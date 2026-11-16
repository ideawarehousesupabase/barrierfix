import mongoose, { Schema } from 'mongoose';

// An adjustment request between an employee and their line manager (in either direction).
//
// Flow (agreed with the client, 16 Nov 2026):
//   pending      the person it was sent to accepts or rejects it, with a comment
//   accepted     closed; nothing else happens
//   hr_review    rejected: HR accepts the rejection (rejected) or sends it back (answering)
//   answering    whoever rejected answers the six questions, then it returns to HR (hr_final)
//   hr_final     HR accepts the rejection (rejected) or rejects it (overturned: the request stands)
//   withdrawn    the person who asked withdrew it before it was answered
//
// The six questions come from the Employment Statutory Code of Practice; their wording is versioned
// under Platform > Decision prompts and each record keeps the version it was answered with.

const answerSchema = new Schema(
  { text: { type: String, default: '', maxlength: 3000 }, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date },
  { _id: false },
);

const hrStepSchema = new Schema(
  {
    stage: { type: String, enum: ['first', 'final'], required: true },
    action: { type: String, enum: ['accept_rejection', 'send_back', 'reject_rejection'], required: true },
    comment: { type: String, default: '', maxlength: 2000 },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const historySchema = new Schema(
  { at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, detail: String },
  { _id: false },
);

const answerField = { type: answerSchema, default: undefined };

export const REQUEST_STATUSES = ['pending', 'accepted', 'hr_review', 'answering', 'hr_final', 'rejected', 'overturned', 'withdrawn'];
// Still waiting for somebody to act.
export const OPEN_REQUEST_STATUSES = ['pending', 'hr_review', 'answering', 'hr_final'];

const decisionRecordSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // The two people involved: the employee the adjustment is for, and their line manager.
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Who asked, and who answers. One is the employee and the other the manager.
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    direction: { type: String, enum: ['to_manager', 'to_employee'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    promptVersion: { type: Number, default: 1 },
    version: { type: Number, default: 0 },
    request: {
      title: { type: String, required: true, maxlength: 200 },
      details: { type: String, default: '', maxlength: 3000 },
    },
    status: { type: String, enum: REQUEST_STATUSES, default: 'pending', index: true },
    response: {
      decision: { type: String, enum: ['accepted', 'rejected'], default: undefined },
      comment: { type: String, default: '', maxlength: 2000 },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    // The six questions, answered by whoever rejected the request when HR sends it back.
    answers: {
      effectiveness: answerField,
      practicability: answerField,
      financialCost: answerField,
      otherImpact: answerField,
      employerResources: answerField,
      externalAssistance: answerField,
    },
    hrSteps: { type: [hrStepSchema], default: [] },
    lastReminderAt: Date,
    history: { type: [historySchema], default: [] },
    retainUntil: { type: Date, index: true },
  },
  { timestamps: true },
);

export const DecisionRecord = mongoose.model('DecisionRecord', decisionRecordSchema);
