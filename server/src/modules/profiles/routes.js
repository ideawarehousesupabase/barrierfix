import { Router } from 'express';
import { z } from 'zod';
import { RULE_GROUP_LABELS } from '../../config/constants.js';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { Profile, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { notify, usersWithRole } from '../../services/notify.js';
import { parseCsv } from '../../utils/csv.js';
import { ah, badRequest, conflict, forbidden, notFound, sendPdf } from '../../utils/http.js';
import { medicalWarning } from '../../utils/medicalGuard.js';
import { buildPdf } from '../../utils/pdf.js';
import { cancelReviews } from '../reviews/service.js';
import { ruleMap } from '../rules/routes.js';
import { agreeProfile, canAgree, getOrCreateProfile, loadEmployeeProfile, serializeProfile } from './service.js';

const router = Router();
router.use(requireOrg);

const ruleInput = z.object({
  code: z.string().trim().toUpperCase(),
  params: z.record(z.union([z.string(), z.number()])).optional().default({}),
  note: z.string().trim().max(500).optional().default(''),
});

function cleanParams(lib, params = {}) {
  const out = {};
  for (const def of lib.params || []) {
    const raw = params[def.key] ?? def.default;
    if (def.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`"${def.label}" must be a number`);
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw badRequest(`"${def.label}" must be between ${def.min} and ${def.max}`);
      out[def.key] = n;
    } else if (def.kind === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) throw badRequest(`"${def.label}" must be a time like 12:00`);
      out[def.key] = String(raw);
    } else out[def.key] = String(raw ?? '').slice(0, 200);
  }
  return out;
}

const sameParams = (a = {}, b = {}) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

async function managerOrHr(employee) {
  if (employee.managerId) return [employee.managerId];
  return (await usersWithRole(employee.orgId, 'hr')).map((u) => u._id);
}

router.get(
  '/me',
  ah(async (req, res) => {
    const profile = await Profile.findOne({ employeeId: req.user._id });
    res.json({ profile: await serializeProfile(profile, req.user, await ruleMap(), req.user) });
  }),
);

// The employee edits their own rules. New rules and changes wait for the manager to
// agree; removing a rule takes effect straight away (the employee is in control).
router.put(
  '/me',
  validate(z.object({ rules: z.array(ruleInput).max(60), extraViewerIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(20).optional() })),
  ah(async (req, res) => {
    const rules = await ruleMap();
    const profile = await getOrCreateProfile(req.org, req.user);
    const incoming = new Map();
    for (const r of req.body.rules) {
      const lib = rules.get(r.code);
      if (!lib || !lib.active) throw badRequest(`Unknown rule ${r.code}`);
      incoming.set(r.code, { ...r, params: cleanParams(lib, r.params) });
    }
    let changed = false;
    const removedCodes = [];
    for (const existing of profile.rules) {
      if (existing.status === 'removed') continue;
      const next = incoming.get(existing.code);
      if (!next) {
        existing.status = 'removed';
        existing.removedAt = new Date();
        existing.pending = undefined;
        removedCodes.push(existing.code);
        changed = true;
        continue;
      }
      incoming.delete(existing.code);
      const differs = !sameParams(existing.params, next.params) || (existing.note || '') !== next.note;
      if (existing.status === 'proposed') {
        if (differs) {
          existing.params = next.params;
          existing.note = next.note;
          changed = true;
        }
      } else if (differs) {
        existing.pending = { params: next.params, note: next.note };
        changed = true;
      } else if (existing.pending) {
        existing.pending = undefined;
      }
    }
    for (const r of incoming.values()) {
      profile.rules.push({ code: r.code, params: r.params, note: r.note, status: 'proposed', addedBy: req.user._id, source: 'employee' });
      changed = true;
    }
    for (const code of removedCodes) await cancelReviews(profile._id, code);
    if (req.body.extraViewerIds) {
      const viewers = await User.find({ _id: { $in: req.body.extraViewerIds }, orgId: req.org._id }).select('_id');
      profile.extraViewerIds = viewers.map((v) => v._id).filter((id) => !id.equals(req.user._id));
    }
    const hasPending = profile.rules.some((r) => r.status === 'proposed' || (r.status === 'agreed' && r.pending));
    if (changed && hasPending) profile.status = 'draft';
    else if (!hasPending && profile.rules.some((r) => r.status === 'agreed')) profile.status = 'agreed';
    profile.history.push({ by: req.user._id, action: 'edited', detail: removedCodes.length ? `removed ${removedCodes.join(', ')}` : '' });
    profile.markModified('rules');
    await profile.save();
    if (removedCodes.length) {
      const names = removedCodes.map((c) => rules.get(c)?.name || c).join(', ');
      await notify(await managerOrHr(req.user), { kind: 'profile_rule_removed', title: `${req.user.name || req.user.email} removed a rule from their profile`, body: `No longer applied: ${names}.`, link: `/team/${req.user._id}` });
    }
    await audit(req, 'profile.edited', { entity: 'Profile', entityId: profile._id, meta: { removed: removedCodes } });
    res.json({
      profile: await serializeProfile(profile, req.user, rules, req.user),
      warning: medicalWarning(...req.body.rules.map((r) => r.note)),
    });
  }),
);

router.post(
  '/me/submit',
  validate(z.object({ consent: z.literal(true, { errorMap: () => ({ message: 'Please confirm you agree to BarrierFix applying these rules' }) }) })),
  ah(async (req, res) => {
    const profile = await getOrCreateProfile(req.org, req.user);
    const pending = profile.rules.filter((r) => r.status === 'proposed' || (r.status === 'agreed' && r.pending));
    if (!pending.length) throw badRequest('There is nothing new to send to your manager');
    profile.status = 'proposed';
    profile.submittedAt = new Date();
    profile.consent = { given: true, givenAt: new Date() };
    profile.history.push({ by: req.user._id, action: 'submitted', detail: pending.map((r) => r.code).join(', ') });
    await profile.save();
    await notify(await managerOrHr(req.user), {
      kind: 'profile_submitted',
      title: `${req.user.name || req.user.email} asked you to agree their Adjustment Profile`,
      body: `${pending.length} rule(s) to review. It takes a few minutes.`,
      link: `/team/${req.user._id}`,
      channels: ['email', 'slack'],
    });
    await audit(req, 'profile.submitted', { entity: 'Profile', entityId: profile._id });
    res.json({ profile: await serializeProfile(profile, req.user, await ruleMap(), req.user) });
  }),
);

// From the Rule Library: the employee asks for one rule in one step. It is added to their profile
// and sent to their manager straight away, as if they had added it on their profile page and then
// sent it for agreement. Agreed rules keep applying until the manager agrees the new one.
router.post(
  '/me/rules',
  requireRole('employee'),
  validate(ruleInput.extend({ consent: z.boolean().optional() })),
  ah(async (req, res) => {
    const rules = await ruleMap();
    const lib = rules.get(req.body.code);
    if (!lib || !lib.active) throw badRequest(`Unknown rule ${req.body.code}`);
    const params = cleanParams(lib, req.body.params);
    const profile = await getOrCreateProfile(req.org, req.user);
    if (profile.rules.some((r) => r.code === lib.code && r.status !== 'removed')) throw conflict(`"${lib.name}" is already in your Adjustment Profile`);
    if (!profile.consent?.given && req.body.consent !== true) {
      throw badRequest('Please confirm you agree to BarrierFix applying your rules to tasks sent to you', { code: 'consent_required' });
    }
    const now = new Date();
    profile.rules.push({ code: lib.code, params, note: req.body.note, status: 'proposed', addedBy: req.user._id, source: 'employee' });
    if (!profile.consent?.given) profile.consent = { given: true, givenAt: now };
    profile.status = 'proposed';
    profile.submittedAt = now;
    profile.history.push({ by: req.user._id, action: 'rule_requested', detail: lib.code });
    profile.markModified('rules');
    await profile.save();
    const waiting = profile.rules.filter((r) => r.status === 'proposed' || (r.status === 'agreed' && r.pending)).length;
    await notify(await managerOrHr(req.user), {
      kind: 'profile_submitted',
      title: `${req.user.name || req.user.email} asked you to agree "${lib.name}"`,
      body: `Requested from the Rule Library. ${waiting} rule(s) to review in their Adjustment Profile.`,
      link: `/team/${req.user._id}`,
      channels: ['email', 'slack'],
    });
    await audit(req, 'profile.rule_requested', { entity: 'Profile', entityId: profile._id, meta: { code: lib.code } });
    res.status(201).json({ profile: await serializeProfile(profile, req.user, rules, req.user), warning: medicalWarning(req.body.note) });
  }),
);

router.post(
  '/me/consent',
  validate(z.object({ given: z.boolean() })),
  ah(async (req, res) => {
    const profile = await getOrCreateProfile(req.org, req.user);
    profile.consent = req.body.given ? { given: true, givenAt: new Date() } : { ...profile.toObject().consent, given: false, withdrawnAt: new Date() };
    profile.history.push({ by: req.user._id, action: req.body.given ? 'consent_given' : 'consent_withdrawn' });
    await profile.save();
    if (!req.body.given) {
      await notify(await managerOrHr(req.user), { kind: 'profile_paused', title: `${req.user.name || req.user.email} paused their profile`, body: 'BarrierFix will not reformat their tasks until they switch it back on.', link: `/team/${req.user._id}` });
    }
    await audit(req, req.body.given ? 'profile.consent_given' : 'profile.consent_withdrawn', { entity: 'Profile', entityId: profile._id });
    res.json({ profile: await serializeProfile(profile, req.user, await ruleMap(), req.user) });
  }),
);

// Team view for managers: their direct reports' profile status.
router.get(
  '/team',
  requireRole('manager', 'hr'),
  ah(async (req, res) => {
    const filter = { orgId: req.org._id, status: { $in: ['active', 'invited'] } };
    if (!req.user.hasRole('hr') || req.query.scope !== 'all') filter.managerId = req.user._id;
    const people = await User.find(filter).sort({ name: 1 });
    const profiles = await Profile.find({ employeeId: { $in: people.map((p) => p._id) } });
    const byId = new Map(profiles.map((p) => [String(p.employeeId), p]));
    res.json({
      team: people.map((u) => {
        const p = byId.get(String(u._id));
        return {
          _id: u._id,
          name: u.name || u.email,
          email: u.email,
          jobTitle: u.jobTitle,
          status: u.status,
          slackLinked: Boolean(u.slackUserId),
          profile: p ? { status: p.status, consent: Boolean(p.consent?.given), agreed: p.rules.filter((r) => r.status === 'agreed').length, waiting: p.rules.filter((r) => r.status === 'proposed' || r.pending).length, needsRevision: p.rules.some((r) => r.needsRevision && r.status === 'agreed') } : null,
        };
      }),
    });
  }),
);

async function exportProfile(req, res, employee, profile) {
  const rules = await ruleMap();
  const data = await serializeProfile(profile, employee, rules, req.user);
  await audit(req, 'profile.exported', { entity: 'Profile', entityId: profile?._id, meta: { employeeId: employee._id, format: req.query.format || 'pdf' } });
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="adjustment-profile-${employee._id}.json"`);
    return res.json({ employee: data.employee, status: data.status, consent: data.consent, rules: data.rules.map((r) => ({ code: r.code, name: r.name, group: r.groupLabel, status: r.status, params: r.params, note: r.note, agreedAt: r.agreedAt, nextReviewAt: r.nextReviewAt })), exportedAt: new Date() });
  }
  const pdf = await buildPdf({
    title: 'Adjustment Profile',
    subtitle: `${data.employee.name} · ${req.org.name} · exported ${new Date().toLocaleDateString('en-GB')}`,
    blocks: [
      { text: 'This profile records ways of working that help. It holds no medical information.' },
      ...Object.keys(RULE_GROUP_LABELS).flatMap((group) => {
        const inGroup = data.rules.filter((r) => r.group === group);
        if (!inGroup.length) return [];
        return [{ heading: RULE_GROUP_LABELS[group] }, ...inGroup.map((r) => ({ fields: [[r.name, r.status === 'agreed' ? 'Agreed' : 'Waiting for agreement'], ['What it means', r.summary], ...(r.note ? [['Note', r.note]] : []), ...(r.agreedAt ? [['Agreed on', new Date(r.agreedAt).toLocaleDateString('en-GB')]] : []), ...(r.nextReviewAt ? [['Next review', new Date(r.nextReviewAt).toLocaleDateString('en-GB')]] : [])] }))];
      }),
      { heading: 'Who can see this profile' },
      { list: data.accessList.map((a) => `${a.name} (${a.reason})`) },
    ],
  });
  return sendPdf(res, `adjustment-profile-${employee._id}.pdf`, pdf);
}

router.get('/me/export', ah(async (req, res) => exportProfile(req, res, req.user, await Profile.findOne({ employeeId: req.user._id }))));

// CSV columns: employee_email, rule_code, params (key=value;key=value), note
router.post(
  '/import',
  requireRole('admin', 'hr'),
  validate(z.object({ csv: z.string().min(1).max(2_000_000) })),
  ah(async (req, res) => {
    const rows = parseCsv(req.body.csv, { required: ['employee_email', 'rule_code'] });
    const rules = await ruleMap();
    const summary = { added: 0, skipped: [] };
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      const employee = await User.findOne({ email: String(row.employee_email).toLowerCase(), orgId: req.org._id });
      const code = String(row.rule_code || '').toUpperCase();
      const lib = rules.get(code);
      if (!employee) summary.skipped.push({ line, reason: `No one with the email ${row.employee_email}` });
      else if (!lib) summary.skipped.push({ line, reason: `Unknown rule ${code}` });
      else {
        const params = Object.fromEntries(String(row.params || '').split(';').map((kv) => kv.split('=').map((s) => s.trim())).filter(([k, v]) => k && v !== undefined));
        let clean;
        try {
          clean = cleanParams(lib, params);
        } catch (err) {
          summary.skipped.push({ line, reason: err.message });
          continue;
        }
        const profile = await getOrCreateProfile(req.org, employee);
        if (profile.rules.some((r) => r.code === code && r.status !== 'removed')) {
          summary.skipped.push({ line, reason: `${employee.email} already has ${code}` });
          continue;
        }
        profile.rules.push({ code, params: clean, note: String(row.note || '').slice(0, 500), status: 'proposed', addedBy: req.user._id, source: 'import' });
        if (profile.status === 'agreed') profile.status = 'draft';
        profile.history.push({ by: req.user._id, action: 'imported', detail: code });
        await profile.save();
        summary.added += 1;
      }
    }
    await audit(req, 'profile.imported', { meta: summary });
    res.json(summary);
  }),
);

router.get(
  '/:employeeId',
  ah(async (req, res) => {
    const { employee, profile } = await loadEmployeeProfile(req, req.params.employeeId);
    if (String(employee._id) !== String(req.user._id)) await audit(req, 'profile.viewed', { entity: 'Profile', entityId: profile?._id, meta: { employeeId: employee._id } });
    res.json({ profile: await serializeProfile(profile, employee, await ruleMap(), req.user) });
  }),
);

router.get(
  '/:employeeId/export',
  ah(async (req, res) => {
    const { employee, profile } = await loadEmployeeProfile(req, req.params.employeeId);
    return exportProfile(req, res, employee, profile);
  }),
);

// Admin or HR switch a profile off (nothing is applied to that person's tasks) or back on.
router.patch(
  '/:employeeId/active',
  requireRole('admin', 'hr'),
  validate(z.object({ active: z.boolean() })),
  ah(async (req, res) => {
    const employee = await User.findOne({ _id: req.params.employeeId, orgId: req.org._id });
    if (!employee) throw notFound('Person not found');
    const profile = await Profile.findOne({ employeeId: employee._id, orgId: req.org._id });
    if (!profile) throw notFound('This person has no Adjustment Profile yet');
    profile.active = req.body.active;
    profile.deactivatedAt = req.body.active ? undefined : new Date();
    profile.deactivatedBy = req.body.active ? undefined : req.user._id;
    profile.history.push({ by: req.user._id, action: req.body.active ? 'activated' : 'deactivated' });
    await profile.save();
    await audit(req, req.body.active ? 'profile.activated' : 'profile.deactivated', { entity: 'Profile', entityId: profile._id, meta: { employeeId: employee._id } });
    res.json({ profile: await serializeProfile(profile, employee, await ruleMap(), req.user) });
  }),
);

router.post(
  '/:employeeId/agree',
  ah(async (req, res) => {
    const { employee, profile } = await loadEmployeeProfile(req, req.params.employeeId);
    if (!canAgree(req.user, employee)) throw forbidden('Only the line manager or HR can agree this profile');
    if (!profile || profile.status !== 'proposed') throw badRequest('There is nothing waiting for agreement');
    const rules = await ruleMap();
    const agreed = await agreeProfile({ org: req.org, profile, employee, agreedBy: req.user, rules });
    await notify(employee._id, {
      kind: 'profile_agreed',
      title: 'Your Adjustment Profile was agreed',
      body: `${req.user.name || 'Your manager'} agreed: ${agreed.map((r) => rules.get(r.code)?.name || r.code).join(', ')}. BarrierFix now applies it to your tasks.`,
      link: '/profile',
      channels: ['email', 'slack'],
    });
    await audit(req, 'profile.agreed', { entity: 'Profile', entityId: profile._id, meta: { rules: agreed.map((r) => r.code) } });
    res.json({ profile: await serializeProfile(profile, employee, rules, req.user) });
  }),
);

router.post(
  '/:employeeId/request-changes',
  validate(z.object({ comment: z.string().trim().min(3).max(1000) })),
  ah(async (req, res) => {
    const { employee, profile } = await loadEmployeeProfile(req, req.params.employeeId);
    if (!canAgree(req.user, employee)) throw forbidden('Only the line manager or HR can respond to this profile');
    if (!profile || profile.status !== 'proposed') throw badRequest('There is nothing waiting for agreement');
    profile.status = 'changes_requested';
    profile.managerComment = req.body.comment;
    profile.history.push({ by: req.user._id, action: 'changes_requested', detail: req.body.comment });
    await profile.save();
    await notify(employee._id, { kind: 'profile_changes_requested', title: 'Your manager would like to talk about your profile', body: req.body.comment, link: '/profile', channels: ['email'] });
    await audit(req, 'profile.changes_requested', { entity: 'Profile', entityId: profile._id });
    res.json({ profile: await serializeProfile(profile, employee, await ruleMap(), req.user) });
  }),
);

export default router;
