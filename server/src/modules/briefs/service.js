import { config } from '../../config/env.js';
import { hasFeature } from '../../config/plans.js';
import { ENGINE_NAME, breakdownBrief, translateBrief } from '../../engine/index.js';
import { taskBlocks } from '../../integrations/slack/blocks.js';
import { sendSlackDm, slackClientForOrg, updateSlackMessage } from '../../integrations/slack/messaging.js';
import { Brief, BriefMetric, Profile, ScheduledPrompt, User } from '../../models/index.js';
import { emitToUser } from '../../realtime/socket.js';
import { audit } from '../../services/audit.js';
import { calendarForOrg } from '../../services/calendar.js';
import { notify } from '../../services/notify.js';
import { HttpError, badRequest, forbidden, notFound } from '../../utils/http.js';
import { activeRulesFor } from '../profiles/service.js';

const DAY = 86400 * 1000;
const briefExpiry = () => new Date(Date.now() + config.retention.briefDays * DAY);
const metricExpiry = () => new Date(Date.now() + config.retention.reviewMonths * 30 * DAY);
const displayName = (u) => u?.name || u?.email || 'Someone';
const firstName = (u) => displayName(u).split(/\s+/)[0];
const orgPlain = (org) => (org.toObject ? org.toObject() : org);

// `priority` and `overrides` ({ deadlineDate, deadlineTime }) are details the manager typed into a form
// to fill gaps in the message; they never change anything the message already says.
export async function runTranslation({ org, manager, employee, text, sentAt = new Date(), forceTask = true, priority, overrides }) {
  const rules = await activeRulesFor(employee._id, org._id);
  const { holidays } = await calendarForOrg(org);
  const result = translateBrief({ text, sentAt, rules, org: orgPlain(org), holidays, managerName: firstName(manager), employeeName: employee.name, forceTask, priority, overrides });
  return { rules, result };
}

// Keeps what the UI and Slack need; drops nothing the employee or manager might ask about.
const storedResult = (r) => ({
  engine: r.engine,
  cards: r.cards,
  summaries: r.summaries,
  tasks: r.tasks,
  appliedRules: r.appliedRules,
  checkedRules: r.checkedRules,
  changes: r.changes,
  schedule: r.schedule,
  confidence: r.confidence,
  priority: r.priority,
  missing: r.missing,
});

const needsInfo = (missing) => new HttpError(422, `Before this can be sent, please add: ${missing.map((m) => m.question.replace(/\?$/, '').toLowerCase()).join('; ')}`, { code: 'needs_info', missing });

function deliveredCards(brief) {
  if (brief.deliveredVersion === 'translated') return brief.result?.cards || [];
  const text = brief.deliveredVersion === 'manager_edited' ? brief.managerEditedText : brief.originalText;
  return [{ index: 0, total: 1, mrkdwn: text, text, sections: [{ type: 'text', key: 'details', items: text.split('\n').filter(Boolean), origin: 'content' }] }];
}

const slackMode = (brief) => (brief.deliveredVersion === 'translated' ? 'translated' : brief.deliveredVersion === 'manager_edited' ? 'edited' : 'original');

function blocksFor(brief, card, managerName, status) {
  return taskBlocks({ briefId: brief._id, managerName, card, mode: slackMode(brief), appliedRules: brief.appliedRules, originalText: brief.originalText, appUrl: config.appUrl, status });
}

// Returns 'sent', 'failed' (after retries) or 'skipped' (no Slack for this person).
async function deliverToSlack(brief, org, manager, employee) {
  // Not sent at all (rather than failed) when the person or the company is not on Slack.
  if (!employee.slackUserId || !hasFeature(org, 'slack') || !(await slackClientForOrg(org._id))) return 'skipped';
  const managerName = displayName(manager);
  const dmTs = [];
  let dmChannelId = null;
  let failed = 0;
  for (const card of deliveredCards(brief)) {
    const sent = await sendSlackDm(org._id, employee.slackUserId, { text: `New task from ${managerName}`, blocks: blocksFor(brief, card, managerName) });
    if (sent) {
      dmChannelId = sent.channel;
      dmTs.push(sent.ts);
    } else failed += 1;
  }
  if (dmTs.length) brief.slack = { ...(brief.toObject().slack || {}), dmChannelId, dmTs };
  return failed ? 'failed' : 'sent';
}

// Updates the employee's Slack messages after an action (buttons replaced by a status line).
export async function refreshSlackStatus(brief, status) {
  if (!brief.slack?.dmChannelId || !brief.slack.dmTs?.length) return;
  const manager = await User.findById(brief.managerId);
  const cards = deliveredCards(brief);
  await Promise.all(brief.slack.dmTs.map((ts, i) => updateSlackMessage(brief.orgId, brief.slack.dmChannelId, ts, { text: 'Task', blocks: blocksFor(brief, cards[i] || cards[0], displayName(manager), status) })));
}

async function deliver(brief, { org, manager, employee }) {
  emitToUser(employee._id, 'brief:new', { id: String(brief._id) });
  emitToUser(manager._id, 'brief:updated', { id: String(brief._id) });
  const title = brief.result?.summaries?.[0]?.title || brief.originalText.slice(0, 80);
  await notify(employee._id, { kind: 'task_new', title: `New task from ${displayName(manager)}`, body: title, link: `/tasks/${brief._id}` });
  const slack = await deliverToSlack(brief, org, manager, employee);
  brief.delivery = { slack, at: new Date() };
  await brief.save();
  // The task is always in their BarrierFix inbox; the manager is told if the Slack message did not arrive.
  if (slack === 'failed') {
    await notify(manager._id, {
      kind: 'delivery_failed',
      title: `Slack could not deliver a task to ${displayName(employee)}`,
      body: 'It is in their BarrierFix inbox. You may want to tell them directly.',
      link: `/tasks/${brief._id}`,
      channels: ['email'],
    });
  }
  return slack;
}

async function schedulePrompts(brief, org) {
  if (!hasFeature(org, 'jitPrompts')) return;
  const items = brief.result?.schedule || [];
  const docs = items
    .filter((s) => new Date(s.at) > new Date())
    .map((s) => ({
      orgId: brief.orgId,
      kind: s.kind,
      runAt: new Date(s.at),
      briefId: brief._id,
      recipientIds: s.kind === 'checkin' ? [brief.employeeId, brief.managerId] : [brief.employeeId],
      payload: { taskIndex: s.taskIndex, title: brief.result?.summaries?.[s.taskIndex]?.title || '' },
    }));
  if (docs.length) await ScheduledPrompt.insertMany(docs);
}

const cancelPrompts = (briefId) => ScheduledPrompt.updateMany({ briefId, status: 'pending' }, { $set: { status: 'cancelled' } });

/**
 * Translates and delivers a brief. Returns null when there is nothing to do (a Slack
 * message that is not a task, or a person with no agreed profile).
 */
// Why there is no format to apply to tasks for this person.
export async function noProfileReason(employee, org) {
  const off = await Profile.exists({ employeeId: employee._id, orgId: org._id, active: false });
  return off ? `${displayName(employee)}'s Adjustment Profile is switched off, so there is no format to apply.` : `${displayName(employee)} has no agreed Adjustment Profile yet, so there is no format to apply.`;
}

export async function createBrief({ org, manager, employee, text, rawText, source = 'web', sentAt = new Date(), slack, forceTask = true, supersedes, actor, priority, overrides, asDraft = false }) {
  if (!hasFeature(org, 'translation')) throw forbidden("Task translation is not included in your company's plan");
  if (!employee.orgId || String(employee.orgId) !== String(org._id)) throw notFound('Person not found');
  const { rules, result } = await runTranslation({ org, manager, employee, text, sentAt, forceTask, priority, overrides });
  if (!rules.length) {
    if (source === 'slack' && !asDraft) return null;
    throw badRequest(await noProfileReason(employee, org));
  }
  if (!result.isTask) return null;
  // Required details are asked for, never guessed. A draft keeps the question open for the manager to answer.
  if (result.missing.length && !asDraft) throw needsInfo(result.missing);

  const passed = result.validator.passed;
  const brief = await Brief.create({
    orgId: org._id,
    managerId: manager._id,
    employeeId: employee._id,
    source,
    slack: slack ? { ...slack, ...(rawText ? { rawText } : {}) } : rawText ? { rawText } : undefined,
    originalText: text,
    sentAt,
    detection: result.detection,
    result: storedResult(result),
    translatedText: result.text,
    appliedRules: result.appliedRules.map(({ code, name, effect }) => ({ code, name, effect })),
    validator: result.validator,
    priority: result.priority || undefined,
    status: asDraft ? 'draft' : passed ? 'delivered' : 'held',
    deliveredVersion: passed ? 'translated' : 'original',
    processingMs: result.processingMs,
    engine: ENGINE_NAME,
    supersedes,
    expiresAt: briefExpiry(),
  });
  if (asDraft) return brief;
  return finishBrief(brief, { org, manager, employee, actor, rules });
}

// Confirms a draft (or a brief that needs no confirmation): metrics, delivery, scheduled prompts and the audit trail.
async function finishBrief(brief, { org, manager, employee, actor, rules }) {
  const passed = Boolean(brief.validator?.passed);
  brief.status = passed ? 'delivered' : 'held';
  brief.deliveredVersion = passed ? 'translated' : 'original';
  await brief.save();
  const ruleCodes = rules.map((r) => r.code);
  await BriefMetric.create({
    orgId: org._id,
    briefId: brief._id,
    managerId: manager._id,
    employeeId: employee._id,
    source: brief.source,
    isTask: true,
    validatorPassed: passed,
    held: !passed,
    ruleCodes,
    processingMs: brief.processingMs,
    employeeStatus: 'new',
    expiresAt: metricExpiry(),
  });

  await audit(actor || manager, 'brief.confirmed', { entity: 'Brief', entityId: brief._id, orgId: org._id, meta: { source: brief.source, rules: ruleCodes, validatorPassed: passed, appliedRules: brief.appliedRules.map((r) => r.code) } });
  const slackStatus = await deliver(brief, { org, manager, employee });
  await audit(actor || manager, 'brief.delivered', { entity: 'Brief', entityId: brief._id, orgId: org._id, meta: { deliveredVersion: brief.deliveredVersion, slack: slackStatus } });
  if (passed) await schedulePrompts(brief, org);
  else {
    await notify(manager._id, {
      kind: 'brief_held',
      title: `Please check the formatted task for ${displayName(employee)}`,
      body: 'Something in the formatted version did not match your original, so BarrierFix sent your original wording instead. You can approve, edit or keep the original.',
      link: `/tasks/${brief._id}`,
      channels: ['email', 'slack'],
    });
  }
  await audit(actor || manager, 'brief.created', { entity: 'Brief', entityId: brief._id, orgId: org._id, meta: { source: brief.source, validatorPassed: passed, rules: ruleCodes } });
  return brief;
}

// The manager confirmed a draft (shown as a preview in Slack): only now is anything delivered.
export async function sendDraft(brief, { org, manager, employee, actor }) {
  if (brief.status !== 'draft') throw badRequest('This task was already sent or cancelled');
  if (brief.result?.missing?.length) throw needsInfo(brief.result.missing);
  const rules = await activeRulesFor(employee._id, org._id);
  if (!rules.length) throw badRequest(await noProfileReason(employee, org));
  return finishBrief(brief, { org, manager, employee, actor, rules });
}

// The manager cancelled the preview: nothing was sent, and the draft is removed.
export async function discardDraft(brief) {
  if (brief.status !== 'draft') return false;
  await Brief.deleteOne({ _id: brief._id, status: 'draft' });
  return true;
}

export async function loadBrief(id, user) {
  const brief = await Brief.findById(id);
  if (!brief || String(brief.orgId) !== String(user.orgId)) throw notFound('Task not found. Task text is deleted 30 days after it was sent.');
  const isEmployee = String(brief.employeeId) === String(user._id);
  const isManager = String(brief.managerId) === String(user._id);
  if (!isEmployee && !isManager) throw forbidden('Only the sender and the recipient can see this task');
  return { brief, isEmployee, isManager };
}

async function updateMetric(brief, patch) {
  await BriefMetric.updateOne({ briefId: brief._id }, { $set: { employeeStatus: brief.employeeStatus, ...patch } });
}

export async function markSeen(brief) {
  if (brief.employeeStatus === 'new') {
    brief.employeeStatus = 'seen';
    await brief.save();
    await updateMetric(brief, {});
  }
  return brief;
}

export async function confirmTask(brief, employee) {
  brief.employeeStatus = 'confirmed';
  await brief.save();
  await updateMetric(brief, { confirmed: true });
  await notify(brief.managerId, { kind: 'task_confirmed', title: `${displayName(employee)} confirmed a task`, body: brief.result?.summaries?.[0]?.title || '', link: `/tasks/${brief._id}` });
  emitToUser(brief.managerId, 'brief:updated', { id: String(brief._id) });
  await refreshSlackStatus(brief, 'confirmed');
  return brief;
}

export async function askQuestion(brief, employee, text) {
  brief.thread.push({ authorId: employee._id, kind: 'question', text });
  brief.employeeStatus = 'question';
  await brief.save();
  await updateMetric(brief, { questioned: true });
  await notify(brief.managerId, { kind: 'task_question', title: `${displayName(employee)} has a question about a task`, body: text, link: `/tasks/${brief._id}`, channels: ['email', 'slack'] });
  emitToUser(brief.managerId, 'brief:updated', { id: String(brief._id) });
  await refreshSlackStatus(brief, 'question');
  return brief;
}

export async function answerQuestion(brief, manager, text) {
  brief.thread.push({ authorId: manager._id, kind: 'answer', text });
  await brief.save();
  await notify(brief.employeeId, { kind: 'task_answer', title: `${displayName(manager)} answered your question`, body: text, link: `/tasks/${brief._id}`, channels: ['slack'] });
  emitToUser(brief.employeeId, 'brief:updated', { id: String(brief._id) });
  return brief;
}

export async function flagTranslation(brief, employee, reason = '') {
  brief.employeeStatus = 'flagged';
  brief.flag = { reason, at: new Date() };
  brief.thread.push({ authorId: employee._id, kind: 'flag', text: reason || 'Flagged as wrong' });
  await brief.save();
  await updateMetric(brief, { flagged: true });
  await notify(brief.managerId, {
    kind: 'task_flagged',
    title: `${displayName(employee)} flagged a formatted task as wrong`,
    body: reason || 'Please check the original and the formatted version side by side.',
    link: `/tasks/${brief._id}`,
    channels: ['email', 'slack'],
  });
  emitToUser(brief.managerId, 'brief:updated', { id: String(brief._id) });
  await refreshSlackStatus(brief, 'flagged');
  return brief;
}

// "Break it down further": smaller steps with a target time for each.
export async function requestBreakdown(brief, employee, org) {
  const { holidays } = await calendarForOrg(org);
  const summaries = brief.result?.summaries?.length ? brief.result.summaries : [{ title: brief.originalText, steps: [] }];
  const result = summaries.map((s, taskIndex) => ({ taskIndex, ...breakdownBrief(s, { sentAt: new Date(), org: orgPlain(org), holidays }) }));
  brief.breakdown = { requestedAt: new Date(), result };
  brief.thread.push({ authorId: employee._id, kind: 'breakdown', text: 'Asked for this task to be broken down further' });
  await brief.save();
  await updateMetric(brief, { breakdownRequested: true });
  await notify(brief.managerId, { kind: 'task_breakdown', title: `${displayName(employee)} asked for a task to be broken down`, body: 'BarrierFix added smaller steps with target times. You may want to check them.', link: `/tasks/${brief._id}` });
  emitToUser(brief.managerId, 'brief:updated', { id: String(brief._id) });

  if (brief.slack?.dmChannelId && brief.slack.dmTs?.length) {
    const entry = await slackClientForOrg(brief.orgId);
    const lines = result.flatMap((r) => r.items.map((it, i) => `${i + 1}. ${it.text}${it.targetText ? ` _(aim for ${it.targetText})_` : ''}`));
    try {
      await entry?.client.chat.postMessage({ channel: brief.slack.dmChannelId, thread_ts: brief.slack.dmTs[0], text: `*Smaller steps*\n${lines.join('\n')}` });
    } catch (err) {
      console.warn('[slack] could not post breakdown:', err.data?.error || err.message);
    }
  }
  return brief;
}

// Manager resolves a held translation: approve it, send an edited version, or keep the original.
export async function resolveHeld(brief, manager, org, { action, text }) {
  if (brief.status !== 'held') throw badRequest('This task is not waiting for a check');
  const employee = await User.findById(brief.employeeId);
  if (action === 'keep_original') {
    brief.status = 'original_sent';
    await brief.save();
  } else {
    if (action === 'edit') {
      if (!text?.trim()) throw badRequest('Please write the version to send');
      brief.managerEditedText = text.trim();
      brief.deliveredVersion = 'manager_edited';
    } else brief.deliveredVersion = 'translated';
    brief.status = 'approved';
    await brief.save();
    await deliver(brief, { org, manager, employee });
    if (action === 'approve') await schedulePrompts(brief, org);
  }
  await audit(manager, `brief.held_${action}`, { entity: 'Brief', entityId: brief._id, orgId: org._id });
  emitToUser(brief.managerId, 'brief:updated', { id: String(brief._id) });
  return brief;
}

export async function cancelBrief(brief, manager, status = 'cancelled') {
  brief.status = status;
  await brief.save();
  await cancelPrompts(brief._id);
  emitToUser(brief.employeeId, 'brief:updated', { id: String(brief._id) });
  await refreshSlackStatus(brief, status);
  if (status === 'cancelled') await notify(brief.employeeId, { kind: 'task_cancelled', title: `${displayName(manager)} withdrew a task`, body: brief.result?.summaries?.[0]?.title || '', link: `/tasks/${brief._id}` });
  return brief;
}

// A Slack message was edited: translate the new wording and replace the old task.
export async function supersedeBrief(oldBrief, { org, manager, employee, text }) {
  const fresh = await createBrief({ org, manager, employee, text, source: oldBrief.source, sentAt: new Date(), slack: { ...oldBrief.toObject().slack, dmChannelId: undefined, dmTs: [] }, forceTask: true, supersedes: oldBrief._id });
  if (!fresh) return null;
  oldBrief.supersededBy = fresh._id;
  await cancelBrief(oldBrief, manager, 'superseded');
  return fresh;
}

export async function serializeBrief(brief, viewer) {
  const people = await User.find({ _id: { $in: [brief.managerId, brief.employeeId, ...brief.thread.map((t) => t.authorId)] } }).select('name email');
  const nameOf = new Map(people.map((p) => [String(p._id), displayName(p)]));
  const b = brief.toObject();
  const isManager = String(brief.managerId) === String(viewer._id);
  return {
    ...b,
    managerName: nameOf.get(String(brief.managerId)),
    employeeName: nameOf.get(String(brief.employeeId)),
    thread: b.thread.map((t) => ({ ...t, authorName: nameOf.get(String(t.authorId)) })),
    deliveredCards: deliveredCards(brief),
    viewerRole: isManager ? 'manager' : 'employee',
  };
}
