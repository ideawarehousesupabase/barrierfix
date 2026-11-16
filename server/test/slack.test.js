// Drives every Slack handler with a simulated Slack (no network): @mentions, /brief, the
// "Create structured task" shortcut, the private previews and their buttons, the employee's
// buttons, message edits and deletions, App Home, matching people by email and delivery failure.
// A live run against a real Slack workspace is still needed on top of this.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const ADMIN = 'admin@slack.test';
const MGR = 'mgr@slack.test';
const MGR2 = 'mgr2@slack.test';
const EMP = 'emp@slack.test';
const EMP2 = 'emp2@slack.test';
const PLAIN = 'plain@slack.test';
const NEWBIE = 'newbie@slack.test';
const FAILS = 'fails@slack.test';
const ids = {};
const context = { teamId: 'T1' };
let t;
let h;

// A simulated Slack Web API client that records every call.
const calls = [];
const slackUsers = { UNEW: { id: 'UNEW', real_name: 'New Manager', profile: { email: NEWBIE } } };
const record = (name, reply = () => ({ ok: true })) => async (args) => {
  calls.push({ name, args });
  return reply(args);
};
const client = {
  chat: {
    postMessage: record('chat.postMessage', (args) => {
      if (args.channel === 'UFAIL') throw Object.assign(new Error('channel_not_found'), { code: 'slack_webapi_platform_error', data: { error: 'channel_not_found' } });
      return { ok: true, channel: `D-${args.channel}`, ts: `${Date.now()}.${calls.length}` };
    }),
    postEphemeral: record('chat.postEphemeral'),
    update: record('chat.update'),
  },
  views: { open: record('views.open'), update: record('views.update'), publish: record('views.publish') },
  users: { info: record('users.info', (args) => ({ ok: true, user: slackUsers[args.user] || { id: args.user, real_name: 'Someone' } })) },
};
const since = (n) => calls.slice(n);
const last = (name) => [...calls].reverse().find((c) => c.name === name);
const json = (v) => JSON.stringify(v);

// Replies the handlers send (ack and respond) are captured too.
function replies() {
  const out = { acks: [], responds: [] };
  out.ack = async (v) => out.acks.push(v);
  out.respond = async (v) => out.responds.push(v);
  return out;
}
const body = (slackUser, extra = {}) => ({ user: { id: slackUser }, team: { id: 'T1' }, ...extra });

before(async () => {
  t = await startApp();
  const messaging = await import('../src/integrations/slack/messaging.js');
  messaging.setSlackClientOverride(async (orgId) => ((await t.models.SlackInstallation.exists({ orgId })) ? { client } : null));
  const { registerHandlers } = await import('../src/integrations/slack/app.js');
  h = { event: {}, command: {}, shortcut: {}, view: {}, action: {} };
  registerHandlers({
    event: (n, f) => (h.event[n] = f),
    command: (n, f) => (h.command[n] = f),
    shortcut: (n, f) => (h.shortcut[n] = f),
    view: (k, f) => (h.view[typeof k === 'string' ? k : `${k.callback_id}:${k.type}`] = f),
    action: (n, f) => (h.action[n] = f),
    error: () => {},
  });

  const org = await t.createCompany('Slack Ltd', ADMIN);
  ids.org = org._id;
  const { encrypt } = await import('../src/utils/crypto.js');
  await t.models.SlackInstallation.create({ orgId: org._id, teamId: 'T1', teamName: 'Test', botTokenEnc: encrypt('xoxb-test'), botUserId: 'UBOT' });
  ids.mgr = await t.createPerson(ADMIN, MGR, 'Mia Manager', ['manager']);
  ids.mgr2 = await t.createPerson(ADMIN, MGR2, 'Max Manager', ['manager']);
  ids.emp = await t.createPerson(ADMIN, EMP, 'Eli Employee', ['employee'], ids.mgr);
  ids.emp2 = await t.createPerson(ADMIN, EMP2, 'Eve Employee', ['employee'], ids.mgr);
  ids.plain = await t.createPerson(ADMIN, PLAIN, 'Pat Plain', ['employee'], ids.mgr);
  ids.newbie = await t.createPerson(ADMIN, NEWBIE, 'New Manager', ['manager']);
  ids.fails = await t.createPerson(ADMIN, FAILS, 'Fay Fails', ['employee'], ids.mgr);
  const link = { [ids.mgr]: 'UMGR', [ids.mgr2]: 'UMGR2', [ids.emp]: 'UEMP', [ids.emp2]: 'UEMP2', [ids.plain]: 'UPLAIN', [ids.fails]: 'UFAIL' };
  for (const [id, slackUserId] of Object.entries(link)) await t.models.User.updateOne({ _id: id }, { $set: { slackUserId } });
  await t.agreeProfile(EMP, ids.emp, MGR, [{ code: 'TS1' }, { code: 'TM1' }, { code: 'TM2' }]);
  await t.agreeProfile(EMP2, ids.emp2, MGR, [{ code: 'TS1' }, { code: 'TM1' }, { code: 'TM4' }, { code: 'PR1' }]);
  await t.agreeProfile(FAILS, ids.fails, MGR, [{ code: 'TS1' }, { code: 'TM1' }]);
});

after(async () => t.stop());

const mention = (text, ts, user = 'UMGR') => h.event.message({ event: { channel: 'C1', user, text, ts, channel_type: 'channel' }, client, context });

test('an @mention gives only the manager a private preview; Confirm delivers it to the employee', async () => {
  const n = calls.length;
  await mention('<@UEMP> can you send the invoice to Acme by Friday? Use last quarter\'s template.', '100.1');
  const preview = since(n).find((c) => c.name === 'chat.postEphemeral');
  assert.ok(preview, 'a private preview was posted');
  assert.equal(preview.args.user, 'UMGR', 'only the manager sees it');
  assert.match(json(preview.args.blocks), /bf_mention_confirm/);
  assert.ok(!since(n).some((c) => c.name === 'chat.postMessage' && c.args.channel === 'UEMP'), 'nothing reaches the employee yet');
  const draft = await t.models.Brief.findOne({ employeeId: ids.emp, status: 'draft' });
  assert.ok(draft);
  assert.equal(draft.slack.rawText, '<@UEMP> can you send the invoice to Acme by Friday? Use last quarter\'s template.', 'the exact message is kept');

  const r = replies();
  await h.action.bf_mention_confirm({ ...r, body: body('UMGR', { actions: [{ value: String(draft._id) }] }), client, context });
  assert.match(r.responds[0].text, /Delivered to Eli Employee/);
  const sent = await t.models.Brief.findById(draft._id);
  assert.equal(sent.status, 'delivered');
  assert.equal(sent.delivery.slack, 'sent');
  const dm = last('chat.postMessage');
  assert.equal(dm.args.channel, 'UEMP');
  assert.match(json(dm.args.blocks), /bf_confirm/);
  assert.match(json(dm.args.blocks), /bf_original/);
  ids.delivered = String(draft._id);
  assert.ok(await t.models.AuditLog.exists({ action: 'brief.confirmed', entityId: ids.delivered }));
});

test('messages that are not for BarrierFix are ignored and nothing is stored', async () => {
  const before = await t.models.Brief.countDocuments();
  const n = calls.length;
  await mention('Morning all, the coffee machine is fixed', '101.1');
  await mention('<@UEMP> can you send the report by Friday?', '101.2', 'UPLAIN');
  await mention('<@UMGR2> can you send the report by Friday?', '101.3');
  await h.event.message({ event: { channel: 'C1', user: 'UMGR', text: '<@UEMP> please do it by Friday', ts: '101.4', bot_id: 'B1' }, client, context });
  await h.event.message({ event: { channel: 'D1', user: 'UMGR', text: '<@UEMP> please do it by Friday', ts: '101.5', channel_type: 'im' }, client, context });
  await h.event.message({ event: { channel: 'C1', user: 'UMGR', text: '<@UEMP> please do it by Friday', ts: '101.6' }, client, context: { teamId: 'T1', retryNum: 1 } });
  await h.event.message({ event: { channel: 'C1', user: 'UMGR', text: '<@UEMP> please do it by Friday', ts: '101.7' }, client, context: { teamId: 'T-UNKNOWN' } });
  assert.equal(await t.models.Brief.countDocuments(), before);
  assert.equal(since(n).filter((c) => c.name === 'chat.postEphemeral').length, 0);
});

test('Cancel and Edit on the private preview; nobody else can act on a manager\'s preview', async () => {
  await mention('<@UEMP> please book the venue by Thursday', '102.1');
  let draft = await t.models.Brief.findOne({ 'slack.ts': '102.1' });
  const other = replies();
  await h.action.bf_mention_confirm({ ...other, body: body('UMGR2', { actions: [{ value: String(draft._id) }] }), client, context });
  assert.match(other.responds[0].text, /already sent or cancelled/, 'another manager cannot send it');
  assert.equal((await t.models.Brief.findById(draft._id)).status, 'draft');

  const cancel = replies();
  await h.action.bf_mention_cancel({ ...cancel, body: body('UMGR', { actions: [{ value: String(draft._id) }] }), client, context });
  assert.match(cancel.responds[0].text, /Cancelled\. Nothing was sent/);
  assert.equal(await t.models.Brief.exists({ _id: draft._id }), null);
  const again = replies();
  await h.action.bf_mention_confirm({ ...again, body: body('UMGR', { actions: [{ value: String(draft._id) }] }), client, context });
  assert.match(again.responds[0].text, /already sent or cancelled/);

  await mention('<@UEMP> please book the venue by Thursday', '102.2');
  draft = await t.models.Brief.findOne({ 'slack.ts': '102.2' });
  const edit = replies();
  await h.action.bf_mention_edit({ ...edit, body: body('UMGR', { actions: [{ value: String(draft._id) }], trigger_id: 'trig-1' }), client, context });
  const opened = last('views.open');
  assert.equal(opened.args.view.callback_id, 'bf_send_modal');
  assert.match(json(opened.args.view), /please book the venue by Thursday/);
  assert.equal(await t.models.Brief.exists({ _id: draft._id }), null, 'the draft is discarded while editing');
});

test('/brief previews first and asks for the details the profile requires', async () => {
  const usage = replies();
  await h.command['/brief']({ ...usage, command: { text: 'send the invoice', user_id: 'UMGR', channel_id: 'C1' }, client, context });
  assert.match(usage.responds[0].text, /Use: `\/brief @person/);
  const notManager = replies();
  await h.command['/brief']({ ...notManager, command: { text: '<@UEMP> send the invoice by Friday', user_id: 'UPLAIN', channel_id: 'C1' }, client, context });
  assert.match(notManager.responds[0].text, /Only managers, HR and company admins/);
  const noProfile = replies();
  await h.command['/brief']({ ...noProfile, command: { text: '<@UMGR2> send the invoice by Friday', user_id: 'UMGR', channel_id: 'C1' }, client, context });
  assert.match(noProfile.responds[0].text, /no active Adjustment Profile/);

  const r = replies();
  await h.command['/brief']({ ...r, command: { text: '<@UEMP2|eve> please send the invoice to Acme', user_id: 'UMGR', channel_id: 'C1' }, client, context });
  const preview = r.responds[0];
  assert.match(json(preview.blocks), /bf_mention_details/);
  assert.doesNotMatch(json(preview.blocks), /bf_mention_confirm/, 'cannot be sent before the details are given');
  assert.match(json(preview.blocks), /What is the due date\?/);
  const draft = await t.models.Brief.findOne({ employeeId: ids.emp2, status: 'draft' });

  const details = replies();
  await h.action.bf_mention_details({ ...details, body: body('UMGR', { actions: [{ value: String(draft._id) }], trigger_id: 'trig-2' }), client, context });
  const form = last('views.open').args.view;
  assert.equal(form.callback_id, 'bf_missing_modal');

  const submit = replies();
  await h.view.bf_missing_modal({
    ...submit,
    view: { private_metadata: form.private_metadata, state: { values: { deadlineDate: { value: { selected_date: '2030-01-04' } }, priority: { value: { selected_option: { value: 'high' } } } } } },
    body: body('UMGR'),
    client,
    context,
  });
  assert.equal(submit.acks[0].response_action, 'update', JSON.stringify(submit.acks[0]));
  assert.equal(submit.acks[0].view.callback_id, 'bf_preview_modal');
  assert.match(json(submit.acks[0].view), /Priority: High/);
  const ready = await t.models.Brief.findOne({ employeeId: ids.emp2, status: 'draft' });
  assert.deepEqual(ready.result.missing, []);

  const confirm = replies();
  await h.view.bf_preview_modal({ ...confirm, view: { private_metadata: submit.acks[0].view.private_metadata }, body: body('UMGR'), client, context });
  assert.equal(confirm.acks[0].response_action, 'clear');
  const sent = await t.models.Brief.findById(ready._id);
  assert.equal(sent.status, 'delivered');
  assert.equal(sent.priority, 'high');
  assert.match(sent.translatedText, /Friday 4 January 2030/);
});

test('"Create structured task" passes the exact message, previews, and only then delivers', async () => {
  const raw = 'Hi <@UEMP>, please update <https://example.test/deck|the deck> by Friday';
  const shortcut = replies();
  await h.shortcut.create_structured_task({ ...shortcut, shortcut: { user: { id: 'UMGR' }, trigger_id: 'trig-3', message: { text: raw, ts: '103.1' }, channel: { id: 'C9' } }, client, context });
  const modal = last('views.open').args.view;
  assert.equal(modal.callback_id, 'bf_send_modal');
  const textBlock = modal.blocks.find((b) => b.block_id === 'text');
  assert.equal(textBlock.element.initial_value, raw, 'the selected message arrives exactly as written');
  assert.equal(modal.blocks.find((b) => b.block_id === 'employee').element.initial_user, 'UEMP');

  const submit = replies();
  await h.view.bf_send_modal({
    ...submit,
    view: { private_metadata: modal.private_metadata, state: { values: { employee: { value: { selected_user: 'UEMP' } }, text: { value: { value: raw } } } } },
    body: body('UMGR'),
    client,
    context,
  });
  assert.equal(submit.acks[0].response_action, 'update', JSON.stringify(submit.acks[0]));
  const draft = await t.models.Brief.findOne({ 'slack.ts': '103.1' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.slack.rawText, raw);
  assert.doesNotMatch(draft.originalText, /<@UEMP>/, 'names and links are made readable for the engine');
  assert.match(draft.originalText, /@Eli Employee/);

  // Closing the preview cancels it.
  const closed = replies();
  await h.view['bf_preview_modal:view_closed']({ ...closed, body: body('UMGR', { view: { private_metadata: submit.acks[0].view.private_metadata } }), client, context });
  assert.equal(await t.models.Brief.exists({ _id: draft._id }), null);

  const plain = replies();
  await h.shortcut.create_structured_task({ ...plain, shortcut: { user: { id: 'UPLAIN' }, trigger_id: 'trig-4', message: { text: raw, ts: '103.2' }, channel: { id: 'C9' } }, client, context });
  assert.match(json(last('views.open').args.view), /Only managers, HR and company admins/);

  const wrongPerson = replies();
  await h.view.bf_send_modal({ ...wrongPerson, view: { private_metadata: modal.private_metadata, state: { values: { employee: { value: { selected_user: 'UMGR2' } }, text: { value: { value: raw } } } } }, body: body('UMGR'), client, context });
  assert.equal(wrongPerson.acks[0].response_action, 'errors');
});

test('the employee\'s buttons work only for the employee', async () => {
  const id = ids.delivered;
  const stranger = replies();
  await h.action.bf_confirm({ ...stranger, body: body('UMGR', { actions: [{ value: id }] }), client, context });
  assert.match(stranger.responds[0].text, /no longer available/);
  assert.equal((await t.models.Brief.findById(id)).employeeStatus, 'new');

  await h.action.bf_confirm({ ...replies(), body: body('UEMP', { actions: [{ value: id }] }), client, context });
  assert.equal((await t.models.Brief.findById(id)).employeeStatus, 'confirmed');
  assert.ok(calls.some((c) => c.name === 'chat.update'), 'the buttons are replaced by a status line');

  await h.action.bf_original({ ...replies(), body: body('UEMP', { actions: [{ value: id }], channel: { id: 'D-UEMP' }, message: { ts: '1.1' } }), client, context });
  assert.match(last('chat.postMessage').args.text, /Original message from Mia Manager/);

  await h.action.bf_ask({ ...replies(), body: body('UEMP', { actions: [{ value: id }], trigger_id: 'trig-5' }), client, context });
  assert.equal(last('views.open').args.view.callback_id, 'bf_ask_modal');
  await h.view.bf_ask_modal({ ...replies(), view: { private_metadata: id, state: { values: { text: { value: { value: 'Which template?' } } } } }, body: body('UEMP', { view: { private_metadata: id } }), client, context });
  assert.equal((await t.models.Brief.findById(id)).thread.at(-1).text, 'Which template?');

  await h.view.bf_flag_modal({ ...replies(), view: { private_metadata: id, state: { values: { text: { value: { value: 'Wrong day' } } } } }, body: body('UEMP', { view: { private_metadata: id } }), client, context });
  assert.equal((await t.models.Brief.findById(id)).employeeStatus, 'flagged');

  await h.action.bf_breakdown({ ...replies(), body: body('UEMP', { actions: [{ value: id }] }), client, context });
  assert.ok((await t.models.Brief.findById(id)).breakdown?.result?.length);
});

test('editing a message refreshes its preview; deleting it withdraws a delivered task', async () => {
  await mention('<@UEMP> please send the brochure by Friday', '104.1');
  const first = await t.models.Brief.findOne({ 'slack.ts': '104.1' });
  await h.event.message({ event: { subtype: 'message_changed', channel: 'C1', message: { ts: '104.1', text: '<@UEMP> please send the brochure by Thursday', user: 'UMGR' }, previous_message: { text: '<@UEMP> please send the brochure by Friday' } }, client, context });
  assert.equal(await t.models.Brief.exists({ _id: first._id }), null);
  const fresh = await t.models.Brief.findOne({ 'slack.ts': '104.1', status: 'draft' });
  assert.match(fresh.originalText, /by Thursday/);

  await h.event.message({ event: { subtype: 'message_deleted', channel: 'C1', deleted_ts: '104.1' }, client, context });
  assert.equal(await t.models.Brief.exists({ _id: fresh._id }), null, 'an unconfirmed preview simply goes');

  await mention('<@UEMP> please order the banners by Friday', '104.2');
  const draft = await t.models.Brief.findOne({ 'slack.ts': '104.2' });
  await h.action.bf_mention_confirm({ ...replies(), body: body('UMGR', { actions: [{ value: String(draft._id) }] }), client, context });
  await h.event.message({ event: { subtype: 'message_deleted', channel: 'C1', deleted_ts: '104.2' }, client, context });
  assert.equal((await t.models.Brief.findById(draft._id)).status, 'cancelled');
  assert.ok(await t.models.Notification.exists({ userId: ids.emp, kind: 'task_cancelled' }));
});

test('people are matched to their account by Slack email the first time', async () => {
  assert.equal((await t.models.User.findById(ids.newbie)).slackUserId, null);
  await mention('<@UEMP> please check the stock list by Friday', '105.1', 'UNEW');
  assert.equal((await t.models.User.findById(ids.newbie)).slackUserId, 'UNEW');
  assert.ok(await t.models.Brief.exists({ 'slack.ts': '105.1', managerId: ids.newbie }));
});

test('App Home shows the person\'s waiting tasks', async () => {
  await h.event.app_home_opened({ event: { user: 'UEMP' }, client, context });
  assert.match(json(last('views.publish').args.view), /task\(s\) waiting/);
  await h.event.app_home_opened({ event: { user: 'UNOBODY' }, client, context });
  assert.match(json(last('views.publish').args.view), /not linked to BarrierFix/);
});

test('a Slack delivery that fails is recorded and the manager is told; the task is still in the inbox', async () => {
  await mention('<@UFAIL> please send the invoice to Acme by Friday', '106.1');
  const draft = await t.models.Brief.findOne({ 'slack.ts': '106.1' });
  await h.action.bf_mention_confirm({ ...replies(), body: body('UMGR', { actions: [{ value: String(draft._id) }] }), client, context });
  const brief = await t.models.Brief.findById(draft._id);
  assert.equal(brief.status, 'delivered');
  assert.equal(brief.delivery.slack, 'failed');
  assert.ok(await t.models.Notification.exists({ userId: ids.mgr, kind: 'delivery_failed' }));
  assert.ok((await t.as(FAILS).get('/api/briefs?box=inbox')).body.briefs.some((b) => b._id === String(draft._id)));
});
