import mongoose, { Schema } from 'mongoose';
import { ROLES } from '../config/constants.js';

const userSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true, default: null },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, trim: true, default: '', maxlength: 120 },
    jobTitle: { type: String, trim: true, default: '', maxlength: 120 },
    roles: { type: [{ type: String, enum: ROLES }], default: ['employee'] },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    slackUserId: { type: String, default: null, index: true },
    firebaseUid: { type: String, default: undefined, unique: true, sparse: true },
    status: { type: String, enum: ['active', 'disabled', 'left'], default: 'active' },
    // Accounts are created by an admin with a temporary password that must be replaced at first login.
    mustChangePassword: { type: Boolean, default: false },
    temporaryPasswordSetAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    employmentEndedAt: Date,
    preferences: {
      textScale: { type: Number, default: 1, min: 0.85, max: 1.6 },
      contrast: { type: String, enum: ['normal', 'high'], default: 'normal' },
      font: { type: String, enum: ['default', 'readable'], default: 'default' },
      reduceMotion: { type: Boolean, default: false },
    },
    lastLoginAt: Date,
    // Set when a leaver's data was erased on request; the record stays only as an anonymous placeholder.
    erasedAt: Date,
  },
  { timestamps: true },
);

userSchema.methods.hasRole = function hasRole(...roles) {
  return roles.some((r) => this.roles.includes(r));
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const { temporaryPasswordSetAt, invite, __v, ...rest } = this.toObject();
  return rest;
};

export const User = mongoose.model('User', userSchema);
