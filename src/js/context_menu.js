// ─── Context menu ─────────────────────────────────────────────────────────────
var _lastBoardCursorClientX = null;
var _lastBoardCursorClientY = null;
const HAS_POINTER_EVENTS = 'PointerEvent' in window;
const BOARD_CURSOR_CLIENT_EVENT_TYPES = Object.freeze([
  ...(HAS_POINTER_EVENTS
    ? ['pointerover', 'pointerenter', 'pointermove', 'pointerdown', 'pointerup']
    : ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup']),
  'click', 'dblclick', 'auxclick', 'contextmenu', 'dragenter', 'dragover', 'drop',
]);

function rememberBoardCursorClientPoint(event) {
  _lastBoardCursorClientX = event.clientX;
  _lastBoardCursorClientY = event.clientY;
}

function boardCursorWorldPoint() {
  return toWorld(
    _lastBoardCursorClientX ?? window.innerWidth / 2,
    _lastBoardCursorClientY ?? window.innerHeight / 2,
  );
}

function menuCommandWorldPoint(event = null) {
  const x = event?.clientX;
  const y = event?.clientY;
  if (Number.isFinite(x) && Number.isFinite(y)) return toWorld(x, y);
  return boardCursorWorldPoint();
}

for (const type of BOARD_CURSOR_CLIENT_EVENT_TYPES) {
  window.addEventListener(type, rememberBoardCursorClientPoint, true);
}

function addTextAtMenuCommandPoint(event = null) {
  const point = menuCommandWorldPoint(event);
  closeCtxMenu();
  addText(point.x, point.y, '', { anchor: 'center' });
}

function menuViewportBounds() {
  const viewport = window.visualViewport;
  const left = Number(viewport?.offsetLeft) || 0;
  const top = Number(viewport?.offsetTop) || 0;
  const width = Number(viewport?.width) || Number(window.innerWidth) || 0;
  const height = Number(viewport?.height) || Number(window.innerHeight) || 0;
  const style = getComputedStyle(document.body);
  const inset = (name) => {
    const value = parseFloat(style.getPropertyValue(`--safe-area-${name}`));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  const gap = parseFloat(style.getPropertyValue('--menu-shell-padding'));
  return {
    left: left + inset('left'),
    top: top + inset('top'),
    right: left + width - inset('right'),
    bottom: top + height - inset('bottom'),
    gap: Number.isFinite(gap) ? gap : 8,
  };
}

function clampMenuCoord(value, size, start, end) {
  const min = start + MENU_VIEWPORT_EDGE_MARGIN;
  return Math.max(min, Math.min(end - size - MENU_VIEWPORT_EDGE_MARGIN, value));
}

function openMenuAt(menu, x, y) {
  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  const bounds = menuViewportBounds();
  menu.style.left = `${Math.round(clampMenuCoord(x, rect.width, bounds.left, bounds.right))}px`;
  menu.style.top = `${Math.round(clampMenuCoord(y, rect.height, bounds.top, bounds.bottom))}px`;
}

const closeFloatingSurface = (surface) => {
  surface.classList.remove('visible');
};

var ctxActionItems = ctxActions.getElementsByClassName('ctx-action-item');

function updateCtxActionStates() {
  darkModeMenuBtn.setAttribute('aria-pressed', appTheme === 'dark' ? 'true' : 'false');
}

function closeCtxActions() {
  closeFloatingSurface(ctxActions);
}

function openCtxMenuAt(x, y) {
  closeOpenMenusExcept('ctx-menu');
  updateCtxActionStates();
  ctxMenu.classList.add('visible');
  ctxActions.classList.add('visible');
  const { gap, left, right, top, bottom } = menuViewportBounds();
  const { width: menuWidth, height: menuHeight } = ctxMenu.getBoundingClientRect();
  const actionWidth = ctxActions.offsetWidth;
  const minActionLeft = left + gap;
  const maxActionRight = right - gap;
  const maxActionLeft = Math.max(minActionLeft, maxActionRight - actionWidth);
  let menuLeft = Math.round(clampMenuCoord(x, menuWidth, left, right));
  let actionLeft = menuLeft + menuWidth + gap;

  if (actionLeft + actionWidth > maxActionRight) {
    actionLeft = maxActionLeft;
    menuLeft = actionLeft - gap - menuWidth;
  }

  if (menuLeft < minActionLeft) {
    menuLeft = minActionLeft;
    actionLeft = Math.min(maxActionLeft, menuLeft + menuWidth + gap);
  }

  ctxMenu.style.left = `${Math.round(menuLeft)}px`;
  ctxMenu.style.top = `${Math.round(clampMenuCoord(y, menuHeight, top, bottom))}px`;
  ctxActions.style.left = `${Math.round(actionLeft)}px`;
  ctxActions.style.top = ctxMenu.style.top;
}

function closeCtxMenu() {
  clearMenuCommandPressState();
  closeFloatingSurface(ctxMenu);
  closeCtxActions();
}

function closeObjCtxMenu() {
  clearMenuCommandPressState();
  closeFloatingSurface(objCtxMenu);
}

const closeTextCtxMenu = () => {
  clearMenuCommandPressState();
  closeFloatingSurface(textCtxMenu);
};

function closeOpenMenusExcept(activeMenuId = '') {
  if (activeMenuId !== 'ctx-menu') closeCtxMenu();
  if (activeMenuId !== 'obj-ctx-menu') closeObjCtxMenu();
  if (activeMenuId !== 'text-ctx-menu') closeTextCtxMenu();
}

function openExclusiveMenuAt(menu, menuId, x, y) {
  closeOpenMenusExcept(menuId);
  openMenuAt(menu, x, y);
}
var _menuPointerCommand = null;

function clearMenuCommandPressState() {
  _menuPointerCommand?.classList.remove('menu-pressed');
  _menuPointerCommand = null;
}

var MENU_COMMANDS = {
  'btn-new': () => { closeCtxMenu(); newBoard(); },
  'btn-add-text': addTextAtMenuCommandPoint,
  'btn-add-image': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu();
    pickAndInsertImages(point.x, point.y);
  },
  'btn-paste': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu();
    pasteAtPos(point.x, point.y);
  },
  'btn-save': () => { closeCtxMenu(); saveBoard(); },
  'btn-save-as': () => { closeCtxMenu(); saveBoardAs(); },
  'btn-open': () => { closeCtxMenu(); openBoard(); },
  'obj-btn-copy': () => { closeObjCtxMenu(); copySelected(); },
  'obj-btn-delete': () => { closeObjCtxMenu(); deleteSelected(); },
  'obj-btn-duplicate': (event) => {
    const point = menuCommandWorldPoint(event);
    closeObjCtxMenu();
    duplicateSelected(point);
  },
  'obj-btn-move-to-back': () => { closeObjCtxMenu(); sendSelectedToBack(); },
  'obj-btn-flip': flipSelectedImages,
  'obj-btn-rotate': rotateSelectedImages,
  'obj-btn-save-image': () => { closeObjCtxMenu(); exportSelectedImages(); },
  'text-btn-copy': () => { closeTextCtxMenu(); copyTextEditSelection(); },
  'text-btn-paste': () => { closeTextCtxMenu(); pasteTextIntoEditSelection(); },
  'text-btn-delete': () => { closeTextCtxMenu(); deleteTextEditSelection(); },
};

const getTextEditSelectionState = () =>
  editingId && _editEl ? textEditSelectionState(_editEl) : null;

const focusTextEditProxy = () => focusTextEditProxyNow(_editEl);

const readTextClipboardForEditMenu = async () => {
  try {
    if (navigator.clipboard?.readText) {
      return String(await navigator.clipboard.readText() || '');
    }
  } catch {}
  return '';
};

const replaceTextEditSelection = (text, { inputType }) => {
  const selection = getTextEditSelectionState();
  if (!selection || !_editEl) return false;
  const inputTypeValue = inputType.toLowerCase();
  const replacementText = inputTypeValue.includes('paste')
    ? textForTextObjectPaste(text)
    : normalizeTextContent(text);
  if (inputTypeValue.includes('paste') && !replacementText) return false;
  const oldValue = textEditProxyValue(_editEl);
  if (!BoardfishWebLimits.canReplaceText(objectsMap.get(editingId),
    oldValue.slice(0, selection.start) + replacementText + oldValue.slice(selection.end))) return false;
  const replacementState = {
    ...selection,
    value: oldValue,
    inputType,
    replacement: {
      start: selection.start,
      end: selection.end,
      insertedText: replacementText,
    },
  };

  beginTextEditHistoryAction(editingId, replacementState);
  _editEl?._boardfishSetPendingInputState?.(replacementState);

  replaceTextEditProxyRange(
    _editEl, replacementText, selection.start, selection.end, 'end', inputTypeValue.startsWith('delete'),
  );

  _caretVisible = true;

  _editEl.dispatchEvent(new Event('input', { bubbles: true }));

  focusTextEditProxy();
  return true;
};

const copyTextEditSelection = async () => {
  const selection = getTextEditSelectionState();
  if (selection?.hasSelection && _editEl) {
    await copyTextEditSelectionFromProxy(editingId, _editEl, selection);
  }
  focusTextEditProxy();
};

const deleteTextEditSelection = () => {
  if (!getTextEditSelectionState()?.hasSelection) {
    focusTextEditProxy();
    return;
  }
  replaceTextEditSelection('', { inputType: 'deleteContentBackward' });
};

const pasteTextIntoEditSelection = async () => {
  const hasBoardfishTextPayload = !!currentBoardfishTextSelectionClipboardPayload();
  const pasteOptions = {};
  const pendingBoardfishPaste = hasBoardfishTextPayload ? pasteBoardfishTextSelectionIntoEditSelection(pasteOptions) : null;
  const pendingExternalText = !hasBoardfishTextPayload || _jsClipboardWebMaybeStale ? readTextClipboardForEditMenu() : null;
  if (pendingBoardfishPaste && (await pendingBoardfishPaste || pasteOptions.limitRejected)) {
    focusTextEditProxy();
    return;
  }
  const text = await (pendingExternalText || readTextClipboardForEditMenu());
  if (!text) {
    focusTextEditProxy();
    return;
  }
  clearJsClipboard();
  replaceTextEditSelection(text, { inputType: 'insertFromPaste' });
};

function menuCommandFromButton(button) {
  return button?.id ? MENU_COMMANDS[button.id] || null : null;
}

function runMenuCommand(button, source, commandEvent = null) {
  if (source === 'click' && commandEvent?.detail !== 0) return true;
  const run = menuCommandFromButton(button);
  if (!run) {
    return false;
  }

  try {
    run(commandEvent);
  } catch {}
  return true;
}

function contextMenuSurfaceById(id) {
  if (id === 'ctx-menu') return ctxMenu;
  if (id === 'obj-ctx-menu') return objCtxMenu;
  if (id === 'text-ctx-menu') return textCtxMenu;
}

function hasOpenContextMenu() {
  return !!(
    ctxMenu.classList.contains('visible') ||
    objCtxMenu.classList.contains('visible') ||
    textCtxMenu.classList.contains('visible')
  );
}

function isVisibleMenuCommandButton(button) {
  return !!button &&
    !button.hidden &&
    button.style.display !== 'none' &&
    button.getAttribute('aria-hidden') !== 'true';
}

var SHORTCUT_MENU_COMMANDS = {
  'new-board': [['ctx-menu', 'btn-new']],
  'add-text': [['ctx-menu', 'btn-add-text']],
  'add-images': [['ctx-menu', 'btn-add-image']],
  paste: [
    ['text-ctx-menu', 'text-btn-paste'],
    ['ctx-menu', 'btn-paste'],
  ],
  save: [['ctx-menu', 'btn-save']],
  'save-as': [['ctx-menu', 'btn-save-as']],
  open: [['ctx-menu', 'btn-open']],
  copy: [
    ['text-ctx-menu', 'text-btn-copy'],
    ['obj-ctx-menu', 'obj-btn-copy'],
  ],
  duplicate: [['obj-ctx-menu', 'obj-btn-duplicate']],
  'move-to-back': [['obj-ctx-menu', 'obj-btn-move-to-back']],
  'flip-image': [['obj-ctx-menu', 'obj-btn-flip']],
  'rotate-image': [['obj-ctx-menu', 'obj-btn-rotate']],
  'export-image': [['obj-ctx-menu', 'obj-btn-save-image']],
  delete: [
    ['text-ctx-menu', 'text-btn-delete'],
    ['obj-ctx-menu', 'obj-btn-delete'],
  ],
};

function runVisibleMenuCommandForShortcut(shortcutName) {
  const candidates = SHORTCUT_MENU_COMMANDS[shortcutName] || [];
  for (const [menuId, buttonId] of candidates) {
    const menu = contextMenuSurfaceById(menuId);
    if (!menu?.classList.contains('visible')) continue;
    const button = document.getElementById(buttonId);
    if (!isVisibleMenuCommandButton(button)) continue;
    return runMenuCommand(button, 'shortcut');
  }
  return false;
}

function runAddImagesCommandFromShortcut() { runMenuCommand(addImageBtn, 'shortcut'); }

function runAddTextCommandFromShortcut() { runMenuCommand(addTextBtn, 'shortcut'); }

function resetZoomToClosestObject() {
  if (selectedIds.size || editingId) deselectAll();
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  let closestImage = null;
  let closestImageDistanceSq = Infinity;
  let closestText = null;
  let closestTextDistanceSq = Infinity;
  for (const obj of objects) {
    const dx = center.x - (obj.x + obj.w / 2);
    const dy = center.y - (obj.y + obj.h / 2);
    const candidateDistanceSq = dx * dx + dy * dy;
    if (obj.type === 'image') {
      if (candidateDistanceSq < closestImageDistanceSq) {
        closestImage = obj;
        closestImageDistanceSq = candidateDistanceSq;
      }
    } else if (candidateDistanceSq < closestTextDistanceSq) {
      closestText = obj;
      closestTextDistanceSq = candidateDistanceSq;
    }
  }
  const object = closestImage || closestText;
  const objectCenterX = object ? object.x + object.w / 2 : center.x;
  const objectCenterY = object ? object.y + object.h / 2 : center.y;
  const changed = BoardfishViewportState.setZoomPan(1, window.innerWidth / 2 - objectCenterX, window.innerHeight / 2 - objectCenterY);
  scheduleTransform(changed);
}

const resetZoomFromPill = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
  closeOpenMenusExcept('');
  resetZoomToClosestObject();
};

const suppressZoomPillContextMenu = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
};

island?.addEventListener('click', resetZoomFromPill);
island?.addEventListener('contextmenu', suppressZoomPillContextMenu);

const MENU_COMMAND_DOWN_EVENT = HAS_POINTER_EVENTS ? 'pointerdown' : 'mousedown';
const MENU_COMMAND_UP_EVENT = HAS_POINTER_EVENTS ? 'pointerup' : 'mouseup';
const MENU_COMMAND_CANCEL_EVENTS = HAS_POINTER_EVENTS
  ? ['pointercancel', 'pointerleave', 'lostpointercapture']
  : ['mouseleave'];

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  if (HAS_POINTER_EVENTS) e.stopPropagation();
  clearMenuCommandPressState();
  _menuPointerCommand = button;
  button.classList.add('menu-pressed');
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  clearMenuCommandPressState();
  if (e.pointerType === 'touch') started.blur?.();
  if (button !== started) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, MENU_COMMAND_UP_EVENT, e);
}

for (const menu of [ctxMenu, objCtxMenu, textCtxMenu]) {
  menu.addEventListener(MENU_COMMAND_DOWN_EVENT, onMenuPointerDown);
  menu.addEventListener(MENU_COMMAND_UP_EVENT, onMenuPointerUp);
  for (const type of MENU_COMMAND_CANCEL_EVENTS) menu.addEventListener(type, clearMenuCommandPressState);
}
const contextMenuStopSurfaces = [ctxMenu, objCtxMenu, textCtxMenu, ctxActions];
function suppressContextMenuSurface(e) {
  e.preventDefault();
  e.stopPropagation();
}
for (const menu of contextMenuStopSurfaces) menu.addEventListener('contextmenu', suppressContextMenuSurface);

function updateObjMenuActions() {
  let imageCount = 0;
  for (const id of selectedIds) {
    if (objectsMap.get(id)?.type === 'image' && ++imageCount === 2) break;
  }
  const showImageActions = imageCount >= 1;
  objectActionsSep.style.display = showImageActions ? 'block' : 'none';
  flipBtn.style.display = showImageActions ? '' : 'none';
  rotateBtn.style.display = showImageActions ? '' : 'none';
  saveImageBtn.style.display = showImageActions ? '' : 'none';
  saveImageBtn.firstElementChild.textContent = imageCount > 1 ? 'Export Images' : 'Export Image';
  exportSep.style.display = showImageActions ? 'block' : 'none';
}

const showTextEditContextMenuAt = (clientX, clientY) => {
  focusTextEditProxy();
  const hasSelection = !!getTextEditSelectionState()?.hasSelection;
  textCopyBtn.style.display = hasSelection ? '' : 'none';
  // Clipboard contents cannot be probed just to build a menu: mobile browsers
  // may gate that read behind their own Paste control. Keep the action
  // available and defer the protected read until the user invokes it.
  textDeleteSep.style.display = hasSelection ? 'block' : 'none';
  textDeleteBtn.style.display = hasSelection ? '' : 'none';
  if (!editingId) return;
  openExclusiveMenuAt(textCtxMenu, 'text-ctx-menu', clientX, clientY);
};

function showCanvasContextMenuAt(clientX, clientY) {
  if (_rubberBandDragActive) {
    return;
  }
  const wp = toWorld(clientX, clientY);

  const obj = BoardObjectGeometry.topObjectAtWorldPoint(wp);

  if (editingId && obj?.id === editingId) {
    showTextEditContextMenuAt(clientX, clientY);
    return;
  }

  // Multi-select: right-click anywhere inside the selected bounding box shows
  // the group menu.
  if (isMultiSelected()) {
    if (rectContainsPoint(selectedBounds(), wp) && (!obj || isSelected(obj.id))) {
      updateObjMenuActions();
      openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY);

      return;
    }
  }

  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY);

    return;
  }
  if (selectedIds.size) deselectAll();
  openCtxMenuAt(clientX, clientY);
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showCanvasContextMenuAt(e.clientX, e.clientY);
});

for (const id in MENU_COMMANDS) {
  if (!Object.hasOwn(MENU_COMMANDS, id)) continue;
  document.getElementById(id)?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runMenuCommand(event.currentTarget, 'click', event);
  });
}

document.addEventListener(HAS_POINTER_EVENTS ? 'pointerdown' : 'mousedown', (e) => {
  if (!hasOpenContextMenu()) return;
  if (isEventInsideVisibleContextMenu(e)) {
    return;
  }
  closeOpenMenusExcept('');
});

function clearCtxActionHotspotState() {
  for (let i = 0; i < ctxActionItems.length; i++) {
    ctxActionItems[i].classList.remove('hotspot-active');
  }
}

ctxActions.addEventListener('pointerdown', (e) => {
  const button = e.target.closest?.('.ctx-action-item');
  if (!button) return;
  clearCtxActionHotspotState();
  button.classList.add('hotspot-active');
});
ctxActions.addEventListener('pointerup', clearCtxActionHotspotState);
ctxActions.addEventListener('pointerleave', clearCtxActionHotspotState);

darkModeMenuBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();
  toggleAppTheme();
  updateCtxActionStates();
});
