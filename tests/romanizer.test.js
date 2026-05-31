import { romanizeKorean } from '../lib/romanizer.js';

describe('romanizeKorean', () => {
  test('single syllable block: 안 → an', () => {
    expect(romanizeKorean('안')).toBe('an');
  });

  test('multi-syllable word: 안녕 → annyeong', () => {
    expect(romanizeKorean('안녕')).toBe('annyeong');
  });

  test('non-Hangul characters passed through unchanged', () => {
    expect(romanizeKorean('hello')).toBe('hello');
  });

  test('empty string returns empty string', () => {
    expect(romanizeKorean('')).toBe('');
  });
});
