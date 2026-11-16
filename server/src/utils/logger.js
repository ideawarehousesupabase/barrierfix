import { config } from '../config/env.js';

// A small structured logger for technical failures. It records what went wrong and where, never what
// people wrote: task text, tokens, passwords and similar fields are replaced before anything is printed.
const SENSITIVE_KEY = /(text|body|message|password|token|secret|authorization|cookie|reason|comment|note|email|name|api[-_]?key|private[-_]?key)/i;

export function redact(value, depth = 0) {
  if (value == null || typeof value !== 'object') return typeof value === 'string' && value.length > 200 ? `[${value.length} characters]` : value;
  if (depth > 3) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

function write(level, event, fields = {}) {
  if (config.isTest && level !== 'error') return;
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...redact(fields) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

// Errors are reduced to their type, status and code: the message can quote user input.
export const errorFields = (err) => ({ type: err?.name, status: err?.status || err?.statusCode, code: err?.code || err?.data?.error });

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
