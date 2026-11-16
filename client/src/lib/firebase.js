import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

const app = initializeApp(firebaseConfigured ? config : { apiKey: 'missing', projectId: 'missing' });
export const auth = getAuth(app);

const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
export const usingEmulator = Boolean(emulatorUrl);
if (emulatorUrl) connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });

// Friendlier wording for the Firebase errors people actually see.
export function authErrorMessage(err) {
  const code = err?.code || '';
  const messages = {
    'auth/invalid-credential': 'That email and password do not match an account.',
    'auth/wrong-password': 'That email and password do not match an account.',
    'auth/user-not-found': 'That email and password do not match an account.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
    'auth/weak-password': 'Please choose a longer password (at least 10 characters).',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'We could not reach the sign-in service. Check your connection.',
    'auth/expired-action-code': 'This link has expired. Please ask for a new one.',
    'auth/invalid-action-code': 'This link has already been used or is not valid.',
  };
  return messages[code] || err?.message || 'Something went wrong. Please try again.';
}
