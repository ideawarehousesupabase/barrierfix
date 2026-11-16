import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
// The developer .env is ignored in tests (see config/env.js); this is the test Platform Admin.
process.env.PLATFORM_ADMIN_EMAILS = 'admin@simpliaccess.co.uk';
const { MongoMemoryServer } = await import('mongodb-memory-server');
const request = (await import('supertest')).default;

let mongo;
let app;
let models;
let jobs;
let reviewsService;

// Firebase is replaced by a stub: a bearer token "test:<email>" is a verified user.
before(async () => {
  mongo = await MongoMemoryServer.create();
  const { connectDatabase } = await import('../src/db/connect.js');
  await connectDatabase(mongo.getUri('barrierfix-test'));
  const { setTokenVerifier } = await import('../src/integrations/firebase.js');
  // Stands in for Firebase's record of when each person last changed their password.
  const { setPasswordChangeChecker } = await import('../src/integrations/firebase.js');
  setPasswordChangeChecker(async (uid, since) => (passwordChangedAt.get(uid) || 0) > since);
  setTokenVerifier(async (token) => {
    const email = String(token).replace(/^test:/, '');
    return { uid: `test-${email}`, email, email_verified: true };
  });
  const { ensureRuleLibrary } = await import('../src/seed/rules.js');
  await ensureRuleLibrary();
  const { createApp } = await import('../src/app.js');
  app = createApp();
  models = await import('../src/models/index.js');
  jobs = await import('../src/jobs/handlers.js');
  reviewsService = await import('../src/modules/reviews/service.js');
});

after(async () => {
  const { disconnectDatabase } = await import('../src/db/connect.js');
  await disconnectDatabase();
  await mongo.stop();
});

const as = (email) => {
  const auth = (r) => r.set('Authorization', `Bearer test:${email}`);
  return {
    get: (url) => auth(request(app).get(url)),
    post: (url, body = {}) => auth(request(app).post(url)).send(body),
    put: (url, body = {}) => auth(request(app).put(url)).send(body),
    patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
  };
};

const ADMIN = 'owner@acme.test';
const MANAGER = 'priya@acme.test';
const EMPLOYEE = 'jordan@acme.test';
const HR = 'hana@acme.test';
const PLATFORM = 'admin@simpliaccess.co.uk';
const ids = {};
const passwordChangedAt = new Map();

// The person replaces their temporary password in Firebase, then tells BarrierFix.
async function changePassword(email) {
  passwordChangedAt.set(`test-${email}`, new Date(Date.now() + 1));
  return as(email).post('/api/auth/password-changed');
}

// The admin creates the account with a temporary password; the person must change it at first login.
async function createPerson(creator, email, name, roles, managerId) {
  const res = await as(creator).post('/api/users', { email, name, roles, managerId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.status, 'active');
  assert.equal(res.body.user.mustChangePassword, true);
  assert.ok(res.body.temporaryPassword.length >= 12);
  const changed = await changePassword(email);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  return res.body.user._id;
}

test('people cannot register themselves or create a company', async () => {
  const stranger = await as('stranger@nowhere.test').get('/api/auth/session');
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, 'no_account');
  assert.equal(await models.User.countDocuments({ email: 'stranger@nowhere.test' }), 0);
  const org = await as('stranger@nowhere.test').post('/api/orgs', { name: 'Sneaky Ltd' });
  assert.ok([403, 404].includes(org.status));
  assert.equal(await models.Organization.countDocuments({ name: 'Sneaky Ltd' }), 0);
});

test('the platform admin creates a company and its first admin', async () => {
  const notPlatform = await as(ADMIN).post('/api/platform/orgs', { name: 'Nope Ltd', admin: { email: 'x@nope.test' } });
  assert.equal(notPlatform.status, 403);

  const created = await as(PLATFORM).post('/api/platform/orgs', { name: 'Acme Agency', staffCount: 45, admin: { email: ADMIN, name: 'Olu Owner', roles: ['hr'] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.org.name, 'Acme Agency');
  assert.ok(created.body.temporaryPassword.length >= 12);
  assert.deepEqual([...created.body.admin.roles].sort(), ['admin', 'hr']);
  assert.match(created.body.org.orgNumber, /^BF-\d{6}$/, 'every company gets a readable Organisation ID');
  ids.org = created.body.org._id;
  ids.orgNumber = created.body.org.orgNumber;

  const duplicate = await as(PLATFORM).post('/api/platform/orgs', { name: 'Again Ltd', admin: { email: ADMIN } });
  assert.equal(duplicate.status, 409);

  // First login: only the session and the password change are allowed until the password is replaced.
  const session = await as(ADMIN).get('/api/auth/session');
  assert.equal(session.status, 200);
  assert.equal(session.body.user.mustChangePassword, true);
  const blocked = await as(ADMIN).get('/api/users');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'password_change_required');
  const notYet = await as(ADMIN).post('/api/auth/password-changed');
  assert.equal(notYet.status, 409, 'claiming a change that Firebase has not seen is refused');
  assert.equal((await changePassword(ADMIN)).status, 200);
  const after = await as(ADMIN).get('/api/auth/session');
  assert.equal(after.body.user.mustChangePassword, false);
  assert.equal(after.body.features.translation, true);
  assert.equal((await as(ADMIN).post('/api/orgs', { name: 'Second' })).status, 404);
});

test('admin creates a manager, an employee and HR with temporary passwords', async () => {
  ids.manager = await createPerson(ADMIN, MANAGER, 'Priya Shah', ['manager']);
  ids.employee = await createPerson(ADMIN, EMPLOYEE, 'Jordan Lee', ['employee'], ids.manager);
  ids.hr = await createPerson(ADMIN, HR, 'Hana Reid', ['hr']);
  const session = await as(EMPLOYEE).get('/api/auth/session');
  assert.equal(session.body.user.status, 'active');
  assert.equal(session.body.user.managerId, ids.manager);
  assert.equal((await as(EMPLOYEE).post('/api/users', { email: 'x@acme.test', name: 'X' })).status, 403);
  assert.equal((await as(HR).post('/api/users', { email: 'dup@acme.test', name: 'D', roles: ['admin'] })).status, 403);
  assert.equal((await as(HR).post('/api/users', { email: 'hr.made@acme.test', name: 'H' })).status, 403, 'HR does not create accounts');
  assert.equal((await as(HR).post('/api/users/import', { csv: 'name,email\nH,hr.csv@acme.test\n' })).status, 403);
  assert.equal((await as(ADMIN).post('/api/users', { email: EMPLOYEE, name: 'Again' })).status, 409);
});

test('an admin or the line manager can reset a temporary password, which forces a new change', async () => {
  assert.equal((await as(HR).post(`/api/users/${ids.employee}/reset-password`, {})).status, 403, 'HR asks an admin instead');
  const reset = await as(MANAGER).post(`/api/users/${ids.employee}/reset-password`, {});
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(reset.body.temporaryPassword.length >= 12);
  assert.equal((await as(EMPLOYEE).get('/api/briefs?box=inbox')).status, 403);
  assert.equal((await changePassword(EMPLOYEE)).status, 200);
  assert.equal((await as(EMPLOYEE).get('/api/briefs?box=inbox')).status, 200);
  assert.equal((await as(EMPLOYEE).post(`/api/users/${ids.manager}/reset-password`, {})).status, 403);
  // HR or admin accounts: only a company admin can reset them.
  assert.equal((await as(HR).post(`/api/users/${ids.hr}/reset-password`, {})).status, 403);
  assert.equal((await as(ADMIN).post(`/api/users/${ids.hr}/reset-password`, {})).status, 200);
  await changePassword(HR);
});

test('a password changed with "Forgot your password" lifts the temporary-password block', async () => {
  await as(ADMIN).post(`/api/users/${ids.employee}/reset-password`, {});
  assert.equal((await as(EMPLOYEE).get('/api/auth/session')).body.user.mustChangePassword, true);
  // The person used the emailed reset link instead of the temporary password: Firebase records the change.
  passwordChangedAt.set(`test-${EMPLOYEE}`, new Date(Date.now() + 1));
  const session = await as(EMPLOYEE).get('/api/auth/session');
  assert.equal(session.body.user.mustChangePassword, false, 'they are not asked to change it a second time');
  assert.equal((await as(EMPLOYEE).get('/api/briefs?box=inbox')).status, 200);
});

test('employee proposes a profile and the manager agrees it', async () => {
  const edited = await as(EMPLOYEE).put('/api/profiles/me', { rules: [{ code: 'TS1' }, { code: 'TM1' }, { code: 'TM2', params: { daysBefore: 1, time: '12:00' } }, { code: 'MT1' }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.profile.status, 'draft');

  const warn = await as(EMPLOYEE).put('/api/profiles/me', { rules: [{ code: 'TS1', note: 'Because of my ADHD' }, { code: 'TM1' }, { code: 'TM2' }, { code: 'MT1' }] });
  assert.ok(warn.body.warning?.terms.includes('adhd'), 'medical terms are flagged');
  await as(EMPLOYEE).put('/api/profiles/me', { rules: [{ code: 'TS1' }, { code: 'TM1' }, { code: 'TM2' }, { code: 'MT1' }] });

  const submitted = await as(EMPLOYEE).post('/api/profiles/me/submit', { consent: true });
  assert.equal(submitted.body.profile.status, 'proposed');
  assert.ok(submitted.body.profile.accessList.some((a) => a.reason === 'Line manager'));

  const team = await as(MANAGER).get('/api/profiles/team');
  assert.equal(team.body.team[0].profile.waiting, 4);

  const agreed = await as(MANAGER).post(`/api/profiles/${ids.employee}/agree`);
  assert.equal(agreed.status, 200, JSON.stringify(agreed.body));
  assert.equal(agreed.body.profile.status, 'agreed');
  assert.equal(await models.Review.countDocuments({ employeeId: ids.employee }), 12);
});

test('manager sends a brief; employee receives it in their format and confirms', async () => {
  const text = "Can you pull together the Q3 review deck for Harbour & Co by Thursday? Use last quarter's as a base, add the new campaign numbers and flag anything that needs Sam's input.";
  const preview = await as(MANAGER).post('/api/briefs/preview', { employeeId: ids.employee, text });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.result.validator.passed, true);

  assert.equal((await as(EMPLOYEE).get('/api/briefs?box=inbox')).body.briefs.length, 0, 'a preview sends nothing');
  const sent = await as(MANAGER).post('/api/briefs', { draftId: preview.body.draftId });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.brief.status, 'delivered');
  ids.brief = sent.body.brief._id;

  const inbox = await as(EMPLOYEE).get('/api/briefs?box=inbox');
  assert.equal(inbox.body.briefs.length, 1);
  assert.equal(inbox.body.briefs[0].title, 'Pull together the Q3 review deck for Harbour & Co');

  const opened = await as(EMPLOYEE).get(`/api/briefs/${ids.brief}`);
  assert.equal(opened.body.brief.employeeStatus, 'seen');
  assert.ok(opened.body.brief.deliveredCards[0].text.includes('Steps:'));

  const confirmed = await as(EMPLOYEE).post(`/api/briefs/${ids.brief}/confirm`);
  assert.equal(confirmed.body.brief.employeeStatus, 'confirmed');
  const metric = await models.BriefMetric.findOne({ briefId: ids.brief });
  assert.equal(metric.confirmed, true);
  assert.equal(metric.validatorPassed, true);

  const asked = await as(EMPLOYEE).post(`/api/briefs/${ids.brief}/question`, { text: 'Which campaign numbers?' });
  assert.equal(asked.status, 200);
  const answered = await as(MANAGER).post(`/api/briefs/${ids.brief}/answer`, { text: 'The September ones.' });
  assert.equal(answered.body.brief.thread.length, 2);

  const broken = await as(EMPLOYEE).post(`/api/briefs/${ids.brief}/breakdown`);
  assert.ok(broken.body.brief.breakdown.result[0].items.length >= 3);

  const forbidden = await as(MANAGER).post(`/api/briefs/${ids.brief}/confirm`);
  assert.equal(forbidden.status, 403);
});

test('check-in prompts are sent when due', async () => {
  const before = await models.Notification.countDocuments({ userId: ids.employee, kind: 'checkin' });
  await jobs.processDuePrompts(new Date('2030-01-01'));
  const afterCount = await models.Notification.countDocuments({ userId: ids.employee, kind: 'checkin' });
  assert.equal(afterCount, before + 1);
});

test('another company cannot see this company\'s data', async () => {
  const other = await as(PLATFORM).post('/api/platform/orgs', { name: 'Other Ltd', admin: { email: 'boss@other.test' } });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  assert.equal(Number(other.body.org.orgNumber.slice(3)), Number(ids.orgNumber.slice(3)) + 1, 'Organisation IDs are numbered in order');
  // The Organisation ID never changes once given.
  const org = await models.Organization.findById(other.body.org._id);
  org.orgNumber = 'BF-999999';
  await org.save();
  assert.equal((await models.Organization.findById(other.body.org._id)).orgNumber, other.body.org.orgNumber);
  await changePassword('boss@other.test');
  const res = await as('boss@other.test').get(`/api/briefs/${ids.brief}`);
  assert.equal(res.status, 404);
  const profile = await as('boss@other.test').get(`/api/profiles/${ids.employee}`);
  assert.equal(profile.status, 404);
});

test('the platform admin can add or reset a company admin', async () => {
  assert.equal((await as(ADMIN).post(`/api/platform/orgs/${ids.org}/admin`, { email: 'second.admin@acme.test' })).status, 403);
  const added = await as(PLATFORM).post(`/api/platform/orgs/${ids.org}/admin`, { email: 'second.admin@acme.test', name: 'Sasha Admin' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.ok(added.body.admin.roles.includes('admin'));
  assert.equal(added.body.admin.orgId, ids.org);
  assert.ok(added.body.temporaryPassword.length >= 12);

  // A locked-out (or only) admin gets a new temporary password.
  const reset = await as(PLATFORM).post(`/api/platform/orgs/${ids.org}/admin`, { email: ADMIN });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(reset.body.temporaryPassword.length >= 12);
  assert.equal((await as(ADMIN).get('/api/auth/session')).body.user.mustChangePassword, true);
  await changePassword(ADMIN);

  const otherCompany = await as(PLATFORM).post(`/api/platform/orgs/${ids.org}/admin`, { email: 'boss@other.test' });
  assert.equal(otherCompany.status, 409, 'someone in another company cannot be made admin here');
  assert.ok(await models.AuditLog.exists({ action: 'platform.org_admin_added' }));
});


test('a company asks for an account through the contact form and the platform admin approves it', async () => {
  const form = { companyName: 'Blue Ocean Waves Centre Ltd', staffCount: 30, sector: 'Leisure', contactName: 'Mira Blue', jobTitle: 'Operations Director', email: 'Mira@BlueOcean.test', phone: '01234 567890', message: 'We would like to pilot BarrierFix.' };
  const sent = await request(app).post('/api/public/org-requests').send(form);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.match(sent.body.message, /thank you/i);
  const again = await request(app).post('/api/public/org-requests').send({ ...form, message: 'Updated message' });
  assert.equal(again.status, 201);
  assert.equal(await models.OrgRequest.countDocuments({ email: 'mira@blueocean.test' }), 1, 'a second request from the same email updates the first');
  const invalid = await request(app).post('/api/public/org-requests').send({ ...form, email: 'not-an-email' });
  assert.equal(invalid.status, 400);

  const bot = await request(app).post('/api/public/org-requests').send({ ...form, email: 'bot@spam.test', website: 'http://spam.test' });
  assert.equal(bot.status, 201, 'a bot gets the same answer');
  assert.equal(await models.OrgRequest.countDocuments({ email: 'bot@spam.test' }), 0, 'but nothing is stored');

  // Someone who already has an account gets the same answer, so the form never reveals who is a customer.
  const known = await request(app).post('/api/public/org-requests').send({ ...form, email: ADMIN });
  assert.equal(known.status, 201);
  assert.deepEqual(known.body, sent.body);

  assert.ok(await models.Notification.exists({ kind: 'org_request_new' }), 'platform admins are told in the app');
  const { getDevMailbox } = await import('../src/integrations/email.js');
  assert.ok(getDevMailbox().some((m) => m.to === 'mira@blueocean.test' && /received/i.test(m.subject)), 'the requester gets an acknowledgement');

  assert.equal((await as(ADMIN).get('/api/platform/org-requests')).status, 403);
  const list = await as(PLATFORM).get('/api/platform/org-requests?status=new');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const mira = list.body.requests.find((r) => r.email === 'mira@blueocean.test');
  assert.equal(mira.message, 'Updated message');
  assert.ok((await as(PLATFORM).get('/api/platform/overview')).body.newRequests >= 2);

  const approved = await as(PLATFORM).post(`/api/platform/org-requests/${mira._id}/approve`, { plan: 'starter' });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  assert.equal(approved.body.org.name, 'Blue Ocean Waves Centre Ltd');
  assert.equal(approved.body.org.plan, 'starter');
  assert.equal(approved.body.org.staffCount, 30);
  assert.match(approved.body.org.orgNumber, /^BF-\d{6}$/);
  assert.equal(approved.body.admin.email, 'mira@blueocean.test');
  assert.equal(approved.body.admin.name, 'Mira Blue');
  assert.deepEqual(approved.body.admin.roles, ['admin']);
  assert.ok(approved.body.temporaryPassword.length >= 12);
  const stored = await models.OrgRequest.findById(mira._id);
  assert.equal(stored.status, 'approved');
  assert.equal(String(stored.orgId), approved.body.org._id);
  assert.equal((await as(PLATFORM).post(`/api/platform/org-requests/${mira._id}/approve`, {})).status, 409, 'a request is approved once');
  assert.ok(await models.AuditLog.exists({ action: 'platform.org_request_approved' }));

  const fromCustomer = (await as(PLATFORM).get('/api/platform/org-requests?status=new')).body.requests.find((r) => r.email === ADMIN);
  assert.equal((await as(PLATFORM).post(`/api/platform/org-requests/${fromCustomer._id}/approve`, {})).status, 409, 'that email already has an account');
  const rejected = await as(PLATFORM).post(`/api/platform/org-requests/${fromCustomer._id}/reject`, { note: 'Your company already uses BarrierFix. Please speak to your company admin.' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.request.status, 'rejected');
  assert.ok(rejected.body.request.expiresAt, 'rejected requests are deleted after a while');
  assert.ok(getDevMailbox().some((m) => m.to === ADMIN && /request/i.test(m.subject)), 'the requester is told');
  assert.equal((await as(PLATFORM).post(`/api/platform/org-requests/${fromCustomer._id}/approve`, {})).status, 409, 'a rejected request cannot then be approved');
});

test('decision prompts are versioned and administrators can update them', async () => {
  // Requests are covered in requests.test.js; here only the versioned wording of the six questions.
  const earlier = await as(EMPLOYEE).post('/api/decisions', { title: 'Flexible lunch' });
  assert.equal(earlier.status, 201, JSON.stringify(earlier.body));
  const factors = (await as(MANAGER).get('/api/decisions/meta')).body.factors.map((f) => ({ key: f.key, title: f.title, prompt: f.key === 'effectiveness' ? 'Would this adjustment reduce the disadvantage described?' : f.prompt, help: f.help }));
  const denied = await as(ADMIN).post('/api/platform/decision-prompts', { changeNote: 'x', factors });
  assert.equal(denied.status, 403);
  const created = await as(PLATFORM).post('/api/platform/decision-prompts', { changeNote: 'Reworded the effectiveness prompt after legal review', factors });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.promptSet.version, 2);
  assert.ok(created.body.promptSet.effectiveFrom);
  const history = await as(PLATFORM).get('/api/platform/decision-prompts');
  assert.deepEqual(history.body.promptSets.map((p) => p.version), [2, 1]);

  const fresh = await as(EMPLOYEE).post('/api/decisions', { title: 'Later lunch' });
  assert.equal(fresh.body.record.promptVersion, 2);
  const old = await as(MANAGER).get(`/api/decisions/${earlier.body.record._id}`);
  assert.equal(old.body.record.promptVersion, 1, 'older requests keep the wording they started with');
  assert.equal(old.body.record.prompts.find((f) => f.key === 'effectiveness').prompt.startsWith('Would this adjustment be effective'), true);
  assert.equal(fresh.body.record.prompts.find((f) => f.key === 'effectiveness').prompt, 'Would this adjustment reduce the disadvantage described?');
  await as(EMPLOYEE).post(`/api/decisions/${earlier.body.record._id}/withdraw`, {});
  await as(EMPLOYEE).post(`/api/decisions/${fresh.body.record._id}/withdraw`, {});
});
test('library changes are permissioned, audited and keep a version history', async () => {
  const before = (await as(PLATFORM).get('/api/platform/rules/EQ4/versions')).body.versions.length;
  assert.equal((await as(MANAGER).patch('/api/platform/rules/EQ4', { typicalCost: '£50 to £150' })).status, 403);
  const updated = await as(PLATFORM).patch('/api/platform/rules/EQ4', { typicalCost: '£50 to £150', group: 'equipment', approved: true, markReviewed: true });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const versions = await as(PLATFORM).get('/api/platform/rules/EQ4/versions');
  assert.equal(versions.body.versions.length, before + 1);
  assert.equal(versions.body.versions[0].snapshot.typicalCost, '£50 to £150');
  assert.ok(await models.AuditLog.exists({ action: 'platform.rule_updated', entityId: 'EQ4' }));
  const retired = await as(PLATFORM).patch('/api/platform/rules/EQ4', { active: false });
  assert.ok(retired.body.rule.retiredAt);
  await as(PLATFORM).patch('/api/platform/rules/EQ4', { active: true });
  await assert.rejects(() => models.RuleVersion.deleteMany({}), /append-only/);
});

test('reviews open when due and a "not helping" answer flags the rule', async () => {
  await models.Review.updateOne({ employeeId: ids.employee, ruleCode: 'TS1', stageWeeks: 2 }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  assert.equal(await reviewsService.activateDueReviews(new Date()), 1);
  const list = await as(EMPLOYEE).get('/api/reviews');
  assert.equal(list.body.open.length, 1);
  const answered = await as(EMPLOYEE).post(`/api/reviews/${list.body.open[0]._id}/answer`, { employee: { helping: 'no', next: 'change' } });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const profile = await models.Profile.findOne({ employeeId: ids.employee });
  assert.equal(profile.rules.find((r) => r.code === 'TS1').needsRevision, true);
  const manager = await as(MANAGER).post(`/api/reviews/${list.body.open[0]._id}/answer`, { manager: { practical: 'yes' } });
  assert.equal(manager.body.review.status, 'completed');
});

test('HR sees firm-wide KPIs; managers see their team', async () => {
  const dash = await as(HR).get('/api/dashboard');
  assert.equal(dash.body.hr.kpis.tasksTranslated, 1);
  assert.equal(dash.body.hr.kpis.meaningPreservedPct, 100);
  assert.equal(typeof dash.body.hr.decisions.waitingForHr, 'number');
  const mgr = await as(MANAGER).get('/api/dashboard');
  assert.equal(mgr.body.manager.team.length, 1);
  assert.equal(mgr.body.manager.team[0].tasksTranslated30d, 1);
});

test('profiles are private to the employee, their manager and HR', async () => {
  const colleague = await createPerson(ADMIN, 'sam@acme.test', 'Sam Patel', ['employee'], ids.manager);
  assert.ok(colleague);
  assert.equal((await as('sam@acme.test').get(`/api/profiles/${ids.employee}`)).status, 403);
  assert.equal((await as(HR).get(`/api/profiles/${ids.employee}`)).status, 200);
});

test('managers create employee accounts for their own team only', async () => {
  const made = await as(MANAGER).post('/api/users', { email: 'ella@acme.test', name: 'Ella Stone', managerId: ids.hr });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.user.roles, ['employee']);
  assert.equal(String(made.body.user.managerId), ids.manager, 'always placed in the creating manager\'s team');
  assert.ok(made.body.temporaryPassword.length >= 12);
  assert.equal((await as(MANAGER).post('/api/users', { email: 'mgr2@acme.test', name: 'M', roles: ['manager'] })).status, 403);
  assert.equal((await as(MANAGER).post('/api/users', { email: 'hr2@acme.test', name: 'H', roles: ['hr'] })).status, 403);
  assert.equal((await as(MANAGER).post('/api/users', { email: 'adm2@acme.test', name: 'A', roles: ['employee', 'admin'] })).status, 403);

  const csv = 'name,email,roles,manager_email\nFinn Lowe,finn@acme.test,employee,owner@acme.test\nGale Moss,gale@acme.test,manager,\n';
  const imported = await as(MANAGER).post('/api/users/import', { csv });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.created, 1);
  assert.match(imported.body.skipped.map((s) => s.reason).join(' '), /employee accounts only/i);
  assert.equal(String((await models.User.findOne({ email: 'finn@acme.test' })).managerId), ids.manager, 'manager_email is ignored for a manager');
  assert.equal(await models.User.countDocuments({ email: 'gale@acme.test' }), 0);

  // A manager resets only their own team's employees.
  const elsewhere = await as(ADMIN).post('/api/users', { email: 'other.team@acme.test', name: 'Other Team' });
  assert.equal((await as(MANAGER).post(`/api/users/${elsewhere.body.user._id}/reset-password`, {})).status, 403);
  assert.equal((await as(MANAGER).post(`/api/users/${made.body.user._id}/reset-password`, {})).status, 200);
  const list = await as(MANAGER).get('/api/users');
  assert.ok(list.body.users.some((u) => u.email === 'ella@acme.test'));
  assert.ok(!list.body.users.some((u) => u.email === 'other.team@acme.test'), 'a manager sees their own team');
});

test('CSV import adds people and links managers', async () => {
  const csv = 'name,email,roles,manager_email\nAlex Kim,alex@acme.test,employee,priya@acme.test\nRavi Rao,ravi@acme.test,employee;manager,\n';
  const res = await as(ADMIN).post('/api/users/import', { csv });
  assert.equal(res.body.created, 2, JSON.stringify(res.body));
  assert.equal(res.body.accounts.length, 2);
  assert.ok(res.body.accounts.every((a) => a.temporaryPassword.length >= 12));
  const alex = await models.User.findOne({ email: 'alex@acme.test' });
  assert.equal(String(alex.managerId), ids.manager);
});

test('plan features are enforced (Starter has no task translation)', async () => {
  const set = await as(PLATFORM).patch(`/api/platform/orgs/${ids.org}`, { plan: 'starter' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const blocked = await as(MANAGER).post('/api/briefs', { employeeId: ids.employee, text: 'Please send the invoice by Friday.' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'plan_feature');
  await as(PLATFORM).patch(`/api/platform/orgs/${ids.org}`, { plan: 'professional' });
  const notPlatform = await as(ADMIN).get('/api/platform/orgs');
  assert.equal(notPlatform.status, 403);
});

test('evaluation harness measures deadlines and catches changed meaning', async () => {
  const csv = [
    'id,brief_text,sent_at,rules,expected_is_task,expected_deadline,expected_steps,candidate_translation,expected_validator',
    '1,"Can you send the invoice to Acme by Friday?",2026-09-21T10:00:00+01:00,TS1;TM1,yes,2026-09-25 17:00,0,"Task: Send the invoice to Acme\nDue: Friday 25 September at 5pm",pass',
    '2,"Can you send the invoice to Acme by Friday?",2026-09-21T10:00:00+01:00,TS1;TM1,yes,2026-09-25 17:00,0,"Task: Send the invoice to Acme\nDue: Monday 28 September at 5pm",hold',
    '3,"Thanks, great work!",2026-09-21T10:00:00+01:00,TS1,no,,,,',
  ].join('\n');
  const res = await as(PLATFORM).post('/api/platform/evaluations', { name: 'Smoke test', csv });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const s = res.body.run.summary;
  assert.equal(s.detectionAccuracyPct, 100);
  assert.equal(s.deadlineAccuracyPct, 100);
  assert.equal(s.candidateAgreementPct, 100);
  assert.equal(s.heldWhenExpectedPct, 100);
});

test('required details are asked for before a task is sent', async () => {
  const current = (await as(EMPLOYEE).get('/api/profiles/me')).body.profile.rules.map((r) => ({ code: r.code, params: r.params }));
  const edited = await as(EMPLOYEE).put('/api/profiles/me', { rules: [...current, { code: 'TM4' }, { code: 'TM5' }, { code: 'PR1' }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  await as(EMPLOYEE).post('/api/profiles/me/submit', { consent: true });
  assert.equal((await as(MANAGER).post(`/api/profiles/${ids.employee}/agree`)).status, 200);

  const text = 'Please send the invoice to Acme';
  const preview = await as(MANAGER).post('/api/briefs/preview', { employeeId: ids.employee, text });
  assert.deepEqual(preview.body.result.missing.map((m) => m.key), ['deadlineDate', 'priority']);

  const sentCount = () => models.Brief.countDocuments({ managerId: ids.manager, status: { $ne: 'draft' } });
  const before = await sentCount();
  const blocked = await as(MANAGER).post('/api/briefs', { draftId: preview.body.draftId });
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'needs_info');
  assert.deepEqual(blocked.body.details.missing.map((m) => m.key), ['deadlineDate', 'priority']);
  assert.equal(await sentCount(), before, 'nothing is sent until the details are given');

  const completed = await as(MANAGER).post('/api/briefs/preview', { employeeId: ids.employee, text, priority: 'high', deadlineDate: '2030-01-04', deadlineTime: '15:00', replaces: preview.body.draftId });
  assert.deepEqual(completed.body.result.missing, []);
  const sent = await as(MANAGER).post('/api/briefs', { draftId: completed.body.draftId });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.brief.originalText, text, 'the manager\'s words are stored exactly');
  assert.match(sent.body.brief.translatedText, /Priority: High/);
  assert.match(sent.body.brief.translatedText, /Friday 4 January 2030 at 3pm/);
  assert.equal(sent.body.brief.result.priority, 'high');
  for (const action of ['brief.confirmed', 'brief.delivered']) {
    const entry = await models.AuditLog.findOne({ action, entityId: sent.body.brief._id });
    assert.ok(entry?.at && entry.actorId, `${action} is audited with a time and the manager`);
  }
  assert.ok((await models.AuditLog.findOne({ action: 'brief.confirmed', entityId: sent.body.brief._id })).meta.rules.includes('PR1'), 'the rules applied are recorded');
});

test('a task is held as a draft until the manager confirms it', async () => {
  const [manager, employee, org] = await Promise.all([models.User.findById(ids.manager), models.User.findById(ids.employee), models.Organization.findById(ids.org)]);
  const service = await import('../src/modules/briefs/service.js');
  const raw = 'Hi <@U123> please send the invoice to Acme by Friday at 3pm <https://x.test|the folder>. Urgent.';
  const resolved = 'Hi @Jordan please send the invoice to Acme by Friday at 3pm the folder (https://x.test). Urgent.';
  const notifications = () => models.Notification.countDocuments({ userId: ids.employee, kind: 'task_new' });
  const before = await notifications();
  const draft = await service.createBrief({ org, manager, employee, text: resolved, source: 'slack', slack: { teamId: 'T1', channelId: 'C1', ts: '1.1', rawText: raw }, asDraft: true });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.slack.rawText, raw, 'the exact selected message is kept');
  assert.equal(await notifications(), before, 'a draft is not delivered');
  assert.equal((await as(EMPLOYEE).get('/api/briefs?box=inbox')).body.briefs.some((b) => b._id === String(draft._id)), false);

  const sent = await service.sendDraft(draft, { org, manager, employee });
  assert.equal(sent.status, 'delivered');
  assert.equal(await notifications(), before + 1);

  const discarded = await service.createBrief({ org, manager, employee, text: resolved, source: 'slack', asDraft: true });
  await service.discardDraft(discarded);
  assert.equal(await models.Brief.countDocuments({ _id: discarded._id }), 0);
  assert.equal(await notifications(), before + 1);
});

test('an admin or HR can switch a profile off and on', async () => {
  assert.equal((await as(EMPLOYEE).patch(`/api/profiles/${ids.employee}/active`, { active: false })).status, 403);
  assert.equal((await as(MANAGER).patch(`/api/profiles/${ids.employee}/active`, { active: false })).status, 403);
  const off = await as(HR).patch(`/api/profiles/${ids.employee}/active`, { active: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.profile.active, false);
  const directory = await as(MANAGER).get('/api/users/directory');
  assert.equal(directory.body.users.find((u) => u._id === ids.employee).formatReady, false, 'a switched-off profile is not offered as ready');
  const blocked = await as(MANAGER).post('/api/briefs/preview', { employeeId: ids.employee, text: 'Please send the invoice by Friday at 3pm', priority: 'low' });
  assert.equal(blocked.body.hasProfile, false);
  assert.equal(blocked.body.draftId, undefined, 'there is nothing to send');
  assert.match(blocked.body.reason, /switched off/);
  const profiles = await import('../src/modules/profiles/service.js');
  assert.deepEqual(await profiles.activeRulesFor(ids.employee, ids.org), []);
  assert.equal((await as(HR).patch(`/api/profiles/${ids.employee}/active`, { active: true })).status, 200);
  assert.ok((await profiles.activeRulesFor(ids.employee, ids.org)).length > 0);
  assert.deepEqual(await profiles.activeRulesFor(ids.employee, new models.Organization()._id), [], 'profiles are looked up inside their own company only');
  assert.ok(await models.AuditLog.exists({ action: 'profile.deactivated' }));
});

test('stale previews are cleaned up and nothing else is touched', async () => {
  const [manager, employee, org] = await Promise.all([models.User.findById(ids.manager), models.User.findById(ids.employee), models.Organization.findById(ids.org)]);
  const service = await import('../src/modules/briefs/service.js');
  const text = 'Please send the invoice to Acme by Friday at 3pm. Urgent.';
  const stale = await service.createBrief({ org, manager, employee, text, source: 'slack', asDraft: true });
  const recent = await service.createBrief({ org, manager, employee, text, source: 'slack', asDraft: true });
  const delivered = await service.createBrief({ org, manager, employee, text, priority: 'high', overrides: { deadlineDate: '2030-01-04', deadlineTime: '15:00' } });
  // Back-date the stale preview and the delivered task by two days: only the preview may go.
  const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000);
  // createdAt is immutable in Mongoose, so back-date through the raw collection.
  await models.Brief.collection.updateMany({ _id: { $in: [stale._id, delivered._id] } }, { $set: { createdAt: twoDaysAgo } });
  await jobs.retentionSweep();
  assert.equal(await models.Brief.countDocuments({ _id: stale._id }), 0, 'an ignored preview is removed after a day');
  assert.equal(await models.Brief.countDocuments({ _id: recent._id }), 1, 'a recent preview is kept');
  assert.equal(await models.Brief.countDocuments({ _id: delivered._id }), 1, 'a delivered task is kept');
  await service.discardDraft(recent);
});

test('the audit log is append-only', async () => {
  assert.ok((await models.AuditLog.countDocuments({ orgId: ids.org })) > 10);
  await assert.rejects(() => models.AuditLog.updateOne({}, { $set: { action: 'tampered' } }), /append-only/);
  await assert.rejects(() => models.AuditLog.deleteMany({}), /append-only/);
});

test('leaving the company deactivates the account and starts retention', async () => {
  const res = await as(HR).post(`/api/users/${ids.employee}/end-employment`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const profile = await models.Profile.findOne({ employeeId: ids.employee });
  assert.ok(profile.retainUntil > new Date());
  assert.equal((await as(EMPLOYEE).get('/api/auth/session')).status, 403);
});

test('companies created before Organisation IDs existed are given one', async () => {
  const { insertedId } = await models.Organization.collection.insertOne({ name: 'Legacy Ltd', plan: 'starter', status: 'active', createdAt: new Date() });
  const { ensureOrgNumbers } = await import('../src/models/Organization.js');
  assert.ok((await ensureOrgNumbers()) >= 1);
  assert.match((await models.Organization.findById(insertedId)).orgNumber, /^BF-\d{6}$/);
  assert.equal(await ensureOrgNumbers(), 0, 'nothing left to number the second time');
  await models.Organization.collection.deleteOne({ _id: insertedId });
});
