/**
 * Google sign-in and Google Ads API calls.
 *
 * The OAuth client belongs to the install, not to a traffic channel: it is
 * registered once in Google Cloud Console and read from config here. A channel
 * therefore asks for nothing but the ad account id - pressing "Sign in with
 * Google" sends the operator through Google's consent screen, and the refresh
 * token that comes back is stored against that channel.
 *
 * The developer token is a separate gate. Google issues it per manager account
 * and approves it by hand, and until that happens calls reach the API and are
 * refused. It is config too, for the same reason: one install, one token.
 */

import config from '../config/env.js';

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const ADS_API = 'https://googleads.googleapis.com/v18';
const TIMEOUT_MS = 8000;

/** Where Google sends the operator back. Must match the Cloud Console entry. */
export const redirectUri = () => `${config.baseUrl}/api/v1/oauth/google/callback`;

export const googleConfigured = () => config.google.configured;

/**
 * The consent screen URL. `prompt=consent` with `access_type=offline` is what
 * makes Google hand back a refresh token; without it a second authorisation of
 * the same account returns only a short-lived access token and the connection
 * silently stops working an hour later.
 */
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: 'https://www.googleapis.com/auth/adwords email',
    state,
  });
  return `${OAUTH_AUTH_URL}?${params}`;
}

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

const tokenRequest = (fields) =>
  call(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...fields,
    }).toString(),
  });

/** Trade the stored refresh token for a short-lived access token. */
async function accessToken(refreshToken) {
  const res = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (!res.ok) return { ok: false, error: `Google sign-in expired: ${res.error}` };
  return { ok: true, token: res.body.access_token };
}

/**
 * Finish the consent round trip: turn the one-time code into a refresh token
 * and find out which account granted it, so the panel can name the connection.
 */
export async function exchangeCode(code) {
  const res = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.body.refresh_token) {
    // Google withholds it when the account has already granted this client and
    // the request did not force the consent screen.
    return { ok: false, error: 'Google returned no refresh token — remove this app at myaccount.google.com/permissions and try again' };
  }

  const who = await call(USERINFO_URL, {
    headers: { authorization: `Bearer ${res.body.access_token}` },
  });
  return { ok: true, refreshToken: res.body.refresh_token, email: who.ok ? who.body?.email || '' : '' };
}

/**
 * Confirm the whole chain works by reading the ad account back. Reading it is
 * the check that matters: credentials can be individually valid and still have
 * no permission on this particular customer.
 */
export async function verifyGoogleAccount(integration) {
  const customerId = digits(integration?.adAccountId);
  const loginCustomerId = digits(integration?.mccId);

  if (!customerId) return { ok: false, error: 'Google Ads Account ID is required' };
  if (!integration?.refreshToken) {
    return { ok: false, error: 'Not signed in — press Sign in with Google first' };
  }
  if (!config.google.developerToken) {
    return {
      ok: false,
      error: 'This install has no Google Ads developer token — request one in the Google Ads API Center and set GOOGLE_DEVELOPER_TOKEN',
    };
  }

  const auth = await accessToken(integration.refreshToken);
  if (!auth.ok) return { ok: false, error: auth.error };

  const headers = {
    authorization: `Bearer ${auth.token}`,
    'developer-token': config.google.developerToken,
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
