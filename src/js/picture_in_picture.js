'use strict';

function createBoardfishPictureInPicture({ ownerWindow, view, placeholder, onBeforeMove, onAfterMove, onStateChange }) {
  const ownerDocument = ownerWindow.document;
  let pipWindow = null;
  let opening = false;
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

  function copyPresentation(destination) {
    const base = destination.createElement('base');
    base.href = ownerDocument.baseURI;
    destination.head.appendChild(base);
    const title = destination.createElement('title');
    title.textContent = 'Boardfish';
    destination.head.appendChild(title);
    destination.documentElement.lang = ownerDocument.documentElement.lang;
    for (const source of ownerDocument.querySelectorAll('link[rel="stylesheet"], style')) {
      // Boardfish's stylesheet is same-origin. Copy its parsed rules so the
      // canvas has its final geometry immediately, before moving the view.
      try {
        if (source.sheet?.cssRules) {
          const style = destination.createElement('style');
          style.textContent = Array.from(source.sheet.cssRules, (rule) => rule.cssText).join('\n');
          destination.head.appendChild(style);
          continue;
        }
      } catch { /* Cross-origin stylesheets can still be linked below. */ }
      const copy = source.cloneNode(true);
      if (source.tagName === 'LINK') {
        copy.href = source.href;
        copy.addEventListener('load', () => {
          if (pipWindow?.document === destination) onAfterMove();
        }, { once: true });
      }
      destination.head.appendChild(copy);
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
      pipWindow = openedWindow;
      openedWindow.addEventListener('pagehide', () => {
        if (pipWindow === openedWindow) restore();
      }, { once: true });
      copyPresentation(openedWindow.document);
      onBeforeMove();
      moveContents(ownerDocument, openedWindow.document);
      view.setWindow(openedWindow);
      placeholder.hidden = false;
      onStateChange(true);
      onAfterMove();
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
  });
  pinButton.hidden = !BoardfishPictureInPicture.supported;
  document.getElementById('pip-menu-separator').hidden = !BoardfishPictureInPicture.supported;
  document.getElementById('pip-return').addEventListener('click', () => {
    BoardfishPictureInPicture.close({ focus: true });
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBoardfishPictureInPicture };
