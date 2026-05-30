export { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';


const VALID_POS = new Set(['noun','verb','adj','adv','pron','prep','conj','det','num','punct','other']);
const VALID_PARTICLE_TYPES = new Set(['topic','subject','object','sentence-end','other-particle']);
const VALID_ENDING_TYPES   = new Set(['connective','attributive','nominal','concessive','sentence-final','other-ending']);

const SYSTEM_PROMPT = `Analyze the input text for language learning using the linguistic_analysis tool.

For each word:
- lemma: base/dictionary form (Korean: stem without attached particles)
- pos: noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other
- meaning: short English gloss (5 words max)
- romanization: REQUIRED for every non-Latin-script word — Korean: Revised Romanization, Chinese: Pinyin, Japanese: Hepburn. Omit only for words already in the Latin alphabet.
- pronunciation: REQUIRED IPA transcription for every non-Latin-script word. Omit only for Latin-script words with completely transparent pronunciation.
- particles: REQUIRED for Korean nouns/pronouns with an attached case particle (조사). 은/는 → topic, 이/가 → subject, 을/를 → object, sentence-final copula endings → sentence-end, others → other-particle. Omit only when no particle is attached.
- endings: REQUIRED for Korean verbs and adjectives with an attached grammatical ending (어미). -고/-아서/-어서/-면/-지만/-는데/-려고 → connective; -는/-은/-ㄴ/-을/-ㄹ/-던 modifying a noun → attributive; -기/-음/-ㅁ → nominal; -든/-든지/-거나 → concessive; -다/-요/-네/-지/-ㄹ게/-아/-어 as sentence-final → sentence-final; anything else → other-ending. Omit only for words with no attached ending.`;

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
            word:          { type: 'string', description: 'Exact surface form as it appears in the input' },
            lemma:         { type: 'string', description: 'Base/dictionary form; for Korean strip attached particles' },
            pos:           { type: 'string', description: 'noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other' },
            meaning:       { type: 'string', description: 'Short English gloss, 5 words max' },
            romanization:  { type: 'string', description: 'REQUIRED for every Korean, Chinese, or Japanese word: Revised Romanization / Pinyin / Hepburn. Must not be omitted for non-Latin-script words.' },
            pronunciation: { type: 'string', description: 'REQUIRED IPA transcription for every Korean, Chinese, or Japanese word. Must not be omitted for non-Latin-script words.' },
            particles: {
              type: 'array',
              description: 'REQUIRED for Korean nouns/pronouns with an attached case particle (조사): 은/는 → topic, 이/가 → subject, 을/를 → object, copula endings → sentence-end, others → other-particle.',
              items: {
                type: 'object',
                properties: {
                  form:    { type: 'string', description: 'The particle exactly as attached (e.g. 는, 가, 를)' },
                  type:    { type: 'string', description: 'topic | subject | object | sentence-end | other-particle' },
                  meaning: { type: 'string', description: 'Brief English explanation of what the particle does' },
                },
                required: ['form', 'type', 'meaning'],
              },
            },
            endings: {
              type: 'array',
              description: 'REQUIRED for Korean verbs/adjectives with an attached grammatical ending (어미). Each entry is one ending.',
              items: {
                type: 'object',
                properties: {
                  form:    { type: 'string', description: 'The ending as attached (e.g. 고, 는, 든, 아서)' },
                  type:    { type: 'string', description: 'connective | attributive | nominal | concessive | sentence-final | other-ending' },
                  meaning: { type: 'string', description: 'Brief English explanation of what this ending expresses' },
                },
                required: ['form', 'type', 'meaning'],
              },
            },
          },
          required: ['word', 'lemma', 'pos', 'meaning', 'romanization', 'pronunciation'],
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
    if (token.endings !== undefined) {
      if (!Array.isArray(token.endings)) {
        delete token.endings;
      } else {
        token.endings = token.endings.filter((e, ei) => {
          if (!e?.form || typeof e.form !== 'string' || e.form.trim() === '') return false;
          if (!VALID_ENDING_TYPES.has(e.type)) {
            console.warn(`Token ${i} ending ${ei}: invalid type "${e.type}", correcting to "other-ending"`);
            e.type = 'other-ending';
          }
          if (typeof e.meaning !== 'string') e.meaning = '';
          return true;
        });
        if (token.endings.length === 0) delete token.endings;
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
