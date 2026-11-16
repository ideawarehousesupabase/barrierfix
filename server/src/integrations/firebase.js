import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config/env.js';

const APP_NAME = 'barrierfix';
let verifierOverride = null;

export function firebaseConfigured() {
  const f = config.firebase;
  return Boolean(f.emulatorHost || (f.projectId && f.clientEmail && f.privateKey));
}

function firebaseApp() {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  const { projectId, clientEmail, privateKey, emulatorHost } = config.firebase;
  if (emulatorHost) {
    // The Admin SDK reads this variable to talk to the local Auth emulator.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
    return initializeApp({ projectId: projectId || 'demo-barrierfix' }, APP_NAME);
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env (or FIREBASE_AUTH_EMULATOR_HOST for local development).');
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, APP_NAME);
}

export const firebaseAuth = () => getAuth(firebaseApp());

// Verifies a Firebase ID token from the browser. Tests can swap the verifier.
export async function verifyIdToken(token) {
  if (verifierOverride) return verifierOverride(token);
  return firebaseAuth().verifyIdToken(token);
}

export function setTokenVerifier(fn) {
  verifierOverride = fn;
}

// Tests can say when a password was changed (Firebase records this as "tokens valid after").
let passwordCheckOverride = null;
export function setPasswordChangeChecker(fn) {
  passwordCheckOverride = fn;
}

// Has this person replaced the temporary password? Changing a password revokes older tokens,
// so a "tokens valid after" time later than the moment the temporary password was set proves it.
export async function passwordChangedSince(uid, since) {
  if (passwordCheckOverride) return passwordCheckOverride(uid, since);
  if (verifierOverride) return true;
  const record = await firebaseAuth().getUser(uid);
  const validAfter = record.tokensValidAfterTime ? new Date(record.tokensValidAfterTime) : null;
  // The local Auth emulator does not always report this value.
  if (!validAfter) return Boolean(config.firebase.emulatorHost);
  return validAfter > since;
}

// Creates (or updates) the Firebase account for a person an admin has created. The admin supplies
// the temporary password; the account is marked verified because the admin vouches for the address.
export async function upsertPasswordUser({ email, password, displayName }) {
  if (verifierOverride) return { uid: `test-${email}` };
  const auth = firebaseAuth();
  try {
    const existing = await auth.getUserByEmail(email);
    return auth.updateUser(existing.uid, { password, emailVerified: true, displayName: displayName || existing.displayName });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    return auth.createUser({ email, password, emailVerified: true, displayName: displayName || undefined });
  }
}

export async function findFirebaseUserByEmail(email) {
  if (verifierOverride) return null;
  try {
    return await firebaseAuth().getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  }
}

// Removes the sign-in account entirely (used when a leaver's data is erased).
export async function deleteFirebaseUser(uid) {
  if (!uid || verifierOverride) return;
  try {
    await firebaseAuth().deleteUser(uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') console.warn('[firebase] could not delete user', err.message);
  }
}

export async function disableFirebaseUser(uid, disabled = true) {
  if (!uid || verifierOverride) return;
  try {
    await firebaseAuth().updateUser(uid, { disabled });
  } catch (err) {
    console.warn('[firebase] could not update user', err.message);
  }
}
