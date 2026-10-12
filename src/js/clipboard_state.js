'use strict';

// Clipboard state for in-app object copy/paste plus browser clipboard tokens.
var jsClipboard = null;
var _jsClipboardSetAt = 0;
var _jsClipboardToken = 0;
var _jsClipboardWebToken = '';
var _jsClipboardWebTokenWritten = false;
var _jsClipboardWebMaybeStale = false;
var _jsClipboardWebTokenCounter = 0;
var _pasteInProgress = false;

const getJsClipboardWebToken = () => _jsClipboardWebToken;

const markJsClipboardWebTokenWritten = (token = _jsClipboardWebToken) => {
  const accepted = !!token && token === _jsClipboardWebToken && !!jsClipboard;
  if (accepted) {
    _jsClipboardWebTokenWritten = true;
    _jsClipboardWebMaybeStale = false;
  }

  return accepted;
};

const markJsClipboardMaybeStaleFromWebBlur = () => {
  if (!jsClipboard) return;
  _jsClipboardWebMaybeStale = true;
};

function setJsClipboard(value) {
  jsClipboard = value;
  _jsClipboardSetAt = Date.now();
  _jsClipboardWebToken = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `bf-${crypto.randomUUID()}`
    : (++_jsClipboardWebTokenCounter, `bf-${Date.now().toString(36)}-${_jsClipboardWebTokenCounter.toString(36)}`);
  _jsClipboardWebTokenWritten = false;
  _jsClipboardWebMaybeStale = false;
  return ++_jsClipboardToken;
}

function clearJsClipboard() {
  jsClipboard = null;
  _jsClipboardWebToken = '';
  _jsClipboardWebTokenWritten = false;
  _jsClipboardWebMaybeStale = false;
  _jsClipboardToken++;
}

function jsClipboardStillCurrent(options = {}) {
  if (!jsClipboard) return false;
  const clipboardTokenChecked = options.webClipboardTokenChecked === true;
  const clipboardToken = options.webClipboardToken || '';
  if (clipboardTokenChecked && (_jsClipboardWebTokenWritten || clipboardToken)) {
    const current = !!clipboardToken && clipboardToken === _jsClipboardWebToken;

    return current;
  }
  const age = Date.now() - _jsClipboardSetAt;
  const current = !_jsClipboardWebMaybeStale || age < 750;

  return current;
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', markJsClipboardMaybeStaleFromWebBlur);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') markJsClipboardMaybeStaleFromWebBlur();
  });
}
Object.assign(globalThis, {
  getJsClipboardWebToken,
  markJsClipboardWebTokenWritten,
});
