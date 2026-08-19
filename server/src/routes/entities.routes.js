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
import {
  verifyMetaAccount,
  fetchEmqScore,
  metaConfigured,
  buildMetaAuthUrl,
  metaRedirectUri,
  exchangeMetaCode,
  listAdAccounts,
  metaAccountName,
} from '../services/meta.service.js';

import {
  buildAuthUrl,
  googleConfigured,
  returnUrl,
  verifyGoogleAccount,
} from '../services/google.service.js';
import AffiliateNetwork, { POSTBACK_ROLES, DUPLICATE_MODES } from '../models/AffiliateNetwork.js';
import { networkCatalogSummary, getNetworkTemplate } from '../services/networkCatalog.service.js';
import Offer, { sanitizeOffer } from '../models/Offer.js';
import MetaPixel, { ACTION_SOURCES, sanitizeMetaPixel } from '../models/MetaPixel.js';
import Lander, { LANDER_TYPES } from '../models/Lander.js';
import FunnelTemplate, { FUNNEL_TYPES } from '../models/FunnelTemplate.js';
import Domain from '../models/Domain.js';
import Campaign from '../models/Campaign.js';
import config from '../config/env.js';
import { asyncRoute } from '../middleware/error.js';
import { publishConfigChange, getNetworkById } from '../services/cache.service.js';
import { refreshCaps, capUsage, capStatus } from '../services/caps.service.js';
import { runReport } from '../services/report.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { parseRange } from '../utils/time.js';
import { newSecurityKey, slugify } from '../utils/ids.js';
import { badRequest, isHttpUrl, isObjectId, str, notFound , forbidden} from '../utils/validate.js';
import { MACRO_LIST } from '../services/macro.service.js';

const router = express.Router();

/**
 * Sign-ins waiting on Facebook to come back, keyed by the nonce that went out
 * in the `state` parameter. Held in memory on purpose: a stale one is worth
 * nothing, they last minutes, and one worker not knowing about another's is a
 * retry rather than a fault.
 */
const metaStates = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of metaStates) if (v.at < cutoff) metaStates.delete(k);
}, 60 * 1000).unref?.();

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
      /*
       * Normally written by the sign-in callback. A typed value is accepted
       * too, because an install whose proxy has no sign-in endpoint has no
       * other way to supply one - but only a non-empty value replaces it, so
       * an ordinary save can never wipe a grant that is already there.
       */
      refreshToken: str(inc.refreshToken, 512) || prev.refreshToken || '',
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

  if (Array.isArray(body.capiPixelIds)) {
    body.capiPixelIds = [...new Set(body.capiPixelIds.filter(isObjectId).map(String))];
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

/**
 * What the install itself can do, as opposed to any one channel. The modal
 * needs this to know whether to offer a sign-in button or ask for the token
 * directly.
 */
router.get('/integrations/config', (req, res) => {
  res.json({
    googleSignIn: googleConfigured(),
    metaSignIn: metaConfigured(),
    // Facebook refuses a redirect the app has not been told about, so the
    // screen can show the operator exactly what to paste into their app.
    metaRedirectUri: metaRedirectUri(),
  });
});

/* ------------------------------------------------------------ meta pixels */

/**
 * A pixel is only useful with somewhere to send to and something to send with,
 * so both are required.
 *
 * Neither key is ever sent to the client, so the form necessarily posts an
 * empty one back on every edit. On an existing pixel that has to mean "leave
 * what is stored": reading it as "clear it" made the key required field fail
 * validation on every edit, and would have quietly dropped a Data Quality
 * token the moment anything else on the pixel was changed.
 */
const normalizeMetaPixel = async (body, existing = null) => {
  if (!str(body.title)) throw badRequest('Title is required');
  if (!str(body.pixelId)) throw badRequest('Pixel ID is required');

  const secret = (key) => (typeof body[key] === 'string' ? str(body[key], 512) : '') || existing?.[key] || '';
  body.apiKey = secret('apiKey');
  body.dataQualityToken = secret('dataQualityToken');
  if (!body.apiKey) throw badRequest('Conversions API key is required');

  if (body.actionSource && !ACTION_SOURCES.includes(body.actionSource)) body.actionSource = 'store_tracking_url';
  if (body.eventUrl && !isHttpUrl(body.eventUrl)) throw badRequest('Event URL must start with http:// or https://');

  if (Array.isArray(body.conversionMatching)) {
    body.conversionMatching = body.conversionMatching
      .map((c) => ({ conversionType: str(c?.conversionType, 60), eventName: str(c?.eventName, 60) }))
      .filter((c) => c.conversionType && c.eventName);
  }
  if (Array.isArray(body.payoutRules)) {
    body.payoutRules = body.payoutRules
      .map((c) => ({ conversionType: str(c?.conversionType, 60), value: Number(c?.value) || 0 }))
      .filter((c) => c.conversionType);
  }
  // Counters belong to the sender, not to whoever is editing the form
  delete body.eventsSent;
  delete body.lastEventAt;
  delete body.lastError;
  return body;
};

/**
 * The keys held on one pixel, for its own edit form.
 *
 * Every other route strips these, so a list of pixels never carries anybody's
 * credentials. Asking for one at a time is what lets the form show what is
 * stored - without it an operator cannot tell a right key from a wrong one, and
 * cannot copy the one they already have back out.
 */
router.get(
  '/meta-pixels/:id/secret',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const pixel = await MetaPixel.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!pixel) throw notFound('Pixel not found');
    res.json({ apiKey: pixel.apiKey || '', dataQualityToken: pixel.dataQualityToken || '' });
  })
);

/**
 * Event Match Quality for one pixel. Declared before the CRUD router below, or
 * that router would claim the path as an id and answer 404.
 */
router.get(
  '/meta-pixels/:id/emq',
  asyncRoute(async (req, res) => {
    const pixel = await MetaPixel.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!pixel) throw notFound('Pixel not found');
    res.json(await fetchEmqScore(pixel));
  })
);

router.use(
  '/meta-pixels',
  crudRouter(MetaPixel, { searchFields: ['title', 'pixelId'], beforeSave: normalizeMetaPixel, sanitize: sanitizeMetaPixel })
);

/**
 * What a pixel is attached to. The relation is stored on the channel and the
 * offer, so this reads it back from there rather than keeping a second copy
 * that could disagree with the first.
 */
router.get(
  '/meta-pixels/:id/links',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const q = { capiPixelIds: req.params.id, ...ownerFilter(req) };
    const [sources, offers] = await Promise.all([
      TrafficSource.find(q, { name: 1, createdAt: 1 }).lean(),
      Offer.find(q, { name: 1, createdAt: 1 }).lean(),
    ]);
    res.json({ sources, offers });
  })
);

/** Attach the pixel to one channel or one offer. */
router.post(
  '/meta-pixels/:id/links',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const kind = str(req.body?.kind, 10);
    const targetId = str(req.body?.targetId, 40);
    if (!['source', 'offer'].includes(kind)) throw badRequest('kind must be source or offer');
    if (!isObjectId(targetId)) throw badRequest('Invalid target');

    const Model = kind === 'source' ? TrafficSource : Offer;
    const doc = await Model.findById(targetId);
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    // Added as a set, because attaching twice would send the conversion twice
    await Model.updateOne({ _id: targetId }, { $addToSet: { capiPixelIds: req.params.id } });
    await publishConfigChange();
    res.json({ ok: true });
  })
);

router.delete(
  '/meta-pixels/:id/links/:kind/:targetId',
  asyncRoute(async (req, res) => {
    const { id, kind, targetId } = req.params;
    if (!isObjectId(id) || !isObjectId(targetId)) throw badRequest('Invalid id');
    if (!['source', 'offer'].includes(kind)) throw badRequest('kind must be source or offer');

    const Model = kind === 'source' ? TrafficSource : Offer;
    const doc = await Model.findById(targetId);
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    await Model.updateOne({ _id: targetId }, { $pull: { capiPixelIds: id } });
    await publishConfigChange();
    res.json({ ok: true });
  })
);

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
    await publishConfigChange();
    res.status(201).json(sanitizeSource(created.toObject()));
  })
);

/**
 * Start Google's consent flow and report where to send the browser.
 *
 * The proxy carries nothing through the round trip but the return address, so
 * which channel is being connected cannot ride along - the caller remembers it
 * and hands the token back to the route below.
 */
/**
 * Begin a Meta sign-in for one channel.
 *
 * The channel id rides along in `state` and comes back untouched, which is what
 * lets the callback know whose token it is holding - and what stops a callback
 * arriving from anywhere else being believed.
 */
router.post(
  '/sources/:id/integration/meta/start',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    if (!metaConfigured()) {
      throw badRequest(
        'Meta sign-in is not set up on this install. Create an app at developers.facebook.com and set META_APP_ID and META_APP_SECRET.'
      );
    }
    const doc = await TrafficSource.findById(req.params.id).lean();
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    const nonce = newSecurityKey();
    metaStates.set(nonce, { sourceId: String(doc._id), at: Date.now() });
    res.json({ url: buildMetaAuthUrl(nonce), redirectUri: metaRedirectUri() });
  })
);

/**
 * Where Facebook returns. Exchanges the code, stores the token on the channel
 * that started the flow, and closes the window it opened.
 */
router.get(
  '/integrations/meta/callback',
  asyncRoute(async (req, res) => {
    const done = (msg, ok = false) =>
      res.type('html').send(
        `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:32px">` +
          `<p>${ok ? '✓ ' : ''}${msg}</p>` +
          `<script>if(window.opener){window.opener.postMessage({kapMeta:${ok}},'*');setTimeout(()=>window.close(),1200)}</script>` +
          `</body>`
      );

    const state = str(req.query.state, 64);
    const entry = state ? metaStates.get(state) : null;
    metaStates.delete(state);
    if (!entry) return done('This sign-in link has already been used, or did not come from here.');

    if (req.query.error) return done(`Facebook refused: ${str(req.query.error_description || req.query.error, 200)}`);
    const code = str(req.query.code, 512);
    if (!code) return done('Facebook returned no code.');

    const token = await exchangeMetaCode(code);
    if (!token.ok) return done(`Could not finish the sign-in: ${token.error}`);

    const doc = await TrafficSource.findById(entry.sourceId);
    if (!doc) return done('That traffic channel no longer exists.');

    const [name, accounts] = await Promise.all([
      metaAccountName(token.accessToken),
      listAdAccounts(token.accessToken),
    ]);

    doc.integration.provider = 'meta';
    doc.integration.accessToken = token.accessToken;
    doc.integration.grantedEmail = name;
    doc.integration.lastCheckAt = new Date();
    /*
     * A grant proves someone signed in, not that this channel points at one of
     * their accounts. With exactly one visible account there is nothing to
     * choose, so it is filled in and the channel is connected outright.
     */
    const list = accounts.ok ? accounts.accounts : [];
    if (!doc.integration.adAccountId && list.length === 1) doc.integration.adAccountId = list[0].id;
    const chosen = list.find((a) => a.id === doc.integration.adAccountId);
    doc.integration.status = chosen ? 'connected' : 'not_connected';
    doc.integration.accountName = chosen?.name || '';
    doc.integration.lastError = chosen
      ? ''
      : list.length
        ? 'Signed in. Pick which of the ad accounts this channel buys from.'
        : accounts.ok
          ? 'Signed in, but this login can see no ad accounts.'
          : accounts.error;
    await doc.save();
    await publishConfigChange();

    return done(chosen ? `Connected to ${chosen.name}. You can close this window.` : doc.integration.lastError, !!chosen);
  })
);

/** The ad accounts the stored grant can see, for the channel's picker. */
router.get(
  '/sources/:id/integration/meta/accounts',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const doc = await TrafficSource.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!doc) throw notFound();
    if (!doc.integration?.accessToken) return res.json({ ok: false, error: 'Not signed in yet', accounts: [] });
    res.json(await listAdAccounts(doc.integration.accessToken));
  })
);

router.post(
  '/sources/:id/integration/google/start',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    if (!googleConfigured()) {
      throw badRequest('Google sign-in is not set up. Set GOOGLE_ADS_AUTH_URL to the proxy sign-in endpoint.');
    }
    const doc = await TrafficSource.findById(req.params.id).lean();
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    res.json({ url: buildAuthUrl(), returnUrl: returnUrl() });
  })
);

/**
 * Store the refresh token the proxy handed back, and only then decide whether
 * the channel is connected: a grant proves an account signed in, not that it
 * can see this particular ad account.
 */
router.post(
  '/sources/:id/integration/google/token',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const refreshToken = str(req.body?.refresh_token || req.body?.token, 512);
    if (!refreshToken) throw badRequest('No refresh token was returned by the sign-in');

    const doc = await TrafficSource.findById(req.params.id);
    if (!doc) throw notFound();
    if (!ownsDoc(req, doc)) throw forbidden();

    doc.integration.provider = 'google';
    doc.integration.refreshToken = refreshToken;

    const check = await verifyGoogleAccount(doc.integration);
    doc.integration.status = check.ok ? 'connected' : 'error';
    doc.integration.accountName = check.ok ? check.accountName : '';
    doc.integration.lastError = check.ok ? '' : check.error;
    doc.integration.lastCheckAt = new Date();
    await doc.save();
    await publishConfigChange();

    res.json({ ok: check.ok, integration: sanitizeSource(doc.toObject()).integration });
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
    await publishConfigChange();
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

    await publishConfigChange();
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
    await publishConfigChange();
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
    await publishConfigChange();
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

    await publishConfigChange();
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
    await publishConfigChange();
    res.json(doc);
  })
);

/* ------------------------------------------------------------------ offers */
const normalizeOffer = async (body, existing = null) => {
  if (!str(body.name)) throw badRequest('Name is required');
  if (!isHttpUrl(body.url)) throw badRequest('Offer URL must start with http:// or https://');
  if (body.networkId === '') body.networkId = null;
  if (Array.isArray(body.geo)) body.geo = body.geo.map((g) => String(g).toUpperCase().slice(0, 3));
  if (Array.isArray(body.tags)) {
    body.tags = [...new Set(body.tags.map((t) => str(t, 40)).filter(Boolean))];
  }
  if (Array.isArray(body.capiPixelIds)) {
    body.capiPixelIds = [...new Set(body.capiPixelIds.filter(isObjectId).map(String))];
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
  await publishConfigChange();
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

router.use(
  '/offers',
  crudRouter(Offer, { beforeSave: normalizeOffer, afterWrite: afterOfferWrite, sanitize: sanitizeOffer })
);

/* ----------------------------------------------------------------- landers */
const normalizeLander = async (body) => {
  if (!str(body.name)) throw badRequest('Name is required');
  if (!isHttpUrl(body.url)) throw badRequest('Lander URL must start with http:// or https://');
  if (body.type && !LANDER_TYPES.includes(body.type)) throw badRequest('Unknown landing page type');
  // Empty means "the default domain", and an empty string is not an ObjectId
  if (!body.domainId) body.domainId = null;
  if (body.domainId && !isObjectId(body.domainId)) throw badRequest('Invalid tracking domain');
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
    await publishConfigChange();
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

    await publishConfigChange();
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
  /*
   * "No domain" means the default one, and the form says so with an empty
   * option. An empty string is not an ObjectId, so it has to become null before
   * Mongoose sees it - `?? null` did not, because it only catches null and
   * undefined and leaves "" exactly as it was.
   */
  if (!body.domainId) body.domainId = null;
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
    await publishConfigChange();
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

    await publishConfigChange();
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
      // /go still answers, but /click is the name every screen shows
      goUrl: `${origin}/click?clickid={clickid}`,
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
