/**
 * Per-process 24h "seen" set used to flag unique clicks without hitting Mongo on
 * the hot path. Keys are `campaignId:ip`. In cluster mode each worker keeps its
 * own set, so uniques can be slightly over-counted across workers - acceptable
 * for a uniqueness heuristic, and documented in ASSUMPTIONS.md.
 */
const seen = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200_000;

export function markAndCheckUnique(campaignId, ip) {
  if (!ip) return true;
  const key = `${campaignId}:${ip}`;
  const now = Date.now();
  const prev = seen.get(key);
  seen.set(key, now);
  if (seen.size > MAX_ENTRIES) prune(now);
  return !(prev && now - prev < TTL_MS);
}

function prune(now) {
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
    if (seen.size <= MAX_ENTRIES * 0.8) break;
  }
  // Still oversized (all entries fresh): drop the oldest insertions.
  if (seen.size > MAX_ENTRIES) {
    const excess = seen.size - Math.floor(MAX_ENTRIES * 0.8);
    let i = 0;
    for (const k of seen.keys()) {
      seen.delete(k);
      i += 1;
      if (i >= excess) break;
    }
  }
}

export const uniquesSize = () => seen.size;
