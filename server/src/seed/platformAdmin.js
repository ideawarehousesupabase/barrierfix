import { findFirebaseUserByEmail, upsertPasswordUser } from '../integrations/firebase.js';
import { User } from '../models/index.js';
import { generateTemporaryPassword } from '../utils/crypto.js';

// Platform admins (PLATFORM_ADMIN_EMAILS) belong to SimpliAccess, not to a company, and nobody can
// register an account, so they are created here. Returns the temporary password the first time (and
// whenever the Firebase account is missing), or null if the account already exists.
export async function ensurePlatformAdmin(emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  if (!email) return null;
  const existing = await findFirebaseUserByEmail(email);
  if (existing) {
    await User.updateOne({ email }, { $setOnInsert: { email, roles: [], status: 'active' }, $set: { firebaseUid: existing.uid } }, { upsert: true });
    return null;
  }
  const temporaryPassword = generateTemporaryPassword();
  const fb = await upsertPasswordUser({ email, password: temporaryPassword, displayName: 'Platform admin' });
  await User.updateOne(
    { email },
    { $setOnInsert: { email, roles: [], name: 'Platform admin' }, $set: { firebaseUid: fb.uid, status: 'active', mustChangePassword: true, temporaryPasswordSetAt: new Date() } },
    { upsert: true },
  );
  return temporaryPassword;
}
