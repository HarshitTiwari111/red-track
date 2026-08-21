import RateLimit from '../models/RateLimit.js';
import logger from '../utils/logger.js';

/**
 * A store for express-rate-limit that keeps its counters in MongoDB.
 *
 * See models/RateLimit.js for why the counter cannot live in process memory.
 * This implements the v7 Store interface: increment, decrement, resetKey.
 */
export class MongoRateLimitStore {
  constructor({ prefix = 'rl', windowMs = 60_000 } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  /** express-rate-limit hands over the resolved options before first use. */
  init(options) {
    if (options?.windowMs) this.windowMs = options.windowMs;
  }

  key(k) {
    return `${this.prefix}:${k}`;
  }

  /**
   * Count one hit and report the window.
   *
   * The whole decision - is the old window still open, or does a new one start
   * here - happens inside a single update pipeline, so two requests arriving
   * together cannot both believe they opened the window. Doing it as a read
   * then a write would let one of them overwrite the other's count.
   *
   * A pipeline's $set sees the document as it was before this update, which is
   * what makes `resetAt` usable on both lines below.
   */
  async increment(k) {
    const now = new Date();
    const fresh = new Date(now.getTime() + this.windowMs);

    try {
      const doc = await RateLimit.findOneAndUpdate(
        { _id: this.key(k) },
        [
          {
            $set: {
              resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', fresh] },
              hits: {
                $cond: [{ $gt: ['$resetAt', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1],
              },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', lean: true }
      );

      return { totalHits: doc?.hits ?? 1, resetTime: doc?.resetAt ?? fresh };
    } catch (err) {
      /*
       * A limiter that throws would take the login route down with it. Report
       * a single hit instead: the request is let through, which is the same
       * thing the in-memory store did on a fresh process.
       */
      logger.warn(`rate limit store increment failed: ${err.message}`);
      return { totalHits: 1, resetTime: fresh };
    }
  }

  /** Give a hit back - used by skipSuccessfulRequests. */
  async decrement(k) {
    try {
      await RateLimit.updateOne(
        { _id: this.key(k), hits: { $gt: 0 }, resetAt: { $gt: new Date() } },
        { $inc: { hits: -1 } }
      );
    } catch (err) {
      logger.warn(`rate limit store decrement failed: ${err.message}`);
    }
  }

  async resetKey(k) {
    try {
      await RateLimit.deleteOne({ _id: this.key(k) });
    } catch (err) {
      logger.warn(`rate limit store resetKey failed: ${err.message}`);
    }
  }

  async resetAll() {
    try {
      await RateLimit.deleteMany({ _id: new RegExp(`^${this.prefix}:`) });
    } catch (err) {
      logger.warn(`rate limit store resetAll failed: ${err.message}`);
    }
  }
}

export default MongoRateLimitStore;
