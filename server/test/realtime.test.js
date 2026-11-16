// Live updates: the web app keeps a socket open so a new task, a change to a task or a notification
// appears without reloading. These tests open real socket connections to a running server.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const ADMIN = 'admin@live.test';
const MGR = 'mgr@live.test';
const EMP = 'emp@live.test';
const EMP2 = 'emp2@live.test';
const OUTSIDER = 'boss@other-live.test';
const ids = {};
let t;
let server;
let url;
let io;
const sockets = [];

// Connects as a person (or with no token) and resolves once the server accepts or refuses.
function connect(email) {
  return new Promise((resolve) => {
    const socket = io(url, { auth: email === undefined ? {} : { token: `test:${email}` }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    const events = [];
    socket.onAny((event, payload) => events.push({ event, payload }));
    socket.on('connect', () => resolve({ socket, events, connected: true }));
    socket.on('connect_error', (err) => resolve({ socket, events, connected: false, error: err.message }));
  });
}

const settle = () => new Promise((r) => setTimeout(r, 150));

before(async () => {
  t = await startApp();
  ({ io } = await import('socket.io-client'));
  const { initSocket } = await import('../src/realtime/socket.js');
  const { createApp } = await import('../src/app.js');
  server = http.createServer(createApp());
  initSocket(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;

  await t.createCompany('Live Ltd', ADMIN);
  ids.mgr = await t.createPerson(ADMIN, MGR, 'Lou Manager', ['manager']);
  ids.emp = await t.createPerson(ADMIN, EMP, 'Lee Employee', ['employee'], ids.mgr);
  ids.emp2 = await t.createPerson(ADMIN, EMP2, 'Lin Colleague', ['employee'], ids.mgr);
  await t.agreeProfile(EMP, ids.emp, MGR, [{ code: 'TS1' }, { code: 'TM1' }]);
  await t.createCompany('Other Live Ltd', OUTSIDER);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((r) => server.close(r));
  await t.stop();
});

test('live updates: a connection without a valid sign-in is refused', async () => {
  const none = await connect(undefined);
  assert.equal(none.connected, false);
  const stranger = await connect('nobody@nowhere.test');
  assert.equal(stranger.connected, false, 'a signed-in Firebase user with no BarrierFix account');
});

test('live updates: a new task reaches the employee and the sender at once, and nobody else', async () => {
  const emp = await connect(EMP);
  const mgr = await connect(MGR);
  const colleague = await connect(EMP2);
  const outsider = await connect(OUTSIDER);
  assert.ok(emp.connected && mgr.connected && colleague.connected && outsider.connected);

  const res = await t.sendTask(MGR, { employeeId: ids.emp, text: 'Please update the client tracker by Wednesday at 3pm.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const briefId = res.body.brief?._id || res.body.briefs?.[0]?._id;
  await settle();

  assert.ok(emp.events.some((e) => e.event === 'brief:new' && e.payload.id === String(briefId)), 'the employee sees the new task');
  assert.ok(mgr.events.some((e) => e.event === 'brief:updated'), 'the sender\'s Sent list refreshes');
  assert.ok(emp.events.some((e) => e.event === 'notification'), 'and the employee\'s notification count');
  assert.equal(colleague.events.length, 0, 'a colleague hears nothing');
  assert.equal(outsider.events.length, 0, 'another company hears nothing');

  // The employee confirms: the manager's view updates live.
  mgr.events.length = 0;
  assert.equal((await t.as(EMP).post(`/api/briefs/${briefId}/confirm`)).status, 200);
  await settle();
  assert.ok(mgr.events.some((e) => e.event === 'brief:updated' && e.payload.id === String(briefId)));
});

const waitFor = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

test('live updates: a deactivated person loses their open connection and cannot reconnect until reactivated', async () => {
  const open = await connect(EMP2);
  assert.equal(open.connected, true);
  assert.equal((await t.as(ADMIN).patch(`/api/users/${ids.emp2}`, { status: 'disabled' })).status, 200);
  assert.equal(await waitFor(() => !open.socket.connected), true, 'the open connection is closed');
  assert.equal((await connect(EMP2)).connected, false, 'and a new one is refused');
  assert.equal((await t.as(ADMIN).patch(`/api/users/${ids.emp2}`, { status: 'active' })).status, 200);
  assert.equal((await connect(EMP2)).connected, true, 'reactivated, they can connect again');
});

test('live updates: someone who has left the company loses their connection', async () => {
  const open = await connect(EMP2);
  assert.equal(open.connected, true);
  assert.equal((await t.as(ADMIN).post(`/api/users/${ids.emp2}/end-employment`, {})).status, 200);
  assert.equal(await waitFor(() => !open.socket.connected), true);
  assert.equal((await connect(EMP2)).connected, false);
});

test('live updates: people in a suspended company lose their connection and cannot reconnect', async () => {
  const orgs = (await t.as('admin@simpliaccess.co.uk').get('/api/platform/orgs')).body.orgs;
  const other = orgs.find((o) => o.name === 'Other Live Ltd');
  const open = await connect(OUTSIDER);
  assert.equal(open.connected, true);
  assert.equal((await t.as('admin@simpliaccess.co.uk').patch(`/api/platform/orgs/${other._id}`, { status: 'suspended' })).status, 200);
  assert.equal(await waitFor(() => !open.socket.connected), true, 'the open connection is closed');
  assert.equal((await connect(OUTSIDER)).connected, false);
  assert.equal((await t.as('admin@simpliaccess.co.uk').patch(`/api/platform/orgs/${other._id}`, { status: 'active' })).status, 200);
  assert.equal((await connect(OUTSIDER)).connected, true);
});
