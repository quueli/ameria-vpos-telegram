import { CURRENCIES, currencyByCode } from './config.js';
import { genOrderId } from './order-id.js';

const GEN_BUTTON = 'Generate payment link';
const mainKeyboard = { keyboard: [[{ text: GEN_BUTTON }]], resize_keyboard: true, is_persistent: true };

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
  const rows = CURRENCIES.map((c) => [{ text: `${c.label} - ${c.title}`, callback_data: `cur:${c.code}` }]);
  rows.push([{ text: 'Cancel', callback_data: 'flow:cancel' }]);
  return { inline_keyboard: rows };
}

const validateKeyboard = {
  inline_keyboard: [
    [{ text: 'OK, create link', callback_data: 'val:ok' }],
    [{ text: 'Cancel', callback_data: 'flow:cancel' }],
  ],
};

export function createBot({ telegram, gateway, store, config, rates }) {
  const sessions = new Map();
  const isAllowed = (id) => config.allowedIds.includes(Number(id));
  const toAmd = (amount, code) => rates.toAMD(amount, code);

  function getSession(chatId) {
    if (!sessions.has(chatId)) sessions.set(chatId, { step: 'idle' });
    return sessions.get(chatId);
  }
  function resetSession(chatId) {
    sessions.set(chatId, { step: 'idle' });
  }

  async function startFlow(chatId) {
    sessions.set(chatId, { step: 'currency' });
    await telegram.sendMessage(chatId, 'Choose the currency:', { reply_markup: currencyKeyboard() });
  }

  async function askAmount(chatId, session) {
    session.step = 'amount';
    const cur = currencyByCode(session.currency);
    await telegram.sendMessage(chatId, `Currency: ${cur.label}. Enter the amount:`);
  }

  async function showValidation(chatId, session) {
    session.step = 'validate';
    const cur = currencyByCode(session.currency);
    const amd = toAmd(session.amount, session.currency);
    await telegram.sendMessage(
      chatId,
      `Amount: ${fmtAmount(session.amount)} ${cur.label} = ${fmtAmount(amd)} AMD. Create the link?`,
      { reply_markup: validateKeyboard },
    );
  }

  async function createPayment(chatId, userId, session) {
    const amountAmd = toAmd(session.amount, session.currency);
    const orderId = genOrderId();
    const result = await gateway.initPayment({
      amount: amountAmd,
      currency: '051',
      orderId,
      description: `Payment (order ${orderId})`,
      backUrl: config.backUrl,
    });
    if (!result.ok) {
      await telegram.sendMessage(chatId, `Could not create the link: ${result.error || ''}`, { reply_markup: mainKeyboard });
      resetSession(chatId);
      return;
    }
    store.set(orderId, {
      paymentId: result.paymentId,
      orderId,
      chatId,
      userId,
      amount: session.amount,
      currency: session.currency,
      status: 'pending',
      createdAt: Date.now(),
    });
    await telegram.sendMessage(chatId, `Payment link (order ${orderId}):\n${result.redirectUrl}`, { reply_markup: mainKeyboard });
    resetSession(chatId);
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    if (!isAllowed(userId)) {
      await telegram.sendMessage(chatId, 'Access denied.');
      return;
    }
    if (text === '/start' || text === GEN_BUTTON) {
      await startFlow(chatId);
      return;
    }
    const session = getSession(chatId);
    if (session.step === 'amount') {
      const amount = parseAmount(text);
      if (amount == null) {
        await telegram.sendMessage(chatId, 'Enter a positive number.');
        return;
      }
      session.amount = amount;
      await showValidation(chatId, session);
    }
  }

  async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    const userId = cq.from?.id;
    const data = cq.data || '';
    if (!isAllowed(userId)) {
      await telegram.answerCallbackQuery(cq.id, 'Access denied.', { show_alert: true });
      return;
    }
    const session = getSession(chatId);
    if (data === 'flow:cancel') {
      resetSession(chatId);
      await telegram.answerCallbackQuery(cq.id, 'Cancelled');
      return;
    }
    if (data.startsWith('cur:')) {
      session.currency = data.slice('cur:'.length);
      await telegram.answerCallbackQuery(cq.id);
      await askAmount(chatId, session);
      return;
    }
    if (data === 'val:ok') {
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

  return { handleUpdate, handleMessage, handleCallback };
}
