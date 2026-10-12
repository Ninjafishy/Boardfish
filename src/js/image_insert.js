'use strict';

const WEB_IMAGE_INSERT_CONCURRENCY = 3;
const IMAGE_INSERT_MAX_DIMENSION = 600;

function beginBulkImageInsert() {
  _bulkImageInsertDepth++;
  _bulkImageInsertAdded = 0;
}

function finishBulkImageInsert() {
  if (_bulkImageInsertDepth > 0) _bulkImageInsertDepth--;
  if (_bulkImageInsertDepth === 0 && _bulkImageInsertAdded > 0) {
    invalidateOffscreen();
    scheduleRender(true, true);
    pushHistory('bulk-image-insert');
  }
  if (_bulkImageInsertDepth === 0) {
    _bulkImageInsertAdded = 0;
  }
}

const webImageExtForFile = (file) => (
  file?.type === 'image/jpeg' ? 'jpg' : 'png'
);

const createWebImageSourceFromBlob = async (file, imgKey) => {
  const ext = webImageExtForFile(file);
  const mime = file.type;
  return BoardfishWebBoardContainer.createWebImageRef({
    path: `images/${imgKey}.${ext}`,
    mime,
    ext,
    blob: await BoardfishWebBoardContainer.snapshotImageBlob(file, mime),
  });
};

const rollbackImageInsertSource = (imgKey, source, hadPreviousSource = false, previousSource) => {
  if (
    imgKey
    && BoardfishImageStore.getSource(imgKey) === source
  ) {
    if (hadPreviousSource) {
      BoardfishImageStore.setSource(imgKey, previousSource);
    } else {
      removeImageRuntimeCachesForKey(imgKey);
      delete imageStore[imgKey];
    }
    return true;
  }
  return false;
};

const createImageInsertSourceRollback = (imgKey, source) => {
  const hadPreviousSource = !!imgKey && Object.hasOwn(imageStore, imgKey);
  const previousSource = hadPreviousSource ? imageStore[imgKey] : undefined;
  let rolledBack = false;
  return () => {
    if (rolledBack) return false;
    rolledBack = true;
    return rollbackImageInsertSource(imgKey, source, hadPreviousSource, previousSource);
  };
};

var _pendingImageInsertPoint = null;

async function addImage(src, cx, cy, imgKey, options = {}) {
  const rollbackSource = createImageInsertSourceRollback(imgKey, src);
  try {
    BoardfishImageStore.setSource(imgKey, src);
    await cacheImage(imgKey, src);
    const naturalW = Number(imageBitmapCache[imgKey]?.width || 0);
    const naturalH = Number(imageBitmapCache[imgKey]?.height || 0);

    if (!(naturalW > 0 && naturalH > 0)) {
      rollbackSource();

      return null;
    }
    let w = naturalW, h = naturalH;
    const maxDimension = IMAGE_INSERT_MAX_DIMENSION;
    if (w > maxDimension || h > maxDimension) {
      const scale = maxDimension / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }

    const explicitZ = Number.isFinite(options.z) ? options.z : null;
    const z = explicitZ == null ? ++zCounter : explicitZ;
    if (explicitZ != null) zCounter = Math.max(zCounter, explicitZ);
    const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z, data: { imgKey, flipX: false, flipY: false, rotation: 0 } };
    BoardfishEditorState.addObject(obj);
    if (editingId) exitEdit();
    if (_bulkImageInsertDepth > 0) {
      _bulkImageInsertAdded++;
    } else {
      BoardfishEditorState.setSelection([obj.id]);
      scheduleRender(true, true);
      pushHistory('add-image');
    }

    return obj;
  } catch {
    rollbackSource();

    return null;
  }
}

fileInput.addEventListener('change', async () => {
  const files = fileInput.files || [];
  const insertPoint = _pendingImageInsertPoint;
  try {
    await insertImageFiles(files, insertPoint.x, insertPoint.y);
  } finally {
    _pendingImageInsertPoint = null;
    fileInput.value = '';
  }
});

async function pickAndInsertImages(x, y) {
  if (!BoardfishWebLimits.canAddObjects(1)) return;
  _pendingImageInsertPoint = { x, y };
  fileInput.value = '';
  fileInput.click();
}

async function insertImageFiles(files, x, y) {

  const accepted = [];

  let contentLimitDropped = false;
  const supportedFiles = [];
  let acceptedBytes = 0;
  for (const file of files) {
    if (file?.type !== 'image/png' && file?.type !== 'image/jpeg') {
      continue;
    }
    supportedFiles.push(file);
  }
  if (!supportedFiles.length) {
    return;
  }
  if (!BoardfishWebLimits.canAddObjects(supportedFiles.length)) {
    return;
  }
  const limitOptions = { notifyUser: false, baseBytes: BoardfishWebLimits.currentContentBytes() };
  for (const file of supportedFiles) {
    const projectedBytes = acceptedBytes + Number(file.size || 0);
    const projectedObjects = accepted.length + 1;
    if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(projectedBytes, projectedObjects, limitOptions)) {
      contentLimitDropped = true;

      continue;
    }
    acceptedBytes = projectedBytes;
    accepted.push(file);
  }
  const bulk = accepted.length > 1;
  if (!accepted.length) {
    if (contentLimitDropped) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());

    return;
  }
  const concurrency = Math.min(WEB_IMAGE_INSERT_CONCURRENCY, accepted.length);
  const bulkZBase = bulk ? zCounter + 1 : null;
  const addedIds = new Array(accepted.length);
  const releaseInputShield = acquireInputShield();
  if (bulk) {
    beginBulkImageInsert();
  }
  try {
    await mapWithConcurrency(accepted, concurrency, async (file, acceptedIndex) => {
      try {
        const imgKey = newImgKey();
        const insertOptions = {
          z: bulkZBase == null ? undefined : bulkZBase + acceptedIndex,
        };

        const imageSource = await createWebImageSourceFromBlob(file, imgKey);

        const obj = await addImage(imageSource, x, y, imgKey, insertOptions);

        if (obj) {
          addedIds[acceptedIndex] = obj.id;
        }
      } catch {}
    });
  } finally {
    if (bulk) {
      const ids = addedIds.filter(Boolean);
      if (ids.length) BoardfishEditorState.setSelection(ids);
      finishBulkImageInsert();
    }
    releaseInputShield();
    if (contentLimitDropped) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());
  }
}

canvas.addEventListener('dragover', (event) => {
  let hasFile = false;
  for (const item of event.dataTransfer?.items || []) {
    if (item.kind === 'file') {
      hasFile = true;
      break;
    }
  }
  if (!hasFile) return;
  event.preventDefault();
});

canvas.addEventListener('drop', async (event) => {
  const files = event.dataTransfer?.files || [];
  if (!files.length) return;
  event.preventDefault();
  let boardFile = null;
  for (const file of files) {
    if (/\.bf$/i.test(file.name || '')) {
      boardFile = file;
      break;
    }
  }
  if (boardFile && typeof openBoardFileRef === 'function') {
    await openBoardFileRef(BoardfishRuntime.fileRefFromFile(boardFile));
    return;
  }
  const wp = toWorld(event.clientX, event.clientY);
  await insertImageFiles(files, wp.x, wp.y);
});
