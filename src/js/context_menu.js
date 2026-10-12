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
  closeCtxMenu('command:add-text');
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

function closeCtxActions(reason) {
  MenuDebug.log('ctx-actions:close', { reason });
  closeFloatingSurface(ctxActions);
}

function openCtxMenuAt(x, y) {
  closeOpenMenusExcept('ctx-menu', 'open-ctx-menu');
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

if (DEBUG_TOOLS_ENABLED) {
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:capture`, e), true);
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:bubble`, e), false);
    ctxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`ctx-menu:${type}`, e));
    objCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`obj-ctx-menu:${type}`, e));
    textCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`text-ctx-menu:${type}`, e));
  }
}

function closeCtxMenu(reason) {
  MenuDebug.log('ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(ctxMenu);
  closeCtxActions(reason);
}

function closeObjCtxMenu(reason) {
  MenuDebug.log('obj-ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(objCtxMenu);
}

const closeTextCtxMenu = (reason) => {
  MenuDebug.log('text-ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(textCtxMenu);
};

function closeOpenMenusExcept(activeMenuId = '', reason = 'menu-switch') {
  const switchReason = `${reason}:switch`;
  if (activeMenuId !== 'ctx-menu') closeCtxMenu(switchReason);
  if (activeMenuId !== 'obj-ctx-menu') closeObjCtxMenu(switchReason);
  if (activeMenuId !== 'text-ctx-menu') closeTextCtxMenu(switchReason);
}

function openExclusiveMenuAt(menu, menuId, x, y, reason) {
  closeOpenMenusExcept(menuId, reason);
  openMenuAt(menu, x, y);
}
var _menuPointerCommand = null;

function clearMenuCommandPressState() {
  _menuPointerCommand?.classList.remove('menu-pressed');
  _menuPointerCommand = null;
}

var MENU_COMMANDS = {
  'btn-new': () => { closeCtxMenu('command:new'); newBoard(); },
  'btn-add-text': addTextAtMenuCommandPoint,
  'btn-add-image': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu('command:add-image');
    pickAndInsertImages(point.x, point.y);
  },
  'btn-paste': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu('command:paste');
    pasteAtPos(point.x, point.y);
  },
  'btn-save': () => { closeCtxMenu('command:save'); saveBoard(); },
  'btn-save-as': () => { closeCtxMenu('command:save-as'); saveBoardAs(); },
  'btn-open': () => { closeCtxMenu('command:open'); openBoard(); },
  'obj-btn-copy': () => { closeObjCtxMenu('command:copy'); copySelected(); },
  'obj-btn-delete': () => { closeObjCtxMenu('command:delete'); deleteSelected(); },
  'obj-btn-duplicate': (event) => {
    const point = menuCommandWorldPoint(event);
    closeObjCtxMenu('command:duplicate');
    duplicateSelected(point);
  },
  'obj-btn-move-to-back': () => { closeObjCtxMenu('command:move-to-back'); sendSelectedToBack(); },
  'obj-btn-flip': flipSelectedImages,
  'obj-btn-rotate': rotateSelectedImages,
  'obj-btn-save-image': () => { closeObjCtxMenu('command:save-image'); exportSelectedImages(); },
  'text-btn-copy': () => { closeTextCtxMenu('command:copy'); copyTextEditSelection(); },
  'text-btn-paste': () => { closeTextCtxMenu('command:paste'); pasteTextIntoEditSelection(); },
  'text-btn-delete': () => { closeTextCtxMenu('command:delete'); deleteTextEditSelection(); },
};

const getTextEditSelectionState = () =>
  editingId && _editEl ? textEditSelectionState(_editEl) : null;

const focusTextEditProxy = () => focusTextEditProxyNow(_editEl);

const readTextClipboardForEditMenu = async () => {
  try {
    if (navigator.clipboard?.readText) {
      return String(await navigator.clipboard.readText() || '');
    }
  } catch (err) {
    MenuDebug.log('text-ctx-menu:clipboard-text-miss', { error: String(err) });
  }
  return '';
};

const replaceTextEditSelection = (text, { inputType }) => {
  const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
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
  if (collectDiagnostics && typeof nextTextEditInputDebugSeq === 'function') {
    replacementState._debugSeq = nextTextEditInputDebugSeq();
  }
  beginTextEditHistoryAction(editingId, replacementState);
  _editEl?._boardfishSetPendingInputState?.(replacementState);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debugNow = typeof textEditorDebugNow === 'function' ? textEditorDebugNow : () => Date.now();
  const debugRound = typeof textEditorDebugRound === 'function'
    ? textEditorDebugRound
    : (value) => Math.round((Number(value) || 0) * 100) / 100;
  const mutationStartedAt = debugNow();
  const mutationResult =
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  replaceTextEditProxyRange(
    _editEl, replacementText, selection.start, selection.end, 'end', inputTypeValue.startsWith('delete'),
  );
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const nextValue = textEditProxyValue(_editEl);
  if (typeof recordTextEditorInputPerfStep === 'function') {
    const mutationMs = debugRound(debugNow() - mutationStartedAt);
    recordTextEditorInputPerfStep('menu-replace-textarea-mutated', {
      seq: replacementState._debugSeq ?? '',
      inputType,
      objectId: editingId,
      textareaMutationMs: mutationMs,
      textareaMutationMethod: mutationResult.method,
      setRangeTextMs: mutationResult.setRangeTextMs || (mutationResult.method === 'setRangeText' ? mutationMs : ''),
      valueAssignMs: mutationResult.valueAssignMs,
      valueBuildMs: mutationResult.valueBuildMs,
      valueSetMs: mutationResult.valueSetMs,
      logicalSetMs: mutationResult.logicalSetMs,
      selectionSetMs: mutationResult.selectionSetMs,
      proxyChars: nextValue.length,
      domProxyChars: String(_editEl.value ?? '').length,
      domValueStale: !!_editEl._boardfishDomValueStale,
      oldChars: oldValue.length,
      nextChars: nextValue.length,
      insertedChars: replacementText.length,
      removedChars: Math.max(0, selection.end - selection.start),
      replacementStart: selection.start,
      replacementEnd: selection.end,
      ...(typeof textEditorSelectionDebugStats === 'function' ? textEditorSelectionDebugStats(selection, oldValue) : {}),
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  _caretVisible = true;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dispatchStartedAt = debugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  _editEl.dispatchEvent(new Event('input', { bubbles: true }));
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof recordTextEditorInputPerfStep === 'function') {
    recordTextEditorInputPerfStep('menu-replace-input-dispatched', {
      seq: replacementState._debugSeq ?? '',
      inputType,
      objectId: editingId,
      dispatchMs: debugRound(debugNow() - dispatchStartedAt),
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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

function menuCommandName(button) {
  return button?.id ? button.id.replace(/^(btn|obj-btn|text-btn)-/, '') : '';
}

function runMenuCommand(button, source, commandEvent = null) {
  if (source === 'click' && commandEvent?.detail !== 0) return true;
  const run = menuCommandFromButton(button);
  const command = menuCommandName(button);
  if (!run) {
    MenuDebug.log('menu:command:missing', { command, source, target: button?.id || '' });
    return false;
  }
  MenuDebug.log(button.id.startsWith('obj-')
    ? 'obj-ctx-menu:command'
    : button.id.startsWith('text-')
      ? 'text-ctx-menu:command'
      : 'ctx-menu:command', { command, source });
  MenuDebug.log('menu:command:start', { command, source });
  try {
    run(commandEvent);
    MenuDebug.log('menu:command:end', { command, source });
  } catch (err) {
    MenuDebug.log('menu:command:error', { command, source, error: String(err) });
    console.error('Menu Command Failed:', command, err);
  }
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
  const dbg = ViewportDebug.start('resetZoom', { panX, panY, zoom, objectCount: objects.length });
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
  scheduleTransform(changed /* BOARDFISH_DEV_DIAGNOSTICS_START */ , 'reset-zoom' /* BOARDFISH_DEV_DIAGNOSTICS_END */ );
  ViewportDebug.end(dbg, {
    ...(object
      ? { objectId: object.id, objectType: object.type, distanceSq: closestImage ? closestImageDistanceSq : closestTextDistanceSq }
      : { mode: 'empty-board-center' }),
    centerX: center.x,
    centerY: center.y,
    objectCenterX,
    objectCenterY,
    panX,
    panY,
    zoom,
  });
}

const resetZoomFromPill = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
  closeOpenMenusExcept('', 'pill-reset-zoom');
  resetZoomToClosestObject();
};

const suppressZoomPillContextMenu = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
};

island?.addEventListener('click', resetZoomFromPill);
island?.addEventListener('contextmenu', suppressZoomPillContextMenu);

const MENU_COMMAND_INPUT_FAMILY = HAS_POINTER_EVENTS ? 'pointer' : 'mouse';
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
  MenuDebug.log(`menu:${MENU_COMMAND_INPUT_FAMILY}-command:start`, { command: menuCommandName(button), target: button.id });
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  clearMenuCommandPressState();
  if (e.pointerType === 'touch') started.blur?.();
  if (button !== started) {
    MenuDebug.log(`menu:${MENU_COMMAND_INPUT_FAMILY}-command:cancel`, { started: started.id, ended: button?.id || '' });
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
  openExclusiveMenuAt(textCtxMenu, 'text-ctx-menu', clientX, clientY, 'show-text-menu:edit');
  MenuDebug.log('text-ctx-menu:open', {
    hasSelection,
    pasteVisible: textPasteBtn.style.display !== 'none',
    x: clientX,
    y: clientY,
  });
};

function showCanvasContextMenuAt(clientX, clientY) {
  if (_rubberBandDragActive) {
    MenuDebug.log('canvas:contextmenu:blocked-rubber-band', { x: clientX, y: clientY });
    return;
  }
  const wp = toWorld(clientX, clientY);
  MenuDebug.log('canvas:contextmenu', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });

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
      openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY, 'show-obj-menu:multi');
      MenuDebug.log('obj-ctx-menu:open', { reason: 'multi', x: clientX, y: clientY });
      return;
    }
  }

  MenuDebug.log('canvas:contextmenu-hit', {
    hit: !!obj,
    objectId: obj?.id || '',
    objectType: obj?.type || '',
    selectedCount: selectedIds.size,
    x: clientX,
    y: clientY,
    wx: wp.x,
    wy: wp.y,
  });
  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY, 'show-obj-menu:object');
    MenuDebug.log('obj-ctx-menu:open', { reason: 'object', objectId: obj.id, objectType: obj.type, x: clientX, y: clientY });
    return;
  }
  if (selectedIds.size) deselectAll();
  openCtxMenuAt(clientX, clientY);
  MenuDebug.log('ctx-menu:open', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });
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
    MenuDebug.log('document-outside-press:inside-menu');
    return;
  }
  closeOpenMenusExcept('', 'document-outside-press');
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
  closeCtxMenu('command:dark-mode');
  toggleAppTheme();
  updateCtxActionStates();
});
