# KAP Tracker — manual end-to-end test

Verifies the full path: **create campaign → open the click URL → fire a postback with that clickid →
see the conversion and the stats on the dashboard.**

Set these once per shell:

```bash
BASE=http://localhost:3010
```

Everything below assumes the seeded demo data (`npm run seed`). The seed output prints the demo
network's security key — export it as `KEY`.

---

## 0. Preflight

| # | Step | Expected |
|---|---|---|
| 0.1 | `curl -s $BASE/health` | `"ok": true`, `"db": "connected"`, cache counts non-zero |
| 0.2 | Open `$BASE` in a browser | Login screen |
| 0.3 | Sign in with the seeded admin credentials | Overview loads with stat cards and the chart |
| 0.4 | Wrong password ×6 | Attempts 1–5 return `401`, the 6th returns `429` (rate limit) |

---

## 1. Create the campaign

Either use the seeded **Demo Campaign**, or build one from scratch:

| # | Step | Expected |
|---|---|---|
| 1.1 | Networks → *New network* → name it, save | A postback URL and security key appear on edit |
| 1.2 | Offers → *New offer*, URL `https://example.com/offer?click_id={clickid}&geo={country}`, payout type **fixed**, default payout `25` | Saved, listed with `fixed 25.00` |
| 1.3 | Landers → *New lander*, URL `https://example.com/quiz?clickid={clickid}` | Saved |
| 1.4 | Campaigns → *New campaign* — name, traffic source **Google Ads**, cost model **CPC** `0.15` | Slug is derived automatically |
| 1.5 | Add **Path 0**: weight 70, lander selected, offer added at weight 100 | Weight readout shows 70% of traffic |
| 1.6 | Add **Path 1**: weight 30, tick *direct linking*, same offer | Lander select disappears |
| 1.7 | Add a rule: countries `IN`, device `mobile` → **Path 1** | Rule card shows the selected path |
| 1.8 | Save | Campaign appears in the table with a `/c/<slug>` subtitle |
| 1.9 | Open the campaign | Tracking links panel shows the campaign URL with the ValueTrack params pre-filled |

---

## 2. Click redirect

| # | Command | Expected |
|---|---|---|
| 2.1 | `curl -i "$BASE/c/demo-campaign?sub1=test-kw&sub2=exact&gclid=GCL1"` | `302`, `Location` = lander URL with `{clickid}` and `{country}` replaced, `Set-Cookie: kap_clickid=…` |
| 2.2 | Rule check — mobile UA from an Indian IP:<br>`curl -i -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" -H "X-Forwarded-For: 49.36.1.1" "$BASE/c/demo-campaign?sub1=mobile"` | `302` straight to the **offer** URL — the rule sent it to the direct-linking path |
| 2.3 | `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total} " "$BASE/c/demo-campaign"; done` | Each under ~0.05s locally (the redirect never waits on the database) |
| 2.4 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/c/no-such-campaign"` | `404`, and the failure shows in **Settings → Diagnostics → Click errors** |
| 2.5 | `curl -i -A "Googlebot/2.1" "$BASE/c/demo-campaign"` | `302` (bots still redirect), the click is flagged `bot` in the Clicks Log and excluded from reports |
| 2.6 | Clicks Log | Every click above listed with geo, device, OS, browser, sub1 and flags |

**Capture the clickid for the next steps:**

```bash
CID=$(curl -s -i -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36" \
  -H "X-Forwarded-For: 8.8.8.8" "$BASE/c/demo-campaign?sub1=e2e&sub2=checklist" \
  | grep -i "^set-cookie" | sed -E 's/.*kap_clickid=([^;]+).*/\1/' | tr -d '\r')
echo "$CID"
```

---

## 3. Lander → offer

| # | Command | Expected |
|---|---|---|
| 3.1 | `curl -i "$BASE/go?clickid=$CID"` | `302` to the offer URL with macros replaced |
| 3.2 | Clicks Log → find the click | `LP` badge present; **LP Clicks** on the campaign is now 1 |
| 3.3 | `curl -i "$BASE/go?clickid=does-not-exist"` | `404`, logged under Click errors |

---

## 4. Conversion via postback

| # | Command | Expected |
|---|---|---|
| 4.1 | `curl "$BASE/postback?clickid=$CID&payout=25&txid=TX-E2E-1&status=approved&type=lead&key=$KEY"` | `OK` |
| 4.2 | Repeat 4.1 exactly | `OK` — but no second conversion appears (deduped on network + txid) |
| 4.3 | `curl "$BASE/postback?clickid=$CID&payout=25&txid=TX-E2E-1&status=rejected&key=$KEY"` | `OK`; the conversion flips to **rejected** and revenue drops back by 25 |
| 4.4 | `curl "$BASE/postback?clickid=$CID&payout=25&txid=TX-E2E-1&status=approved&key=$KEY"` | Revenue returns to 25 |
| 4.5 | `curl "$BASE/postback?clickid=$CID&txid=TX-E2E-2&key=$KEY"` (no payout) | `OK`, payout falls back to the offer's default (25) because the offer is `fixed` |
| 4.6 | `curl "$BASE/postback?clickid=$CID&payout=1&txid=TX-X&key=WRONG"` | `ERROR: invalid key`, still HTTP 200, logged as failed |
| 4.7 | `curl "$BASE/postback?clickid=NOPE&payout=1&key=$KEY"` | `ERROR: unknown clickid`, HTTP 200, logged |
| 4.8 | Conversions page | Rows present with campaign, network, offer, txid, payout and status |
| 4.9 | Change a status to **rejected** in the Conversions dropdown | Overview revenue and conversion count drop immediately |

### Conversion pixel

| # | Command | Expected |
|---|---|---|
| 4.10 | `curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" "$BASE/pixel.gif?clickid=$CID&payout=10&txid=TX-PIX-1&type=sale&key=$KEY"` | `200 image/gif 42` and a new conversion with source `pixel` |

---

## 5. No-redirect script (Google Ads safe)

| # | Step | Expected |
|---|---|---|
| 5.1 | `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" $BASE/track.js` | `200 application/javascript` |
| 5.2 | Open `$BASE/demo-lander.html?sub1=noredirect&gclid=GCLTEST` in a browser | The address bar URL never changes |
| 5.3 | Read the box on that page | A clickid is shown, and the CTA href has been rewritten to `$BASE/go?clickid=…` |
| 5.4 | Clicks Log | A new click with entry `pageview`, `sub1=noredirect`, `gclid=GCLTEST` |
| 5.5 | Click the CTA | Redirects to the offer; the click gains the `LP` badge |

---

## 6. Reporting

| # | Step | Expected |
|---|---|---|
| 6.1 | Overview → **Today** | Clicks, LP clicks, conversions, revenue, cost, profit and ROI match the actions above; bots counted separately |
| 6.2 | Overview chart | Hourly line for a single day, daily when the range spans several days |
| 6.3 | Campaign detail → drilldown tabs | Country, Device, OS, Browser, Offer, Lander, Day, Hour and Sub1–Sub10 all return rows |
| 6.4 | `curl -H "X-Api-Key: <key>" "$BASE/api/v1/report?groupBy=country&from=<today>&to=<today>"` | Same numbers as the UI; `"source":"stats"` |
| 6.5 | `…&groupBy=os` | `"source":"raw"` — dimensions that are not pre-aggregated fall back to raw clicks |
| 6.6 | Compare totals from 6.4 and 6.5 | Click totals agree |

### Stats self-healing

| # | Command | Expected |
|---|---|---|
| 6.7 | `node server/src/tools/reconcile.cli.js 2` | The BEFORE and AFTER bucket dumps are identical — the incremental counters already matched the raw data |

---

## 7. Cost

| # | Step | Expected |
|---|---|---|
| 7.1 | Campaign detail → *Push manual cost* → total `100` for today | Confirmation naming the click count, per-click cost and buckets updated |
| 7.2 | Overview | Cost = 100.00, profit and ROI recalculated |
| 7.3 | Clicks Log | Each non-bot click in the range now carries the distributed cost |

---

## 8. Auth and security

| # | Command | Expected |
|---|---|---|
| 8.1 | `curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/campaigns` | `401` |
| 8.2 | `curl -s -o /dev/null -w "%{http_code}\n" -H "X-Api-Key: <key>" $BASE/api/v1/campaigns` | `200` |
| 8.3 | Sign out in the dashboard, then load any page | Redirected to `/login` |
| 8.4 | Settings → Users → create a **member** user, sign in as them | Settings fields are read-only |

---

## 9. Production build and PM2

| # | Command | Expected |
|---|---|---|
| 9.1 | `npm run build` | Vite build succeeds into `client/dist` |
| 9.2 | `npm start` | PM2 starts `kap-tracker`, 2 instances, cluster mode, status `online` |
| 9.3 | `curl -s -o /dev/null -w "%{http_code}\n" $BASE/` | `200` — the SPA is served by Express |
| 9.4 | `curl -s -o /dev/null -w "%{http_code}\n" $BASE/campaigns` | `200` — React Router deep link falls back to `index.html` |
| 9.5 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/c/demo-campaign"` | `302` — tracking is unaffected by the SPA fallback |
| 9.6 | `npx pm2 logs kap-tracker --lines 40 --nostream \| grep cron` | `cron: 4 jobs scheduled` on instance 0, `cron: skipped on worker 1` |
| 9.7 | `npx pm2 list` | Only `kap-tracker` was touched; any other PM2 apps are untouched |

---

## Sign-off

| Area | Pass |
|---|---|
| Click redirect, rotation, rules, macros | ☐ |
| Lander → offer, LP clicks | ☐ |
| Postbacks, dedupe, status updates, pixel | ☐ |
| No-redirect script | ☐ |
| Reporting + reconciliation | ☐ |
| Cost distribution | ☐ |
| Auth + rate limiting | ☐ |
| Production build + PM2 | ☐ |
