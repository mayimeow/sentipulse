/**
 * SentiPulse - Processor.gs (with alerts)
 * Copies new responses into Analysis, analyzes them with the AI, and sends alerts.
 */

// Column positions in the Analysis tab (0 = column A)
const COL = {
  ID: 0, TIMESTAMP: 1, CATEGORY: 2, RATING: 3, FEEDBACK: 4,
  SENTIMENT: 5, SCORE: 6, TOPICS: 7, SUMMARY: 8, URGENT: 9,
  STATUS: 10, PROCESSED_AT: 11, ERROR: 12, RETRY: 13, ALERT: 14
};

const MAX_RUN_MS = 4.5 * 60 * 1000;   // stop before Apps Script's 6 minute limit
const MAX_ROWS_PER_RUN = 20;
const PAUSE_BETWEEN_CALLS_MS = 5000;
const LOCK_WAIT_MS = 30000;
const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';
const MAX_ERROR_LENGTH = 500;
const ALERT_MAX_AGE_HOURS = 48;        // older feedback never sends alerts
const MAX_ALERT_RETRIES_PER_RUN = 5;

/* ---------- Entry points (triggers and manual runs call these) ---------- */

/** Runs on every form submission. */
function onFormSubmit(e) {
  runProcessing_('onFormSubmit', false);
}

/** Runs every hour. Also retries Failed rows. */
function retryFailed() {
  runProcessing_('retryFailed', true);
}

/** Run this by hand to process everything that is waiting. */
function processNow() {
  runProcessing_('processNow', true);
}

/* ---------- Main runner ---------- */

function runProcessing_(source, includeFailed) {
  const fn = 'runProcessing_';
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(LOCK_WAIT_MS)) {
    logEvent_('WARN', fn, 'Another run is busy, so this run was skipped (' + source +
      '). Waiting rows are picked up next time');
    return;
  }

  try {
    const check = validateSheets_();
    if (!check.ok) {
      const problems = check.problems.join(' | ');
      logEvent_('CRITICAL', fn, 'Setup check failed, run stopped', problems);
      sendAdminAlert_('Setup check failed', problems);
      return;
    }

    const added = syncNewResponses_();
    if (added > 0) {
      logEvent_('INFO', fn, added + ' new response(s) copied to Analysis', source);
    }

    const summary = processRows_(includeFailed);
    if (summary.analyzed > 0) { invalidateDashboardCache_(); }
    sendPendingAlerts_();
    logEvent_('INFO', fn, 'Run finished (' + source + ')', summary);
  } catch (e) {
    logEvent_('ERROR', fn, 'Unexpected crash in ' + source, e);
    sendAdminAlert_('Unexpected crash in ' + source, e && e.message ? e.message : e);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Step A: copy new Responses rows into Analysis ---------- */

/** Returns how many new rows were added. Safe to run many times. */
function syncNewResponses_() {
  const responses = getSheet_(SHEET_NAMES.RESPONSES);
  const analysis = getSheet_(SHEET_NAMES.ANALYSIS);

  const lastResponseRow = responses.getLastRow();
  if (lastResponseRow < 2) {
    return 0;
  }

  // Which Response IDs are already in Analysis?
  const known = {};
  const lastAnalysisRow = analysis.getLastRow();
  if (lastAnalysisRow >= 2) {
    analysis.getRange(2, 1, lastAnalysisRow - 1, 1).getValues().forEach(function (r) {
      known[String(r[0])] = true;
    });
  }

  // Responses columns: A Timestamp, B Category, C Rating, D Feedback, E Email
  const data = responses.getRange(2, 1, lastResponseRow - 1, 5).getValues();
  const newRows = [];

  data.forEach(function (row, i) {
    const id = 'R-' + (i + 2);          // R- plus the row number in Responses
    if (known[id]) { return; }
    if (!row[0] && !row[3]) { return; } // completely empty row
    newRows.push([id, row[0], row[1], row[2], row[3],
                  '', '', '', '', '', 'Pending', '', '', 0, '']);
  });

  if (newRows.length === 0) {
    return 0;
  }

  const startRow = analysis.getLastRow() + 1;
  analysis.getRange(startRow, 1, newRows.length, 15).setValues(newRows);
  analysis.getRange(startRow, 2, newRows.length, 1).setNumberFormat(DATE_FORMAT);
  return newRows.length;
}

/* ---------- Step B: analyze waiting rows ---------- */

function processRows_(includeFailed) {
  const fn = 'processRows_';
  const summary = { analyzed: 0, failed: 0, stopped: '' };
  const gaveUp = [];

  const analysis = getSheet_(SHEET_NAMES.ANALYSIS);
  const lastRow = analysis.getLastRow();
  if (lastRow < 2) {
    return summary;
  }

  const maxRetries = Number(getSetting_('MAX_RETRIES')) || 3;
  const rows = analysis.getRange(2, 1, lastRow - 1, 15).getValues();
  const startTime = new Date().getTime();
  let attempted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = String(row[COL.STATUS]).trim();
    const retries = Number(row[COL.RETRY]) || 0;

    const waiting = (status === 'Pending' || status === '');
    const retryable = (includeFailed && status === 'Failed' && retries < maxRetries);
    if (!waiting && !retryable) { continue; }

    if (attempted >= MAX_ROWS_PER_RUN) {
      summary.stopped = 'row limit reached';
      break;
    }
    if (new Date().getTime() - startTime > MAX_RUN_MS) {
      summary.stopped = 'time limit reached';
      break;
    }

    const sheetRow = i + 2;
    const id = String(row[COL.ID]);
    attempted++;

    const result = analyzeFeedback_(row[COL.FEEDBACK], row[COL.CATEGORY], row[COL.RATING]);

    if (result.ok) {
      writeSuccess_(analysis, sheetRow, result.data, retries);
      summary.analyzed++;
      logEvent_('INFO', fn, id + ' analyzed', result.data.sentiment + ' (' + result.data.score + ') via ' + (result.provider || 'gemini'));

      handleAlert_(analysis, sheetRow, {
        id: id,
        timestamp: row[COL.TIMESTAMP],
        category: row[COL.CATEGORY],
        rating: row[COL.RATING],
        feedback: row[COL.FEEDBACK],
        sentiment: result.data.sentiment,
        score: result.data.score,
        topics: result.data.topics.join(', '),
        summary: result.data.summary,
        urgent: result.data.urgent
      });

    } else if (result.fatal) {
      // Setup problem: stop everything, leave this row waiting
      logEvent_('CRITICAL', fn, 'Setup problem, run stopped at ' + id, result.error);
      sendAdminAlert_('AI setup problem, processing stopped', result.error);
      summary.stopped = 'fatal error: ' + result.error;
      break;

    } else if (result.throttled) {
      // Gemini is busy or the limit is reached: pause the whole run, do not blame this row
      logEvent_('WARN', fn, 'Gemini is busy or the rate limit was reached. Run paused at ' + id +
        '. Waiting rows are picked up later', result.error);
      summary.stopped = 'rate limit or busy';
      break;

    } else {
      const newRetries = result.retryable ? retries + 1 : maxRetries;
      writeFailure_(analysis, sheetRow, result.error, newRetries);
      summary.failed++;
      logEvent_('ERROR', fn, id + ' failed (attempt ' + newRetries + ' of ' + maxRetries + ')', result.error);
      if (newRetries >= maxRetries) {
        logEvent_('ERROR', fn, id + ' will not be retried again', result.error);
        gaveUp.push(id + ': ' + String(result.error).substring(0, 150));
      }
    }
    Utilities.sleep(PAUSE_BETWEEN_CALLS_MS);
  }

  if (gaveUp.length > 0) {
    sendAdminAlert_(gaveUp.length + ' feedback(s) could not be analyzed', gaveUp.join('\n'));
  }
  return summary;
}

/** Writes columns F to N (Sentiment ... Retry Count) for a successful row. */
function writeSuccess_(sheet, row, data, retries) {
  sheet.getRange(row, 6, 1, 9).setValues([[
    data.sentiment, data.score, data.topics.join(', '), data.summary, data.urgent,
    'Done', new Date(), '', retries
  ]]);
  sheet.getRange(row, 12).setNumberFormat(DATE_FORMAT);
}

/** Writes columns F to N for a failed row (AI columns stay empty). */
function writeFailure_(sheet, row, errorText, retries) {
  sheet.getRange(row, 6, 1, 9).setValues([[
    '', '', '', '', '',
    'Failed', new Date(), String(errorText).substring(0, MAX_ERROR_LENGTH), retries
  ]]);
  sheet.getRange(row, 12).setNumberFormat(DATE_FORMAT);
}

/* ---------- Step C: alerts ---------- */

/** True if the feedback is newer than ALERT_MAX_AGE_HOURS. */
function isRecent_(timestamp) {
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
    return true;   // unknown time: better to alert than to miss something
  }
  return (new Date().getTime() - timestamp.getTime()) <= ALERT_MAX_AGE_HOURS * 3600 * 1000;
}

/** Decides, sends, and records the alert for one analyzed row. */
function handleAlert_(sheet, sheetRow, item) {
  const fn = 'handleAlert_';
  const cell = sheet.getRange(sheetRow, COL.ALERT + 1);

  if (!shouldAlert_(item.score, item.urgent)) {
    cell.setValue('No');
    return;
  }
  if (!isRecent_(item.timestamp)) {
    cell.setValue('Skipped');
    logEvent_('INFO', fn, item.id + ': alert skipped (feedback older than ' + ALERT_MAX_AGE_HOURS + ' hours)');
    return;
  }

  item.customerEmail = getCustomerEmail_(item.id);
  const result = sendNegativeAlert_(item);

  if (result.ok) {
    cell.setValue('Yes');
    logEvent_('INFO', fn, item.id + ': alert email sent', item.sentiment + ' (' + item.score + ')' +
      (item.urgent === true ? ' URGENT' : ''));
  } else {
    cell.setValue('Failed');
    logEvent_('ERROR', fn, item.id + ': alert email failed, will retry on a later run', result.error);
  }
}

/** Builds an alert item from an Analysis row. */
function itemFromRow_(row) {
  return {
    id: String(row[COL.ID]), timestamp: row[COL.TIMESTAMP], category: row[COL.CATEGORY],
    rating: row[COL.RATING], feedback: row[COL.FEEDBACK], sentiment: row[COL.SENTIMENT],
    score: row[COL.SCORE], topics: row[COL.TOPICS], summary: row[COL.SUMMARY],
    urgent: row[COL.URGENT]
  };
}

/** Retries alerts that previously failed to send (a few per run). */
function sendPendingAlerts_() {
  const fn = 'sendPendingAlerts_';
  const analysis = getSheet_(SHEET_NAMES.ANALYSIS);
  const lastRow = analysis.getLastRow();
  if (lastRow < 2) { return; }

  const rows = analysis.getRange(2, 1, lastRow - 1, 15).getValues();
  let tried = 0;

  for (let i = 0; i < rows.length && tried < MAX_ALERT_RETRIES_PER_RUN; i++) {
    const row = rows[i];
    if (String(row[COL.STATUS]).trim() !== 'Done') { continue; }
    if (String(row[COL.ALERT]).trim() !== 'Failed') { continue; }
    tried++;
    handleAlert_(analysis, i + 2, itemFromRow_(row));
  }
  if (tried > 0) {
    logEvent_('INFO', fn, 'Retried ' + tried + ' failed alert(s)');
  }
}