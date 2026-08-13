import mongoose from 'mongoose';

/**
 * Roles map an incoming postback parameter onto a known conversion field, which
 * is the generalised form of the old fixed `paramMapping`.
 */
export const POSTBACK_ROLES = [
  '',
  'clickid',
  'payout',
  'txid',
  'status',
  'type',
  'event',
  'coupon',
  'refid',
  'pubrevenue',
];

/** What to do when a postback repeats a transaction id already recorded. */
export const DUPLICATE_MODES = ['ignore', 'update', 'create'];

const paramSchema = new mongoose.Schema(
  {
    param: { type: String, required: true, trim: true },
    macro: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    role: { type: String, enum: POSTBACK_ROLES, default: '' },
  },
  { _id: false }
);

const affiliateNetworkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    aliasName: { type: String, default: '', trim: true },
    postbackSecurityKey: { type: String, required: true, unique: true, index: true },
    // Display label only - the tracker does no currency conversion
    currency: { type: String, default: 'USD', trim: true },
    // Pre-fills the URL when creating an offer under this network
    offerUrlTemplate: { type: String, default: '', trim: true },

    paramMapping: {
      clickid: { type: String, default: 'clickid' },
      payout: { type: String, default: 'payout' },
      txid: { type: String, default: 'txid' },
      status: { type: String, default: 'status' },
      type: { type: String, default: 'type' },
    },
    // Extra postback parameters with roles; supersedes paramMapping when a role
    // is set for the same field.
    params: { type: [paramSchema], default: [] },

    defaultConversionStatus: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'approved',
    },

    // Reject conversions that arrive too long after the click (attribution window)
    clickExpiration: {
      enabled: { type: Boolean, default: false },
      days: { type: Number, default: 0, min: 0 },
    },
    // Require the security key on every postback from this network
    postbackProtection: {
      enabled: { type: Boolean, default: false },
    },
    // Only accept postbacks from these IPs
    whitelistedIps: {
      enabled: { type: Boolean, default: false },
      ips: { type: [String], default: [] },
    },
    // 'update' keeps the long-standing behaviour: a repeat txid with a changed
    // status or payout rewrites the conversion and adjusts the stats.
    duplicateMode: { type: String, enum: DUPLICATE_MODES, default: 'update' },

    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
  },
  { timestamps: true, collection: 'affiliate_networks' }
);

affiliateNetworkSchema.index({ name: 1 });

export const AffiliateNetwork = mongoose.model('AffiliateNetwork', affiliateNetworkSchema);
export default AffiliateNetwork;
