import express from 'express';
import crudRouter from './crudFactory.js';
import { ownerFilter, ownerOnCreate, ownsDoc } from '../middleware/scope.js';
import TrafficSource, {
  PARAM_ROLES,
  COST_DEPTHS,
  COST_FREQUENCIES,
  sanitizeSource,
} from '../models/TrafficSource.js';
import { catalogSummary, getCatalogEntry } from '../services/sourceCatalog.service.js';
import { verifyMetaAccount } from '../services/meta.service.js';
import jwt from 'jsonwebtoken';
import {
  buildAuthUrl,
  googleConfigured,
  redirectUri,
  verifyGoogleAccount,
} from '../services/google.service.js';
import AffiliateNetwork, { POSTBACK_ROLES, DUPLICATE_MODES } from '../models/AffiliateNetwork.js';
import { networkCatalogSummary, getNetworkTemplate } from '../services/networkCatalog.service.js';
import Offer from '../models/Offer.js';
import Lander, { LANDER_TYPES } from '../models/Lander.js';
import FunnelTemplate, { FUNNEL_TYPES } from '../models/FunnelTemplate.js';
import Domain from '../models/Domain.js';
import Campaign from '../models/Campaign.js';
import config from '../config/env.js';
import { asyncRoute } from '../middleware/error.js';
import { refreshCache, getNetworkById } from '../services/cache.service.js';
import { refreshCaps, capUsage, capStatus } from '../services/caps.service.js';
import { runReport } from '../services/report.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { parseRange } from '../utils/time.js';
import { newSecurityKey, slugify } from '../utils/ids.js';
import { badRequest, isHttpUrl, isObjectId, str, notFound , forbidden} from '../utils/validate.js';
import { MACRO_LIST } from '../services/macro.service.js';

const router = express.Router();

/* --------------------------------------------------------- traffic sources */

/**
 * `params` is the editable list. `tokens` and `paramTemplate` are derived from it
 * so the campaign tracking-link builder keeps working without knowing about roles.
 */
const normalizeSource = async (body, existing = null) => {
  if (!str(body.name)) throw badRequest('Name is required');
  body.slug = body.slug ? slugify(body.slug) : slugify(body.name);

  if (body.costUpdateDepth !== undefined) {
    body.costUpdateDepth = COST_DEPTHS.includes(body.costUpdateDepth) ? body.costUpdateDepth : 'adset';
  }
  if (body.costUpdateFrequency !== undefined) {
    const freq = Number(body.costUpdateFrequency);
    body.costUpdateFrequency = COST_FREQUENCIES.includes(freq) ? freq : 5;
  }

  if (body.integration && typeof body.integration === 'object') {
    const prev = existing?.integration || {};
    const inc = body.integration;

    // Secrets are never sent back to the client, so an edit round-trip arrives
    // without them. Absent means "leave it alone"; only an explicit value
    // replaces one, and an explicit empty string clears it.
    const secrets = {
      accessToken:
        typeof inc.accessToken === 'string' ? str(inc.accessToken, 512) : prev.accessToken || '',
      // Written only by the OAuth callback. Saving the form must never be able
      // to set or clear a grant Google made.
      refreshToken: prev.refreshToken || '',
      grantedEmail: prev.grantedEmail || '',
    };

    const adAccountId = str(inc.adAccountId, 64).replace(/^act_/, '');
    const mccId = str(inc.mccId, 64);

    // Any credential change invalidates whatever the last check concluded - the
    // badge must never claim a connection that was verified with other values.
    const changed =
      adAccountId !== (prev.adAccountId || '') ||
      mccId !== (prev.mccId || '') ||
      Object.entries(secrets).some(([k, v]) => v !== (prev[k] || ''));

    body.integration = {
      provider: ['meta', 'google'].includes(inc.provider) ? inc.provider : '',
      adAccountId,
      mccId,
      ...secrets,
      impressionCostSync: !!inc.impressionCostSync,
      status: changed ? 'not_connected' : prev.status || 'not_connected',
      accountName: changed ? '' : prev.accountName || '',
      lastCheckAt: changed ? null : prev.lastCheckAt || null,
      lastError: changed ? '' : prev.lastError || '',
    };
  }

  if (Array.isArray(body.conversionMatching)) {
    body.conversionMatching = body.conversionMatching
      .map((c) => ({
        conversionType: str(c?.conversionType, 60),
        conversionName: str(c?.conversionName, 120),
        category: str(c?.category, 60),
        includeInConversions: c?.includeInConversions !== false,
      }))
      // A row with no conversion action to fire at is an empty form row
      .filter((c) => c.conversionType && c.conversionName);
  }

  if (Array.isArray(body.cm360)) {
    body.cm360 = body.cm360
      .map((c) => ({
        conversionType: str(c?.conversionType, 60),
        profileId: str(c?.profileId, 64),
        floodlightActivityId: str(c?.floodlightActivityId, 64),
      }))
      .filter((c) => c.conversionType && c.profileId && c.floodlightActivityId);
  }

  if (Array.isArray(body.capiPixels)) {
    const prev = existing?.capiPixels || [];
    body.capiPixels = body.capiPixels
      .map((p, i) => {
        const pixelId = str(p?.pixelId, 64);
        // Match on pixel id rather than index so reordering or deleting a row
        // above cannot hand one pixel another pixel's token
        const was = prev.find((x) => x.pixelId && x.pixelId === pixelId) || prev[i] || {};
        return {
          platform: 'meta',
          label: str(p?.label, 80),
          pixelId,
          accessToken:
            typeof p?.accessToken === 'string' ? str(p.accessToken, 512) : was.accessToken || '',
          testEventCode: str(p?.testEventCode, 40),
          enabled: p?.enabled !== false,
        };
      })
      .filter((p) => p.pixelId);
  }

  if (Array.isArray(body.params)) {
    const seen = new Set();
    body.params = body.params
      .map((p) => ({
        param: str(p?.param, 60),
        macro: str(p?.macro, 200),
        name: str(p?.name, 80),
        role: PARAM_ROLES.includes(p?.role) ? p.role : '',
      }))
      .filter((p) => {
        if (!p.param || seen.has(p.param)) return false;
        // The form offers a fixed set of slots, so most arrive untouched -
        // carrying only their generated sub name. Those are not parameters
        // anyone asked for. A row with a name or a role is kept even without a
        // macro: the platform may append that value itself, and the role still
        // has to route it onto the click.
        if (!p.macro && !p.name && !p.role) return false;
        seen.add(p.param);
        return true;
      });

    const tokens = {};
    for (const p of body.params) if (p.macro) tokens[p.param] = p.macro;
    body.tokens = tokens;
    body.paramTemplate = Object.entries(tokens)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    // Keep the shorthand fields in step with the roles
    const costRole = body.params.find((p) => p.role === 'cost');
    if (costRole) body.costParam = costRole.param;
    const refRole = body.params.find((p) => p.role === 'clickref');
    if (refRole) body.clickIdParam = refRole.param;
  }

  return body;
};

/* Catalog of prebuilt channels for "New from template" */
router.get('/sources/catalog', (req, res) => {
  res.json({ items: catalogSummary(), roles: PARAM_ROLES });
});

router.post(
  '/sources/from-template',
  asyncRoute(async (req, res) => {
    const entry = getCatalogEntry(str(req.body?.templateId, 40));
    if (!entry) throw badRequest('Unknown template');

    const name = str(req.body?.name, 120) || entry.name;
    const body = await normalizeSource({
      name,
      notes: entry.description,
      status: 'active',
      ...entry.template,
    });

    body.ownerId = ownerOnCreate(req, {});
    const created = await TrafficSource.create(body);
    await refreshCache();
    res.status(201).json(sanitizeSource(created.toObject()));
  })
);

/**
 * Begin Google's consent flow for one channel.
 *
 * The state is a signed, short-lived token rather than the raw channel id: the
 * callback arrives as a plain browser redirect, so anything unsigned there
 * could be forged to attach an attacker's Google grant to someone's channel.
 */
router.post(
  '/sources/:id/integration/google/start',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    if (!googleConfigured()) {
      throw badRequest(
        'Google sign-in is not set up. The Google Ads proxy needs a sign-in endpoint that returns a refresh token, and its address must be set as GOOGLE_ADS_AUTH_URL.'
      );
    }
    const doc = await TrafficSource.findById(req.params.id).lean();
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    const state = jwt.sign({ sid: String(doc._id), uid: String(req.user.uid) }, config.jwtSecret, {
      expiresIn: '10m',
    });
    res.json({ url: buildAuthUrl(state), redirectUri: redirectUri() });
  })
);

/**
 * Where the proxy sends the operator back, carrying the refresh token Google
 * issued. Reached by a browser redirect rather than the app's own fetch, so it
 * answers with a redirect rather than JSON, and the signed state - not anything
 * the URL claims about which channel this is - is what identifies the channel.
 */
router.get(
  '/oauth/google/callback',
  asyncRoute(async (req, res) => {
    const done = (ok, message) =>
      res.redirect(`/sources?google=${ok ? 'ok' : 'error'}&message=${encodeURIComponent(message)}`);

    if (req.query.error) return done(false, String(req.query.error).slice(0, 200));

    let claims;
    try {
      claims = jwt.verify(String(req.query.state || ''), config.jwtSecret);
    } catch {
      return done(false, 'That sign-in link expired. Open the channel and try again.');
    }

    const doc = await TrafficSource.findById(claims.sid);
    if (!doc) return done(false, 'That traffic channel no longer exists.');

    const refreshToken = str(req.query.refresh_token || req.query.token, 512);
    if (!refreshToken) {
      return done(false, 'The sign-in returned no refresh token. Check the proxy sends one back.');
    }

    doc.integration.provider = 'google';
    doc.integration.refreshToken = refreshToken;
    doc.integration.grantedEmail = str(req.query.email, 200);
    // Signing in proves nothing about the ad account itself, so the connection
    // is only called good once the account has actually been read back.
    const check = await verifyGoogleAccount(doc.integration);
    doc.integration.status = check.ok ? 'connected' : 'error';
    doc.integration.accountName = check.ok ? check.accountName : '';
    doc.integration.lastError = check.ok ? '' : check.error;
    doc.integration.lastCheckAt = new Date();
    await doc.save();
    await refreshCache();

    return done(check.ok, check.ok ? `Connected to ${check.accountName}` : check.error);
  })
);

/**
 * Re-check a channel's stored credentials against the platform and record the
 * verdict, so the badge in the UI reflects a real answer rather than the fact
 * that someone typed something into the field.
 */
router.post(
  '/sources/:id/integration/verify',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const doc = await TrafficSource.findById(req.params.id);
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    const verify = doc.integration?.provider === 'google' ? verifyGoogleAccount : verifyMetaAccount;
    const result = await verify(doc.integration);
    doc.integration.status = result.ok ? 'connected' : 'error';
    doc.integration.accountName = result.ok ? result.accountName : '';
    doc.integration.lastError = result.ok ? '' : result.error;
    doc.integration.lastCheckAt = new Date();
    await doc.save();

    res.json({ ok: result.ok, integration: sanitizeSource(doc.toObject()).integration });
  })
);

/* Sources table: channels joined with their metrics for the selected range */
router.get(
  '/sources/table',
  asyncRoute(async (req, res) => {
    const q = { ...ownerFilter(req) };
    if (req.query.title) {
      q.name = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (req.query.status && req.query.status !== 'all') q.status = String(req.query.status);
    if (req.query.connectedFrom || req.query.connectedTo) {
      const tz = getSettingsSync().reportTimezone;
      const range = parseRange(req.query.connectedFrom, req.query.connectedTo, tz);
      q.createdAt = { $gte: range.utcFrom, $lte: range.utcTo };
    }

    const [sources, report] = await Promise.all([
      TrafficSource.find(q).sort({ createdAt: -1 }).lean(),
      runReport({
        groupBy: 'source',
        from: req.query.from,
        to: req.query.to,
        includeBots: req.query.includeBots,
        limit: 5000,
      }),
    ]);

    // The source dimension is keyed by the name snapshot stored on the click
    const stats = new Map(report.rows.map((r) => [r.key, r]));
    const zero = {
      clicks: 0, uniques: 0, lpClicks: 0, lpCtr: 0, conversions: 0, cr: 0,
      revenue: 0, cost: 0, profit: 0, roi: 0, epc: 0, cpc: 0,
    };

    const rows = sources.map((s, i) => {
      const st = stats.get(s.name) || zero;
      return {
        ...s,
        index: i + 1,
        paramCount: (s.params || []).length,
        lpViews: st.lpClicks ? st.clicks : st.clicks,
        clicks: st.clicks, uniques: st.uniques, lpClicks: st.lpClicks, lpCtr: st.lpCtr,
        conversions: st.conversions, cr: st.cr, revenue: st.revenue, cost: st.cost,
        profit: st.profit, roi: st.roi, epc: st.epc, cpc: st.cpc,
        cpa: st.conversions ? Math.round((st.cost / st.conversions) * 100) / 100 : 0,
      };
    });

    const totals = rows.reduce(
      (a, r) => {
        a.clicks += r.clicks; a.uniques += r.uniques; a.lpClicks += r.lpClicks;
        a.conversions += r.conversions; a.revenue += r.revenue; a.cost += r.cost;
        return a;
      },
      { clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 }
    );
    totals.lpViews = totals.clicks;
    totals.profit = Math.round((totals.revenue - totals.cost) * 100) / 100;
    totals.roi = totals.cost ? Math.round((totals.profit / totals.cost) * 10000) / 100 : 0;
    totals.epc = totals.clicks ? Math.round((totals.revenue / totals.clicks) * 10000) / 10000 : 0;
    totals.cpc = totals.clicks ? Math.round((totals.cost / totals.clicks) * 10000) / 10000 : 0;
    totals.cpa = totals.conversions ? Math.round((totals.cost / totals.conversions) * 100) / 100 : 0;
    totals.cr = totals.clicks ? Math.round((totals.conversions / totals.clicks) * 10000) / 100 : 0;
    totals.lpCtr = totals.clicks ? Math.round((totals.lpClicks / totals.clicks) * 10000) / 100 : 0;

    res.json({ rows, totals, source: report.source });
  })
);

router.post(
  '/sources/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await TrafficSource.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, name, slug, ...rest } = src;
    const clone = await TrafficSource.create({
      ...rest,
      name: `${name} (copy)`,
      slug: slugify(`${name}-copy`),
      status: 'paused',
    });
    await refreshCache();
    res.status(201).json(clone.toObject());
  })
);

router.post(
  '/sources/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one channel');
    const action = str(req.body?.action, 24);

    let result;
    if (action === 'status') {
      const status = req.body?.status === 'paused' ? 'paused' : 'active';
      result = await TrafficSource.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { status } });
    } else if (action === 'delete') {
      result = await TrafficSource.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    } else {
      throw badRequest('Unknown bulk action');
    }

    await refreshCache();
    res.json({ ok: true, matched: result.matchedCount ?? result.deletedCount ?? 0 });
  })
);

router.use('/sources', crudRouter(TrafficSource, { beforeSave: normalizeSource, sanitize: sanitizeSource }));

/* ------------------------------------------------------ affiliate networks */
const normalizeNetwork = async (body, existing) => {
  if (!str(body.name)) throw badRequest('Name is required');
  if (!existing && !body.postbackSecurityKey) body.postbackSecurityKey = newSecurityKey();
  if (existing && !body.postbackSecurityKey) delete body.postbackSecurityKey;

  if (Array.isArray(body.params)) {
    const seen = new Set();
    body.params = body.params
      .map((p) => ({
        param: str(p?.param, 60),
        macro: str(p?.macro, 200),
        name: str(p?.name, 80),
        role: POSTBACK_ROLES.includes(p?.role) ? p.role : '',
      }))
      .filter((p) => {
        if (!p.param || seen.has(p.param)) return false;
        seen.add(p.param);
        return true;
      });

    // Keep the legacy mapping in step with whatever the roles now say
    const mapping = { ...(existing?.paramMapping || {}), ...(body.paramMapping || {}) };
    for (const p of body.params) {
      if (['clickid', 'payout', 'txid', 'status', 'type'].includes(p.role)) mapping[p.role] = p.param;
    }
    body.paramMapping = mapping;
  }

  if (body.clickExpiration) {
    body.clickExpiration = {
      enabled: Boolean(body.clickExpiration.enabled),
      days: Math.max(0, Number(body.clickExpiration.days) || 0),
    };
  }
  if (body.whitelistedIps) {
    body.whitelistedIps = {
      enabled: Boolean(body.whitelistedIps.enabled),
      ips: (Array.isArray(body.whitelistedIps.ips) ? body.whitelistedIps.ips : [])
        .map((i) => str(i, 64))
        .filter(Boolean),
    };
  }
  if (body.postbackProtection) {
    body.postbackProtection = { enabled: Boolean(body.postbackProtection.enabled) };
  }
  if (body.duplicateMode && !DUPLICATE_MODES.includes(body.duplicateMode)) {
    throw badRequest('Unknown duplicate postback mode');
  }

  return body;
};

router.get('/networks/catalog', (req, res) => {
  res.json({ items: networkCatalogSummary(), roles: POSTBACK_ROLES, duplicateModes: DUPLICATE_MODES });
});

router.post(
  '/networks/from-template',
  asyncRoute(async (req, res) => {
    const entry = getNetworkTemplate(str(req.body?.templateId, 40));
    if (!entry) throw badRequest('Unknown template');

    const body = await normalizeNetwork(
      {
        name: str(req.body?.name, 120) || entry.name,
        notes: entry.description,
        status: 'active',
        postbackSecurityKey: newSecurityKey(),
        ...entry.template,
      },
      null
    );

    const created = await AffiliateNetwork.create(body);
    await refreshCache();
    res.status(201).json(created.toObject());
  })
);

/* Offer sources table: networks joined with the metrics of their offers */
router.get(
  '/networks/table',
  asyncRoute(async (req, res) => {
    const q = { ...ownerFilter(req) };
    if (req.query.title) {
      q.name = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (req.query.status && req.query.status !== 'all') q.status = String(req.query.status);

    const [networks, offers, report] = await Promise.all([
      AffiliateNetwork.find(q).sort({ createdAt: -1 }).lean(),
      Offer.find({}, { networkId: 1 }).lean(),
      runReport({
        groupBy: 'offer',
        from: req.query.from,
        to: req.query.to,
        includeBots: req.query.includeBots,
        limit: 5000,
      }),
    ]);

    // A network's numbers are the sum of its offers'
    const offerToNetwork = new Map(offers.map((o) => [String(o._id), o.networkId ? String(o.networkId) : '']));
    const byNetwork = new Map();
    for (const row of report.rows) {
      const nid = offerToNetwork.get(row.key);
      if (!nid) continue;
      const cur = byNetwork.get(nid) || {
        clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0,
      };
      cur.clicks += row.clicks; cur.uniques += row.uniques; cur.lpClicks += row.lpClicks;
      cur.conversions += row.conversions; cur.revenue += row.revenue; cur.cost += row.cost;
      byNetwork.set(nid, cur);
    }

    const offerCount = offers.reduce((m, o) => {
      const nid = o.networkId ? String(o.networkId) : '';
      if (nid) m.set(nid, (m.get(nid) || 0) + 1);
      return m;
    }, new Map());

    const derive = (s) => {
      const profit = Math.round((s.revenue - s.cost) * 100) / 100;
      return {
        ...s,
        lpViews: s.clicks,
        profit,
        roi: s.cost ? Math.round((profit / s.cost) * 10000) / 100 : 0,
        epc: s.clicks ? Math.round((s.revenue / s.clicks) * 10000) / 10000 : 0,
        cpa: s.conversions ? Math.round((s.cost / s.conversions) * 100) / 100 : 0,
        cr: s.clicks ? Math.round((s.conversions / s.clicks) * 10000) / 100 : 0,
      };
    };

    const zero = { clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 };
    const rows = networks.map((n, i) => ({
      ...n,
      index: i + 1,
      offerCount: offerCount.get(String(n._id)) || 0,
      paramCount: (n.params || []).length,
      ...derive(byNetwork.get(String(n._id)) || zero),
    }));

    const totalsRaw = rows.reduce(
      (a, r) => {
        a.clicks += r.clicks; a.uniques += r.uniques; a.lpClicks += r.lpClicks;
        a.conversions += r.conversions; a.revenue += r.revenue; a.cost += r.cost;
        return a;
      },
      { ...zero }
    );

    res.json({ rows, totals: derive(totalsRaw), source: report.source });
  })
);

router.post(
  '/networks/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await AffiliateNetwork.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, name, postbackSecurityKey, ...rest } = src;
    const clone = await AffiliateNetwork.create({
      ...rest,
      name: `${name} (copy)`,
      postbackSecurityKey: newSecurityKey(),
      status: 'paused',
    });
    await refreshCache();
    res.status(201).json(clone.toObject());
  })
);

router.post(
  '/networks/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one offer source');
    const action = str(req.body?.action, 24);

    let result;
    if (action === 'status') {
      const status = req.body?.status === 'paused' ? 'paused' : 'active';
      result = await AffiliateNetwork.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { status } });
    } else if (action === 'delete') {
      result = await AffiliateNetwork.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    } else {
      throw badRequest('Unknown bulk action');
    }

    await refreshCache();
    res.json({ ok: true, matched: result.matchedCount ?? result.deletedCount ?? 0 });
  })
);

router.use('/networks', crudRouter(AffiliateNetwork, { beforeSave: normalizeNetwork }));

// Regenerate a network's security key
router.post(
  '/networks/:id/rotate-key',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const doc = await AffiliateNetwork.findByIdAndUpdate(
      req.params.id,
      { $set: { postbackSecurityKey: newSecurityKey() } },
      { new: true }
    ).lean();
    if (!doc) throw notFound();
    await refreshCache();
    res.json(doc);
  })
);

/* ------------------------------------------------------------------ offers */
const normalizeOffer = async (body) => {
  if (!str(body.name)) throw badRequest('Name is required');
  if (!isHttpUrl(body.url)) throw badRequest('Offer URL must start with http:// or https://');
  if (body.networkId === '') body.networkId = null;
  if (Array.isArray(body.geo)) body.geo = body.geo.map((g) => String(g).toUpperCase().slice(0, 3));
  if (Array.isArray(body.tags)) {
    body.tags = [...new Set(body.tags.map((t) => str(t, 40)).filter(Boolean))];
  }
  if (body.caps) {
    const c = body.caps;
    body.caps = {
      uniqueVisits: Math.max(0, Number(c.uniqueVisits) || 0),
      clickCap: Math.max(0, Number(c.clickCap) || 0),
      conversionCap: Math.max(0, Number(c.conversionCap) || 0),
      timePeriod: ['hour', 'day', 'month', 'total'].includes(c.timePeriod) ? c.timePeriod : 'day',
      filterType: c.filterType === 'unique' ? 'unique' : 'none',
      alertOnClickCap: Boolean(c.alertOnClickCap),
      alertOnConversionCap: Boolean(c.alertOnConversionCap),
    };
  }
  return body;
};

const afterOfferWrite = async () => {
  await refreshCache();
  await refreshCaps();
};

/* Offers table: entities joined with their metrics for the selected date range */
router.get(
  '/offers/table',
  asyncRoute(async (req, res) => {
    const q = { ...ownerFilter(req) };
    if (req.query.title) {
      q.name = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (req.query.status && req.query.status !== 'all') q.status = String(req.query.status);
    if (req.query.networkId && isObjectId(req.query.networkId)) q.networkId = req.query.networkId;
    if (req.query.tags) {
      const tags = String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) q.tags = { $in: tags };
    }
    // "Date connected" - when the offer itself was created
    if (req.query.connectedFrom || req.query.connectedTo) {
      const tz = getSettingsSync().reportTimezone;
      const range = parseRange(req.query.connectedFrom, req.query.connectedTo, tz);
      q.createdAt = { $gte: range.utcFrom, $lte: range.utcTo };
    }

    const [offers, report] = await Promise.all([
      Offer.find(q).sort({ createdAt: -1 }).lean(),
      runReport({
        groupBy: 'offer',
        from: req.query.from,
        to: req.query.to,
        includeBots: req.query.includeBots,
        limit: 5000,
      }),
    ]);

    const stats = new Map(report.rows.map((r) => [r.key, r]));
    const zero = {
      clicks: 0, uniques: 0, lpClicks: 0, lpCtr: 0, conversions: 0, cr: 0,
      revenue: 0, cost: 0, profit: 0, roi: 0, epc: 0, cpc: 0,
    };

    const rows = offers.map((o, i) => {
      const s = stats.get(String(o._id)) || zero;
      const usage = capUsage(o._id);
      return {
        ...o,
        index: i + 1,
        networkName: o.networkId ? getNetworkById(o.networkId)?.name || '' : '',
        clicks: s.clicks, uniques: s.uniques, lpClicks: s.lpClicks, lpCtr: s.lpCtr,
        conversions: s.conversions, cr: s.cr, revenue: s.revenue, cost: s.cost,
        profit: s.profit, roi: s.roi, epc: s.epc, cpc: s.cpc,
        cpa: s.conversions ? Math.round((s.cost / s.conversions) * 100) / 100 : 0,
        capUsage: usage,
        cappedBy: capStatus(o),
      };
    });

    const totals = rows.reduce(
      (a, r) => {
        a.clicks += r.clicks; a.uniques += r.uniques; a.lpClicks += r.lpClicks;
        a.conversions += r.conversions; a.revenue += r.revenue; a.cost += r.cost;
        return a;
      },
      { clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 }
    );
    totals.profit = Math.round((totals.revenue - totals.cost) * 100) / 100;
    totals.roi = totals.cost ? Math.round((totals.profit / totals.cost) * 10000) / 100 : 0;
    totals.epc = totals.clicks ? Math.round((totals.revenue / totals.clicks) * 10000) / 10000 : 0;
    totals.cpa = totals.conversions ? Math.round((totals.cost / totals.conversions) * 100) / 100 : 0;
    totals.cr = totals.clicks ? Math.round((totals.conversions / totals.clicks) * 10000) / 100 : 0;
    totals.lpCtr = totals.clicks ? Math.round((totals.lpClicks / totals.clicks) * 10000) / 100 : 0;

    const allTags = [...new Set(offers.flatMap((o) => o.tags || []))].sort();

    res.json({ rows, totals, tags: allTags, source: report.source });
  })
);

/* Duplicate an offer, including caps and tags */
router.post(
  '/offers/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await Offer.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, ...rest } = src;
    const clone = await Offer.create({ ...rest, name: `${src.name} (copy)`, status: 'paused', ownerId: ownerOnCreate(req, {}) });
    await afterOfferWrite();
    res.status(201).json(clone.toObject());
  })
);

/* Bulk status / tag edits from the offers toolbar */
router.post(
  '/offers/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one offer');
    const action = str(req.body?.action, 24);

    let result;
    if (action === 'status') {
      const status = req.body?.status === 'paused' ? 'paused' : 'active';
      result = await Offer.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { status } });
    } else if (action === 'addTags' || action === 'setTags') {
      const tags = (Array.isArray(req.body?.tags) ? req.body.tags : [])
        .map((t) => str(t, 40))
        .filter(Boolean);
      result =
        action === 'setTags'
          ? await Offer.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { tags } })
          : await Offer.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $addToSet: { tags: { $each: tags } } });
    } else if (action === 'delete') {
      result = await Offer.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    } else {
      throw badRequest('Unknown bulk action');
    }

    await afterOfferWrite();
    res.json({ ok: true, matched: result.matchedCount ?? result.deletedCount ?? 0 });
  })
);

router.use('/offers', crudRouter(Offer, { beforeSave: normalizeOffer, afterWrite: afterOfferWrite }));

/* ----------------------------------------------------------------- landers */
const normalizeLander = async (body) => {
  if (!str(body.name)) throw badRequest('Name is required');
  if (!isHttpUrl(body.url)) throw badRequest('Lander URL must start with http:// or https://');
  if (body.type && !LANDER_TYPES.includes(body.type)) throw badRequest('Unknown landing page type');
  if (Array.isArray(body.tags)) {
    body.tags = [...new Set(body.tags.map((t) => str(t, 40)).filter(Boolean))];
  }
  return body;
};

/* Landers table: entities joined with their metrics for the selected range */
router.get(
  '/landers/table',
  asyncRoute(async (req, res) => {
    const q = { ...ownerFilter(req) };
    if (req.query.title) {
      q.name = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (req.query.status && req.query.status !== 'all') q.status = String(req.query.status);
    if (req.query.type && req.query.type !== 'all') q.type = String(req.query.type);
    if (req.query.tags) {
      const tags = String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) q.tags = { $in: tags };
    }

    const [landers, report] = await Promise.all([
      Lander.find(q).sort({ createdAt: -1 }).lean(),
      runReport({
        groupBy: 'lander',
        from: req.query.from,
        to: req.query.to,
        includeBots: req.query.includeBots,
        limit: 5000,
      }),
    ]);

    const stats = new Map(report.rows.map((r) => [r.key, r]));
    const zero = {
      clicks: 0, uniques: 0, lpClicks: 0, lpCtr: 0, conversions: 0, cr: 0,
      revenue: 0, cost: 0, profit: 0, roi: 0, epc: 0, cpc: 0,
    };

    const rows = landers.map((l, i) => {
      const s = stats.get(String(l._id)) || zero;
      return {
        ...l,
        index: i + 1,
        // A lander's "LP views" are the clicks routed to it; LP clicks are the
        // visitors who then clicked through to the offer.
        lpViews: s.clicks,
        lpClicks: s.lpClicks,
        lpCtr: s.lpCtr,
        clicks: s.clicks,
        uniques: s.uniques,
        conversions: s.conversions, cr: s.cr, revenue: s.revenue, cost: s.cost,
        profit: s.profit, roi: s.roi, epc: s.epc, cpc: s.cpc,
        cpa: s.conversions ? Math.round((s.cost / s.conversions) * 100) / 100 : 0,
      };
    });

    const totals = rows.reduce(
      (a, r) => {
        a.lpViews += r.lpViews; a.clicks += r.clicks; a.uniques += r.uniques;
        a.lpClicks += r.lpClicks; a.conversions += r.conversions;
        a.revenue += r.revenue; a.cost += r.cost;
        return a;
      },
      { lpViews: 0, clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 }
    );
    totals.profit = Math.round((totals.revenue - totals.cost) * 100) / 100;
    totals.roi = totals.cost ? Math.round((totals.profit / totals.cost) * 10000) / 100 : 0;
    totals.epc = totals.clicks ? Math.round((totals.revenue / totals.clicks) * 10000) / 10000 : 0;
    totals.cpc = totals.clicks ? Math.round((totals.cost / totals.clicks) * 10000) / 10000 : 0;
    totals.cpa = totals.conversions ? Math.round((totals.cost / totals.conversions) * 100) / 100 : 0;
    totals.cr = totals.clicks ? Math.round((totals.conversions / totals.clicks) * 10000) / 100 : 0;
    totals.lpCtr = totals.lpViews ? Math.round((totals.lpClicks / totals.lpViews) * 10000) / 100 : 0;

    const allTags = [...new Set(landers.flatMap((l) => l.tags || []))].sort();
    res.json({ rows, totals, tags: allTags, source: report.source });
  })
);

router.post(
  '/landers/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await Lander.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, ...rest } = src;
    const clone = await Lander.create({ ...rest, name: `${src.name} (copy)`, status: 'paused', ownerId: ownerOnCreate(req, {}) });
    await refreshCache();
    res.status(201).json(clone.toObject());
  })
);

router.post(
  '/landers/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one lander');
    const action = str(req.body?.action, 24);

    let result;
    if (action === 'status') {
      const status = req.body?.status === 'paused' ? 'paused' : 'active';
      result = await Lander.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { status } });
    } else if (action === 'addTags' || action === 'setTags') {
      const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).map((t) => str(t, 40)).filter(Boolean);
      result =
        action === 'setTags'
          ? await Lander.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { tags } })
          : await Lander.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $addToSet: { tags: { $each: tags } } });
    } else if (action === 'delete') {
      result = await Lander.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    } else {
      throw badRequest('Unknown bulk action');
    }

    await refreshCache();
    res.json({ ok: true, matched: result.matchedCount ?? result.deletedCount ?? 0 });
  })
);

router.use('/landers', crudRouter(Lander, { beforeSave: normalizeLander }));

/* Macro reference used by the URL builders in the lander/offer modals */
router.get('/macros', (req, res) => {
  res.json({ macros: MACRO_LIST, landerTypes: LANDER_TYPES });
});

/* -------------------------------------------------------- funnel templates */
const weightedList = (list, key) =>
  (Array.isArray(list) ? list : [])
    .filter((x) => x && x[key])
    .map((x) => ({ [key]: x[key], weight: Math.max(0, Number(x.weight) || 0) }));

const normalizeFunnel = async (body) => {
  if (!str(body.name)) throw badRequest('Title is required');
  if (body.type && !FUNNEL_TYPES.includes(body.type)) throw badRequest('Unknown funnel template type');

  body.landers = body.type === 'direct-offer' ? [] : weightedList(body.landers, 'landerId');
  body.offers = weightedList(body.offers, 'offerId');

  if (body.filters) {
    body.filters = {
      country: (body.filters.country || []).map((c) => String(c).toUpperCase()),
      device: (body.filters.device || []).map((c) => String(c).toLowerCase()),
      os: body.filters.os || [],
      browser: body.filters.browser || [],
      timeRange: {
        from: numOrNull(body.filters.timeRange?.from),
        to: numOrNull(body.filters.timeRange?.to),
      },
    };
  }
  return body;
};

router.post(
  '/funnels/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await FunnelTemplate.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, name, ...rest } = src;
    const clone = await FunnelTemplate.create({ ...rest, name: `${name} (copy)` });
    res.status(201).json(clone.toObject());
  })
);

router.post(
  '/funnels/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one funnel template');
    if (str(req.body?.action, 24) !== 'delete') throw badRequest('Unknown bulk action');
    const result = await FunnelTemplate.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    res.json({ ok: true, matched: result.deletedCount || 0 });
  })
);

router.use('/funnels', crudRouter(FunnelTemplate, { beforeSave: normalizeFunnel, afterWrite: async () => {} }));

/* --------------------------------------------------------------- campaigns */
const normalizeCampaign = async (body, existing) => {
  if (!str(body.name)) throw badRequest('Name is required');
  const slug = slugify(body.slug || body.name);
  if (!slug) throw badRequest('Slug could not be derived from the name');

  const clash = await Campaign.findOne({ slug, ...(existing ? { _id: { $ne: existing._id } } : {}) }).lean();
  if (clash) throw badRequest(`Slug "${slug}" is already used by another campaign`);
  body.slug = slug;

  if (body.trafficSourceId === '') body.trafficSourceId = null;
  if (body.domainId === '' || body.domainId === undefined) body.domainId = body.domainId ?? null;
  if (body.domainId && !isObjectId(body.domainId)) throw badRequest('Invalid tracking domain');
  if (body.domainId && !(await Domain.exists({ _id: body.domainId }))) {
    throw badRequest('That tracking domain no longer exists');
  }

  body.paths = (Array.isArray(body.paths) ? body.paths : []).map((p) => ({
    name: str(p.name, 80),
    weight: Number(p.weight) || 0,
    directLinking: Boolean(p.directLinking),
    landerId: p.directLinking || !p.landerId ? null : p.landerId,
    landers: p.directLinking ? [] : weightedList(p.landers, 'landerId'),
    offers: (Array.isArray(p.offers) ? p.offers : [])
      .filter((o) => o && o.offerId)
      .map((o) => ({ offerId: o.offerId, weight: Number(o.weight) || 0 })),
  }));

  if (Array.isArray(body.tags)) {
    body.tags = [...new Set(body.tags.map((t) => str(t, 40)).filter(Boolean))];
  }
  body.redirectType = body.redirectType === 'meta' ? 'meta' : '302';

  const cleanForwards = (list) =>
    (Array.isArray(list) ? list : [])
      .map((f) => ({ name: str(f?.name, 60), url: str(f?.url, 1024), enabled: f?.enabled !== false }))
      .filter((f) => f.url);
  body.postbackForwarding = cleanForwards(body.postbackForwarding);
  body.clickForwarding = cleanForwards(body.clickForwarding);

  body.rules = (Array.isArray(body.rules) ? body.rules : [])
    .filter((r) => r && Number.isInteger(Number(r.pathIndex)))
    .map((r) => ({
      name: str(r.name, 80),
      pathIndex: Number(r.pathIndex),
      conditions: {
        country: (r.conditions?.country || []).map((c) => String(c).toUpperCase()),
        device: (r.conditions?.device || []).map((c) => String(c).toLowerCase()),
        os: r.conditions?.os || [],
        browser: r.conditions?.browser || [],
        timeRange: {
          from: numOrNull(r.conditions?.timeRange?.from),
          to: numOrNull(r.conditions?.timeRange?.to),
        },
      },
    }));

  return body;
};

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
};

/* Campaigns table: entities joined with their metrics for the selected range */
router.get(
  '/campaigns/table',
  asyncRoute(async (req, res) => {
    const q = { ...ownerFilter(req) };
    if (req.query.title) {
      q.name = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (req.query.status && req.query.status !== 'all') q.status = String(req.query.status);
    if (req.query.trafficSourceId && isObjectId(req.query.trafficSourceId)) {
      q.trafficSourceId = req.query.trafficSourceId;
    }
    if (req.query.tags) {
      const tags = String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) q.tags = { $in: tags };
    }

    const [campaigns, report] = await Promise.all([
      Campaign.find(q).sort({ createdAt: -1 }).lean(),
      runReport({
        groupBy: 'campaign',
        from: req.query.from,
        to: req.query.to,
        includeBots: req.query.includeBots,
        limit: 5000,
      }),
    ]);

    const sources = await TrafficSource.find({}, { name: 1 }).lean();
    const sourceName = new Map(sources.map((s) => [String(s._id), s.name]));
    const stats = new Map(report.rows.map((r) => [r.key, r]));
    const zero = {
      clicks: 0, uniques: 0, lpClicks: 0, lpCtr: 0, conversions: 0, cr: 0,
      revenue: 0, cost: 0, profit: 0, roi: 0, epc: 0, cpc: 0,
    };

    const rows = campaigns.map((c, i) => {
      const s = stats.get(String(c._id)) || zero;
      return {
        ...c,
        index: i + 1,
        sourceName: c.trafficSourceId ? sourceName.get(String(c.trafficSourceId)) || '' : '',
        funnels: (c.paths || []).length,
        clicks: s.clicks, uniques: s.uniques, lpClicks: s.lpClicks, lpCtr: s.lpCtr,
        conversions: s.conversions, cr: s.cr, revenue: s.revenue, cost: s.cost,
        profit: s.profit, roi: s.roi, epc: s.epc, cpc: s.cpc,
        cpa: s.conversions ? Math.round((s.cost / s.conversions) * 100) / 100 : 0,
      };
    });

    const totals = rows.reduce(
      (a, r) => {
        a.clicks += r.clicks; a.uniques += r.uniques; a.lpClicks += r.lpClicks;
        a.conversions += r.conversions; a.revenue += r.revenue; a.cost += r.cost;
        return a;
      },
      { clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 }
    );
    totals.profit = Math.round((totals.revenue - totals.cost) * 100) / 100;
    totals.roi = totals.cost ? Math.round((totals.profit / totals.cost) * 10000) / 100 : 0;
    totals.epc = totals.clicks ? Math.round((totals.revenue / totals.clicks) * 10000) / 10000 : 0;
    totals.cpc = totals.clicks ? Math.round((totals.cost / totals.clicks) * 10000) / 10000 : 0;
    totals.cpa = totals.conversions ? Math.round((totals.cost / totals.conversions) * 100) / 100 : 0;
    totals.cr = totals.clicks ? Math.round((totals.conversions / totals.clicks) * 10000) / 100 : 0;
    totals.lpCtr = totals.clicks ? Math.round((totals.lpClicks / totals.clicks) * 10000) / 100 : 0;

    const allTags = [...new Set(campaigns.flatMap((c) => c.tags || []))].sort();
    res.json({ rows, totals, tags: allTags, source: report.source });
  })
);

router.post(
  '/campaigns/:id/clone',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const src = await Campaign.findById(req.params.id).lean();
    if (!src) throw notFound();
    if (!ownsDoc(req, src)) throw forbidden();
    const { _id, createdAt, updatedAt, slug, name, ...rest } = src;

    // Slugs are unique, so find a free one before inserting the copy
    let n = 2;
    let nextSlug = `${slug}-copy`;
    // eslint-disable-next-line no-await-in-loop
    while (await Campaign.exists({ slug: nextSlug })) {
      nextSlug = `${slug}-copy-${n}`;
      n += 1;
    }

    const clone = await Campaign.create({
      ...rest,
      name: `${name} (copy)`,
      slug: nextSlug,
      status: 'paused',
    });
    await refreshCache();
    res.status(201).json(clone.toObject());
  })
);

router.post(
  '/campaigns/bulk',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one campaign');
    const action = str(req.body?.action, 24);

    let result;
    if (action === 'status') {
      const status = req.body?.status === 'paused' ? 'paused' : 'active';
      result = await Campaign.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { status } });
    } else if (action === 'addTags' || action === 'setTags') {
      const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).map((t) => str(t, 40)).filter(Boolean);
      result =
        action === 'setTags'
          ? await Campaign.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $set: { tags } })
          : await Campaign.updateMany({ _id: { $in: ids }, ...ownerFilter(req) }, { $addToSet: { tags: { $each: tags } } });
    } else if (action === 'delete') {
      result = await Campaign.deleteMany({ _id: { $in: ids }, ...ownerFilter(req) });
    } else {
      throw badRequest('Unknown bulk action');
    }

    await refreshCache();
    res.json({ ok: true, matched: result.matchedCount ?? result.deletedCount ?? 0 });
  })
);

router.use('/campaigns', crudRouter(Campaign, { beforeSave: normalizeCampaign }));

/* Tracking-link helper: builds the campaign URL with the source's params filled in */
router.get(
  '/campaigns/:id/links',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw notFound();
    if (!ownsDoc(req, campaign)) throw forbidden();

    const source = campaign.trafficSourceId
      ? await TrafficSource.findById(campaign.trafficSourceId).lean()
      : null;

    /* Link origin: the campaign's own tracking domain, else the default one,
     * else the install's BASE_URL. */
    const domain = campaign.domainId
      ? await Domain.findById(campaign.domainId).lean()
      : await Domain.findOne({ isDefault: true, status: 'active' }).lean();
    const origin = domain ? `${domain.protocol}://${domain.host}` : config.baseUrl;

    const base = `${origin}/c/${campaign.slug}`;
    const tokens = source?.tokens ? Object.entries(source.tokens) : [];
    const params = tokens.map(([k, v]) => `${k}=${v}`).join('&');
    const template = source?.paramTemplate?.trim();
    const query = template || params;

    res.json({
      campaignUrl: query ? `${base}?${query}` : base,
      bareUrl: base,
      goUrl: `${origin}/go?clickid={clickid}`,
      pixelUrl: `${origin}/pixel.gif?clickid={clickid}&payout={payout}&type=lead`,
      scriptTag: `<script src="${origin}/track.js" data-kcmp="${campaign.slug}"></script>`,
      origin,
      domain: domain ? { _id: domain._id, host: domain.host, isDefault: domain.isDefault } : null,
      source: source ? { _id: source._id, name: source.name } : null,
      macros: MACRO_LIST,
    });
  })
);

export default router;
