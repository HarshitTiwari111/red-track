# KAP Tracker

Self-hosted ad & affiliate tracking platform — click tracking, rotation, S2S postbacks and
reporting for a single company. Built on the MERN stack, no SaaS dependencies, no external paid
APIs, no multi-tenant billing.

> Original implementation. Not affiliated with, and containing no assets from, any commercial tracker.

---

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Setup](#setup)
- [Development workflow](#development-workflow)
- [Production workflow](#production-workflow)
- [Tracking endpoints](#tracking-endpoints)
- [Macros](#macros)
- [End-to-end example](#end-to-end-example)
- [nginx reverse proxy for a custom tracking domain](#nginx-reverse-proxy-for-a-custom-tracking-domain)
- [Jobs and operations](#jobs-and-operations)
- [Project layout](#project-layout)
- [API reference](#api-reference)

---

## What it does

| Capability | Detail |
|---|---|
| Click redirect | `/c/:slug` responds in single-digit milliseconds — campaign config is served from an in-memory cache, the click row is written after the 302 |
| Rotation | Weighted funnels, weighted landing pages and weighted offers inside a funnel, direct-linking or lander paths |
| Funnel templates | Save a funnel shape once and copy it into any campaign, with its filters |
| Rules | Country / device / OS / browser / hour-of-day conditions override the weighted rotation |
| No-redirect tracking | `/track.js` registers the visit server-side so Google Ads sees the real landing page URL |
| Conversions | S2S postback, conversion pixel, dedupe by transaction id, status updates that re-adjust reports |
| Cost | Fixed CPC/CPM, cost token from the traffic source, or a manual total spread across a date range |
| Offer sources | Per-source postback rules that are actually enforced: attribution window, required security key, IP allow-list and duplicate-postback mode |
| Offer caps | Unique-visit, click and conversion caps per hour/day/month/total; a capped offer leaves the rotation until the period resets, with optional Telegram alerts |
| Forwarding | Conversions pushed back to the traffic source (S2S postback) and clicks mirrored to another system, both macro-driven and fired server-side |
| Redirect type | Standard 302, or a meta-refresh that hides the tracking domain from the destination's referrer |
| Tracking domains | Register extra hosts for click links; each serves the tracking endpoints only and answers its root redirect (or 404) elsewhere, with live SSL-expiry checks |
| Bot filtering | UA pattern list + IP/CIDR blocklist; bots still redirect but are excluded from reports |
| Reporting | 21 dimensions, pre-aggregated hourly and per-subID stats with a raw-click fallback |
| Dashboard | React SPA — dashboard, campaign drilldowns, live clicks log, conversions log, CRUD, settings; dark and light themes |

---

## Requirements

- **Node.js 22+** (developed and tested on Node 24)
- **MongoDB** running locally, database `kaptracker`
- Port **3010** free — the app only ever binds this port and never touches other PM2 processes

---

## Setup

```bash
npm run install:all
```

Copy the environment template and edit it:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `MONGO_URI` | Mongo connection string, database `kaptracker` |
| `JWT_SECRET` | Signing secret for dashboard sessions — **change this** |
| `PORT` | Fixed at `3010` |
| `BASE_URL` | Public URL of the tracker; used in tracking links, macros and `/track.js` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional — alerts are skipped silently when empty |
| `NODE_ENV` | `development` or `production` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Optional seed credentials; a random password is generated when the password is blank |

Seed the database — this creates the admin user, the five prebuilt traffic sources and a demo
campaign/offer/lander/network:

```bash
npm run seed
```

The admin password is printed **once**. Save it.

---

## Development workflow

```bash
npm run dev
```

- Express API + tracking endpoints on `http://localhost:3010`
- Vite dev server on `http://localhost:5173`

Vite proxies `/api`, `/c`, `/go`, `/postback`, `/pixel.gif`, `/track.js` and `/health` to Express, so
httpOnly cookie auth and the tracking flows behave exactly as they do in production. Open
`http://localhost:5173` and sign in.

Run one side on its own with `npm run dev:server` or `npm run dev:client`.

---

## Production workflow

```bash
npm run build          # vite build -> client/dist
npm start              # pm2 start ecosystem.config.js
```

Express serves `client/dist` and falls back to `index.html` for React Router routes. The whole app —
dashboard and tracking — runs on port 3010.

```bash
npm run logs           # pm2 logs kap-tracker
npm run restart        # pm2 restart kap-tracker
npm run stop           # pm2 stop kap-tracker
```

PM2 runs the app as `kap-tracker` in cluster mode with 2 instances. Cron jobs run **only on instance
0** so they never fire twice.

To run without PM2: `npm run serve`.

---

## Tracking endpoints

All of these are public (no authentication).

| Endpoint | Purpose |
|---|---|
| `GET /c/:slug` | Click redirect. Evaluates rules → path → offer, sets the `kap_clickid` cookie, 302s to the lander or offer |
| `GET /go` | Lander → offer click-through. Reads the cookie (or `?clickid=`), marks the LP click, 302s to the offer. `?off=<offerId>` forces a specific offer |
| `GET /postback` | S2S conversion. `?clickid=&payout=&txid=&status=&type=&key=<network security key>` |
| `GET /pixel.gif` | Conversion pixel fallback, same parameters; always returns a 1×1 gif |
| `GET /track.js` | No-redirect universal script |
| `POST /api/v1/track/pageview` | Called by `/track.js`; creates the click and returns the clickid |
| `GET /health` | DB status, cache age, uptime |

**Postbacks always return HTTP 200** — `OK` or `ERROR: <reason>` — so a network never retries forever
on a malformed hit. Every attempt, successful or not, is recorded in **Settings → Diagnostics**.

Conversion behaviour:

- A repeat `txid` from the same network is ignored as a duplicate.
- The same `txid` arriving with a different status or payout **updates** the conversion, and the
  reports are adjusted by the difference.
- `rejected` conversions stop counting toward conversions and revenue.
- If the offer's payout type is `fixed`, a missing or zero `payout` falls back to the offer's default.

---

## Macros

Available in offer URLs, lander URLs and the tracking-link builder. Unknown macros become an empty
string; every value is URL-encoded.

```
{clickid} {campaign_id} {campaign_name} {campaign_slug} {source} {source_id}
{sub1} … {sub10}
{country} {country_name} {region} {city} {ip}
{device} {device_brand} {device_model} {os} {os_version} {browser} {browser_version}
{useragent} {language} {referrer} {referrer_domain}
{gclid} {fbclid} {ttclid}
{lander_id} {lander_name} {offer_id} {offer_name} {network_id} {network_name}
{cost} {payout} {timestamp} {click_time} {random}
```

---

## End-to-end example

1. **Network** — Networks → *New network*. Copy the generated postback URL and give it to the
   affiliate network.
2. **Offer** — Offers → *New offer*, pointing at the network:
   `https://network.com/click?aff_sub={clickid}&geo={country}`
   Always pass `{clickid}` — that is what comes back in the postback.
3. **Lander** (optional) — Landers → *New lander*. Its CTA must link to
   `https://track.example.com/go`.
4. **Campaign** — Campaigns → *New campaign*. Pick the traffic source, add a path (lander or direct
   linking), add the offer, set weights. Add rules if some traffic should be routed differently.
5. **Tracking link** — open the campaign and copy the campaign URL. For Google Ads it already
   contains the ValueTrack parameters:

   ```
   https://track.example.com/c/my-campaign?sub1={keyword}&sub2={matchtype}&sub3={device}&gclid={gclid}
   ```

6. **Test the flow**:

   ```bash
   # 1. click - grab the clickid out of the Set-Cookie header
   curl -i "https://track.example.com/c/my-campaign?sub1=test"

   # 2. lander click-through (skip for direct-linking paths)
   curl -i "https://track.example.com/go?clickid=<clickid>"

   # 3. conversion
   curl "https://track.example.com/postback?clickid=<clickid>&payout=25&txid=TX-1&status=approved&key=<security key>"
   ```

   The click appears in **Clicks Log** immediately, the conversion in **Conversions**, and both in the
   **Overview** cards and chart.

`TEST_CHECKLIST.md` walks through the same flow as a manual acceptance test.

### Google Ads without a redirect

Put the script on the landing page instead of using `/c/:slug`, and the visitor never leaves the real
URL:

```html
<script src="https://track.example.com/track.js" data-kcmp="my-campaign"></script>
<a href="#" data-kap-go>Continue →</a>
```

The script registers the pageview server-side, stores the clickid in a first-party cookie and
rewrites every `data-kap-go` link into a `/go` click-through. A working example ships at
`/demo-lander.html`.

---

## nginx reverse proxy for a custom tracking domain

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name track.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name track.example.com;

    ssl_certificate     /etc/letsencrypt/live/track.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.example.com/privkey.pem;

    # Real client IP - required for correct geo lookups.
    # Behind Cloudflare, use CF-Connecting-IP (the app already prefers it).
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Redirects and postbacks must never be cached or buffered
    location ~ ^/(c/|go|postback|pixel\.gif) {
        proxy_pass http://127.0.0.1:3010;
        proxy_buffering off;
        add_header Cache-Control "no-store" always;
    }

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }

    client_max_body_size 2m;
    access_log /var/log/nginx/kap-tracker.access.log;
}
```

**Cloudflare:** set SSL/TLS mode to **Full** (or **Full (strict)** with a valid origin certificate).
*Flexible* breaks the secure cookies used by the dashboard. Turn caching **off** for `/c/*`, `/go`,
`/postback` and `/pixel.gif` with a page rule — a cached redirect would serve one visitor's clickid to
everybody.

Set `BASE_URL=https://track.example.com` in `.env`, rebuild, and restart.

---

## Jobs and operations

| Job | Schedule (report timezone) | What it does |
|---|---|---|
| Stats reconciliation | hourly at :05 | Rebuilds the last 2 hours of `stats_hourly` from raw clicks and conversions — self-healing if an increment was ever lost |
| Raw click cleanup | daily 03:30 | Deletes clicks older than the retention setting (default 90 days). Aggregated stats are kept forever |
| Postback watchdog | every 5 min | Telegram alert when more than 10 postbacks fail within 5 minutes |
| Daily summary | 09:00 | Telegram summary of yesterday — clicks, conversions, revenue, profit |

Reconciliation can also be run by hand:

```bash
node server/src/tools/reconcile.cli.js 6
```

`postback_logs` and `click_error_logs` self-expire after 14 days via a TTL index.

Health check:

```bash
curl http://localhost:3010/health
```

---

## Project layout

```
server/src/
  config/      environment loading
  db/          connection + explicit index creation
  models/      Mongoose schemas
  middleware/  auth, security headers, error handling
  routes/      tracking, auth, CRUD, reporting, logs, settings, cost
  services/    cache, rotation, macros, geo, UA, bots, stats, reports, conversions, Telegram
  jobs/        cron: reconciliation, cleanup, alerts
  tools/       maintenance CLIs
  utils/       ids, validation, time/timezone, logging
client/src/
  pages/       one file per dashboard screen
  components/  DataTable, StatCard, DateRangePicker, CopyField, Modal, Layout, CampaignForm
  api/         axios instance + typed endpoint helpers
  styles/      single dark theme
```

---

## API reference

Everything under `/api/v1` (except `/api/v1/track/pageview`) needs either the dashboard session
cookie or an `X-Api-Key` header. API keys are managed in **Settings → Users**.

```bash
curl -H "X-Api-Key: kap_xxx" "http://localhost:3010/api/v1/report?groupBy=country&from=2026-08-01&to=2026-08-10"
```

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login`, `/auth/logout`, `GET /auth/me` | Session management (5 login attempts per 10 min per IP) |
| CRUD | `/campaigns`, `/offers`, `/landers`, `/sources`, `/networks` | `GET` list, `GET /:id`, `POST`, `PUT /:id`, `PATCH /:id`, `DELETE /:id` |
| `GET` | `/offers/table`, `/campaigns/table`, `/landers/table`, `/sources/table` | Entities joined with their metrics for a date range, plus totals and the tag list |
| `GET` | `/sources/catalog` | Prebuilt traffic-channel templates |
| `GET` | `/networks/table`, `/networks/catalog` | Offer sources with their offers' metrics; postback templates |
| CRUD | `/funnels` | Funnel templates; `POST /funnels/:id/clone` duplicates one |
| CRUD | `/domains` | Tracking domains; `POST /domains/:id/check-ssl` reads the certificate the host presents |
| `POST` | `/sources/from-template`, `/sources/:id/clone`, `/sources/bulk` | Create a channel from a template; duplicate; bulk status / delete |
| `GET` | `/macros` | Macro reference used by the URL builders in the modals |
| `POST` | `/landers/:id/clone`, `/landers/bulk` | Duplicate a lander; bulk status / tag / delete actions |
| `POST` | `/offers/:id/clone`, `/offers/bulk` | Duplicate an offer; bulk status / tag / delete actions |
| `POST` | `/campaigns/:id/clone`, `/campaigns/bulk` | Same for campaigns (the clone gets a free slug and starts paused) |
| `GET` | `/dashboard` | Every dashboard panel in one round trip |
| `GET` | `/campaigns/:id/links` | Generated tracking links for a campaign |
| `POST` | `/networks/:id/rotate-key` | New postback security key |
| `GET` | `/report` | `groupBy`, `from`, `to`, `campaignId`, `includeBots`, plus dimension filters |
| `GET` | `/report/timeseries`, `/report/summary`, `/report/dimensions` | Chart, cards, dimension list |
| `GET` | `/clicks`, `/clicks/:clickid`, `/conversions` | Log views |
| `GET` | `/conversions/table` | Conversions grid — 78 columns from the click snapshot plus postback fields |
| `POST` | `/conversions/manual`, `/conversions/bulk-status` | Add conversions by hand; bulk status update |
| `PATCH` | `/conversions/:id` | Edit status/payout — reports are adjusted automatically |
| `GET` | `/logs/postbacks`, `/logs/click-errors` | Diagnostics |
| `GET/PUT` | `/settings` | Bot filters, retention, timezone |
| `POST` | `/settings/telegram-test` | Send a Telegram test message |
| CRUD | `/users` | User + API key management (admin only) |
| `GET/POST` | `/cost` | Manual cost distribution |

**Report dimensions:** `campaign`, `source`, `network`, `offer`, `lander`, `country`, `device`, `os`,
`browser`, `day`, `hour`, `sub1`–`sub10`.

**Metrics per row:** clicks, uniques, lpClicks, lpCtr, conversions, cr, revenue, cost, profit, roi,
epc, cpc.

---

## Notes

- Every default chosen during the build is documented in `ASSUMPTIONS.md`.
- The manual acceptance test lives in `TEST_CHECKLIST.md`.
