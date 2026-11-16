// Feature coverage against the MVP scope (project context, client requirements sheet and the agreed
// login flow) for the parts the main API test does not exercise. Email delivery over SMTP is not
// tested: emails are captured in the Dev mailbox instead.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const ADMIN = 'admin@scope.test';
const MGR = 'mgr@scope.test';
const EMP = 'emp@scope.test';
const EMP2 = 'emp2@scope.test';
const HR = 'hr@scope.test';
const VIEWER = 'viewer@scope.test';
const ids = {};
let t;
let jobs;
let profiles;

const RULES = [{ code: 'TS1' }, { code: 'TS3' }, { code: 'TM1' }, { code: 'TM2', params: { daysBefore: 1, time: '12:00' } }, { code: 'CM4' }, { code: 'MT1' }, { code: 'MT2' }];
const FACTORS = ['effectiveness', 'practicability', 'financialCost', 'otherImpact', 'employerResources', 'externalAssistance'];
const allYes = () => Object.fromEntries(FACTORS.map((k) => [k, { answer: 'yes' }]));
const reasoned = () => ({
  ...Object.fromEntries(FACTORS.map((k) => [k, { answer: 'no', reason: `Considered ${k} carefully with the team.` }])),
  financialCost: { answer: 'no', reason: 'A quote came to about £400 a year.', estimatedCost: 400, costBasis: 'Supplier quote' },
  otherImpact: { answer: 'no', noneIdentified: true },
  externalAssistance: { answer: 'unsure', reason: 'Access to Work was considered; support must be verified.', accessToWorkConsidered: true },
});
const rulesFrom = (profile) => profile.rules.filter((r) => r.status !== 'removed').map((r) => ({ code: r.code, params: r.pending?.params || r.params, note: r.note }));

before(async () => {
  t = await startApp();
  jobs = await import('../src/jobs/handlers.js');
  profiles = await import('../src/modules/profiles/service.js');
  const org = await t.createCompany('Scope Ltd', ADMIN, { org: { plan: 'enterprise' } });
  ids.org = org._id;
  ids.mgr = await t.createPerson(ADMIN, MGR, 'Mia Manager', ['manager']);
  ids.emp = await t.createPerson(ADMIN, EMP, 'Eli Employee', ['employee'], ids.mgr);
  ids.hr = await t.createPerson(ADMIN, HR, 'Hal Hr', ['hr']);
  ids.viewer = await t.createPerson(ADMIN, VIEWER, 'Val Viewer', ['employee']);
  ids.emp2 = await t.createPerson(MGR, EMP2, 'Ezra Two', ['employee']);
  await t.agreeProfile(EMP, ids.emp, MGR, RULES);
  // A second company, on the default plan, for isolation and plan checks.
  await t.createCompany('Solo Ltd', 'boss@solo.test');
});

after(async () => t.stop());

// ---------------------------------------------------------------- Adjustment Profile

test('profile: a change to an agreed rule waits for agreement while the agreed setting keeps applying', async () => {
  const next = RULES.map((r) => (r.code === 'TM2' ? { code: 'TM2', params: { daysBefore: 2, time: '10:00' } } : r));
  const edited = await t.as(EMP).put('/api/profiles/me', { rules: next });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const tm2 = edited.body.profile.rules.find((r) => r.code === 'TM2');
  assert.equal(tm2.status, 'agreed');
  assert.deepEqual(tm2.pending.params, { daysBefore: 2, time: '10:00' });
  const live = await profiles.activeRulesFor(ids.emp, ids.org);
  assert.equal(live.find((r) => r.code === 'TM2').params.daysBefore, 1, 'the agreed setting still applies');

  await t.as(EMP).post('/api/profiles/me/submit', { consent: true });
  assert.equal((await t.as(MGR).post(`/api/profiles/${ids.emp}/agree`)).status, 200);
  const after = await profiles.activeRulesFor(ids.emp, ids.org);
  assert.equal(after.find((r) => r.code === 'TM2').params.daysBefore, 2, 'the new setting applies once agreed');
});

test('profile: removing a rule takes effect at once, tells the manager and cancels its reviews', async () => {
  const before = await t.models.Review.countDocuments({ employeeId: ids.emp, ruleCode: 'CM4', status: { $in: ['scheduled', 'open'] } });
  assert.equal(before, 3, 'reviews at 2, 6 and 12 weeks were booked');
  const current = (await t.as(EMP).get('/api/profiles/me')).body.profile;
  const res = await t.as(EMP).put('/api/profiles/me', { rules: rulesFrom(current).filter((r) => r.code !== 'CM4') });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!(await profiles.activeRulesFor(ids.emp, ids.org)).some((r) => r.code === 'CM4'));
  assert.equal(await t.models.Review.countDocuments({ employeeId: ids.emp, ruleCode: 'CM4', status: { $in: ['scheduled', 'open'] } }), 0);
  assert.ok(await t.models.Notification.exists({ userId: ids.mgr, kind: 'profile_rule_removed' }));
});

test('profile: unknown rules and out-of-range settings are refused', async () => {
  const current = rulesFrom((await t.as(EMP).get('/api/profiles/me')).body.profile);
  assert.equal((await t.as(EMP).put('/api/profiles/me', { rules: [...current, { code: 'ZZ9' }] })).status, 400);
  const badTm2 = current.map((r) => (r.code === 'TM2' ? { ...r, params: { daysBefore: 99, time: '12:00' } } : r));
  assert.equal((await t.as(EMP).put('/api/profiles/me', { rules: badTm2 })).status, 400);
  assert.equal((await t.as(EMP).post('/api/profiles/me/submit', { consent: false })).status, 400, 'consent must be given');
});

test('profile: the manager can ask for changes instead of agreeing', async () => {
  await t.as(EMP2).put('/api/profiles/me', { rules: [{ code: 'TS1' }, { code: 'TM1' }] });
  await t.as(EMP2).post('/api/profiles/me/submit', { consent: true });
  assert.equal((await t.as(VIEWER).post(`/api/profiles/${ids.emp2}/request-changes`, { comment: 'Not your team' })).status, 403);
  const res = await t.as(MGR).post(`/api/profiles/${ids.emp2}/request-changes`, { comment: 'Can we talk about the check-in time first?' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.profile.status, 'changes_requested');
  assert.ok(await t.models.Notification.exists({ userId: ids.emp2, kind: 'profile_changes_requested' }));
});

test('profile: pausing stops formatting and switching it back on restarts it', async () => {
  const before = await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please send the invoice to Acme by Friday' });
  const paused = await t.as(EMP).post('/api/profiles/me/consent', { given: false });
  assert.equal(paused.status, 200);
  assert.ok(await t.models.Notification.exists({ userId: ids.mgr, kind: 'profile_paused' }));
  const preview = await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please send the invoice to Acme by Friday' });
  assert.equal(preview.body.hasProfile, false);
  assert.equal(preview.body.draftId, undefined, 'nothing to send');
  assert.equal((await t.as(MGR).post('/api/briefs', { draftId: before.body.draftId })).status, 400, 'a preview made before the pause cannot be sent');
  await t.as(EMP).post('/api/profiles/me/consent', { given: true });
  assert.equal((await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please send the invoice to Acme by Friday' })).body.hasProfile, true);
});

test('profile: people the employee adds can see it; other colleagues cannot', async () => {
  assert.equal((await t.as(VIEWER).get(`/api/profiles/${ids.emp}`)).status, 403);
  const current = rulesFrom((await t.as(EMP).get('/api/profiles/me')).body.profile);
  const res = await t.as(EMP).put('/api/profiles/me', { rules: current, extraViewerIds: [ids.viewer] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.profile.accessList.some((a) => a.reason === 'Added by the employee'));
  assert.equal((await t.as(VIEWER).get(`/api/profiles/${ids.emp}`)).status, 200);
  assert.ok((await profiles.activeRulesFor(ids.emp, ids.org)).length > 0, 'saving viewers does not change the agreed rules');
});

test('profile: exports as PDF and JSON, and an HR spreadsheet only proposes rules', async () => {
  const pdf = await t.as(EMP).get('/api/profiles/me/export');
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  const json = await t.as(MGR).get(`/api/profiles/${ids.emp}/export?format=json`);
  assert.equal(json.status, 200);
  assert.ok(json.body.rules.some((r) => r.code === 'TS1' && r.status === 'agreed'));
  const csv = 'employee_email,rule_code,params,note\nemp2@scope.test,TM3,hoursBefore=4,\nemp2@scope.test,TM3,,\nemp2@scope.test,TM2,daysBefore=50,\nemp2@scope.test,ZZ9,,\nnobody@scope.test,TS1,,\n';
  const imported = await t.as(HR).post('/api/profiles/import', { csv });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.added, 1);
  assert.equal(imported.body.skipped.length, 4);
  const p = await t.models.Profile.findOne({ employeeId: ids.emp2 });
  assert.equal(p.rules.find((r) => r.code === 'TM3').status, 'proposed', 'imported rules still need the employee and manager');
  assert.equal((await t.as(MGR).post('/api/profiles/import', { csv })).status, 403);
});

// ---------------------------------------------------------------- Tasks

test('tasks: separate requests in one message become separate cards (TS3)', async () => {
  const res = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Can you send the invoice to Acme by Friday? Also, please book the meeting room for Thursday.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.brief.deliveredCards.length, 2);
  assert.ok(res.body.brief.appliedRules.some((r) => r.code === 'TS3'));
  assert.ok(Math.abs(new Date(res.body.brief.expiresAt) - Date.now() - 30 * 86400000) < 86400000, 'task text is deleted after 30 days');
});

test('tasks: verbal instructions and spreadsheet uploads are previewed, then delivered the same way', async () => {
  const verbal = await t.sendTask(MGR, { employeeId: ids.emp, text: 'As discussed on the call, please update the client tracker by Wednesday.', source: 'verbal' });
  assert.equal(verbal.status, 201, JSON.stringify(verbal.body));
  assert.equal(verbal.body.brief.source, 'verbal');
  const inbox = async () => (await t.as(EMP).get('/api/briefs?box=inbox&limit=200')).body.briefs.length;
  const before = await inbox();
  const csv = 'employee_email,brief_text\nemp@scope.test,Please send the board pack to Sam by Friday\nnobody@scope.test,Please send it\nviewer@scope.test,Please send the board pack by Friday\n';
  const res = await t.as(MGR).post('/api/briefs/import', { csv });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.results.map((r) => r.ok), [true, false, false]);
  assert.match(res.body.results[2].reason, /no agreed Adjustment Profile/);
  const row = res.body.results[0];
  assert.ok(row.draftId, 'each row is kept as a preview');
  assert.match(row.preview?.text || '', /board pack/, 'showing what the person will receive');
  assert.equal(await inbox(), before, 'nothing is sent by the upload alone');

  const notMine = await t.as(HR).post('/api/briefs/import/send', { draftIds: [row.draftId] });
  assert.equal(notMine.body.results[0].ok, false, 'only the person who uploaded can send');
  const sent = await t.as(MGR).post('/api/briefs/import/send', { draftIds: [row.draftId] });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.results[0].ok, true);
  assert.equal(await inbox(), before + 1);
  assert.equal((await t.as(MGR).post('/api/briefs/import/send', { draftIds: [row.draftId] })).body.results[0].ok, false, 'only once');

  const again = await t.as(MGR).post('/api/briefs/import', { csv: 'employee_email,brief_text\nemp@scope.test,Please file the receipts by Friday\n' });
  const dropped = again.body.results[0].draftId;
  assert.equal((await t.as(MGR).post('/api/briefs/import/discard', { draftIds: [dropped] })).status, 200);
  assert.equal(await t.models.Brief.exists({ _id: dropped }), null, 'cancelled uploads are removed');
  assert.equal((await t.as(EMP).post('/api/briefs/import', { csv })).status, 403, 'employees cannot send tasks');
});

test('tasks: the web form previews first, and only that preview is sent, once, by the person who made it', async () => {
  const text = 'Please draft the client newsletter by Thursday';
  const preview = await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const { draftId } = preview.body;
  assert.ok(draftId, 'the preview is kept as a draft');
  assert.ok(!(await t.as(EMP).get('/api/briefs?box=inbox&limit=200')).body.briefs.some((b) => b._id === draftId), 'nothing reaches the employee yet');

  const direct = await t.as(MGR).post('/api/briefs', { employeeId: ids.emp, text });
  assert.equal(direct.status, 409, 'a task cannot be sent without a preview');
  assert.equal(direct.body.code, 'preview_required');
  assert.equal((await t.as(HR).post('/api/briefs', { draftId })).status, 404, "nobody else can send someone's preview");
  assert.equal((await t.as(EMP).post('/api/briefs', { draftId })).status, 403);

  const sent = await t.as(MGR).post('/api/briefs', { draftId });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.brief._id, draftId);
  assert.equal(sent.body.brief.status, 'delivered');
  assert.equal(sent.body.brief.translatedText, preview.body.result.text, 'exactly what was previewed is delivered');
  assert.equal((await t.as(MGR).post('/api/briefs', { draftId })).status, 400, 'and only once');
});

test('tasks: changing a preview replaces its draft, and cancelling removes it', async () => {
  const first = (await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please renew the insurance by Friday' })).body.draftId;
  const second = (await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please renew the insurance by Friday at noon', replaces: first })).body.draftId;
  assert.equal(await t.models.Brief.exists({ _id: first }), null, 'the older draft is gone');
  const hrDraft = (await t.as(HR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please check the rota by Friday', replaces: second })).body.draftId;
  assert.ok(await t.models.Brief.exists({ _id: second }), "nobody can replace someone else's draft");
  assert.equal((await t.as(HR).delete(`/api/briefs/drafts/${second}`)).status, 404, 'or cancel it');
  assert.equal((await t.as(MGR).delete(`/api/briefs/drafts/${second}`)).status, 200);
  assert.equal(await t.models.Brief.exists({ _id: second }), null);
  assert.equal((await t.as(MGR).post('/api/briefs', { draftId: second })).status, 404, 'a cancelled preview cannot be sent');
  await t.as(HR).delete(`/api/briefs/drafts/${hrDraft}`);
});

test('tasks: questions, answers, flags and withdrawal', async () => {
  const sent = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Please draft the newsletter by Thursday' });
  const id = sent.body.brief._id;
  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/question`, { text: 'Which audience?' })).status, 200);
  const answered = await t.as(MGR).post(`/api/briefs/${id}/answer`, { text: 'Customers.' });
  assert.equal(answered.body.brief.thread.length, 2);
  const flagged = await t.as(EMP).post(`/api/briefs/${id}/flag`, { reason: 'The deadline looks wrong' });
  assert.equal(flagged.body.brief.employeeStatus, 'flagged');
  assert.ok(await t.models.Notification.exists({ userId: ids.mgr, kind: 'task_flagged' }));
  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/cancel`)).status, 403, 'only the sender withdraws a task');
  const cancelled = await t.as(MGR).post(`/api/briefs/${id}/cancel`);
  assert.equal(cancelled.body.brief.status, 'cancelled');
  assert.equal((await t.as(EMP).post(`/api/briefs/${id}/confirm`)).status, 400, 'a withdrawn task cannot be confirmed');
  assert.equal((await t.as(MGR).post(`/api/briefs/${id}/cancel`)).status, 400);
});

test('tasks: a held translation can be approved, edited or kept as the original', async () => {
  const make = async () => {
    const res = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Please send the invoice to Acme by Friday' });
    await t.models.Brief.updateOne({ _id: res.body.brief._id }, { $set: { status: 'held', deliveredVersion: 'original' } });
    return res.body.brief._id;
  };
  const a = await make();
  assert.equal((await t.as(EMP).post(`/api/briefs/${a}/resolve`, { action: 'approve' })).status, 403);
  const approved = await t.as(MGR).post(`/api/briefs/${a}/resolve`, { action: 'approve' });
  assert.equal(approved.body.brief.status, 'approved');
  assert.equal(approved.body.brief.deliveredVersion, 'translated');
  assert.equal((await t.as(MGR).post(`/api/briefs/${a}/resolve`, { action: 'approve' })).status, 400, 'only a held task can be resolved');

  const b = await make();
  assert.equal((await t.as(MGR).post(`/api/briefs/${b}/resolve`, { action: 'edit', text: '' })).status, 400);
  const edited = await t.as(MGR).post(`/api/briefs/${b}/resolve`, { action: 'edit', text: 'Task: Send the invoice to Acme\nDue: Friday at 5pm' });
  assert.equal(edited.body.brief.deliveredVersion, 'manager_edited');
  assert.match(edited.body.brief.deliveredCards[0].text, /Send the invoice to Acme/);

  const c = await make();
  const kept = await t.as(MGR).post(`/api/briefs/${c}/resolve`, { action: 'keep_original' });
  assert.equal(kept.body.brief.status, 'original_sent');
});

test('tasks: only the sender and the recipient can open a task, and drafts never show as sent', async () => {
  const sent = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Please update the price list by Monday' });
  const id = sent.body.brief._id;
  assert.equal((await t.as(HR).get(`/api/briefs/${id}`)).status, 403);
  assert.equal((await t.as(EMP2).get(`/api/briefs/${id}`)).status, 403);
  assert.equal((await t.as(EMP).get(`/api/briefs/${id}`)).status, 200);
  const service = await import('../src/modules/briefs/service.js');
  const [org, manager, employee] = await Promise.all([t.models.Organization.findById(ids.org), t.models.User.findById(ids.mgr), t.models.User.findById(ids.emp)]);
  const draft = await service.createBrief({ org, manager, employee, text: 'Please call the supplier by Friday', source: 'slack', asDraft: true });
  const sentBox = await t.as(MGR).get('/api/briefs?box=sent&limit=200');
  assert.ok(!sentBox.body.briefs.some((b) => b._id === String(draft._id)));
  assert.ok(!(await t.as(EMP).get('/api/briefs?box=inbox&limit=200')).body.briefs.some((b) => b._id === String(draft._id)));
  await service.discardDraft(draft);
});

test('tasks: when the company has not connected Slack, delivery is skipped, not reported as failed', async () => {
  assert.equal((await t.as(ADMIN).patch(`/api/users/${ids.emp}`, { slackUserId: 'U0SCOPE1' })).status, 200);
  const before = await t.models.Notification.countDocuments({ userId: ids.mgr, kind: 'delivery_failed' });
  const sent = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Please renew the domain by Friday' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.brief.delivery.slack, 'skipped');
  assert.equal(await t.models.Notification.countDocuments({ userId: ids.mgr, kind: 'delivery_failed' }), before, 'no false "Slack failed" alert');
  await t.as(ADMIN).patch(`/api/users/${ids.emp}`, { slackUserId: null });
});

// ---------------------------------------------------------------- Meetings

test('meetings: agenda and summary prompts follow the attendees\' agreed rules', async () => {
  const startsAt = new Date(Date.now() + 3 * 86400000);
  const endsAt = new Date(startsAt.getTime() + 3600000);
  assert.equal((await t.as(EMP).post('/api/meetings', { title: 'Planning', startsAt, endsAt, attendeeIds: [ids.mgr] })).status, 403, 'employees do not log meetings');
  assert.equal((await t.as(MGR).post('/api/meetings', { title: 'Planning', startsAt: endsAt, endsAt: startsAt, attendeeIds: [ids.emp] })).status, 400);
  assert.equal((await t.as(MGR).post('/api/meetings', { title: 'Planning', startsAt, endsAt, attendeeIds: ['5f5f5f5f5f5f5f5f5f5f5f5f'] })).status, 400, 'attendees must be in the company');

  const created = await t.as(MGR).post('/api/meetings', { title: 'Quarterly planning', startsAt, endsAt, attendeeIds: [ids.emp] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.meeting._id;
  const prompts = await t.models.ScheduledPrompt.find({ meetingId: id, status: 'pending' });
  assert.deepEqual(prompts.map((p) => p.kind).sort(), ['agenda_share', 'summary_request']);

  // No agenda yet when the agenda is due: the organiser is asked for one.
  await jobs.processDuePrompts(new Date(startsAt.getTime() - 3600000));
  assert.ok(await t.models.Notification.exists({ userId: ids.mgr, kind: 'agenda_request' }));
  const withAgenda = await t.as(MGR).patch(`/api/meetings/${id}`, { agenda: '1. Budget\n2. Hiring' });
  assert.equal(withAgenda.status, 200, JSON.stringify(withAgenda.body));
  assert.ok(withAgenda.body.meeting.agendaSharedAt, 'adding the agenda shares it straight away');
  assert.ok(await t.models.Notification.exists({ userId: ids.emp, kind: 'meeting_agenda' }));

  assert.equal((await t.as(EMP).post(`/api/meetings/${id}/cancel`)).status, 403);
  const summary = await t.as(MGR).post(`/api/meetings/${id}/summary`, { summary: 'We agreed that Eli will send the invoice to Acme by Friday.' });
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.results[0].formatted, true, 'the summary arrives in the attendee\'s format');
  assert.ok(await t.models.Brief.exists({ employeeId: ids.emp, source: 'meeting_summary' }));
  const list = await t.as(EMP).get('/api/meetings');
  assert.ok(list.body.meetings.some((m) => m._id === id));
  assert.equal((await t.as(MGR).post(`/api/meetings/${id}/cancel`)).body.meeting.cancelledAt !== undefined, true);
});

// ---------------------------------------------------------------- Decision Record

test('reviews: each person answers their own part; outsiders and closed reviews are refused', async () => {
  await t.models.Review.updateOne({ employeeId: ids.emp, ruleCode: 'TS1', stageWeeks: 2 }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  const services = await import('../src/modules/reviews/service.js');
  assert.ok((await services.activateDueReviews(new Date())) >= 1);
  const review = await t.models.Review.findOne({ employeeId: ids.emp, ruleCode: 'TS1', stageWeeks: 2 });
  assert.ok(await t.models.Notification.exists({ userId: ids.emp, kind: 'review_due' }));
  const mgr = await t.as(MGR).post(`/api/reviews/${review._id}/answer`, { manager: { practical: 'yes' } });
  assert.equal(mgr.body.review.status, 'open', 'still waiting for the employee');
  assert.equal((await t.as(HR).post(`/api/reviews/${review._id}/answer`, { manager: { practical: 'no' } })).status, 403);
  const emp = await t.as(EMP).post(`/api/reviews/${review._id}/answer`, { employee: { helping: 'yes', next: 'keep' } });
  assert.equal(emp.body.review.status, 'completed');
  assert.equal((await t.as(EMP).post(`/api/reviews/${review._id}/answer`, { employee: { helping: 'no', next: 'stop' } })).status, 403);
  assert.equal((await t.as(EMP).post(`/api/reviews/${review._id}/answer`, { employee: { helping: 'maybe', next: 'keep' } })).status, 400);
});

test('reviews: a review left unanswered gets one reminder, only for whoever has not answered', async () => {
  const services = await import('../src/modules/reviews/service.js');
  await t.models.Review.updateOne({ employeeId: ids.emp, ruleCode: 'TM1', stageWeeks: 2 }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await services.activateDueReviews(new Date());
  const review = await t.models.Review.findOne({ employeeId: ids.emp, ruleCode: 'TM1', stageWeeks: 2 });
  assert.equal(review.status, 'open');
  assert.equal((await t.as(EMP).post(`/api/reviews/${review._id}/answer`, { employee: { helping: 'yes', next: 'keep' } })).status, 200);
  const reminders = (userId) => t.models.Notification.countDocuments({ userId, kind: 'review_reminder' });

  assert.equal(await services.remindUnansweredReviews(new Date(Date.now() + 86400000)), 0, 'not straight away');
  const later = new Date(Date.now() + 4 * 86400000);
  assert.equal(await services.remindUnansweredReviews(later), 1);
  assert.equal(await reminders(ids.mgr), 1, 'the manager has not answered');
  assert.equal(await reminders(ids.emp), 0, 'the employee already did');
  assert.equal(await services.remindUnansweredReviews(new Date(later.getTime() + 86400000)), 0, 'only one reminder');
});

test('reviews: a manager answering "not practical" flags the rule for a conversation', async () => {
  const services = await import('../src/modules/reviews/service.js');
  await t.models.Review.updateMany({ employeeId: ids.emp, ruleCode: { $in: ['TM2', 'TS3'] }, stageWeeks: 2, status: 'scheduled' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await services.activateDueReviews(new Date());
  const answer = async (code, practical) => {
    const review = await t.models.Review.findOne({ employeeId: ids.emp, ruleCode: code, stageWeeks: 2, status: 'open' });
    assert.ok(review, `an open ${code} review`);
    assert.equal((await t.as(MGR).post(`/api/reviews/${review._id}/answer`, { manager: { practical, comment: 'The check-in time clashes with client calls.' } })).status, 200);
  };
  await answer('TM2', 'no');
  await answer('TS3', 'with_difficulty');
  const profile = await t.models.Profile.findOne({ employeeId: ids.emp });
  assert.equal(profile.rules.find((r) => r.code === 'TM2').needsRevision, true, '"not practical" flags the rule');
  assert.notEqual(profile.rules.find((r) => r.code === 'TS3').needsRevision, true, '"with difficulty" does not');
  const told = await t.models.Notification.findOne({ userId: ids.emp, kind: 'review_change_needed', title: /Interim check-in/ });
  assert.ok(told, 'the employee is told, so they can talk it through');
  assert.doesNotMatch(told.body, /client calls/, 'the manager\'s comment is not copied into the notification');
});

test('reviews: the manager sees the reviews coming up for their team, by name', async () => {
  const mine = (await t.as(MGR).get('/api/reviews')).body;
  const team = mine.upcoming.filter((r) => r.employeeId === ids.emp);
  assert.ok(team.length > 0, 'reviews of the profile they agreed are listed');
  assert.ok(team.every((r) => r.employeeName === 'Eli Employee' && r.myPart === 'manager'));
  const emp = (await t.as(EMP).get('/api/reviews')).body;
  assert.ok(emp.upcoming.length > 0 && emp.upcoming.every((r) => r.myPart === 'employee'));
  const outsider = (await t.as(VIEWER).get('/api/reviews')).body;
  assert.equal(outsider.upcoming.filter((r) => r.employeeId === ids.emp).length, 0, 'nobody else sees them');
});

test('notifications: unread count, read one, read all; nobody can mark another person\'s', async () => {
  const list = await t.as(EMP).get('/api/notifications');
  assert.ok(list.body.unread > 1);
  const one = list.body.notifications.find((n) => !n.readAt);
  await t.as(MGR).post(`/api/notifications/${one._id}/read`);
  assert.equal((await t.models.Notification.findById(one._id)).readAt, undefined, 'another person cannot mark it read');
  await t.as(EMP).post(`/api/notifications/${one._id}/read`);
  assert.equal((await t.as(EMP).get('/api/notifications')).body.unread, list.body.unread - 1);
  await t.as(EMP).post('/api/notifications/read-all');
  assert.equal((await t.as(EMP).get('/api/notifications')).body.unread, 0);
  assert.equal((await t.as(EMP).post('/api/notifications/not-an-id/read')).status, 400);
});

test('dashboards: each role sees its own panel', async () => {
  const emp = await t.as(EMP).get('/api/dashboard');
  assert.ok(emp.body.employee.profile);
  assert.equal(emp.body.manager, undefined);
  assert.equal(emp.body.hr, undefined);
  const mgr = await t.as(MGR).get('/api/dashboard');
  assert.ok(mgr.body.manager.team.some((m) => String(m._id) === ids.emp));
  assert.ok(mgr.body.manager.kpis, 'manager reports are on this plan');
  const hr = await t.as(HR).get('/api/dashboard');
  assert.ok(hr.body.hr.kpis);
  assert.ok(Array.isArray(hr.body.hr.rules), 'Enterprise firm analytics by rule');
  assert.equal((await t.as(EMP).get('/api/dashboard/hr')).status, 403);
  assert.equal((await t.as(ADMIN).get('/api/dashboard/hr')).status, 200);
});

// ---------------------------------------------------------------- Company settings and audit

test('company settings: working hours drive deadlines; only admins change settings', async () => {
  assert.equal((await t.as(MGR).patch('/api/orgs/current', { settings: { workdayEnd: '16:00' } })).status, 403);
  assert.equal((await t.as(ADMIN).patch('/api/orgs/current', { settings: { workdayStart: '18:00' } })).status, 400, 'the day must end after it starts');
  assert.equal((await t.as(ADMIN).patch('/api/orgs/current', { settings: { timezone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await t.as(ADMIN).patch('/api/orgs/current', { settings: { workdayEnd: '16:00' } })).status, 200);
  const preview = await t.as(MGR).post('/api/briefs/preview', { employeeId: ids.emp, text: 'Please send the invoice to Acme by Friday' });
  assert.match(preview.body.result.summaries[0].deadline, /T16:00/, 'a day with no time uses the company end of day');
  await t.as(ADMIN).patch('/api/orgs/current', { settings: { workdayEnd: '17:00' } });
  assert.equal((await t.as(HR).put('/api/orgs/current/glossary', { glossary: [{ term: 'QBR', meaning: 'quarterly business review' }] })).status, 200);
  assert.equal((await t.as(EMP).put('/api/orgs/current/glossary', { glossary: [] })).status, 403);
});

test('audit log: admins and HR read it; the export needs the Enterprise plan', async () => {
  const list = await t.as(ADMIN).get('/api/audit');
  assert.ok(list.body.entries.length > 10);
  assert.ok(list.body.entries.every((e) => e.orgId === ids.org), 'only this company\'s entries');
  assert.equal((await t.as(EMP).get('/api/audit')).status, 403);
  assert.equal((await t.as(MGR).get('/api/audit')).status, 403);
  const csv = await t.as(HR).get('/api/audit/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  const solo = await t.as('boss@solo.test').get('/api/audit/export.csv');
  assert.equal(solo.status, 403);
  assert.equal(solo.body.code, 'plan_feature');
});

// ---------------------------------------------------------------- Retention and scheduled jobs

test('weekly digest: managers get a Monday summary (prepared; real email delivery not yet tested)', async () => {
  const { DateTime } = await import('luxon');
  const monday = DateTime.now().setZone('Europe/London').startOf('week').plus({ weeks: 1 }).set({ hour: 9 });
  const sent = await jobs.sendWeeklyDigests(monday);
  assert.ok(sent >= 1);
  const { getDevMailbox } = await import('../src/integrations/email.js');
  assert.ok(getDevMailbox().some((m) => m.to === MGR));
  assert.equal(await jobs.sendWeeklyDigests(monday), 0, 'only once a week');
  assert.equal(await jobs.sendWeeklyDigests(monday.set({ weekday: 3 })), 0, 'only on Mondays');
});

test('leaving: the account closes at once and records are deleted when the retention period ends', async () => {
  const req = await t.as(EMP2).post('/api/decisions', { title: 'Second screen' });
  const recordId = req.body.record._id;
  assert.equal((await t.as(MGR).post(`/api/users/${ids.emp2}/end-employment`, {})).status, 403, 'managers do not record leavers');
  assert.equal((await t.as(HR).post(`/api/users/${ids.emp2}/end-employment`, {})).status, 200);
  assert.equal((await t.as(EMP2).get('/api/auth/session')).status, 403);
  await jobs.retentionSweep(new Date(Date.now() + 17 * 30 * 86400000));
  assert.ok(await t.models.Profile.exists({ employeeId: ids.emp2 }), 'kept for 18 months after leaving');
  await jobs.retentionSweep(new Date(Date.now() + 19 * 31 * 86400000));
  assert.equal(await t.models.Profile.exists({ employeeId: ids.emp2 }), null);
  assert.equal(await t.models.DecisionRecord.exists({ _id: recordId }), null);
  assert.equal(await t.models.DecisionRecordVersion.countDocuments({ recordId }), 0, 'the version history goes too');
  assert.ok(await t.models.AuditLog.exists({ action: 'retention.purged' }));
});

test('erasure: an admin or HR can erase the data of someone who has left, at once, and nothing else', async () => {
  const GONE = 'gone@scope.test';
  const gone = await t.createPerson(ADMIN, GONE, 'Gil Gone', ['employee'], ids.mgr);
  await t.agreeProfile(GONE, gone, MGR, [{ code: 'TS1' }, { code: 'TM1' }]);
  const brief = (await t.sendTask(MGR, { employeeId: gone, text: 'Please file the expenses by Friday' })).body.brief._id;
  const record = (await t.as(GONE).post('/api/decisions', { title: 'Quiet room' })).body.record._id;
  const othersBefore = await t.models.Profile.countDocuments({ employeeId: { $ne: gone } });

  assert.equal((await t.as(ADMIN).post(`/api/users/${gone}/erase`, {})).status, 400, 'only for people who have left');
  assert.equal((await t.as(HR).post(`/api/users/${gone}/end-employment`, {})).status, 200);
  assert.equal((await t.as(MGR).post(`/api/users/${gone}/erase`, {})).status, 403, 'managers cannot');
  assert.equal((await t.as('boss@solo.test').post(`/api/users/${gone}/erase`, {})).status, 404, 'nor another company');

  const erased = await t.as(HR).post(`/api/users/${gone}/erase`, {});
  assert.equal(erased.status, 200, JSON.stringify(erased.body));
  for (const [model, filter] of [['Profile', { employeeId: gone }], ['DecisionRecord', { _id: record }], ['Review', { employeeId: gone }], ['Brief', { _id: brief }], ['BriefMetric', { employeeId: gone }], ['Notification', { userId: gone }]]) {
    assert.equal(await t.models[model].exists(filter), null, `${model} is erased`);
  }
  assert.equal(await t.models.DecisionRecordVersion.countDocuments({ recordId: record }), 0, 'with the decision history');
  const user = await t.models.User.findById(gone);
  assert.ok(user.erasedAt);
  assert.doesNotMatch(`${user.email} ${user.name} ${user.jobTitle}`, /gone@scope|Gil/, 'the account keeps no name or email');
  const entry = await t.models.AuditLog.findOne({ action: 'user.erased', entityId: String(gone) });
  assert.ok(entry, 'the erasure itself is audited');
  assert.doesNotMatch(JSON.stringify(entry.meta), /gone@scope|Gil/, 'without the personal details');
  assert.equal(await t.models.Profile.countDocuments({ employeeId: { $ne: gone } }), othersBefore, 'nobody else is touched');
  assert.equal((await t.as(HR).post(`/api/users/${gone}/erase`, {})).status, 400, 'once only');
  assert.equal((await t.as(ADMIN).post('/api/users', { email: GONE, name: 'Gil Again', roles: ['employee'] })).status, 201, 'the email address is free again');
});

test('audit log: every change to someone\'s account says whose account it was', async () => {
  assert.equal((await t.as(ADMIN).patch(`/api/users/${ids.viewer}`, { jobTitle: 'Designer' })).status, 200);
  assert.equal((await t.as(ADMIN).post(`/api/users/${ids.viewer}/reset-password`, {})).status, 200);
  const { entries } = (await t.as(ADMIN).get('/api/audit')).body;
  const about = (action, id) => entries.find((e) => e.action === action && e.entityId === String(id));
  assert.equal(about('user.updated', ids.viewer)?.meta?.email, VIEWER);
  assert.equal(about('user.password_reset', ids.viewer)?.meta?.email, VIEWER);
  assert.equal(about('user.employment_ended', ids.emp2)?.meta?.email, EMP2);
});

test('health check: the live endpoint reports the database, without signing in', async () => {
  const res = await t.as(null).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'ok');
});

test('rule library: settings defined by the engine are refreshed in existing databases at start-up', async () => {
  // Reminders became "working hours"; a database seeded earlier still had the old label.
  await t.models.Rule.updateOne({ code: 'TM3' }, { $set: { 'params.0.label': 'Hours before the deadline', 'params.0.unit': 'hours' } });
  const before = await t.models.Rule.findOne({ code: 'TM3' });
  const { ensureRuleLibrary } = await import('../src/seed/rules.js');
  await ensureRuleLibrary();
  const after = await t.models.Rule.findOne({ code: 'TM3' });
  assert.equal(after.params[0].label, 'Working hours before the deadline');
  assert.equal(after.params[0].unit, 'working hours');
  assert.equal(after.version, before.version, 'wording and version are left alone');
  assert.equal(after.name, before.name);
});
