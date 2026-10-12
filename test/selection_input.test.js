'use strict';

const { readSource, runScript, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadSelectionInputHarness(objects) {
  const source = readSource('src/js/selection_input.js');
  const context = {
    objectsMap: new Map(objects.map((obj) => [obj.id, obj])),
    editingId: null,
    _editEl: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: null,
    _editHistoryActionStartState: null,
    EDIT_HISTORY_DEBOUNCE_MS: 500,
    history: [],
    historyOptions: [],
    timeoutDelay: null,
    clearTimeout() {},
    setTimeout(handler, delay) {
      context.timeoutHandler = handler;
      context.timeoutDelay = delay;
      return 1;
    },
    textEditProxyValue: proxy => proxy._boardfishLogicalValue ?? proxy.value,
    pushHistory(reason, dirty, beforeEditState) {
      context.history.push(reason);
      context.historyOptions.push({ beforeEditState });
    },
  };
  runScript(
    source.slice(source.indexOf('const normalizeTextEditHistoryState')) + '\n' +
      'globalThis.beginTextEditHistoryAction = beginTextEditHistoryAction;\n' +
      'globalThis.recordTextEditInputHistory = recordTextEditInputHistory;\n',
    context,
  );
  return context;
}

test('save flushes a pending text edit checkpoint into the saved baseline', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
  const context = loadSelectionInputHarness([text]);
  context.editingId = text.id;
  context._editHistoryTimer = 42;
  context._editHistoryLastContent = 'before';

  assert.equal(context.flushEditHistoryCheckpoint(), true);
  assert.equal(context._editHistoryTimer, null);
  assert.equal(context._editHistoryLastContent, 'after');
  assert.deepEqual(context.history, ['text-edit-checkpoint']);
});

test('continuous text edits debounce into a 500ms checkpoint', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
  const context = loadSelectionInputHarness([text]);
  context.editingId = text.id;
  context._editEl = {
    value: 'before',
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
  };
  context._editHistoryLastContent = 'before';
  context.beginTextEditHistoryAction(text.id, {
    start: 3,
    end: 3,
    direction: 'none',
  });

  assert.equal(context.recordTextEditInputHistory(text.id, 'deleteContentBackward'), false);

  assert.equal(context.timeoutDelay, 500);
  assert.deepEqual(context.history, []);
  context.timeoutHandler();
  assert.equal(context._editHistoryTimer, null);
  assert.deepEqual(context.history, ['text-edit-checkpoint']);
  assert.deepEqual(plain(context.historyOptions[0].beforeEditState), {
    id: text.id,
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
  });
});

test('selection replace and paste text edits commit without debounce', () => {
  for (const meta of [
    { inputType: 'deleteContentBackward', hadSelection: true },
    { inputType: 'insertFromPaste', hadSelection: false },
  ]) {
    const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
    const context = loadSelectionInputHarness([text]);
    context.editingId = text.id;
    context._editHistoryTimer = 42;
    context._editHistoryLastContent = 'before';

    assert.equal(context.recordTextEditInputHistory(text.id, meta.inputType, meta.hadSelection), true);
    assert.equal(context._editHistoryTimer, null);
    assert.equal(context.timeoutDelay, null);
    assert.deepEqual(context.history, ['text-edit-checkpoint']);
  }
});
