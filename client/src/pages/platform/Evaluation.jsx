import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CsvUpload } from '../../components/CsvUpload.jsx';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Loading, PageHeader, Stat, TextInput } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api, download } from '../../lib/api.js';
import { fmtDateTime, pct } from '../../lib/format.js';

function RunSummary({ run }) {
  const s = run.summary;
  const [onlyProblems, setOnlyProblems] = useState(true);
  const problems = (c) => c.detectionCorrect === false || c.deadlineCorrect === false || c.stepsCorrect === false || c.validatorCorrect === false || !c.validatorPassed;
  const cases = run.cases.filter((c) => !onlyProblems || problems(c));
  return (
    <Card title={`${run.name} (${fmtDateTime(run.createdAt)})`} actions={<Button variant="secondary" size="small" onClick={() => download(`/api/platform/evaluations/${run._id}/export.csv`, `evaluation-${run._id}.csv`)}>Export CSV</Button>}>
      <div className="stats">
        <Stat label="Test briefs" value={s.cases} />
        <Stat label="Task detection" value={pct(s.detectionAccuracyPct)} hint={`${s.counts.detection} with expected values`} />
        <Stat label="Deadlines correct" value={pct(s.deadlineAccuracyPct)} hint={`${s.counts.deadline} with expected values`} />
        <Stat label="Steps correct" value={pct(s.stepsAccuracyPct)} hint={`${s.counts.steps} with expected values`} />
        <Stat label="Meaning preserved" value={pct(s.meaningPreservedPct)} hint="Engine output passed the validator (plan target 99%)" />
        <Stat label="Validator agrees with expected" value={pct(s.candidateAgreementPct)} hint={`${s.counts.candidates} candidate translations`} />
        <Stat label="Changed meaning held" value={pct(s.heldWhenExpectedPct)} hint={`${s.counts.expectedHolds} seeded cases`} />
        <Stat label="Slowest brief" value={s.maxProcessingMs === null ? '–' : `${s.maxProcessingMs} ms`} hint="Plan target under 10 s" />
      </div>
      <Checkbox label="Show only cases with a problem" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
      {!cases.length ? (
        <p className="muted">No problems found.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Brief</th>
                <th scope="col">Results</th>
                <th scope="col">Translation</th>
              </tr>
            </thead>
            <tbody>
              {cases.slice(0, 300).map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td className="small">{c.text}</td>
                  <td className="small">
                    {c.detectionCorrect !== undefined && <div><Badge tone={c.detectionCorrect ? 'success' : 'danger'}>Detection</Badge></div>}
                    {c.deadlineCorrect !== undefined && <div><Badge tone={c.deadlineCorrect ? 'success' : 'danger'}>Deadline</Badge> {c.deadline ? fmtDateTime(c.deadline) : 'none'}{c.deadlineCorrect ? '' : ` (expected ${c.expectedDeadline ? fmtDateTime(c.expectedDeadline) : 'none'})`}</div>}
                    {c.stepsCorrect !== undefined && <div><Badge tone={c.stepsCorrect ? 'success' : 'danger'}>Steps</Badge> {c.steps}/{c.expectedSteps}</div>}
                    <div><Badge tone={c.validatorPassed ? 'success' : 'warning'}>{c.validatorPassed ? 'Validator passed' : 'Validator held'}</Badge></div>
                    {c.failedChecks?.length > 0 && <div className="check-fail">{c.failedChecks.join('; ')}</div>}
                    {c.validatorCorrect !== undefined && <div><Badge tone={c.validatorCorrect ? 'success' : 'danger'}>Candidate {c.expectedValidator}</Badge></div>}
                  </td>
                  <td><pre className="mail small">{c.translation}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Evaluation() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const runs = useQuery({ queryKey: ['platform', 'evaluations'], queryFn: () => api.get('/api/platform/evaluations'), enabled: isPlatformAdmin });
  const [selected, setSelected] = useState(null);
  const run = useQuery({ queryKey: ['platform', 'evaluation', selected], queryFn: () => api.get(`/api/platform/evaluations/${selected}`), enabled: Boolean(selected) });
  const create = useMutation({
    mutationFn: (csv) => api.post('/api/platform/evaluations', { name: name || undefined, csv }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform', 'evaluations'] });
      setSelected(res.run._id);
    },
  });
  if (!isPlatformAdmin) return <Alert tone="danger">Platform admins only.</Alert>;
  return (
    <>
      <PageHeader title="Evaluation" intro="Run a fixed test set of briefs through the rule engine and the Outcome Validator before each release. The business plan's gate: any fall in the validator pass rate blocks a release." />
      <Card title="Run a test set">
        <TextInput label="Run name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <CsvUpload
          label="Test set CSV"
          hint="Columns: id, brief_text, sent_at, rules (e.g. TS1;TM1;TM2), expected_is_task, expected_deadline (YYYY-MM-DD HH:mm or none), expected_steps, candidate_translation, expected_validator (pass or hold)."
          onUpload={(csv) => create.mutate(csv)}
          busy={create.isPending}
          buttonLabel="Run evaluation"
        />
        <Button variant="ghost" onClick={() => download('/api/platform/evaluations/sample.csv', 'evaluation-test-set.csv')}>Download the sample test set</Button>
        <ErrorAlert error={create.error} />
      </Card>
      {selected && (run.isLoading ? <Loading /> : run.data && <RunSummary run={run.data.run} />)}
      <Card title="Previous runs">
        {runs.isLoading && <Loading />}
        <ul className="list">
          {(runs.data?.runs || []).map((r) => (
            <li key={r._id} className="list-item">
              <span>
                <strong>{r.name}</strong> <span className="muted small">{fmtDateTime(r.createdAt)} · {r.summary.cases} briefs · meaning preserved {pct(r.summary.meaningPreservedPct)} · deadlines {pct(r.summary.deadlineAccuracyPct)}</span>
              </span>
              <Button size="small" variant="secondary" onClick={() => setSelected(r._id)}>View</Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
