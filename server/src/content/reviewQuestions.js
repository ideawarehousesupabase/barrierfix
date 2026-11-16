// Review check-ins at 2, 6 and 12 weeks: two questions for the employee, one for the manager.
export const REVIEW_QUESTIONS = {
  employee: [
    {
      key: 'helping',
      text: 'Is this adjustment helping you do your work?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'partly', label: 'Partly' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      key: 'next',
      text: 'What should happen next?',
      options: [
        { value: 'keep', label: 'Keep it as it is' },
        { value: 'change', label: 'Change it' },
        { value: 'stop', label: 'Stop it' },
      ],
    },
  ],
  manager: [
    {
      key: 'practical',
      text: 'Is this adjustment practical to keep applying?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'with_difficulty', label: 'Yes, with some difficulty' },
        { value: 'no', label: 'No' },
      ],
    },
  ],
};
