import mongoose, { Schema } from 'mongoose';
import { RULE_GROUPS, RULE_TYPES } from '../config/constants.js';

const paramSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    kind: { type: String, enum: ['number', 'time', 'text'], default: 'number' },
    default: Schema.Types.Mixed,
    min: Number,
    max: Number,
    unit: String,
  },
  { _id: false },
);

// The adjustment library: global, versioned, each entry showing its source and reviewer.
const ruleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    group: { type: String, enum: RULE_GROUPS, required: true },
    type: { type: String, enum: RULE_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    changes: { type: String, default: '' },
    neverChanges: { type: String, default: '' },
    params: { type: [paramSchema], default: [] },
    priority: { type: Number, default: 50 },
    typicalCost: { type: String, default: '' },
    costLevel: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'none' },
    accessToWork: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    // Only approved entries are offered as alternatives in a Decision Record.
    approved: { type: Boolean, default: true },
    retiredAt: Date,
    version: { type: Number, default: 1 },
    source: { type: String, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewedAt: Date,
  },
  { timestamps: true },
);

export const Rule = mongoose.model('Rule', ruleSchema);
