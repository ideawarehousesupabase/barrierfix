import { Router } from 'express';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { ah } from '../../utils/http.js';
import { employeeDashboard, hrDashboard, managerDashboard } from './service.js';

const router = Router();
router.use(requireOrg);

// One call returns the panels for every role the person holds.
router.get(
  '/',
  ah(async (req, res) => {
    const out = { employee: await employeeDashboard(req.user) };
    if (req.user.hasRole('manager')) out.manager = await managerDashboard(req.user, req.org);
    if (req.user.hasRole('hr')) out.hr = await hrDashboard(req.org);
    res.json(out);
  }),
);

router.get('/hr', requireRole('hr', 'admin'), ah(async (req, res) => res.json(await hrDashboard(req.org))));

export default router;
