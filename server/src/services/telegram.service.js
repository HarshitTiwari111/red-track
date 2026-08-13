import config from '../config/env.js';
import logger from '../utils/logger.js';

const enabled = () => Boolean(config.telegramToken && config.telegramChatId);

// Simple throttle so an error storm cannot spam the chat
const lastSent = new Map();
const THROTTLE_MS = 60_000;

export async function sendTelegram(text, { key = 'default', throttle = true } = {}) {
  if (!enabled()) return { skipped: true, reason: 'Telegram not configured' };

  if (throttle) {
    const prev = lastSent.get(key) || 0;
    if (Date.now() - prev < THROTTLE_MS) return { skipped: true, reason: 'throttled' };
    lastSent.set(key, Date.now());
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      logger.warn('Telegram send failed', body.description || res.status);
      return { ok: false, error: body.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('Telegram send error', err.message);
    return { ok: false, error: err.message };
  }
}

export const notifyError = (msg) =>
  sendTelegram(`⚠️ <b>KAP Tracker error</b>\n<pre>${escapeHtml(msg).slice(0, 900)}</pre>`, {
    key: 'error',
  });

export const telegramEnabled = enabled;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
