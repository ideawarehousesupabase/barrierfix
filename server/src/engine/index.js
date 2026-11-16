import { DateTime } from 'luxon';
import { analyseBrief } from './analyse.js';
import { breakdownTask } from './breakdown.js';
import { createCalendar } from './calendar.js';
import { normaliseRules } from './catalog.js';
import { findDateMentions } from './dates.js';
import { detectTask } from './detect.js';
import { applyOverrides, findMissing } from './missing.js';
import { detectPriority } from './priority.js';
import { renderTranslation } from './render.js';
import { outputFromBlocks, outputFromText, validate } from './validator.js';

// The rule-based engine stands in for the AI in the MVP. Anything that can translate
// a brief (a future LLM translator included) must implement this same shape.
export const ENGINE_NAME = 'rule-engine-v1';

export function buildContext({ sentAt, org = {}, holidays = new Set(), managerName, employeeName, recipientNames = [] }) {
  const settings = org.settings || {};
  const cal = createCalendar({
    timezone: settings.timezone || 'Europe/London',
    workdayStart: settings.workdayStart || '09:00',
    workdayEnd: settings.workdayEnd || '17:00',
    workingDays: settings.workingDays?.length ? settings.workingDays : [1, 2, 3, 4, 5],
    holidays,
  });
  const now = DateTime.fromJSDate(sentAt ? new Date(sentAt) : new Date(), { zone: cal.timezone });
  const firstName = (n) => (n ? String(n).trim().split(/\s+/)[0] : null);
  return {
    cal,
    now,
    managerName: managerName || null,
    employeeName: employeeName || null,
    recipientNames: [...new Set([employeeName, firstName(employeeName), ...recipientNames].filter(Boolean))],
    glossary: org.glossary || [],
  };
}

const serialiseTask = (t) => ({
  index: t.index,
  title: t.title,
  titleNoDeadline: t.titleNoDeadline,
  deliverable: t.deliverable,
  steps: t.steps,
  notes: t.notes,
  deadline: t.deadline ? { at: t.deadline.dt.toISO(), phrase: t.deadline.phrase, confidence: t.deadline.confidence, timeAssumed: Boolean(t.deadline.timeAssumed) } : null,
  vague: t.vague,
});

/**
 * Translates one brief for one employee.
 * input: { text, sentAt, rules: [{ code, params }], org, holidays, managerName, employeeName, recipientNames, forceTask,
 *          priority (chosen by the manager), overrides: { deadlineDate, deadlineTime } (fill gaps only) }
 * The result's `missing` lists anything the employee's profile requires that the brief does not say.
 */
export function translateBrief(input) {
  const started = performance.now();
  const ctx = buildContext(input);
  const rules = normaliseRules(input.rules);
  const analysis = analyseBrief(input.text, ctx);
  const detection = detectTask(analysis, ctx);
  const isTask = Boolean(input.forceTask) || detection.isTask;
  if (!isTask || !analysis.tasks.length) {
    return { engine: ENGINE_NAME, isTask: false, detection, processingMs: Math.round(performance.now() - started) };
  }

  applyOverrides(analysis, input.overrides, ctx);
  const priority = input.priority || detectPriority(input.text);
  analysis.priority = priority;
  const missing = findMissing({ analysis, rules, priority });

  const rendered = renderTranslation(analysis, rules, ctx);
  const validator = validate({
    analysis,
    output: outputFromBlocks(rendered.blocks),
    ctx,
    canonical: (t) => rendered.transformer.canonical(t),
    allowlist: [ctx.managerName, ctx.employeeName, rendered.transformer.glossaryMeanings].filter(Boolean).join(' '),
  });

  const confidences = rendered.blocks.map((b) => b.summary.deadlineConfidence).filter(Boolean);
  const confidence = confidences.includes('low') ? 'low' : confidences.includes('medium') ? 'medium' : 'high';

  return {
    engine: ENGINE_NAME,
    isTask: true,
    detection,
    tasks: analysis.tasks.map(serialiseTask),
    summaries: rendered.blocks.map((b) => b.summary),
    cards: rendered.cards,
    text: rendered.text,
    appliedRules: rendered.appliedRules,
    checkedRules: rendered.checkedRules,
    changes: rendered.changes,
    schedule: rendered.schedule,
    priority,
    missing,
    validator,
    confidence,
    processingMs: Math.round(performance.now() - started),
  };
}

// Validates any candidate translation text against a source brief (used by the
// evaluation harness, and ready for checking AI output once that is added).
export function validateCandidate({ sourceText, candidateText, sentAt, org, holidays, managerName, employeeName }) {
  const ctx = buildContext({ sentAt, org, holidays, managerName, employeeName });
  const analysis = analyseBrief(sourceText, ctx);
  const { output, hasDue } = outputFromText(candidateText);
  if (hasDue) analysis.tasks.forEach((t) => output.dueShownTasks.add(t.index));
  for (const f of output.ruleFields) {
    const m = findDateMentions(f.text, ctx)[0];
    if (m && f.key !== 'due') f.value = m.dt.toISO();
  }
  return validate({ analysis, output, ctx, allowlist: [managerName, employeeName].filter(Boolean).join(' ') });
}

export function breakdownBrief(summary, { sentAt, org, holidays }) {
  const ctx = buildContext({ sentAt: sentAt || new Date(), org, holidays });
  return breakdownTask(summary, ctx);
}

export { analyseBrief, buildContext as engineContext };
