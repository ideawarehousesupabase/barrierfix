import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtRelative } from '../lib/format.js';

export default function Notifications() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/api/notifications') });
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = (id) => api.post(`/api/notifications/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => readAll.mutate()} disabled={!data?.unread}>Mark all as read</Button>} />
      <Card>
        {isLoading && <Loading />}
        <ErrorAlert error={error} />
        {data && !data.notifications.length && <Empty>No notifications yet.</Empty>}
        <ul className="list">
          {(data?.notifications || []).map((n) => (
            <li key={n._id} className={`list-item ${n.readAt ? '' : 'notification-unread'}`}>
              <div>
                {n.link ? (
                  <Link className="title" to={n.link} onClick={() => !n.readAt && readOne(n._id)}>
                    {n.title}
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                {!n.readAt && <span className="visually-hidden"> (unread)</span>}
                {n.body && <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '0.2rem 0 0' }}>{n.body}</p>}
              </div>
              <span className="muted small">{fmtRelative(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
