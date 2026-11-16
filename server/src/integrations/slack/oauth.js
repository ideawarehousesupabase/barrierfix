import { WebClient } from '@slack/web-api';
import { config } from '../../config/env.js';
import { SlackInstallation, User } from '../../models/index.js';
import { audit } from '../../services/audit.js';
import { encrypt, signToken, verifySignedToken } from '../../utils/crypto.js';
import { forgetSlackClient, slackClientForOrg } from './messaging.js';

// Bot permissions: read messages in channels the app is added to (to spot tasks for
// people with a profile), send DMs, run the /brief command, and match users by email.
export const BOT_SCOPES = ['channels:history', 'groups:history', 'chat:write', 'im:write', 'commands', 'users:read', 'users:read.email'];

const redirectUri = () => `${config.apiPublicUrl}/slack/oauth/callback`;

export function slackInstallUrl(orgId, userId) {
  const state = signToken({ orgId: String(orgId), userId: String(userId), purpose: 'slack_install' }, 900);
  const params = new URLSearchParams({ client_id: config.slack.clientId, scope: BOT_SCOPES.join(','), redirect_uri: redirectUri(), state });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

// Links company users to Slack users with the same email address.
export async function syncSlackUsers(orgId) {
  const entry = await slackClientForOrg(orgId);
  if (!entry) return { linked: 0, notFound: 0 };
  const users = await User.find({ orgId, status: { $in: ['active', 'invited'] } });
  let linked = 0;
  let notFound = 0;
  for (const user of users) {
    try {
      const res = await entry.client.users.lookupByEmail({ email: user.email });
      if (res.user?.id && res.user.id !== user.slackUserId) {
        user.slackUserId = res.user.id;
        await user.save();
      }
      linked += 1;
    } catch {
      notFound += 1;
    }
  }
  return { linked, notFound };
}

export async function handleOAuthCallback(req, res) {
  const back = (query) => res.redirect(`${config.appUrl}/admin/settings?${query}`);
  if (req.query.error) return back(`slack=error&reason=${encodeURIComponent(req.query.error)}`);
  const state = verifySignedToken(req.query.state);
  if (!state || state.purpose !== 'slack_install') return back('slack=error&reason=expired');
  try {
    const result = await new WebClient().oauth.v2.access({ client_id: config.slack.clientId, client_secret: config.slack.clientSecret, code: String(req.query.code || ''), redirect_uri: redirectUri() });
    const teamId = result.team?.id;
    const inUse = await SlackInstallation.findOne({ teamId });
    if (inUse && String(inUse.orgId) !== state.orgId) return back('slack=error&reason=workspace_in_use');
    await SlackInstallation.findOneAndUpdate(
      { orgId: state.orgId },
      {
        orgId: state.orgId,
        teamId,
        teamName: result.team?.name,
        enterpriseId: result.enterprise?.id,
        appId: result.app_id,
        botUserId: result.bot_user_id,
        botTokenEnc: encrypt(result.access_token),
        scopes: String(result.scope || '').split(','),
        installedBy: state.userId,
        installedAt: new Date(),
      },
      { upsert: true, new: true },
    );
    forgetSlackClient(state.orgId);
    const sync = await syncSlackUsers(state.orgId);
    await audit({ _id: state.userId, orgId: state.orgId }, 'slack.connected', { orgId: state.orgId, meta: { teamId, teamName: result.team?.name, ...sync } });
    return back('slack=connected');
  } catch (err) {
    console.error('[slack] OAuth failed:', err.data?.error || err.message);
    return back(`slack=error&reason=${encodeURIComponent(err.data?.error || 'oauth_failed')}`);
  }
}
