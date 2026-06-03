import { StorageError } from './errors/index.js';

const HISTORY_KEY        = 'lingua_history_v1';
const MAX_ENTRIES        = 75;
const QUOTA_CEILING      = 4 * 1024 * 1024;
const SNIPPET_LENGTH     = 60;
export const PAGE_SIZE   = 10;
const SCHEMA_VERSION     = 1;
const COMPRESS_THRESHOLD = 500;

async function gzipBase64(json) {
  const stream = new Blob([json]).stream()
    .pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function ungzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function packTokens(tokens) {
  const store = {
    schema: ['word', 'lemma', 'pos', 'meaning', 'rom', 'ipa', 'particles', 'endings'],
    rows: tokens.map(t => [
      t.word,
      t.lemma,
      t.pos,
      t.meaning,
      t.romanization  ?? '',
      t.pronunciation ?? '',
      t.particles ? t.particles.map(p => [p.form, p.type, p.meaning]) : null,
      t.endings   ? t.endings.map(e => [e.form, e.type, e.meaning])   : null,
    ]),
  };
  const json = JSON.stringify(store);
  if (json.length <= COMPRESS_THRESHOLD) return store;
  return { c: 1, d: await gzipBase64(json) };
}

export async function unpackTokens(packed) {
  const store = packed.c === 1
    ? JSON.parse(await ungzipBase64(packed.d))
    : packed;
  return store.rows.map(row => ({
    word:    row[0],
    lemma:   row[1],
    pos:     row[2],
    meaning: row[3],
    ...(row[4] ? { romanization:  row[4] } : {}),
    ...(row[5] ? { pronunciation: row[5] } : {}),
    ...(row[6] ? { particles: row[6].map(([form, type, meaning]) => ({ form, type, meaning })) } : {}),
    ...(row[7] ? { endings:   row[7].map(([form, type, meaning]) => ({ form, type, meaning })) } : {}),
  }));
}

export async function buildEntry(analysisResult, text, lang) {
  return {
    id:          Date.now().toString(36),
    version:     SCHEMA_VERSION,
    ts:          Date.now(),
    lang:        lang,
    input:       text.trim(),
    snippet:     text.trim().slice(0, SNIPPET_LENGTH),
    translation: analysisResult.translation,
    tokens:      await packTokens(analysisResult.tokens),
  };
}

export async function addEntry(analysisResult, text, lang) {
  const entry = await buildEntry(analysisResult, text, lang);
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] ?? [];
  const existingIdx = history.findIndex(e => e.input === entry.input);
  if (existingIdx >= 0) history.splice(existingIdx, 1);
  history.unshift(entry);
  if (history.length > MAX_ENTRIES) history.splice(MAX_ENTRIES);
  const bytes = new TextEncoder().encode(JSON.stringify(history)).length;
  if (bytes > QUOTA_CEILING) history.splice(Math.floor(MAX_ENTRIES / 2));
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch (err) {
    throw new StorageError(err.message);
  }
}

export async function getHistory(page) {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = (data[HISTORY_KEY] ?? []).filter(e => e.version === SCHEMA_VERSION);
  return history
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map(({ id, ts, lang, snippet }) => ({ id, ts, lang, snippet }));
}

export async function getEntry(id) {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] ?? [];
  const entry = history.find(e => e.id === id);
  if (!entry) return null;
  let expandedTokens;
  try {
    expandedTokens = await unpackTokens(entry.tokens);
  } catch {
    return null;
  }
  return { ...entry, tokens: expandedTokens };
}

export async function getCached(text) {
  const normalizedText = text.trim();
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY] ?? [];
  const entry = history.find(e => e.version === SCHEMA_VERSION && e.input === normalizedText);
  if (!entry) return null;
  try {
    return { ...entry, tokens: await unpackTokens(entry.tokens) };
  } catch {
    return null;
  }
}
