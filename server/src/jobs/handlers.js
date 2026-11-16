import { DateTime } from 'luxon';
import { config } from '../config/env.js';
import { hasFeature } from '../config/plans.js';
import { emails } from '../content/emailTemplates.js';
import { formatDateTime } from '../engine/calendar.js';
import { sendEmail } from '../integrations/email.js';
import { Brief, DecisionRecord, DecisionRecordVersion, Meeting, Organization, Profile, ScheduledPrompt, SystemState, User } from '../models/index.js';
import { managerDashboard } from '../modules/dashboard/service.js';
import { shareAgenda } from '../modules/meetings/service.js';
import { audit } from '../services/audit.js';
import { notify, usersWithRole } from '../services/notify.js';

const nameOf = (u) => u?.name || u?.email || 'Someone';
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

async function handlePrompt(p) {
  const org = await Organization.findById(p.orgId);
  if (!org || org.status !== 'active' || !hasFeature(org, 'jitPrompts')) return;
  const tz = org.settings?.timezone || 'Europe/London';

  if (p.kind === 'checkin' || p.kind === 'deadline_reminder') {
    const brief = await Brief.findById(p.briefId);
    if (!brief || ['cancelled', 'superseded', 'held', 'original_sent'].includes(brief.status)) return;
    const summary = brief.result?.summaries?.[p.payload?.taskIndex ?? 0] || {};
    const title = summary.title || p.payload?.title || 'your task';
    const link = `/tasks/${brief._id}`;
    const [employee, manager] = await Promise.all([User.findById(brief.employeeId), User.findById(brief.managerId)]);
    if (p.kind === 'checkin') {
      await notify(brief.employeeId, { kind: 'checkin', title: `Check-in now with ${nameOf(manager)}`, body: `Your agreed check-in for: ${title}. Share how it is going and anything you need.`, link, channels: ['slack'] });
      await notify(brief.managerId, { kind: 'checkin', title: `Check in with ${nameOf(employee)} now`, body: `${nameOf(employee)}'s agreed check-in for: ${title}.`, link, channels: ['slack'] });
    } else {
      const due = summary.deadline ? formatDateTime(DateTime.fromISO(summary.deadline, { zone: tz }), DateTime.now().setZone(tz)) : 'soon';
      await notify(brief.employeeId, { kind: 'deadline_reminder', title: `Reminder: due ${due}`, body: title, link, channels: ['slack'] });
    }
    return;
  }

  const meeting = await Meeting.findById(p.meetingId);
  if (!meeting || meeting.cancelledAt) return;
  if (p.kind === 'agenda_share') {
    if (meeting.startsAt < new Date() || meeting.agendaSharedAt) return;
    if (meeting.agenda) {
      await shareAgenda(meeting, org, p.recipientIds);
      return;
    }
    const people = await User.find({ _id: { $in: p.recipientIds } });
    await notify(meeting.organizerId, {
      kind: 'agenda_request',
      title: `Please add an agenda for "${meeting.title}"`,
      body: `${joinNames(people.map(nameOf))} ${people.length === 1 ? 'has' : 'have'} an agreed adjustment to receive the agenda ahead of meetings. Add it and BarrierFix will share it straight away.`,
      link: '/meetings',
      channels: ['email', 'slack'],
    });
  }
  if (p.kind === 'summary_request' && !meeting.summarySentAt) {
    const people = await User.find({ _id: { $in: p.payload?.attendeeIds || [] } });
    await notify(meeting.organizerId, {
      kind: 'summary_request',
      title: `Send a written summary of "${meeting.title}"`,
      body: `${joinNames(people.map(nameOf))} ${people.length === 1 ? 'has' : 'have'} an agreed adjustment to receive a written summary after meetings.`,
      link: '/meetings',
      channels: ['email', 'slack'],
    });
  }
}

// Claims due prompts one at a time (safe with several server instances).
export async function processDuePrompts(now = new Date()) {
  let processed = 0;
  for (let i = 0; i < 200; i += 1) {
    const prompt = await ScheduledPrompt.findOneAndUpdate(
      { status: 'pending', runAt: { $lte: now } },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { new: true, sort: { runAt: 1 } },
    );
    if (!prompt) break;
    try {
      await handlePrompt(prompt);
      prompt.status = 'sent';
      prompt.sentAt = new Date();
    } catch (err) {
      prompt.status = prompt.attempts >= 3 ? 'failed' : 'pending';
      prompt.lastError = err.message;
    }
    await prompt.save();
    processed += 1;
  }
  return processed;
}

// Monday-morning email for every manager, once per company per week.
export async function sendWeeklyDigests(now = DateTime.now().setZone('Europe/London')) {
  if (now.weekday !== 1 || now.hour < 8) return 0;
  const week = `${now.weekYear}-W${String(now.weekNumber).padStart(2, '0')}`;
  let sent = 0;
  for (const org of await Organization.find({ status: 'active', 'settings.digestEnabled': { $ne: false } })) {
    try {
      await SystemState.create({ key: `digest:${week}:${org._id}`, value: { at: new Date() } });
    } catch {
      continue; // already sent this week
    }
    const managers = await User.find({ orgId: org._id, roles: 'manager', status: 'active' });
    for (const manager of managers) {
      const d = await managerDashboard(manager, org);
      const t = d.toDo;
      const attention = [
        t.heldTranslations && `${t.heldTranslations} formatted task(s) waiting for you to check`,
        t.unansweredQuestions && `${t.unansweredQuestions} question(s) from your team`,
        t.profilesToAgree && `${t.profilesToAgree} Adjustment Profile(s) to agree`,
        t.decisionsToMake && `${t.decisionsToMake} adjustment request(s) to decide`,
        t.reviewsToAnswer && `${t.reviewsToAnswer} review question(s) to answer`,
      ].filter(Boolean);
      if (!attention.length && !d.team.length) continue;
      const translated = d.team.reduce((s, m) => s + m.tasksTranslated30d, 0);
      await sendEmail({
        to: manager.email,
        ...emails.digest({
          name: manager.name,
          orgName: org.name,
          lists: [
            { heading: 'Needs your attention', items: attention.length ? attention : ['Nothing is waiting for you. Thank you.'] },
            { heading: 'Your team', items: [`${d.team.length} people, ${d.team.filter((m) => m.profileStatus === 'agreed').length} with an agreed profile`, `${translated} task(s) delivered in agreed formats in the last 30 days`] },
          ],
          link: config.appUrl,
        }),
      });
      sent += 1;
    }
  }
  return sent;
}

// Reminds whoever has to act next on an adjustment request that has waited a few days: the person it was
// sent to (to answer it, or to fill in the six questions), or HR (to review a rejection). A request is
// never closed because it was left alone.
const WAITING_ON = { pending: 'recipient', answering: 'recipient', hr_review: 'hr', hr_final: 'hr' };

export async function remindIncompleteDecisions(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.decisions.reminderDays * 86400 * 1000);
  const records = await DecisionRecord.find({
    status: { $in: Object.keys(WAITING_ON) },
    updatedAt: { $lte: cutoff },
    $or: [{ lastReminderAt: { $exists: false } }, { lastReminderAt: null }, { lastReminderAt: { $lte: cutoff } }],
  }).limit(500);
  let sent = 0;
  for (const record of records) {
    const party = (id) => [String(record.requesterId), String(record.recipientId)].includes(String(id));
    const targets = WAITING_ON[record.status] === 'recipient' ? [record.recipientId] : (await usersWithRole(record.orgId, 'hr')).filter((u) => !party(u._id)).map((u) => u._id);
    if (!targets.length) continue;
    const what = { pending: 'is waiting for your answer', answering: 'needs your answers to the six questions', hr_review: 'was rejected and is waiting for HR review', hr_final: 'is waiting for a final HR decision' }[record.status];
    await notify(targets, { kind: 'request_reminder', title: 'An adjustment request is still waiting', body: `${record.request.title} ${what}.`, link: `/decisions/${record._id}`, channels: ['email'] });
    await DecisionRecord.updateOne({ _id: record._id }, { $set: { lastReminderAt: now } }, { timestamps: false });
    sent += 1;
  }
  return sent;
}

// Deletes profiles and decision records (with their version history) whose retention period has ended.
export async function retentionSweep(now = new Date()) {
  // A preview the manager never confirmed (it was ignored or the message was left alone) is removed after a day.
  await Brief.deleteMany({ status: 'draft', createdAt: { $lte: new Date(now.getTime() - 86400 * 1000) } });
  const expired = await DecisionRecord.find({ retainUntil: { $lte: now } }).select('_id');
  const [profiles, decisions] = await Promise.all([Profile.deleteMany({ retainUntil: { $lte: now } }), DecisionRecord.deleteMany({ retainUntil: { $lte: now } })]);
  // The version history is append-only through Mongoose, so retention uses the raw collection.
  if (expired.length) await DecisionRecordVersion.collection.deleteMany({ recordId: { $in: expired.map((r) => r._id) } });
  if (profiles.deletedCount || decisions.deletedCount) {
    await audit('system', 'retention.purged', { meta: { profiles: profiles.deletedCount, decisions: decisions.deletedCount } });
  }
  return { profiles: profiles.deletedCount, decisions: decisions.deletedCount };
}
