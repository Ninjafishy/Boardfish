// ─── Zoom ─────────────────────────────────────────────────────────────────────
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null, _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;
var _textInputSelectionHistorySuppress = null, _editHistoryActionStartState = null;

function selectionSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function focusTextEditProxyNow(proxy) {
  if (!proxy || (typeof document !== 'undefined' && document.activeElement === proxy)) return false;
  proxy.focus({ preventScroll: true });
  return true;
}

function handleViewportWheel(e) {
  if (!e.ctrlKey && !e.metaKey && !isEventInsideViewportWheelSurface(e)) return;

    e.preventDefault();
    if (_rubberBandDragActive) {
      return;
    }
    if (editingId) {
      _caretVisible = true;
    }
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.pow(0.995, e.deltaY);
      const requestedZoom = zoom * factor;
      scheduleTransform(BoardfishViewportState.zoomAroundClient(e.clientX, e.clientY, requestedZoom));

      return;
    }

    scheduleTransform(BoardfishViewportState.panBy(-e.deltaX, -e.deltaY));
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('wheel', handleViewportWheel, { capture: true, passive: false });
}

// ─── Pan (spacebar + left click) ─────────────────────────────────────────────
var _spaceDown = false,
  _rubberBandSelectionCleanup = null,
  hideRubberBandSelectionVisual = null,
  cancelRubberBandSelection = null;

document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  if (_spaceDown || !editingId) e.preventDefault();
  _spaceDown = false;
  canvas.classList.remove('panning');
});

function dragItemsForSelection() {
  const items = [];
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o) items.push({ obj: o, startX: o.x, startY: o.y });
  }
  return items;
}

function startMousePan(e) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;

  let lastClientX = startX;
  let lastClientY = startY;

  function onMove(ev) {
      const clientStepX = ev.clientX - lastClientX;
      const clientStepY = ev.clientY - lastClientY;
      if (!clientStepX && !clientStepY) return;

      scheduleTransform(BoardfishViewportState.panBy(clientStepX, clientStepY));

      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
  }
  function onUp(ev) {}
  beginDocumentDrag({ move: onMove, up: onUp });
}

function createSelectionDragSession(startClientX, startClientY) {
  const grpItems = dragItemsForSelection();
  if (!grpItems.length) return null;
  const dragZoom = Math.max(0.0001, zoom);
  let grpMoved = false;
  let finished = false;
  function move(clientX, clientY) {
    if (finished || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const dx = clientX - startClientX;
    const dy = clientY - startClientY;
    if (!grpMoved && dx*dx + dy*dy > 9) grpMoved = true;
    if (!grpMoved) return false;
    const worldDx = dx / dragZoom, worldDy = dy / dragZoom;
    for (const item of grpItems) { item.obj.x = item.startX + worldDx; item.obj.y = item.startY + worldDy; }
    scheduleRender(true, true);
    return true;
  }
  function finish() {
    if (finished) return false;
    finished = true;
    if (!grpMoved) return false;
    pushHistory('drag', grpItems);
    return true;
  }
  return { move, finish };
}

function startGroupDrag(e) {
  const drag = createSelectionDragSession(e.clientX, e.clientY);
  if (!drag) return;
  beginDocumentDrag({
    move: (ev) => drag.move(ev.clientX, ev.clientY),
    up: drag.finish,
  });
}

function startSelectedRegionDrag(e) {
  if (editingId || !rectContainsPoint(selectedBounds(), toWorld(e.clientX, e.clientY))) return false;
  return createSelectionDragSession(e.clientX, e.clientY);
}

hideRubberBandSelectionVisual = () => {
  finishRubberBandDrag();
  rubberBand.style.display = 'none';
};

cancelRubberBandSelection = (reason = 'cancel') => {
  if (!_rubberBandDragActive) return false;
  const cancelEvent = { __boardfishRubberBandCancel: true, reason };
  if (_rubberBandSelectionCleanup) _rubberBandSelectionCleanup(cancelEvent);
  else hideRubberBandSelectionVisual();
  return true;
};

function startRubberBandSelection(e, additive) {
  cancelRubberBandSelection('restart');
  if (!additive) deselectAll();
  const rbStartX = e.clientX, rbStartY = e.clientY;
  beginRubberBandDrag();
  let rbActive = false;
  let rbFinished = false;
  const rbStyleCommitter = createRafCommitter((x, y, dx, dy) => {
    rubberBand.style.cssText = `display:block;left:${Math.min(rbStartX, x)}px;top:${Math.min(rbStartY, y)}px;width:${Math.abs(dx)}px;height:${Math.abs(dy)}px`;
  });
  function onRbMove(ev) {
    const dx = ev.clientX - rbStartX, dy = ev.clientY - rbStartY;
    if (!rbActive && dx*dx + dy*dy > 16) rbActive = true;
    if (!rbActive) return;
    rbStyleCommitter.schedule(ev.clientX, ev.clientY, dx, dy);
  }
  function onRbUp(ev) {
    if (rbFinished) return;
    rbFinished = true;
    _rubberBandSelectionCleanup = null;
    rbStyleCommitter.flush();
    hideRubberBandSelectionVisual();
    if (ev?.__boardfishRubberBandCancel || ev?.__boardfishDragCancel) return;
    if (!rbActive) return;
    const a = toWorld(Math.min(rbStartX, ev.clientX), Math.min(rbStartY, ev.clientY));
    const b = toWorld(Math.max(rbStartX, ev.clientX), Math.max(rbStartY, ev.clientY));
    const rbRect = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const nextSelection = additive ? new Set(selectedIds) : new Set();
    for (const o of objects) {
      if (objectIntersectsRect(o, rbRect)) {
        nextSelection.add(o.id);
      }
    }
    if (selectionSetsEqual(nextSelection, selectedIds)) return;
    BoardfishEditorState.setSelection(nextSelection);
    scheduleRender(false, true);
  }
  _rubberBandSelectionCleanup = beginDocumentDrag({ move: onRbMove, up: onRbUp });
}

function toggleAdditiveSelection(obj) {
  const nextSelection = new Set(selectedIds);
  const selecting = !isSelected(obj.id);
  if (selecting) nextSelection.add(obj.id); else nextSelection.delete(obj.id);
  BoardfishEditorState.setSelection(nextSelection, selecting ? { primaryId: obj.id } : {});
  if (selecting) bringObjectToFront(obj);
  scheduleRender(selecting, true);
}

function applyTextEditCaretHit(obj, proxy, hit) {
  if (!obj || !proxy || !hit) return;
  const textContent = obj.data?.content || '';
  const index = hit.index;
  setTextEditProxySelectionRange(proxy, index, index, 'none', textContent);
  setTextEditCaretIndex(obj, index, hit.lineStartIndex);
}

function textCaretHitAtWorldPoint(obj, point, preferFull = false) {
  const visible = preferFull && obj._layoutCache
    ? getTextLayout(obj)
    : getTextLayoutForViewport(obj, { y1: point.y, y2: point.y });
  const layout = visible.length ? visible : getTextLayout(obj);

  const hit = layoutHitTestCaret(layout, point.x, point.y, obj);

  return hit;
}

function startTextSelectionDrag(e, obj, wp) {
  flushEditHistoryCheckpoint();
  const el = _editEl;

  const clickHit = textCaretHitAtWorldPoint(obj, wp, true);
  const clickIdx = clickHit.index;
  applyTextEditCaretHit(obj, el, clickHit);
  focusTextEditProxyNow(el);

  _caretVisible = true;
  scheduleRender(true, false);
  function onSelMove(ev) {
    if (_editEl !== el) return;
    const wp2 = toWorld(ev.clientX, ev.clientY);

    const endHit = obj._layoutCache
      ? layoutHitTestCaret(obj._layoutCache, wp2.x, wp2.y, obj)
      : textCaretHitAtWorldPoint(obj, wp2, false);
    const endIdx = endHit.index;
    const start = Math.min(clickIdx, endIdx);
    const end = Math.max(clickIdx, endIdx);
    if (clickIdx === endIdx) applyTextEditCaretHit(obj, el, endHit);
    else if (el.selectionStart !== start || el.selectionEnd !== end) {
      setTextEditProxySelectionRange(el, start, end, 'none', obj.data?.content || '');
      clearTextEditCaretIndex(obj);
    } else return;

    _caretVisible = true;
    scheduleRender(true, false);
  }
  function onSelUp(ev) {
    if (!ev || ev.__boardfishDragCancel) return;
  }
  beginDocumentDrag({ move: onSelMove, up: onSelUp });
}

function startObjectDrag(e, obj) {
  const wasSelected = isSelected(obj.id);
  const canClickToEditText = obj.type === 'text' && wasSelected && selectedIds.size === 1;
  if (!wasSelected) selectObject(obj.id);
  const startX = e.clientX, startY = e.clientY;
  const drag = createSelectionDragSession(startX, startY);

  function onUp(ev) {
    if (!drag.finish()) {
      if (!isSelected(obj.id)) selectObject(obj.id);
      if (canClickToEditText) {
        enterEdit(obj.id, { placeInitialCaret: false });

        if (_editEl && ev) {
          const upPoint = toWorld(ev.clientX, ev.clientY);

          const clickHit = textCaretHitAtWorldPoint(obj, upPoint, false);

          applyTextEditCaretHit(obj, _editEl, clickHit);

          _caretVisible = true;
          if (ev?.isTrusted) {
            focusTextEditProxyNow(_editEl);
          }
        }
      }
    }
  }
  beginDocumentDrag({ move: (ev) => drag.move(ev.clientX, ev.clientY), up: onUp });
}

canvas.addEventListener('mousedown', (e) => {
  // Spacebar pan
  if (e.button === 0 && _spaceDown) {
    startMousePan(e);
    return;
  }

  if (e.button !== 0) return;

  // Don't capture clicks on sel-overlay handles
  if (e.target !== canvas && e.target !== boardCanvas) return;

  e.preventDefault();

  const wp = toWorld(e.clientX, e.clientY);

  const additive = e.metaKey || e.ctrlKey;
  const canGroupDrag = isMultiSelected() && !additive;
  const groupDragFromBounds = canGroupDrag && rectContainsPoint(selectedBounds(), wp);

  const obj = groupDragFromBounds ? null : BoardObjectGeometry.topObjectAtWorldPoint(wp);
  const groupDrag = groupDragFromBounds || (canGroupDrag && isSelected(obj?.id));

  // Multi-select: drag from its bounds or a rotated selected object extending beyond them.
  if (groupDrag) { startGroupDrag(e); return; }

  if (!obj) {
    startRubberBandSelection(e, additive);
    return;
  }

  if (additive) {
    toggleAdditiveSelection(obj);
    return;
  }

  // Click inside the currently edited text object: position caret / start drag-select
  if (editingId && obj.id === editingId && selectedIds.size === 1) {
    startTextSelectionDrag(e, obj, wp);
    return;
  }

  startObjectDrag(e, obj);
});
