import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Modal } from '../components/Modal.jsx';
import { DualView, OriginalText, RuleChips, TaskCards, ValidatorPanel } from '../components/TaskView.jsx';
import { Alert, Badge, Button, Card, ErrorAlert, Field, Loading, PageHeader, TextArea, useToast } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { BRIEF_STATUS, SOURCE_LABELS, TASK_STATUS, fmtDate, fmtDateTime } from '../lib/format.js';

function Thread({ brief }) {
  if (!brief.thread.length) return null;
  const labels = { question: 'Question', answer: 'Answer', flag: 'Flagged', breakdown: 'Asked for smaller steps', note: 'Note' };
  return (
    <Card title="Conversation" headingLevel={2}>
      <ul className="thread">
        {brief.thread.map((t) => (
          <li key={t._id}>
            <div className="meta">
              {labels[t.kind]} · {t.authorName} · {fmtDateTime(t.at)}
            </div>
            {t.kind !== 'breakdown' && <div>{t.text}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Breakdown({ brief }) {
  const result = brief.breakdown?.result;
  if (!result?.length) return null;
  return (
    <Card title="Smaller steps">
      {result.map((r) => (
        <div key={r.taskIndex}>
          {result.length > 1 && <h3>Task {r.taskIndex + 1}</h3>}
          <ol>
            {r.items.map((it, i) => (
              <li key={i}>
                {it.text}
                {it.targetText && <span className="muted"> (aim to finish by {it.targetText})</span>}
              </li>
            ))}
          </ol>
          {r.basis && <p className="muted small">Times are spread evenly across your working hours before the {r.basis}.</p>}
        </div>
      ))}
    </Card>
  );
}

function EmployeeActions({ brief, act, busy }) {
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const closed = ['cancelled', 'superseded'].includes(brief.status);
  if (closed) return null;
  return (
    <Card title="What would you like to do?">
      <div className="actions">
        <Button onClick={() => act('confirm')} busy={busy === 'confirm'} disabled={brief.employeeStatus === 'confirmed'}>
          {brief.employeeStatus === 'confirmed' ? 'Confirmed' : 'Confirm I have this'}
        </Button>
        <Button variant="secondary" onClick={() => setMode(mode === 'question' ? null : 'question')} aria-expanded={mode === 'question'}>Ask a question</Button>
        <Button variant="secondary" onClick={() => act('breakdown')} busy={busy === 'breakdown'}>Break it down further</Button>
        {brief.deliveredVersion !== 'original' && (
          <Button variant="danger" onClick={() => setMode(mode === 'flag' ? null : 'flag')} aria-expanded={mode === 'flag'}>Flag as wrong</Button>
        )}
      </div>
      {mode && (
        <form
          style={{ marginTop: '1rem' }}
          onSubmit={async (e) => {
            e.preventDefault();
            await act(mode, mode === 'question' ? { text } : { reason: text });
            setText('');
            setMode(null);
          }}
        >
          <TextArea
            label={mode === 'question' ? 'Your question' : 'What is wrong with the formatted version? (optional)'}
            hint={mode === 'question' ? 'Your manager will see it here and in Slack or email.' : 'Your manager will be asked to check the original and the formatted version.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions">
            <Button type="submit" busy={Boolean(busy)} disabled={mode === 'question' && text.trim().length < 2}>{mode === 'question' ? 'Send question' : 'Flag this task'}</Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function ManagerPanel({ brief, act, busy }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(brief.translatedText || '');
  const [answer, setAnswer] = useState('');
  const unanswered = brief.thread.filter((t) => t.kind === 'question').length > brief.thread.filter((t) => t.kind === 'answer').length;
  return (
    <>
      {brief.status === 'held' && (
        <Card title="Please check this task">
          <Alert tone="warning">
            <p>The Outcome Validator found a difference between your brief and the formatted version, so {brief.employeeName} received your original wording. Choose what to do.</p>
          </Alert>
          <div className="actions">
            <Button onClick={() => act('resolve', { action: 'approve' })} busy={busy === 'resolve'}>Send the formatted version</Button>
            <Button variant="secondary" onClick={() => setEditing(!editing)} aria-expanded={editing}>Edit, then send</Button>
            <Button variant="ghost" onClick={() => act('resolve', { action: 'keep_original' })}>Keep my original</Button>
          </div>
          {editing && (
            <form style={{ marginTop: '1rem' }} onSubmit={(e) => { e.preventDefault(); act('resolve', { action: 'edit', text }); }}>
              <TextArea label="Version to send" value={text} onChange={(e) => setText(e.target.value)} rows={10} />
              <Button type="submit" busy={busy === 'resolve'}>Send this version</Button>
            </form>
          )}
        </Card>
      )}
      {unanswered && (
        <Card title={`${brief.employeeName} asked a question`}>
          <form onSubmit={async (e) => { e.preventDefault(); await act('answer', { text: answer }); setAnswer(''); }}>
            <TextArea label="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <Button type="submit" busy={busy === 'answer'} disabled={!answer.trim()}>Send answer</Button>
          </form>
        </Card>
      )}
    </>
  );
}

const TIME_KEYS = ['due', 'checkin', 'reminder'];
const copyCards = (cards) => cards.map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, ...(s.items ? { items: [...s.items] } : {}) })) }));
const wordsOf = (cards) => JSON.stringify(cards.map((c) => c.sections.map((s) => [s.text ?? null, s.items ?? null])));

// One part of the task as an editable box. Headings and dividers stay as they are.
function EditSection({ s, onChange }) {
  if (s.type === 'heading') return <p className="heading">{s.text}</p>;
  if (s.type === 'divider') return <hr />;
  if (s.type === 'list' || s.type === 'text') {
    const name = s.label || 'Message';
    return (
      <fieldset className="field">
        <legend>{name}</legend>
        <p className="hint">{s.type === 'list' ? 'Leave a step empty to remove it.' : 'Leave a paragraph empty to remove it.'}</p>
        {s.items.map((item, j) => (
          <div className="step-row" key={j}>
            {s.type === 'list' && <span aria-hidden="true">{j + 1}.</span>}
            {s.type === 'list' ? (
              <input type="text" aria-label={`Step ${j + 1}`} maxLength={2000} value={item} onChange={(e) => onChange({ items: s.items.map((x, k) => (k === j ? e.target.value : x)) })} />
            ) : (
              <textarea aria-label={`${name}, paragraph ${j + 1}`} rows={2} maxLength={2000} style={{ minHeight: '3.5rem' }} value={item} onChange={(e) => onChange({ items: s.items.map((x, k) => (k === j ? e.target.value : x)) })} />
            )}
          </div>
        ))}
        <Button variant="ghost" size="small" onClick={() => onChange({ items: [...s.items, ''] })}>{s.type === 'list' ? 'Add a step' : 'Add a paragraph'}</Button>
      </fieldset>
    );
  }
  const isTime = TIME_KEYS.includes(s.key);
  return (
    <Field label={s.type === 'note' ? 'Note' : s.label} hint={isTime ? 'If you change this time, the automatic reminders for this task are switched off.' : s.type === 'note' ? 'Leave it empty to remove the note.' : undefined}>
      {(a) => <input {...a} type="text" maxLength={2000} value={s.text || ''} onChange={(e) => onChange({ text: e.target.value })} />}
    </Field>
  );
}

// The employee flagged the task as wrong: the sender corrects what the employee received and sends it again.
// Only the wording changes, so the employee still gets the layout of their agreed format.
function CorrectTask({ brief, onClose, onSent }) {
  const [cards, setCards] = useState(() => copyCards(brief.deliveredCards));
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => api.post(`/api/briefs/${brief._id}/correct`, { cards: cards.map((c) => ({ sections: c.sections.map(({ type, key, text, items }) => ({ type, key, text, items })) })) }),
    onSuccess: onSent,
  });
  const setSection = (ci, si, patch) => setCards((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, sections: c.sections.map((s, j) => (j === si ? { ...s, ...patch } : s)) })));
  const submit = () => {
    if (wordsOf(cards) === wordsOf(brief.deliveredCards)) return setError('You have not changed anything yet. Edit the task on the right first.');
    setError('');
    return send.mutate();
  };
  return (
    <Modal
      wide
      title="Edit task"
      onClose={onClose}
      footer={
        <>
          <div className="actions">
            <Button onClick={submit} busy={send.isPending}>Send to {brief.employeeName}</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
          <p className="muted small">Nothing has been sent yet. Edit the task on the right, then send it. {brief.employeeName} will be asked to check it again.</p>
        </>
      }
    >
      {brief.flag?.reason && (
        <Alert tone="warning" title={`${brief.employeeName} flagged this task as wrong`}>
          <p>{brief.flag.reason}</p>
        </Alert>
      )}
      <div className="dual">
        <div>
          <h3>Original brief</h3>
          <OriginalText text={brief.originalText} />
        </div>
        <div>
          <h3>What they receive</h3>
          <div className="stack">
            {cards.map((c, ci) => (
              <div className="task task-edit" key={c.index ?? ci}>
                {cards.length > 1 && <p className="muted small">Message {ci + 1} of {cards.length}</p>}
                {c.sections.map((s, si) => (
                  <EditSection key={`${s.key}-${si}`} s={s} onChange={(patch) => setSection(ci, si, patch)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {error && <Alert tone="danger"><p>{error}</p></Alert>}
      <ErrorAlert error={send.error} />
    </Modal>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [showOriginal, setShowOriginal] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['brief', id], queryFn: () => api.get(`/api/briefs/${id}`) });
  const mutation = useMutation({
    mutationFn: ({ action, body }) => api.post(`/api/briefs/${id}/${action}`, body || {}),
    onSuccess: (res, { action }) => {
      qc.setQueryData(['brief', id], res);
      qc.invalidateQueries({ queryKey: ['briefs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      const messages = { confirm: 'Thanks. Your manager can see you have confirmed.', question: 'Your question was sent.', breakdown: 'Smaller steps were added below.', flag: 'Thanks. Your manager has been asked to check it.', answer: 'Answer sent.', resolve: 'Done.', cancel: 'The task was withdrawn.' };
      toast(messages[action] || 'Saved');
    },
  });
  const act = (action, body) => mutation.mutateAsync({ action, body }).catch(() => {});
  const busy = mutation.isPending ? mutation.variables?.action : null;

  if (isLoading) return <Loading />;
  if (error) return <><PageHeader title="Task" /><ErrorAlert error={error} /></>;
  const brief = data.brief;
  const isManager = brief.viewerRole === 'manager';
  const cards = brief.deliveredCards;
  const title = brief.result?.summaries?.[0]?.title || 'Task';
  const corrected = brief.deliveredVersion === 'manager_edited' && brief.managerEditedCards?.length > 0;
  const canCorrect = isManager && brief.employeeStatus === 'flagged' && !['cancelled', 'superseded', 'draft', 'held'].includes(brief.status);

  return (
    <>
      <PageHeader
        title={isManager ? `Task for ${brief.employeeName}` : `Task from ${brief.managerName}`}
        intro={`${SOURCE_LABELS[brief.source]} · sent ${fmtDateTime(brief.createdAt)} · text kept until ${fmtDate(brief.expiresAt)}`}
        actions={
          <>
            <Badge tone={BRIEF_STATUS[brief.status]?.tone}>{BRIEF_STATUS[brief.status]?.label}</Badge>
            <Badge tone={TASK_STATUS[brief.employeeStatus]?.tone}>{TASK_STATUS[brief.employeeStatus]?.label}</Badge>
          </>
        }
      />
      <ErrorAlert error={mutation.error} />
      {['cancelled', 'superseded'].includes(brief.status) && (
        <Alert tone="info">
          <p>
            {brief.status === 'cancelled' ? 'This task was withdrawn.' : 'This task was replaced by an updated version.'}{' '}
            {brief.supersededBy && <Link to={`/tasks/${brief.supersededBy}`}>See the new version</Link>}
          </p>
        </Alert>
      )}

      {isManager ? (
        <>
          <ManagerPanel brief={brief} act={act} busy={busy} />
          <Card title="Side by side">
            <DualView original={brief.originalText} cards={corrected ? cards : brief.result?.cards || []} translatedLabel={brief.status === 'held' ? 'Formatted version (held)' : `What ${brief.employeeName} received`} />
            {corrected && <p className="muted small">You corrected this version after {brief.employeeName} flagged it.</p>}
          </Card>
        </>
      ) : (
        <Card title={title}>
          {brief.deliveredVersion === 'original' ? (
            <>
              <Alert tone="info"><p>BarrierFix could not safely reformat this task, so here is {brief.managerName}&apos;s original wording. {brief.managerName} has been asked to check the formatted version.</p></Alert>
              <OriginalText text={brief.originalText} />
            </>
          ) : (
            <>
              <TaskCards cards={cards} />
              {brief.deliveredVersion === 'manager_edited' && <p className="muted small">{brief.managerName} checked and edited this version for you.</p>}
              <div style={{ marginTop: '0.75rem' }}>
                <Button variant="ghost" size="small" onClick={() => setShowOriginal(!showOriginal)} aria-expanded={showOriginal}>
                  {showOriginal ? 'Hide the original message' : 'Show the original message'}
                </Button>
                {showOriginal && <OriginalText text={brief.originalText} />}
              </div>
            </>
          )}
        </Card>
      )}

      {!isManager && <EmployeeActions brief={brief} act={act} busy={busy} />}
      <Breakdown brief={brief} />
      <Thread brief={brief} />

      <div className="grid two">
        <Card title="Rules applied">
          <RuleChips rules={brief.appliedRules} />
          {brief.result?.checkedRules?.length > 0 && (
            <>
              <h3 style={{ marginTop: '0.75rem' }}>Checked, no change needed</h3>
              <RuleChips rules={brief.result.checkedRules} />
            </>
          )}
        </Card>
        <Card title="Outcome check">
          <ValidatorPanel validator={brief.validator} />
        </Card>
      </div>
      {brief.result?.changes?.length > 0 && (
        <Card title="Wording changes">
          <ul>
            {brief.result.changes.map((c, i) => (
              <li key={i}>
                &ldquo;{c.from}&rdquo; → &ldquo;{c.to}&rdquo;
              </li>
            ))}
          </ul>
        </Card>
      )}
      {isManager && !['cancelled', 'superseded'].includes(brief.status) && (
        <div className="actions">
          {canCorrect && <Button onClick={() => setCorrecting(true)}>Edit task</Button>}
          <Button variant="danger" onClick={() => window.confirm('Withdraw this task? The employee will be told.') && act('cancel')}>Withdraw this task</Button>
        </div>
      )}
      {correcting && (
        <CorrectTask
          brief={brief}
          onClose={() => setCorrecting(false)}
          onSent={(res) => {
            qc.setQueryData(['brief', id], res);
            qc.invalidateQueries({ queryKey: ['briefs'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
            setCorrecting(false);
            toast(`The corrected task was sent to ${brief.employeeName}.`);
          }}
        />
      )}
    </>
  );
}
