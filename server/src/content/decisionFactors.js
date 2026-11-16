// The six reasonableness factors, from the Employment Statutory Code of Practice.
// DRAFT wording: the business plan requires review by the retained employment law
// adviser before any customer uses these prompts. These are the defaults for the first
// version; a Platform Admin maintains later versions (each with an effective date and
// change note) under Platform > Decision prompts.
//
// The keys are fixed in code because the record and its checks depend on them.
export const DECISION_FACTORS = [
  {
    key: 'effectiveness',
    title: 'Would it work?',
    prompt: 'Would this adjustment be effective in reducing or removing the disadvantage the employee has described? Explain your reasoning.',
    help: 'Think about whether the change would make a real difference to how the employee can do their work.',
  },
  {
    key: 'practicability',
    title: 'Is it practical?',
    prompt: 'Is it practical to make this adjustment in the workplace? Explain how you reached that view.',
    help: 'Consider how easily it can be put in place and kept going in day-to-day work.',
  },
  {
    key: 'financialCost',
    title: 'What would it cost?',
    prompt: 'What is the expected financial cost of this adjustment? Enter or confirm an estimate and say where it came from.',
    help: 'Use a quote or a typical cost from the library if you have one. The library figures are indicative guidance, not a quote.',
    hasEstimate: true,
  },
  {
    key: 'otherImpact',
    title: 'Are there other costs or impacts?',
    prompt: 'Are there other costs or impacts that are not about money, such as technical difficulty or the effort of putting it in place? If there are none, say so.',
    help: 'Consider the effect on the team and on customers, and how it could be reduced.',
    allowsNone: true,
  },
  {
    key: 'employerResources',
    title: 'What resources does the business have?',
    prompt: 'What financial and other resources does the business have that are relevant to making this adjustment? Record your reasoning.',
    help: 'Larger costs may still be affordable for the business; record what was considered.',
  },
  {
    key: 'externalAssistance',
    title: 'Is outside help available?',
    prompt: 'Did you consider whether financial or other outside help might be available, for example through Access to Work? Record what you considered.',
    help: 'Access to Work can fund equipment, support workers and other adjustments. Eligibility is for the provider to decide and must be verified: BarrierFix does not decide it.',
    hasAccessToWork: true,
  },
];

export const FACTOR_KEYS = DECISION_FACTORS.map((f) => f.key);

export const FACTOR_ANSWERS = [
  { value: 'yes', label: 'Yes / favourable' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No / unfavourable' },
  { value: 'unsure', label: 'Not sure yet' },
];

export const DECISION_OUTCOMES = [
  { value: 'approved', label: 'Agree the adjustment as requested' },
  { value: 'approved_alternative', label: 'Agree an alternative adjustment' },
  { value: 'declined', label: 'Propose to decline the request (HR reviews it first)' },
];

export const ALTERNATIVE_STATUSES = [
  { value: 'considered', label: 'Considered' },
  { value: 'discussed', label: 'Discussed with the employee' },
  { value: 'rejected', label: 'Rejected' },
];

export const DECISION_DISCLAIMER =
  'BarrierFix helps you consider and record a decision. It does not give legal advice and does not decide whether an adjustment is reasonable. The decision rests with the named person who signs it. For contested cases, speak to your own employment adviser.';

export const ACCESS_TO_WORK_NOTE = 'Support such as Access to Work may be available. Eligibility must be verified with the provider: BarrierFix does not decide it.';

export const INDICATIVE_COST_LABEL = 'Indicative guidance only, not a quote';
