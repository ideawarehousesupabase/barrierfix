import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DualView, RuleChips, ValidatorPanel } from '../components/TaskView.jsx';
import { Alert, Button, Card, ErrorAlert, Field, PageHeader, RadioGroup, Select, TextArea, useToast } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

// A task is always previewed first. The preview is saved as a draft on the server, and Send delivers
// exactly that draft, so the person receives what the manager saw. Changing the task throws the
// draft away and a new preview is needed.
export default function SendTask() {
  const { features } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const people = useQuery({ queryKey: ['directory'], queryFn: () => api.get('/api/users/directory') });
  const [employeeId, setEmployeeId] = useState('');
  const [mode, setMode] = useState('web');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  // Details the person's profile requires and the message does not give (asked for, never guessed).
  const [extras, setExtras] = useState({ priority: '', deadlineDate: '', deadlineTime: '' });
  const setExtra = (key) => (e) => setExtras((x) => ({ ...x, [key]: e.target.value }));
  const extraBody = Object.fromEntries(Object.entries(extras).filter(([, v]) => v));

  // The draft behind the current preview, so it can be removed if the manager leaves or changes the task.
  const draftRef = useRef(null);
  const sentRef = useRef(false);
  draftRef.current = preview?.draftId || null;
  useEffect(() => () => {
    if (draftRef.current && !sentRef.current) api.del(`/api/briefs/drafts/${draftRef.current}`).catch(() => {});
  }, []);

  if (!features.translation) {
    return (
      <>
        <PageHeader title="Send a task" />
        <Alert tone="info">Task translation is part of the Professional and Enterprise plans.</Alert>
      </>
    );
  }

  const options = (people.data?.users || []).map((u) => ({ value: u._id, label: `${u.name}${u.formatReady ? '' : ' (no agreed format yet)'}`, disabled: !u.formatReady }));
  const ready = options.filter((o) => !o.disabled).length;
  const recipientName = options.find((o) => o.value === employeeId)?.label;
  const canSend = Boolean(preview?.draftId) && !preview.result?.missing?.length;

  // Anything that changes the task makes the preview out of date: its draft is removed.
  function dropPreview() {
    if (preview?.draftId) api.del(`/api/briefs/drafts/${preview.draftId}`).catch(() => {});
    setPreview(null);
  }

  async function makePreview() {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await api.post('/api/briefs/preview', { employeeId, text, source: mode, ...extraBody, ...(preview?.draftId ? { replaces: preview.draftId } : {}) }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }

  async function send() {
    setBusy('send');
    setError(null);
    try {
      const { brief } = await api.post('/api/briefs', { draftId: preview.draftId });
      sentRef.current = true;
      toast(brief.status === 'held' ? 'Held for your check: the original wording was sent.' : 'Sent in their agreed format.');
      navigate(`/tasks/${brief._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        title="Send a task"
        intro="Write the task the way you normally would. BarrierFix rewrites it into the person's agreed format and checks that nothing about the goal, deadline or deliverable has changed. You see exactly what they will receive before it is sent."
        actions={<Link className="btn btn-secondary" to="/send/bulk">Upload a CSV of tasks</Link>}
      />
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); makePreview(); }}>
          <Select label="Who is it for?" hint={people.isLoading ? 'Loading people…' : `${ready} person(s) have an agreed format.`} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); dropPreview(); }} options={options} placeholder="Choose a person" />
          <RadioGroup
            legend="What are you sending?"
            inline
            value={mode}
            onChange={(value) => { setMode(value); dropPreview(); }}
            options={[
              { value: 'web', label: 'A written task' },
              { value: 'verbal', label: 'A summary of something I said in person or on a call' },
            ]}
          />
          <TextArea
            label={mode === 'verbal' ? 'What did you ask them to do?' : 'Task'}
            hint="For example: Can you pull together the Q3 review deck for Harbour & Co by Thursday? Use last quarter's as a base and add the new campaign numbers."
            value={text}
            onChange={(e) => { setText(e.target.value); dropPreview(); }}
            rows={7}
          />
          {!preview && (
            <div className="actions">
              <Button type="submit" busy={busy === 'preview'} disabled={!employeeId || text.trim().length < 3}>Preview</Button>
            </div>
          )}
        </form>
      </Card>
      <ErrorAlert error={error} />
      {preview?.result?.missing?.length > 0 && (
        <Card title="A few more details are needed">
          <p>This person's agreed format needs the following before the task can be sent. BarrierFix does not guess them.</p>
          <div className="grid two">
            {preview.result.missing.map((m) =>
              m.input === 'priority' ? (
                <Select key={m.key} label={m.question} value={extras.priority} onChange={setExtra('priority')} placeholder="Choose" options={m.options} />
              ) : (
                <Field key={m.key} label={m.question}>
                  {(a) => <input {...a} type={m.input === 'date' ? 'date' : 'time'} value={extras[m.key]} onChange={setExtra(m.key)} />}
                </Field>
              ),
            )}
          </div>
          <Button variant="secondary" busy={busy === 'preview'} onClick={makePreview}>Update preview</Button>
        </Card>
      )}
      {preview && (
        <>
          <Card title="Preview">
            {!preview.hasProfile ? (
              <Alert tone="warning">{preview.reason || 'This person has no agreed profile yet, so there is no format to apply.'}</Alert>
            ) : (
              <DualView original={text} cards={preview.result.cards} />
            )}
            <div className="actions">
              {canSend && (
                <Button busy={busy === 'send'} onClick={send}>
                  Send to {recipientName}
                </Button>
              )}
              <Button variant="ghost" onClick={dropPreview}>
                {canSend ? 'Cancel' : 'Close preview'}
              </Button>
            </div>
            {canSend && <p className="muted small">Nothing has been sent yet. To change the task, edit it above and preview it again.</p>}
          </Card>
          {preview.hasProfile && (
            <div className="grid two">
              <Card title="Rules applied"><RuleChips rules={preview.result.appliedRules} /></Card>
              <Card title="Outcome check"><ValidatorPanel validator={preview.result.validator} /></Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
