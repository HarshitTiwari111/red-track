import Campaign from '../models/Campaign.js';
import { toObjectId } from '../utils/validate.js';

/**
 * Two roles, one rule: an admin sees everything, a user sees only what they own.
 *
 * Scoping lives here rather than in each route so a new list endpoint cannot
 * quietly forget it - the helpers below are the only thing a route needs.
 */
export const isAdmin = (req) => req.user?.role === 'admin';

/** Mongo filter fragment for a collection that carries ownerId. */
export function ownerFilter(req) {
  if (isAdmin(req)) return {};
  return { ownerId: toObjectId(req.user?.uid) || null };
}

/** Stamp on create. Admins may hand a record to someone else. */
export function ownerOnCreate(req, body = {}) {
  if (isAdmin(req) && body.ownerId) return toObjectId(body.ownerId) || null;
  return toObjectId(req.user?.uid) || null;
}

/** May this user act on this document? */
export const ownsDoc = (req, doc) =>
  isAdmin(req) || (doc?.ownerId && String(doc.ownerId) === String(req.user?.uid));

/**
 * Clicks, conversions, postbacks and reports hang off a campaign rather than
 * carrying an owner of their own, so they are scoped by the campaigns the user
 * owns. Returns null when no filter is needed (admin).
 *
 * A user who owns no campaigns gets an empty list, not everything - the caller
 * must apply the returned array even when it is empty.
 */
export async function ownedCampaignIds(req) {
  if (isAdmin(req)) return null;
  const rows = await Campaign.find({ ownerId: toObjectId(req.user?.uid) || null }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/** Merge the campaign scope into a query, if one applies. */
export async function scopeByCampaign(req, query = {}, field = 'campaignId') {
  const ids = await ownedCampaignIds(req);
  if (ids === null) return query;
  return { ...query, [field]: { $in: ids } };
}
