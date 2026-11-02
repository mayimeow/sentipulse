/**
 * SentiPulse - Fallback.gs
 * Backup AI. Used only when Gemini is busy, rate limited, or unreachable.
 */

const FALLBACK_URLS = { groq: 'https://api.groq.com/openai/v1/chat/completions' };
const FALLBACK_KEY_NAMES = { groq: 'GROQ_API_KEY' };
const FALLBACK_ATTEMPTS = 2;
const FALLBACK_BACKOFF_MS = 3000;
const PRIMARY_COOLDOWN_KEY = 'primary_ai_cooldown';
const PRIMARY_COOLDOWN_SECONDS = 300;

/* ---------- Small helpers ---------- */

/** Logs a message at most once per `seconds`, so a repeating problem cannot flood the Logs tab. */
function logOnce_(key, seconds, level, fn, message, details) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) { return; }
    cache.put(key, '1', seconds);
  } catch (e) { /* if the cache fails, log anyway */ }
  logEvent_(level, fn, message, details);
}

function isPrimaryCoolingDown_() {
  try {
    return !!CacheService.getScriptCache().get(PRIMARY_COOLDOWN_KEY);
  } catch (e) {
    return false;
  }
}

function startPrimaryCooldown_(reason) {
  try {
    CacheService.getScriptCache().put(PRIMARY_COOLDOWN_KEY, '1', PRIMARY_COOLDOWN_SECONDS);
  } catch (e) { /* ignore */ }
  logEvent_('WARN', 'startPrimaryCooldown_',
    'Gemini is busy or limited. Using the fallback AI for the next ' + (PRIMARY_COOLDOWN_SECONDS / 60) + ' minutes', reason);
}

/** Returns the fallback settings, or null when the fallback is off or incomplete. */
function getFallbackConfig_() {
  const fn = 'getFallbackConfig_';
  const provider = String(getSetting_('FALLBACK_PROVIDER') || 'none').trim().toLowerCase();
  if (!provider || provider === 'none') { return null; }

  if (!FALLBACK_URLS[provider]) {
    logOnce_('fb_bad_provider', 3600, 'WARN', fn, 'FALLBACK_PROVIDER has an unknown value, so no fallback is used', provider);
    return null;
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty(FALLBACK_KEY_NAMES[provider]);
  const model = String(getSetting_('FALLBACK_MODEL') || '').trim();
  if (!apiKey || !model) {
    logOnce_('fb_incomplete', 3600, 'WARN', fn,
      'Fallback AI is on, but ' + FALLBACK_KEY_NAMES[provider] + ' or FALLBACK_MODEL is missing, so no fallback is used');
    return null;
  }
  return { provider: provider, apiKey: apiKey, model: model, url: FALLBACK_URLS[provider] };
}

/* ---------- The fallback AI call ---------- */

/** One request to an OpenAI-style API (Groq, Cerebras, and others work the same way). */
function callOpenAICompatible_(url, apiKey, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: response.getResponseCode(), body: response.getContentText() };
}

/** Same result shape as analyzeWithGemini_. */
function analyzeWithFallback_(feedback, category, rating, fb) {
  const fn = 'analyzeWithFallback_';

  if (!String(feedback || '').trim()) {
    return { ok: false, fatal: false, retryable: false, error: 'Feedback text is empty' };
  }

  const payload = {
    model: fb.model,
    messages: [
      { role: 'system', content: 'You are a precise JSON-only API. Reply with exactly one JSON object and nothing else.' },
      { role: 'user', content: buildPrompt_(feedback, category, rating) }
    ],
    temperature: 0.1
  };

  let lastError = 'Unknown error';
  let throttled = false;

  for (let attempt = 1; attempt <= FALLBACK_ATTEMPTS; attempt++) {
    let result = null;
    try {
      result = callOpenAICompatible_(fb.url, fb.apiKey, payload);
    } catch (e) {
      lastError = 'Network error: ' + e.message;
    }

    if (result) {
      if (result.code === 200) {
        let data = null;
        try { data = JSON.parse(result.body); } catch (e) { lastError = 'Fallback reply was not readable JSON'; }

        if (data) {
          const choice = data.choices && data.choices[0];
          const text = String((choice && choice.message && choice.message.content) || '').trim();
          const parsed = parseAIResponse_(text);
          if (parsed.ok) {
            if (parsed.warnings.length > 0) {
              logEvent_('WARN', fn, 'Fallback AI reply was corrected', parsed.warnings.join(' | '));
            }
            return { ok: true, data: parsed.data, warnings: parsed.warnings, attempts: attempt,
                     provider: fb.provider, model: fb.model };
          }
          lastError = parsed.error;
        }
      } else if ([400, 401, 403, 404].indexOf(result.code) !== -1) {
        return { ok: false, fatal: true, retryable: false,
                 error: fb.provider + ' HTTP ' + result.code + ': ' + extractApiError_(result.body) };
      } else {
        lastError = fb.provider + ' HTTP ' + result.code + ': ' + extractApiError_(result.body);
        throttled = (result.code === 429 || result.code === 503);
      }
    }

    if (attempt < FALLBACK_ATTEMPTS) {
      logEvent_('WARN', fn, 'Fallback attempt ' + attempt + ' of ' + FALLBACK_ATTEMPTS + ' failed, retrying', lastError);
      Utilities.sleep(FALLBACK_BACKOFF_MS);
    }
  }

  return { ok: false, fatal: false, retryable: true, throttled: throttled,
           error: 'Fallback failed after ' + FALLBACK_ATTEMPTS + ' attempts. Last error: ' + lastError };
}

/* ---------- The new analyzeFeedback_ (Gemini first, then the fallback) ---------- */

/**
 * Same result shape as before, plus result.provider ('gemini' or the fallback name).
 * options (tests only): { apiKey, model, simulatePrimaryDown: true }
 */
function analyzeFeedback_(feedback, category, rating, options) {
  const fn = 'analyzeFeedback_';
  options = options || {};
  const fb = getFallbackConfig_();

  let primary = null;

  if (fb && isPrimaryCoolingDown_() && !options.simulatePrimaryDown) {
    primary = null;                                   // Gemini is resting: go straight to the fallback
  } else {
    if (options.simulatePrimaryDown) {
      primary = { ok: false, fatal: false, retryable: true, throttled: true, error: 'Simulated Gemini outage (test)' };
    } else {
      primary = analyzeWithGemini_(feedback, category, rating, options);
    }

    if (primary.ok) {
      primary.provider = 'gemini';
      return primary;
    }
    // Setup problems and feedback-specific problems: a backup AI cannot fix them
    if (primary.fatal || !primary.retryable || !fb) {
      return primary;
    }
    if (primary.throttled && !options.simulatePrimaryDown) {
      startPrimaryCooldown_(primary.error);
    }
  }

  const second = analyzeWithFallback_(feedback, category, rating, fb);
  if (second.ok) {
    return second;
  }

  if (second.fatal) {
    logEvent_('CRITICAL', fn, 'Fallback AI setup problem', second.error);
    sendAdminAlert_('Fallback AI problem', second.error);
  }

  const reason = (primary ? 'Gemini: ' + primary.error + ' | ' : 'Gemini: resting | ') + 'Fallback: ' + second.error;
  return { ok: false, fatal: false, retryable: true,
           throttled: (primary === null) || !!primary.throttled || !!second.throttled || !!second.fatal,
           error: reason.substring(0, 500) };
}

/* ---------- Tests ---------- */

/** Run by hand: tests the backup AI on its own (needs GROQ_API_KEY and the Config rows). */
function testFallback() {
  const fb = getFallbackConfig_();
  if (!fb) {
    Logger.log('Fallback is off or incomplete. Check FALLBACK_PROVIDER and FALLBACK_MODEL in Config, and the GROQ_API_KEY property.');
    return;
  }
  const samples = [
    ['Delivery', 1, 'My order arrived 2 weeks late and the box was damaged. Nobody replied to my emails.'],
    ['Overall Experience', 3, 'Ang sarap ng kape pero sobrang tagal ng order, 30 minutes! Sayang.']
  ];
  samples.forEach(function (s, i) {
    const start = new Date().getTime();
    const result = analyzeWithFallback_(s[2], s[0], s[1], fb);
    Logger.log('FALLBACK TEST ' + (i + 1) + ' (' + (new Date().getTime() - start) + ' ms): ' + JSON.stringify(result));
    Utilities.sleep(2000);
  });
}

/** Run by hand: pretends Gemini is down and checks that the fallback takes over. */
function testFailover() {
  const result = analyzeFeedback_(
    'The app keeps crashing when I try to check out. Very frustrating.', 'Website/App', 2,
    { simulatePrimaryDown: true });
  Logger.log('FAILOVER TEST -> provider: ' + result.provider + ' | ' + JSON.stringify(result));
}