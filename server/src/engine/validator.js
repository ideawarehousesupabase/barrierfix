import { findDateMentions } from './dates.js';
import { NEGATION } from './lexicon.js';
import { stripLead } from './analyse.js';
import { formatDateTime } from './calendar.js';
import { contentWords, normWord, wordsOf } from './text.js';

// Phrases that contain "not"/"no" but are not negative instructions.
const NEUTRAL_NEGATIONS = /\b(?:don'?t|do not) forget(?: to)?\b|\bno (?:worries|problem|probs|rush)\b|\bnot a problem\b/gi;
// Words that only frame a request ("I need you to", "make sure you") and are dropped by design.
const FRAMING_WORDS = new Set(['need', 'needs', 'want', 'like', 'able', 'possible', 'forget', 'remember', 'sure', 'make', 'try', 'kindly', 'would', 'great', 'ideal', 'helpful', 'wondering', 'mind']);
const LINK_OR_HANDLE = /https?:\/\/[^\s<>()]+|[\w.+-]+@[\w-]+\.[\w.-]+|@[\w.-]+/g;

const countNegations = (text) => (String(text).replace(NEUTRAL_NEGATIONS, ' ').match(NEGATION) || []).length;

// Names, numbers, links and handles: the facts a translation must neither lose nor invent.
export function significantTokens(pieces) {
  const out = new Set();
  for (const piece of pieces) {
    const p = String(piece || '');
    for (const m of p.matchAll(LINK_OR_HANDLE)) out.add(m[0].toLowerCase().replace(/[.,;:!?)]+$/, ''));
    const rest = p.replace(LINK_OR_HANDLE, ' ');
    for (const sentence of rest.split(/(?<=[.!?:])\s+|\n+/)) {
      wordsOf(sentence).forEach((w, i) => {
        const clean = w.replace(/'s$/, '').replace(/[.,;:!?]+$/, '');
        if (!clean) return;
        if (/\d/.test(clean)) out.add(clean.toLowerCase());
        else if (/^[A-Z]{2,}$/.test(clean)) out.add(clean.toLowerCase());
        else if (i > 0 && /^[A-Z][a-z]/.test(clean)) out.add(clean.toLowerCase());
      });
    }
  }
  return out;
}

function maskPhrases(text, phrases) {
  let out = String(text);
  for (const p of phrases.filter(Boolean)) {
    const i = out.toLowerCase().indexOf(p.toLowerCase());
    if (i >= 0) out = `${out.slice(0, i)} ${' '.repeat(p.length)} ${out.slice(i + p.length)}`;
  }
  return out;
}

const wordSet = (pieces) => new Set(pieces.flatMap((p) => wordsOf(p).map(normWord)));
const hasToken = (set, rawLower, token) => set.has(token) || rawLower.includes(token);
const check = (key, label, passed, detail = '') => ({ key, label, passed, detail: passed ? '' : detail });

/**
 * Outcome Validator. Compares the source brief with what will be delivered:
 * goal, deadline and deliverable unchanged, nothing lost, nothing invented.
 *
 * output = { content: [...], derived: [...], ruleFields: [{ key, text, value, taskIndex }], dueShownTasks: Set }
 */
export function validate({ analysis, output, ctx, canonical = (t) => t, allowlist = '' }) {
  const checks = [];
  const tasks = analysis.tasks;
  const maskedPhrases = tasks.filter((t) => output.dueShownTasks.has(t.index) && t.deadline).map((t) => t.deadline.phrase || t.deadline.text);
  const sourceMasked = maskPhrases(analysis.text, maskedPhrases);
  const deliverablePieces = [...output.content, ...output.derived];
  const outWords = wordSet(deliverablePieces.map(canonical).concat(deliverablePieces));
  const outLower = deliverablePieces.join('\n').toLowerCase();
  const everythingOut = [...deliverablePieces, ...output.ruleFields.map((f) => f.text)].join('\n');

  // 1. Goal: the main instruction of each task survives.
  const goalMisses = [];
  for (const t of tasks) {
    const goal = output.dueShownTasks.has(t.index) ? t.titleNoDeadline : t.title;
    const words = contentWords(canonical(goal)).filter((w) => !FRAMING_WORDS.has(w));
    const missing = words.filter((w) => !outWords.has(w));
    if (words.length && missing.length > Math.floor(words.length * 0.1)) goalMisses.push(`"${goal}" (missing: ${missing.join(', ')})`);
  }
  checks.push(check('goal', 'Goal unchanged', goalMisses.length === 0, `The main request changed: ${goalMisses.join('; ')}`));

  // 2. Deadline: the same moment in time appears in the output.
  const outMentions = findDateMentions(everythingOut, ctx);
  const deadlineIssues = [];
  for (const t of tasks) {
    if (t.deadline) {
      const ms = t.deadline.dt.toMillis();
      if (!outMentions.some((m) => Math.abs(m.dt.toMillis() - ms) < 60000)) deadlineIssues.push(`expected ${formatDateTime(t.deadline.dt, ctx.now)}`);
    } else if (t.vague && !everythingOut.toLowerCase().includes(t.vague.toLowerCase())) {
      deadlineIssues.push(`"${t.vague}" was dropped`);
    }
  }
  checks.push(check('deadline', 'Deadline unchanged', deadlineIssues.length === 0, `The deadline is missing or different: ${deadlineIssues.join('; ')}`));

  // 3. Deliverable: what has to be produced is still named.
  const deliverableMisses = [];
  for (const t of tasks) {
    if (!t.deliverable) continue;
    const missing = contentWords(canonical(t.deliverable)).filter((w) => !outWords.has(w));
    if (missing.length) deliverableMisses.push(`"${t.deliverable}" (missing: ${missing.join(', ')})`);
  }
  checks.push(check('deliverable', 'Deliverable unchanged', deliverableMisses.length === 0, `The deliverable changed: ${deliverableMisses.join('; ')}`));

  // 4. Every name, number, link and handle from the brief is still there.
  const recipient = new Set((ctx.recipientNames || []).flatMap((n) => wordsOf(n).map((w) => w.toLowerCase())));
  const sourceTokens = [...significantTokens([sourceMasked])].filter((tok) => !recipient.has(tok.replace(/^@/, '')));
  const lost = sourceTokens.filter((tok) => !hasToken(outWords, outLower, tok));
  checks.push(check('entities', 'Names, links and numbers kept', lost.length === 0, `Missing from the translation: ${lost.join(', ')}`));

  // 5. Nothing new: no names, numbers, links or dates the brief did not contain.
  const sourceWords = wordSet([analysis.text]);
  const sourceLower = `${analysis.text}\n${allowlist}`.toLowerCase();
  const added = [...significantTokens(deliverablePieces)].filter((tok) => !hasToken(sourceWords, sourceLower, tok));
  const sourceMentions = analysis.mentions;
  const contentMentions = findDateMentions(deliverablePieces.join('\n'), ctx);
  const newDates = contentMentions.filter((m) => !sourceMentions.some((s) => Math.abs(s.dt.toMillis() - m.dt.toMillis()) < 60000));
  const addedAll = [...added, ...newDates.map((m) => `date "${m.text}"`)];
  checks.push(check('no_new_facts', 'Nothing new added', addedAll.length === 0, `Not in the original brief: ${addedAll.join(', ')}`));

  // 6. Negatives ("don't", "not", "never") are neither lost nor added.
  const sourceNeg = tasks.reduce((sum, t) => sum + t.sourceUnits.filter((u) => !t.pleasantries.includes(u)).reduce((s, u) => s + countNegations(u), 0), 0);
  const outNeg = output.content.reduce((s, p) => s + countNegations(p), 0);
  checks.push(check('negation', 'Negatives kept', sourceNeg === outNeg, `The original has ${sourceNeg} negative word(s), the translation has ${outNeg}`));

  // 7. No instruction or detail left out.
  const dropped = [];
  for (const t of tasks) {
    for (const unit of t.sourceUnits) {
      if (t.pleasantries.includes(unit)) continue;
      const masked = output.dueShownTasks.has(t.index) && t.deadline ? maskPhrases(unit, [t.deadline.phrase, t.deadline.text]) : unit;
      const words = contentWords(canonical(stripLead(masked, ctx))).filter((w) => !FRAMING_WORDS.has(w));
      if (!words.length) continue;
      const missing = words.filter((w) => !outWords.has(w));
      if (missing.length > 1 && missing.length / words.length > 0.3) dropped.push(`"${unit}"`);
    }
  }
  checks.push(check('coverage', 'No instruction left out', dropped.length === 0, `Parts of the brief are missing: ${dropped.join('; ')}`));

  // 8. Check-ins and reminders fall after now and before the deadline.
  const timingIssues = [];
  for (const f of output.ruleFields.filter((x) => ['checkin', 'reminder'].includes(x.key) && x.value)) {
    const t = tasks[f.taskIndex];
    const at = Date.parse(f.value);
    if (t?.deadline && at >= t.deadline.dt.toMillis()) timingIssues.push(`${f.key} is not before the deadline`);
    if (at < ctx.now.toMillis() - 60000) timingIssues.push(`${f.key} is in the past`);
  }
  checks.push(check('timing', 'Check-ins fall before the deadline', timingIssues.length === 0, timingIssues.join('; ')));

  return { passed: checks.every((c) => c.passed), checks };
}

// Collects validator input from rendered blocks.
export function outputFromBlocks(blocks) {
  const output = { content: [], derived: [], ruleFields: [], dueShownTasks: new Set() };
  for (const b of blocks) {
    if (b.dueShown) output.dueShownTasks.add(b.index);
    for (const s of b.sections) {
      if (s.origin === 'content') {
        if (s.type === 'field') output.content.push(s.text);
        else if (s.items) output.content.push(...s.items);
      } else if (s.origin === 'derived') output.derived.push(s.text);
      else if (s.origin === 'rule') output.ruleFields.push({ key: s.key, text: s.text, value: s.value, taskIndex: b.index });
    }
  }
  return output;
}

// Parses free text (e.g. a candidate translation from a test-set CSV) into validator input.
export function outputFromText(text) {
  const output = { content: [], derived: [], ruleFields: [], dueShownTasks: new Set() };
  let hasDue = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\*/g, '').trim();
    if (!line || /^task \d+ of \d+$/i.test(line) || /^(?:note|steps|details)\s*:?\s*$/i.test(line)) continue;
    const field = line.match(/^(due|check-in|checkin|reminder|done when|task|steps|details|note)\s*:\s*(.*)$/i);
    const body = field ? field[2] : line.replace(/^\s*\d{1,2}[.)]\s+/, '');
    const label = field ? field[1].toLowerCase() : '';
    if (label === 'due') {
      hasDue = true;
      output.ruleFields.push({ key: 'due', text: body, value: null, taskIndex: 0 });
    } else if (label === 'check-in' || label === 'checkin') output.ruleFields.push({ key: 'checkin', text: body, value: null, taskIndex: 0 });
    else if (label === 'reminder') output.ruleFields.push({ key: 'reminder', text: body, value: null, taskIndex: 0 });
    else if (label === 'done when') output.derived.push(body);
    else if (label === 'note') continue;
    else if (body) output.content.push(body);
  }
  return { output, hasDue };
}
