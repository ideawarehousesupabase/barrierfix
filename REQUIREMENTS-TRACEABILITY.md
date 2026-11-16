# Requirements traceability

Client file: `REQUIREMENTS - 1 - translation engine & decision record.xlsx` (MVP-001 to MVP-064).
Status key: **Built** (done and covered by tests) · **Built, live check pending** (written and tested without Slack; needs a real Slack workspace) · **Different by agreement** · **Partly**.

**Two points to confirm with the client**
1. The sheet words MVP-016, 018 and 019 as AI requirements. This MVP is the no-AI package: the rule engine fills that role and its Outcome Validator checks the result. The output shape of `translateBrief` (`server/src/engine/index.js`) is the point where a language model can be added later.
2. Nothing in Slack has been run against a live workspace yet (MVP-001, 002, 038, 040).

## Translation engine (MVP-001 to MVP-040)

| ID | Requirement | Status | Where / notes |
|---|---|---|---|
| 001 | Installable Slack app | Built, live check pending | `slack-app-manifest.yml`, `integrations/slack/oauth.js` |
| 002 | "Create structured task" action on a message | Built, live check pending | Message shortcut `create_structured_task`, `integrations/slack/app.js` |
| 003 | Exact selected message passed to the backend | Built, live check pending | The raw message is kept in `Brief.slack.rawText`; a readable copy (names and links resolved) feeds the engine. The Slack text box holds up to 3,000 characters |
| 004 | Manager identified by Slack work identity | Built, live check pending | Slack ID matched to the account by email; only managers, HR and admins can create tasks |
| 005 | Determine or ask who receives the task | Built, live check pending | Person picker, pre-filled from an @mention |
| 006 | Multi-tenant separation | Built | `orgId` on every query; profile lookups now company-scoped; tests |
| 007 | Profiles linked to stable Slack user IDs | Built | `User.slackUserId` (email match, admin edit, CSV) |
| 008 | Operational work-format profile, no diagnosis | Built | Adjustment Profile; medical-term warning |
| 009 | Admins activate or deactivate profiles | Built | People → Edit → Switch profile off/on (admin or HR); audited |
| 010 | Numbered steps rule | Built | TS1 |
| 011 | Written instruction rule | Built | TS4 (new) |
| 012 | Deadline date rule | Built | TM4 (new): asks for a date if missing |
| 013 | Deadline time rule | Built | TM5 (new): asks for a time if only a day was given |
| 014 | Optional priority rule | Built | PR1 (new): priority is only what the manager says or chooses |
| 015 | Machine-readable rule taxonomy | Built | Rule codes in `engine/catalog.js` and `content/ruleLibrary.js` |
| 016 | Extract task facts (AI) | Different by agreement | Rule engine, no AI (see above) |
| 017 | One canonical task object | Built | `translateBrief` result (`tasks`, `summaries`, `missing`) drives validation, preview and delivery |
| 018 | Do not invent information | Built (rule engine) | Nothing is generated; the Validator holds anything that adds names, numbers, links or dates; priority and deadlines are never guessed |
| 019 | Preserve original meaning | Built (rule engine) | Outcome Validator, 8 checks; release-gate test |
| 020 | Deterministic rules engine | Built | `server/src/engine/` |
| 021 | Missing-field detection | Built | `engine/missing.js` |
| 022 | UK date/time handling | Built | Company timezone (default Europe/London), UK bank holidays |
| 023 | Missing-information form in Slack | Built, live check pending | Modal asks for date, time and priority |
| 024 | Complete preview before sending | Built (Slack live check pending) | Every route shows the manager a preview first and delivers exactly that preview. Slack: the shortcut (modal), an @mention and `/brief` (private message). Web form: Send appears only after Preview, and the server refuses a web task that was not previewed (`preview_required`). CSV upload: every row is previewed, then sent or cancelled together |
| 025 | Edit, confirm and cancel | Built, live check pending | Edit / Confirm and send / Cancel on every Slack preview; nothing is delivered until Confirm |
| 026 | Private delivery in Slack | Built, live check pending | Direct message with buttons; always also in the web inbox |
| 027 | Clear task card | Built | Every card starts with Task, Due and Priority (when given), whatever rules the employee agreed; steps when the TS1 rule is on |
| 028 | Access to original instruction | Built | "Show original" |
| 029 | No diagnosis disclosure | Built | No medical fields; free-text warnings |
| 030 | Role-based access | Built | Five roles; checked on every route |
| 031 | Encryption and secret management | Partly | Slack tokens AES-256-GCM; all secrets in `.env`. Encryption of the database at rest and HTTPS depend on MongoDB Atlas and the host |
| 032 | Workflow audit trail | Built | `brief.confirmed` (rules applied) and `brief.delivered`, with times and the manager |
| 033 | Data minimisation | Built | Task text deleted after 30 days; text-free metrics |
| 034 | Retention, deletion, anonymisation | Built | Retention sweep and TTLs, plus **Erase their data now** for people who have left (admin or HR, People page): profile, adjustment requests with history, reviews, tasks, metrics and notifications are deleted and the account becomes an anonymous placeholder. The audit log is kept (append-only, 7 years) and records the erasure without personal details |
| 035 | Error handling and retry | Built | Slack calls retried with back-off; a failed Slack message is recorded and the manager told; the task is still in the web inbox |
| 036 | Monitoring without sensitive logging | Built (monitor account to set up) | Structured, redacted logger (no task text, tokens or names). `/api/health` answers 200 only when the API and database work (503 otherwise), for an external uptime monitor such as UptimeRobot. An error-tracking service (Sentry) was not part of this MVP |
| 037 | Basic admin screen | Built | Platform (companies, library, prompts) and company People/Settings |
| 038 | Slack installation process documented | Built, live check pending | README, "Slack" section |
| 039 | Core workflow tests | Built | Core, missing-data, rule-engine safety and tenant-isolation tests |
| 040 | End-to-end pilot workflow | Pending | Needs a Slack test workspace |

## Decision Record (MVP-041 to MVP-064)

**Changed on 16 Nov 2026 at the client's request: a much simpler request flow.**
1. An employee asks their line manager, or a manager asks someone in their team, with a two-box form.
2. The other person accepts, or rejects with a comment.
3. Accepted: closed, and nothing else happens (the profile is not changed).
4. Rejected: HR either accepts the rejection, or sends it back. When it is sent back, whoever rejected answers the six questions, and HR then accepts the rejection or rejects it (the request then stands).
5. With no HR person in the company, a rejection is final. HR reviews requests but cannot send them.

The rows below show what that means for each original requirement.

| ID | Requirement | Status | Where / notes |
|---|---|---|---|
| 041 | Considering-decline workflow, no direct decline | Changed | A rejection is never final on one person's word: it always goes to HR (unless the company has no HR person) |
| 042 | Effectiveness prompt, reason required | Changed | Question 1 of 6, answered only when HR sends a rejection back; every answer is required |
| 043 | Practicability prompt, cannot be blank | Changed | Question 2 of 6, as above |
| 044 | Financial cost, estimate and basis | Changed | Question 3 of 6: one text answer (no separate estimate field) |
| 045 | Other cost and impact, or "none identified" | Changed | Question 4 of 6: one text answer |
| 046 | Employer resources | Changed | Question 5 of 6 |
| 047 | External assistance incl. Access to Work | Changed | Question 6 of 6; the question itself mentions Access to Work |
| 048 | Alternatives from the approved library | Removed | Not part of the simple flow |
| 049 | Indicative cost labelled as guidance | Built (library only) | Still shown in the Adjustment Library; no longer part of requests |
| 050 | Access to Work indicator, no eligibility claim | Built (library only) | As above |
| 051 | Reasons mandatory for a proposed decline | Changed | A rejection needs a comment; when HR sends it back, all six answers are required |
| 052 | Alternatives-considered record with reasons | Removed | Not part of the simple flow |
| 053 | Employee input, never invented | Built | Only what people type: the request, the comment, the six answers and HR's comments, each with who and when |
| 054 | Automatic HR notification, delivery status | Built | HR is notified of every rejection and of the six answers; in-app and email |
| 055 | HR review status | Changed | Rejected: with HR → (sent back) six questions to answer → with HR for a final decision → rejected / accepted by HR |
| 056 | Manager stays the decision-maker | Changed | The person who received the request answers it; HR makes the final call on a rejection |
| 057 | No automated legal conclusion | Built | Procedural wording only; the disclaimer is shown on every request and PDF |
| 058 | Maintainable prompts with versions | Built | Platform → Decision prompts: version, effective date, change note, history; each request keeps its version |
| 059 | Versioned, immutable record | Built | A full snapshot after every step; snapshots cannot be changed or deleted (except by retention or erasure) |
| 060 | Actors and timestamps | Built | Every request, answer, comment and HR step is attributed and timed |
| 061 | Follow-up for incomplete records | Built | Whoever must act next is reminded after `DECISION_REMINDER_DAYS`; a request never closes by itself |
| 062 | Adjustment Library management | Built | Create, edit, categorise, approve and retire; every change versioned and audited |
| 063 | Data minimisation in decision records | Built | Medical-term warning on every free-text box; PDF and CSV exports mask health terms unless HR asks for the full text (audited) |
| 064 | Decision Record acceptance tests | Built | `server/test/requests.test.js`: both directions, accept, reject, HR review, six questions, HR final call, withdrawal, no-HR company, lists, versions, exports, reminders, conversion of older records |
