export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function tokenize(value = '') {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function overlapScore(a = '', b = '') {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  let score = 0;

  for (const token of aa) {
    if (bb.has(token)) score += 1;
  }

  return score;
}