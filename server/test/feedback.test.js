// Client feedback of 19 Nov 2026 ("MVP feedback.docx"):
//   1. an employee can request an adjustment straight from the Rule Library;
//   2. the manager can correct a task the employee flagged as wrong, by editing what the employee received;
//   3. new analytics on the manager's home page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const ADMIN = 'admin@feedback.test';
const MGR = 'mgr@feedback.test';
const EMP = 'emp@feedback.test';
const EMP2 = 'emp2@feedback.test';
const NEWB = 'newb@feedback.test';
const OTHER_MGR = 'other.mgr@feedback.test';
const OTHER_EMP = 'other.emp@feedback.test';
const HR = 'hr@feedback.test';
const AMGR = 'a.mgr@feedback.test';
const AEMP1 = 'a.emp1@feedback.test';
const AEMP2 = 'a.emp2@feedback.test';
const ids = {};
let t;
let profiles;
let reviews;

const notified = (userId, kind) => t.models.Notification.exists({ userId, kind });
const clone = (v) => JSON.parse(JSON.stringify(v));

before(async () => {
  t = await startApp();
  profiles = await import('../src/modules/profiles/service.js');
  reviews = await import('../src/modules/reviews/service.js');
  ids.org = (await t.createCompany('Feedback Ltd', ADMIN, { org: { plan: 'professional' } }))._id;
  ids.mgr = await t.createPerson(ADMIN, MGR, 'Mia Manager', ['manager']);
  ids.emp = await t.createPerson(ADMIN, EMP, 'Eli Employee', ['employee'], ids.mgr);
  ids.emp2 = await t.createPerson(ADMIN, EMP2, 'Ezra Two', ['employee'], ids.mgr);
  ids.newb = await t.createPerson(ADMIN, NEWB, 'Nia New', ['employee'], ids.mgr);
  ids.otherMgr = await t.createPerson(ADMIN, OTHER_MGR, 'Olu Other', ['manager']);
  ids.otherEmp = await t.createPerson(ADMIN, OTHER_EMP, 'Ola Other', ['employee'], ids.otherMgr);
  ids.hr = await t.createPerson(ADMIN, HR, 'Hal Hr', ['hr']);
  ids.amgr = await t.createPerson(ADMIN, AMGR, 'Ana Manager', ['manager']);
  ids.aemp1 = await t.createPerson(ADMIN, AEMP1, 'Abe One', ['employee'], ids.amgr);
  ids.aemp2 = await t.createPerson(ADMIN, AEMP2, 'Ada Two', ['employee'], ids.amgr);
  await t.agreeProfile(EMP, ids.emp, MGR, [{ code: 'TS1' }, { code: 'TM1' }, { code: 'TM3' }]);
  await t.agreeProfile(EMP2, ids.emp2, MGR, [{ code: 'TS1' }]);
  await t.agreeProfile(OTHER_EMP, ids.otherEmp, OTHER_MGR, [{ code: 'TS1' }, { code: 'TM1' }]);
});

after(async () => t.stop());

// ---------------------------------------------------------------- 1. Requesting a rule from the Rule Library

test('rule library: an employee requests a rule in one step; it waits for their manager while agreed rules keep applying', async () => {
  const res = await t.as(EMP).post('/api/profiles/me/rules', { code: 'CM3', note: 'Our team uses a lot of short forms.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rule = res.body.profile.rules.find((r) => r.code === 'CM3');
  assert.equal(rule.status, 'proposed');
  assert.equal(rule.note, 'Our team uses a lot of short forms.');
  assert.equal(res.body.profile.status, 'proposed', 'sent to the manager, not left as a draft');
  assert.ok(await notified(ids.mgr, 'profile_submitted'), 'the manager is asked to agree it');
  const applying = (await profiles.activeRulesFor(ids.emp, ids.org)).map((r) => r.code).sort();
  assert.deepEqual(applying, ['TM1', 'TM3', 'TS1'], 'nothing changes until it is agreed');
  assert.ok(await t.models.AuditLog.exists({ action: 'profile.rule_requested' }));

  const agreed = await t.as(MGR).post(`/api/profiles/${ids.emp}/agree`);
  assert.equal(agreed.status, 200, 'the manager agrees it the usual way');
  assert.equal(agreed.body.profile.rules.find((r) => r.code === 'CM3').status, 'agreed');
});

test('rule library: a rule already in the profile, an unknown rule and out-of-range settings are refused; health words are flagged', async () => {
  const again = await t.as(EMP).post('/api/profiles/me/rules', { code: 'TS1' });
  assert.equal(again.status, 409, 'already in the profile');
  assert.equal((await t.as(EMP).post('/api/profiles/me/rules', { code: 'ZZ9' })).status, 400, 'not in the library');
  assert.equal((await t.as(EMP).post('/api/profiles/me/rules', { code: 'TM2', params: { daysBefore: 99 } })).status, 400, 'outside the allowed range');
  const health = await t.as(EMP).post('/api/profiles/me/rules', { code: 'TM2', params: { daysBefore: 2 }, note: 'Because of my ADHD I lose track of long tasks.' });
  assert.equal(health.status, 201);
  assert.ok(health.body.warning?.terms.includes('adhd'), 'the employee is told to leave out health details');
  assert.equal(health.body.profile.rules.find((r) => r.code === 'TM2').params.daysBefore, 2);
});

test('rule library: someone who has not agreed to BarrierFix applying rules is asked to agree first', async () => {
  const refused = await t.as(NEWB).post('/api/profiles/me/rules', { code: 'TS1' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'consent_required');
  assert.equal(await t.models.Profile.exists({ employeeId: ids.newb, 'rules.code': 'TS1' }), null, 'nothing was added');
  const ok = await t.as(NEWB).post('/api/profiles/me/rules', { code: 'TS1', consent: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.profile.consent.given, true);
  assert.equal(ok.body.profile.status, 'proposed');
});

test('rule library: only employees request rules, and a removed rule can be requested again', async () => {
  assert.equal((await t.as(MGR).post('/api/profiles/me/rules', { code: 'TS1' })).status, 403, 'a manager-only account has no profile');
  assert.equal((await t.as(HR).post('/api/profiles/me/rules', { code: 'TS1' })).status, 403);
  const removed = await t.as(EMP2).put('/api/profiles/me', { rules: [] });
  assert.equal(removed.status, 200);
  const back = await t.as(EMP2).post('/api/profiles/me/rules', { code: 'TS1' });
  assert.equal(back.status, 201, JSON.stringify(back.body));
  assert.equal(back.body.profile.rules.filter((r) => r.code === 'TS1').length, 1);
  assert.equal(back.body.profile.rules.find((r) => r.code === 'TS1').status, 'proposed');
});

// ---------------------------------------------------------------- 2. Correcting a task flagged as wrong

const MULTI_STEP = 'Please update the client tracker, email the summary to Sam and book the review room by Friday at 3pm';
const listOf = (card) => card.sections.find((s) => s.type === 'list');
const fieldOf = (card, key) => card.sections.find((s) => s.type === 'field' && s.key === key);

test('flagged task: the sender corrects what the employee received, and the layout of the agreed format is kept', async () => {
  const sent = await t.sendTask(MGR, { employeeId: ids.emp, text: MULTI_STEP });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const id = sent.body.brief._id;
  const original = sent.body.brief.deliveredCards;
  assert.ok(listOf(original[0])?.items.length >= 2, 'numbered steps to edit');

  assert.equal((await t.as(MGR).post(`/api/briefs/${id}/correct`, { cards: original })).status, 400, 'only after the employee flags it');
  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/flag`, { reason: 'Sam left the project' })).status, 200);

  const edited = clone(original);
  listOf(edited[0]).items[1] = 'Email the summary to Priya';
  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/correct`, { cards: edited })).status, 403, 'not the employee');
  assert.equal((await t.as(OTHER_MGR).post(`/api/briefs/${id}/correct`, { cards: edited })).status, 403, 'not another manager');

  const res = await t.as(MGR).post(`/api/briefs/${id}/correct`, { cards: edited });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = res.body.brief;
  assert.equal(b.deliveredVersion, 'manager_edited');
  assert.equal(b.employeeStatus, 'new', 'back with the employee to check');
  assert.deepEqual(b.deliveredCards[0].sections.map((s) => `${s.type}:${s.key}`), original[0].sections.map((s) => `${s.type}:${s.key}`), 'same layout');
  assert.equal(listOf(b.deliveredCards[0]).items[1], 'Email the summary to Priya');
  assert.match(b.deliveredCards[0].text, /Email the summary to Priya/);
  assert.ok(b.thread.some((x) => x.kind === 'note' && /Corrected/.test(x.text)), 'the correction shows in the conversation');

  const seen = (await t.as(EMP).get(`/api/briefs/${id}`)).body.brief;
  assert.equal(listOf(seen.deliveredCards[0]).items[1], 'Email the summary to Priya', 'the employee sees the corrected task');
  assert.ok(await notified(ids.emp, 'task_corrected'), 'and is told about it');
  assert.ok(await t.models.AuditLog.exists({ action: 'brief.corrected', entityId: id }));

  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/flag`, { reason: 'The room is wrong too' })).status, 200, 'a corrected task can be flagged again');
  const twice = clone(b.deliveredCards);
  listOf(twice[0]).items[2] = 'Book the small meeting room';
  const again = await t.as(MGR).post(`/api/briefs/${id}/correct`, { cards: twice });
  assert.equal(again.status, 200, 'and corrected again');
  assert.equal(listOf(again.body.brief.deliveredCards[0]).items[1], 'Email the summary to Priya', 'the earlier correction is kept');
});

test('flagged task: a correction must keep the layout and cannot leave a part empty', async () => {
  const sent = await t.sendTask(MGR, { employeeId: ids.emp, text: MULTI_STEP });
  const id = sent.body.brief._id;
  const cards = sent.body.brief.deliveredCards;
  await t.as(EMP).post(`/api/briefs/${id}/flag`, {});
  const send = (body) => t.as(MGR).post(`/api/briefs/${id}/correct`, body);

  assert.equal((await send({ cards: [] })).status, 400, 'every card is needed');
  const fewer = clone(cards);
  fewer[0].sections.pop();
  assert.equal((await send({ cards: fewer })).status, 400, 'no parts removed');
  const retyped = clone(cards);
  fieldOf(retyped[0], 'task').type = 'list';
  assert.equal((await send({ cards: retyped })).status, 400, 'no parts changed into something else');
  const emptyTask = clone(cards);
  fieldOf(emptyTask[0], 'task').text = '   ';
  assert.equal((await send({ cards: emptyTask })).status, 400, 'the task cannot be blank');
  const noSteps = clone(cards);
  listOf(noSteps[0]).items = ['', ' '];
  assert.equal((await send({ cards: noSteps })).status, 400, 'the steps cannot all be blank');
  assert.equal((await t.models.Brief.findById(id)).deliveredVersion, 'translated', 'nothing was saved');

  await t.as(MGR).post(`/api/briefs/${id}/cancel`);
  assert.equal((await send({ cards })).status, 400, 'a withdrawn task cannot be corrected');
});

test('flagged task: changing a time switches off its automatic reminders; other corrections keep them', async () => {
  const pending = (briefId) => t.models.ScheduledPrompt.countDocuments({ briefId, status: 'pending' });

  const a = (await t.sendTask(MGR, { employeeId: ids.emp, text: MULTI_STEP })).body.brief;
  assert.ok((await pending(a._id)) >= 1, 'a reminder is scheduled (Reminder before the deadline)');
  await t.as(EMP).post(`/api/briefs/${a._id}/flag`, {});
  const wordsOnly = clone(a.deliveredCards);
  listOf(wordsOnly[0]).items[0] = 'Update the client tracker with this week';
  const kept = await t.as(MGR).post(`/api/briefs/${a._id}/correct`, { cards: wordsOnly });
  assert.equal(kept.status, 200);
  assert.ok((await pending(a._id)) >= 1, 'the reminder still goes out');

  const b = (await t.sendTask(MGR, { employeeId: ids.emp, text: MULTI_STEP })).body.brief;
  await t.as(EMP).post(`/api/briefs/${b._id}/flag`, {});
  const newTime = clone(b.deliveredCards);
  fieldOf(newTime[0], 'due').text = 'Monday 30 November at 10am';
  const changed = await t.as(MGR).post(`/api/briefs/${b._id}/correct`, { cards: newTime });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(await pending(b._id), 0, 'reminders for the old time are not sent');
  assert.equal(fieldOf(changed.body.brief.deliveredCards[0], 'due').text, 'Monday 30 November at 10am');
  assert.ok(changed.body.brief.thread.some((x) => /reminders/i.test(x.text)), 'the manager is told the reminders were switched off');
});

// ---------------------------------------------------------------- 3. Manager home page analytics

test("manager home: the analytics count this manager's team only", async () => {
  // Adjustment Profiles: Abe has two rules agreed today and asks for a third; Ada's draft was never sent.
  await t.agreeProfile(AEMP1, ids.aemp1, AMGR, [{ code: 'TS1' }, { code: 'TM1' }]);
  assert.equal((await t.as(AEMP1).post('/api/profiles/me/rules', { code: 'CM3' })).status, 201);
  assert.equal((await t.as(AEMP2).put('/api/profiles/me', { rules: [{ code: 'TS1' }] })).status, 200);

  // Adjustment requests: one waiting, one accepted, one rejected and with HR, one rejected for good.
  const ask = async (who, title) => (await t.as(who).post('/api/decisions', { title })).body.record._id;
  await ask(AEMP1, 'Quiet room on Fridays');
  const accepted = await ask(AEMP1, 'Later start');
  await t.as(AMGR).post(`/api/decisions/${accepted}/respond`, { decision: 'accept' });
  const withHr = await ask(AEMP2, 'Second screen');
  await t.as(AMGR).post(`/api/decisions/${withHr}/respond`, { decision: 'reject', comment: 'No budget this month.' });
  const declined = await ask(AEMP2, 'Standing desk');
  await t.as(AMGR).post(`/api/decisions/${declined}/respond`, { decision: 'reject', comment: 'No space for it.' });
  await t.as(HR).post(`/api/decisions/${declined}/hr`, { action: 'accept_rejection' });

  // Tasks: two delivered, one with an unanswered question, one flagged.
  const task1 = (await t.sendTask(AMGR, { employeeId: ids.aemp1, text: 'Please send the invoice to Acme by Friday at 3pm' })).body.brief._id;
  const task2 = (await t.sendTask(AMGR, { employeeId: ids.aemp1, text: 'Please check the stock list and order the paper by Thursday at noon' })).body.brief._id;
  await t.as(AEMP1).post(`/api/briefs/${task1}/question`, { text: 'Which invoice number?' });
  await t.as(AEMP1).post(`/api/briefs/${task2}/flag`, {});

  // Reviews: the TS1 2-week review is done; the TM1 one is open now; nothing else is due within 30 days.
  await t.models.Review.updateMany({ employeeId: ids.aemp1, stageWeeks: 2 }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await reviews.activateDueReviews(new Date());
  const ts1 = await t.models.Review.findOne({ employeeId: ids.aemp1, ruleCode: 'TS1', stageWeeks: 2 });
  await t.as(AEMP1).post(`/api/reviews/${ts1._id}/answer`, { employee: { helping: 'yes', next: 'keep' } });
  await t.as(AMGR).post(`/api/reviews/${ts1._id}/answer`, { manager: { practical: 'yes' } });

  // Another manager's team, to check nothing leaks in.
  await t.sendTask(OTHER_MGR, { employeeId: ids.otherEmp, text: 'Please send the invoice to Acme by Friday at 3pm' });
  await t.as(OTHER_EMP).post('/api/profiles/me/rules', { code: 'CM3' });

  const dash = await t.as(AMGR).get('/api/dashboard');
  assert.equal(dash.status, 200);
  const a = dash.body.manager.analytics;
  assert.ok(a, 'analytics on the Professional plan');
  assert.deepEqual(a.decisions, { pending: 2, agreed: 3, declined: 1, pendingHr: 1 }, 'rules waiting + request waiting; 2 rules + 1 request agreed; 1 declined; 1 with HR');
  assert.deepEqual(a.tasks, { delivered: 2, questionsPending: 1, flaggedPending: 1 });
  assert.deepEqual(a.reviews, { pending: 1, completed: 1, upcoming: 0 });
  assert.equal(a.periodDays, 30);
});

test('manager home: a correction clears the flagged count, and the Starter plan keeps its simpler home page', async () => {
  const flagged = await t.models.Brief.findOne({ managerId: ids.amgr, employeeStatus: 'flagged' });
  const cards = (await t.as(AMGR).get(`/api/briefs/${flagged._id}`)).body.brief.deliveredCards;
  const edited = clone(cards);
  fieldOf(edited[0], 'task').text = `${fieldOf(edited[0], 'task').text} from the main supplier`;
  assert.equal((await t.as(AMGR).post(`/api/briefs/${flagged._id}/correct`, { cards: edited })).status, 200);
  assert.equal((await t.as(AMGR).get('/api/dashboard')).body.manager.analytics.tasks.flaggedPending, 0);

  await t.createCompany('Starter Ltd', 'boss@starter.test', { org: { plan: 'starter' } });
  await t.createPerson('boss@starter.test', 'sm@starter.test', 'Sam Starter', ['manager']);
  const starter = (await t.as('sm@starter.test').get('/api/dashboard')).body.manager;
  assert.equal(starter.detailed, false);
  assert.equal(starter.analytics, null, 'like the figures it replaces, this is part of the Professional plan');
});
