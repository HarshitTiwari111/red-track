import mongoose from 'mongoose';

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
    defaultConversionStatus: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'approved',
    },
    geo: { type: [String], default: [] },
    tags: { type: [String], default: [], index: true },
    caps: { type: capsSchema, default: () => ({}) },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'offers' }
);

offerSchema.index({ name: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
export default Offer;
