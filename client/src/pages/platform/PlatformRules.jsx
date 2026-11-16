import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Loading, PageHeader, Select, TextArea, TextInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { fmtDate } from '../../lib/format.js';

const GROUPS = [
  ['task_structure', 'Task structure'],
  ['timing', 'Timing'],
  ['communication', 'Communication'],
  ['meetings', 'Meetings'],
  ['environment', 'Environment'],
  ['equipment', 'Equipment'],
];
const COST = [
  ['none', 'No cost'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
];

function RuleEditor({ rule, onSaved }) {
  const [form, setForm] = useState({ name: rule.name, summary: rule.summary, changes: rule.changes, neverChanges: rule.neverChanges, typicalCost: rule.typicalCost, costLevel: rule.costLevel, accessToWork: rule.accessToWork, active: rule.active, approved: rule.approved !== false, group: rule.group, reviewedBy: rule.reviewedBy, source: rule.source });
  const [open, setOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const versions = useQuery({ queryKey: ['platform', 'rule-versions', rule.code, rule.version], queryFn: () => api.get(`/api/platform/rules/${rule.code}/versions`), enabled: open && showVersions });
  const toast = useToast();
  const save = useMutation({
    mutationFn: (markReviewed) => api.patch(`/api/platform/rules/${rule.code}`, { ...form, markReviewed }),
    onSuccess: () => {
      toast(`${rule.code} saved`);
      onSaved();
    },
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="rule-card">
      <div className="spread">
        <h3>{rule.code}: {rule.name}</h3>
        <div className="row">
          <Badge tone={rule.type === 'record' ? 'neutral' : 'info'}>{rule.type}</Badge>
          {!rule.active && <Badge tone="warning">Retired</Badge>}
          {rule.active && rule.approved === false && <Badge tone="warning">Not approved</Badge>}
          <span className="muted small">v{rule.version}{rule.reviewedAt ? ` · reviewed ${fmtDate(rule.reviewedAt)}` : ' · not reviewed yet'}</span>
          <Button size="small" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>Edit</Button>
        </div>
      </div>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(false); }}>
          <TextInput label="Name" value={form.name} onChange={set('name')} />
          <TextArea label="Summary" value={form.summary} onChange={set('summary')} rows={2} />
          {rule.type !== 'record' && (
            <>
              <TextArea label="What it changes" value={form.changes} onChange={set('changes')} rows={2} />
              <TextArea label="What it never changes" value={form.neverChanges} onChange={set('neverChanges')} rows={2} />
            </>
          )}
          <div className="grid two">
            <TextInput label="Typical cost" value={form.typicalCost} onChange={set('typicalCost')} />
            <Select label="Cost level" value={form.costLevel} onChange={set('costLevel')} options={COST.map(([v, l]) => ({ value: v, label: l }))} />
            <TextInput label="Reviewed by" hint="e.g. the occupational psychologist's name" value={form.reviewedBy} onChange={set('reviewedBy')} />
            <TextInput label="Source" value={form.source} onChange={set('source')} />
          </div>
          <Checkbox label="Access to Work may fund this" checked={form.accessToWork} onChange={(e) => setForm((f) => ({ ...f, accessToWork: e.target.checked }))} />
          <Select label="Category" value={form.group} onChange={set('group')} options={GROUPS.map(([v, l]) => ({ value: v, label: l }))} />
          <Checkbox label="Approved (offered as an alternative in Decision Records)" checked={form.approved} onChange={(e) => setForm((f) => ({ ...f, approved: e.target.checked }))} />
          <Checkbox label="Active (shown in the library). Untick to retire it; its history is kept." checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          <div className="actions">
            <Button type="submit" busy={save.isPending}>Save</Button>
            <Button variant="secondary" onClick={() => save.mutate(true)}>Save and mark reviewed today</Button>
            <Button variant="ghost" onClick={() => setShowVersions(!showVersions)} aria-expanded={showVersions}>{showVersions ? 'Hide history' : 'Show history'}</Button>
          </div>
          <ErrorAlert error={save.error} />
          {showVersions && versions.data && (
            <ol>
              {versions.data.versions.map((v) => <li key={v.version}>Version {v.version}, {fmtDate(v.at)} by {v.by}: {v.snapshot.typicalCost || 'no cost recorded'}{v.snapshot.active === false ? ' (retired)' : ''}</li>)}
              {!versions.data.versions.length && <li className="muted">No earlier versions recorded.</li>}
            </ol>
          )}
        </form>
      )}
    </div>
  );
}

export default function PlatformRules() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'rules'], queryFn: () => api.get('/api/platform/rules'), enabled: isPlatformAdmin });
  const [form, setForm] = useState({ code: '', group: 'environment', name: '', summary: '', typicalCost: '', costLevel: 'none', accessToWork: false });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform', 'rules'] });
    qc.invalidateQueries({ queryKey: ['rules'] });
  };
  const create = useMutation({
    mutationFn: () => api.post('/api/platform/rules', form),
    onSuccess: () => {
      toast('Rule added');
      setForm({ code: '', group: 'environment', name: '', summary: '', typicalCost: '', costLevel: 'none', accessToWork: false });
      refresh();
    },
  });
  if (!isPlatformAdmin) return <Alert tone="danger">Platform admins only.</Alert>;
  if (isLoading) return <Loading />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="Adjustment library" intro="Edit wording, costs and review details. Rules that change tasks need engine code; new entries here are record-only." />
      <ErrorAlert error={error} />
      <Card title="Add a record-only rule">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="grid two">
            <TextInput label="Code" hint="Two letters and a number, e.g. EN9" value={form.code} onChange={set('code')} />
            <Select label="Group" value={form.group} onChange={set('group')} options={GROUPS.map(([v, l]) => ({ value: v, label: l }))} />
            <TextInput label="Name" value={form.name} onChange={set('name')} />
            <TextInput label="Typical cost" value={form.typicalCost} onChange={set('typicalCost')} />
          </div>
          <TextArea label="Summary" value={form.summary} onChange={set('summary')} rows={2} />
          <Checkbox label="Access to Work may fund this" checked={form.accessToWork} onChange={(e) => setForm((f) => ({ ...f, accessToWork: e.target.checked }))} />
          <ErrorAlert error={create.error} />
          <Button type="submit" busy={create.isPending} disabled={!form.code || !form.name || !form.summary}>Add rule</Button>
        </form>
      </Card>
      {GROUPS.map(([group, label]) => (
        <Card key={group} title={label}>
          <div className="stack">
            {(data?.rules || []).filter((r) => r.group === group).map((r) => <RuleEditor key={`${r.code}-${r.version}`} rule={r} onSaved={refresh} />)}
          </div>
        </Card>
      ))}
    </>
  );
}
