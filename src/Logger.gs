/**
 * SentiPulse - Logger.gs
 * Writes events to the Logs tab. Logging must NEVER crash the main job.
 */

const LOG_LEVELS = ['INFO', 'WARN', 'ERROR', 'CRITICAL'];
const MAX_LOG_ROWS = 2000;      // keep about this many rows
const LOG_TRIM_AT = 2200;       // trim when the sheet grows past this
const MAX_DETAILS_LENGTH = 1500;

/**
 * Adds one row to the Logs tab.
 * level: INFO | WARN | ERROR | CRITICAL
 * fn: name of the function that is logging
 * message: short human-readable text
 * details: optional (text, object, or error)
 */
function logEvent_(level, fn, message, details) {
  try {
    const safeLevel = LOG_LEVELS.indexOf(level) === -1 ? 'INFO' : level;
    const detailText = formatLogDetails_(details);

    // Always print to the Apps Script execution log too
    Logger.log('[' + safeLevel + '] ' + fn + ': ' + message +
      (detailText ? ' | ' + detailText : ''));

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOGS);
    if (!sheet) {
      return; // Logs tab missing: validateSheets_ will report it
    }

    sheet.appendRow([new Date(), safeLevel, fn, String(message), detailText]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');

    trimLogs_(sheet);
  } catch (e) {
    // Last resort: never let logging break the main work
    Logger.log('LOGGING FAILED: ' + e);
  }
}

/** Turns details into safe text: hides API keys, limits length. */
function formatLogDetails_(details) {
  if (details === undefined || details === null || details === '') {
    return '';
  }
  let text;
  if (details instanceof Error) {
    text = details.message;
  } else if (typeof details === 'object') {
    try {
      text = JSON.stringify(details);
    } catch (e) {
      text = String(details);
    }
  } else {
    text = String(details);
  }
  // Hide anything that looks like a Google API key
  text = text.replace(/(AIza|gsk_)[0-9A-Za-z_\-]{20,}/g, '[HIDDEN_KEY]');
  if (text.length > MAX_DETAILS_LENGTH) {
    text = text.substring(0, MAX_DETAILS_LENGTH) + '...[cut]';
  }
  return text;
}

/** Deletes the oldest rows when the Logs tab gets too long. */
function trimLogs_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > LOG_TRIM_AT) {
    const rowsToDelete = lastRow - MAX_LOG_ROWS - 1; // keep header + newest rows
    sheet.deleteRows(2, rowsToDelete);
  }
}

/** Run this by hand to test the logger. */
function testLogger() {
  logEvent_('INFO', 'testLogger', 'Logger test started');
  logEvent_('WARN', 'testLogger', 'This is a test warning', { example: 'object details' });
  logEvent_('ERROR', 'testLogger', 'This is a test error', new Error('Fake error for testing'));
  logEvent_('INFO', 'testLogger', 'Key hiding test', 'key=AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345');
}