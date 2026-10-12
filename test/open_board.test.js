'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../test-support/source.js');
const vm = require('node:vm');

test('open-board helpers used by io_close are shared across startup scripts', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const ioClose = readSource('src/js/io_close.js');

  for (const helper of ['confirmDirtyBeforeOpen', 'openBoardFromPath', 'finishFailedOpen']) {
    assert.match(bootstrap, new RegExp(`var ${helper};`), `${helper} should be declared in shared script scope`);
    assert.match(bootstrap, new RegExp(`${helper} = (?:async )?function ${helper}\\(`), `${helper} should be assigned by app_bootstrap`);
    assert.match(ioClose, new RegExp(`\\b${helper}\\(`), `${helper} should remain callable from io_close`);
  }
});

test('open-board failures show a readable pill message', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const styles = readSource('src/styles.css');
  const start = bootstrap.indexOf('  function openFailureIslandMessage(');
  const end = bootstrap.indexOf('  finishFailedOpen =', start);
  assert.ok(start >= 0 && end > start);
  const format = vm.runInNewContext(`${bootstrap.slice(start, end)}; openFailureIslandMessage`);
  for (const [error, expected] of [
    [{ name: 'NotAllowedError' }, 'Open Failed: Permission Denied'],
    [{ name: 'SecurityError' }, 'Open Failed: Permission Denied'],
    [new Error('Permission Denied'), 'Open Failed: Permission Denied'],
    [{ name: 'NotReadableError' }, 'Open Failed: File Unavailable'],
    [{ name: 'NotFoundError' }, 'Open Failed: File Unavailable'],
    [new Error('File Unavailable'), 'Open Failed: File Unavailable'],
    [new Error('No File Selected'), 'Open Failed: File Unavailable'],
    [new Error('Image Read Failed'), 'Open Failed: File Unavailable'],
    [new Error('Unsupported Board Version: 99'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported File Format'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported Compression'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported ZIP Format'), 'Open Failed: Unsupported File'],
    [new Error('Missing File Entry: board.json'), 'Open Failed: Invalid File'],
    [new Error('Missing Image: img-1'), 'Open Failed: Invalid File'],
    [new Error('Invalid Image Source: img-1'), 'Open Failed: Invalid File'],
    [new Error('File Checksum Mismatch: board.json'), 'Open Failed: Invalid File'],
    [new SyntaxError('unexpected browser detail'), 'Open Failed: Invalid File'],
    [new Error('Invalid File Entry: permission-denied/unsupported.png'), 'Open Failed: Invalid File'],
    [new Error('File Entry Too Large: board.json'), 'Open Failed: File Too Large'],
    [{ boardfishLimit: true, boardfishUserMessage: 'Board Limit: 100 Objects' }, 'Board Limit: 100 Objects'],
    [{ boardfishLimit: true }, 'Board Limit Exceeded'],
    [new Error('unrecognized browser detail'), 'Open Failed'],
    [null, 'Open Failed'],
  ]) assert.equal(format(error), expected);
  assert.match(bootstrap, /finalMsg: message/);
  assert.match(bootstrap, /duration: long_message/);
  assert.match(styles, /#island \{[\s\S]*max-width: calc\(100vw - 32px\);/);
  assert.match(styles, /#isl-zoom \{[\s\S]*white-space: normal;/);
});

function loadOpenHarness({ readBoard = async () => ({ objects: [] }), finishOpen = async () => {} } = {}) {
  const events = [];
  const context = {
    document: {},
    _boardOpening: false,
    currentFileRef: null,
    startCanvasSizeTracking() {}, resizeCanvas() {}, snapshot() {}, markSaved() {},
    beginOpeningFreeze() { events.push('freeze'); },
    showIslandMsg(message) { events.push(message); return new Promise(() => {}); },
    endOpeningFreeze() { events.push('release'); },
    async invokeReadBoard(file) { events.push('read'); return readBoard(file); },
    applyBoardData(data) { events.push('apply'); context.applied = data; },
    async finishOpenedBoard() { events.push('finish'); await finishOpen(context); },
    long_message: 4500,
    finishPillTask({ beforeFinish, finalMsg, duration }) {
      beforeFinish();
      events.push({ finalMsg, duration });
    },
  };
  vm.createContext(context);
  vm.runInContext(readSource('src/js/app_bootstrap.js'), context);
  return { context, events };
}

test('open failures show the error and release the input shield', async () => {
  const { context, events } = loadOpenHarness({
    readBoard: async () => { throw new Error('Invalid File Entry: images/original.png'); },
  });
  await context.openBoardFromPath({});
  assert.deepEqual(events, ['freeze', 'Opening', 'read', 'release', {
    finalMsg: 'Open Failed: Invalid File', duration: 4500,
  }]);
  assert.equal(context._boardOpening, false);
  assert.equal(context.currentFileRef, null);
});

test('opening starts immediately and retains the file target before hydration finishes', async () => {
  const file = {}, board = { objects: [{ id: 'text-1' }] };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { context, events } = loadOpenHarness({
    readBoard: async received => { assert.equal(received, file); return board; },
    finishOpen: async state => {
      assert.equal(state.currentFileRef, file);
      await pending;
    },
  });
  const opened = context.openBoardFromPath(file);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['freeze', 'Opening', 'read', 'apply', 'finish']);
  assert.equal(context.applied, board);
  release();
  await opened;
});

test('open-board completion does not await synchronous pill cleanup', () => {
  const ioClose = readSource('src/js/io_close.js');
  assert.match(ioClose, /finishPillTask\(\{/);
  assert.doesNotMatch(ioClose, /await finishPillTask\(\{/);
});
