import mongoose, { Schema } from 'mongoose';
import { BRIEF_SOURCES } from '../config/constants.js';

const threadSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: { type: String, enum: ['question', 'answer', 'flag', 'note', 'breakdown'] },
    text: { type: String, maxlength: 4000 },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

// A manager's brief and its translation. The text is deleted 30 days after it is
// created (TTL index on expiresAt); the numbers live on in BriefMetric.
const briefSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: BRIEF_SOURCES, default: 'web' },
    slack: {
      teamId: String,
      channelId: String,
      ts: String,
      threadTs: String,
      dmChannelId: String,
      dmTs: [String],
      // The selected message exactly as Slack sent it (before names and links were made readable).
      rawText: { type: String, maxlength: 8000 },
    },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: undefined },
    // Did the Slack DM arrive? In-app delivery always happens; this records a Slack failure after retries.
    delivery: { slack: { type: String, enum: ['sent', 'failed', 'skipped'], default: undefined }, at: Date },
    originalText: { type: String, required: true, maxlength: 8000 },
    sentAt: { type: Date, default: Date.now },
    detection: { isTask: Boolean, score: Number, signals: [String] },
    result: { type: Schema.Types.Mixed }, // engine output: cards, sections, applied rules, changes
    translatedText: { type: String, maxlength: 12000 },
    appliedRules: [{ code: String, name: String, effect: String, _id: false }],
    validator: {
      passed: Boolean,
      checks: [{ key: String, label: String, passed: Boolean, detail: String, _id: false }],
    },
    status: {
      type: String,
      enum: ['draft', 'delivered', 'held', 'approved', 'original_sent', 'not_task', 'superseded', 'cancelled'],
      default: 'delivered',
    },
    deliveredVersion: { type: String, enum: ['translated', 'original', 'manager_edited'], default: 'translated' },
    managerEditedText: String,
    employeeStatus: { type: String, enum: ['new', 'seen', 'confirmed', 'question', 'flagged'], default: 'new' },
    breakdown: { requestedAt: Date, result: Schema.Types.Mixed },
    thread: { type: [threadSchema], default: [] },
    flag: { reason: String, at: Date },
    supersedes: { type: Schema.Types.ObjectId, ref: 'Brief' },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'Brief' },
    processingMs: Number,
    engine: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

briefSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
briefSchema.index({ orgId: 1, employeeId: 1, createdAt: -1 });
briefSchema.index({ orgId: 1, managerId: 1, createdAt: -1 });
briefSchema.index({ 'slack.channelId': 1, 'slack.ts': 1 });

export const Brief = mongoose.model('Brief', briefSchema);
