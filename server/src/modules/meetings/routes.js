import { Router } from 'express';
import { z } from 'zod';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { Meeting, ScheduledPrompt, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { ah, badRequest, forbidden, notFound } from '../../utils/http.js';
import { scheduleMeetingPrompts, sendSummary, shareAgenda } from './service.js';

const router = Router();
router.use(requireOrg);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const meetingInput = z.object({
  title: z.string().trim().min(2).max(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  attendeeIds: z.array(objectId).max(100).default([]),
  agenda: z.string().trim().max(4000).optional().default(''),
});

async function load(req) {
  const meeting = await Meeting.findOne({ _id: req.params.id, orgId: req.org._id });
  if (!meeting) throw notFound('Meeting not found');
  const isOrganizer = String(meeting.organizerId) === String(req.user._id);
  const isAttendee = meeting.attendeeIds.some((a) => String(a) === String(req.user._id));
  if (!isOrganizer && !isAttendee) throw forbidden('You are not part of this meeting');
  return { meeting, isOrganizer };
}

async function shape(meetings) {
  const people = await User.find({ _id: { $in: meetings.flatMap((m) => [m.organizerId, ...m.attendeeIds]) } }).select('name email');
  const names = new Map(people.map((p) => [String(p._id), p.name || p.email]));
  return meetings.map((m) => ({ ...m.toObject(), organizerName: names.get(String(m.organizerId)), attendees: m.attendeeIds.map((id) => ({ _id: id, name: names.get(String(id)) || 'Unknown' })) }));
}

router.get(
  '/',
  ah(async (req, res) => {
    const me = req.user._id;
    const past = req.query.range === 'past';
    const now = new Date();
    const meetings = await Meeting.find({ orgId: req.org._id, $or: [{ organizerId: me }, { attendeeIds: me }], ...(past ? { endsAt: { $lt: now } } : { endsAt: { $gte: now } }) })
      .sort({ startsAt: past ? -1 : 1 })
      .limit(100);
    res.json({ meetings: await shape(meetings) });
  }),
);

async function checkAttendees(req, ids) {
  const count = await User.countDocuments({ _id: { $in: ids }, orgId: req.org._id });
  if (count !== new Set(ids).size) throw badRequest('Some attendees were not found');
}

router.post(
  '/',
  requireRole('manager', 'hr', 'admin'),
  validate(meetingInput),
  ah(async (req, res) => {
    if (req.body.endsAt <= req.body.startsAt) throw badRequest('The meeting must end after it starts');
    await checkAttendees(req, req.body.attendeeIds);
    const meeting = await Meeting.create({ ...req.body, orgId: req.org._id, organizerId: req.user._id });
    await scheduleMeetingPrompts(meeting, req.org);
    await audit(req, 'meeting.created', { entity: 'Meeting', entityId: meeting._id });
    res.status(201).json({ meeting: (await shape([meeting]))[0] });
  }),
);

router.patch(
  '/:id',
  validate(meetingInput.partial()),
  ah(async (req, res) => {
    const { meeting, isOrganizer } = await load(req);
    if (!isOrganizer) throw forbidden('Only the organiser can change this meeting');
    if (req.body.attendeeIds) await checkAttendees(req, req.body.attendeeIds);
    Object.assign(meeting, req.body);
    if (meeting.endsAt <= meeting.startsAt) throw badRequest('The meeting must end after it starts');
    await meeting.save();
    await scheduleMeetingPrompts(meeting, req.org);
    // An agenda added after the agenda prompt went out is shared straight away.
    if (meeting.agenda && !meeting.agendaSharedAt && meeting.startsAt > new Date()) {
      const asked = await ScheduledPrompt.findOne({ meetingId: meeting._id, kind: 'agenda_share', status: 'sent' });
      if (asked) await shareAgenda(meeting, req.org, asked.recipientIds);
    }
    await audit(req, 'meeting.updated', { entity: 'Meeting', entityId: meeting._id });
    res.json({ meeting: (await shape([meeting]))[0] });
  }),
);

router.post(
  '/:id/share-agenda',
  ah(async (req, res) => {
    const { meeting, isOrganizer } = await load(req);
    if (!isOrganizer) throw forbidden('Only the organiser can share the agenda');
    if (!meeting.agenda) throw badRequest('Add an agenda first');
    await shareAgenda(meeting, req.org, meeting.attendeeIds);
    res.json({ meeting: (await shape([meeting]))[0] });
  }),
);

router.post(
  '/:id/summary',
  validate(z.object({ summary: z.string().trim().min(5).max(6000) })),
  ah(async (req, res) => {
    const { meeting, isOrganizer } = await load(req);
    if (!isOrganizer) throw forbidden('Only the organiser can send the summary');
    const results = await sendSummary(meeting, req.org, req.user, req.body.summary);
    await ScheduledPrompt.updateMany({ meetingId: meeting._id, kind: 'summary_request', status: 'pending' }, { $set: { status: 'cancelled' } });
    await audit(req, 'meeting.summary_sent', { entity: 'Meeting', entityId: meeting._id, meta: { recipients: results.length } });
    res.json({ meeting: (await shape([meeting]))[0], results });
  }),
);

router.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const { meeting, isOrganizer } = await load(req);
    if (!isOrganizer) throw forbidden('Only the organiser can cancel this meeting');
    meeting.cancelledAt = new Date();
    await meeting.save();
    await scheduleMeetingPrompts(meeting, req.org);
    res.json({ meeting: (await shape([meeting]))[0] });
  }),
);

export default router;
