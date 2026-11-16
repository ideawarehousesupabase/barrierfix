import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const { EvaluationRun } = await import('../src/models/index.js');
EvaluationRun.create = async (doc) => doc; // scored in memory, nothing saved
const { runEvaluation } = await import('../src/modules/platform/evaluation.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const csv = fs.readFileSync(path.join(here, '../../samples/evaluation-test-set.csv'), 'utf8');

// The business plan's release gate: any fall in the validator pass rate blocks a release.
test('release gate: the sample test set keeps its scores', async () => {
  const { summary, cases } = await runEvaluation({ name: 'release gate', csv, user: { _id: null } });
  const failures = cases.filter((c) => c.detectionCorrect === false || c.deadlineCorrect === false || c.stepsCorrect === false || c.validatorCorrect === false || !c.validatorPassed);
  assert.equal(summary.meaningPreservedPct, 100, 'engine output must always pass the Outcome Validator');
  assert.equal(summary.heldWhenExpectedPct, 100, 'every seeded change of meaning must be held');
  assert.equal(summary.candidateAgreementPct, 100);
  assert.equal(summary.detectionAccuracyPct, 100);
  assert.ok(summary.deadlineAccuracyPct >= 95, `deadline accuracy ${summary.deadlineAccuracyPct}%`);
  assert.ok(summary.under10sPct === 100, 'every brief within the 10-second target');
  assert.deepEqual(failures.map((c) => c.id), []);
});
