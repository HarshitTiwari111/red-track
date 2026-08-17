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
/** 1234567890 -> 123-456-7890, the form every Google Ads screen shows. */
const dashed = (id) => String(id).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

/** Which customers the signed-in account can reach at all. */
export async function listAccessibleCustomers(refreshToken) {
  const res = await call(`${apiBase()}/customers:listAccessibleCustomers`, {
    headers: { 'x-user-refresh-token': refreshToken },
  });
  if (!res.ok) return res;
  return {
    ok: true,
    ids: (res.body?.resourceNames || []).map((n) => String(n).split('/').pop()),
  };
}

/**
 * "The caller does not have permission" says nothing about which account is
 * wrong, and there are three ordinary reasons for it: the wrong customer id,
 * a client account queried without naming its manager, or a Google account
 * that was simply never given access. Asking Google what this grant *can*
 * reach turns all three into something a person can act on.
 */
async function explainPermission(integration, error) {
  if (!/permission|PERMISSION_DENIED|not have access/i.test(error)) return error;

  const reachable = await listAccessibleCustomers(integration.refreshToken);
  if (!reachable.ok || !reachable.ids?.length) {
    return `${error} — the signed-in Google account can reach no Google Ads accounts at all. Sign in with the account that has access to ${dashed(digits(integration.adAccountId))}.`;
  }

  const list = reachable.ids.map(dashed).join(', ');
  const asked = dashed(digits(integration.adAccountId));
  if (reachable.ids.includes(digits(integration.adAccountId))) {
    // It is reachable, so the id is right and something else is refusing:
    // almost always a client account queried without its manager named.
    return `${error} — ${asked} is visible to this account, so it is most likely a client account under a manager. Put the manager's id in the MCC field.`;
  }
  return `${error} — this Google account can reach ${list}, but not ${asked}. Use one of those, or put its manager's id in the MCC field.`;
}

export async function verifyGoogleAccount(integration) {
  const res = await searchAds(
    integration,
    'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1'
  );
  if (!res.ok) return { ok: false, error: await explainPermission(integration, res.error) };

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
