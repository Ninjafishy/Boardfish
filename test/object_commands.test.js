'use strict';

const { readSource, runScript, loadBoardLimits, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadDuplicateHarness({ realLimits = false } = {}) {
  const source = readSource('src/js/object_commands.js');
  const sourceObjects = [
    { id: 'text-1', type: 'text', x: 10, y: 20, w: 20, h: 10, z: 1, data: { content: 'text' } },
    { id: 'image-1', type: 'image', x: 50, y: 60, w: 10, h: 20, z: 2, data: { imgKey: 'img-1' } },
  ];
  let idCounter = 0;
  const calls = {
    added: [],
    histories: [],
  };
  const context = {
    calls,
    editingId: null,
    objects: sourceObjects,
    selectedIds: new Set(sourceObjects.map((obj) => obj.id)),
    objectsMap: new Map(sourceObjects.map((obj) => [obj.id, obj])),
    zCounter: 10,
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      canAcceptAdditionalTextCharacters() { return true; },
      textCharacterCount(text) { return Array.from(String(text ?? '')).length; },
      textByteLength(text) { return String(text ?? '').length; },
    },
    BoardfishEditorState: {
      addObject(obj) {
        calls.added.push(obj);
        context.objects.push(obj);
        context.objectsMap.set(obj.id, obj);
      },
      setSelection(ids) {
        context.selectedIds = new Set(ids);
      },
    },
    cloneObject(obj) {
      return plain(obj);
    },
    newId() {
      idCounter++;
      return `dup-${idCounter}`;
    },
    scheduleRender() {},
    pushHistory(reason) {
      calls.histories.push(reason);
    },
  };
  if (realLimits) context.BoardfishWebLimits = loadBoardLimits(context.objects);
  runScript(source, context, {
    filename: 'object_commands.js',
  });
  return context;
}

test('duplicateSelected centers the duplicated group on the supplied point', () => {
  const context = loadDuplicateHarness();

  context.duplicateSelected({ x: 100, y: 200 });

  assert.equal(context.calls.added.length, 2);
  const minX = Math.min(...context.calls.added.map((obj) => obj.x));
  const minY = Math.min(...context.calls.added.map((obj) => obj.y));
  const maxX = Math.max(...context.calls.added.map((obj) => obj.x + obj.w));
  const maxY = Math.max(...context.calls.added.map((obj) => obj.y + obj.h));
  assert.equal((minX + maxX) / 2, 100);
  assert.equal((minY + maxY) / 2, 200);
  assert.deepEqual(plain(context.calls.histories), ['duplicate-selected']);
});

test('duplicateSelected rejects a mixed selection atomically when its text exceeds the board limit', () => {
  const context = loadDuplicateHarness({ realLimits: true });
  context.objects[0].data.content = 'x'.repeat(12501);

  context.duplicateSelected({ x: 100, y: 200 });

  assert.equal(context.objects.length, 2);
  assert.equal(context.zCounter, 10);
  assert.deepEqual(context.calls.added, []);
  assert.deepEqual(context.calls.histories, []);
});

test('duplicateSelected accepts the exact board limit counting spaces, tabs, and emoji', () => {
  const context = loadDuplicateHarness({ realLimits: true });
  context.objects[0].data.content = `${'x'.repeat(12497)} \t😀`;

  context.duplicateSelected({ x: 100, y: 200 });

  assert.equal(context.calls.added.length, 2);
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
  assert.deepEqual(context.calls.histories, ['duplicate-selected']);
});
