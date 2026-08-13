/**
 * Timezone helpers.
 *
 * Design note: stats buckets are stored as "naive local" Dates - the UTC fields of
 * the stored Date hold the wall-clock time of the report timezone. So a bucket
 * printed as 2026-08-10T14:00:00.000Z means 14:00 in the report timezone.
 * This keeps day/hour grouping exact even for half-hour offsets like Asia/Kolkata
 * (+05:30), where deriving local days from true-UTC hour buckets would smear
 * across day boundaries.
 */

const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
    formatters.set(tz, f);
  }
  return f;
}

export function tzParts(date, tz) {
  const parts = formatter(tz).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  let hour = get('hour');
  if (hour === 24) hour = 0; // en-US hour12:false can emit 24
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Wall-clock of `date` in `tz`, expressed as a naive-local Date. */
export function toLocal(date, tz) {
  const p = tzParts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/** Start of the wall-clock hour in `tz`, as a naive-local Date (bucket key). */
export function localHourBucket(date, tz) {
  const p = tzParts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, 0, 0, 0));
}

/** YYYY-MM-DD in `tz`. */
export function localDayKey(date, tz) {
  const p = tzParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function localHour(date, tz) {
  return tzParts(date, tz).hour;
}

function tzOffsetMs(date, tz) {
  const p = tzParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Naive-local Date -> real UTC instant. Refined once so DST shifts resolve. */
export function localToUtc(naiveLocal, tz) {
  const guess = new Date(naiveLocal.getTime() - tzOffsetMs(naiveLocal, tz));
  return new Date(naiveLocal.getTime() - tzOffsetMs(guess, tz));
}

/**
 * Parse a report date range. Accepts YYYY-MM-DD (whole local day) or a full ISO
 * timestamp. Returns both the naive-local bounds (for stats buckets) and the real
 * UTC bounds (for raw click/conversion queries).
 */
export function parseRange(fromRaw, toRaw, tz) {
  const now = new Date();
  const todayKey = localDayKey(now, tz);
  const fromKey = String(fromRaw || todayKey);
  const toKey = String(toRaw || todayKey);

  const localFrom = parseBound(fromKey, false);
  const localTo = parseBound(toKey, true);

  return {
    localFrom,
    localTo,
    utcFrom: localToUtc(localFrom, tz),
    utcTo: localToUtc(localTo, tz),
  };
}

function parseBound(value, isEnd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const [, y, mo, d] = m;
    return isEnd
      ? new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 59, 999))
      : new Date(Date.UTC(+y, +mo - 1, +d, 0, 0, 0, 0));
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    const now = new Date();
    return isEnd ? now : new Date(now.getTime() - 24 * 3600 * 1000);
  }
  return dt;
}

export const addDays = (date, n) => new Date(date.getTime() + n * 24 * 3600 * 1000);
