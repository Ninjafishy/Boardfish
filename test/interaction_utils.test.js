'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('createRafCommitter coalesces scheduled state and supports flush', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let requestCount = 0;
  const cancelled = [];
  globalThis.requestAnimationFrame = () => {
    requestCount++;
    return 0;
  };
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);
  const Interaction = require('../src/js/interaction_utils.js');
  const applied = [];

  try {
    const committer = Interaction.createRafCommitter((...values) => applied.push(values));
    committer.schedule(1, 2, 3, 4);
    committer.schedule(5, 6, 7, 8);
    assert.equal(requestCount, 1);
    assert.deepEqual(applied, []);
    committer.flush();
    assert.deepEqual(cancelled, [0]);
    assert.deepEqual(applied, [[5, 6, 7, 8]]);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
