import { DateTime } from 'luxon';
import { splitClauses } from './analyse.js';
import { formatDateTime } from './calendar.js';
import { asSentence, stripEndPunctuation } from './text.js';

// "Break it down further": splits each step into single actions and spreads them
// across the working time before the check-in (or deadline) with a target for each.
export function breakdownTask(summary, ctx) {
  const base = summary.steps?.length ? summary.steps : [summary.title];
  const items = [];
  for (const step of base.filter(Boolean)) {
    const parts = splitClauses(stripEndPunctuation(step));
    for (const p of parts) {
      const s = asSentence(p);
      if (s && !items.includes(s)) items.push(s);
    }
  }

  const endIso = summary.checkin || summary.deadline;
  const end = endIso ? DateTime.fromISO(endIso, { zone: ctx.cal.timezone }) : null;
  if (!end || end <= ctx.now || !items.length) {
    return { items: items.map((text) => ({ text })), basis: null };
  }
  const minutes = ctx.cal.workingMinutesBetween(ctx.now, end);
  const share = minutes / items.length;
  return {
    basis: summary.checkin ? 'check-in' : 'deadline',
    items: items.map((text, i) => {
      const offset = Math.max(15, Math.round((share * (i + 1)) / 15) * 15);
      let target = ctx.cal.addWorkingMinutes(ctx.now, offset);
      if (target > end) target = end;
      return { text, targetAt: target.toISO(), targetText: formatDateTime(target, ctx.now) };
    }),
  };
}
