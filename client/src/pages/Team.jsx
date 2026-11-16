import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { PROFILE_STATUS } from '../lib/format.js';

export default function Team() {
  const { data, isLoading, error } = useQuery({ queryKey: ['team'], queryFn: () => api.get('/api/profiles/team') });
  return (
    <>
      <PageHeader title="My team" intro="The people you manage and the state of their Adjustment Profiles. Nobody is ranked or scored." />
      <Card>
        {isLoading && <Loading />}
        <ErrorAlert error={error} />
        {data && !data.team.length && <Empty>Nobody reports to you yet. Add the employees in your team under People.</Empty>}
        {data?.team.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Agreed rules</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Slack</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((m) => {
                  const s = PROFILE_STATUS[m.profile?.status || 'none'];
                  return (
                    <tr key={m._id}>
                      <td>
                        <Link to={`/team/${m._id}`}>{m.name}</Link>
                        {m.jobTitle && <div className="muted small">{m.jobTitle}</div>}
                      </td>
                      <td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {m.profile && !m.profile.consent && m.profile.agreed > 0 && <div className="muted small">Paused</div>}
                        {m.profile?.needsRevision && <div className="small check-fail">A review says a rule may need to change</div>}
                      </td>
                      <td>{m.profile?.agreed ?? 0}</td>
                      <td>{m.profile?.waiting ? `${m.profile.waiting} to agree` : '–'}</td>
                      <td>{m.slackLinked ? 'Linked' : 'Not linked'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
