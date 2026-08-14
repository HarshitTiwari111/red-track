import mongoose from 'mongoose';

/**
 * A reusable funnel shape. Applying one to a campaign adds a rotation path built
 * from it (plus a matching rule when filters are enabled), so a template is a
 * starting point that is copied - later edits do not reach campaigns already
 * using it.
 */
export const FUNNEL_TYPES = ['single-landing', 'direct-offer'];

const weightedRef = (ref) =>
  new mongoose.Schema(
    {
      [ref === 'Lander' ? 'landerId' : 'offerId']: {
        type: mongoose.Schema.Types.ObjectId,
        ref,
        required: true,
      },
      weight: { type: Number, default: 100, min: 0 },
    },
    { _id: false }
  );

const funnelTemplateSchema = new mongoose.Schema(
  {
    /**
     * Who this belongs to. Admins see every record; a user sees only their own,
     * so scoping happens on this one field rather than per-route.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: FUNNEL_TYPES, default: 'single-landing' },

    landers: { type: [weightedRef('Lander')], default: [] },
    offers: { type: [weightedRef('Offer')], default: [] },

    // Optional conditions; when enabled, applying the template also creates a
    // campaign rule that routes matching traffic to this funnel.
    filtersEnabled: { type: Boolean, default: false },
    filters: {
      country: { type: [String], default: [] },
      device: { type: [String], default: [] },
      os: { type: [String], default: [] },
      browser: { type: [String], default: [] },
      timeRange: {
        from: { type: Number, default: null, min: 0, max: 23 },
        to: { type: Number, default: null, min: 0, max: 23 },
      },
    },

    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'funnel_templates' }
);

funnelTemplateSchema.index({ name: 1 });

export const FunnelTemplate = mongoose.model('FunnelTemplate', funnelTemplateSchema);
export default FunnelTemplate;
