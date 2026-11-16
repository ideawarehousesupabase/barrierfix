import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { BANK_HOLIDAY_REGIONS } from '../../config/constants.js';
import { requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { audit } from '../../services/audit.js';
import { ah, badRequest } from '../../utils/http.js';

const router = Router();
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the 24-hour format HH:MM');

// Companies are created by the platform admin (see /api/platform/orgs), never by self-registration.
router.use(requireOrg);

router.get('/current', ah(async (req, res) => res.json({ org: req.org })));

router.patch(
  '/current',
  requireRole('admin'),
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      staffCount: z.coerce.number().int().min(1).max(100000).optional(),
      sector: z.string().trim().max(80).optional(),
      settings: z
        .object({
          timezone: z.string().refine((tz) => DateTime.now().setZone(tz).isValid, 'Unknown timezone').optional(),
          workdayStart: hm.optional(),
          workdayEnd: hm.optional(),
          workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
          bankHolidayRegion: z.enum(BANK_HOLIDAY_REGIONS).optional(),
          digestEnabled: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
  ah(async (req, res) => {
    const { settings, ...rest } = req.body;
    Object.assign(req.org, rest);
    if (settings) {
      const next = { ...req.org.toObject().settings, ...settings };
      if (next.workdayStart >= next.workdayEnd) throw badRequest('The working day must end after it starts');
      req.org.settings = next;
    }
    await req.org.save();
    await audit(req, 'org.updated', { entity: 'Organization', entityId: req.org._id, meta: req.body });
    res.json({ org: req.org });
  }),
);

// The company glossary feeds the "Abbreviations explained" rule (CM3).
router.put(
  '/current/glossary',
  requireRole('admin', 'hr'),
  validate(z.object({ glossary: z.array(z.object({ term: z.string().trim().min(1).max(40), meaning: z.string().trim().min(1).max(200) })).max(300) })),
  ah(async (req, res) => {
    req.org.glossary = req.body.glossary;
    await req.org.save();
    await audit(req, 'org.glossary_updated', { entity: 'Organization', entityId: req.org._id, meta: { terms: req.body.glossary.length } });
    res.json({ glossary: req.org.glossary });
  }),
);

export default router;
