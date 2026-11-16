import mongoose, { Schema } from 'mongoose';
import { makeAppendOnly } from './appendOnly.js';

const factorPromptSchema = new Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    prompt: { type: String, required: true, maxlength: 2000 },
    help: { type: String, default: '', maxlength: 2000 },
    hasEstimate: Boolean,
    allowsNone: Boolean,
    hasAccessToWork: Boolean,
  },
  { _id: false },
);

// The decision prompts and guidance, versioned so each record shows the wording it was
// completed with. A change is a new version with an effective date and a change note;
// earlier versions are never edited.
const promptSetSchema = new Schema({
  version: { type: Number, required: true, unique: true },
  effectiveFrom: { type: Date, required: true, default: Date.now },
  changeNote: { type: String, required: true, maxlength: 1000 },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  factors: { type: [factorPromptSchema], required: true },
  disclaimer: { type: String, required: true, maxlength: 2000 },
});

makeAppendOnly(promptSetSchema, 'The decision prompt history');

export const DecisionPromptSet = mongoose.model('DecisionPromptSet', promptSetSchema);
