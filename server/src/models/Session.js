import mongoose from 'mongoose';

/**
 * One live refresh token.
 *
 * The access token is a JWT and therefore cannot be withdrawn - whoever holds
 * it is that user until it expires, and nothing on this server can say
 * otherwise. That is fine for fifteen minutes and unacceptable for a week, so
 * the long-lived half is a row here instead: revoking a session is a write,
 * and the next refresh fails.
 *
 * The token itself is never stored, only its SHA-256. The reasoning is the
 * same as for passwords - a dump of this collection must not hand over live
 * sessions - and it costs nothing, because a refresh token is looked up by
 * exact value and never listed.
 */
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },

    /**
     * Every token descended from one sign-in shares a family id.
     *
     * Rotation means a stolen token stops working the moment the real user
     * refreshes - but the thief may refresh first, and then it is the owner
     * who is logged out, silently. Presenting a token that has already been
     * rotated is proof one of the two was copied, and there is no way to tell
     * which; the whole family is revoked so both must sign in again.
     */
    family: { type: String, required: true, index: true },

    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    // Set the moment this token is rotated away or the session is ended
    revokedAt: { type: Date, default: null },
    reason: { type: String, default: '' },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { collection: 'sessions', versionKey: false, timestamps: true }
);

/*
 * Rows disappear on their own once expired. Revoked rows are kept until then
 * on purpose: a revoked token that vanished would be indistinguishable from
 * one that never existed, and reuse detection needs to tell those apart.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
export default Session;
