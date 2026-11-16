// Adjustment requests (simple flow agreed with the client on 16 Nov 2026):
//   an employee asks their manager, or a manager asks someone in their team, with a short form;
//   the other person accepts or rejects it with a comment;
//   accepted: closed, nothing else happens;
//   rejected: HR either accepts the rejection (closed) or sends it back, in which case whoever rejected
//   answers the six questions and HR then accepts the rejection (rejected) or rejects it (accepted).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const ADMIN = 'admin@req.test';
const MGR = 'mgr@req.test';
const EMP = 'emp@req.test';
const EMP2 = 'emp2@req.test';
const OTHER_MGR = 'other.mgr@req.test';
const OTHER_EMP = 'other.emp@req.test';
const HR = 'hr@req.test';
const HR_EMP = 'hr.emp@req.test';
const LONE = 'lone@req.test';
const ids = {};
let t;
let jobs;

const SIX = ['effectiveness', 'practicability', 'financialCost', 'otherImpact', 'employerResources', 'externalAssistance'];
const sixAnswers = () => Object.fromEntries(SIX.map((k) => [k, `We looked at ${k} with the team.`]));
const notified = (userId, kind) => t.models.Notification.exists({ userId, kind });

async function ask(from, body = {}) {
  const res = await t.as(from).post('/api/decisions', { title: 'Meetings on the ground floor', details: 'Stairs are hard for me to manage.', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.record;
}

before(async () => {
  t = await startApp();
  jobs = await import('../src/jobs/handlers.js');
  ids.org = (await t.createCompany('Req Ltd', ADMIN))._id;
  ids.mgr = await t.createPerson(ADMIN, MGR, 'Mia Manager', ['manager']);
  ids.emp = await t.createPerson(ADMIN, EMP, 'Eli Employee', ['employee'], ids.mgr);
  ids.emp2 = await t.createPerson(ADMIN, EMP2, 'Ezra Two', ['employee'], ids.mgr);
  ids.otherMgr = await t.createPerson(ADMIN, OTHER_MGR, 'Olu Other', ['manager']);
  ids.otherEmp = await t.createPerson(ADMIN, OTHER_EMP, 'Ola Other', ['employee'], ids.otherMgr);
  ids.hr = await t.createPerson(ADMIN, HR, 'Hal Hr', ['hr']);
  ids.hrEmp = await t.createPerson(ADMIN, HR_EMP, 'Hana Both', ['employee', 'hr'], ids.mgr);
  ids.lone = await t.createPerson(ADMIN, LONE, 'Lou Lone', ['employee']);
});

after(async () => t.stop());

test('an employee asks their manager with a simple form, and only that manager can answer', async () => {
  const record = await ask(EMP);
  assert.equal(record.status, 'pending');
  assert.equal(record.direction, 'to_manager');
  assert.equal(record.requesterId, ids.emp);
  assert.equal(record.recipientId, ids.mgr);
  assert.equal(record.employeeId, ids.emp);
  assert.equal(record.managerId, ids.mgr);
  assert.deepEqual([record.request.title, record.request.details], ['Meetings on the ground floor', 'Stairs are hard for me to manage.']);
  assert.ok(await notified(ids.mgr, 'request_received'), 'the manager is told');

  assert.equal((await t.as(EMP).post('/api/decisions', { details: 'No title' })).status, 400, 'a title is needed');
  const respond = (who) => t.as(who).post(`/api/decisions/${record._id}/respond`, { decision: 'accept' });
  assert.equal((await respond(EMP)).status, 403, 'not the person who asked');
  assert.equal((await respond(HR)).status, 403, 'not HR');
  assert.equal((await respond(OTHER_MGR)).status, 403, 'not another manager');
  assert.equal((await t.as(OTHER_MGR).get(`/api/decisions/${record._id}`)).status, 403, 'who cannot even see it');
  assert.equal((await t.as(HR).get(`/api/decisions/${record._id}`)).status, 200, 'HR can see every request');

  const lone = await t.as(LONE).post('/api/decisions', { title: 'A quiet desk' });
  assert.equal(lone.status, 400, 'someone without a line manager is told to ask for one');
  assert.match(lone.body.error, /line manager/i);
});

test('accepting closes the request and nothing else happens', async () => {
  const record = await ask(EMP, { title: 'A second screen' });
  const profilesBefore = await t.models.Profile.countDocuments({});
  const accepted = await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'accept', comment: 'Yes, ordering one today.' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.record.status, 'accepted');
  assert.equal(accepted.body.record.response.comment, 'Yes, ordering one today.');
  assert.ok(await notified(ids.emp, 'request_accepted'));
  assert.equal(await t.models.Profile.countDocuments({}), profilesBefore, 'the profile is not touched');
  assert.equal(await notified(ids.hr, 'request_rejected'), null, 'HR is not involved');
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'Changed my mind' })).status, 400, 'answered once');
});

test('a manager can ask someone in their own team, and nobody else', async () => {
  const toTeam = await ask(MGR, { employeeId: ids.emp2, title: 'Use the quiet room for calls' });
  assert.equal(toTeam.direction, 'to_employee');
  assert.equal(toTeam.requesterId, ids.mgr);
  assert.equal(toTeam.recipientId, ids.emp2);
  assert.ok(await notified(ids.emp2, 'request_received'));
  assert.equal((await t.as(MGR).post('/api/decisions', { employeeId: ids.otherEmp, title: 'Not my team' })).status, 403);
  assert.equal((await t.as(EMP).post('/api/decisions', { employeeId: ids.emp2, title: 'A colleague' })).status, 403, 'employees only ask their own manager');
  await t.as(MGR).post(`/api/decisions/${toTeam._id}/withdraw`);
});

test('a rejection needs a comment and goes to HR, who can accept the rejection and close it', async () => {
  const record = await ask(EMP, { title: 'Start at 10am' });
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'reject' })).status, 400, 'a reason is needed');
  const rejected = await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'Client calls start at 9am.' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.record.status, 'hr_review');
  assert.ok(await notified(ids.hr, 'request_rejected'), 'HR is told');
  assert.ok(await notified(ids.emp, 'request_rejected'), 'and so is the person who asked');

  const hrList = (await t.as(HR).get('/api/decisions?scope=hr')).body.records.map((r) => r._id);
  assert.ok(hrList.includes(record._id), "it is in HR's list");
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() })).status, 400, 'no questions until HR sends it back');
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection' })).status, 403, 'only HR reviews');
  assert.equal((await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'reject_rejection' })).status, 400, 'first HR can only accept it or send it back');

  const closed = await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection', comment: 'The reason is fair.' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.record.status, 'rejected');
  assert.ok(await notified(ids.emp, 'request_closed'));
  assert.ok(await notified(ids.mgr, 'request_closed'));
});

test('HR can send it back: whoever rejected answers the six questions, then HR makes the final call', async () => {
  const meta = (await t.as(MGR).get('/api/decisions/meta')).body;
  assert.deepEqual(meta.factors.map((f) => f.key), SIX);
  assert.ok(meta.factors.every((f) => f.title && f.prompt));

  const record = await ask(EMP, { title: 'Work from home on Fridays' });
  await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'The team needs everyone in on Fridays.' });
  const sentBack = await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'send_back', comment: 'Please go through the six questions.' });
  assert.equal(sentBack.body.record.status, 'answering');
  assert.ok(await notified(ids.mgr, 'request_answers_needed'));

  assert.equal((await t.as(EMP).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() })).status, 403, 'only the person who rejected answers');
  assert.equal((await t.as(HR).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() })).status, 403);
  const partial = { ...sixAnswers(), externalAssistance: '' };
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/answers`, { answers: partial })).status, 400, 'all six are needed');

  const answered = await t.as(MGR).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(answered.body.record.status, 'hr_final');
  assert.equal(answered.body.record.answers.effectiveness.text, 'We looked at effectiveness with the team.');
  assert.equal(answered.body.record.answers.effectiveness.by, ids.mgr);
  assert.equal(answered.body.record.promptVersion, 1);
  assert.ok(await notified(ids.hr, 'request_answers_ready'));
  assert.equal((await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'send_back' })).status, 400, 'it cannot be sent back twice');

  const overturned = await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'reject_rejection', comment: 'Fridays at home can work with a phone rota.' });
  assert.equal(overturned.status, 200, JSON.stringify(overturned.body));
  assert.equal(overturned.body.record.status, 'overturned', 'HR rejected the rejection, so the request stands');
  assert.ok(await notified(ids.emp, 'request_closed'));
});

test("an employee rejecting their manager's request goes through the same steps", async () => {
  const record = await ask(MGR, { employeeId: ids.emp2, title: 'Move to the front desk' });
  const rejected = await t.as(EMP2).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'The front desk is too noisy for me.' });
  assert.equal(rejected.body.record.status, 'hr_review');
  await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'send_back' });
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() })).status, 403, 'the manager asked, so the employee answers');
  const answered = await t.as(EMP2).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() });
  assert.equal(answered.body.record.status, 'hr_final');
  const final = await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection' });
  assert.equal(final.body.record.status, 'rejected');
});

test('HR cannot make adjustment requests', async () => {
  const before = await t.models.DecisionRecord.countDocuments({});
  const hr = await t.as(HR).post('/api/decisions', { title: 'A footrest' });
  assert.equal(hr.status, 403, 'an HR account cannot send a request');
  assert.match(hr.body.error, /HR/);
  assert.equal((await t.as(HR_EMP).post('/api/decisions', { title: 'A footrest' })).status, 403, 'nor an HR person who is also an employee');
  assert.equal(await t.models.DecisionRecord.countDocuments({}), before, 'nothing was created');
});

test('HR cannot review a request they are part of', async () => {
  // An HR person can still be asked by their own manager; they then cannot review their own rejection.
  const record = await ask(MGR, { employeeId: ids.hrEmp, title: 'Sit nearer the team' });
  await t.as(HR_EMP).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'I need the quiet corner for my work.' });
  assert.equal((await t.as(HR_EMP).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection' })).status, 403, 'not a request they are part of');
  assert.ok(!(await t.as(HR_EMP).get('/api/decisions?scope=hr')).body.records.some((r) => r._id === record._id));
  assert.equal((await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection' })).status, 200, 'another HR person can');
});

test('the person who asked can withdraw a request until it is answered', async () => {
  const record = await ask(EMP, { title: 'Later lunch' });
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/withdraw`)).status, 403, 'only the person who asked');
  const withdrawn = await t.as(EMP).post(`/api/decisions/${record._id}/withdraw`);
  assert.equal(withdrawn.body.record.status, 'withdrawn');
  assert.ok(await notified(ids.mgr, 'request_withdrawn'));
  assert.equal((await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'accept' })).status, 400);
  const answered = await ask(EMP, { title: 'Blinds' });
  await t.as(MGR).post(`/api/decisions/${answered._id}/respond`, { decision: 'accept' });
  assert.equal((await t.as(EMP).post(`/api/decisions/${answered._id}/withdraw`)).status, 400, 'not once answered');
});

test('in a company with no HR person, a rejection is final', async () => {
  await t.createCompany('NoHr Ltd', 'boss@nohr.test');
  const nm = await t.createPerson('boss@nohr.test', 'nm@nohr.test', 'Nia Manager', ['manager']);
  await t.createPerson('boss@nohr.test', 'ne@nohr.test', 'Ned Employee', ['employee'], nm);
  const record = await ask('ne@nohr.test');
  const rejected = await t.as('nm@nohr.test').post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'We have no ground floor room.' });
  assert.equal(rejected.body.record.status, 'rejected');
  assert.ok(rejected.body.record.history.some((h) => /no HR/i.test(h.detail || '')), 'the record says why');
});

test('lists show each person what is waiting for them', async () => {
  const waiting = await ask(EMP, { title: 'Desk by the window' });
  const sentBack = await ask(EMP, { title: 'Longer breaks' });
  await t.as(MGR).post(`/api/decisions/${sentBack._id}/respond`, { decision: 'reject', comment: 'Shifts are tight.' });
  await t.as(HR).post(`/api/decisions/${sentBack._id}/hr`, { action: 'send_back' });
  const list = async (who, scope) => (await t.as(who).get(`/api/decisions?scope=${scope}`)).body.records?.map((r) => r._id) || [];

  const mgrWaiting = await list(MGR, 'waiting');
  assert.ok(mgrWaiting.includes(waiting._id) && mgrWaiting.includes(sentBack._id), 'to answer, and six questions to fill in');
  assert.ok(!(await list(EMP, 'waiting')).includes(waiting._id), 'nothing for the person who asked');
  assert.ok((await list(EMP, 'mine')).includes(waiting._id));
  assert.ok(!(await list(OTHER_EMP, 'mine')).includes(waiting._id));
  assert.equal((await t.as(MGR).get('/api/decisions?scope=hr')).status, 403, 'the HR list is for HR');
  assert.equal((await t.as(MGR).get('/api/decisions?scope=all')).status, 403);
  assert.ok((await list(HR, 'all')).includes(waiting._id));
});

test('every step is versioned, attributed and audited; exports leave out health details', async () => {
  const record = await ask(EMP, { title: 'Rest breaks', details: 'Because of my ADHD diagnosis short breaks help.' });
  const created = await t.as(EMP).post('/api/decisions', { title: 'Another', details: 'My ADHD makes long meetings hard.' });
  assert.ok(created.body.warning?.terms.includes('adhd'), 'health details are flagged when typed');
  await t.as(MGR).post(`/api/decisions/${record._id}/respond`, { decision: 'reject', comment: 'Not possible on the line.' });
  await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'send_back' });
  await t.as(MGR).post(`/api/decisions/${record._id}/answers`, { answers: sixAnswers() });
  await t.as(HR).post(`/api/decisions/${record._id}/hr`, { action: 'accept_rejection' });

  const versions = await t.as(HR).get(`/api/decisions/${record._id}/versions`);
  assert.equal(versions.status, 200, JSON.stringify(versions.body));
  const list = versions.body.versions;
  assert.deepEqual(list.map((v) => v.version), list.map((_, i) => i + 1));
  assert.deepEqual(list.map((v) => v.action), ['requested', 'rejected', 'hr_sent_back', 'answers_submitted', 'hr_accepted_rejection']);
  assert.ok(list.every((v) => v.by && v.at));
  assert.equal((await t.as(EMP).get(`/api/decisions/${record._id}/versions`)).status, 403);
  await assert.rejects(() => t.models.DecisionRecordVersion.updateOne({}, { $set: { action: 'tampered' } }), /append-only/);
  assert.ok(await t.models.AuditLog.exists({ action: 'decision.answers_submitted', entityId: String(record._id) }));

  const masked = await t.as(HR).get('/api/decisions/export.csv');
  assert.equal(masked.status, 200);
  assert.ok(!/ADHD/i.test(masked.text), 'health terms are masked in the CSV');
  assert.match(masked.text, /\[health detail removed\]/);
  assert.match((await t.as(HR).get('/api/decisions/export.csv?full=1')).text, /ADHD/);
  assert.equal((await t.as(MGR).get('/api/decisions/export.csv')).status, 403);
  const pdf = await t.as(EMP).get(`/api/decisions/${record._id}/export`);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((await t.as(MGR).get(`/api/decisions/${record._id}/export?full=1`)).status, 403, 'only HR can export the full text');
});

test('whoever has to act next gets one reminder', async () => {
  const record = await ask(EMP2, { title: 'A headset' });
  const later = new Date(Date.now() + 10 * 86400 * 1000);
  const before = await t.models.Notification.countDocuments({ userId: ids.mgr, kind: 'request_reminder' });
  assert.ok((await jobs.remindIncompleteDecisions(later)) >= 1);
  assert.ok((await t.models.Notification.countDocuments({ userId: ids.mgr, kind: 'request_reminder' })) > before, 'the manager is reminded to answer');
  assert.equal(await jobs.remindIncompleteDecisions(later), 0, 'not again straight away');
  assert.equal((await t.models.DecisionRecord.findById(record._id)).status, 'pending', 'never closed by itself');
});

test('requests saved in the earlier format are converted to the new one at start-up', async () => {
  const { migrateOldRequests } = await import('../src/modules/decisions/migrate.js');
  const now = new Date();
  const base = { orgId: t.models.DecisionRecord.base.Types.ObjectId.createFromHexString(String(ids.org)), employeeId: t.models.DecisionRecord.base.Types.ObjectId.createFromHexString(String(ids.emp)), managerId: t.models.DecisionRecord.base.Types.ObjectId.createFromHexString(String(ids.mgr)), promptVersion: 1, version: 3, history: [], createdAt: now, updatedAt: now };
  const col = t.models.DecisionRecord.collection;
  const { insertedIds } = await col.insertMany([
    { ...base, status: 'considering_decline', request: { title: 'Old open one', description: 'Some detail', howItHelps: 'It helps', requestedBy: 'employee' }, factors: { effectiveness: { answer: 'no', reason: 'Too costly' } } },
    { ...base, status: 'proposed_decline', request: { title: 'Old proposed decline', requestedBy: 'employee' }, proposal: { decision: 'declined', reason: 'No budget this year' } },
    { ...base, status: 'decided', request: { title: 'Old agreed one', requestedBy: 'manager' }, outcome: { decision: 'approved', reason: 'Fine' } },
  ]);
  assert.equal(await migrateOldRequests(), 3);
  assert.equal(await migrateOldRequests(), 0, 'only once');
  const get = async (i) => (await t.as(HR).get(`/api/decisions/${insertedIds[i]}`)).body.record;
  const open = await get(0);
  assert.equal(open.status, 'pending');
  assert.equal(open.requesterId, ids.emp);
  assert.equal(open.recipientId, ids.mgr);
  assert.equal(open.request.details, 'Some detail\n\nIt helps');
  assert.match(open.answers.effectiveness.text, /Too costly/, 'earlier answers are kept');
  const declined = await get(1);
  assert.equal(declined.status, 'hr_review');
  assert.equal(declined.response.decision, 'rejected');
  assert.equal(declined.response.comment, 'No budget this year');
  const agreed = await get(2);
  assert.equal(agreed.status, 'accepted');
  assert.equal(agreed.direction, 'to_employee', 'it was a manager\'s request');
  assert.equal(agreed.requesterId, ids.mgr);
});
