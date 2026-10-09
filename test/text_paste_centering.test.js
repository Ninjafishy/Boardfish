'use strict';

const { readSource } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('../test-support/browser_vm.js');
const { createUnitTextContext } = require('../test-support/text_editor.js');
const { element, clipboardHtmlFixture, listNames, namesListFixture } = require('../test-support/clipboard.js');

const DEFAULT_TEXT_BOX_MIN_LINES = 1;
const DEFAULT_TEXT_BOX_LINE_H = 24;
const DEFAULT_TEXT_BOX_PAD = 16;
const DEFAULT_TEXT_BOX_HEIGHT = DEFAULT_TEXT_BOX_MIN_LINES * DEFAULT_TEXT_BOX_LINE_H + DEFAULT_TEXT_BOX_PAD * 2;

function loadAddTextHarness({ syncedHeight = null, realLimits = false } = {}) {
  const textLayoutSource = readSource('src/js/text_layout.js') + '\n';
  const source = readSource('src/js/object_commands.js');
  let idCounter = 1;
  const context = {
    performance,
    document: {
      createElement() { return { getContext: createUnitTextContext }; },
    },
    added: [],
    debugSteps: [],
    editCalls: [],
    editedIds: [],
    histories: [],
    messages: [],
    objects: [],
    selectedIds: [],
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
    ClipDebug: {
      step(_debug, step, meta) {
        context.debugSteps.push({ step, meta });
      },
    },
    newId() {
      return `obj-${idCounter++}`;
    },
    testSyncTextAutoHeight(obj, minLines = 1) {
      const contentLines = String(obj.data?.content || '').split('\n').length;
      obj.h = syncedHeight ?? Math.max(minLines, contentLines) * context.LINE_H + context.TEXT_PAD * 2;
      return true;
    },
    selectObject(id) {
      context.selectedIds.push(id);
    },
    pushHistory(reason) {
      context.histories.push(reason);
    },
    enterEdit(id, options = {}) {
      context.editCalls.push({ id, options });
      context.editedIds.push(id);
      if (options.history !== false) context.pushHistory('text-edit-enter');
    },
    textByteLengthCalls: 0,
  };
  if (realLimits) {
    const limitsContext = vm.createContext({
      objects: context.objects,
      TextEncoder,
      showIslandMsg(message, duration) { context.messages.push({ message, duration }); },
    });
    vm.runInContext(readSource('src/js/board_limits.js'), limitsContext);
    context.BoardfishWebLimits = limitsContext.BoardfishWebLimits;
  }
  vm.createContext(context);
  vm.runInContext(`${textLayoutSource}syncTextAutoHeight = testSyncTextAutoHeight;\n${source}\n`, context, {
    filename: 'object_commands.js',
  });
  return context;
}

function loadPasteHarness({ browserText = '', normalizeExternalText, clipboard = {}, htmlFixture } = {}) {
  const source = readSource('src/js/clipboard_export_init.js');
  const calls = { addText: [], images: [], readText: 0 };
  const context = {
    performance,
    console,
    Promise,
    calls,
    document: {
      addEventListener() {},
      createElement(tag) {
        return tag === 'template' && htmlFixture ? htmlFixture.createTemplate() : { getContext: createUnitTextContext };
      },
      visibilityState: 'visible',
    },
    navigator: {
      clipboard: {
        readText() {
          calls.readText++;
          return Promise.resolve(browserText);
        },
        ...clipboard,
      },
    },
    objects: [],
    jsClipboard: null,
    _pasteInProgress: false,
    ClipDebug: {
      end() {},
      start() { return null; },
      step() {},
    },
    acquireInputShield() {
      return () => {};
    },
    addText(wx, wy, content, options = {}) {
      calls.addText.push({ wx, wy, content, options });
    },
    imageFileDebugName: () => 'clipboard-image',
    async insertImageFiles(files, wx, wy) {
      calls.images.push({ files, wx, wy });
    },
  };
  vm.createContext(context);
  vm.runInContext(readSource('src/js/clipboard_io.js'), context);
  if (normalizeExternalText) context.textForExternalTextObjectPaste = normalizeExternalText;
  else vm.runInContext(readSource('src/js/text_layout.js'), context);
  vm.runInContext(source, context, {
    filename: 'clipboard_export_init.js',
  });
  return context;
}

test('addText can center a text box after auto-height is synced', () => {
  const context = loadAddTextHarness({ syncedHeight: 184 });
  const content = [
    'The Alienware 16X Aurora has been updated this year with new configurations.',
    'The upgrades come at a hefty cost.',
  ].join('\n');

  context.addText(640, 360, content, { anchor: 'center' });

  const obj = context.added[0];
  assert.equal(obj.x + obj.w / 2, 640);
  assert.equal(obj.y + obj.h / 2, 360);
  assert.equal(obj.h, 184);
  assert.deepEqual(context.histories, ['add-text']);
  assert.deepEqual(context.editedIds, []);
  assert.equal(context.textByteLengthCalls, 1);
});

test('addText keeps top-left placement by default', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48);

  const obj = context.added[0];
  assert.equal(obj.x, 24);
  assert.equal(obj.y, 48);
  assert.equal(obj.h, DEFAULT_TEXT_BOX_HEIGHT);
  assert.equal(obj.w, DEFAULT_TEXT_BOX_HEIGHT * 6);
  assert.deepEqual(context.editedIds, [obj.id]);
  assert.deepEqual(context.histories, ['text-edit-enter']);
});

test('addText retains full text diagnostics for an active debug capture', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, 'first\nsecond', { debug: {} });

  assert.equal(context.textByteLengthCalls, 5);
  assert.equal(context.debugSteps[0].step, 'addText:start');
  assert.equal(context.debugSteps[0].meta.textLineCount, 2);
});

test('addText strips whitespace-only lines at pasted text edges', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  \n\t\nfirst line  \nsecond line\n   \n\t');

  const obj = context.added[0];
  assert.equal(obj.data.content, 'first line  \nsecond line');
  assert.deepEqual(context.editedIds, []);
});

test('addText preserves content that the external-paste path already prepared', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  prepared  ', { contentPrepared: true });

  assert.equal(context.added[0].data.content, '  prepared  ');
});

test('addText with pasted content stays in select mode by default', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, 'pasted text');

  assert.deepEqual(context.editCalls, []);
});

test('addText rejects the entire paste using the existing board error notification', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24998) } });

  context.addText(24, 48, 'x \t');

  assert.equal(context.objects.length, 1);
  assert.equal(context.zCounter, 1);
  assert.deepEqual(context.added, []);
  assert.deepEqual(context.editCalls, []);
  assert.deepEqual(context.histories, []);
  assert.deepEqual(context.selectedIds, []);
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0].message, /25,000/);
  assert.equal(context.messages[0].duration, 4500);
});

test('addText accepts the exact character limit after paste normalization', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });

  context.addText(24, 48, '\r\n\t\r\nx \t😀\r\n\t');

  assert.equal(context.added[0].data.content, 'x \t😀');
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
  assert.deepEqual(context.messages, []);
});

test('addText counts prepared external paste content without changing it', () => {
  const context = loadAddTextHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });

  context.addText(24, 48, ' \t😀x', { contentPrepared: true });

  assert.equal(context.added[0].data.content, ' \t😀x');
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
  assert.deepEqual(context.messages, []);
});

test('outside clipboard text is pasted at the same center point as canvas objects', async () => {
  const context = loadPasteHarness();

  await context.pasteAtPos(640, 360, {
    getData(type) {
      return type === 'text/plain' ? 'outside text' : '';
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.addText)), [{
    wx: 640,
    wy: 360,
    content: 'outside text',
    options: { anchor: 'center', contentPrepared: true },
  }]);
});

test('browser clipboard text paste stays in select mode for the new text box', async () => {
  const context = loadPasteHarness({
    browserText: 'browser\ntext',
    normalizeExternalText(value) {
      return value.replace('\n', ' ');
    },
  });

  await context.pasteAtPos(640, 360, {
    getData() {
      return '';
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.addText)), [{
    wx: 640,
    wy: 360,
    content: 'browser text',
    options: { anchor: 'center', contentPrepared: true },
  }]);
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

function clipboardItem(parts) {
  return {
    types: Object.keys(parts),
    async getType(type) {
      const part = parts[type];
      if (part instanceof Error) throw part;
      return part;
    },
  };
}

for (const viaMenu of [false, true]) {
  test(`${viaMenu ? 'menu' : 'keyboard'} canvas paste removes copied list margins`, async () => {
    const fixture = namesListFixture();
    const text = listNames.join('\n\n\n\n');
    const context = loadPasteHarness({
      htmlFixture: fixture,
      clipboard: { async read() { return [fixture.clipboardItem(text)]; } },
    });
    await context.pasteAtPos(640, 360, viaMenu ? null : fixture.clipboardData(text));
    assert.equal(context.calls.addText[0].content, listNames.join('\n'));
    assert.equal(context.calls.addText[0].options.anchor, 'center');
  });

  test(`${viaMenu ? 'menu' : 'keyboard'} canvas paste keeps long list items on separate lines`, async () => {
    const lines = [
      'first item has enough words to resemble a line of fixed-width prose copied elsewhere',
      'second item also contains many words but must remain a separate entry in this list',
      'third item should still be a separate line',
    ];
    const fixture = clipboardHtmlFixture(element('ul', ...lines.map((line) => element('li', element('p', line)))));
    const text = lines.join('\n\n');
    const context = loadPasteHarness({
      htmlFixture: fixture,
      clipboard: { async read() { return [fixture.clipboardItem(text)]; } },
    });
    await context.pasteAtPos(640, 360, viaMenu ? null : fixture.clipboardData(text));
    assert.equal(context.calls.addText[0].content, lines.join('\n'));
  });
}

for (const fixture of [
  {
    name: 'formatted rich text',
    text: 'A formatted heading\r\nThe editable body.',
    html: '<h1>A formatted heading</h1><p>The <b>editable</b> body.</p>',
    imageType: 'image/jpeg',
  },
  {
    name: 'Excel cells',
    text: 'Item\tQuantity\tPrice\r\nApples\t2\t$3.00\r\nPears\t\t$4.00\r\n',
    html: '<table><tr><td>Item</td><td>Quantity</td><td>Price</td></tr></table>',
    imageType: 'image/png',
  },
]) {
  test(`keyboard paste of ${fixture.name} prefers editable text over its preview image`, async () => {
    const context = loadPasteHarness({
      clipboard: { async read() { throw new Error('Event paste must not read the browser clipboard'); } },
    });
    const preview = new Blob(['preview'], { type: fixture.imageType });
    const representations = { 'text/plain': fixture.text, 'text/html': fixture.html, 'text/rtf': '{\\rtf1 formatted}' };

    await context.pasteAtPos(640, 360, {
      items: [{ kind: 'file', type: preview.type, getAsFile: () => preview }],
      files: [preview],
      getData: (type) => representations[type] || '',
    });

    assert.deepEqual(context.calls.images, []);
    assert.equal(context.calls.addText.length, 1);
    assert.equal(context.calls.addText[0].content, fixture.text.replace(/\r\n/g, '\n').replace(/\n$/, ''));
    assert.equal(context.calls.addText[0].options.anchor, 'center');
    assert.equal(context.calls.readText, 0);
    assert.equal(context._pasteInProgress, false);
  });
}

test('Paste menu uses plain text from clipboard items before decoding a preview image', async () => {
  const text = 'Name\tValue\r\nBudget\t125';
  const item = clipboardItem({
    'image/png': new Error('Preview image must not be decoded'),
    'text/html': new Blob(['<table><tr><td>Name</td><td>Value</td></tr></table>'], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  });
  const context = loadPasteHarness({
    clipboard: {
      async read() { return [item]; },
      async readText() { throw new Error('Use the already-read clipboard item'); },
    },
  });

  await context.pasteAtPos(640, 360);

  assert.deepEqual(context.calls.images, []);
  assert.equal(context.calls.addText.length, 1);
  assert.equal(context.calls.addText[0].content, 'Name\tValue\nBudget\t125');
  assert.equal(context._pasteInProgress, false);
});

test('Paste menu finds text even when an image is in an earlier clipboard item', async () => {
  const context = loadPasteHarness({
    clipboard: {
      async read() {
        return [
          clipboardItem({ 'image/png': new Error('Preview image must not be decoded') }),
          clipboardItem({ 'text/plain': new Blob(['Editable text'], { type: 'text/plain' }) }),
        ];
      },
    },
  });

  await context.pasteAtPos(640, 360);

  assert.deepEqual(context.calls.images, []);
  assert.equal(context.calls.addText[0]?.content, 'Editable text');
  assert.equal(context.calls.readText, 0);
});

test('Paste menu prefers readText fallback over a preview image', async () => {
  const context = loadPasteHarness({
    browserText: 'Editable fallback',
    clipboard: {
      async read() { return [clipboardItem({ 'image/png': new Error('Preview image must not be decoded') })]; },
    },
  });

  await context.pasteAtPos(640, 360);

  assert.deepEqual(context.calls.images, []);
  assert.equal(context.calls.addText[0]?.content, 'Editable fallback');
});

test('Paste menu can read text when reading rich clipboard items fails', async () => {
  const context = loadPasteHarness({
    browserText: 'Editable fallback',
    clipboard: { async read() { throw new Error('Rich clipboard unavailable'); } },
  });

  await context.pasteAtPos(640, 360);

  assert.equal(context.calls.addText[0]?.content, 'Editable fallback');
  assert.equal(context._pasteInProgress, false);
});

for (const imageType of ['image/png', 'image/jpeg']) {
  test(`keyboard paste keeps an image-only ${imageType} clipboard as an image`, async () => {
    const context = loadPasteHarness();
    const image = new Blob(['image'], { type: imageType });

    await context.pasteAtPos(640, 360, {
      files: [image],
      getData: () => '',
    });

    assert.deepEqual(context.calls.addText, []);
    assert.equal(context.calls.images[0]?.files[0], image);
    assert.equal(context.calls.readText, 0);
  });
}

for (const textState of ['empty', 'whitespace', 'unavailable', 'rejected']) {
  test(`Paste menu keeps image paste working when text is ${textState}`, async () => {
    const image = new Blob(['image'], { type: 'image/png' });
    const text = textState === 'whitespace' ? ' \t\r\n' : '';
    const context = loadPasteHarness({
      clipboard: {
        async read() {
          return [clipboardItem({
            'image/png': image,
            'text/plain': textState === 'rejected'
              ? new Error('Text representation unavailable')
              : new Blob([text], { type: 'text/plain' }),
          })];
        },
        readText: textState === 'unavailable' ? undefined : async () => {
          if (textState === 'rejected') throw new Error('Clipboard text unavailable');
          return text;
        },
      },
    });

    await context.pasteAtPos(640, 360);

    assert.deepEqual(context.calls.addText, []);
    assert.equal(context.calls.images[0]?.files[0], image);
    assert.equal(context._pasteInProgress, false);
  });
}
