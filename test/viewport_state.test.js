'use strict';

const { readSource, runScript } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

test('viewport panning accepts large offsets in every direction', () => {
  const zoom = 2;

  const towardTopLeft = applyViewportState({ zoom }, 'setViewport', { panX: 100000, panY: 100000 });
  assert.deepEqual(towardTopLeft, { panX: 100000, panY: 100000, zoom });

  const towardBottomRight = applyViewportState({ zoom }, 'setViewport', { panX: -100000, panY: -100000 });
  assert.deepEqual(towardBottomRight, { panX: -100000, panY: -100000, zoom });
});

test('viewport state accepts an explicit pan and zoom', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };

  assert.deepEqual(applyViewportState({}, 'setViewport', viewport), viewport);
});

test('invalid zoom-pan input retains the viewport', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };
  assert.deepEqual(applyViewportState(viewport, 'setZoomPan', NaN, NaN, Infinity), viewport);
});

function loadViewportStateHarness({
  panX = 0,
  panY = 0,
  zoom = 1,
} = {}) {
  const source = readSource('src/js/viewport_state.js');
  const context = {};
  runScript(
    `var panX = ${panX}; var panY = ${panY}; var zoom = ${zoom};\n` +
      `${source}\n` +
      'globalThis.viewportSnapshot = () => ({ panX, panY, zoom });\n',
    context,
    { filename: 'viewport_state.js' },
  );
  return context;
}

function applyViewportState(options, method, ...args) {
  const context = loadViewportStateHarness(options);
  context.BoardfishViewportState[method](...args);
  return { ...context.viewportSnapshot() };
}

test('wheel and drag state methods share the same unrestricted pan path', () => {
  const context = loadViewportStateHarness();

  assert.equal(context.BoardfishViewportState.panBy(100000, -100000), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 100000, panY: -100000, zoom: 1 });

  assert.equal(context.BoardfishViewportState.setViewport({ panX: -100000, panY: 100000 }), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -100000, panY: 100000, zoom: 1 });
});

test('zooming around a client point keeps its world-space anchor fixed', () => {
  const context = loadViewportStateHarness({ panX: 10, panY: 20, zoom: 2 });
  assert.equal(context.BoardfishViewportState.zoomAroundClient(110, 220, 4), true);

  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -90, panY: -180, zoom: 4 });
});

test('panning continues in every direction after a large prior offset', () => {
  const context = loadViewportStateHarness({
    panX: 900,
    panY: 0,
  });

  assert.equal(context.BoardfishViewportState.panBy(50, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 950, panY: 75, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(-25, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 925, panY: 150, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(0, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 925, panY: 225, zoom: 1 });
});
