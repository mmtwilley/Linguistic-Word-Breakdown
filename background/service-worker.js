import { analyzeText } from '../lib/analyzer.js';

const MENU_ID = 'lingua-analyze';

const pendingTabs = new Set();
const dismissedTabs = new Set();
let cachedApiKey = null;

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const { apiKey } = await chrome.storage.local.get('apiKey');
  cachedApiKey = apiKey ?? null;
  return cachedApiKey;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Lingua: Analyze "%s"',
    contexts: ['selection'],
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'lingua-overlay-dismissed' && msg.tabId != null) {
    dismissedTabs.add(msg.tabId);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  if (pendingTabs.has(tab.id)) return;

  const text = info.selectionText?.trim();
  if (!text) return;

  pendingTabs.add(tab.id);

  try {
    await inject(tab.id, { tabId: tab.id, loading: true });
  } catch {
    pendingTabs.delete(tab.id);
    return; // Tab is not injectable (e.g., chrome:// pages)
  }

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      await inject(tab.id, { tabId: tab.id, error: 'No API key set. Open the Lingua extension and add your Anthropic API key in Settings.' });
      return;
    }
    const result = await analyzeText(text, apiKey);
    if (!dismissedTabs.has(tab.id)) {
      await inject(tab.id, { tabId: tab.id, result });
    }
    dismissedTabs.delete(tab.id);
  } catch (err) {
    if (!dismissedTabs.has(tab.id)) {
      await inject(tab.id, { tabId: tab.id, error: err.message || 'Something went wrong. Please try again.' }).catch(() => {});
    }
    dismissedTabs.delete(tab.id);
  } finally {
    pendingTabs.delete(tab.id);
  }
});

async function inject(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: linguaRenderOverlay,
    args: [payload],
  });
}

// Self-contained: injected into page context via chrome.scripting.
// This function is serialized by Chrome — it cannot close over module-scope
// variables (including cachedApiKey). The args array contains only the
// payload object, which never includes the API key. Security guarantee:
// the key is retrieved and used exclusively within this service worker context.
function linguaRenderOverlay(payload) {
  const OVERLAY_ID = '__lingua_overlay_host__';
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .panel {
      position: fixed; top: 20px; right: 20px;
      width: 360px; max-height: 480px; overflow-y: auto;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; color: #111827; pointer-events: all;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px 10px; border-bottom: 1px solid #e5e7eb;
    }
    .logo { font-size: 15px; font-weight: 700; color: #4f46e5; }
    .close-btn {
      background: none; border: none; cursor: pointer;
      font-size: 16px; color: #6b7280; padding: 2px 6px;
      border-radius: 4px; line-height: 1;
    }
    .close-btn:hover { background: #f3f4f6; color: #111827; }
    .body { padding: 12px 16px 16px; }
    .spinner-wrap { display: flex; justify-content: center; padding: 24px 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      width: 28px; height: 28px; border: 3px solid #e5e7eb;
      border-top-color: #4f46e5; border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }
    .error {
      background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px;
      padding: 10px 12px; color: #991b1b; font-size: 13px; line-height: 1.4;
    }
    .translation {
      font-size: 15px; font-weight: 600; margin-bottom: 12px;
      padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; line-height: 1.5;
    }
    .tokens-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px;
    }
    .token-card {
      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
      padding: 8px; display: flex; flex-direction: column; gap: 3px;
    }
    .token-card.morpheme-card { background: #fff; border-style: dashed; }
    .token-word { font-size: 15px; font-weight: 700; word-break: break-word; }
    .token-romanization { font-size: 11px; color: #4f46e5; font-style: italic; word-break: break-word; }
    .token-pronunciation { font-size: 11px; color: #6b7280; word-break: break-word; }
    .token-lemma { font-size: 12px; font-style: italic; color: #6b7280; word-break: break-word; }
    .token-meaning { font-size: 12px; margin-top: 2px; word-break: break-word; }
    .pos-badge {
      display: inline-block; font-size: 10px; font-weight: 700;
      text-transform: uppercase; padding: 1px 5px; border-radius: 3px;
      letter-spacing: 0.04em; width: fit-content;
    }
    .pos-noun  { background: #dbeafe; color: #1e40af; }
    .pos-verb  { background: #dcfce7; color: #166534; }
    .pos-adj   { background: #ffedd5; color: #9a3412; }
    .pos-adv   { background: #fef9c3; color: #854d0e; }
    .pos-pron  { background: #f3e8ff; color: #6b21a8; }
    .pos-prep  { background: #f1f5f9; color: #475569; }
    .pos-conj  { background: #fce7f3; color: #9d174d; }
    .pos-det   { background: #ccfbf1; color: #115e59; }
    .pos-num   { background: #fee2e2; color: #991b1b; }
    .pos-punct { background: #f3f4f6; color: #9ca3af; }
    .pos-other { background: #f3f4f6; color: #6b7280; }
    .token-particles, .token-endings { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 1px; }
    .particle-badge, .ending-badge {
      display: inline-block; font-size: 10px; font-weight: 600;
      padding: 1px 5px; border-radius: 3px; letter-spacing: 0.02em;
      cursor: default; width: fit-content;
    }
    .particle-topic        { background: #e0f2fe; color: #075985; }
    .particle-subject      { background: #d1fae5; color: #065f46; }
    .particle-object       { background: #fef3c7; color: #92400e; }
    .particle-sentence-end { background: #ede9fe; color: #5b21b6; }
    .particle-other-particle { background: #f3f4f6; color: #6b7280; }
    .ending-connective     { background: #fff7ed; color: #c2410c; }
    .ending-attributive    { background: #ecfeff; color: #0e7490; }
    .ending-nominal        { background: #fdf4ff; color: #7e22ce; }
    .ending-concessive     { background: #f0fdf4; color: #15803d; }
    .ending-sentence-final { background: #fff1f2; color: #be123c; }
    .ending-other-ending   { background: #f8fafc; color: #64748b; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const header = document.createElement('div');
  header.className = 'header';

  const logo = document.createElement('span');
  logo.className = 'logo';
  logo.textContent = 'Lingua';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    if (payload.tabId != null) {
      chrome.runtime.sendMessage({ type: 'lingua-overlay-dismissed', tabId: payload.tabId });
    }
    host.remove();
  });

  header.appendChild(logo);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';

  if (payload.loading) {
    const wrap = document.createElement('div');
    wrap.className = 'spinner-wrap';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    wrap.appendChild(spinner);
    body.appendChild(wrap);
  } else if (payload.error) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = payload.error;
    body.appendChild(errorDiv);
  } else if (payload.result) {
    const { translation, tokens } = payload.result;
    const trans = document.createElement('div');
    trans.className = 'translation';
    trans.textContent = translation;
    body.appendChild(trans);

    const grid = document.createElement('div');
    grid.className = 'tokens-grid';

    for (const token of tokens) {
      const card = document.createElement('div');
      card.className = 'token-card';

      const mk = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };

      card.appendChild(mk('div', 'token-word', token.word));
      if (token.romanization) card.appendChild(mk('div', 'token-romanization', token.romanization));
      if (token.pronunciation) card.appendChild(mk('div', 'token-pronunciation', token.pronunciation));
      card.appendChild(mk('div', 'token-lemma', token.lemma));
      card.appendChild(mk('span', 'pos-badge pos-' + token.pos, token.pos));
      card.appendChild(mk('div', 'token-meaning', token.meaning));
      grid.appendChild(card);

      for (const p of (token.particles ?? [])) {
        const mc = mk('div', 'token-card morpheme-card', '');
        mc.appendChild(mk('span', 'token-word', p.form));
        mc.appendChild(mk('span', 'particle-badge particle-' + p.type, p.type));
        mc.appendChild(mk('div', 'token-meaning', p.meaning));
        grid.appendChild(mc);
      }
      for (const e of (token.endings ?? [])) {
        const mc = mk('div', 'token-card morpheme-card', '');
        mc.appendChild(mk('span', 'token-word', '-' + e.form));
        mc.appendChild(mk('span', 'ending-badge ending-' + e.type, e.type));
        mc.appendChild(mk('div', 'token-meaning', e.meaning));
        grid.appendChild(mc);
      }
    }
    body.appendChild(grid);
  }

  panel.appendChild(body);
  shadow.appendChild(panel);
}
