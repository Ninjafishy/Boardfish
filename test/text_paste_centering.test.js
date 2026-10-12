'use strict';

const { readSource, runScript, loadBoardLimits } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitTextContext } = require('../test-support/text_editor.js');

function loadAddTextHarness({ realLimits = false } = {}) {
  const textLayoutSource = readSource('src/js/text_layout.js') + '\n';
  const source = readSource('src/js/object_commands.js');
  let idCounter = 1;
  const context = {
    document: {
      createElement() { return { getContext: createUnitTextContext }; },
    },
    added: [],

    histories: [],
    objects: [],
    zCounter: 1,
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      canAcceptAdditionalTextCharacters() { return true; },
      textCharacterCount(text) { return Array.from(String(text ?? '')).length; },
      textByteLength(text) {
        context.textByteLengthCalls++;
        return String(text ?? '').length;
      },
    },
    BoardfishEditorState: {
      addObject(obj) {
        context.added.push(obj);
        context.objects.push(obj);
        return obj;
      },
    },

    newId() {
      return `obj-${idCounter++}`;
    },
    testSyncTextAutoHeight(obj, minLines = 1) {
      const contentLines = String(obj.data?.content || '').split('\n').length;
      obj.h = Math.max(minLines, contentLines) * context.LINE_H + context.TEXT_PAD * 2;
      return true;
    },
    selectObject() {},
    pushHistory(reason) {
      context.histories.push(reason);
    },
    enterEdit(id, options = {}) {
      if (options.history !== false) context.pushHistory('text-edit-enter');
    },
    textByteLengthCalls: 0,
  };
  if (realLimits) context.BoardfishWebLimits = loadBoardLimits(context.objects);
  runScript(`${textLayoutSource}syncTextAutoHeight = testSyncTextAutoHeight;\n${source}\n`, context, {
    filename: 'object_commands.js',
  });
  return context;
}

function loadPasteHarness({ browserText = '', normalizeExternalText = (value) => value } = {}) {
  const source = readSource('src/js/clipboard_export_init.js');
  const calls = { addText: [] };
  const context = {
    Promise,
    calls,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    navigator: {
      clipboard: {
        readText() {
          return Promise.resolve(browserText);
        },
      },
    },
    objects: [],
    jsClipboard: null,
    _pasteInProgress: false,
    BoardfishClipboardIO: {
      readClipboardImageFileFromEvent() { return null; },
      readClipboardTextFromEvent(clipboardData) {
        return clipboardData?.getData?.('text/plain') || '';
      },
    },

    acquireInputShield() {
      return () => {};
    },
    addText(wx, wy, content, options = {}) {
      calls.addText.push({ wx, wy, content, options });
    },
    textForExternalTextObjectPaste(value) {
      return normalizeExternalText(value);
    },
  };
  runScript(source, context, {
    filename: 'clipboard_export_init.js',
  });
  return context;
}

test('addText strips whitespace-only lines at pasted text edges', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  \n\t\nfirst line  \nsecond line\n   \n\t');

  const obj = context.added[0];
  assert.equal(obj.data.content, 'first line  \nsecond line');
});

test('addText preserves content that the external-paste path already prepared', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  prepared  ', { contentPrepared: true });

  assert.equal(context.added[0].data.content, '  prepared  ');
});

test('addText rejects over-limit content atomically', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24998) } });

  context.addText(24, 48, 'x \t');

  assert.equal(context.objects.length, 1);
  assert.equal(context.zCounter, 1);
  assert.deepEqual(context.added, []);
  assert.deepEqual(context.histories, []);
});

test('addText accepts the exact character limit after paste normalization', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });

  context.addText(24, 48, '\r\n\t\r\nx \t😀\r\n\t');

  assert.equal(context.added[0].data.content, 'x \t😀');
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
});

test('addText counts prepared external paste content without changing it', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });

  context.addText(24, 48, ' \t😀x', { contentPrepared: true });

  assert.equal(context.added[0].data.content, ' \t😀x');
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
});

test('outside clipboard text is normalized before creating a text box', async () => {
  const context = loadPasteHarness({
    normalizeExternalText(value) {
      return value.replace('\n', ' ');
    },
  });

  await context.pasteAtPos(640, 360, {
    getData(type) {
      return type === 'text/plain' ? 'wrapped prose\ncontinues here' : '';
    },
  });

  assert.equal(context.calls.addText[0].content, 'wrapped prose continues here');
});
