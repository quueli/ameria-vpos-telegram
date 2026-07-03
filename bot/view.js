import { CURRENCIES, currencyByCode } from './config.js';

export const GEN_BUTTON = 'Generate payment link';

export const mainKeyboard = {
  keyboard: [[{ text: GEN_BUTTON }]],
  resize_keyboard: true,
  is_persistent: true,
};

export const amountKeyboard = {
  inline_keyboard: [
    [{ text: 'Back (change currency)', callback_data: 'amt:back' }],
    [{ text: 'Cancel', callback_data: 'flow:cancel' }],
  ],
};

export const confirmKeyboard = {
  inline_keyboard: [
    [{ text: 'OK, create link', callback_data: 'val:ok' }],
    [{ text: 'Back (change amount)', callback_data: 'val:back' }],
    [{ text: 'Cancel', callback_data: 'flow:cancel' }],
  ],
};

export function currencyKeyboard() {
  const rows = CURRENCIES.map((c) => [
    { text: `${c.label} - ${c.title}`, callback_data: `cur:${c.code}` },
  ]);
  rows.push([{ text: 'Cancel', callback_data: 'flow:cancel' }]);
  return { inline_keyboard: rows };
}

export function payCancelKeyboard(orderId) {
  return { inline_keyboard: [[{ text: 'Cancel payment', callback_data: `pay:cancel:${orderId}` }]] };
}

export function fmtAmount(n) {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

export function parseAmount(text) {
  const cleaned = String(text).replace(',', '.').replace(/\s/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!(num > 0)) return null;
  return Math.round(num * 100) / 100;
}

export function amountLine(rates, amount, code) {
  const cur = currencyByCode(code);
  if (code === '051') return `<b>${fmtAmount(amount)} ${cur.label}</b>`;
  return `<b>${fmtAmount(amount)} ${cur.label}</b> ~ <b>${fmtAmount(rates.toAMD(amount, code))} AMD</b>`;
}

export const startText = 'Payment-link bot for AmeriaBank vPOS.\n\n'
  + 'Pick a currency and an amount; the bot registers the payment, sends you '
  + 'the bank link, and tells you when it clears.\n\n'
  + 'Tap "Generate payment link" below to begin.';

export const currencyText = 'Choose the <b>currency</b> for the payment link:';

export function amountText(code) {
  const cur = currencyByCode(code);
  return `Currency: <b>${cur.label}</b> (${cur.title}).\n\n`
    + 'Enter the <b>amount</b> as a number (e.g. 10 or 1500.50):';
}

export function confirmText(rates, { currency, amount }) {
  const cur = currencyByCode(currency);
  let conv = '';
  if (currency !== '051') {
    conv = `To be charged: <b>${fmtAmount(rates.toAMD(amount, currency))} AMD</b>\n`
      + `Rate: 1 ${cur.label} = ${rates.amdPerUnit(currency).toFixed(2)} AMD\n`;
  }
  return '<b>Check the details</b>\n\n'
    + `Currency: <b>${cur.label}</b> - ${cur.title}\n`
    + `Amount: <b>${fmtAmount(amount)} ${cur.label}</b>\n`
    + conv
    + '\nThe invoice is issued in AMD; any card works.\nAll correct?';
}

export function linkText(rates, p, minutes) {
  return '<b>Payment link created</b>\n\n'
    + `Amount: ${amountLine(rates, p.amount, p.currency)}\n`
    + `Order ID: <code>${p.orderId}</code>\n`
    + `Pay within <b>${minutes} minutes</b> (any bank card):\n\n`
    + `${p.redirectUrl}`;
}

export function paidText(rates, p, c) {
  const d = c.details || {};
  return '<b>Payment received</b>\n\n'
    + `Amount: ${amountLine(rates, p.amount, p.currency)}\n`
    + `Order: <code>${p.orderId}</code>\n`
    + (d.CardNumber ? `Card: <code>${d.CardNumber}</code>\n` : '')
    + (d.rrn ? `RRN: <code>${d.rrn}</code>\n` : '')
    + `Status: <code>${c.state || ''}</code>`;
}

export function declinedText(p, code, hint) {
  return `A payment attempt for order <code>${p.orderId}</code> was declined by the bank.`
    + (code ? `\nCode: <code>${code}</code>` : '')
    + (hint ? `\n${hint}` : '')
    + '\nThe link is still active - the customer can try again before it expires.';
}

export function expiredText(p, cancel) {
  return '<b>Payment time expired.</b>\n\n'
    + `Order: <code>${p.orderId}</code>\n`
    + 'No payment was made, the link has been voided.\n'
    + (cancel.ok
      ? `Cancellation confirmed by the bank${cancel.code ? ` (code ${cancel.code})` : ''}.`
      : `Cancellation: ${cancel.message || cancel.code || 'not confirmed'}`);
}

export function closedLinkText(rates, p, note) {
  return '<s>Payment link</s>\n\n'
    + `Amount: ${amountLine(rates, p.amount, p.currency)}\n`
    + `Order: <code>${p.orderId}</code>\n\n`
    + note;
}
