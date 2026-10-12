'use strict';

const { readSource, runScript, loadBoardLimits, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadReadableImageSourceBlob, pngBytes } = require('../test-support/image_output.js');
const WebContainer = require('../src/js/web_board_container.js');

function trimClipboardFixture(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !/\S/.test(lines[first])) first++;
  while (last >= first && !/\S/.test(lines[last])) last--;
  return first <= last ? lines.slice(first, last + 1).join('\n') : '';
}

function loadClipboardStateHarness() {
  const source = readSource('src/js/clipboard_state.js');
  let tokenId = 0;
  const context = {
    Date,
    crypto: {
      randomUUID() {
        tokenId++;
        return `test-token-${tokenId}`;
      },
    },
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    window: {
      addEventListener() {},
    },
  };
  runScript(
    source +
      'globalThis.markJsClipboardMaybeStaleFromWebBlur = markJsClipboardMaybeStaleFromWebBlur;\n' +
      'globalThis.forceJsClipboardSetAt = (value) => { _jsClipboardSetAt = value; };\n',
    context,
    { filename: 'clipboard_state.js' },
  );
  return context;
}

function loadClipboardExportHarness(options = {}) {
  const source = readSource('src/js/clipboard_export_init.js');
  const textObject = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 80,
    z: 1,
    data: { content: 'first line\nsecond line' },
  };
  const selectedObject = options.selectedObject || textObject;
  const calls = {
    canvasToPngBlob: 0,
    copiedImages: [],
    copiedTexts: [],

    insertedImages: [],
    pendingImageCopyResolves: [],
    pendingPngBlobResolves: [],
    renderImageToCanvas: 0,
    resolveNextCopiedImage(result = { boardfishTokenWritten: true }) {
      const pending = calls.pendingImageCopyResolves.shift();
      if (!pending) throw new Error('No pending image copy to resolve');
      pending.resolve(result);
    },
    resolveNextPngBlob(blob = options.renderedBlob || null) {
      const pending = calls.pendingPngBlobResolves.shift();
      if (!pending) throw new Error('No pending PNG blob to resolve');
      pending.resolve(blob);
    },
  };
  const context = {
    Blob,
    Promise,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    editingId: null,
    objects: [],
    selectedIds: new Set([selectedObject.id]),
    objectsMap: new Map([[selectedObject.id, selectedObject]]),
    textObject,
    calls,
    BoardfishClipboardIO: {
      copyBoardfishTokenToClipboard() {
        return Promise.resolve({ boardfishTokenWritten: true });
      },
      copyImageBlobToClipboard(blobOrPromise, token) {
        calls.copiedImages.push({ blob: blobOrPromise, token });
        const blobPromise = Promise.resolve(blobOrPromise);
        const writePromise = options.deferCopyImage
          ? new Promise((resolve, reject) => calls.pendingImageCopyResolves.push({ resolve, reject }))
          : Promise.resolve({ boardfishTokenWritten: true });
        return Promise.all([blobPromise, writePromise]).then(([, result]) => result);
      },
      copyTextToClipboard(text) {
        calls.copiedTexts.push(text);
        return Promise.resolve({ boardfishTokenWritten: true });
      },
    },
    BoardfishImageStore: {
      getSource() { return options.imageSource || ''; },
    },
    BoardfishMotion: {
      applyCopyFeedback() {},
    },

    cloneObject(obj) {
      return { ...obj, data: { ...obj.data } };
    },
    getFirstSelectedObject() {
      return selectedObject;
    },
    hasSelection() {
      return context.selectedIds.size > 0;
    },
    getJsClipboardWebToken() {
      return 'web-token';
    },
    markJsClipboardWebTokenWritten() {},
    imageNeedsRendering: options.imageNeedsRendering || (() => false),

    async insertImageFiles(files, x, y, source) { calls.insertedImages.push({ files, x, y, source }); context.objects.push({}); },
    isWebImageRef: options.isWebImageRef || (() => false),
    readableImageSourceBlob: options.readableImageSourceBlob || loadReadableImageSourceBlob({
      container: { ...WebContainer, ...options.BoardfishWebBoardContainer },
    }),
    renderImageToCanvas() {
      calls.renderImageToCanvas++;
      return options.renderedCanvas || null;
    },
    async renderStoredImageToCanvas() { return options.storedCanvas || null; },
    canvasToPngBlob() {
      calls.canvasToPngBlob++;
      if (options.deferCanvasToPngBlob) {
        return new Promise((resolve, reject) => calls.pendingPngBlobResolves.push({ resolve, reject }));
      }
      return Promise.resolve(options.renderedBlob || null);
    },
    textForClipboard: trimClipboardFixture,
    scheduleRender() {},
    setJsClipboard() { return 'clip-token'; },
  };
  runScript(`${source}\nglobalThis.copySelected = copySelected;\n`, context, {
    filename: 'clipboard_export_init.js',
  });
  return context;
}

function loadClipboardPasteObjectsHarness({ realLimits = false } = {}) {
  const source = readSource('src/js/clipboard_export_init.js');
  const sourceTextObject = {
    id: 'text-source',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 128,
    z: 1,
    data: { content: '   \n\t\nfirst line\nsecond line\n   \n\t' },
  };
  const calls = {
    added: [],
    histories: [],
    clones: 0,
    synced: [],
    textBytes: [],
  };
  const context = {
    Promise,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    calls,
    objects: [],
    jsClipboard: {
      type: 'objects',
      objects: [sourceTextObject],
    },
    _jsClipboardWebMaybeStale: false,
    _pasteInProgress: false,
    clearTextObjectLayoutRuntime() {},
    zCounter: 1,
    BoardfishClipboardIO: {
      readBoardfishClipboardTokenFromEvent() { return ''; },
      readBoardfishClipboardTokenFromBrowser() { calls.histories.push('browser-token-read'); return Promise.resolve({ checked: true, token: '' }); },
    },
    BoardfishEditorState: {
      addObject(obj) {
        context.objects.push(obj);
        calls.added.push(obj);
      },
      setSelection() {},
    },
    BoardfishMotion: {
      applyCopyFeedback() {},
    },
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      canAcceptAdditionalTextCharacters() { return true; },
      textCharacterCount(text) { return Array.from(String(text ?? '')).length; },
      textByteLength(text) {
        calls.textBytes.push(String(text ?? ''));
        return String(text ?? '').length;
      },
    },

    cloneObjects(list) {
      calls.clones++;
      return plain(list);
    },
    jsClipboardStillCurrent() {
      return Promise.resolve(true);
    },
    newId() {
      return 'text-pasted';
    },
    scheduleRender() {},
    pushHistory(reason) {
      calls.histories.push(reason);
    },
    syncTextAutoHeight(obj) {
      calls.synced.push(obj.id);
      obj.h = 56;
      return true;
    },
    textForTextObjectPaste: trimClipboardFixture,
  };
  if (realLimits) context.BoardfishWebLimits = loadBoardLimits(context.objects);
  runScript(source, context, {
    filename: 'clipboard_export_init.js',
  });
  return { context, sourceTextObject };
}

test('web js clipboard stays current only while its browser clipboard marker matches', async () => {
  const context = loadClipboardStateHarness();

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }] });
  const token = context.getJsClipboardWebToken();
  context.markJsClipboardWebTokenWritten(token);

  assert.equal(await context.jsClipboardStillCurrent({
    webClipboardTokenChecked: true,
    webClipboardToken: token,
  }), true);

  assert.equal(await context.jsClipboardStillCurrent({
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('web js clipboard without a browser marker is invalidated after leaving the page', async () => {
  const context = loadClipboardStateHarness();

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }] });
  context.forceJsClipboardSetAt(Date.now() - 1000);
  context.markJsClipboardMaybeStaleFromWebBlur();

  assert.equal(await context.jsClipboardStillCurrent({
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('clipboard image base64 fallback preserves bytes across chunk boundaries', async () => {
  let writtenParts;
  const context = vm.createContext({
    Blob,
    btoa,
    Buffer: undefined,
    FileReader: undefined,
    ClipboardItem: class {
      constructor(parts) { this.parts = parts; }
    },
    navigator: {
      clipboard: {
        async write(items) { writtenParts = items[0].parts; },
      },
    },
  });
  vm.runInContext(readSource('src/js/clipboard_io.js'), context);

  for (const length of [32766, 32767, 32768, 32769, 65536]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    await context.BoardfishClipboardIO.copyImageBlobToClipboard(
      new Blob([bytes], { type: 'image/png' }), 'bf-image',
    );
    const html = await (await writtenParts['text/html']).text();
    const base64 = /src="data:image\/png;base64,([^"]+)"/.exec(html)?.[1];
    assert.ok(base64);
    assert.ok(Buffer.from(base64, 'base64').equals(Buffer.from(bytes)), `${length} bytes round-trip`);
  }
});

test('clipboard IO preserves rich representations and supports direct-only clipboard items', async () => {
  const previous = {
    BoardfishWebLimits: globalThis.BoardfishWebLimits,
    ClipboardItem: globalThis.ClipboardItem,

    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  const writes = [];
  class FakeClipboardItem {
    constructor(parts) {
      this.parts = parts;
    }
  }

  try {
    globalThis.BoardfishWebLimits = { textByteLength: (text) => Buffer.byteLength(String(text)) };
    globalThis.ClipboardItem = FakeClipboardItem;

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          async write(items) {
            writes.push(items[0]);
            await Promise.all(Object.values(items[0].parts).map((part) => Promise.resolve(part)));
          },
        },
      },
    });

    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    const ClipboardIO = require('../src/js/clipboard_io.js');

    const token = ClipboardIO.readBoardfishClipboardTokenFromEvent({
      getData(type) {
        return type === 'text/html' ? '<p>x</p><!--boardfish-clipboard:bf-test.1-->' : '';
      },
    });
    assert.equal(token, 'bf-test.1');

    const result = await ClipboardIO.copyBoardfishTokenToClipboard('bf-written');
    assert.equal(result.boardfishTokenWritten, true);
    assert.equal(writes.length, 1);
    assert.equal(await writes[0].parts['text/plain'].text(), '');
    assert.match(await writes[0].parts['text/html'].text(), /boardfish-clipboard:bf-written/);

    let resolveImageBlob;
    const pendingImageBlob = new Promise((resolve) => { resolveImageBlob = resolve; });
    let imageCopySettled = false;
    const imageCopyPromise = ClipboardIO.copyImageBlobToClipboard(pendingImageBlob, 'bf-image')
      .then((result) => {
        imageCopySettled = true;
        return result;
      });

    // The browser write must begin in the copy event, before PNG encoding or
    // the HTML data URL representation has finished.
    assert.equal(writes.length, 2);
    assert.equal(typeof writes[1].parts['image/png']?.then, 'function');
    assert.equal(typeof writes[1].parts['text/html']?.then, 'function');
    await Promise.resolve();
    assert.equal(imageCopySettled, false);

    resolveImageBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    const imageResult = await imageCopyPromise;
    assert.equal(imageResult.boardfishTokenWritten, true);
    const imageBlob = await writes[1].parts['image/png'];
    assert.equal(imageBlob.type, 'image/png');
    const imageHtmlBlob = await writes[1].parts['text/html'];
    const imageHtml = await imageHtmlBlob.text();
    assert.match(imageHtml, /boardfish-clipboard:bf-image/);
    assert.match(imageHtml, /<img src="data:image\/png;base64,AQID" alt="">/);

    const textResult = await ClipboardIO.copyTextToClipboard(
      'A&<\r\nB\rC\nD', { boardfishToken: 'bf-rich-text' },
    );
    assert.equal(textResult.boardfishTokenWritten, true);
    assert.equal(writes.length, 3);
    assert.equal(await writes[2].parts['text/plain'].text(), 'A&<\r\nB\rC\nD');
    assert.equal(
      await writes[2].parts['text/html'].text(),
      '<!--boardfish-clipboard:bf-rich-text--><div>A&amp;&lt;<br>B<br>C<br>D</div>',
    );
  } finally {
    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    if (previous.BoardfishWebLimits === undefined) delete globalThis.BoardfishWebLimits;
    else globalThis.BoardfishWebLimits = previous.BoardfishWebLimits;
    if (previous.ClipboardItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previous.ClipboardItem;

    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
  }
});

test('copying an untransformed web PNG image writes source bytes without rendering', async () => {
  const imageSource = {
    web: true,
    mime: 'image/png',
    bytes: pngBytes.length,
  };
  const imageObject = {
    id: 'image-1',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-1' },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageSource,
    BoardfishWebBoardContainer: {
      blobForImageSource(source) {
        assert.equal(source, imageSource);
        return new Blob([pngBytes], { type: 'image/png' });
      },
      bytesForImageSource() {
        throw new Error('Blob-backed source should not be materialized before clipboard write');
      },
    },
    imageNeedsRendering: () => false,
    isWebImageRef: (source) => source?.web === true,
    deferCopyImage: true,
  });

  const copyPromise = context.copySelected();

  assert.equal(context.calls.renderImageToCanvas, 0);
  assert.equal(context.calls.canvasToPngBlob, 0);
  assert.equal(context.calls.copiedImages.length, 1);
  assert.equal(context.calls.copiedImages[0].token, 'web-token');
  const copiedBlob = await context.calls.copiedImages[0].blob;
  assert.equal(copiedBlob.type, 'image/png');
  assert.equal(copiedBlob.size, pngBytes.length);
  assert.deepEqual(
    new Uint8Array(await copiedBlob.arrayBuffer()),
    new Uint8Array(pngBytes),
  );

  context.calls.resolveNextCopiedImage();
  assert.equal(await copyPromise, true);
});

test('copying a transformed image starts the clipboard write before PNG encoding finishes', async () => {
  const renderedBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const imageObject = {
    id: 'image-transformed',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-transformed', rotation: 90 },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageNeedsRendering: () => true,
    renderedCanvas: {},
    renderedBlob,
    deferCanvasToPngBlob: true,
    deferCopyImage: true,
  });

  let copySettled = false;
  const copyPromise = context.copySelected().then((result) => {
    copySettled = true;
    return result;
  });

  assert.equal(context.calls.renderImageToCanvas, 1);
  assert.equal(context.calls.canvasToPngBlob, 1);
  assert.equal(context.calls.copiedImages.length, 1);
  assert.equal(context.calls.copiedImages[0].token, 'web-token');
  assert.equal(typeof context.calls.copiedImages[0].blob?.then, 'function');
  assert.equal(copySettled, false);

  context.calls.resolveNextPngBlob();
  assert.equal(await context.calls.copiedImages[0].blob, renderedBlob);
  assert.equal(copySettled, false);

  context.calls.resolveNextCopiedImage();
  assert.equal(await copyPromise, true);
});

test('copy recovers unreadable and mislabeled images before clipboard consumption', async (t) => {
  const unreadable = new Blob([pngBytes], { type: 'image/png' });
  Object.defineProperty(unreadable, 'stream', { value() { throw new Error('file changed on disk'); } });
  const sources = [
    WebContainer.createWebImageRef({ mime: 'image/png', blob: unreadable }),
    WebContainer.createWebImageRef({ mime: 'image/png', blob: new Blob(['not a PNG'], { type: 'image/png' }) }),
    'data:image/png;base64,invalid%%%data',
  ];
  for (const [index, imageSource] of sources.entries()) {
    await t.test(`source ${index + 1}`, async () => {
      const renderedBlob = new Blob([pngBytes], { type: 'image/png' });
      const imageObject = { id: 'image-1', type: 'image', data: { imgKey: 'img-shared', rotation: 0, flipX: false } };
      const context = loadClipboardExportHarness({
        selectedObject: imageObject,
        imageSource,
        BoardfishWebBoardContainer: WebContainer,
        isWebImageRef: WebContainer.isWebImageRef,
        renderedCanvas: { width: 192, height: 192 },
        renderedBlob,
        deferCopyImage: true,
      });

      const copied = context.copySelected();
      assert.equal(context.calls.copiedImages.length, 1, 'write starts inside the copy gesture');
      assert.equal(await context.calls.copiedImages[0].blob, renderedBlob);
      assert.equal(context.calls.renderImageToCanvas, 1);
      context.calls.resolveNextCopiedImage();
      assert.equal(await copied, true);
      assert.deepEqual(imageObject.data, { imgKey: 'img-shared', rotation: 0, flipX: false });
    });
  }
});

test('pasting an image retains typed Blobs and only adds a MIME view when missing', async () => {
  const context = loadClipboardExportHarness();
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const typed = new Blob([bytes], { type: 'image/png' });
  Object.defineProperty(typed, 'arrayBuffer', { value() { throw new Error('paste should not materialize Blob bytes'); } });
  await context.pasteWebImageBlob(typed, 10, 20);
  assert.equal(context.calls.insertedImages[0].files[0], typed);
  const untyped = new Blob([bytes]);
  await context.pasteWebImageBlob(untyped, 30, 40);
  const typedView = context.calls.insertedImages[1].files[0];
  assert.deepEqual({ type: typedView.type, size: typedView.size }, { type: 'image/png', size: untyped.size });
  assert.deepEqual(new Uint8Array(await typedView.arrayBuffer()), bytes);
});

test('copying a text object omits whitespace-only lines at plain clipboard edges', async () => {
  const context = loadClipboardExportHarness();
  context.textObject.data.content = '   \n\t\n  first line  \n second line\t \n   \n\t';

  await context.copySelected();

  assert.deepEqual(context.calls.copiedTexts, ['  first line  \n second line\t ']);
});

test('pasting Boardfish text objects strips whitespace-only edge lines from the pasted clone', async () => {
  const { context, sourceTextObject } = loadClipboardPasteObjectsHarness();

  await context.pasteAtPos(300, 200);

  assert.equal(context.calls.added.length, 1);
  assert.equal(context.calls.added[0].data.content, 'first line\nsecond line');
  assert.deepEqual(context.calls.textBytes, ['first line\nsecond line']);
  assert.equal(sourceTextObject.data.content, '   \n\t\nfirst line\nsecond line\n   \n\t');
  assert.deepEqual(context.calls.histories, ['paste-objects']);
});

test('object-limit rejection happens before pasted text trimming and measurement', async () => {
  const { context } = loadClipboardPasteObjectsHarness();
  context.BoardfishWebLimits.canAddObjects = () => false;
  context._jsClipboardWebMaybeStale = true;
  await context.pasteAtPos(300, 200);
  assert.equal(context.calls.clones, 0);
  assert.deepEqual([context.calls.synced, context.calls.textBytes, context.calls.added, context.calls.histories], [[], [], [], ['browser-token-read']]);
});

test('mixed object paste rejects the whole clipboard before cloning when combined text exceeds 25,000', async () => {
  const { context, sourceTextObject } = loadClipboardPasteObjectsHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });
  sourceTextObject.data.content = 'ab';
  context.jsClipboard.objects.push(
    { ...sourceTextObject, id: 'second-text', data: { content: ' \t😀x' } },
    { id: 'image-source', type: 'image', x: 0, y: 0, w: 10, h: 10, data: { imgKey: 'image' } },
  );

  await context.pasteAtPos(300, 200);

  assert.equal(context.objects.length, 1);
  assert.equal(context.calls.clones, 0);
  assert.equal(context.zCounter, 1);
  assert.equal(context._pasteInProgress, false);
  assert.deepEqual(context.calls.added, []);
  assert.deepEqual(context.calls.histories, []);
  assert.deepEqual(context.calls.synced, []);
});

test('object paste counts normalized content and accepts exactly 25,000 characters', async () => {
  const { context, sourceTextObject } = loadClipboardPasteObjectsHarness({ realLimits: true });
  context.objects.push({ id: 'existing', type: 'text', data: { content: 'x'.repeat(24996) } });
  sourceTextObject.data.content = '\r\n  \r\n \t😀x\r\n\t';

  await context.pasteAtPos(300, 200);

  assert.equal(context.calls.added.length, 1);
  assert.equal(context.calls.added[0].data.content, ' \t😀x');
  assert.equal(context.BoardfishWebLimits.currentTextCharacters(), 25000);
  assert.equal(sourceTextObject.data.content, '\r\n  \r\n \t😀x\r\n\t');
  assert.deepEqual(context.calls.histories, ['paste-objects']);
});
