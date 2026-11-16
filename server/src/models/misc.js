import mongoose, { Schema } from 'mongoose';

// One Slack workspace per company. The bot token is encrypted at rest.
const slackInstallationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    teamId: { type: String, required: true, unique: true },
    teamName: String,
    enterpriseId: String,
    appId: String,
    botUserId: String,
    botId: String,
    botTokenEnc: { type: String, required: true },
    scopes: [String],
    installedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    installedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const SlackInstallation = mongoose.model('SlackInstallation', slackInstallationSchema);

// Results of running a CSV test set through the engine and validator.
const evaluationRunSchema = new Schema(
  {
    name: { type: String, default: 'Evaluation run' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    engine: String,
    summary: { type: Schema.Types.Mixed, default: {} },
    cases: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const EvaluationRun = mongoose.model('EvaluationRun', evaluationRunSchema);

// Key/value markers that make scheduled jobs idempotent (e.g. "digest sent for week 44").
const systemStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const SystemState = mongoose.model('SystemState', systemStateSchema);

// A company asking for a BarrierFix account through the public "request an account" form.
// A Platform Admin checks it, then approves (which creates the company and its admin) or rejects it.
const orgRequestSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    staffCount: { type: Number, min: 1, max: 100000 },
    sector: { type: String, trim: true, default: '', maxlength: 80 },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    jobTitle: { type: String, trim: true, default: '', maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true, default: '', maxlength: 40 },
    message: { type: String, trim: true, default: '', maxlength: 2000 },
    status: { type: String, enum: ['new', 'approved', 'rejected'], default: 'new', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    decisionNote: { type: String, default: '', maxlength: 1000 },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    // Set when a request is rejected: rejected requests are deleted 12 months later.
    expiresAt: Date,
  },
  { timestamps: true },
);

orgRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OrgRequest = mongoose.model('OrgRequest', orgRequestSchema);
