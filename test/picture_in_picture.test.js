'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardfishView } = require('../src/js/view_context.js');
const { createBoardfishPictureInPicture } = require('../src/js/picture_in_picture.js');

function makeWindow() {
  const win = new EventTarget();
  win.frames = new Map();
  let id = 0;
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
    }
    cloneNode() { return new Element(this.tagName); }
  }
  const doc = new EventTarget();
  doc.body = new Element('body');
  doc.head = new Element('head');
  doc.baseURI = 'http://localhost/boardfish/';
  doc.documentElement = { lang: 'en' };
  doc.createElement = (tag) => new Element(tag);
  doc.querySelectorAll = () => doc.head.children.filter((node) => node.tagName === 'LINK');
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

function setup({ supported = true, request } = {}) {
  const owner = makeWindow(), pip = makeWindow();
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
