import { CURRENCIES, currencyByCode } from './config.js';
import { genOrderId } from './order-id.js';

const GEN_BUTTON = 'Generate payment link';
const mainKeyboard = {
  keyboard: [[{ text: GEN_BUTTON }]],
  resize_keyboard: true,
  is_persistent: true,
};

function fmtAmount(n) {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function parseAmount(text) {
  const cleaned = String(text).replace(',', '.').replace(/\s/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!(num > 0)) return null;
  return Math.round(num * 100) / 100;
}

function currencyKeyboard() {
  const rows = CURRENCIES.map((c) => [
    { text: `${c.label} - ${c.title}`, callback_data: `cur:${c.code}` },
  ]);
  rows.push([{ text: 'Cancel', callback_data: 'flow:cancel' }]);
  return { inline_keyboard: rows };
}

const amountKeyboard = {
  inline_keyboard: [
    [{ text: 'Back (change currency)', callback_data: 'amt:back' }],
    [{ text: 'Cancel', callback_data: 'flow:cancel' }],
  ],
};

const validateKeyboard = {
  inline_keyboard: [
    [{ text: 'OK, create link', callback_data: 'val:ok' }],
    [{ text: 'Back (change amount)', callback_data: 'val:back' }],
    [{ text: 'Cancel', callback_data: 'flow:cancel' }],
  ],
};

export function createBot({ telegram, gateway, store, config, rates, log = console, autoStartTimers = true }) {
  const sessions = new Map(); // chatId -> { step, currency, amount }
  const timers = new Map();

  const isAllowed = (id) => config.allowedIds.includes(Number(id));
  const toAmd = (amount, code) => rates.toAMD(amount, code);

  function amountLine(amount, code) {
    const cur = currencyByCode(code);
    if (code === '051') return `<b>${fmtAmount(amount)} ${cur.label}</b>`;
    return `<b>${fmtAmount(amount)} ${cur.label}</b> ~ <b>${fmtAmount(toAmd(amount, code))} AMD</b>`;
  }

  function getSession(chatId) {
    if (!sessions.has(chatId)) sessions.set(chatId, { step: 'idle' });
    return sessions.get(chatId);
  }

  function resetSession(chatId) {
    sessions.set(chatId, { step: 'idle' });
  }

  async function startFlow(chatId) {
    sessions.set(chatId, { step: 'currency' });
    await telegram.sendMessage(chatId, 'Choose the <b>currency</b> for the payment link:', {
      reply_markup: currencyKeyboard(),
    });
  }

  async function askAmount(chatId, session) {
    session.step = 'amount';
    const cur = currencyByCode(session.currency);
    await telegram.sendMessage(
      chatId,
      `Currency: <b>${cur.label}</b> (${cur.title}).\n\n`
        + 'Enter the <b>amount</b> as a number (e.g. 10 or 1500.50):',
      { reply_markup: amountKeyboard },
    );
  }

  async function showValidation(chatId, session) {
    session.step = 'validate';
    const cur = currencyByCode(session.currency);

    let conv = '';
    if (session.currency !== '051') {
      conv = `To be charged: <b>${fmtAmount(toAmd(session.amount, session.currency))} AMD</b>\n`
        + `Rate: 1 ${cur.label} = ${rates.amdPerUnit(session.currency).toFixed(2)} AMD\n`;
    }

    await telegram.sendMessage(
      chatId,
      '<b>Check the details</b>\n\n'
        + `Currency: <b>${cur.label}</b> - ${cur.title}\n`
        + `Amount: <b>${fmtAmount(session.amount)} ${cur.label}</b>\n`
        + conv
        + '\nThe invoice is issued in AMD; any card works.\nAll correct?',
      { reply_markup: validateKeyboard },
    );
  }

  async function createPayment(chatId, userId, session) {
    const cur = currencyByCode(session.currency);
    const amountAmd = toAmd(session.amount, session.currency);
    const orderId = genOrderId();
    const desc = session.currency === '051'
      ? `Payment ${fmtAmount(amountAmd)} AMD (order ${orderId})`
      : `Payment ${fmtAmount(session.amount)} ${cur.label} = ${fmtAmount(amountAmd)} AMD (order ${orderId})`;

    const result = await gateway.initPayment({
      amount: amountAmd,
      currency: '051', // the merchant account is dram-only, everything is converted first
      orderId,
      description: desc,
      backUrl: config.backUrl,
      lang: 'en',
      timeoutSec: Math.min(1200, Math.floor(config.paymentTtlMs / 1000)),
    });

    if (!result.ok) {
      await telegram.sendMessage(
        chatId,
        `Could not create the link.\n<code>${result.error || ''}</code>`
          + (result.responseCode ? `\nResponseCode: ${result.responseCode}` : ''),
        { reply_markup: mainKeyboard },
      );
      resetSession(chatId);
      return;
    }

    const now = Date.now();
    const deadlineAt = now + config.paymentTtlMs;
    const minutes = Math.round(config.paymentTtlMs / 60000);

    const sent = await telegram.sendMessage(
      chatId,
      '<b>Payment link created</b>\n\n'
        + `Amount: ${amountLine(session.amount, session.currency)}\n`
        + `Order ID: <code>${orderId}</code>\n`
        + `Pay within <b>${minutes} minutes</b> (any bank card):\n\n`
        + `${result.redirectUrl}`,
      {
        // keyed by our orderId, not the gateway PaymentID which gets reused across sessions
        reply_markup: {
          inline_keyboard: [[{ text: 'Cancel payment', callback_data: `pay:cancel:${orderId}` }]],
        },
        disable_web_page_preview: false,
      },
    );

    store.set(orderId, {
      paymentId: result.paymentId,
      amountAmd,
      orderId,
      chatId,
      userId,
      amount: session.amount,
      currency: session.currency,
      redirectUrl: result.redirectUrl,
      linkMsgId: sent.message_id,
      status: 'pending',
      createdAt: now,
      deadlineAt,
    });

    track(orderId);
    resetSession(chatId);
  }

  function clearTimers(orderId) {
    const t = timers.get(orderId);
    if (!t) return;
    if (t.interval) clearInterval(t.interval);
    if (t.deadline) clearTimeout(t.deadline);
    timers.delete(orderId);
  }

  function track(orderId) {
    if (!autoStartTimers) return; // tests and the demo drive pollOnce/expire by hand
    clearTimers(orderId);
    const p = store.get(orderId);
    if (!p || p.status !== 'pending') return;
    const interval = setInterval(() => {
      pollOnce(orderId).catch((e) => log.error('poll error', e.message));
    }, config.pollIntervalMs);
    const remaining = Math.max(0, (p.deadlineAt || 0) - Date.now());
    const deadline = setTimeout(() => {
      expirePayment(orderId).catch((e) => log.error('expire error', e.message));
    }, remaining);
    timers.set(orderId, { interval, deadline });
  }

  function resumeTracking() {
    for (const p of store.active()) track(p.orderId);
  }

  async function fetchState(p) {
    return gateway.classify(await gateway.getPaymentDetails(p.paymentId));
  }

  async function pollOnce(orderId) {
    const p = store.get(orderId);
    if (!p || p.status !== 'pending') {
      clearTimers(orderId);
      return 'inactive';
    }

    const c = await fetchState(p);
    const d = c.details || {};

    if (c.kind === 'paid') {
      store.set(orderId, { status: 'paid', paidAt: Date.now() });
      clearTimers(orderId);
      await finishLinkMessage(p, 'Paid');
      await telegram.sendMessage(
        p.chatId,
        '<b>Payment received</b>\n\n'
          + `Amount: ${amountLine(p.amount, p.currency)}\n`
          + `Order: <code>${p.orderId}</code>\n`
          + (d.CardNumber ? `Card: <code>${d.CardNumber}</code>\n` : '')
          + (d.rrn ? `RRN: <code>${d.rrn}</code>\n` : '')
          + `Status: <code>${c.state || ''}</code>`,
        { reply_markup: mainKeyboard },
      );
      return 'paid';
    }

    if (c.kind === 'void' || c.kind === 'refunded') {
      const cancelled = c.kind !== 'refunded';
      store.set(orderId, { status: cancelled ? 'void' : 'refunded' });
      clearTimers(orderId);
      await finishLinkMessage(p, cancelled ? 'Cancelled' : 'Refunded');
      await telegram.sendMessage(
        p.chatId,
        cancelled
          ? `Payment for order <code>${p.orderId}</code> was cancelled.`
          : `Order <code>${p.orderId}</code> was refunded.`,
        { reply_markup: mainKeyboard },
      );
      return cancelled ? 'void' : 'refunded';
    }

    // one notice per refusal code: cvc and then no funds are two different stories
    const refusalKey = String(c.rc || 'declined');
    if (c.kind === 'declined' && p.declinedNotified !== refusalKey) {
      store.set(orderId, { declinedNotified: refusalKey });
      const hint = gateway.declineHint ? gateway.declineHint(c.rc) : null;
      await telegram.sendMessage(
        p.chatId,
        `A payment attempt for order <code>${p.orderId}</code> was declined by the bank.`
          + (c.rc ? `\nCode: <code>${c.rc}</code>` : '')
          + (hint ? `\n${hint}` : '')
          + '\nThe link is still active - the customer can try again before it expires.',
      );
      return 'declined';
    }

    return c.kind;
  }

  async function cancelAtGateway(p) {
    const r = await gateway.cancelPayment(p.paymentId);
    return { ok: r.ok || r.responseCode === '00', code: r.responseCode, message: r.error || r.message };
  }

  async function expirePayment(orderId) {
    const p = store.get(orderId);
    if (!p || p.status !== 'pending') {
      clearTimers(orderId);
      return;
    }
    // the customer may have paid while the deadline was firing
    const c = await fetchState(p);
    if (c.kind === 'paid') {
      await pollOnce(orderId);
      return;
    }

    const cancel = await cancelAtGateway(p);
    store.set(orderId, { status: 'expired', cancelResponseCode: cancel.code || null });
    clearTimers(orderId);
    await finishLinkMessage(p, 'Time is up - link cancelled');
    await telegram.sendMessage(
      p.chatId,
      '<b>Payment time expired.</b>\n\n'
        + `Order: <code>${p.orderId}</code>\n`
        + 'No payment was made, the link has been voided.\n'
        + (cancel.ok
          ? `Cancellation confirmed by the bank${cancel.code ? ` (code ${cancel.code})` : ''}.`
          : `Cancellation: ${cancel.message || cancel.code || 'not confirmed'}`),
      { reply_markup: mainKeyboard },
    );
  }

  async function cancelByButton(orderId, callbackId) {
    const p = store.get(orderId);
    if (!p) {
      await telegram.answerCallbackQuery(callbackId, 'Payment not found or already finished.', { show_alert: true });
      return;
    }
    if (p.status !== 'pending') {
      await telegram.answerCallbackQuery(callbackId, 'This payment is no longer active.');
      return;
    }
    await telegram.answerCallbackQuery(callbackId, 'Cancelling the payment...');

    const cancel = await cancelAtGateway(p);
    if (!cancel.ok) {
      await telegram.sendMessage(
        p.chatId,
        `Could not cancel the payment: <code>${cancel.message || cancel.code}</code>`,
      );
      return;
    }
    store.set(orderId, { status: 'void' });
    clearTimers(orderId);
    await finishLinkMessage(p, 'Payment cancelled - link no longer valid');
    await telegram.sendMessage(
      p.chatId,
      `Payment for order <code>${p.orderId}</code> was cancelled. The link no longer works.`,
      { reply_markup: mainKeyboard },
    );
  }

  async function finishLinkMessage(p, note) {
    if (!p.linkMsgId) return;
    try {
      await telegram.editMessageText(
        p.chatId,
        p.linkMsgId,
        '<s>Payment link</s>\n\n'
          + `Amount: ${amountLine(p.amount, p.currency)}\n`
          + `Order: <code>${p.orderId}</code>\n\n`
          + note,
        { reply_markup: { inline_keyboard: [] }, disable_web_page_preview: true },
      );
    } catch (e) {
      log.error('finishLinkMessage:', e.message);
    }
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (!isAllowed(msg.from?.id)) {
      await telegram.sendMessage(chatId, 'Access denied.');
      return;
    }

    if (text === '/start') {
      await telegram.sendMessage(
        chatId,
        'Payment-link bot for AmeriaBank vPOS.\n\n'
          + 'Pick a currency and an amount; the bot registers the payment, sends you '
          + 'the bank link, and tells you when it clears.\n\n'
          + 'Tap "Generate payment link" below to begin.',
        { reply_markup: mainKeyboard },
      );
      await startFlow(chatId);
      return;
    }

    if (text === '/cancel') {
      resetSession(chatId);
      await telegram.sendMessage(chatId, 'Cancelled.', { reply_markup: mainKeyboard });
      return;
    }

    if (text === GEN_BUTTON) {
      await startFlow(chatId);
      return;
    }

    const session = getSession(chatId);
    if (session.step === 'amount') {
      const amount = parseAmount(text);
      if (amount == null) {
        await telegram.sendMessage(chatId, 'Enter a positive number (e.g. 10 or 1500.50).', {
          reply_markup: amountKeyboard,
        });
        return;
      }
      session.amount = amount;
      await showValidation(chatId, session);
      return;
    }

    await telegram.sendMessage(chatId, 'Tap "Generate payment link" to create a payment link.', {
      reply_markup: mainKeyboard,
    });
  }

  async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    const userId = cq.from?.id;
    const data = cq.data || '';

    if (!isAllowed(userId)) {
      await telegram.answerCallbackQuery(cq.id, 'Access denied.', { show_alert: true });
      return;
    }

    // the cancel button has to work whatever the conversation is doing
    if (data.startsWith('pay:cancel:')) {
      await cancelByButton(data.slice('pay:cancel:'.length), cq.id);
      return;
    }

    const session = getSession(chatId);

    if (data === 'flow:cancel') {
      resetSession(chatId);
      await telegram.answerCallbackQuery(cq.id, 'Cancelled');
      await telegram.sendMessage(chatId, 'Link creation cancelled.', { reply_markup: mainKeyboard });
      return;
    }

    if (data.startsWith('cur:')) {
      session.currency = data.slice('cur:'.length);
      await telegram.answerCallbackQuery(cq.id);
      await askAmount(chatId, session);
      return;
    }

    if (data === 'amt:back') {
      await telegram.answerCallbackQuery(cq.id);
      await startFlow(chatId);
      return;
    }

    if (data === 'val:back') {
      await telegram.answerCallbackQuery(cq.id);
      await askAmount(chatId, session);
      return;
    }

    if (data === 'val:ok') {
      if (session.step !== 'validate' || session.amount == null || !session.currency) {
        await telegram.answerCallbackQuery(cq.id, 'Session expired, start again.', { show_alert: true });
        resetSession(chatId);
        return;
      }
      await telegram.answerCallbackQuery(cq.id, 'Creating the link...');
      await createPayment(chatId, userId, session);
      return;
    }

    await telegram.answerCallbackQuery(cq.id);
  }

  async function handleUpdate(update) {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleCallback(update.callback_query);
  }

  return {
    handleUpdate,
    handleMessage,
    handleCallback,
    resumeTracking,
    pollOnce,
    expirePayment,
    track,
  };
}
