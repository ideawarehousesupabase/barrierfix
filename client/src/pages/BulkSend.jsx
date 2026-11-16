import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CsvUpload } from '../components/CsvUpload.jsx';
import { Alert, Badge, Button, Card, ErrorAlert, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';

const TEMPLATE = 'employee_email,brief_text,sent_at\njordan@example.com,"Can you send the invoice to Acme by Friday?",\n';

// Upload, check every row's preview, then send. Nothing reaches anyone until "Send" is pressed, and
// cancelling removes the previews.
export default function BulkSend() {
  const [rows, setRows] = useState(null); // previews from the upload
  const [sent, setSent] = useState(null); // results after sending
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  const ready = (rows || []).filter((r) => r.ok);
  const pendingRef = useRef([]);
  pendingRef.current = sent ? [] : ready.map((r) => r.draftId);
  // Leaving the page without sending removes the previews.
  useEffect(() => () => {
    if (pendingRef.current.length) api.post('/api/briefs/import/discard', { draftIds: pendingRef.current }).catch(() => {});
  }, []);

  async function call(kind, fn) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }

  const upload = (csv) =>
    call('upload', async () => {
      if (pendingRef.current.length) await api.post('/api/briefs/import/discard', { draftIds: pendingRef.current });
      setSent(null);
      setRows((await api.post('/api/briefs/import', { csv })).results);
    });

  const sendAll = () =>
    call('send', async () => {
      const { results } = await api.post('/api/briefs/import/send', { draftIds: ready.map((r) => r.draftId) });
      const byDraft = new Map(results.map((r) => [String(r.draftId), r]));
      setSent(ready.map((r) => ({ ...r, ...byDraft.get(String(r.draftId)) })));
    });

  const cancel = () =>
    call('cancel', async () => {
      if (ready.length) await api.post('/api/briefs/import/discard', { draftIds: ready.map((r) => r.draftId) });
      setRows(null);
    });

  return (
    <>
      <PageHeader title="Send tasks from a CSV" intro="Upload several tasks at once. Each row is translated for that person and shown to you first; nothing is sent until you check the previews and press Send." />
      <Card>
        <CsvUpload
          label="Tasks CSV"
          hint="Columns: employee_email, brief_text, and optionally sent_at (ISO date and time, used to work out relative deadlines such as 'by Thursday'). Up to 500 rows."
          template={TEMPLATE}
          templateName="tasks-template.csv"
          onUpload={upload}
          busy={busy === 'upload'}
          buttonLabel="Preview tasks"
        />
      </Card>
      <ErrorAlert error={error} />

      {rows && !sent && (
        <Card title={`Preview: ${ready.length} of ${rows.length} ready to send`}>
          {ready.length < rows.length && <Alert tone="warning">Rows that cannot be sent are listed with the reason. They will not be sent.</Alert>}
          <ul className="list">
            {rows.map((r) => (
              <li className="list-item" key={r.line}>
                <div>
                  <div className="title">
                    Row {r.line}: {r.name || r.email}
                  </div>
                  {r.ok ? (
                    <details>
                      <summary>{r.preview?.title || 'What they will receive'}</summary>
                      <pre className="preview-text">{r.preview?.text}</pre>
                    </details>
                  ) : (
                    <span className="check-fail">{r.reason}</span>
                  )}
                </div>
                {r.ok && <Badge tone={r.validatorPassed ? 'success' : 'warning'}>{r.validatorPassed ? 'Outcome check passed' : 'Original wording will be sent'}</Badge>}
              </li>
            ))}
          </ul>
          <div className="actions">
            {ready.length > 0 && (
              <Button busy={busy === 'send'} onClick={sendAll}>
                Send {ready.length} task{ready.length === 1 ? '' : 's'}
              </Button>
            )}
            <Button variant="ghost" busy={busy === 'cancel'} onClick={cancel}>
              Cancel upload
            </Button>
          </div>
        </Card>
      )}

      {sent && (
        <Card title={`Sent: ${sent.filter((r) => r.ok).length} of ${sent.length}`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Person</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name || r.email}</td>
                    <td>
                      {r.ok ? (
                        <>
                          <Badge tone={r.status === 'held' ? 'warning' : 'success'}>{r.status === 'held' ? 'Held for your check' : 'Delivered'}</Badge> <Link to={`/tasks/${r.briefId}`}>View</Link>
                        </>
                      ) : (
                        <span className="check-fail">{r.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
