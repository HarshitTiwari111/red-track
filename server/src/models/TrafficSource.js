import mongoose from 'mongoose';
import { capiPixelSchema, sanitizeCapiPixels } from './capiPixel.js';

/**
 * A parameter role wires an incoming query parameter into a known slot on the
 * click, so the value shows up in the "Rt …" columns and reports rather than
 * only living in a subID. An empty role means "just store it as-is".
 */
export const PARAM_ROLES = [
  '',
  /*
   * The id halves. Ad platforms send an id and a human name for the same thing
   * and both are worth keeping: the id is what their API and their reports key
   * on, the name is what a person reads.
   */
  'campaignId',
  'pubId',
  'placementId',
  'adId',
  'adgroupId',
  // Two spare slots with no fixed meaning, for whatever a network sends that
  // none of the named roles fit.
  'role1',
  'role2',
  // The name halves
  'source',
  'medium',
  'campaign',
  'adgroup',
  'ad',
  'placement',
  'keyword',
  // Some networks send the placement only as a hash, to avoid naming the site
  'placementHashed',
  /*
   * Not offered in the picker: the channel form has its own Click Ref ID and
   * Click cost ID fields, which is where those two belong. Still accepted so
   * channels created from templates that used them keep loading and saving
   * unchanged.
   */
  'cost',
  'clickref',
];

/** Cost pulled from the ad platform can be attributed at one of three depths. */
export const COST_DEPTHS = ['campaign', 'adset', 'ad'];

/** How often the cost pull runs, in minutes. */
export const COST_FREQUENCIES = [5, 15, 30, 60, 180, 360, 720, 1440];

/**
 * Credentials for the ad platform's own API. This is deliberately a long-lived
 * access token rather than an OAuth round trip: a self-hosted tracker has no
 * registered app to redirect through, and Meta hands out exactly this kind of
 * token from Business Manager for the accounts you already own.
 */
const integrationSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['', 'meta', 'google'], default: '' },
    adAccountId: { type: String, default: '', trim: true },
    // Google only: the manager account conversions are sent to instead of the
    // ad account, when the advertiser runs under an MCC
    mccId: { type: String, default: '', trim: true },
    // Never leaves the server - stripped by sanitizeSource below
    accessToken: { type: String, default: '', trim: true },
    /*
     * Google only. Written by the OAuth callback, never typed: the client id,
     * secret and developer token belong to the install as a whole and live in
     * config, so a channel carries nothing but the grant it was given.
     */
    refreshToken: { type: String, default: '', trim: true },
    // Which Google account granted it, so the panel can name the connection
    grantedEmail: { type: String, default: '', trim: true },
    status: { type: String, enum: ['not_connected', 'connected', 'error'], default: 'not_connected' },
    accountName: { type: String, default: '', trim: true },
    lastCheckAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    /**
     * Spend on an ad set that got impressions but no clicks would otherwise
     * have nothing to attach to, so the pull records one synthetic click and
     * hangs the cost off that. It skews click counts, hence the opt-in.
     */
    impressionCostSync: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Maps one of this tracker's conversion types onto a conversion action defined
 * in the ad account, so an upload lands on the right goal rather than a generic
 * one. `includeInConversions` mirrors the Google Ads setting of the same name -
 * off means the action is still recorded but kept out of the bidding column.
 */
const conversionMatchSchema = new mongoose.Schema(
  {
    conversionType: { type: String, default: '', trim: true },
    conversionName: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true },
    includeInConversions: { type: Boolean, default: true },
  },
  { _id: false }
);

/** Campaign Manager 360 destination for a conversion type. */
const cm360Schema = new mongoose.Schema(
  {
    conversionType: { type: String, default: '', trim: true },
    profileId: { type: String, default: '', trim: true },
    floodlightActivityId: { type: String, default: '', trim: true },
  },
  { _id: false }
);


const paramSchema = new mongoose.Schema(
  {
    // The query parameter on the tracking link, e.g. "sub1"
    param: { type: String, required: true, trim: true },
    // The ad platform's macro that fills it, e.g. "{keyword}"
    macro: { type: String, default: '', trim: true },
    // Human label shown in the UI
    name: { type: String, default: '', trim: true },
    role: { type: String, enum: PARAM_ROLES, default: '' },
  },
  { _id: false }
);

/**
 * A traffic source (channel) describes how an ad network passes data into the
 * tracking link. `params` is the editable list; `tokens` and `paramTemplate` are
 * derived from it on save so the campaign link builder keeps working unchanged.
 */
const trafficSourceSchema = new mongoose.Schema(
  {
    /**
     * Who this belongs to. Admins see every record; a user sees only their own,
     * so scoping happens on this one field rather than per-route.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true },
    aliasChannel: { type: String, default: '', trim: true },
    // Display label only - the tracker does no currency conversion
    currency: { type: String, default: 'USD', trim: true },
    // Postback fired back to this source on conversion; campaigns without their
    // own forwarding fall back to this one
    s2sPostbackTemplate: { type: String, default: '', trim: true },
    externalId: { type: String, default: '', trim: true },

    params: { type: [paramSchema], default: [] },

    // Template of the query string appended to the campaign link (derived)
    paramTemplate: { type: String, default: '' },
    // { sub1: '{keyword}', gclid: '{gclid}' ... } (derived from params)
    tokens: { type: Map, of: String, default: {} },
    // Which incoming query param carries the click cost
    costParam: { type: String, default: '' },
    // Which incoming query param carries the external click id (gclid/fbclid/ttclid)
    clickIdParam: { type: String, default: '' },

    // Depth and cadence of the cost pull. They are stored even while no
    // integration is connected, so connecting one later needs no re-setup.
    costUpdateDepth: { type: String, enum: COST_DEPTHS, default: 'adset' },
    costUpdateFrequency: { type: Number, enum: COST_FREQUENCIES, default: 5 },

    integration: { type: integrationSchema, default: () => ({}) },
    capiPixels: { type: [capiPixelSchema], default: [] },
    conversionMatching: { type: [conversionMatchSchema], default: [] },
    cm360: { type: [cm360Schema], default: [] },

    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
  },
  { timestamps: true, collection: 'traffic_sources' }
);

trafficSourceSchema.index({ name: 1 });

/**
 * Access tokens are write-only over the API: the client needs to know whether
 * one is set - to draw "connected", and to leave the field alone when editing -
 * but never needs the value. This is a plain function rather than a toJSON
 * transform because most reads here are .lean(), which skips transforms.
 */
/** Integration fields the client may never read back. */
const SECRETS = ['accessToken', 'refreshToken'];

export function sanitizeSource(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (out.integration) {
    const kept = { ...out.integration };
    // One flag per secret: the form needs to know which are already stored so it
    // can show a placeholder and leave them alone, without ever holding a value.
    for (const key of SECRETS) {
      kept[`has${key[0].toUpperCase()}${key.slice(1)}`] = !!kept[key];
      delete kept[key];
    }
    kept.hasToken = kept.hasAccessToken;
    out.integration = kept;
  }
  if (Array.isArray(out.capiPixels)) out.capiPixels = sanitizeCapiPixels(out.capiPixels);
  return out;
}

export const TrafficSource = mongoose.model('TrafficSource', trafficSourceSchema);
export default TrafficSource;
