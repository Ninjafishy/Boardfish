'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardfishView } = require('../src/js/view_context.js');
const { createBoardfishPictureInPicture } = require('../src/js/picture_in_picture.js');

function makeWindow({ loadStylesheets = true, now = () => 0 } = {}) {
  const win = new EventTarget();
  win.frames = new Map();
  win.timers = new Map();
  win.performance = { now };
  Object.assign(win, { screenX: 100, screenY: 80, outerWidth: 800, outerHeight: 634, devicePixelRatio: 2 });
  let id = 0;
  win.setTimeout = (callback, delay) => { win.timers.set(++id, { callback, delay }); return id; };
  win.clearTimeout = (id) => win.timers.delete(id);
  win.flushTimers = () => {
    const timers = [...win.timers.values()];
    win.timers.clear();
    timers.forEach(({ callback }) => callback());
  };
  win.requestAnimationFrame = (callback) => { win.frames.set(++id, callback); return id; };
  win.cancelAnimationFrame = (id) => win.frames.delete(id);
  win.flushFrames = () => {
    const frames = [...win.frames.values()];
    win.frames.clear();
    frames.forEach((callback) => callback(100));
  };
  win.focus = () => { win.focused = true; };
  win.close = () => {
    if (win.closed) return;
    win.dispatchEvent(new Event('pagehide'));
    win.closed = true;
    win.document.body.children.length = 0;
  };
  class Element extends EventTarget {
    constructor(tagName) {
      super();
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
    }
    appendChild(node) {
      if (node.parentNode) {
        const siblings = node.parentNode.children;
        siblings.splice(siblings.indexOf(node), 1);
      }
      node.parentNode = this;
      this.children.push(node);
      if (loadStylesheets && this.tagName === 'HEAD' && node.tagName === 'LINK' && node.rel === 'stylesheet') {
        queueMicrotask(() => node.dispatchEvent(new Event('load')));
      }
    }
    cloneNode() {
      const copy = new Element(this.tagName);
      copy.rel = this.rel;
      copy.href = this.href;
      copy.textContent = this.textContent;
      return copy;
    }
  }
  const doc = new EventTarget();
  doc.body = new Element('body');
  doc.head = new Element('head');
  doc.baseURI = 'http://localhost/boardfish/';
  doc.documentElement = { lang: 'en' };
  doc.createElement = (tag) => new Element(tag);
  doc.querySelectorAll = () => doc.head.children.filter((node) => node.tagName === 'LINK' || node.tagName === 'STYLE');
  win.document = doc;
  return win;
}

test('view transfers input listeners without duplicates and preserves listener removal', () => {
  const owner = makeWindow(), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  const received = [];
  const key = () => received.push(view.document);
  view.addDocumentListener('keydown', key, true);
  view.addDocumentListener('keydown', key, { capture: true });
  view.setWindow(pip);
  owner.document.dispatchEvent(new Event('keydown'));
  pip.document.dispatchEvent(new Event('keydown'));
  view.setWindow(owner);
  pip.document.dispatchEvent(new Event('keydown'));
  owner.document.dispatchEvent(new Event('keydown'));
  assert.deepEqual(received, [pip.document, owner.document]);
  view.removeDocumentListener('keydown', key, { capture: true });
  owner.document.dispatchEvent(new Event('keydown'));
  assert.equal(received.length, 2);
});

test('once listeners stay removed across repeated pin transitions', () => {
  const owner = makeWindow(), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  let calls = 0;
  view.addWindowListener('focus', () => calls++, { once: true });
  view.setWindow(pip);
  pip.dispatchEvent(new Event('focus'));
  view.setWindow(owner);
  owner.dispatchEvent(new Event('focus'));
  assert.equal(calls, 1);
});

test('pending renders follow the visible window and keep their cancellation handles', () => {
  const owner = makeWindow(), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  let frames = 0;
  const cancelled = view.requestAnimationFrame(() => frames += 100);
  view.requestAnimationFrame(() => frames++);
  view.setWindow(pip);
  assert.equal(owner.frames.size, 0);
  view.cancelAnimationFrame(cancelled);
  pip.flushFrames();
  assert.equal(frames, 1);
  view.requestAnimationFrame(() => frames++);
  view.setWindow(owner);
  owner.flushFrames();
  assert.equal(frames, 2);
});

test('save deadlines follow PiP transitions without restarting their timeout', () => {
  let time = 0;
  const owner = makeWindow({ now: () => time }), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  let calls = 0;
  const cancelled = view.setTimeout(() => calls += 100, 100);
  view.setTimeout(() => calls++, 100);
  time = 40;
  view.setWindow(pip);
  assert.equal(owner.timers.size, 0);
  assert.deepEqual([...pip.timers.values()].map(({ delay }) => delay), [60, 60]);
  view.clearTimeout(cancelled);
  time = 120;
  view.setWindow(owner);
  assert.equal(pip.timers.size, 0);
  assert.deepEqual([...owner.timers.values()].map(({ delay }) => delay), [0]);
  owner.flushTimers();
  assert.equal(calls, 1);
  assert.equal(owner.timers.size, 0);
});

test('pending save work resumes when PiP closes with its scheduler suspended', async () => {
  const owner = makeWindow(), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  let finishOldYield;
  pip.scheduler = { yield: () => new Promise((resolve) => { finishOldYield = resolve; }) };
  view.setWindow(pip);
  let calls = 0;
  const pending = view.yieldToEventLoop().then(() => calls++);
  view.setWindow(owner);
  owner.flushTimers();
  await pending;
  finishOldYield();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(pip.timers.size, 0);
  assert.equal(owner.timers.size, 0);
});

test('save yields use the visible window and clear their fallback timer', async () => {
  const owner = makeWindow(), pip = makeWindow();
  const view = createBoardfishView(owner, owner.document);
  owner.scheduler = { yield() { throw new Error('hidden opener used'); } };
  let yields = 0;
  pip.scheduler = { yield() { yields++; return Promise.resolve(); } };
  view.setWindow(pip);
  await view.yieldToEventLoop();
  assert.equal(yields, 1);
  assert.equal(pip.timers.size, 0);
  assert.equal(owner.timers.size, 0);
});

function setup({ supported = true, request, loadStylesheets = true, onResize } = {}) {
  const owner = makeWindow(), pip = makeWindow({ loadStylesheets });
  let requests = 0, transitions = 0;
  const board = owner.document.createElement('canvas');
  // Mutable state models unsaved objects, retained images, and undo entries.
  board.session = { objects: ['unsaved text'], images: new Map(), history: ['first edit'] };
  const script = owner.document.createElement('script');
  const placeholder = owner.document.createElement('section');
  placeholder.hidden = true;
  owner.document.body.appendChild(board);
  owner.document.body.appendChild(script);
  owner.document.body.appendChild(placeholder);
  owner.document.body.dataset.theme = 'dark';
  const stylesheet = owner.document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'http://localhost/boardfish/styles.css';
  owner.document.head.appendChild(stylesheet);
  if (supported) owner.documentPictureInPicture = { requestWindow() {
    requests++;
    return request ? request(pip) : Promise.resolve(pip);
  } };
  const view = createBoardfishView(owner, owner.document);
  const controller = createBoardfishPictureInPicture({
    ownerWindow: owner, view, placeholder,
    onBeforeMove() {},
    onAfterMove() { transitions++; },
    onStateChange() {},
    onResize,
  });
  return { owner, pip, board, script, placeholder, view, controller,
    get requests() { return requests; }, get transitions() { return transitions; } };
}

test('browser close restores the same unsaved board, dynamic controls, theme and history synchronously', async () => {
  const h = setup();
  const session = h.board.session;
  let clicks = 0;
  h.board.addEventListener('click', () => clicks++);
  await h.controller.open();
  assert.equal(h.board.parentNode, h.pip.document.body);
  assert.equal(h.script.parentNode, h.owner.document.body);
  assert.equal(h.placeholder.hidden, false);
  assert.equal(h.view.window, h.pip);
  assert.equal(h.pip.document.head.children.find((node) => node.tagName === 'BASE').href, h.owner.document.baseURI);
  assert.equal(h.pip.document.head.children.find((node) => node.tagName === 'LINK').href, 'http://localhost/boardfish/styles.css');
  h.board.session.objects.push('edit in PiP');
  h.board.session.history.push('second edit');
  const dynamicControl = h.pip.document.createElement('textarea');
  h.pip.document.body.appendChild(dynamicControl);
  h.pip.document.body.dataset.theme = 'light';
  h.pip.close();
  assert.equal(h.board.parentNode, h.owner.document.body);
  assert.equal(dynamicControl.parentNode, h.owner.document.body);
  assert.equal(h.board.session, session);
  assert.deepEqual(session.objects, ['unsaved text', 'edit in PiP']);
  assert.deepEqual(session.history, ['first edit', 'second edit']);
  assert.equal(h.owner.document.body.dataset.theme, 'light');
  assert.equal(h.view.window, h.owner);
  assert.equal(h.controller.pinned, false);
  assert.equal(h.placeholder.hidden, true);
  h.board.dispatchEvent(new Event('click'));
  assert.equal(clicks, 1);
});

test('return to tab restores only once and focuses the owner', async () => {
  const h = setup();
  await h.controller.open();
  h.controller.close({ focus: true });
  h.controller.close();
  assert.equal(h.transitions, 2);
  assert.equal(h.owner.focused, true);
  assert.equal(h.pip.closed, true);
  assert.equal(h.board.parentNode, h.owner.document.body);
});

test('resizing every PiP edge preserves the board position on screen at the same zoom', async () => {
  const viewport = { panX: 37, panY: -24, zoom: 0.52 };
  const deltas = [];
  const h = setup({ onResize(dx, dy) {
    viewport.panX += dx;
    viewport.panY += dy;
    deltas.push([dx, dy]);
  } });
  await h.controller.open();
  const screenPoint = () => ({
    x: h.pip.screenX + viewport.panX + 400 * viewport.zoom,
    y: h.pip.screenY + viewport.panY + 250 * viewport.zoom,
  });
  const original = screenPoint();
  for (const bounds of [
    { outerWidth: 700 }, // right
    { outerHeight: 534 }, // bottom
    { screenX: 200, outerWidth: 600 }, // left
    { screenY: 180, outerHeight: 434 }, // top
    { screenX: 120, screenY: 100, outerWidth: 680, outerHeight: 514 }, // top-left
    { outerWidth: 800, outerHeight: 634 }, // bottom-right
  ]) {
    Object.assign(h.pip, bounds);
    h.pip.dispatchEvent(new Event('resize'));
    assert.deepEqual(screenPoint(), original);
    h.pip.flushFrames();
    assert.deepEqual(screenPoint(), original, 'the following frame must not apply the offset twice');
    assert.equal(viewport.zoom, 0.52);
  }
  assert.deepEqual(deltas, [[-100, 0], [0, -100], [80, 80]]);
  h.controller.close();
});

test('dragging a PiP window moves its content normally and establishes the next resize origin', async () => {
  const deltas = [];
  const h = setup({ onResize: (dx, dy) => deltas.push([dx, dy]) });
  await h.controller.open();
  Object.assign(h.pip, { screenX: 600, screenY: 320 });
  h.pip.flushFrames();
  h.pip.flushFrames();
  assert.deepEqual(deltas, [], 'movement and idle frames must not pan or repaint the board');

  Object.assign(h.pip, { screenX: 680, outerWidth: 720 });
  h.pip.dispatchEvent(new Event('resize'));
  assert.deepEqual(deltas, [[-80, 0]], 'only the edge movement is compensated');
  h.controller.close();
});

test('PiP bounds sampled before a resize notification are compensated only once', async () => {
  const deltas = [];
  const h = setup({ onResize: (dx, dy) => deltas.push([dx, dy]) });
  await h.controller.open();
  Object.assign(h.pip, { screenX: 150, screenY: 120, outerWidth: 750, outerHeight: 594 });
  h.pip.flushFrames();
  h.pip.dispatchEvent(new Event('resize'));
  assert.deepEqual(deltas, [[-50, -40]]);
  h.controller.close();
});

test('moving PiP between display scales resets its resize origin without panning', async () => {
  const deltas = [];
  const h = setup({ onResize: (dx, dy) => deltas.push([dx, dy]) });
  await h.controller.open();
  Object.assign(h.pip, { screenX: -1200, outerWidth: 700, devicePixelRatio: 1 });
  h.pip.dispatchEvent(new Event('resize'));
  assert.deepEqual(deltas, []);
  Object.assign(h.pip, { screenX: -1150, outerWidth: 650 });
  h.pip.dispatchEvent(new Event('resize'));
  assert.deepEqual(deltas, [[-50, 0]]);
  h.controller.close();
});

test('closing PiP stops its bounds sampler and removes its resize listener', async () => {
  const deltas = [];
  const h = setup({ onResize: (dx, dy) => deltas.push([dx, dy]) });
  await h.controller.open();
  assert.equal(h.pip.frames.size, 1);
  const lateFrame = [...h.pip.frames.values()][0];
  h.pip.close();
  assert.equal(h.pip.frames.size, 0);
  assert.equal(h.owner.frames.size, 0);
  Object.assign(h.pip, { screenX: 200, outerWidth: 700 });
  h.pip.dispatchEvent(new Event('resize'));
  lateFrame();
  assert.deepEqual(deltas, []);
  assert.equal(h.pip.frames.size, 0);
});

test('PiP loads the original stylesheet and preserves inline font shorthands instead of serializing CSS rules', async () => {
  const h = setup();
  h.owner.document.head.children[0].sheet = {
    cssRules: [{ cssText: 'body { font-family: ; }' }],
  };
  const inlineStyle = h.owner.document.createElement('style');
  inlineStyle.textContent = 'body { font: var(--text-font-style) 400 13px "Geist Sans", system-ui; }';
  inlineStyle.sheet = { cssRules: [{ cssText: 'body { font-family: ; }' }] };
  h.owner.document.head.appendChild(inlineStyle);

  await h.controller.open();

  const styles = h.pip.document.head.children.filter((node) => node.tagName === 'LINK' || node.tagName === 'STYLE');
  assert.equal(styles.length, 2);
  assert.equal(styles[0].href, 'http://localhost/boardfish/styles.css');
  assert.equal(styles[1].textContent, inlineStyle.textContent);
});

test('PiP waits for stylesheet loading before moving and measuring the board', async () => {
  const h = setup({ loadStylesheets: false });
  const opening = h.controller.open();
  await Promise.resolve();

  assert.equal(h.board.parentNode, h.owner.document.body);
  assert.equal(h.transitions, 0);
  const stylesheet = h.pip.document.head.children.find((node) => node.tagName === 'LINK');
  stylesheet.dispatchEvent(new Event('load'));

  assert.equal(await opening, true);
  assert.equal(h.board.parentNode, h.pip.document.body);
  assert.equal(h.transitions, 1);
});

test('closing PiP during stylesheet loading leaves the board and theme in the owner', async () => {
  const h = setup({ loadStylesheets: false });
  const opening = h.controller.open();
  await Promise.resolve();
  h.pip.close();

  assert.equal(await opening, false);
  assert.equal(h.board.parentNode, h.owner.document.body);
  assert.equal(h.owner.document.body.dataset.theme, 'dark');
  assert.equal(h.placeholder.hidden, true);
  assert.equal(h.view.window, h.owner);
});

test('a failed PiP stylesheet leaves the board in the owner and allows retry', async () => {
  const h = setup({ loadStylesheets: false });
  const opening = h.controller.open();
  await Promise.resolve();
  h.pip.document.head.children.find((node) => node.tagName === 'LINK').dispatchEvent(new Event('error'));

  await assert.rejects(opening, /stylesheet/i);
  assert.equal(h.controller.pinned, false);
  assert.equal(h.board.parentNode, h.owner.document.body);
  assert.equal(h.pip.closed, true);
  const retry = makeWindow();
  h.owner.documentPictureInPicture.requestWindow = async () => retry;
  assert.equal(await h.controller.open(), true);
  assert.equal(h.board.parentNode, retry.document.body);
});

test('unsupported browsers and rejected requests leave the board in the original tab', async () => {
  const unavailable = setup({ supported: false });
  assert.equal(unavailable.controller.supported, false);
  assert.equal(await unavailable.controller.open(), false);
  assert.equal(unavailable.requests, 0);
  const rejected = setup({ request: () => Promise.reject(new Error('Not allowed')) });
  await assert.rejects(rejected.controller.open(), /Not allowed/);
  assert.equal(rejected.board.parentNode, rejected.owner.document.body);
  assert.equal(rejected.placeholder.hidden, true);
  assert.equal(rejected.controller.pinned, false);
  await assert.rejects(rejected.controller.open(), /Not allowed/);
  assert.equal(rejected.requests, 2, 'a rejected request can be retried');
});

test('a second open during a pending browser request does not create another window', async () => {
  let resolve;
  const h = setup({ request: (pip) => new Promise((done) => { resolve = () => done(pip); }) });
  const pending = h.controller.open();
  assert.equal(await h.controller.open(), false);
  resolve();
  assert.equal(await pending, true);
  assert.equal(h.requests, 1);
  assert.equal(await h.controller.open(), false);
  assert.equal(h.requests, 1);
});

test('a delayed close event from an older PiP cannot close a newly pinned board', async () => {
  const h = setup();
  h.pip.close = () => {};
  await h.controller.open();
  h.controller.close();
  const second = makeWindow();
  h.owner.documentPictureInPicture.requestWindow = async () => second;
  await h.controller.open();
  h.pip.dispatchEvent(new Event('pagehide'));
  assert.equal(h.controller.pinned, true);
  assert.equal(h.board.parentNode, second.document.body);
  assert.equal(h.view.window, second);
  second.close();
  assert.equal(h.board.parentNode, h.owner.document.body);
});
