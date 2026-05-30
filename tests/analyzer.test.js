import { jest } from '@jest/globals';
import {
  validateInput,
  validateResponse,
  analyzeText,
  TimeoutError,
  ApiError,
  NetworkError,
  JsonError,
  ValidationError,
} from '../lib/analyzer.js';
import {
  VALID_RESPONSE,
  SINGLE_TOKEN_RESPONSE,
  MISSING_TRANSLATION,
  MISSING_TOKENS,
  EMPTY_TOKENS,
  MISSING_FIELD_TOKEN,
  INVALID_POS_TOKEN,
  makeOversizedResponse,
  makeClaudeResponse,
  makeHttpResponse,
  makeNetworkError,
  makeAbortError,
} from './mocks/fetchMock.js';

// ── validateInput ────────────────────────────────────────────────────────────

describe('validateInput', () => {
  test('throws on empty string', () => {
    expect(() => validateInput('')).toThrow(ValidationError);
    expect(() => validateInput('')).toThrow('Please enter text to analyze.');
  });

  test('throws on whitespace-only string', () => {
    expect(() => validateInput('   ')).toThrow(ValidationError);
    expect(() => validateInput('\t\n')).toThrow(ValidationError);
  });

  test('passes on normal text', () => {
    expect(() => validateInput('Hello world')).not.toThrow();
    expect(() => validateInput('Ich liebe Sprachen')).not.toThrow();
  });

  test('throws on text exceeding 2000 characters', () => {
    const longText = 'a'.repeat(2001);
    expect(() => validateInput(longText)).toThrow(ValidationError);
    expect(() => validateInput(longText)).toThrow('2000 characters or fewer');
  });

  test('passes on text exactly 2000 characters', () => {
    expect(() => validateInput('a'.repeat(2000))).not.toThrow();
  });

  test('throws on non-string input', () => {
    expect(() => validateInput(null)).toThrow(ValidationError);
    expect(() => validateInput(42)).toThrow(ValidationError);
  });
});

// ── validateResponse ─────────────────────────────────────────────────────────

describe('validateResponse', () => {
  test('returns parsed object for valid input', () => {
    const result = validateResponse(VALID_RESPONSE);
    expect(result.translation).toBe(VALID_RESPONSE.translation);
    expect(result.tokens).toHaveLength(3);
  });

  test('throws ValidationError when translation is missing', () => {
    const err = (() => { try { validateResponse(MISSING_TRANSLATION); } catch(e) { return e; } })();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.field).toBe('translation');
  });

  test('throws ValidationError when tokens is missing', () => {
    const err = (() => { try { validateResponse(MISSING_TOKENS); } catch(e) { return e; } })();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.field).toBe('tokens');
  });

  test('throws ValidationError when tokens array is empty', () => {
    expect(() => validateResponse(EMPTY_TOKENS)).toThrow(ValidationError);
  });

  test('throws ValidationError when token is missing a required field', () => {
    expect(() => validateResponse(MISSING_FIELD_TOKEN)).toThrow(ValidationError);
  });

  test('silently corrects invalid POS tag to "other"', () => {
    const result = validateResponse(INVALID_POS_TOKEN);
    expect(result.tokens[0].pos).toBe('other');
  });

  test('throws ValidationError when token count exceeds 500', () => {
    expect(() => validateResponse(makeOversizedResponse())).toThrow(ValidationError);
  });

  test('returns single-token response correctly', () => {
    const result = validateResponse(SINGLE_TOKEN_RESPONSE);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].word).toBe('hello');
  });
});

// ── analyzeText ──────────────────────────────────────────────────────────────

describe('analyzeText', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns AnalysisResult on successful response', async () => {
    global.fetch.mockResolvedValue(makeHttpResponse(200, makeClaudeResponse(VALID_RESPONSE)));
    const result = await analyzeText('Ich liebe Sprachen', 'sk-ant-test-key-1234567890');
    expect(result.translation).toBe(VALID_RESPONSE.translation);
    expect(result.tokens).toHaveLength(3);
  });

  test('throws ApiError(401) on HTTP 401', async () => {
    global.fetch.mockResolvedValue(makeHttpResponse(401));
    await expect(analyzeText('hello', 'bad-key')).rejects.toThrow(ApiError);
    const err = await analyzeText('hello', 'bad-key').catch(e => e);
    expect(err.status).toBe(401);
  });

  test('throws ApiError(429) on HTTP 429', async () => {
    global.fetch.mockResolvedValue(makeHttpResponse(429));
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
  });

  test('throws ApiError on HTTP 500', async () => {
    global.fetch.mockResolvedValue(makeHttpResponse(500));
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  test('throws NetworkError on fetch TypeError', async () => {
    global.fetch.mockImplementation(() => makeNetworkError());
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
  });

  test('throws TimeoutError on AbortError', async () => {
    global.fetch.mockImplementation(() => makeAbortError());
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(TimeoutError);
  });

  test('throws JsonError on malformed response body', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not valid json {{',
    });
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(JsonError);
  });

  test('throws JsonError when response is not a tool_use block', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'oops' }] }),
    });
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(JsonError);
  });

  test('throws ValidationError on missing token field', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(makeClaudeResponse(MISSING_FIELD_TOKEN)),
    });
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
  });

  test('throws ValidationError on input exceeding 2000 chars without calling fetch', async () => {
    await expect(analyzeText('a'.repeat(2001), 'sk-ant-test-key-1234567890')).rejects.toThrow(ValidationError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws ValidationError when response body exceeds 50 KB', async () => {
    const bigText = 'x'.repeat(51201);
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => bigText });
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
  });

  test('throws ValidationError when response has >500 tokens', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(makeClaudeResponse(makeOversizedResponse())),
    });
    const err = await analyzeText('hello', 'sk-ant-test-key-1234567890').catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
  });

  test('fetch timeout: AbortController fires and throws TimeoutError', async () => {
    jest.useFakeTimers();
    global.fetch.mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        }, 10001);
      });
    });

    const analysisPromise = analyzeText('hello world', 'sk-ant-test-key-1234567890');
    jest.advanceTimersByTime(10001);

    const err = await analysisPromise.catch(e => e);
    expect(err).toBeInstanceOf(TimeoutError);
    jest.useRealTimers();
  });

  // T008 (US1): inject payload never contains the API key
  test('inject payload shape: fetch args never contain apiKey string', async () => {
    let capturedBody;
    global.fetch.mockImplementation((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve(makeHttpResponse(200, makeClaudeResponse(VALID_RESPONSE)));
    });
    await analyzeText('hello', 'sk-ant-super-secret-key');
    // The API key appears in the x-api-key header (correct) but must not be in the body
    const bodyStr = JSON.stringify(capturedBody);
    expect(bodyStr).not.toContain('sk-ant-super-secret-key');
  });
});

// ── US2: English text edge cases ─────────────────────────────────────────────

describe('English text edge cases (US2)', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('accepts English sentence and passes it through without error', async () => {
    const englishResponse = {
      translation: 'I love languages.',
      tokens: [
        { word: 'I',         lemma: 'I',         pos: 'pron', meaning: 'first person singular' },
        { word: 'love',      lemma: 'love',       pos: 'verb', meaning: 'to feel affection' },
        { word: 'languages', lemma: 'language',   pos: 'noun', meaning: 'system of communication' },
      ],
    };
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify(makeClaudeResponse(englishResponse)),
    });
    const result = await analyzeText('I love languages', 'sk-ant-test-key-1234567890');
    expect(result.tokens).toHaveLength(3);
    expect(result.tokens[1].pos).toBe('verb');
  });

  test('handles ambiguous POS silently when model returns unexpected tag', () => {
    const response = {
      translation: 'run',
      tokens: [{ word: 'run', lemma: 'run', pos: 'GERUND', meaning: 'to move fast' }],
    };
    const result = validateResponse(response);
    expect(result.tokens[0].pos).toBe('other');
  });
});

// ── US3: Single-word and short-phrase input ──────────────────────────────────

describe('Single-word and short-phrase input (US3)', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('accepts single word input', () => {
    expect(() => validateInput('hello')).not.toThrow();
    expect(() => validateInput('casa')).not.toThrow();
    expect(() => validateInput('日本')).not.toThrow();
    expect(() => validateInput('café')).not.toThrow();
  });

  test('accepts two-word phrase', () => {
    expect(() => validateInput('hello world')).not.toThrow();
    expect(() => validateInput('ciao mondo')).not.toThrow();
  });

  test('validateResponse accepts single-token response', () => {
    const result = validateResponse(SINGLE_TOKEN_RESPONSE);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].word).toBe('hello');
  });

  test('validateResponse accepts two-token response', () => {
    const twoTokens = {
      translation: 'hello world',
      tokens: [
        { word: 'hello', lemma: 'hello', pos: 'noun', meaning: 'greeting' },
        { word: 'world', lemma: 'world', pos: 'noun', meaning: 'the earth' },
      ],
    };
    const result = validateResponse(twoTokens);
    expect(result.tokens).toHaveLength(2);
  });
});
