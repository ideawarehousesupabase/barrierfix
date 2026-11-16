// What /api/health answers. An uptime monitor (for example UptimeRobot or Better Stack) checks it
// every few minutes and alerts when it stops answering 200. It never includes connection details.
// readyState is Mongoose's connection state: 1 means connected.
export function healthReport(readyState, now = new Date()) {
  const connected = readyState === 1;
  return {
    status: connected ? 200 : 503,
    body: { ok: connected, database: connected ? 'ok' : 'unavailable', time: now.toISOString() },
  };
}
