const DEEPL_URL = 'https://api-free.deepl.com/v2/translate';

export async function translateWithDeepL(text, apiKey) {
  const response = await fetch(DEEPL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text, target_lang: 'EN' }).toString(),
  });
  if (!response.ok) {
    const err = new Error(`DeepL error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const translated = data.translations?.[0]?.text;
  return (translated && translated.trim()) ? translated : null;
}
