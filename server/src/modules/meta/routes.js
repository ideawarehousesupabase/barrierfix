import { Router } from 'express';
import { config } from '../../config/env.js';
import { BANK_HOLIDAY_REGIONS, ROLE_LABELS, RULE_GROUP_LABELS } from '../../config/constants.js';
import { FEATURE_LABELS, PLANS } from '../../config/plans.js';
import { DECISION_DISCLAIMER, DECISION_FACTORS, DECISION_OUTCOMES, FACTOR_ANSWERS } from '../../content/decisionFactors.js';
import { REVIEW_QUESTIONS } from '../../content/reviewQuestions.js';
import { getDevMailbox } from '../../integrations/email.js';
import { MEDICAL_TERMS } from '../../utils/medicalGuard.js';
import { ah } from '../../utils/http.js';

// Public reference data the client needs (labels, plans, wording).
export const metaRouter = Router();
metaRouter.get('/', (req, res) =>
  res.json({
    roles: ROLE_LABELS,
    ruleGroups: RULE_GROUP_LABELS,
    plans: PLANS,
    featureLabels: FEATURE_LABELS,
    bankHolidayRegions: BANK_HOLIDAY_REGIONS,
    medicalTerms: MEDICAL_TERMS,
    reviewQuestions: REVIEW_QUESTIONS,
    decision: { factors: DECISION_FACTORS, answers: FACTOR_ANSWERS, outcomes: DECISION_OUTCOMES, disclaimer: DECISION_DISCLAIMER },
  }),
);

// Development only: shows emails that would have been sent, plus the Firebase
// emulator's verification and password-reset links.
export const devRouter = Router();
devRouter.get(
  '/mailbox',
  ah(async (req, res) => {
    let authLinks = [];
    if (config.firebase.emulatorHost) {
      try {
        const r = await fetch(`http://${config.firebase.emulatorHost}/emulator/v1/projects/${config.firebase.projectId || 'demo-barrierfix'}/oobCodes`);
        const data = await r.json();
        authLinks = (data.oobCodes || []).reverse().map((c) => ({ email: c.email, type: c.requestType, link: c.oobLink }));
      } catch {
        authLinks = [];
      }
    }
    res.json({ emails: getDevMailbox(), authLinks });
  }),
);
