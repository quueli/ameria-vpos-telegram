import { createPayments } from './payments.js';
import {
  GEN_BUTTON,
  amountKeyboard,
  amountText,
  confirmKeyboard,
  confirmText,
  currencyKeyboard,
  currencyText,
  mainKeyboard,
  parseAmount,
  startText,
} from './view.js';

export function createBot({ telegram, gateway, store, config, rates, log = console, autoStartTimers = true }) {
  const sessions = new Map(); // chatId -> { step, currency, amount }
  const payments = createPayments({ telegram, gateway, store, config, rates, log, autoStartTimers });

  const isAllowed = (id) => config.allowedIds.includes(Number(id));

  function session(chatId) {
    if (!sessions.has(chatId)) sessions.set(chatId, { step: 'idle' });
    return sessions.get(chatId);
  }

  function reset(chatId) {
    sessions.set(chatId, { step: 'idle' });
  }

  async function askCurrency(chatId) {
    sessions.set(chatId, { step: 'currency' });
    await telegram.sendMessage(chatId, currencyText, { reply_markup: currencyKeyboard() });
  }

  async function askAmount(chatId, s) {
    s.step = 'amount';
    await telegram.sendMessage(chatId, amountText(s.currency), { reply_markup: amountKeyboard });
  }

  async function askConfirm(chatId, s) {
    s.step = 'validate';
    await telegram.sendMessage(chatId, confirmText(rates, s), { reply_markup: confirmKeyboard });
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (!isAllowed(msg.from?.id)) {
      await telegram.sendMessage(chatId, 'Access denied.');
      return;
    }

    if (text === '/start') {
      await telegram.sendMessage(chatId, startText, { reply_markup: mainKeyboard });
      await askCurrency(chatId);
      return;
    }

    if (text === '/cancel') {
      reset(chatId);
      await telegram.sendMessage(chatId, 'Cancelled.', { reply_markup: mainKeyboard });
      return;
    }

    if (text === GEN_BUTTON) {
      await askCurrency(chatId);
      return;
    }

    const s = session(chatId);
    if (s.step === 'amount') {
      const amount = parseAmount(text);
      if (amount == null) {
        await telegram.sendMessage(chatId, 'Enter a positive number (e.g. 10 or 1500.50).', {
          reply_markup: amountKeyboard,
        });
        return;
      }
      s.amount = amount;
      await askConfirm(chatId, s);
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
      await payments.cancelByButton(data.slice('pay:cancel:'.length), cq.id);
      return;
    }

    const s = session(chatId);

    if (data === 'flow:cancel') {
      reset(chatId);
      await telegram.answerCallbackQuery(cq.id, 'Cancelled');
      await telegram.sendMessage(chatId, 'Link creation cancelled.', { reply_markup: mainKeyboard });
      return;
    }

    if (data.startsWith('cur:')) {
      s.currency = data.slice('cur:'.length);
      await telegram.answerCallbackQuery(cq.id);
      await askAmount(chatId, s);
      return;
    }

    if (data === 'amt:back') {
      await telegram.answerCallbackQuery(cq.id);
      await askCurrency(chatId);
      return;
    }

    if (data === 'val:back') {
      await telegram.answerCallbackQuery(cq.id);
      await askAmount(chatId, s);
      return;
    }

    if (data === 'val:ok') {
      if (s.step !== 'validate' || s.amount == null || !s.currency) {
        await telegram.answerCallbackQuery(cq.id, 'Session expired, start again.', { show_alert: true });
        reset(chatId);
        return;
      }
      await telegram.answerCallbackQuery(cq.id, 'Creating the link...');
      await payments.createLink(chatId, userId, s);
      reset(chatId);
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
    resumeTracking: payments.resumeTracking,
    pollOnce: payments.pollOnce,
    expirePayment: payments.expirePayment,
    track: payments.track,
  };
}
