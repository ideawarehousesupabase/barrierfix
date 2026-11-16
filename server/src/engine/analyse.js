import {
  IRREGULAR_PARTICIPLES,
  LEADING_CONNECTOR,
  NEGATION,
  NEW_TASK_MARKER,
  PARTICLES,
  PLEASANTRY_ONLY,
  REQUEST_PATTERNS,
  REQUEST_WRAPPER,
  VERB_FOLLOWERS,
  WORK_VERBS,
} from './lexicon.js';
import { asSentence, capitalise, escapeRegExp, normaliseText, splitUnits, stripEndPunctuation, tidy, wordsOf } from './text.js';
import { findDateMentions, findVagueDeadline, pickDeadline } from './dates.js';

const GREETING = /^(?:hi|hey|hello|hiya|morning|good morning|afternoon|good afternoon|evening|good evening)\b[\s,!.-]*/i;
const CONDITIONAL_START = /^(?:if|when|once|after|before|unless|as soon as|while|whilst)\b/i;
const DELIVERABLE_BOUNDARY = new Set(['for', 'by', 'before', 'to', 'with', 'from', 'on', 'at', 'in', 'until', 'so', 'and', 'because', 'using', 'via', 'ahead', 'which', 'that', 'if', 'when', 'into', 'onto']);

export const hasNegation = (text) => (String(text).match(NEGATION) || []).length > 0;
export const isRequest = (text) => REQUEST_PATTERNS.some((re) => re.test(text));

function recipientPrefix(names = []) {
  const parts = names.filter(Boolean).map((n) => escapeRegExp(n));
  return parts.length ? new RegExp(`^@?(?:${parts.join('|')})\\b[\\s,:!.-]*`, 'i') : null;
}

// Removes greetings, the recipient's name and leading connectors ("and", "then").
export function stripLead(text, ctx = {}) {
  let t = String(text).trim();
  const recipient = recipientPrefix(ctx.recipientNames);
  for (let i = 0; i < 3; i += 1) {
    const before = t;
    t = t.replace(GREETING, '');
    if (recipient) t = t.replace(recipient, '');
    t = t.replace(LEADING_CONNECTOR, '');
    t = t.replace(/^(?:please|pls|plz|kindly)\b[\s,]*/i, '');
    if (t === before) break;
  }
  return t.trim();
}

// Only the greeting and the recipient's name ("Hi Jordan, ..."), for prose output.
export function stripGreeting(text, ctx = {}) {
  let t = String(text).trim();
  const recipient = recipientPrefix(ctx.recipientNames);
  for (let i = 0; i < 2; i += 1) {
    const before = t;
    t = t.replace(GREETING, '');
    if (recipient) t = t.replace(recipient, '');
    if (t === before) break;
  }
  return capitalise(t.trim());
}

export function startsWithInstruction(text, ctx = {}) {
  // "Don't send it yet" is an instruction too.
  const t = stripLead(text, ctx).replace(REQUEST_WRAPPER, '').replace(/^(?:don'?t|do not|never)\s+/i, '');
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (/:$/.test(words[0])) return false;
  const first = words[0].toLowerCase().replace(/[^a-z'-]/g, '');
  if (!WORK_VERBS.has(first)) return false;
  if (words.length === 1) return true;
  const second = words[1];
  const secondNorm = second.toLowerCase().replace(/[^a-z0-9'@#£$-]/g, '');
  // "leave comments", "send updates": a plural noun straight after the verb.
  const pluralObject = /^[a-z]{3,}s$/.test(secondNorm) && !NOT_PLURAL_OBJECTS.has(secondNorm);
  return VERB_FOLLOWERS.has(secondNorm) || PARTICLES.has(secondNorm) || pluralObject || UNCOUNTABLE_OBJECTS.has(secondNorm) || /^[A-Z@#£$\d"'(]/.test(second);
}

const NOT_PLURAL_OBJECTS = new Set(['this', 'thus', 'unless', 'always', 'perhaps', 'yours', 'ours', 'theirs', 'hers', 'his', 'its', 'was', 'has', 'does', 'goes', 'less', 'across', 'whereas', 'as']);
const UNCOUNTABLE_OBJECTS = new Set(['feedback', 'information', 'data', 'advice', 'access', 'approval', 'sign-off', 'permission', 'budget', 'stock', 'payment', 'everyone']);

// Splits "Use last quarter's as a base, add the new numbers and flag anything for Sam"
// into three instructions, but leaves "the deck, report and notes" alone.
export function splitClauses(sentence) {
  const parts = [];
  const re = /\s*;\s*|,?\s+(?:and\s+)?then\s+|,\s*and\s+|,\s+|\s+and\s+/gi;
  let last = 0;
  let m;
  while ((m = re.exec(sentence))) {
    const left = sentence.slice(last, m.index);
    const after = sentence.slice(m.index + m[0].length);
    const separator = m[0];
    const semicolon = separator.includes(';');
    const then = /then/i.test(separator);
    if (!after.trim()) continue;
    if ((left.match(/\(/g) || []).length > (left.match(/\)/g) || []).length) continue;
    if (CONDITIONAL_START.test(left.trim())) continue;
    if (!semicolon && !then && !startsWithInstruction(after)) continue;
    if (!semicolon && wordsOf(left).length < 2) continue;
    parts.push(left);
    last = m.index + m[0].length;
  }
  parts.push(sentence.slice(last));
  return parts.map((p) => tidy(p)).filter(Boolean);
}

// "Can you pull together the deck, thanks?" -> "Pull together the deck"
export function cleanInstruction(text, ctx = {}) {
  let t = stripLead(text, ctx);
  t = t.replace(REQUEST_WRAPPER, '');
  t = t.replace(/[\s,]*\b(?:please|pls|plz)\b(?=[\s,?.!]*$)/i, '');
  t = t.replace(/[\s,-]*(?:thanks|thank you|thanks so much|many thanks|cheers|ta)(?:\s+\w+)?[\s!.]*$/i, '');
  // An intro line such as "Before the launch, can you:" keeps only its context.
  t = t.replace(/[\s,]*(?:(?:can|could|would|will) you(?:\s+please)?|please)\s*:?\s*$/i, '').replace(/:\s*$/, '');
  t = stripEndPunctuation(t);
  return capitalise(tidy(t));
}

function participle(verb) {
  const v = verb.toLowerCase();
  if (IRREGULAR_PARTICIPLES[v]) return IRREGULAR_PARTICIPLES[v];
  if (v.endsWith('e')) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  const vowelGroups = (v.match(/[aeiou]+/g) || []).length;
  if (vowelGroups === 1 && /[^aeiou][aeiou][^aeiouwxy]$/.test(v)) return `${v}${v.slice(-1)}ed`;
  return `${v}ed`;
}

// "Check the numbers and update the deck" -> "you have checked the numbers and updated the deck"
export function doneLineFor(title) {
  const words = String(title).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const verb = words[0].toLowerCase();
  if (!WORK_VERBS.has(verb) || hasNegation(title)) return null;
  const parts = String(title).split(/(,\s*and\s+|\s+and\s+|,\s+)/);
  const converted = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    const [first, ...rest] = part.split(/\s+/);
    if (i === 0 || (WORK_VERBS.has(first.toLowerCase()) && startsWithInstruction(part))) {
      return [participle(first), ...rest].join(' ');
    }
    return part;
  });
  return `you have ${converted.join('')}`.trim();
}

export function deliverableOf(title) {
  const words = String(title).split(/\s+/).filter(Boolean);
  if (!words.length || !WORK_VERBS.has(words[0].toLowerCase())) return null;
  let i = 1;
  while (i < words.length && PARTICLES.has(words[i].toLowerCase())) i += 1;
  const rest = [];
  for (; i < words.length; i += 1) {
    const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
    if (rest.length && DELIVERABLE_BOUNDARY.has(w)) break;
    rest.push(words[i]);
  }
  return tidy(rest.join(' ')) || null;
}

export function removeDeadlinePhrase(text, deadline) {
  if (!deadline) return text;
  const re = new RegExp(
    `(?:\\s*,)?\\s*(?:(?:by|before|due|until|till|no later than|for|latest|on|at)\\s+)?(?:the\\s+)?(?:end of\\s+)?${escapeRegExp(deadline.text)}`,
    'i',
  );
  const out = tidy(String(text).replace(re, ''));
  return out.replace(/\s+(?:and|or|by|on|at|for)$/i, '').trim();
}

function segmentUnits(units, ctx) {
  const segments = [];
  let current = null;
  for (const u of units) {
    const lead = stripLead(u.text, ctx);
    const marker = NEW_TASK_MARKER.test(lead);
    const request = isRequest(u.text);
    if (!current || (u.kind !== 'item' && current.hasRequest && (request || (marker && startsWithInstruction(lead.replace(NEW_TASK_MARKER, ''), ctx))))) {
      current = { units: [], hasRequest: false };
      segments.push(current);
    }
    current.units.push(u);
    if (request || startsWithInstruction(u.text, ctx)) current.hasRequest = true;
  }
  return segments;
}

function classifyClause(text, ctx) {
  if (isRequest(text)) return 'request';
  if (startsWithInstruction(text, ctx)) return 'action';
  return 'info';
}

function buildTask(segment, index, text, mentions, ctx, nextStart) {
  const from = segment.units[0].start;
  const to = nextStart ?? Infinity;
  const clauses = [];
  const pleasantries = [];
  for (const u of segment.units) {
    const stripped = stripLead(u.text, ctx);
    if (!stripped || PLEASANTRY_ONLY.test(u.text.trim()) || PLEASANTRY_ONLY.test(stripped)) {
      pleasantries.push(u.text);
      continue;
    }
    const pieces = u.kind === 'item' ? [u.text] : splitClauses(u.text);
    for (const p of pieces) clauses.push({ text: p, unit: u, kind: u.kind === 'item' ? 'item' : classifyClause(p, ctx) });
  }

  const main = clauses.find((c) => c.kind === 'request') || clauses.find((c) => c.kind === 'action') || clauses[0] || null;
  const deadline = pickDeadline(mentions, { from, to });
  const vagueMonth = mentions.find((x) => x.index >= from && x.index < to && x.kind === 'vague');
  const vague = deadline ? null : vagueMonth?.phrase || findVagueDeadline(text.slice(from, Number.isFinite(to) ? to : undefined));

  // "Can you check the numbers and update the deck?" keeps the whole sentence as the
  // task and lists each instruction as a step.
  const mainClauses = main ? clauses.filter((c) => c.unit === main.unit) : [];
  const mainActions = mainClauses.filter((c) => c.kind !== 'info');
  // When the main sentence holds several instructions, each one is also a step.
  const splitMain = Boolean(main && main.kind !== 'item' && mainActions.length > 1);
  // A short compound request stays whole as the task; a long one (or one with a
  // leading phrase such as "By next Friday,") is headed by its main clause.
  const keepWhole = splitMain && mainClauses.length === mainActions.length && mainClauses.length <= 2 && wordsOf(main.unit.text).length <= 16;
  const mainText = main ? (keepWhole ? main.unit.text : main.text) : '';
  const title = main ? cleanInstruction(mainText, ctx) : '';
  const titleIsInstruction = startsWithInstruction(title, ctx);
  const deadlineInTitle = Boolean(deadline && mainText.toLowerCase().includes(deadline.text.toLowerCase()));
  const titleNoDeadline = deadlineInTitle && titleIsInstruction ? capitalise(removeDeadlinePhrase(title, deadline)) : title;

  const steps = [];
  const notes = [];
  for (const c of clauses) {
    if (c === main && !splitMain) continue;
    if (c.kind === 'request' || c.kind === 'action' || c.kind === 'item') steps.push(asSentence(cleanInstruction(c.text, ctx)));
    else notes.push(asSentence(stripLead(c.text, ctx)));
  }

  return {
    index,
    range: { from, to: Number.isFinite(to) ? to : text.length },
    sourceUnits: segment.units.map((u) => u.text),
    pleasantries,
    mainText,
    title,
    titleNoDeadline,
    titleIsInstruction,
    deadlineInTitle,
    deliverable: deliverableOf(titleNoDeadline),
    steps: steps.filter(Boolean),
    notes: notes.filter(Boolean),
    deadline,
    vague,
    negated: hasNegation(title),
  };
}

export function analyseBrief(rawText, ctx) {
  const text = normaliseText(rawText);
  const units = splitUnits(text);
  const mentions = findDateMentions(text, ctx);
  const segments = segmentUnits(units, ctx).filter((s) => s.units.length);
  const tasks = segments.map((seg, i) => buildTask(seg, i, text, mentions, ctx, segments[i + 1]?.units[0]?.start));
  return { text, units, mentions, tasks };
}
