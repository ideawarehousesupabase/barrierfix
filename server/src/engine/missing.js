import { DateTime } from 'luxon';
import { PRIORITIES, PRIORITY_LABELS } from './priority.js';

const has = (rules, code) => Object.prototype.hasOwnProperty.call(rules, code);

// The employee's agreed profile can require a due date (TM4), a due time (TM5) and a priority (PR1).
// Anything required but not in the manager's message is reported here so the manager can be asked,
// instead of BarrierFix guessing it.
export function findMissing({ analysis, rules, priority }) {
  const missing = [];
  const add = (item) => !missing.some((m) => m.key === item.key) && missing.push(item);
  for (const task of analysis.tasks) {
    const of = analysis.tasks.length > 1 ? ` for task ${task.index + 1}` : '';
    if (has(rules, 'TM4') && !task.deadline) add({ key: 'deadlineDate', taskIndex: task.index, input: 'date', question: `What is the due date${of}?`, rule: 'TM4' });
    else if (has(rules, 'TM5') && task.deadline?.timeAssumed) add({ key: 'deadlineTime', taskIndex: task.index, input: 'time', question: `What time is it due${of}?`, rule: 'TM5' });
  }
  if (has(rules, 'PR1') && !priority) {
    add({ key: 'priority', input: 'priority', question: 'How urgent is this task?', rule: 'PR1', options: PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] })) });
  }
  return missing;
}

// Details the manager typed into a form fill gaps only: a deadline the message already gives is never moved.
export function applyOverrides(analysis, overrides = {}, ctx) {
  const { deadlineDate, deadlineTime } = overrides;
  if (!deadlineDate && !deadlineTime) return;
  const zone = ctx.cal.timezone;
  for (const task of analysis.tasks) {
    const existing = task.deadline;
    if (existing && !existing.timeAssumed) continue;
    if (!existing && !deadlineDate) continue;
    if (existing && !deadlineTime) continue;
    let dt = DateTime.fromISO(existing ? existing.dt.toISODate() : deadlineDate, { zone });
    if (!dt.isValid) continue;
    if (deadlineTime) {
      const [hour, minute] = deadlineTime.split(':').map(Number);
      dt = dt.set({ hour, minute, second: 0, millisecond: 0 });
    } else dt = ctx.cal.atEnd(dt);
    task.deadline = { dt, phrase: existing?.phrase || 'set by the manager', confidence: 'high', timeAssumed: !deadlineTime, timeLabel: deadlineTime ? undefined : existing?.timeLabel };
  }
}
