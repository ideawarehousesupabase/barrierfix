import { hasFeature } from '../../config/plans.js';
import { ENGINE_RULES } from '../../engine/catalog.js';
import { formatDateTime } from '../../engine/calendar.js';
import { DateTime } from 'luxon';
import { Meeting, ScheduledPrompt, User } from '../../models/index.js';
import { notify } from '../../services/notify.js';
import { createBrief } from '../briefs/service.js';
import { activeRulesFor } from '../profiles/service.js';

const nameOf = (u) => u?.name || u?.email || 'Someone';

export function whenText(meeting, tz = 'Europe/London') {
  const start = DateTime.fromJSDate(meeting.startsAt, { zone: tz });
  return formatDateTime(start, DateTime.now().setZone(tz));
}

// Which attendees have agreed the meeting rules, and with what settings.
async function meetingRuleHolders(meeting) {
  const holders = { MT1: [], MT2: [] };
  for (const id of meeting.attendeeIds) {
    const rules = await activeRulesFor(id);
    for (const code of ['MT1', 'MT2']) {
      const rule = rules.find((r) => r.code === code);
      if (rule) holders[code].push({ userId: id, params: { ...ENGINE_RULES[code].params, ...rule.params } });
    }
  }
  return holders;
}

// (Re)creates the agenda and summary prompts for a meeting.
export async function scheduleMeetingPrompts(meeting, org) {
  await ScheduledPrompt.updateMany({ meetingId: meeting._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  if (!hasFeature(org, 'jitPrompts') || meeting.cancelledAt) return;
  const holders = await meetingRuleHolders(meeting);
  const now = Date.now();
  const docs = [];
  const agendaGroups = new Map();
  for (const h of holders.MT1) {
    const at = Math.max(now, meeting.startsAt.getTime() - Number(h.params.hoursBefore || 24) * 3600 * 1000);
    if (at >= meeting.startsAt.getTime()) continue;
    const key = String(at);
    agendaGroups.set(key, [...(agendaGroups.get(key) || []), h.userId]);
  }
  for (const [at, userIds] of agendaGroups) docs.push({ orgId: org._id, kind: 'agenda_share', runAt: new Date(Number(at)), meetingId: meeting._id, recipientIds: userIds });
  if (holders.MT2.length) {
    const delay = Math.min(...holders.MT2.map((h) => Number(h.params.delayMinutes || 30)));
    docs.push({ orgId: org._id, kind: 'summary_request', runAt: new Date(meeting.endsAt.getTime() + delay * 60000), meetingId: meeting._id, recipientIds: [meeting.organizerId], payload: { attendeeIds: holders.MT2.map((h) => h.userId) } });
  }
  if (docs.length) await ScheduledPrompt.insertMany(docs);
}

export async function shareAgenda(meeting, org, recipientIds) {
  const tz = org.settings?.timezone || 'Europe/London';
  const organizer = await User.findById(meeting.organizerId);
  await notify(recipientIds, {
    kind: 'meeting_agenda',
    title: `Agenda for "${meeting.title}" on ${whenText(meeting, tz)}`,
    body: `${meeting.agenda}\n\nFrom ${nameOf(organizer)}.`,
    link: '/meetings',
    channels: ['slack', 'email'],
  });
  meeting.agendaSharedAt = new Date();
  await meeting.save();
}

// Sends the organiser's written summary to every attendee. People with a profile get
// it in their agreed format; everyone else gets it as written.
export async function sendSummary(meeting, org, organizer, summary) {
  const tz = org.settings?.timezone || 'Europe/London';
  meeting.summary = summary;
  meeting.summarySentAt = new Date();
  await meeting.save();
  const text = `Summary of "${meeting.title}" (${whenText(meeting, tz)}):\n${summary}`;
  const results = [];
  for (const id of meeting.attendeeIds.filter((a) => String(a) !== String(organizer._id))) {
    const attendee = await User.findById(id);
    if (!attendee) continue;
    const hasProfile = (await activeRulesFor(id)).length > 0;
    if (hasProfile && hasFeature(org, 'translation')) {
      const brief = await createBrief({ org, manager: organizer, employee: attendee, text, source: 'meeting_summary', forceTask: true }).catch(() => null);
      results.push({ userId: id, name: nameOf(attendee), formatted: Boolean(brief), briefId: brief?._id });
      if (brief) continue;
    }
    await notify(id, { kind: 'meeting_summary', title: `Summary of "${meeting.title}"`, body: summary, link: '/meetings', channels: ['email', 'slack'] });
    results.push({ userId: id, name: nameOf(attendee), formatted: false });
  }
  return results;
}

export { Meeting };
