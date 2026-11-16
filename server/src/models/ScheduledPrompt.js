import mongoose, { Schema } from 'mongoose';

// Just-in-time prompts: check-ins, deadline reminders, agenda and summary prompts.
// The scheduler claims due prompts atomically, so several server instances are safe.
const scheduledPromptSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    kind: {
      type: String,
      enum: ['checkin', 'deadline_reminder', 'agenda_request', 'agenda_share', 'summary_request'],
      required: true,
    },
    runAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'processing', 'sent', 'cancelled', 'failed'], default: 'pending' },
    briefId: { type: Schema.Types.ObjectId, ref: 'Brief' },
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
    recipientIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    payload: { type: Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    lastError: String,
    sentAt: Date,
  },
  { timestamps: true },
);

scheduledPromptSchema.index({ status: 1, runAt: 1 });

export const ScheduledPrompt = mongoose.model('ScheduledPrompt', scheduledPromptSchema);
