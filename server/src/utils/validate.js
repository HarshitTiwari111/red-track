import mongoose from 'mongoose';

export const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

export const toObjectId = (v) => (isObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

/** Trim + hard length cap so a hostile query string can never blow up a document. */
export const str = (v, max = 512) => {
  if (v === undefined || v === null) return '';
  const s = Array.isArray(v) ? String(v[0] ?? '') : String(v);
  return s.slice(0, max).trim();
};

export const num = (v, fallback = 0) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : fallback;
};

export const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

export const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

export const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

/** Strip mongo operators from user-provided objects before they touch a query. */
export const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$') || k.includes('.')) continue;
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? sanitizeObject(v) : v;
  }
  return out;
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
