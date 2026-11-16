import { Router } from 'express';
import { z } from 'zod';
import { REVIEW_QUESTIONS } from '../../content/reviewQuestions.js';
import { requireOrg } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { Review, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { ah, forbidden, notFound } from '../../utils/http.js';
import { medicalWarning } from '../../utils/medicalGuard.js';
import { answerReview } from './service.js';

const router = Router();
router.use(requireOrg);

router.get('/questions', (req, res) => res.json({ questions: REVIEW_QUESTIONS }));

router.get(
  '/',
  ah(async (req, res) => {
    const me = req.user._id;
    const open = await Review.find({
      orgId: req.org._id,
      status: 'open',
      $or: [
        { employeeId: me, 'employee.answeredAt': { $exists: false } },
        { managerId: me, 'manager.answeredAt': { $exists: false } },
      ],
    }).sort({ dueAt: 1 });
    // Coming up: reviews of my own profile, and of the team profiles I agreed (I answer the manager part).
    const upcoming = await Review.find({ orgId: req.org._id, $or: [{ employeeId: me }, { managerId: me }], status: 'scheduled' }).sort({ dueAt: 1 }).limit(20);
    const recent = await Review.find({ orgId: req.org._id, $or: [{ employeeId: me }, { managerId: me }], status: 'completed' }).sort({ updatedAt: -1 }).limit(20);
    const people = await User.find({ _id: { $in: [...open, ...upcoming, ...recent].map((r) => r.employeeId) } }).select('name email');
    const names = new Map(people.map((p) => [String(p._id), p.name || p.email]));
    const shape = (r) => ({ ...r.toObject(), employeeName: names.get(String(r.employeeId)), myPart: String(r.employeeId) === String(me) ? 'employee' : 'manager' });
    res.json({ open: open.map(shape), upcoming: upcoming.map(shape), recent: recent.map(shape), questions: REVIEW_QUESTIONS });
  }),
);

router.post(
  '/:id/answer',
  validate(
    z.object({
      employee: z.object({ helping: z.enum(['yes', 'partly', 'no']), next: z.enum(['keep', 'change', 'stop']), comment: z.string().trim().max(1000).optional().default('') }).optional(),
      manager: z.object({ practical: z.enum(['yes', 'with_difficulty', 'no']), comment: z.string().trim().max(1000).optional().default('') }).optional(),
    }),
  ),
  ah(async (req, res) => {
    const review = await Review.findOne({ _id: req.params.id, orgId: req.org._id });
    if (!review) throw notFound('Review not found');
    const isEmployee = review.employeeId.equals(req.user._id);
    const isManager = review.managerId?.equals(req.user._id);
    if (!isEmployee && !isManager) throw forbidden('This review is not yours to answer');
    if (review.status !== 'open') throw forbidden('This review is not open');
    await answerReview(review, req.user, req.body);
    await audit(req, 'review.answered', { entity: 'Review', entityId: review._id, meta: { part: isEmployee ? 'employee' : 'manager' } });
    res.json({ review, warning: medicalWarning(req.body.employee?.comment, req.body.manager?.comment) });
  }),
);

export default router;
