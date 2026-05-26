// endpoint for the gateway to POST to when a payment finishes, so we don't poll.
// app.post('/api/ameria/callback', createWebhookHandler({ store, telegram }))

export function createWebhookHandler({ store, telegram }) {
  return async function handleGatewayCallback(req, res) {
    const { OrderID, PaymentState } = req.body || {};
    const p = OrderID != null ? store.get(OrderID) : null;
    if (!p) {
      res.statusCode = 404;
      res.end('unknown order');
      return;
    }
    if (PaymentState === 'payment_deposited' && p.status === 'pending') {
      store.set(OrderID, { status: 'paid' });
      await telegram.sendMessage(p.chatId, `Payment received for order ${OrderID}`);
    }
    res.end('ok');
  };
}
