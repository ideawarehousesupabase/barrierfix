import { sendEmailVerification } from 'firebase/auth';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { auth, authErrorMessage } from '../../lib/firebase.js';
import { AuthShell } from './AuthShell.jsx';

export default function VerifyEmail() {
  const { firebaseUser, status, refresh, signOut } = useAuth();
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');
  const navigate = useNavigate();
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'ready') return <Navigate to="/" replace />;

  async function check() {
    setBusy('check');
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) {
      await refresh();
      navigate('/', { replace: true });
    } else setMessage({ tone: 'warning', text: 'Your email address is not verified yet. Open the link in the email, then try again.' });
    setBusy('');
  }

  async function resend() {
    setBusy('resend');
    try {
      await sendEmailVerification(auth.currentUser, { url: `${window.location.origin}/login?verified=1` });
      setMessage({ tone: 'success', text: 'We sent a new verification email.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: authErrorMessage(err) });
    }
    setBusy('');
  }

  return (
    <AuthShell title="Check your email">
      <p>
        We sent a verification link to <strong>{firebaseUser?.email}</strong>. Open the link to confirm it is your email address, then come back here.
      </p>
      {message && <Alert tone={message.tone} live>{message.text}</Alert>}
      <div className="actions">
        <Button onClick={check} busy={busy === 'check'}>I have verified my email</Button>
        <Button variant="secondary" onClick={resend} busy={busy === 'resend'}>Send the email again</Button>
        <Button variant="ghost" onClick={signOut}>Use a different account</Button>
      </div>
    </AuthShell>
  );
}
