const VALID_POS = new Set(['noun','verb','adj','adv','pron','prep','conj','det','num','punct','other']);

const SYSTEM_PROMPT = `Translate the input text and produce a word-level linguistic breakdown for language learning.

Input: A single string of text in any language.

Output: Return ONLY valid JSON. No explanations, no markdown, no extra text.

Schema:
{
  "translation": "string",
  "tokens": [
    {
      "word": "string",
      "lemma": "string",
      "pos": "string",
      "meaning": "string"
    }
  ]
}

Rules:
- translation: natural English rendering of the full sentence
- tokens: one entry per original word, preserving order
- word: exact surface form from input
- lemma: base dictionary form of the word
- pos: simple part-of-speech tag (noun, verb, adj, adv, pron, prep, conj, det, num, punct, other)
- meaning: short English gloss (max 1 short phrase, ideally 5 words or fewer)
- If uncertain, choose the most likely interpretation given sentence context
- Do not include any text outside the JSON object
- Keep output concise and consistent for UI rendering`;

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_API = 2048;
const TIMEOUT_MS = 10000;
const MAX_INPUT_CHARS = 2000;
const MAX_RESPONSE_BYTES = 51200;
const MAX_TOKEN_COUNT = 500;

export class TimeoutError extends Error {
  constructor() {
    super('Request took too long. Please try again.');
    this.name = 'TimeoutError';
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message || 'Network error. Check your internet connection and try again.');
    this.name = 'NetworkError';
  }
}

export class JsonError extends Error {
  constructor(message) {
    super(message || 'Unexpected response format. Please retry.');
    this.name = 'JsonError';
  }
}

export class ValidationError extends Error {
  constructor(field, message) {
    super(message || 'Incomplete response. Please retry.');
    this.name = 'ValidationError';
    this.field = field;
  }
}

export function validateInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('text', 'Please enter text to analyze.');
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new ValidationError('text', `Input must be ${MAX_INPUT_CHARS} characters or fewer.`);
  }
}

export function validateResponse(responseText) {
  if (responseText.length > MAX_RESPONSE_BYTES) {
    throw new ValidationError('response', 'Response too large. Please try a shorter input.');
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new JsonError('Unexpected response format. Please retry.');
  }

  if (!parsed.translation || typeof parsed.translation !== 'string' || parsed.translation.trim() === '') {
    throw new ValidationError('translation', 'Incomplete response. Please retry.');
  }
  if (!Array.isArray(parsed.tokens) || parsed.tokens.length === 0) {
    throw new ValidationError('tokens', 'No analysis returned. Please retry.');
  }
  if (parsed.tokens.length > MAX_TOKEN_COUNT) {
    throw new ValidationError('tokens', 'Analysis too long (>500 words). Please try a shorter input.');
  }

  parsed.tokens = parsed.tokens.map((token, i) => {
    for (const field of ['word', 'lemma', 'pos', 'meaning']) {
      if (!token[field] || typeof token[field] !== 'string' || token[field].trim() === '') {
        console.error(`Token ${i}: missing or empty field "${field}"`);
        throw new ValidationError(field, 'Incomplete analysis (missing field). Please retry.');
      }
    }
    if (!VALID_POS.has(token.pos)) {
      console.warn(`Token ${i}: invalid POS "${token.pos}", correcting to "other"`);
      token.pos = 'other';
    }
    return token;
  });

  return parsed;
}

export async function analyzeText(text, apiKey) {
  validateInput(text);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS_API,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      if (response.status === 401) throw new ApiError(401, 'Invalid or expired API key. Check your settings.');
      if (response.status === 429) throw new ApiError(429, "You've made too many requests. Please wait a moment before trying again.");
      if (response.status >= 500) throw new ApiError(response.status, 'Claude API is temporarily unavailable. Please try again.');
      throw new ApiError(response.status, `API error (${response.status}). Please try again.`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new JsonError('Unexpected response format. Please retry.');
    }

    if (!data.content?.[0]?.text || typeof data.content[0].text !== 'string') {
      throw new JsonError('Unexpected response format. Please retry.');
    }

    return validateResponse(data.content[0].text);

  } catch (err) {
    if (err instanceof ApiError || err instanceof JsonError || err instanceof ValidationError || err instanceof TimeoutError) {
      throw err;
    }
    if (err.name === 'AbortError') throw new TimeoutError();
    throw new NetworkError(err.message);
  } finally {
    clearTimeout(timeoutId);
  }
}
