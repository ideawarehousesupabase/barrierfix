const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn` again after a short, growing pause when it throws something temporary
// (a network error, a rate limit or a server error). Anything else is thrown straight away.
export async function withRetry(fn, { attempts = 3, baseMs = 300, isTransient = defaultIsTransient, wait = sleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isTransient(err)) break;
      const retryAfterMs = Number(err?.retryAfter) > 0 ? Number(err.retryAfter) * 1000 : 0;
      await wait(Math.max(retryAfterMs, baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export function defaultIsTransient(err) {
  const code = err?.code || err?.data?.error;
  const status = err?.status || err?.statusCode;
  if (['slack_webapi_request_error', 'slack_webapi_rate_limited_error', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ratelimited', 'service_unavailable', 'internal_error', 'fatal_error'].includes(code)) return true;
  if (err?.code === 'slack_webapi_platform_error') return ['ratelimited', 'service_unavailable', 'internal_error', 'fatal_error', 'request_timeout'].includes(err.data?.error);
  return typeof status === 'number' && (status === 429 || status >= 500);
}
