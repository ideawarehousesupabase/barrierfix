import { config } from '../config/env.js';
import { emails } from '../content/emailTemplates.js';
import { sendEmail } from '../integrations/email.js';
import { sendSlackDm, slackClientForOrg } from '../integrations/slack/messaging.js';
import { Notification, User } from '../models/index.js';
import { emitToUser } from '../realtime/socket.js';

/**
 * Notifies one or more users. Every notification appears in the app; `channels`
 * can add 'email' and/or 'slack' (Slack only reaches users linked to Slack).
 * Returns what happened per person and channel, e.g. { userId, channel: 'email', status: 'sent' },
 * so callers that must prove delivery (the HR escalation) can record it.
 */
export async function notify(recipients, { kind, title, body = '', link = '', channels = [] }) {
  const results = [];
  const ids = [...new Set([].concat(recipients).filter(Boolean).map(String))];
  if (!ids.length) return results;
  const users = await User.find({ _id: { $in: ids } });
  const url = `${config.appUrl}${link || ''}`;
  for (const user of users) {
    if (['disabled', 'left'].includes(user.status)) continue;
    const n = await Notification.create({ orgId: user.orgId, userId: user._id, kind, title, body, link });
    emitToUser(user._id, 'notification', n.toObject());
    results.push({ userId: user._id, channel: 'in_app', status: 'delivered' });
    if (channels.includes('email') && user.status === 'active') {
      const sent = await sendEmail({ to: user.email, ...emails.notification({ name: user.name, title, body, link: url }) });
      // "not_set_up" when no SMTP server is configured (the email only reached the Dev mailbox).
      results.push({ userId: user._id, channel: 'email', status: sent?.error ? 'failed' : sent?.dev ? 'not_set_up' : 'sent' });
    }
    if (channels.includes('slack')) {
      // "skipped" when the person or their company is not on Slack; "failed" only when a real attempt failed.
      if (user.slackUserId && user.orgId && (await slackClientForOrg(user.orgId))) {
        const sent = await sendSlackDm(user.orgId, user.slackUserId, { text: `*${title}*${body ? `\n${body}` : ''}\n<${url}|Open in BarrierFix>` });
        results.push({ userId: user._id, channel: 'slack', status: sent ? 'sent' : 'failed' });
      } else {
        results.push({ userId: user._id, channel: 'slack', status: 'skipped' });
      }
    }
  }
  return results;
}

export async function usersWithRole(orgId, role) {
  return User.find({ orgId, roles: role, status: 'active' });
}
