import mongoose, { Schema } from 'mongoose';

// Meetings are logged by hand in the MVP (no calendar integration). They drive the
// "agenda a day ahead" and "written summary afterwards" prompts.
const meetingSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    organizerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    attendeeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    agenda: { type: String, default: '', maxlength: 4000 },
    agendaSharedAt: Date,
    summary: { type: String, default: '', maxlength: 6000 },
    summarySentAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true },
);

export const Meeting = mongoose.model('Meeting', meetingSchema);
