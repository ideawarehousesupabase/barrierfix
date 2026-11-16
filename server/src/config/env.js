import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '../..');
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

// One .env file at the project root is shared by the server and the client.
// Tests never read it: a test run must not reach the real database, Firebase, Slack or email,
// whatever the developer's .env points at. Tests set the few values they need themselves.
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const flag = (fallback) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['true', '1', 'yes'].includes(v.toLowerCase())));
const int = (fallback) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number.parseInt(v, 10)));
const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v.trim()));

const schema = z.object({
  NODE_ENV: str('development'),
  API_PORT: int(undefined),
  PORT: int(4000),
  APP_URL: str('http://localhost:5173'),
  API_PUBLIC_URL: str('http://localhost:4000'),
  APP_SECRET: str(),
  ENCRYPTION_KEY: str(),
  MONGODB_URI: str('memory'),
  FIREBASE_PROJECT_ID: str(),
  FIREBASE_CLIENT_EMAIL: str(),
  FIREBASE_PRIVATE_KEY: str(),
  FIREBASE_AUTH_EMULATOR_HOST: str(),
  PLATFORM_ADMIN_EMAILS: str(),
  DEFAULT_PLAN: z.enum(['starter', 'professional', 'enterprise']).optional().default('professional'),
  SMTP_HOST: str(),
  SMTP_PORT: int(587),
  SMTP_SECURE: flag(false),
  SMTP_USER: str(),
  SMTP_PASS: str(),
  EMAIL_FROM: str('BarrierFix <no-reply@simpliaccess.co.uk>'),
  SLACK_CLIENT_ID: str(),
  SLACK_CLIENT_SECRET: str(),
  SLACK_SIGNING_SECRET: str(),
  BRIEF_RETENTION_DAYS: int(30),
  RECORD_RETENTION_MONTHS_AFTER_EMPLOYMENT: int(18),
  REVIEW_RETENTION_MONTHS: int(24),
  DECISION_REMINDER_DAYS: int(3),
  REVIEW_REMINDER_DAYS: int(3),
  BANK_HOLIDAYS_URL: str('https://www.gov.uk/bank-holidays.json'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function secret(name, value) {
  if (value) return value;
  if (isProd) {
    console.error(`${name} must be set in production.`);
    process.exit(1);
  }
  if (!isTest) console.warn(`[config] ${name} is not set; using a temporary value for this run only.`);
  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  env: env.NODE_ENV,
  isProd,
  isTest,
  // API_PORT wins so dev tools that set PORT for the web app do not move the API;
  // hosting platforms that only set PORT still work.
  port: env.API_PORT || env.PORT,
  appUrl: env.APP_URL.replace(/\/$/, ''),
  apiPublicUrl: env.API_PUBLIC_URL.replace(/\/$/, ''),
  appSecret: secret('APP_SECRET', env.APP_SECRET),
  encryptionKey: secret('ENCRYPTION_KEY', env.ENCRYPTION_KEY),
  mongoUri: env.MONGODB_URI,
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    // .env files store the key on one line with literal \n sequences
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    emulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST,
  },
  platformAdminEmails: env.PLATFORM_ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  defaultPlan: env.DEFAULT_PLAN,
  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM,
  },
  slack: {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    signingSecret: env.SLACK_SIGNING_SECRET,
    enabled: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET),
  },
  decisions: {
    reminderDays: env.DECISION_REMINDER_DAYS,
  },
  reviews: {
    reminderDays: env.REVIEW_REMINDER_DAYS,
  },
  retention: {
    briefDays: env.BRIEF_RETENTION_DAYS,
    recordMonthsAfterEmployment: env.RECORD_RETENTION_MONTHS_AFTER_EMPLOYMENT,
    reviewMonths: env.REVIEW_RETENTION_MONTHS,
  },
  bankHolidaysUrl: env.BANK_HOLIDAYS_URL,
  dataDir: path.join(SERVER_DIR, '.data'),
};
