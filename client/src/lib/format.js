const tz = 'Europe/London';

export function fmtDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(value));
}

export function fmtDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(new Date(value));
}

export function fmtRelative(value) {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return 'just now';
}

export const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);

export const ROLE_LABELS = { employee: 'Employee', manager: 'Manager', hr: 'HR / Operations', admin: 'Company Admin' };

export const PROFILE_STATUS = {
  none: { label: 'No profile', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
  proposed: { label: 'Waiting for agreement', tone: 'warning' },
  agreed: { label: 'Agreed', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
};

export const TASK_STATUS = {
  new: { label: 'New', tone: 'info' },
  seen: { label: 'Opened', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  question: { label: 'Question asked', tone: 'warning' },
  flagged: { label: 'Flagged as wrong', tone: 'danger' },
};

export const BRIEF_STATUS = {
  delivered: { label: 'Delivered in agreed format', tone: 'success' },
  held: { label: 'Held: please check', tone: 'warning' },
  approved: { label: 'Checked and sent', tone: 'success' },
  original_sent: { label: 'Original wording sent', tone: 'neutral' },
  superseded: { label: 'Replaced by an update', tone: 'neutral' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
  not_task: { label: 'Not a task', tone: 'neutral' },
};

export const DECISION_STATUS = {
  pending: { label: 'Waiting for an answer', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  hr_review: { label: 'Rejected: with HR', tone: 'warning' },
  answering: { label: 'Six questions to answer', tone: 'warning' },
  hr_final: { label: 'With HR for a final decision', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
  overturned: { label: 'Accepted by HR', tone: 'success' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export const SOURCE_LABELS = { web: 'Web', csv: 'CSV upload', slack: 'Slack', verbal: 'Verbal instruction', meeting_summary: 'Meeting summary' };
