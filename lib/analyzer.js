export { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';


const VALID_POS = new Set(['noun','verb','adj','adv','pron','prep','conj','det','num','punct','other']);
const VALID_PARTICLE_TYPES = new Set(['topic','subject','object','sentence-end','other-particle']);

const SYSTEM_PROMPT = `Analyze the input text for language learning using the linguistic_analysis tool.

For each word:
- lemma: base/dictionary form (Korean: stem without attached particles)
- pos: noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other
- meaning: short English gloss (5 words max)
- romanization: Latin transliteration for non-Latin scripts (Korean: Revised Romanization, Chinese: Pinyin, Japanese: Hepburn). Omit for Latin-script words.
- pronunciation: IPA transcription for non-Latin scripts and non-obvious pronunciations. Omit otherwise.
- particles: Korean grammatical markers only — topic (-은/-는), subject (-이/-가), object (-을/-를), sentence-end (-이네/-이까/-이다/-이네다). Omit if none.`;

const ANALYSIS_TOOL = {
  name: 'linguistic_analysis',
  description: 'Structured word-level linguistic breakdown of input text for language learning.',
  input_schema: {
    type: 'object',
    properties: {
      translation: { type: 'string', description: 'Natural English translation of the full input' },
      tokens: {
        type: 'array',
        description: 'One entry per input word, preserving order',
        items: {
          type: 'object',
          properties: {
            word:          { type: 'string' },
            lemma:         { type: 'string' },
            pos:           { type: 'string' },
            meaning:       { type: 'string' },
            romanization:  { type: 'string' },
            pronunciation: { type: 'string' },
            particles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  form:    { type: 'string' },
                  type:    { type: 'string' },
                  meaning: { type: 'string' },
                },
                required: ['form', 'type', 'meaning'],
              },
            },
          },
          required: ['word', 'lemma', 'pos', 'meaning'],
        },
      },
    },
    required: ['translation', 'tokens'],
  },
};


const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_API = 4096;
const TIMEOUT_MS = 30000;
const MAX_INPUT_CHARS = 2000;
const MAX_RESPONSE_BYTES = 51200;
const MAX_TOKEN_COUNT = 500;

export function validateInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('text', 'Please enter text to analyze.');
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new ValidationError('text', `Input must be ${MAX_INPUT_CHARS} characters or fewer.`);
  }
}

export function validateResponse(data) {
  if (JSON.stringify(data).length > MAX_RESPONSE_BYTES) {
    throw new ValidationError('response', 'Response too large. Please try a shorter input.');
  }
  if (!data.translation || typeof data.translation !== 'string' || data.translation.trim() === '') {
    throw new ValidationError('translation', 'Incomplete response. Please retry.');
  }
  if (!Array.isArray(data.tokens) || data.tokens.length === 0) {
    throw new ValidationError('tokens', 'No analysis returned. Please retry.');
  }
  if (data.tokens.length > MAX_TOKEN_COUNT) {
    throw new ValidationError('tokens', 'Analysis too long (>500 words). Please try a shorter input.');
  }

  data.tokens = data.tokens.map((token, i) => {
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
    for (const field of ['romanization', 'pronunciation']) {
      if (token[field] !== undefined && (typeof token[field] !== 'string' || token[field].trim() === '')) {
        delete token[field];
      }
    }
    if (token.particles !== undefined) {
      if (!Array.isArray(token.particles)) {
        delete token.particles;
      } else {
        token.particles = token.particles.filter((p, pi) => {
          if (!p?.form || typeof p.form !== 'string' || p.form.trim() === '') return false;
          if (!VALID_PARTICLE_TYPES.has(p.type)) {
            console.warn(`Token ${i} particle ${pi}: invalid type "${p.type}", correcting to "other-particle"`);
            p.type = 'other-particle';
          }
          if (typeof p.meaning !== 'string') p.meaning = '';
          return true;
        });
        if (token.particles.length === 0) delete token.particles;
      }
    }
    return token;
  });

  return data;
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
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS_API,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: 'linguistic_analysis' },
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

    const toolUse = data.content?.find(b => b.type === 'tool_use' && b.name === 'linguistic_analysis');
    if (!toolUse?.input || typeof toolUse.input !== 'object') {
      throw new JsonError('Unexpected response format. Please retry.');
    }

    return validateResponse(toolUse.input);

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
