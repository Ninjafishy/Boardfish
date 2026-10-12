'use strict';

const { readSource, runScript, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createUnitTextContext } = require('../test-support/text_editor.js');

function loadTextLayout() {
  const context = {
    document: {
      createElement() {
        const canvasContext = createUnitTextContext();
        return { getContext: () => canvasContext };
      },
    },
    objects: [],
    editingId: null,

    scheduleRender() {},
  };
  runScript(
    readSource('src/js/text_layout.js'),
    context,
    { filename: 'text_layout.js' },
  );
  vm.runInContext(
    `globalThis.__testTextLayout = {
      getPrefixWidths,
      getTextLayout,
      layoutHitTestCaret,
      lineXAtOffset,
      get textPad() { return TEXT_PAD; },
    };`,
    context,
    { filename: 'text_tab_layout_test_hook.js' },
  );
  return context.__testTextLayout;
}

test('text tab measurement advances to the next eight-space tab stop', () => {
  const textLayout = loadTextLayout();

  assert.deepEqual(Array.from(textLayout.getPrefixWidths('\tX')), [0, 8, 9]);
  assert.deepEqual(Array.from(textLayout.getPrefixWidths('a\tX')), [0, 1, 8, 9]);
  assert.deepEqual(Array.from(textLayout.getPrefixWidths('abcdefgh\tX')), [0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 17]);
});

test('text caret hit at wrapped line start records the visual line', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 3 + textLayout.textPad * 2,
    h: 48,
    data: { content: 'abcdef' },
  };
  const layout = textLayout.getTextLayout(obj);
  const [firstLine, secondLine] = layout;

  assert.equal(firstLine.text, 'abc');
  assert.equal(secondLine.text, 'def');

  const secondLineHit = textLayout.layoutHitTestCaret(
    layout,
    textLayout.lineXAtOffset(secondLine, obj, 0),
    secondLine.y,
    obj,
  );
  const firstLineEndHit = textLayout.layoutHitTestCaret(
    layout,
    textLayout.lineXAtOffset(firstLine, obj, firstLine.text.length),
    firstLine.y,
    obj,
  );

  assert.deepEqual(plain(secondLineHit), { index: 3, lineStartIndex: 3 });
  assert.deepEqual(plain(firstLineEndHit), { index: 3, lineStartIndex: 0 });
});
