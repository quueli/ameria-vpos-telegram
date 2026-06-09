import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBot } from '../bot/bot.js';
import { createStore } from '../bot/store.js';
import { createRates } from '../bot/rates.js';
import { createStubGateway } from './stub-gateway.js';

const USER = 42;

function createFakeTelegram() {
  let msgId = 0;
  const show = (label, chatId, text) => {
    console.log(`\n--- ${label} -> chat ${chatId} ---`);
    console.log(text.replace(/<[^>]+>/g, ''));
  };
  return {
    async sendMessage(chatId, text) { show('sendMessage', chatId, text); return { message_id: ++msgId }; },
    async editMessageText(chatId, id, text) { show(`editMessageText #${id}`, chatId, text); return { message_id: id }; },
    async editMessageReplyMarkup() { return {}; },
    async answerCallbackQuery(id, text) { if (text) console.log(`[callback ${id}] ${text}`); return true; },
    async getMe() { return { username: 'demo_bot' }; },
    async startPolling() {},
    stop() {},
  };
}

const msg = (text) => ({ message: { chat: { id: USER }, from: { id: USER }, text } });
const cb = (data, messageId = 1) => ({
  callback_query: { id: `cb-${data}`, from: { id: USER }, message: { chat: { id: USER }, message_id: messageId }, data },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ameria-demo-'));
  const telegram = createFakeTelegram();
  const gateway = createStubGateway({ payAfter: 2 });
  const store = createStore(dataDir);
  const rates = createRates({ live: false });
  const config = {
    allowedIds: [USER],
    pollIntervalMs: 300,
    paymentTtlMs: 120_000,
    backUrl: 'https://example.com/payment-result',
  };

  // no timers, the trace polls by hand so it stays deterministic
  const bot = createBot({ telegram, gateway, store, config, rates, autoStartTimers: false });

  console.log('=== offline payment flow (stub gateway) ===');
  await bot.handleUpdate(msg('/start'));
  await bot.handleUpdate(cb('cur:840'));
  await bot.handleUpdate(msg('10'));
  await bot.handleUpdate(cb('val:ok'));

  const order = store.active()[0];
  console.log(`\n[demo] tracking order ${order.orderId} (paymentId ${order.paymentId})`);

  for (let i = 1; i <= 5; i += 1) {
    const kind = await bot.pollOnce(order.orderId);
    console.log(`[demo] poll ${i}: ${kind}`);
    if (kind !== 'pending') break;
    await sleep(200);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\n=== done ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
