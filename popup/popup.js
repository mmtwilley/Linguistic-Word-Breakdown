import { analyzeText } from '../lib/analyzer.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from '../lib/errors/index.js';
import { buildTokenCard, buildMorphemeCard } from '../lib/renderer.js';

const RATE_LIMIT_MS = 1000;
let lastSubmitTime = 0;
let cachedApiKey = null;

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
const translationEl   = $('translation');
const tokensGrid      = $('tokens-grid');
const settingsBtn     = $('settings-btn');
const apiKeyInput     = $('api-key-input');
const saveBtn         = $('save-btn');
const cancelBtn       = $('cancel-btn');
const settingsError   = $('settings-error');

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const { apiKey } = await chrome.storage.local.get('apiKey');
  cachedApiKey = apiKey ?? null;
  return cachedApiKey;
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

function renderResults(data) {
  hideError();
  translationEl.textContent = data.translation;
  tokensGrid.replaceChildren();

  for (const token of data.tokens) {
    tokensGrid.appendChild(buildTokenCard(token));
    for (const p of (token.particles ?? [])) {
      tokensGrid.appendChild(buildMorphemeCard(p.form, `particle-badge particle-${p.type}`, p.type, p.meaning));
    }
    for (const e of (token.endings ?? [])) {
      tokensGrid.appendChild(buildMorphemeCard(`-${e.form}`, `ending-badge ending-${e.type}`, e.type, e.meaning));
    }
  }

  resultsEl.hidden = false;
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

async function runAnalysis() {
  const now = Date.now();
  if (now - lastSubmitTime < RATE_LIMIT_MS) {
    showError('Please wait a moment before submitting again.');
    return;
  }
  lastSubmitTime = now;

  hideError();
  resultsEl.hidden = true;
  showLoading();

  const apiKey = await getApiKey();

  try {
    const data = await analyzeText(inputText.value, apiKey);
    renderResults(data);
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
  apiKeyInput.value = '';
  showMain();
});

saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (key.length < 20) {
    settingsError.textContent = 'Please enter a valid API key (at least 20 characters).';
    settingsError.hidden = false;
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  cachedApiKey = key;
  apiKeyInput.value = '';
  settingsError.hidden = true;
  showMain();
});

async function init() {
  const apiKey = await getApiKey();
  if (!apiKey) showSettings();
}

init();
