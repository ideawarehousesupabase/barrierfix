import { config } from '../../config/env.js';
import { ROLES } from '../../config/constants.js';
import { emails } from '../../content/emailTemplates.js';
import { sendEmail } from '../../integrations/email.js';
import { deleteFirebaseUser, disableFirebaseUser, upsertPasswordUser } from '../../integrations/firebase.js';
import { Brief, BriefMetric, DecisionRecord, DecisionRecordVersion, Meeting, Notification, Profile, Review, ScheduledPrompt, User } from '../../models/index.js';
import { disconnectUser } from '../../realtime/socket.js';
import { audit } from '../../services/audit.js';
import { generateTemporaryPassword } from '../../utils/crypto.js';

export function parseRoles(value) {
  const aliases = { hr: 'hr', 'hr / operations': 'hr', operations: 'hr', admin: 'admin', 'company admin': 'admin', manager: 'manager', 'line manager': 'manager', employee: 'employee', staff: 'employee' };
  const raw = Array.isArray(value) ? value : String(value || '').split(/[;|,/]+/);
  const roles = raw.map((r) => aliases[String(r).trim().toLowerCase()]).filter(Boolean);
  return [...new Set(roles.length ? roles : ['employee'])].filter((r) => ROLES.includes(r));
}

async function emailLoginDetails({ user, creator, org, temporaryPassword }) {
  await sendEmail({
    to: user.email,
    ...emails.account({ orgName: org.name, creatorName: creator?.name || creator?.email || org.name, name: user.name, email: user.email, temporaryPassword, link: `${config.appUrl}/login` }),
  });
}

// Accounts are only ever created by an admin (or the platform admin). The Firebase account is
// made with a temporary password, which the person must replace at first login. The password is
// returned once to the caller and never stored.
export async function createAccount({ org, creator, email, name = '', jobTitle = '', roles = ['employee'], managerId = null, slackUserId = null, emailDetails = false }) {
  const temporaryPassword = generateTemporaryPassword();
  const fbUser = await upsertPasswordUser({ email, password: temporaryPassword, displayName: name });
  const user = await User.create({
    orgId: org._id,
    email,
    name,
    jobTitle,
    roles,
    managerId,
    slackUserId,
    firebaseUid: fbUser.uid,
    status: 'active',
    mustChangePassword: true,
    temporaryPasswordSetAt: new Date(),
    createdBy: creator?._id,
  });
  if (emailDetails) await emailLoginDetails({ user, creator, org, temporaryPassword });
  return { user, temporaryPassword };
}

// A forgotten or lost temporary password: issue a new one and force another change.
export async function resetTemporaryPassword({ user, org, creator, emailDetails = false }) {
  const temporaryPassword = generateTemporaryPassword();
  const fbUser = await upsertPasswordUser({ email: user.email, password: temporaryPassword, displayName: user.name });
  user.firebaseUid = fbUser.uid;
  user.mustChangePassword = true;
  user.temporaryPasswordSetAt = new Date();
  await user.save();
  if (emailDetails) await emailLoginDetails({ user, creator, org, temporaryPassword });
  return temporaryPassword;
}

// Someone assigned as a manager gets the manager role automatically.
export async function ensureManagerRole(managerId, orgId) {
  if (!managerId) return;
  await User.updateOne({ _id: managerId, orgId, roles: { $ne: 'manager' } }, { $addToSet: { roles: 'manager' } });
}

// Leaving the company: deactivate the account, stop prompts and reviews, and start
// the retention clock (employment end + 18 months) for profiles and decisions.
export async function endEmployment(user, actor, endedAt = new Date()) {
  const retainUntil = new Date(endedAt);
  retainUntil.setMonth(retainUntil.getMonth() + config.retention.recordMonthsAfterEmployment);
  user.status = 'left';
  user.employmentEndedAt = endedAt;
  await user.save();
  await Profile.updateOne({ employeeId: user._id }, { $set: { retainUntil } });
  await DecisionRecord.updateMany({ employeeId: user._id }, { $set: { retainUntil } });
  // The append-only version history goes with the record: it is purged by the same retention sweep.
  await DecisionRecordVersion.collection.updateMany({ recordId: { $in: (await DecisionRecord.find({ employeeId: user._id }).select('_id')).map((r) => r._id) } }, { $set: { retainUntil } });
  await Review.updateMany({ employeeId: user._id, status: { $in: ['scheduled', 'open'] } }, { $set: { status: 'cancelled' } });
  await ScheduledPrompt.updateMany({ recipientIds: user._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  await User.updateMany({ managerId: user._id }, { $set: { managerId: null } });
  await disableFirebaseUser(user.firebaseUid, true);
  disconnectUser(user._id);
  await audit(actor, 'user.employment_ended', { entity: 'User', entityId: user._id, meta: { email: user.email, retainUntil } });
  return { retainUntil };
}

// Erases a leaver's data now, instead of when the retention period ends (MVP-034): their profile,
// adjustment requests with their history, reviews, tasks, task metrics and notifications. The account
// stays only as an anonymous placeholder so other people's records still make sense. The audit log is
// kept (it is append-only and has its own 7-year retention) and records the erasure without personal details.
export async function eraseLeaver(user, actor) {
  const id = user._id;
  const recordIds = (await DecisionRecord.find({ employeeId: id }).select('_id')).map((r) => r._id);
  const [profiles, decisions, reviews, tasks, metrics, notifications] = await Promise.all([
    Profile.deleteMany({ employeeId: id }),
    DecisionRecord.deleteMany({ employeeId: id }),
    Review.deleteMany({ employeeId: id }),
    Brief.deleteMany({ employeeId: id }),
    BriefMetric.deleteMany({ employeeId: id }),
    Notification.deleteMany({ userId: id }),
  ]);
  // The version history is append-only through Mongoose, so it is removed through the raw collection.
  if (recordIds.length) await DecisionRecordVersion.collection.deleteMany({ recordId: { $in: recordIds } });
  await ScheduledPrompt.deleteMany({ recipientIds: { $all: [id], $size: 1 } });
  await ScheduledPrompt.updateMany({ recipientIds: id }, { $pull: { recipientIds: id } });
  await Meeting.updateMany({ attendeeIds: id }, { $pull: { attendeeIds: id } });
  await deleteFirebaseUser(user.firebaseUid);
  user.set({ name: 'Erased person', email: `erased-${id}@erased.invalid`, jobTitle: '', slackUserId: null, managerId: null, firebaseUid: undefined, erasedAt: new Date() });
  await user.save();
  const counts = { profiles: profiles.deletedCount, decisions: decisions.deletedCount, reviews: reviews.deletedCount, tasks: tasks.deletedCount, metrics: metrics.deletedCount, notifications: notifications.deletedCount };
  await audit(actor, 'user.erased', { entity: 'User', entityId: id, meta: counts });
  return counts;
}
