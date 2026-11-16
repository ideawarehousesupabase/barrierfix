import mongoose, { Schema } from 'mongoose';

const notificationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 2000 },
    link: { type: String, default: '' },
    readAt: Date,
  },
  { timestamps: true },
);

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const Notification = mongoose.model('Notification', notificationSchema);
