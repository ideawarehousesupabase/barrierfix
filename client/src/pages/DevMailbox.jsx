import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';

const TYPE = { VERIFY_EMAIL: 'Verify email', PASSWORD_RESET: 'Password reset', EMAIL_SIGNIN: 'Sign-in link' };

// Development only: what would have been emailed, plus Firebase emulator links.
export default function DevMailbox({ standalone = false }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dev-mailbox'], queryFn: () => api.get('/api/dev/mailbox'), refetchInterval: 5000 });
  useEffect(() => {
    document.title = 'Dev mailbox · BarrierFix';
  }, []);
  const body = (
    <>
      {standalone ? <h1>Dev mailbox</h1> : <PageHeader title="Dev mailbox" />}
      <Alert>
        <p>No real email is sent in development. Firebase verification and reset links appear here, together with the emails BarrierFix would send. {standalone && <Link to="/login">Back to sign in</Link>}</p>
      </Alert>
      <Button variant="secondary" size="small" onClick={() => refetch()}>Refresh</Button>
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <>
          <Card title="Firebase links (sign-up verification, password reset)">
            {!data.authLinks.length ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="list">
                {data.authLinks.map((l, i) => (
                  <li key={i} className="list-item">
                    <span>
                      <strong>{TYPE[l.type] || l.type}</strong> for {l.email}
                    </span>
                    <a href={l.link} target="_blank" rel="noreferrer">Open link</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="App emails">
            {!data.emails.length ? (
              <Empty>None yet.</Empty>
            ) : (
              data.emails.map((m) => (
                <details key={m.id} className="card inset">
                  <summary>
                    <strong>{m.subject}</strong> to {m.to} · {fmtDateTime(m.at)}
                  </summary>
                  <pre className="mail">{m.text}</pre>
                </details>
              ))
            )}
          </Card>
        </>
      )}
    </>
  );
  return standalone ? (
    <div className="content" id="main">
      {body}
    </div>
  ) : (
    body
  );
}
