import express from 'express';
import Click from '../models/Click.js';
import config from '../config/env.js';
import { getCampaignBySlug, getOffer, getCampaignById, getNetworkByKey } from '../services/cache.service.js';
import { buildClick, persistClick, logClickError, CLICK_COOKIE } from '../services/click.service.js';
import { selectOffer } from '../services/rotation.service.js';
import { replaceMacros, buildMacroContext } from '../services/macro.service.js';
import { incLpClick } from '../services/stats.service.js';
import { recordConversion, logPostback } from '../services/conversion.service.js';
import { clientIp } from '../services/geo.service.js';
import { str } from '../utils/validate.js';
import { openCors } from '../middleware/security.js';
import { trackScript } from '../services/trackscript.service.js';

const router = express.Router();

const cookieOpts = {
  httpOnly: false, // /track.js needs to read it from the lander
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: config.clickCookieMaxAge,
  path: '/',
};

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
};

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * 302 by default. `meta` answers with a tiny HTML page that meta-refreshes,
 * which stops the tracker URL leaking as the referrer to the destination.
 */
function sendRedirect(res, url, type) {
  if (type === 'meta') {
    const safe = escapeAttr(url);
    return res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8">` +
          `<meta name="referrer" content="no-referrer">` +
          `<meta http-equiv="refresh" content="0;url=${safe}">` +
          `</head><body><script>location.replace("${safe.replace(/"/g, '\\"')}")</script>` +
          `<a href="${safe}">Continue</a></body></html>`
      );
  }
  return res.redirect(302, url);
}

/* ------------------------------------------------------------------ /c/:slug */
router.get('/c/:slug', (req, res) => {
  try {
    const campaign = getCampaignBySlug(req.params.slug);
    if (!campaign) {
      logClickError({ route: '/c', reason: 'unknown slug', slug: req.params.slug, ip: clientIp(req), query: req.query });
      noStore(res);
      return res.status(404).type('text/plain').send('Campaign not found');
    }
    if (campaign.status !== 'active') {
      logClickError({ route: '/c', reason: 'campaign paused', slug: req.params.slug, ip: clientIp(req), query: req.query });
      noStore(res);
      return res.status(410).type('text/plain').send('Campaign paused');
    }

    const { click, finalUrl } = buildClick(campaign, req);

    if (!finalUrl) {
      logClickError({ route: '/c', reason: 'no destination (no path/offer)', slug: campaign.slug, ip: click.ip, query: req.query });
      persistClick(click);
      noStore(res);
      return res.status(503).type('text/plain').send('No destination configured');
    }

    res.cookie(CLICK_COOKIE, click.clickid, cookieOpts);
    noStore(res);
    sendRedirect(res, finalUrl, campaign.redirectType);

    // everything below happens after the response is on the wire
    persistClick(click, campaign);
    return undefined;
  } catch (err) {
    logClickError({ route: '/c', reason: err.message, slug: req.params?.slug || '', ip: clientIp(req), query: req.query });
    noStore(res);
    if (!res.headersSent) res.status(500).type('text/plain').send('Tracking error');
    return undefined;
  }
});

/* ---------------------------------------------------------------------- /go */
router.get('/go', async (req, res) => {
  const clickid = str(req.query.clickid || req.cookies?.[CLICK_COOKIE], 64);
  noStore(res);
  try {
    if (!clickid) {
      logClickError({ route: '/go', reason: 'missing clickid', ip: clientIp(req), query: req.query });
      return res.status(400).type('text/plain').send('Missing clickid');
    }

    const click = await Click.findOne({ clickid }).lean();
    if (!click) {
      logClickError({ route: '/go', reason: 'unknown clickid', ip: clientIp(req), query: req.query });
      return res.status(404).type('text/plain').send('Unknown clickid');
    }

    const campaign = getCampaignById(click.campaignId);
    const requested = str(req.query.off, 64);

    let offer = requested ? getOffer(requested) : null;
    if (!offer && click.offerId) offer = getOffer(click.offerId);
    if (!offer && campaign) {
      const path = campaign.paths?.[click.pathIndex] || campaign.paths?.[0];
      offer = path ? selectOffer(path) : null;
    }

    if (!offer) {
      logClickError({ route: '/go', reason: 'no offer resolved', ip: clientIp(req), query: req.query });
      return res.status(503).type('text/plain').send('No offer configured');
    }

    const ctx = buildMacroContext({ ...click, offerId: offer._id }, campaign, {
      payout: offer.defaultPayout ?? '',
    });
    const url = replaceMacros(offer.url, ctx);

    res.cookie(CLICK_COOKIE, clickid, cookieOpts);
    res.redirect(302, url);

    // async tail: mark the lander click-through exactly once
    if (!click.lpClick) {
      Click.updateOne({ clickid, lpClick: { $ne: true } }, { $set: { lpClick: true, offerId: offer._id } })
        .then((r) => {
          if (r.modifiedCount) incLpClick(click);
        })
        .catch(() => {});
    }
    return undefined;
  } catch (err) {
    logClickError({ route: '/go', reason: err.message, ip: clientIp(req), query: req.query });
    if (!res.headersSent) res.status(500).type('text/plain').send('Tracking error');
    return undefined;
  }
});

/* ---------------------------------------------------------------- /postback */
router.get('/postback', async (req, res) => {
  noStore(res);
  const ip = clientIp(req);
  try {
    const key = str(req.query.key || req.query.security_key, 64);
    const network = key ? getNetworkByKey(key) : null;

    if (key && !network) {
      logPostback({ ok: false, reason: 'invalid security key', ip, query: req.query, kind: 'postback' });
      return res.status(200).type('text/plain').send('ERROR: invalid key');
    }

    // Networks may rename params - honour the mapping when one is configured.
    const map = network?.paramMapping || {};
    const pick = (canonical) => {
      const mapped = map[canonical];
      return req.query[mapped || canonical] ?? req.query[canonical];
    };

    const result = await recordConversion({
      clickid: pick('clickid') ?? req.query.cid ?? req.query.click_id,
      payout: pick('payout') ?? req.query.amount ?? req.query.sum,
      txid: pick('txid') ?? req.query.transaction_id,
      status: pick('status'),
      type: pick('type') ?? req.query.goal,
      network,
      rawQuery: req.query,
      source: 'postback',
      ip,
    });

    return res
      .status(200)
      .type('text/plain')
      .send(result.ok ? 'OK' : `ERROR: ${result.reason}`);
  } catch (err) {
    logPostback({ ok: false, reason: err.message, ip, query: req.query, kind: 'postback' });
    return res.status(200).type('text/plain').send('ERROR: internal');
  }
});

/* --------------------------------------------------------------- /pixel.gif */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get('/pixel.gif', async (req, res) => {
  const ip = clientIp(req);
  // Always answer with the gif, whatever happens with the conversion.
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.status(200).send(GIF);

  try {
    const key = str(req.query.key, 64);
    const network = key ? getNetworkByKey(key) : null;
    await recordConversion({
      clickid: str(req.query.clickid || req.cookies?.[CLICK_COOKIE], 64),
      payout: req.query.payout,
      txid: str(req.query.txid, 128),
      status: req.query.status,
      type: req.query.type,
      network,
      rawQuery: req.query,
      source: 'pixel',
      ip,
    });
  } catch (err) {
    logPostback({ ok: false, reason: err.message, ip, query: req.query, kind: 'pixel' });
  }
});

/* ---------------------------------------------------------------- /track.js */
router.get('/track.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(trackScript(config.baseUrl));
});

/* ------------------------------------------- POST /api/v1/track/pageview */
router.options('/api/v1/track/pageview', openCors, (req, res) => res.sendStatus(204));

router.post('/api/v1/track/pageview', openCors, (req, res) => {
  noStore(res);
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const slug = str(body.kcmp || body.campaign || req.query.kcmp, 64);
    const campaign = getCampaignBySlug(slug);

    if (!campaign) {
      logClickError({ route: '/track/pageview', reason: 'unknown campaign', slug, ip: clientIp(req), query: body });
      return res.status(404).json({ ok: false, error: 'Unknown campaign' });
    }

    // Reuse the redirect engine by feeding it the posted params as the query.
    const shim = {
      query: body,
      cookies: req.cookies,
      ip: req.ip,
      socket: req.socket,
      get: (h) => {
        const lower = String(h).toLowerCase();
        if (lower === 'referer' || lower === 'referrer') return body.referrer || req.get('referer') || '';
        return req.get(h);
      },
    };

    const { click, offer } = buildClick(campaign, shim, { entry: 'pageview' });
    click.finalUrl = str(body.url, 1024); // the lander itself is the destination

    res.cookie(CLICK_COOKIE, click.clickid, cookieOpts);
    res.json({
      ok: true,
      clickid: click.clickid,
      campaign: campaign.slug,
      offerId: offer?._id ? String(offer._id) : null,
      goUrl: `${config.baseUrl}/go?clickid=${encodeURIComponent(click.clickid)}`,
    });

    persistClick(click);
    return undefined;
  } catch (err) {
    logClickError({ route: '/track/pageview', reason: err.message, ip: clientIp(req), query: req.body });
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Tracking error' });
    return undefined;
  }
});

export default router;
