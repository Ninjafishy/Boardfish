'use strict';

const { readSource, runScript } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitTextContext } = require('../test-support/text_editor.js');

function loadTextEditorHelpers() {
  const context = { document: { createElement: () => ({ getContext: createUnitTextContext }) } };
  runScript(
    readSource('src/js/text_layout.js') + '\n' +
    readSource('src/js/text_editor.js') +
      '\nglobalThis.textNewlineCount = textNewlineCount;\n' +
      'globalThis.applyTextEditLineIndent = applyTextEditLineIndent;\n' +
      'globalThis.applyTextEditLineBreakIndent = applyTextEditLineBreakIndent;\n',
    context,
    { filename: 'text_editor.js' },
  );
  return context;
}

function loadTextClipboardFreshnessHarness({ maybeStale = false } = {}) {
  const source = readSource('src/js/text_editor.js');
  const start = source.indexOf('const boardfishTextClipboardStillCurrent');
  const end = source.indexOf('const readBoardfishTextClipboardPayloadForPaste', start);
  assert.ok(start >= 0 && end > start, 'Boardfish text clipboard freshness helper is missing');

  const calls = {
    browserTokenReads: 0,
    currentOptions: null,
  };
  const context = {
    calls,
    _jsClipboardWebMaybeStale: maybeStale,
    BoardfishClipboardIO: {
      readBoardfishClipboardTokenFromBrowser() {
        calls.browserTokenReads++;
        return Promise.resolve({ checked: true, token: 'bf-token' });
      },
    },
    jsClipboardStillCurrent(options) {
      calls.currentOptions = options;
      return true;
    },
  };

  runScript(
    `${source.slice(start, end)}\n` +
      'this.boardfishTextClipboardStillCurrent = boardfishTextClipboardStillCurrent;\n',
    context,
  );
  return context;
}

test('fresh in-app text clipboard skips browser token authorization', async () => {
  const context = loadTextClipboardFreshnessHarness({ maybeStale: false });

  assert.equal(await context.boardfishTextClipboardStillCurrent(), true);
  assert.equal(context.calls.browserTokenReads, 0);
  assert.equal(context.calls.currentOptions.webClipboardTokenChecked, false);
  assert.equal(context.calls.currentOptions.webClipboardToken, '');
});

test('text newline count handles bounded long ranges', () => {
  const context = loadTextEditorHelpers();
  const longText = `${'x'.repeat(80)}\nsecond\nthird`;
  assert.equal(context.textNewlineCount(longText, 0, longText.length - 1), 2);
});

test('tab indents the current text edit line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('one\ntwo', {
    start: 5,
    end: 5,
    direction: 'none',
  });

  assert.equal(result.changed, true);
  assert.equal(result.value, 'one\n\ttwo');
  assert.equal(result.start, 6);
  assert.equal(result.end, 6);
});

test('tab at the start of a blank first line indents that line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('\none', {
    start: 0,
    end: 0,
    direction: 'none',
  });

  assert.equal(result.value, '\t\none');
  assert.equal(result.start, 1);
  assert.equal(result.end, 1);
});

test('tab indents every selected text edit line without including a trailing caret-only line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const multiline = applyTextEditLineIndent('one\ntwo\nthree', {
    start: 1,
    end: 7,
    direction: 'forward',
  });
  assert.equal(multiline.value, '\tone\n\ttwo\nthree');
  assert.equal(multiline.start, 2);
  assert.equal(multiline.end, 9);
  assert.equal(multiline.direction, 'forward');

  const trailingLineStart = applyTextEditLineIndent('one\ntwo', {
    start: 0,
    end: 4,
    direction: 'forward',
  });
  assert.equal(trailingLineStart.value, '\tone\ntwo');
  assert.equal(trailingLineStart.start, 1);
  assert.equal(trailingLineStart.end, 5);
});

test('shift tab outdents selected text edit lines', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('    one\n\ttwo\n  three', {
    start: 4,
    end: 20,
    direction: 'forward',
  }, true);

  assert.equal(result.changed, true);
  assert.equal(result.value, 'one\ntwo\nthree');
  assert.equal(result.start, 0);
  assert.equal(result.end, 13);
});

test('line indentation treats only LF as a line boundary', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();
  const value = 'alpha\u2028beta\ngamma\u2029delta';

  const result = applyTextEditLineIndent(value, {
    start: 0,
    end: value.length,
    direction: 'forward',
  });

  assert.equal(result.value, '\talpha\u2028beta\n\tgamma\u2029delta');
  assert.equal(result.start, 1);
  assert.equal(result.end, value.length + 2);
});

test('enter inserts a line break with the current line indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = 'for each image\n    for each pixel';

  const result = applyTextEditLineBreakIndent(value, {
    start: value.length,
    end: value.length,
    direction: 'none',
  });

  assert.equal(result.value, 'for each image\n    for each pixel\n    ');
  assert.equal(result.start, result.value.length);
  assert.equal(result.end, result.value.length);
});

test('enter preserves mixed tab and space indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = '\t  save rgba';

  const result = applyTextEditLineBreakIndent(value, {
    start: value.length,
    end: value.length,
    direction: 'none',
  });

  assert.equal(result.value, '\t  save rgba\n\t  ');
});

test('enter replaces selected text using the first selected line indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = '    second line';

  const result = applyTextEditLineBreakIndent(value, {
    start: 4,
    end: value.length,
    direction: 'forward',
  });

  assert.equal(result.value, '    \n    ');
  assert.equal(result.start, result.value.length);
  assert.equal(result.end, result.value.length);
});
