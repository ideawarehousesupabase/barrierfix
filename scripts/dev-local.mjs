// Runs BarrierFix entirely on this computer, whatever .env points at: the Firebase Auth emulator,
// the embedded MongoDB, no Slack and no real email. Uses its own ports (web 5174, API 4100), so it
// can run next to `npm run dev:server` / `npm run dev:client` that use the real accounts.
//   npm run dev:local
import { spawn } from 'node:child_process';

// Values set here win over .env (dotenv and Vite never overwrite existing environment variables).
const local = {
  NODE_ENV: 'development',
  API_PORT: '4100',
  APP_URL: 'http://localhost:5174',
  API_PUBLIC_URL: 'http://localhost:4100',
  API_PROXY_TARGET: 'http://localhost:4100',
  MONGODB_URI: 'memory',
  FIREBASE_PROJECT_ID: 'demo-barrierfix',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-barrierfix.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-barrierfix',
  VITE_FIREBASE_APP_ID: 'demo-app-id',
  VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  PLATFORM_ADMIN_EMAILS: 'admin@simpliaccess.co.uk',
  SLACK_CLIENT_ID: '',
  SLACK_CLIENT_SECRET: '',
  SLACK_SIGNING_SECRET: '',
  SMTP_HOST: '',
};

const command = 'npx concurrently -k -n auth,api,web -c magenta,blue,green "npm:emulators" "npm run dev -w server" "npm run dev -w client -- --port 5174 --strictPort"';
const child = spawn(command, { shell: true, stdio: 'inherit', env: { ...process.env, ...local } });
child.on('exit', (code) => process.exit(code ?? 0));
