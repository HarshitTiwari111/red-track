import mongoose from 'mongoose';

/**
 * A Conversions API destination: conversions are mirrored back to the platform
 * so it can optimise on them.
 *
 * The same shape hangs off a traffic channel and off an offer, because both are
 * places a person naturally thinks about conversions - the channel that bought
 * the click, and the offer that paid for it. One definition, so the two can
 * never drift apart.
 */
export const capiPixelSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['meta'], default: 'meta' },
    label: { type: String, default: '', trim: true },
    pixelId: { type: String, default: '', trim: true },
    // Never leaves the server - stripped by sanitizeCapiPixels below
    accessToken: { type: String, default: '', trim: true },
    // Sends events to Meta's test console instead of counting them for real
    testEventCode: { type: String, default: '', trim: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

/**
 * Drop the tokens on the way out, leaving a flag so the form knows one is
 * stored and can show a placeholder rather than an empty box.
 */
export const sanitizeCapiPixels = (list) =>
  (Array.isArray(list) ? list : []).map((p) => {
    const { accessToken, ...rest } = p;
    return { ...rest, hasToken: !!accessToken };
  });

/**
 * Read the pixels off an incoming body, keeping any token the form did not
 * send back. Matching on pixel id rather than position means reordering or
 * deleting a row cannot hand one pixel another pixel's token.
 */
export const normalizeCapiPixels = (incoming, previous = []) =>
  (Array.isArray(incoming) ? incoming : [])
    .map((p, i) => {
      const pixelId = String(p?.pixelId || '').trim().slice(0, 64);
      const was = previous.find((x) => x.pixelId && x.pixelId === pixelId) || previous[i] || {};
      return {
        platform: 'meta',
        label: String(p?.label || '').trim().slice(0, 80),
        pixelId,
        accessToken:
          typeof p?.accessToken === 'string'
            ? p.accessToken.trim().slice(0, 512)
            : was.accessToken || '',
        testEventCode: String(p?.testEventCode || '').trim().slice(0, 40),
        enabled: p?.enabled !== false,
      };
    })
    // A row with no pixel to send to is an empty form row
    .filter((p) => p.pixelId);
