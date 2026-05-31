export const SCRIPT = { KOR: 'kor', JPN: 'jpn', CMN: 'cmn', LAT: 'lat', UND: 'und' };

// Detect dominant script by counting characters in each Unicode block.
// Kana presence is the tiebreaker between Japanese and Chinese for CJK characters.
export function detectScript(text) {
  let kor = 0, kana = 0, cjk = 0, lat = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F)) kor++;
    else if ((cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF)) kana++;
    else if (cp >= 0x4E00 && cp <= 0x9FFF) cjk++;
    else if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) lat++;
  }
  if (kor === 0 && kana === 0 && cjk === 0 && lat === 0) return SCRIPT.UND;
  if (kor > 0 && kor >= kana && kor >= cjk && kor >= lat) return SCRIPT.KOR;
  if (kana > 0) return SCRIPT.JPN;
  if (cjk > 0 && cjk >= lat) return SCRIPT.CMN;
  return SCRIPT.LAT;
}
