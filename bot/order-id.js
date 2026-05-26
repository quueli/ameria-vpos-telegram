// vPOS OrderID is a signed int32. The first version sent Date.now() * 100, which
// wrapped to a negative id, so every order collided onto one stuck PaymentID.

let seq = Math.floor(Math.random() * 20);

export function genOrderId() {
  seq = (seq + 1) % 20;
  return (Date.now() % 100000000) * 20 + seq; // <= 1 999 999 999
}

export const INT32_MAX = 2147483647;
