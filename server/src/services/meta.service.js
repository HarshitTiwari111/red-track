/**
 * Meta (Facebook) Graph API calls: credential checks and Conversions API.
 *
 * There is no OAuth here on purpose. A self-hosted tracker has no registered
 * Meta app to redirect a browser through, and it does not need one: Business
 * Manager issues a long-lived System User token for the ad accounts you already
 * own, and that token is what these calls carry. The user pastes it once.
 *
 * Nothing in this file may throw into a request path. A conversion is recorded
 * whether or not Meta accepts its copy, so every call here reports failure as a
 * return value and the caller logs it.
 */

import MetaPixel from '../models/MetaPixel.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 6000;

/** fetch with a deadline - Meta occasionally holds a socket open for minutes. */
async function call(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: err, body };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Meta did not respond in time' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirm the token can actually read the ad account it is paired with.
 * Reading the account is the check that matters - a token can be valid in
 * general and still have no permission on this particular account.
 */
export async function verifyMetaAccount(integration) {
  const id = String(integration?.adAccountId || '').replace(/^act_/, '').trim();
  const token = String(integration?.accessToken || '').trim();
  if (!id) return { ok: false, error: 'Ad account ID is required' };
  if (!token) return { ok: false, error: 'Access token is required' };

  const url = `${GRAPH}/act_${encodeURIComponent(id)}?fields=name,account_status&access_token=${encodeURIComponent(token)}`;
  const res = await call(url);
  if (!res.ok) return { ok: false, error: res.error };

  // account_status 1 is active; anything else still verifies the credential but
  // is worth saying out loud, because no cost will arrive from a closed account.
  const status = res.body?.account_status;
  return {
    ok: true,
    accountName: String(res.body?.name || `act_${id}`),
    accountStatus: status,
    warning: status === 1 ? '' : `Ad account status is ${status ?? 'unknown'}, not active`,
  };
}

/** Meta's click cookie format, rebuilt from the fbclid we captured on the click. */
const fbcFrom = (fbclid, clickTime) =>
  fbclid ? `fb.1.${new Date(clickTime || Date.now()).getTime()}.${fbclid}` : undefined;

/**
 * Mirror one conversion to a pixel's Conversions API.
 *
 * `eventId` is the tracker's own conversion id. Meta uses it to collapse this
 * server event with the browser pixel event for the same conversion, so a site
 * running both does not count twice.
 */
export async function sendCapiEvent(pixel, conversion) {
  if (!pixel?.pixelId || !pixel?.accessToken || pixel.enabled === false) return { ok: false, skipped: true };

  const userData = {
    client_ip_address: conversion.ip || undefined,
    client_user_agent: conversion.userAgent || undefined,
    fbc: fbcFrom(conversion.fbclid, conversion.clickTime),
  };
  // Meta rejects an event whose user_data cannot identify anyone at all
  if (!userData.client_ip_address && !userData.fbc) {
    return { ok: false, skipped: true, error: 'No IP or fbclid to identify the user' };
  }

  const payload = {
    data: [
      {
        event_name: conversion.eventName || 'Purchase',
        event_time: Math.floor(new Date(conversion.time || Date.now()).getTime() / 1000),
        event_id: conversion.eventId || undefined,
        event_source_url: conversion.url || undefined,
        action_source: conversion.actionSource === 'store_tracking_url' ? 'website' : conversion.actionSource || 'website',
        user_data: userData,
        custom_data: {
          value: Number(conversion.value) || 0,
          currency: conversion.currency || 'USD',
        },
      },
    ],
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;

  const res = await call(
    `${GRAPH}/${encodeURIComponent(pixel.pixelId)}/events?access_token=${encodeURIComponent(pixel.accessToken)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    console.warn(`[meta.capi] pixel ${pixel.pixelId}: ${res.error}`);
    return { ok: false, error: res.error };
  }
  return { ok: true, received: res.body?.events_received ?? 0 };
}

/**
 * Send a conversion to a set of pixels, and record on each what happened.
 *
 * The counters are the only honest answer to "is this working" - Meta scores
 * the quality, but whether an event left here at all is ours to report, so a
 * pixel that has never sent one says 0 rather than looking configured and idle.
 *
 * Failures are recorded, never raised: the conversion is already saved and the
 * network is owed a fast answer.
 */
export async function forwardConversionToMeta(pixelIds, conversion) {
  const ids = (Array.isArray(pixelIds) ? pixelIds : []).map(String);
  if (!ids.length) return [];

  const pixels = await MetaPixel.find({ _id: { $in: ids }, status: 'active' }).lean();

  return Promise.all(
    pixels.map(async (pixel) => {
      // A rule for this conversion type wins over the event name the postback
      // used, which is rarely what an ad account optimises on.
      const rule = pixel.customConversionMatching
        ? (pixel.conversionMatching || []).find((m) => m.conversionType === conversion.eventName)
        : null;
      const payoutRule = (pixel.payoutRules || []).find((r) => r.conversionType === conversion.eventName);

      const res = await sendCapiEvent(
        { pixelId: pixel.pixelId, accessToken: pixel.apiKey, testEventCode: pixel.testEventCode },
        {
          ...conversion,
          eventName: rule?.eventName || conversion.eventName || pixel.defaultEventName || 'Purchase',
          value: payoutRule ? payoutRule.value : conversion.value,
          url: conversion.url || pixel.eventUrl || '',
          actionSource: pixel.actionSource,
        }
      ).catch((e) => ({ ok: false, error: e.message }));

      await MetaPixel.updateOne(
        { _id: pixel._id },
        res.ok
          ? { $inc: { eventsSent: 1 }, $set: { lastEventAt: new Date(), lastError: '' } }
          : { $set: { lastEventAt: new Date(), lastError: String(res.error || 'unknown error').slice(0, 300) } }
      ).catch(() => {});

      return res;
    })
  );
}

/**
 * Everything Meta needs before it will report an Event Match Quality score, and
 * what is still missing. The UI greys the link out until this says ready, so the
 * reasons are worded as the steps an operator still has to take.
 */
export function emqReadiness(pixel) {
  const missing = [];
  if (!pixel?.dataQualityToken) missing.push('Set the Data Quality API token');
  if (!pixel?.customConversionMatching) missing.push('Switch on Custom Conversion Matching');
  const rules = (pixel?.conversionMatching || []).filter((m) => m.conversionType && m.eventName);
  if (!rules.length) missing.push('Choose a conversion type and event name');
  return { ready: missing.length === 0, missing };
}

/**
 * Event Match Quality for one pixel, read with its Data Quality token.
 *
 * EMQ is scored per event name, which is why a conversion-matching rule has to
 * exist first: without one there is no event whose quality Meta could report.
 */
export async function fetchEmqScore(pixel) {
  const { ready, missing } = emqReadiness(pixel);
  if (!ready) return { ok: false, notReady: true, missing };

  const events = [...new Set((pixel.conversionMatching || []).map((m) => m.eventName).filter(Boolean))];
  const res = await call(
    `${GRAPH}/${encodeURIComponent(pixel.pixelId)}/event_match_quality` +
      `?event_names=${encodeURIComponent(JSON.stringify(events))}` +
      `&access_token=${encodeURIComponent(pixel.dataQualityToken)}`
  );

  if (!res.ok) return { ok: false, error: res.error };

  /*
   * Meta returns one entry per event name. The shape has changed between API
   * versions, so read the score from whichever field carries it rather than
   * insisting on one name.
   */
  const rows = (res.body?.data || []).map((d) => ({
    eventName: d.event_name || d.event || '',
    score: d.event_match_quality_score ?? d.score ?? d.emq_score ?? null,
    matchedFields: d.matched_fields || d.user_data_fields || [],
  }));
  return { ok: true, events: rows, raw: res.body };
}
