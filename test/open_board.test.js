'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, runScript } = require('../test-support/source.js');

test('open-board helpers used by io_close are shared across startup scripts', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const ioClose = readSource('src/js/io_close.js');

  for (const helper of ['confirmDirtyBeforeOpen', 'openBoardFromPath', 'finishFailedOpen']) {
    assert.match(bootstrap, new RegExp(`var ${helper};`), `${helper} should be declared in shared script scope`);
    assert.match(bootstrap, new RegExp(`${helper} = (?:async )?function ${helper}\\(`), `${helper} should be assigned by app_bootstrap`);
    assert.match(ioClose, new RegExp(`\\b${helper}\\(`), `${helper} should remain callable from io_close`);
  }
});

function loadOpenHarness({ readBoard = async () => ({ objects: [] }), finishOpen = async () => {} } = {}) {
  const context = {
    document: {},
    _boardOpening: false,
    currentFileRef: null,
    startCanvasSizeTracking() {}, resizeCanvas() {}, snapshot() {}, markSaved() {},
    beginOpeningFreeze() {},
    showIslandMsg() { return new Promise(() => {}); },
    endOpeningFreeze() {},
    BoardfishRuntime: { readBoard: async file => ({ board: await readBoard(file) }) },
    applyBoardData(data) { context.applied = data; },
    async finishOpenedBoard() { await finishOpen(context); },
    long_message: 4500,
    finishPillTask({ beforeFinish }) {
      beforeFinish();
    },
  };
  runScript(readSource('src/js/app_bootstrap.js'), context);
  return { context };
}

test('opening starts immediately and retains the file target before hydration finishes', async () => {
  const file = {}, board = { objects: [{ id: 'text-1' }] };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { context } = loadOpenHarness({
    readBoard: async received => { assert.equal(received, file); return board; },
    finishOpen: async state => {
      assert.equal(state.currentFileRef, file);
      await pending;
    },
  });
  const opened = context.openBoardFromPath(file);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.applied, board);
  release();
  await opened;
});
