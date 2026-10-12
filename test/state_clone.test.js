'use strict';

const { readSource, runScript, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadStateCloneHarness() {
  const context = {
    cloneTextObjectRuntimeCaches(source, target) {
      target._runtimeCopiedFrom = source.id;
    },
  };
  runScript(
    `${readSource('src/js/state.js')}\n` +
      'globalThis.__stateClone = { cloneObject, newId };\n',
    context,
    { filename: 'state.js' },
  );
  return context;
}

test('text clone preserves canonical content and drops retired alignment metadata', () => {
  const context = loadStateCloneHarness();
  const clone = context.__stateClone.cloneObject({
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello\nworld', lineAlign: ['center'] },
  });

  assert.deepEqual(plain(clone), {
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello\nworld' },
  });
});

test('text clone copies runtime caches only when requested', () => {
  const context = loadStateCloneHarness();
  const source = {
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello' },
  };

  const regularClone = context.__stateClone.cloneObject(source);
  const runtimeClone = context.__stateClone.cloneObject(source, true);

  assert.equal(regularClone._runtimeCopiedFrom, undefined);
  assert.equal(runtimeClone._runtimeCopiedFrom, 'text-1');
});

test('newId skips ids already present in the live object map', () => {
  const context = loadStateCloneHarness();

  context.objectsMap.set('obj-1', { id: 'obj-1' });

  assert.equal(context.__stateClone.newId(), 'obj-2');
});
