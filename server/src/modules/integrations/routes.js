import { Router } from 'express';
import { config } from '../../config/env.js';
import { slackInstallUrl, syncSlackUsers } from '../../integrations/slack/oauth.js';
import { forgetSlackClient } from '../../integrations/slack/messaging.js';
import { requireFeature, requireOrg, requireRole } from '../../middleware/auth.js';
import { SlackInstallation } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { HttpError, ah } from '../../utils/http.js';

const router = Router();
router.use(requireOrg);

router.get(
  '/slack',
  ah(async (req, res) => {
    const installation = await SlackInstallation.findOne({ orgId: req.org._id }).select('teamName teamId installedAt scopes');
    res.json({
      configured: config.slack.enabled,
      connected: Boolean(installation),
      installation,
      eventsUrl: `${config.apiPublicUrl}/slack/events`,
      redirectUrl: `${config.apiPublicUrl}/slack/oauth/callback`,
    });
  }),
);

router.get(
  '/slack/install-url',
  requireRole('admin'),
  requireFeature('slack'),
  ah(async (req, res) => {
    if (!config.slack.enabled) throw new HttpError(503, 'Slack is not set up on this server yet. Add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET to .env.');
    res.json({ url: slackInstallUrl(req.org._id, req.user._id) });
  }),
);

router.post(
  '/slack/sync-users',
  requireRole('admin', 'hr'),
  ah(async (req, res) => {
    const result = await syncSlackUsers(req.org._id);
    res.json(result);
  }),
);

router.delete(
  '/slack',
  requireRole('admin'),
  ah(async (req, res) => {
    await SlackInstallation.deleteOne({ orgId: req.org._id });
    forgetSlackClient(req.org._id);
    await audit(req, 'slack.disconnected', { entity: 'Organization', entityId: req.org._id });
    res.json({ ok: true });
  }),
);

export default router;
