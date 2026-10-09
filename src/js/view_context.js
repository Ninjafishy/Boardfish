'use strict';

// The session always lives in the opening tab. Only its DOM, input targets and
// scheduled work follow the editable view into Document Picture-in-Picture.
function createBoardfishView(ownerWindow, ownerDocument) {
  let activeWindow = ownerWindow;
  let activeDocument = ownerDocument;
  let nextFrameId = 1;
  let nextTimeoutId = 1;
  const listeners = [];
  const frames = new Map();
  const timeouts = new Map();
  const beforeChange = new Set();
  const capture = (options) => typeof options === 'boolean' ? options : !!options?.capture;
  const target = (kind) => kind === 'window' ? activeWindow : activeDocument;
  const now = () => (ownerWindow.performance || globalThis.performance).now();
  const wallNow = () => (ownerWindow.Date || Date).now();

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

  function timeoutRemaining(timeout) {
    // performance.now() can stop during system sleep on some platforms.
    return Math.max(0, Math.min(timeout.deadline - now(), timeout.wallDeadline - wallNow()));
  }

  function scheduleTimeout(id, timeout) {
    const source = typeof activeWindow?.setTimeout === 'function' ? activeWindow : globalThis;
    timeout.source = source;
    timeout.nativeId = source.setTimeout(() => {
      if (!timeouts.delete(id)) return;
      timeout.callback();
    }, timeoutRemaining(timeout));
  }

  function requestTimeout(callback, delay = 0) {
    const id = nextTimeoutId++;
    const duration = Math.max(0, Number(delay) || 0);
    const timeout = { callback, deadline: now() + duration, wallDeadline: wallNow() + duration };
    timeouts.set(id, timeout);
    scheduleTimeout(id, timeout);
    return id;
  }

  function cancelTimeout(id) {
    const timeout = timeouts.get(id);
    if (!timeout) return;
    timeout.source.clearTimeout(timeout.nativeId);
    timeouts.delete(id);
  }

  function recoverDueTimeouts() {
    // Focus can return without a setWindow transition. If browser scheduling
    // stalled while PiP was inactive, settle overdue save guards and yields
    // from the next live event instead of waiting for that same stalled queue.
    if (!timeouts.size) return;
    for (const [id, timeout] of Array.from(timeouts)) {
      if (!timeouts.has(id) || timeoutRemaining(timeout) > 0) continue;
      cancelTimeout(id);
      timeout.callback();
    }
  }

  for (const type of ['focus', 'pageshow']) addListener('window', type, recoverDueTimeouts);
  addListener('document', 'resume', recoverDueTimeouts);
  addListener('document', 'visibilitychange', () => {
    if (activeDocument?.visibilityState === 'visible') recoverDueTimeouts();
  });
  for (const type of ['pointerdown', 'keydown', 'wheel', 'contextmenu']) {
    addListener('document', type, recoverDueTimeouts, { capture: true, passive: true });
  }

  function yieldToEventLoop() {
    return new Promise((resolve) => {
      // The timer also carries this continuation across a window change if
      // the old window's scheduler is suspended or destroyed before it runs.
      const id = requestTimeout(resolve);
      try {
        activeWindow.scheduler?.yield?.().then(() => {
          cancelTimeout(id);
          resolve();
        }, () => {});
      } catch {
        // An unavailable scheduler still has the timer fallback.
      }
    });
  }

  function setWindow(nextWindow) {
    if (nextWindow === activeWindow) return;
    for (const callback of beforeChange) callback();
    for (const entry of listeners) {
      target(entry.kind)?.removeEventListener?.(entry.type, entry.handler, { capture: capture(entry.options) });
    }
    for (const frame of frames.values()) frame.source.cancelAnimationFrame(frame.nativeId);
    for (const timeout of timeouts.values()) timeout.source.clearTimeout(timeout.nativeId);
    activeWindow = nextWindow;
    activeDocument = nextWindow.document || ownerDocument;
    for (const entry of listeners) {
      target(entry.kind)?.addEventListener?.(entry.type, entry.handler, entry.options);
    }
    for (const [id, frame] of frames) scheduleFrame(id, frame);
    for (const [id, timeout] of timeouts) scheduleTimeout(id, timeout);
  }

  return Object.freeze({
    get window() { return activeWindow; },
    get document() { return activeDocument; },
    get navigator() { return activeWindow?.navigator || globalThis.navigator; },
    setWindow,
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    setTimeout: requestTimeout,
    clearTimeout: cancelTimeout,
    yieldToEventLoop,
    addDocumentListener: (type, callback, options) => addListener('document', type, callback, options),
    removeDocumentListener: (type, callback, options) => removeListener('document', type, callback, options),
    addWindowListener: (type, callback, options) => addListener('window', type, callback, options),
    beforeChange(callback) { beforeChange.add(callback); return () => beforeChange.delete(callback); },
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
