import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
const { mentionPreviewBlocks } = await import('../src/integrations/slack/blocks.js');

const base = { draftId: 'abc123', employeeName: 'Jordan Lee', mrkdwn: '*Task:* Send the invoice\n*Due:* Friday 4 January 2030 at 3pm', held: false, priorityLabel: 'High', missing: [] };
const buttons = (blocks) => blocks.find((b) => b.type === 'actions')?.elements ?? [];
const allText = (blocks) => JSON.stringify(blocks);

test('the @mention preview offers Confirm, Edit and Cancel for this draft', () => {
  const blocks = mentionPreviewBlocks(base);
  assert.deepEqual(buttons(blocks).map((b) => b.action_id), ['bf_mention_confirm', 'bf_mention_edit', 'bf_mention_cancel']);
  assert.ok(buttons(blocks).every((b) => b.value === 'abc123'), 'every button carries the draft id');
  const text = allText(blocks);
  assert.match(text, /Jordan Lee will receive/);
  assert.match(text, /Send the invoice/);
  assert.match(text, /Priority: High/);
  assert.match(text, /Outcome check passed/);
  assert.match(text, /Nothing has been sent yet/);
});

test('the preview asks for missing details instead of offering Confirm', () => {
  const blocks = mentionPreviewBlocks({ ...base, missing: [{ key: 'deadlineDate', question: 'What is the due date?' }, { key: 'priority', question: 'How urgent is this task?' }] });
  assert.deepEqual(buttons(blocks).map((b) => b.action_id), ['bf_mention_details', 'bf_mention_edit', 'bf_mention_cancel']);
  const text = allText(blocks);
  assert.match(text, /What is the due date\?/);
  assert.match(text, /How urgent is this task\?/);
  assert.ok(!text.includes('bf_mention_confirm'), 'a task with missing details cannot be confirmed');
});

test('the preview warns when the Outcome Validator held the formatted version', () => {
  const text = allText(mentionPreviewBlocks({ ...base, held: true }));
  assert.match(text, /could not safely reformat/);
  assert.ok(!/Outcome check passed/.test(text));
});
