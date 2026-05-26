import { config } from './config.js';
import { createAmeria } from './ameria.js';
import { createStore } from './store.js';
import { createTelegram } from './telegram.js';
import { createBot } from './bot.js';
import { createRates } from './rates.js';

async function main() {
  if (!config.telegramToken || !config.allowedIds.length) {
    console.error('TELEGRAM_TOKEN and ALLOWED_IDS have to be set in .env');
    process.exit(1);
  }

  const gateway = createAmeria(config.ameria);
  const store = createStore(config.dataDir);
  const telegram = createTelegram(config.telegramToken);
  const rates = createRates(config.rates);
  const bot = createBot({ telegram, gateway, store, config, rates });

  const me = await telegram.getMe();
  console.log(`Bot @${me.username} started`);
  console.log(`  vPOS    : ${config.ameria.apiBase}`);
  console.log(`  Allowed : ${config.allowedIds.join(', ')}`);

  process.on('SIGINT', () => {
    telegram.stop();
    process.exit(0);
  });

  await telegram.startPolling((u) => bot.handleUpdate(u));
}

main().catch((e) => {
  console.error('Fatal:', e.stack || e.message);
  process.exit(1);
});
