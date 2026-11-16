import { ABBREVIATIONS, PLAIN_LANGUAGE } from './lexicon.js';
import { asSentence, capitalise, escapeRegExp, wordCount } from './text.js';

const plainPatterns = PLAIN_LANGUAGE.map(([pattern, to]) => ({ re: new RegExp(`\\b${pattern}\\b`, 'gi'), to }));

const matchCase = (original, replacement) => (/^[A-Z]/.test(original) ? capitalise(replacement) : replacement);

function abbreviationPatterns(glossary = []) {
  const fromGlossary = glossary
    .filter((g) => g && g.term && g.meaning)
    .map((g) => [g.term.trim(), g.meaning.trim(), 'explain', 'glossary']);
  return [...fromGlossary, ...ABBREVIATIONS].map(([term, meaning, mode, origin = 'built-in']) => ({
    term,
    meaning,
    mode,
    origin,
    re: new RegExp(`(?<![\\w/@.])${escapeRegExp(term)}(?![\\w/])`, 'gi'),
  }));
}

// Communication rules: CM1 plain language, CM3 abbreviations, CM2 short sentences.
// Records every change so the employee and manager can see exactly what was altered.
export function createTextTransformer({ plain = false, abbreviations = false, glossary = [] } = {}) {
  const changes = [];
  const explained = new Set();
  const abbrevs = abbreviationPatterns(glossary);

  function applyPlain(text, record) {
    let out = text;
    for (const { re, to } of plainPatterns) {
      out = out.replace(re, (match, ...groups) => {
        const replaced = to.replace(/\$(\d)/g, (_, n) => groups[Number(n) - 1] ?? '');
        if (record) changes.push({ code: 'CM1', from: match, to: replaced });
        return matchCase(match, replaced);
      });
    }
    return out;
  }

  function applyAbbreviations(text, record) {
    let out = text;
    for (const a of abbrevs) {
      out = out.replace(a.re, (match, offset, whole) => {
        const isGlossary = a.origin === 'glossary';
        // "Okrs" in a name is not an abbreviation; "OKRs" (capitals plus a plural s) is.
        const core = /^[^a-z]+s$/.test(match) ? match.slice(0, -1) : match;
        if (!isGlossary && core !== core.toUpperCase() && core !== core.toLowerCase()) return match;
        if (a.mode === 'replace') {
          if (record) changes.push({ code: 'CM3', from: match, to: a.meaning });
          return matchCase(match, a.meaning);
        }
        if (!record) return match;
        const key = a.term.toLowerCase();
        if (explained.has(key) || whole.slice(offset + match.length).trimStart().startsWith('(')) return match;
        explained.add(key);
        changes.push({ code: 'CM3', from: match, to: `${match} (${a.meaning})` });
        return `${match} (${a.meaning})`;
      });
    }
    return out;
  }

  return {
    changes,
    apply(text) {
      let out = String(text || '');
      if (plain) out = applyPlain(out, true);
      if (abbreviations) out = applyAbbreviations(out, true);
      return out;
    },
    // Same word substitutions without recording; the validator uses it to compare like with like.
    canonical(text) {
      let out = String(text || '');
      if (plain) out = applyPlain(out, false);
      if (abbreviations) out = applyAbbreviations(out, false);
      return out;
    },
    short(sentence, maxWords = 20) {
      if (wordCount(sentence) <= maxWords) return [sentence];
      // Only split where a sentence clearly joins two complete thoughts; splitting a
      // comma-separated list would change its meaning.
      const pieces = sentence.split(/,\s+(?=(?:and|but|so|because)\s+(?:i|you|we|they|it|this|that|he|she|the|please)\b)|;\s+|\s+[-–]\s+/i);
      if (pieces.length < 2 || pieces.some((p) => wordCount(p) < 3)) return [sentence];
      changes.push({ code: 'CM2', from: sentence, to: `${pieces.length} shorter sentences` });
      return pieces.map((p) => asSentence(p.replace(/^and\s+/i, '')));
    },
    explainedTerms: explained,
    glossaryMeanings: glossary.map((g) => g.meaning || '').join(' '),
  };
}
