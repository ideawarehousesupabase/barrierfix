// Block Kit messages for Slack. Section text is limited to 3000 characters.
function chunk(text, size = 2900) {
  const out = [];
  let current = '';
  for (const line of String(text || '').split('\n')) {
    if ((current + line).length > size && current) {
      out.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line}`;
  }
  if (current) out.push(current);
  return out.length ? out : [' '];
}

const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text } });
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
const button = (text, actionId, value, extra = {}) => ({ type: 'button', text: { type: 'plain_text', text, emoji: true }, action_id: actionId, value: String(value), ...extra });

const STATUS_TEXT = {
  confirmed: ':white_check_mark: You confirmed this task.',
  question: ':speech_balloon: Your question was sent to your manager.',
  flagged: ':triangular_flag_on_post: You flagged this translation. Your manager has been told.',
  superseded: ':arrows_counterclockwise: This task was updated. See the newer message.',
  cancelled: ':no_entry_sign: This task was withdrawn by your manager.',
};

/**
 * mode: 'translated' (the employee's agreed format), 'original' (held by the Outcome
 * Validator), or 'edited' (wording checked and edited by the manager).
 */
export function taskBlocks({ briefId, managerName, card, mode = 'translated', appliedRules = [], originalText, appUrl, status }) {
  const of = card && card.total > 1 ? ` (${card.index + 1} of ${card.total})` : '';
  const blocks = [section(`*New task from ${managerName}*${of}${mode === 'original' ? ' (original wording)' : ''}`)];
  if (mode === 'original') {
    blocks.push(context(`BarrierFix could not safely reformat this task, so here is ${managerName}'s original wording. ${managerName} has been asked to check the formatted version.`));
    chunk(originalText).forEach((c) => blocks.push(section(c)));
  } else if (mode === 'edited') {
    chunk(card.mrkdwn).forEach((c) => blocks.push(section(c)));
    blocks.push(context(`${managerName} checked and edited this version for you.`));
  } else {
    chunk(card.mrkdwn).forEach((c) => blocks.push(section(c)));
    const names = appliedRules.map((r) => r.name).join(' · ');
    if (names) blocks.push(context(`Your agreed format: ${names}`));
    blocks.push(context(':white_check_mark: Outcome check: the goal, deadline and deliverable are unchanged.'));
  }
  if (status && STATUS_TEXT[status]) {
    blocks.push(context(STATUS_TEXT[status]));
    blocks.push({ type: 'actions', elements: [button('Open in BarrierFix', 'bf_open', briefId, { url: `${appUrl}/tasks/${briefId}` })] });
    return blocks;
  }
  const actions = [
    button('Confirm', 'bf_confirm', briefId, { style: 'primary' }),
    button('Ask a question', 'bf_ask', briefId),
    button('Break it down', 'bf_breakdown', briefId),
  ];
  if (mode !== 'original') actions.push(button('Flag as wrong', 'bf_flag', briefId), button('Show original', 'bf_original', briefId));
  actions.push(button('Open in BarrierFix', 'bf_open', briefId, { url: `${appUrl}/tasks/${briefId}` }));
  blocks.push({ type: 'actions', elements: actions });
  return blocks;
}

export function managerConfirmation({ employeeName, brief, appUrl }) {
  const link = `<${appUrl}/tasks/${brief._id}|View side by side>`;
  if (brief.status === 'held') {
    return `:warning: BarrierFix held the formatted version for ${employeeName} because something did not match your original, so ${employeeName} received your original wording. ${link} to check it.`;
  }
  const n = brief.appliedRules?.length || 0;
  return `:white_check_mark: Delivered to ${employeeName} in their agreed format (${n} rule${n === 1 ? '' : 's'} applied). Outcome check passed: goal, deadline and deliverable unchanged. ${link}`;
}

export function textModal({ callbackId, title, label, briefId, placeholder, submit = 'Send', optional = false }) {
  return {
    type: 'modal',
    callback_id: callbackId,
    private_metadata: String(briefId),
    title: { type: 'plain_text', text: title },
    submit: { type: 'plain_text', text: submit },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'text',
        optional,
        label: { type: 'plain_text', text: label },
        element: { type: 'plain_text_input', action_id: 'value', multiline: true, ...(placeholder ? { placeholder: { type: 'plain_text', text: placeholder } } : {}) },
      },
    ],
  };
}

export function sendModal({ text, initialUser, channelId, messageTs }) {
  return {
    type: 'modal',
    callback_id: 'bf_send_modal',
    private_metadata: JSON.stringify({ channelId, messageTs }),
    title: { type: 'plain_text', text: 'Create structured task' },
    submit: { type: 'plain_text', text: 'Preview' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'employee',
        label: { type: 'plain_text', text: 'Who is this task for?' },
        element: { type: 'users_select', action_id: 'value', ...(initialUser ? { initial_user: initialUser } : {}) },
      },
      {
        type: 'input',
        block_id: 'text',
        label: { type: 'plain_text', text: 'Task' },
        element: { type: 'plain_text_input', action_id: 'value', multiline: true, initial_value: String(text || '').slice(0, 2900) },
      },
      context('You will see exactly what they will receive, and can edit or cancel, before anything is sent.'),
    ],
  };
}

const PRIORITY_OPTIONS = [
  { text: { type: 'plain_text', text: 'Low' }, value: 'low' },
  { text: { type: 'plain_text', text: 'Normal' }, value: 'normal' },
  { text: { type: 'plain_text', text: 'High' }, value: 'high' },
  { text: { type: 'plain_text', text: 'Urgent' }, value: 'urgent' },
];

// Asks the manager for the details this employee's profile requires and the message did not give.
// `state` (draft id and anything already chosen) travels in private_metadata.
export function missingInfoModal({ state, missing, employeeName }) {
  const blocks = [section(`${employeeName}'s agreed format needs a few more details before this task can be sent. BarrierFix does not guess them.`)];
  for (const item of missing) {
    if (item.input === 'date') {
      blocks.push({ type: 'input', block_id: item.key, label: { type: 'plain_text', text: item.question }, element: { type: 'datepicker', action_id: 'value' } });
    } else if (item.input === 'time') {
      blocks.push({ type: 'input', block_id: item.key, label: { type: 'plain_text', text: item.question }, element: { type: 'timepicker', action_id: 'value' } });
    } else if (item.input === 'priority') {
      blocks.push({ type: 'input', block_id: item.key, label: { type: 'plain_text', text: item.question }, element: { type: 'static_select', action_id: 'value', options: PRIORITY_OPTIONS } });
    }
  }
  return {
    type: 'modal',
    callback_id: 'bf_missing_modal',
    notify_on_close: true,
    private_metadata: JSON.stringify(state),
    title: { type: 'plain_text', text: 'A few more details' },
    submit: { type: 'plain_text', text: 'Preview' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

// The private preview a manager sees (only they) after @mentioning an employee in a channel.
// Nothing reaches the employee until the manager confirms. Every button carries the draft id.
export function mentionPreviewBlocks({ draftId, employeeName, mrkdwn, held, priorityLabel, missing = [] }) {
  const blocks = [section(`*${employeeName} will receive this once you confirm.* Nothing has been sent yet.`)];
  if (held) {
    blocks.push(context(`:warning: BarrierFix could not safely reformat this task: something in the formatted version did not match your wording. ${employeeName} would receive your original wording, and you would be asked to check the formatted version.`));
  } else {
    blocks.push(context(':white_check_mark: Outcome check passed: the goal, deadline and deliverable are unchanged.'));
  }
  chunk(mrkdwn).forEach((c) => blocks.push(section(c)));
  if (priorityLabel) blocks.push(context(`Priority: ${priorityLabel}`));
  if (missing.length) {
    blocks.push(section(`*${employeeName}'s agreed format needs a few more details first:*\n${missing.map((m) => `• ${m.question}`).join('\n')}`));
  }
  blocks.push({
    type: 'actions',
    elements: [
      missing.length ? button('Add details', 'bf_mention_details', draftId, { style: 'primary' }) : button('Confirm and send', 'bf_mention_confirm', draftId, { style: 'primary' }),
      button('Edit', 'bf_mention_edit', draftId),
      button('Cancel', 'bf_mention_cancel', draftId),
    ],
  });
  return blocks;
}

// The complete preview: exactly the message the employee will get. Nothing is sent until Confirm.
export function previewModal({ state, employeeName, mrkdwn, held, priorityLabel }) {
  const blocks = [section(`*This is what ${employeeName} will receive:*`)];
  if (held) {
    blocks.push(context(`:warning: BarrierFix could not safely reformat this task: something in the formatted version did not match your wording. ${employeeName} would receive your original wording, and you would be asked to check the formatted version.`));
  } else {
    blocks.push(context(':white_check_mark: Outcome check passed: the goal, deadline and deliverable are unchanged.'));
  }
  chunk(mrkdwn).forEach((c) => blocks.push(section(c)));
  if (priorityLabel) blocks.push(context(`Priority: ${priorityLabel}`));
  blocks.push({ type: 'actions', elements: [button('Edit', 'bf_preview_edit', state.draftId)] });
  return {
    type: 'modal',
    callback_id: 'bf_preview_modal',
    notify_on_close: true,
    private_metadata: JSON.stringify(state),
    title: { type: 'plain_text', text: 'Preview' },
    submit: { type: 'plain_text', text: 'Confirm and send' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}
