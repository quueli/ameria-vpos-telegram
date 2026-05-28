import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDetails, declineHint } from '../ameria.js';

test('vpos states map to a kind', () => {
  assert.equal(classifyDetails({ PaymentState: 'payment_deposited' }).kind, 'paid');
  assert.equal(classifyDetails({ OrderStatus: 2 }).kind, 'paid');
  assert.equal(classifyDetails({ PaymentState: 'payment_approved' }).kind, 'paid');
  assert.equal(classifyDetails({ PaymentState: 'payment_declined' }).kind, 'declined');
  assert.equal(classifyDetails({ OrderStatus: 6 }).kind, 'declined');
  assert.equal(classifyDetails({ PaymentState: 'payment_void' }).kind, 'void');
  assert.equal(classifyDetails({ PaymentState: 'payment_refunded' }).kind, 'refunded');
  assert.equal(classifyDetails({ PaymentState: 'payment_started' }).kind, 'pending');
  assert.equal(classifyDetails({}).kind, 'pending');
});

test('transport failures classify as error', () => {
  assert.equal(classifyDetails({ error: 'network error' }).kind, 'error');
  assert.equal(classifyDetails(null).kind, 'error');
});

test('decline hints for known codes only', () => {
  const declined = classifyDetails({ PaymentState: 'payment_declined', ResponseCode: '0116' });
  assert.equal(declined.rc, '0116');
  assert.ok(declineHint('0116'));
  assert.equal(declineHint('99999'), null);
});
