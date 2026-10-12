// ─── Image store (keeps base64 data OUT of boardHistory snapshots) ─────────────────
var imageStore = {};
var imageBitmapCache = {}; // key -> ImageBitmap (GPU-resident, never evicted by WebKit)
var imageBitmapFailed = new Set();
var imgKeyCounter = 1;
var _imageStoreGeneration = 0;
var _imageDecodeQueue = [];
var _imageDecodeActive = 0;
var _imageDecodeScheduled = false;
var MAX_IMAGE_DECODE_ACTIVE = 2;
const MAX_OPEN_IMAGE_DECODE_ACTIVE = 8;
var imageReadyPromises = new Map();

function newImgKey() {
  let key;
  do {
    key = 'img-' + (imgKeyCounter++);
  } while (Object.hasOwn(imageStore, key));
  return key;
}

const isWebImageRef = (src) => !!globalThis.BoardfishWebBoardContainer?.isWebImageRef?.(src);
const isImageSource = (src) => typeof src === 'string' ? !!src : isWebImageRef(src);

const isImageDisplayCacheRequestCurrent = (key, source, generation) => (
  generation === _imageStoreGeneration && imageStore[key] === source
);

function imageNeedsRendering(obj) {
  return !!(obj.data?.flipX || obj.data?.flipY || obj.data?.rotation);
}

function renderImageToCanvas(obj, sourceImg = null) {
  const transform = obj.data;

  const img = sourceImg || imageBitmapCache[obj.data.imgKey];
  const sourceW = img?.naturalWidth || img?.width || 0;
  const sourceH = img?.naturalHeight || img?.height || 0;
  if (!img || !sourceW || !sourceH) {
    return null;
  }
  const sideways = Math.abs(transform.rotation) % 180 === 90;
  const tmp = document.createElement('canvas');
  tmp.width = sideways ? sourceH : sourceW;
  tmp.height = sideways ? sourceW : sourceH;
  const tctx = tmp.getContext('2d');
  tctx.transform(transform.flipX ? -1 : 1, 0, 0, transform.flipY ? -1 : 1, tmp.width / 2, tmp.height / 2);
  if (transform.rotation) tctx.rotate((transform.rotation * Math.PI) / 180);
  tctx.drawImage(img, -sourceW / 2, -sourceH / 2, sourceW, sourceH);

  return tmp;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

async function readableImageSourceBlob(source) {
  const container = globalThis.BoardfishWebBoardContainer;
  const original = container.blobForImageSource(source);
  if (!original?.size) throw new Error('Image Unavailable');
  const blob = await container.snapshotImageBlob(original);
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const startsWith = (bytes) => bytes.every((byte, i) => header[i] === byte);
  const mime = blob.type.toLowerCase();
  const matchesMime = mime === 'image/png' ? startsWith([137, 80, 78, 71, 13, 10, 26, 10])
    : mime === 'image/jpeg' || mime === 'image/jpg' ? startsWith([255, 216, 255])
    : mime === 'image/gif' ? startsWith([71, 73, 70, 56])
    : mime === 'image/webp' && startsWith([82, 73, 70, 70])
      && header[8] === 87 && header[9] === 69 && header[10] === 66 && header[11] === 80;
  if (!matchesMime) throw new Error('Image Format Mismatch');
  // Reading and decoding here catches stale file snapshots and corrupt payloads
  // before the browser consumes a download or promised clipboard payload.
  const bitmap = await createImageBitmapForSource(blob);
  bitmap.close?.();
  return blob;
}

async function renderStoredImageToCanvas(obj, source = imageStore[obj?.data?.imgKey]) {
  if (!isImageSource(source)) return null;
  const bitmap = await createImageBitmapForSource(source).catch(() => null);
  if (!bitmap) return null;
  const canvas = renderImageToCanvas(obj, bitmap);
  bitmap.close?.();
  return canvas;
}

const bitmapSourceFromImageSource = async (source) => {
  if (isWebImageRef(source)) {
    const container = globalThis.BoardfishWebBoardContainer;
    const blob = container?.blobForImageSource?.(source);
    if (blob) return blob;
  }
  if (source && typeof Blob !== 'undefined' && source instanceof Blob) return source;
  if (typeof source === 'string' && source && typeof fetch === 'function') {
    const response = await fetch(source);
    if (!response.ok && !source.startsWith('data:') && !source.startsWith('blob:')) {
      throw new Error(`Image Read Failed: ${response.status}`);
    }
    return response.blob();
  }
  return source;
};

const createImageBitmapForSource = async (source) => {
  if (typeof createImageBitmap !== 'function') throw new Error('Image Decoder Unavailable');
  const bitmapSource = await bitmapSourceFromImageSource(source);
  return createImageBitmap(bitmapSource);
};

const addImageRuntimeObjectKeysToSet = (keys, value) => {
  if (!value || typeof value !== 'object') return;
  for (const sourceKey in value) {
    if (Object.hasOwn(value, sourceKey)) keys.add(sourceKey);
  }
};

const IMAGE_READY_RENDER_INTERVAL_MS = 120;
const BULK_IMAGE_READY_RENDER_INTERVAL_MS = 450;

function scheduleImageReadyRender() {
  if (_boardOpening) return;
  invalidateOffscreen();
  const now = performance.now();
  const intervalMs = _bulkImageInsertDepth > 0 ? BULK_IMAGE_READY_RENDER_INTERVAL_MS : IMAGE_READY_RENDER_INTERVAL_MS;
  if (now - _imageReadyLastRender <= intervalMs) return;
  _imageReadyLastRender = now;
  scheduleRender(true);
}

var _imageHydrationScheduled = false;
var _imageHydrationQueue = new Set();

function queueImageHydration(key) {
  const source = imageStore[key];
  if (imageBitmapCache[key] || _imageHydrationQueue.has(key) || !isImageSource(source)) return;
  _imageHydrationQueue.add(key);
  scheduleImageHydration();
}

function scheduleImageHydration() {
  if (_imageHydrationScheduled) return;
  _imageHydrationScheduled = true;
  requestAnimationFrame(processImageHydrationQueue);
}

function processImageHydrationQueue() {
  _imageHydrationScheduled = false;
  const batchStart = performance.now();
  let count = 0;
  for (const key of _imageHydrationQueue) {
    if (count > 0 && performance.now() - batchStart >= 6) break;
    _imageHydrationQueue.delete(key);
    const source = imageStore[key];
    if (!source || imageBitmapCache[key]) continue;
    count++;
    try {
      cacheImage(key, source);
    } catch {}
  }
  if (_imageHydrationQueue.size) scheduleImageHydration();
}

function enqueueImageDecode(task) {
  _imageDecodeQueue.push(task);

  scheduleImageDecodeQueue();
}

function scheduleImageDecodeQueue() {
  if (_imageDecodeScheduled) return;
  _imageDecodeScheduled = true;
  if (_boardOpening) {
    setTimeout(processImageDecodeQueue, 0);
  } else {
    requestAnimationFrame(processImageDecodeQueue);
  }
}

function processImageDecodeQueue() {
  _imageDecodeScheduled = false;
  const activeLimit = _boardOpening ? MAX_OPEN_IMAGE_DECODE_ACTIVE : MAX_IMAGE_DECODE_ACTIVE;
  const done = () => {
    _imageDecodeActive--;
    if (_imageDecodeQueue.length) scheduleImageDecodeQueue();
  };
  while (_imageDecodeActive < activeLimit && _imageDecodeQueue.length) {
    const task = _imageDecodeQueue.shift();
    _imageDecodeActive++;
    task().then(done, done);
  }
}

function cacheImage(key, src) {
  if (!isImageSource(src)) return;
  let ready;
  if (!imageBitmapFailed.delete(key) && (ready = imageReadyPromises.get(key))) return ready;
  const generation = _imageStoreGeneration;

  let resolveReady;
  ready = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, ready);

  enqueueImageDecode(async () => {
    let same;
    try {
      const bitmap = await createImageBitmapForSource(src);

      same = isImageDisplayCacheRequestCurrent(key, src, generation);
      if (!same) {
        bitmap.close?.();
      } else {
        let selectedBitmap = imageBitmapCache[key];
        if (selectedBitmap) bitmap.close?.();
        else imageBitmapCache[key] = selectedBitmap = bitmap;
        const warmupMeta = { kind: 'full-image', key };

        scheduleDrawableBitmapWarmup(selectedBitmap, warmupMeta);

        queueScaledImageVariantForReadyImage(key, selectedBitmap);
      }
    } catch {
      same = isImageDisplayCacheRequestCurrent(key, src, generation);
      if (same) imageBitmapFailed.add(key);
    }

    if (!same) {
      if (imageReadyPromises.get(key) === ready) imageReadyPromises.delete(key);
      if (!imageBitmapCache[key]) queueImageHydration(key);
      resolveReady();
      return;
    }

    scheduleImageReadyRender();
    scheduleVisibleImageWorkAfterIdle();

    resolveReady();
  });

  return ready;
}

const removeImageRuntimeCachesForKey = (key) => {
  const bitmap = imageBitmapCache[key];
  if (bitmap) {
    dropDrawableBitmapWarmup(bitmap);
    try { bitmap.close(); } catch {}
    delete imageBitmapCache[key];
  }

  imageBitmapFailed.delete(key);

  imageReadyPromises.delete(key);
  clearScaledImageVariants(key);
};

const invalidateImageSourceCachesForKey = (key) => {
  if (!key) return;
  _imageStoreGeneration++;
  _imageHydrationQueue.delete(key);
  removeImageRuntimeCachesForKey(key);
};

const pruneImageCachesToKeys = (retainedKeys = new Set()) => {
  if (!retainedKeys || typeof retainedKeys.has !== 'function') {
    return;
  }
  const keys = new Set();
  addImageRuntimeObjectKeysToSet(keys, imageStore);
  addImageRuntimeObjectKeysToSet(keys, imageBitmapCache);
  for (const key of imageBitmapFailed) keys.add(key);

  for (const key of keys) {
    if (retainedKeys.has(key)) continue;
    if (Object.hasOwn(imageStore, key)) {
      delete imageStore[key];
    }

    removeImageRuntimeCachesForKey(key);
  }
};

function clearImageStore() {
  _imageStoreGeneration++;
  imageStore = {};
  for (const k in imageBitmapCache) {
    if (!Object.hasOwn(imageBitmapCache, k)) continue;
    try { imageBitmapCache[k].close(); } catch {}
  }
  imageBitmapCache = {};
  clearScaledImageVariants();
  imageBitmapFailed.clear();
  imageReadyPromises.clear();
  _imageHydrationQueue.clear();
  _imageDecodeQueue.length = 0;
  _imageDecodeScheduled = false;
  _imageReadyLastRender = 0;
  imgKeyCounter = 1;
}

// ─── History ──────────────────────────────────────────────────────────────────
