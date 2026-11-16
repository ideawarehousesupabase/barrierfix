import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { CsvUpload } from '../../components/CsvUpload.jsx';
import { Alert, Badge, Button, Card, Checkbox, ErrorAlert, Loading, PageHeader, Select, TextInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { PROFILE_STATUS, ROLE_LABELS } from '../../lib/format.js';

const ROLES = ['employee', 'manager', 'hr', 'admin'];
const TEMPLATE = 'name,email,roles,manager_email,job_title,slack_user_id\nJordan Lee,jordan@example.com,employee,priya@example.com,Account executive,\nPriya Shah,priya@example.com,manager,,Client services director,\n';
// A manager's file adds employees to their own team, so it has no roles or manager columns.
const TEAM_TEMPLATE = 'name,email,job_title,slack_user_id\nJordan Lee,jordan@example.com,Account executive,\n';

function RolePicker({ value, onChange, allowAdmin }) {
  return (
    <fieldset className="field">
      <legend>Roles</legend>
      <div className="choice-row">
        {ROLES.filter((r) => allowAdmin || r !== 'admin').map((r) => (
          <Checkbox key={r} label={ROLE_LABELS[r]} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
        ))}
      </div>
    </fieldset>
  );
}

// Shown once after an account is created or reset: the server never stores or shows it again.
function TemporaryPassword({ email, password }) {
  return (
    <Alert tone="success" title={`Temporary password for ${email}`}>
      <p>
        Give this to the person now: <strong className="mono">{password}</strong>
      </p>
      <p>It is shown only once. They will be asked to choose their own password when they first sign in.</p>
    </Alert>
  );
}

// A company admin creates anyone; a manager creates employees, who always join their own team.
function CreateAccountForm({ managers, isAdmin, managerOnly, onDone }) {
  const [form, setForm] = useState({ name: '', email: '', jobTitle: '', roles: ['employee'], managerId: '', emailDetails: false });
  const [created, setCreated] = useState(null);
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/api/users', managerOnly ? { ...form, roles: ['employee'], managerId: null } : { ...form, managerId: form.managerId || null }),
    onSuccess: (res) => {
      toast(`Account created for ${res.user.email}`);
      setCreated({ email: res.user.email, password: res.temporaryPassword });
      setForm({ name: '', email: '', jobTitle: '', roles: ['employee'], managerId: '', emailDetails: false });
      onDone();
    },
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <div className="grid two">
        <TextInput label="Full name" value={form.name} onChange={set('name')} autoComplete="off" />
        <TextInput label="Work email" type="email" value={form.email} onChange={set('email')} autoComplete="off" required />
        <TextInput label="Job title (optional)" value={form.jobTitle} onChange={set('jobTitle')} />
        {!managerOnly && <Select label="Line manager" value={form.managerId} onChange={set('managerId')} placeholder="No manager" options={managers.map((m) => ({ value: m._id, label: m.name }))} />}
      </div>
      {managerOnly ? (
        <Alert tone="info"><p>They join your team as an employee. Ask your company admin to add managers or HR.</p></Alert>
      ) : (
        <RolePicker value={form.roles} onChange={(roles) => setForm((f) => ({ ...f, roles }))} allowAdmin={isAdmin} />
      )}
      <Checkbox label="Also email the login details to this person" hint="The email contains the temporary password in plain text. Handing it over in person is safer." checked={form.emailDetails} onChange={(e) => setForm((f) => ({ ...f, emailDetails: e.target.checked }))} />
      <ErrorAlert error={create.error} />
      {created && <TemporaryPassword email={created.email} password={created.password} />}
      <Button type="submit" busy={create.isPending} disabled={!form.email || !form.roles.length}>Create account</Button>
    </form>
  );
}

function PersonRow({ person, people, isAdmin, canEdit, canReset, canErase, onChange, onReset }) {
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState(person.roles);
  const [managerId, setManagerId] = useState(person.managerId || '');
  const [slackUserId, setSlackUserId] = useState(person.slackUserId || '');
  const toast = useToast();
  const call = useMutation({
    mutationFn: ({ method = 'post', path = '', body }) => api[method](`/api/users/${person._id}${path}`, body),
    onSuccess: (res, vars) => {
      toast(vars.message);
      if (vars.path === '/reset-password') onReset({ email: person.email, password: res.temporaryPassword });
      setEditing(false);
      onChange();
    },
  });
  const setProfileActive = useMutation({
    mutationFn: (active) => api.patch(`/api/profiles/${person._id}/active`, { active }),
    onSuccess: (res, active) => {
      toast(active ? 'Profile switched on' : 'Profile switched off');
      onChange();
    },
  });
  const manager = people.find((p) => p._id === person.managerId);
  const status = PROFILE_STATUS[person.profile?.status || 'none'];
  const who = person.name || person.email;
  return (
    <Fragment>
    <tr>
      <td>
        <strong>{person.name || person.email}</strong>
        {!person.erasedAt && <div className="muted small">{person.email}</div>}
        {person.jobTitle && <div className="muted small">{person.jobTitle}</div>}
      </td>
      <td>{person.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
      <td>{manager?.name || '–'}</td>
      <td>
        <Badge tone={person.status === 'active' ? 'success' : 'neutral'}>{person.status}</Badge>
        {person.mustChangePassword && person.status === 'active' && <div className="muted small">has not signed in yet</div>}
        {person.erasedAt && <div className="muted small">data erased</div>}
      </td>
      <td>{person.slackUserId ? 'Linked' : '–'}</td>
      <td>
        <Badge tone={status.tone}>{status.label}</Badge>
        {person.profile && person.profile.active === false && <div><Badge tone="warning">Switched off</Badge></div>}
      </td>
      <td>
        {person.status === 'left' && !person.erasedAt && canErase && (
          <Button
            size="small"
            variant="danger"
            onClick={() =>
              window.confirm(`Erase ${who}'s data now? Their Adjustment Profile, adjustment requests, reviews and tasks are deleted straight away instead of after 18 months. This cannot be undone.`) &&
              call.mutate({ path: '/erase', body: {}, message: 'Their data has been erased' })
            }
          >
            Erase their data now<span className="visually-hidden"> for {who}</span>
          </Button>
        )}
        {person.status === 'left' && <ErrorAlert error={call.error} />}
        {person.status !== 'left' && (
          <div className="stack">
            {canEdit && <Button size="small" variant="secondary" onClick={() => setEditing(!editing)} aria-expanded={editing}>Edit<span className="visually-hidden"> {person.name || person.email}</span></Button>}
            {person.status === 'active' && canReset && (
              <Button
                size="small"
                variant="ghost"
                onClick={() => window.confirm(`Give ${person.name || person.email} a new temporary password? Their current password stops working.`) && call.mutate({ path: '/reset-password', body: {}, message: 'New temporary password created' })}
              >
                Reset password<span className="visually-hidden"> for {person.name || person.email}</span>
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
    {editing && (
      <tr className="edit-row">
        <td colSpan={7}>
          <form aria-label={`Edit ${who}`} onSubmit={(e) => { e.preventDefault(); call.mutate({ method: 'patch', body: { ...(isAdmin ? { roles } : {}), managerId: managerId || null, slackUserId: slackUserId || null }, message: 'Saved' }); }}>
            <h3 className="small-heading">Edit {who}</h3>
            {isAdmin && <RolePicker value={roles} onChange={setRoles} allowAdmin />}
            <Select label="Line manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} placeholder="No manager" options={people.filter((p) => p._id !== person._id).map((p) => ({ value: p._id, label: p.name || p.email }))} />
            <TextInput label="Slack user ID (optional)" hint="Usually linked automatically by email." value={slackUserId} onChange={(e) => setSlackUserId(e.target.value)} />
            <div className="actions">
              <Button type="submit" size="small" busy={call.isPending}>Save</Button>
              {isAdmin && (
                <Button size="small" variant="ghost" onClick={() => call.mutate({ method: 'patch', body: { status: person.status === 'disabled' ? 'active' : 'disabled' }, message: 'Account updated' })}>
                  {person.status === 'disabled' ? 'Reactivate' : 'Deactivate'}
                </Button>
              )}
              {person.profile && (
                <Button size="small" variant="ghost" onClick={() => setProfileActive.mutate(person.profile.active === false)}>
                  {person.profile.active === false ? 'Switch profile on' : 'Switch profile off'}
                </Button>
              )}
              <Button
                size="small"
                variant="danger"
                onClick={() => window.confirm(`Record that ${who} has left? Their account is closed and their records are kept for 18 months, then deleted. An admin or HR can erase them sooner.`) && call.mutate({ path: '/end-employment', body: {}, message: 'Employment ended' })}
              >
                Has left the company
              </Button>
            </div>
            <ErrorAlert error={call.error || setProfileActive.error} />
          </form>
        </td>
      </tr>
    )}
    </Fragment>
  );
}

export default function People() {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole('admin');
  const isHr = hasRole('hr');
  // Who does what here: an admin creates anyone; a manager creates and resets employees in their own team;
  // HR edits people and records leavers, but does not create accounts.
  const managerOnly = !isAdmin && hasRole('manager');
  const canCreate = isAdmin || managerOnly;
  const canEdit = isAdmin || isHr;
  const canResetFor = (person) => isAdmin || (managerOnly && person.managerId === user._id && person.roles.every((r) => r === 'employee'));
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/api/users') });
  const [importResult, setImportResult] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [emailDetails, setEmailDetails] = useState(false);
  const importCsv = useMutation({
    mutationFn: (csv) => api.post('/api/users/import', { csv, emailDetails }),
    onSuccess: (res) => {
      setImportResult(res);
      toast(`${res.created} added, ${res.updated} updated`);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const importProfiles = useMutation({ mutationFn: (csv) => api.post('/api/profiles/import', { csv }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['directory'] });
  };
  if (users.isLoading) return <Loading />;
  const people = users.data?.users || [];
  const managers = people.filter((p) => p.status !== 'left');

  return (
    <>
      <PageHeader
        title={managerOnly ? 'Team accounts' : 'People'}
        intro={
          managerOnly
            ? 'Create accounts for the employees in your team. Each person gets a temporary password from you and chooses their own when they first sign in.'
            : isAdmin
              ? 'Create accounts for managers, HR and employees, and set roles and line managers. People cannot register themselves: each person gets a temporary password and chooses their own when they first sign in.'
              : 'Everyone in the company. Accounts are created by your company admin, and managers add the employees in their own team.'
        }
      />
      {canCreate && (
        <Card title={managerOnly ? 'Add an employee to your team' : 'Create an account'}>
          <CreateAccountForm managers={managers} isAdmin={isAdmin} managerOnly={managerOnly} onDone={refresh} />
        </Card>
      )}
      {(canCreate || isHr) && (
        <Card title="Import from a CSV">
          {canCreate && (
            <>
              <CsvUpload
                label={managerOnly ? 'Team CSV' : 'People CSV'}
                hint={managerOnly ? 'Columns: name, email, job_title, slack_user_id. Everyone is added to your team as an employee.' : 'Columns: name, email, roles (employee; manager; hr; admin), manager_email, job_title, slack_user_id.'}
                template={managerOnly ? TEAM_TEMPLATE : TEMPLATE}
                templateName={managerOnly ? 'team-template.csv' : 'people-template.csv'}
                onUpload={(csv) => importCsv.mutate(csv)}
                busy={importCsv.isPending}
                buttonLabel="Import people"
              />
              <Checkbox label="Also email login details to new people" checked={emailDetails} onChange={(e) => setEmailDetails(e.target.checked)} />
              <ErrorAlert error={importCsv.error} />
        {importResult && (
          <Alert tone={importResult.skipped.length ? 'warning' : 'success'} title={`${importResult.created} added, ${importResult.updated} updated`}>
            {importResult.skipped.map((s, i) => <p key={i}>Row {s.line} ({s.email}): {s.reason}</p>)}
            {importResult.accounts?.length > 0 && (
              <>
                <p>Temporary passwords are shown only once. Copy them now.</p>
                <ul>
                  {importResult.accounts.map((a) => (
                    <li key={a.email}>{a.email}: <strong className="mono">{a.temporaryPassword}</strong></li>
                  ))}
                </ul>
              </>
            )}
          </Alert>
        )}
            </>
          )}
          {(isAdmin || isHr) && (
            <>
              {canCreate && <hr />}
        <CsvUpload
          label="Adjustment Profiles CSV (optional)"
          hint="Columns: employee_email, rule_code, params (key=value;key=value), note. Rules are added as proposals; each person reviews and agrees to them before anything applies."
          template={'employee_email,rule_code,params,note\njordan@example.com,TM2,daysBefore=1;time=12:00,\n'}
          templateName="profiles-template.csv"
          onUpload={(csv) => importProfiles.mutate(csv)}
          busy={importProfiles.isPending}
          buttonLabel="Import profile rules"
        />
        <ErrorAlert error={importProfiles.error} />
        {importProfiles.data && (
          <Alert tone={importProfiles.data.skipped.length ? 'warning' : 'success'} title={`${importProfiles.data.added} rule(s) proposed`}>
            {importProfiles.data.skipped.map((s, i) => <p key={i}>Row {s.line}: {s.reason}</p>)}
          </Alert>
        )}
            </>
          )}
        </Card>
      )}
      <Card title={managerOnly ? `Accounts in your team (${people.length})` : `Everyone (${people.length})`}>
        <ErrorAlert error={users.error} />
        {resetResult && <TemporaryPassword email={resetResult.email} password={resetResult.password} />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Roles</th>
                <th scope="col">Manager</th>
                <th scope="col">Account</th>
                <th scope="col">Slack</th>
                <th scope="col">Profile</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <PersonRow key={`${p._id}-${p.updatedAt}`} person={p} people={people} isAdmin={isAdmin} canEdit={canEdit} canReset={canResetFor(p)} canErase={isAdmin || isHr} onChange={refresh} onReset={setResetResult} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
