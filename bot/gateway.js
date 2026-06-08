// ameria.js in production, demo/stub-gateway.js offline
export function assertGateway(gw) {
  for (const fn of ['initPayment', 'getPaymentDetails', 'cancelPayment', 'classify']) {
    if (typeof gw[fn] !== 'function') throw new Error(`gateway is missing ${fn}()`);
  }
  return gw;
}
