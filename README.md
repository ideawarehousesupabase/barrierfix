# BarrierFix MVP (SimpliAccess Ltd)

BarrierFix applies agreed workplace adjustments to everyday tasks. A manager writes a task as they normally would; BarrierFix rewrites it into the format the employee has agreed works for them (numbered steps, an exact deadline, a check-in), checks that the goal, deadline and deliverable have not changed, and delivers it in the web app and in Slack. Around that, it keeps the record-keeping side: Adjustment Profiles, simple adjustment requests between employees and managers (a rejection is reviewed by HR, who can ask for six questions to be answered), and reviews at 2, 6 and 12 weeks.

**MVP scope:** MERN stack · rule-based engine in place of AI · real data from forms and CSV · Firebase Authentication · Slack · no payment gateway (plans are set by a Platform Admin) · meetings are logged by hand (no calendar sync).

---

## Quick start (local development, no accounts needed)

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

`npm run dev` starts three things:

| Process | What it is |
|---|---|
| `auth` | Firebase **Auth emulator** on port 9099 (no Google account needed) |
| `api` | Express API on port 4000, with an **embedded MongoDB** saved in `server/.data/mongo` |
| `web` | React app (Vite) on port 5173 |

The first run downloads a MongoDB binary (about 600 MB, cached afterwards).

**Try it:** **nobody can register themselves.** Everyone signs in at the same address; the company is worked out from the account, never from the URL.
1. Start the app. The server prints the **Platform Admin's temporary password** once (for `PLATFORM_ADMIN_EMAILS`, `admin@simpliaccess.co.uk` in the dev `.env`). Sign in with it and choose your own password.
2. A company asks for an account with the **Request an account** form (`/contact`, linked from the sign-in page). Platform admins are told in the app and by email.
3. Under **Platform → Company requests**, check the details and **Approve**. This creates the company with its **Organisation ID** (BF-000001, BF-000002, ...) and makes the requester its **Company Admin**. Their temporary password is shown once, for you to pass on securely. **Reject** emails the requester instead. (Companies agreed outside the form can still be added under **Platform → Companies → Create a company**.)
4. The Company Admin signs in, chooses their own password, and creates **managers and HR** under **People** (one at a time, or by CSV). They can also add employees.
5. Each **manager** adds the **employees** in their own team under **People** (titled "Team accounts" for them). New employees always join that manager's team.
6. Every new person gets a temporary password and must replace it at first sign-in. Then they build their profiles, and so on.

Account rules:
- **Who creates accounts:** the Company Admin creates anyone; managers create employees for their own team only; HR does not create accounts.
- **Reset password** (People) gives a new temporary password. A Company Admin can reset anyone; a manager can reset the employees in their own team.
- If a company loses its only admin, or they are locked out, the Platform Admin uses **Platform → Companies → Add or reset admin**.
- Someone who uses **Forgotten your password?** instead of their temporary password is not asked to change it again.

Good to know in development:
- No real email is sent. Anything that would be emailed (alerts, review requests, the weekly digest, optional login details) and every Firebase reset link appears in the **Dev mailbox**.
- Emulator accounts disappear when the emulator stops. Restart the server to recreate the Platform Admin (a new temporary password is printed), then use **People → Reset password** for everyone else, or delete `server/.data` to start with an empty database.
- A Platform Admin sign-in is created automatically in development. In production run `npm run create-platform-admin -- someone@simpliaccess.co.uk` (the email must be in `PLATFORM_ADMIN_EMAILS`).
- Once `.env` points at the real Firebase, Atlas and Slack accounts, `npm run dev:local` still gives a throwaway copy for testing: the login emulator, the local database, no Slack and no real email, on http://localhost:5174 (API on port 4100). It can run next to `npm run dev:server`. The Platform Admin is `admin@simpliaccess.co.uk`; the temporary password is printed when it starts.
- The **Dev mailbox** shows every email to anyone who is signed in. It only exists while `NODE_ENV` is not `production`, so a live server must set `NODE_ENV=production`.

## When the client's Google account arrives

All configuration lives in the single `.env` file in this folder (see `.env.example` for every setting, with explanations). Nothing in the code needs to change.

### 1. Firebase Authentication (required)
1. Go to https://console.firebase.google.com with the client's Google account and **create a project**.
2. **Build → Authentication → Get started → Sign-in method:** enable **Email/Password**.
3. **Project settings → General → Your apps → Add app → Web.** Copy the config into:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
4. **Project settings → Service accounts → Generate new private key.** From the downloaded JSON copy:
   `FIREBASE_PROJECT_ID` (project_id), `FIREBASE_CLIENT_EMAIL` (client_email), `FIREBASE_PRIVATE_KEY` (private_key, keep the quotes and `\n`).
5. **Make both of these blank:** `FIREBASE_AUTH_EMULATOR_HOST` and `VITE_FIREBASE_AUTH_EMULATOR_URL`. That switches off the emulator.
6. **Authentication → Settings → Authorised domains:** add the live app domain (localhost is there already).
7. (Recommended) **Authentication → Templates:**
   - Set the sender name.
   - Under *Customise action URL*, enter `https://YOUR-APP-DOMAIN/auth/action`, so verification and password-reset links open BarrierFix's own branded pages.

Firebase sends the **forgot password** emails itself. There is no public sign-up: admins create the accounts (with a temporary password, already marked as verified).

**Stopping outside sign-ups.** The server already refuses any sign-in that does not match an account an admin created (it answers 403 `no_account`), so someone who calls Firebase's sign-up directly with the public web key gets an account that cannot use BarrierFix. To switch Firebase's own sign-up off as well, upgrade the project to **Identity Platform** (Authentication → Settings → User actions) and turn off **Enable create (sign-up)**. Ask the client whether they want that upgrade.

### 2. MongoDB Atlas (required for a live server)
Sign up at https://cloud.mongodb.com with the Google account. Create a cluster on **AWS, London (eu-west-2)** to keep data in the UK. Then add a database user, allow the server's IP under Network Access, and copy the connection string into `MONGODB_URI`.

### 3. Email (SMTP) for the app's own emails
These are alerts, review requests, the weekly digest and (only if an admin ticks the box) login details for new accounts. Login details contain the temporary password in plain text, so it is safer to hand the password over in person and leave that box unticked. Use any SMTP provider: Postmark, SendGrid, Amazon SES, or Google Workspace SMTP.
- Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`.
- Verify the sending domain (SPF/DKIM) with the provider.

### 4. Slack (optional, Professional and Enterprise plans)
1. Edit `slack-app-manifest.yml` and replace `YOUR-API-DOMAIN` with the API's public HTTPS address. In development, use a tunnel such as `ngrok http 4000`.
2. Go to https://api.slack.com/apps → **Create New App → From an app manifest** and paste the file.
3. Copy the **Client ID, Client Secret and Signing Secret** into `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`. Set `API_PUBLIC_URL` to the same public address.
4. In BarrierFix, a company admin goes to **Company settings → Slack → Add to Slack**. Then add the BarrierFix app to the channels where work is given.

How tasks are captured in Slack (only by managers, HR and company admins):
- The **"Create structured task"** message shortcut (⋯ menu on any message, including DMs). It passes the exact message, asks who it is for, asks for any detail the person's profile requires and the message does not give (due date, due time, priority), then shows a **preview** with Edit, Confirm and Cancel. Nothing is sent until Confirm.
- The **`/brief @person …`** command, which shows the same private preview (Confirm, Edit, Cancel) before anything is sent.
- An **@mention** of a person with an agreed profile, in a channel the app has been added to. The manager (and nobody else) gets a **private preview** in the channel with **Confirm and send**, **Edit** and **Cancel**. If a required detail is missing, the preview lists it and offers **Add details** instead of Confirm. Nothing reaches the employee until the manager confirms, and an ignored preview is removed after a day.

Slack does not let any app read private conversations between two people, which is why the shortcut exists. Messages that do not mention someone with a profile are ignored and never stored.

**Installing and approving the app (workspace admin).**
1. A Slack workspace admin installs the app from the manifest (step 1 and 2 above) or from the direct install link the company admin gets under **Company settings → Slack → Add to Slack**.
2. If the workspace requires app approval, the admin approves it under **Manage apps → App Management Settings → Requests**. It needs the scopes in the manifest: `channels:history`, `groups:history`, `chat:write`, `im:write`, `commands`, `users:read`, `users:read.email`.
3. Each person is matched to their BarrierFix account by their Slack email address the first time they use Slack, so create their BarrierFix account with the same email.
4. Test in a free Slack workspace before the pilot: the Slack flow has been written against Bolt 4 and its logic is covered by tests, but it has not yet been run against a live workspace.

### 5. Uptime monitoring (recommended)
Create a free monitor at UptimeRobot or Better Stack for `https://YOUR-API-DOMAIN/api/health`, checking every 5 minutes. It answers 200 only when the API and its database are working, and 503 otherwise. It shows no personal data.

### 6. Before going live
- Generate new values for `APP_SECRET` and `ENCRYPTION_KEY`:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Set `NODE_ENV=production`, `APP_URL` and `API_PUBLIC_URL`, and `PLATFORM_ADMIN_EMAILS`.

## Production build

```bash
npm run build      # builds the React app into client/dist
npm start          # one Node server: API + the built web app
```

In production the Express server also serves the React app, so one service is enough.
- Host it in a UK region (for example AWS eu-west-2, Azure UK South or DigitalOcean London) to keep data in the UK, as the business plan requires.
- Hosting platforms that set `PORT` work as they are. Otherwise set `API_PORT`.

## Tests

```bash
npm test
```

The suite covers:
- **Engine:** the business plan's worked example, deadlines, bank holidays, the Outcome Validator catching changed meaning, priority detection, required-detail (missing field) detection, and speed.
- **API:** admin-created accounts and forced password change, company creation by the Platform Admin, the full flow across all roles, company data isolation, versioned prompts and the library, drafts and preview before sending, profile on/off, CSV import, plan gating, and the append-only audit log.
- **Utilities:** retry of temporary failures, log redaction and temporary password strength.
- **Adjustment requests:** `requests.test.js` covers the whole request flow.
- **Scope, security, Slack and live updates:** every MVP feature against the scope (`scope.test.js`), tenant isolation and access control (`security.test.js`), the Slack flows against a simulated Slack (`slack.test.js`), and the live-update connection (`realtime.test.js`). See `TEST-REPORT.md` for the last full run.
- **Release gate:** `samples/evaluation-test-set.csv` must keep 100% "meaning preserved" and catch every seeded change of meaning. This is the business plan's "any fall in the validator pass rate blocks a release".

## Roles

| Role | What they do |
|---|---|
| Employee | Builds and controls their Adjustment Profile, receives tasks in their format, confirms, asks, asks for smaller steps or flags a translation, requests adjustments, answers reviews |
| Manager | Agrees profiles, sends tasks (form, CSV, Slack, verbal instructions), checks held translations, sends and answers adjustment requests, answers the six questions when HR asks, logs meetings, sees the team view |
| HR / Operations | Firm-wide KPIs, reviews every rejected request (accept the rejection, or send it back for the six questions, then make the final call), exports requests, records leavers |
| Company Admin | Company settings, working hours and bank holidays, glossary, creating accounts (temporary passwords) and roles, switching profiles on and off, Slack connection, audit log |
| Platform Admin (SimpliAccess) | Creates companies and their first admin, plans (no payment gateway), the adjustment library, the decision prompts, evaluation runs |

## How the rule-based engine works (in place of AI)

`server/src/engine/` turns a brief into the employee's format in a few milliseconds, with every change traceable to a rule:

1. **Detect** whether a message is a task (request phrases, instructions, dates).
2. **Analyse:**
   - Split into tasks, steps and notes.
   - Find the goal and deliverable.
   - Resolve deadlines in the company's timezone, working hours and UK bank holidays. For example, "by Thursday" becomes Thursday 24 September at 5pm; "ASAP" is flagged, never guessed.
3. **Apply the agreed rules:**
   - Numbered steps, Done when, one task per message.
   - Exact deadline, check-in, reminder.
   - Plain language, short sentences, abbreviations, key details first.
4. **Outcome Validator:** eight checks, including goal, deadline and deliverable unchanged, nothing lost or invented, and negatives kept. A failure holds the translation: the employee gets the original wording and the manager is asked to check it.

To add AI later, put an LLM translator behind the same `translateBrief` output shape in `engine/index.js`. Its output can be checked with the same `validateCandidate` function the evaluation harness uses.

## Content the client's specialists should review

| File | Reviewer (per the business plan) |
|---|---|
| `server/src/content/ruleLibrary.js` | Occupational psychologist: rule wording, costs, Access to Work flags (also editable in **Platform → Library admin**) |
| `server/src/content/decisionFactors.js` | Employment law adviser: the six factor prompts and disclaimer (version 1). Later wording is kept as versions, with an effective date and change note, under **Platform → Decision prompts** |
| `server/src/content/reviewQuestions.js` | Review questions at 2, 6 and 12 weeks |
| `server/src/content/emailTemplates.js` | Email wording |

## Privacy and retention (business plan, Table 8)
- **No medical data:** profiles hold work-format rules only, and free-text fields warn if health terms are typed. Decision Record exports (PDF and CSV) replace health terms with "[health detail removed]"; HR can choose the full text, and that download is audited.
- **Retention periods:**

  | Data | Kept for |
  |---|---|
  | Task text | 30 days (MongoDB TTL), with text-free metrics kept for KPIs |
  | Review answers | 24 months |
  | Profiles and decision records (and their version history) | Employment plus 18 months, starting when HR records a leaver |
  | Audit log | 7 years, append-only |

- **Erasing sooner:** for someone who has left, an admin or HR can press **Erase their data now** on the People page. Their profile, adjustment requests (with history), reviews, tasks, task metrics and notifications are deleted at once, and the account becomes an anonymous placeholder so colleagues' records still make sense. The audit log is kept and records the erasure without personal details.
- Slack tokens are encrypted at rest (AES-256-GCM). Every company's data is scoped by `orgId` on every query.

## Project structure

```
barrierfix/
├─ .env / .env.example        one config file for server and client
├─ firebase.json              Auth emulator for development
├─ slack-app-manifest.yml     create the Slack app from this
├─ samples/                   CSV templates and the evaluation test set
├─ server/src/
│  ├─ config/                 env, plans and feature flags, constants
│  ├─ engine/                 rule-based translation engine and Outcome Validator
│  ├─ content/                reviewable wording (rules, factors, questions, emails)
│  ├─ models/                 MongoDB models
│  ├─ modules/                feature modules: auth, organizations, users, profiles,
│  │                          briefs, decisions, reviews, meetings, dashboard,
│  │                          integrations, audit, platform, meta
│  ├─ integrations/           Firebase, email, Slack, UK bank holidays
│  ├─ jobs/                   scheduler: prompts, reviews, weekly digest, retention
│  └─ services/               audit log, notifications, calendar
├─ server/test/               engine, API and release-gate tests
└─ client/src/                React app: pages per role, accessible UI components
```

## Client requirements
`REQUIREMENTS-TRACEABILITY.md` maps each of the client's 64 requirements (MVP-001 to MVP-064) to what was built and what is still to be checked against a live Slack workspace.

## Not in this MVP (by agreement)
AI rewriting, Microsoft Teams, payment gateway, calendar sync (meetings are logged by hand), single sign-on, Jira/Asana connectors, role-demand maps, and the cross-company effectiveness library.

## Note on OneDrive
This folder is inside OneDrive. Syncing `node_modules` and the live database in `server/.data` can slow things down or lock files. Either pause syncing for those folders or move the project outside OneDrive.
