import { Router } from 'express';
import { z } from 'zod';
import { FACTOR_KEYS } from '../../content/decisionFactors.js';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { DecisionRecord, DecisionRecordVersion, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { notify, usersWithRole } from '../../services/notify.js';
import { toCsv } from '../../utils/csv.js';
import { ah, badRequest, forbidden, notFound, sendCsv, sendPdf } from '../../utils/http.js';
import { maskMedical, medicalWarning } from '../../utils/medicalGuard.js';
import { buildPdf } from '../../utils/pdf.js';
import { currentPromptSet, promptSetFor } from './prompts.js';

// Adjustment requests between an employee and their line manager. See models/DecisionRecord.js for the flow.
const router = Router();
router.use(requireOrg);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const nameOf = (u) => u?.name || u?.email || 'Unknown';
const same = (a, b) => Boolean(a && b && String(a) === String(b));
const warn = (...texts) => medicalWarning(...texts);
const maskText = (value) => (typeof value === 'string' ? maskMedical(value) : value);
const linkTo = (record) => `/decisions/${record._id}`;

export const STATUS_LABELS = {
  pending: 'Waiting for an answer',
  accepted: 'Accepted',
  hr_review: 'Rejected: with HR',
  answering: 'Six questions to answer',
  hr_final: 'With HR for a final decision',
  rejected: 'Rejected',
  overturned: 'Accepted by HR',
  withdrawn: 'Withdrawn',
};

router.get(
  '/meta',
  ah(async (req, res) => {
    const set = await currentPromptSet();
    res.json({ factors: set.factors, promptVersion: set.version, disclaimer: set.disclaimer, statuses: STATUS_LABELS });
  }),
);

async function loadRecord(req) {
  const record = await DecisionRecord.findOne({ _id: req.params.id, orgId: req.org._id });
  if (!record) throw notFound('Request not found');
  const isRequester = same(record.requesterId, req.user._id);
  const isRecipient = same(record.recipientId, req.user._id);
  const isParty = isRequester || isRecipient;
  const isHr = req.user.hasRole('hr');
  if (!isParty && !isHr) throw forbidden('You do not have access to this request');
  return { record, isRequester, isRecipient, isParty, isHr };
}

// Every step: a history entry (who, what, when), a new numbered version with a full snapshot, and an
// audit entry. Audit failures are not swallowed: a step must not go unrecorded.
async function commit(req, record, action, detail) {
  record.history.push({ by: req.user._id, action, detail });
  record.version = (record.version || 0) + 1;
  await record.save();
  await DecisionRecordVersion.create({ orgId: record.orgId, recordId: record._id, version: record.version, action, by: req.user._id, snapshot: record.toObject(), retainUntil: record.retainUntil });
  await audit(req, `decision.${action}`, { entity: 'DecisionRecord', entityId: record._id, meta: { version: record.version }, strict: true });
}

// HR people who can review this request: never the two people involved in it.
async function hrReviewers(orgId, record) {
  return (await usersWithRole(orgId, 'hr')).filter((u) => !same(u._id, record.requesterId) && !same(u._id, record.recipientId));
}

async function serialize(record, viewer) {
  const people = await User.find({ _id: { $in: [record.requesterId, record.recipientId, record.employeeId, record.managerId, record.response?.by, ...record.hrSteps.map((s) => s.by), ...record.history.map((h) => h.by)].filter(Boolean) } }).select('name email');
  const names = new Map(people.map((p) => [String(p._id), nameOf(p)]));
  const set = await promptSetFor(record.promptVersion);
  const r = record.toObject();
  const isRequester = same(record.requesterId, viewer._id);
  const isRecipient = same(record.recipientId, viewer._id);
  const isHr = viewer.hasRole('hr');
  const reviewStage = record.status === 'hr_review' ? 'first' : record.status === 'hr_final' ? 'final' : null;
  return {
    ...r,
    statusLabel: STATUS_LABELS[record.status],
    requesterName: names.get(String(record.requesterId)),
    recipientName: names.get(String(record.recipientId)),
    employeeName: names.get(String(record.employeeId)),
    managerName: names.get(String(record.managerId)),
    responseByName: names.get(String(record.response?.by)),
    hrSteps: (r.hrSteps || []).map((s) => ({ ...s, byName: names.get(String(s.by)) })),
    history: (r.history || []).map((h) => ({ ...h, byName: names.get(String(h.by)) })),
    prompts: set.factors,
    disclaimer: set.disclaimer,
    viewer: {
      isRequester,
      isRecipient,
      isHr,
      canRespond: isRecipient && record.status === 'pending',
      canWithdraw: isRequester && record.status === 'pending',
      canAnswer: isRecipient && record.status === 'answering',
      canReview: isHr && !isRequester && !isRecipient && Boolean(reviewStage),
      reviewStage,
    },
  };
}

router.get(
  '/',
  validate(z.object({ scope: z.enum(['mine', 'waiting', 'hr', 'all']).default('mine') }), 'query'),
  ah(async (req, res) => {
    const me = req.user._id;
    const { scope } = req.valid;
    if (['hr', 'all'].includes(scope) && !req.user.hasRole('hr')) throw forbidden('This list is for HR');
    const filter = { orgId: req.org._id };
    if (scope === 'mine') filter.$or = [{ requesterId: me }, { recipientId: me }];
    if (scope === 'waiting') Object.assign(filter, { recipientId: me, status: { $in: ['pending', 'answering'] } });
    if (scope === 'hr') Object.assign(filter, { status: { $in: ['hr_review', 'hr_final'] }, requesterId: { $ne: me }, recipientId: { $ne: me } });
    const records = await DecisionRecord.find(filter).sort({ updatedAt: -1 }).limit(200);
    const people = await User.find({ _id: { $in: records.flatMap((r) => [r.requesterId, r.recipientId]) } }).select('name email');
    const names = new Map(people.map((p) => [String(p._id), nameOf(p)]));
    res.json({
      records: records.map((r) => ({
        _id: r._id,
        title: r.request.title,
        status: r.status,
        statusLabel: STATUS_LABELS[r.status],
        direction: r.direction,
        requesterName: names.get(String(r.requesterId)),
        recipientName: names.get(String(r.recipientId)),
        requesterId: r.requesterId,
        recipientId: r.recipientId,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      })),
    });
  }),
);

// A new request: an employee asks their line manager, or a manager asks someone in their own team.
router.post(
  '/',
  validate(
    z.object({
      title: z.string().trim().min(3, 'Please give your request a short title').max(200),
      details: z.string().trim().max(3000).optional().default(''),
      employeeId: objectId.optional(),
    }),
  ),
  ah(async (req, res) => {
    // HR reviews rejected requests; it does not make them (agreed with the client, 16 Nov 2026).
    if (req.user.hasRole('hr')) throw forbidden('HR reviews adjustment requests but cannot send them');
    let employee;
    let manager;
    let recipient;
    let direction;
    if (req.body.employeeId && !same(req.body.employeeId, req.user._id)) {
      if (!req.user.hasRole('manager')) throw forbidden('You can send a request to your line manager only');
      const target = await User.findOne({ _id: req.body.employeeId, orgId: req.org._id, status: 'active' });
      if (!target || !same(target.managerId, req.user._id)) throw forbidden('You can send a request only to someone in your own team');
      [employee, manager, recipient, direction] = [target, req.user, target, 'to_employee'];
    } else {
      if (!req.user.managerId) throw badRequest('You do not have a line manager yet. Ask your company admin to set one, then send your request.');
      const lineManager = await User.findOne({ _id: req.user.managerId, orgId: req.org._id, status: 'active' });
      if (!lineManager) throw badRequest('Your line manager is not available. Ask your company admin to check who your line manager is.');
      [employee, manager, recipient, direction] = [req.user, lineManager, lineManager, 'to_manager'];
    }
    const set = await currentPromptSet();
    const record = await DecisionRecord.create({
      orgId: req.org._id,
      employeeId: employee._id,
      managerId: manager._id,
      requesterId: req.user._id,
      recipientId: recipient._id,
      direction,
      createdBy: req.user._id,
      promptVersion: set.version,
      request: { title: req.body.title, details: req.body.details },
    });
    await commit(req, record, 'requested', req.body.title);
    await notify(recipient._id, { kind: 'request_received', title: `New request from ${nameOf(req.user)}`, body: req.body.title, link: linkTo(record), channels: ['email'] });
    res.status(201).json({ record: await serialize(record, req.user), warning: warn(req.body.title, req.body.details) });
  }),
);

router.get('/export.csv', requireRole('hr'), ah(async (req, res) => {
  const filter = { orgId: req.org._id };
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if (from || to) filter.createdAt = { ...(from && !Number.isNaN(from.getTime()) ? { $gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { $lte: to } : {}) };
  const records = await DecisionRecord.find(filter).sort({ createdAt: 1 });
  const people = await User.find({ _id: { $in: records.flatMap((r) => [r.requesterId, r.recipientId, ...r.hrSteps.map((s) => s.by)]).filter(Boolean) } }).select('name email');
  const names = new Map(people.map((p) => [String(p._id), nameOf(p)]));
  const set = await currentPromptSet();
  // Health and medical terms in free text are masked unless HR asks for the full text (?full=1), which is audited.
  const full = req.query.full === '1';
  const columns = [
    { label: 'Request ID', value: (r) => r._id },
    { label: 'Sent', value: (r) => r.createdAt },
    { label: 'From', value: (r) => names.get(String(r.requesterId)) },
    { label: 'To', value: (r) => names.get(String(r.recipientId)) },
    { label: 'Request', value: (r) => r.request.title },
    { label: 'Details', value: (r) => r.request.details },
    { label: 'Status', value: (r) => STATUS_LABELS[r.status] || r.status },
    { label: 'Answer', value: (r) => r.response?.decision || '' },
    { label: 'Answer comment', value: (r) => r.response?.comment || '' },
    { label: 'Answered at', value: (r) => r.response?.at || '' },
    { label: 'Question wording version', value: (r) => r.promptVersion },
    ...set.factors.map((f) => ({ label: f.title, value: (r) => r.answers?.[f.key]?.text || '' })),
    { label: 'HR review', value: (r) => r.hrSteps.map((s) => `${s.stage}: ${s.action.replace(/_/g, ' ')} by ${names.get(String(s.by)) || 'HR'} on ${new Date(s.at).toISOString().slice(0, 10)}${s.comment ? ` (${s.comment})` : ''}`).join(' | ') },
  ];
  const exported = full ? columns : columns.map((c) => ({ ...c, value: (r) => maskText(c.value(r)) }));
  await audit(req, 'decision.exported', { meta: { count: records.length, full } });
  sendCsv(res, `adjustment-requests-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(exported, records));
}));

router.get('/:id', ah(async (req, res) => {
  const { record } = await loadRecord(req);
  res.json({ record: await serialize(record, req.user) });
}));

// For an authorised auditor: every numbered version, each a full snapshot, oldest first.
router.get(
  '/:id/versions',
  requireRole('hr', 'admin'),
  ah(async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw notFound('Request not found');
    const versions = await DecisionRecordVersion.find({ recordId: req.params.id, orgId: req.org._id }).sort({ version: 1 });
    if (!versions.length) throw notFound('Request not found');
    const people = await User.find({ _id: { $in: versions.map((v) => v.by).filter(Boolean) } }).select('name email');
    const names = new Map(people.map((p) => [String(p._id), nameOf(p)]));
    await audit(req, 'decision.versions_viewed', { entity: 'DecisionRecord', entityId: req.params.id });
    res.json({ versions: versions.map((v) => ({ version: v.version, action: v.action, by: v.by, byName: names.get(String(v.by)), at: v.at, snapshot: v.snapshot })) });
  }),
);

// The person the request was sent to accepts or rejects it. Accepting closes it; rejecting sends it to HR.
router.post(
  '/:id/respond',
  validate(z.object({ decision: z.enum(['accept', 'reject']), comment: z.string().trim().max(2000).optional().default('') })),
  ah(async (req, res) => {
    const { record, isRecipient } = await loadRecord(req);
    if (!isRecipient) throw forbidden('Only the person the request was sent to can answer it');
    if (record.status !== 'pending') throw badRequest('This request has already been answered or withdrawn');
    const { decision, comment } = req.body;
    if (decision === 'reject' && comment.length < 3) throw badRequest('Please say why you are rejecting the request');
    record.response = { decision: decision === 'accept' ? 'accepted' : 'rejected', comment, by: req.user._id, at: new Date() };
    const link = linkTo(record);
    if (decision === 'accept') {
      record.status = 'accepted';
      await commit(req, record, 'accepted', comment);
      await notify(record.requesterId, { kind: 'request_accepted', title: `${nameOf(req.user)} accepted your request`, body: record.request.title, link, channels: ['email'] });
    } else {
      const reviewers = await hrReviewers(req.org._id, record);
      if (reviewers.length) {
        record.status = 'hr_review';
        await commit(req, record, 'rejected', comment);
        await notify(reviewers.map((u) => u._id), { kind: 'request_rejected', title: 'A request was rejected and needs HR review', body: record.request.title, link, channels: ['email'] });
      } else {
        record.status = 'rejected';
        await commit(req, record, 'rejected', `${comment} (there is no HR person in this company, so the rejection is final)`);
      }
      await notify(record.requesterId, { kind: 'request_rejected', title: `${nameOf(req.user)} rejected your request`, body: reviewers.length ? `${record.request.title}. HR will review it.` : record.request.title, link, channels: ['email'] });
    }
    res.json({ record: await serialize(record, req.user), warning: warn(comment) });
  }),
);

// After HR sends a rejection back, whoever rejected it answers the six questions.
router.post(
  '/:id/answers',
  validate(z.object({ answers: z.object(Object.fromEntries(FACTOR_KEYS.map((k) => [k, z.string().trim().max(3000).optional().default('')]))) })),
  ah(async (req, res) => {
    const { record, isRecipient } = await loadRecord(req);
    if (!isRecipient) throw forbidden('Only the person who rejected the request answers the six questions');
    if (record.status !== 'answering') throw badRequest('HR has not asked for the six questions on this request');
    const set = await promptSetFor(record.promptVersion);
    const missing = set.factors.filter((f) => (req.body.answers[f.key] || '').length < 2).map((f) => f.title);
    if (missing.length) throw badRequest(`Please answer every question: ${missing.join('; ')}`);
    const now = new Date();
    for (const f of set.factors) record.answers[f.key] = { text: req.body.answers[f.key], by: req.user._id, at: now };
    record.markModified('answers');
    const reviewers = await hrReviewers(req.org._id, record);
    record.status = reviewers.length ? 'hr_final' : 'rejected';
    await commit(req, record, 'answers_submitted', reviewers.length ? undefined : 'there is no HR person to review it any more, so the rejection is final');
    if (reviewers.length) {
      await notify(reviewers.map((u) => u._id), { kind: 'request_answers_ready', title: 'The six questions have been answered', body: `${record.request.title}: please make the final decision.`, link: linkTo(record), channels: ['email'] });
    }
    res.json({ record: await serialize(record, req.user), warning: warn(...Object.values(req.body.answers)) });
  }),
);

// HR reviews a rejection. First time: accept it or send it back for the six questions. After the
// questions are answered: accept the rejection, or reject it (the request then stands).
router.post(
  '/:id/hr',
  requireRole('hr'),
  validate(z.object({ action: z.enum(['accept_rejection', 'send_back', 'reject_rejection']), comment: z.string().trim().max(2000).optional().default('') })),
  ah(async (req, res) => {
    const { record, isParty } = await loadRecord(req);
    if (isParty) throw forbidden('You cannot review a request you are part of. Another HR person needs to review it.');
    const stage = { hr_review: 'first', hr_final: 'final' }[record.status];
    if (!stage) throw badRequest('This request is not waiting for HR');
    const { action, comment } = req.body;
    if (stage === 'first' && action === 'reject_rejection') throw badRequest('First accept the rejection, or send it back for the six questions');
    if (stage === 'final' && action === 'send_back') throw badRequest('This request was already sent back once. Accept or reject the rejection.');
    record.hrSteps.push({ stage, action, comment, by: req.user._id, at: new Date() });
    const link = linkTo(record);
    if (action === 'send_back') {
      record.status = 'answering';
      await commit(req, record, 'hr_sent_back', comment);
      await notify(record.recipientId, { kind: 'request_answers_needed', title: 'HR asked you to answer six questions', body: `About the request you rejected: ${record.request.title}`, link, channels: ['email'] });
    } else {
      const upheld = action === 'accept_rejection';
      record.status = upheld ? 'rejected' : 'overturned';
      await commit(req, record, upheld ? 'hr_accepted_rejection' : 'hr_rejected_rejection', comment);
      await notify([record.requesterId, record.recipientId], {
        kind: 'request_closed',
        title: upheld ? 'HR confirmed the rejection' : 'HR overturned the rejection: the request is accepted',
        body: record.request.title,
        link,
        channels: ['email'],
      });
    }
    res.json({ record: await serialize(record, req.user), warning: warn(comment) });
  }),
);

router.post(
  '/:id/withdraw',
  ah(async (req, res) => {
    const { record, isRequester } = await loadRecord(req);
    if (!isRequester) throw forbidden('Only the person who made the request can withdraw it');
    if (record.status !== 'pending') throw badRequest('A request can be withdrawn only until it is answered');
    record.status = 'withdrawn';
    await commit(req, record, 'withdrawn');
    await notify(record.recipientId, { kind: 'request_withdrawn', title: `${nameOf(req.user)} withdrew a request`, body: record.request.title, link: linkTo(record) });
    res.json({ record: await serialize(record, req.user) });
  }),
);

router.get(
  '/:id/export',
  ah(async (req, res) => {
    const { record, isHr } = await loadRecord(req);
    // Health and medical terms are masked unless HR asks for the full text, which is audited.
    const full = req.query.full === '1';
    if (full && !isHr) throw forbidden('Only HR can export the full text');
    const t = full ? (v) => v : maskText;
    const r = await serialize(record, req.user);
    const date = (d) => (d ? new Date(d).toLocaleString('en-GB') : '');
    const answered = r.prompts.some((f) => r.answers?.[f.key]?.text);
    const pdf = await buildPdf({
      title: 'Adjustment request',
      subtitle: `${req.org.name} · request ${r._id} · version ${r.version}`,
      blocks: [
        { fields: [['From', r.requesterName], ['To', r.recipientName], ['Sent', date(r.createdAt)], ['Status', r.statusLabel]] },
        { heading: 'The request' },
        { fields: [['Request', t(r.request.title)], ['Details', t(r.request.details) || 'None given']] },
        ...(r.response?.decision ? [{ heading: 'Answer' }, { fields: [['Answer', r.response.decision === 'accepted' ? 'Accepted' : 'Rejected'], ['Comment', t(r.response.comment) || 'None'], ['By', r.responseByName], ['At', date(r.response.at)]] }] : []),
        ...(answered ? [{ heading: `The six questions (wording version ${r.promptVersion})` }, ...r.prompts.map((f) => ({ fields: [[f.title, t(r.answers?.[f.key]?.text) || 'Not answered']] }))] : []),
        ...(r.hrSteps.length ? [{ heading: 'HR review' }, { list: r.hrSteps.map((s) => `${s.stage === 'first' ? 'First review' : 'Final review'}: ${s.action.replace(/_/g, ' ')} by ${s.byName || 'HR'}, ${date(s.at)}${s.comment ? `. ${t(s.comment)}` : ''}`) }] : []),
        ...(full ? [] : [{ text: 'Health and medical details typed into this request are left out of this export. HR can download the full text if it is needed.' }]),
        { divider: true },
        { text: r.disclaimer },
      ],
    });
    await audit(req, 'decision.pdf_exported', { entity: 'DecisionRecord', entityId: record._id, meta: { full } });
    sendPdf(res, `adjustment-request-${record._id}.pdf`, pdf);
  }),
);

export default router;
