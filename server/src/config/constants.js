export const ROLES = ['employee', 'manager', 'hr', 'admin'];

export const ROLE_LABELS = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR / Operations',
  admin: 'Company Admin',
};

export const RULE_GROUPS = ['task_structure', 'timing', 'communication', 'meetings', 'environment', 'equipment'];

export const RULE_GROUP_LABELS = {
  task_structure: 'Task structure',
  timing: 'Timing',
  communication: 'Communication',
  meetings: 'Meetings',
  environment: 'Environment',
  equipment: 'Equipment',
};

// transform = changes how a task is written; schedule = creates timed prompts;
// record = agreed and reviewed, but never changes a task (e.g. a quiet desk).
export const RULE_TYPES = ['transform', 'schedule', 'record'];

export const BANK_HOLIDAY_REGIONS = ['england-and-wales', 'scotland', 'northern-ireland'];

export const BRIEF_SOURCES = ['web', 'csv', 'slack', 'verbal', 'meeting_summary'];

export const REVIEW_STAGES_WEEKS = [2, 6, 12];
