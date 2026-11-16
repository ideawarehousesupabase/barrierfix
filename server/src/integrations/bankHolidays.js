import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = path.join(here, '../content/bank-holidays.fallback.json');
const CACHE_FILE = path.join(config.dataDir, 'bank-holidays.json');

let data = null;
let lastFetch = 0;

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function merge(primary, fallback) {
  const out = {};
  for (const region of Object.keys({ ...fallback, ...primary })) {
    const dates = new Map();
    for (const src of [fallback?.[region], primary?.[region]]) for (const e of src?.events || []) dates.set(e.date, e.title);
    out[region] = { events: [...dates].map(([date, title]) => ({ date, title })) };
  }
  return out;
}

// UK bank holidays from the gov.uk feed, cached on disk, with a bundled fallback.
export async function refreshBankHolidays({ force = false } = {}) {
  if (!force && Date.now() - lastFetch < 12 * 3600 * 1000 && data) return data;
  const fallback = load(FALLBACK_FILE);
  data = merge(load(CACHE_FILE), fallback);
  if (config.isTest) return data;
  lastFetch = Date.now();
  try {
    const res = await fetch(config.bankHolidaysUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const live = await res.json();
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(live));
      data = merge(live, fallback);
    }
  } catch (err) {
    console.warn('[bank-holidays] using cached/bundled dates:', err.message);
  }
  return data;
}

export async function getHolidays(region = 'england-and-wales') {
  if (!data) await refreshBankHolidays();
  return new Set((data[region]?.events || []).map((e) => e.date));
}
