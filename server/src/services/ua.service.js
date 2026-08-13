import { UAParser } from 'ua-parser-js';

const parser = new UAParser();

const EMPTY = {
  device: 'unknown',
  os: 'unknown',
  browser: 'unknown',
  osVersion: '',
  browserVersion: '',
  brand: '',
  model: '',
};

/**
 * Normalises a raw user-agent into device/os/browser plus the finer details
 * (versions, vendor, model) that the macro set exposes.
 * ua-parser-js leaves device.type undefined for desktops, so we map that here.
 */
export function parseUa(ua) {
  if (!ua) return { ...EMPTY };
  try {
    parser.setUA(ua);
    const r = parser.getResult();
    const type = r.device?.type;
    let device = 'desktop';
    if (type === 'mobile') device = 'mobile';
    else if (type === 'tablet') device = 'tablet';
    else if (type === 'smarttv' || type === 'console' || type === 'wearable') device = type;

    return {
      device,
      os: r.os?.name || 'unknown',
      browser: r.browser?.name || 'unknown',
      osVersion: r.os?.version || '',
      browserVersion: r.browser?.version || '',
      brand: r.device?.vendor || '',
      model: r.device?.model || '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export default parseUa;
