import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Field, Loading, PageHeader, Select, TextInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';

const DAYS = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [7, 'Sunday'],
];

function CompanyForm({ org, onSaved }) {
  const [form, setForm] = useState({ name: org.name, staffCount: org.staffCount || '', sector: org.sector || '', settings: { ...org.settings } });
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.patch('/api/orgs/current', { name: form.name, staffCount: form.staffCount ? Number(form.staffCount) : undefined, sector: form.sector, settings: form.settings }),
    onSuccess: () => {
      toast('Company settings saved');
      onSaved();
    },
  });
  const s = form.settings;
  const setS = (patch) => setForm((f) => ({ ...f, settings: { ...f.settings, ...patch } }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid two">
        <TextInput label="Company name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextInput label="Number of staff" type="number" value={form.staffCount} onChange={(e) => setForm((f) => ({ ...f, staffCount: e.target.value }))} />
        <TextInput label="Sector" value={form.sector} onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))} />
        <Select
          label="Bank holidays"
          value={s.bankHolidayRegion}
          onChange={(e) => setS({ bankHolidayRegion: e.target.value })}
          options={[
            { value: 'england-and-wales', label: 'England and Wales' },
            { value: 'scotland', label: 'Scotland' },
            { value: 'northern-ireland', label: 'Northern Ireland' },
          ]}
        />
        <Field label="Working day starts">{(a) => <input {...a} type="time" value={s.workdayStart} onChange={(e) => setS({ workdayStart: e.target.value })} />}</Field>
        <Field label="Working day ends" hint="Also the deadline time when a task gives a day but no time.">{(a) => <input {...a} type="time" value={s.workdayEnd} onChange={(e) => setS({ workdayEnd: e.target.value })} />}</Field>
      </div>
      <fieldset className="field">
        <legend>Working days</legend>
        <div className="choice-row">
          {DAYS.map(([n, label]) => (
            <Checkbox key={n} label={label} checked={s.workingDays.includes(n)} onChange={(e) => setS({ workingDays: e.target.checked ? [...s.workingDays, n].sort() : s.workingDays.filter((d) => d !== n) })} />
          ))}
        </div>
      </fieldset>
      <Checkbox label="Send managers a weekly summary email on Monday mornings" checked={s.digestEnabled} onChange={(e) => setS({ digestEnabled: e.target.checked })} />
      <ErrorAlert error={save.error} />
      <Button type="submit" busy={save.isPending}>Save settings</Button>
    </form>
  );
}

function Glossary({ org, onSaved }) {
  const [rows, setRows] = useState(org.glossary?.length ? org.glossary : [{ term: '', meaning: '' }]);
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.put('/api/orgs/current/glossary', { glossary: rows.filter((r) => r.term.trim() && r.meaning.trim()) }),
    onSuccess: () => {
      toast('Glossary saved');
      onSaved();
    },
  });
  const update = (i, patch) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="muted">Your own abbreviations and project names. People with the &ldquo;Abbreviations explained&rdquo; rule see the meaning the first time each one appears.</p>
      {rows.map((row, i) => (
        <div className="inline-form" key={i} style={{ marginBottom: '0.5rem' }}>
          <TextInput label={`Term ${i + 1}`} value={row.term} onChange={(e) => update(i, { term: e.target.value })} maxLength={40} />
          <TextInput label="Meaning" value={row.meaning} onChange={(e) => update(i, { meaning: e.target.value })} maxLength={200} />
          <Button variant="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={`Remove term ${i + 1}`}>Remove</Button>
        </div>
      ))}
      <div className="actions">
        <Button variant="secondary" onClick={() => setRows((r) => [...r, { term: '', meaning: '' }])}>Add a term</Button>
        <Button type="submit" busy={save.isPending}>Save glossary</Button>
      </div>
      <ErrorAlert error={save.error} />
    </form>
  );
}

function SlackPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const { features } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['slack'], queryFn: () => api.get('/api/integrations/slack') });
  const connect = useMutation({ mutationFn: () => api.get('/api/integrations/slack/install-url'), onSuccess: (res) => window.location.assign(res.url) });
  const sync = useMutation({ mutationFn: () => api.post('/api/integrations/slack/sync-users'), onSuccess: (res) => toast(`${res.linked} people linked to Slack`) });
  const disconnect = useMutation({ mutationFn: () => api.del('/api/integrations/slack'), onSuccess: () => qc.invalidateQueries({ queryKey: ['slack'] }) });
  if (isLoading) return <Loading />;
  const status = params.get('slack');
  return (
    <>
      {status === 'connected' && <Alert tone="success">Slack is connected.</Alert>}
      {status === 'error' && <Alert tone="danger">Slack could not be connected ({params.get('reason')}). Please try again.</Alert>}
      {!features.slack && <Alert>Slack is part of the Professional and Enterprise plans.</Alert>}
      {!data.configured ? (
        <Alert tone="warning" title="Slack is not set up on the server yet">
          <p>Create the Slack app from <code>slack-app-manifest.yml</code> in the project folder, then add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET to the .env file and restart the server.</p>
        </Alert>
      ) : data.connected ? (
        <>
          <p>
            <Badge tone="success">Connected</Badge> to the <strong>{data.installation.teamName}</strong> workspace.
          </p>
          <p className="muted">Add the BarrierFix app to the channels where tasks are given. When a manager @mentions someone with an agreed profile, only the manager sees a preview and must confirm before it is sent. Managers can also use <code>/brief @person</code> or the &ldquo;Create structured task&rdquo; message shortcut.</p>
          <div className="actions">
            <Button variant="secondary" busy={sync.isPending} onClick={() => sync.mutate()}>Link people by email</Button>
            <Button variant="danger" onClick={() => window.confirm('Disconnect Slack?') && disconnect.mutate()}>Disconnect</Button>
          </div>
        </>
      ) : (
        <Button busy={connect.isPending} disabled={!features.slack} onClick={() => connect.mutate()}>Add to Slack</Button>
      )}
      <ErrorAlert error={connect.error || sync.error || disconnect.error} />
      <details style={{ marginTop: '1rem' }}>
        <summary>Technical details for the Slack app</summary>
        <p className="small">Events request URL: <code>{data.eventsUrl}</code></p>
        <p className="small">OAuth redirect URL: <code>{data.redirectUrl}</code></p>
      </details>
    </>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { refresh, org: sessionOrg } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['org'], queryFn: () => api.get('/api/orgs/current') });
  const [key, setKey] = useState(0);
  useEffect(() => setKey((k) => k + 1), [data]);
  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['org'] });
    refresh();
  };
  return (
    <>
      <PageHeader title="Company settings" intro={`${sessionOrg.orgNumber ? `Organisation ID ${sessionOrg.orgNumber}. ` : ''}${sessionOrg.planLabel} plan. Plans are changed by SimpliAccess.`} />
      <Card title="Company and working hours"><CompanyForm key={`c${key}`} org={data.org} onSaved={onSaved} /></Card>
      <Card title="Company glossary"><Glossary key={`g${key}`} org={data.org} onSaved={onSaved} /></Card>
      <Card title="Slack"><SlackPanel /></Card>
    </>
  );
}
