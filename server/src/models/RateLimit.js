import mongoose from 'mongoose';

/**
 * One counter per rate-limited key, shared by every worker and every machine.
 *
 * express-rate-limit's default store keeps its counters in process memory,
 * which quietly multiplies the limit by the number of instances: two cluster
 * workers turn "5 attempts" into ten, four boxes behind a load balancer into
 * twenty, and a restart into zero. The counter has to live where every
 * instance can see it, and MongoDB is already that place - no second datastore
 * for a handful of writes on a route nobody hits in a loop.
 *
 * `_id` is the limiter's prefix plus the client key, so unrelated limiters
 * cannot collide if another is added later.
 */
const rateLimitSchema = new mongoose.Schema(
  {
    _id: { type: String },
    hits: { type: Number, default: 0 },
    // When the current window ends. Also drives the TTL cleanup below.
    resetAt: { type: Date, required: true },
  },
  { collection: 'rate_limits', versionKey: false, _id: false }
);

/*
 * Expire a document the moment its window closes. This is housekeeping only -
 * Mongo's TTL monitor runs about once a minute, so a stale row can outlive its
 * window briefly. The store never trusts it: every read compares resetAt to
 * now and starts a fresh window itself.
 */
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = mongoose.model('RateLimit', rateLimitSchema);
export default RateLimit;
