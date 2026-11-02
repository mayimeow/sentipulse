/**
 * SentiPulse - SelfTest.gs
 * One button that checks the most important parts.
 * Safe: changes no data and sends no email.
 */

function runSelfTests() {
  const results = [];

  // fn returns: true = PASS, { warn: 'text' } = WARNING, anything else = FAIL (text shown)
  const test = function (name, fn) {
    try {
      const out = fn();
      if (out === true) { results.push({ name: name, status: 'PASS', note: '' }); }
      else if (out && out.warn) { results.push({ name: name, status: 'WARN', note: out.warn }); }
      else { results.push({ name: name, status: 'FAIL', note: String(out) }); }
    } catch (e) {
      results.push({ name: name, status: 'FAIL', note: 'Crashed: ' + e.message });
    }
  };

  /* ----- Setup ----- */

  test('Tabs, headers and settings pass the setup check', function () {
    const c = validateSheets_();
    return c.ok ? true : c.problems.join('; ');
  });

  test('All 3 automatic triggers exist', function () {
    const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    const missing = ['onFormSubmit', 'retryFailed', 'sendDailyDigest'].filter(function (n) { return have.indexOf(n) === -1; });
    return missing.length === 0 ? true : 'Missing: ' + missing.join(', ') + ' (run setupTriggers)';
  });

  test('Gemini key is saved', function () {
    return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') ? true : 'GEMINI_API_KEY is missing';
  });

  test('Fallback AI is ready (optional)', function () {
    return getFallbackConfig_() ? true : { warn: 'Not set up. Gemini will work alone.' };
  });

  test('Email quota left today', function () {
    const left = MailApp.getRemainingDailyQuota();
    return left >= 10 ? true : { warn: 'Only ' + left + ' emails left today' };
  });

  /* ----- Logic ----- */

  test('AI reply checker rejects bad replies and fixes small mistakes', function () {
    if (parseAIResponse_('').ok) { return 'Empty reply was accepted'; }
    if (parseAIResponse_('not json at all').ok) { return 'Text without JSON was accepted'; }
    if (parseAIResponse_('{"sentiment":"Angry","sentiment_score":-1,"topics":["Other"],"summary":"x","urgent":false}').ok) {
      return 'Invalid sentiment was accepted';
    }
    const fixed = parseAIResponse_('{"sentiment":"negative","sentiment_score":-3,"topics":["Parking"],"summary":"x","urgent":"true"}');
    if (!fixed.ok) { return 'A fixable reply was rejected: ' + fixed.error; }
    if (fixed.data.score !== -1) { return 'Score was not clamped to -1'; }
    if (fixed.data.topics[0] !== 'Other') { return 'Unknown topic was not replaced with Other'; }
    if (fixed.data.urgent !== true) { return 'Urgent text "true" was not converted'; }
    return true;
  });

  test('Alert rules follow the threshold and urgent flag', function () {
    const t = Number(getSetting_('ALERT_THRESHOLD'));
    const limit = isFinite(t) ? t : -0.4;
    if (!shouldAlert_(limit - 0.1, false)) { return 'Very negative score did not alert'; }
    if (!shouldAlert_(limit, false)) { return 'Score exactly at the threshold did not alert'; }
    if (shouldAlert_(0.5, false)) { return 'Positive feedback alerted'; }
    if (!shouldAlert_(0.5, true)) { return 'Urgent feedback did not alert'; }
    if (shouldAlert_('', false)) { return 'Empty score alerted'; }
    return true;
  });

  test('Dashboard filters clean up strange input', function () {
    const bad = normalizeFilters_({ range: 'abc', from: 'zzz', category: '<script>', sentiment: 'x' });
    if (bad.range !== '30d' || bad.category !== 'All' || bad.sentiment !== 'All') { return 'Bad input was not reset: ' + JSON.stringify(bad); }
    const swapped = normalizeFilters_({ range: 'custom', from: '2026-10-31', to: '2026-10-01' });
    if (swapped.from !== '2026-10-01' || swapped.to !== '2026-10-31') { return 'Backwards dates were not swapped'; }
    const fake = normalizeFilters_({ range: 'custom', from: '2026-02-31', to: '2026-03-05' });
    if (fake.range === 'custom') { return 'Impossible date 2026-02-31 was accepted'; }
    return true;
  });

  test('HTML in customer text is made harmless', function () {
    const out = escapeHtml_('<script>alert("x")</script>');
    return (out.indexOf('<') === -1 && out.indexOf('>') === -1) ? true : 'Tags were not escaped: ' + out;
  });

  test('Logger hides API keys (Google and Groq)', function () {
    const a = formatLogDetails_('key=AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345');
    const b = formatLogDetails_('key=gsk_FAKEKEYFAKEKEYFAKEKEYFAKEKEY12345');
    if (a.indexOf('AIza') !== -1) { return 'Google key was not hidden'; }
    if (b.indexOf('gsk_') !== -1) { return 'Groq key was not hidden'; }
    return true;
  });

  /* ----- Dashboard ----- */

  test('Dashboard data builds and contains no customer emails', function () {
    const d = getDashboardData({ range: 'all', category: 'All', sentiment: 'All' }, true);
    if (!d.ok) { return 'Dashboard failed: ' + d.error; }
    const leak = d.recent.some(function (r) { return ('email' in r) || ('customerEmail' in r); });
    return leak ? 'Customer email found in dashboard data' : true;
  });

  test('Dashboard handles a period with no data', function () {
    const d = getDashboardData({ range: 'custom', from: '2000-01-01', to: '2000-01-02', category: 'All', sentiment: 'All' }, true);
    if (!d.ok) { return 'Dashboard failed: ' + d.error; }
    return d.empty === true ? true : 'Expected an empty result';
  });

  /* ----- Data quality ----- */

  const analysis = getSheet_(SHEET_NAMES.ANALYSIS);
  const last = analysis.getLastRow();
  const rows = last >= 2 ? analysis.getRange(2, 1, last - 1, 15).getValues() : [];

  test('No duplicate Response IDs', function () {
    const seen = {};
    const dupes = [];
    rows.forEach(function (r) {
      const id = String(r[COL.ID]);
      if (seen[id]) { dupes.push(id); }
      seen[id] = true;
    });
    return dupes.length === 0 ? true : 'Duplicates: ' + dupes.join(', ');
  });

  test('Every Done row has sentiment, score and topics', function () {
    const bad = rows.filter(function (r) {
      return String(r[COL.STATUS]).trim() === 'Done' &&
             (!r[COL.SENTIMENT] || r[COL.SCORE] === '' || !r[COL.TOPICS]);
    }).map(function (r) { return r[COL.ID]; });
    return bad.length === 0 ? true : 'Incomplete rows: ' + bad.join(', ');
  });

  test('No rows stuck in Pending or Failed', function () {
    let pending = 0, failed = 0;
    rows.forEach(function (r) {
      const s = String(r[COL.STATUS]).trim();
      if (s === 'Failed') { failed++; } else if (s === 'Pending' || s === '') { pending++; }
    });
    return (pending + failed === 0) ? true : { warn: pending + ' pending, ' + failed + ' failed (run processNow to continue)' };
  });

  /* ----- Report ----- */

  const count = { PASS: 0, WARN: 0, FAIL: 0 };
  results.forEach(function (r) {
    count[r.status]++;
    Logger.log(r.status + '  ' + r.name + (r.note ? '  ->  ' + r.note : ''));
  });

  const summary = 'Self-test: ' + count.PASS + ' passed, ' + count.WARN + ' warning(s), ' + count.FAIL + ' failed';
  Logger.log(summary);
  logEvent_(count.FAIL ? 'ERROR' : (count.WARN ? 'WARN' : 'INFO'), 'runSelfTests', summary,
    results.filter(function (r) { return r.status !== 'PASS'; })
           .map(function (r) { return r.status + ': ' + r.name + ' (' + r.note + ')'; }).join(' | '));
}