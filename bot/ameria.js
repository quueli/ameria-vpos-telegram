// AmeriaBank vPOS 3.1, so far only InitPayment and GetPaymentDetails
export function createAmeria(cfg) {
  const { apiBase, payUrl, clientId, username, password } = cfg;

  async function post(endpoint, body) {
    let response;
    try {
      response = await fetch(`${apiBase}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { error: `network error calling ${endpoint}: ${e.message}` };
    }
    const text = await response.text();
    if (!response.ok) {
      return { error: `gateway HTTP ${response.status} on ${endpoint}: ${text}` };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { error: `bad JSON from ${endpoint}: ${text}` };
    }
  }

  return {
    async initPayment(p) {
      const body = {
        ClientID: clientId,
        Username: username,
        Password: password,
        Amount: Number(p.amount),
        OrderID: p.orderId,
        Description: p.description || `Payment ${p.orderId}`,
        Currency: p.currency || '051',
        BackURL: p.backUrl,
        Timeout: p.timeoutSec || 1200,
      };
      const data = await post('InitPayment', body);
      if (data.error) return { ok: false, error: data.error };
      if (Number(data.ResponseCode) !== 1) {
        return { ok: false, error: data.ResponseMessage || 'InitPayment failed', responseCode: data.ResponseCode };
      }
      return {
        ok: true,
        paymentId: data.PaymentID,
        redirectUrl: `${payUrl}?id=${encodeURIComponent(data.PaymentID)}&lang=${p.lang || 'en'}`,
      };
    },

    async getPaymentDetails(paymentId) {
      return post('GetPaymentDetails', { PaymentID: paymentId, Username: username, Password: password });
    },
  };
}
