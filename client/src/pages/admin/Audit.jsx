import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, ErrorAlert, Loading, PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api, download } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';

export default function Audit() {
  const { features } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['audit'], queryFn: () => api.get('/api/audit?limit=300') });
  return (
    <>
      <PageHeader
        title="Audit log"
        intro="Every access and change, kept for 7 years. Entries cannot be edited or deleted."
        actions={features.auditExport && <Button variant="secondary" onClick={() => download('/api/audit/export.csv', 'audit-log.csv')}>Export CSV</Button>}
      />
      {!features.auditExport && <Alert>Exporting the audit log is part of the Enterprise plan.</Alert>}
      <Card>
        {isLoading && <Loading />}
        <ErrorAlert error={error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries || []).map((e) => (
                <tr key={e._id}>
                  <td>{fmtDateTime(e.at)}</td>
                  <td>{e.actorEmail}</td>
                  <td>{e.action.replace(/[._]/g, ' ')}</td>
                  <td className="small muted">{Object.keys(e.meta || {}).length ? JSON.stringify(e.meta).slice(0, 160) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
