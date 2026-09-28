// ─── Zoom ─────────────────────────────────────────────────────────────────────
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null, _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;
var _textInputSelectionHistorySuppress = null, _editHistoryActionStartState = null;

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function canvasInputNow() {
  return performance.now();
}

function canvasInputDebugRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function canvasInputEventTimestampMs(event = null) {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return canvasInputNow();
  return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
}

function canvasInputWheelDeltaScale(deltaMode) {
  if (deltaMode === 1) return 16;
  if (deltaMode === 2) return Math.max(1, Number(window.innerHeight) || 1);
  return 1;
}

function canvasInputWheelDebugMeta(e) {
  const deltaMode = Number(e?.deltaMode) || 0;
  const scale = canvasInputWheelDeltaScale(deltaMode);
  return {
    deltaMode,
    deltaModeLabel: deltaMode === 1 ? 'line' : deltaMode === 2 ? 'page' : 'pixel',
    deltaX: e?.deltaX ?? '',
    deltaY: e?.deltaY ?? '',
    deltaZ: e?.deltaZ ?? '',
    wheelDeltaXPx: (Number(e?.deltaX) || 0) * scale,
    wheelDeltaYPx: (Number(e?.deltaY) || 0) * scale,
    wheelDeltaZPx: (Number(e?.deltaZ) || 0) * scale,
  };
}

function canvasInputEventDebugMeta(e) {
  const eventAt = canvasInputEventTimestampMs(e);
  return {
    eventAt,
    eventAgeMs: Math.max(0, canvasInputNow() - eventAt),
    eventType: e?.type || '',
    clientX: e?.clientX ?? '',
    clientY: e?.clientY ?? '',
    button: e?.button ?? '',
    buttons: e?.buttons ?? '',
    movementX: e?.movementX ?? '',
    movementY: e?.movementY ?? '',
    ctrlKey: !!e?.ctrlKey,
    metaKey: !!e?.metaKey,
    shiftKey: !!e?.shiftKey,
    altKey: !!e?.altKey,
    defaultPrevented: !!e?.defaultPrevented,
    cancelable: !!e?.cancelable,
    isTrusted: e?.isTrusted ?? '',
  };
}

function canvasInputViewportDebugSnapshot(prefix = '') {
  const key = (name) => prefix ? `${name}${prefix}` : name;
  return {
    [key('panX')]: panX,
    [key('panY')]: panY,
    [key('zoom')]: zoom,
  };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function selectionSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function canvasInputTextDebugLog(label, obj = null, meta = {}) {
  if (typeof TextSelDebug === 'undefined') return;
  TextSelDebug._logEditLifecycle?.(label, obj, meta);
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function focusTextEditProxyNow(proxy
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , obj = null, label = null, meta = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    if (!proxy || (typeof document !== 'undefined' && document.activeElement === proxy)) return false;
    proxy.focus({ preventScroll: true });
    return true;
  } else {
    if (label == null) label = 'text-edit-focus';
    if (meta == null) meta = {};
    if (!proxy) return { focused: false, skipped: true, reason: 'missing-proxy', focusMs: '' };
    if (typeof document !== 'undefined' && document.activeElement === proxy) {
      const out = { focused: false, skipped: true, reason: 'already-active', focusMs: 0, activeElementIsProxy: true };
      canvasInputTextDebugLog(label, obj, { ...meta, ...out });
      return out;
    }
    const focusStart = canvasInputNow();
    proxy.focus({ preventScroll: true });
    const out = {
      focused: true,
      skipped: false,
      reason: '',
      focusMs: canvasInputDebugRound(canvasInputNow() - focusStart),
      activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === proxy : '',
    };
    canvasInputTextDebugLog(label, obj, { ...meta, ...out });
    return out;
  }
}

function handleViewportWheel(e) {
  if (!e.ctrlKey && !e.metaKey && !isEventInsideViewportWheelSurface(e)) return;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const collectDebug = ViewportDebug.isEnabled();
  const handlerStart = collectDebug ? canvasInputNow() : 0;
  const wheelMeta = collectDebug ? canvasInputWheelDebugMeta(e) : null;
  const eventMeta = collectDebug ? canvasInputEventDebugMeta(e) : null;
  const beforeMeta = collectDebug ? canvasInputViewportDebugSnapshot('Before') : null;
  const dbg = collectDebug
    ? ViewportDebug.start('wheel', {
      ...eventMeta,
      ...wheelMeta,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      ...beforeMeta,
      panX,
      panY,
      zoom,
    })
    : null;
  try {
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ViewportDebug.count('wheel');
    e.preventDefault();
    if (_rubberBandDragActive) {
      if (collectDebug) {
        ViewportDebug.recordPanZoom?.('wheel-blocked-rubber-band', {
          mode: 'blocked',
          source: 'wheel',
          blocked: true,
          reason: 'rubber-band',
          ...wheelMeta,
          ...beforeMeta,
          ...canvasInputViewportDebugSnapshot('After'),
        }, e);
        ViewportDebug.end(dbg, { mode: 'blocked-rubber-band', panX, panY, zoom });
      }
      return;
    }
    if (editingId) {
      _caretVisible = true;
    }
    if (e.ctrlKey || e.metaKey) {
      ViewportDebug.count('wheelZoom');
      const factor = Math.pow(0.995, e.deltaY);
      const requestedZoom = zoom * factor;
      scheduleTransform(BoardfishViewportState.zoomAroundClient(e.clientX, e.clientY, requestedZoom) /* BOARDFISH_DEV_DIAGNOSTICS_START */ , 'wheel-zoom', e /* BOARDFISH_DEV_DIAGNOSTICS_END */ );
      if (collectDebug) {
        const { panXBefore, panYBefore, zoomBefore } = beforeMeta;
        const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
        const zoomDeltaPct = zoomBefore ? ((zoom / zoomBefore) - 1) * 100 : 0;
        const panDeltaX = panX - panXBefore;
        const panDeltaY = panY - panYBefore;
        const focusWorldX = (e.clientX - panXBefore) / Math.max(zoomBefore || 1, 0.0001);
        const focusWorldY = (e.clientY - panYBefore) / Math.max(zoomBefore || 1, 0.0001);
        ViewportDebug.recordPanZoom?.('wheel-zoom', {
          mode: 'zoom',
          source: 'wheel-zoom',
          ...eventMeta,
          ...wheelMeta,
          panXBefore,
          panYBefore,
          zoomBefore,
          panXAfter: panX,
          panYAfter: panY,
          zoomAfter: zoom,
          panDeltaX,
          panDeltaY,
          panDistancePx: Math.hypot(panDeltaX, panDeltaY),
          zoomDelta: zoom - zoomBefore,
          zoomDeltaPct,
          factor,
          requestedZoom,
          clamped: zoom !== requestedZoom,
          focusWorldX,
          focusWorldY,
          handlerMs,
        }, e);
        ViewportDebug.end(dbg, {
          mode: 'zoom',
          source: 'wheel-zoom',
          newZoom: zoom,
          zoomBefore,
          zoomAfter: zoom,
          zoomDeltaPct,
          panX,
          panY,
          panDeltaX,
          panDeltaY,
          handlerMs,
        });
      }
      return;
    }

    ViewportDebug.count('wheelPan');
    scheduleTransform(BoardfishViewportState.panBy(-e.deltaX, -e.deltaY) /* BOARDFISH_DEV_DIAGNOSTICS_START */ , 'wheel-pan', e /* BOARDFISH_DEV_DIAGNOSTICS_END */ );
    if (collectDebug) {
      const { panXBefore, panYBefore, zoomBefore } = beforeMeta;
      const appliedPanX = -e.deltaX, appliedPanY = -e.deltaY;
      const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
      const panDeltaX = panX - panXBefore;
      const panDeltaY = panY - panYBefore;
      ViewportDebug.recordPanZoom?.('wheel-pan', {
        mode: 'pan',
        source: 'wheel-pan',
        ...eventMeta,
        ...wheelMeta,
        panXBefore,
        panYBefore,
        zoomBefore,
        panXAfter: panX,
        panYAfter: panY,
        zoomAfter: zoom,
        appliedPanX,
        appliedPanY,
        panDeltaX,
        panDeltaY,
        panDistancePx: Math.hypot(panDeltaX, panDeltaY),
        handlerMs,
      }, e);
      ViewportDebug.end(dbg, {
        mode: 'pan',
        source: 'wheel-pan',
        appliedDX: e.deltaX,
        appliedDY: e.deltaY,
        appliedPanX,
        appliedPanY,
        panX,
        panY,
        panDeltaX,
        panDeltaY,
        handlerMs,
      });
    }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  } finally {
    if (collectDebug) ViewportDebug.timing('wheelHandler', canvasInputNow() - handlerStart);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const collectPanDebug = ViewportDebug.isEnabled();
  const startDebugMeta = collectPanDebug ? {
    ...canvasInputEventDebugMeta(e),
    ...canvasInputViewportDebugSnapshot('Before'),
  } : null;
  const panDbg = collectPanDebug
    ? ViewportDebug.start('mousePan', { startX: e.clientX, startY: e.clientY, ...startDebugMeta, panX, panY, zoom })
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const startPanX = panX, startPanY = panY;
  const startZoom = zoom;
  const panStartedAt = collectPanDebug ? canvasInputNow() : 0;
  let moveCount = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let lastClientX = startX;
  let lastClientY = startY;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectPanDebug) {
    ViewportDebug.recordPanZoom?.('mouse-pan-start', {
      mode: 'pan',
      source: 'mouse-pan',
      ...startDebugMeta,
      startClientX: startX,
      startClientY: startY,
      panXBefore: startPanX,
      panYBefore: startPanY,
      zoomBefore: startZoom,
    }, e);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  function onMove(ev) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDebug = ViewportDebug.isEnabled();
    const handlerStart = collectDebug ? canvasInputNow() : 0;
    try {
      const panXBefore = panX;
      const panYBefore = panY;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const clientStepX = ev.clientX - lastClientX;
      const clientStepY = ev.clientY - lastClientY;
      if (!clientStepX && !clientStepY) return;
      ViewportDebug.count('mousePanMoves');
      scheduleTransform(BoardfishViewportState.panBy(clientStepX, clientStepY) /* BOARDFISH_DEV_DIAGNOSTICS_START */ , 'mouse-pan', ev /* BOARDFISH_DEV_DIAGNOSTICS_END */ );
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDebug) {
        const panDeltaX = panX - panXBefore;
        const panDeltaY = panY - panYBefore;
        const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
        moveCount++;
        ViewportDebug.recordPanZoom?.('mouse-pan-move', {
          mode: 'pan',
          source: 'mouse-pan',
          moveIndex: moveCount,
          ...canvasInputEventDebugMeta(ev),
          panXBefore,
          panYBefore,
          zoomBefore: startZoom,
          panXAfter: panX,
          panYAfter: panY,
          zoomAfter: zoom,
          startClientX: startX,
          startClientY: startY,
          clientDeltaX: ev.clientX - startX,
          clientDeltaY: ev.clientY - startY,
          clientStepX,
          clientStepY,
          panDeltaX,
          panDeltaY,
          panDistancePx: Math.hypot(panDeltaX, panDeltaY),
          cumulativePanX: panX - startPanX,
          cumulativePanY: panY - startPanY,
          handlerMs,
        }, ev);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    } finally {
      if (collectDebug) ViewportDebug.timing('mousePanHandler', canvasInputNow() - handlerStart);
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  function onUp(ev) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectPanDebug && (!ev || ev.__boardfishDragCancel || ev.button === 0)) {
      const panDeltaX = panX - startPanX;
      const panDeltaY = panY - startPanY;
      const panDistancePx = Math.hypot(panDeltaX, panDeltaY);
      ViewportDebug.recordPanZoom?.('mouse-pan-end', {
        mode: 'pan',
        source: 'mouse-pan',
        ...(ev ? canvasInputEventDebugMeta(ev) : {}),
        startClientX: startX,
        startClientY: startY,
        endClientX: ev?.clientX ?? '',
        endClientY: ev?.clientY ?? '',
        panXBefore: startPanX,
        panYBefore: startPanY,
        zoomBefore: startZoom,
        panXAfter: panX,
        panYAfter: panY,
        zoomAfter: zoom,
        panDeltaX,
        panDeltaY,
        panDistancePx,
        moveCount,
        durationMs: canvasInputNow() - panStartedAt,
        cancelled: !!ev?.__boardfishDragCancel,
      }, ev);
      ViewportDebug.end(panDbg, {
        endX: ev?.clientX ?? '',
        endY: ev?.clientY ?? '',
        panX,
        panY,
        zoom,
        panDeltaX,
        panDeltaY,
        panDistancePx,
        moveCount,
        cancelled: !!ev?.__boardfishDragCancel,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
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
    scheduleRender(true, true /* BOARDFISH_DEV_DIAGNOSTICS_START */ , 'drag' /* BOARDFISH_DEV_DIAGNOSTICS_END */ );
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

function textCaretHitAtWorldPoint(obj, point, preferFull = false
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , source
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const layoutStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const visible = preferFull && obj._layoutCache
    ? getTextLayout(obj)
    : getTextLayoutForViewport(obj, { y1: point.y, y2: point.y });
  const layout = visible.length ? visible : getTextLayout(obj);
  TextSelDebug._logLayout?.(source + '-layout', obj, layout, canvasInputNow() - layoutStart);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hitStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const hit = layoutHitTestCaret(layout, point.x, point.y, obj);
  TextSelDebug._logHitTiming?.(source + '-hit', obj, hit, canvasInputNow() - hitStart, { wx: point.x, wy: point.y });
  return hit;
}

function startTextSelectionDrag(e, obj, wp) {
  flushEditHistoryCheckpoint();
  const el = _editEl;
  TextSelDebug._logPointer?.('selection-drag-start', e, { objectId: obj?.id || '', wx: wp.x, wy: wp.y });
  const clickHit = textCaretHitAtWorldPoint(obj, wp, true
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , 'selection-drag-start'
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
  const clickIdx = clickHit.index;
  applyTextEditCaretHit(obj, el, clickHit);
  focusTextEditProxyNow(el
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , obj, 'selection-drag-focus', {
      phase: 'selection-drag',
      clientX: e?.clientX ?? '',
      clientY: e?.clientY ?? '',
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
  TextSelDebug._logSelection('mouse-down', el, obj);
  _caretVisible = true;
  scheduleRender(true, false);
  function onSelMove(ev) {
    if (_editEl !== el) return;
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-move', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    const endHit = obj._layoutCache
      ? layoutHitTestCaret(obj._layoutCache, wp2.x, wp2.y, obj)
      : textCaretHitAtWorldPoint(obj, wp2, false
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , 'selection-drag-move'
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    const endIdx = endHit.index;
    const start = Math.min(clickIdx, endIdx);
    const end = Math.max(clickIdx, endIdx);
    if (clickIdx === endIdx) applyTextEditCaretHit(obj, el, endHit);
    else if (el.selectionStart !== start || el.selectionEnd !== end) {
      setTextEditProxySelectionRange(el, start, end, 'none', obj.data?.content || '');
      clearTextEditCaretIndex(obj);
    } else return;
    TextSelDebug._logSelection('mouse-drag', el, obj);
    _caretVisible = true;
    scheduleRender(true, false);
  }
  function onSelUp(ev) {
    if (!ev || ev.__boardfishDragCancel) return;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-end', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    if (_editEl) TextSelDebug._logSelection('mouse-up', _editEl, obj);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const clickEditStart = canvasInputNow();
        let clickEditStepStart = clickEditStart;
        const logClickEditStep = (label, meta = {}) => {
          const t = canvasInputNow();
          canvasInputTextDebugLog(label, obj, {
            phase: 'click-to-edit',
            clientX: ev?.clientX ?? '',
            clientY: ev?.clientY ?? '',
            startClientX: startX,
            startClientY: startY,
            selectedCount: selectedIds.size,
            wasSelected,
            canClickToEditText,
            ms: canvasInputDebugRound(t - clickEditStepStart),
            totalMs: canvasInputDebugRound(t - clickEditStart),
            ...meta,
          });
          clickEditStepStart = t;
        };
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        logClickEditStep('click-to-edit-start', {
          hasEditProxy: !!_editEl,
          previousEditingId: editingId || '',
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const enterEditStart = canvasInputNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        enterEdit(obj.id, { placeInitialCaret: false });
        logClickEditStep('click-to-edit-enter-edit', {
          enterEditMs: canvasInputDebugRound(canvasInputNow() - enterEditStart),
          hasEditProxy: !!_editEl,
          editingId: editingId || '',
        });
        if (_editEl && ev) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const worldStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          const upPoint = toWorld(ev.clientX, ev.clientY);
          logClickEditStep('click-to-edit-world-point', {
            wx: upPoint.x,
            wy: upPoint.y,
            worldPointMs: canvasInputDebugRound(canvasInputNow() - worldStart),
          });
          const clickHit = textCaretHitAtWorldPoint(obj, upPoint, false
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            , 'click-to-edit'
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          );
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const caretStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          applyTextEditCaretHit(obj, _editEl, clickHit);
          logClickEditStep('click-to-edit-caret-applied', {
            caretApplyMs: canvasInputDebugRound(canvasInputNow() - caretStart),
            selectionStart: _editEl.selectionStart ?? '',
            selectionEnd: _editEl.selectionEnd ?? '',
            selectionDirection: _editEl.selectionDirection || 'none',
            textEditCaretIndex: obj._textEditCaretIndex ?? '',
            textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
          });
          TextSelDebug._logSelection('click-to-edit', _editEl, obj);
          _caretVisible = true;
          if (ev?.isTrusted) {
            if (typeof BOARDFISH_PRODUCTION === 'undefined') {
              /* BOARDFISH_DEV_DIAGNOSTICS_START */
              const focusResult = focusTextEditProxyNow(_editEl, obj, 'click-to-edit-focus', {
                phase: 'click-to-edit',
                clientX: ev?.clientX ?? '',
                clientY: ev?.clientY ?? '',
                startClientX: startX,
                startClientY: startY,
                selectedCount: selectedIds.size,
                wasSelected,
                canClickToEditText,
                selectionStart: _editEl.selectionStart ?? '',
                selectionEnd: _editEl.selectionEnd ?? '',
              });
              logClickEditStep('click-to-edit-focus', {
                focusResult,
                activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === _editEl : '',
              });
              /* BOARDFISH_DEV_DIAGNOSTICS_END */
            } else {
              focusTextEditProxyNow(_editEl);
            }
          }
        }
        logClickEditStep('click-to-edit-end', {
          hasEditProxy: !!_editEl,
          editingId: editingId || '',
          clickToEditTotalMs: canvasInputDebugRound(canvasInputNow() - clickEditStart),
        });
      }
    }
  }
  beginDocumentDrag({ move: (ev) => drag.move(ev.clientX, ev.clientY), up: onUp });
}

canvas.addEventListener('mousedown', (e) => {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const mouseDownStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  // Spacebar pan
  if (e.button === 0 && _spaceDown) {
    startMousePan(e);
    return;
  }

  if (e.button !== 0) return;

  // Don't capture clicks on sel-overlay handles
  if (e.target !== canvas && e.target !== boardCanvas) return;

  e.preventDefault();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const worldStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const wp = toWorld(e.clientX, e.clientY);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const worldPointMs = canvasInputDebugRound(canvasInputNow() - worldStart);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const additive = e.metaKey || e.ctrlKey;
  const canGroupDrag = isMultiSelected() && !additive;
  const groupDragFromBounds = canGroupDrag && rectContainsPoint(selectedBounds(), wp);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hitStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const obj = groupDragFromBounds ? null : BoardObjectGeometry.topObjectAtWorldPoint(wp);
  const groupDrag = groupDragFromBounds || (canGroupDrag && isSelected(obj?.id));
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hitTestMs = canvasInputDebugRound(canvasInputNow() - hitStart);
  canvasInputTextDebugLog('canvas-mousedown-route', obj, {
    phase: 'canvas-mousedown',
    clientX: e.clientX,
    clientY: e.clientY,
    wx: wp.x,
    wy: wp.y,
    button: e.button,
    detail: e.detail ?? '',
    additive,
    groupDrag,
    worldPointMs,
    hitTestMs,
    hitObjectId: obj?.id || '',
    hitObjectType: obj?.type || '',
    hitObjectSelected: obj ? isSelected(obj.id) : '',
    selectedCount: selectedIds.size,
    editingId: editingId || '',
    ms: canvasInputDebugRound(canvasInputNow() - mouseDownStart),
    totalMs: canvasInputDebugRound(canvasInputNow() - mouseDownStart),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

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
