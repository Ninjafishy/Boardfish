'use strict';

(function initBoardDocument(root) {
  const BoardTypes = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);
  const { dataUrlMime, mimeForExt, normalizeImageExt } = BoardTypes;

  function imageMetaForBoardFile(imgKey, src = '', deps = {}) {
    const guessImageExtFromDataUrl = deps.guessImageExtFromDataUrl || (() => 'png');
    if (src && typeof src === 'object' && (src.path || src.mime || src.ext)) {
      const ext = normalizeImageExt(src.ext, src.mime);
      const mime = src.mime || mimeForExt(ext);
      const path = `images/${imgKey}.${ext}`;
      return { path, mime, ext };
    }
    const comma = typeof src === 'string' ? src.indexOf(',') : -1;
    const ext = guessImageExtFromDataUrl(src);
    const mime = comma > 0 ? dataUrlMime(src) : mimeForExt(ext);
    return { path: `images/${imgKey}.${ext}`, mime, ext };
  }

  function referencedImageKeys(objects = []) {
    const keys = new Set();
    for (const obj of objects || []) {
      const key = obj?.type === BoardTypes.OBJECT_TYPES.IMAGE ? obj.data?.imgKey : '';
      if (key) keys.add(key);
    }
    return keys;
  }

  function createBoardDataForSave({ viewport, imageStore, objects }, deps = {}) {
    const data = deps.schema.normalizeBoardData({
      version: BoardTypes.BOARD_VERSION_CONTAINER,
      format: BoardTypes.BOARD_FORMAT,
      viewport,
      imageStore: imageStore || {},
      objects,
    }, true);
    for (const key in data.imageStore) {
      data.imageStore[key] = imageMetaForBoardFile(key, data.imageStore[key], deps);
    }
    return data;
  }

  const api = {
    createBoardDataForSave,
    referencedImageKeys,
  };

  Object.freeze(api);

  root.BoardfishBoardDocument = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
