import { config } from '../config/env.js';
import { badRequest } from '../utils/http.js';
import { errorFields, logger } from '../utils/logger.js';

// Validates req.body (default) or req.query with a zod schema.
export const validate = (schema, where = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[where] ?? {});
  if (!result.success) return next(badRequest('Please check the highlighted fields', result.error.flatten().fieldErrors));
  if (where === 'body') req.body = result.data;
  else req.valid = result.data;
  return next();
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message;
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join('; ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409;
    message = 'That already exists';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'That upload is too large';
  }
  // Only the kind of failure and where it happened are logged: error messages can quote what people wrote.
  if (status >= 500) logger.error('request.failed', { method: req.method, path: req.path, ...errorFields(err) });
  res.status(status).json({
    error: status >= 500 && config.isProd ? 'Something went wrong. Please try again.' : message,
    code: err.details?.code,
    details: err.details,
  });
}
