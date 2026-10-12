'use strict';

(function registerBoardfishServiceWorker(root) {
  if (!root.navigator?.serviceWorker || !root.location) return;
  const { protocol, hostname } = root.location;
  const canRegister =
    protocol === 'https:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';
  if (!canRegister) return;

  root.addEventListener?.('load', () => {
    root.navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}(globalThis));
