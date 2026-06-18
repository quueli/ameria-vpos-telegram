import { config } from './config.js';
import { createAmeria } from './ameria.js';
import { assertGateway } from './gateway.js';
import { createStore } from './store.js';
import { createTelegram } from './telegram.js';
import { createBot } from './bot.js';
import { createRates } from './rates.js';

function assertConfig() {
  const problems = [];
  if (!config.telegramToken) {
    problems.push('TELEGRAM_TOKEN is not set (get one from @BotFather).');
  }
  if (!config.allowedIds.length) {
    problems.push('ALLOWED_IDS is empty - nobody may use the bot.');
  }
  if (!config.ameria.clientId || !config.ameria.username || !config.ameria.password) {
    problems.push('AmeriaBank credentials are missing (AMERIA_CLIENT_ID/USERNAME/PASSWORD).');
  }
  return problems;
}

async function main() {
  const problems = assertConfig();
  if (problems.length) {
    console.error('\nBot not started. Fix the .env configuration:\n');
    for (const p of problems) console.error('  - ' + p);
    console.error('');
    process.exit(1);
  }

  const gateway = assertGateway(createAmeria(config.ameria));
  const store = createStore(config.dataDir);
  const telegram = createTelegram(config.telegramToken);
  const rates = createRates(config.rates);
  await rates.refresh();
  setInterval(() => rates.maybeRefresh(), 60 * 60 * 1000).unref?.();
  const bot = createBot({ telegram, gateway, store, config, rates });

  const me = await telegram.getMe();
  const t = rates.table();
  console.log(`\nBot @${me.username} started (${config.ameria.testMode ? 'SANDBOX' : 'PRODUCTION'})`);
  console.log(`  vPOS       : ${config.ameria.apiBase}`);
  console.log(`  Allowed    : ${config.allowedIds.join(', ')}`);
  console.log(`  Rates (${rates.source()}): 1 USD=${t['840'].toFixed(2)} AMD, 1 EUR=${t['978'].toFixed(2)} AMD`);
  console.log(`  Polling    : every ${config.pollIntervalMs} ms, link TTL ${Math.round(config.paymentTtlMs / 60000)} min\n`);

  bot.resumeTracking();

  const shutdown = () => {
    console.log('\nStopping the bot...');
    telegram.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await telegram.startPolling((u) => bot.handleUpdate(u));
}

main().catch((e) => {
  console.error('Fatal:', e.stack || e.message);
  process.exit(1);
});
