import mongoose, { Schema } from 'mongoose';

const profileRuleSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true },
    params: { type: Schema.Types.Mixed, default: {} },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['proposed', 'agreed', 'removed'], default: 'proposed' },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    agreedAt: Date,
    agreedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    removedAt: Date,
    nextReviewAt: Date,
    needsRevision: { type: Boolean, default: false },
    // A change to an agreed rule waits here until the manager agrees it; the agreed
    // version keeps applying in the meantime.
    pending: { type: { params: Schema.Types.Mixed, note: String }, default: undefined },
    source: { type: String, enum: ['employee', 'decision', 'import'], default: 'employee' },
  },
  { _id: true },
);

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    action: String,
    detail: String,
  },
  { _id: false },
);

// The Adjustment Profile: work-format rules the employee controls. No diagnoses.
const profileSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    status: { type: String, enum: ['draft', 'proposed', 'agreed', 'changes_requested'], default: 'draft' },
    // An authorised admin can switch a profile off (no rules applied) and on again without losing it.
    active: { type: Boolean, default: true },
    deactivatedAt: Date,
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    consent: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      withdrawnAt: Date,
    },
    rules: { type: [profileRuleSchema], default: [] },
    extraViewerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    submittedAt: Date,
    agreedAt: Date,
    agreedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    managerComment: { type: String, default: '', maxlength: 1000 },
    history: { type: [historySchema], default: [] },
    retainUntil: { type: Date, index: true },
  },
  { timestamps: true },
);

profileSchema.methods.activeRules = function activeRules() {
  if (!this.consent?.given || this.active === false) return [];
  return this.rules.filter((r) => r.status === 'agreed');
};

export const Profile = mongoose.model('Profile', profileSchema);
