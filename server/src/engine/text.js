import { STOPWORDS } from './lexicon.js';

const ABBREV_BEFORE_DOT = new Set(['e.g', 'i.e', 'etc', 'vs', 'approx', 'mr', 'mrs', 'ms', 'dr', 'co', 'ltd', 'inc', 'st', 'no', 'nb', 'p.s', 'ps', 'a.s.a.p']);

export function normaliseText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BULLET = /^\s*(?:[-*•·–—]|\d{1,2}[.)]|\(?[a-z][.)])\s+/i;

// Splits a message into units: list items and sentences, in order.
export function splitUnits(text) {
  const units = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = text.indexOf(line, offset);
    offset = lineStart + line.length;
    if (!line.trim()) continue;
    const bullet = line.match(BULLET);
    if (bullet) {
      const body = line.slice(bullet[0].length).trim();
      if (body) units.push({ text: body, kind: 'item', start: lineStart + bullet[0].length });
      continue;
    }
    for (const s of splitSentences(line)) units.push({ text: s.text, kind: 'sentence', start: lineStart + s.start });
  }
  return units;
}

export function splitSentences(line) {
  const out = [];
  let start = 0;
  const re = /([.!?]+)(["')\]]*)\s+(?=["'(\[]?[A-Z0-9@#£$])|([?!]+)\s+/g;
  let m;
  while ((m = re.exec(line))) {
    const end = m.index + m[0].length;
    const before = line.slice(start, m.index);
    const lastWord = (before.match(/([A-Za-z.]+)$/) || [''])[0].toLowerCase().replace(/\.$/, '');
    const isInitial = /(^|\s)[A-Z]$/.test(before);
    if (m[1] && m[1].startsWith('.') && (ABBREV_BEFORE_DOT.has(lastWord) || isInitial)) continue;
    const textPart = line.slice(start, end).trim();
    if (textPart) out.push({ text: textPart, start });
    start = end;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push({ text: rest, start });
  return out;
}

export function wordsOf(text) {
  return (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'&./:@£$€%#_-]*/gu) || []).map((w) => w.replace(/[.,:;!?]+$/, ''));
}

export function normWord(w) {
  return String(w)
    .toLowerCase()
    .replace(/'s$/, '')
    .replace(/s'$/, 's')
    .replace(/[.,:;!?"')\]]+$/, '')
    .replace(/^["'(\[]+/, '');
}

export function contentWords(text) {
  return wordsOf(text)
    .map(normWord)
    .filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));
}

export const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function tidy(s) {
  return String(s)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:-]+/, '')
    .replace(/[\s,;:-]+$/, '')
    .trim();
}

export function asSentence(s) {
  const t = tidy(s).replace(/[?]+$/, '');
  if (!t) return t;
  return capitalise(/[.!]$/.test(t) ? t : `${t}.`);
}

export function stripEndPunctuation(s) {
  return tidy(s).replace(/[.!?]+$/, '');
}

export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function wordCount(text) {
  return wordsOf(text).length;
}
