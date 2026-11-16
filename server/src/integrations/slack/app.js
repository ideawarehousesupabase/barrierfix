import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import { config } from '../../config/env.js';
import { hasFeature } from '../../config/plans.js';
import { Brief, Organization, SlackInstallation, User } from '../../models/index.js';
import { decrypt } from '../../utils/crypto.js';
import { managerConfirmation, mentionPreviewBlocks, missingInfoModal, previewModal, sendModal, textModal } from './blocks.js';
import { activeRulesFor } from '../../modules/profiles/service.js';
import {
  askQuestion,
  cancelBrief,
  confirmTask,
  createBrief,
  discardDraft,
  flagTranslation,
  requestBreakdown,
  sendDraft,
  supersedeBrief,
} from '../../modules/briefs/service.js';
import { PRIORITY_LABELS } from '../../engine/priority.js';
import { errorFields, logger } from '../../utils/logger.js';

const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
const displayName = (u) => u?.name || u?.email || 'Someone';
// Only people who give work (managers, HR, admins) can turn a message into a task, like on the web.
const canSend = (user) => Boolean(user?.hasRole('manager', 'hr', 'admin'));
const NOT_A_MANAGER = 'Only managers, HR and company admins can create tasks for colleagues.';

async function orgForTeam(teamId) {
  const installation = await SlackInstallation.findOne({ teamId });
  if (!installation) return {};
  const org = await Organization.findById(installation.orgId);
  return { installation, org };
}

// Finds the BarrierFix user for a Slack user, matching by email the first time.
async function bfUser(org, slackUserId, client) {
  let user = await User.findOne({ orgId: org._id, slackUserId });
  if (user) return user;
  try {
    const info = await client.users.info({ user: slackUserId });
    const email = info.user?.profile?.email?.toLowerCase();
    if (email) {
      user = await User.findOne({ orgId: org._id, email });
      if (user) {
        user.slackUserId = slackUserId;
        await user.save();
      }
    }
  } catch {
    /* missing users:read.email scope or unknown user */
  }
  return user;
}

// Turns Slack markup into readable text: <@U123> -> @Name, <url|label> -> label (url).
async function resolveText(text, org, client) {
  let out = String(text || '');
  const ids = [...new Set([...out.matchAll(MENTION)].map((m) => m[1]))];
  for (const id of ids) {
    const user = await bfUser(org, id, client);
    let name = user?.name;
    if (!name) {
      try {
        const info = await client.users.info({ user: id });
        name = info.user?.real_name || info.user?.name;
      } catch {
        name = 'someone';
      }
    }
    out = out.replace(new RegExp(`<@${id}(?:\\|[^>]*)?>`, 'g'), `@${name}`);
  }
  return out
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const confirmationText = (employee, brief) => managerConfirmation({ employeeName: displayName(employee), brief, appUrl: config.appUrl });

// An @mention or /brief makes a draft and shows only the manager a private preview with
// Confirm, Edit and Cancel. Nothing reaches the employee until the manager confirms.
// `show` posts the preview (an ephemeral message, or the slash command's own reply).
async function createDraftPreview({ org, author, employee, text, raw, slack, sentAt, forceTask = false, show }) {
  let draft;
  try {
    draft = await createBrief({ org, manager: author, employee, text, rawText: raw, source: 'slack', sentAt, slack, forceTask, asDraft: true });
  } catch (err) {
    logger.warn('slack.preview_failed', errorFields(err));
    return null;
  }
  if (!draft) return null; // not a task: nothing is stored
  try {
    await show({
      text: `Preview for ${displayName(employee)}: nothing has been sent yet.`,
      blocks: mentionPreviewBlocks({
        draftId: String(draft._id),
        employeeName: displayName(employee),
        mrkdwn: draft.result.cards.map((c) => c.mrkdwn).join('\n\n'),
        held: !draft.validator.passed,
        priorityLabel: PRIORITY_LABELS[draft.priority],
        missing: draft.result.missing,
      }),
    });
  } catch (err) {
    // The manager cannot see the preview, so there is nothing for them to confirm.
    logger.warn('slack.preview_not_shown', errorFields(err));
    await discardDraft(draft);
    return null;
  }
  return draft;
}

const postMentionPreview = ({ client, channel, user, ...rest }) => createDraftPreview({ ...rest, show: (message) => client.chat.postEphemeral({ channel, user, ...message }) });

async function onChannelMessage({ event, client, context }) {
  if (context.retryNum) return; // Slack retried: the first delivery is already being handled
  if (event.channel_type === 'im' || event.bot_id || event.subtype === 'bot_message') return;
  const { installation, org } = await orgForTeam(context.teamId);
  if (!org || !hasFeature(org, 'slack') || !hasFeature(org, 'translation')) return;

  if (event.subtype === 'message_deleted') {
    const briefs = await Brief.find({ orgId: org._id, 'slack.channelId': event.channel, 'slack.ts': event.deleted_ts, status: { $nin: ['cancelled', 'superseded'] } });
    // An unconfirmed preview is simply dropped; a delivered task is withdrawn from the employee.
    for (const b of briefs) {
      if (b.status === 'draft') await discardDraft(b);
      else await cancelBrief(b, await User.findById(b.managerId));
    }
    return;
  }
  if (event.subtype === 'message_changed') {
    const msg = event.message;
    if (!msg?.text || msg.text === event.previous_message?.text) return;
    const briefs = await Brief.find({ orgId: org._id, 'slack.channelId': event.channel, 'slack.ts': msg.ts, status: { $nin: ['cancelled', 'superseded'] } });
    if (!briefs.length) return;
    const text = await resolveText(msg.text, org, client);
    for (const old of briefs) {
      const [manager, employee] = await Promise.all([User.findById(old.managerId), User.findById(old.employeeId)]);
      if (old.status === 'draft') {
        // The message changed before the manager confirmed: replace the preview with a fresh one.
        await discardDraft(old);
        await postMentionPreview({ client, org, author: manager, employee, text, raw: msg.text, slack: { teamId: context.teamId, channelId: event.channel, ts: msg.ts, threadTs: msg.thread_ts }, sentAt: new Date(), channel: event.channel, user: msg.user });
        continue;
      }
      const fresh = await supersedeBrief(old, { org, manager, employee, text }).catch(() => null);
      if (fresh) await client.chat.postEphemeral({ channel: event.channel, user: msg.user, text: `Updated for ${displayName(employee)}. ${confirmationText(employee, fresh)}` }).catch(() => {});
    }
    return;
  }
  if (event.subtype && !['thread_broadcast', 'file_share'].includes(event.subtype)) return;

  // Only messages that mention someone with a profile are processed; all others are
  // discarded immediately and never stored.
  const mentioned = [...new Set([...String(event.text || '').matchAll(MENTION)].map((m) => m[1]))].filter((id) => id !== event.user && id !== installation.botUserId);
  if (!mentioned.length) return;
  const author = await bfUser(org, event.user, client);
  if (!author || !canSend(author)) return;
  let text = null;
  for (const slackId of mentioned) {
    const employee = await bfUser(org, slackId, client);
    if (!employee || ['left', 'disabled'].includes(employee.status)) continue;
    if (!(await activeRulesFor(employee._id, org._id)).length) continue;
    text = text ?? (await resolveText(event.text, org, client));
    await postMentionPreview({
      client,
      org,
      author,
      employee,
      text,
      raw: event.text,
      slack: { teamId: context.teamId, channelId: event.channel, ts: event.ts, threadTs: event.thread_ts },
      sentAt: new Date(Number(event.ts) * 1000),
      channel: event.channel,
      user: event.user,
    });
  }
}

async function onBriefCommand({ command, ack, respond, client, context }) {
  await ack();
  const { org } = await orgForTeam(context.teamId);
  if (!org || !hasFeature(org, 'slack')) return respond({ response_type: 'ephemeral', text: 'BarrierFix Slack features are not switched on for your company.' });
  const m = String(command.text || '').match(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/);
  if (!m) return respond({ response_type: 'ephemeral', text: 'Use: `/brief @person the task`. For example: `/brief @Jordan can you update the deck by Thursday?`' });
  const [author, employee] = await Promise.all([bfUser(org, command.user_id, client), bfUser(org, m[1], client)]);
  if (!author) return respond({ response_type: 'ephemeral', text: 'Your Slack account is not linked to a BarrierFix account in this company yet.' });
  if (!canSend(author)) return respond({ response_type: 'ephemeral', text: NOT_A_MANAGER });
  if (!employee || employee.status !== 'active') return respond({ response_type: 'ephemeral', text: 'That person does not have an active BarrierFix account in this company.' });
  if (!(await activeRulesFor(employee._id, org._id)).length) return respond({ response_type: 'ephemeral', text: `${displayName(employee)} has no active Adjustment Profile yet, so there is no format to apply.` });
  const raw = String(command.text).replace(m[0], '').trim();
  if (raw.length < 3) return respond({ response_type: 'ephemeral', text: 'Please add the task after the person, e.g. `/brief @Jordan send the invoice by Friday`.' });
  // Like every Slack route, /brief shows the manager a private preview first; nothing is sent until Confirm.
  const draft = await createDraftPreview({
    org,
    author,
    employee,
    text: await resolveText(raw, org, client),
    raw,
    slack: { teamId: context.teamId, channelId: command.channel_id },
    sentAt: new Date(),
    forceTask: true,
    show: (message) => respond({ response_type: 'ephemeral', ...message }),
  });
  if (!draft) return respond({ response_type: 'ephemeral', text: 'BarrierFix could not prepare that task. Please try again, or use the web app.' });
  return null;
}

// "Create structured task" on an existing message. The selected message is passed exactly as Slack sent it;
// names and links are only made readable for the engine, and the raw text is kept on the task.
async function onSendShortcut({ shortcut, ack, client, context }) {
  await ack();
  const { org } = await orgForTeam(context.teamId);
  if (!org) return;
  const author = await bfUser(org, shortcut.user.id, client);
  if (!author || !canSend(author)) {
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: { type: 'modal', title: { type: 'plain_text', text: 'Create structured task' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: author ? NOT_A_MANAGER : 'Your Slack account is not linked to a BarrierFix account in this company yet. Ask your company admin to create your account with your Slack email address.' } }] },
    });
    return;
  }
  const raw = shortcut.message?.text || '';
  const mentioned = [...raw.matchAll(MENTION)].map((x) => x[1]).find((id) => id !== shortcut.user.id);
  await client.views.open({ trigger_id: shortcut.trigger_id, view: sendModal({ text: raw, initialUser: mentioned, channelId: shortcut.channel?.id, messageTs: shortcut.message?.ts }) });
}

// Builds the draft and the next modal: a form for missing details, or the full preview.
async function draftStep({ org, author, employee, text, raw, meta, extras = {}, replace }) {
  if (replace) await discardDraft(replace);
  let draft;
  try {
    draft = await createBrief({
      org,
      manager: author,
      employee,
      text,
      rawText: raw,
      source: 'slack',
      slack: { teamId: meta.teamId, channelId: meta.channelId, ts: meta.messageTs },
      forceTask: true,
      asDraft: true,
      priority: extras.priority,
      overrides: { deadlineDate: extras.deadlineDate, deadlineTime: extras.deadlineTime },
    });
  } catch (err) {
    return { error: err.message };
  }
  if (!draft) return { error: 'That does not look like a task.' };
  const state = { draftId: String(draft._id), ...extras };
  const employeeName = displayName(employee);
  if (draft.result.missing.length) return { view: missingInfoModal({ state, missing: draft.result.missing, employeeName }) };
  return { view: previewModal({ state, employeeName, mrkdwn: draft.result.cards.map((c) => c.mrkdwn).join('\n\n'), held: !draft.validator.passed, priorityLabel: PRIORITY_LABELS[draft.priority] }) };
}

// A draft belongs to the manager who made it, in their own company.
async function ownDraft(body, client, context) {
  const { org } = await orgForTeam(context.teamId || body.team?.id);
  if (!org) return {};
  const author = await bfUser(org, body.user.id, client);
  // The draft id comes from a button's value (previews in a channel and the Edit button) or the modal's state.
  let state = {};
  const buttonValue = body.actions?.[0]?.value;
  if (/^[a-f0-9]{24}$/i.test(buttonValue || '')) state = { draftId: buttonValue };
  else {
    try {
      state = JSON.parse(body.view?.private_metadata || '{}');
    } catch {
      /* no state */
    }
  }
  const draft = author && /^[a-f0-9]{24}$/i.test(state.draftId || '') ? await Brief.findOne({ _id: state.draftId, orgId: org._id, managerId: author._id, status: 'draft' }) : null;
  return { org, author, draft, state };
}

async function onSendSubmit({ ack, view, body, client, context }) {
  const { org } = await orgForTeam(context.teamId || body.team?.id);
  const slackEmployee = view.state.values.employee?.value?.selected_user;
  const raw = view.state.values.text?.value?.value || '';
  if (!org) return ack({ response_action: 'errors', errors: { employee: 'This Slack workspace is not connected to BarrierFix.' } });
  const [author, employee] = await Promise.all([bfUser(org, body.user.id, client), bfUser(org, slackEmployee, client)]);
  if (!author) return ack({ response_action: 'errors', errors: { employee: 'Your Slack account is not linked to BarrierFix yet.' } });
  if (!canSend(author)) return ack({ response_action: 'errors', errors: { employee: NOT_A_MANAGER } });
  if (!employee || employee.status !== 'active') return ack({ response_action: 'errors', errors: { employee: 'This person does not have an active BarrierFix account in your company.' } });
  if (!(await activeRulesFor(employee._id, org._id)).length) return ack({ response_action: 'errors', errors: { employee: `${displayName(employee)} has no active Adjustment Profile yet.` } });
  if (raw.trim().length < 3) return ack({ response_action: 'errors', errors: { text: 'Please write the task.' } });
  const meta = { ...JSON.parse(view.private_metadata || '{}'), teamId: context.teamId || body.team?.id };
  const out = await draftStep({ org, author, employee, text: await resolveText(raw, org, client), raw, meta });
  if (out.error) return ack({ response_action: 'errors', errors: { text: out.error } });
  return ack({ response_action: 'update', view: out.view });
}

// The manager answered the questions about missing details: rebuild the draft with them.
async function onMissingSubmit({ ack, view, body, client, context }) {
  const { org, author, draft, state } = await ownDraft({ ...body, view }, client, context);
  if (!draft) return ack({ response_action: 'clear' });
  const v = view.state.values;
  const extras = {
    priority: v.priority?.value?.selected_option?.value ?? state.priority,
    deadlineDate: v.deadlineDate?.value?.selected_date ?? state.deadlineDate,
    deadlineTime: v.deadlineTime?.value?.selected_time ?? state.deadlineTime,
  };
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  const out = await draftStep({ org, author, employee, text: draft.originalText, raw: draft.slack?.rawText, meta: { teamId: draft.slack?.teamId, channelId: draft.slack?.channelId, messageTs: draft.slack?.ts }, extras, replace: draft });
  if (out.error) return ack({ response_action: 'errors', errors: { [Object.keys(v)[0] || 'priority']: out.error } });
  return ack({ response_action: 'update', view: out.view });
}

// "Confirm and send": only now is the task delivered, and the confirmation is audited.
async function onPreviewConfirm({ ack, view, body, client, context }) {
  const { org, author, draft } = await ownDraft({ ...body, view }, client, context);
  await ack({ response_action: 'clear' });
  if (!draft) {
    await client.chat.postMessage({ channel: body.user.id, text: 'That task was already sent or cancelled, so nothing new was sent.' }).catch(() => {});
    return;
  }
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  try {
    const brief = await sendDraft(draft, { org, manager: author, employee });
    await client.chat.postMessage({ channel: body.user.id, text: confirmationText(employee, brief) });
  } catch (err) {
    await client.chat.postMessage({ channel: body.user.id, text: `BarrierFix could not send that task: ${err.message}` }).catch(() => {});
  }
}

// Closing either modal cancels: nothing was sent, and the draft is removed.
async function onDraftClosed({ ack, body, client, context }) {
  await ack();
  const { draft } = await ownDraft(body, client, context);
  if (draft) await discardDraft(draft);
}

// "Edit" on the preview: back to the message and recipient, with the draft discarded.
async function onPreviewEdit({ ack, body, client, context }) {
  await ack();
  const { org, draft } = await ownDraft(body, client, context);
  if (!draft) return;
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  await discardDraft(draft);
  await client.views.update({
    view_id: body.view.id,
    hash: body.view.hash,
    view: sendModal({ text: draft.slack?.rawText || draft.originalText, initialUser: employee?.slackUserId, channelId: draft.slack?.channelId, messageTs: draft.slack?.ts }),
  });
}

// Buttons on the manager's private preview after an @mention in a channel.
const GONE = 'That preview was already sent or cancelled, so nothing new was sent.';

async function onMentionConfirm({ ack, body, client, context, respond }) {
  await ack();
  const { org, author, draft } = await ownDraft(body, client, context);
  if (!draft) return respond({ replace_original: true, text: GONE });
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  try {
    const brief = await sendDraft(draft, { org, manager: author, employee });
    return respond({ replace_original: true, text: confirmationText(employee, brief) });
  } catch (err) {
    return respond({ replace_original: false, text: `BarrierFix could not send that task: ${err.message}` });
  }
}

async function onMentionCancel({ ack, body, client, context, respond }) {
  await ack();
  const { org, draft } = await ownDraft(body, client, context);
  if (!draft) return respond({ replace_original: true, text: GONE });
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  await discardDraft(draft);
  return respond({ replace_original: true, text: `Cancelled. Nothing was sent to ${displayName(employee)}.` });
}

async function onMentionEdit({ ack, body, client, context, respond }) {
  await ack();
  const { org, draft } = await ownDraft(body, client, context);
  if (!draft) return respond({ replace_original: true, text: GONE });
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  await discardDraft(draft);
  await client.views.open({
    trigger_id: body.trigger_id,
    view: sendModal({ text: draft.slack?.rawText || draft.originalText, initialUser: employee?.slackUserId, channelId: draft.slack?.channelId, messageTs: draft.slack?.ts }),
  });
  return respond({ replace_original: true, text: `Editing in the form that just opened. Nothing has been sent to ${displayName(employee)}.` });
}

async function onMentionDetails({ ack, body, client, context, respond }) {
  await ack();
  const { org, draft } = await ownDraft(body, client, context);
  if (!draft) return respond({ replace_original: true, text: GONE });
  const employee = await User.findOne({ _id: draft.employeeId, orgId: org._id });
  await client.views.open({ trigger_id: body.trigger_id, view: missingInfoModal({ state: { draftId: String(draft._id) }, missing: draft.result.missing, employeeName: displayName(employee) }) });
  return respond({ replace_original: true, text: `Adding the missing details in the form that just opened. Nothing has been sent to ${displayName(employee)}.` });
}

// Buttons on the employee's DM. The value of every button is the brief id.
async function briefForAction(body, client, context) {
  const { org } = await orgForTeam(context.teamId || body.team?.id);
  if (!org) return {};
  const user = await bfUser(org, body.user.id, client);
  const id = body.actions?.[0]?.value || body.view?.private_metadata;
  const brief = /^[a-f0-9]{24}$/i.test(id || '') ? await Brief.findOne({ _id: id, orgId: org._id }) : null;
  if (!user || !brief || String(brief.employeeId) !== String(user._id)) return { org };
  return { org, user, brief };
}

// Exported so the tests can drive every handler with a simulated Slack client.
export function registerHandlers(app) {
  app.event('message', onChannelMessage);
  app.command('/brief', onBriefCommand);
  app.shortcut('create_structured_task', onSendShortcut);
  app.view('bf_send_modal', onSendSubmit);
  app.view('bf_missing_modal', onMissingSubmit);
  app.view('bf_preview_modal', onPreviewConfirm);
  app.view({ callback_id: 'bf_missing_modal', type: 'view_closed' }, onDraftClosed);
  app.view({ callback_id: 'bf_preview_modal', type: 'view_closed' }, onDraftClosed);
  app.action('bf_preview_edit', onPreviewEdit);
  app.action('bf_mention_confirm', onMentionConfirm);
  app.action('bf_mention_edit', onMentionEdit);
  app.action('bf_mention_cancel', onMentionCancel);
  app.action('bf_mention_details', onMentionDetails);

  app.action('bf_open', async ({ ack }) => ack());
  app.action('bf_confirm', async ({ ack, body, client, context, respond }) => {
    await ack();
    const { brief, user } = await briefForAction(body, client, context);
    if (!brief) return respond({ response_type: 'ephemeral', replace_original: false, text: 'This task is no longer available.' });
    await confirmTask(brief, user);
  });
  app.action('bf_breakdown', async ({ ack, body, client, context, respond }) => {
    await ack();
    const { brief, user, org } = await briefForAction(body, client, context);
    if (!brief) return respond({ response_type: 'ephemeral', replace_original: false, text: 'This task is no longer available.' });
    await requestBreakdown(brief, user, org);
  });
  app.action('bf_original', async ({ ack, body, client, context }) => {
    await ack();
    const { brief } = await briefForAction(body, client, context);
    if (!brief) return;
    const manager = await User.findById(brief.managerId);
    await client.chat.postMessage({ channel: body.channel.id, thread_ts: body.message.ts, text: `*Original message from ${displayName(manager)}*\n${brief.originalText}` });
  });
  app.action('bf_ask', async ({ ack, body, client }) => {
    await ack();
    await client.views.open({ trigger_id: body.trigger_id, view: textModal({ callbackId: 'bf_ask_modal', title: 'Ask a question', label: 'Your question', briefId: body.actions[0].value, placeholder: 'What would you like to check?' }) });
  });
  app.action('bf_flag', async ({ ack, body, client }) => {
    await ack();
    await client.views.open({ trigger_id: body.trigger_id, view: textModal({ callbackId: 'bf_flag_modal', title: 'Flag as wrong', label: 'What is wrong? (optional)', briefId: body.actions[0].value, submit: 'Flag', optional: true }) });
  });
  app.view('bf_ask_modal', async ({ ack, body, view, client, context }) => {
    await ack();
    const { brief, user } = await briefForAction(body, client, context);
    if (brief) await askQuestion(brief, user, view.state.values.text.value.value);
  });
  app.view('bf_flag_modal', async ({ ack, body, view, client, context }) => {
    await ack();
    const { brief, user } = await briefForAction(body, client, context);
    if (brief) await flagTranslation(brief, user, view.state.values.text?.value?.value || '');
  });

  app.event('app_home_opened', async ({ event, client, context }) => {
    const { org } = await orgForTeam(context.teamId);
    if (!org) return;
    const user = await bfUser(org, event.user, client);
    const open = user ? await Brief.countDocuments({ employeeId: user._id, employeeStatus: { $in: ['new', 'seen'] }, status: { $in: ['delivered', 'approved', 'held', 'original_sent'] } }) : 0;
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'BarrierFix' } },
          { type: 'section', text: { type: 'mrkdwn', text: user ? `You have *${open}* task(s) waiting for you to confirm.` : 'Your Slack account is not linked to BarrierFix yet. Ask your company admin to create your BarrierFix account with this email address.' } },
          { type: 'section', text: { type: 'mrkdwn', text: 'Managers: mention someone in a channel (you get a private preview to confirm first), use `/brief @person`, or choose *Create structured task* from a message menu.' } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open BarrierFix' }, url: config.appUrl, action_id: 'bf_open', value: 'home' }] },
        ],
      },
    }).catch(() => {});
  });

  app.error(async (err) => logger.error('slack.handler_failed', errorFields(err.original || err)));
}

async function authorizeTeam({ teamId }) {
  const installation = await SlackInstallation.findOne({ teamId });
  if (!installation) throw new Error(`No BarrierFix installation for Slack team ${teamId}`);
  return { botToken: decrypt(installation.botTokenEnc), botUserId: installation.botUserId, botId: installation.botId, teamId };
}

// Returns an Express router that receives Slack events at POST /slack/events, or null
// when Slack is not configured in .env.
export function createSlackRouter() {
  if (!config.slack.enabled) return null;
  const receiver = new ExpressReceiver({ signingSecret: config.slack.signingSecret, endpoints: '/slack/events', processBeforeResponse: false, logLevel: LogLevel.WARN });
  const app = new App({ receiver, authorize: authorizeTeam, logLevel: LogLevel.WARN });
  registerHandlers(app);
  return receiver.router;
}
