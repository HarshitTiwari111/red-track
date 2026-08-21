# Assumptions & defaults

Every decision taken during the build that the brief left open. Grouped by area; each entry says what
was chosen and why, and how to change it where that matters.

---

## Environment

| # | Assumption |
|---|---|
| A1 | **Node 24** is used (the brief said 22). 24 is the installed runtime and is a superset for everything here; nothing depends on a Node-22-only behaviour. |
| A2 | `MONGO_URI` defaults to `mongodb://127.0.0.1:27017/kaptracker` — local, unauthenticated, single node. |
| A3 | No replica set, so **no transactions**. Conversion writes rely on the unique `(networkId, txid)` index for deduplication rather than a transaction. |
| A4 | **PM2 is a project devDependency**, not a global install, so `npm start` works on a machine without a global pm2. `npx pm2 …` addresses it directly. |
| A5 | `.env` lives at the repo root and is loaded by the server from there; `.env.example` documents every variable. A working `.env` is committed with development defaults — **`JWT_SECRET` must be changed before production**. |
| A6 | Logs are written to `logs/` (created by PM2 on first start) and are gitignored. |

## Data model

| # | Assumption |
|---|---|
| B1 | `sub1`–`sub10` are stored as **flat fields** on the click rather than an array, so they can be indexed and aggregated directly. |
| B2 | Click documents keep a **snapshot** of the traffic source name, and conversions keep a snapshot of country/device/clickTs. Reports and reconciliation then need no joins, and renaming a source does not rewrite history. |
| B3 | The settings collection holds a **single document** with `_id: "global"`. |
| B4 | Campaign `slug` is unique, lowercase, and derived from the name unless typed explicitly. Duplicate slugs are rejected with a clear message rather than silently suffixed. |
| B5 | `postback_logs` and `click_error_logs` use a **14-day TTL index**; raw clicks use the configurable retention setting (default 90 days). Aggregated stats are never deleted. |
| B6 | Deleting a campaign/offer/lander does **not** delete its clicks, conversions or stats — historical reporting stays intact. Report labels fall back to the raw id when the entity is gone. |
| B7 | An extra `cost_entries` collection records manual cost pushes as an audit trail. Not in the brief; the numbers themselves live in `stats_hourly` and on the clicks. |

## Time and stats bucketing

| # | Assumption |
|---|---|
| C1 | **Stats buckets are stored in the report timezone, not UTC.** A bucket whose value prints as `2026-08-10T14:00:00.000Z` means 14:00 *local*. This is deliberate: the default timezone is `Asia/Kolkata` (+05:30), and deriving local days from true-UTC hour buckets would smear each day boundary across a half-hour. Raw `clicks.ts` and `conversions.ts` remain true UTC. |
| C2 | Consequence of C1: **changing the report timezone does not retro-convert existing buckets.** Old data keeps the boundaries it was written with. Change the timezone at a quiet time, or re-run reconciliation over the affected window. |
| C3 | **Conversions are attributed to the click's hour bucket**, not the conversion's own timestamp, so revenue lines up with the traffic that produced it and ROI per hour/day is meaningful. The Conversions log still shows the real conversion time. |
| C4 | `stats_subs` is aggregated **daily**, not hourly — sub-ID cardinality is high and hourly rows would explode the collection. Sub dimensions therefore have no `uniques` or `lpClicks` columns. |
| C5 | Date-only report bounds (`from=2026-08-10`) mean the whole local day, `00:00:00.000` to `23:59:59.999`. |

## Click engine

| # | Assumption |
|---|---|
| D1 | The redirect does **geo + UA parsing synchronously** (both are local, in-memory operations) because rules need country and device before a path can be chosen. The database write happens after the response. |
| D2 | Campaign configuration is cached in-process and refreshed every 30s. In cluster mode a CRUD change reaches the other worker within one refresh cycle — up to 30s of staleness on config edits is accepted. Writes refresh the cache in their own worker immediately. |
| D3 | **Uniqueness** = no existing `kap_clickid` cookie *and* this `campaignId:ip` has not been seen by this worker in the last 24h. The set is in-process and capped at 200k entries, so uniques can be slightly over-counted across workers. A cross-worker store was not worth a Redis dependency for a heuristic. |
| D4 | When no path or offer resolves, the click is still **recorded** and the response is `503` — the traffic is not silently lost. |
| D5 | The `kap_clickid` cookie is **not** httpOnly, because `/track.js` must read it on the landing page. It contains only an opaque click id. Lifetime 90 days, `SameSite=Lax`. |
| D6 | Paused campaigns return `410 Gone` (distinct from `404` for a slug that never existed). |
| D7 | A path with `directLinking: false` but no lander configured falls through to the offer rather than failing. |
| D8 | Client IP resolution order: `CF-Connecting-IP` → first `X-Forwarded-For` entry → socket address. `trust proxy` is enabled, which assumes the tracker sits behind nginx/Cloudflare. |

## Rotation and rules

| # | Assumption |
|---|---|
| E1 | **Rules are evaluated before weighted rotation**, top to bottom; the first match wins. An empty condition list means "any". |
| E2 | If every path weight is 0, selection falls back to uniform random rather than dropping the click. |
| E3 | Paused offers are skipped during offer selection. If a path has no active offer, the click is recorded and answered with `503`. |
| E4 | Rule hour windows use the **report timezone** and are inclusive. `from > to` wraps overnight (22→5 means 22,23,0…5). |
| E5 | Deleting a path in the campaign editor re-anchors existing rules: rules pointing at the removed path are dropped, later indices shift down. |

## Conversions

| # | Assumption |
|---|---|
| F1 | Deduplication is scoped to **(network, txid)**. Conversions with a blank `txid` are excluded from the unique index entirely, so multiple untracked conversions on one click are all recorded. |
| F2 | `approved` **and** `pending` both count toward conversions and revenue; only `rejected` contributes nothing. Pending revenue is money in flight and is shown as such. |
| F3 | The same `txid` arriving with a changed status or payout **updates** the conversion, and stats are adjusted by the delta — including negative deltas. |
| F4 | Postbacks always answer **HTTP 200** with `OK` or `ERROR: <reason>`, so a network never enters an infinite retry loop. Every attempt is logged. |
| F5 | A postback **without** a `key` is accepted, and the network is inferred from the offer. Supplying a *wrong* key is rejected. This keeps simple networks working while still letting the key scope deduplication. |
| F6 | Default conversion type is `lead`, default status `approved`, when the network sends neither. |
| F7 | Common parameter aliases are accepted out of the box (`cid`/`click_id`, `amount`/`sum`, `transaction_id`, `goal`) in addition to the per-network mapping. |
| F8 | The conversion pixel writes its 1×1 gif **before** processing the conversion, so a tracking failure can never break the page it sits on. |

## Bot filtering

| # | Assumption |
|---|---|
| G1 | A **missing user-agent counts as a bot** — no real browser omits it. |
| G2 | Bot clicks are stored and still redirect normally (blocking them would tell the crawler it was detected), but are excluded from reports unless `includeBots=true`. Their count is kept in a separate `bots` counter. |
| G3 | The seeded UA list matches ~28 common crawler/automation substrings, **including `curl/`** — so `curl` tests appear flagged as bots. That is correct behaviour, not a bug. Remove the pattern in Settings → Filters to test with curl as a human. |
| G4 | Patterns are matched as escaped case-insensitive **substrings**, not raw regex, so an operator cannot break the filter with an invalid expression. |
| G5 | The IP blocklist accepts plain IPv4, IPv4 CIDR and exact IPv6 addresses. IPv6 CIDR is not supported. |

## Cost

| # | Assumption |
|---|---|
| H1 | Manual cost is distributed **evenly per click** across every non-bot click in the range — not weighted by hour of day. |
| H2 | A manual push writes to **both** the raw clicks and the hourly buckets, so the pre-aggregated and raw report paths always agree, and reconciliation reproduces the same number. |
| H3 | Pushing cost for a period with zero clicks is rejected rather than silently discarded. |
| H4 | CPM cost is charged per click as `costValue / 1000` — the tracker sees clicks, not impressions. |
| H5 | Bot clicks carry a cost value on the document but are excluded from cost totals in reports. |

## Funnel templates

| # | Assumption |
|---|---|
| T1 | A funnel template is a **reusable funnel shape**, not a live link. Applying one to a campaign **copies** it in as a new funnel — later edits to the template deliberately do not reach campaigns already built from it, so changing a template can never alter live traffic behind your back. |
| T2 | **Apply template** lives in the campaign editor's Funnels panel. If the template has filters enabled, applying it also adds the matching campaign rule pointing at the new funnel, which is how a filter actually takes effect. |
| T3 | Template types are **Single landing** and **Direct to offer**, matching the two funnel shapes the click engine runs. Pre-landing chains are still absent (see N2). |
| T4 | Adding this brought **weighted landing-page rotation** to campaign paths: `path.landers` is a weighted list and the engine picks one per click. The old single `path.landerId` is still read when a path predates the change, and the editor shows it as a one-row list, so existing campaigns keep working untouched. Verified deterministically — weights 100/0 sent every click to the first lander, 0/100 to the second. |
| T5 | **Filter presets** in the modal are shortcuts that fill the condition fields (mobile only, tier-1, evening hours…). They are not a stored entity, so there is no preset library to manage. |
| T6 | **Per-offer filters** from the reference are absent: a rule routes a visitor to a funnel, not to one offer inside it, so an offer-level condition would have nowhere to apply. The modal says so. |
| T7 | **New lander / New offer** open their own pages in a new tab rather than nesting a creator inside the modal, which would risk losing unsaved funnel state. |

## Offer sources

| # | Assumption |
|---|---|
| S1 | The affiliate-network screen is now **Offer sources** (sidebar and page title), with the same grid shell and a **New From Template / New From Scratch** pair. Its numbers are the **sum of the offers assigned to it**, since conversions attach to offers rather than to the source directly. |
| S2 | The fixed `paramMapping` grew into a **`params` list** of `{param, macro, name, role}`. Roles cover clickid, payout, txid, status, type, event, coupon, refid and pubrevenue. `paramMapping` is still written from the roles on save, so the postback handler and older records keep working. Networks saved before this show their old mapping as rows. |
| S3 | **Click expiration is real**: a conversion whose click is older than the configured window is refused with `ERROR: click expired` and logged. `days: 0` means the guard does nothing — a zero-day window would reject everything. |
| S4 | **Postback protection is real**: with it on, a postback carrying no valid security key is refused even though the offer would otherwise identify the network. Off by default, because turning it on before the network sends the key would drop live conversions. |
| S5 | **Whitelisted IPs are real**: postbacks from an unlisted IP are refused. An empty list allows everything — the toggle alone blocks nothing, and the field says so. |
| S6 | **Duplicate postback mode** is real and defaults to `update`, which is the behaviour the tracker already had (F3). `ignore` never rewrites an existing conversion; `create` records each repeat as its own conversion, suffixing the transaction id (`TX-1`, `TX-1#2`, `TX-1#3`) so the unique `(network, txid)` index still holds and the origin stays visible. |
| S7 | The catalog templates are **shaped by postback pattern**, not by brand. The `macro` column is deliberately blank: only a network's own documentation says which token it substitutes, and a guessed macro would deliver empty values on every conversion. Real third-party logos are not used either. |
| S8 | **Offer URL template** pre-fills the URL when creating an offer under the source. **Currency** is a display label — no FX conversion anywhere. |
| S9 | An offer's own `defaultConversionStatus` still wins over the source's, since it is the more specific setting. |

## Tracking domains

| # | Assumption |
|---|---|
| R1 | **Domains** lives under System in the sidebar. The tracking endpoints already answer on any host that reaches the server, so a domain record is what makes that host *known* to the tracker rather than what enables it. |
| R2 | A registered tracking domain **serves the tracking endpoints only**. Any other path on that host returns its root-redirect URL, or 404 when blank — so the dashboard is not exposed on a domain handed out to ad platforms. The host the dashboard itself runs on (`BASE_URL`) is explicitly exempt, so a misconfigured record can never lock the operator out. |
| R3 | **No certificate material is ever stored.** The reference tool provisions SSL because it is SaaS; here nginx or Cloudflare terminates TLS. The "Free SSL certificate" toggle and the Certificate/Key textareas are therefore absent — storing private keys in Mongo for a component that never terminates TLS would be pure secret sprawl. The modal says where to issue the certificate instead. |
| R4 | The **SSL expiry** column is real: the server opens a TLS connection to the host and reads the certificate it presents (`rejectUnauthorized: false`, so an expired or untrusted certificate is reported rather than aborting). Checked on demand from the page and by a daily 04:10 cron. Certificates inside 21 days are flagged amber, expired ones red. |
| R5 | **Domain expiry (registrar)** and **Reissue** are absent — the first needs a WHOIS/RDAP lookup service, the second is SSL provisioning this tracker does not do. |
| R6 | Only one domain can be `isDefault`; setting it clears the flag on the others. Second-level domains are rejected at save time, because CNAMEing an apex record breaks the rest of the zone. |
| R8 | A campaign carries a **`domainId`**, and its tracking links are built on that domain — falling back to the default domain, then to `BASE_URL`. The click endpoints already answer on any host, so choosing a domain changes the link you hand out, not where traffic can arrive. |
| R7 | Local TLS interception changes what the check sees: on a machine running an antivirus HTTPS scanner, the issuer comes back as that product rather than the real CA. That is the certificate the server genuinely receives, so it is reported as-is. |

## Traffic channels

| # | Assumption |
|---|---|
| Q1 | The page is now titled **Traffic Channels** (sidebar too) and uses the same grid shell as the other entity screens, with **New From Template** and **New From Scratch** side by side. |
| Q2 | A channel's parameters moved from a plain `tokens` map to a **`params` list** of `{param, macro, name, role}`. `tokens` and `paramTemplate` are still derived from it on save, so the campaign tracking-link builder is untouched. Channels saved before this change show their old tokens as rows with no role. |
| Q3 | **Roles are functional, not labels.** Giving a parameter the role `keyword`, `campaign`, `adgroup`, `ad`, `placement`, `source` or `medium` routes that click's value into the matching `utm` slot, which is what the conversions grid shows as `Rt keyword`, `Rt campaign` and so on. `cost` and `clickref` keep the shorthand `costParam` / `clickIdParam` fields in step. |
| Q4 | The **catalog** ships 8 templates (Other, Google Ads, Google PMax, Facebook, TikTok, Push/Pop, Microsoft, Organic). Templates only pre-fill parameters, macros and the cost/click-id fields. |
| Q5 | The reference's **API Integrations chips** (cost update, campaign pause, blacklist placement, pause creative) are **not** shown — this tracker has no ad-platform API integrations, and advertising capabilities it does not have would be the most misleading thing on the page. Each card lists what the template actually pre-fills instead. **Clone (Google ads)** is likewise absent; plain Clone is there. |
| Q6 | **Currency** is stored as a display label. The tracker does no FX conversion — every amount is stored and reported exactly as received. |
| Q7 | A channel's **S2S postback template** fires on conversion for campaigns that have no forwarding list of their own; a campaign's own `postbackForwarding` always wins. |
| Q8 | **Report** on a channel opens the Campaigns grid filtered to it (`/campaigns?trafficSourceId=…`). |
| Q9 | Channel metrics are matched by the **channel name snapshot** stored on each click, so renaming a channel splits its history. This is called out under the table. |

## Conversions grid

| # | Assumption |
|---|---|
| P1 | The Conversions screen carries **78 columns**, matching the reference list. Only 14 are visible by default — the sub, UTM and device columns start hidden behind **Columns**, because 78 visible columns is unusable. |
| P2 | Each conversion stores a **snapshot of its click** (geo, city, device, OS, browser, IP, user agent, cost, lander, deeplink, sub1–sub20, UTM values) taken at insert time. The grid therefore renders from one collection with no joins, and the row stays complete even after retention prunes the raw click. |
| P3 | Clicks now capture **sub1–sub20** (was sub1–sub10) and a **UTM block** (`utm_source`, `utm_medium`, `utm_campaign`, `utm_adgroup`/`utm_adset`, `utm_content`, `utm_placement`, `utm_term`), which is what the reference's `Rt source` … `Rt keyword` columns hold. Common aliases are accepted for each. |
| P4 | `stats_subs` still pre-aggregates **sub1–sub10 only**; sub11–sub20 are reportable through the raw-click path. Pre-aggregating 20 sub dimensions would double that collection for little gain. |
| P5 | Postback-side fields are captured when the network sends them: `convSub1`–`convSub20` (a plain `sub1`… on the postback also works), `event`, `coupon`, `ref_id`, `pub_revenue` and the postback's own IP. |
| P6 | **Duplicate status** is real: a repeat postback for the same `(network, txid)` increments `duplicateHits` on the existing conversion instead of being silently dropped, and the column reports the count. **Deduplicate Token** is the `txid`. |
| P7 | **Add conversions** takes `clickid, payout` per line and runs each through the normal recording path, so dedupe, payout fallback and stats behave exactly like a real postback. **Upload** reads a CSV/TXT file into the same box. The result reports added / duplicate / failed counts with the first failure reason. |
| P8 | **Export (Google Ads)** emits the offline conversion import format (Google Click ID, Conversion Name, Conversion Time, Conversion Value, Conversion Currency, with a `Parameters:TimeZone=UTC` header) and only includes conversions whose click carried a `gclid`. Currency is hard-coded to USD — the tracker does not store one. |
| P9 | Three reference columns are **absent because no data exists behind them**: `ISP` and `Connection type` (geoip-lite carries neither, and no connection-type signal reaches the server) and `Pre-Landing` (there is no pre-lander step — see N2). Everything else in the reference list is present and populated. |

## Landers

| # | Assumption |
|---|---|
| N1 | The Landers screen uses the same grid shell as Offers and Campaigns (filter bar → action toolbar → totals in the footer → column/density/reset → pager), and the modal follows the reference: Name, Type, URL + macro chips, Tracking domain, Click URL, Tags, Optional settings. |
| N2 | **Landing page `type`** (landing / pre-landing / listicle landing / listicle pre-landing) is stored, shown and filterable, but it is a **classification only**. The tracker's funnel is single-page — a path is one landing page then the offer — so a pre-landing page is used exactly like a landing page. Chaining pre-lander → lander → offer would need a second lander slot on the path plus a multi-step `/go`, which is not built. |
| N3 | The macro chips list **this tracker's real macros** (46 of them, served from `GET /api/v1/macros`), not the reference tool's names. Clicking a chip appends `?name={name}` (or `&name={name}`) to the URL. |
| N3b | The macro set was widened to cover everything the tracker can genuinely resolve: `country_name` (via `Intl.DisplayNames`), `device_brand`, `device_model`, `os_version`, `browser_version`, `useragent`, `language` (first entry of `Accept-Language`), `referrer_domain`, `source_id`, `lander_name`, `offer_name`, `network_id`, `network_name` and `click_time`. The click document now stores UA versions/vendor/model and the language to back them. |
| N3c | Reference macros with **no data behind them here are deliberately absent**: `{isp}` and `{connectiontype}` (geoip-lite carries neither), `{prelanderid}`/`{prelandername}` (no pre-lander step — see N2), `{sub11}`–`{sub20}` (the tracker records sub1–sub10), and the `{rt_*}` / `{lpkeyua}` / `{palias}` family, which are that product's internal fields. A macro that always resolves to an empty string silently corrupts the destination URL, so adding them as look-alikes would be worse than leaving them out. |
| N4 | **Click URL** is `BASE_URL/go` — the equivalent of the reference tool's `/click`. Its optional parameter is `?off=<offerId>` to force one offer; arbitrary extra parameters are not recorded against the lander. |
| N5 | A lander's **LP views** are the clicks routed to it and **LP clicks** are the visitors who clicked through to the offer. The tracker has no separate page-view beacon, so "clicks" and "LP views" are the same number and only LP views is shown. |
| N6 | **Optional settings** holds Status and Notes — the fields that exist here but are not in the reference's main body. |
| N7 | Landers keep Export in the table tools even though the reference's Landers screen omits it, so all three grid pages behave the same. |

## Campaigns & funnels

| # | Assumption |
|---|---|
| M1 | The Campaigns screen uses the same grid shell as Offers (filter bar → action toolbar → totals row → column/density/reset → pager), and the modal has a **single Campaign details tab**, as requested. Creatives, Custom payouts and Update costs were deliberately left out — Update costs is instead a toolbar action that opens the existing cost-distribution flow. |
| M2 | RedTrack's **funnel** is our rotation **path**, and a funnel's **filters** are the campaign rules whose `pathIndex` points at it. The data model did not change — the editor just presents rules grouped under the funnel they route to. |
| M3 | Funnel types are **Offer** (direct linking) and **Landing > Offer**. "Pre-landing > Landing > Offer" and "Template" need a pre-lander entity and a template library that this tracker does not have. |
| M4 | The cost segmented control exposes the four models the click engine really computes — **CPC, CPM, From token, Do not track**. CPA and REVSHARE were *not* added as look-alike buttons: they charge cost per conversion rather than per click, which the stats pipeline does not do, and a control that silently produced wrong money numbers would be worse than not having it. |
| M5 | "Smart traffic distribution" (auto-optimisation) is not implemented; weights and filters decide the split. The toggle was omitted rather than faked. |
| M6 | **Redirect type** is a real setting: `302` (default) or `meta`, which answers with a meta-refresh page carrying `referrer: no-referrer` so the tracking domain does not leak as the referrer. 301 is deliberately absent — browsers cache it, which would freeze the rotation. |
| M7 | **S2S postback forwarding** fires configured URLs server-side whenever a conversion is recorded, with the full macro set available — this is how a conversion gets pushed back to Google/Meta for optimisation. **Click forwarding** does the same on every non-bot click. Both are fire-and-forget with a 6s timeout; only *failures* are written to `postback_logs` (kind `postback-forward` / `click-forward`) to keep the log small. |
| M8 | Impression forwarding from the reference UI was omitted — the tracker does not record impressions, so there would be nothing to forward. |
| M9 | The **Domain** select shows the configured `BASE_URL` and is read-only; multi-domain tracking would need per-campaign domains and certificates. |
| M10 | Cloning a campaign finds a free slug (`slug-copy`, `slug-copy-2`, …) and starts the clone **paused**. |
| M11 | Config edits reach the other PM2 worker on its next 30s cache tick, so a freshly saved forwarding URL or redirect type can take up to 30 seconds to apply on every worker. |

## Offers & caps

| # | Assumption |
|---|---|
| O1 | The Offers screen is modelled on a RedTrack-style grid: filter bar, selection-driven action toolbar, totals row in the header, and column/density/reset controls. Column visibility and density persist in `localStorage` per browser. |
| O2 | RedTrack's "Offer source" is our **affiliate network** — the same concept (who sends the postback), so no separate entity was added. |
| O3 | The third modal tab is **Postback & macros**, not RedTrack's "CAPI (Maximize signals)". Conversions API integrations push data to external ad platforms, which contradicts the self-hosted / no-external-API constraint, so a tab that looked functional but did nothing was not built. |
| O4 | **Caps** (unique visits, click cap, conversion cap) pull an offer out of the *rotation* only. Visitors already on a lander still reach it through `/go` — cutting them off mid-funnel would lose traffic that has already been paid for. |
| O5 | Cap counters are recomputed **every 30 seconds** in memory, not per click, so the redirect stays free of database reads. An offer can therefore overshoot its cap slightly under heavy traffic. |
| O6 | If *every* offer in a path is capped, caps are ignored for that click rather than dropping the visitor — a capped funnel still beats a 503. |
| O7 | Cap periods (`hour`/`day`/`month`/`total`) reset on report-timezone boundaries. `total` never resets. |
| O8 | Cap alerts fire once per offer, per cap type, per period, and need a Telegram token. |
| O9 | An offer's **default conversion status** is applied when a postback arrives without one, replacing the previous hard-coded `approved`. |
| O10 | Tags are a free-form string array on the offer used for filtering and bulk edits. There is no separate tags collection. |
| O11 | Cloning an offer copies caps and tags, appends "(copy)" and starts the clone **paused**, so a duplicate never silently enters rotation. |
| O12 | "Upload" (bulk CSV import of offers) from the reference UI was **not** built. Export to CSV is implemented; import is the larger half and was not requested explicitly. |

## Reporting

| # | Assumption |
|---|---|
| I1 | Reports use `stats_hourly` for campaign/country/device/day/hour, `stats_subs` for sub1–sub10, and fall back to a raw `clicks` aggregation (with a `$lookup` into conversions) for source/network/offer/lander/os/browser or any query with a non-pre-aggregated filter. Each response reports which path it used in `source`. |
| I2 | `network` has no dimension of its own on the click, so raw mode groups by offer and remaps to the offer's network. |
| I3 | Rows where every metric is zero are omitted — they carry no information. |
| I4 | Result sets are capped at 500 rows by default, 5000 maximum. |
| I5 | ROI is `profit / cost × 100` and is reported as `0%` when cost is zero, rather than infinity. |
| I6 | Revenue in reports counts non-rejected conversions only, matching F2. |

## Dashboard

| # | Assumption |
|---|---|
| J1 | Sorting, filtering and search happen **client-side** on the fetched page of rows. At the row counts a self-hosted internal tracker produces, this is faster than a round trip. |
| J2 | The Clicks Log auto-refreshes every 10s and shows the most recent 500 clicks; the toggle is on by default. |
| J3 | The date range lives in a shared context, so switching pages preserves the selection. Default range is **Today**. |
| J4 | Charts switch to hourly granularity automatically when the range is a single day. |
| J5 | Traffic-source token mappings are edited as `key=value` lines rather than a row builder — that is how operators copy them out of ad platform docs. |
| J6 | Members can read settings but not change them; only admins can write settings and manage users. |
| J7 | The whole dashboard is one bundle (~677 kB, ~199 kB gzipped) with no code splitting — an internal tool loaded once per session does not benefit from route chunks. |
| J8 | `client/public/demo-lander.html` ships with the build as a test page for the no-redirect script. Delete it if you would rather not serve it in production. |
| J9 | **Dark and light themes** share one set of CSS variables, so a component only has to use `var(--…)` to work in both. The choice is stored in `localStorage` (`kap.theme`) and defaults to the operating system's `prefers-color-scheme` on first visit. The toggle lives at the bottom of the sidebar. |
| J10 | Recharts takes colours as props rather than CSS, so chart palettes live in `useChartColors()` in `ThemeContext` and must be kept in step with the CSS blocks by hand. |
| J11 | Chromium keeps the *previously computed* value of a property that has a CSS `transition` when only a custom property underneath it changes — on theme switch that left the sidebar link and primary buttons on the old accent colour. Transitions on colour/background were therefore removed from `.nav a` and `.btn` (a `theme-switching` class that suppresses transitions for one frame is also applied during the swap). Only `opacity` still animates on buttons. |
| J12 | Table **totals render in `<tfoot>`, under the rows**, sticky to the bottom of the scroll area. |
| J13 | Alert text uses the theme's semantic colour (`--red` / `--green` / `--accent`) rather than a fixed pale tint. The original tints were picked for a dark background and washed out to near-invisible on the light theme — the same bug class as J11. |
| J14 | Modal widths: `wide` (980px) is the default for form and picker dialogs; `full` (1240px) is reserved for the campaign editor, which is the only genuinely two-column layout. A single-column form at full width just stretches its inputs. |
| J15 | Long setup explanations sit in a quiet `.page-note` line with a **Setup notes** toggle rather than a permanent coloured banner. |
| J16 | The **sidebar is navy in both themes**, so it carries its own foreground variables (`--sidebar-text`, `--sidebar-active-text`, …) instead of the page ones. Reusing `--text-dim` there would have made the light theme render grey-on-navy. |
| J17 | Account controls moved out of the sidebar into a **topbar avatar menu**: name, role, a theme toggle, and Logout. The theme switch now lives only there. |
| J18 | **Logout asks for confirmation** in a modal before ending the session. Cancel leaves the session untouched. |
| J19 | `User.name` is a new optional field shown in the menu and the users table; when blank the menu falls back to the capitalised local part of the email, so the avatar and name are never empty. |
| J20 | **Modals render through a portal into `<body>`.** A `position: fixed` backdrop is contained by any ancestor carrying a transform, filter or `backdrop-filter` — the topbar has `backdrop-filter: blur()`, so the logout dialog opened from the user menu was being clipped to the height of the topbar. Any modal opened from inside the topbar would have hit the same thing. |
| J22 | Confirmation dialogs use a **`small` (440px) modal** with an icon + copy layout. The confirming action is a **solid** destructive button (`.btn.danger.solid`) so it reads as the primary choice; the quiet `.btn.danger` outline stays for row-level Delete actions, where the destructive option should *not* dominate. |
| J23 | Modals now come in four widths — `small` 440px (confirmations), `compact` 620px (short single-column forms), the 720px default, `wide` 980px and `full` 1240px. The domain form uses `compact`: at 980px its six fields sat stranded in white space. Related: `.rt-hint` only had a rule scoped to `.rt-field`, so the ~20 standalone hint blocks across the modals were rendering at full body-text size; a base `.rt-hint` rule now makes every one of them muted 11.5px. |
| J24 | **Tracking domains start `pending` and are proved by DNS.** `status` is now `pending → active → paused`: create always stores `pending` (a client-supplied `status` is ignored), `POST /domains/:id/verify` flips it to `active` once the record is visible, and a `*/10` cron re-checks pending domains so the operator need not sit on the button. A failed check keeps the domain `pending` and answers **200**, not an error — propagation takes 5 minutes to 48 hours, so failing first is the expected path, not a fault. Verification never resurrects a domain the operator paused, and changing the host clears the proof. Editing can still force `active` by hand, because an A record to a load balancer is a legitimate setup the check may never confirm. |
| J25 | Verification passes on a **CNAME match or a shared A record**. CNAME alone would permanently fail Cloudflare-proxied domains (the CNAME is flattened away) and plain A-record setups, so `resolve4` on both names is compared for a shared IP as a second chance. `resolveCname`/`resolve4` are used rather than `dns.lookup`, which would answer from the OS resolver and the hosts file. |
| J26 | Verification resolves through **1.1.1.1 / 8.8.8.8 by default, not the system resolvers** (`DNS_RESOLVERS=system` opts back in). The question is what the public internet sees; the local resolver is the wrong witness. On the dev box this was not theoretical — `/etc/resolv.conf` pointed at a stub on `127.0.0.1` with nothing listening, so every lookup returned ECONNREFUSED. |
| J27 | The tracking-domain host guard now applies to **every registered host regardless of status**, not just `active` ones. With domains starting `pending`, the old `status !== 'active'` check would have served the dashboard on a freshly added tracking domain. Tracking routes are mounted above the guard, so they keep answering on pending and paused domains. |
| J28 | **TLS is still terminated by the reverse proxy — no ACME client is embedded.** `greenlock-express` needs to own ports 80/443 for the HTTP-01 challenge, which collides with the standing "only use port 3010, never touch other PM2 processes" constraint, and the Cloudflare route needs an account-bound API token. The domain page instead verifies DNS, then reads back the certificate the host actually presents, so certbot or Cloudflare remains the (free, self-hosted) way to issue it. |
| J29 | Per-row table controls use **icon buttons in a `.row-actions` flex row that never wraps**, not `.btn-group`. `.btn-group` wraps, so a third button in the narrow Actions column stacked them vertically and made every row ~130px tall. Icons carry `title` and `aria-label`, since the label is no longer visible. |
| J30 | The domain dialog carries a **Free SSL certificate** toggle, **off by default**. Off reveals Certificate and Key textareas; on shows an advisory panel. Both fields blank is a valid state — that is how a pair is removed — so the blank check runs against the submitted key, not the stored one, otherwise a key on file would make a cleared form look half-filled and block the removal. A certificate without a key (or the reverse) is rejected. |
| J31 | A pasted certificate is **validated, not just stored**: PEM markers present, parses as X.509, not expired, and `checkPrivateKey` confirms the key actually belongs to it. Expiry, issuer and subject are parsed once and denormalised onto the domain so the table need not re-parse. Bundles are accepted, leaf first. |
| J32 | **The private key is never returned by the API.** Every domain response goes through `sanitize()`, which strips `sslPrivateKey` and substitutes a `hasPrivateKey` boolean; an edit therefore shows the field blank rather than masked, and leaving it blank keeps the stored key. The advisory panel deliberately does **not** claim the tracker issues certificates — it does not; TLS still belongs to nginx/certbot or Cloudflare. |
| J33 | `targetCname` is snapshotted per domain, but **only a verified domain keeps its snapshot** — a pending one always re-reads `DNS_TARGET_CNAME`. The original always-snapshot rule meant a domain added before the target was configured kept checking the stale value forever: the operator fixes their config, every pending domain still fails against the old hostname, and the only way out is deleting and re-adding. The modal follows the same rule so the record it prints matches the one the check will use. |
| J21 | The sidebar nav scrolls with its scrollbar hidden (`scrollbar-width: none` plus the WebKit pseudo-element), since a visible bar on a 232px rail eats into the labels. Scrolling itself is untouched — only the indicator is gone. |

## Security

| # | Assumption |
|---|---|
| K1 | JWT lives in an httpOnly cookie for 7 days; `secure` is set only when `NODE_ENV=production`, so http works in development. |
| K2 | API keys are an **alternative** to the cookie on `/api/v1/*`, sent as `X-Api-Key`. Every user gets one; it is rotatable. |
| K3 | Login rate limiting is 5 attempts per 10 minutes per IP with successful logins not counted. The store is in-process, so in cluster mode the effective ceiling is 5 × instances. |
| K3b | **`trust proxy` defaults to 0**, not `true`. With any value above 0, `req.ip` comes from `X-Forwarded-For`, and testing confirmed a client that can reach port 3010 directly can forge that header and reset the login limiter on every attempt. Set `TRUST_PROXY=1` only once nginx/Cloudflare fronts the app **and** the port is firewalled. Click geo still reads the forwarded header independently — a forged one only pollutes the attacker's own click row, so it is not a security boundary. |
| K4 | CORS on the dashboard API is locked to `BASE_URL`. `/api/v1/track/pageview` is deliberately open, because it is called from arbitrary landing-page domains. |
| K5 | Security headers (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`) are applied to dashboard and API routes only — never to `/c/:slug`, to keep the redirect path minimal. |
| K6 | Passwords are bcrypt with cost 10, minimum 8 characters. |
| K8 | Mongoose `CastError` and `ValidationError` are answered as **400 with a clean message** instead of leaking the raw driver text (`Cast to ObjectId failed … BSONError`) as a 500. |
| K7 | Request bodies are capped at 1 MB for the API and 32 kB for the pageview endpoint. Mongo operators (`$`, dotted keys) are stripped from incoming objects before they reach a query. |

## Jobs

| # | Assumption |
|---|---|
| L1 | Cron runs on **instance 0 only** (`NODE_APP_INSTANCE`), or on the single process outside PM2. |
| L2 | Reconciliation rebuilds the last **2 hours** and runs at :05 past each hour. It `$set`s the recomputed values rather than incrementing, which is what makes it self-healing. The window is snapped back to the start of a whole local hour, because recomputing a bucket from only part of its hour would rewrite it with less traffic than it really had. |
| L2b | Reconciliation also **deletes buckets in the window whose raw data no longer exists** — upserts alone can never correct a bucket that nothing generates a key for, so deleted clicks/conversions would otherwise leave their counters behind forever. Consequence: never run `reconcile.cli.js` over a period whose raw clicks the retention job has already pruned, or it will wipe stats that were correct. |
| L3 | Cleanup runs at 03:30, the daily summary at 09:00, both in the report timezone. |
| L4 | The postback failure threshold is **>10 failures in 5 minutes**, checked every 5 minutes. |
| L5 | Telegram is optional everywhere. With no token configured, every send returns `{skipped: true}` and nothing errors. Alerts are throttled to one per key per minute so an error storm cannot flood the chat. |

## Security

| # | Assumption |
|---|---|
| S1 | The login limiter counts **5 failed attempts per 5 minutes per IP, across the whole install**. Counters live in `rate_limits` in MongoDB, not process memory, so cluster workers and load-balanced instances share one number and a restart does not clear it. Successful logins return their attempt (`skipSuccessfulRequests`), so a user who remembers their password is never locked out. |
| S2 | The server **refuses to start in production** if `JWT_SECRET` is unset or still the built-in default, and warns below 32 characters. A weak signing key forges any session, including an admin's, and leaves no trace — a warning nobody reads is not enough. |
| S3 | Content-Security-Policy is written explicitly rather than left to helmet's default. `style-src` must keep `'unsafe-inline'`: React renders `style={{...}}` as an inline style attribute and the dashboard uses them throughout. `script-src` is `'self'` with no exceptions — the Vite build emits no inline script. `img-src`/`font-src` allow `data:` for the inline SVG favicon. |
| S4 | HSTS is sent **only in production**. `crossOriginEmbedderPolicy` is off and `crossOriginResourcePolicy` is `cross-origin`, because third-party landers load `/track.js` and `/pixel.gif` from this host. |
| S5 | Every write through `crudRouter` writes an **audit row** — create, update, delete, for every entity, because that factory is the one place they all pass through. Updates store only the fields that changed, and only their new value: the previous value is already the previous row. |
| S6 | The audit log **redacts secrets at any depth**, not just the top level (`integration.accessToken` is the case that matters). The field name is still recorded, so the change is visible without the value. Nothing redacts this collection on read, which is why it must never receive a secret in the first place. |
| S7 | `GET /logs/audit` is **admin only** — not because the rows are secret, but because reading them reveals which accounts exist and when each is active. |
| S8 | A sign-in from a **device not seen before** sends a Telegram alert. "Device" is the IP's /24 (IPv6: the /64 prefix) plus browser and OS — a home connection moves within its block, and an alert on every DHCP lease is an alert that gets ignored. Known devices are silent. |
| S9 | Failed logins are recorded with the **email that was tried, even when no such account exists** — a run of failures against an unregistered address is what a credential list being tried looks like, and it is invisible if only real users are logged. |

## Roles

| # | Assumption |
|---|---|
| R1 | **Two roles, and only two**: `admin` and `user`. An admin sees every account's data; a user sees only records they own. Scoping lives in `middleware/scope.js` — `ownerFilter` for anything carrying `ownerId`, `scopeByCampaign` for clicks, conversions, postbacks and reports, which hang off a campaign rather than owning themselves. It is in one place so a new list endpoint cannot quietly forget it. |
| R2 | A user **cannot create, list, edit or delete other users**, read the audit log, or change install settings. Those routes are `requireAdmin` and answer 403. |
| R3 | A user **can change their own name and password**, through `PATCH /users/me` — the only route under `/users` that is not admin-only. It accepts name and password and nothing else: `role`, `active` and `email` are silently ignored there, so it can never become an escalation route. |
| R4 | Changing your own password requires the **current** one, even though the session already proves who you are. A session can be an unlocked laptop for two minutes; taking the account over permanently should cost more than that. |
| R5 | A self-service password change **revokes every other session and re-issues this one**. Signing the person out of the tab they are working in teaches them not to bother next time, while leaving other devices signed in defeats the point of changing it. |
| R6 | The Users tab is **not rendered for non-admins**. It used to be, showing an empty table because the list endpoint refused them — which reads as broken rather than as not theirs. |

## Sessions

| # | Assumption |
|---|---|
| T1 | The access token is a JWT and lasts **15 minutes** (`ACCESS_TOKEN_MINUTES`). Nothing can withdraw a signed JWT, so its lifetime *is* the window a copied one stays useful. The refresh token lasts **7 days** (`REFRESH_TOKEN_DAYS`) and is a row in `sessions`, so revoking it is a write. |
| T2 | Refresh tokens are stored as a **SHA-256 hash**, never in the clear — same reasoning as passwords, and free, because they are looked up by exact value and never listed. |
| T3 | Refresh tokens **rotate**: every use issues a new one and revokes the old. Presenting an already-rotated token means a copy exists, and nothing can tell whose, so the **whole family** from that sign-in is revoked and a Telegram alert fires. Both the thief and the owner must sign in again — that is the intended outcome, not a bug. |
| T4 | The dashboard refreshes **once at a time**. A page fires several requests together and they expire together; without a queue each would refresh, the second would present a token the first had already rotated, and rotation would read that as a replay. The app would log itself out. |
| T5 | The refresh cookie is scoped to **`/api/v1/auth`**, the access cookie to `/`. There is no reason for the long-lived credential to ride along on every request a dashboard makes. |
| T6 | Changing a password or deactivating an account **revokes every session that user holds**. Changing a password to lock someone out only works if what they already hold stops working. |
| T7 | Revoked session rows are kept until they expire rather than deleted, because a revoked token that vanished would be indistinguishable from one that never existed — and that distinction is what reuse detection is. |

## Deliberately not built

Out of scope for a single-company self-hosted tracker, and not requested:

- Multi-tenancy, workspaces, billing, per-seat limits
- Automated rules / auto-optimisation of traffic distribution
- Native ad-platform API integrations (cost pull, campaign pause) — cost is pushed manually or read from a token
- CSV/PDF report export
- Server-side pagination on log views (capped result sets are used instead)
