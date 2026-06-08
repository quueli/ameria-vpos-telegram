import { classifyDetails, declineHint } from '../bot/ameria.js';

// a payment stays started until it has been polled payAfter times, then deposits
export function createStubGateway({ payAfter = 2 } = {}) {
  const payments = new Map();
  let n = 0;

  return {
    async initPayment(p) {
      const paymentId = `stub-${++n}`;
      payments.set(paymentId, { orderId: p.orderId, amount: p.amount, polls: 0 });
      return {
        ok: true,
        paymentId,
        redirectUrl: `https://vpos.example/pay?id=${paymentId}&lang=${p.lang || 'en'}`,
      };
    },

    async getPaymentDetails(paymentId) {
      const rec = payments.get(paymentId);
      if (!rec) return { error: `unknown paymentId ${paymentId}` };
      rec.polls += 1;
      const paid = rec.polls > payAfter && !rec.cancelled;
      return {
        PaymentID: paymentId,
        OrderID: rec.orderId,
        Amount: rec.amount,
        ResponseCode: '00',
        PaymentState: rec.cancelled ? 'payment_void' : (paid ? 'payment_deposited' : 'payment_started'),
        OrderStatus: rec.cancelled ? 3 : (paid ? 2 : 0),
        CardNumber: paid ? '400000******0002' : '',
        rrn: paid ? '123456789012' : '',
      };
    },

    async cancelPayment(paymentId) {
      const rec = payments.get(paymentId);
      if (rec) rec.cancelled = true;
      return { ok: true, responseCode: '00', message: 'OK' };
    },

    classify: classifyDetails,
    declineHint,
  };
}
