import mongoose from 'mongoose';
import { capiPixelSchema, sanitizeCapiPixels } from './capiPixel.js';

/**
 * Caps temporarily pull an offer out of the rotation once a threshold is hit
 * within the chosen period. Zero means "no cap".
 */
const capsSchema = new mongoose.Schema(
  {
    uniqueVisits: { type: Number, default: 0, min: 0 },
    clickCap: { type: Number, default: 0, min: 0 },
    conversionCap: { type: Number, default: 0, min: 0 },
    timePeriod: { type: String, enum: ['hour', 'day', 'month', 'total'], default: 'day' },
    // none   -> every click counts
    // unique -> only unique clicks count toward the click cap
    filterType: { type: String, enum: ['none', 'unique'], default: 'none' },
    alertOnClickCap: { type: Boolean, default: false },
    alertOnConversionCap: { type: Boolean, default: false },
  },
  { _id: false }
);

const offerSchema = new mongoose.Schema(
  {
    /**
     * Who this belongs to. Admins see every record; a user sees only their own,
     * so scoping happens on this one field rather than per-route.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    networkId: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateNetwork', default: null },
    url: { type: String, required: true, trim: true },
    // auto  -> payout comes from the postback
    // fixed -> always use defaultPayout
    payoutType: { type: String, enum: ['auto', 'fixed'], default: 'auto' },
    defaultPayout: { type: Number, default: 0 },
    // Status applied to a conversion when the network sends none
    /**
     * Empty means "whatever the offer source says". It has to be the default:
     * a real status here always wins, so an offer that merely never had one
     * chosen would otherwise override the source's setting and leave that
     * setting unreachable for every offer that has a source.
     */
    defaultConversionStatus: {
      type: String,
      enum: ['', 'approved', 'pending', 'rejected'],
      default: '',
    },
    geo: { type: [String], default: [] },
    tags: { type: [String], default: [], index: true },
    /**
     * Conversions on this offer are also mirrored to these pixels. Kept here as
     * well as on the traffic channel because an offer is the other place a
     * person thinks about a conversion - what was actually sold.
     */
    /**
     * Pixels this offer sends conversions to, by reference. The pixel itself
     * lives in one list under CAPI Integrations, so a key rotates in one place
     * rather than in every offer that uses it.
     */
    capiPixelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MetaPixel' }],
    // Superseded by capiPixelIds; kept so a migration can read it once
    capiPixels: { type: [capiPixelSchema], default: [] },
    caps: { type: capsSchema, default: () => ({}) },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'offers' }
);

offerSchema.index({ name: 1 });

/** Access tokens are write-only over the API; .lean() reads skip toJSON. */
export function sanitizeOffer(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (Array.isArray(out.capiPixels)) out.capiPixels = sanitizeCapiPixels(out.capiPixels);
  return out;
}

export const Offer = mongoose.model('Offer', offerSchema);
export default Offer;
