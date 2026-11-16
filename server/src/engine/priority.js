// Task priority is only ever what the manager said (or chose in a form). It is never inferred
// from tone or deadline, so "no priority given" is a normal answer.
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

// Checked in this order, so "not urgent" is low rather than urgent.
const PATTERNS = [
  ['low', /\b(low[- ]priority|no rush|not urgent|whenever you (get|have) (a )?(chance|time))\b/i],
  ['urgent', /\b(urgent|urgently|p0|p1)\b/i],
  ['high', /\b(high|top)[- ]priority\b/i],
  ['normal', /\b(normal|medium|standard)[- ]priority\b|\bp2\b/i],
];

export function detectPriority(text) {
  const source = String(text || '');
  for (const [priority, re] of PATTERNS) if (re.test(source)) return priority;
  return null;
}
