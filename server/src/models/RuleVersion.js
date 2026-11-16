import mongoose, { Schema } from 'mongoose';
import { makeAppendOnly } from './appendOnly.js';

// A snapshot of an adjustment library entry each time it is created or changed.
const ruleVersionSchema = new Schema({
  code: { type: String, required: true, index: true },
  version: { type: Number, required: true },
  by: { type: String },
  at: { type: Date, default: Date.now },
  snapshot: { type: Schema.Types.Mixed, required: true },
});

ruleVersionSchema.index({ code: 1, version: -1 });
makeAppendOnly(ruleVersionSchema, 'The adjustment library history');

export const RuleVersion = mongoose.model('RuleVersion', ruleVersionSchema);
