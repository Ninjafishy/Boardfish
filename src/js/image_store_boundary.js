'use strict';

(function initImageStoreBoundary(root) {
  function getSource(key) {
    return imageStore[key];
  }

  function setSource(key, source) {
    if (!key) return;
    const hadSource = Object.hasOwn(imageStore, key);
    const previous = imageStore[key];
    const changed = hadSource && previous !== source;
    if (changed) invalidateImageSourceCachesForKey(key);
    imageStore[key] = source;
  }

  function hasDisplayImage(key) {
    return !!imageBitmapCache[key];
  }

  root.BoardfishImageStore = Object.freeze({
    getSource,
    hasDisplayImage,
    setSource,
  });
})(typeof window !== 'undefined' ? window : globalThis);
