/**
 * Add-on for the Google Ads proxy Worker: the sign-in half.
 *
 * The proxy already forwards API calls once a refresh token exists, but nothing
 * produces that token. Google only issues one from its consent screen, and the
 * consent screen belongs to the OAuth client whose secret this Worker holds -
 * which is why this has to live here and not in the tracker.
 *
 * Two routes:
 *   GET /auth/start?redirect_uri=<app callback>&state=<opaque>
 *   GET /auth/callback         (Google returns here)
 *
 * It ends by sending the browser back to the app's callback with the refresh
 * token, so the tracker can store it against one traffic channel.
 *
 * Worker settings needed:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   - the same client the proxy uses
 *   ALLOWED_REDIRECT_ORIGINS                 - comma separated, e.g.
 *       https://kap-tracker.onrender.com,http://localhost:3010
 *
 * And in Google Cloud Console, this Worker's own callback must be listed as an
 * authorized redirect URI:  https://<worker-host>/auth/callback
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

const b64url = {
  encode: (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))),
};

/**
 * Only ever send a browser back to an origin the operator listed. Without this
 * anyone could call /auth/start with their own redirect_uri and walk away with
 * a refresh token for whichever Google account signed in.
 */
function redirectAllowed(env, target) {
  const allowed = String(env.ALLOWED_REDIRECT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    return allowed.includes(new URL(target).origin);
  } catch {
    return false;
  }
}

const backTo = (redirectUri, params) => {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
};

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/auth/start') {
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    if (!redirectAllowed(env, redirectUri)) {
      return new Response('redirect_uri is not on the allowed list', { status: 400 });
    }

    // Google hands `state` back untouched, so the app's own state rides along
    // with the address to return to.
    const state = b64url.encode({ r: redirectUri, s: url.searchParams.get('state') || '' });

    const go = new URL(GOOGLE_AUTH);
    go.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    go.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
    go.searchParams.set('response_type', 'code');
    // Both are required for a refresh token: without prompt=consent, a second
    // authorisation of the same account returns only a one-hour access token
    // and the connection quietly dies later.
    go.searchParams.set('access_type', 'offline');
    go.searchParams.set('prompt', 'consent');
    go.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords email');
    go.searchParams.set('state', state);
    return Response.redirect(go.toString(), 302);
  }

  if (url.pathname === '/auth/callback') {
    let claims;
    try {
      claims = b64url.decode(url.searchParams.get('state') || '');
    } catch {
      return new Response('Bad state', { status: 400 });
    }
    if (!redirectAllowed(env, claims.r)) return new Response('Bad redirect', { status: 400 });

    const error = url.searchParams.get('error');
    if (error) return backTo(claims.r, { state: claims.s, error });

    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code') || '',
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.refresh_token) {
      return backTo(claims.r, {
        state: claims.s,
        error:
          body.error_description ||
          body.error ||
          'Google returned no refresh token — remove this app at myaccount.google.com/permissions and retry',
      });
    }

    // Nice to have, not essential: lets the tracker name who granted access.
    let email = '';
    try {
      const who = await fetch(GOOGLE_USERINFO, {
        headers: { authorization: `Bearer ${body.access_token}` },
      });
      if (who.ok) email = (await who.json()).email || '';
    } catch {
      /* the grant is what matters; a missing label is not a failure */
    }

    return backTo(claims.r, { state: claims.s, refresh_token: body.refresh_token, email });
  }

  return null; // not an auth path - let the existing proxy handle it
}

/*
 * Wire it into the existing Worker by trying auth first, then falling through
 * to whatever already handles /api:
 *
 *   export default {
 *     async fetch(request, env, ctx) {
 *       const authed = await handleAuth(request, env);
 *       if (authed) return authed;
 *       return handleApiProxy(request, env, ctx);   // your existing code
 *     },
 *   };
 */
