import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { auth, authErrorMessage } from '../../lib/firebase.js';
import { AuthShell } from './AuthShell.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { refresh } = useAuth();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await cred.user.reload();
      if (!cred.user.emailVerified) return navigate('/verify-email');
      await refresh();
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          <p className="muted">Accounts are created by your company admin. If you do not have one yet, please ask them to set you up.</p>
          <p>
            New to BarrierFix? <Link to="/contact">Request an account for your organisation</Link>.
          </p>
        </>
      }
    >
      {params.get('verified') && <Alert tone="success">Your email address is verified. Please sign in.</Alert>}
      {params.get('reset') && <Alert tone="success">Your password was changed. Please sign in with your new password.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field label="Email address">{(a) => <input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">{(a) => <input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <div className="spread">
          <Button type="submit" busy={busy}>Sign in</Button>
          <Link to="/forgot-password">Forgotten your password?</Link>
        </div>
      </form>
    </AuthShell>
  );
}
