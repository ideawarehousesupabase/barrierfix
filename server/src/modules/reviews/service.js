import { DateTime } from 'luxon';
import { config } from '../../config/env.js';
import { REVIEW_STAGES_WEEKS } from '../../config/constants.js';
import { Profile, Review, User } from '../../models/index.js';
import { calendarForOrg } from '../../services/calendar.js';
import { notify } from '../../services/notify.js';

// Creates the 2, 6 and 12-week reviews for a newly agreed rule.
export async function scheduleReviews({ org, profile, employee, rule, from = new Date() }) {
  const { cal } = await calendarForOrg(org);
  const start = DateTime.fromJSDate(new Date(from), { zone: cal.timezone });
  const docs = REVIEW_STAGES_WEEKS.map((weeks) => {
    const due = cal.clampToWorkingTime(start.plus({ weeks }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }));
    return {
      orgId: org._id,
      profileId: profile._id,
      employeeId: employee._id,
      managerId: employee.managerId || null,
      ruleCode: rule.code,
      ruleName: rule.name,
      stageWeeks: weeks,
      dueAt: due.toJSDate(),
      expiresAt: due.plus({ months: config.retention.reviewMonths }).toJSDate(),
    };
  });
  await Review.insertMany(docs);
  return docs[0].dueAt;
}

export async function cancelReviews(profileId, code) {
  await Review.updateMany({ profileId, ruleCode: code, status: { $in: ['scheduled', 'open'] } }, { $set: { status: 'cancelled' } });
}

// Job: opens reviews that have reached their due date and tells both people.
export async function activateDueReviews(now = new Date()) {
  let opened = 0;
  for (;;) {
    const review = await Review.findOneAndUpdate({ status: 'scheduled', dueAt: { $lte: now } }, { $set: { status: 'open', openedAt: now } }, { new: true });
    if (!review) break;
    opened += 1;
    const employee = await User.findById(review.employeeId);
    const title = `${review.stageWeeks}-week review: ${review.ruleName}`;
    await notify(review.employeeId, { kind: 'review_due', title, body: 'Two quick questions about whether this adjustment is working for you.', link: '/reviews', channels: ['email', 'slack'] });
    if (review.managerId) {
      await notify(review.managerId, { kind: 'review_due', title: `${title} (${employee?.name || 'team member'})`, body: 'One quick question about whether this adjustment is practical to keep applying.', link: '/reviews', channels: ['email'] });
    }
  }
  return opened;
}

// Job: one reminder for a review that has been open a few days, to whoever has not answered yet.
export async function remindUnansweredReviews(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.reviews.reminderDays * 86400 * 1000);
  const reviews = await Review.find({ status: 'open', openedAt: { $lte: cutoff }, reminderSentAt: { $exists: false } }).limit(500);
  let sent = 0;
  for (const review of reviews) {
    // Claimed first, so two servers running the job never remind twice.
    const claimed = await Review.updateOne({ _id: review._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } });
    if (!claimed.modifiedCount) continue;
    const title = `Reminder: ${review.stageWeeks}-week review of ${review.ruleName}`;
    if (!review.employee?.answeredAt) {
      await notify(review.employeeId, { kind: 'review_reminder', title, body: 'Two quick questions about whether this adjustment is working for you. It takes a minute.', link: '/reviews', channels: ['email', 'slack'] });
      sent += 1;
    }
    if (review.managerId && !review.manager?.answeredAt) {
      const employee = await User.findById(review.employeeId).select('name');
      await notify(review.managerId, { kind: 'review_reminder', title: `${title} (${employee?.name || 'team member'})`, body: 'One quick question about whether this adjustment is practical to keep applying.', link: '/reviews', channels: ['email'] });
      sent += 1;
    }
  }
  return sent;
}

export async function answerReview(review, user, answers) {
  const isEmployee = review.employeeId.equals(user._id);
  const isManager = review.managerId && review.managerId.equals(user._id);
  if (isEmployee && answers.employee) {
    review.employee = { ...answers.employee, answeredAt: new Date() };
  }
  if (isManager && answers.manager) {
    review.manager = { ...answers.manager, answeredAt: new Date() };
  }
  const employeeDone = Boolean(review.employee?.answeredAt);
  const managerDone = !review.managerId || Boolean(review.manager?.answeredAt);
  if (employeeDone && managerDone) review.status = 'completed';
  await review.save();

  // "Adjustments that are not working are changed rather than forgotten."
  const e = review.employee || {};
  if (isEmployee && (e.helping === 'no' || ['change', 'stop'].includes(e.next))) {
    await Profile.updateOne({ _id: review.profileId, 'rules.code': review.ruleCode }, { $set: { 'rules.$.needsRevision': true } });
    const title = `"${review.ruleName}" may need to change`;
    const body = `In the ${review.stageWeeks}-week review the employee said this adjustment ${e.helping === 'no' ? 'is not helping' : `should ${e.next === 'stop' ? 'stop' : 'change'}`}. Please talk together and update the profile.`;
    await notify(review.employeeId, { kind: 'review_change_needed', title, body, link: '/profile' });
    if (review.managerId) await notify(review.managerId, { kind: 'review_change_needed', title, body, link: `/team/${review.employeeId}`, channels: ['email'] });
  }
  // The manager finds it hard to keep up in practice: flagged for a conversation, never removed automatically.
  if (isManager && answers.manager?.practical === 'no') {
    await Profile.updateOne({ _id: review.profileId, 'rules.code': review.ruleCode }, { $set: { 'rules.$.needsRevision': true } });
    await notify(review.employeeId, {
      kind: 'review_change_needed',
      title: `"${review.ruleName}" may need to change`,
      body: `In the ${review.stageWeeks}-week review your manager said this adjustment is hard to keep up in practice. Nothing changes yet: please talk it through together and agree what would work.`,
      link: '/profile',
    });
  }
  return review;
}
