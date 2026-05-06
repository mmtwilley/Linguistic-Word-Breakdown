export const VALID_RESPONSE = {
  translation: 'I love languages.',
  tokens: [
    { word: 'Ich',      lemma: 'ich',      pos: 'pron', meaning: 'I' },
    { word: 'liebe',    lemma: 'lieben',   pos: 'verb', meaning: 'love' },
    { word: 'Sprachen', lemma: 'Sprache',  pos: 'noun', meaning: 'languages' },
  ],
};

export const SINGLE_TOKEN_RESPONSE = {
  translation: 'hello',
  tokens: [{ word: 'hello', lemma: 'hello', pos: 'noun', meaning: 'greeting' }],
};

export const MISSING_TRANSLATION = { tokens: [{ word: 'hi', lemma: 'hi', pos: 'noun', meaning: 'greeting' }] };
export const MISSING_TOKENS = { translation: 'hello' };
export const EMPTY_TOKENS = { translation: 'hello', tokens: [] };
export const MISSING_FIELD_TOKEN = {
  translation: 'hello',
  tokens: [{ word: 'hello', lemma: 'hello', pos: 'noun' }],
};
export const INVALID_POS_TOKEN = {
  translation: 'hello',
  tokens: [{ word: 'hello', lemma: 'hello', pos: 'INVALID_POS', meaning: 'greeting' }],
};

export function makeOversizedResponse() {
  const token = { word: 'a', lemma: 'a', pos: 'noun', meaning: 'a' };
  return { translation: 'a'.repeat(100), tokens: Array(600).fill(token) };
}

export function makeClaudeResponse(content) {
  return { content: [{ text: JSON.stringify(content) }] };
}

export function makeHttpResponse(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? makeClaudeResponse(VALID_RESPONSE),
  };
}

export function makeNetworkError() {
  return Promise.reject(Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }));
}

export function makeAbortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return Promise.reject(err);
}

export function makeNeverResolvingFetch() {
  return new Promise(() => {});
}
