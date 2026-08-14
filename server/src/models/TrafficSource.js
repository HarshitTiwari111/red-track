import mongoose from 'mongoose';

/**
 * A parameter role wires an incoming query parameter into a known slot on the
 * click, so the value shows up in the "Rt …" columns and reports rather than
 * only living in a subID. An empty role means "just store it as-is".
 */
export const PARAM_ROLES = [
  '',
  'source',
  'medium',
  'campaign',
  'adgroup',
  'ad',
  'placement',
  'keyword',
  'cost',
  'clickref',
];

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

    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
  },
  { timestamps: true, collection: 'traffic_sources' }
);

trafficSourceSchema.index({ name: 1 });

export const TrafficSource = mongoose.model('TrafficSource', trafficSourceSchema);
export default TrafficSource;
