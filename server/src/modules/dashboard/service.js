import { hasFeature } from '../../config/plans.js';
import { Brief, BriefMetric, DecisionRecord, Profile, Review, User } from '../../models/index.js';
import { OPEN_REQUEST_STATUSES } from '../../models/DecisionRecord.js';

// Adjustment requests waiting for this person: to answer, or to fill in the six questions.
const waitingFor = (userId) => DecisionRecord.countDocuments({ recipientId: userId, status: { $in: ['pending', 'answering'] } });

const DAY = 86400 * 1000;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// Plan KPIs from text-free metrics: meaning preserved (validator pass), rated accurate
// (confirmed vs flagged), flags, questions and processing time.
export async function briefKpis(match) {
  const since = new Date(Date.now() - 30 * DAY);
  const [row] = await BriefMetric.aggregate([
    { $match: { ...match, createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        passed: { $sum: { $cond: ['$validatorPassed', 1, 0] } },
        held: { $sum: { $cond: ['$held', 1, 0] } },
        confirmed: { $sum: { $cond: ['$confirmed', 1, 0] } },
        flagged: { $sum: { $cond: ['$flagged', 1, 0] } },
        questioned: { $sum: { $cond: ['$questioned', 1, 0] } },
        breakdowns: { $sum: { $cond: ['$breakdownRequested', 1, 0] } },
        avgMs: { $avg: '$processingMs' },
        maxMs: { $max: '$processingMs' },
      },
    },
  ]);
  const r = row || { total: 0, passed: 0, held: 0, confirmed: 0, flagged: 0, questioned: 0, breakdowns: 0, avgMs: null, maxMs: null };
  return {
    periodDays: 30,
    tasksTranslated: r.total,
    meaningPreservedPct: pct(r.passed, r.total),
    held: r.held,
    ratedAccuratePct: pct(r.confirmed, r.confirmed + r.flagged),
    flaggedPct: pct(r.flagged, r.total),
    questions: r.questioned,
    breakdowns: r.breakdowns,
    avgProcessingMs: r.avgMs === null ? null : Math.round(r.avgMs),
    maxProcessingMs: r.maxMs,
  };
}

// "Which rules employees rate as working", from completed employee review answers.
export async function ruleEffectiveness(match) {
  const rows = await Review.aggregate([
    { $match: { ...match, 'employee.answeredAt': { $exists: true } } },
    {
      $group: {
        _id: { code: '$ruleCode', name: '$ruleName' },
        answers: { $sum: 1 },
        yes: { $sum: { $cond: [{ $eq: ['$employee.helping', 'yes'] }, 1, 0] } },
        partly: { $sum: { $cond: [{ $eq: ['$employee.helping', 'partly'] }, 1, 0] } },
        no: { $sum: { $cond: [{ $eq: ['$employee.helping', 'no'] }, 1, 0] } },
      },
    },
    { $sort: { answers: -1 } },
  ]);
  return rows.map((r) => ({ code: r._id.code, name: r._id.name, answers: r.answers, yes: r.yes, partly: r.partly, no: r.no, workingPct: pct(r.yes + r.partly * 0.5, r.answers) }));
}

export async function employeeDashboard(user) {
  const [newTasks, openTasks, profile, openReviews, decisions, requestsToAnswer] = await Promise.all([
    Brief.countDocuments({ employeeId: user._id, employeeStatus: 'new', status: { $in: ['delivered', 'approved', 'held', 'original_sent'] } }),
    Brief.countDocuments({ employeeId: user._id, employeeStatus: { $in: ['new', 'seen', 'question'] }, status: { $in: ['delivered', 'approved', 'held', 'original_sent'] } }),
    Profile.findOne({ employeeId: user._id }),
    Review.countDocuments({ employeeId: user._id, status: 'open', 'employee.answeredAt': { $exists: false } }),
    DecisionRecord.countDocuments({ $or: [{ requesterId: user._id }, { recipientId: user._id }], status: { $in: OPEN_REQUEST_STATUSES } }),
    waitingFor(user._id),
  ]);
  return {
    newTasks,
    openTasks,
    openReviews,
    openDecisions: decisions,
    requestsToAnswer,
    profile: profile
      ? { status: profile.status, consent: Boolean(profile.consent?.given), agreed: profile.rules.filter((r) => r.status === 'agreed').length, waiting: profile.rules.filter((r) => r.status === 'proposed' || r.pending).length, needsRevision: profile.rules.some((r) => r.status === 'agreed' && r.needsRevision) }
      : null,
  };
}

// The manager's home page figures (client feedback, Nov 2026), for this manager's own team only.
// "Pending" figures are what is waiting today; the others count the last 30 days.
async function managerAnalytics(user, profiles, unansweredQuestions) {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const soon = new Date(now.getTime() + 30 * DAY);
  const pair = { managerId: user._id };
  const sentRules = profiles.filter((p) => p.status === 'proposed').flatMap((p) => p.rules.filter((r) => r.status === 'proposed' || (r.status === 'agreed' && r.pending)));
  const rulesAgreed = profiles.flatMap((p) => p.rules.filter((r) => r.status === 'agreed' && r.agreedAt && r.agreedAt >= since));
  const [requestsPending, requestsAgreed, requestsDeclined, requestsWithHr, tasks, flagged, reviewsPending, reviewsCompleted, reviewsUpcoming] = await Promise.all([
    DecisionRecord.countDocuments({ ...pair, status: 'pending' }),
    DecisionRecord.countDocuments({ ...pair, status: { $in: ['accepted', 'overturned'] }, updatedAt: { $gte: since } }),
    DecisionRecord.countDocuments({ ...pair, status: 'rejected', updatedAt: { $gte: since } }),
    DecisionRecord.countDocuments({ ...pair, status: { $in: ['hr_review', 'answering', 'hr_final'] } }),
    BriefMetric.countDocuments({ managerId: user._id, createdAt: { $gte: since } }),
    Brief.countDocuments({ managerId: user._id, employeeStatus: 'flagged', status: { $nin: ['cancelled', 'superseded', 'draft'] } }),
    Review.countDocuments({ managerId: user._id, status: 'open' }),
    Review.countDocuments({ managerId: user._id, status: 'completed', updatedAt: { $gte: since } }),
    Review.countDocuments({ managerId: user._id, status: 'scheduled', dueAt: { $gte: now, $lte: soon } }),
  ]);
  return {
    periodDays: 30,
    decisions: { pending: sentRules.length + requestsPending, agreed: rulesAgreed.length + requestsAgreed, declined: requestsDeclined, pendingHr: requestsWithHr },
    tasks: { delivered: tasks, questionsPending: unansweredQuestions, flaggedPending: flagged },
    reviews: { pending: reviewsPending, completed: reviewsCompleted, upcoming: reviewsUpcoming },
  };
}

export async function managerDashboard(user, org) {
  const team = await User.find({ orgId: org._id, managerId: user._id, status: { $in: ['active', 'invited'] } }).sort({ name: 1 });
  const teamIds = team.map((t) => t._id);
  const since = new Date(Date.now() - 30 * DAY);
  const [profiles, perPerson, held, decisions, reviews, waitingProfiles] = await Promise.all([
    Profile.find({ employeeId: { $in: teamIds } }),
    BriefMetric.aggregate([{ $match: { managerId: user._id, createdAt: { $gte: since } } }, { $group: { _id: '$employeeId', tasks: { $sum: 1 } } }]),
    Brief.countDocuments({ managerId: user._id, status: 'held' }),
    waitingFor(user._id),
    Review.countDocuments({ managerId: user._id, status: 'open', 'manager.answeredAt': { $exists: false } }),
    Profile.countDocuments({ employeeId: { $in: teamIds }, status: 'proposed' }),
  ]);
  const openQuestions = await Brief.find({ managerId: user._id, employeeStatus: 'question' }).select('thread');
  const unanswered = openQuestions.filter((b) => b.thread.filter((t) => t.kind === 'question').length > b.thread.filter((t) => t.kind === 'answer').length).length;
  const byProfile = new Map(profiles.map((p) => [String(p.employeeId), p]));
  const tasksBy = new Map(perPerson.map((p) => [String(p._id), p.tasks]));
  const detailed = hasFeature(org, 'managerReports');
  return {
    detailed,
    team: team.map((t) => {
      const p = byProfile.get(String(t._id));
      return {
        _id: t._id,
        name: t.name || t.email,
        status: t.status,
        slackLinked: Boolean(t.slackUserId),
        profileStatus: p?.status || 'none',
        consent: Boolean(p?.consent?.given),
        agreedRules: p ? p.rules.filter((r) => r.status === 'agreed').length : 0,
        tasksTranslated30d: tasksBy.get(String(t._id)) || 0,
      };
    }),
    toDo: { heldTranslations: held, unansweredQuestions: unanswered, decisionsToMake: decisions, reviewsToAnswer: reviews, profilesToAgree: waitingProfiles },
    kpis: detailed ? await briefKpis({ managerId: user._id }) : null,
    rules: detailed ? await ruleEffectiveness({ managerId: user._id }) : null,
    analytics: detailed ? await managerAnalytics(user, profiles, unanswered) : null,
  };
}

export async function hrDashboard(org) {
  const orgId = org._id;
  const now = new Date();
  const [people, profilesAgreed, profilesWaiting, openDecisions, waitingForHr, openReviews, overdueReviews, openedReviews, answeredReviews, closed] = await Promise.all([
    User.countDocuments({ orgId, status: { $in: ['active', 'invited'] } }),
    Profile.countDocuments({ orgId, status: 'agreed', 'consent.given': true }),
    Profile.countDocuments({ orgId, status: 'proposed' }),
    DecisionRecord.countDocuments({ orgId, status: { $in: OPEN_REQUEST_STATUSES } }),
    DecisionRecord.countDocuments({ orgId, status: { $in: ['hr_review', 'hr_final'] } }),
    Review.countDocuments({ orgId, status: 'open' }),
    Review.countDocuments({ orgId, status: 'open', dueAt: { $lt: new Date(now.getTime() - 7 * DAY) } }),
    Review.countDocuments({ orgId, status: { $in: ['open', 'completed'] } }),
    Review.countDocuments({ orgId, 'employee.answeredAt': { $exists: true } }),
    DecisionRecord.aggregate([{ $match: { orgId, status: { $in: ['accepted', 'rejected', 'overturned'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const outcomes = Object.fromEntries(closed.map((c) => [c._id, c.n]));
  const analytics = hasFeature(org, 'firmAnalytics');
  return {
    analytics,
    people,
    profiles: { agreed: profilesAgreed, waitingForAgreement: profilesWaiting },
    decisions: { open: openDecisions, waitingForHr, accepted: (outcomes.accepted || 0) + (outcomes.overturned || 0), rejected: outcomes.rejected || 0, outcomes },
    reviews: { open: openReviews, overdue: overdueReviews, responseRatePct: pct(answeredReviews, openedReviews) },
    kpis: await briefKpis({ orgId }),
    rules: analytics ? await ruleEffectiveness({ orgId }) : null,
  };
}
