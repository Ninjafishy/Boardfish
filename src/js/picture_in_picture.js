'use strict';

function trackPictureInPictureBounds(targetWindow, onResize) {
  const readBounds = () => ({
    x: targetWindow.screenX,
    y: targetWindow.screenY,
    width: targetWindow.outerWidth,
    height: targetWindow.outerHeight,
    dpr: targetWindow.devicePixelRatio,
  });
  let previous = readBounds();
  let frame = null;
  let stopped = false;
  const track = () => {
    if (stopped) return;
    const current = readBounds();
    const resized = current.width !== previous.width || current.height !== previous.height;
    const dx = previous.x - current.x;
    const dy = previous.y - current.y;
    const sameScale = current.dpr === previous.dpr;
    previous = current;
    if (resized && sameScale && Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy)) {
      onResize(dx, dy);
    }
  };
  // Window moves have no DOM event. Sample their position without redrawing so
  // a later left/top resize does not mistake a title-bar drag for edge movement.
  const sample = () => {
    track();
    if (!stopped) frame = targetWindow.requestAnimationFrame(sample);
  };
  targetWindow.addEventListener('resize', track);
  frame = targetWindow.requestAnimationFrame(sample);
  return () => {
    stopped = true;
    targetWindow.cancelAnimationFrame(frame);
    targetWindow.removeEventListener('resize', track);
  };
}

function createBoardfishPictureInPicture({ ownerWindow, view, placeholder, onBeforeMove, onAfterMove, onStateChange, onResize = () => {} }) {
  const ownerDocument = ownerWindow.document;
  let pipWindow = null;
  let opening = false;
  let stopTrackingBounds = null;
  const supported = typeof ownerWindow.documentPictureInPicture?.requestWindow === 'function';

  function moveContents(from, to) {
    for (const node of Array.from(from.body.children)) {
      if (node === placeholder || node.tagName === 'SCRIPT') continue;
      to.body.appendChild(node);
    }
    to.body.dataset.theme = from.body.dataset.theme;
  }

  function restore() {
    if (!pipWindow) return;
    const closingWindow = pipWindow;
    stopTrackingBounds?.();
    stopTrackingBounds = null;
    // Do this synchronously in pagehide: the PiP document is about to be
    // destroyed, and its close action cannot be vetoed by beforeunload.
    try {
      onBeforeMove();
    } finally {
      moveContents(closingWindow.document, ownerDocument);
      pipWindow = null;
      view.setWindow(ownerWindow);
      placeholder.hidden = true;
      onStateChange(false);
      onAfterMove();
    }
  }

  async function copyPresentation(destinationWindow) {
    const destination = destinationWindow.document;
    const base = destination.createElement('base');
    base.href = ownerDocument.baseURI;
    destination.head.appendChild(base);
    const title = destination.createElement('title');
    title.textContent = 'Boardfish';
    destination.head.appendChild(title);
    destination.documentElement.lang = ownerDocument.documentElement.lang;
    const stylesLoaded = [];
    for (const source of ownerDocument.querySelectorAll('link[rel="stylesheet"], style')) {
      // Preserve the source CSS. Serializing cssRules can lose font shorthands
      // that contain variables, and inline copies change relative asset URLs.
      const copy = source.cloneNode(true);
      if (source.tagName === 'LINK') {
        copy.href = source.href;
        stylesLoaded.push(new Promise((resolve, reject) => {
          copy.addEventListener('load', resolve, { once: true });
          copy.addEventListener('error', () => reject(new Error('Could Not Load Board Stylesheet')), { once: true });
        }));
      }
      destination.head.appendChild(copy);
    }
    let onClosed;
    const closed = new Promise((resolve) => { onClosed = resolve; });
    destinationWindow.addEventListener('pagehide', onClosed, { once: true });
    try {
      // Measure the canvas only after its styles arrive. Closing a still-loading
      // PiP must leave the board in the owner and settle this pending open.
      await Promise.race([Promise.all(stylesLoaded), closed]);
    } finally {
      destinationWindow.removeEventListener('pagehide', onClosed);
    }
  }

  async function open() {
    if (!supported || opening || pipWindow) return false;
    opening = true;
    let openedWindow;
    try {
      // Keep the request in the originating user gesture. Chrome chooses the
      // placement and can clamp these initial dimensions.
      openedWindow = await ownerWindow.documentPictureInPicture.requestWindow({ width: 800, height: 600 });
      if (openedWindow.closed) return false;
      await copyPresentation(openedWindow);
      if (openedWindow.closed) return false;
      pipWindow = openedWindow;
      openedWindow.addEventListener('pagehide', () => {
        if (pipWindow === openedWindow) restore();
      }, { once: true });
      onBeforeMove();
      moveContents(ownerDocument, openedWindow.document);
      view.setWindow(openedWindow);
      placeholder.hidden = false;
      onStateChange(true);
      onAfterMove();
      stopTrackingBounds = trackPictureInPictureBounds(openedWindow, onResize);
      const refreshFonts = () => {
        if (pipWindow === openedWindow) onAfterMove();
      };
      openedWindow.document.fonts?.addEventListener('loadingdone', refreshFonts);
      openedWindow.document.fonts?.ready.then(refreshFonts).catch(() => {});
      return true;
    } catch (error) {
      if (pipWindow) restore();
      openedWindow?.close();
      throw error;
    } finally {
      opening = false;
    }
  }

  function close({ focus = false } = {}) {
    if (!pipWindow) return;
    const closingWindow = pipWindow;
    if (focus) ownerWindow.focus();
    restore();
    closingWindow.close();
  }

  return Object.freeze({ supported, open, close, get pinned() { return !!pipWindow; } });
}

var BoardfishPictureInPicture;

async function toggleBoardPin() {
  if (BoardfishPictureInPicture.pinned) {
    BoardfishPictureInPicture.close({ focus: true });
    return;
  }
  if (isBoardInputBlocked()) return;
  try {
    await BoardfishPictureInPicture.open();
  } catch (error) {
    console.error('Pin Board Failed:', error);
    showIslandMsg('Could Not Pin Board', long_message);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const pinButton = document.getElementById('btn-pin');
  const placeholder = document.getElementById('pip-placeholder');
  let pendingCenter = null;
  BoardfishPictureInPicture = createBoardfishPictureInPicture({
    ownerWindow: window,
    view: BoardfishView,
    placeholder,
    onBeforeMove() {
      const size = boardSurfaceCssSize();
      pendingCenter = toWorld(size.width / 2, size.height / 2);
      if (editingId) exitEdit();
      hideMenus();
      clearMenuCommandPressState();
      _spaceDown = false;
      canvas.classList.remove('panning');
      _lastBoardCursorClientX = null;
      _lastBoardCursorClientY = null;
    },
    onAfterMove() {
      restartCanvasSizeTracking();
      if (pendingCenter) {
        const size = boardSurfaceCssSize();
        BoardfishViewportState.setZoomPan(zoom,
          size.width / 2 - pendingCenter.x * zoom,
          size.height / 2 - pendingCenter.y * zoom);
        pendingCenter = null;
      }
      clearTextMeasurementCaches();
      invalidateOffscreen();
      scheduleRender(true, true);
    },
    onStateChange(pinned) {
      pinButton.querySelector('.ctx-label').textContent = pinned ? 'Return to Tab' : 'Pin Board';
    },
    onResize(dx, dy) {
      if (!BoardfishViewportState.panBy(dx, dy)) return;
      // Anchor the existing pixels immediately, including when bounds arrive
      // inside RAF and the redraw cannot run until the following frame.
      offsetBoardCanvasForResize(dx, dy);
      invalidateOffscreen();
      updateSelectionOverlay();
      scheduleRender(true, true);
    },
  });
  pinButton.hidden = !BoardfishPictureInPicture.supported;
  document.getElementById('pip-menu-separator').hidden = !BoardfishPictureInPicture.supported;
  document.getElementById('pip-return').addEventListener('click', () => {
    BoardfishPictureInPicture.close({ focus: true });
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBoardfishPictureInPicture };
