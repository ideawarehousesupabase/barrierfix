import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MedicalWarning } from '../components/MedicalWarning.jsx';
import { Button, Card, Empty, ErrorAlert, Loading, PageHeader, RadioGroup, TextArea, useToast } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';

function ReviewForm({ review, questions, onDone }) {
  const part = review.myPart;
  const qs = questions[part];
  const [answers, setAnswers] = useState({});
  const [comment, setComment] = useState('');
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.post(`/api/reviews/${review._id}/answer`, { [part]: { ...answers, comment } }),
    onSuccess: () => {
      toast('Thank you. Your answers were saved.');
      onDone();
    },
  });
  const complete = qs.every((q) => answers[q.key]);
  return (
    <form className="card inset" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h3>
        {review.stageWeeks}-week review: {review.ruleName}
        {part === 'manager' && <span className="muted"> for {review.employeeName}</span>}
      </h3>
      {qs.map((q) => (
        <RadioGroup key={q.key} legend={q.text} inline value={answers[q.key]} onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} options={q.options} />
      ))}
      <TextArea label="Anything else? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      <MedicalWarning text={comment} />
      <ErrorAlert error={save.error} />
      <Button type="submit" busy={save.isPending} disabled={!complete}>Save answers</Button>
    </form>
  );
}

export default function Reviews() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['reviews'], queryFn: () => api.get('/api/reviews') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['reviews'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return (
    <>
      <PageHeader title="Reviews" intro="Short check-ins at 2, 6 and 12 weeks after an adjustment is agreed, so adjustments that are not working get changed rather than forgotten." />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <>
          <Card title="Waiting for your answers">
            {data.open.length ? <div className="stack">{data.open.map((r) => <ReviewForm key={r._id} review={r} questions={data.questions} onDone={refresh} />)}</div> : <Empty>Nothing to answer right now.</Empty>}
          </Card>
          <Card title="Coming up">
            {data.upcoming.length ? (
              <ul>
                {data.upcoming.map((r) => (
                  <li key={r._id}>
                    {fmtDate(r.dueAt)}: {r.stageWeeks}-week review of {r.ruleName}{r.myPart === 'manager' && r.employeeName ? ` (${r.employeeName})` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No reviews scheduled.</p>
            )}
          </Card>
          {data.recent.length > 0 && (
            <Card title="Recently completed">
              <ul>
                {data.recent.map((r) => (
                  <li key={r._id}>
                    {r.stageWeeks}-week review of {r.ruleName}
                    {r.myPart === 'manager' && ` (${r.employeeName})`}: {r.employee?.helping ? `helping: ${r.employee.helping}` : 'no employee answer'}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
