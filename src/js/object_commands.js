// ─── Add objects ─────────────────────────────────────────────────────────────

function addText(wx, wy, content = '', options = {}) {
  if (!BoardfishWebLimits.canAddObjects(1)) {
    return;
  }
  if (!options.contentPrepared) content = textForTextObjectPaste(content);

  if (!BoardfishWebLimits.canAcceptAdditionalTextCharacters(BoardfishWebLimits.textCharacterCount(content))) return;
  const data = { content };
  const textBytes = BoardfishWebLimits.textByteLength(content);
  const accepted = BoardfishWebLimits.canAcceptAdditionalContentBytes(textBytes, 1);

  if (!accepted) return;
  const h = LINE_H + TEXT_PAD * 2;
  let w = content ? 120 : h * 6;
  for (let start = 0; start < content.length && w < 700;) {
    let end = content.indexOf('\n', start);
    if (end < 0) end = content.length;
    w = Math.min(Math.max(Math.round((end - start) * 9.2 + 16), w), 700);
    start = end + 1;
  }
  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data };

  syncTextAutoHeight(obj);

  if (options?.anchor === 'center') {
    obj.x = wx - obj.w / 2;
    obj.y = wy - obj.h / 2;
  }

  BoardfishEditorState.addObject(obj);

  selectObject(obj.id);

  if (content) {
    pushHistory('add-text');
  } else {
    enterEdit(obj.id);
  }
}
var _inputShieldStack = [];

function updateInputShieldVisual() {
  openingShield.classList.toggle('active', _dialogResolve === null &&
    (_boardOpening || _inputShieldStack.some((token) => token.visual !== false)));
}

function acquireInputShield(options = {}) {
  const token = {
    keepSelectionOverlay: options.keepSelectionOverlay === true,
    visual: options.visual !== false,
    released: false,
  };
  _inputShieldStack.push(token);
  updateInputShieldVisual();
  return () => {
    if (token.released) return;
    token.released = true;
    const index = _inputShieldStack.indexOf(token);
    if (index !== -1) _inputShieldStack.splice(index, 1);
    updateInputShieldVisual();
    if (!_inputShieldStack.length && !_boardOpening) {
      scheduleRender(false, true);
    }
  };
}

function isBoardInputBlocked() {
  return _boardOpening || _inputShieldStack.length > 0;
}

function shouldKeepSelectionOverlayWhileBlocked() {
  if (_boardOpening) return false;
  for (const token of _inputShieldStack) {
    if (token.keepSelectionOverlay) return true;
  }
  return false;
}

// ─── New board ───────────────────────────────────────────────────────────────

async function newBoard() {
  if (isCleanDefaultEmptyBoardState() && !currentFileRef) {
    return;
  }
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }

  BoardfishEditorState.setBoardOpening();
  beginOpeningFreeze();

  showIslandMsg('Opening');
  BoardfishEditorState.resetBoardObjectState();

  clearJsClipboard();
  invalidateOffscreen();

  currentFileRef = null;
  BoardfishViewportState.reset();
  clearImageStore();

  snapshot();
  markSaved();

  _boardOpening = false;
  applyTransform();
  finishPillTask({ beforeFinish: endOpeningFreeze });
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected(anchorPoint = null) {
  if (!selectedIds.size || editingId || !BoardfishWebLimits.canAddObjects(selectedIds.size)) return;
  const selectedObjects = [];
  let additionalTextBytes = 0;
  let additionalTextCharacters = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    selectedObjects.push(obj);
    if (obj?.type === 'text') {
      const content = String(obj.data?.content || '');
      additionalTextBytes += BoardfishWebLimits.textByteLength(content);
      additionalTextCharacters += BoardfishWebLimits.textCharacterCount(content);
    }
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.w);
    maxY = Math.max(maxY, obj.y + obj.h);
  }
  if (
    !selectedObjects.length ||
    !BoardfishWebLimits.canAcceptAdditionalTextCharacters(additionalTextCharacters) ||
    !BoardfishWebLimits.canAcceptAdditionalContentBytes(additionalTextBytes, selectedObjects.length)
  ) return;
  const center = (
    anchorPoint &&
    Number.isFinite(Number(anchorPoint.x)) &&
    Number.isFinite(Number(anchorPoint.y))
  )
    ? { x: Number(anchorPoint.x), y: Number(anchorPoint.y) }
    : boardCursorWorldPoint();
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;
  const duplicatedIds = [];
  for (const source of selectedObjects) {
    const obj = cloneObject(source);
    obj.id = newId();
    obj.x += dx;
    obj.y += dy;
    obj.z = ++zCounter;
    BoardfishEditorState.addObject(obj);
    duplicatedIds.push(obj.id);
  }
  BoardfishEditorState.setSelection(duplicatedIds);
  scheduleRender(true, true);
  pushHistory('duplicate-selected');
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  BoardfishEditorState.removeObjectsById(selectedIds);
  scheduleRender(true, true);
  pushHistory('delete-selected');
}
