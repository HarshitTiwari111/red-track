import logger from '../utils/logger.js';
import { notifyError } from '../services/telegram.service.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found', path: req.path });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, err);
    notifyError(`${req.method} ${req.originalUrl}\n${err.message}`);
  }
  if (res.headersSent) return;

  const isDuplicate = err.code === 11000;
  if (isDuplicate) {
    return res.status(409).json({ error: 'Duplicate value', key: err.keyValue });
  }

  // Mongoose casting/validation failures are the caller's fault, not a 500,
  // and their raw messages ("Cast to ObjectId failed … BSONError") are noise.
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for "${err.path}"` });
  }
  if (err.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return res.status(400).json({ error: first?.message || 'Validation failed' });
  }

  return res.status(status).json({ error: err.message || 'Internal error' });
}

/** Wrap an async route handler so rejections reach errorHandler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
