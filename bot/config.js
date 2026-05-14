import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseEnvFile(filePath) {
  const result = {};
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('.env read error:', e.message);
  }
  return result;
}

const env = parseEnvFile(path.join(__dirname, '.env'));

const HOST = 'https://services.ameriabank.am';

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
    .map((s) => Number(s.trim()))
    .filter(Boolean),
  ameria: {
    clientId: env.AMERIA_CLIENT_ID || '',
    username: env.AMERIA_USERNAME || '',
    password: env.AMERIA_PASSWORD || '',
    apiBase: `${HOST}/VPOS/api/VPOS`,
    payUrl: `${HOST}/VPOS/Payments/Pay`,
  },
  backUrl: env.BACK_URL || 'https://example.com/payment-result',
  pollIntervalMs: Number(env.POLL_INTERVAL_MS || 8000),
  paymentTtlMs: Number(env.PAYMENT_TTL_MS || 20 * 60 * 1000),
  dataDir: path.join(__dirname, 'data'),
  rates: {
    overrides: {
      ...(env.RATE_USD ? { '840': Number(env.RATE_USD) } : {}),
      ...(env.RATE_EUR ? { '978': Number(env.RATE_EUR) } : {}),
    },
  },
};

export default config;
