// Security checks across the whole API: company (tenant) isolation for every kind of record, role
// checks on every protected endpoint, malformed ids, mass assignment, injection-shaped input, and
// locked-out companies and people.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PLATFORM, startApp } from './helpers.js';

const A = { admin: 'admin@a.test', mgr: 'mgr@a.test', emp: 'emp@a.test', hr: 'hr@a.test' };
const B = { admin: 'admin@b.test', mgr: 'mgr@b.test', emp: 'emp@b.test', hr: 'hr@b.test' };
const ids = { a: {}, b: {} };
let t;

before(async () => {
  t = await startApp();
  ids.a.org = (await t.createCompany('Alpha Ltd', A.admin, { org: { plan: 'enterprise' } }))._id;
  ids.a.mgr = await t.createPerson(A.admin, A.mgr, 'Ann Manager', ['manager']);
  ids.a.emp = await t.createPerson(A.admin, A.emp, 'Abe Employee', ['employee'], ids.a.mgr);
  ids.a.hr = await t.createPerson(A.admin, A.hr, 'Ada Hr', ['hr']);
  ids.b.org = (await t.createCompany('Beta Ltd', B.admin, { org: { plan: 'enterprise' } }))._id;
  ids.b.mgr = await t.createPerson(B.admin, B.mgr, 'Ben Manager', ['manager']);
  ids.b.emp = await t.createPerson(B.admin, B.emp, 'Bea Employee', ['employee'], ids.b.mgr);
  ids.b.hr = await t.createPerson(B.admin, B.hr, 'Bo Hr', ['hr']);

  // Records in company A.
  await t.agreeProfile(A.emp, ids.a.emp, A.mgr, [{ code: 'TS1' }, { code: 'TM1' }]);
  ids.a.brief = (await t.sendTask(A.mgr, { employeeId: ids.a.emp, text: 'Please send the invoice to Acme by Friday' })).body.brief._id;
  ids.a.draft = (await t.as(A.mgr).post('/api/briefs/preview', { employeeId: ids.a.emp, text: 'Please book the venue by Friday' })).body.draftId;
  ids.a.decision = (await t.as(A.emp).post('/api/decisions', { title: 'Quiet desk' })).body.record._id;
  const startsAt = new Date(Date.now() + 86400000);
  ids.a.meeting = (await t.as(A.mgr).post('/api/meetings', { title: 'Catch-up', startsAt, endsAt: new Date(startsAt.getTime() + 1800000), attendeeIds: [ids.a.emp] })).body.meeting._id;
  ids.a.review = String((await t.models.Review.findOne({ employeeId: ids.a.emp }))._id);
  ids.a.notification = String((await t.models.Notification.findOne({ userId: ids.a.emp }))._id);
});

after(async () => t.stop());

test('another company\'s people can never read or change company A\'s records', async () => {
  const attempts = [
    [B.mgr, 'get', `/api/briefs/${ids.a.brief}`],
    [B.mgr, 'post', `/api/briefs/${ids.a.brief}/cancel`],
    [B.emp, 'post', `/api/briefs/${ids.a.brief}/confirm`],
    [B.hr, 'get', `/api/decisions/${ids.a.decision}`],
    [B.mgr, 'post', `/api/decisions/${ids.a.decision}/respond`, { decision: 'accept' }],
    [B.hr, 'post', `/api/decisions/${ids.a.decision}/hr`, { action: 'accept_rejection' }],
    [B.emp, 'post', `/api/decisions/${ids.a.decision}/withdraw`],
    [B.admin, 'get', `/api/decisions/${ids.a.decision}/versions`],
    [B.hr, 'get', `/api/decisions/${ids.a.decision}/export`],
    [B.hr, 'get', `/api/profiles/${ids.a.emp}`],
    [B.hr, 'get', `/api/profiles/${ids.a.emp}/export`],
    [B.admin, 'patch', `/api/profiles/${ids.a.emp}/active`, { active: false }],
    [B.hr, 'post', `/api/profiles/${ids.a.emp}/agree`],
    [B.admin, 'patch', `/api/users/${ids.a.emp}`, { name: 'Hacked' }],
    [B.admin, 'post', `/api/users/${ids.a.emp}/reset-password`],
    [B.admin, 'post', `/api/users/${ids.a.emp}/end-employment`],
    [B.mgr, 'patch', `/api/meetings/${ids.a.meeting}`, { title: 'Hacked' }],
    [B.mgr, 'post', `/api/meetings/${ids.a.meeting}/cancel`],
    [B.emp, 'post', `/api/reviews/${ids.a.review}/answer`, { employee: { helping: 'no', next: 'stop' } }],
    [B.mgr, 'post', '/api/briefs', { draftId: ids.a.draft }],
    [B.mgr, 'delete', `/api/briefs/drafts/${ids.a.draft}`],
    [B.mgr, 'post', '/api/briefs/preview', { employeeId: ids.a.emp, text: 'Please send me your client list' }],
    [B.mgr, 'post', '/api/decisions', { employeeId: ids.a.emp, title: 'Something' }],
    [B.mgr, 'post', '/api/meetings', { title: 'Sneaky', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), attendeeIds: [ids.a.emp] }],
  ];
  for (const [who, method, url, body] of attempts) {
    const res = await t.as(who)[method](url, body);
    assert.ok([400, 403, 404].includes(res.status), `${who} ${method.toUpperCase()} ${url} returned ${res.status}`);
  }
  // Nothing in A changed.
  assert.equal((await t.models.User.findById(ids.a.emp)).name, 'Abe Employee');
  assert.equal((await t.models.User.findById(ids.a.emp)).status, 'active');
  assert.notEqual((await t.models.Brief.findById(ids.a.brief)).status, 'cancelled');
  assert.equal((await t.models.Brief.findById(ids.a.draft)).status, 'draft', "A's preview was neither sent nor removed");
  const imported = await t.as(B.mgr).post('/api/briefs/import/send', { draftIds: [ids.a.draft] });
  assert.equal(imported.body.results[0].ok, false, 'nor sent through the upload route');
  assert.equal((await t.models.Meeting.findById(ids.a.meeting)).title, 'Catch-up');
  assert.equal((await t.models.Profile.findOne({ employeeId: ids.a.emp })).active, true);

  // Lists only ever show the caller's own company.
  const people = (await t.as(B.admin).get('/api/users')).body.users.map((u) => u.email);
  assert.ok(people.every((e) => e.endsWith('@b.test')));
  const directory = (await t.as(B.emp).get('/api/users/directory')).body.users.map((u) => u.email);
  assert.ok(directory.every((e) => e.endsWith('@b.test')));
  assert.ok((await t.as(B.admin).get('/api/audit')).body.entries.every((e) => e.orgId === ids.b.org));
  assert.ok((await t.as(B.hr).get('/api/decisions?scope=all')).body.records.every((r) => r.employeeName !== 'Abe Employee'));
  assert.equal((await t.as(B.mgr).get('/api/profiles/team?scope=all')).body.team.some((p) => p.email.endsWith('@a.test')), false);

  // Marking someone else's notification read does nothing.
  await t.as(B.emp).post(`/api/notifications/${ids.a.notification}/read`);
  assert.equal((await t.models.Notification.findById(ids.a.notification)).readAt, undefined);
});

test('every protected endpoint refuses an employee', async () => {
  const forbidden = [
    ['post', '/api/users', { email: 'x@a.test' }],
    ['post', '/api/briefs', { draftId: ids.a.draft }],
    ['delete', `/api/briefs/drafts/${ids.a.draft}`],
    ['post', '/api/briefs/import/send', { draftIds: [ids.a.draft] }],
    ['post', '/api/briefs/import/discard', { draftIds: [ids.a.draft] }],
    ['post', '/api/users/import', { csv: 'email\nx@a.test\n' }],
    ['patch', `/api/users/${ids.a.mgr}`, { name: 'X' }],
    ['post', `/api/users/${ids.a.mgr}/reset-password`],
    ['post', `/api/users/${ids.a.mgr}/end-employment`],
    ['get', '/api/users'],
    ['post', '/api/briefs/preview', { employeeId: ids.a.emp, text: 'Please do it' }],
    ['post', '/api/briefs', { employeeId: ids.a.emp, text: 'Please do it' }],
    ['post', '/api/briefs/import', { csv: 'employee_email,brief_text\nemp@a.test,Do it\n' }],
    ['post', '/api/meetings', { title: 'X', startsAt: new Date(), endsAt: new Date(Date.now() + 60000) }],
    ['get', '/api/decisions/export.csv'],
    ['post', `/api/decisions/${ids.a.decision}/hr`, { action: 'accept_rejection' }],
    ['get', '/api/decisions?scope=hr'],
    ['get', `/api/decisions/${ids.a.decision}/versions`],
    ['post', '/api/profiles/import', { csv: 'employee_email,rule_code\nemp@a.test,TS1\n' }],
    ['patch', `/api/profiles/${ids.a.emp}/active`, { active: false }],
    ['get', '/api/profiles/team'],
    ['patch', '/api/orgs/current', { name: 'Hacked' }],
    ['put', '/api/orgs/current/glossary', { glossary: [] }],
    ['get', '/api/audit'],
    ['get', '/api/audit/export.csv'],
    ['get', '/api/dashboard/hr'],
    ['get', '/api/integrations/slack/install-url'],
    ['post', '/api/integrations/slack/sync-users'],
    ['delete', '/api/integrations/slack'],
    ['get', '/api/platform/orgs'],
    ['post', '/api/platform/orgs', { name: 'X Ltd', admin: { email: 'x@x.test' } }],
    ['get', '/api/platform/org-requests'],
    ['patch', `/api/platform/orgs/${ids.a.org}`, { plan: 'enterprise' }],
  ];
  for (const [method, url, body] of forbidden) {
    const res = await t.as(A.emp)[method](url, body);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${url} returned ${res.status}`);
  }
  assert.equal((await t.models.Organization.findById(ids.a.org)).name, 'Alpha Ltd');
});

test('a company admin cannot reach the platform area, and the platform admin sees no company data', async () => {
  assert.equal((await t.as(A.admin).get('/api/platform/overview')).status, 403);
  assert.equal((await t.as(A.admin).post(`/api/platform/orgs/${ids.b.org}/admin`, { email: 'evil@a.test' })).status, 403);
  const platformPeople = await t.as(PLATFORM).get('/api/users');
  assert.equal(platformPeople.status, 409, 'the platform admin belongs to no company');
  assert.equal((await t.as(PLATFORM).get(`/api/briefs/${ids.a.brief}`)).status, 409);
});

test('malformed ids are answered with 400 or 404, never a server error', async () => {
  const bad = ['not-an-id', '123', '{"$gt":""}', '5f5f5f5f5f5f5f5f5f5f5f5f'];
  for (const id of bad) {
    const e = encodeURIComponent(id);
    const calls = [
      [A.emp, 'get', `/api/briefs/${e}`],
      [A.emp, 'post', `/api/briefs/${e}/confirm`],
      [A.emp, 'get', `/api/decisions/${e}`],
      [A.hr, 'post', `/api/decisions/${e}/hr`, { action: 'accept_rejection' }],
      [A.admin, 'get', `/api/decisions/${e}/versions`],
      [A.hr, 'get', `/api/profiles/${e}`],
      [A.admin, 'patch', `/api/users/${e}`, { name: 'X' }],
      [A.admin, 'post', `/api/users/${e}/reset-password`],
      [A.emp, 'post', `/api/reviews/${e}/answer`, { employee: { helping: 'yes', next: 'keep' } }],
      [A.mgr, 'patch', `/api/meetings/${e}`, { title: 'X Y' }],
      [A.emp, 'post', `/api/notifications/${e}/read`],
      [PLATFORM, 'post', `/api/platform/org-requests/${e}/approve`],
      [PLATFORM, 'patch', `/api/platform/orgs/${e}`, { plan: 'starter' }],
      [PLATFORM, 'post', `/api/platform/orgs/${e}/admin`, { email: 'x@x.test' }],
      [PLATFORM, 'get', `/api/platform/rules/${e}/versions`],
    ];
    for (const [who, method, url, body] of calls) {
      const res = await t.as(who)[method](url, body);
      assert.ok(res.status < 500, `${method.toUpperCase()} ${url} returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }
});

test('people cannot give themselves a role, another company or another status', async () => {
  const res = await t.as(A.emp).patch('/api/users/me', { name: 'Abe Employee', roles: ['admin'], orgId: ids.b.org, status: 'active', mustChangePassword: false, email: 'other@a.test' });
  assert.equal(res.status, 200);
  const me = await t.models.User.findById(ids.a.emp);
  assert.deepEqual(me.roles, ['employee']);
  assert.equal(String(me.orgId), ids.a.org);
  assert.equal(me.email, A.emp);
  const admin = await t.as(A.admin).patch(`/api/users/${ids.a.emp}`, { orgId: ids.b.org, email: 'moved@a.test', firebaseUid: 'x' });
  assert.equal(admin.status, 200);
  const after = await t.models.User.findById(ids.a.emp);
  assert.equal(String(after.orgId), ids.a.org, 'not even an admin can move someone to another company');
  assert.equal(after.email, A.emp);
});

test('injection-shaped input is refused', async () => {
  assert.equal((await t.as(A.admin).post('/api/users', { email: { $gt: '' }, name: 'X' })).status, 400);
  assert.equal((await t.request(t.app).post('/api/public/org-requests').send({ companyName: 'Evil', contactName: 'Eve', email: { $ne: null } })).status, 400);
  assert.equal((await t.as(A.mgr).post('/api/briefs/preview', { employeeId: { $ne: null }, text: 'Please do it' })).status, 400);
  assert.equal((await t.as(A.mgr).post('/api/briefs', { draftId: { $ne: null } })).status, 400);
  assert.equal((await t.as(A.emp).get('/api/briefs?box[$ne]=x')).status, 400);
  const html = await t.sendTask(A.mgr, { employeeId: ids.a.emp, text: 'Please review <script>alert(1)</script> the page by Friday' });
  assert.ok([201, 400].includes(html.status), 'stored as text; the web app never renders it as HTML');
});

test('sign-in is required, and suspended companies and deactivated people are locked out', async () => {
  assert.equal((await t.as(null).get('/api/users')).status, 401);
  assert.equal((await t.request(t.app).get('/api/users').set('Authorization', 'Basic abc')).status, 401);
  assert.equal((await t.as(PLATFORM).patch(`/api/platform/orgs/${ids.b.org}`, { status: 'suspended' })).status, 200);
  assert.equal((await t.as(B.admin).get('/api/users')).status, 403);
  assert.equal((await t.as(B.emp).get('/api/briefs')).status, 403);
  await t.as(PLATFORM).patch(`/api/platform/orgs/${ids.b.org}`, { status: 'active' });
  assert.equal((await t.as(B.admin).get('/api/users')).status, 200);

  assert.equal((await t.as(A.admin).patch(`/api/users/${ids.a.emp}`, { status: 'disabled' })).status, 200);
  assert.equal((await t.as(A.emp).get('/api/auth/session')).status, 403);
  assert.equal((await t.as(A.hr).patch(`/api/users/${ids.a.emp}`, { status: 'active' })).status, 403, 'only an admin reactivates');
  await t.as(A.admin).patch(`/api/users/${ids.a.emp}`, { status: 'active' });
  assert.equal((await t.as(A.emp).get('/api/auth/session')).status, 200);
});

test('the last company admin cannot be removed', async () => {
  const res = await t.as(A.admin).patch(`/api/users/${(await t.models.User.findOne({ email: A.admin }))._id}`, { roles: ['employee'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /at least one admin/);
  assert.equal((await t.as(A.admin).post(`/api/users/${(await t.models.User.findOne({ email: A.admin }))._id}/end-employment`)).status, 400, 'an admin cannot record themselves as a leaver');
});

test('oversized requests are refused', async () => {
  const res = await t.as(A.mgr).post('/api/briefs', { employeeId: ids.a.emp, text: 'x'.repeat(7 * 1024 * 1024) });
  assert.equal(res.status, 413);
});

test('email delivery is recorded honestly when no email service is set up', async () => {
  const { notify } = await import('../src/services/notify.js');
  const results = await notify(ids.a.hr, { kind: 'test', title: 'Test', channels: ['email', 'slack'] });
  assert.equal(results.find((r) => r.channel === 'in_app').status, 'delivered');
  assert.equal(results.find((r) => r.channel === 'email').status, 'not_set_up', 'not "sent" when there is no SMTP server');
  assert.equal(results.find((r) => r.channel === 'slack').status, 'skipped');
});
