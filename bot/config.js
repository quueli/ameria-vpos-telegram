import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// own .env parser: windows already has USERNAME in the environment and it would
// shadow the merchant one
function parseEnvFile(filePath) {
  const result = {};
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1);
      const hash = val.indexOf(' #');
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim().replace(/^["']|["']$/g, '');
      result[key] = val;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('.env read error:', e.message);
  }
  return result;
}

const KNOWN_KEYS = [
  'TELEGRAM_TOKEN', 'ALLOWED_IDS',
  'AMERIA_CLIENT_ID', 'AMERIA_USERNAME', 'AMERIA_PASSWORD', 'AMERIA_TEST_MODE',
  'BACK_URL', 'POLL_INTERVAL_MS', 'PAYMENT_TTL_MS',
  'LIVE_RATES', 'RATE_USD', 'RATE_EUR', 'PORT',
];

const env = parseEnvFile(path.join(__dirname, '..', '.env'));
for (const k of KNOWN_KEYS) {
  if (process.env[k] != null && process.env[k] !== '') env[k] = process.env[k];
}

// sandbox is a separate host with its own merchant credentials
const TEST_MODE = String(env.AMERIA_TEST_MODE ?? 'true').toLowerCase() !== 'false';
const HOST = TEST_MODE ? 'https://servicestest.ameriabank.am' : 'https://services.ameriabank.am';

export const CURRENCIES = [
  { code: '051', label: 'AMD', title: 'Armenian dram' },
  { code: '840', label: 'USD', title: 'US dollar' },
  { code: '978', label: 'EUR', title: 'Euro' },
];

export function currencyByCode(code) {
  return CURRENCIES.find((c) => c.code === code) || null;
}

export const config = {
  telegramToken: env.TELEGRAM_TOKEN || '',
  allowedIds: String(env.ALLOWED_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s)),
  ameria: {
    clientId: env.AMERIA_CLIENT_ID || '',
    username: env.AMERIA_USERNAME || '',
    password: env.AMERIA_PASSWORD || '',
    testMode: TEST_MODE,
    apiBase: `${HOST}/VPOS/api/VPOS`,
    payUrl: `${HOST}/VPOS/Payments/Pay`,
  },
  // must be a domain the bank has on file for this merchant
  backUrl: env.BACK_URL || 'https://example.com/payment-result',
  pollIntervalMs: Number(env.POLL_INTERVAL_MS || 8000),
  paymentTtlMs: Number(env.PAYMENT_TTL_MS || 20 * 60 * 1000),
  port: Number(env.PORT || 3000),
  dataDir: path.join(__dirname, 'data'),
  rates: {
    live: String(env.LIVE_RATES ?? 'true').toLowerCase() !== 'false',
    overrides: {
      ...(env.RATE_USD ? { '840': Number(env.RATE_USD) } : {}),
      ...(env.RATE_EUR ? { '978': Number(env.RATE_EUR) } : {}),
    },
  },
};

export default config;
