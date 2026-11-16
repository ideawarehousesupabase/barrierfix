import mongoose, { Schema } from 'mongoose';
import { makeAppendOnly } from './appendOnly.js';

// A full snapshot of a Decision Record after every material change. Snapshots are never
// updated or deleted, so an auditor can reconstruct the decision path and see later
// amendments without the original being overwritten. They go with the record when its
// retention period ends (retainUntil).
const versionSchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  recordId: { type: Schema.Types.ObjectId, ref: 'DecisionRecord', required: true, index: true },
  version: { type: Number, required: true },
  action: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
  snapshot: { type: Schema.Types.Mixed, required: true },
  retainUntil: { type: Date, index: true },
});

versionSchema.index({ recordId: 1, version: 1 }, { unique: true });
// Retention purges are the one allowed deletion (see retentionSweep); they use the collection directly.
makeAppendOnly(versionSchema, 'The decision record history');

export const DecisionRecordVersion = mongoose.model('DecisionRecordVersion', versionSchema);
