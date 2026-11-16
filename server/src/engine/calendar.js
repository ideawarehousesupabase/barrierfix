import { DateTime } from 'luxon';

const parseHm = (hm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : fallback;
};

// Working-time arithmetic for one company: its timezone, hours, working days and
// UK bank holidays. Every function takes and returns Luxon DateTimes in that zone.
export function createCalendar({ timezone = 'Europe/London', workdayStart = '09:00', workdayEnd = '17:00', workingDays = [1, 2, 3, 4, 5], holidays = new Set() } = {}) {
  const start = parseHm(workdayStart, { hour: 9, minute: 0 });
  const end = parseHm(workdayEnd, { hour: 17, minute: 0 });
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];

  const zone = (dt) => (dt instanceof DateTime ? dt.setZone(timezone) : DateTime.fromJSDate(new Date(dt), { zone: timezone }));
  const atStart = (dt) => zone(dt).set({ ...start, second: 0, millisecond: 0 });
  const atEnd = (dt) => zone(dt).set({ ...end, second: 0, millisecond: 0 });
  const isWorkingDay = (dt) => days.includes(zone(dt).weekday) && !holidays.has(zone(dt).toISODate());

  function nextWorkingDay(dt) {
    let d = zone(dt).plus({ days: 1 });
    for (let i = 0; i < 30 && !isWorkingDay(d); i += 1) d = d.plus({ days: 1 });
    return d;
  }

  function previousWorkingDay(dt) {
    let d = zone(dt).minus({ days: 1 });
    for (let i = 0; i < 30 && !isWorkingDay(d); i += 1) d = d.minus({ days: 1 });
    return d;
  }

  function addWorkingDays(dt, n) {
    let d = zone(dt);
    for (let i = 0; i < n; i += 1) d = nextWorkingDay(d);
    return d;
  }

  function subtractWorkingDays(dt, n) {
    let d = zone(dt);
    for (let i = 0; i < n; i += 1) d = previousWorkingDay(d);
    return d;
  }

  function lastWorkingDayOfWeek(dt) {
    let d = zone(dt).endOf('week').startOf('day');
    for (let i = 0; i < 7 && !isWorkingDay(d); i += 1) d = d.minus({ days: 1 });
    return d;
  }

  function lastWorkingDayOfMonth(dt) {
    let d = zone(dt).endOf('month').startOf('day');
    for (let i = 0; i < 31 && !isWorkingDay(d); i += 1) d = d.minus({ days: 1 });
    return d;
  }

  // The next moment that is inside working hours (dt itself if it already is).
  function clampToWorkingTime(dt) {
    let d = zone(dt);
    if (isWorkingDay(d) && d >= atStart(d) && d < atEnd(d)) return d;
    if (isWorkingDay(d) && d < atStart(d)) return atStart(d);
    return atStart(nextWorkingDay(d));
  }

  function workingMinutesBetween(a, b) {
    let cursor = clampToWorkingTime(a);
    const target = zone(b);
    let total = 0;
    for (let i = 0; i < 400 && cursor < target; i += 1) {
      const dayEnd = atEnd(cursor);
      const until = target < dayEnd ? target : dayEnd;
      total += Math.max(0, until.diff(cursor, 'minutes').minutes);
      cursor = atStart(nextWorkingDay(cursor));
    }
    return Math.round(total);
  }

  function addWorkingMinutes(dt, minutes) {
    let cursor = clampToWorkingTime(dt);
    let left = minutes;
    for (let i = 0; i < 400; i += 1) {
      const available = atEnd(cursor).diff(cursor, 'minutes').minutes;
      if (left <= available) return cursor.plus({ minutes: left });
      left -= available;
      cursor = atStart(nextWorkingDay(cursor));
    }
    return cursor;
  }

  // The moment `minutes` of working time before dt: evenings, weekends and bank holidays are skipped.
  function subtractWorkingMinutes(dt, minutes) {
    let cursor = zone(dt);
    // Start from the latest working moment at or before dt.
    if (!isWorkingDay(cursor) || cursor <= atStart(cursor)) cursor = atEnd(previousWorkingDay(cursor));
    else if (cursor > atEnd(cursor)) cursor = atEnd(cursor);
    let left = minutes;
    for (let i = 0; i < 400; i += 1) {
      const available = cursor.diff(atStart(cursor), 'minutes').minutes;
      if (left <= available) return cursor.minus({ minutes: left });
      left -= available;
      cursor = atEnd(previousWorkingDay(cursor));
    }
    return cursor;
  }

  return {
    timezone,
    start,
    end,
    zone,
    atStart,
    atEnd,
    isWorkingDay,
    nextWorkingDay,
    previousWorkingDay,
    addWorkingDays,
    subtractWorkingDays,
    lastWorkingDayOfWeek,
    lastWorkingDayOfMonth,
    clampToWorkingTime,
    workingMinutesBetween,
    addWorkingMinutes,
    subtractWorkingMinutes,
  };
}

const pad = (n) => String(n).padStart(2, '0');

export function formatTime(dt) {
  const h12 = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  const suffix = dt.hour < 12 ? 'am' : 'pm';
  return dt.minute === 0 ? `${h12}${suffix}` : `${h12}:${pad(dt.minute)}${suffix}`;
}

// "Thursday 24 September at 5pm" (the year is added when it is not the current one).
export function formatDateTime(dt, ref) {
  const d = dt.setLocale('en-GB');
  const year = ref && d.year !== ref.year ? ` ${d.year}` : '';
  return `${d.toFormat('cccc d LLLL')}${year} at ${formatTime(d)}`;
}

export function formatDate(dt, ref) {
  const d = dt.setLocale('en-GB');
  const year = ref && d.year !== ref.year ? ` ${d.year}` : '';
  return `${d.toFormat('cccc d LLLL')}${year}`;
}
