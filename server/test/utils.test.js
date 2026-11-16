import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
const { withRetry } = await import('../src/utils/retry.js');
const { redact, errorFields } = await import('../src/utils/logger.js');
const { generateTemporaryPassword } = await import('../src/utils/crypto.js');

const transient = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });

test('temporary failures are retried and permanent ones are not', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw transient;
      return 'sent';
    },
    { wait: async () => {} },
  );
  assert.equal(value, 'sent');
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(() => withRetry(async () => { calls += 1; throw transient; }, { attempts: 3, wait: async () => {} }), /timeout/);
  assert.equal(calls, 3, 'it gives up after the last attempt');

  calls = 0;
  const invalid = Object.assign(new Error('channel_not_found'), { code: 'slack_webapi_platform_error', data: { error: 'channel_not_found' } });
  await assert.rejects(() => withRetry(async () => { calls += 1; throw invalid; }, { wait: async () => {} }));
  assert.equal(calls, 1, 'a permanent error is not retried');

  const waits = [];
  const limited = Object.assign(new Error('rate limited'), { code: 'slack_webapi_rate_limited_error', retryAfter: 2 });
  await assert.rejects(() => withRetry(async () => { throw limited; }, { attempts: 2, wait: async (ms) => waits.push(ms) }));
  assert.deepEqual(waits, [2000], 'it respects Slack\'s Retry-After');
});

test('logs never contain task text, names, tokens or passwords', () => {
  const logged = redact({ briefId: 'abc', status: 200, text: 'Please send the invoice to Acme', originalText: 'secret task', botToken: 'xoxb-123', user: { email: 'a@b.test', name: 'Jordan', id: 'u1' }, long: 'x'.repeat(500) });
  assert.equal(logged.briefId, 'abc');
  assert.equal(logged.status, 200);
  assert.equal(logged.text, '[redacted]');
  assert.equal(logged.originalText, '[redacted]');
  assert.equal(logged.botToken, '[redacted]');
  assert.equal(logged.user.email, '[redacted]');
  assert.equal(logged.user.name, '[redacted]');
  assert.equal(logged.user.id, 'u1');
  assert.equal(logged.long, '[500 characters]');
  assert.deepEqual(errorFields(Object.assign(new Error('could not parse "Please send the invoice"'), { status: 500, code: 'X' })), { type: 'Error', status: 500, code: 'X' });
});

test('temporary passwords are long, mixed and different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const p = generateTemporaryPassword();
    assert.ok(p.length >= 12);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[0-9]/);
    assert.match(p, /[^A-Za-z0-9]/);
    assert.ok(!/[0OIl1]/.test(p), 'no look-alike characters');
    seen.add(p);
  }
  assert.equal(seen.size, 50);
});

test('a test run never uses the developer .env (no real database, sign-in, Slack or email)', async () => {
  const { config } = await import('../src/config/env.js');
  assert.equal(config.isTest, true);
  assert.equal(config.mongoUri, 'memory');
  assert.equal(config.email.host, '', 'no real SMTP server in tests');
  assert.equal(config.slack.enabled, false, 'no real Slack app in tests');
  assert.equal(config.firebase.clientEmail, '', 'no real Firebase service account in tests');
});

test('health check: says whether the database is reachable, so an uptime monitor can alert', async () => {
  const { healthReport } = await import('../src/utils/health.js');
  const up = healthReport(1);
  assert.equal(up.status, 200);
  assert.equal(up.body.ok, true);
  assert.equal(up.body.database, 'ok');
  for (const state of [0, 2, 3]) {
    const down = healthReport(state);
    assert.equal(down.status, 503, `connection state ${state}`);
    assert.equal(down.body.ok, false);
    assert.equal(down.body.database, 'unavailable');
  }
  assert.equal(JSON.stringify(healthReport(1).body).includes('mongodb'), false, 'no connection details are exposed');
});
