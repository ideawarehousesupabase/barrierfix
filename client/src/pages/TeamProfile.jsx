import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, ErrorAlert, Loading, PageHeader, TextArea, useToast } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { PROFILE_STATUS, fmtDate } from '../lib/format.js';
import { paramsText, ruleStatus } from './MyProfile.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function TeamProfile() {
  const { hasRole } = useAuth();
  const { employeeId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [asking, setAsking] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['profile', employeeId], queryFn: () => api.get(`/api/profiles/${employeeId}`) });
  const act = useMutation({
    mutationFn: ({ action, body }) => api.post(`/api/profiles/${employeeId}/${action}`, body || {}),
    onSuccess: (res, { action }) => {
      qc.setQueryData(['profile', employeeId], res);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(action === 'agree' ? 'Profile agreed. BarrierFix will now apply it.' : 'Your comment was sent.');
      setAsking(false);
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  const p = data.profile;
  const status = PROFILE_STATUS[p.status] || PROFILE_STATUS.draft;

  return (
    <>
      <PageHeader
        title={`${p.employee.name}'s Adjustment Profile`}
        intro="Ways of working agreed with this person. It shows which rules apply, never why someone has them."
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Button variant="ghost" size="small" onClick={() => download(`/api/profiles/${employeeId}/export`, `adjustment-profile-${p.employee.name}.pdf`)}>Download PDF</Button>
          </>
        }
      />
      {!p.consent?.given && p.rules.length > 0 && <Alert tone="warning">This profile is paused by {p.employee.name}. Tasks reach them as written.</Alert>}
      {p.status === 'proposed' && p.canAgree && (
        <Card title="Waiting for your agreement">
          <p>Read the rules below. Agreeing means you will apply them, and BarrierFix will format tasks this way. Reviews are scheduled at 2, 6 and 12 weeks.</p>
          <div className="actions">
            <Button onClick={() => act.mutate({ action: 'agree' })} busy={act.isPending && act.variables?.action === 'agree'}>Agree profile</Button>
            <Button variant="secondary" onClick={() => setAsking(!asking)} aria-expanded={asking}>Talk about it first</Button>
          </div>
          {asking && (
            <form style={{ marginTop: '1rem' }} onSubmit={(e) => { e.preventDefault(); act.mutate({ action: 'request-changes', body: { comment } }); }}>
              <TextArea label="Message" hint="For example: can we talk about the check-in time on Monday?" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="submit" busy={act.isPending} disabled={comment.trim().length < 3}>Send message</Button>
            </form>
          )}
          <ErrorAlert error={act.error} />
        </Card>
      )}
      <Card title="Rules">
        {!p.rules.length && <p className="muted">No rules yet.</p>}
        <div className="stack">
          {p.rules.map((r) => (
            <div className="rule-card" key={r.code}>
              <div className="spread">
                <h3>{r.name}</h3>
                {ruleStatus(r)}
              </div>
              <p className="muted">{r.summary}</p>
              {r.paramDefs?.length > 0 && <p className="small">{paramsText(r.paramDefs, r.params)}</p>}
              {r.pending && <p className="small"><strong>Proposed change:</strong> {paramsText(r.paramDefs, r.pending.params)}{r.pending.note ? ` · Note: ${r.pending.note}` : ''}</p>}
              {r.note && <p className="small">Note: {r.note}</p>}
              <p className="small muted">{r.groupLabel}{r.agreedAt ? ` · agreed ${fmtDate(r.agreedAt)}` : ''}{r.nextReviewAt ? ` · next review ${fmtDate(r.nextReviewAt)}` : ''}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Who can see this profile">
        <ul>
          {p.accessList.map((a) => (
            <li key={a._id}>{a.name} <span className="muted">({a.reason})</span></li>
          ))}
        </ul>
      </Card>
      {!hasRole('hr') && <Link className="btn btn-secondary" to={`/decisions/new?employeeId=${employeeId}`}>Send a request to {p.employee.name}</Link>}
    </>
  );
}
