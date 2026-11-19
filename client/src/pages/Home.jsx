import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Badge, Card, ErrorAlert, Loading, PageHeader, Stat } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { PROFILE_STATUS } from '../lib/format.js';

function EmployeePanel({ data }) {
  const { hasRole } = useAuth();
  const p = data.profile;
  return (
    <Card title="Your work">
      <div className="stats">
        <Stat label="New tasks" value={data.newTasks} />
        <Stat label="Tasks to confirm" value={data.openTasks} />
        <Stat label="Reviews to answer" value={data.openReviews} />
        <Stat label="Requests in progress" value={data.openDecisions} />
      </div>
      {data.requestsToAnswer > 0 && (
        <Alert tone="info">
          <p>{data.requestsToAnswer} adjustment request(s) waiting for your answer. <Link to="/decisions?scope=waiting">Open them</Link></p>
        </Alert>
      )}
      {!p || !p.agreed ? (
        <Alert tone="info" title="Set up your Adjustment Profile">
          <p>Choose the ways of working that help you, such as numbered steps or exact deadlines. Once your manager agrees, BarrierFix applies them to every task you receive.</p>
          <Link className="btn btn-primary" to="/profile">Set up my profile</Link>
        </Alert>
      ) : (
        <p>
          Your profile: <Badge tone={PROFILE_STATUS[p.status]?.tone}>{PROFILE_STATUS[p.status]?.label}</Badge> with {p.agreed} agreed rule(s).
          {!p.consent && ' It is paused, so tasks are not being reformatted.'}
          {p.waiting > 0 && ` ${p.waiting} change(s) waiting for agreement.`}
          {p.needsRevision && ' One or more rules may need changing after a review.'} <Link to="/profile">View profile</Link>
        </p>
      )}
      <div className="actions">
        <Link className="btn btn-secondary" to="/inbox">Open my tasks</Link>
        {!hasRole('hr') && <Link className="btn btn-ghost" to="/decisions/new">Send a request</Link>}
      </div>
    </Card>
  );
}

// Figures for the manager's own team. "Pending" ones are what is waiting today.
function ManagerAnalytics({ a }) {
  const days = a.periodDays || 30;
  return (
    <>
      <h3 style={{ marginTop: '1rem' }}>Adjustment Decision Record (Last {days} days)</h3>
      <div className="stats">
        <Stat label="Rule approval pending" value={a.decisions.pending} />
        <Stat label="Rules agreed" value={a.decisions.agreed} />
        <Stat label="Rules declined" value={a.decisions.declined} />
        <Stat label="Pending HR decision" value={a.decisions.pendingHr} />
      </div>
      <h3>Tasks (Last {days} days)</h3>
      <div className="stats">
        <Stat label="Tasks delivered in agreed formats" value={a.tasks.delivered} />
        <Stat label="Questions pending" value={a.tasks.questionsPending} />
        <Stat label="Flagged tasks pending" value={a.tasks.flaggedPending} />
      </div>
      <h3>Reviews (Last {days} days)</h3>
      <div className="stats">
        <Stat label="Reviews pending" value={a.reviews.pending} />
        <Stat label="Reviews completed" value={a.reviews.completed} />
        <Stat label={`Upcoming reviews (next ${days} days)`} value={a.reviews.upcoming} />
      </div>
    </>
  );
}

function ManagerPanel({ data }) {
  const t = data.toDo;
  const items = [
    { n: t.heldTranslations, text: 'formatted task(s) waiting for your check', to: '/sent?tab=held' },
    { n: t.unansweredQuestions, text: 'question(s) from your team', to: '/sent' },
    { n: t.profilesToAgree, text: 'Adjustment Profile(s) to agree', to: '/team' },
    { n: t.decisionsToMake, text: 'adjustment request(s) waiting for your answer', to: '/decisions?scope=waiting' },
    { n: t.reviewsToAnswer, text: 'review question(s) to answer', to: '/reviews' },
  ].filter((i) => i.n > 0);
  return (
    <Card title="Your team" actions={<Link className="btn btn-primary" to="/send">Send a task</Link>}>
      <h3>To do</h3>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i.to + i.text}>
              <Link to={i.to}>
                {i.n} {i.text}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing is waiting for you.</p>
      )}
      <h3>People you manage</h3>
      {data.team.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Profile</th>
                <th scope="col">Agreed rules</th>
                <th scope="col">Tasks (30 days)</th>
                <th scope="col">Slack</th>
              </tr>
            </thead>
            <tbody>
              {data.team.map((m) => (
                <tr key={m._id}>
                  <td><Link to={`/team/${m._id}`}>{m.name}</Link></td>
                  <td><Badge tone={PROFILE_STATUS[m.profileStatus]?.tone}>{PROFILE_STATUS[m.profileStatus]?.label}</Badge>{m.profileStatus === 'agreed' && !m.consent && ' (paused)'}</td>
                  <td>{m.agreedRules}</td>
                  <td>{m.tasksTranslated30d}</td>
                  <td>{m.slackLinked ? 'Linked' : 'Not linked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nobody reports to you yet. Add the employees in your team under People.</p>
      )}
      {data.detailed && data.analytics && <ManagerAnalytics a={data.analytics} />}
    </Card>
  );
}

function AdminChecklist({ session }) {
  return (
    <Card title="Getting set up">
      <ol>
        <li><Link to="/admin/people">Create accounts for your colleagues</Link> (one at a time, or upload a CSV).</li>
        <li><Link to="/admin/settings">Check working hours and bank holidays</Link>; they decide default deadline times.</li>
        <li>{session.slack.connected ? `Slack is connected (${session.slack.teamName}).` : <Link to="/admin/settings">Connect Slack</Link>} {!session.slack.configured && <span className="muted small">(Slack keys are not set on the server yet.)</span>}</li>
      </ol>
    </Card>
  );
}

export default function Home() {
  const { user, org, hasRole, session, isPlatformAdmin } = useAuth();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard'), enabled: Boolean(org) });
  const name = (user?.name || '').split(' ')[0];

  if (!org && isPlatformAdmin) {
    return (
      <>
        <PageHeader title={`Hello${name ? `, ${name}` : ''}`} intro="You are signed in as a SimpliAccess platform admin." />
        <Card title="Platform">
          <p><Link to="/platform">Manage companies and plans</Link> · <Link to="/platform/rules">Adjustment library</Link> · <Link to="/platform/evaluation">Run an evaluation</Link></p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Hello${name ? `, ${name}` : ''}`} intro={`${org.name} · ${org.planLabel} plan`} />
      {dash.isLoading && <Loading />}
      <ErrorAlert error={dash.error} />
      {dash.data && (
        <>
          {hasRole('admin') && <AdminChecklist session={session} />}
          {hasRole('manager') && dash.data.manager && <ManagerPanel data={dash.data.manager} />}
          {hasRole('employee') && <EmployeePanel data={dash.data.employee} />}
          {hasRole('hr') && dash.data.hr && (
            <Card title="Across the company" actions={<Link className="btn btn-secondary" to="/hr">HR overview</Link>}>
              <div className="stats">
                <Stat label="People" value={dash.data.hr.people} />
                <Stat label="Agreed profiles" value={dash.data.hr.profiles.agreed} />
                <Stat label="Open requests" value={dash.data.hr.decisions.open} />
                <Stat label="Rejections waiting for HR" value={dash.data.hr.decisions.waitingForHr} />
              </div>
            </Card>
          )}
          {!hasRole('employee', 'manager', 'hr', 'admin') && <Alert>You have no role yet. Ask your company admin to give you one.</Alert>}
        </>
      )}
    </>
  );
}
