// Shared set-up for the integration test files. Each file gets its own in-memory MongoDB, a stubbed
// Firebase (a bearer token "test:<email>" is a verified user) and helpers to build a company.
// The developer .env is never read in tests (see config/env.js).
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PLATFORM_ADMIN_EMAILS = 'admin@simpliaccess.co.uk';

export const PLATFORM = 'admin@simpliaccess.co.uk';

export async function startApp() {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const request = (await import('supertest')).default;
  const mongo = await MongoMemoryServer.create();
  const { connectDatabase, disconnectDatabase } = await import('../src/db/connect.js');
  await connectDatabase(mongo.getUri('barrierfix-test'));

  const firebase = await import('../src/integrations/firebase.js');
  const passwordChangedAt = new Map();
  firebase.setPasswordChangeChecker(async (uid, since) => (passwordChangedAt.get(uid) || 0) > since);
  firebase.setTokenVerifier(async (token) => {
    const email = String(token).replace(/^test:/, '');
    return { uid: `test-${email}`, email, email_verified: true };
  });

  const { ensureRuleLibrary } = await import('../src/seed/rules.js');
  await ensureRuleLibrary();
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const models = await import('../src/models/index.js');

  const as = (email) => {
    const auth = (r) => (email ? r.set('Authorization', `Bearer test:${email}`) : r);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
      patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
      delete: (url) => auth(request(app).delete(url)),
    };
  };

  // The person replaces their temporary password in Firebase, then tells BarrierFix.
  async function changePassword(email) {
    passwordChangedAt.set(`test-${email}`, new Date(Date.now() + 1));
    const res = await as(email).post('/api/auth/password-changed');
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  // A company with its admin, ready to use (password already changed).
  async function createCompany(name, adminEmail, extra = {}) {
    const res = await as(PLATFORM).post('/api/platform/orgs', { name, admin: { email: adminEmail, name: `${name} Admin`, ...(extra.admin || {}) }, ...(extra.org || {}) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await changePassword(adminEmail);
    return res.body.org;
  }

  async function createPerson(creator, email, name, roles = ['employee'], managerId) {
    const res = await as(creator).post('/api/users', { email, name, roles, managerId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await changePassword(email);
    return res.body.user._id;
  }

  // Sends a task from the web the only way the app allows: preview it, then send that preview.
  // Returns the response to the send, so callers check its status and body as before.
  async function sendTask(senderEmail, body) {
    const preview = await as(senderEmail).post('/api/briefs/preview', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(preview.body.draftId, `no draft was made: ${JSON.stringify(preview.body).slice(0, 300)}`);
    return as(senderEmail).post('/api/briefs', { draftId: preview.body.draftId });
  }

  // The employee proposes rules with consent and their manager (or HR) agrees them.
  async function agreeProfile(employeeEmail, employeeId, agreerEmail, rules) {
    const put = await as(employeeEmail).put('/api/profiles/me', { rules });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const submitted = await as(employeeEmail).post('/api/profiles/me/submit', { consent: true });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const agreed = await as(agreerEmail).post(`/api/profiles/${employeeId}/agree`);
    assert.equal(agreed.status, 200, JSON.stringify(agreed.body));
    return agreed.body.profile;
  }

  async function stop() {
    await disconnectDatabase();
    await mongo.stop();
  }

  return { app, request, models, as, changePassword, createCompany, createPerson, agreeProfile, sendTask, stop };
}
