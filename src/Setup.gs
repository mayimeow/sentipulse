/**
 * SentiPulse - Setup.gs
 * One-time setup helpers. Safe to run more than once.
 */

const MANAGED_TRIGGERS = ['onFormSubmit', 'retryFailed', 'sendDailyDigest'];

/** Creates the automatic triggers (replaces old copies first). */
function setupTriggers() {
  const fn = 'setupTriggers';
  try {
    // Remove old copies so we never end up with duplicates
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (MANAGED_TRIGGERS.indexOf(t.getHandlerFunction()) !== -1) {
        ScriptApp.deleteTrigger(t);
      }
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = String(getSetting_('TIMEZONE') || 'Asia/Manila');

    // 1. Runs every time the Form gets a new response
    ScriptApp.newTrigger('onFormSubmit')
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();

    // 2. Runs every hour to retry Failed rows and catch anything missed
    ScriptApp.newTrigger('retryFailed')
      .timeBased()
      .everyHours(1)
      .create();

    // 3. Runs every morning between 8 and 9 AM (sendDailyDigest checks DIGEST_ENABLED itself)
    ScriptApp.newTrigger('sendDailyDigest')
      .timeBased()
      .atHour(8)
      .everyDays(1)
      .inTimezone(tz)
      .create();

    logEvent_('INFO', fn, 'Triggers created: onFormSubmit, retryFailed (hourly), sendDailyDigest (daily, 8 AM ' + tz + ')');
    listTriggers();
  } catch (e) {
    logEvent_('ERROR', fn, 'Could not create triggers', e);
  }
}

/** Shows which triggers exist (in the Execution log). */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('Triggers found: ' + triggers.length);
  triggers.forEach(function (t) {
    Logger.log('- ' + t.getHandlerFunction() + ' | ' + t.getEventType());
  });
}