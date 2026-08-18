import express from 'express';
import Domain from '../models/Domain.js';
import config from '../config/env.js';
import { asyncRoute } from '../middleware/error.js';
import { publishConfigChange } from '../services/cache.service.js';
import { refreshDomainSsl, parseCertificate } from '../services/ssl.service.js';
import { verifyDomainDns } from '../services/dns.service.js';
import { str, isObjectId, badRequest, notFound, isHttpUrl } from '../utils/validate.js';

const router = express.Router();

/** Accepts "track.example.com" or "https://track.example.com/" and keeps the host. */
function parseHost(input) {
  const raw = str(input, 253).trim().toLowerCase();
  if (!raw) return null;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    const { hostname } = new URL(withScheme);
    if (!hostname.includes('.')) return null;
    return hostname;
  } catch {
    return null;
  }
}

/**
 * A domain only leaves `pending` when DNS has been seen, but the operator can
 * still force it: an A record to a load balancer, or a Cloudflare setup we
 * cannot observe, are legitimate configurations the check may never confirm.
 */
const STATUSES = ['pending', 'active', 'paused'];

const resolveStatus = (body, existing) => {
  if (!existing) return 'pending';
  // An omitted or unknown status must not promote a pending domain to active
  return STATUSES.includes(body.status) ? body.status : existing.status;
};

const normalize = async (body, existing) => {
  const host = parseHost(body.url ?? body.host);
  if (!host) throw badRequest('Enter a valid domain, e.g. track.example.com');

  // A second-level domain cannot be CNAMEd without breaking the apex record
  if (host.split('.').length < 3) {
    throw badRequest('Use a third-level domain (track.example.com), not a root domain (example.com)');
  }

  const clash = await Domain.findOne({ host, ...(existing ? { _id: { $ne: existing._id } } : {}) }).lean();
  if (clash) throw badRequest(`${host} is already registered`);

  if (body.rootRedirectUrl && !isHttpUrl(body.rootRedirectUrl)) {
    throw badRequest('Root domain URL must start with http:// or https://');
  }

  // Single URL field like the rest of the form: http:// only when typed explicitly
  const typedHttp = /^http:\/\//i.test(String(body.url ?? '').trim());
  const protocol = body.protocol === 'http' || (body.protocol === undefined && typedHttp) ? 'http' : 'https';

  const patch = {
    host,
    protocol,
    rootRedirectUrl: str(body.rootRedirectUrl, 1024),
    isDefault: Boolean(body.isDefault),
    status: resolveStatus(body, existing),
    notes: str(body.notes, 500),
    targetCname: existing?.targetCname || config.dnsTargetCname,
  };

  Object.assign(patch, normalizeSsl(body, existing, host));
  return patch;
};

/**
 * "Free SSL certificate" on means the reverse proxy owns TLS and nothing is
 * stored. Turning it off means the operator supplies the pair themselves.
 */
function normalizeSsl(body, existing, host) {
  const manual = body.sslMode === 'manual' || body.freeSsl === false;
  if (!manual) {
    return {
      sslMode: 'auto',
      sslCertificate: '',
      sslPrivateKey: '',
      certExpiresAt: null,
      certIssuer: '',
      certSubject: '',
    };
  }

  const cert = str(body.sslCertificate, 32_000).trim();
  // Blank key on an edit means "keep the one already on file" - it is never sent back
  const key = body.sslPrivateKey === undefined ? '' : str(body.sslPrivateKey, 32_000).trim();
  const effectiveKey = key || existing?.sslPrivateKey || '';

  // Both fields blank is a valid state, and the way an operator removes a pair
  // they uploaded earlier. Checked against `key`, not `effectiveKey`: a stored
  // key must not make a cleared form look half-filled and block the removal.
  if (!cert && !key) {
    return {
      sslMode: 'manual',
      sslCertificate: '',
      sslPrivateKey: '',
      certExpiresAt: null,
      certIssuer: '',
      certSubject: '',
    };
  }

  if (!cert) throw badRequest('Paste the certificate that goes with this key');
  if (!effectiveKey) throw badRequest('Paste the private key that goes with this certificate');

  const parsed = parseCertificate(cert, effectiveKey, host);
  if (!parsed.ok) throw badRequest(parsed.error);
  if (parsed.expired) throw badRequest(`That certificate expired on ${parsed.expiresAt.toDateString()}`);

  return {
    sslMode: 'manual',
    sslCertificate: cert,
    sslPrivateKey: effectiveKey,
    certExpiresAt: parsed.expiresAt,
    certIssuer: parsed.issuer,
    certSubject: parsed.subject,
  };
}

/**
 * A private key must never leave the server, not even back to the operator who
 * pasted it. The client only needs to know whether one is on file.
 */
const sanitize = (doc) => {
  if (!doc) return doc;
  const { sslPrivateKey, ...rest } = doc;
  return { ...rest, hasPrivateKey: Boolean(sslPrivateKey) };
};

/** Only one domain can be the default. */
async function enforceSingleDefault(doc) {
  if (!doc?.isDefault) return;
  await Domain.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
}

router.get(
  '/domains',
  asyncRoute(async (req, res) => {
    const items = await Domain.find({}).sort({ isDefault: -1, createdAt: -1 }).lean();
    const rows = items.map((d, i) => ({
      ...sanitize(d),
      index: i + 1,
      url: `${d.protocol}://${d.host}`,
    }));
    res.json({
      items: rows,
      // Where the app itself is reachable - the fallback when no domain is chosen
      defaultBaseUrl: config.baseUrl,
      defaultHost: new URL(config.baseUrl).hostname,
      targetCname: config.dnsTargetCname,
    });
  })
);

router.post(
  '/domains',
  asyncRoute(async (req, res) => {
    const body = await normalize(req.body, null);
    const created = await Domain.create(body);
    await enforceSingleDefault(created);
    await publishConfigChange();
    res.status(201).json(sanitize(created.toObject()));
  })
);

router.put(
  '/domains/:id',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const existing = await Domain.findById(req.params.id);
    if (!existing) throw notFound();
    const body = await normalize(req.body, existing);
    // A different hostname is a different DNS record - the old proof means nothing
    if (body.host !== existing.host) {
      Object.assign(body, {
        status: 'pending',
        targetCname: config.dnsTargetCname,
        dnsVerifiedAt: null,
        dnsCheckedAt: null,
        dnsMethod: '',
        dnsFound: [],
        dnsError: '',
        dnsAttempts: 0,
      });
    }
    Object.assign(existing, body);
    await existing.save();
    await enforceSingleDefault(existing);
    await publishConfigChange();
    res.json(sanitize(existing.toObject()));
  })
);

router.delete(
  '/domains/:id',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const deleted = await Domain.findByIdAndDelete(req.params.id).lean();
    if (!deleted) throw notFound();
    await publishConfigChange();
    res.json({ ok: true });
  })
);

/**
 * Check the domain's DNS and flip it to active once the record is visible.
 *
 * A failure here is the expected first answer, not an error condition -
 * registrar changes take 5 minutes to 48 hours to propagate - so this always
 * answers 200 with the outcome rather than throwing.
 */
router.post(
  '/domains/:id/verify',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const existing = await Domain.findById(req.params.id).lean();
    if (!existing) throw notFound();

    const { domain, result } = await verifyDomainDns(existing);

    // Knowing the certificate state the moment DNS lands saves a second round trip
    let withSsl = domain;
    if (result.ok && domain.protocol === 'https') {
      try {
        withSsl = await refreshDomainSsl(domain);
      } catch {
        /* the SSL probe is advisory - a failure must not fail verification */
      }
    }

    res.json({
      ...sanitize(withSsl),
      verified: result.ok,
      method: result.method,
      found: result.found,
      message: result.ok
        ? `${domain.host} verified via ${result.method === 'cname' ? 'CNAME' : 'A record'} — now active`
        : result.error,
    });
  })
);

/* Read the certificate the domain currently presents */
router.post(
  '/domains/:id/check-ssl',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const domain = await Domain.findById(req.params.id).lean();
    if (!domain) throw notFound();
    const updated = await refreshDomainSsl(domain);
    res.json(sanitize(updated));
  })
);

export default router;
