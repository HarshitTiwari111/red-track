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
        action_source: 'website',
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
 * Fan a conversion out to every pixel configured on its traffic channel.
 * Failures are logged, never raised - the conversion is already recorded.
 */
export async function forwardConversionToMeta(source, conversion) {
  const pixels = (source?.capiPixels || []).filter((p) => p.enabled !== false && p.pixelId && p.accessToken);
  if (!pixels.length) return [];
  return Promise.all(pixels.map((p) => sendCapiEvent(p, conversion).catch((e) => ({ ok: false, error: e.message }))));
}
