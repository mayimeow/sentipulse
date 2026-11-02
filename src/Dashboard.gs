/**
 * SentiPulse - Dashboard.gs
 * Web app entry point and the data the dashboard page needs.
 * Includes month and custom date filters. All dates use the Config timezone.
 */

const CATEGORIES = ['Overall Experience', 'Product Quality', 'Customer Service',
                    'Delivery', 'Pricing', 'Website/App', 'Other'];
const SENTIMENT_ORDER = ['Positive', 'Neutral', 'Mixed', 'Negative'];
const QUICK_RANGES = { '7d': 7, '30d': 30, '90d': 90 };
const NAMED_RANGES = ['thisMonth', 'lastMonth', 'all'];
const DEFAULT_RANGE = '30d';
const MAX_CUSTOM_DAYS = 1100;
const RECENT_LIMIT = 100;
const MAX_CACHE_CHARS = 80000;
const MIN_WORD_LENGTH = 3;
const MAX_FEEDBACK_CHARS_SENT = 600;
const DAY_MS = 86400000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Words that are not useful in the word chart (English and Filipino).
// Add more here any time you see a boring word in the chart.
const STOPWORD_TEXT =
  'the and for are but not you your yours was were this that with have has had they them their from what when ' +
  'where which who will would could should can cant dont didnt wasnt isnt its it\'s i\'m i\'ve don\'t didn\'t ' +
  'just very really too also than then there here about into over after before again more most some such only ' +
  'own same been being does did doing out off why how all any both each few other because until while above ' +
  'below between during these those our ours she him her his hers myself yourself itself once under further ' +
  'even much many get got getting make made one two like said say says went come came need needs want wanted ' +
  'ang ng sa na at ay po opo naman lang yung yun ung ko mo ka ako ikaw siya kami tayo sila ito iyon iyan dito ' +
  'doon pero kasi para kung din rin pa ba nga talaga sobra sobrang mga si ni kay sana wala may meron hindi ' +
  'huwag pag kapag habang lahat nang mag nag naka nung pag lang eh ha';

const STOPWORDS = (function () {
  const map = {};
  STOPWORD_TEXT.split(/\s+/).forEach(function (w) { if (w) { map[w] = true; } });
  return map;
})();

/* =========================================================
 * Web app entry points
 * ========================================================= */

/** Opens the dashboard page. */
function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('SentiPulse Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    logEvent_('ERROR', 'doGet', 'Dashboard page failed to load', err);
    return HtmlService.createHtmlOutput(
      '<h3>SentiPulse dashboard is not ready yet</h3><p>' + escapeHtml_(err.message) + '</p>');
  }
}

/** Lets Index.html pull in other files: <?!= include('Styles') ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Called by the dashboard page. Never throws: returns { ok: false, error } on failure.
 * filters: { range, from, to, category, sentiment }
 *   range: '7d' | '30d' | '90d' | 'thisMonth' | 'lastMonth' | 'all' | 'month:YYYY-MM' | 'custom'
 *   from/to: 'YYYY-MM-DD' (only used when range is 'custom')
 */
function getDashboardData(filters, forceRefresh) {
  const fn = 'getDashboardData';
  try {
    const f = normalizeFilters_(filters);
    const key = cacheKey_(f);
    const cache = CacheService.getScriptCache();

    if (!forceRefresh) {
      try {
        const hit = cache.get(key);
        if (hit) {
          const cached = JSON.parse(hit);
          cached.fromCache = true;
          return cached;
        }
      } catch (e) {
        logEvent_('WARN', fn, 'Cache read failed, reading the sheet instead', e);
      }
    }

    const data = buildDashboardData_(f);
    data.fromCache = false;

    try {
      const json = JSON.stringify(data);
      if (json.length <= MAX_CACHE_CHARS) {
        const ttl = Math.max(10, Math.min(21600, Number(getSetting_('CACHE_SECONDS')) || 300));
        cache.put(key, json, ttl);
      }
    } catch (e) {
      Logger.log('Cache write skipped: ' + e);
    }
    return data;
  } catch (e) {
    logEvent_('ERROR', fn, 'Dashboard data failed', e);
    return { ok: false, error: 'The dashboard could not load its data. Please try again in a moment.' };
  }
}

/* =========================================================
 * Cache and filter helpers
 * ========================================================= */

function cacheKey_(f) {
  const version = PropertiesService.getScriptProperties().getProperty('DASH_VERSION') || '1';
  return ('dash_' + version + '_' + f.range + '_' + f.from + '_' + f.to + '_' + f.category + '_' + f.sentiment).substring(0, 240);
}

/** Makes every cached dashboard answer old, so the next request reads fresh data. */
function invalidateDashboardCache_() {
  try {
    PropertiesService.getScriptProperties().setProperty('DASH_VERSION', String(new Date().getTime()));
  } catch (e) {
    Logger.log('Could not clear dashboard cache: ' + e);
  }
}

/** True for a real calendar date written as YYYY-MM-DD. */
function isValidKey_(key) {
  const s = String(key || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { return false; }
  const t = Date.parse(s + 'T00:00:00Z');
  return isFinite(t) && new Date(t).toISOString().substring(0, 10) === s;
}

/** Only allows known filter values. Anything else falls back to a default. */
function normalizeFilters_(filters) {
  const f = filters || {};
  const r = String(f.range || '');
  let range = DEFAULT_RANGE, from = '', to = '';

  if (QUICK_RANGES.hasOwnProperty(r) || NAMED_RANGES.indexOf(r) !== -1) {
    range = r;
  } else if (/^month:\d{4}-(0[1-9]|1[0-2])$/.test(r)) {
    range = r;
  } else if (r === 'custom' && isValidKey_(f.from) && isValidKey_(f.to)) {
    range = 'custom';
    from = String(f.from);
    to = String(f.to);
    if (from > to) { const tmp = from; from = to; to = tmp; }
    if (daysBetween_(from, to) > MAX_CUSTOM_DAYS) { to = addDays_(from, MAX_CUSTOM_DAYS); }
  }

  const category = (f.category === 'All' || CATEGORIES.indexOf(f.category) !== -1) ? f.category : 'All';
  const sentiment = (f.sentiment === 'All' || SENTIMENT_ORDER.indexOf(f.sentiment) !== -1) ? f.sentiment : 'All';
  return { range: range, from: from, to: to, category: category, sentiment: sentiment };
}

/* =========================================================
 * Date helpers (days are text like 2026-10-31, so no timezone surprises)
 * ========================================================= */

function round_(n, digits) {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

function dayKey_(ms, tz) {
  return Utilities.formatDate(new Date(ms), tz, 'yyyy-MM-dd');
}

function addDays_(key, n) {
  return new Date(Date.parse(key + 'T00:00:00Z') + n * DAY_MS).toISOString().substring(0, 10);
}

function daysBetween_(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

/** monthKey like '2026-10'. n can be negative. */
function addMonths_(monthKey, n) {
  const y = Number(monthKey.substring(0, 4));
  const m = Number(monthKey.substring(5, 7));
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().substring(0, 7);
}

/** Last day of the month that dayKey belongs to. */
function monthEnd_(key) {
  const y = Number(key.substring(0, 4));
  const m = Number(key.substring(5, 7));
  return new Date(Date.UTC(y, m, 1) - DAY_MS).toISOString().substring(0, 10);
}

function fmtKey_(key) {
  const p = String(key).split('-');
  return MONTH_NAMES[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0];
}

function fmtMonth_(monthKey) {
  return MONTH_NAMES[Number(monthKey.substring(5, 7)) - 1] + ' ' + monthKey.substring(0, 4);
}

/** Monday of the week that contains the day. */
function mondayOf_(key) {
  const dow = new Date(Date.parse(key + 'T00:00:00Z')).getUTCDay();   // 0 = Sunday
  return addDays_(key, -((dow + 6) % 7));
}

function bucketOf_(key, unit) {
  if (unit === 'week') { return mondayOf_(key); }
  if (unit === 'month') { return key.substring(0, 7) + '-01'; }
  return key;
}

function bucketKeys_(startKey, endKey, unit) {
  const keys = [];
  const last = bucketOf_(endKey, unit);
  let k = bucketOf_(startKey, unit);
  let guard = 0;
  while (k <= last && guard++ < 1000) {
    keys.push(k);
    if (unit === 'day') { k = addDays_(k, 1); }
    else if (unit === 'week') { k = addDays_(k, 7); }
    else { k = addMonths_(k.substring(0, 7), 1) + '-01'; }
  }
  return keys;
}

/**
 * Works out the dates for the chosen range and the period to compare with.
 * Returns { start, end, trendEnd, prevStart, prevEnd, label, compareLabel }
 */
function resolvePeriod_(f, todayKey, firstKey) {
  const r = f.range;
  let start, end, prevStart = null, prevEnd = null, label, compareLabel = '';

  if (QUICK_RANGES.hasOwnProperty(r)) {
    const days = QUICK_RANGES[r];
    end = todayKey;
    start = addDays_(end, -(days - 1));
    prevEnd = addDays_(start, -1);
    prevStart = addDays_(prevEnd, -(days - 1));
    label = 'Last ' + days + ' days';
    compareLabel = 'previous ' + days + ' days';

  } else if (r === 'thisMonth' || r === 'lastMonth' || r.indexOf('month:') === 0) {
    let mk;
    if (r === 'thisMonth') { mk = todayKey.substring(0, 7); }
    else if (r === 'lastMonth') { mk = addMonths_(todayKey.substring(0, 7), -1); }
    else { mk = r.substring(6); }

    start = mk + '-01';
    end = monthEnd_(start);
    const pm = addMonths_(mk, -1);
    prevStart = pm + '-01';
    prevEnd = monthEnd_(prevStart);
    label = fmtMonth_(mk);
    compareLabel = fmtMonth_(pm);

    if (todayKey >= start && todayKey < end) {            // month still in progress
      const elapsed = daysBetween_(start, todayKey);      // 0 on the 1st
      const sameDay = addDays_(prevStart, elapsed);
      if (sameDay < prevEnd) {
        prevEnd = sameDay;                                // compare the same number of days
        compareLabel += ' (first ' + (elapsed + 1) + ' days)';
      }
    }

  } else if (r === 'custom') {
    start = f.from;
    end = f.to;
    const span = daysBetween_(start, end) + 1;
    prevEnd = addDays_(start, -1);
    prevStart = addDays_(prevEnd, -(span - 1));
    label = 'Custom range';
    compareLabel = 'previous ' + span + ' days';

  } else {                                                 // all time
    start = firstKey || todayKey;
    end = todayKey;
    label = 'All time';
  }

  let trendEnd = end > todayKey ? todayKey : end;
  if (trendEnd < start) { trendEnd = start; }
  return { start: start, end: end, trendEnd: trendEnd, prevStart: prevStart, prevEnd: prevEnd,
           label: label, compareLabel: compareLabel };
}

/** Totals for a list of parsed feedback rows. */
function summarize_(list) {
  let ratingSum = 0, ratingN = 0, scoreSum = 0, scoreN = 0, negative = 0, urgent = 0;
  list.forEach(function (r) {
    if (isFinite(r.rating) && r.rating > 0) { ratingSum += r.rating; ratingN++; }
    if (isFinite(r.score)) { scoreSum += r.score; scoreN++; }
    if (r.sentiment === 'Negative') { negative++; }
    if (r.urgent) { urgent++; }
  });
  return {
    total: list.length,
    avgRating: ratingN ? round_(ratingSum / ratingN, 1) : null,
    avgScore: scoreN ? round_(scoreSum / scoreN, 2) : null,
    negativePct: list.length ? Math.round(100 * negative / list.length) : 0,
    urgent: urgent
  };
}

/* =========================================================
 * The big builder
 * ========================================================= */

function buildDashboardData_(f) {
  const tz = String(getSetting_('TIMEZONE') || 'Asia/Manila');
  const sheet = getSheet_(SHEET_NAMES.ANALYSIS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 15).getValues() : [];
  const nowMs = new Date().getTime();
  const todayKey = dayKey_(nowMs, tz);

  // 1. Read rows: count health numbers, keep valid Done rows
  let waiting = 0, failed = 0, skipped = 0;
  const parsed = [];

  rows.forEach(function (row) {
    const status = String(row[COL.STATUS]).trim();
    if (status === 'Failed') { failed++; }
    if (status === 'Pending' || status === '') { waiting++; }
    if (status !== 'Done') { return; }

    const ts = row[COL.TIMESTAMP];
    if (!(ts instanceof Date) || isNaN(ts.getTime())) { skipped++; return; }

    parsed.push({
      id: String(row[COL.ID]),
      ts: ts.getTime(),
      dayKey: dayKey_(ts.getTime(), tz),
      category: String(row[COL.CATEGORY]),
      rating: Number(row[COL.RATING]),
      feedback: String(row[COL.FEEDBACK]),
      sentiment: String(row[COL.SENTIMENT]),
      score: row[COL.SCORE] === '' ? NaN : Number(row[COL.SCORE]),
      topics: String(row[COL.TOPICS]).split(',').map(function (t) { return t.trim(); }).filter(Boolean),
      summary: String(row[COL.SUMMARY]),
      urgent: (row[COL.URGENT] === true || String(row[COL.URGENT]).toUpperCase() === 'TRUE')
    });
  });

  // 2. Months that have data (for the month dropdown), newest first
  const monthSet = {};
  parsed.forEach(function (r) { monthSet[r.dayKey.substring(0, 7)] = true; });
  monthSet[todayKey.substring(0, 7)] = true;
  const months = Object.keys(monthSet).sort().reverse().map(function (m) {
    return { value: m, label: fmtMonth_(m) };
  });

  // 3. Category and sentiment filters
  const scoped = parsed.filter(function (r) {
    return (f.category === 'All' || r.category === f.category) &&
           (f.sentiment === 'All' || r.sentiment === f.sentiment);
  });

  // 4. Dates: current period and the period to compare with
  let firstKey = '';
  scoped.forEach(function (r) { if (!firstKey || r.dayKey < firstKey) { firstKey = r.dayKey; } });
  const p = resolvePeriod_(f, todayKey, firstKey);

  const current = scoped.filter(function (r) { return r.dayKey >= p.start && r.dayKey <= p.end; });
  const previous = p.prevStart ? scoped.filter(function (r) {
    return r.dayKey >= p.prevStart && r.dayKey <= p.prevEnd;
  }) : null;

  // 5. KPIs and comparison
  const kpis = summarize_(current);
  kpis.waiting = waiting;
  kpis.failed = failed;
  const compare = previous ? summarize_(previous) : null;

  // 6. Sentiment distribution
  const distribution = { Positive: 0, Neutral: 0, Mixed: 0, Negative: 0 };
  current.forEach(function (r) {
    if (distribution[r.sentiment] !== undefined) { distribution[r.sentiment]++; }
  });

  // 7. Trend (days, weeks, or months depending on how long the period is)
  const span = daysBetween_(p.start, p.trendEnd) + 1;
  const unit = span <= 62 ? 'day' : (span <= 400 ? 'week' : 'month');
  let trend = [];
  if (current.length > 0) {
    const buckets = {};
    current.forEach(function (r) {
      const bk = bucketOf_(r.dayKey, unit);
      const b = buckets[bk] || (buckets[bk] =
        { count: 0, scoreSum: 0, scoreN: 0, Positive: 0, Neutral: 0, Mixed: 0, Negative: 0 });
      b.count++;
      if (isFinite(r.score)) { b.scoreSum += r.score; b.scoreN++; }
      if (b[r.sentiment] !== undefined) { b[r.sentiment]++; }
    });
    trend = bucketKeys_(p.start, p.trendEnd, unit).map(function (key) {
      const b = buckets[key];
      return {
        date: key,
        count: b ? b.count : 0,
        avgScore: b && b.scoreN ? round_(b.scoreSum / b.scoreN, 2) : null,
        Positive: b ? b.Positive : 0, Neutral: b ? b.Neutral : 0,
        Mixed: b ? b.Mixed : 0, Negative: b ? b.Negative : 0
      };
    });
  }

  // 8. Topics: top complaints (Negative + Mixed) and all-topic stats
  const complaintCounts = {};
  const topicStats = {};
  current.forEach(function (r) {
    r.topics.forEach(function (t) {
      const s = topicStats[t] || (topicStats[t] = { count: 0, scoreSum: 0, scoreN: 0 });
      s.count++;
      if (isFinite(r.score)) { s.scoreSum += r.score; s.scoreN++; }
      if (r.sentiment === 'Negative' || r.sentiment === 'Mixed') {
        complaintCounts[t] = (complaintCounts[t] || 0) + 1;
      }
    });
  });
  const topComplaints = Object.keys(complaintCounts)
    .map(function (t) { return { topic: t, count: complaintCounts[t] }; })
    .sort(function (a, b) { return b.count - a.count || a.topic.localeCompare(b.topic); })
    .slice(0, 10);
  const topics = Object.keys(topicStats)
    .map(function (t) {
      const s = topicStats[t];
      return { topic: t, count: s.count, avgScore: s.scoreN ? round_(s.scoreSum / s.scoreN, 2) : null };
    })
    .sort(function (a, b) { return b.count - a.count || a.topic.localeCompare(b.topic); });

  // 9. Category by sentiment
  const catMap = {};
  current.forEach(function (r) {
    const c = catMap[r.category] || (catMap[r.category] =
      { category: r.category, Positive: 0, Neutral: 0, Mixed: 0, Negative: 0, total: 0 });
    c.total++;
    if (c[r.sentiment] !== undefined) { c[r.sentiment]++; }
  });
  const known = CATEGORIES.filter(function (c) { return catMap[c]; });
  const unknown = Object.keys(catMap).filter(function (c) { return CATEGORIES.indexOf(c) === -1; });
  const categoryBySentiment = known.concat(unknown).map(function (c) { return catMap[c]; });

  // 10. Rating distribution (index 0 = 1 star ... index 4 = 5 stars)
  const ratingDistribution = [0, 0, 0, 0, 0];
  current.forEach(function (r) {
    const n = Math.round(r.rating);
    if (n >= 1 && n <= 5) { ratingDistribution[n - 1]++; }
  });

  // 11. Word frequency (each word counted once per feedback)
  const wordCounts = {};
  current.forEach(function (r) {
    const seen = {};
    r.feedback.toLowerCase().replace(/[^a-z\u00f1\s']/g, ' ').split(/\s+/).forEach(function (raw) {
      const w = raw.replace(/^'+|'+$/g, '');
      if (w.length >= MIN_WORD_LENGTH && !STOPWORDS[w] && !seen[w]) {
        seen[w] = true;
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    });
  });
  const topN = Number(getSetting_('WORD_FREQ_TOP_N')) || 30;
  const words = Object.keys(wordCounts)
    .map(function (w) { return { word: w, count: wordCounts[w] }; })
    .sort(function (a, b) { return b.count - a.count || a.word.localeCompare(b.word); })
    .slice(0, topN);

  // 12. Urgent items and recent feedback (newest first, no customer emails)
  const newestFirst = current.slice().sort(function (a, b) { return b.ts - a.ts; });
  const toItem = function (r, withText) {
    const item = {
      id: r.id, time: Utilities.formatDate(new Date(r.ts), tz, 'yyyy-MM-dd HH:mm'),
      category: r.category, rating: isFinite(r.rating) ? r.rating : null,
      sentiment: r.sentiment, score: isFinite(r.score) ? r.score : null,
      topics: r.topics, summary: r.summary, urgent: r.urgent
    };
    if (withText) { item.feedback = r.feedback.substring(0, MAX_FEEDBACK_CHARS_SENT); }
    return item;
  };
  const urgent = newestFirst.filter(function (r) { return r.urgent; }).slice(0, 10)
    .map(function (r) { return toItem(r, true); });
  const recent = newestFirst.slice(0, RECENT_LIMIT).map(function (r) { return toItem(r, true); });

  return {
    ok: true,
    businessName: String(getSetting_('BUSINESS_NAME') || 'SentiPulse'),
    generatedAt: Utilities.formatDate(new Date(nowMs), tz, 'yyyy-MM-dd HH:mm:ss'),
    filters: f,
    period: {
      label: p.label,
      range: fmtKey_(p.start) + ' to ' + fmtKey_(p.trendEnd),
      compareLabel: p.compareLabel,
      unit: unit,
      today: todayKey
    },
    empty: current.length === 0,
    skippedRows: skipped,
    kpis: kpis,
    compare: compare,
    distribution: distribution,
    trend: trend,
    topComplaints: topComplaints,
    topics: topics,
    categoryBySentiment: categoryBySentiment,
    ratingDistribution: ratingDistribution,
    words: words,
    urgent: urgent,
    recent: recent,
    options: { categories: CATEGORIES, sentiments: SENTIMENT_ORDER, months: months }
  };
}

/* =========================================================
 * Manual tests
 * ========================================================= */

/** Run by hand: builds the dashboard data with different filters and prints a summary. */
function testDashboardData() {
  const run = function (title, filters) {
    const t = new Date().getTime();
    const d = getDashboardData(filters, true);
    if (!d.ok) { Logger.log(title + ' -> ERROR: ' + d.error); return null; }
    Logger.log(title + ' (' + (new Date().getTime() - t) + ' ms): ' + d.period.label + ' | ' + d.period.range +
      ' | trend by ' + d.period.unit + ' (' + d.trend.length + ' points) | total ' + d.kpis.total +
      ' | compare ' + (d.compare ? d.compare.total + ' vs ' + d.period.compareLabel : 'none'));
    return d;
  };

  const all = run('1) All time', { range: 'all', category: 'All', sentiment: 'All' });
  if (all) { Logger.log('   Months offered: ' + all.options.months.map(function (m) { return m.value; }).join(', ')); }

  run('2) Last 30 days', { range: '30d', category: 'All', sentiment: 'All' });
  run('3) This month', { range: 'thisMonth', category: 'All', sentiment: 'All' });
  run('4) Last month', { range: 'lastMonth', category: 'All', sentiment: 'All' });

  if (all && all.options.months.length > 1) {
    run('5) Specific month', { range: 'month:' + all.options.months[1].value, category: 'All', sentiment: 'All' });
  }
  run('6) Custom range', { range: 'custom', from: '2026-09-01', to: '2026-09-30', category: 'All', sentiment: 'All' });
  run('7) Backwards custom range (should swap)', { range: 'custom', from: '2026-10-31', to: '2026-10-01', category: 'All', sentiment: 'All' });
  run('8) Filtered', { range: '90d', category: 'Delivery', sentiment: 'Negative' });

  const bad = getDashboardData({ range: 'abc', from: 'zzz', category: '<script>', sentiment: 'x' }, true);
  Logger.log('9) Strange filters became: ' + JSON.stringify(bad.filters));

  const t2 = new Date().getTime();
  const again = getDashboardData({ range: 'all', category: 'All', sentiment: 'All' }, false);
  Logger.log('10) Repeat call: ' + (new Date().getTime() - t2) + ' ms | fromCache=' + again.fromCache);
}