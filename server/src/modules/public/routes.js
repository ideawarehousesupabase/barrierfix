import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { emails } from '../../content/emailTemplates.js';
import { sendEmail } from '../../integrations/email.js';
import { validate } from '../../middleware/common.js';
import { OrgRequest, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { notify } from '../../services/notify.js';
import { ah } from '../../utils/http.js';

// Pages anyone can use without signing in.
const router = Router();

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests from this address. Please try again in an hour.' },
});

// Every request gets the same answer, so the form never reveals whether a company already uses BarrierFix.
const THANKS = { message: 'Thank you. We have received your request and will be in touch, usually within two working days.' };

router.post(
  '/org-requests',
  requestLimiter,
  validate(
    z.object({
      companyName: z.string().trim().min(2, 'Please enter your organisation name').max(120),
      staffCount: z.coerce.number().int().min(1).max(100000).optional(),
      sector: z.string().trim().max(80).optional().default(''),
      contactName: z.string().trim().min(2, 'Please enter your name').max(120),
      jobTitle: z.string().trim().max(120).optional().default(''),
      email: z.string().trim().toLowerCase().email('Please enter a valid work email address'),
      phone: z.string().trim().max(40).optional().default(''),
      message: z.string().trim().max(2000).optional().default(''),
      // A field people never see: automated spam fills it in.
      website: z.string().max(500).optional(),
    }),
  ),
  ah(async (req, res) => {
    const { website, ...details } = req.body;
    if (website) return res.status(201).json(THANKS);

    // A second request from the same person, before we have answered, updates the first.
    const open = await OrgRequest.findOne({ email: details.email, status: 'new' });
    const request = open ? Object.assign(open, details) : new OrgRequest(details);
    await request.save();
    await audit(details.email, open ? 'org_request.updated' : 'org_request.received', { entity: 'OrgRequest', entityId: request._id, meta: { companyName: details.companyName } });

    if (!open) {
      const link = `${config.appUrl}/platform/requests`;
      const platformAdmins = await User.find({ email: { $in: config.platformAdminEmails } }).select('_id');
      await notify(platformAdmins.map((u) => u._id), { kind: 'org_request_new', title: `New account request: ${details.companyName}`, body: `${details.contactName} (${details.email})`, link: '/platform/requests' });
      for (const to of config.platformAdminEmails) await sendEmail({ to, ...emails.orgRequestNew({ ...details, link }) });
      await sendEmail({ to: details.email, ...emails.orgRequestReceived({ name: details.contactName, companyName: details.companyName }) });
    }
    return res.status(201).json(THANKS);
  }),
);

export default router;
