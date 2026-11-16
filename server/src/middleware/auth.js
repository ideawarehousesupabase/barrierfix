import { config } from '../config/env.js';
import { FEATURE_LABELS, hasFeature } from '../config/plans.js';
import { verifyIdToken } from '../integrations/firebase.js';
import { Organization, User } from '../models/index.js';
import { HttpError, ah, forbidden, unauthorized } from '../utils/http.js';
import { logger } from '../utils/logger.js';

// People cannot register themselves: a signed-in Firebase user needs an account an admin created.
// The one exception is the platform admin (PLATFORM_ADMIN_EMAILS), who has no company.
async function resolveUser(decoded) {
  const email = String(decoded.email || '').toLowerCase();
  let user = await User.findOne({ firebaseUid: decoded.uid });
  if (!user) {
    // An account created by us that has not been linked to its Firebase login yet.
    user = await User.findOne({ email, firebaseUid: { $exists: false } });
    if (user) {
      user.firebaseUid = decoded.uid;
      if (!user.name && decoded.name) user.name = decoded.name;
      await user.save();
    }
  }
  if (!user && config.platformAdminEmails.includes(email)) {
    user = await User.create({ email, name: decoded.name || '', firebaseUid: decoded.uid, roles: [], status: 'active' });
  }
  if (!user) throw new HttpError(403, 'No BarrierFix account exists for this email. Please ask your company admin to create one for you.', { code: 'no_account' });
  return user;
}

// Verifies the Firebase ID token, requires a verified email, and loads the user and company.
export const authenticate = ah(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch (err) {
    // Only the error code is logged (never the token or its contents).
    logger.warn('auth.token_rejected', { code: err?.code || err?.errorInfo?.code });
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (!decoded.email) throw unauthorized('Your account has no email address');
  if (!decoded.email_verified) throw new HttpError(403, 'Please verify your email address first', { code: 'email_not_verified' });

  const user = await resolveUser(decoded);
  if (['disabled', 'left'].includes(user.status)) throw forbidden('Your account has been deactivated. Please contact your company admin.');
  // A temporary password must be replaced first; only the /api/auth routes (session, password-changed) work until then.
  if (user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
    throw new HttpError(403, 'Please choose your own password before continuing', { code: 'password_change_required' });
  }
  if (!user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > 3600 * 1000) {
    user.lastLoginAt = new Date();
    await user.save();
  }
  req.user = user;
  req.org = user.orgId ? await Organization.findById(user.orgId) : null;
  req.isPlatformAdmin = config.platformAdminEmails.includes(user.email);
  return next();
});

export function requireOrg(req, res, next) {
  if (!req.org) return next(new HttpError(409, 'Set up your company first', { code: 'no_org' }));
  if (req.org.status === 'suspended') return next(forbidden('This company account is suspended. Please contact SimpliAccess.'));
  return next();
}

export const requireRole = (...roles) => (req, res, next) => (req.user?.hasRole(...roles) ? next() : next(forbidden()));

export const requireFeature = (feature) => (req, res, next) =>
  hasFeature(req.org, feature)
    ? next()
    : next(new HttpError(403, `${FEATURE_LABELS[feature] || feature} is not included in your company's plan`, { code: 'plan_feature', feature }));

export const requirePlatformAdmin = (req, res, next) => (req.isPlatformAdmin ? next() : next(forbidden('Platform admins only')));
