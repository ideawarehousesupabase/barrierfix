import { Profile, User } from '../../models/index.js';
import { RULE_GROUP_LABELS } from '../../config/constants.js';
import { forbidden, notFound } from '../../utils/http.js';
import { usersWithRole } from '../../services/notify.js';
import { cancelReviews, scheduleReviews } from '../reviews/service.js';

const sameId = (a, b) => Boolean(a && b && String(a) === String(b));

export async function getOrCreateProfile(org, employee) {
  let profile = await Profile.findOne({ employeeId: employee._id, orgId: org._id });
  if (!profile) profile = await Profile.create({ orgId: org._id, employeeId: employee._id });
  return profile;
}

// The rules BarrierFix applies today: agreed rules, only while consent is given and an admin has
// not switched the profile off. Pass the company so a profile is only ever read inside its own tenant.
export async function activeRulesFor(employeeId, orgId) {
  const profile = await Profile.findOne(orgId ? { employeeId, orgId } : { employeeId });
  if (!profile || !profile.consent?.given || profile.active === false) return [];
  return profile.rules.filter((r) => r.status === 'agreed').map((r) => ({ code: r.code, params: r.params || {} }));
}

export function canView(viewer, employee, profile) {
  return (
    sameId(viewer._id, employee._id) ||
    sameId(employee.managerId, viewer._id) ||
    viewer.hasRole('hr') ||
    Boolean(profile?.extraViewerIds?.some((id) => sameId(id, viewer._id)))
  );
}

export function canAgree(viewer, employee) {
  if (sameId(viewer._id, employee._id)) return false;
  return sameId(employee.managerId, viewer._id) || viewer.hasRole('hr');
}

// "The employee can see who has access to it."
export async function accessList(profile, employee) {
  const entries = [];
  if (employee.managerId) {
    const manager = await User.findById(employee.managerId).select('name email');
    if (manager) entries.push({ _id: manager._id, name: manager.name || manager.email, reason: 'Line manager' });
  }
  for (const hr of await usersWithRole(employee.orgId, 'hr')) {
    if (!sameId(hr._id, employee._id) && !entries.some((e) => sameId(e._id, hr._id))) entries.push({ _id: hr._id, name: hr.name || hr.email, reason: 'HR' });
  }
  const extra = await User.find({ _id: { $in: profile?.extraViewerIds || [] } }).select('name email');
  for (const u of extra) if (!entries.some((e) => sameId(e._id, u._id))) entries.push({ _id: u._id, name: u.name || u.email, reason: 'Added by the employee' });
  return entries;
}

export async function loadEmployeeProfile(req, employeeId) {
  const employee = await User.findOne({ _id: employeeId, orgId: req.org._id });
  if (!employee) throw notFound('Person not found');
  const profile = await Profile.findOne({ employeeId: employee._id, orgId: req.org._id });
  if (!canView(req.user, employee, profile)) throw forbidden('You do not have access to this profile');
  return { employee, profile };
}

export async function serializeProfile(profile, employee, rules, viewer) {
  const p = profile ? profile.toObject() : { status: 'draft', consent: { given: false }, rules: [], extraViewerIds: [], history: [] };
  return {
    ...p,
    employee: { _id: employee._id, name: employee.name || employee.email, email: employee.email, jobTitle: employee.jobTitle, managerId: employee.managerId },
    rules: (p.rules || [])
      .filter((r) => r.status !== 'removed')
      .map((r) => {
        const lib = rules.get(r.code);
        return {
          ...r,
          name: lib?.name || r.code,
          summary: lib?.summary || '',
          group: lib?.group,
          groupLabel: RULE_GROUP_LABELS[lib?.group] || '',
          type: lib?.type,
          paramDefs: lib?.params || [],
        };
      }),
    accessList: await accessList(profile, employee),
    canAgree: canAgree(viewer, employee),
    isOwner: sameId(viewer._id, employee._id),
  };
}

// Manager (or HR) agrees everything the employee has proposed. Newly agreed rules get
// their 2, 6 and 12-week reviews; changed rules restart theirs.
export async function agreeProfile({ org, profile, employee, agreedBy, rules }) {
  const now = new Date();
  const newlyAgreed = [];
  for (const r of profile.rules) {
    if (r.status === 'proposed') {
      r.status = 'agreed';
      r.agreedAt = now;
      r.agreedBy = agreedBy._id;
      r.needsRevision = false;
      newlyAgreed.push(r);
    } else if (r.status === 'agreed' && r.pending) {
      r.params = r.pending.params ?? r.params;
      r.note = r.pending.note ?? r.note;
      r.pending = undefined;
      r.agreedAt = now;
      r.agreedBy = agreedBy._id;
      r.needsRevision = false;
      await cancelReviews(profile._id, r.code);
      newlyAgreed.push(r);
    }
  }
  for (const r of newlyAgreed) {
    const lib = rules.get(r.code);
    r.nextReviewAt = await scheduleReviews({ org, profile, employee, rule: { code: r.code, name: lib?.name || r.code }, from: now });
  }
  profile.status = 'agreed';
  profile.agreedAt = now;
  profile.agreedBy = agreedBy._id;
  profile.managerComment = '';
  profile.history.push({ by: agreedBy._id, action: 'agreed', detail: newlyAgreed.map((r) => r.code).join(', ') });
  profile.markModified('rules');
  await profile.save();
  return newlyAgreed;
}
