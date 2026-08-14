import Campaign from '../models/Campaign.js';
import { toObjectId, isObjectId } from '../utils/validate.js';

/**
 * Two roles, one rule: an admin sees everything, a user sees only what they own.
 *
 * Scoping lives here rather than in each route so a new list endpoint cannot
 * quietly forget it - the helpers below are the only thing a route needs.
 */
export const isAdmin = (req) => req.user?.role === 'admin';

/**
 * An admin may narrow the whole dashboard to one user with the X-View-As header,
 * so every page answers as that user without anyone sharing a password. It is a
 * view filter, not a role change: the admin keeps admin rights while it is on,
 * and the header is ignored outright for anyone who is not an admin.
 */
export function viewingAs(req) {
  if (!isAdmin(req)) return null;
  const id = req.get('x-view-as');
  return id && isObjectId(id) ? toObjectId(id) : null;
}

/** The account whose data this request should see, or null for "everyone". */
function effectiveOwner(req) {
  const as = viewingAs(req);
  if (as) return as;
  if (isAdmin(req)) return null;
  return toObjectId(req.user?.uid) || null;
}

/** Mongo filter fragment for a collection that carries ownerId. */
export function ownerFilter(req) {
  const owner = effectiveOwner(req);
  return owner === null ? {} : { ownerId: owner };
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
  const owner = effectiveOwner(req);
  if (owner === null) return null;
  const rows = await Campaign.find({ ownerId: owner }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/** Merge the campaign scope into a query, if one applies. */
export async function scopeByCampaign(req, query = {}, field = 'campaignId') {
  const ids = await ownedCampaignIds(req);
  if (ids === null) return query;
  return { ...query, [field]: { $in: ids } };
}
