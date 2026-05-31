import { detectScript, SCRIPT } from '../lib/lang-detect.js';

describe('detectScript', () => {
  test('pure Hangul returns KOR', () => {
    expect(detectScript('안녕하세요')).toBe(SCRIPT.KOR);
  });

  test('Kana present returns JPN', () => {
    expect(detectScript('ありがとう')).toBe(SCRIPT.JPN);
  });

  test('CJK with no Kana returns CMN', () => {
    expect(detectScript('你好世界')).toBe(SCRIPT.CMN);
  });

  test('ASCII letters returns LAT', () => {
    expect(detectScript('Hello world')).toBe(SCRIPT.LAT);
  });

  test('empty string returns UND', () => {
    expect(detectScript('')).toBe(SCRIPT.UND);
  });

  test('symbols only returns UND', () => {
    expect(detectScript('!@#$%^&*()')).toBe(SCRIPT.UND);
  });

  test('mixed Korean+English with Korean dominant returns KOR', () => {
    // 5 Korean chars vs 2 Latin letters
    expect(detectScript('안녕하세요 hi')).toBe(SCRIPT.KOR);
  });

  test('mixed CJK+Kana: Kana tiebreaker returns JPN', () => {
    // CJK chars present but Kana also present → JPN
    expect(detectScript('日本語です')).toBe(SCRIPT.JPN);
  });
});
