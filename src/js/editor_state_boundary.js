'use strict';

(function initEditorStateBoundary(root) {
  function clearSelectionState() {
    selectedId = null;
    selectedIds.clear();
  }

  function setSelectionState(ids = []) {
    const nextIds = ids || [];

    selectedIds.clear();
    let lastExistingId = null;
    for (const id of nextIds) {
      if (!objectsMap.has(id)) continue;
      selectedIds.add(id);
      lastExistingId = id;
    }
    selectedId = lastExistingId;
    if (editingId && !selectedIds.has(editingId)) exitEdit();
  }

  function addObject(obj) {
    objects.push(obj);
    objectsMap.set(obj.id, obj);
  }

  function removeObjectsById(ids = []) {
    const idsToRemove = ids instanceof Set ? ids : new Set(ids);
    let write = 0;
    for (let read = 0; read < objects.length; read++) {
      const obj = objects[read];
      if (idsToRemove.has(obj.id)) {
        objectsMap.delete(obj.id);
        selectedIds.delete(obj.id);
        continue;
      }
      objects[write++] = obj;
    }
    objects.length = write;
    if (selectedId && !selectedIds.has(selectedId)) selectedId = null;
  }

  function resetObjectCounters() {
    idCounter = 1;
    zCounter = 1;
  }

  function restoreObjectCounters() {
    resetObjectCounters();
    for (const obj of objects) {
      const idNumber = parseInt(obj.id.slice(4));
      if (idNumber >= idCounter) idCounter = idNumber + 1;
      if (obj.z >= zCounter) zCounter = obj.z + 1;
    }
  }

  function replaceBoardObjects(nextObjects = [], {
    normalizeText = true,
    syncTextHeights = true,
  } = {}) {
    objects = Array.isArray(nextObjects) ? nextObjects : [];
    objectsMap.clear();
    for (const obj of objects) {
      objectsMap.set(obj.id, obj);
      if (!normalizeText || obj?.type !== 'text') continue;
      if (!obj.data) obj.data = {};
      obj.data.content = normalizeTextContent(obj.data?.content);
    }
    if (syncTextHeights) syncAllTextAutoHeights();
  }

  function resetBoardObjectState() {
    if (editingId) exitEdit();
    clearSelectionState();
    objects = [];
    objectsMap.clear();
    clearTextLayoutCaches();
    resetObjectCounters();
  }

  function setBoardOpening() {
    _boardOpening = true;
    updateInputShieldVisual();
  }

  function commitMutation(reason, mutate, options = {}) {
    const result = mutate();
    if (!result) return result;
    if (options.invalidate) invalidateOffscreen();
    scheduleRender(true, true);
    pushHistory(reason);
    return result;
  }

  root.BoardfishEditorState = Object.freeze({
    addObject,
    clearSelection: clearSelectionState,
    commitMutation,
    removeObjectsById,
    replaceBoardObjects,
    resetBoardObjectState,
    restoreObjectCounters,
    setSelection: setSelectionState,
    setBoardOpening,
  });
})(typeof window !== 'undefined' ? window : globalThis);
