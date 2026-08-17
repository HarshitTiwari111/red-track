/**
 * Google Ads access, routed through the operator's own proxy.
 *
 * The proxy holds the OAuth client and the developer token, so nothing secret
 * about the install lives here: a call carries only the refresh token of the
 * account that granted access, in `x-user-refresh-token`, and the proxy turns
 * that into a real Google Ads request. Paths and bodies are Google's own, with
 * the proxy's base in front - so anything in Google's documentation works
 * unchanged.
 *
 * There is no REST-style reading here because Google offers none: every read is
 * a POST to googleAds:search carrying a GAQL query.
 */

import config from '../config/env.js';

const TIMEOUT_MS = 10000;

async function call(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err =
        body?.error?.message ||
        body?.error ||
        body?.[0]?.error?.message ||
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: String(err) };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Google did not respond in time' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Google Ads customer ids are shown with dashes and sent without them. */
const digits = (v) => String(v || '').replace(/\D/g, '');

const apiBase = () => `${config.googleAds.proxyUrl.replace(/\/+$/, '')}/${config.googleAds.apiVersion}`;

/** Whether this install can start a Google sign-in at all. */
export const googleConfigured = () => !!config.googleAds.authUrl;

/**
 * Where the proxy drops the browser afterwards, with the refresh token appended
 * to the address. It has to be an origin the proxy allows; anything else comes
 * back "Invalid Return URL. Only dashboard origin is allowed."
 */
export const returnUrl = () => `${config.baseUrl}/sources`;

/**
 * Hand the browser to the proxy's sign-in.
 *
 * The proxy owns the consent screen because it owns the OAuth client, and it
 * takes one parameter: where to return to. It carries nothing else through, so
 * which channel is being connected is remembered on this side rather than sent.
 */
export function buildAuthUrl() {
  const url = new URL(config.googleAds.authUrl);
  url.searchParams.set('return_url', returnUrl());
  return url.toString();
}

/**
 * Run one GAQL query against a customer.
 *
 * `login-customer-id` is only sent when an MCC is configured: setting it
 * without access to that manager account is itself an error.
 */
export async function searchAds(integration, query, { stream = false } = {}) {
  const customerId = digits(integration?.adAccountId);
  const loginCustomerId = digits(integration?.mccId);
  const refreshToken = integration?.refreshToken;

  if (!customerId) return { ok: false, error: 'Google Ads Account ID is required' };
  if (!refreshToken) return { ok: false, error: 'Not signed in — press Sign in with Google first' };

  const headers = {
    'x-user-refresh-token': refreshToken,
    'content-type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const method = stream ? 'googleAds:searchStream' : 'googleAds:search';
  return call(`${apiBase()}/customers/${customerId}/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
}

/**
 * Confirm the whole chain works by reading the ad account back. Reading it is
 * the check that matters: a grant can be valid in general and still carry no
 * permission on this particular customer.
 */
export async function verifyGoogleAccount(integration) {
  const res = await searchAds(
    integration,
    'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1'
  );
  if (!res.ok) return { ok: false, error: res.error };

  const row = res.body?.results?.[0]?.customer;
  return {
    ok: true,
    accountName: String(row?.descriptiveName || `Customer ${digits(integration?.adAccountId)}`),
  };
}

/** Client accounts under a manager account, for picking one to attach. */
export async function listClientAccounts(integration) {
  const res = await searchAds(
    integration,
    'SELECT customer_client.id, customer_client.descriptive_name, customer_client.level FROM customer_client WHERE customer_client.level <= 1'
  );
  if (!res.ok) return res;
  return {
    ok: true,
    items: (res.body?.results || []).map((r) => ({
      id: r.customerClient?.id,
      name: r.customerClient?.descriptiveName || '',
      level: Number(r.customerClient?.level || 0),
    })),
  };
}
