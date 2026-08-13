import { customAlphabet, nanoid } from 'nanoid';

// URL-safe, no look-alike characters, 12 chars => plenty of entropy for click ids
const clickAlphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const clickNano = customAlphabet(clickAlphabet, 12);

export const newClickId = () => clickNano();
export const newApiKey = () => `kap_${nanoid(32)}`;
export const newSecurityKey = () => nanoid(16);

export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
