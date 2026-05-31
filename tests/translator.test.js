import { jest } from '@jest/globals';
import { translateWithDeepL } from '../lib/translator.js';

describe('translateWithDeepL', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('success case returns translations[0].text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ translations: [{ text: 'Hello world', detected_source_language: 'KO' }] }),
    });
    const result = await translateWithDeepL('안녕 세상', 'test-key:fx');
    expect(result).toBe('Hello world');
  });

  test('non-2xx response throws Error with status property', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    const err = await translateWithDeepL('text', 'bad-key:fx').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
  });

  test('response with missing translations field returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const result = await translateWithDeepL('text', 'test-key:fx');
    expect(result).toBeNull();
  });

  test('translations[0].text equal to empty string returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ translations: [{ text: '' }] }),
    });
    const result = await translateWithDeepL('text', 'test-key:fx');
    expect(result).toBeNull();
  });

  test('translations[0].text equal to whitespace returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ translations: [{ text: '   ' }] }),
    });
    const result = await translateWithDeepL('text', 'test-key:fx');
    expect(result).toBeNull();
  });
});
