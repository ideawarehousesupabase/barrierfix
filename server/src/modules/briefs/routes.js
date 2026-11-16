import { Router } from 'express';
import { z } from 'zod';
import { requireFeature, requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { Brief, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { parseCsv } from '../../utils/csv.js';
import { HttpError, ah, badRequest, forbidden, notFound } from '../../utils/http.js';
import { activeRulesFor } from '../profiles/service.js';
import {
  answerQuestion,
  askQuestion,
  cancelBrief,
  confirmTask,
  createBrief,
  discardDraft,
  flagTranslation,
  loadBrief,
  markSeen,
  noProfileReason,
  requestBreakdown,
  resolveHeld,
  runTranslation,
  sendDraft,
  serializeBrief,
} from './service.js';

const router = Router();
router.use(requireOrg);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Choose a person');
const briefText = z.string().trim().min(3, 'Please write the task').max(8000);
// Details the manager adds when the employee's profile requires something the message does not say.
const extras = {
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').optional(),
  deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the 24-hour format HH:MM').optional(),
};
const overridesOf = ({ deadlineDate, deadlineTime }) => ({ deadlineDate, deadlineTime });

async function recipient(req, employeeId) {
  const employee = await User.findOne({ _id: employeeId, orgId: req.org._id, status: 'active' });
  if (!employee) throw notFound('Person not found');
  return employee;
}

const sendersOnly = requireRole('manager', 'hr', 'admin');

// What a preview shows: the draft exactly as it will be delivered.
const draftPreview = (draft) => ({ ...draft.result, validator: draft.validator, text: draft.translatedText });

// Removes one of the sender's own unsent previews. Anyone else's is left alone.
async function discardOwnDraft(req, id) {
  const draft = await Brief.findOne({ _id: id, orgId: req.org._id, managerId: req.user._id, status: 'draft' });
  return draft ? discardDraft(draft) : false;
}

// Shows the manager exactly what the employee will receive. The preview is kept as a draft, and sending
// delivers that draft, so what arrives is exactly what was previewed (MVP-024). Nothing is sent here.
router.post(
  '/preview',
  sendersOnly,
  requireFeature('translation'),
  validate(z.object({ employeeId: objectId, text: briefText, source: z.enum(['web', 'verbal']).optional().default('web'), replaces: objectId.optional(), ...extras })),
  ah(async (req, res) => {
    const employee = await recipient(req, req.body.employeeId);
    if (req.body.replaces) await discardOwnDraft(req, req.body.replaces);
    const options = { org: req.org, manager: req.user, employee, text: req.body.text, priority: req.body.priority, overrides: overridesOf(req.body) };
    if (!(await activeRulesFor(employee._id, req.org._id)).length) {
      const { result } = await runTranslation(options);
      return res.json({ hasProfile: false, rules: [], result, reason: await noProfileReason(employee, req.org) });
    }
    const draft = await createBrief({ ...options, source: req.body.source, actor: req, asDraft: true });
    return res.json({ hasProfile: true, rules: draft.appliedRules.map((r) => r.code), draftId: draft._id, result: draftPreview(draft) });
  }),
);

// Sends a preview the manager has seen. A task cannot be sent from the web without one.
router.post(
  '/',
  sendersOnly,
  requireFeature('translation'),
  validate(z.object({ draftId: objectId.optional() })),
  ah(async (req, res) => {
    if (!req.body.draftId) throw new HttpError(409, 'Preview the task first, then send that preview.', { code: 'preview_required' });
    const draft = await Brief.findOne({ _id: req.body.draftId, orgId: req.org._id, managerId: req.user._id });
    if (!draft) throw notFound('That preview no longer exists. Please preview the task again.');
    const employee = await recipient(req, draft.employeeId);
    const brief = await sendDraft(draft, { org: req.org, manager: req.user, employee, actor: req });
    res.status(201).json({ brief: await serializeBrief(brief, req.user) });
  }),
);

// The manager cancelled a preview: it is removed and nothing is sent.
router.delete(
  '/drafts/:id',
  sendersOnly,
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    if (!(await discardOwnDraft(req, req.params.id))) throw notFound('Preview not found');
    res.json({ ok: true });
  }),
);

// CSV columns: employee_email, brief_text, sent_at (optional, ISO date-time). Every row becomes a
// preview; nothing is sent until the manager confirms them with /import/send.
router.post(
  '/import',
  sendersOnly,
  requireFeature('translation'),
  validate(z.object({ csv: z.string().min(1).max(2_000_000) })),
  ah(async (req, res) => {
    const rows = parseCsv(req.body.csv, { required: ['employee_email', 'brief_text'] });
    if (rows.length > 500) throw badRequest('Please send at most 500 briefs at a time');
    const results = [];
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      const employee = await User.findOne({ email: String(row.employee_email).toLowerCase(), orgId: req.org._id, status: 'active' });
      if (!employee) {
        results.push({ line, email: row.employee_email, ok: false, reason: 'No one with this email in your company' });
        continue;
      }
      const sentAt = row.sent_at ? new Date(row.sent_at) : new Date();
      try {
        const draft = await createBrief({ org: req.org, manager: req.user, employee, text: row.brief_text, source: 'csv', sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt, actor: req, asDraft: true });
        const missing = draft.result?.missing || [];
        if (missing.length) {
          // Required details are never guessed: this row is not sent, and the manager sends it from the form.
          await discardDraft(draft);
          results.push({ line, email: employee.email, ok: false, reason: `${missing.map((m) => m.question).join(' ')} BarrierFix does not guess this, so send this one from the Send a task page.` });
          continue;
        }
        results.push({
          line,
          email: employee.email,
          name: employee.name,
          ok: true,
          draftId: draft._id,
          validatorPassed: draft.validator.passed,
          rules: draft.appliedRules.map((r) => r.code),
          preview: { title: draft.result?.summaries?.[0]?.title || '', text: draft.translatedText },
        });
      } catch (err) {
        results.push({ line, email: employee.email, ok: false, reason: err.message });
      }
    }
    await audit(req, 'brief.imported', { meta: { rows: rows.length, ok: results.filter((r) => r.ok).length } });
    res.json({ results });
  }),
);

const draftIds = z.object({ draftIds: z.array(objectId).min(1).max(500) });

// Sends the previews from an upload that the manager confirmed.
router.post(
  '/import/send',
  sendersOnly,
  requireFeature('translation'),
  validate(draftIds),
  ah(async (req, res) => {
    const results = [];
    for (const id of req.body.draftIds) {
      const draft = await Brief.findOne({ _id: id, orgId: req.org._id, managerId: req.user._id, status: 'draft' });
      if (!draft) {
        results.push({ draftId: id, ok: false, reason: 'Already sent, cancelled or not yours' });
        continue;
      }
      try {
        const employee = await recipient(req, draft.employeeId);
        const brief = await sendDraft(draft, { org: req.org, manager: req.user, employee, actor: req });
        results.push({ draftId: id, ok: true, briefId: brief._id, status: brief.status });
      } catch (err) {
        results.push({ draftId: id, ok: false, reason: err.message });
      }
    }
    res.json({ results });
  }),
);

// The manager cancelled an upload: its previews are removed.
router.post(
  '/import/discard',
  sendersOnly,
  validate(draftIds),
  ah(async (req, res) => {
    let removed = 0;
    for (const id of req.body.draftIds) if (await discardOwnDraft(req, id)) removed += 1;
    res.json({ removed });
  }),
);

router.get(
  '/',
  validate(z.object({ box: z.enum(['inbox', 'sent', 'held']).default('inbox'), limit: z.coerce.number().int().min(1).max(200).default(50) }), 'query'),
  ah(async (req, res) => {
    const { box, limit } = req.valid;
    const filter = { orgId: req.org._id };
    if (box === 'inbox') Object.assign(filter, { employeeId: req.user._id, status: { $in: ['delivered', 'held', 'approved', 'original_sent'] } });
    else if (box === 'sent') Object.assign(filter, { managerId: req.user._id, status: { $ne: 'draft' } });
    else Object.assign(filter, { managerId: req.user._id, status: 'held' });
    const briefs = await Brief.find(filter).sort({ createdAt: -1 }).limit(limit);
    const people = await User.find({ _id: { $in: briefs.flatMap((b) => [b.managerId, b.employeeId]) } }).select('name email');
    const nameOf = new Map(people.map((p) => [String(p._id), p.name || p.email]));
    res.json({
      briefs: briefs.map((b) => ({
        _id: b._id,
        title: b.result?.summaries?.[0]?.title || b.originalText.slice(0, 100),
        deadline: b.result?.summaries?.[0]?.deadline || null,
        taskCount: b.result?.summaries?.length || 1,
        source: b.source,
        status: b.status,
        employeeStatus: b.employeeStatus,
        validatorPassed: b.validator?.passed,
        appliedRules: b.appliedRules,
        managerName: nameOf.get(String(b.managerId)),
        employeeName: nameOf.get(String(b.employeeId)),
        createdAt: b.createdAt,
        expiresAt: b.expiresAt,
        openQuestions: b.thread.filter((t) => t.kind === 'question').length > b.thread.filter((t) => t.kind === 'answer').length,
      })),
    });
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const { brief, isEmployee } = await loadBrief(req.params.id, req.user);
    if (isEmployee) await markSeen(brief);
    res.json({ brief: await serializeBrief(brief, req.user) });
  }),
);

const employeeAction = (handler) =>
  ah(async (req, res) => {
    const { brief, isEmployee } = await loadBrief(req.params.id, req.user);
    if (!isEmployee) throw forbidden('Only the person the task was sent to can do this');
    if (['cancelled', 'superseded'].includes(brief.status)) throw badRequest('This task was withdrawn or replaced');
    await handler(req, brief);
    await audit(req, `brief.${req.path.split('/').pop()}`, { entity: 'Brief', entityId: brief._id });
    res.json({ brief: await serializeBrief(brief, req.user) });
  });

router.post('/:id/confirm', employeeAction((req, brief) => confirmTask(brief, req.user)));
router.post('/:id/question', validate(z.object({ text: z.string().trim().min(2).max(2000) })), employeeAction((req, brief) => askQuestion(brief, req.user, req.body.text)));
router.post('/:id/breakdown', employeeAction((req, brief) => requestBreakdown(brief, req.user, req.org)));
router.post('/:id/flag', validate(z.object({ reason: z.string().trim().max(1000).optional().default('') })), employeeAction((req, brief) => flagTranslation(brief, req.user, req.body.reason)));

const managerAction = (handler) =>
  ah(async (req, res) => {
    const { brief, isManager } = await loadBrief(req.params.id, req.user);
    if (!isManager) throw forbidden('Only the person who sent the task can do this');
    await handler(req, brief);
    res.json({ brief: await serializeBrief(brief, req.user) });
  });

router.post('/:id/answer', validate(z.object({ text: z.string().trim().min(1).max(2000) })), managerAction((req, brief) => answerQuestion(brief, req.user, req.body.text)));
router.post(
  '/:id/resolve',
  validate(z.object({ action: z.enum(['approve', 'edit', 'keep_original']), text: z.string().max(8000).optional() })),
  managerAction((req, brief) => resolveHeld(brief, req.user, req.org, req.body)),
);
router.post(
  '/:id/cancel',
  managerAction(async (req, brief) => {
    if (['cancelled', 'superseded'].includes(brief.status)) throw badRequest('This task was already withdrawn');
    await cancelBrief(brief, req.user);
    await audit(req, 'brief.cancelled', { entity: 'Brief', entityId: brief._id });
  }),
);

export default router;
