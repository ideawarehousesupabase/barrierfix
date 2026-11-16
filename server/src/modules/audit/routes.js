import { Router } from 'express';
import { requireFeature, requireOrg, requireRole } from '../../middleware/auth.js';
import { AuditLog } from '../../models/index.js';
import { toCsv } from '../../utils/csv.js';
import { ah, sendCsv } from '../../utils/http.js';

const router = Router();
router.use(requireOrg, requireRole('admin', 'hr'));

router.get(
  '/',
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await AuditLog.find({ orgId: req.org._id }).sort({ at: -1 }).limit(limit);
    res.json({ entries });
  }),
);

router.get(
  '/export.csv',
  requireFeature('auditExport'),
  ah(async (req, res) => {
    const entries = await AuditLog.find({ orgId: req.org._id }).sort({ at: 1 });
    const columns = [
      { label: 'Time', value: 'at' },
      { label: 'Actor', value: 'actorEmail' },
      { label: 'Action', value: 'action' },
      { label: 'Entity', value: 'entity' },
      { label: 'Entity ID', value: 'entityId' },
      { label: 'Details', value: (e) => JSON.stringify(e.meta || {}) },
    ];
    sendCsv(res, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, entries));
  }),
);

export default router;
