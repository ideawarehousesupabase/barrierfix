import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { DEADLINE_KEYWORD, EVENT_WORDS, VAGUE_DEADLINE } from './lexicon.js';

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const toNumber = (w) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w.toLowerCase()] ?? null);

const PERIOD_TIMES = [
  { re: /\bfirst thing\b|\bstart of (?:the )?day\b/i, time: 'start', label: 'start of the working day' },
  { re: /\b(?:morning)\b/i, time: { hour: 12, minute: 0 }, label: 'end of the morning' },
  { re: /\b(?:lunch|lunchtime)\b/i, time: { hour: 12, minute: 0 }, label: 'lunchtime' },
  { re: /\bafternoon\b/i, time: 'end', label: 'end of the afternoon' },
  { re: /\b(?:evening|tonight)\b/i, time: { hour: 18, minute: 0 }, label: 'early evening' },
];

const END_OF_DAY = /\b(?:eod|e\.o\.d\.?|end of (?:the )?(?:working |business )?day|cob|close of (?:business|play)|end of play|eop)\b/gi;

// Builds a JS Date whose *local* fields equal the company's wall-clock time, so chrono
// resolves "Thursday" or "tomorrow" relative to the company's day, not the server's.
function floatingDate(dt) {
  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second);
}

function fromComponents(c, tz) {
  return DateTime.fromObject(
    { year: c.get('year'), month: c.get('month'), day: c.get('day'), hour: c.get('hour'), minute: c.get('minute') || 0 },
    { zone: tz },
  );
}

const overlaps = (a, b) => a.index < b.index + b.length && b.index < a.index + a.length;

function classify(text, mention, now) {
  const before = text.slice(Math.max(0, mention.index - 40), mention.index);
  const keywordMatch = before.match(DEADLINE_KEYWORD);
  const keyword = keywordMatch ? keywordMatch[0].trim().toLowerCase() : null;
  const strongKeyword = keyword && !/^(?:on|at)\b/.test(keyword);
  const after = text.slice(mention.index + mention.length, mention.index + mention.length + 30);
  let kind = 'date';
  // A month on its own: after "by", "before" etc. it is a vague deadline ("by October"); otherwise it
  // only labels something ("the October numbers").
  if (mention.monthOnly) kind = strongKeyword ? 'vague' : 'reference';
  else if (mention.dt < now.minus({ minutes: 1 })) kind = 'past';
  // "Monday's workshop" names an event; it is not a deadline for the task.
  else if (/^'s\b/.test(after) || /^\s+(?:meeting|call|workshop|session|launch|event|presentation|demo|catch[- ]?up)\b/i.test(after)) kind = 'reference';
  else if (EVENT_WORDS.test(before.slice(-30)) && !strongKeyword) kind = 'event';
  else if (/\b(?:last|since|ago|from|yesterday)\s+$/i.test(before)) kind = 'past';
  const phraseStart = keywordMatch ? mention.index - keywordMatch[0].length : mention.index;
  return { ...mention, keyword, strongKeyword: Boolean(strongKeyword), kind, phrase: text.slice(phraseStart, mention.index + mention.length).trim() };
}

function applyPeriodWord(mention, cal) {
  for (const p of PERIOD_TIMES) {
    if (p.re.test(mention.text)) {
      const time = p.time === 'start' ? cal.start : p.time === 'end' ? cal.end : p.time;
      return { ...mention, dt: mention.dt.set({ ...time, second: 0, millisecond: 0 }), timeAssumed: true, timeLabel: p.label };
    }
  }
  return null;
}

// Finds every date or time a message mentions, resolved in the company's timezone.
export function findDateMentions(text, { now, cal }) {
  const tz = cal.timezone;
  const custom = [];
  const add = (index, length, dt, extra = {}) => custom.push({ index, length, text: text.substr(index, length), dt, timeCertain: false, timeAssumed: true, confidence: 'high', ...extra });
  let m;

  const eow = /\b(?:the\s+)?(?:end of (?:the |this )?week|eow)\b/gi;
  while ((m = eow.exec(text))) add(m.index, m[0].length, cal.atEnd(cal.lastWorkingDayOfWeek(now)), { timeLabel: 'end of the working day' });
  const eonw = /\b(?:the\s+)?end of next week\b/gi;
  while ((m = eonw.exec(text))) add(m.index, m[0].length, cal.atEnd(cal.lastWorkingDayOfWeek(now.plus({ weeks: 1 }))), { timeLabel: 'end of the working day' });
  const eom = /\b(?:the\s+)?(?:end of (?:the |this )?month|eom)\b/gi;
  while ((m = eom.exec(text))) add(m.index, m[0].length, cal.atEnd(cal.lastWorkingDayOfMonth(now)), { timeLabel: 'end of the working day' });
  const nextWeek = /\bnext week\b(?!\s+(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun))/gi;
  while ((m = nextWeek.exec(text))) {
    if (!/end of\s+$/i.test(text.slice(0, m.index))) add(m.index, m[0].length, cal.atEnd(cal.lastWorkingDayOfWeek(now.plus({ weeks: 1 }))), { confidence: 'low', note: '"next week" has no day, so the last working day of next week is used' });
  }
  const thisWeek = /\b(?:this|later this) week\b/gi;
  while ((m = thisWeek.exec(text))) add(m.index, m[0].length, cal.atEnd(cal.lastWorkingDayOfWeek(now)), { confidence: 'low', note: '"this week" has no day, so the last working day of this week is used' });
  const ordinal = /\b(?:the\s+)(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi;
  while ((m = ordinal.exec(text))) {
    const day = Number(m[1]);
    let dt = now.set({ day: Math.min(day, now.daysInMonth) });
    if (dt.startOf('day') < now.startOf('day')) dt = now.plus({ months: 1 }).set({ day });
    if (dt.isValid) add(m.index, m[0].length, cal.atEnd(dt));
  }
  const within = /\b(?:within|in)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(working |business )?(hours?|days?|weeks?)\b/gi;
  while ((m = within.exec(text))) {
    const n = toNumber(m[1]);
    if (!n) continue;
    const unit = m[3].toLowerCase();
    let dt;
    if (unit.startsWith('hour')) dt = now.plus({ hours: n });
    else if (unit.startsWith('week')) dt = cal.atEnd(now.plus({ weeks: n }));
    else dt = cal.atEnd(m[2] ? cal.addWorkingDays(now, n) : now.plus({ days: n }));
    add(m.index, m[0].length, dt, { timeCertain: unit.startsWith('hour'), timeAssumed: !unit.startsWith('hour') });
  }
  const firstThing = /\bfirst thing(?! (?:tomorrow|today|on|mon|tue|wed|thu|fri))\b/gi;
  while ((m = firstThing.exec(text))) add(m.index, m[0].length, cal.atStart(cal.nextWorkingDay(now)), { timeLabel: 'start of the working day' });

  const parsed = chrono.en.GB.parse(text, floatingDate(now), { forwardDate: true });
  const fromChrono = [];
  for (const r of parsed) {
    const mention = { index: r.index, length: r.text.length, text: r.text };
    if (custom.some((c) => overlaps(c, mention))) continue;
    if (/^(?:\d{1,3}|a|an|one|\d:\d)$/i.test(r.text.trim())) continue; // bare numbers and "1:1" are not dates
    // "Morning all!" is a greeting, not a time.
    if (/^(?:good\s+)?(?:morning|afternoon|evening)$/i.test(r.text.trim()) && /(?:^|[.!?\n]\s*)$/.test(text.slice(0, r.index))) continue;
    let dt = fromComponents(r.start, tz);
    // A month with no day ("the October numbers", "by October") names a period, not a moment. Only
    // "the end of October" can be pinned down; anything else is never turned into a deadline.
    const endOfMonth = /^(?:the\s+)?end of\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(r.text);
    if (endOfMonth || (r.start.isCertain('month') && !r.start.isCertain('day') && !r.start.isCertain('weekday'))) {
      if (endOfMonth || /end of\s+(?:the\s+)?$/i.test(text.slice(Math.max(0, r.index - 20), r.index))) {
        fromChrono.push({ ...mention, dt: cal.atEnd(cal.lastWorkingDayOfMonth(dt)), timeCertain: false, timeAssumed: true, confidence: 'high', timeLabel: 'end of the working day' });
      } else {
        fromChrono.push({ ...mention, dt, monthOnly: true, timeCertain: false, timeAssumed: true, confidence: 'low' });
      }
      continue;
    }
    // "by Monday" said on a Monday means next Monday, not today.
    if (r.start.isCertain('weekday') && !r.start.isCertain('day') && dt.hasSame(now, 'day') && !/\b(?:today|this)\b/i.test(r.text)) {
      dt = dt.plus({ weeks: 1 });
    }
    const timeCertain = r.start.isCertain('hour');
    let resolved = { ...mention, dt, timeCertain, timeAssumed: !timeCertain, confidence: 'high' };
    const period = !timeCertain && applyPeriodWord(resolved, cal);
    if (period) resolved = period;
    else if (!timeCertain) {
      dt = cal.atEnd(dt);
      resolved = { ...resolved, dt, timeLabel: 'end of the working day' };
    }
    fromChrono.push(resolved);
  }

  // "Friday EOD", "tomorrow COB": an end-of-day word sets the time of a nearby date.
  const all = [...custom, ...fromChrono];
  END_OF_DAY.lastIndex = 0;
  while ((m = END_OF_DAY.exec(text))) {
    const eod = { index: m.index, length: m[0].length };
    const near = all.find((x) => Math.abs(x.index - (eod.index + eod.length)) <= 12 || Math.abs(eod.index - (x.index + x.length)) <= 12);
    if (near) {
      const s = Math.min(near.index, eod.index);
      const e = Math.max(near.index + near.length, eod.index + eod.length);
      Object.assign(near, { index: s, length: e - s, text: text.slice(s, e), dt: cal.atEnd(near.dt), timeAssumed: false, timeLabel: undefined });
    } else {
      let dt = cal.atEnd(now);
      let note;
      if (now >= dt || !cal.isWorkingDay(now)) {
        dt = cal.atEnd(cal.nextWorkingDay(now));
        note = 'the working day had already ended, so the next working day is used';
      }
      all.push({ ...eod, text: m[0], dt, timeCertain: false, timeAssumed: false, confidence: note ? 'medium' : 'high', note });
    }
  }

  return all
    .filter((x) => x.dt && x.dt.isValid)
    .sort((a, b) => a.index - b.index)
    .map((x) => classify(text, x, now));
}

// Chooses the deadline for a stretch of text: dates introduced by "by", "before",
// "due" etc. win (the latest of them); otherwise a single plain date is used.
export function pickDeadline(mentions, { from = 0, to = Infinity } = {}) {
  const inRange = mentions.filter((x) => x.index >= from && x.index < to && x.kind === 'date');
  const keyed = inRange.filter((x) => x.strongKeyword);
  if (keyed.length) return [...keyed].sort((a, b) => b.dt - a.dt)[0];
  const softKeyed = inRange.filter((x) => x.keyword);
  if (softKeyed.length === 1) return { ...softKeyed[0], confidence: softKeyed[0].confidence === 'high' ? 'medium' : softKeyed[0].confidence };
  if (inRange.length === 1) return { ...inRange[0], confidence: inRange[0].confidence === 'high' ? 'medium' : inRange[0].confidence };
  return null;
}

export function findVagueDeadline(text) {
  const m = text.match(VAGUE_DEADLINE);
  return m ? m[0] : null;
}

export { DateTime };
