export { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';
import { TimeoutError, ApiError, NetworkError, JsonError, ValidationError } from './errors/index.js';
import { detectScript, SCRIPT } from './lang-detect.js';
import { romanizeKorean } from './romanizer.js';
import { translateWithDeepL } from './translator.js';

const VALID_POS            = new Set(['noun','verb','adj','adv','pron','prep','conj','det','num','punct','other']);
const VALID_PARTICLE_TYPES = new Set(['topic','subject','object','sentence-end','other-particle']);
const VALID_ENDING_TYPES   = new Set(['connective','attributive','nominal','concessive','sentence-final','other-ending']);

const HANGUL_RE = /[가-힣ᄀ-ᇿ㄰-㆏]/;

const API_URL        = 'https://api.anthropic.com/v1/messages';
const API_VERSION    = '2023-06-01';
const MODEL          = 'claude-sonnet-4-6';
const MAX_TOKENS_API = 4096;
const TIMEOUT_MS     = 30000;
export const CHUNK_TIMEOUT_MS = 15_000;
const MAX_INPUT_CHARS    = 2000;
const MAX_RESPONSE_BYTES = 51200;
const MAX_TOKEN_COUNT    = 500;

// Build a language-aware system prompt.
// When DeepL has already translated the text we tell Claude to skip translation
// and focus entirely on morphological breakdown.
function buildSystemPrompt(lang, preTranslation) {
  let p = 'Analyze the input text for language learning using the linguistic_analysis tool. Produce a structured word-level breakdown.';
  if (preTranslation) {
    p += ` The English translation is already provided as context — do not include a translation field in your output. Focus entirely on the word-by-word morphological breakdown.`;
  }
  if (lang === SCRIPT.KOR) {
    p += ' For Korean, identify attached particles (조사) and verb/adjective endings (어미) as specified in the tool schema. Romanization will be generated locally; omit it from your output.';
  } else if (lang === SCRIPT.JPN) {
    p += ' For Japanese words, provide Hepburn romanization.';
  } else if (lang === SCRIPT.CMN) {
    p += ' For Chinese words, provide Pinyin romanization.';
  }
  return p;
}

// Build a language-conditional tool schema:
// - translation: omitted when DeepL already provided it
// - pronunciation (IPA): removed entirely — Web Speech API handles audio
// - romanization: Korean generates locally; Japanese/Chinese still use Claude
// - particles + endings: only included for Korean
export function buildAnalysisTool(lang, preTranslation) {
  const tokenRequired = ['word', 'lemma', 'pos', 'meaning'];
  const tokenProps = {
    word:    { type: 'string', description: 'Exact surface form as it appears in the input' },
    lemma:   { type: 'string', description: 'Base/dictionary form; for Korean strip attached particles' },
    pos:     { type: 'string', description: 'noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other' },
    meaning: { type: 'string', description: 'Short English gloss, 5 words max' },
  };

  if (lang === SCRIPT.JPN) {
    tokenProps.romanization = { type: 'string', description: 'Hepburn romanization for this Japanese word' };
    tokenRequired.push('romanization');
  } else if (lang === SCRIPT.CMN) {
    tokenProps.romanization = { type: 'string', description: 'Pinyin romanization for this Chinese word' };
    tokenRequired.push('romanization');
  }

  if (lang === SCRIPT.KOR) {
    tokenProps.particles = {
      type: 'array',
      description: 'REQUIRED for Korean nouns/pronouns with an attached case particle (조사): 은/는→topic, 이/가→subject, 을/를→object, copula endings→sentence-end, others→other-particle.',
      items: {
        type: 'object',
        properties: {
          form:    { type: 'string', description: 'The particle exactly as attached (e.g. 는, 가, 를)' },
          type:    { type: 'string', description: 'topic | subject | object | sentence-end | other-particle' },
          meaning: { type: 'string', description: 'Brief English explanation of what the particle does' },
        },
        required: ['form', 'type', 'meaning'],
      },
    };
    tokenProps.endings = {
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
    };
  }

  const topProps = {
    tokens: {
      type: 'array',
      description: 'One entry per input word, preserving order',
      items: { type: 'object', properties: tokenProps, required: tokenRequired },
    },
  };
  const topRequired = ['tokens'];

  if (!preTranslation) {
    topProps.translation = { type: 'string', description: 'Natural English translation of the full input' };
    topRequired.unshift('translation');
  }

  return {
    name: 'linguistic_analysis',
    description: 'Structured word-level linguistic breakdown of input text for language learning.',
    input_schema: { type: 'object', properties: topProps, required: topRequired },
  };
}

export function validateInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('text', 'Please enter text to analyze.');
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new ValidationError('text', `Input must be ${MAX_INPUT_CHARS} characters or fewer.`);
  }
}

export function validateResponse(data) {
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
    if (token.romanization !== undefined && (typeof token.romanization !== 'string' || token.romanization.trim() === '')) {
      delete token.romanization;
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

export const TRANSLATION_SYSTEM_PROMPT = 'Translate the input text to English using the text_translation tool.';

export const TEXT_TRANSLATION_TOOL = {
  name: 'text_translation',
  description: 'Translate the input text to English.',
  input_schema: {
    type: 'object',
    properties: {
      translation: { type: 'string', description: 'Natural English translation of the full input text' },
    },
    required: ['translation'],
  },
};

// Translation-only path: no word breakdown, no streaming. Used by the bulk queue (feature 007)
// and the large-text single-text flow. Returns { translation, tokens: [] }.
export async function translateOnly(text, apiKey, deeplKey = null, options = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);

  const fetchSignal = options.signal && AbortSignal.any
    ? AbortSignal.any([timeoutController.signal, options.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: fetchSignal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: TRANSLATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...TEXT_TRANSLATION_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: 'text_translation' },
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      if (response.status === 401) throw new ApiError(401, 'Invalid or expired API key. Check your settings.');
      if (response.status === 429) throw new ApiError(429, "You've made too many requests. Please wait a moment before trying again.");
      if (response.status >= 500) throw new ApiError(response.status, 'Claude API is temporarily unavailable. Please try again.');
      throw new ApiError(response.status, `API error (${response.status}). Please try again.`);
    }

    if (options.signal?.aborted) return null;

    const body = await response.json();
    const toolInput = body.content?.find(b => b.type === 'tool_use')?.input;
    if (!toolInput?.translation) throw new JsonError('No translation returned. Please retry.');

    return { translation: toolInput.translation, tokens: [] };

  } catch (err) {
    if (err instanceof ApiError || err instanceof JsonError || err instanceof ValidationError || err instanceof TimeoutError) throw err;
    if (err.name === 'AbortError') {
      if (options.signal?.aborted) return null;
      throw new TimeoutError();
    }
    throw new NetworkError(err.message);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Pipeline:
//  1. Detect script (local, free)
//  2. Translate with DeepL if key provided and text is non-Latin (free tier)
//  3. Stream Claude response via SSE — extract translation early, parse tokens at end
//  4. Merge DeepL translation into result
//  5. Generate Korean romanization locally via Revised Romanization algorithm
export async function analyzeText(text, apiKey, deeplKey = null, options = {}) {
  validateInput(text);

  const lang = detectScript(text);
  let preTranslation = null;

  if (deeplKey && lang !== SCRIPT.LAT && lang !== SCRIPT.UND) {
    try { preTranslation = await translateWithDeepL(text, deeplKey); }
    catch (err) { console.warn('[Lingua] DeepL translation failed, falling back to Claude:', err.message); }
  }

  if (preTranslation && !options.signal?.aborted) {
    options.onTranslation?.(preTranslation);
  }

  const tool         = buildAnalysisTool(lang, preTranslation);
  const systemPrompt = buildSystemPrompt(lang, preTranslation);

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);

  const fetchSignal = options.signal && AbortSignal.any
    ? AbortSignal.any([timeoutController.signal, options.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: fetchSignal,
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
        stream: true,
        system: [{ type: 'text', text: systemPrompt }],
        tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    let translationEmitted = !!preTranslation;
    let translationSliced = false;
    let extractedTranslation = preTranslation;

    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        if (!options.signal?.aborted) options.onTranslation?.('');
        throw new ValidationError('response', 'Response too large. Please try a shorter input.');
      }

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          buffer += event.delta.partial_json ?? '';
        }
      }

      if (!translationEmitted) {
        const match = buffer.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*?)"/);
        if (match) {
          translationEmitted = true;
          extractedTranslation = JSON.parse('"' + match[1] + '"');
          if (!options.signal?.aborted) {
            options.onTranslation?.(extractedTranslation);
          }
        }
      }

      if (translationEmitted && !translationSliced) {
        const tokensIdx = buffer.indexOf('"tokens"');
        if (tokensIdx !== -1) {
          buffer = buffer.slice(tokensIdx);
          translationSliced = true;
        }
      }
    }

    if (options.signal?.aborted) return null;

    const jsonStr = translationSliced ? ('{' + buffer) : buffer;
    const fullMatch = jsonStr.match(/(\{[\s\S]*\})/);
    if (!fullMatch) throw new JsonError('Unexpected response format. Please retry.');

    let data;
    try { data = JSON.parse(fullMatch[1]); }
    catch { throw new JsonError('Unexpected response format. Please retry.'); }

    if (extractedTranslation && !data.translation) data.translation = extractedTranslation;
    if (preTranslation && !data.translation) data.translation = preTranslation;

    if (lang === SCRIPT.KOR) {
      for (const token of (data.tokens ?? [])) {
        if (!token.romanization && HANGUL_RE.test(token.word)) {
          token.romanization = romanizeKorean(token.word);
        }
      }
    }

    return validateResponse(data);

  } catch (err) {
    if (err instanceof ApiError || err instanceof JsonError || err instanceof ValidationError || err instanceof TimeoutError) throw err;
    if (err.name === 'AbortError') {
      if (options.signal?.aborted) return null;
      throw new TimeoutError();
    }
    throw new NetworkError(err.message);
  } finally {
    clearTimeout(timeoutId);
  }
}
