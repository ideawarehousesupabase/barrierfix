import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorAlert, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { DECISION_STATUS, fmtDateTime } from '../lib/format.js';

const EMPTY = {
  waiting: 'Nothing is waiting for your answer.',
  mine: 'You have not sent or received any requests yet.',
  hr: 'No rejected requests are waiting for HR.',
  all: 'No requests yet.',
};

export default function Decisions() {
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  // HR reviews rejected requests and cannot send them. An HR person who is also someone's team member
  // can still be sent a request, so they keep the personal lists.
  const hr = hasRole('hr');
  const personal = hasRole('employee', 'manager');
  const tabs = [
    ...(personal ? [{ id: 'waiting', label: 'Waiting for me' }, { id: 'mine', label: 'My requests' }] : []),
    ...(hr ? [{ id: 'hr', label: 'Waiting for HR' }, { id: 'all', label: 'All requests' }] : []),
  ];
  const scope = tabs.some((t) => t.id === params.get('scope')) ? params.get('scope') : tabs[0]?.id || 'mine';
  const { data, isLoading, error } = useQuery({ queryKey: ['decisions', scope], queryFn: () => api.get(`/api/decisions?scope=${scope}`) });
  return (
    <>
      <PageHeader
        title="Adjustment requests"
        intro={hr ? 'Requests between employees and their managers. When one is rejected, HR reviews it here.' : 'Requests between you and your manager or team. The other person accepts or rejects; a rejection is reviewed by HR.'}
        actions={!hr && <Link className="btn btn-primary" to="/decisions/new">New request</Link>}
      />
      <Card>
        <Tabs label="Request lists" value={scope} onChange={(id) => setParams({ scope: id })} tabs={tabs} />
        {isLoading && <Loading />}
        <ErrorAlert error={error} />
        {data && !data.records.length && <Empty>{EMPTY[scope]}</Empty>}
        <ul className="list">
          {(data?.records || []).map((r) => (
            <li className="list-item" key={r._id}>
              <div>
                <Link className="title" to={`/decisions/${r._id}`}>{r.title}</Link>
                <div className="muted small">
                  From {r.requesterName} to {r.recipientName} · updated {fmtDateTime(r.updatedAt)}
                </div>
              </div>
              <Badge tone={DECISION_STATUS[r.status]?.tone || 'neutral'}>{DECISION_STATUS[r.status]?.label || r.statusLabel}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
