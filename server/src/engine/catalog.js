// The rules the engine knows how to apply, with their default parameters.
// Wording, cost and review details for each rule live in content/ruleLibrary.js.
export const ENGINE_RULES = {
  TS1: { name: 'Numbered steps', kind: 'transform', params: {} },
  TS2: { name: 'One-line "Done when"', kind: 'transform', params: {} },
  TS3: { name: 'One task per message', kind: 'transform', params: {} },
  TM1: { name: 'Deadline as a day, date and time', kind: 'transform', params: {} },
  TM2: { name: 'Interim check-in before the deadline', kind: 'schedule', params: { daysBefore: 1, time: '12:00' } },
  TM3: { name: 'Reminder before the deadline', kind: 'schedule', params: { hoursBefore: 2 } },
  CM1: { name: 'Plain language', kind: 'transform', params: {} },
  CM2: { name: 'Short sentences', kind: 'transform', params: { maxWords: 20 } },
  CM3: { name: 'Abbreviations explained', kind: 'transform', params: {} },
  CM4: { name: 'Key details first', kind: 'transform', params: {} },
  TS4: { name: 'Written instructions', kind: 'transform', params: {} },
  TM4: { name: 'Due date required', kind: 'requirement', params: {} },
  TM5: { name: 'Due time required', kind: 'requirement', params: {} },
  PR1: { name: 'Task priority required', kind: 'requirement', params: {} },
  MT1: { name: 'Agenda a day ahead', kind: 'meeting', params: { hoursBefore: 24 } },
  MT2: { name: 'Written summary after verbal instructions', kind: 'meeting', params: { delayMinutes: 30 } },
};

// Rules that change how a brief is written or timed (MT1/MT2 act on meetings instead).
export const BRIEF_RULE_CODES = ['TS1', 'TS2', 'TS3', 'TS4', 'TM1', 'TM2', 'TM3', 'TM4', 'TM5', 'PR1', 'CM1', 'CM2', 'CM3', 'CM4'];

export const ruleName = (code) => ENGINE_RULES[code]?.name || code;

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

// Turns a profile's agreed rules into { CODE: params } with defaults filled in.
export function normaliseRules(profileRules = []) {
  const out = {};
  for (const rule of profileRules) {
    const code = String(rule.code || '').toUpperCase();
    if (!BRIEF_RULE_CODES.includes(code)) continue;
    const params = { ...ENGINE_RULES[code].params, ...(rule.params || {}) };
    if (code === 'TM2') {
      params.daysBefore = clampNumber(params.daysBefore, 1, 1, 10);
      if (!/^\d{1,2}:\d{2}$/.test(String(params.time))) params.time = '12:00';
    }
    if (code === 'TM3') params.hoursBefore = clampNumber(params.hoursBefore, 2, 1, 72);
    if (code === 'CM2') params.maxWords = clampNumber(params.maxWords, 20, 8, 40);
    out[code] = params;
  }
  return out;
}
