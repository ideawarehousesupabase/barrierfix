import mongoose, { Schema } from 'mongoose';

const SEVEN_YEARS_SECONDS = 7 * 365 * 24 * 3600;

// Append-only audit log of access and changes, kept for 7 years.
const auditLogSchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  actorEmail: String,
  action: { type: String, required: true },
  entity: String,
  entityId: String,
  meta: { type: Schema.Types.Mixed, default: {} },
  ip: String,
  at: { type: Date, default: Date.now },
});

auditLogSchema.index({ at: 1 }, { expireAfterSeconds: SEVEN_YEARS_SECONDS });
auditLogSchema.index({ orgId: 1, at: -1 });

const blockChange = function blockChange() {
  throw new Error('The audit log is append-only');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditLogSchema.pre(op, blockChange);
}
auditLogSchema.pre('save', function onlyInsert(next) {
  if (!this.isNew) return next(new Error('The audit log is append-only'));
  return next();
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
