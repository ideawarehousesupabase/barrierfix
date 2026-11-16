import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MedicalWarning } from '../components/MedicalWarning.jsx';
import { Alert, Badge, Button, Card, ErrorAlert, Loading, PageHeader, TextArea, useToast } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { DECISION_STATUS, fmtDateTime } from '../lib/format.js';

const HR_ACTION = { accept_rejection: 'accepted the rejection', send_back: 'sent it back for the six questions', reject_rejection: 'rejected the rejection, so the request is accepted' };

// Answer a request: accept, or reject with a reason.
function Respond({ act }) {
  const [comment, setComment] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const box = useRef(null);
  const hasReason = comment.trim().length >= 3;
  function reject() {
    if (!hasReason) {
      setNeedReason(true);
      box.current?.querySelector('textarea')?.focus();
      return;
    }
    act.mutate({ path: 'respond', body: { decision: 'reject', comment }, message: 'Request rejected and sent to HR' });
  }
  return (
    <Card title="Your answer">
      <div ref={box}>
        <TextArea
          label="Comment"
          hint="Optional when you accept. Needed when you reject."
          error={needReason && !hasReason ? 'Please write why you are rejecting this request, then press Reject again.' : undefined}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
      </div>
      <MedicalWarning text={comment} />
      <div className="actions">
        <Button busy={act.isPending && act.variables?.body?.decision === 'accept'} onClick={() => act.mutate({ path: 'respond', body: { decision: 'accept', comment }, message: 'Request accepted' })}>Accept</Button>
        <Button variant="danger" busy={act.isPending && act.variables?.body?.decision === 'reject'} onClick={reject}>Reject</Button>
      </div>
      <p className="muted small">If you reject it, HR reviews your reason.</p>
    </Card>
  );
}

// After HR sends a rejection back: the six questions, one answer each.
function SixQuestions({ record, act }) {
  const [answers, setAnswers] = useState({});
  const [tried, setTried] = useState(false);
  const blank = (key) => (answers[key] || '').trim().length < 2;
  const complete = record.prompts.every((f) => !blank(f.key));
  return (
    <Card title="Six questions from HR">
      <p>HR asked you to explain your rejection. Please answer each question, then send it back to HR.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (complete) act.mutate({ path: 'answers', body: { answers }, message: 'Answers sent to HR' });
        }}
      >
        {record.prompts.map((f, i) => (
          <div key={f.key}>
            <TextArea label={`${i + 1}. ${f.title}`} hint={f.prompt} error={tried && blank(f.key) ? 'Please answer this question.' : undefined} value={answers[f.key] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} rows={2} />
          </div>
        ))}
        <MedicalWarning text={Object.values(answers).join(' ')} />
        {tried && !complete && <Alert tone="warning">Please answer all six questions before sending them to HR.</Alert>}
        <Button type="submit" busy={act.isPending}>Send to HR</Button>
      </form>
    </Card>
  );
}

// HR's review of a rejection.
function HrReview({ record, act }) {
  const [comment, setComment] = useState('');
  const first = record.viewer.reviewStage === 'first';
  return (
    <Card title={first ? 'HR review' : 'HR final decision'}>
      <p>{first ? 'Accept the rejection, or send it back so the person who rejected it answers six questions.' : 'The six questions have been answered. Accept the rejection, or reject it so the request is accepted.'}</p>
      <TextArea label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      <div className="actions">
        <Button onClick={() => act.mutate({ path: 'hr', body: { action: 'accept_rejection', comment }, message: 'Rejection accepted' })} busy={act.isPending}>Accept the rejection</Button>
        {first ? (
          <Button variant="secondary" onClick={() => act.mutate({ path: 'hr', body: { action: 'send_back', comment }, message: 'Sent back for the six questions' })} busy={act.isPending}>Send back for six questions</Button>
        ) : (
          <Button variant="secondary" onClick={() => act.mutate({ path: 'hr', body: { action: 'reject_rejection', comment }, message: 'Rejection overturned: the request is accepted' })} busy={act.isPending}>Reject the rejection</Button>
        )}
      </div>
    </Card>
  );
}

export default function DecisionDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['decision', id], queryFn: () => api.get(`/api/decisions/${id}`) });
  const act = useMutation({
    mutationFn: ({ path, body }) => api.post(`/api/decisions/${id}/${path}`, body || {}),
    onSuccess: (res, vars) => {
      qc.setQueryData(['decision', id], { record: res.record });
      qc.invalidateQueries({ queryKey: ['decisions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(vars.message);
    },
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  const r = data.record;
  const v = r.viewer;
  const status = DECISION_STATUS[r.status] || { label: r.statusLabel, tone: 'neutral' };
  const answered = r.prompts.filter((f) => r.answers?.[f.key]?.text);

  return (
    <>
      <PageHeader
        title={r.request.title}
        intro={`From ${r.requesterName} to ${r.recipientName} · sent ${fmtDateTime(r.createdAt)}`}
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Button variant="ghost" size="small" onClick={() => download(`/api/decisions/${id}/export`, `adjustment-request-${id}.pdf`)}>Download PDF</Button>
          </>
        }
      />
      <ErrorAlert error={act.error} />

      <Card title="The request">
        <p><strong>{r.request.title}</strong></p>
        {r.request.details ? <p style={{ whiteSpace: 'pre-wrap' }}>{r.request.details}</p> : <p className="muted">No more details given.</p>}
        {v.canWithdraw && <Button variant="ghost" size="small" onClick={() => window.confirm('Withdraw this request?') && act.mutate({ path: 'withdraw', message: 'Request withdrawn' })}>Withdraw request</Button>}
      </Card>

      {r.response?.decision && (
        <Card title={r.response.decision === 'accepted' ? 'Accepted' : 'Rejected'}>
          <p>{r.responseByName}, {fmtDateTime(r.response.at)}</p>
          {r.response.comment && <p style={{ whiteSpace: 'pre-wrap' }}>{r.response.comment}</p>}
        </Card>
      )}

      {v.canRespond && <Respond act={act} />}
      {r.status === 'pending' && !v.canRespond && <Alert tone="info">Waiting for {r.recipientName} to answer.</Alert>}

      {v.canAnswer && <SixQuestions record={r} act={act} />}
      {r.status === 'answering' && !v.canAnswer && <Alert tone="info">HR sent this back. Waiting for {r.recipientName} to answer six questions.</Alert>}

      {answered.length > 0 && (
        <Card title="Answers to the six questions">
          <dl>
            {r.prompts.map((f, i) => (
              <div key={f.key} style={{ marginBottom: '0.75rem' }}>
                <dt><strong>{i + 1}. {f.title}</strong></dt>
                <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.answers?.[f.key]?.text || 'Not answered'}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {r.hrSteps.length > 0 && (
        <Card title="HR">
          <ul>
            {r.hrSteps.map((s, i) => (
              <li key={i}>
                {s.byName} {HR_ACTION[s.action]} ({fmtDateTime(s.at)}){s.comment ? `: ${s.comment}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {v.canReview && <HrReview record={r} act={act} />}
      {['hr_review', 'hr_final'].includes(r.status) && !v.canReview && <Alert tone="info">Rejected. Waiting for HR to review it.</Alert>}

      <details className="card">
        <summary>History</summary>
        <ul>
          {r.history.map((h, i) => (
            <li key={i}>{fmtDateTime(h.at)}: {h.action.replace(/_/g, ' ')} by {h.byName}</li>
          ))}
        </ul>
      </details>
      <p className="muted small">{r.disclaimer}</p>
    </>
  );
}
