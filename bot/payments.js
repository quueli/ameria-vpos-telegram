import { genOrderId } from './order-id.js';
import { currencyByCode } from './config.js';
import {
  closedLinkText,
  declinedText,
  expiredText,
  fmtAmount,
  linkText,
  mainKeyboard,
  paidText,
  payCancelKeyboard,
} from './view.js';

export function createPayments({ telegram, gateway, store, config, rates, log = console, autoStartTimers = true }) {
  const timers = new Map();

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

  async function createLink(chatId, userId, session) {
    const cur = currencyByCode(session.currency);
    const amountAmd = rates.toAMD(session.amount, session.currency);
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
      return null;
    }

    const now = Date.now();
    const p = {
      paymentId: result.paymentId,
      amountAmd,
      orderId,
      chatId,
      userId,
      amount: session.amount,
      currency: session.currency,
      redirectUrl: result.redirectUrl,
      status: 'pending',
      createdAt: now,
      deadlineAt: now + config.paymentTtlMs,
    };

    const sent = await telegram.sendMessage(
      chatId,
      linkText(rates, p, Math.round(config.paymentTtlMs / 60000)),
      // keyed by our orderId, not the gateway PaymentID which gets reused across sessions
      { reply_markup: payCancelKeyboard(orderId), disable_web_page_preview: false },
    );

    store.set(orderId, { ...p, linkMsgId: sent.message_id });
    track(orderId);
    return orderId;
  }

  async function pollOnce(orderId) {
    const p = store.get(orderId);
    if (!p || p.status !== 'pending') {
      clearTimers(orderId);
      return 'inactive';
    }

    const c = await fetchState(p);

    if (c.kind === 'paid') {
      store.set(orderId, { status: 'paid', paidAt: Date.now() });
      clearTimers(orderId);
      await closeLink(p, 'Paid');
      await telegram.sendMessage(p.chatId, paidText(rates, p, c), { reply_markup: mainKeyboard });
      return 'paid';
    }

    if (c.kind === 'void' || c.kind === 'refunded') {
      const cancelled = c.kind !== 'refunded';
      store.set(orderId, { status: cancelled ? 'void' : 'refunded' });
      clearTimers(orderId);
      await closeLink(p, cancelled ? 'Cancelled' : 'Refunded');
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
      await telegram.sendMessage(p.chatId, declinedText(p, c.rc, hint));
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
    await closeLink(p, 'Time is up - link cancelled');
    await telegram.sendMessage(p.chatId, expiredText(p, cancel), { reply_markup: mainKeyboard });
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
    await closeLink(p, 'Payment cancelled - link no longer valid');
    await telegram.sendMessage(
      p.chatId,
      `Payment for order <code>${p.orderId}</code> was cancelled. The link no longer works.`,
      { reply_markup: mainKeyboard },
    );
  }

  async function closeLink(p, note) {
    if (!p.linkMsgId) return;
    try {
      await telegram.editMessageText(p.chatId, p.linkMsgId, closedLinkText(rates, p, note), {
        reply_markup: { inline_keyboard: [] },
        disable_web_page_preview: true,
      });
    } catch (e) {
      // too old or unchanged - not worth failing the payment over
      log.error('closeLink:', e.message);
    }
  }

  return { createLink, pollOnce, expirePayment, cancelByButton, track, resumeTracking };
}
