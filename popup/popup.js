import { analyzeText } from '../lib/analyzer.js';
import { BulkTranslator, prewarmCache } from '../lib/bulk-translator.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError, StorageError } from '../lib/errors/index.js';
import { renderTranslation, renderTokens } from '../lib/renderer.js';
import { detectScript } from '../lib/lang-detect.js';
import { addEntry, getHistory, getEntry, getCached, PAGE_SIZE } from '../lib/history.js';

const RATE_LIMIT_MS = 1000;
let lastSubmitTime     = 0;
let cachedApiKey       = null;
let cachedDeeplKey     = null;
let controller         = null;
let historyPage        = 0;
let currentTranslator  = null;

const $ = id => document.getElementById(id);

const mainView        = $('main-view');
const settingsView    = $('settings-view');
const loadingOverlay  = $('loading-overlay');
const inputText       = $('input-text');
const charCount       = $('char-count');
const analyzeBtn      = $('analyze-btn');
const errorBanner     = $('error-banner');
const errorMessage    = $('error-message');
const retryBtn        = $('retry-btn');
const settingsLinkBtn = $('settings-link-btn');
const resultsEl       = $('results');
const settingsBtn     = $('settings-btn');
const apiKeyInput     = $('api-key-input');
const deeplKeyInput   = $('deepl-key-input');
const saveBtn         = $('save-btn');
const cancelBtn       = $('cancel-btn');
const settingsError   = $('settings-error');
const analysisPanel   = $('analysis-panel');
const historyPanel    = $('history-panel');
const tabAnalysisBtn  = $('tab-analysis');
const tabHistoryBtn   = $('tab-history');
const tabTranslateBtn = $('tab-translate');
const bulkSection     = $('bulk-section');
const bulkInput       = $('bulk-input');
const bulkSubmit      = $('bulk-submit');
const bulkCancel      = $('bulk-cancel');
const bulkProgress    = $('bulk-progress');
const bulkStatus      = $('bulk-status');
const bulkCacheStats  = $('bulk-cache-stats');
const bulkResults     = $('bulk-results');
const historyList     = $('history-list');
const loadMoreBtn     = $('load-more');

async function getKeys() {
  if (cachedApiKey) return { apiKey: cachedApiKey, deeplKey: cachedDeeplKey };
  const { apiKey, deeplKey } = await chrome.storage.local.get(['apiKey', 'deeplKey']);
  cachedApiKey   = apiKey   ?? null;
  cachedDeeplKey = deeplKey ?? null;
  return { apiKey: cachedApiKey, deeplKey: cachedDeeplKey };
}

function showMain() {
  mainView.hidden = false;
  settingsView.hidden = true;
}

function showSettings() {
  mainView.hidden = true;
  settingsView.hidden = false;
  settingsError.hidden = true;
  settingsError.textContent = '';
}

function showAnalysisPanel() {
  analysisPanel.hidden = false;
  historyPanel.hidden = true;
  bulkSection.hidden = true;
  tabAnalysisBtn.classList.add('tab-active');
  tabAnalysisBtn.setAttribute('aria-selected', 'true');
  tabHistoryBtn.classList.remove('tab-active');
  tabHistoryBtn.setAttribute('aria-selected', 'false');
  tabTranslateBtn.classList.remove('tab-active');
  tabTranslateBtn.setAttribute('aria-selected', 'false');
}

function showHistoryPanel() {
  analysisPanel.hidden = true;
  historyPanel.hidden = false;
  bulkSection.hidden = true;
  tabAnalysisBtn.classList.remove('tab-active');
  tabAnalysisBtn.setAttribute('aria-selected', 'false');
  tabHistoryBtn.classList.add('tab-active');
  tabHistoryBtn.setAttribute('aria-selected', 'true');
  tabTranslateBtn.classList.remove('tab-active');
  tabTranslateBtn.setAttribute('aria-selected', 'false');
  historyPage = 0;
  loadHistoryPage(0);
}

function showBulkPanel() {
  analysisPanel.hidden = true;
  historyPanel.hidden = true;
  bulkSection.hidden = false;
  tabAnalysisBtn.classList.remove('tab-active');
  tabAnalysisBtn.setAttribute('aria-selected', 'false');
  tabHistoryBtn.classList.remove('tab-active');
  tabHistoryBtn.setAttribute('aria-selected', 'false');
  tabTranslateBtn.classList.add('tab-active');
  tabTranslateBtn.setAttribute('aria-selected', 'true');
}

function showLoading() {
  loadingOverlay.hidden = false;
  analyzeBtn.disabled = true;
  inputText.disabled = true;
}

function hideLoading() {
  loadingOverlay.hidden = true;
  analyzeBtn.disabled = false;
  inputText.disabled = false;
}

function showError(message, opts = {}) {
  errorMessage.textContent = message;
  retryBtn.hidden = !opts.retry;
  settingsLinkBtn.hidden = !opts.settingsLink;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
}

function handleError(err) {
  if (err instanceof TimeoutError) {
    showError(err.message, { retry: true });
  } else if (err instanceof ApiError && err.status === 401) {
    showError(err.message, { settingsLink: true });
  } else if (err instanceof ApiError && err.status === 429) {
    showError(err.message);
  } else if (err instanceof ApiError) {
    showError(err.message, { retry: true });
  } else if (err instanceof NetworkError) {
    showError(err.message, { retry: true });
  } else if (err instanceof JsonError) {
    showError(err.message, { retry: true });
  } else if (err instanceof ValidationError && err.field === 'text') {
    showError(err.message);
  } else if (err instanceof ValidationError) {
    showError(err.message, { retry: true });
  } else {
    showError('An unexpected error occurred. Please retry.', { retry: true });
  }
}

async function loadHistoryPage(page) {
  const entries = await getHistory(page);
  if (page === 0) historyList.replaceChildren();

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.setAttribute('data-id', entry.id);
    li.setAttribute('tabindex', '0');
    li.setAttribute('role', 'button');

    const snippet = document.createElement('span');
    snippet.className = 'history-snippet';
    snippet.textContent = entry.snippet;
    li.appendChild(snippet);

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = entry.lang + ' · ' + new Date(entry.ts).toLocaleDateString();
    li.appendChild(meta);

    li.addEventListener('click', () => handleHistoryEntryClick(entry.id));
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHistoryEntryClick(entry.id); }
    });

    historyList.appendChild(li);
  }

  loadMoreBtn.hidden = entries.length < PAGE_SIZE;
  historyPage = page;
}

async function handleHistoryEntryClick(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  hideError();
  renderTranslation(entry.translation);
  renderTokens(entry.tokens);
  showAnalysisPanel();
}

async function runAnalysis() {
  const now = Date.now();
  if (now - lastSubmitTime < RATE_LIMIT_MS) {
    showError('Please wait a moment before submitting again.');
    return;
  }
  lastSubmitTime = now;

  controller = new AbortController();
  hideError();
  resultsEl.hidden = true;
  showLoading();

  const text = inputText.value.trim();
  const start = performance.now();

  try {
    const cached = await getCached(text);
    if (cached) {
      const elapsed = Math.round(performance.now() - start);
      console.log('[Lingua] cache hit: ' + elapsed + 'ms');
      hideLoading();
      renderTranslation(cached.translation);
      renderTokens(cached.tokens);
      return;
    }

    const { apiKey, deeplKey } = await getKeys();
    const lang = detectScript(text);
    let translationLogged = false;

    const onTranslation = (translatedText) => {
      renderTranslation(translatedText);
      hideLoading();
      if (!translationLogged) {
        translationLogged = true;
        const elapsed = Math.round(performance.now() - start);
        console.log('[Lingua] translation emitted: ' + elapsed + 'ms');
      }
    };

    const result = await analyzeText(text, apiKey, deeplKey, {
      onTranslation,
      signal: controller.signal,
    });

    if (result === null) return;

    renderTokens(result.tokens);

    try {
      await addEntry(result, text, lang);
    } catch (err) {
      if (err instanceof StorageError) {
        console.error('[Lingua] Storage write failed:', err.message);
      } else {
        throw err;
      }
    }

  } catch (err) {
    handleError(err);
  } finally {
    hideLoading();
  }
}

analyzeBtn.addEventListener('click', runAnalysis);

inputText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runAnalysis();
  }
});

inputText.addEventListener('input', () => {
  const len = inputText.value.length;
  charCount.textContent = `${len} / 2000`;
  charCount.classList.toggle('warn', len > 1800 && len < 2000);
  charCount.classList.toggle('limit', len >= 2000);
});

retryBtn.addEventListener('click', runAnalysis);
settingsLinkBtn.addEventListener('click', showSettings);
settingsBtn.addEventListener('click', showSettings);
cancelBtn.addEventListener('click', () => {
  apiKeyInput.value   = '';
  deeplKeyInput.value = '';
  showMain();
});

tabAnalysisBtn.addEventListener('click', showAnalysisPanel);
tabHistoryBtn.addEventListener('click', showHistoryPanel);
loadMoreBtn.addEventListener('click', () => loadHistoryPage(historyPage + 1));

saveBtn.addEventListener('click', async () => {
  const enteredKey   = apiKeyInput.value.trim();
  const deeplKey     = deeplKeyInput.value.trim();

  // Allow saving without re-entering the Anthropic key when one is already cached.
  // Only require a key entry when none is saved yet.
  if (enteredKey.length > 0 && enteredKey.length < 20) {
    settingsError.textContent = 'Please enter a valid Anthropic API key (at least 20 characters).';
    settingsError.hidden = false;
    return;
  }
  if (enteredKey.length === 0 && !cachedApiKey) {
    settingsError.textContent = 'Please enter your Anthropic API key.';
    settingsError.hidden = false;
    return;
  }

  const anthropicKey = enteredKey || cachedApiKey;
  const updates = { apiKey: anthropicKey };
  if (deeplKey) {
    updates.deeplKey = deeplKey;
  } else {
    await chrome.storage.local.remove('deeplKey');
  }
  await chrome.storage.local.set(updates);

  cachedApiKey   = anthropicKey;
  cachedDeeplKey = deeplKey || null;

  chrome.runtime.sendMessage({ type: 'lingua-keys-updated' }).catch(() => {});

  apiKeyInput.value   = '';
  deeplKeyInput.value = '';
  settingsError.hidden = true;
  showMain();
});

tabTranslateBtn.addEventListener('click', showBulkPanel);

bulkCancel.addEventListener('click', () => {
  currentTranslator?.abort();
  bulkProgress.textContent = 'Cancelled.';
  bulkCancel.hidden = true;
});

bulkSubmit.addEventListener('click', async () => {
  currentTranslator?.abort();
  bulkResults.textContent = '';
  bulkStatus.textContent = '';
  bulkProgress.textContent = '';
  bulkCacheStats.textContent = '';

  try {
    const { apiKey, deeplKey } = await getKeys();
    currentTranslator = new BulkTranslator(bulkInput.value);
    bulkCancel.hidden = false;

    await currentTranslator.runQueue(apiKey, deeplKey, {
      onUnitComplete(unit, session) {
        const p = document.createElement('p');
        p.textContent = unit.translation ?? '[Translation failed]';
        bulkResults.appendChild(p);
        bulkProgress.textContent = `${session.completed} of ${session.total} translated`;
        bulkStatus.textContent = '';
      },
      onQueueComplete(session) {
        bulkCancel.hidden = true;
        const hits = session.units.filter(u => u.fromCache).length;
        bulkCacheStats.textContent = hits > 0 ? `${hits} of ${session.total} from cache` : '';
        bulkStatus.textContent = '';
        console.info('[Lingua] Queue complete:', session.completed, 'done,', hits, 'cache hits');
      },
      onRateLimitDelay(delayMs) {
        bulkStatus.textContent = `Rate limit reached — retrying in ${Math.ceil(delayMs / 1000)} s…`;
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      bulkResults.textContent = err.message;
    } else {
      bulkResults.textContent = 'Translation failed. Please try again.';
    }
    bulkCancel.hidden = true;
  }
});

async function init() {
  window.addEventListener('unload', () => controller?.abort());
  const { apiKey } = await getKeys();
  if (!apiKey) {
    showSettings();
  } else {
    prewarmCache(apiKey);
  }
}

init();
