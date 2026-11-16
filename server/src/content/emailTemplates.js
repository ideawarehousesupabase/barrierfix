// Email wording. Kept separate from code so the client can edit it.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function layout({ heading, paragraphs = [], cta, lists = [], footer }) {
  const text = [
    heading,
    '',
    ...paragraphs,
    ...lists.flatMap((l) => ['', l.heading, ...l.items.map((i) => `- ${i}`)]),
    cta ? `\n${cta.label}: ${cta.url}` : '',
    '',
    footer || 'BarrierFix by SimpliAccess Ltd',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.6;color:#1d2a3a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
<h1 style="font-size:22px;margin:0 0 16px">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('')}
${lists.map((l) => `<h2 style="font-size:17px;margin:18px 0 6px">${esc(l.heading)}</h2><ul style="margin:0 0 14px;padding-left:20px">${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
${cta ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#1f5fbf;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold">${esc(cta.label)}</a></p>` : ''}
<p style="margin:24px 0 0;font-size:14px;color:#5b6676">${esc(footer || 'BarrierFix by SimpliAccess Ltd')}</p>
</div></body></html>`;
  return { text, html };
}

export const emails = {
  orgRequestReceived({ name, companyName }) {
    return {
      subject: 'We have received your BarrierFix request',
      ...layout({
        heading: 'Thank you for your interest in BarrierFix',
        paragraphs: [
          `Hello${name ? ` ${name}` : ''},`,
          `We have received your request for a BarrierFix account for ${companyName}. Our team will check the details and be in touch, usually within two working days.`,
          'Once your organisation is set up, you will receive your sign-in details as the company admin.',
        ],
        footer: 'If you did not send this request, you can ignore this email.',
      }),
    };
  },

  orgRequestNew({ companyName, contactName, email, jobTitle, staffCount, sector, message, link }) {
    return {
      subject: `New BarrierFix account request: ${companyName}`,
      ...layout({
        heading: 'A company has asked for a BarrierFix account',
        paragraphs: [
          `${contactName}${jobTitle ? ` (${jobTitle})` : ''} at ${companyName} has asked for an account.`,
          `Email: ${email}${staffCount ? ` · Staff: ${staffCount}` : ''}${sector ? ` · Sector: ${sector}` : ''}`,
          ...(message ? [`Message: ${message}`] : []),
          'Check the details, then approve or reject the request.',
        ],
        cta: { label: 'Review the request', url: link },
      }),
    };
  },

  orgRequestDeclined({ name, companyName, note }) {
    return {
      subject: 'About your BarrierFix account request',
      ...layout({
        heading: 'About your BarrierFix request',
        paragraphs: [
          `Hello${name ? ` ${name}` : ''},`,
          `Thank you for your request for a BarrierFix account for ${companyName}. We are not able to set up an account from this request.`,
          ...(note ? [note] : []),
          'If you have any questions, just reply to this email.',
        ],
      }),
    };
  },

  account({ orgName, creatorName, name, email, temporaryPassword, link }) {
    return {
      subject: `Your BarrierFix account at ${orgName}`,
      ...layout({
        heading: 'Your BarrierFix account is ready',
        paragraphs: [
          `Hello${name ? ` ${name}` : ''},`,
          `${creatorName} has created a BarrierFix account for you at ${orgName}. BarrierFix helps teams apply agreed ways of working to everyday tasks.`,
          `Sign in with ${email} and this temporary password: ${temporaryPassword}`,
          'You will be asked to choose your own password straight away.',
        ],
        cta: { label: 'Sign in', url: link },
        footer: 'If you were not expecting this email, please tell your company admin.',
      }),
    };
  },

  notification({ name, title, body, link }) {
    return {
      subject: title,
      ...layout({ heading: title, paragraphs: [`Hello${name ? ` ${name}` : ''},`, ...(body ? String(body).split('\n') : [])], cta: { label: 'Open BarrierFix', url: link } }),
    };
  },

  digest({ name, orgName, lists, link }) {
    return {
      subject: `Your BarrierFix week at ${orgName}`,
      ...layout({
        heading: 'Your weekly BarrierFix summary',
        paragraphs: [`Hello${name ? ` ${name}` : ''},`, 'Here is what needs your attention this week.'],
        lists,
        cta: { label: 'Open BarrierFix', url: link },
        footer: 'You receive this weekly summary because you manage people using BarrierFix. Your company admin can switch it off.',
      }),
    };
  },
};
