'use strict';

(function initBoardLimits(root) {
  const MB = 1024 * 1024;
  const LIMITS = Object.freeze({
    maxObjects: 100,
    maxTextCharacters: 25000,
    maxBoardContentBytes: 500 * MB,
  });

  function formatBytes(bytes) {
    const mb = Math.round((Number(bytes) || 0) / MB * 10) / 10;
    return `${mb} MB`;
  }

  function objectLimitMessage() {
    return `Board Limit: ${LIMITS.maxObjects} Objects`;
  }

  function textCharacterLimitMessage() {
    return `Board Limit: ${LIMITS.maxTextCharacters.toLocaleString('en-US')} Characters`;
  }

  function boardContentLimitMessage() {
    return `Board Limit: ${formatBytes(LIMITS.maxBoardContentBytes)}`;
  }

  function limitError(message) {
    const err = new Error(message);
    err.boardfishLimit = true;
    err.boardfishUserMessage = message;
    return err;
  }

  function notify(message) {
    if (typeof root.showIslandMsg === 'function') {
      root.showIslandMsg(message, root.long_message ?? 4500);
      return;
    }
    if (typeof root.alert === 'function') root.alert(message);
  }

  function rejectLimit(message, { notifyUser = true } = {}) {
    if (notifyUser) notify(message);
    return false;
  }

  function objectCount() {
    return Array.isArray(root.objects) ? root.objects.length : 0;
  }

  function canAddObjects(count = 1, options = {}) {
    const nextCount = objectCount() + Math.max(0, Number(count) || 0);
    if (nextCount <= LIMITS.maxObjects) return true;
    return rejectLimit(objectLimitMessage(), options);
  }

  function textCharacterCount(text = '') {
    return String(text ?? '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ').length;
  }

  function currentTextCharacters(objects = root.objects, excludedObject = null) {
    if (!Array.isArray(objects)) return 0;
    let count = 0;
    for (const obj of objects) {
      if (obj === excludedObject) excludedObject = null;
      else if (obj?.type === 'text' && typeof obj.data?.content === 'string') {
        count += textCharacterCount(obj.data.content);
      }
    }
    return count;
  }

  function canAcceptAdditionalTextCharacters(count = 0, options = {}) {
    const nextCount = currentTextCharacters() + Math.max(0, Number(count) || 0);
    if (nextCount <= LIMITS.maxTextCharacters) return true;
    return rejectLimit(textCharacterLimitMessage(), options);
  }

  function canReplaceText(obj, nextText, options = {}) {
    const nextCount = currentTextCharacters(root.objects, obj) + textCharacterCount(nextText);
    if (nextCount <= LIMITS.maxTextCharacters) return true;
    return rejectLimit(textCharacterLimitMessage(), options);
  }

  let textByteEncoder = null;
  function textByteLength(text = '') {
    const value = String(text ?? '');
    if (typeof TextEncoder === 'function') {
      if (!textByteEncoder) textByteEncoder = new TextEncoder();
      return textByteEncoder.encode(value).length;
    }
    return value.length;
  }

  function imageSourceByteLength(source) {
    if (typeof source === 'string' && source.startsWith('data:')) return root.BoardfishWebBoardContainer.dataUrlByteLength(source);
    if (source && typeof source === 'object') return Number(source.bytes || source.byteLength || 0) || 0;
    return 0;
  }

  function currentContentBytes() {
    const store = root.imageStore || {};
    const referenced = root.BoardfishBoardDocument?.referencedImageKeys && Array.isArray(root.objects)
      ? root.BoardfishBoardDocument.referencedImageKeys(root.objects)
      : Object.keys(store);
    let total = 0;
    for (const key of referenced) total += imageSourceByteLength(store[key]);
    try {
      const objects = Array.isArray(root.objects) ? root.objects : [];
      const cleanObjects = objects.map(({ id, type, x, y, w, h, z, data }) => ({ id, type, x, y, w, h, z, data }));
      const json = JSON.stringify({
        viewport: { panX: root.panX || 0, panY: root.panY || 0, zoom: root.zoom || 1 },
        objects: cleanObjects,
      });
      return total + textByteLength(json) + 1024;
    } catch (_) {
      return total + 1024;
    }
  }

  function projectedContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, baseBytes = currentContentBytes()) {
    const objectCount = Array.isArray(root.objects) ? root.objects.length : 0;
    const additionalObjectBytes = additionalObjectCount * 3 - (!objectCount && additionalObjectCount ? 1 : 0);
    return baseBytes + Math.max(0, Number(additionalImageBytes) || 0) + additionalObjectBytes;
  }

  function canAcceptAdditionalContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, options = {}) {
    const projected = projectedContentBytes(additionalImageBytes, additionalObjectCount, options.baseBytes);
    if (projected <= LIMITS.maxBoardContentBytes) return true;
    return rejectLimit(boardContentLimitMessage(), options);
  }

  function validateBoardPayload({ objectCount: nextObjectCount = 0, textCharacters = 0, boardJsonBytes = 0, imageBytes = null } = {}) {
    if ((Number(nextObjectCount) || 0) > LIMITS.maxObjects) throw limitError(objectLimitMessage());
    if ((Number(textCharacters) || 0) > LIMITS.maxTextCharacters) throw limitError(textCharacterLimitMessage());
    const total = (Number(boardJsonBytes) || 0) + (Number(imageBytes) || 0);
    if (total > LIMITS.maxBoardContentBytes) {
      throw limitError(boardContentLimitMessage());
    }
    return true;
  }

  const api = Object.freeze({
    LIMITS,
    boardContentLimitMessage,
    canAcceptAdditionalContentBytes,
    canAcceptAdditionalTextCharacters,
    canAddObjects,
    canReplaceText,
    currentContentBytes,
    currentTextCharacters,
    limitError,
    notify,
    textByteLength,
    textCharacterCount,
    validateBoardPayload,
  });

  root.BoardfishWebLimits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
