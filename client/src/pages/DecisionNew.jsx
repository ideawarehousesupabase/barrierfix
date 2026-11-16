import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MedicalWarning } from '../components/MedicalWarning.jsx';
import { Alert, Button, Card, ErrorAlert, PageHeader, Select, TextArea, TextInput, useToast } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

// A short form: who it goes to, what you would like, and (optionally) more detail.
// An employee sends it to their line manager; a manager can also send one to someone in their team.
export default function DecisionNew() {
  const { user, hasRole } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const people = useQuery({ queryKey: ['directory'], queryFn: () => api.get('/api/users/directory') });
  const everyone = people.data?.users || [];
  const myManager = everyone.find((u) => String(u._id) === String(user.managerId));
  const team = hasRole('manager') ? everyone.filter((u) => String(u.managerId) === String(user._id)) : [];
  const options = [...(myManager ? [{ value: '', label: `${myManager.name} (my line manager)` }] : []), ...team.map((u) => ({ value: String(u._id), label: u.name }))];
  const [chosen, setChosen] = useState(params.get('employeeId') || '');
  // Whoever is picked, or else the first person this user can send to ('' means their line manager).
  const to = options.some((o) => o.value === chosen) ? chosen : options[0]?.value ?? '';
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const recipient = to ? team.find((u) => String(u._id) === to) : myManager;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { record } = await api.post('/api/decisions', { title, details, ...(to ? { employeeId: to } : {}) });
      toast(`Request sent to ${record.recipientName}`);
      navigate(`/decisions/${record._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New request" intro="Ask for a change in how work is done. They can accept or reject it. You do not need to share a diagnosis or any medical information." />
      <Card>
        {hasRole('hr') ? (
          <Alert tone="info">HR reviews adjustment requests but cannot send them.</Alert>
        ) : !people.isLoading && !options.length ? (
          <Alert tone="warning">You do not have a line manager yet. Ask your company admin to set one, then you can send a request.</Alert>
        ) : (
          <form onSubmit={submit}>
            {options.length > 1 ? (
              <Select label="Send to" value={to} onChange={(e) => setChosen(e.target.value)} options={options} />
            ) : (
              <p><strong>Send to:</strong> {recipient?.name || '…'}</p>
            )}
            <TextInput label="What would you like?" hint="For example: hold our weekly meeting on the ground floor." value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <TextArea label="Anything else they should know? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} />
            <MedicalWarning text={`${title} ${details}`} />
            <ErrorAlert error={error} />
            <Button type="submit" busy={busy} disabled={title.trim().length < 3}>Send request</Button>
          </form>
        )}
      </Card>
    </>
  );
}
