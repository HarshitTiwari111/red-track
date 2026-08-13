import tls from 'node:tls';
import crypto from 'node:crypto';
import Domain from '../models/Domain.js';
import logger from '../utils/logger.js';

const BEGIN_CERT = '-----BEGIN CERTIFICATE-----';
const END_CERT = '-----END CERTIFICATE-----';

/**
 * Validate a pasted certificate (and optional key) and pull out the details
 * worth showing back to the operator.
 *
 * A bundle is normal - the leaf comes first, intermediates after - so only the
 * first block is parsed for identity while the rest are just checked for shape.
 * Returns { ok, expiresAt, issuer, subject, chainLength } or { ok:false, error }.
 */
export function parseCertificate(certPem, keyPem = '', host = '') {
  const cert = String(certPem || '').trim();
  if (!cert) return { ok: false, error: 'Certificate is empty' };

  if (!cert.includes(BEGIN_CERT) || !cert.includes(END_CERT)) {
    return { ok: false, error: `Certificate must include the ${BEGIN_CERT} and ${END_CERT} markers` };
  }

  const blocks = cert.split(BEGIN_CERT).length - 1;

  let x509;
  try {
    x509 = new crypto.X509Certificate(cert);
  } catch (err) {
    return { ok: false, error: `Certificate could not be read: ${err.message}` };
  }

  // A key is optional here; when given it must actually belong to the certificate
  if (String(keyPem || '').trim()) {
    let key;
    try {
      key = crypto.createPrivateKey(keyPem);
    } catch (err) {
      return { ok: false, error: `Private key could not be read: ${err.message}` };
    }
    if (!x509.checkPrivateKey(key)) {
      return { ok: false, error: 'Private key does not match this certificate' };
    }
  }

  const expiresAt = new Date(x509.validTo);
  const result = {
    ok: true,
    expiresAt,
    issuer: (x509.issuer || '').split('\n').find((l) => l.startsWith('O=') || l.startsWith('CN='))?.slice(3) || '',
    subject: x509.subject?.split('\n').find((l) => l.startsWith('CN='))?.slice(3) || '',
    chainLength: blocks,
    expired: expiresAt.getTime() < Date.now(),
    // Advisory only - a wildcard or SAN entry can be valid without matching literally
    hostMatches: host ? x509.checkHost(host) !== undefined : null,
  };
  return result;
}

/**
 * Read the certificate a hostname actually presents.
 *
 * `rejectUnauthorized: false` on purpose - an expired or mismatched certificate
 * is exactly what the operator needs to see, so the handshake must complete far
 * enough to read it rather than being aborted.
 */
export function checkSsl(hostname, port = 443, timeout = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let socket;
    try {
      socket = tls.connect(
        { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout },
        () => {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            done({ ok: false, error: 'no certificate presented' });
          } else {
            done({
              ok: true,
              expiresAt: new Date(cert.valid_to),
              issuer: cert.issuer?.O || cert.issuer?.CN || '',
              subject: cert.subject?.CN || '',
              authorized: socket.authorized,
              authorizationError: socket.authorizationError ? String(socket.authorizationError) : '',
            });
          }
          socket.end();
        }
      );
    } catch (err) {
      return done({ ok: false, error: err.message });
    }

    socket.on('error', (err) => done({ ok: false, error: err.message }));
    socket.on('timeout', () => {
      socket.destroy();
      done({ ok: false, error: 'connection timed out' });
    });
    return undefined;
  });
}

/** Run the check for one domain document and persist the result. */
export async function refreshDomainSsl(domain) {
  if (domain.protocol !== 'https') {
    return Domain.findByIdAndUpdate(
      domain._id,
      { $set: { sslCheckedAt: new Date(), sslError: 'domain is configured as http', sslExpiresAt: null } },
      { new: true }
    ).lean();
  }

  const result = await checkSsl(domain.host);
  const patch = result.ok
    ? {
        sslCheckedAt: new Date(),
        sslExpiresAt: result.expiresAt,
        sslIssuer: result.issuer,
        sslSubject: result.subject,
        sslError: result.authorized ? '' : result.authorizationError || 'certificate not trusted',
      }
    : { sslCheckedAt: new Date(), sslError: result.error, sslExpiresAt: null };

  return Domain.findByIdAndUpdate(domain._id, { $set: patch }, { new: true }).lean();
}

/** Daily sweep so the SSL expiry column stays current without manual checks. */
export async function refreshAllDomainSsl() {
  const domains = await Domain.find({ status: 'active' }).lean();
  let checked = 0;
  for (const d of domains) {
    // eslint-disable-next-line no-await-in-loop
    await refreshDomainSsl(d);
    checked += 1;
  }
  if (checked) logger.info(`ssl: checked ${checked} tracking domain(s)`);
  return { checked };
}
