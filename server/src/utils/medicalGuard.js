// BarrierFix stores work-format rules, never diagnoses. Free-text fields are checked
// against this list and the user is warned before saving (the plan's "no medical data").
export const MEDICAL_TERMS = [
  'adhd', 'autism', 'autistic', 'asperger', 'aspergers', 'dyslexia', 'dyslexic', 'dyspraxia',
  'dyscalculia', 'dysgraphia', 'tourette', 'tourettes', 'epilepsy', 'epileptic', 'seizure', 'seizures',
  'cerebral palsy', 'multiple sclerosis', 'parkinson', 'parkinsons', 'diabetes', 'diabetic',
  'cancer', 'chemotherapy', 'arthritis', 'fibromyalgia', 'lupus', 'crohn', 'crohns', 'ibs', 'migraine',
  'migraines', 'depression', 'depressed', 'anxiety disorder', 'bipolar', 'ptsd', 'ocd', 'schizophrenia',
  'eating disorder', 'anorexia', 'bulimia', 'long covid', 'chronic fatigue', 'me/cfs', 'hiv', 'stroke',
  'diagnosis', 'diagnosed', 'diagnose', 'medication', 'medicine', 'prescription', 'prescribed',
  'antidepressant', 'antidepressants', 'therapy', 'therapist', 'psychiatrist', 'gp letter', 'fit note',
  'sick note', 'medical', 'condition', 'disorder', 'syndrome', 'symptom', 'symptoms', 'impairment',
  'disability', 'disabled', 'neurodivergent', 'mental health', 'hospital', 'surgery', 'treatment',
];

const patterns = MEDICAL_TERMS.map((term) => ({
  term,
  re: new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z]|$)`, 'i'),
}));

export function findMedicalTerms(text) {
  if (!text) return [];
  return patterns.filter(({ re }) => re.test(String(text))).map(({ term }) => term);
}

export const HEALTH_DETAIL_REMOVED = '[health detail removed]';

// Longest terms first, so "anxiety disorder" is masked as one phrase rather than two.
const maskPatterns = [...MEDICAL_TERMS]
  .sort((a, b) => b.length - a.length)
  .map((term) => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=[^a-z]|$)`, 'gi'));

// For exports: replaces health and medical terms, so records that leave the app carry no diagnosis by default.
export function maskMedical(text) {
  if (!text) return text;
  return maskPatterns.reduce((out, re) => out.replace(re, `$1${HEALTH_DETAIL_REMOVED}`), String(text));
}

export function medicalWarning(...texts) {
  const found = [...new Set(texts.flatMap((t) => findMedicalTerms(t)))];
  if (!found.length) return null;
  return {
    terms: found,
    message:
      'This looks like it may include health or medical information. BarrierFix only needs to know what helps you work, not why. Please describe the way of working instead.',
  };
}
