// Creates a Platform Admin sign-in:  npm run create-platform-admin -- someone@simpliaccess.co.uk
// The email must also be listed in PLATFORM_ADMIN_EMAILS. The temporary password is shown once.
import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { ensurePlatformAdmin } from './platformAdmin.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run create-platform-admin -- someone@example.com');
  process.exit(1);
}
if (!config.platformAdminEmails.includes(email)) {
  console.error(`${email} is not in PLATFORM_ADMIN_EMAILS. Add it to .env first, then run this again.`);
  process.exit(1);
}
await connectDatabase();
const password = await ensurePlatformAdmin(email);
console.log(password ? `Created ${email}.\nTemporary password (shown once): ${password}\nThey must choose their own password at first sign-in.` : `${email} already has an account. Nothing was changed. Use "Reset password" in the app if they are locked out.`);
await disconnectDatabase();
