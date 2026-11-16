import { refreshBankHolidays } from '../integrations/bankHolidays.js';
import { activateDueReviews, remindUnansweredReviews } from '../modules/reviews/service.js';
import { processDuePrompts, remindIncompleteDecisions, retentionSweep, sendWeeklyDigests } from './handlers.js';

const MINUTE = 60 * 1000;

const JOBS = [
  { name: 'prompts', every: 0.5 * MINUTE, run: () => processDuePrompts() },
  { name: 'reviews', every: MINUTE, run: () => activateDueReviews() },
  { name: 'review-reminders', every: 6 * 60 * MINUTE, run: () => remindUnansweredReviews() },
  { name: 'digest', every: 15 * MINUTE, run: () => sendWeeklyDigests() },
  { name: 'decision-reminders', every: 6 * 60 * MINUTE, run: () => remindIncompleteDecisions() },
  { name: 'retention', every: 6 * 60 * MINUTE, run: () => retentionSweep() },
  { name: 'bank-holidays', every: 12 * 60 * MINUTE, run: () => refreshBankHolidays({ force: true }) },
];

const timers = [];

// Simple in-process scheduler. Each job is skipped if its previous run is still going.
export function startScheduler() {
  for (const job of JOBS) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        console.error(`[jobs] ${job.name} failed:`, err.message);
      } finally {
        running = false;
      }
    };
    timers.push(setTimeout(tick, 5000), setInterval(tick, job.every));
  }
}

export function stopScheduler() {
  while (timers.length) clearInterval(timers.pop());
}
