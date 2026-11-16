import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { ROOT_DIR } from '../../config/env.js';
import { BANK_HOLIDAY_REGIONS, ROLES, RULE_GROUPS } from '../../config/constants.js';
import { PLAN_KEYS } from '../../config/plans.js';
import { BRIEF_RULE_CODES } from '../../engine/catalog.js';
import { requirePlatformAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { BriefMetric, EvaluationRun, OrgRequest, Organization, Profile, Rule, RuleVersion, SlackInstallation, User } from '../../models/index.js';
import { disconnectOrg } from '../../realtime/socket.js';
import { audit } from '../../services/audit.js';
import { toCsv } from '../../utils/csv.js';
import { ah, badRequest, conflict, notFound, sendCsv } from '../../utils/http.js';
import { FACTOR_KEYS } from '../../content/decisionFactors.js';
import { briefKpis } from '../dashboard/service.js';
import { addPromptSet, listPromptSets } from '../decisions/prompts.js';
import { createAccount, resetTemporaryPassword } from '../users/service.js';
import { createOrgWithAdmin } from '../organizations/service.js';
import { emails } from '../../content/emailTemplates.js';
import { sendEmail } from '../../integrations/email.js';
import { runEvaluation } from './evaluation.js';

const router = Router();
router.use(requirePlatformAdmin);

router.get(
  '/overview',
  ah(async (req, res) => {
    const [orgs, users, profiles, slack, newRequests] = await Promise.all([Organization.countDocuments(), User.countDocuments({ orgId: { $ne: null } }), Profile.countDocuments({ status: 'agreed' }), SlackInstallation.countDocuments(), OrgRequest.countDocuments({ status: 'new' })]);
    const byPlan = await Organization.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]);
    res.json({ orgs, users, profilesAgreed: profiles, slackConnected: slack, newRequests, byPlan: Object.fromEntries(byPlan.map((p) => [p._id, p.count])), kpis: await briefKpis({}) });
  }),
);

router.get(
  '/orgs',
  ah(async (req, res) => {
    const orgs = await Organization.find().sort({ createdAt: -1 });
    const since = new Date(Date.now() - 30 * 86400 * 1000);
    const [userCounts, briefCounts, slack] = await Promise.all([
      User.aggregate([{ $match: { orgId: { $ne: null } } }, { $group: { _id: '$orgId', count: { $sum: 1 } } }]),
      BriefMetric.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$orgId', count: { $sum: 1 } } }]),
      SlackInstallation.find().select('orgId teamName'),
    ]);
    const users = new Map(userCounts.map((u) => [String(u._id), u.count]));
    const briefs = new Map(briefCounts.map((b) => [String(b._id), b.count]));
    const slackBy = new Map(slack.map((s) => [String(s.orgId), s.teamName]));
    res.json({ orgs: orgs.map((o) => ({ ...o.toObject(), users: users.get(String(o._id)) || 0, briefs30d: briefs.get(String(o._id)) || 0, slackTeam: slackBy.get(String(o._id)) || null })) });
  }),
);

// Companies and their first admin are created here, never by self-registration.
router.post(
  '/orgs',
  validate(
    z.object({
      name: z.string().trim().min(2).max(120),
      staffCount: z.coerce.number().int().min(1).max(100000).optional(),
      sector: z.string().trim().max(80).optional(),
      bankHolidayRegion: z.enum(BANK_HOLIDAY_REGIONS).optional(),
      plan: z.enum(PLAN_KEYS).optional(),
      admin: z.object({
        email: z.string().trim().toLowerCase().email(),
        name: z.string().trim().max(120).optional().default(''),
        roles: z.array(z.enum(ROLES)).optional().default([]),
        emailDetails: z.boolean().optional().default(false),
      }),
    }),
  ),
  ah(async (req, res) => {
    const { org, admin, temporaryPassword } = await createOrgWithAdmin({ ...req.body, creator: req.user });
    await audit(req, 'org.created', { entity: 'Organization', entityId: org._id, orgId: org._id, meta: { name: org.name, orgNumber: org.orgNumber, plan: org.plan, adminEmail: admin.email } });
    res.status(201).json({ org, admin: admin.toSafeJSON(), temporaryPassword });
  }),
);

// Account requests from the public "request an account" form.
router.get(
  '/org-requests',
  validate(z.object({ status: z.enum(['new', 'approved', 'rejected', 'all']).default('new') }), 'query'),
  ah(async (req, res) => {
    const filter = req.valid.status === 'all' ? {} : { status: req.valid.status };
    res.json({ requests: await OrgRequest.find(filter).sort({ createdAt: -1 }).limit(200) });
  }),
);

async function openRequest(id) {
  const request = /^[a-f0-9]{24}$/i.test(id) ? await OrgRequest.findById(id) : null;
  if (!request) throw notFound('Request not found');
  if (request.status !== 'new') throw conflict(`This request was already ${request.status}`);
  return request;
}

// Approving creates the company (with its Organisation ID) and its Company Admin from the request.
// The temporary password is shown once, for us to pass on securely.
router.post(
  '/org-requests/:id/approve',
  validate(z.object({ plan: z.enum(PLAN_KEYS).optional(), bankHolidayRegion: z.enum(BANK_HOLIDAY_REGIONS).optional() })),
  ah(async (req, res) => {
    const request = await openRequest(req.params.id);
    const { org, admin, temporaryPassword } = await createOrgWithAdmin({
      name: request.companyName,
      staffCount: request.staffCount,
      sector: request.sector,
      plan: req.body.plan,
      bankHolidayRegion: req.body.bankHolidayRegion,
      admin: { email: request.email, name: request.contactName, jobTitle: request.jobTitle },
      creator: req.user,
    });
    Object.assign(request, { status: 'approved', orgId: org._id, reviewedBy: req.user._id, reviewedAt: new Date() });
    await request.save();
    await audit(req, 'platform.org_request_approved', { entity: 'OrgRequest', entityId: request._id, orgId: org._id, meta: { companyName: org.name, orgNumber: org.orgNumber, adminEmail: admin.email } });
    res.status(201).json({ request, org, admin: admin.toSafeJSON(), temporaryPassword });
  }),
);

router.post(
  '/org-requests/:id/reject',
  validate(z.object({ note: z.string().trim().max(1000).optional().default('') })),
  ah(async (req, res) => {
    const request = await openRequest(req.params.id);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);
    Object.assign(request, { status: 'rejected', decisionNote: req.body.note, reviewedBy: req.user._id, reviewedAt: new Date(), expiresAt });
    await request.save();
    await sendEmail({ to: request.email, ...emails.orgRequestDeclined({ name: request.contactName, companyName: request.companyName, note: req.body.note }) });
    await audit(req, 'platform.org_request_rejected', { entity: 'OrgRequest', entityId: request._id, meta: { companyName: request.companyName } });
    res.json({ request });
  }),
);

// A company that lost its only admin (or whose admin is locked out) gets one back here: a new
// admin account, or an existing member of that company made admin with a new temporary password.
router.post(
  '/orgs/:id/admin',
  validate(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().max(120).optional().default(''), emailDetails: z.boolean().optional().default(false) })),
  ah(async (req, res) => {
    const org = /^[a-f0-9]{24}$/i.test(req.params.id) ? await Organization.findById(req.params.id) : null;
    if (!org) throw notFound('Company not found');
    const { email, name, emailDetails } = req.body;
    const existing = await User.findOne({ email });
    if (existing && !existing.orgId?.equals(org._id)) throw conflict('That email address belongs to someone outside this company');
    if (existing) {
      if (existing.status !== 'active') throw badRequest('That account is not active. Reactivate it first, or use another email address.');
      existing.roles = [...new Set(['admin', ...existing.roles])];
      const temporaryPassword = await resetTemporaryPassword({ user: existing, org, creator: req.user, emailDetails });
      await audit(req, 'platform.org_admin_added', { orgId: org._id, entity: 'User', entityId: existing._id, meta: { email, reset: true } });
      return res.json({ admin: existing.toSafeJSON(), temporaryPassword });
    }
    const account = await createAccount({ org, creator: req.user, email, name, roles: ['admin'], emailDetails });
    await audit(req, 'platform.org_admin_added', { orgId: org._id, entity: 'User', entityId: account.user._id, meta: { email, reset: false } });
    return res.status(201).json({ admin: account.user.toSafeJSON(), temporaryPassword: account.temporaryPassword });
  }),
);

// No payment gateway in the MVP: plans are set here by hand.
router.patch(
  '/orgs/:id',
  validate(z.object({ plan: z.enum(PLAN_KEYS).optional(), status: z.enum(['active', 'suspended']).optional() })),
  ah(async (req, res) => {
    const org = await Organization.findById(req.params.id);
    if (!org) throw notFound('Company not found');
    if (req.body.plan && req.body.plan !== org.plan) {
      org.plan = req.body.plan;
      org.planChangedAt = new Date();
      org.planChangedBy = req.user.email;
    }
    if (req.body.status) org.status = req.body.status;
    await org.save();
    if (org.status === 'suspended') disconnectOrg(org._id);
    await audit(req, 'platform.org_updated', { orgId: org._id, entity: 'Organization', entityId: org._id, meta: req.body });
    res.json({ org });
  }),
);

router.get('/rules', ah(async (req, res) => res.json({ rules: await Rule.find().sort({ group: 1, priority: 1 }) })));

const ruleText = {
  name: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(2).max(500),
  changes: z.string().trim().max(1000).optional(),
  neverChanges: z.string().trim().max(1000).optional(),
  typicalCost: z.string().trim().max(120).optional(),
  costLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
  accessToWork: z.boolean().optional(),
  source: z.string().trim().max(300).optional(),
  reviewedBy: z.string().trim().max(120).optional(),
};

const snapshotRule = (rule, by) => RuleVersion.create({ code: rule.code, version: rule.version, by, snapshot: rule.toObject() });

// New library entries are record-only: rules that change tasks need engine code.
router.post(
  '/rules',
  validate(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{1,3}$/, 'Use two letters and a number, e.g. EN9'), group: z.enum(RULE_GROUPS), ...ruleText })),
  ah(async (req, res) => {
    if (await Rule.exists({ code: req.body.code })) throw conflict('That code is already used');
    if (BRIEF_RULE_CODES.includes(req.body.code)) throw badRequest('That code is reserved for an engine rule');
    const rule = await Rule.create({ ...req.body, type: 'record', priority: 90 });
    await snapshotRule(rule, req.user.email);
    await audit(req, 'platform.rule_created', { entity: 'Rule', entityId: rule.code });
    res.status(201).json({ rule });
  }),
);

router.patch(
  '/rules/:code',
  validate(
    z.object({
      ...Object.fromEntries(Object.entries(ruleText).map(([k, v]) => [k, v.optional()])),
      group: z.enum(RULE_GROUPS).optional(),
      approved: z.boolean().optional(),
      active: z.boolean().optional(),
      markReviewed: z.boolean().optional(),
    }),
  ),
  ah(async (req, res) => {
    const rule = await Rule.findOne({ code: req.params.code.toUpperCase() });
    if (!rule) throw notFound('Rule not found');
    const { markReviewed, ...changes } = req.body;
    Object.assign(rule, changes);
    // Retiring keeps the entry and its history; it just stops being offered.
    if (changes.active === false) rule.retiredAt = new Date();
    if (changes.active === true) rule.retiredAt = undefined;
    if (markReviewed) rule.reviewedAt = new Date();
    rule.version += 1;
    await rule.save();
    await snapshotRule(rule, req.user.email);
    await audit(req, 'platform.rule_updated', { entity: 'Rule', entityId: rule.code, meta: req.body });
    res.json({ rule });
  }),
);

router.get(
  '/rules/:code/versions',
  ah(async (req, res) => {
    const versions = await RuleVersion.find({ code: req.params.code.toUpperCase() }).sort({ version: -1 });
    res.json({ versions });
  }),
);

// The decision prompts and guidance. Each change is a new version with an effective date and a note.
router.get('/decision-prompts', ah(async (req, res) => res.json({ promptSets: await listPromptSets() })));

router.post(
  '/decision-prompts',
  validate(
    z.object({
      changeNote: z.string().trim().min(3).max(1000),
      effectiveFrom: z.coerce.date().optional(),
      disclaimer: z.string().trim().min(10).max(2000).optional(),
      factors: z
        .array(z.object({ key: z.enum(FACTOR_KEYS), title: z.string().trim().min(2).max(200), prompt: z.string().trim().min(10).max(2000), help: z.string().trim().max(2000).optional() }))
        .length(FACTOR_KEYS.length)
        .refine((list) => new Set(list.map((f) => f.key)).size === FACTOR_KEYS.length, 'Include each factor once'),
    }),
  ),
  ah(async (req, res) => {
    const promptSet = await addPromptSet({ ...req.body, by: req.user.email });
    await audit(req, 'platform.decision_prompts_updated', { entity: 'DecisionPromptSet', entityId: String(promptSet.version), meta: { changeNote: req.body.changeNote, effectiveFrom: promptSet.effectiveFrom } });
    res.status(201).json({ promptSet });
  }),
);

router.get('/evaluations/sample.csv', (req, res) => {
  const file = path.join(ROOT_DIR, 'samples', 'evaluation-test-set.csv');
  sendCsv(res, 'evaluation-test-set.csv', fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^﻿/, '') : 'id,brief_text,sent_at,rules,expected_is_task,expected_deadline,expected_steps,candidate_translation,expected_validator\n');
});

router.post(
  '/evaluations',
  validate(z.object({ name: z.string().trim().max(120).optional(), csv: z.string().min(1).max(5_000_000) })),
  ah(async (req, res) => {
    const run = await runEvaluation({ name: req.body.name, csv: req.body.csv, user: req.user });
    await audit(req, 'platform.evaluation_run', { entity: 'EvaluationRun', entityId: run._id, meta: run.summary });
    res.status(201).json({ run });
  }),
);

router.get('/evaluations', ah(async (req, res) => res.json({ runs: await EvaluationRun.find().select('-cases').sort({ createdAt: -1 }).limit(50) })));

router.get(
  '/evaluations/:id',
  ah(async (req, res) => {
    const run = await EvaluationRun.findById(req.params.id);
    if (!run) throw notFound('Evaluation run not found');
    res.json({ run });
  }),
);

router.get(
  '/evaluations/:id/export.csv',
  ah(async (req, res) => {
    const run = await EvaluationRun.findById(req.params.id);
    if (!run) throw notFound('Evaluation run not found');
    const columns = [
      { label: 'id', value: 'id' },
      { label: 'rules', value: (c) => (c.rules || []).join(';') },
      { label: 'is_task', value: 'isTask' },
      { label: 'detection_correct', value: 'detectionCorrect' },
      { label: 'deadline', value: 'deadline' },
      { label: 'expected_deadline', value: 'expectedDeadline' },
      { label: 'deadline_correct', value: 'deadlineCorrect' },
      { label: 'steps', value: 'steps' },
      { label: 'steps_correct', value: 'stepsCorrect' },
      { label: 'validator_passed', value: 'validatorPassed' },
      { label: 'failed_checks', value: (c) => (c.failedChecks || []).join(' | ') },
      { label: 'candidate_passed', value: 'candidatePassed' },
      { label: 'validator_correct', value: 'validatorCorrect' },
      { label: 'processing_ms', value: 'processingMs' },
      { label: 'translation', value: 'translation' },
    ];
    sendCsv(res, `evaluation-${run._id}.csv`, toCsv(columns, run.cases));
  }),
);

export default router;
