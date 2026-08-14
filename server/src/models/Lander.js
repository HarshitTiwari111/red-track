import mongoose from 'mongoose';

/**
 * Landing page types. These are a classification only - the tracker's funnel is
 * single-page (path = one landing page -> offer), so a pre-landing page is used
 * exactly like a landing page. See ASSUMPTIONS.md (N2).
 */
export const LANDER_TYPES = ['landing', 'pre-landing', 'listicle-landing', 'listicle-pre-landing'];

const landerSchema = new mongoose.Schema(
  {
    /**
     * Who this belongs to. Admins see every record; a user sees only their own,
     * so scoping happens on this one field rather than per-route.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LANDER_TYPES, default: 'landing', index: true },
    url: { type: String, required: true, trim: true },
    tags: { type: [String], default: [], index: true },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'landers' }
);

landerSchema.index({ name: 1 });

export const Lander = mongoose.model('Lander', landerSchema);
export default Lander;
