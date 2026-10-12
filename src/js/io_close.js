// ─── Dirty tracking ───────────────────────────────────────────────────────────

var savedHistoryRevision;
var savedDefaultEmptyBoard = false;
var currentFileRef = null;

function isDefaultEmptyBoardState(objectList = objects) {
  for (const obj of objectList || []) {
    if (!obj) continue;
    if (obj.type !== 'text') return false;
    const content = obj.data?.content;
    if ((typeof isTextContentEmpty === 'function'
      ? !isTextContentEmpty(content)
      : String(content || '').trim() !== '')) return false;
  }
  return true;
}

function isCleanDefaultEmptyBoardState() {
  return savedDefaultEmptyBoard && isDefaultEmptyBoardState(objects);
}

function isDirty() {
  const revision = boardHistory[historyIndex]?.revision;
  return (_dirtyIds.size > 0 || revision === undefined || revision !== savedHistoryRevision) && !isCleanDefaultEmptyBoardState();
}

function markSaved() {
  _dirtyIds.clear();
  savedHistoryRevision = boardHistory[historyIndex]?.revision;
  savedDefaultEmptyBoard = isDefaultEmptyBoardState();
}

// ─── Unsaved changes dialog ───────────────────────────────────────────────────
function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  const r = _dialogResolve;
  _dialogResolve = null;
  updateInputShieldVisual();
  if (r) r(result);
}

unsavedDialog.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
for (const choice of ['save', 'discard', 'cancel']) {
  document.getElementById(`dlg-${choice}`).addEventListener('click', () => _dialogClose(choice));
}

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    dialogOverlay.classList.add('show');
    updateInputShieldVisual();
  });
}

const appendOpeningFreezeBoard = () => {
  const rect = boardCanvas?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  Object.assign(boardCanvas.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  openingShield.appendChild(boardCanvas);
};

const beginOpeningFreeze = () => {
  if (!openingShield || boardCanvas.parentNode === openingShield) return;
  openingShield.replaceChildren();
  openingShield.style.background = _canvasBackgroundColor;
  openingShield.classList.add('opening-freeze', 'active');
  appendOpeningFreezeBoard();
  openingShield.appendChild(island);
};

const endOpeningFreeze = () => {
  if (!openingShield) return;
  document.body.appendChild(island);
  canvas.prepend(boardCanvas);
  boardCanvas.removeAttribute('style');
  openingShield.classList.remove('active', 'opening-freeze');
  openingShield.replaceChildren();
  openingShield.style.background = '';
  resizeCanvas();
};

// ─── Save / Open ─────────────────────────────────────────────────────────────

function boardDataForSave() {
  return BoardfishBoardDocument.createBoardDataForSave({
    viewport: { panX, panY, zoom },
    imageStore,
    objects,
  }, { schema: BoardSchema, guessImageExtFromDataUrl: BoardfishExportUtils.guessImageExtFromDataUrl });
}

async function invokeSaveBoard(fileRef, options = {}) {
  flushEditHistoryCheckpoint();
  const data = boardDataForSave();
  return BoardfishRuntime.saveBoard(fileRef, data, { imageStore, ...options });
}

async function invokeReadBoard(fileRef) {
  const result = await BoardfishRuntime.readBoard(fileRef);
  return result?.board || result;
}

const isOpenHydratableImageSource = (source) => {
  return typeof source === 'string' || isWebImageRef(source);
};

function getVisibleImageKeys(limit = Infinity) {
  const b = viewportWorldRect();
  const keys = [];
  const seen = new Set();

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type !== 'image') {
      continue;
    }
    if (!objectIntersectsRect(obj, b)) {
      continue;
    }
    const key = obj.data.imgKey;
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const source = BoardfishImageStore.getSource(key);
    if (!source) {
      continue;
    }
    if (!isOpenHydratableImageSource(source)) {
      continue;
    }
    if (BoardfishImageStore.hasDisplayImage(key)) {
      continue;
    }
    keys.push(key);
    if (keys.length >= limit) break;
  }

  return keys;
}

function getPendingHydratableImageKeys(keys = []) {
  const seen = new Set(keys);

  for (const key of Object.keys(imageStore)) {
    if (seen.has(key)) continue;
    if (!isOpenHydratableImageSource(BoardfishImageStore.getSource(key))) {
      continue;
    }
    if (BoardfishImageStore.hasDisplayImage(key)) {
      continue;
    }
    keys.push(key);
  }

  return keys;
}

async function hydrateImageForDisplay(key) {
  const source = BoardfishImageStore.getSource(key);
  if (BoardfishImageStore.hasDisplayImage(key) || !isOpenHydratableImageSource(source)) return false;
  const pendingReady = imageReadyPromises.get(key);

  await (pendingReady || cacheImage(key, source));

  return BoardfishImageStore.hasDisplayImage(key);
}

async function hydrateImageKeysWithLimit(keys, concurrency = openHydrationConcurrency) {
  let anyHydrated = false;
  await mapWithConcurrency(keys, concurrency, async (key) => {
    try {
      if (await hydrateImageForDisplay(key)) {
        anyHydrated = true;
      }
    } catch {}
  });
  if (anyHydrated) invalidateOffscreen();
}

function createOpenTextWarmupTarget() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 512;
    const context = canvas.getContext?.('2d') || null;
    return context ? { context } : null;
  } catch {
    return null;
  }
}

function warmOpenTextLineForDraw(target, obj, line) {
  if (!target?.context || !line || !String(line.text ?? '').length) return;
  const context = target.context;
  const dpr = typeof window !== 'undefined' ? (Number(window.devicePixelRatio) || 1) : 1;
  const viewZoom = Number(zoom) || 1;
  const deviceScale = Math.max(0.25, Math.min(4, viewZoom * dpr));
  const margin = 12;
  const baseX = (Number(obj?.x) || 0) + TEXT_PAD;
  const textY = Number(line.textY) || 0;
  try {
    context.font = FONT;
    context.textBaseline = 'alphabetic';
    context.fillStyle = canvasTextColor();
    context.setTransform(
      deviceScale,
      0,
      0,
      deviceScale,
      margin - baseX * deviceScale,
      margin + LINE_H * deviceScale - textY * deviceScale,
    );
    drawTextLineRange(context, line, obj);
  } catch {}
}

async function hydrateTextDrawCachesForOpen() {
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (fontSet?.ready) {
    try { await fontSet.ready; } catch {}
  }

  const warmupTarget = createOpenTextWarmupTarget();
  let batchStartedAt = performance.now();
  for (const obj of objects) {
    if (obj?.type !== 'text') continue;

    const layout = getTextLayout(obj);
    for (const line of layout) {
      prepareTextLineForDraw(line);

      warmOpenTextLineForDraw(warmupTarget, obj, line);
      if (performance.now() - batchStartedAt >= 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        batchStartedAt = performance.now();
      }
    }
  }
}

function queueVisibleImageHydration(limit) {
  for (const key of getVisibleImageKeys(limit)) queueImageHydration(key);
}

async function finishOpenedBoard() {
  const hydrationKeys = getPendingHydratableImageKeys(getVisibleImageKeys());

  const imageHydrationPromise = hydrateImageKeysWithLimit(hydrationKeys, openHydrationConcurrency);
  const textHydrationPromise = hydrateTextDrawCachesForOpen();
  await Promise.all([
    imageHydrationPromise,
    textHydrationPromise,
  ]);
  await settleOpenImageDrawCaches(openHydrationConcurrency);

  _boardOpening = false;
  applyTransform();
  finishPillTask({ beforeFinish: endOpeningFreeze });
}

function applyBoardData(data) {
  data = BoardSchema.normalizeBoardData(data);

  clearJsClipboard();

  clearImageStore();

  imageStore = data.imageStore;

  for (const k of Object.keys(imageStore)) {
    const n = parseInt(k.slice(4));
    if (n >= imgKeyCounter) imgKeyCounter = n + 1;
  }

  if (editingId) exitEdit();
  BoardfishEditorState.clearSelection();
  clearTextLayoutCaches({ objectLayout: false });

  BoardfishEditorState.replaceBoardObjects(data.objects);

  invalidateOffscreen();

  BoardfishEditorState.restoreObjectCounters();
  BoardfishViewportState.setViewport(data.viewport);

  snapshot();
  markSaved();
}

const runExclusiveBoardSave = (run) => {
  if (runExclusiveBoardSave.inFlight) {
    return runExclusiveBoardSave.inFlight;
  }
  const tracked = run().finally(() => {
    if (runExclusiveBoardSave.inFlight === tracked) runExclusiveBoardSave.inFlight = null;
  });
  runExclusiveBoardSave.inFlight = tracked;
  return tracked;
};
runExclusiveBoardSave.inFlight = null;

function showSaveFailurePill(err) {
  showIslandMsg(err?.boardfishLimit && err.boardfishUserMessage || 'Save Failed', long_message);
}

const saveBoardImpl = async (saveAs = false) => {
  let fileRef = !saveAs && BoardfishRuntime.canSaveToExistingTarget(currentFileRef) ? currentFileRef : null;
  saveAs = !fileRef;

  const releaseInputShield = acquireInputShield({ visual: false, keepSelectionOverlay: true });
  try {
    if (saveAs) {
      fileRef = await BoardfishRuntime.saveFileDialog(`${BoardfishExportUtils.randomHex()}.bf`);
      if (!fileRef) {
        releaseInputShield();
        return false;
      }
    }
    try {
      showIslandMsg('Saving');
      await invokeSaveBoard(fileRef, { sourceFileRef: currentFileRef });
      if (saveAs) currentFileRef = fileRef;
      markSaved();
      finishPillTask({ beforeFinish: releaseInputShield, finalMsg: 'Saved' });
    } catch (err) {
      finishPillTask({ beforeFinish: releaseInputShield });
      throw err;
    }

    return true;
  } catch (err) {
    releaseInputShield();

    showSaveFailurePill(err);

    return false;
  }
};

function saveBoardAs() {
  return runExclusiveBoardSave(() => saveBoardImpl(true));
}

function saveBoard() {
  return runExclusiveBoardSave(saveBoardImpl);
}

async function openBoardFileRef(fileRef) {
  if (!(await confirmDirtyBeforeOpen())) return;
  await openBoardFromPath(fileRef);
}

async function openBoard() {
  if (!(await confirmDirtyBeforeOpen())) return;

  try {
    const chooseFile = BoardfishRuntime.openFileDialog;
    let fileRef;
    fileRef = await chooseFile();
    if (!fileRef) {
      return;
    }
    await openBoardFromPath(fileRef);
  } catch (err) {
    finishFailedOpen(err);
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});
