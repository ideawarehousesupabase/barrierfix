import { formatDateTime, formatTime } from './calendar.js';
import { ruleName } from './catalog.js';
import { doneLineFor, removeDeadlinePhrase, stripGreeting } from './analyse.js';
import { PRIORITY_LABELS } from './priority.js';
import { createTextTransformer } from './transforms.js';
import { asSentence, capitalise, contentWords } from './text.js';

function parseHm(hm) {
  const [h, m] = String(hm || '12:00').split(':').map(Number);
  return { hour: Number.isFinite(h) ? h : 12, minute: Number.isFinite(m) ? m : 0 };
}

// TM2: N working days before the deadline at a set time. If that has already passed
// (a tight deadline), check in halfway through the remaining working time instead.
function checkinTime(deadline, params, ctx) {
  const { cal, now } = ctx;
  const at = cal.subtractWorkingDays(deadline.startOf('day'), params.daysBefore).set({ ...parseHm(params.time), second: 0, millisecond: 0 });
  if (at > now.plus({ minutes: 30 }) && at < deadline) return { at };
  const minutes = cal.workingMinutesBetween(now, deadline);
  if (minutes < 120) return { at: null, reason: 'The deadline is too close for a check-in' };
  const half = Math.round(minutes / 2 / 15) * 15;
  return { at: cal.addWorkingMinutes(now, half), adjusted: true };
}

function sectionsToText(sections, mrkdwn) {
  const b = (s) => (mrkdwn ? `*${s}*` : s);
  const lines = [];
  for (const s of sections) {
    if (s.type === 'heading') lines.push(b(s.text));
    else if (s.type === 'field') lines.push(`${b(`${s.label}:`)} ${s.text}`);
    else if (s.type === 'list') {
      lines.push(b(`${s.label}:`));
      s.items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
    } else if (s.type === 'text') {
      if (s.label) lines.push(b(`${s.label}:`));
      lines.push(...s.items);
    } else if (s.type === 'note') lines.push(mrkdwn ? `_${s.text}_` : `Note: ${s.text}`);
  }
  return lines.join('\n');
}

export function renderTranslation(analysis, rules, ctx) {
  const has = (code) => Object.prototype.hasOwnProperty.call(rules, code);
  const tx = createTextTransformer({ plain: has('CM1'), abbreviations: has('CM3'), glossary: ctx.glossary });
  const short = (s) => (has('CM2') ? tx.short(s, rules.CM2.maxWords) : [s]);
  const applied = new Map();
  const checked = new Map();
  const mark = (code, effect) => has(code) && !applied.has(code) && applied.set(code, effect);
  const skip = (code, reason) => has(code) && !checked.has(code) && checked.set(code, reason);
  // TM4 and TM5 only require the due date and time to be known, so they show the due line exactly like TM1.
  const exactDue = has('TM1') || has('TM4') || has('TM5');
  const structured = has('TS1') || has('TS2') || exactDue || has('CM4') || has('PR1');
  const total = analysis.tasks.length;
  const schedule = [];
  const managerName = ctx.managerName || 'your manager';

  const blocks = analysis.tasks.map((task) => {
    const sections = [];
    const dl = task.deadline;
    // Every card shows the task, when it is due and its priority (MVP-027), whatever rules were agreed.
    const dueShown = Boolean(dl);
    let displayTitle = '';
    const titleSource = dueShown && task.deadlineInTitle && task.titleIsInstruction ? task.titleNoDeadline : task.title;
    // The due line for people without a deadline rule: written exactly, but not counted as TM1.
    const plainDue = () =>
      dl
        ? { type: 'field', key: 'due', label: 'Due', text: formatDateTime(dl.dt, ctx.now), value: dl.dt.toISO(), origin: 'rule', ruleCodes: [] }
        : { type: 'field', key: 'due', label: 'Due', text: task.vague ? `No exact time given ("${task.vague}")` : 'No deadline was given', value: null, origin: 'rule', ruleCodes: [] };
    // Priority is only what the manager said or chose; it is shown whenever it is known.
    const pushPriority = () => {
      if (!analysis.priority) return;
      sections.push({ type: 'field', key: 'priority', label: 'Priority', text: PRIORITY_LABELS[analysis.priority], value: analysis.priority, origin: 'rule', ruleCodes: ['PR1'] });
      mark('PR1', `Showed the priority the manager gave: ${PRIORITY_LABELS[analysis.priority]}`);
    };
    let steps = [];
    mark('TS4', 'Sent as a written task, so nothing depends on a spoken instruction');
    if (dl) mark('TM4', 'Checked that a due date was given');
    if (dl && !dl.timeAssumed) mark('TM5', 'Checked that a due time was given');
    if (total > 1) sections.push({ type: 'heading', key: 'heading', text: `Task ${task.index + 1} of ${total}`, origin: 'system' });

    if (structured) {
      displayTitle = tx.apply(titleSource);
      sections.push({ type: 'field', key: 'task', label: 'Task', text: displayTitle, origin: 'content' });
      if (has('CM4')) mark('CM4', 'Put the task and its deadline at the top');

      if (exactDue) {
        if (dl) {
          const text = formatDateTime(dl.dt, ctx.now);
          sections.push({ type: 'field', key: 'due', label: 'Due', text, value: dl.dt.toISO(), origin: 'rule', ruleCodes: ['TM1'] });
          mark('TM1', `Deadline written as ${text}`);
        } else if (task.vague) {
          sections.push({ type: 'field', key: 'due', label: 'Due', text: `No exact time given ("${task.vague}")`, value: null, origin: 'rule', ruleCodes: ['TM1'] });
          mark('TM1', 'Flagged that no exact deadline was given');
        } else {
          sections.push({ type: 'field', key: 'due', label: 'Due', text: 'No deadline was given', value: null, origin: 'rule', ruleCodes: ['TM1'] });
          mark('TM1', 'Flagged that no deadline was given');
        }
      } else if (has('CM4') && dl) {
        sections.push({ type: 'field', key: 'due', label: 'Due', text: capitalise(dl.phrase), value: dl.dt.toISO(), origin: 'rule', ruleCodes: ['CM4'] });
      } else sections.push(plainDue());

      pushPriority();

      if (has('TS2')) {
        const done = task.titleIsInstruction ? doneLineFor(displayTitle) : null;
        if (done) {
          sections.push({ type: 'field', key: 'done', label: 'Done when', text: asSentence(done), origin: 'derived', ruleCodes: ['TS2'] });
          mark('TS2', 'Added a one-line "Done when"');
        } else skip('TS2', task.negated ? 'Not added because the request says what not to do' : 'Not added because the request is not a single clear action');
      }

      steps = task.steps.map((s) => short(tx.apply(s)).join(' '));
      if (has('TS1') && steps.length) {
        sections.push({ type: 'list', key: 'steps', label: 'Steps', items: steps, origin: 'content', ruleCodes: ['TS1'] });
        mark('TS1', `Listed the work as numbered steps`);
      } else if (has('TS1')) skip('TS1', 'A single action, so no steps were needed');

      // A note that only repeats the deadline ("By next Friday.") is dropped when the Due line shows it.
      const notes = dueShown ? task.notes.filter((n) => contentWords(removeDeadlinePhrase(n, dl)).length > 0) : task.notes;
      const details = [...(has('TS1') ? [] : steps), ...notes.flatMap((n) => short(tx.apply(n)))];
      if (details.length) sections.push({ type: 'text', key: 'details', label: 'Details', items: details, origin: 'content' });
    } else {
      // Prose: a short header (task, due, priority), then the manager's own sentences with only the communication rules applied.
      displayTitle = tx.apply(titleSource);
      sections.push({ type: 'field', key: 'task', label: 'Task', text: displayTitle, origin: 'content' });
      sections.push(plainDue());
      pushPriority();
      const paragraphs = task.sourceUnits
        .filter((u) => !task.pleasantries.includes(u))
        .map((u) => stripGreeting(u, ctx))
        .filter(Boolean)
        .flatMap((u) => short(tx.apply(u)));
      sections.push({ type: 'text', key: 'details', label: 'Message', items: paragraphs, origin: 'content' });
    }

    let checkinAt = null;
    if (dl && has('TM2')) {
      const c = checkinTime(dl.dt, rules.TM2, ctx);
      if (c.at) {
        checkinAt = c.at;
        const text = `${formatDateTime(c.at, ctx.now)} with ${managerName}`;
        sections.push({ type: 'field', key: 'checkin', label: 'Check-in', text, value: c.at.toISO(), origin: 'rule', ruleCodes: ['TM2'] });
        schedule.push({ kind: 'checkin', at: c.at.toISO(), taskIndex: task.index, ruleCode: 'TM2' });
        mark('TM2', c.adjusted ? `Added a check-in (moved earlier because the deadline is close): ${text}` : `Added a check-in: ${text}`);
      } else skip('TM2', c.reason);
    } else if (has('TM2')) skip('TM2', 'No deadline, so no check-in was set');

    if (dl && has('TM3')) {
      // Counted in working hours, so a reminder never arrives in the evening, at a weekend or on a bank holiday.
      const at = ctx.cal.subtractWorkingMinutes(dl.dt, rules.TM3.hoursBefore * 60);
      if (at > ctx.now.plus({ minutes: 5 })) {
        const text = `We will remind you on ${formatDateTime(at, ctx.now)}`;
        sections.push({ type: 'field', key: 'reminder', label: 'Reminder', text, value: at.toISO(), origin: 'rule', ruleCodes: ['TM3'] });
        schedule.push({ kind: 'deadline_reminder', at: at.toISO(), taskIndex: task.index, ruleCode: 'TM3' });
        mark('TM3', `Set a reminder ${rules.TM3.hoursBefore} working hour${rules.TM3.hoursBefore === 1 ? '' : 's'} before the deadline`);
      } else skip('TM3', 'The deadline is too close for a reminder');
    } else if (has('TM3')) skip('TM3', 'No deadline, so no reminder was set');

    if (dueShown && dl.timeAssumed && dl.timeLabel) {
      sections.push({ type: 'note', key: 'note-time', text: `No time was given, so the ${dl.timeLabel} (${formatTime(dl.dt)}) is used.`, origin: 'system' });
    }
    if (dueShown && dl.note) sections.push({ type: 'note', key: 'note-deadline', text: capitalise(`${dl.note}.`), origin: 'system' });
    if (dueShown && dl.confidence === 'low') sections.push({ type: 'note', key: 'note-check', text: 'If you are unsure about the deadline, use "Ask a question" to check.', origin: 'system' });
    if (!dl && task.vague && exactDue) sections.push({ type: 'note', key: 'note-vague', text: 'Use "Ask a question" if you need an exact deadline.', origin: 'system' });

    return {
      index: task.index,
      sections,
      dueShown,
      summary: {
        title: displayTitle,
        deliverable: task.deliverable,
        deadline: dl ? dl.dt.toISO() : null,
        deadlinePhrase: dl ? dl.phrase : task.vague || null,
        deadlineConfidence: dl ? dl.confidence : null,
        checkin: checkinAt ? checkinAt.toISO() : null,
        priority: analysis.priority || null,
        steps: task.steps,
      },
    };
  });

  let groups;
  if (has('TS3') && total > 1) {
    groups = blocks.map((b) => [b]);
    mark('TS3', `Split into ${total} separate tasks`);
  } else {
    groups = [blocks];
    if (has('TS3')) skip('TS3', 'Only one task in this message');
  }

  // The wording rules are listed only when they actually changed something.
  const changedBy = (code) => tx.changes.filter((c) => c.code === code);
  const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
  const abbreviations = [...new Set(changedBy('CM3').map((c) => c.from))];
  if (abbreviations.length) mark('CM3', `Explained ${plural(abbreviations.length, 'an abbreviation', 'abbreviations')}: ${abbreviations.join(', ')}`);
  const plainWords = changedBy('CM1').length;
  if (plainWords) mark('CM1', `Replaced ${plural(plainWords, 'a phrase', 'phrases')} with plain words`);
  const splitSentences = changedBy('CM2').length;
  if (splitSentences) mark('CM2', `Split ${plural(splitSentences, 'a long sentence', 'long sentences')} into shorter ones`);

  const cards = groups.map((group, i) => {
    const sections = group.flatMap((b, j) => (j > 0 ? [{ type: 'divider', key: `divider-${j}`, origin: 'system' }, ...b.sections] : b.sections));
    const visible = sections.filter((s) => s.type !== 'divider');
    return { index: i, total: groups.length, taskIndexes: group.map((b) => b.index), sections, text: sectionsToText(visible, false), mrkdwn: sectionsToText(visible, true) };
  });

  return {
    blocks,
    cards,
    text: cards.map((c) => c.text).join('\n\n'),
    appliedRules: [...applied].map(([code, effect]) => ({ code, name: ruleName(code), effect })),
    checkedRules: [...checked].map(([code, reason]) => ({ code, name: ruleName(code), reason })),
    changes: tx.changes,
    schedule,
    transformer: tx,
  };
}
