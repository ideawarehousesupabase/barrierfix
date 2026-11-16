import { FACTOR_KEYS } from '../../content/decisionFactors.js';
import { DecisionRecord } from '../../models/index.js';

// Converts adjustment requests saved in the earlier format (factors first, then a proposed decline) to
// the simple request flow. Runs at start-up; a record is converted once. Earlier answers are kept.
const STATUS = {
  requested: 'pending',
  in_progress: 'pending',
  considering_decline: 'pending',
  proposed_decline: 'hr_review',
  ready_for_decision: 'hr_review',
  withdrawn: 'withdrawn',
};
const ANSWER_LABEL = { yes: 'Yes', partly: 'Partly', no: 'No', unsure: 'Not sure' };

export async function migrateOldRequests() {
  const col = DecisionRecord.collection;
  const old = await col.find({ requesterId: { $exists: false } }).toArray();
  for (const d of old) {
    const byManager = d.request?.requestedBy === 'manager';
    let status = STATUS[d.status] || 'pending';
    let response;
    if (d.status === 'decided') {
      const declined = d.outcome?.decision === 'declined';
      status = declined ? 'rejected' : 'accepted';
      response = { decision: declined ? 'rejected' : 'accepted', comment: d.outcome?.reason || '', by: d.outcome?.decidedBy || d.managerId, at: d.outcome?.decidedAt || d.updatedAt };
    } else if (status === 'hr_review') {
      response = { decision: 'rejected', comment: d.proposal?.reason || '', by: d.proposal?.proposedBy || d.managerId, at: d.proposal?.proposedAt || d.updatedAt };
    }
    const answers = {};
    for (const key of FACTOR_KEYS) {
      const f = d.factors?.[key];
      const text = [ANSWER_LABEL[f?.answer], f?.reason].filter(Boolean).join(': ');
      if (text) answers[key] = { text, by: f.enteredBy || d.managerId, at: f.enteredAt || d.updatedAt };
    }
    await col.updateOne(
      { _id: d._id },
      {
        $set: {
          requesterId: byManager ? d.managerId : d.employeeId,
          recipientId: byManager ? d.employeeId : d.managerId,
          direction: byManager ? 'to_employee' : 'to_manager',
          status,
          'request.details': [d.request?.description, d.request?.howItHelps].filter(Boolean).join('\n\n'),
          answers,
          hrSteps: [],
          ...(response ? { response } : {}),
        },
        $unset: { factors: '', alternatives: '', alternativesNote: '', employeeInput: '', proposal: '', outcome: '', hr: '', reconsideration: '', 'request.description': '', 'request.howItHelps': '', 'request.ruleCode': '', 'request.requestedBy': '' },
      },
    );
  }
  return old.length;
}
