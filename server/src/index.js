import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import { refreshBankHolidays } from './integrations/bankHolidays.js';
import { emailConfigured } from './integrations/email.js';
import { firebaseConfigured } from './integrations/firebase.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { ensureOrgNumbers } from './models/Organization.js';
import { initSocket } from './realtime/socket.js';
import { ensurePlatformAdmin } from './seed/platformAdmin.js';
import { ensureRuleLibrary } from './seed/rules.js';
import { migrateOldRequests } from './modules/decisions/migrate.js';
import { withRetry } from './utils/retry.js';

await connectDatabase();
const library = await ensureRuleLibrary();
if (library.added) console.log(`[seed] added ${library.added} rules to the adjustment library`);
const numbered = await ensureOrgNumbers();
if (numbered) console.log(`[seed] gave ${numbered} existing compan${numbered === 1 ? 'y' : 'ies'} an Organisation ID`);
const converted = await migrateOldRequests();
if (converted) console.log(`[seed] converted ${converted} adjustment request(s) to the new request flow`);
await refreshBankHolidays();

// Nobody can register, so in development the Platform Admin accounts are created on start-up
// and the temporary password is printed once. In production use `npm run create-platform-admin`.
// It runs in the background and retries, because the Auth emulator may still be starting.
if (!config.isProd) {
  for (const email of config.platformAdminEmails) {
    withRetry(() => ensurePlatformAdmin(email), { attempts: 6, baseMs: 1500, isTransient: () => true })
      .then((password) => password && console.log(`[seed] Platform admin ${email} created. Temporary password (development only): ${password}`))
      .catch((err) => console.warn(`[seed] could not create platform admin ${email}: ${err.message}`));
  }
}

const app = createApp();
const server = http.createServer(app);
initSocket(server);

server.listen(config.port, () => {
  console.log(`[api] BarrierFix API listening on http://localhost:${config.port}`);
  console.log(`[api] Firebase: ${config.firebase.emulatorHost ? `emulator at ${config.firebase.emulatorHost}` : firebaseConfigured() ? `project ${config.firebase.projectId}` : 'NOT CONFIGURED (see .env.example)'}`);
  console.log(`[api] Email: ${emailConfigured() ? `SMTP ${config.email.host}` : 'Dev mailbox (no SMTP_HOST set)'}`);
  console.log(`[api] Slack: ${config.slack.enabled ? 'configured' : 'not configured (optional)'}`);
});
startScheduler();

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[api] ${signal} received, shutting down`);
  stopScheduler();
  server.close();
  await disconnectDatabase().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
