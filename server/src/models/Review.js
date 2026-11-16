import mongoose, { Schema } from 'mongoose';

// Reviews at 2, 6 and 12 weeks after a rule is agreed: two questions for the
// employee, one for the manager.
const reviewSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    ruleCode: { type: String, required: true },
    ruleName: String,
    stageWeeks: { type: Number, enum: [2, 6, 12], required: true },
    dueAt: { type: Date, required: true },
    status: { type: String, enum: ['scheduled', 'open', 'completed', 'cancelled'], default: 'scheduled' },
    openedAt: Date,
    // One reminder only, to whoever has not answered by then.
    reminderSentAt: Date,
    employee: {
      helping: { type: String, enum: ['yes', 'partly', 'no'], default: undefined },
      next: { type: String, enum: ['keep', 'change', 'stop'], default: undefined },
      comment: { type: String, default: '', maxlength: 1000 },
      answeredAt: Date,
    },
    manager: {
      practical: { type: String, enum: ['yes', 'with_difficulty', 'no'], default: undefined },
      comment: { type: String, default: '', maxlength: 1000 },
      answeredAt: Date,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

reviewSchema.index({ status: 1, dueAt: 1 });
reviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Review = mongoose.model('Review', reviewSchema);
