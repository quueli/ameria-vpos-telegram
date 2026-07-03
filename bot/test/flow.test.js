import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createBot } from '../bot.js';
import { createStore } from '../store.js';
import { createRates } from '../rates.js';
import { parseAmount } from '../view.js';
import { createStubGateway } from '../../demo/stub-gateway.js';

const USER = 7;
const msg = (text) => ({ message: { chat: { id: USER }, from: { id: USER }, text } });
const cb = (data) => ({ callback_query: { id: 'cb', from: { id: USER }, message: { chat: { id: USER } }, data } });

function setup({ payAfter = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ameria-test-'));
  const sent = [];
  let msgId = 0;
  const telegram = {
    async sendMessage(chatId, text) { sent.push(text); return { message_id: ++msgId }; },
    async editMessageText() { return {}; },
    async answerCallbackQuery() { return true; },
  };
  const store = createStore(dir);
  const bot = createBot({
    telegram,
    gateway: createStubGateway({ payAfter }),
    store,
    rates: createRates({ live: false }),
    config: { allowedIds: [USER], pollIntervalMs: 1000, paymentTtlMs: 60000, backUrl: 'https://example.com/back' },
    autoStartTimers: false,
  });
  return { bot, store, sent, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function walkToLink(bot) {
  await bot.handleUpdate(msg('/start'));
  await bot.handleUpdate(cb('cur:840'));
  await bot.handleUpdate(msg('10'));
  await bot.handleUpdate(cb('val:ok'));
}

test('amounts', () => {
  assert.equal(parseAmount('10'), 10);
  assert.equal(parseAmount('1 500,50'), 1500.5);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-3'), null);
  assert.equal(parseAmount('10.999'), null);
  assert.equal(parseAmount('ten'), null);
});

test('the flow registers a payment in amd', async () => {
  const { bot, store, cleanup } = setup();
  await walkToLink(bot);
  const [p] = store.active();
  assert.equal(p.currency, '840');
  assert.equal(p.amount, 10);
  assert.equal(p.amountAmd, 3710);
  assert.ok(p.paymentId);
  cleanup();
});

test('a bad amount does not advance the step', async () => {
  const { bot, store, cleanup } = setup();
  await bot.handleUpdate(msg('/start'));
  await bot.handleUpdate(cb('cur:051'));
  await bot.handleUpdate(msg('abc'));
  await bot.handleUpdate(cb('val:ok'));
  assert.equal(store.active().length, 0);
  cleanup();
});

test('polling reports paid once the gateway deposits', async () => {
  const { bot, store, sent, cleanup } = setup({ payAfter: 1 });
  await walkToLink(bot);
  const { orderId } = store.active()[0];
  assert.equal(await bot.pollOnce(orderId), 'pending');
  assert.equal(await bot.pollOnce(orderId), 'paid');
  assert.equal(store.get(orderId).status, 'paid');
  assert.equal(await bot.pollOnce(orderId), 'inactive');
  assert.ok(sent.some((t) => t.includes('Payment received')));
  cleanup();
});

test('strangers get nothing', async () => {
  const { bot, sent, cleanup } = setup();
  await bot.handleUpdate({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/start' } });
  assert.deepEqual(sent, ['Access denied.']);
  cleanup();
});
