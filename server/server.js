import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../bot/config.js';
import { createAmeria, classifyDetails } from '../bot/ameria.js';
import { genOrderId } from '../bot/order-id.js';

// web side of the same merchant account: no link to the bot process, they only
// share bot/ameria.js and the order-id scheme

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const ameria = createAmeria(config.ameria);
const app = express();
app.use(express.json());
app.use(express.static(publicDir));

// orderId -> PaymentID, so a later cancel/refund only needs our id. 72h is how
// long vPOS accepts a reversal.
const ORDER_TTL_MS = 72 * 60 * 60 * 1000;
const orderStore = new Map();

function saveOrderContext(orderId, ctx) {
  orderStore.set(String(orderId), { ...ctx, savedAt: Date.now() });
}

function getOrderContext(orderId) {
  const key = String(orderId);
  const ctx = orderStore.get(key);
  if (!ctx) return null;
  if (Date.now() - ctx.savedAt > ORDER_TTL_MS) {
    orderStore.delete(key);
    return null;
  }
  return ctx;
}

app.post('/api/init-payment', async (req, res) => {
  try {
    const { amount = 10, currency = '051', description, backUrl } = req.body || {};
    const orderId = req.body?.orderId || genOrderId();

    const result = await ameria.initPayment({
      amount,
      currency,
      orderId,
      description: description || `Payment ${orderId}`,
      backUrl: backUrl || config.backUrl,
      lang: 'en',
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error, responseCode: result.responseCode });
    }

    saveOrderContext(orderId, { paymentId: result.paymentId, amount, currency, status: 'pending_at_bank' });
    res.json({ orderId, paymentId: result.paymentId, redirectUrl: result.redirectUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payment-details', async (req, res) => {
  try {
    const { paymentId } = req.query;
    if (!paymentId) return res.status(400).json({ error: 'paymentId is required' });
    const details = await ameria.getPaymentDetails(paymentId);
    if (details.error) return res.status(502).json({ error: details.error });
    const c = classifyDetails(details);
    res.json({ status: c.kind, state: c.state, details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// cancel before capture, refund after; an order that is already void or
// refunded is a no-op so a double click is harmless
async function reverse(orderId, paymentId, amount, mode) {
  let ctx = null;
  if (orderId) {
    ctx = getOrderContext(orderId);
    if (ctx && !paymentId && ctx.paymentId) paymentId = ctx.paymentId;
  }
  if (!paymentId) {
    return { status: 404, data: { success: false, message: 'Order not found or expired (72h).' } };
  }

  const details = await ameria.getPaymentDetails(paymentId);
  if (details.error) return { status: 502, data: { success: false, message: details.error } };
  const c = classifyDetails(details);

  if (c.kind === 'void' || c.kind === 'refunded') {
    return { status: 200, data: { success: true, operation: 'noop', message: 'Already cancelled or refunded', paymentId, details } };
  }
  if (c.kind === 'declined' && mode !== 'cancel') {
    return { status: 200, data: { success: false, operation: 'noop', message: 'Payment was declined; no refund needed', paymentId } };
  }

  const deposited = details.PaymentState === 'payment_deposited' || Number(details.OrderStatus) === 2;
  const useRefund = mode === 'refund' || (mode === 'auto' && deposited);

  if (useRefund) {
    let refundAmount = amount;
    if (refundAmount == null || refundAmount === '') {
      refundAmount = (ctx && ctx.amount) || details.DepositedAmount || details.Amount;
    }
    refundAmount = Number(refundAmount);
    if (!refundAmount || refundAmount <= 0) {
      return { status: 400, data: { success: false, message: 'Invalid refund amount' } };
    }
    const r = await ameria.refundPayment(paymentId, refundAmount);
    if (r.error) return { status: 502, data: { success: false, message: r.error } };
    if (r.ok && orderId) saveOrderContext(orderId, { ...(ctx || {}), paymentId, status: 'refunded' });
    return {
      status: r.ok ? 200 : 400,
      data: { success: r.ok, operation: 'refund', responseCode: r.responseCode, message: r.message, paymentId, orderId, amount: refundAmount },
    };
  }

  const r = await ameria.cancelPayment(paymentId);
  if (r.error) return { status: 502, data: { success: false, message: r.error } };
  if (r.ok && orderId) saveOrderContext(orderId, { ...(ctx || {}), paymentId, status: 'void' });
  return {
    status: r.ok ? 200 : 400,
    data: { success: r.ok, operation: 'cancel', responseCode: r.responseCode, message: r.message, paymentId, orderId },
  };
}

app.post('/api/cancel-payment', async (req, res) => {
  const { orderId, paymentId } = req.body || {};
  const r = await reverse(orderId || null, paymentId || null, null, 'cancel');
  res.status(r.status).json(r.data);
});

app.post('/api/refund-payment', async (req, res) => {
  const { orderId, paymentId, amount } = req.body || {};
  if (!orderId && !paymentId) return res.status(400).json({ error: 'orderId or paymentId is required' });
  const r = await reverse(orderId || null, paymentId || null, amount, 'auto');
  res.status(r.status).json(r.data);
});

// BACK_URL: where the bank drops the customer's browser after paying
app.get('/payment-result', (req, res) => {
  res.sendFile(path.join(publicDir, 'payment-result.html'));
});

app.listen(config.port, () => {
  console.log(`\nServer on http://localhost:${config.port}`);
  console.log(`  Payment result page: http://localhost:${config.port}/payment-result`);
  console.log(`  vPOS: ${config.ameria.apiBase}\n`);
});
