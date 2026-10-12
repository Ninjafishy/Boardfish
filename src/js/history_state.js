// ─── History ──────────────────────────────────────────────────────────────────
var boardHistory = [];
var historyIndex = -1;
var _historyRevision = 0;
var MAX_HISTORY = 50;
var _historyImageCacheClipboardToken = _jsClipboardToken;
function trimHistory() {
  if (boardHistory.length > MAX_HISTORY) {
    const trim = boardHistory.length - MAX_HISTORY;
    boardHistory.splice(0, trim);
    historyIndex = Math.max(-1, historyIndex - trim);
    return true;
  }
  return false;
}

function collectImageKeysFromObjects(sourceObjects, out) {
  for (const obj of sourceObjects || []) {
    const key = obj?.type === 'image' ? obj.data?.imgKey : '';
    if (key) out.add(key);
  }
}

function retainedImageKeysForCurrentAndHistory() {
  const keys = new Set();
  for (const entry of boardHistory) {
    collectImageKeysFromObjects(entry?.objects, keys);
  }
  collectImageKeysFromObjects(jsClipboard?.objects, keys);
  return keys;
}

function pruneImageCachesAfterHistoryChange(historyEntriesDropped = false) {
  if (!historyEntriesDropped && _historyImageCacheClipboardToken === _jsClipboardToken) return;
  _historyImageCacheClipboardToken = _jsClipboardToken;
  const retainedKeys = retainedImageKeysForCurrentAndHistory();
  pruneImageCachesToKeys(retainedKeys);
}

function syncHistoryEditProxyDomValueForSelection(proxy, start, end) {
  const domValue = String(proxy?.value ?? '');
  const logicalValue = textEditProxyValue(proxy);
  const selectionStart = Math.max(0, Math.trunc(Number(start)) || 0);
  const selectionEnd = Math.max(selectionStart, Math.trunc(Number(end)) || selectionStart);
  const stale = !!proxy?._boardfishDomValueStale || domValue !== logicalValue;
  const needsSelectionRange = selectionStart !== selectionEnd || selectionEnd > domValue.length;

  if (proxy && stale && needsSelectionRange) {
    proxy.value = logicalValue;
    setTextEditProxyLogicalValue(proxy, logicalValue);
  }
}

function cloneObjectsForHistoryRestore(snapshotObjects = []) {
  const clones = new Array(snapshotObjects.length);
  for (let i = 0; i < snapshotObjects.length; i++) {
    const clone = clones[i] = cloneObject(snapshotObjects[i], true);
    if (clone.type === 'text') cloneTextObjectRuntimeCaches(objectsMap.get(clone.id), clone);
  }
  return clones;
}

function snapshot() {
  boardHistory = []; historyIndex = -1;

  const objectsSnapshot = cloneObjects(objects);

  const editState = captureEditState();

  boardHistory.push({
    reason: 'snapshot',
    revision: ++_historyRevision,
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = boardHistory.length - 1;
  _dirtyIds.clear();
  _historyImageCacheClipboardToken = _jsClipboardToken;
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory(reason = '', dirty = null, beforeEditState = null) {
  if (dirty) for (const item of dirty) _dirtyIds.add(item?.obj?.id ?? item);
  const contentChanged = _dirtyIds.size > 0;

  let historyEntriesDropped = boardHistory.length > historyIndex + 1;
  boardHistory.length = historyIndex + 1;
  const prevEntry = boardHistory[historyIndex];
  const prevObjects = prevEntry?.objects || [];
  let byId;
  const cacheEditingText = !!editingId && (
    reason === 'text-edit-checkpoint' || reason === 'text-edit-enter'
  );

  const entry = new Array(objects.length);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    const previous = prevObjects[i]?.id === o.id ? prevObjects[i] :
      (byId ||= new Map(prevObjects.map(o => [o.id, o]))).get(o.id);
    const runtimeTextCache = cacheEditingText && o.type === 'text' && o.id === editingId;
    const shouldClone = _dirtyIds.has(o.id) || !previous || runtimeTextCache;
    entry[i] = shouldClone ? cloneObject(o, runtimeTextCache) : previous;
  }

  _dirtyIds.clear();
  const editState = captureEditState();

  boardHistory.push({
    reason,
    revision: reason === 'text-edit-enter' && !contentChanged ? prevEntry?.revision : ++_historyRevision,
    objects: entry,
    editState,
    beforeEditState,
  });
  historyIndex++;
  historyEntriesDropped = trimHistory() || historyEntriesDropped;
  pruneImageCachesAfterHistoryChange(historyEntriesDropped);
}

function restoreSnapshot(s, editStateOverride) {
  const snapshotObjects = s?.objects || [];
  const snapshotEditState = s?.editState || null;
  const editState = editStateOverride === undefined ? snapshotEditState : editStateOverride;

  const liveEditId = editingId || '';
  const liveEditProxy = _editEl || null;
  const liveEditObject = liveEditId ? objectsMap.get(liveEditId) : null;
  const liveEditIndex = (
    editState?.id &&
    liveEditId === editState.id &&
    liveEditProxy &&
    liveEditObject?.type === 'text'
  ) ? snapshotObjects.findIndex((obj) => obj?.id === editState.id && obj?.type === 'text') : -1;
  const preserveLiveEdit = liveEditIndex >= 0;
  let liveSelectionListenerRemoved = false;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  if (editingId && preserveLiveEdit) {
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      liveSelectionListenerRemoved = true;
    }
  } else if (editingId) {
    clearInterval(_caretBlinkInterval);
    _caretBlinkInterval = null;
    _editHistoryLastContent = null;
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      _selChangeListener = null;
    }
    if (_editEl) {
      _editEl.remove();
    }
    editingId = null;
    _editEl = null;
  }

  const clonedSnapshotObjects = cloneObjectsForHistoryRestore(snapshotObjects);
  if (preserveLiveEdit) {
    for (const key of Object.keys(liveEditObject)) delete liveEditObject[key];
    Object.assign(liveEditObject, clonedSnapshotObjects[liveEditIndex]);
    clonedSnapshotObjects[liveEditIndex] = liveEditObject;
  }

  BoardfishEditorState.replaceBoardObjects(clonedSnapshotObjects, {
    normalizeText: false,
    syncTextHeights: false,
  });

  _dirtyIds.clear();

  invalidateOffscreen();

  if (editingId && !selectedIds.has(editingId)) exitEdit();
  const obj = editState?.id ? objectsMap.get(editState.id) : null;
  // Restore the final selection before the scheduled frame

  BoardfishEditorState.setSelection(obj?.type === 'text' ? [obj.id] : [...selectedIds]);

  scheduleRender(true, true);

  if (!editState || !editState.id || !obj || obj.type !== 'text') {
    return;
  }

  let reusedEditProxy = false;
  if (preserveLiveEdit && _editEl === liveEditProxy && obj === liveEditObject) {
    reusedEditProxy = true;
    setTextEditProxyLogicalValue(_editEl, obj.data.content, _editEl.value === obj.data.content);
    obj._editStartContent = obj.data.content;
    setTextEditMinLinesForSession(obj, true);
    _editHistoryLastContent = obj.data.content;
  } else {
    enterEdit(obj.id, {
      history: false,
      preserveSize: true,
      placeInitialCaret: false,
    });
  }

  if (!_editEl) {
    return;
  }
  const max = textEditProxyValue(_editEl).length;
  const start = Math.max(0, Math.min(editState.selectionStart ?? max, max));
  const end = Math.max(0, Math.min(editState.selectionEnd ?? max, max));

    syncHistoryEditProxyDomValueForSelection(_editEl, start, end);

  _textInputSelectionHistorySuppress = { start, end };
  _editEl.setSelectionRange(start, end, editState.selectionDirection || 'none');

  const editProxyAlreadyFocused = typeof document !== 'undefined' && document.activeElement === _editEl;
  if (reusedEditProxy && editProxyAlreadyFocused) {} else if (typeof _editEl.focus === 'function') {
    _editEl.focus({ preventScroll: true });
  }

  if (start === end) {
    obj._textEditCaretIndex = start;
  } else {
    delete obj._textEditCaretIndex;
  }
  if (liveSelectionListenerRemoved && _selChangeListener) {
    document.addEventListener('selectionchange', _selChangeListener);
  }
  _caretVisible = true;
}

function captureEditState() {
  if (!editingId) return null;
  if (!_editEl) return { id: editingId, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  return {
    id: editingId,
    selectionStart: _editEl.selectionStart,
    selectionEnd: _editEl.selectionEnd,
    selectionDirection: _editEl.selectionDirection || 'none',
  };
}

function undo() {
    flushEditHistoryCheckpoint();

  if (historyIndex <= 0) {
    return;
  }

  const actionEntry = boardHistory[historyIndex];

  historyIndex--;
  const undoEditState = actionEntry?.reason === 'text-edit-checkpoint'
    ? actionEntry.beforeEditState || undefined
    : undefined;

  restoreSnapshot(boardHistory[historyIndex], undoEditState);
}

function redo() {
    flushEditHistoryCheckpoint();

  if (historyIndex >= boardHistory.length - 1) {
    return;
  }

  historyIndex++;
  const actionEntry = boardHistory[historyIndex];

  restoreSnapshot(actionEntry);
}
