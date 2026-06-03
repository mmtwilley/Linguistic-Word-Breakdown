import { jest } from '@jest/globals';

jest.unstable_mockModule('../../lib/analyzer.js', () => ({
  translateOnly: jest.fn(),
  CHUNK_TIMEOUT_MS: 15_000,
  TRANSLATION_SYSTEM_PROMPT: 'Translate the input text to English using the text_translation tool.',
  TEXT_TRANSLATION_TOOL: { name: 'text_translation', description: 'Translate the input text to English.', input_schema: { type: 'object', properties: { translation: { type: 'string', description: 'Natural English translation of the full input text' } }, required: ['translation'] } },
}));
jest.unstable_mockModule('../../lib/history.js', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  addEntry: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../../lib/rate-limiter.js', () => ({
  SlidingWindowRateLimiter: jest.fn().mockImplementation(() => ({
    waitForSlot: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
  })),
}));

const { chunkText, validateBulkInput } = await import('../../lib/bulk-translator.js');
const { ValidationError } = await import('../../lib/errors/index.js');

describe('chunkText', () => {
  test('text ≤500 chars returns one unit', () => {
    const text = 'Hello world';
    const units = chunkText(text);
    expect(units.length).toBe(1);
    expect(units[0].text).toBe('Hello world');
    expect(units[0].status).toBe('pending');
    expect(units[0].index).toBe(0);
  });

  test('two-paragraph text returns two units', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    const units = chunkText(text);
    expect(units.length).toBe(2);
    expect(units[0].text).toBe('First paragraph.');
    expect(units[1].text).toBe('Second paragraph.');
  });

  test('oversized single segment (600 chars, no spaces) is hard-cut at 500', () => {
    const text = 'a'.repeat(600);
    const units = chunkText(text);
    expect(units.length).toBe(2);
    expect(units[0].text.length).toBe(500);
    expect(units[1].text.length).toBe(100);
  });

  test('multi-paragraph CJK text is chunked without corruption', () => {
    const line = '日本語のテキスト。';
    const text = (line + '\n').repeat(10).trim();
    const units = chunkText(text);
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) {
      expect(u.text).toMatch(/[　-鿿。]/);
      expect(u.text.length).toBeLessThanOrEqual(500);
    }
  });
});

describe('validateBulkInput', () => {
  test('text.length ≤ MAX_BULK_CHARS does not throw', () => {
    expect(() => validateBulkInput('a'.repeat(30_000))).not.toThrow();
  });

  test('text.length > MAX_BULK_CHARS throws ValidationError with correct message', () => {
    expect(() => validateBulkInput('a'.repeat(30_001))).toThrow(ValidationError);
    expect(() => validateBulkInput('a'.repeat(30_001))).toThrow('5 000 words');
  });
});
