import { DateTime } from 'luxon';
import { ENGINE_NAME, translateBrief, validateCandidate } from '../../engine/index.js';
import { getHolidays } from '../../integrations/bankHolidays.js';
import { EvaluationRun } from '../../models/index.js';
import { parseCsv } from '../../utils/csv.js';
import { badRequest } from '../../utils/http.js';

const TZ = 'Europe/London';
const truthy = (v) => /^(?:1|y|yes|true|task)$/i.test(String(v).trim());
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

function parseExpected(value) {
  const v = String(value || '').trim();
  if (!v || /^none$/i.test(v)) return null;
  let dt = DateTime.fromISO(v, { zone: TZ });
  if (!dt.isValid) dt = DateTime.fromFormat(v, 'yyyy-MM-dd HH:mm', { zone: TZ });
  if (!dt.isValid) dt = DateTime.fromFormat(v, 'dd/MM/yyyy HH:mm', { zone: TZ });
  return dt.isValid ? dt : undefined;
}

const sameMinute = (a, b) => (!a && !b) || (a && b && Math.abs(Date.parse(a) - Date.parse(b)) < 60000);

/**
 * Runs a test set through the engine and the Outcome Validator.
 * CSV columns: id, brief_text (required), sent_at, rules (e.g. "TS1;TM1;TM2"),
 * expected_is_task, expected_deadline, expected_steps, candidate_translation,
 * expected_validator (pass | hold).
 */
export async function runEvaluation({ name, csv, user }) {
  const rows = parseCsv(csv, { required: ['brief_text'] });
  if (rows.length > 1000) throw badRequest('Please use at most 1000 test briefs per run');
  const holidays = await getHolidays('england-and-wales');
  const org = { settings: { timezone: TZ } };
  const cases = [];
  const ruleUsage = {};

  for (const [i, row] of rows.entries()) {
    const sentAt = row.sent_at ? new Date(row.sent_at) : new Date();
    const at = Number.isNaN(sentAt.getTime()) ? new Date() : sentAt;
    const rules = String(row.rules || 'TS1;TM1;TM2')
      .split(/[;|,\s]+/)
      .filter(Boolean)
      .map((code) => ({ code: code.toUpperCase() }));
    const input = { text: row.brief_text, sentAt: at, rules, org, holidays, managerName: row.manager_name || 'your manager', employeeName: row.employee_name || undefined };
    const detected = translateBrief({ ...input, forceTask: false });
    const result = detected.isTask ? detected : translateBrief({ ...input, forceTask: true });
    const c = {
      id: row.id || String(i + 1),
      text: row.brief_text.slice(0, 400),
      rules: rules.map((r) => r.code),
      isTask: detected.isTask,
      processingMs: result.processingMs,
      validatorPassed: result.validator.passed,
      failedChecks: result.validator.checks.filter((x) => !x.passed).map((x) => `${x.key}: ${x.detail}`),
      deadline: result.summaries?.[0]?.deadline || null,
      steps: result.summaries?.[0]?.steps?.length ?? 0,
      translation: result.text.slice(0, 2000),
    };
    for (const r of result.appliedRules) ruleUsage[r.code] = (ruleUsage[r.code] || 0) + 1;
    if (row.expected_is_task) {
      c.expectedIsTask = truthy(row.expected_is_task);
      c.detectionCorrect = c.expectedIsTask === detected.isTask;
    }
    // Deadlines and steps are only scored for briefs that are meant to be tasks.
    const scoreTranslation = c.expectedIsTask !== false;
    if (scoreTranslation && row.expected_deadline !== undefined && String(row.expected_deadline).trim() !== '') {
      const expected = parseExpected(row.expected_deadline);
      if (expected !== undefined) {
        c.expectedDeadline = expected ? expected.toISO() : null;
        c.deadlineCorrect = Boolean(sameMinute(c.deadline, c.expectedDeadline));
      }
    }
    if (scoreTranslation && row.expected_steps !== undefined && String(row.expected_steps).trim() !== '') {
      c.expectedSteps = Number(row.expected_steps);
      c.stepsCorrect = c.steps === c.expectedSteps;
    }
    if (row.candidate_translation) {
      const v = validateCandidate({ sourceText: row.brief_text, candidateText: row.candidate_translation, sentAt: at, org, holidays, managerName: row.manager_name });
      c.candidatePassed = v.passed;
      c.candidateFailedChecks = v.checks.filter((x) => !x.passed).map((x) => `${x.key}: ${x.detail}`);
      if (row.expected_validator) {
        c.expectedValidator = /^h/i.test(row.expected_validator) ? 'hold' : 'pass';
        c.validatorCorrect = (c.expectedValidator === 'pass') === v.passed;
      }
    }
    cases.push(c);
  }

  const withDetect = cases.filter((c) => c.detectionCorrect !== undefined);
  const withDeadline = cases.filter((c) => c.deadlineCorrect !== undefined);
  const withSteps = cases.filter((c) => c.stepsCorrect !== undefined);
  const withCandidate = cases.filter((c) => c.validatorCorrect !== undefined);
  const expectedHolds = withCandidate.filter((c) => c.expectedValidator === 'hold');
  const times = cases.map((c) => c.processingMs);
  const summary = {
    cases: cases.length,
    detectionAccuracyPct: pct(withDetect.filter((c) => c.detectionCorrect).length, withDetect.length),
    deadlineAccuracyPct: pct(withDeadline.filter((c) => c.deadlineCorrect).length, withDeadline.length),
    stepsAccuracyPct: pct(withSteps.filter((c) => c.stepsCorrect).length, withSteps.length),
    meaningPreservedPct: pct(cases.filter((c) => c.validatorPassed).length, cases.length),
    candidateAgreementPct: pct(withCandidate.filter((c) => c.validatorCorrect).length, withCandidate.length),
    heldWhenExpectedPct: pct(expectedHolds.filter((c) => c.candidatePassed === false).length, expectedHolds.length),
    avgProcessingMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    maxProcessingMs: times.length ? Math.max(...times) : null,
    under10sPct: pct(times.filter((t) => t < 10000).length, times.length),
    ruleUsage,
    counts: { detection: withDetect.length, deadline: withDeadline.length, steps: withSteps.length, candidates: withCandidate.length, expectedHolds: expectedHolds.length },
  };
  return EvaluationRun.create({ name: name || `Evaluation ${new Date().toISOString().slice(0, 16)}`, createdBy: user._id, engine: ENGINE_NAME, summary, cases });
}
