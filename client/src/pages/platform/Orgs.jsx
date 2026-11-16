import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Checkbox, ErrorAlert, Loading, PageHeader, Select, Stat, TextInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { fmtDate, pct } from '../../lib/format.js';

const PLANS = [
  ['starter', 'Starter'],
  ['professional', 'Professional'],
  ['enterprise', 'Enterprise'],
];

const EMPTY = { name: '', staffCount: '', plan: 'professional', adminName: '', adminEmail: '', adminAlsoHr: false, emailDetails: false };

// Companies and their first admin are created here: nobody can register a company themselves.
function CreateCompany({ onDone }) {
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState(null);
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/platform/orgs', {
        name: form.name,
        staffCount: form.staffCount ? Number(form.staffCount) : undefined,
        plan: form.plan,
        admin: { email: form.adminEmail, name: form.adminName, roles: form.adminAlsoHr ? ['hr'] : [], emailDetails: form.emailDetails },
      }),
    onSuccess: (res) => {
      toast(`${res.org.name} created`);
      setCreated({ company: res.org.name, email: res.admin.email, password: res.temporaryPassword });
      setForm(EMPTY);
      onDone();
    },
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <div className="grid two">
        <TextInput label="Company name" value={form.name} onChange={set('name')} required />
        <TextInput label="Number of staff (optional)" type="number" min="1" value={form.staffCount} onChange={set('staffCount')} />
        <TextInput label="First admin's name" value={form.adminName} onChange={set('adminName')} autoComplete="off" />
        <TextInput label="First admin's work email" type="email" value={form.adminEmail} onChange={set('adminEmail')} autoComplete="off" required />
        <Select label="Plan" value={form.plan} onChange={set('plan')} options={PLANS.map(([value, label]) => ({ value, label }))} />
      </div>
      <Checkbox label="The admin also acts as HR / Operations" checked={form.adminAlsoHr} onChange={(e) => setForm((f) => ({ ...f, adminAlsoHr: e.target.checked }))} />
      <Checkbox label="Also email the login details to the admin" checked={form.emailDetails} onChange={(e) => setForm((f) => ({ ...f, emailDetails: e.target.checked }))} />
      <ErrorAlert error={create.error} />
      {created && (
        <Alert tone="success" title={`${created.company} is ready`}>
          <p>
            Give {created.email} this temporary password: <strong className="mono">{created.password}</strong>
          </p>
          <p>It is shown only once. They choose their own password when they first sign in.</p>
        </Alert>
      )}
      <Button type="submit" busy={create.isPending} disabled={!form.name || !form.adminEmail}>Create company</Button>
    </form>
  );
}

// For a company whose only admin left or is locked out: add an admin, or give an existing one a new temporary password.
function CompanyAdmin({ org }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState(null);
  const save = useMutation({
    mutationFn: () => api.post(`/api/platform/orgs/${org._id}/admin`, { email, name }),
    onSuccess: (res) => {
      setResult({ email: res.admin.email, password: res.temporaryPassword });
      setEmail('');
      setName('');
    },
  });
  return (
    <div>
      <Button size="small" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>Add or reset admin</Button>
      {open && (
        <form style={{ marginTop: '0.5rem', minWidth: '16rem' }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <TextInput label="Admin's work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Someone already in this company gets the admin role and a new temporary password." />
          <TextInput label="Name (new accounts only)" value={name} onChange={(e) => setName(e.target.value)} />
          <ErrorAlert error={save.error} />
          {result && (
            <Alert tone="success" title={`Temporary password for ${result.email}`}>
              <p><strong className="mono">{result.password}</strong> (shown once; they choose their own at sign-in)</p>
            </Alert>
          )}
          <Button type="submit" size="small" busy={save.isPending} disabled={!email}>Save</Button>
        </form>
      )}
    </div>
  );
}

export default function Orgs() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api.get('/api/platform/overview'), enabled: isPlatformAdmin });
  const orgs = useQuery({ queryKey: ['platform', 'orgs'], queryFn: () => api.get('/api/platform/orgs'), enabled: isPlatformAdmin });
  const update = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/api/platform/orgs/${id}`, body),
    onSuccess: () => {
      toast('Company updated');
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
  });
  if (!isPlatformAdmin) return <Alert tone="danger">Platform admins only.</Alert>;
  if (orgs.isLoading || overview.isLoading) return <Loading />;
  const o = overview.data;
  return (
    <>
      <PageHeader title="Companies" intro="Every customer company. There is no payment gateway in the MVP: set each company's plan here when they subscribe." />
      {o?.newRequests > 0 && (
        <Alert tone="info" title={`${o.newRequests} new account request${o.newRequests === 1 ? '' : 's'}`}>
          <p><Link to="/platform/requests">Review company requests</Link> to approve or reject them.</p>
        </Alert>
      )}
      {o && (
        <div className="stats">
          <Stat label="Companies" value={o.orgs} />
          <Stat label="People" value={o.users} />
          <Stat label="Agreed profiles" value={o.profilesAgreed} />
          <Stat label="Slack connected" value={o.slackConnected} />
          <Stat label="Tasks (30 days)" value={o.kpis.tasksTranslated} />
          <Stat label="Meaning preserved" value={pct(o.kpis.meaningPreservedPct)} />
        </div>
      )}
      <ErrorAlert error={orgs.error || update.error} />
      <Card title="Create a company">
        <CreateCompany onDone={() => qc.invalidateQueries({ queryKey: ['platform'] })} />
      </Card>
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Created</th>
                <th scope="col">People</th>
                <th scope="col">Tasks (30 days)</th>
                <th scope="col">Slack</th>
                <th scope="col">Plan</th>
                <th scope="col">Status</th>
                <th scope="col">Admin</th>
              </tr>
            </thead>
            <tbody>
              {(orgs.data?.orgs || []).map((org) => (
                <tr key={org._id}>
                  <td><strong>{org.name}</strong><div className="muted small">{org.orgNumber}{org.sector ? ` · ${org.sector}` : ''}</div></td>
                  <td>{fmtDate(org.createdAt)}</td>
                  <td>{org.users}</td>
                  <td>{org.briefs30d}</td>
                  <td>{org.slackTeam || '–'}</td>
                  <td>
                    <label className="visually-hidden" htmlFor={`plan-${org._id}`}>Plan for {org.name}</label>
                    <select id={`plan-${org._id}`} value={org.plan} onChange={(e) => update.mutate({ id: org._id, body: { plan: e.target.value } })}>
                      {PLANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td>
                    <label className="visually-hidden" htmlFor={`status-${org._id}`}>Status for {org.name}</label>
                    <select id={`status-${org._id}`} value={org.status} onChange={(e) => update.mutate({ id: org._id, body: { status: e.target.value } })}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </td>
                  <td><CompanyAdmin org={org} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
