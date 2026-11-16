import { signInWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Field } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { auth, authErrorMessage } from '../../lib/firebase.js';
import { AuthShell } from './AuthShell.jsx';

// An admin gives each new person a temporary password. They must replace it before anything else.
export default function ChangePassword() {
  const { user, refresh, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (user && !user.mustChangePassword) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (password.length < 10) next.password = 'Use at least 10 characters';
    if (password !== confirm) next.confirm = 'The passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError('');
    try {
      const email = auth.currentUser.email;
      await updatePassword(auth.currentUser, password);
      // Changing a password revokes the older sign-in, so sign in again with the new one.
      await signInWithEmailAndPassword(auth, email, password);
      // The new token can be rejected for a moment if the two clocks differ by a second, so try again briefly.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await auth.currentUser.getIdToken(true);
          await api.post('/api/auth/password-changed');
          break;
        } catch (err) {
          if (err.status !== 401 || attempt >= 4) throw err;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.code === 'auth/requires-recent-login' ? 'For your security, please sign out, sign in again with your temporary password and then choose your new password.' : err.code ? authErrorMessage(err) : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Choose your own password" footer={<Button variant="ghost" onClick={signOut}>Sign out</Button>}>
      <p>You signed in with a temporary password. Please choose a new one that only you know before you continue.</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field label="New password" hint="At least 10 characters." error={errors.password}>{(a) => <input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Field label="Confirm new password" error={errors.confirm}>{(a) => <input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        <Button type="submit" busy={busy}>Save password and continue</Button>
      </form>
    </AuthShell>
  );
}
