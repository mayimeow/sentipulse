/**
 * SentiPulse - Alerts.gs (styled emails)
 * Sends alert emails. Email problems are caught and reported, never thrown.
 */

const ALERT_SENDER_NAME = 'SentiPulse Alerts';
const ADMIN_ALERT_COOLDOWN_SECONDS = 3600;   // same admin alert at most once per hour

const EMAIL_COLORS = {
  brown: '#3e2723', accent: '#c8793a', cream: '#f6f1eb', soft: '#faf6f1',
  text: '#2b2b2b', muted: '#7a7068', border: '#e8dfd5',
  positive: '#2e7d32', neutral: '#78909c', mixed: '#f9a825', negative: '#c62828',
  urgent: '#b71c1c', warn: '#e65100', info: '#546e7a'
};

/* =========================================================
 * Rules and helpers
 * ========================================================= */

/** True when feedback is negative enough, or marked urgent. */
function shouldAlert_(score, urgent) {
  const threshold = Number(getSetting_('ALERT_THRESHOLD'));
  const limit = isFinite(threshold) ? threshold : -0.4;
  const isUrgent = (urgent === true || String(urgent).toUpperCase() === 'TRUE');
  const hasScore = (score !== '' && score !== null && isFinite(Number(score)));
  return isUrgent || (hasScore && Number(score) <= limit);
}

function escapeHtml_(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Link to the dashboard if it is deployed, otherwise to the spreadsheet. */
function getDashboardLink_() {
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) { /* not deployed yet */ }
  if (url) {
    return { url: url, label: 'Open the dashboard' };
  }
  return { url: SpreadsheetApp.getActiveSpreadsheet().getUrl(), label: 'Open the spreadsheet' };
}

/** Finds the customer's email in Responses (column E) from an ID like R-7. */
function getCustomerEmail_(responseId) {
  try {
    const rowNum = Number(String(responseId).replace('R-', ''));
    if (!isFinite(rowNum) || rowNum < 2) { return ''; }
    const sheet = getSheet_(SHEET_NAMES.RESPONSES);
    if (rowNum > sheet.getLastRow()) { return ''; }
    return String(sheet.getRange(rowNum, 5).getValue() || '').trim();
  } catch (e) {
    return '';
  }
}

function formatAlertTime_(value) {
  try {
    if (value instanceof Date) {
      return Utilities.formatDate(value, String(getSetting_('TIMEZONE') || 'Asia/Manila'), 'MMM d, yyyy h:mm a');
    }
  } catch (e) { /* fall through */ }
  return String(value || '');
}

/* =========================================================
 * Email style helpers (tables and inline styles = works in every email app)
 * ========================================================= */

function sentimentColor_(sentiment) {
  const c = EMAIL_COLORS;
  const map = { Positive: c.positive, Neutral: c.neutral, Mixed: c.mixed, Negative: c.negative };
  return map[sentiment] || c.neutral;
}

function chip_(text, bg, color) {
  return '<span style="display:inline-block;padding:3px 10px;margin:2px 6px 2px 0;border-radius:12px;background:' +
         bg + ';color:' + color + ';font-size:12px;font-weight:bold;">' + escapeHtml_(text) + '</span>';
}

function sentimentBadge_(sentiment) {
  const bg = { Positive: '#e8f5e9', Neutral: '#eceff1', Mixed: '#fff8e1', Negative: '#ffebee' };
  const fg = { Positive: '#2e7d32', Neutral: '#546e7a', Mixed: '#b26a00', Negative: '#c62828' };
  return chip_(sentiment || 'Unknown', bg[sentiment] || '#eceff1', fg[sentiment] || '#546e7a');
}

function starsHtml_(rating) {
  const r = Number(rating);
  if (!isFinite(r)) { return ''; }
  const n = Math.max(0, Math.min(5, Math.round(r)));
  return '<span style="font-size:16px;letter-spacing:2px;">' +
         '<span style="color:#f9a825;">' + '\u2605'.repeat(n) + '</span>' +
         '<span style="color:#d7ccc8;">' + '\u2605'.repeat(5 - n) + '</span></span>' +
         '<span style="font-size:12px;color:' + EMAIL_COLORS.muted + ';margin-left:6px;">' + n + ' / 5</span>';
}

/** A bar from very negative (left) to very positive (right). */
function scoreBar_(score, sentiment) {
  const s = Number(score);
  if (!isFinite(s)) { return ''; }
  const pct = Math.max(3, Math.min(100, Math.round(((s + 1) / 2) * 100)));
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 2px;"><tr>' +
    '<td width="' + pct + '%" bgcolor="' + sentimentColor_(sentiment) + '" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>' +
    '<td bgcolor="#ece4db" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:11px;color:' + EMAIL_COLORS.muted + ';">Very negative</td>' +
    '<td align="right" style="font-size:11px;color:' + EMAIL_COLORS.muted + ';">Very positive</td></tr></table>';
}

function detailRow_(label, valueHtml) {
  const c = EMAIL_COLORS;
  return '<tr><td style="padding:8px 0;width:125px;font-size:13px;color:' + c.muted +
         ';vertical-align:top;border-bottom:1px solid ' + c.border + ';">' + label + '</td>' +
         '<td style="padding:8px 0;font-size:13px;vertical-align:top;border-bottom:1px solid ' + c.border + ';">' +
         valueHtml + '</td></tr>';
}

/**
 * Wraps content in the branded email frame.
 * o = { preheader, banner, bannerColor, bodyHtml, ctaLabel, ctaUrl, footer }
 */
function emailShell_(o) {
  const c = EMAIL_COLORS;
  const business = escapeHtml_(String(getSetting_('BUSINESS_NAME') || 'SentiPulse'));

  const banner = o.banner ?
    '<tr><td bgcolor="' + o.bannerColor + '" style="padding:12px 24px;color:#ffffff;font-size:15px;font-weight:bold;">' +
    escapeHtml_(o.banner) + '</td></tr>' : '';

  const button = o.ctaUrl ?
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 4px;"><tr>' +
    '<td align="center" bgcolor="' + c.brown + '" style="border-radius:6px;">' +
    '<a href="' + escapeHtml_(o.ctaUrl) + '" style="display:inline-block;padding:12px 30px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">' +
    escapeHtml_(o.ctaLabel) + '</a></td></tr></table>' : '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:' + c.cream + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + c.cream + ';">' + escapeHtml_(o.preheader || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + c.cream + '"><tr>' +
    '<td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
      'style="width:100%;max-width:600px;background:#ffffff;border:1px solid ' + c.border +
      ';font-family:Arial,Helvetica,sans-serif;color:' + c.text + ';">' +
    '<tr><td bgcolor="' + c.brown + '" style="padding:18px 24px;">' +
      '<div style="font-size:11px;letter-spacing:3px;color:#d7b99a;font-weight:bold;">SENTIPULSE</div>' +
      '<div style="font-size:21px;color:#ffffff;font-weight:bold;margin-top:3px;">' + business + '</div></td></tr>' +
    banner +
    '<tr><td style="padding:22px 24px;">' + o.bodyHtml + button + '</td></tr>' +
    '<tr><td bgcolor="' + c.soft + '" style="padding:14px 24px;font-size:12px;color:' + c.muted + ';border-top:1px solid ' + c.border + ';">' +
      escapeHtml_(o.footer || 'Sent automatically by SentiPulse') + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

/* =========================================================
 * Customer alert
 * ========================================================= */

/**
 * item = { id, timestamp, category, rating, feedback, sentiment, score,
 *          topics, summary, urgent, customerEmail }
 * Returns { subject, text, html }.
 */
function buildAlertEmail_(item) {
  const c = EMAIL_COLORS;
  const business = String(getSetting_('BUSINESS_NAME') || 'SentiPulse');
  const urgent = (item.urgent === true || String(item.urgent).toUpperCase() === 'TRUE');
  const link = getDashboardLink_();
  const when = formatAlertTime_(item.timestamp);
  const customer = item.customerEmail ? item.customerEmail : 'Not provided';

  const subject = (urgent ? '[URGENT] ' : '') + '[' + business + '] Negative feedback: ' +
                  item.category + ' (' + item.score + ')';

  const text = [
    urgent ? 'URGENT - this feedback needs attention today.' : 'New negative feedback received.',
    '',
    'Response ID: ' + item.id,
    'Received: ' + when,
    'Category: ' + item.category,
    'Rating: ' + item.rating + ' / 5',
    'Sentiment: ' + item.sentiment + ' (score ' + item.score + ')',
    'Topics: ' + item.topics,
    'AI summary: ' + item.summary,
    'Customer email: ' + customer,
    '',
    'Feedback:',
    item.feedback,
    '',
    link.label + ': ' + link.url
  ].join('\n');

  const topicsHtml = String(item.topics || '').split(',').map(function (t) {
    return t.trim() ? chip_(t.trim(), '#f1e9e0', '#5d4037') : '';
  }).join('');

  const bodyHtml =
    '<div style="margin-bottom:14px;">' + chip_(item.category, '#f1e9e0', '#5d4037') + starsHtml_(item.rating) + '</div>' +
    '<div>' + sentimentBadge_(item.sentiment) +
      '<span style="font-size:13px;color:' + c.muted + ';margin-left:6px;">Score ' + escapeHtml_(item.score) + '</span></div>' +
    scoreBar_(item.score, item.sentiment) +
    '<div style="font-size:17px;font-weight:bold;line-height:1.4;margin:18px 0 4px;">' + escapeHtml_(item.summary) + '</div>' +
    '<div style="margin:14px 0 18px;padding:14px 16px;background:' + c.soft + ';border-left:4px solid ' + c.accent +
      ';font-size:14px;line-height:1.55;white-space:pre-wrap;">\u201C' + escapeHtml_(item.feedback) + '\u201D</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      detailRow_('Topics', topicsHtml || '-') +
      detailRow_('Response ID', escapeHtml_(item.id)) +
      detailRow_('Received', escapeHtml_(when)) +
      detailRow_('Customer email', escapeHtml_(customer)) +
    '</table>';

  const html = emailShell_({
    preheader: (urgent ? 'URGENT: ' : '') + String(item.summary || '').substring(0, 120),
    banner: urgent ? 'URGENT: needs attention today' : 'Negative feedback received',
    bannerColor: urgent ? c.urgent : c.warn,
    bodyHtml: bodyHtml,
    ctaLabel: link.label,
    ctaUrl: link.url,
    footer: 'Sent automatically by SentiPulse because this feedback scored at or below your alert threshold' +
            (urgent ? ' or was marked urgent.' : '.')
  });

  return { subject: subject, text: text, html: html };
}

/** Sends one customer alert. Returns { ok: true } or { ok: false, error }. */
function sendNegativeAlert_(item) {
  try {
    const to = String(getSetting_('ALERT_EMAIL') || '').trim();
    if (to.indexOf('@') === -1) {
      return { ok: false, error: 'ALERT_EMAIL is missing or invalid in Config' };
    }
    if (MailApp.getRemainingDailyQuota() < 1) {
      return { ok: false, error: 'Daily email quota is used up' };
    }
    const mail = buildAlertEmail_(item);
    MailApp.sendEmail({
      to: to,
      subject: mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: ALERT_SENDER_NAME
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* =========================================================
 * Admin alert (system problems)
 * ========================================================= */

/**
 * Emails you about a system problem. The same subject is sent at most once
 * per hour, so a repeating error cannot flood your inbox.
 * Returns true if an email was sent.
 */
function sendAdminAlert_(subject, message) {
  try {
    const to = String(getSetting_('ALERT_EMAIL') || '').trim();
    if (to.indexOf('@') === -1) { return false; }

    const cache = CacheService.getScriptCache();
    const key = 'admin_alert_' + String(subject).substring(0, 100);
    if (cache.get(key)) { return false; }
    if (MailApp.getRemainingDailyQuota() < 1) { return false; }

    cache.put(key, '1', ADMIN_ALERT_COOLDOWN_SECONDS);

    const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
    const bodyHtml =
      '<div style="font-size:17px;font-weight:bold;margin-bottom:10px;">' + escapeHtml_(subject) + '</div>' +
      '<div style="padding:14px 16px;background:' + EMAIL_COLORS.soft + ';border-left:4px solid ' + EMAIL_COLORS.info +
        ';font-size:14px;line-height:1.55;white-space:pre-wrap;">' + escapeHtml_(message) + '</div>' +
      '<div style="font-size:13px;color:' + EMAIL_COLORS.muted + ';margin-top:14px;">Check the Logs tab for the full details.</div>';

    MailApp.sendEmail({
      to: to,
      subject: '[SentiPulse ADMIN] ' + subject,
      body: String(message) + '\n\nCheck the Logs tab for details: ' + sheetUrl,
      htmlBody: emailShell_({
        preheader: String(message).substring(0, 120),
        banner: 'System notice',
        bannerColor: EMAIL_COLORS.info,
        bodyHtml: bodyHtml,
        ctaLabel: 'Open the spreadsheet',
        ctaUrl: sheetUrl,
        footer: 'Admin alert from SentiPulse. The same alert is sent at most once per hour.'
      }),
      name: ALERT_SENDER_NAME
    });
    return true;
  } catch (e) {
    Logger.log('Admin alert failed: ' + e);   // do not use logEvent_ here to avoid loops
    return false;
  }
}

/* =========================================================
 * Daily digest
 * ========================================================= */

/** Runs every morning (trigger). Covers the last 24 hours. */
function sendDailyDigest() {
  buildAndSendDigest_(24);
}

/** Run by hand: builds a digest from ALL feedback so you can see how it looks. */
function testDigest() {
  buildAndSendDigest_(24 * 365);
}

function buildAndSendDigest_(hours) {
  const fn = 'buildAndSendDigest_';
  try {
    if (String(getSetting_('DIGEST_ENABLED')).toUpperCase() === 'FALSE') {
      logEvent_('INFO', fn, 'Digest is turned off in Config (DIGEST_ENABLED)');
      return;
    }

    const to = String(getSetting_('ALERT_EMAIL') || '').trim();
    if (to.indexOf('@') === -1) {
      logEvent_('ERROR', fn, 'Digest not sent: ALERT_EMAIL is missing or invalid');
      return;
    }

    const analysis = getSheet_(SHEET_NAMES.ANALYSIS);
    const lastRow = analysis.getLastRow();
    if (lastRow < 2) {
      logEvent_('INFO', fn, 'Digest not sent: Analysis tab has no data');
      return;
    }

    const rows = analysis.getRange(2, 1, lastRow - 1, 15).getValues();
    const cutoff = new Date().getTime() - hours * 3600 * 1000;
    const done = [];
    let waiting = 0;
    let failed = 0;

    rows.forEach(function (row) {
      const status = String(row[COL.STATUS]).trim();
      if (status === 'Failed') { failed++; }
      if (status === 'Pending' || status === '') { waiting++; }
      const ts = row[COL.TIMESTAMP];
      if (status === 'Done' && ts instanceof Date && ts.getTime() >= cutoff) {
        done.push(row);
      }
    });

    if (done.length === 0) {
      logEvent_('INFO', fn, 'Digest not sent: no new feedback in the last ' + hours + ' hours');
      return;
    }

    // Numbers
    let ratingSum = 0, ratingCount = 0, scoreSum = 0, scoreCount = 0;
    const counts = { Positive: 0, Neutral: 0, Mixed: 0, Negative: 0 };
    const complaintTopics = {};
    const urgentRows = [];

    done.forEach(function (row) {
      const rating = Number(row[COL.RATING]);
      if (isFinite(rating) && rating > 0) { ratingSum += rating; ratingCount++; }
      const score = Number(row[COL.SCORE]);
      if (row[COL.SCORE] !== '' && isFinite(score)) { scoreSum += score; scoreCount++; }

      const sentiment = String(row[COL.SENTIMENT]);
      if (counts[sentiment] !== undefined) { counts[sentiment]++; }

      if (sentiment === 'Negative' || sentiment === 'Mixed') {
        String(row[COL.TOPICS]).split(',').forEach(function (t) {
          const topic = t.trim();
          if (topic) { complaintTopics[topic] = (complaintTopics[topic] || 0) + 1; }
        });
      }
      if (row[COL.URGENT] === true || String(row[COL.URGENT]).toUpperCase() === 'TRUE') {
        urgentRows.push(row);
      }
    });

    const c = EMAIL_COLORS;
    const business = String(getSetting_('BUSINESS_NAME') || 'SentiPulse');
    const avgRating = ratingCount ? (ratingSum / ratingCount).toFixed(1) : 'n/a';
    const avgScore = scoreCount ? (scoreSum / scoreCount).toFixed(2) : 'n/a';
    const negativePct = Math.round(100 * counts.Negative / done.length);
    const topComplaints = Object.keys(complaintTopics)
      .sort(function (a, b) { return complaintTopics[b] - complaintTopics[a]; })
      .slice(0, 5);
    const maxCount = topComplaints.length ? complaintTopics[topComplaints[0]] : 1;
    const link = getDashboardLink_();
    const period = hours >= 48 ? 'all feedback so far' : 'the last 24 hours';

    // Plain-text version
    const lines = [
      business + ' - feedback digest (' + period + ')',
      '',
      'Responses: ' + done.length,
      'Average rating: ' + avgRating + ' / 5',
      'Average sentiment score: ' + avgScore,
      'Positive ' + counts.Positive + ' | Neutral ' + counts.Neutral +
        ' | Mixed ' + counts.Mixed + ' | Negative ' + counts.Negative + ' (' + negativePct + '% negative)',
      '',
      'Top complaint topics: ' + (topComplaints.length ?
        topComplaints.map(function (t) { return t + ' (' + complaintTopics[t] + ')'; }).join(', ') : 'none'),
      '',
      'Urgent items: ' + urgentRows.length
    ];
    urgentRows.forEach(function (r) {
      lines.push('  - ' + r[COL.ID] + ' [' + r[COL.CATEGORY] + ']: ' + r[COL.SUMMARY]);
    });
    lines.push('', 'Still waiting: ' + waiting + ' | Failed: ' + failed, '', link.label + ': ' + link.url);

    // HTML pieces
    const kpi = function (value, label, color) {
      return '<td width="25%" align="center" bgcolor="' + c.soft + '" style="padding:14px 4px;border:1px solid ' + c.border + ';">' +
             '<div style="font-size:24px;font-weight:bold;color:' + color + ';">' + escapeHtml_(value) + '</div>' +
             '<div style="font-size:11px;color:' + c.muted + ';margin-top:2px;">' + escapeHtml_(label) + '</div></td>';
    };
    const kpis = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;"><tr>' +
      kpi(done.length, 'RESPONSES', c.brown) + kpi(avgRating, 'AVG RATING', c.accent) +
      kpi(avgScore, 'AVG SENTIMENT', c.brown) + kpi(negativePct + '%', 'NEGATIVE', c.negative) + '</tr></table>';

    const order = ['Positive', 'Neutral', 'Mixed', 'Negative'];
    const segments = order.filter(function (k) { return counts[k] > 0; }).map(function (k) {
      return '<td width="' + Math.max(1, Math.round(100 * counts[k] / done.length)) + '%" bgcolor="' + sentimentColor_(k) +
             '" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td>';
    }).join('');
    const legend = order.map(function (k) {
      return '<span style="font-size:12px;color:' + c.text + ';margin-right:14px;white-space:nowrap;">' +
             '<span style="color:' + sentimentColor_(k) + ';">\u25CF</span> ' + k + ' ' + counts[k] + '</span>';
    }).join('');
    const sentimentSection =
      '<div style="font-size:14px;font-weight:bold;margin:22px 0 8px;">Sentiment split</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + segments + '</tr></table>' +
      '<div style="margin-top:8px;">' + legend + '</div>';

    let complaintsSection;
    if (topComplaints.length) {
      complaintsSection = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
        topComplaints.map(function (t) {
          const pct = Math.max(4, Math.round(100 * complaintTopics[t] / maxCount));
          return '<tr><td style="width:40%;padding:5px 8px 5px 0;font-size:13px;">' + escapeHtml_(t) + '</td>' +
            '<td style="padding:5px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td width="' + pct + '%" bgcolor="' + c.negative + '" style="height:10px;line-height:10px;font-size:0;">&nbsp;</td>' +
            '<td style="font-size:0;">&nbsp;</td></tr></table></td>' +
            '<td align="right" style="width:30px;padding:5px 0;font-size:13px;font-weight:bold;">' + complaintTopics[t] + '</td></tr>';
        }).join('') + '</table>';
    } else {
      complaintsSection = '<div style="font-size:13px;color:' + c.muted + ';">No complaints in this period.</div>';
    }

    let urgentSection;
    if (urgentRows.length) {
      urgentSection = urgentRows.map(function (r) {
        return '<div style="margin:8px 0;padding:10px 12px;border-left:4px solid ' + c.urgent + ';background:#fff5f5;font-size:13px;line-height:1.5;">' +
               '<b>' + escapeHtml_(r[COL.ID]) + '</b> ' + chip_(r[COL.CATEGORY], '#f1e9e0', '#5d4037') + '<br>' +
               escapeHtml_(r[COL.SUMMARY]) + '</div>';
      }).join('');
    } else {
      urgentSection = '<div style="font-size:13px;color:' + c.positive + ';">No urgent items. Nice.</div>';
    }

    const heading = function (text) {
      return '<div style="font-size:14px;font-weight:bold;margin:22px 0 8px;">' + text + '</div>';
    };

    const bodyHtml = kpis + sentimentSection +
      heading('Top complaint topics') + complaintsSection +
      heading('Urgent items (' + urgentRows.length + ')') + urgentSection +
      '<div style="font-size:12px;color:' + c.muted + ';margin-top:18px;">Still waiting: ' + waiting + ' &nbsp;|&nbsp; Failed: ' + failed + '</div>';

    if (MailApp.getRemainingDailyQuota() < 1) {
      logEvent_('ERROR', fn, 'Digest not sent: daily email quota is used up');
      return;
    }

    MailApp.sendEmail({
      to: to,
      subject: '[' + business + '] Daily feedback digest: ' + done.length + ' response(s)',
      body: lines.join('\n'),
      htmlBody: emailShell_({
        preheader: done.length + ' response(s), average rating ' + avgRating + ', ' + urgentRows.length + ' urgent',
        banner: 'Feedback digest for ' + period,
        bannerColor: c.accent,
        bodyHtml: bodyHtml,
        ctaLabel: link.label,
        ctaUrl: link.url,
        footer: 'Daily summary sent automatically by SentiPulse. Turn it off with DIGEST_ENABLED in the Config tab.'
      }),
      name: ALERT_SENDER_NAME
    });
    logEvent_('INFO', fn, 'Digest sent', done.length + ' response(s), ' + urgentRows.length + ' urgent');
  } catch (e) {
    logEvent_('ERROR', fn, 'Digest failed', e);
  }
}

/* =========================================================
 * Manual tests
 * ========================================================= */

/** Run by hand: sends 2 sample alert emails (one normal, one urgent). */
function testAlertEmail() {
  const base = {
    id: 'R-TEST', timestamp: new Date(), category: 'Delivery', rating: 1,
    feedback: 'This is a SAMPLE feedback for testing. My order arrived late and the box was damaged. Nobody replied to my emails.',
    sentiment: 'Negative', score: -0.85, topics: 'Delivery Speed, Packaging, Refund and Support',
    summary: 'Sample: late order, a damaged box, and no reply from support.', urgent: false,
    customerEmail: 'sample.customer@example.com'
  };
  const urgent = Object.assign({}, base, { id: 'R-TEST-URGENT', urgent: true, category: 'Product Quality', rating: 1,
    topics: 'Freshness, Taste and Quality',
    summary: 'Sample: customer found a hair in a pastry and feels sick.',
    feedback: 'This is a SAMPLE urgent feedback. I think there was a hair in my pastry and I feel sick.' });

  logEvent_('INFO', 'testAlertEmail', 'Normal alert result', JSON.stringify(sendNegativeAlert_(base)));
  logEvent_('INFO', 'testAlertEmail', 'Urgent alert result', JSON.stringify(sendNegativeAlert_(urgent)));
  logEvent_('INFO', 'testAlertEmail', 'Emails left today', MailApp.getRemainingDailyQuota());
}

/** Run by hand: sends one admin email (the subject includes the time, so it always sends). */
function testAdminAlert() {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Manila', 'HH:mm:ss');
  const sent = sendAdminAlert_('Test admin alert ' + stamp, 'This is only a test of the admin alert.\nSecond line to check the formatting.');
  logEvent_('INFO', 'testAdminAlert', sent ? 'Admin alert sent' : 'Admin alert NOT sent (email problem)');
}

/** Run by hand: sends 2 realistic-looking alerts (preview only, nothing is saved). */
function testRealisticAlerts() {
  const normal = {
    id: 'R-14', timestamp: new Date(), category: 'Delivery', rating: 1,
    feedback: 'My order arrived two weeks late and the box was damaged. I emailed support three times and nobody replied. Very disappointed.',
    sentiment: 'Negative', score: -0.88, topics: 'Delivery Speed, Packaging, Refund and Support',
    summary: 'Order arrived two weeks late and damaged, and support never replied.', urgent: false,
    customerEmail: 'maria.santos@example.com'
  };
  const urgent = {
    id: 'R-15', timestamp: new Date(), category: 'Product Quality', rating: 1,
    feedback: 'I found a hair in my croissant and got a stomach ache after eating it. I want to talk to a manager.',
    sentiment: 'Negative', score: -0.92, topics: 'Freshness, Cleanliness and Ambiance',
    summary: 'Customer found a hair in a croissant, felt sick, and wants to speak to a manager.', urgent: true,
    customerEmail: ''
  };
  logEvent_('INFO', 'testRealisticAlerts', 'Normal preview', JSON.stringify(sendNegativeAlert_(normal)));
  logEvent_('INFO', 'testRealisticAlerts', 'Urgent preview', JSON.stringify(sendNegativeAlert_(urgent)));
}