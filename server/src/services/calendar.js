import { createCalendar } from '../engine/calendar.js';
import { getHolidays } from '../integrations/bankHolidays.js';

// The company's working-time calendar (hours, working days, UK bank holidays).
export async function calendarForOrg(org) {
  const s = org?.settings || {};
  const holidays = await getHolidays(s.bankHolidayRegion || 'england-and-wales');
  return {
    holidays,
    cal: createCalendar({ timezone: s.timezone, workdayStart: s.workdayStart, workdayEnd: s.workdayEnd, workingDays: s.workingDays, holidays }),
  };
}
