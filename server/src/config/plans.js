// Plan tiers from the business plan (Table 16). There is no payment gateway in the
// MVP: a Platform Admin sets each company's plan, and these flags switch features.
export const PLANS = {
  starter: {
    label: 'Starter',
    price: '£50 a month',
    staff: 'Up to 20 staff',
    features: {
      translation: false, // task translation (web, CSV and Slack)
      slack: false,
      jitPrompts: false, // check-ins, reminders, meeting prompts
      managerReports: false,
      firmAnalytics: false,
      auditExport: false,
    },
  },
  professional: {
    label: 'Professional',
    price: '£150 a month',
    staff: '21 to 99 staff',
    features: {
      translation: true,
      slack: true,
      jitPrompts: true,
      managerReports: true,
      firmAnalytics: false,
      auditExport: false,
    },
  },
  enterprise: {
    label: 'Enterprise',
    price: '£300 a month',
    staff: '100 to 249 staff',
    features: {
      translation: true,
      slack: true,
      jitPrompts: true,
      managerReports: true,
      firmAnalytics: true,
      auditExport: true,
    },
  },
};

export const PLAN_KEYS = Object.keys(PLANS);

export const FEATURE_LABELS = {
  translation: 'Task translation',
  slack: 'Slack integration',
  jitPrompts: 'Just-in-time prompts',
  managerReports: 'Manager reports',
  firmAnalytics: 'Firm-wide analytics',
  auditExport: 'Audit log export',
};

export function planFeatures(plan) {
  return (PLANS[plan] || PLANS.starter).features;
}

export function hasFeature(org, feature) {
  return Boolean(org && planFeatures(org.plan)[feature]);
}
