import { RULE_LIBRARY } from '../content/ruleLibrary.js';
import { Rule } from '../models/index.js';

// Adds any library rules missing from the database. With overwrite, also refreshes
// wording from content/ruleLibrary.js (keeping review details entered in the app).
export async function ensureRuleLibrary({ overwrite = false } = {}) {
  let added = 0;
  let updated = 0;
  for (const rule of RULE_LIBRARY) {
    const existing = await Rule.findOne({ code: rule.code });
    if (!existing) {
      await Rule.create(rule);
      added += 1;
    } else if (!overwrite && rule.params && JSON.stringify(existing.toObject().params || []) !== JSON.stringify(rule.params)) {
      // Settings (which values a rule takes, their limits and labels) are defined by the engine code and
      // cannot be edited in the app, so they always follow the code. Wording edited in the app is kept.
      await Rule.updateOne({ _id: existing._id }, { $set: { params: rule.params } });
    } else if (overwrite) {
      const { reviewedBy, reviewedAt, ...wording } = rule;
      Object.assign(existing, wording);
      existing.version += 1;
      await existing.save();
      updated += 1;
    }
  }
  return { added, updated };
}
