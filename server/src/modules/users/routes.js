import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../config/constants.js';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { Profile, User } from '../../models/index.js';
import { disconnectUser } from '../../realtime/socket.js';
import { audit } from '../../services/audit.js';
import { parseCsv } from '../../utils/csv.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../../utils/http.js';
import { createAccount, endEmployment, ensureManagerRole, eraseLeaver, parseRoles, resetTemporaryPassword } from './service.js';

const router = Router();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

// Personal details and display preferences (any signed-in user).
router.patch(
  '/me',
  validate(
    z.object({
      name: z.string().trim().max(120).optional(),
      jobTitle: z.string().trim().max(120).optional(),
      preferences: z
        .object({
          textScale: z.number().min(0.85).max(1.6).optional(),
          contrast: z.enum(['normal', 'high']).optional(),
          font: z.enum(['default', 'readable']).optional(),
          reduceMotion: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
  ah(async (req, res) => {
    const { name, jobTitle, preferences } = req.body;
    if (name !== undefined) req.user.name = name;
    if (jobTitle !== undefined) req.user.jobTitle = jobTitle;
    if (preferences) req.user.preferences = { ...req.user.toObject().preferences, ...preferences };
    await req.user.save();
    res.json({ user: req.user.toSafeJSON() });
  }),
);

router.use(requireOrg);

// Light list of colleagues for pickers (assigning managers, meeting attendees).
router.get(
  '/directory',
  ah(async (req, res) => {
    const users = await User.find({ orgId: req.org._id, status: { $in: ['active', 'invited'] } })
      .select('name email roles managerId jobTitle slackUserId status')
      .sort({ name: 1 });
    // People who give work need to know whether BarrierFix has an agreed format to apply.
    const givesWork = req.user.hasRole('manager', 'hr', 'admin');
    const ready = givesWork
      ? new Set((await Profile.find({ orgId: req.org._id, active: { $ne: false }, 'consent.given': true, 'rules.status': 'agreed' }).select('employeeId')).map((p) => String(p.employeeId)))
      : new Set();
    res.json({
      users: users.map((u) => ({
        _id: u._id,
        name: u.name || u.email,
        email: u.email,
        roles: u.roles,
        managerId: u.managerId,
        jobTitle: u.jobTitle,
        status: u.status,
        slackLinked: Boolean(u.slackUserId),
        ...(givesWork ? { formatReady: ready.has(String(u._id)) } : {}),
      })),
    });
  }),
);

router.get(
  '/',
  requireRole('admin', 'hr', 'manager'),
  ah(async (req, res) => {
    const filter = { orgId: req.org._id };
    if (!req.user.hasRole('admin', 'hr')) filter.$or = [{ managerId: req.user._id }, { _id: req.user._id }];
    const users = await User.find(filter).sort({ status: 1, name: 1 });
    const profiles = await Profile.find({ orgId: req.org._id, employeeId: { $in: users.map((u) => u._id) } }).select('employeeId status consent rules');
    const byEmployee = new Map(profiles.map((p) => [String(p.employeeId), p]));
    res.json({
      users: users.map((u) => {
        const p = byEmployee.get(String(u._id));
        return { ...u.toSafeJSON(), profile: p ? { status: p.status, active: p.active !== false, consent: p.consent?.given, agreedRules: p.rules.filter((r) => r.status === 'agreed').length } : null };
      }),
    });
  }),
);

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional().default(''),
  jobTitle: z.string().trim().max(120).optional().default(''),
  roles: z.array(z.enum(ROLES)).min(1).optional().default(['employee']),
  managerId: objectId.nullable().optional(),
  slackUserId: z.string().trim().max(40).optional(),
  emailDetails: z.boolean().optional().default(false),
});

// Who creates which accounts: a company admin creates anyone (managers, HR, employees, other admins);
// a manager creates employee accounts, always in their own team; HR does not create accounts.
const ONLY_EMPLOYEES = 'Managers can create employee accounts only. Ask your company admin to add managers or HR.';
const onlyEmployees = (roles) => roles.every((r) => r === 'employee');

// The response carries the temporary password once.
router.post(
  '/',
  requireRole('admin', 'manager'),
  validate(createSchema),
  ah(async (req, res) => {
    const { email, name, jobTitle, slackUserId, emailDetails } = req.body;
    let { roles, managerId } = req.body;
    if (!req.user.hasRole('admin')) {
      if (!onlyEmployees(roles)) throw forbidden(ONLY_EMPLOYEES);
      roles = ['employee'];
      managerId = req.user._id;
    }
    const existing = await User.findOne({ email });
    if (existing) throw conflict(existing.orgId?.equals(req.org._id) ? 'This person is already in your company' : 'This email address is already used by another BarrierFix account');
    if (managerId && !(await User.exists({ _id: managerId, orgId: req.org._id }))) throw badRequest('Manager not found');
    const { user, temporaryPassword } = await createAccount({ org: req.org, creator: req.user, email, name, jobTitle, roles, managerId: managerId || null, slackUserId: slackUserId || null, emailDetails });
    await ensureManagerRole(managerId, req.org._id);
    await audit(req, 'user.created', { entity: 'User', entityId: user._id, meta: { email, roles } });
    res.status(201).json({ user: user.toSafeJSON(), temporaryPassword });
  }),
);

// CSV columns: name, email, roles, manager_email, job_title, slack_user_id
router.post(
  '/import',
  requireRole('admin', 'manager'),
  validate(z.object({ csv: z.string().min(1).max(2_000_000), emailDetails: z.boolean().optional().default(false) })),
  ah(async (req, res) => {
    const rows = parseCsv(req.body.csv, { required: ['email'] });
    const isAdmin = req.user.hasRole('admin');
    const summary = { created: 0, updated: 0, skipped: [], accounts: [] };
    const touched = [];
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      const email = String(row.email || '').trim().toLowerCase();
      if (!z.string().email().safeParse(email).success) {
        summary.skipped.push({ line, email, reason: 'Not a valid email address' });
        continue;
      }
      const roles = parseRoles(row.roles || row.role);
      if (!isAdmin && !onlyEmployees(roles)) {
        summary.skipped.push({ line, email, reason: ONLY_EMPLOYEES });
        continue;
      }
      let user = await User.findOne({ email });
      if (user && !user.orgId?.equals(req.org._id)) {
        summary.skipped.push({ line, email, reason: 'Email already used by another company' });
        continue;
      }
      // Only an admin can change existing people from a file; a manager's file only adds new employees.
      if (user && !isAdmin) {
        summary.skipped.push({ line, email, reason: 'This person already has an account' });
        continue;
      }
      if (user) {
        if (row.name) user.name = row.name;
        if (row.job_title) user.jobTitle = row.job_title;
        if (row.roles || row.role) user.roles = [...new Set([...user.roles, ...roles])];
        if (row.slack_user_id) user.slackUserId = row.slack_user_id;
        await user.save();
        summary.updated += 1;
      } else {
        let account;
        try {
          account = await createAccount({ org: req.org, creator: req.user, email, name: row.name || '', jobTitle: row.job_title || '', roles, managerId: isAdmin ? null : req.user._id, slackUserId: row.slack_user_id || null, emailDetails: req.body.emailDetails });
        } catch (err) {
          summary.skipped.push({ line, email, reason: `Account could not be created (${err.message})` });
          continue;
        }
        user = account.user;
        summary.created += 1;
        summary.accounts.push({ email, name: user.name, temporaryPassword: account.temporaryPassword });
      }
      // A manager's employees always join that manager's team, so manager_email is ignored for them.
      touched.push({ user, managerEmail: isAdmin ? String(row.manager_email || '').trim().toLowerCase() : '', line });
    }
    // Second pass so managers listed later in the file are found.
    for (const { user, managerEmail, line } of touched) {
      if (!managerEmail) continue;
      const manager = await User.findOne({ email: managerEmail, orgId: req.org._id });
      if (!manager) {
        summary.skipped.push({ line, email: user.email, reason: `Manager ${managerEmail} not found (person was still added)` });
        continue;
      }
      user.managerId = manager._id;
      await user.save();
      await ensureManagerRole(manager._id, req.org._id);
    }
    await audit(req, 'user.imported', { meta: { created: summary.created, updated: summary.updated, skipped: summary.skipped.length } });
    res.json(summary);
  }),
);

router.patch(
  '/:id',
  requireRole('admin', 'hr'),
  validate(
    z.object({
      name: z.string().trim().max(120).optional(),
      jobTitle: z.string().trim().max(120).optional(),
      roles: z.array(z.enum(ROLES)).min(1).optional(),
      managerId: objectId.nullable().optional(),
      slackUserId: z.string().trim().max(40).nullable().optional(),
      status: z.enum(['active', 'disabled']).optional(),
    }),
  ),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, orgId: req.org._id });
    if (!user) throw notFound('Person not found');
    const { roles, managerId, status, ...rest } = req.body;
    if ((roles || status) && !req.user.hasRole('admin')) throw forbidden('Only a company admin can change roles or deactivate accounts');
    if (roles) {
      const losingAdmin = user.roles.includes('admin') && !roles.includes('admin');
      if (losingAdmin && (await User.countDocuments({ orgId: req.org._id, roles: 'admin', status: 'active' })) <= 1) throw badRequest('Your company needs at least one admin');
      user.roles = roles;
    }
    if (managerId !== undefined) {
      if (managerId && String(managerId) === String(user._id)) throw badRequest('Someone cannot be their own manager');
      if (managerId && !(await User.exists({ _id: managerId, orgId: req.org._id }))) throw badRequest('Manager not found');
      user.managerId = managerId;
      await ensureManagerRole(managerId, req.org._id);
    }
    if (status && user.status !== 'left') user.status = status;
    Object.assign(user, rest);
    await user.save();
    if (user.status !== 'active') disconnectUser(user._id);
    await audit(req, 'user.updated', { entity: 'User', entityId: user._id, meta: { email: user.email, ...req.body } });
    res.json({ user: user.toSafeJSON() });
  }),
);

// Forgotten or lost login details: issue a new temporary password, which must be changed at next login.
router.post(
  '/:id/reset-password',
  requireRole('admin', 'manager'),
  validate(z.object({ emailDetails: z.boolean().optional().default(false) })),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, orgId: req.org._id });
    if (!user) throw notFound('Person not found');
    if (user.status !== 'active') throw badRequest('Only active accounts can be reset');
    // Whoever resets a password sees the temporary one. A company admin can reset anyone; a manager only
    // the employees in their own team, so nobody can take over a colleague's or a senior account.
    if (!req.user.hasRole('admin') && !(user.managerId?.equals(req.user._id) && onlyEmployees(user.roles))) {
      throw forbidden('You can reset passwords only for the employees in your own team. Ask your company admin for anyone else.');
    }
    const temporaryPassword = await resetTemporaryPassword({ user, org: req.org, creator: req.user, emailDetails: req.body.emailDetails });
    await audit(req, 'user.password_reset', { entity: 'User', entityId: user._id, meta: { email: user.email } });
    res.json({ ok: true, temporaryPassword });
  }),
);

// Erases a leaver's data now rather than when the retention period ends (MVP-034).
router.post(
  '/:id/erase',
  requireRole('admin', 'hr'),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, orgId: req.org._id });
    if (!user) throw notFound('Person not found');
    if (user.erasedAt) throw badRequest("This person's data has already been erased");
    if (user.status !== 'left') throw badRequest('Record that the person has left the company first. Only the data of people who have left can be erased.');
    res.json({ ok: true, erased: await eraseLeaver(user, req) });
  }),
);

router.post(
  '/:id/end-employment',
  requireRole('admin', 'hr'),
  validate(z.object({ endedAt: z.coerce.date().optional() })),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, orgId: req.org._id });
    if (!user) throw notFound('Person not found');
    if (String(user._id) === String(req.user._id)) throw badRequest('You cannot end your own employment here');
    const result = await endEmployment(user, req, req.body.endedAt || new Date());
    res.json({ ok: true, ...result });
  }),
);

export default router;
