import { analyzeText, validateInput } from '../lib/analyzer.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from '../lib/errors/index.js';

const RATE_LIMIT_MS = 1000;
let lastSubmitTime = 0;

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
  tokensGrid.textContent = '';

  for (const token of data.tokens) {
    const card = document.createElement('div');
    card.className = 'token-card';

    const wordEl = document.createElement('span');
    wordEl.className = 'token-word';
    wordEl.textContent = token.word;

    const lemmaEl = document.createElement('span');
    lemmaEl.className = 'token-lemma';
    lemmaEl.textContent = token.lemma;

    const badge = document.createElement('span');
    badge.className = `pos-badge pos-${token.pos}`;
    badge.textContent = token.pos;

    const meaningEl = document.createElement('span');
    meaningEl.className = 'token-meaning';
    meaningEl.textContent = token.meaning;

    card.appendChild(wordEl);

    if (token.romanization) {
      const romaEl = document.createElement('span');
      romaEl.className = 'token-romanization';
      romaEl.textContent = token.romanization;
      card.appendChild(romaEl);
    }

    if (token.pronunciation) {
      const ipaEl = document.createElement('span');
      ipaEl.className = 'token-pronunciation';
      ipaEl.textContent = token.pronunciation;
      card.appendChild(ipaEl);
    }

    card.appendChild(lemmaEl);
    card.appendChild(badge);

    if (token.particles && token.particles.length > 0) {
      const particlesEl = document.createElement('div');
      particlesEl.className = 'token-particles';
      for (const p of token.particles) {
        const pBadge = document.createElement('span');
        pBadge.className = `particle-badge particle-${p.type}`;
        pBadge.textContent = p.form;
        pBadge.setAttribute('title', p.meaning);
        particlesEl.appendChild(pBadge);
      }
      card.appendChild(particlesEl);
    }

    card.appendChild(meaningEl);
    tokensGrid.appendChild(card);
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

  try {
    validateInput(inputText.value);
  } catch (err) {
    handleError(err);
    return;
  }

  hideError();
  resultsEl.hidden = true;
  showLoading();

  const { apiKey } = await chrome.storage.local.get('apiKey');

  try {
    const data = await analyzeText(inputText.value, apiKey);
    lastSubmitTime = Date.now();
    renderResults(data);
  } catch (err) {
    lastSubmitTime = Date.now();
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
cancelBtn.addEventListener('click', showMain);

saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (key.length < 20) {
    settingsError.textContent = 'Please enter a valid API key (at least 20 characters).';
    settingsError.hidden = false;
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  apiKeyInput.value = '';
  settingsError.hidden = true;
  showMain();
});

async function init() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) showSettings();
}

init();
