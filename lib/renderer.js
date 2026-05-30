export function buildTokenCard(token) {
  const card = document.createElement('div');
  card.className = 'token-card';

  const wordEl = document.createElement('span');
  wordEl.className = 'token-word';
  wordEl.textContent = token.word;
  card.appendChild(wordEl);

  if (token.romanization) {
    const romaEl = document.createElement('span');
    romaEl.className = 'token-romanization';
    romaEl.textContent = token.romanization;
    card.appendChild(romaEl);
  }

  if (token.pronunciation) {
    const ipaEl = document.createElement('span');
    ipaEl.className = 'token-pronunciation';
    ipaEl.textContent = token.pronunciation;
    card.appendChild(ipaEl);
  }

  const lemmaEl = document.createElement('span');
  lemmaEl.className = 'token-lemma';
  lemmaEl.textContent = token.lemma;
  card.appendChild(lemmaEl);

  const badge = document.createElement('span');
  badge.className = `pos-badge pos-${token.pos}`;
  badge.textContent = token.pos;
  card.appendChild(badge);

  const meaningEl = document.createElement('span');
  meaningEl.className = 'token-meaning';
  meaningEl.textContent = token.meaning;
  card.appendChild(meaningEl);

  return card;
}

export function buildMorphemeCard(form, badgeClass, typeLabel, meaning) {
  const card = document.createElement('div');
  card.className = 'token-card morpheme-card';

  const formEl = document.createElement('span');
  formEl.className = 'token-word';
  formEl.textContent = form;
  card.appendChild(formEl);

  const typeBadge = document.createElement('span');
  typeBadge.className = badgeClass;
  typeBadge.textContent = typeLabel;
  card.appendChild(typeBadge);

  const meaningEl = document.createElement('span');
  meaningEl.className = 'token-meaning';
  meaningEl.textContent = meaning;
  card.appendChild(meaningEl);

  return card;
}
