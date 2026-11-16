import mongoose, { Schema } from 'mongoose';
import { PLAN_KEYS } from '../config/plans.js';
import { BANK_HOLIDAY_REGIONS } from '../config/constants.js';
import { SystemState } from './misc.js';

const glossarySchema = new Schema({ term: { type: String, trim: true }, meaning: { type: String, trim: true } }, { _id: false });

const organizationSchema = new Schema(
  {
    // The readable Organisation ID (BF-000001, BF-000002, ...). Given once and never changed.
    orgNumber: { type: String, unique: true, sparse: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    plan: { type: String, enum: PLAN_KEYS, default: 'professional' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    staffCount: { type: Number, min: 1, max: 100000 },
    sector: { type: String, trim: true, maxlength: 80 },
    settings: {
      timezone: { type: String, default: 'Europe/London' },
      workdayStart: { type: String, default: '09:00' },
      // Also the default deadline time when a brief gives a day but no time.
      workdayEnd: { type: String, default: '17:00' },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // ISO weekdays, 1 = Monday
      bankHolidayRegion: { type: String, enum: BANK_HOLIDAY_REGIONS, default: 'england-and-wales' },
      digestEnabled: { type: Boolean, default: true },
    },
    glossary: { type: [glossarySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    planChangedAt: Date,
    planChangedBy: String,
  },
  { timestamps: true },
);

// Hands out the next number from a single counter, so two companies can never get the same one.
export async function nextOrgNumber() {
  const counter = await SystemState.findOneAndUpdate({ key: 'counter:orgNumber' }, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `BF-${String(counter.value).padStart(6, '0')}`;
}

organizationSchema.pre('save', async function giveOrgNumber() {
  if (this.isNew && !this.orgNumber) this.orgNumber = await nextOrgNumber();
});

export const Organization = mongoose.model('Organization', organizationSchema);

// Companies created before Organisation IDs existed get one, oldest first. Runs on start-up.
export async function ensureOrgNumbers() {
  const missing = await Organization.find({ orgNumber: { $exists: false } }).sort({ createdAt: 1 }).select('_id');
  for (const org of missing) {
    // orgNumber is immutable through Mongoose, so this one-off fill goes to the collection directly.
    await Organization.collection.updateOne({ _id: org._id, orgNumber: { $exists: false } }, { $set: { orgNumber: await nextOrgNumber() } });
  }
  return missing.length;
}
