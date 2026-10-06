'use strict';

// The session always lives in the opening tab. Only its DOM, input targets and
// animation frames follow the editable view into Document Picture-in-Picture.
function createBoardfishView(ownerWindow, ownerDocument) {
  let activeWindow = ownerWindow;
  let activeDocument = ownerDocument;
  let nextFrameId = 1;
  const listeners = [];
  const frames = new Map();
  const beforeChange = new Set();
  const afterChange = new Set();
  const capture = (options) => typeof options === 'boolean' ? options : !!options?.capture;
  const target = (kind) => kind === 'window' ? activeWindow : activeDocument;

  function removeListener(kind, type, callback, options) {
    const index = listeners.findIndex((entry) => entry.kind === kind && entry.type === type &&
      entry.callback === callback && capture(entry.options) === capture(options));
    if (index < 0) return;
    const [entry] = listeners.splice(index, 1);
    target(kind)?.removeEventListener?.(type, entry.handler, { capture: capture(entry.options) });
  }

  function addListener(kind, type, callback, options) {
    if (listeners.some((entry) => entry.kind === kind && entry.type === type &&
      entry.callback === callback && capture(entry.options) === capture(options))) return;
    const entry = { kind, type, callback, options, handler: callback };
    if (options?.once) {
      entry.handler = function(event) {
        removeListener(kind, type, callback, options);
        callback.call(this, event);
      };
    }
    listeners.push(entry);
    target(kind)?.addEventListener?.(type, entry.handler, options);
  }

  function scheduleFrame(id, frame) {
    const source = typeof activeWindow?.requestAnimationFrame === 'function' ? activeWindow : globalThis;
    frame.source = source;
    frame.nativeId = source.requestAnimationFrame((time) => {
      if (!frames.delete(id)) return;
      frame.callback(time);
    });
  }

  function requestFrame(callback) {
    const id = nextFrameId++;
    const frame = { callback };
    frames.set(id, frame);
    scheduleFrame(id, frame);
    return id;
  }

  function cancelFrame(id) {
    const frame = frames.get(id);
    if (!frame) return;
    frame.source.cancelAnimationFrame(frame.nativeId);
    frames.delete(id);
  }

  function setWindow(nextWindow) {
    if (nextWindow === activeWindow) return;
    for (const callback of beforeChange) callback();
    for (const entry of listeners) {
      target(entry.kind)?.removeEventListener?.(entry.type, entry.handler, { capture: capture(entry.options) });
    }
    for (const frame of frames.values()) frame.source.cancelAnimationFrame(frame.nativeId);
    activeWindow = nextWindow;
    activeDocument = nextWindow.document || ownerDocument;
    for (const entry of listeners) {
      target(entry.kind)?.addEventListener?.(entry.type, entry.handler, entry.options);
    }
    for (const [id, frame] of frames) scheduleFrame(id, frame);
    for (const callback of afterChange) callback();
  }

  return Object.freeze({
    get window() { return activeWindow; },
    get document() { return activeDocument; },
    get navigator() { return activeWindow?.navigator || globalThis.navigator; },
    setWindow,
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    addDocumentListener: (type, callback, options) => addListener('document', type, callback, options),
    removeDocumentListener: (type, callback, options) => removeListener('document', type, callback, options),
    addWindowListener: (type, callback, options) => addListener('window', type, callback, options),
    removeWindowListener: (type, callback, options) => removeListener('window', type, callback, options),
    beforeChange(callback) { beforeChange.add(callback); return () => beforeChange.delete(callback); },
    onChange(callback) { afterChange.add(callback); return () => afterChange.delete(callback); },
  });
}

var BoardfishView = createBoardfishView(
  typeof window !== 'undefined' ? window : globalThis,
  typeof document !== 'undefined' ? document : null,
);

function boardWindow() { return BoardfishView.window; }
function boardDocument() { return BoardfishView.document; }
function boardNavigator() { return BoardfishView.navigator; }

if (typeof module !== 'undefined' && module.exports) module.exports = { createBoardfishView };
