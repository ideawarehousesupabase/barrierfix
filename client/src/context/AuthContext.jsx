import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { auth } from '../lib/firebase.js';

const AuthContext = createContext(null);

// status: loading | signedOut | unverified | error | ready
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const lastUid = useRef(undefined);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  const loadSession = useCallback(async (user = auth.currentUser) => {
    if (!user) {
      setSession(null);
      setStatus('signedOut');
      return null;
    }
    if (!user.emailVerified) {
      setSession(null);
      setStatus('unverified');
      return null;
    }
    try {
      await user.getIdToken(true);
      const data = await api.get('/api/auth/session');
      setSession(data);
      setError(null);
      setStatus('ready');
      return data;
    } catch (err) {
      if (err.code === 'email_not_verified') setStatus('unverified');
      else {
        setError(err.message);
        setStatus('error');
      }
      return null;
    }
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        // A different person (or nobody) is now signed in on this browser: forget everything loaded for
        // the previous one, so their profile, tasks and notifications never show to the next person.
        if (lastUid.current !== undefined && lastUid.current !== (user?.uid || null)) queryClient.clear();
        lastUid.current = user?.uid || null;
        setFirebaseUser(user);
        loadSession(user);
      }),
    [loadSession, queryClient],
  );

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    queryClient.clear();
    setSession(null);
    setStatus('signedOut');
  }, [queryClient]);

  const value = useMemo(() => {
    const roles = session?.user?.roles || [];
    return {
      firebaseUser,
      session,
      status,
      error,
      user: session?.user || null,
      org: session?.org || null,
      features: session?.features || {},
      isPlatformAdmin: Boolean(session?.isPlatformAdmin),
      hasRole: (...r) => r.some((x) => roles.includes(x)),
      refresh: () => loadSession(auth.currentUser),
      setSession,
      signOut,
    };
  }, [firebaseUser, session, status, error, loadSession, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
