import { WebClient } from '@slack/web-api';
import { config } from '../../config/env.js';
import { hasFeature } from '../../config/plans.js';
import { Organization, SlackInstallation } from '../../models/index.js';
import { decrypt } from '../../utils/crypto.js';
import { errorFields, logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';

const clients = new Map();
let clientOverride = null;

// Tests replace the real Slack Web API with a simulated one: fn(orgId) returns { client } or null.
export function setSlackClientOverride(fn) {
  clientOverride = fn;
}

// A Slack Web API client for a company's workspace, using its stored bot token.
export async function slackClientForOrg(orgId) {
  if (clientOverride) return orgId ? clientOverride(orgId) : null;
  if (!config.slack.enabled || !orgId) return null;
  const installation = await SlackInstallation.findOne({ orgId });
  if (!installation) return null;
  const cached = clients.get(String(orgId));
  if (cached && cached.tokenEnc === installation.botTokenEnc) return cached;
  const entry = { client: new WebClient(decrypt(installation.botTokenEnc)), installation, tokenEnc: installation.botTokenEnc };
  clients.set(String(orgId), entry);
  return entry;
}

export const forgetSlackClient = (orgId) => clients.delete(String(orgId));

async function slackAllowed(orgId) {
  const org = await Organization.findById(orgId);
  return hasFeature(org, 'slack');
}

// Posts a direct message from the BarrierFix bot to a Slack user.
export async function sendSlackDm(orgId, slackUserId, { text, blocks }) {
  if (!slackUserId) return null;
  const entry = await slackClientForOrg(orgId);
  if (!entry || !(await slackAllowed(orgId))) return null;
  try {
    // Temporary Slack or network problems are retried with a short, growing pause.
    const res = await withRetry(() => entry.client.chat.postMessage({ channel: slackUserId, text, blocks, unfurl_links: false }));
    return { channel: res.channel, ts: res.ts };
  } catch (err) {
    logger.warn('slack.dm_failed', errorFields(err));
    return null;
  }
}

export async function updateSlackMessage(orgId, channel, ts, { text, blocks }) {
  const entry = await slackClientForOrg(orgId);
  if (!entry || !channel || !ts) return;
  try {
    await withRetry(() => entry.client.chat.update({ channel, ts, text, blocks }));
  } catch (err) {
    logger.warn('slack.update_failed', errorFields(err));
  }
}

export async function postEphemeral(orgId, channel, user, { text, blocks }) {
  const entry = await slackClientForOrg(orgId);
  if (!entry) return;
  try {
    await withRetry(() => entry.client.chat.postEphemeral({ channel, user, text, blocks }));
  } catch (err) {
    logger.warn('slack.ephemeral_failed', errorFields(err));
  }
}
