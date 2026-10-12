// ─── Viewport ─────────────────────────────────────────────────────────────────
var panX = 0, panY = 0, zoom = 1;
var drawSingleObj, setWorldCanvasTransform, drawVisibleObjects;

var short_message = 1500;
var long_message = 3 * short_message;
var _islMsgActive = false;
var _islMsgTimer = null;
var _islMsgToken = 0;
var _islandSyncedZoom = NaN;

const formatZoomPercent = () => {
  const pct = Math.max(0, (Number.isFinite(zoom) ? zoom : 1) * 100);
  const roundedPct = Math.round(pct * 10) / 10;
  if (roundedPct >= 10) return `${Math.round(pct)}%`;
  return `${Math.max(0.1, roundedPct).toFixed(1)}%`;
};

const setPillMessageText = (text) => {
  const nextText = text == null ? '' : String(text);
  islZoom.textContent = nextText;
};

function setIslandVisible() {
  island.classList.add('visible');
  if (island.getAttribute?.('aria-hidden') !== 'false') island.setAttribute('aria-hidden', 'false');
}

const syncIslandZoomDisplay = () => {
  if (_islMsgActive) return;
  _islandSyncedZoom = zoom;
  const zoomText = formatZoomPercent();
  if (island.dataset.mode === 'zoom' && islZoom.textContent === zoomText && island.classList.contains('visible')) return;
  if (islZoom.textContent !== zoomText) islZoom.textContent = zoomText;
  if (island.dataset.mode !== 'zoom') island.dataset.mode = 'zoom';
  if (island.title !== 'Reset Zoom') island.title = 'Reset Zoom';
  setIslandVisible();
};

function showIslandForMessage(text) {
  island.dataset.mode = 'message';
  island.title = '';
  setIslandVisible();
  setPillMessageText(text);
}

function hideIsland() {
  ++_islMsgToken;
  clearTimeout(_islMsgTimer);
  _islMsgTimer = null;
  _islMsgActive = false;
  syncIslandZoomDisplay();
}

function startIslandBusyMsg(text) {
  showIslandMsg(text);
  const token = _islMsgToken;

  return {
    update(nextText) {
      if (token !== _islMsgToken) return;
      setPillMessageText(nextText);
    },
    done(finalMsg = null, duration = short_message) {
      if (token !== _islMsgToken) return;
      if (finalMsg) return showIslandMsg(finalMsg, duration);
      hideIsland();
    },
  };
}

function finishPillTask({
  beforeFinish = null,
  busyPill = null,
  finalMsg = null,
  duration = short_message,
} = {}) {
  beforeFinish();
  if (busyPill) return busyPill.done(finalMsg, duration);
  if (finalMsg) return showIslandMsg(finalMsg, duration);
  hideIsland();
}

function showIslandMsg(msg, duration = 0) {
  const token = ++_islMsgToken;

  clearTimeout(_islMsgTimer);
  _islMsgTimer = null;
  _islMsgActive = true;
  showIslandForMessage(msg);

  if (duration > 0) {
    _islMsgTimer = setTimeout(() => {
      if (token !== _islMsgToken) return;
      _islMsgTimer = null;

      hideIsland();
    }, duration);
  }
}
syncIslandZoomDisplay();
// ─── Offscreen buffer ─────────────────────────────────────────────────────────
var _offscreen = document.createElement('canvas');
var _offCtx    = _offscreen.getContext('2d');
var _offscreenDirty = true;
function invalidateOffscreen() {
  _offscreenDirty = true;
}

function _rebuildOffscreen(dpr, viewportRect) {
  if (_offscreen.width !== boardCanvas.width) _offscreen.width = boardCanvas.width;
  if (_offscreen.height !== boardCanvas.height) _offscreen.height = boardCanvas.height;
  _offCtx.resetTransform();
  fillBoardBackground(_offCtx, _offscreen.width, _offscreen.height);
  setWorldCanvasTransform(_offCtx, dpr);
  const view = { zoom, dpr };
  for (const obj of objects) {
    if (obj.type === 'text') continue;
    if (!objectIntersectsRect(obj, viewportRect)) continue;
    drawSingleObj(_offCtx, obj, viewportRect, view);
  }
  _offscreenDirty = false;
}

// ─── History delta tracking ───────────────────────────────────────────────────
var _dirtyIds = new Set();
function markDirty(obj) {
  _dirtyIds.add(obj.id);
}

// ─── Canvas resize ────────────────────────────────────────────────────────────

var _canvasResizeObserver = null;
var _boardSurfaceCssSizeCache = null;

function boardSurfaceCssSize() {
  if (_boardSurfaceCssSizeCache) return _boardSurfaceCssSizeCache;
  const rect = canvas?.getBoundingClientRect?.();
  let width = Number(rect?.width), height = Number(rect?.height);
  if (!(width > 0)) width = Number(boardCanvas?.clientWidth);
  if (!(width > 0)) width = Number(window.innerWidth);
  if (!(width > 0)) width = 1;
  if (!(height > 0)) height = Number(boardCanvas?.clientHeight);
  if (!(height > 0)) height = Number(window.innerHeight);
  if (!(height > 0)) height = 1;
  return _boardSurfaceCssSizeCache = { width, height };
}

function syncBoardCanvasBackingStore(write = true) {
  const dpr = window.devicePixelRatio || 1;
  const surface = boardSurfaceCssSize();
  const width = Math.max(1, Math.round(surface.width * dpr));
  const height = Math.max(1, Math.round(surface.height * dpr));
  if (boardCanvas.width === width && boardCanvas.height === height) return false;
  if (!write) return true;
  if (boardCanvas.width !== width) boardCanvas.width = width;
  if (boardCanvas.height !== height) boardCanvas.height = height;
  invalidateOffscreen();
  return true;
}

function resizeCanvas(surface = null) {
  _boardSurfaceCssSizeCache = surface?.width > 0 && surface?.height > 0 ? surface : surface?.type === 'resize' && _canvasResizeObserver?.observe && _boardSurfaceCssSizeCache;
  if (typeof _boardOpening !== 'undefined' && _boardOpening) return false;
  if (!syncBoardCanvasBackingStore(false)) return false;
  // Changing a canvas backing dimension clears its visible pixels. Defer that
  // reset to drawBoard so keyboard-driven resize bursts keep the previous frame
  // visible and the eventual clear + redraw happen together before paint.
  scheduleRender(true);
  return true;
}

function startCanvasSizeTracking() {
  if (_canvasResizeObserver) return;
  _canvasResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => resizeCanvas(entries?.[0]?.contentRect))
    : window.visualViewport || window;
  if (_canvasResizeObserver.observe) _canvasResizeObserver.observe(canvas);
  else _canvasResizeObserver.addEventListener('resize', resizeCanvas);
  window.addEventListener?.('resize', resizeCanvas);
}

const collectTextSelectionRuns = (obj, layout, selStart, selEnd) => {
  const runs = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const line of layout) {
    const ls = line.startIndex;
    if (ls >= selEnd) break;
    const o0 = Math.max(0, selStart - ls), o1 = Math.min(line.text.length, selEnd - ls);
    if (o0 >= o1) continue;

    const x1 = lineXAtOffset(line, obj, o0);
    const x2 = lineXAtOffset(line, obj, o1);
    const run = { line, x1, x2, y: line.y, height: LINE_H, startOffset: o0, endOffset: o1 };
    runs.push(run);
    if (x1 < left) left = x1;
    if (line.y < top) top = line.y;
    if (x2 > right) right = x2;
    if (line.y + LINE_H > bottom) bottom = line.y + LINE_H;
  }
  if (!runs.length) return null;
  return {
    runs,
    bounds: { left, top, right, bottom },
  };
};

const applyTextSelectionMotionTransform = (context, bounds, motion) => {
  const { scaleX = 1, scaleY = 1, scaleOriginX = 0.5, scaleOriginY = 0.5, translateX = 0, translateY = 0 } = motion;
  if (scaleX !== 1 || scaleY !== 1) {
    const scalePivotX = bounds.left + (bounds.right - bounds.left) * scaleOriginX;
    const scalePivotY = bounds.top + (bounds.bottom - bounds.top) * scaleOriginY;
    context.transform(scaleX, 0, 0, scaleY,
      translateX + scalePivotX * (1 - scaleX), translateY + scalePivotY * (1 - scaleY));
  } else if (translateX || translateY) context.translate(translateX, translateY);
};

const drawTextLayoutStatic = (context, obj, layout, selectionGap = null) => {
  if (!selectionGap) {
    for (const line of layout) {
      drawTextLineRange(context, line, obj);
    }
    return;
  }
  const selStart = Math.min(selectionGap.start, selectionGap.end);
  const selEnd = Math.max(selectionGap.start, selectionGap.end);
  for (const line of layout) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 >= h1) {
      drawTextLineRange(context, line, obj);

      continue;
    }
    const o0 = h0 - ls, o1 = h1 - ls;
    const hasBefore = o0 > 0;
    const hasAfter = o1 < line.text.length;
    if (hasBefore) {
      drawTextLineRange(context, line, obj, 0, o0);
    }
    if (hasAfter) {
      drawTextLineRange(context, line, obj, o1);
    }
  }
};

function drawTextSelectionHighlight(context, selection, motion) {
  context.save();
  if (motion) applyTextSelectionMotionTransform(context, selection.bounds, motion);
  context.fillStyle = 'rgba(10, 132, 255, 0.3)';
  context.beginPath();

  for (const run of selection.runs) {
    context.rect(run.x1, run.y, run.x2 - run.x1, run.height);
  }
  context.fill();

  context.restore();
}

const drawTextSelectionContentJello = (context, obj, selection, motion) => {
  context.save();
  applyTextSelectionMotionTransform(context, selection.bounds, motion);
  for (const run of selection.runs) {
    drawTextLineRange(context, run.line, obj, run.startOffset, run.endOffset);
  }
  context.restore();
};

const drawTextSelectionJelloOverlays = (context, viewZoom = zoom, motions = null) => {
  if (!motions?.size) return;
  for (const [id, spec] of motions) {
    if (id === editingId) continue;
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'text') continue;
    const layout = getTextLayout(obj);
    const motion = BoardfishMotion.textSelectionMotionForDraw(spec, viewZoom);
    const selection = motion ? collectTextSelectionRuns(obj, layout, spec.start, spec.end) : null;
    if (!selection) {
      // The normal pass skipped this textbox; an empty selection still needs its text.
      drawTextLayoutStatic(context, obj, layout);
      continue;
    }
    drawTextSelectionHighlight(context, selection, motion);
    drawTextLayoutStatic(context, obj, layout, { start: spec.start, end: spec.end });
    drawTextSelectionContentJello(context, obj, selection, motion);
  }
};

function drawCaret(context, obj, layout, selStart, viewZoom = zoom) {
  let caretLine = null;
  const preferredLineStart = obj?._textEditCaretIndex === selStart &&
    Number.isFinite(obj?._textEditCaretLineStartIndex)
    ? obj._textEditCaretLineStartIndex
    : null;
  for (const line of layout) {
    const ls = line.startIndex;
    const le = line.caretEndIndex ?? line.endIndex ?? (ls + line.text.length);
    if (selStart < ls || selStart > le) continue;
    if (ls === preferredLineStart) {
      caretLine = line;
      break;
    }
    caretLine ||= line;
    if (preferredLineStart == null) break;
  }
  if (!caretLine) return false;
  const ls = caretLine.startIndex;
  const off = Math.max(0, selStart - ls);
  const cx = lineCaretXAtOffset(caretLine, obj, off);
  const cy = caretLine.y;
  const caretHeight = LINE_H;
  const caretWidth = 2 / viewZoom;
  const contentLeft = obj.x + TEXT_PAD;
  const contentRight = Math.max(contentLeft, obj.x + obj.w - TEXT_PAD);
  const maxCaretX = Math.max(contentLeft, contentRight - caretWidth);
  const caretX = Math.max(contentLeft, Math.min(cx - caretWidth / 2, maxCaretX));
  context.fillRect(caretX, cy, caretWidth, caretHeight);
  return true;
}

function drawEditingTextOverlay(context, viewZoom = zoom, viewportRect = viewportWorldRect(0), textSelectionMotions = null) {
  const obj = objectsMap.get(editingId);
  if (!obj || obj.type !== 'text') return;
  const copiedSelectionSpec = textSelectionMotions?.get(obj.id) || null;

  const motion = BoardfishMotion.objectMotionForDraw(obj, viewZoom);
  if (motion) viewportRect = BoardfishRenderer.applyObjectMotion(context, obj, viewportRect, motion);
  try {
    const liveSelStart = _editEl ? _editEl.selectionStart : 0;
    const liveSelEnd   = _editEl ? _editEl.selectionEnd   : 0;
    const liveMatchesCopied = copiedSelectionSpec &&
      liveSelStart === copiedSelectionSpec.start &&
      liveSelEnd === copiedSelectionSpec.end;
    const useCopiedSelectionMotion = copiedSelectionSpec && (liveSelStart === liveSelEnd || liveMatchesCopied);
    const copiedMotion = useCopiedSelectionMotion
      ? BoardfishMotion.textSelectionMotionForDraw(copiedSelectionSpec, viewZoom)
      : null;
    if (copiedSelectionSpec && !copiedMotion) BoardfishMotion.cancelTextSelectionMotion(obj.id);
    const selStart = copiedMotion ? copiedSelectionSpec.start : liveSelStart;
    const selEnd   = copiedMotion ? copiedSelectionSpec.end   : liveSelEnd;

    const layout = getTextLayoutForViewport(obj, viewportRect);

    const selection = selStart === selEnd ? null : collectTextSelectionRuns(obj, layout, selStart, selEnd);

    if (selection) drawTextSelectionHighlight(context, selection, copiedMotion);

    drawTextLayoutStatic(context, obj, layout, copiedMotion ? { start: selStart, end: selEnd } : null);
    if (selection && copiedMotion) drawTextSelectionContentJello(context, obj, selection, copiedMotion);

    if (selStart === selEnd && _caretVisible) {
      drawCaret(context, obj, layout, selStart, viewZoom);
    }
  } finally {
    if (motion) context.restore();
  }
}

function drawBoard(bypassEditOffscreenCache = false) {
  if (_boardOpening) {
    return;
  }
  // Keep canvas pixels in the same CSS coordinate space as DOM selections.
  syncBoardCanvasBackingStore();

  const dpr = window.devicePixelRatio || 1;
  const viewportRect = viewportWorldRect(0);
  const textSelectionMotions = BoardfishMotion.beginDraw();

  if (editingId && !bypassEditOffscreenCache && !BoardfishMotion.hasObjectMotionsForDraw('image')) {
    if (_offscreenDirty) _rebuildOffscreen(dpr, viewportRect);
    // Blit the cached background/image layer, then draw text directly so its
    // antialiasing is identical to the normal canvas path.

    ctx.resetTransform();
    ctx.drawImage(_offscreen, 0, 0);

    setWorldCanvasTransform(ctx, dpr);
  } else {
    ctx.resetTransform();
    fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
    setWorldCanvasTransform(ctx, dpr);

    drawVisibleObjects(ctx, viewportRect, textSelectionMotions, editingId, editingId ? 'image' : null);
  }
  if (editingId) {
    drawVisibleObjects(ctx, viewportRect, textSelectionMotions, editingId, 'text');
  }

  drawTextSelectionJelloOverlays(ctx, zoom, textSelectionMotions);
  if (editingId) {
    drawEditingTextOverlay(ctx, zoom, viewportRect, textSelectionMotions);
  }
}

function applyTransform() {
  if (_boardOpening) {
    return;
  }
  if (editingId) invalidateOffscreen();

  // Viewport transforms already require a direct redraw at the new pan/zoom.
  // Rebuilding the edit cache here would render the static scene twice in the
  // same frame; leave it dirty for the next non-navigation edit render.
  drawBoard(true);

  const needsOverlayUpdate = selectionOverlayActive();
  if (needsOverlayUpdate) updateSelectionOverlay();

  scheduleVisibleImageWorkAfterIdle();
  if (_islandSyncedZoom !== zoom) syncIslandZoomDisplay();
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}
var _frameRaf = null;
var _needTransform = false;
var _needBoardRender = false;
var _needOverlayRender = false;

const boardRenderer = BoardfishRenderer.createBoardRenderer({
  objects: () => objects,
  imageBitmapCache: () => imageBitmapCache,
  zoom: () => zoom,
  panX: () => panX,
  panY: () => panY,
  dpr: () => window.devicePixelRatio || 1,
  font: FONT,
  canvasTextColor,
  currentViewportWorldRect: viewportWorldRect,
  drawTextLineRange,
  getTextLayoutForViewport,
  objectIntersectsRect,
  hasObjectMotionsForDraw: BoardfishMotion.hasObjectMotionsForDraw,
  objectMotionForDraw: BoardfishMotion.objectMotionForDraw,
  selectImageSourceForDraw,
});
({ drawSingleObj, setWorldCanvasTransform, drawVisibleObjects } = boardRenderer);

const BoardObjectGeometry = BoardfishObjectGeometry.createObjectGeometry({
  objects: () => objects,
});

var finishMotionViewportRenderFrame = BoardfishMotion.afterViewportRenderFrame;

function scheduleFrame() {
  if (_frameRaf) {
    return;
  }

  _frameRaf = requestAnimationFrame(() => {
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;

    _frameRaf = null;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;

    if (doTransform) {
      applyTransform();
      finishMotionViewportRenderFrame();
      return;
    }
    if (doBoard) {
      drawBoard();
    }
    if (doOverlay) {
      updateSelectionOverlay();
    }
    if (doBoard) {
      finishMotionViewportRenderFrame();
    }
  });
}

function scheduleTransform(changed) {
  const now = performance.now();
  lastViewportInputAt = now;
  if (changed === false && !editingId) return;

  _needTransform = true;
  scheduleFrame();
}

function selectionOverlayActive() {
  return hasSelection() || selOverlay.classList.contains('visible') || multiSelOverlay.classList.contains('visible');
}

function scheduleRender(board = true, overlay = null) {
  if (board) _needBoardRender = true;
  _needOverlayRender ||= !!(overlay ?? (board && selectionOverlayActive()));
  scheduleFrame();
}
