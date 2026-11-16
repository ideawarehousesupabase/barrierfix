import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Checkbox, ErrorAlert, Field, Loading, PageHeader, Stat } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { pct } from '../lib/format.js';

export function RuleTable({ rules }) {
  if (!rules?.length) return <p className="muted">No review answers yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Answers</th>
            <th scope="col">Helping</th>
            <th scope="col">Partly</th>
            <th scope="col">Not helping</th>
            <th scope="col">Working</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <td>{r.name}</td>
              <td>{r.answers}</td>
              <td>{r.yes}</td>
              <td>{r.partly}</td>
              <td>{r.no}</td>
              <td>{pct(r.workingPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HrOverview() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard', 'hr'], queryFn: () => api.get('/api/dashboard/hr') });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fullText, setFullText] = useState(false);
  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  const k = data.kpis;
  const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to: `${to}T23:59:59` } : {}) }).toString();
  return (
    <>
      <PageHeader title="HR overview" intro="Adjustments across the company. No view ranks or scores individuals." actions={<Link className="btn btn-secondary" to="/decisions?scope=hr">Waiting for HR</Link>} />
      <Card title="Adjustment profiles and requests">
        <div className="stats">
          <Stat label="People" value={data.people} />
          <Stat label="Agreed profiles" value={data.profiles.agreed} />
          <Stat label="Profiles waiting for agreement" value={data.profiles.waitingForAgreement} />
          <Stat label="Open requests" value={data.decisions.open} />
          <Stat label="Rejections waiting for HR" value={data.decisions.waitingForHr} />
          <Stat label="Accepted" value={data.decisions.accepted} />
          <Stat label="Rejected" value={data.decisions.rejected} />
        </div>
      </Card>
      <Card title="Tasks in the last 30 days">
        <div className="stats">
          <Stat label="Tasks delivered" value={k.tasksTranslated} />
          <Stat label="Meaning preserved" value={pct(k.meaningPreservedPct)} hint="Plan target 99%" />
          <Stat label="Rated accurate by employees" value={pct(k.ratedAccuratePct)} hint="Plan target 80%" />
          <Stat label="Flagged as wrong" value={pct(k.flaggedPct)} hint="Plan target under 2%" />
          <Stat label="Held for a manager check" value={k.held} />
          <Stat label="Average processing" value={k.avgProcessingMs === null ? '–' : `${k.avgProcessingMs} ms`} hint="Plan target under 10 s" />
        </div>
      </Card>
      <Card title="Reviews">
        <div className="stats">
          <Stat label="Open reviews" value={data.reviews.open} />
          <Stat label="Overdue by a week" value={data.reviews.overdue} />
          <Stat label="Employee response rate" value={pct(data.reviews.responseRatePct)} hint="Plan target 70%" />
        </div>
      </Card>
      <Card title="Which rules are working">
        {data.analytics ? <RuleTable rules={data.rules} /> : <Alert>Firm-wide analytics by rule are part of the Enterprise plan.</Alert>}
      </Card>
      <Card title="Export adjustment requests">
        <div className="inline-form">
          <Field label="From">{(a) => <input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(a) => <input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Button onClick={() => download(`/api/decisions/export.csv?${query}${fullText ? '&full=1' : ''}`, 'adjustment-requests.csv')}>Download CSV</Button>
        </div>
        <Checkbox label="Include health details as typed (normally removed; this download is recorded in the audit log)" checked={fullText} onChange={(e) => setFullText(e.target.checked)} />
      </Card>
    </>
  );
}
