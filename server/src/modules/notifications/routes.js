import { Router } from 'express';
import { Notification } from '../../models/index.js';
import { ah } from '../../utils/http.js';

const router = Router();

router.get(
  '/',
  ah(async (req, res) => {
    const items = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ userId: req.user._id, readAt: { $exists: false } });
    res.json({ notifications: items, unread });
  }),
);

router.post(
  '/read-all',
  ah(async (req, res) => {
    await Notification.updateMany({ userId: req.user._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/read',
  ah(async (req, res) => {
    await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);

export default router;
