// AmeriaBank vPOS 3.1: InitPayment, GetPaymentDetails, CancelPayment, RefundPayment.
// InitPayment signals success with ResponseCode 1, every other call with the string "00".

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
        Timeout: p.timeoutSec || 1200, // seconds, 1200 is the max the gateway takes
      };
      const data = await post('InitPayment', body);
      if (data.error) return { ok: false, error: data.error };
      if (Number(data.ResponseCode) !== 1) {
        return { ok: false, error: data.ResponseMessage || 'InitPayment failed', responseCode: data.ResponseCode, raw: data };
      }
      const lang = p.lang || 'en';
      return {
        ok: true,
        paymentId: data.PaymentID,
        redirectUrl: `${payUrl}?id=${encodeURIComponent(data.PaymentID)}&lang=${lang}`,
        raw: data,
      };
    },

    async getPaymentDetails(paymentId) {
      return post('GetPaymentDetails', { PaymentID: paymentId, Username: username, Password: password });
    },

    // void, allowed for 72h after the original
    async cancelPayment(paymentId) {
      const data = await post('CancelPayment', { PaymentID: paymentId, Username: username, Password: password });
      if (data.error) return { ok: false, error: data.error };
      const ok = String(data.ResponseCode) === '00';
      return { ok, responseCode: data.ResponseCode, message: data.ResponseMessage, raw: data };
    },

    async refundPayment(paymentId, amount) {
      const data = await post('RefundPayment', {
        PaymentID: paymentId,
        Username: username,
        Password: password,
        Amount: Number(amount),
      });
      if (data.error) return { ok: false, error: data.error };
      const ok = String(data.ResponseCode) === '00';
      return { ok, responseCode: data.ResponseCode, message: data.ResponseMessage, raw: data };
    },

    classify: classifyDetails,
    declineHint,
  };
}

// started 0 | approved 1 | deposited 2 | void 3 | refunded 4 | autoauthorized 5 | declined 6
export function classifyDetails(details) {
  if (!details || details.error) return { kind: 'error', message: details?.error || 'no details' };
  const state = String(details.PaymentState || '');
  const status = details.OrderStatus != null ? parseInt(details.OrderStatus, 10) : null;
  const rc = String(details.ResponseCode || '');

  if (state === 'payment_deposited' || state === 'payment_approved' || state === 'payment_autoauthorized'
      || status === 2 || status === 1 || status === 5) {
    return { kind: 'paid', state, status, rc, details };
  }
  if (state === 'payment_declined' || status === 6) {
    return { kind: 'declined', state, status, rc, details };
  }
  if (state === 'payment_void' || status === 3) {
    return { kind: 'void', state, status, rc, details };
  }
  if (state === 'payment_refunded' || status === 4) {
    return { kind: 'refunded', state, status, rc, details };
  }
  return { kind: 'pending', state, status, rc, details };
}

export function declineHint(rc) {
  const code = String(rc || '').trim();
  const map = {
    '02003': '3-D Secure is required on this merchant and the card did not pass it.',
    '0999': 'authorization never started (fraud check or 3-D Secure error).',
    '0-2005': '3-D Secure signature error.',
    '0-2006': 'issuer declined the 3-D Secure authentication.',
    '0-2007': 'card data entry timed out.',
    '0-2016': 'issuer not ready for 3-D Secure.',
    '0-2018': '3-D Secure server unavailable (Visa/MasterCard).',
    '0116': 'insufficient funds.',
    '0101': 'card expired.',
    '0111': 'invalid card number.',
    '0120': 'operation forbidden by the issuer.',
    '0100': 'issuer blocked online operations on this card.',
  };
  return map[code] || null;
}
