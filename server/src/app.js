import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import config from './config/env.js';
import { dbState } from './db/connect.js';
import { requireAuth } from './middleware/auth.js';
import { securityHeaders, lockedCors } from './middleware/security.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { cacheStats, getDomainByHost } from './services/cache.service.js';
import { capsAgeMs } from './services/caps.service.js';
import { uniquesSize } from './services/uniques.service.js';

import trackRoutes from './routes/track.routes.js';
import authRoutes from './routes/auth.routes.js';
import entityRoutes from './routes/entities.routes.js';
import reportRoutes from './routes/report.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import logRoutes from './routes/logs.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import costRoutes from './routes/cost.routes.js';
import domainRoutes from './routes/domains.routes.js';

export function createApp() {
  const app = express();

  // Behind nginx / Cloudflare. A hop count rather than `true`, otherwise a
  // forged X-Forwarded-For would bypass the login rate limiter.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(cookieParser());

  /* ---------------------------------------------------------------------
   * Public tracking endpoints come FIRST and carry the least middleware:
   * only a small JSON parser for the pageview POST. Nothing here blocks.
   * ------------------------------------------------------------------- */
  app.use('/api/v1/track', express.json({ limit: '32kb' }));
  app.use(trackRoutes);

  /* ------------------------------------------------------- health check */
  app.get('/health', (req, res) => {
    res.json({
      ok: dbState() === 'connected',
      db: dbState(),
      dbName: mongoose.connection?.name || null,
      cache: cacheStats(),
      capsAgeMs: capsAgeMs(),
      uniquesTracked: uniquesSize(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      instance: process.env.NODE_APP_INSTANCE ?? null,
      version: '1.0.0',
      env: config.nodeEnv,
      time: new Date().toISOString(),
    });
  });

  /* ------------------------------------------------------- dashboard API */
  const api = express.Router();
  api.use(securityHeaders);
  api.use(lockedCors);
  api.use(express.json({ limit: '1mb' }));

  api.use('/auth', authRoutes);

  const secured = express.Router();
  secured.use(requireAuth);
  secured.use(entityRoutes);
  secured.use(reportRoutes);
  secured.use(dashboardRoutes);
  secured.use(logRoutes);
  secured.use(settingsRoutes);
  secured.use(costRoutes);
  secured.use(domainRoutes);
  api.use(secured);

  app.use('/api/v1', api);

  /* ---------------------------------------------------- tracking domains
   * A registered tracking domain serves the tracking endpoints only. Anything
   * else on that host goes to its root redirect (or 404) rather than exposing
   * the dashboard on a domain handed out to ad platforms.
   * ------------------------------------------------------------------- */
  const appHost = (() => {
    try {
      return new URL(config.baseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  app.use((req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    // Never lock the operator out of the host the dashboard is served on
    if (!host || host === appHost) return next();

    // Any registered host is guarded, whatever its status. A pending or paused
    // domain is still one the operator handed to an ad platform, so it must not
    // start serving the dashboard just because DNS has not verified yet. The
    // tracking routes are mounted above this, so they keep answering either way.
    const domain = getDomainByHost(host);
    if (!domain) return next();

    if (domain.rootRedirectUrl) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, domain.rootRedirectUrl);
    }
    return res.status(404).type('text/plain').send('Not found');
  });

  /* --------------------------------------------- production SPA serving */
  const distIndex = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
    /**
     * React Router fallback - anything not matched above renders the SPA.
     *
     * The tracking endpoints are excluded by exact name, not by prefix: as a
     * prefix, "postback" also swallowed the /postbacks dashboard page and left
     * it 404ing. Only /api/ and /c/ are genuine prefixes.
     */
    app.get(/^\/(?!api\/|c\/|(?:click|go|postback|postback\.js|pixel\.gif|track\.js|health)$).*/, (req, res) => {
      securityHeaders(req, res, () => {});
      res.sendFile(distIndex);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
