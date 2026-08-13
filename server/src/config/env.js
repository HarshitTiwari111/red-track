import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The .env lives at the repo root, two levels above /server/src
export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/kaptracker',
  jwtSecret: process.env.JWT_SECRET || 'kap-tracker-insecure-default',
  port: num(process.env.PORT, 3010),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3010').replace(/\/+$/, ''),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  nodeEnv: process.env.NODE_ENV || 'development',
  /**
   * How many reverse proxies sit in front of the app.
   *
   * Defaults to 0 (trust nothing) because any value above 0 makes req.ip come
   * from X-Forwarded-For, and a client that can reach the port directly can
   * forge that header and walk past the login rate limiter. Set TRUST_PROXY=1
   * only once nginx/Cloudflare is in front AND port 3010 is firewalled off.
   */
  trustProxy: (() => {
    const raw = process.env.TRUST_PROXY;
    if (raw === undefined || raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  })(),
  /**
   * The CNAME value operators are told to point their tracking domains at.
   *
   * Defaults to the host BASE_URL is served on, which is correct for a single
   * server. Override when the tracker sits behind a load balancer or a vanity
   * hostname, so the instructions name the record that actually exists.
   */
  dnsTargetCname:
    process.env.DNS_TARGET_CNAME ||
    (() => {
      try {
        return new URL(process.env.BASE_URL || 'http://localhost:3010').hostname;
      } catch {
        return 'localhost';
      }
    })(),
  /**
   * Resolvers used for domain verification.
   *
   * Deliberately NOT the system resolvers by default. Verification asks "what
   * does the public internet see for this host", and the local resolver is the
   * wrong witness: it may be a stub on 127.0.0.1 with nothing behind it, a
   * split-horizon view, or a cache still serving the pre-change answer. Set
   * DNS_RESOLVERS=system to use /etc/resolv.conf instead, or list your own.
   */
  dnsResolvers: (() => {
    const raw = String(process.env.DNS_RESOLVERS || '').trim();
    if (raw.toLowerCase() === 'system') return [];
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? list : ['1.1.1.1', '8.8.8.8'];
  })(),
  isProd: process.env.NODE_ENV === 'production',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@kaptracker.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || '',
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  // How long the click cookie lives (90 days, in ms)
  clickCookieMaxAge: 90 * 24 * 60 * 60 * 1000,
  // Campaign cache refresh interval on the hot path
  cacheRefreshMs: 30_000,
};

export default config;
