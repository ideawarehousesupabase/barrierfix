import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Loading } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { auth, authErrorMessage } from '../../lib/firebase.js';
import { AuthShell } from './AuthShell.jsx';

// Branded handler for Firebase email links. In the Firebase console set
// Authentication > Templates > Customise action URL to https://<your app>/auth/action
export default function AuthAction() {
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const code = params.get('oobCode');
  const [state, setState] = useState({ loading: true });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    if (!code) return setState({ error: 'This link is missing its code.' });
    if (mode === 'verifyEmail') {
      applyActionCode(auth, code)
        .then(async () => {
          await auth.currentUser?.reload();
          await refresh();
          setState({ done: 'Your email address is verified.' });
        })
        .catch((err) => setState({ error: authErrorMessage(err) }));
    } else if (mode === 'resetPassword') {
      verifyPasswordResetCode(auth, code)
        .then((email) => setState({ reset: true, email }))
        .catch((err) => setState({ error: authErrorMessage(err) }));
    } else setState({ error: 'This link is not recognised.' });
  }, [mode, code]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reset(e) {
    e.preventDefault();
    if (password.length < 10) return setState((s) => ({ ...s, fieldError: 'Use at least 10 characters' }));
    setBusy(true);
    try {
      await confirmPasswordReset(auth, code, password);
      navigate('/login?reset=1');
    } catch (err) {
      setState((s) => ({ ...s, formError: authErrorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={mode === 'resetPassword' ? 'Choose a new password' : 'Verify your email'} footer={<Link to="/login">Go to sign in</Link>}>
      {state.loading && <Loading label="Checking your link" />}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.done && <Alert tone="success" live>{state.done}</Alert>}
      {state.reset && (
        <form onSubmit={reset} noValidate>
          <p>Choose a new password for {state.email}.</p>
          {state.formError && <Alert tone="danger">{state.formError}</Alert>}
          <Field label="New password" hint="At least 10 characters." error={state.fieldError}>{(a) => <input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button type="submit" busy={busy}>Save new password</Button>
        </form>
      )}
    </AuthShell>
  );
}
