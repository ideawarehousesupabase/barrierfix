import { PLEASANTRY_ONLY } from './lexicon.js';
import { isRequest, startsWithInstruction, stripLead } from './analyse.js';
import { wordCount } from './text.js';

// Decides whether a chat message is a task worth translating. Messages typed into
// the web form or uploaded by CSV are tasks by definition; Slack messages are not.
export function detectTask(analysis, ctx) {
  const signals = [];
  let score = 0;
  const text = analysis.text;
  const lead = stripLead(text, ctx);
  if (isRequest(text)) {
    score += 2;
    signals.push('request phrase');
  }
  if (analysis.units.some((u) => startsWithInstruction(u.text, ctx))) {
    score += 2;
    signals.push('instruction');
  }
  if (analysis.mentions.some((m) => m.kind === 'date')) {
    score += 1;
    signals.push('date or deadline');
  }
  if (analysis.tasks.some((t) => t.vague)) {
    score += 1;
    signals.push('urgency');
  }
  if (wordCount(lead) < 3) {
    score -= 2;
    signals.push('very short');
  }
  if (!lead || PLEASANTRY_ONLY.test(text) || analysis.units.every((u) => PLEASANTRY_ONLY.test(u.text))) {
    score -= 3;
    signals.push('greeting or thanks only');
  }
  if (/^(?:fyi|just fyi|for your information|for info)\b/i.test(lead)) {
    score -= 1;
    signals.push('information only');
  }
  return { isTask: score >= 2, score, signals };
}
