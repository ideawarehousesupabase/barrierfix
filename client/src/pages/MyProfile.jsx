import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { MedicalWarning } from '../components/MedicalWarning.jsx';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Field, Loading, PageHeader, Select, useToast } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { PROFILE_STATUS, fmtDate } from '../lib/format.js';

const TYPE_LABEL = { transform: 'Changes how tasks are written', schedule: 'Sends timed prompts', record: 'Recorded and reviewed only' };

// profileStatus: a new rule in a profile that has not been sent yet is not waiting for anyone.
export function ruleStatus(r, profileStatus) {
  if (r.status === 'proposed' && profileStatus === 'draft') return <Badge tone="neutral">Not sent yet</Badge>;
  if (r.status === 'proposed') return <Badge tone="warning">Waiting for agreement</Badge>;
  if (r.pending) return <Badge tone="warning">Agreed (change waiting)</Badge>;
  if (r.needsRevision) return <Badge tone="danger">Review: may need to change</Badge>;
  return <Badge tone="success">Agreed</Badge>;
}

export function paramsText(defs = [], params = {}) {
  return defs.map((d) => `${d.label}: ${params?.[d.key] ?? d.default}${d.unit ? ` ${d.unit}` : ''}`).join(' · ');
}

const draftOf = (profile) => (profile?.rules || []).map((r) => ({ code: r.code, params: r.pending?.params || r.params || {}, note: r.pending?.note ?? r.note ?? '' }));

export default function MyProfile() {
  const qc = useQueryClient();
  const toast = useToast();
  const profileQ = useQuery({ queryKey: ['profile', 'me'], queryFn: () => api.get('/api/profiles/me') });
  const rulesQ = useQuery({ queryKey: ['rules'], queryFn: () => api.get('/api/rules') });
  const people = useQuery({ queryKey: ['directory'], queryFn: () => api.get('/api/users/directory') });
  const profile = profileQ.data?.profile;
  const [draft, setDraft] = useState([]);
  const [viewers, setViewers] = useState([]);
  const [adding, setAdding] = useState('');
  const [consent, setConsent] = useState(false);
  const [warning, setWarning] = useState(null);

  useEffect(() => {
    if (profile) {
      setDraft(draftOf(profile));
      setViewers((profile.extraViewerIds || []).map(String));
    }
  }, [profile]);

  const library = useMemo(() => new Map((rulesQ.data?.rules || []).map((r) => [r.code, r])), [rulesQ.data]);
  const dirty = profile && (JSON.stringify(draft) !== JSON.stringify(draftOf(profile)) || JSON.stringify(viewers) !== JSON.stringify((profile.extraViewerIds || []).map(String)));
  const waiting = profile?.rules.some((r) => r.status === 'proposed' || r.pending);

  const save = useMutation({
    mutationFn: () => api.put('/api/profiles/me', { rules: draft, extraViewerIds: viewers }),
    onSuccess: (res) => {
      qc.setQueryData(['profile', 'me'], res);
      setWarning(res.warning);
      toast('Profile saved');
    },
  });
  const submit = useMutation({
    mutationFn: () => api.post('/api/profiles/me/submit', { consent: true }),
    onSuccess: (res) => {
      qc.setQueryData(['profile', 'me'], res);
      toast('Sent to your manager for agreement');
    },
  });
  const pause = useMutation({
    mutationFn: (given) => api.post('/api/profiles/me/consent', { given }),
    onSuccess: (res) => qc.setQueryData(['profile', 'me'], res),
  });

  if (profileQ.isLoading || rulesQ.isLoading) return <Loading />;
  if (profileQ.error) return <ErrorAlert error={profileQ.error} />;

  const update = (code, patch) => setDraft((d) => d.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  const available = [...library.values()].filter((r) => !draft.some((d) => d.code === r.code));
  const groups = rulesQ.data?.groups || {};
  const status = PROFILE_STATUS[profile.status] || PROFILE_STATUS.draft;
  const others = (people.data?.users || []).filter((u) => String(u._id) !== String(profile.employee._id) && !viewers.includes(String(u._id)));

  return (
    <>
      <PageHeader
        title="My Adjustment Profile"
        intro="The ways of working that help you. You control this profile: there is no medical information in it, and you can change or pause it at any time."
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Button variant="ghost" size="small" onClick={() => download('/api/profiles/me/export', 'adjustment-profile.pdf')}>Download PDF</Button>
            <Button variant="ghost" size="small" onClick={() => download('/api/profiles/me/export?format=json', 'adjustment-profile.json')}>Export data</Button>
          </>
        }
      />
      {profile.status === 'changes_requested' && (
        <Alert tone="warning" title="Your manager would like to talk about your profile">
          <p>{profile.managerComment}</p>
        </Alert>
      )}
      {profile.rules.some((r) => r.status === 'agreed') && (
        <Alert tone={profile.consent?.given ? 'success' : 'warning'} title={profile.consent?.given ? 'BarrierFix is applying your agreed rules' : 'Your profile is paused'}>
          <p>{profile.consent?.given ? 'Tasks sent to you are formatted using your agreed rules.' : 'Tasks will reach you as written until you switch your profile back on.'}</p>
          <Button variant="secondary" size="small" busy={pause.isPending} onClick={() => pause.mutate(!profile.consent?.given)}>
            {profile.consent?.given ? 'Pause my profile' : 'Switch my profile back on'}
          </Button>
        </Alert>
      )}

      <Card title="My rules">
        {!draft.length && <p className="muted">No rules yet. Add the ways of working that help you below.</p>}
        <div className="stack">
          {draft.map((d) => {
            const lib = library.get(d.code);
            const saved = profile.rules.find((r) => r.code === d.code);
            return (
              <div className="rule-card" key={d.code}>
                <div className="spread">
                  <h3>{lib?.name || d.code}</h3>
                  {saved ? ruleStatus(saved, profile?.status) : <Badge tone="neutral">Not saved yet</Badge>}
                </div>
                <p className="muted">{lib?.summary}</p>
                <p className="small muted">{groups[lib?.group]} · {TYPE_LABEL[lib?.type]}{saved?.nextReviewAt ? ` · next review ${fmtDate(saved.nextReviewAt)}` : ''}</p>
                {(lib?.params || []).map((p) => (
                  <Field key={p.key} label={p.label}>
                    {(a) => (
                      <input
                        {...a}
                        type={p.kind === 'time' ? 'time' : 'number'}
                        min={p.min}
                        max={p.max}
                        value={d.params?.[p.key] ?? p.default}
                        onChange={(e) => update(d.code, { params: { ...d.params, [p.key]: p.kind === 'time' ? e.target.value : Number(e.target.value) } })}
                        style={{ maxWidth: '12rem' }}
                      />
                    )}
                  </Field>
                ))}
                <Field label="Note (optional)" hint="Anything that helps, described as a way of working.">
                  {(a) => <input {...a} type="text" maxLength={500} value={d.note} onChange={(e) => update(d.code, { note: e.target.value })} />}
                </Field>
                <MedicalWarning text={d.note} />
                <Button variant="danger" size="small" onClick={() => setDraft((x) => x.filter((r) => r.code !== d.code))}>Remove this rule</Button>
              </div>
            );
          })}
        </div>
        <hr />
        <div className="inline-form">
          <Select
            label="Add a rule"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Choose from the library"
            options={available.map((r) => ({ value: r.code, label: `${groups[r.group]}: ${r.name}` }))}
          />
          <Button
            variant="secondary"
            disabled={!adding}
            onClick={() => {
              const lib = library.get(adding);
              setDraft((d) => [...d, { code: adding, params: Object.fromEntries((lib.params || []).map((p) => [p.key, p.default])), note: '' }]);
              setAdding('');
            }}
          >
            Add
          </Button>
        </div>
      </Card>

      <Card title="Who can see my profile">
        <ul>
          {profile.accessList.map((a) => (
            <li key={a._id}>
              {a.name} <span className="muted">({a.reason})</span>
            </li>
          ))}
          {!profile.accessList.length && <li className="muted">Only you, until you have a manager or HR contact.</li>}
        </ul>
        <p className="muted small">People who regularly give you work can also see your rules, so they can apply them. Add them here:</p>
        {viewers.length > 0 && (
          <ul>
            {viewers.map((id) => {
              const person = (people.data?.users || []).find((u) => String(u._id) === id);
              return (
                <li key={id}>
                  {person?.name || 'Colleague'}{' '}
                  <Button variant="ghost" size="small" onClick={() => setViewers((v) => v.filter((x) => x !== id))}>Remove</Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="inline-form">
          <Select label="Add a colleague" value="" onChange={(e) => e.target.value && setViewers((v) => [...v, e.target.value])} placeholder="Choose a person" options={others.map((u) => ({ value: String(u._id), label: u.name }))} />
        </div>
      </Card>

      <ErrorAlert error={save.error || submit.error} />
      {warning && <Alert tone="warning" title="Please check your notes"><p>{warning.message}</p></Alert>}
      <Card>
        <div className="actions">
          <Button onClick={() => save.mutate()} busy={save.isPending} disabled={!dirty}>Save changes</Button>
          {dirty && <span className="muted">You have unsaved changes.</span>}
        </div>
        {!dirty && waiting && profile.status !== 'proposed' && (
          <div style={{ marginTop: '1rem' }}>
            <h3>Ask your manager to agree</h3>
            <Checkbox label="I agree to BarrierFix applying these rules to tasks sent to me. I can pause or change this at any time." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <Button onClick={() => submit.mutate()} busy={submit.isPending} disabled={!consent}>Send for agreement</Button>
          </div>
        )}
        {profile.status === 'proposed' && <p className="muted" style={{ marginTop: '0.75rem' }}>Sent for agreement. You will be told when it has been agreed.</p>}
      </Card>
    </>
  );
}
