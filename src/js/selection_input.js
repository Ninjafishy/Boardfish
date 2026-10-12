// ─── Screen-space selection overlay ──────────────────────────────────────────
var _selOverlayStyleState = { transform: '', width: '', height: '' };
var _multiSelBoxes = [], _multiSelMotions = [];
var _rubberBandDragActive = false;
var _textMinWidthWarmCancel = null;
var _textMinWidthWarmObjectId = '';
const SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;

function setSelectionOverlayScreenRect(element, state, resting, animated, padDevicePx = 0) {
  const restingX = resting.x1 * zoom + panX;
  const restingY = resting.y1 * zoom + panY;
  const restingWidth = (resting.x2 - resting.x1) * zoom;
  const restingHeight = (resting.y2 - resting.y1) * zoom;
  const dpr = window.devicePixelRatio || 1;
  const px = 1 / dpr;
  const pad = padDevicePx * px;
  const x1 = Math.floor((restingX - pad) * dpr) * px;
  const y1 = Math.floor((restingY - pad) * dpr) * px;
  const x2 = Math.ceil((restingX + restingWidth + pad) * dpr) * px;
  const y2 = Math.ceil((restingY + restingHeight + pad) * dpr) * px;
  const snappedWidth = x2 - x1;
  const snappedHeight = y2 - y1;
  const deltaX = _cleanOverlay((animated.x1 - resting.x1) * zoom);
  const deltaY = _cleanOverlay((animated.y1 - resting.y1) * zoom);
  const deltaWidth = _cleanOverlay((animated.x2 - animated.x1) * zoom - restingWidth);
  const deltaHeight = _cleanOverlay((animated.y2 - animated.y1) * zoom - restingHeight);
  _setStyleIfChanged(element, 'transform', `translate(${_cleanOverlay(x1 + deltaX)}px,${_cleanOverlay(y1 + deltaY)}px)`, state);
  _setStyleIfChanged(element, 'width', _cleanOverlay(Math.max(0, snappedWidth + deltaWidth)) + 'px', state);
  _setStyleIfChanged(element, 'height', _cleanOverlay(Math.max(0, snappedHeight + deltaHeight)) + 'px', state);
}

function selectionOverlayObjectBounds(obj, motion = BoardfishMotion.getLastDrawnObjectMotion(obj)) {
  if (!motion) return null;
  const { scaleX = 1, scaleY = 1, scaleOriginX = 0.5, scaleOriginY = 0.5, translateX = 0, translateY = 0 } = motion;
  const x1 = obj.x + obj.w * scaleOriginX * (1 - scaleX) + translateX;
  const y1 = obj.y + obj.h * scaleOriginY * (1 - scaleY) + translateY;
  return { x1, y1, x2: x1 + obj.w * scaleX, y2: y1 + obj.h * scaleY };
}

function _cleanOverlay(value) {
  if (Math.abs(value) < 1e-9) return 0;
  return Math.round(value * 1e9) / 1e9;
}

function beginRubberBandDrag() {
  if (_rubberBandDragActive) return;
  _rubberBandDragActive = true;
  _rubberBandShieldRelease = acquireInputShield();
}

function finishRubberBandDrag() {
  if (!_rubberBandDragActive) return;
  _rubberBandDragActive = false;
  if (_rubberBandShieldRelease) {
    _rubberBandShieldRelease();
    _rubberBandShieldRelease = null;
  }
}
var _rubberBandShieldRelease = null;

function cancelTextMinWidthWarm() {
  if (_textMinWidthWarmCancel) {
    _textMinWidthWarmCancel();
    _textMinWidthWarmCancel = null;
  }
  _textMinWidthWarmObjectId = '';
}

function scheduleTextMinWidthWarm(obj) {
  cancelTextMinWidthWarm();
  if (!obj || obj.type !== 'text') return;
  const objectId = obj.id || '';
  if (!objectId) return;
  _textMinWidthWarmObjectId = objectId;
  const run = () => {
    _textMinWidthWarmCancel = null;
    if (_textMinWidthWarmObjectId !== objectId) return;
    _textMinWidthWarmObjectId = '';
    if (selectedId !== objectId || !selectedIds.has(objectId)) return;
    const current = objectsMap.get(objectId);
    if (!current || current.type !== 'text') return;
    try { getTextMinWidth(current); } catch {}
  };
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 1000 });
    _textMinWidthWarmCancel = () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
    };
    return;
  }
  if (typeof setTimeout === 'function') {
    const handle = setTimeout(run, 250);
    _textMinWidthWarmCancel = () => clearTimeout(handle);
  }
}

var _dialogResolve = null;

function isUnsavedDialogOpen() {
  return _dialogResolve !== null;
}

function isEventInsideUnsavedDialog(e) {
  return !!unsavedDialog && e.target instanceof Node && unsavedDialog.contains(e.target);
}

const _inputEventPointElementCache = new WeakMap();

function pointedElementForInputEvent(e) {
  const cached = _inputEventPointElementCache.get(e);
  if (cached !== undefined) return cached;
  const x = Number(e?.clientX);
  const y = Number(e?.clientY);
  const pointed = Number.isFinite(x) && Number.isFinite(y)
    ? document.elementFromPoint(x, y)
    : null;
  const element = pointed instanceof Node ? pointed : null;
  _inputEventPointElementCache.set(e, element);
  return element;
}

const isEventInsideVisibleSurface = (e, surface) => {
  if (!surface || !surface.classList.contains('visible')) return false;
  if (e.target instanceof Node && surface.contains(e.target)) return true;
  // A concrete event target is already the browser's hit-test result. Only use
  // elementFromPoint for ambiguous document/window-targeted synthetic events.
  if (e.target instanceof Node && e.target.nodeType === 1) return false;
  const pointed = pointedElementForInputEvent(e);
  return pointed instanceof Node && surface.contains(pointed);
};

const isEventInsideVisibleContextMenu = (e) => {
  return (
    isEventInsideVisibleSurface(e, ctxMenu) ||
    isEventInsideVisibleSurface(e, objCtxMenu) ||
    isEventInsideVisibleSurface(e, textCtxMenu) ||
    isEventInsideVisibleSurface(e, ctxActions)
  );
};

const isEventInsideViewportWheelSurface = (e) => {
  return (e.target instanceof Node && canvas.contains(e.target)) ||
    isEventInsideVisibleContextMenu(e) || isEventInsideVisibleSurface(e, island);
};

function isShieldInputAllowed(e) {
  if (isUnsavedDialogOpen()) return isEventInsideUnsavedDialog(e);
  if (isEventInsideVisibleContextMenu(e)) return true;
  return !_boardOpening && _rubberBandDragActive &&
    _inputShieldStack.length === 1 &&
    (e.type === 'mousemove' || (e.type === 'mouseup' && e.button === 0));
}

function blockShieldInput(e) {
  if (!_boardOpening && !_inputShieldStack.length && _dialogResolve === null) return;
  if (
    e.type === 'keydown' &&
    (e.key === 'Escape' || e.key === 'Meta' || e.key === 'OS' || e.metaKey)
  ) {
    if (typeof cancelRubberBandSelection === 'function' && cancelRubberBandSelection()) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if (isShieldInputAllowed(e)) return;

  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
}
var INPUT_SHIELD_EVENT_OPTIONS = { capture: true, passive: false };
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'beforeinput', 'input', 'paste', 'drop', 'dragover']) {
  document.addEventListener(type, blockShieldInput, INPUT_SHIELD_EVENT_OPTIONS);
}

function _setStyleIfChanged(el, prop, value, state) {
  if (state[prop] === value) return;
  state[prop] = value;
  el.style[prop] = value;
}

const oppositeSelectionDir = function oppositeSelectionDir(dir) {
  if (dir === 'nw') return 'se';
  if (dir === 'ne') return 'sw';
  if (dir === 'se') return 'nw';
  if (dir === 'sw') return 'ne';
  return '';
};

const boundsCornerPoint = function boundsCornerPoint(bounds, dir) {
  if (!bounds || !dir) return null;
  return {
    x: dir.includes('e') ? bounds.x2 : bounds.x1,
    y: dir.includes('s') ? bounds.y2 : bounds.y1,
  };
};

function hideSelectionOverlay(clearSelection = false) {
  selOverlay.classList.toggle('visible', false);
  multiSelOverlay.classList.toggle('visible', false);
  if (clearSelection) BoardfishEditorState.clearSelection();
}

function updateSelectionOverlay() {
  if ((isBoardInputBlocked() && !shouldKeepSelectionOverlayWhileBlocked()) || !hasSelection()) return hideSelectionOverlay();

  const firstSelectedObj = getFirstSelectedObject();
  if (!firstSelectedObj) return hideSelectionOverlay(true);

  const resting = selectedBounds();
  const hasMotion = BoardfishMotion.hasLastDrawnObjectMotions();
  let bounds = resting;
  if (resting && hasMotion) {
    if (selectedIds.size === 1) {
      bounds = selectionOverlayObjectBounds(firstSelectedObj) || resting;
    } else {
      let translateX = 0, translateY = 0;
      _multiSelMotions.length = 0;
      for (const id of selectedIds) {
        const motion = _multiSelMotions[_multiSelMotions.length] = BoardfishMotion.getLastDrawnObjectMotion(id);
        if (!motion) continue;
        translateX += motion.groupTranslateX ?? motion.translateX ?? 0;
        translateY += motion.translateY ?? 0;
      }
      translateX /= selectedIds.size;
      translateY /= selectedIds.size;
      bounds = {
        x1: resting.x1 + translateX,
        y1: resting.y1 + translateY,
        x2: resting.x2 + translateX,
        y2: resting.y2 + translateY,
      };
    }
  }
  const { width, height } = _boardSurfaceCssSizeCache || boardSurfaceCssSize();
  const screenX1 = bounds.x1 * zoom + panX, screenY1 = bounds.y1 * zoom + panY;
  const screenX2 = bounds.x2 * zoom + panX, screenY2 = bounds.y2 * zoom + panY;
  if (!(screenX1 < width && screenX2 > 0 && screenY1 < height && screenY2 > 0)) return hideSelectionOverlay();

  const multiSelected = isMultiSelected();
  let imageEdgePad = firstSelectedObj.type === 'image' ? SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX : 0;
  if (!multiSelected) {
    multiSelOverlay.classList.toggle('visible', false);
  } else {
    while (_multiSelBoxes.length < selectedIds.size) {
      const box = document.createElement('div');
      box.className = 'multi-sel-box';
      box._styleState = { transform: '', width: '', height: '' };
      _multiSelBoxes.push(box);
      multiSelOverlay.appendChild(box);
    }
    let selectedIdx = 0, motionIdx = 0;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      const motion = hasMotion ? _multiSelMotions[motionIdx++] : null;
      if (!obj) continue;
      const resting = { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
      const bounds = hasMotion ? selectionOverlayObjectBounds(obj, motion) || resting : resting;
      const box = _multiSelBoxes[selectedIdx++];
      const state = box._styleState;
      const pad = obj.type === 'image' ? SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX : 0;
      imageEdgePad ||= pad;
      setSelectionOverlayScreenRect(box, state, resting, bounds, pad);
    }
    while (_multiSelBoxes.length > selectedIdx) {
      const box = _multiSelBoxes.pop();
      box?.parentNode?.removeChild(box);
    }
    multiSelOverlay.classList.toggle('visible', true);
  }
  setSelectionOverlayScreenRect(
    selOverlay,
    _selOverlayStyleState,
    resting,
    bounds,
    imageEdgePad,
  );
  const nextClasses = `visible${multiSelected ? ' multi' : ''}${editingId ? ' editing' : ''}${!multiSelected && firstSelectedObj.type === 'text' ? ' text-resize' : ''}`;
  if (selOverlay.className !== nextClasses) selOverlay.className = nextClasses;
}

const beginSelectionHandleDrag = function beginSelectionHandleDrag(handle, e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
      const resizeEast = dir.includes('e'), resizeWest = dir.includes('w');
      const startX = e.clientX, startY = e.clientY;
      const obj = objectsMap.get(selectedId);

      // ── Images and multi-select: scale non-text objects proportionally within the bounding box ──
      if (isMultiSelected() || obj?.type !== 'text') {
        const bounds = selectedBounds();
        const handlePoint = boundsCornerPoint(bounds, dir);
        const anchorPoint = boundsCornerPoint(bounds, oppositeSelectionDir(dir));
        if (!handlePoint || !anchorPoint) return;
        const spanX = handlePoint.x - anchorPoint.x;
        const spanY = handlePoint.y - anchorPoint.y;
        if (!spanX || !spanY) return;

        const MIN_OBJECT_SIZE = 100;
        let minObjectScale = 0;
        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          if (
            !Number.isFinite(o.x) ||
            !Number.isFinite(o.y) ||
            !Number.isFinite(o.w) ||
            !Number.isFinite(o.h) ||
            o.w <= 0 ||
            o.h <= 0
          ) {
            continue;
          }
          snapshots.push({
            obj: o,
            x: o.x,
            y: o.y,
            w: o.w, h: o.h,
          });
          minObjectScale = Math.max(minObjectScale, MIN_OBJECT_SIZE / o.w, MIN_OBJECT_SIZE / o.h);
        }
        if (!snapshots.length) return;

        minObjectScale = Math.min(1, minObjectScale);
        const resizeCommitter = createRafCommitter((x, y, eventZoom) => {
          const invZoom = 1 / eventZoom;
          const dx = (x - startX) * invZoom, dy = (y - startY) * invZoom;
          const scale = Math.max(minObjectScale, Math.min((spanX + dx) / spanX, (spanY + dy) / spanY));
          for (const snap of snapshots) {
            const o = snap.obj;
            o.x = anchorPoint.x + (snap.x - anchorPoint.x) * scale;
            o.y = anchorPoint.y + (snap.y - anchorPoint.y) * scale;
            o.w = snap.w * scale;
            o.h = snap.h * scale;
          }
          drawBoard(); updateSelectionOverlay();
        });

        beginDocumentDrag({
          move: (ev) => resizeCommitter.schedule(ev.clientX, ev.clientY, zoom),
          up() {
            resizeCommitter.flush();
            pushHistory('multi-resize', snapshots);
          },
        });
        return;
      }

      // ── Single text: resize width only ──
      const { x: ox, y: oy, w: ow } = obj;

      let dragMinTextW = null;
      function applyResize(clientX, eventZoom) {
        const dx = (clientX - startX) / eventZoom;
        let x = ox, y = oy, w = ow;

        if (dragMinTextW == null) {
          dragMinTextW = getTextMinWidth(obj);
        }

        if (resizeEast) w = Math.max(dragMinTextW, ow + dx);
        if (resizeWest) { w = Math.max(dragMinTextW, ow - dx); x = ox + ow - w; }

        const render = obj.w !== w;
        obj.x = x;
        obj.y = y;
        obj.w = w;

        if (render) {
          resetTextEditPreservedMinLines(obj);
          syncTextAutoHeight(obj, getTextMinLines(obj));
        }

        if (render) drawBoard(), updateSelectionOverlay();
      }
      const resizeCommitter = createRafCommitter(applyResize);

      beginDocumentDrag({
        move: (ev) => resizeCommitter.schedule(ev.clientX, zoom),
        up() {
          resizeCommitter.flush();

          pushHistory('resize', [obj.id]);
        },
      });
};

// Init overlay handle listeners once — they always operate on selectedId / selectedIds
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => beginSelectionHandleDrag(handle, e));
  }
})();

// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  BoardfishEditorState.setSelection([id], { primaryId: id });
  const obj = objectsMap.get(id);
  if (obj) bringObjectToFront(obj);
  scheduleTextMinWidthWarm(obj);
  scheduleRender(true, true);
}

function deselectAll() {
  if (editingId) exitEdit();
  cancelTextMinWidthWarm();
  BoardfishEditorState.clearSelection();
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  cancelTextMinWidthWarm();
  const ids = new Array(objects.length);
  for (let i = 0; i < objects.length; i++) ids[i] = objects[i].id;
  BoardfishEditorState.setSelection(ids, { primaryId: objects[objects.length - 1].id });
  scheduleRender(false, true);
}

function hideMenus() {
  closeOpenMenusExcept('');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

const normalizeTextEditHistoryState = (id, state = null) => {
  const targetId = id || state?.id || editingId;
  if (!targetId) return null;
  const obj = objectsMap.get(targetId);
  const valueLength = typeof state?.value === 'string'
    ? state.value.length
    : (_editEl
        ? textEditProxyValue(_editEl).length
        : (obj?.data?.content?.length || 0));
  const start = Math.max(0, Math.min(state?.start ?? state?.selectionStart ?? _editEl?.selectionStart ?? 0, valueLength));
  const end = Math.max(0, Math.min(state?.end ?? state?.selectionEnd ?? start, valueLength));
  return {
    id: targetId,
    selectionStart: start,
    selectionEnd: end,
    selectionDirection: state?.direction || state?.selectionDirection || _editEl?.selectionDirection || 'none',
  };
};

const beginTextEditHistoryAction = (id = editingId, state = null) => {
  if (!id) return null;
  const splitPending = shouldCommitTextEditInputImmediately(
    state?.inputType,
    state?.hasSelection ?? (state?.start !== state?.end),
  );

  if (splitPending) {
    if (_editHistoryTimer) flushEditHistoryCheckpoint();
    if (_editHistoryActionStartState?.id === id) _editHistoryActionStartState = null;
  }

  if (!_editHistoryActionStartState || _editHistoryActionStartState.id !== id) {
    _editHistoryActionStartState = normalizeTextEditHistoryState(id, state);
  }

  return _editHistoryActionStartState;
};

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return false;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return false;
  const beforeEditState = _editHistoryActionStartState?.id === id ? _editHistoryActionStartState : null;
  _editHistoryActionStartState = null;

  pushHistory('text-edit-checkpoint', null, beforeEditState);
  _editHistoryLastContent = obj.data.content;
  return true;
}

const clearEditHistoryCheckpointTimer = () => {
  if (_editHistoryTimer) {
    clearTimeout(_editHistoryTimer);
    _editHistoryTimer = null;
  }
};

function flushEditHistoryCheckpoint() {
  clearEditHistoryCheckpointTimer();
  if (typeof _textInputSelectionHistorySuppress !== 'undefined') _textInputSelectionHistorySuppress = null;
  if (!editingId) return false;
  return pushEditHistoryIfChanged(editingId);
}

const shouldCommitTextEditInputImmediately = (inputType = '', hadSelection = false) =>
  hadSelection || inputType.includes('Paste') || inputType.includes('Cut');

const recordTextEditInputHistory = (id, inputType = '', hadSelection = false) => {
  clearEditHistoryCheckpointTimer();
  if (shouldCommitTextEditInputImmediately(inputType, hadSelection)) {
    return pushEditHistoryIfChanged(id);
  }
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
  return false;
};
