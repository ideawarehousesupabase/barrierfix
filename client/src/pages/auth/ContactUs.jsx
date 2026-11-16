import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, ErrorAlert, TextArea, TextInput } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { AuthShell } from './AuthShell.jsx';

const EMPTY = { companyName: '', staffCount: '', sector: '', contactName: '', jobTitle: '', email: '', phone: '', message: '', website: '' };

// A company asks SimpliAccess for a BarrierFix account. We check the details, then set up the
// organisation and send the sign-in details to the person who asked (they become the company admin).
export default function ContactUs() {
  const [form, setForm] = useState(EMPTY);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/api/public/org-requests', { ...form, staffCount: form.staffCount ? Number(form.staffCount) : undefined });
      setSent(res.message);
      setForm(EMPTY);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Request an account for your organisation" footer={<Link to="/login">Already have an account? Sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Request sent" live>
          <p>{sent}</p>
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate>
          <p>Tell us about your organisation. We will check the details and set up your account. You will be the company admin, and you can then add your managers and HR.</p>
          <TextInput label="Organisation name" value={form.companyName} onChange={set('companyName')} autoComplete="organization" required />
          <TextInput label="Number of staff (optional)" type="number" min="1" value={form.staffCount} onChange={set('staffCount')} />
          <TextInput label="Sector (optional)" value={form.sector} onChange={set('sector')} />
          <TextInput label="Your name" value={form.contactName} onChange={set('contactName')} autoComplete="name" required />
          <TextInput label="Your job title (optional)" value={form.jobTitle} onChange={set('jobTitle')} autoComplete="organization-title" />
          <TextInput label="Work email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          <TextInput label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
          <TextArea label="Anything else we should know? (optional)" value={form.message} onChange={set('message')} rows={3} />
          {/* Hidden from people; automated spam fills it in, and those requests are dropped. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}>
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
          </div>
          <ErrorAlert error={error} />
          <Button type="submit" busy={busy} disabled={!form.companyName.trim() || !form.contactName.trim() || !form.email.trim()}>Send request</Button>
        </form>
      )}
    </AuthShell>
  );
}
