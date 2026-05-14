// multiplied so two links made in the same second still differ
export function genOrderId() {
  return Date.now() * 100;
}
