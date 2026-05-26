import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genOrderId, INT32_MAX } from '../order-id.js';

test('order ids fit in int32', () => {
  for (let i = 0; i < 5000; i += 1) {
    const id = genOrderId();
    assert.ok(Number.isInteger(id), `${id} is not an integer`);
    assert.ok(id > 0 && id <= INT32_MAX, `${id} outside (0, ${INT32_MAX}]`);
  }
});

test('the old timestamp formula overflowed', () => {
  assert.ok(Date.now() * 100 > INT32_MAX);
  assert.ok(genOrderId() <= INT32_MAX);
});

test('a burst of ids is unique', async () => {
  const a = Array.from({ length: 20 }, () => genOrderId());
  await new Promise((r) => setTimeout(r, 3));
  const b = Array.from({ length: 20 }, () => genOrderId());
  const all = [...a, ...b];
  assert.equal(new Set(all).size, all.length);
});
