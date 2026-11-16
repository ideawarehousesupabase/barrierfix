import mongoose, { Schema } from 'mongoose';

// Text-free record of each brief so KPIs survive the 30-day deletion of brief text.
const briefMetricSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    briefId: { type: Schema.Types.ObjectId, required: true, unique: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User' },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User' },
    source: String,
    isTask: Boolean,
    validatorPassed: Boolean,
    held: Boolean,
    ruleCodes: [String],
    processingMs: Number,
    employeeStatus: String,
    confirmed: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
    questioned: { type: Boolean, default: false },
    breakdownRequested: { type: Boolean, default: false },
    expiresAt: Date,
  },
  { timestamps: true },
);

briefMetricSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
briefMetricSchema.index({ orgId: 1, createdAt: -1 });

export const BriefMetric = mongoose.model('BriefMetric', briefMetricSchema);
