import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { MedicalWarning } from '../components/MedicalWarning.jsx';
import { Modal } from '../components/Modal.jsx';
import { Badge, Button, Card, Checkbox, ErrorAlert, Field, Loading, PageHeader, useToast } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { ruleStatus } from './MyProfile.jsx';

const TYPE = {
  transform: { label: 'Changes how tasks are written', tone: 'info' },
  schedule: { label: 'Sends timed prompts', tone: 'info' },
  record: { label: 'Recorded and reviewed only', tone: 'neutral' },
};

// `action` sits at the top right of the card: the employee's "+" button, or the rule's status in their profile.
export function RuleCard({ rule, action }) {
  return (
    <article className="rule-card" id={`rule-${rule.code}`} tabIndex={-1}>
      <div className="rule-card-head">
        <h3>{rule.name}</h3>
        {action}
      </div>
      <p>{rule.summary}</p>
      <div className="rule-meta">
        <Badge tone={TYPE[rule.type]?.tone}>{TYPE[rule.type]?.label}</Badge>
        {rule.typicalCost && <Badge>{rule.typicalCost}</Badge>}
        {rule.accessToWork && <Badge tone="success">Access to Work may help</Badge>}
      </div>
      {rule.changes && <p className="small"><strong>What it changes:</strong> {rule.changes}</p>}
      {rule.neverChanges && <p className="small"><strong>What it never changes:</strong> {rule.neverChanges}</p>}
      <p className="small muted">{rule.reviewedBy ? `Reviewed by ${rule.reviewedBy}` : rule.source}</p>
    </article>
  );
}

// The same rule card as on the profile page, in a pop-up. Saving sends it to the manager for agreement.
function RequestRule({ rule, groupLabel, profile, onClose, onSaved }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useState(() => Object.fromEntries((rule.params || []).map((p) => [p.key, p.default])));
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  const needsConsent = !profile?.consent?.given;
  const paused = needsConsent && profile?.rules?.some((r) => r.status === 'agreed');
  const unsent = profile?.status === 'draft' && profile.rules.some((r) => r.status === 'proposed' || r.pending);

  const save = useMutation({
    mutationFn: () => api.post('/api/profiles/me/rules', { code: rule.code, params, note, ...(needsConsent ? { consent } : {}) }),
    onSuccess: (res) => {
      qc.setQueryData(['profile', 'me'], res);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Sent to your manager for agreement');
      onSaved();
    },
  });
  const submit = () => {
    if (needsConsent && !consent) return setConsentError('Please tick the box to agree, or choose Cancel.');
    setConsentError('');
    return save.mutate();
  };

  return (
    <Modal
      title={rule.name}
      badge={<Badge tone="neutral">Not saved yet</Badge>}
      onClose={onClose}
      footer={
        <>
          <div className="actions">
            <Button onClick={submit} busy={save.isPending}>Save changes</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
          <p className="muted small">Saving sends this rule to your manager to agree. Your agreed rules keep applying until then.</p>
        </>
      }
    >
      <p className="muted">{rule.summary}</p>
      <p className="small muted">{groupLabel} · {TYPE[rule.type]?.label}</p>
      {(rule.params || []).map((p) => (
        <Field key={p.key} label={p.label} hint={p.kind === 'number' && p.min !== undefined ? `From ${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ''}` : undefined}>
          {(a) => (
            <input
              {...a}
              type={p.kind === 'time' ? 'time' : 'number'}
              min={p.min}
              max={p.max}
              value={params[p.key] ?? ''}
              onChange={(e) => setParams((x) => ({ ...x, [p.key]: p.kind === 'time' ? e.target.value : Number(e.target.value) }))}
              style={{ maxWidth: '12rem' }}
            />
          )}
        </Field>
      ))}
      <Field label="Note (optional)" hint="Anything that helps, described as a way of working.">
        {(a) => <input {...a} type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <MedicalWarning text={note} />
      {needsConsent && (
        <div className={`field ${consentError ? 'has-error' : ''}`}>
          <Checkbox
            label="I agree to BarrierFix applying my agreed rules to tasks sent to me. I can pause or change this at any time."
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setConsentError('');
            }}
          />
          {paused && <p className="hint">Your profile is paused. Sending this request switches it back on.</p>}
          {consentError && <p className="error" role="alert">{consentError}</p>}
        </div>
      )}
      {unsent && <p className="small muted">Your profile also has changes you have not sent yet. They will be sent to your manager with this rule.</p>}
      <ErrorAlert error={save.error} />
    </Modal>
  );
}

export default function RuleLibrary() {
  const { org, hasRole } = useAuth();
  const isEmployee = Boolean(org) && hasRole('employee');
  const { data, isLoading, error } = useQuery({ queryKey: ['rules'], queryFn: () => api.get('/api/rules') });
  const profileQ = useQuery({ queryKey: ['profile', 'me'], queryFn: () => api.get('/api/profiles/me'), enabled: isEmployee });
  const [search, setSearch] = useState('');
  const [requesting, setRequesting] = useState(null);
  // After a request is sent its "+" button is replaced by a status, so keyboard focus goes to the rule's card.
  const focusAfterClose = useRef(null);
  useEffect(() => {
    if (requesting || !focusAfterClose.current) return;
    document.getElementById(`rule-${focusAfterClose.current}`)?.focus();
    focusAfterClose.current = null;
  }, [requesting]);
  if (isLoading) return <Loading />;
  const q = search.trim().toLowerCase();
  const rules = (data?.rules || []).filter((r) => !q || `${r.name} ${r.summary}`.toLowerCase().includes(q));
  const profile = profileQ.data?.profile;
  const inProfile = new Map((profile?.rules || []).map((r) => [r.code, r]));

  const actionFor = (rule) => {
    if (!isEmployee || !profile) return null;
    const mine = inProfile.get(rule.code);
    if (mine) return ruleStatus(mine, profile.status);
    return (
      <Button variant="secondary" size="small" className="btn-icon" onClick={() => setRequesting(rule)}>
        <span aria-hidden="true">+</span>
        <span className="visually-hidden">Add {rule.name} to my Adjustment Profile</span>
      </Button>
    );
  };

  return (
    <>
      <PageHeader
        title="Rule library"
        intro={`Work-format rules describe what helps, not why. Each one says exactly what it changes in a task and what it never changes.${isEmployee ? ' Choose + on a rule to ask your manager to add it to your Adjustment Profile.' : ''}`}
      />
      <ErrorAlert error={error || profileQ.error} />
      <div className="field" style={{ maxWidth: '28rem' }}>
        <label htmlFor="rule-search">Search the library</label>
        <input id="rule-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {Object.entries(data?.groups || {}).map(([group, label]) => {
        const inGroup = rules.filter((r) => r.group === group);
        if (!inGroup.length) return null;
        return (
          <Card key={group} title={label}>
            <div className="grid two">
              {inGroup.map((r) => (
                <RuleCard key={r.code} rule={r} action={actionFor(r)} />
              ))}
            </div>
          </Card>
        );
      })}
      {requesting && (
        <RequestRule
          rule={requesting}
          groupLabel={data?.groups?.[requesting.group]}
          profile={profile}
          onClose={() => setRequesting(null)}
          onSaved={() => {
            focusAfterClose.current = requesting.code;
            setRequesting(null);
          }}
        />
      )}
    </>
  );
}
