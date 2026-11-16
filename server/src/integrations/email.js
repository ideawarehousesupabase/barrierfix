import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

// Sends the app's own emails (optional login details, alerts, review requests, digests) over SMTP.
// Firebase sends the sign-up verification and password-reset emails itself.
// Without SMTP_HOST (local development) emails are kept in a Dev mailbox instead.
let transport = null;
const devMailbox = [];

function getTransport() {
  if (transport || !config.email.host) return transport;
  transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  return transport;
}

export const emailConfigured = () => Boolean(config.email.host);

export async function sendEmail({ to, subject, text, html }) {
  if (!to) return { skipped: true };
  const t = getTransport();
  if (!t) {
    devMailbox.unshift({ id: `${Date.now()}-${devMailbox.length}`, to, subject, text, html, at: new Date().toISOString() });
    devMailbox.splice(100);
    if (!config.isTest) console.log(`[email:dev] to=${to} subject="${subject}"`);
    return { dev: true };
  }
  try {
    const info = await t.sendMail({ from: config.email.from, to, subject, text, html });
    return { messageId: info.messageId };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return { error: err.message };
  }
}

export const getDevMailbox = () => devMailbox;
