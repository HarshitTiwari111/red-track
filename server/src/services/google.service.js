/**
 * Google Ads API credential checks.
 *
 * Google gates this API behind three separate things, and all of them have to be
 * in place before a single call succeeds:
 *
 *   1. an OAuth client (client id + secret) registered in a Google Cloud project
 *      the operator owns - there is no shared app to sign in through;
 *   2. a refresh token minted against that client by the account that can see
 *      the ad account;
 *   3. a developer token, which Google issues per manager account and approves
 *      by hand. A brand-new one is limited to test accounts until then.
 *
 * That is why there is no one-click "Sign in with Google" here. The checks below
 * report exactly which of the three is missing, so the answer to "why is it not
 * connected" is never a guess.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_API = 'https://googleads.googleapis.com/v18';
const TIMEOUT_MS = 8000;

async function call(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err =
        body?.error?.message ||
        body?.error_description ||
        body?.[0]?.error?.message ||
        `HTTP ${res.status}`;
      return { ok: false, error: err, body };
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

/** Trade the stored refresh token for a short-lived access token. */
async function accessToken({ clientId, clientSecret, refreshToken }) {
  const res = await call(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) return { ok: false, error: `OAuth refresh failed: ${res.error}` };
  return { ok: true, token: res.body.access_token };
}

/**
 * Confirm the whole chain works by reading the ad account back. Reading it is
 * the check that matters: credentials can be individually valid and still have
 * no permission on this particular customer.
 */
export async function verifyGoogleAccount(integration) {
  const customerId = digits(integration?.adAccountId);
  const loginCustomerId = digits(integration?.mccId);
  const { clientId, clientSecret, refreshToken, developerToken } = integration || {};

  if (!customerId) return { ok: false, error: 'Google Ads Account ID is required' };
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'OAuth client ID and secret are required — create them in Google Cloud Console' };
  }
  if (!refreshToken) return { ok: false, error: 'OAuth refresh token is required' };
  if (!developerToken) {
    return { ok: false, error: 'Developer token is required — Google issues it per manager account' };
  }

  const auth = await accessToken({ clientId, clientSecret, refreshToken });
  if (!auth.ok) return { ok: false, error: auth.error };

  const headers = {
    authorization: `Bearer ${auth.token}`,
    'developer-token': developerToken,
    'content-type': 'application/json',
  };
  // Only set when an MCC is configured: sending it without access to that
  // manager account is itself an error.
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const res = await call(`${ADS_API}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }),
  });
  if (!res.ok) return { ok: false, error: res.error };

  const row = res.body?.results?.[0]?.customer;
  return { ok: true, accountName: String(row?.descriptiveName || `Customer ${customerId}`) };
}
