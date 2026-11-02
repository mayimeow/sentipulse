/**
 * SentiPulse - Config.gs
 * Reads settings from the Config tab and validates the sheet structure.
 */

const SHEET_NAMES = {
  RESPONSES: 'Responses',
  ANALYSIS: 'Analysis',
  CONFIG: 'Config',
  LOGS: 'Logs'
};

const ANALYSIS_HEADERS = [
  'Response ID', 'Timestamp', 'Category', 'Rating', 'Feedback',
  'Sentiment', 'Sentiment Score', 'Topics', 'Summary', 'Urgent',
  'Status', 'Processed At', 'Error', 'Retry Count', 'Alert Sent'
];

// Used if a setting is missing from the Config tab
const DEFAULT_CONFIG = {
  BUSINESS_NAME: 'Kanto Brew Co.',
  ALERT_EMAIL: '',
  ALERT_THRESHOLD: -0.4,
  AI_PROVIDER: 'gemini',
  AI_MODEL: '',
  MAX_RETRIES: 3,
  WORD_FREQ_TOP_N: 30,
  CACHE_SECONDS: 300,
  DIGEST_ENABLED: true,
  TIMEZONE: 'Asia/Manila'
};

/** Returns a tab by name, or throws a clear error if it is missing. */
function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing sheet tab: ' + name);
  }
  return sheet;
}

/** Reads the Config tab into an object like { ALERT_EMAIL: '...', ... }. */
function getConfig_() {
  const rows = getSheet_(SHEET_NAMES.CONFIG).getDataRange().getValues();
  const config = Object.assign({}, DEFAULT_CONFIG);
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0]).trim();
    const value = rows[i][1];
    if (key && value !== '' && value !== null) {
      config[key] = value;
    }
  }
  return config;
}

/** Returns one setting, for example getSetting_('ALERT_EMAIL'). */
function getSetting_(key) {
  return getConfig_()[key];
}

/** Reads the first `count` header cells of a tab. */
function readHeaders_(sheet, count) {
  const cols = Math.min(count, sheet.getMaxColumns());
  return sheet.getRange(1, 1, 1, cols).getValues()[0];
}

/**
 * Checks tabs, headers, and settings.
 * Returns { ok: true/false, problems: [list of text messages] }.
 */
function validateSheets_() {
  const problems = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. All four tabs must exist
  Object.keys(SHEET_NAMES).forEach(function (key) {
    if (!ss.getSheetByName(SHEET_NAMES[key])) {
      problems.push('Missing tab: ' + SHEET_NAMES[key]);
    }
  });
  if (problems.length > 0) {
    return { ok: false, problems: problems };
  }

  // 2. Analysis headers must match exactly
  const analysisHeaders = readHeaders_(getSheet_(SHEET_NAMES.ANALYSIS), ANALYSIS_HEADERS.length);
  ANALYSIS_HEADERS.forEach(function (expected, i) {
    const actual = String(analysisHeaders[i] || '').trim();
    if (actual !== expected) {
      problems.push('Analysis column ' + (i + 1) + ' should be "' + expected + '" but is "' + actual + '"');
    }
  });

  // 3. Responses headers: check by keyword (the Form owns the exact text)
  const responseHeaders = readHeaders_(getSheet_(SHEET_NAMES.RESPONSES), 5)
    .map(function (h) { return String(h).toLowerCase(); });
  const expectedKeywords = [
    ['timestamp', 'Timestamp'],
    ['about', 'Category'],
    ['rate', 'Rating'],
    ['feedback', 'Feedback text'],
    ['email', 'Email']
  ];
  expectedKeywords.forEach(function (item, i) {
    if ((responseHeaders[i] || '').indexOf(item[0]) === -1) {
      problems.push('Responses column ' + (i + 1) + ' should be the ' + item[1] + ' question');
    }
  });

  // 4. Important settings
  const config = getConfig_();
  if (String(config.ALERT_EMAIL).indexOf('@') === -1) {
    problems.push('Config: ALERT_EMAIL is missing or not a valid email');
  }
  if (String(config.AI_PROVIDER).toLowerCase() === 'gemini' &&
      !PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
    problems.push('Script Property GEMINI_API_KEY is missing');
  }

  return { ok: problems.length === 0, problems: problems };
}

/** Run this by hand to test your setup. */
function testConfig() {
  Logger.log('Settings: ' + JSON.stringify(getConfig_()));
  const result = validateSheets_();
  if (result.ok) {
    Logger.log('ALL CHECKS PASSED');
  } else {
    Logger.log('PROBLEMS FOUND:\n- ' + result.problems.join('\n- '));
  }
}