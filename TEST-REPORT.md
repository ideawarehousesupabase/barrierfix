# BarrierFix MVP: test report

**Date:** 11 November 2026, updated 19 November 2026 (client feedback, see the last section)
**Result:** 137 automated tests, 137 passing, 0 failing (`npm test`). Web app build passes (`npm run build`).
**Email (SMTP): not yet tested.** Emails are captured in the Dev mailbox instead; real delivery has not been tried.

## How it was tested

1. **Automated tests** (`node --test`, each file with its own in-memory database, a stubbed Firebase and, for Slack, a simulated Slack). They never read the developer `.env`, so a test run cannot reach the real database, Firebase, Slack or email.

   | File | Tests | What it covers |
   |---|---|---|
   | `engine.test.js` | 22 | Translation engine and Outcome Validator: deadlines, bank holidays, working-hours reminders, steps, abbreviations, missing details, priority, meaning checks, speed |
   | `api.test.js` | 27 | Accounts and forced password change, companies, the flow across roles, versioned question wording, drafts, CSV, plans, audit |
   | `requests.test.js` | 14 | Adjustment requests: both directions, accept, reject, HR review, six questions, HR final call, withdrawal, no-HR company, lists, versions, exports, reminders, conversion of older records |
   | `scope.test.js` | 30 | Every MVP feature against the scope: profiles, preview-before-send (form and CSV), tasks, meetings, reviews and their reminders, notifications, dashboards, settings, audit, digest, leaving, retention and erasure, health check |
   | `security.test.js` | 10 | Company data isolation (24 cross-company calls), role checks on 33 endpoints, injection-shaped input, mass assignment, lock-out, request size |
   | `slack.test.js` | 11 | Mention preview and confirm, `/brief`, the shortcut, missing details, employee buttons, a corrected task replacing the Slack message, edits and deletes, email matching, App Home, delivery failure |
   | `feedback.test.js` | 9 | Client feedback of 19 Nov 2026: requesting a rule from the Rule Library, correcting a task flagged as wrong, the manager's home page figures |
   | `realtime.test.js` | 5 | Live updates reach only the right people; closed accounts and suspended companies are cut off |
   | `slack-blocks`, `utils`, `evaluation` | 9 | Slack message layout, retry, log redaction, passwords, health check, the release gate on the evaluation test set |

2. **Browser pass** on a throwaway local copy (`npm run dev:local`: login emulator, local database, no Slack, no real email), signing in as each role in turn:
   - **Platform Admin:** contact-us form, approve request (Organisation ID BF-000006), Companies, Library admin, Decision prompts, Evaluation.
   - **Company admin:** first sign-in and password change, create manager and HR, edit roles, Company settings, Audit log.
   - **Manager:** create an employee in their own team, agree a profile, send a task (missing due date asked for, preview, send), Sent, Meetings, Reviews, record a signed decision.
   - **Employee:** build and send a profile, inbox, task actions (question, break down, confirm), new adjustment request (health-information warning).
   - **HR:** HR overview, People (no account creation), Adjustment requests, Audit log.
   - Phone width (375 px): no sideways scrolling.
   - **After the gap fixes (company admin):**
     - Send: Preview first, then "Send to …" or Cancel. Editing the text drops the preview and its draft.
     - CSV: upload shows each row's preview, then send or cancel.
     - People: the edit form on its own row, and recording a leaver and erasing their data.

## Problems found and fixed

Each fix (except the browser-only ones marked *) has a test that failed before the fix and passes now.

| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | High (privacy) * | After one person signed out and another signed in on the same browser, the second person briefly saw the first person's data (an employee's Adjustment Profile was shown to their manager). | All loaded data is cleared whenever the signed-in account changes. Checked in the browser. |
| 2 | High (security) | Live updates kept flowing to people whose account was deactivated, who had left, or whose company was suspended. Notifications include task text. | The live connection checks the account and company, and is closed straight away on deactivation, leaving or suspension. |
| 3 | High (engine) | A month used as a label became a deadline: "update the tracker with the October numbers" was sent as "Due Friday 1 October 2027", and the Outcome Check passed it. | A month on its own is never a deadline. "By October" is treated as vague, so the manager is asked when the profile needs a due date. "By the end of October" is the last working day of October. |
| 4 | Medium (engine) | Plain language, short sentences and abbreviation rules changed the wording but were missing from "Rules applied", the audit log and the per-rule analytics. | They are listed when they changed something, saying what changed. |
| 5 | Medium (engine) | Plurals such as "KPIs" were never explained, and common terms were missing. | Plurals are recognised. Added SLT, YTD, P&L, OKR(s), RFP, NDA. |
| 6 | Medium | HR's "Requests to decide" was empty while proposed declines and review requests were waiting for HR. | HR's list includes every proposed decline and every open review request. |
| 7 | Medium | Managers could not see the reviews coming up for profiles they agreed. | "Coming up" includes the team's reviews, with the employee's name. |
| 8 | Medium | The audit log did not say whose account was changed, reset or closed. | The person's email is recorded on those entries. |
| 9 | Medium | The test run read the developer `.env`, so it could reach real accounts once `.env` was filled in (32 tests failed). | Tests never read `.env`; a guard test checks this. |
| 10 | Medium | A task to someone at a company without Slack was marked "Slack failed" and raised a false alert. | Recorded as skipped, with no alert. |
| 11 | Low | Email was recorded as "sent" when no SMTP is set up. | Recorded as "not set up". |
| 12 | Low * | Small wording and accessibility issues. | Fixed: <ul><li>The password page now says "You signed in with a temporary password" (it wrongly said "Your company admin gave you…").</li><li>Rules in a profile that has not been sent say "Not sent yet".</li><li>Requests say "decider" until decided.</li><li>Decision prompt version 1 says "effective from the start", not "1 Jan" (1970).</li><li>HR's empty queue explains what will appear there.</li><li>Screen readers hear "Edit Emma Employee", not just "Edit".</li></ul> |

## Not yet tested

- **Email (SMTP):** not yet tested. Set the SMTP values in `.env`, then send a test from the app.
- **Slack with a real workspace:** the "Add to Slack" sign-in and real Slack events. The logic is tested against a simulated Slack only.
- **Production:** hosting, the `app.barrierfix.co.uk` domain and DNS. A live server must set `NODE_ENV=production`; otherwise the Dev mailbox, which shows every email to anyone signed in, stays switched on.
- **Web app screens:** there is no automated test framework for the web app (only for the server), so screens were checked by hand in the browser. Adding Vitest and Testing Library is recommended.

## Adjustment requests simplified (16 Nov 2026)

At the client's request, the six-factor Decision Record was replaced by a simple request flow:
1. An employee asks their manager, or a manager asks someone in their team, using a two-box form.
2. The other person accepts, or rejects with a comment.
3. **Accepted:** closed, and nothing else happens.
4. **Rejected:** goes to HR, who accepts the rejection, or sends it back for the six questions.
5. **After the six answers:** HR accepts the rejection, or rejects it, and the request is then accepted.

Checks:
- **Automated:** 13 tests in `requests.test.js`, all passing.
- **Browser, on the local copy:**
  - An employee's request went through rejection, HR sending it back, the manager's six answers and HR overturning the rejection, ending as "Accepted by HR".
  - A manager's request to an employee was accepted.
  - Older requests are converted automatically at start-up.
- **Bug found and fixed during the browser check:** a manager with no line manager of their own was shown "Send to: Emma", but the request would have gone to their own (missing) manager.

## Known gaps, now fixed

Each has tests that failed before the change and pass now (the People layout was checked in the browser).

| Gap | What changed |
|---|---|
| Web Send could skip the preview (MVP-024) | Send appears only after Preview and delivers exactly the previewed draft, once, by the person who made it. Changing the task or pressing Cancel removes the draft. The server refuses a web task that was not previewed (`preview_required`). |
| CSV upload sent straight away | Every row is previewed first (what the person will receive, and the outcome check). Rows with a problem show why. Then **Send** or **Cancel upload**. Rows needing a detail the profile requires (such as a due date) are not sent; the manager sends those from the form. |
| No reminder for unanswered reviews | One reminder, 3 days after a review opens (`REVIEW_REMINDER_DAYS`), to whoever has not answered yet. |
| A manager's "not practical" answer did nothing | The rule is flagged "may need to change" and the employee is told, so they can talk it through. Nothing is removed automatically. "With difficulty" does not flag it. |
| Deadline reminders counted plain hours | They count working hours, so they never fall in the evening, at a weekend or on a bank holiday (for example 2 hours before Monday 10am is Friday 4pm). The setting now reads "Working hours before the deadline", and existing databases pick up the new label at start-up. |
| No on-demand erasure (MVP-034) | **Erase their data now** on the People page for someone who has left (admin or HR). Their profile, adjustment requests with history, reviews, tasks, metrics and notifications are deleted, and the account becomes an anonymous placeholder. The audit log is kept and records the erasure without personal details. |
| No monitoring hook (MVP-036) | `/api/health` answers 200 only when the API and database work (503 otherwise), for a free uptime monitor such as UptimeRobot. Setting up the monitor account is a step for go-live (README, section 5). |
| People edit form cramped | The form opens on its own full-width row under the person. |

## Still open

- **Waiting for the client:** Google/Microsoft sign-in and people who belong to several organisations.
- **Go-live steps:**
  - Create the uptime monitor account.
  - Decide whether an error-tracking service (Sentry) is wanted; it was not part of this MVP.

## Client feedback changes (19 Nov 2026)

From `MVP feedback.docx`. Only these changes were made. The fourth item in the feedback summary, "UI changes", is postponed and has not been started.

1. **Request a rule from the Rule Library (employee).**
   - Each rule card has a **+** at the top right. A rule already in the profile shows its status there instead ("Agreed", "Waiting for agreement").
   - **+** opens a pop-up like the rule card on the profile page: the name with "Not saved yet", the summary, the group and type, any settings, and "Note (optional)".
   - **Save changes** sends the rule to the manager to agree (`POST /api/profiles/me/rules`). The profile and the rule then show "Waiting for agreement". Agreed rules keep applying until then.
   - Someone who has never agreed to BarrierFix applying rules is asked to tick that box in the pop-up first.
2. **Edit a task that was flagged as wrong (manager).**
   - When the employee flags a task, the sender's task page shows **Edit task** next to "Withdraw this task".
   - It opens a pop-up like the Send preview: the original brief on the left, and what the employee receives on the right, as boxes to edit.
   - **Send to {employee}** delivers the corrected version (`POST /api/briefs/:id/correct`):
     - it replaces the task in BarrierFix and in Slack, where the message is updated with its buttons back;
     - the employee is told, and checks it again;
     - it can be flagged and corrected again.
   - The layout of the agreed format cannot be changed, only the wording, and no part can be left empty. If a time is changed, the automatic reminders for the old time are switched off, and the conversation says so.
3. **Manager home page figures.** Three sections replace the old "Last 30 days" row, with the labels from the mock-up. They count the manager's own team only. "Pending" figures are what is waiting today; the others count the last 30 days. They are part of the Professional plan, like the row they replace.

Checks:
- **Automated:** 9 new tests in `feedback.test.js` and 1 in `slack.test.js`, written first and failing before the change, all passing now. The full suite passes (137).
- **Browser, on the local copy:**
  - An employee requested two rules from the library: an out-of-range setting was refused, and both rules then showed "Waiting for agreement" on the profile.
  - The pop-up closes with Escape and keyboard focus is kept. It fits a phone screen (375 px).
  - The manager's home figures matched a count taken straight from the database.
  - A task was sent, flagged by the employee, then corrected by the manager. Sending with no change was refused. The employee saw the corrected step, "checked and edited this version for you", and a notification.
