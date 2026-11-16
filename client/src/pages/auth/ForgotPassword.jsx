import { sendPasswordResetEmail } from 'firebase/auth';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field } from '../../components/ui.jsx';
import { auth, authErrorMessage } from '../../lib/firebase.js';
import { AuthShell } from './AuthShell.jsx';

// Firebase emails the password reset link.
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/login?reset=1` });
      setSent(true);
    } catch (err) {
      // Do not reveal whether an account exists for this email.
      if (err.code === 'auth/user-not-found') setSent(true);
      else setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Reset your password" footer={<Link to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your email" live>
          <p>If an account exists for {email}, we have sent a link to choose a new password.</p>
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate>
          <p>Enter your email address and we will send you a link to choose a new password.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email address">{(a) => <input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <Button type="submit" busy={busy} disabled={!email}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
