import { Router } from 'express';
import { config } from '../../config/env.js';
import { PLANS, planFeatures } from '../../config/plans.js';
import { passwordChangedSince } from '../../integrations/firebase.js';
import { authenticate } from '../../middleware/auth.js';
import { SlackInstallation } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { ah, HttpError } from '../../utils/http.js';
import { errorFields, logger } from '../../utils/logger.js';

const router = Router();

// Lifts the temporary-password restriction once Firebase confirms the password really changed
// after the temporary one was set (on the change-password page, or through "Forgot your password").
async function clearIfPasswordChanged(req, how) {
  if (!req.user.mustChangePassword) return true;
  const changed = req.user.firebaseUid && (await passwordChangedSince(req.user.firebaseUid, req.user.temporaryPasswordSetAt || new Date(0)));
  if (!changed) return false;
  req.user.mustChangePassword = false;
  await req.user.save();
  await audit(req, 'user.password_changed', { entity: 'User', entityId: req.user._id, meta: { how } });
  return true;
}

// Called after the person has replaced their temporary password in Firebase.
router.post(
  '/password-changed',
  authenticate,
  ah(async (req, res) => {
    if (!(await clearIfPasswordChanged(req, 'change_password_page'))) throw new HttpError(409, 'Your password has not been changed yet', { code: 'password_not_changed' });
    res.json({ ok: true });
  }),
);

export async function sessionPayload(req) {
  const org = req.org;
  const slack = org ? await SlackInstallation.findOne({ orgId: org._id }).select('teamName installedAt') : null;
  return {
    user: req.user.toSafeJSON(),
    isPlatformAdmin: req.isPlatformAdmin,
    org: org
      ? { _id: org._id, orgNumber: org.orgNumber, name: org.name, plan: org.plan, planLabel: PLANS[org.plan]?.label, status: org.status, settings: org.settings, glossary: org.glossary, staffCount: org.staffCount, sector: org.sector }
      : null,
    features: org ? planFeatures(org.plan) : {},
    slack: { configured: config.slack.enabled, connected: Boolean(slack), teamName: slack?.teamName || null },
    environment: { production: config.isProd, emulator: Boolean(config.firebase.emulatorHost) },
  };
}

router.get(
  '/session',
  authenticate,
  ah(async (req, res) => {
    // Someone who set a new password through the emailed reset link is not asked to change it again.
    if (req.user.mustChangePassword) {
      await clearIfPasswordChanged(req, 'reset_link').catch((err) => logger.warn('auth.password_check_failed', errorFields(err)));
    }
    res.json(await sessionPayload(req));
  }),
);

export default router;
