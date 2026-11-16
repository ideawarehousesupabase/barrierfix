import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, ErrorAlert, Loading, PageHeader, Select, TextArea, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';

const PLANS = [
  { value: 'starter', label: 'Starter' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];
const STATUS = { new: { label: 'New', tone: 'info' }, approved: { label: 'Approved', tone: 'success' }, rejected: { label: 'Rejected', tone: 'neutral' } };

// One request from the "request an account" form: check it, then approve (creates the company and its admin) or reject.
function RequestCard({ request, onDone, onApproved }) {
  const [plan, setPlan] = useState('professional');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const toast = useToast();
  const approve = useMutation({
    mutationFn: () => api.post(`/api/platform/org-requests/${request._id}/approve`, { plan }),
    onSuccess: (res) => {
      // The approved request leaves the "New" list, so the page keeps the one-time password, not this card.
      onApproved(res);
      toast(`${res.org.name} created (${res.org.orgNumber})`);
      onDone();
    },
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/api/platform/org-requests/${request._id}/reject`, { note }),
    onSuccess: () => {
      toast('Request rejected and the requester told');
      onDone();
    },
  });
  const status = STATUS[request.status];
  return (
    <Card title={request.companyName} actions={<Badge tone={status.tone}>{status.label}</Badge>}>
      <dl className="grid two">
        <div><dt className="muted small">Contact</dt><dd>{request.contactName}{request.jobTitle ? `, ${request.jobTitle}` : ''}</dd></div>
        <div><dt className="muted small">Work email</dt><dd>{request.email}</dd></div>
        <div><dt className="muted small">Phone</dt><dd>{request.phone || '–'}</dd></div>
        <div><dt className="muted small">Staff and sector</dt><dd>{request.staffCount || '–'} staff{request.sector ? ` · ${request.sector}` : ''}</dd></div>
        <div><dt className="muted small">Received</dt><dd>{fmtDateTime(request.createdAt)}</dd></div>
        {request.reviewedAt && <div><dt className="muted small">Reviewed</dt><dd>{fmtDateTime(request.reviewedAt)}</dd></div>}
      </dl>
      {request.message && <p><strong>Message:</strong> {request.message}</p>}
      {request.decisionNote && <p><strong>Reason given:</strong> {request.decisionNote}</p>}
      {request.status === 'new' && (
        <>
          <div className="inline-form">
            <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} options={PLANS} />
            <Button busy={approve.isPending} onClick={() => window.confirm(`Create ${request.companyName} and make ${request.email} its company admin?`) && approve.mutate()}>Approve and create company</Button>
            <Button variant="ghost" aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>Reject</Button>
          </div>
          {rejecting && (
            <form onSubmit={(e) => { e.preventDefault(); reject.mutate(); }}>
              <TextArea label="Reason for the requester (optional, included in the email)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <Button type="submit" variant="danger" busy={reject.isPending}>Reject and email the requester</Button>
            </form>
          )}
          <ErrorAlert error={approve.error || reject.error} />
        </>
      )}
    </Card>
  );
}

export default function OrgRequests() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('new');
  const [approved, setApproved] = useState(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'org-requests', status], queryFn: () => api.get(`/api/platform/org-requests?status=${status}`), enabled: isPlatformAdmin });
  if (!isPlatformAdmin) return <Alert tone="danger">Platform admins only.</Alert>;
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform'] });
  return (
    <>
      <PageHeader title="Company requests" intro="Organisations that asked for a BarrierFix account through the request form. Check the details, then approve (this creates the company, its Organisation ID and its company admin) or reject." />
      <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'new', label: 'New requests' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
      {approved && (
        <Alert tone="success" title={`${approved.org.name} is ready (Organisation ID ${approved.org.orgNumber})`}>
          <p>
            Give {approved.admin.email} this temporary password securely: <strong className="mono">{approved.temporaryPassword}</strong>
          </p>
          <p>It is shown only once. They choose their own password when they first sign in, then add their managers and HR.</p>
        </Alert>
      )}
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (data?.requests || []).map((r) => <RequestCard key={`${r._id}-${r.status}`} request={r} onDone={refresh} onApproved={setApproved} />)}
      {!isLoading && !data?.requests?.length && <p className="muted">No requests here.</p>}
    </>
  );
}
