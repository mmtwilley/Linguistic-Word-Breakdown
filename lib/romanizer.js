// Korean Revised Romanization — syllable-by-syllable decomposition.
// Handles the full Hangul syllable block range (U+AC00–U+D7A3).
// Cross-syllable assimilation rules are not applied (display-quality output).

const CHO  = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const JONG  = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];

export function romanizeKorean(word) {
  let out = '';
  for (const ch of word) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xAC00 && cp <= 0xD7A3) {
      const n = cp - 0xAC00;
      out += CHO[Math.floor(n / 28 / 21)] + JUNG[Math.floor(n / 28) % 21] + JONG[n % 28];
    } else {
      out += ch;
    }
  }
  return out;
}
