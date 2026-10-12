'use strict';

const { readSource, runScript } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const WebContainer = require('../src/js/web_board_container.js');

function loadWebImageSourceHarness({ boardContainer = null } = {}) {
  const source = readSource('src/js/image_insert.js');
  const start = source.indexOf('const createWebImageSourceFromBlob =');
  const end = source.indexOf('\nconst rollbackImageInsertSource =', start);
  assert.ok(start >= 0 && end > start, 'web image source helpers are missing');
  const calls = [];
  const context = {
    BoardfishWebBoardContainer: boardContainer || {
      snapshotImageBlob: WebContainer.snapshotImageBlob,
      createWebImageRef(options) {
        calls.push(options);
        return { web: true, ...options };
      },
    },
  };
  runScript(
    `${source.slice(start, end)}\n` +
      'globalThis.createWebImageSourceFromBlob = createWebImageSourceFromBlob;\n',
    context,
    { filename: 'image_insert.js' },
  );
  context.calls = calls;
  return context;
}

function loadEditorStateBoundaryHarness() {
  const source = readSource('src/js/editor_state_boundary.js');
  const obj1 = { id: 'obj-1', type: 'image', z: 1 };
  const obj2 = { id: 'obj-2', type: 'rect', z: 2 };
  const textLayoutCacheClears = [];
  const context = {
    editingId: null,
    idCounter: 1,
    zCounter: 3,
    objects: [obj1, obj2],
    objectsMap: new Map([[obj1.id, obj1], [obj2.id, obj2]]),
    selectedId: 'obj-1',
    selectedIds: new Set(['obj-1']),
    textLayoutCacheClears,
    clearTextLayoutCaches(options = {}) {
      textLayoutCacheClears.push({ ...options });
    },
    exitEdit() {
      context.editingId = null;
    },
  };
  runScript(source, context, { filename: 'editor_state_boundary.js' });
  return context;
}

test('inserted image Blob is snapshotted without changing its bytes', async () => {
  const context = loadWebImageSourceHarness();
  const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
  const blob = new Blob([bytes], { type: 'image/jpeg' });

  const source = await context.createWebImageSourceFromBlob(blob, 'img-7');
  const options = context.calls[0];

  assert.equal(source.web, true);
  assert.equal(options.path, 'images/img-7.jpg');
  assert.equal(options.mime, 'image/jpeg');
  assert.equal(options.ext, 'jpg');
  assert.equal(options.bytes, undefined);
  assert.notEqual(options.blob, blob);
  assert.equal(options.blob.type, 'image/jpeg');
  assert.deepEqual(
    new Uint8Array(await options.blob.slice().arrayBuffer()),
    new Uint8Array([0, 1, 127, 128, 254, 255]),
  );
});

test('inserted File bytes detach from their potentially volatile source', async () => {
  const context = loadWebImageSourceHarness();
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const file = new File([bytes], 'source.png', { type: 'image/png' });
  await context.createWebImageSourceFromBlob(file, 'img-file');
  const stored = context.calls[0].blob;

  assert.notEqual(stored, file);
  assert.equal(stored.type, 'image/png');
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
});

test('inserted images survive the backing Blob becoming unreadable', async () => {
  const context = loadWebImageSourceHarness({ boardContainer: WebContainer });
  const bytes = new Uint8Array([0, 128, 255, 13, 10]);
  let readable = true;
  const externalBlob = {
    type: 'image/png',
    size: bytes.length,
    slice() { return this; },
    async arrayBuffer() {
      if (!readable) throw new Error('file snapshot is no longer readable');
      return bytes.slice().buffer;
    },
  };
  const source = await context.createWebImageSourceFromBlob(externalBlob, 'img-external');
  readable = false;

  assert.deepEqual(await WebContainer.bytesForImageSourceAsync(source), bytes);
  assert.equal(source.__blobVolatile, false);
});

test('image insertion rejects a short read before storing a source', async () => {
  const context = loadWebImageSourceHarness();
  await assert.rejects(context.createWebImageSourceFromBlob({
    type: 'image/png',
    size: 8,
    async arrayBuffer() { return new Uint8Array([1, 2]).buffer; },
  }, 'img-short'), /Image Read Failed/);
  assert.equal(context.calls.length, 0);
});

test('inserted immutable Blob sources reuse CRC without changing saved bytes', async () => {
  const context = loadWebImageSourceHarness({ boardContainer: WebContainer });
  const bytes = new Uint8Array([0, 17, 34, 51, 68, 85, 255]);
  const blob = new Blob([bytes], { type: 'image/png' });
  const source = await context.createWebImageSourceFromBlob(blob, 'img-9');
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {
      'img-9': { path: 'images/img-9.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-9', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-9' } },
    ],
  };

  assert.equal(source.__blob instanceof Blob, true);
  assert.notEqual(source.__blob, blob);
  assert.equal(source.__bytes, undefined);
  await WebContainer.createBoardContainerBlob(board, { 'img-9': source });
  const second = await WebContainer.createBoardContainerBlob(board, { 'img-9': source });

  const reopened = await WebContainer.readBoardContainer(second.blob);
  assert.deepEqual(WebContainer.bytesForImageSource(reopened.board.imageStore['img-9']), bytes);
});

test('editor selection changes do not allocate motion snapshots', () => {
  const context = loadEditorStateBoundaryHarness();
  let allocations = 0;
  context.Set = class CountingSet extends Set {
    constructor(iterable) {
      super(iterable);
      allocations++;
    }
  };

  context.BoardfishEditorState.setSelection(['obj-2'], {
    primaryId: 'obj-2',
  });
  assert.equal(allocations, 0);

  context.BoardfishEditorState.setSelection(['obj-1'], {
    primaryId: 'obj-1',
  });
  assert.equal(allocations, 0);
});

test('board object replacement retains content-keyed caches while reset clears them', () => {
  const context = loadEditorStateBoundaryHarness();
  context.BoardfishEditorState.replaceBoardObjects([], { normalizeText: false, syncTextHeights: false });
  assert.deepEqual(context.textLayoutCacheClears, []);

  context.BoardfishEditorState.resetBoardObjectState();
  assert.deepEqual(context.textLayoutCacheClears, [{}]);
});

test('failed web image inserts roll back their adopted source once', () => {
  const source = readSource('src/js/image_insert.js');

  assert.match(source, /const rollbackImageInsertSource = \(imgKey, source, hadPreviousSource = false, previousSource\) =>/);
  assert.match(source, /if \(!\(naturalW > 0 && naturalH > 0\)\) \{\s*rollbackSource\(\);/);
  assert.match(source, /catch \{\s*rollbackSource\(\);/);
  assert.doesNotMatch(source, /cleanupFailedWebImageInsertSource|revokeImageSource/);
});

test('web image insert rejects a whole supported batch that would exceed object limit', () => {
  const source = readSource('src/js/image_insert.js');

  assert.match(source, /const supportedFiles = \[\];/);
  assert.match(source, /supportedFiles\.push\(file\);/);
  assert.match(source, /BoardfishWebLimits\.canAddObjects\(supportedFiles\.length\)/);
  assert.doesNotMatch(source, /accepted\.length >= maxObjects/);
  assert.equal((source.match(/BoardfishWebLimits\.canAddObjects\(/g) || []).length, 2);
  assert.match(source, /const imgKey = newImgKey\(\);\s*const insertOptions = \{\s*z:/);
  assert.doesNotMatch(source, /\baddImageObject\b|insertOptions\.imgKey/);
});
