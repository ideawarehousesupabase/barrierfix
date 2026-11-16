// The adjustment library seeded into the database. DRAFT wording for the 12 MVP
// rules plus record-only rules: to be reviewed by the occupational psychologist
// (business plan, Months 3 to 5) before any customer uses it.
const DRAFT = 'BarrierFix draft library v1 (founder lived experience and published guidance); pending occupational psychologist review';

export const RULE_LIBRARY = [
  // Task structure
  {
    code: 'TS1', group: 'task_structure', type: 'transform', priority: 30, name: 'Numbered steps',
    summary: 'Break tasks with more than one action into numbered steps.',
    changes: 'Lists each separate instruction in the brief as a numbered step, in the order the manager wrote them.',
    neverChanges: 'Never adds, removes or reorders work; never changes who the work is for.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TS2', group: 'task_structure', type: 'transform', priority: 40, name: 'One-line "Done when"',
    summary: 'Add a one-line definition of what "done" looks like.',
    changes: 'Adds a "Done when" line built only from the words of the request itself.',
    neverChanges: 'Never adds a new deliverable, audience or standard that the manager did not ask for.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TS3', group: 'task_structure', type: 'transform', priority: 10, name: 'One task per message',
    summary: 'When a message contains several separate tasks, send each one on its own.',
    changes: 'Splits a message with several separate requests into one message per task.',
    neverChanges: 'Never drops a task or merges tasks; each keeps its own deadline.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TS4', group: 'task_structure', type: 'transform', priority: 15, name: 'Written instructions',
    summary: 'Receive every task as a written message, never only spoken.',
    changes: 'Always delivers the task in writing, including tasks the manager gave out loud.',
    neverChanges: 'Never changes what was asked; the written task is built from the manager\'s own words.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'PR1', group: 'task_structure', type: 'transform', priority: 45, name: 'Task priority required',
    summary: 'Every task states how urgent it is.',
    changes: 'Shows the priority the manager gave. If the manager did not say, they are asked before the task is sent.',
    neverChanges: 'Never works out or guesses a priority itself.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  // Timing
  {
    code: 'TM1', group: 'timing', type: 'transform', priority: 35, name: 'Deadline as a day, date and time',
    summary: 'Always state the deadline as a day, a date and a time.',
    changes: 'Turns "by Thursday" or "EOD" into an exact day, date and time, using the company working hours when no time is given.',
    neverChanges: 'Never moves a deadline. Vague deadlines such as "ASAP" are flagged rather than guessed.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TM2', group: 'timing', type: 'schedule', priority: 60, name: 'Interim check-in before the deadline',
    summary: 'Add a check-in with the manager before the deadline.',
    changes: 'Adds a check-in a set number of working days before the deadline and reminds both people when it is due.',
    neverChanges: 'Never changes the deadline itself.',
    params: [
      { key: 'daysBefore', label: 'Working days before the deadline', kind: 'number', default: 1, min: 1, max: 10, unit: 'days' },
      { key: 'time', label: 'Time of the check-in', kind: 'time', default: '12:00' },
    ],
    costLevel: 'none', typicalCost: 'A few minutes of manager time', accessToWork: false,
  },
  {
    code: 'TM3', group: 'timing', type: 'schedule', priority: 61, name: 'Reminder before the deadline',
    summary: 'Send a reminder a set number of hours before each deadline.',
    changes: 'Sends the employee a reminder in BarrierFix and Slack before the deadline.',
    neverChanges: 'Never changes the deadline itself.',
    params: [{ key: 'hoursBefore', label: 'Working hours before the deadline', kind: 'number', default: 2, min: 1, max: 72, unit: 'working hours' }],
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TM4', group: 'timing', type: 'transform', priority: 36, name: 'Due date required',
    summary: 'Every task has a due date.',
    changes: 'If the manager did not give a due date, they are asked for one before the task is sent.',
    neverChanges: 'Never chooses a date itself. Vague wording such as "ASAP" is not treated as a date.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'TM5', group: 'timing', type: 'transform', priority: 37, name: 'Due time required',
    summary: 'Every deadline has a stated time, not an assumed one.',
    changes: 'If the manager gave a day but no time, they are asked for the time before the task is sent.',
    neverChanges: 'Never assumes a time when this rule is on.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  // Communication
  {
    code: 'CM1', group: 'communication', type: 'transform', priority: 20, name: 'Plain language',
    summary: 'Replace idioms and office jargon with plain words.',
    changes: 'Swaps phrases such as "circle back" or "ping me" for plain alternatives from a reviewed word list.',
    neverChanges: 'Never changes names, numbers, links, dates or negatives.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'CM2', group: 'communication', type: 'transform', priority: 25, name: 'Short sentences',
    summary: 'Split long sentences into shorter ones.',
    changes: 'Splits sentences longer than the agreed length where they join two complete thoughts.',
    neverChanges: 'Never splits lists or conditions ("if", "when") in a way that changes their meaning.',
    params: [{ key: 'maxWords', label: 'Longest sentence (words)', kind: 'number', default: 20, min: 8, max: 40, unit: 'words' }],
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'CM3', group: 'communication', type: 'transform', priority: 15, name: 'Abbreviations explained',
    summary: 'Explain abbreviations and acronyms the first time they appear.',
    changes: 'Adds the meaning in brackets, e.g. "EOD (end of day)", using a built-in list and the company glossary.',
    neverChanges: 'Never removes the original abbreviation.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'CM4', group: 'communication', type: 'transform', priority: 45, name: 'Key details first',
    summary: 'Start every task with what is being asked and when it is due.',
    changes: 'Puts the task and its deadline at the top, before any other detail.',
    neverChanges: 'Never removes the rest of the message.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  // Meetings
  {
    code: 'MT1', group: 'meetings', type: 'schedule', priority: 70, name: 'Agenda a day ahead',
    summary: 'Share an agenda before every meeting.',
    changes: 'Reminds the organiser to add an agenda and sends it to the employee ahead of logged meetings.',
    neverChanges: 'Never changes the meeting time or who is invited.',
    params: [{ key: 'hoursBefore', label: 'Hours before the meeting', kind: 'number', default: 24, min: 2, max: 72, unit: 'hours' }],
    costLevel: 'none', typicalCost: 'A few minutes of organiser time', accessToWork: false,
  },
  {
    code: 'MT2', group: 'meetings', type: 'schedule', priority: 71, name: 'Written summary after verbal instructions',
    summary: 'Follow every verbal instruction or meeting with a written summary.',
    changes: 'Prompts the manager after logged meetings and lets them log a verbal instruction, which is sent in writing in the agreed format.',
    neverChanges: 'Never sends anything the manager did not write.',
    params: [{ key: 'delayMinutes', label: 'Minutes after the meeting', kind: 'number', default: 30, min: 5, max: 240, unit: 'minutes' }],
    costLevel: 'none', typicalCost: 'A few minutes of manager time', accessToWork: false,
  },
  // Record-only rules: agreed and reviewed, never applied to a task
  {
    code: 'CM5', group: 'communication', type: 'record', priority: 80, name: 'Written follow-up instead of phone calls',
    summary: 'Prefer written messages to unplanned phone calls.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'MT3', group: 'meetings', type: 'record', priority: 80, name: 'Camera optional in video calls',
    summary: 'Camera can stay off in internal video calls.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'MT4', group: 'meetings', type: 'record', priority: 80, name: 'Notice before being asked to present',
    summary: 'At least a day of notice before being asked to speak or present.',
    costLevel: 'none', typicalCost: 'No cost', accessToWork: false,
  },
  {
    code: 'EN1', group: 'environment', type: 'record', priority: 80, name: 'Quiet workspace',
    summary: 'A quieter place to work, or noise-cancelling headphones.',
    costLevel: 'low', typicalCost: 'Under £250 for headphones', accessToWork: true,
  },
  {
    code: 'EN2', group: 'environment', type: 'record', priority: 80, name: 'Flexible start time',
    summary: 'A later or flexible start and finish time.',
    costLevel: 'none', typicalCost: 'No direct cost', accessToWork: false,
  },
  {
    code: 'EN3', group: 'environment', type: 'record', priority: 80, name: 'Regular short breaks',
    summary: 'Short breaks at agreed intervals during the day.',
    costLevel: 'none', typicalCost: 'No direct cost', accessToWork: false,
  },
  {
    code: 'EN4', group: 'environment', type: 'record', priority: 80, name: 'Hybrid or home working',
    summary: 'Agreed days working from home.',
    costLevel: 'none', typicalCost: 'No direct cost', accessToWork: false,
  },
  {
    code: 'EN5', group: 'environment', type: 'record', priority: 80, name: 'Fixed desk',
    summary: 'The same desk every day rather than hot-desking.',
    costLevel: 'none', typicalCost: 'No direct cost', accessToWork: false,
  },
  {
    code: 'EQ1', group: 'equipment', type: 'record', priority: 80, name: 'Screen reader or text-to-speech software',
    summary: 'Software that reads text aloud.',
    costLevel: 'low', typicalCost: 'Free to around £300', accessToWork: true,
  },
  {
    code: 'EQ2', group: 'equipment', type: 'record', priority: 80, name: 'Speech-to-text software',
    summary: 'Dictation software for writing.',
    costLevel: 'low', typicalCost: 'Free to around £300', accessToWork: true,
  },
  {
    code: 'EQ3', group: 'equipment', type: 'record', priority: 80, name: 'Ergonomic equipment',
    summary: 'An adjustable chair, desk, keyboard or mouse.',
    costLevel: 'medium', typicalCost: '£100 to £1,000', accessToWork: true,
  },
  {
    code: 'EQ4', group: 'equipment', type: 'record', priority: 80, name: 'Larger or second screen',
    summary: 'A larger monitor or a second screen.',
    costLevel: 'low', typicalCost: '£100 to £300', accessToWork: true,
  },
].map((r) => ({ changes: '', neverChanges: '', params: [], source: DRAFT, reviewedBy: '', ...r }));
