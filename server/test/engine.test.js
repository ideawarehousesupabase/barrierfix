import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
const { translateBrief, validateCandidate, breakdownBrief } = await import('../src/engine/index.js');

const MONDAY_10AM = '2026-09-21T10:00:00+01:00';
const org = { settings: { timezone: 'Europe/London', workdayStart: '09:00', workdayEnd: '17:00' } };
const holidays = new Set(['2026-08-31', '2026-12-25', '2026-12-28']);
const run = (text, codes, extra = {}) =>
  translateBrief({ text, sentAt: MONDAY_10AM, org, holidays, rules: codes.map((code) => ({ code })), managerName: 'Priya', employeeName: 'Jordan Lee', ...extra });
const field = (r, key) => r.cards.flatMap((c) => c.sections).find((s) => s.key === key);

const WORKED_EXAMPLE =
  "Can you pull together the Q3 review deck for Harbour & Co by Thursday? Use last quarter's as a base, add the new campaign numbers and flag anything that needs Sam's input.";

test('business plan worked example: steps, exact deadline and check-in', () => {
  const r = run(WORKED_EXAMPLE, ['TS1', 'TM1', 'TM2']);
  assert.equal(r.isTask, true);
  assert.equal(field(r, 'task').text, 'Pull together the Q3 review deck for Harbour & Co');
  assert.equal(field(r, 'due').text, 'Thursday 24 September at 5pm');
  assert.deepEqual(field(r, 'steps').items, ["Use last quarter's as a base.", 'Add the new campaign numbers.', "Flag anything that needs Sam's input."]);
  assert.equal(field(r, 'checkin').text, 'Wednesday 23 September at 12pm with Priya');
  assert.equal(r.validator.passed, true);
  assert.deepEqual(r.schedule.map((s) => s.kind), ['checkin']);
});

test('done-when line conjugates every action', () => {
  const r = run('Could you check the numbers and update the deck by tomorrow EOD, thanks', ['TS2', 'TM1']);
  assert.equal(field(r, 'done').text, 'You have checked the numbers and updated the deck.');
  assert.equal(field(r, 'due').text, 'Tuesday 22 September at 5pm');
});

test('deadline phrases resolve in the company calendar', () => {
  const due = (text) => run(text, ['TM1']).summaries[0].deadline;
  assert.match(due('Please send the report by end of the week'), /^2026-09-25T17:00/);
  assert.match(due('Please send the report by Monday'), /^2026-09-28T17:00/); // said on a Monday: next Monday
  assert.match(due('Please send the report by the 24th'), /^2026-09-24T17:00/);
  assert.match(due('Please send the report by Thursday morning'), /^2026-09-24T12:00/);
  assert.match(due('Please send the report by 3pm tomorrow'), /^2026-09-22T15:00/);
  assert.match(due('Please send the report within 2 working days'), /^2026-09-23T17:00/);
  assert.equal(due('Please send the report ASAP'), null);
});

test('vague deadlines are flagged, never guessed', () => {
  const r = run('Can you send me the figures ASAP?', ['TM1', 'CM3']);
  assert.match(field(r, 'due').text, /No exact time given/);
  assert.equal(r.validator.passed, true);
});

test('common UK workplace abbreviations are explained with CM3', () => {
  const text = (msg) => JSON.stringify(run(msg, ['CM3']).cards);
  assert.match(text('Can you send the summary to the SLT by Friday?'), /SLT \(senior leadership team\)/);
  assert.match(text('Please add the YTD figures to the P&L by Friday'), /YTD \(year to date\)/);
  assert.match(text('Please add the YTD figures to the P&L by Friday'), /P&L \(profit and loss\)/);
  assert.match(text('Please draft the OKRs for the RFP by Friday'), /OKRs \(objectives and key results\)/);
  assert.match(text('Please draft the OKRs for the RFP by Friday'), /RFP \(request for proposal\)/);
  assert.match(text('Please send the NDA to Acme by Friday'), /NDA \(non-disclosure agreement\)/);
  assert.match(text('Please update the KPIs by Friday'), /KPIs \(key performance indicators\)/, 'plurals of capitals are abbreviations too');
  assert.doesNotMatch(text('Please ask Okrs Ltd for a quote by Friday'), /objectives and key results/, 'but a capitalised name is not');
});

test('wording rules that changed the text are listed as applied', () => {
  // Found in browser testing: KPI and SLT were explained, but "Rules applied" did not mention CM3.
  const applied = (r) => Object.fromEntries(r.appliedRules.map((a) => [a.code, a.effect]));
  const abbr = applied(run('Can you send the KPI summary to the SLT by Friday?', ['TM1', 'CM3']));
  assert.match(abbr.CM3 || '', /KPI.*SLT/);
  const plain = applied(run("Let's circle back on the budget. Can you ping me the figure by Friday?", ['CM1']));
  assert.ok(plain.CM1, 'plain language');
  const nothing = applied(run('Please send the invoice to Acme by Friday', ['CM1', 'CM3']));
  assert.equal(nothing.CM1, undefined, 'a rule that changed nothing is not claimed');
  assert.equal(nothing.CM3, undefined);
});

test('a deadline reminder counts working hours, so it never lands out of hours, at a weekend or on a bank holiday', () => {
  const reminder = (text) => run(text, ['TM1', 'TM3']).schedule.find((s) => s.kind === 'deadline_reminder')?.at;
  // Said on Monday 21 September. Monday 28th at 10am: one working hour that morning, one on Friday afternoon.
  const monday = run('Please send the report by Monday at 10am', ['TM1', 'TM3']);
  assert.match(reminder('Please send the report by Monday at 10am'), /^2026-09-25T16:00/);
  assert.equal(field(monday, 'reminder').text, 'We will remind you on Friday 25 September at 4pm');
  assert.match(monday.appliedRules.find((a) => a.code === 'TM3').effect, /2 working hours before/);
  assert.match(reminder('Please send the report by Wednesday at 3pm'), /^2026-09-23T13:00/, 'within a working day it is simply earlier');
  // 25 and 28 December are bank holidays here; 26 and 27 are a weekend.
  assert.match(reminder('Please send the report by 29 December at 10am'), /^2026-12-24T16:00/);
});

test('calendar: counting back through working time skips evenings, weekends and bank holidays', async () => {
  const { createCalendar } = await import('../src/engine/calendar.js');
  const { DateTime } = await import('luxon');
  const cal = createCalendar({ holidays: new Set(['2026-12-25', '2026-12-28']) });
  const back = (iso, minutes) => cal.subtractWorkingMinutes(DateTime.fromISO(iso, { zone: 'Europe/London' }), minutes).toISO();
  assert.match(back('2026-09-23T15:00', 120), /^2026-09-23T13:00/);
  assert.match(back('2026-09-28T10:00', 120), /^2026-09-25T16:00/);
  assert.match(back('2026-09-28T08:00', 60), /^2026-09-25T16:00/, 'from before the working day starts');
  assert.match(back('2026-09-26T12:00', 60), /^2026-09-25T16:00/, 'from a weekend');
  assert.match(back('2026-09-23T19:00', 60), /^2026-09-23T16:00/, 'from the evening');
  assert.match(back('2026-12-29T10:00', 120), /^2026-12-24T16:00/, 'over bank holidays');
  assert.match(back('2026-09-23T17:00', 480), /^2026-09-23T09:00/, 'a whole working day');
});

test('event dates are not taken as deadlines', () => {
  const r = run("Please book the meeting room for Monday's workshop.", ['TM1']);
  assert.equal(r.summaries[0].deadline, null);
  assert.equal(field(r, 'task').text, "Book the meeting room for Monday's workshop");
});

test('one task per message splits separate requests', () => {
  const r = run('Can you send the invoice to Acme by Friday? Also, please book the meeting room for Thursday.', ['TS3', 'TM1']);
  assert.equal(r.cards.length, 2);
  assert.equal(r.summaries[0].title, 'Send the invoice to Acme');
  assert.ok(r.appliedRules.some((a) => a.code === 'TS3'));
});

test('plain language and abbreviations keep names, numbers and negatives', () => {
  const r = run("Let's circle back on the budget. Can you ping me the ballpark figure ASAP and loop in Sam? Don't share it with the client.", ['CM1', 'CM3']);
  assert.match(r.text, /talk again/);
  // The abbreviation is explained at its first appearance, now the task line at the top of the card.
  assert.match(r.text, /Task: Message me the rough estimate ASAP \(as soon as possible\) and include Sam/);
  assert.match(r.text, /message me the rough estimate ASAP and include Sam/);
  assert.match(r.text, /Don't share it with the client/);
  assert.equal(r.validator.passed, true);
});

test('check-ins skip weekends and bank holidays', () => {
  // Deadline Tuesday 1 Sept 2026; Monday 31 Aug is a bank holiday, so the check-in is Friday 28 Aug.
  const r = translateBrief({ text: 'Please finish the slides by 1 September', sentAt: '2026-08-24T10:00:00+01:00', org, holidays, rules: [{ code: 'TM1' }, { code: 'TM2' }], managerName: 'Priya' });
  assert.equal(field(r, 'checkin').text, 'Friday 28 August at 12pm with Priya');
});

test('greetings and thanks are not tasks', () => {
  assert.equal(run('Thanks Jordan, great work today!', ['TS1']).isTask, false);
  assert.equal(run('Morning!', ['TS1']).isTask, false);
});

test('Outcome Validator holds translations that change the substance', () => {
  const ctx = { sentAt: MONDAY_10AM, org, holidays, managerName: 'Priya' };
  const good = validateCandidate({ ...ctx, sourceText: WORKED_EXAMPLE, candidateText: "Task: Pull together the Q3 review deck for Harbour & Co\nDue: Thursday 24 September at 5pm\n1. Use last quarter's as a base.\n2. Add the new campaign numbers.\n3. Flag anything that needs Sam's input." });
  assert.equal(good.passed, true, JSON.stringify(good.checks.filter((c) => !c.passed)));

  const movedDeadline = validateCandidate({ ...ctx, sourceText: WORKED_EXAMPLE, candidateText: "Task: Pull together the Q3 review deck for Harbour & Co\nDue: Friday 25 September at 5pm\n1. Use last quarter's as a base.\n2. Add the new campaign numbers.\n3. Flag anything that needs Sam's input." });
  assert.equal(movedDeadline.passed, false);
  assert.equal(movedDeadline.checks.find((c) => c.key === 'deadline').passed, false);

  const droppedStep = validateCandidate({ ...ctx, sourceText: WORKED_EXAMPLE, candidateText: "Task: Pull together the Q3 review deck for Harbour & Co\nDue: Thursday 24 September at 5pm\n1. Use last quarter's as a base.\n2. Add the new campaign numbers." });
  assert.equal(droppedStep.passed, false);
  assert.equal(droppedStep.checks.find((c) => c.key === 'coverage').passed, false);

  const newPerson = validateCandidate({ ...ctx, sourceText: WORKED_EXAMPLE, candidateText: "Task: Pull together the Q3 review deck for Harbour & Co\nDue: Thursday 24 September at 5pm\n1. Use last quarter's as a base.\n2. Add the new campaign numbers.\n3. Flag anything that needs Sam's input.\n4. Send it to Alex for sign-off." });
  assert.equal(newPerson.passed, false);
  assert.equal(newPerson.checks.find((c) => c.key === 'no_new_facts').passed, false);

  const flipped = validateCandidate({ ...ctx, sourceText: "Don't send the draft to the client until Sam has checked it.", candidateText: 'Send the draft to the client until Sam has checked it.' });
  assert.equal(flipped.checks.find((c) => c.key === 'negation').passed, false);
});

test('break it down adds target times before the check-in', () => {
  const r = run(WORKED_EXAMPLE, ['TS1', 'TM1', 'TM2']);
  const b = breakdownBrief(r.summaries[0], { sentAt: MONDAY_10AM, org, holidays });
  assert.equal(b.basis, 'check-in');
  assert.equal(b.items.length, 3);
  assert.ok(b.items.every((i) => i.targetAt && i.targetAt <= r.summaries[0].checkin));
});

test('translation is fast (plan target: under 10 seconds)', () => {
  const r = run(WORKED_EXAMPLE, ['TS1', 'TS2', 'TS3', 'TM1', 'TM2', 'TM3', 'CM1', 'CM2', 'CM3', 'CM4']);
  assert.ok(r.processingMs < 1000, `took ${r.processingMs}ms`);
  assert.equal(r.validator.passed, true);
});

test('priority is read from the manager\'s own words and never guessed', () => {
  const urgent = run('Please send the invoice to Acme by Friday. This is urgent.', ['TS1', 'TM1']);
  assert.equal(urgent.priority, 'urgent');
  assert.equal(field(urgent, 'priority').text, 'Urgent');
  assert.equal(urgent.summaries[0].priority, 'urgent');
  assert.equal(urgent.validator.passed, true);
  assert.equal(run('This is a high priority task: please send the invoice by Friday', ['TM1']).priority, 'high');
  assert.equal(run('No rush, but can you send the invoice by Friday?', ['TM1']).priority, 'low');
  assert.equal(run('Please send the invoice by Friday', ['TM1']).priority, null);
  assert.equal(field(run('Please send the invoice by Friday', ['TM1']), 'priority'), undefined);
  // A priority the manager picks in a form is used as given.
  assert.equal(run('Please send the invoice by Friday', ['TM1'], { priority: 'low' }).priority, 'low');
});

test('details the employee\'s profile requires are reported as missing', () => {
  const keys = (r) => r.missing.map((m) => m.key);
  assert.deepEqual(keys(run('Please send the invoice to Acme', ['TS1', 'TM4', 'TM5', 'PR1'])), ['deadlineDate', 'priority']);
  assert.deepEqual(keys(run('Please send the invoice to Acme by Friday', ['TM4', 'TM5', 'PR1'])), ['deadlineTime', 'priority']);
  assert.deepEqual(keys(run('Please send the invoice to Acme by Friday at 3pm. This is urgent.', ['TM4', 'TM5', 'PR1'])), []);
  assert.deepEqual(keys(run('Please send the invoice to Acme', ['TS1', 'TM1'])), [], 'only rules the employee agreed create requirements');
  assert.deepEqual(keys(run('Please send the invoice to Acme', ['TM4'])), ['deadlineDate']);
  assert.match(run('Please send the invoice to Acme', ['TM4']).missing[0].question, /due date/i);
  assert.deepEqual(keys(run('ASAP please, send the invoice to Acme', ['TM4'])), ['deadlineDate'], 'a vague deadline is not a due date');
});

test('a month used as a label is never turned into a deadline', () => {
  // Found in browser testing: "the October numbers" became "Due Friday 1 October 2027 at 5pm".
  const kpi = run('Can you update the KPI tracker with the October numbers and send the summary to the SLT?', ['TS1', 'TM1', 'TM4']);
  assert.equal(kpi.summaries[0].deadline, null, 'no deadline was given');
  assert.deepEqual(kpi.missing.map((m) => m.key), ['deadlineDate'], 'so the manager is asked for one');
  assert.match(field(kpi, 'task').text, /October numbers/, 'the task keeps its wording');
  for (const text of ['Please send me the March figures', "Please file October's report", 'Please review the September budget', 'Please check the numbers for December 2026']) {
    assert.equal(run(text, ['TM1']).summaries[0].deadline, null, text);
  }
});

test('a month on its own after "by" is vague; a day in the month, or its end, is a deadline', () => {
  const byMonth = run('Please send the report by October', ['TM1', 'TM4']);
  assert.equal(byMonth.summaries[0].deadline, null, '"by October" could mean the start or the end of it');
  assert.deepEqual(byMonth.missing.map((m) => m.key), ['deadlineDate'], 'so it is asked about, like "ASAP"');
  assert.match(field(byMonth, 'due').text, /by October/);
  assert.equal(byMonth.validator.passed, true);
  const due = (text) => run(text, ['TM1']).summaries[0].deadline;
  assert.match(due('Please send the report by 30 October'), /^2026-10-30T17:00/);
  assert.match(due('Please send the report by October 30th'), /^2026-10-30T17:00/);
  assert.match(due('Please send the report by the end of October'), /^2026-10-30T17:00/, 'the last working day of October (31st is a Saturday)');
});

test('missing details supplied by the manager complete the task without rewording it', () => {
  const text = 'Please send the invoice to Acme';
  const r = run(text, ['TM1', 'TM4', 'TM5', 'PR1'], { priority: 'high', overrides: { deadlineDate: '2026-09-25', deadlineTime: '15:00' } });
  assert.deepEqual(r.missing, []);
  assert.equal(field(r, 'due').text, 'Friday 25 September at 3pm');
  assert.equal(field(r, 'priority').text, 'High');
  assert.equal(r.validator.passed, true);
  assert.equal(r.tasks[0].title.includes('Friday'), false, 'the manager\'s wording is untouched');
  const dateOnly = run('Please send the invoice to Acme by Friday', ['TM1', 'TM5'], { overrides: { deadlineTime: '10:30' } });
  assert.deepEqual(dateOnly.missing, []);
  assert.equal(field(dateOnly, 'due').text, 'Friday 25 September at 10:30am');
});

test('every card shows the task, when it is due and its priority, whatever rules were agreed', () => {
  const prose = run('Can you send the invoice to Acme by Friday? It is urgent.', ['CM1']);
  assert.equal(field(prose, 'task').text, 'Send the invoice to Acme');
  assert.equal(field(prose, 'due').text, 'Friday 25 September at 5pm');
  assert.equal(field(prose, 'priority').text, 'Urgent');
  assert.equal(prose.summaries[0].title, 'Send the invoice to Acme');
  assert.equal(prose.validator.passed, true, JSON.stringify(prose.validator.checks.filter((c) => !c.passed)));
  const stepsOnly = run(WORKED_EXAMPLE, ['TS1']);
  assert.equal(field(stepsOnly, 'due').text, 'Thursday 24 September at 5pm');
  assert.equal(stepsOnly.validator.passed, true);
  assert.equal(field(run('Please tidy up the shared drive folders', ['CM2']), 'due').text, 'No deadline was given');
  assert.equal(stepsOnly.appliedRules.some((r) => r.code === 'TM1'), false, 'showing the due date is not counted as an agreed rule');
});
