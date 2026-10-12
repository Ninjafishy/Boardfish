'use strict';

var IMAGE_SCALE = 0.25;
var IMAGE_VARIANT_MEMORY_LIMIT = 1024 * 1024 * 1024;

var imageScaledBitmapCache = new Map(); // key -> { bitmap, bytes }
var imageScaledBitmapPending = new Map(); // image key -> estimated bytes
var imageScaledBitmapPendingByteTotal = 0;
var imageScaledBitmapBytes = 0;
var imageScaledVariantRenderTimer = null;

var imageScaledVariantQueue = [];
var imageScaledVariantQueueTimer = null;
var imageScaledVariantQueueActive = 0;
var lastViewportInputAt = 0;
var IMAGE_VARIANT_INPUT_IDLE_MS = 180;
var IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS = 0;
var IMAGE_VARIANT_QUEUE_CONCURRENCY = 4;
var IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS = 180;
var IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT = 1.18;

var imageScaledVariantPrewarmTimer = null;

var IMAGE_VARIANT_PREWARM_PAD_PX = 768;
var viewportImageScalingEnabled = typeof createImageBitmap === 'function';
var drawableBitmapWarmupCanvas = null;
var drawableBitmapWarmupContext = null;
var drawableBitmapWarmupQueue = new Map();
var drawableBitmapWarmupScheduled = false;
var drawableBitmapWarmupReady = new WeakSet();

function bitmapByteSize(bitmap) {
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
}

function isImageVariantDrawableSource(source) {
  if (!source) return false;
  return !!(source.complete && source.naturalWidth > 0) || !!(source.width > 0 && source.height > 0);
}

function drawableBitmapWarmupTargetSize(source, meta = {}) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!(sourceW > 0 && sourceH > 0)) return { sourceW, sourceH, width: 1, height: 1 };
  const maxEdge = meta.kind === 'scaled-variant' ? 512 : meta.kind === 'full-image' ? 256 : 1;
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  return {
    sourceW,
    sourceH,
    width: Math.max(1, Math.round(sourceW * scale)),
    height: Math.max(1, Math.round(sourceH * scale)),
  };
}

function dropDrawableBitmapWarmup(source) {
  if (!source) return;
  drawableBitmapWarmupQueue.delete(source);
  drawableBitmapWarmupReady.delete(source);
}

function dropDrawableBitmapWarmupsForKey(key) {
  if (!key || !drawableBitmapWarmupQueue.size) return;
  for (const [source, meta] of drawableBitmapWarmupQueue) {
    if (meta?.key === key) drawableBitmapWarmupQueue.delete(source);
  }
}

function drawableBitmapWarmup2dContext(width, height) {
  if (!drawableBitmapWarmupCanvas && typeof OffscreenCanvas !== 'undefined') drawableBitmapWarmupCanvas = new OffscreenCanvas(width, height);
  else if (!drawableBitmapWarmupCanvas && typeof document !== 'undefined') drawableBitmapWarmupCanvas = document.createElement('canvas');
  if (!drawableBitmapWarmupCanvas) return null;
  if (drawableBitmapWarmupCanvas.width < width) drawableBitmapWarmupCanvas.width = width;
  if (drawableBitmapWarmupCanvas.height < height) drawableBitmapWarmupCanvas.height = height;
  if (!drawableBitmapWarmupContext) {
    drawableBitmapWarmupContext = drawableBitmapWarmupCanvas.getContext?.('2d', { alpha: false }) || null;
  }
  return drawableBitmapWarmupContext;
}

function warmDrawableBitmapForDrawNow(source, meta = {}) {
  if (!isImageVariantDrawableSource(source)) {
    return (false);
  }
  if (drawableBitmapWarmupReady.has(source)) {
    return (false);
  }
  const target = drawableBitmapWarmupTargetSize(source, meta);
  const ctx = drawableBitmapWarmup2dContext(target.width, target.height);
  if (!ctx) {
    return false;
  }

  try {
    try { ctx.imageSmoothingEnabled = false; } catch {}
    ctx.drawImage(source, 0, 0, target.sourceW, target.sourceH, 0, 0, target.width, target.height);
    drawableBitmapWarmupReady.add(source);

    return true;
  } catch {
    return false;
  }
}

function runDrawableBitmapWarmupQueue() {
  if (isActiveViewportInput()) {
    scheduleDrawableBitmapWarmupQueue();
    return;
  }
  const start = performance.now();
  let count = 0;
  for (const [source, meta] of drawableBitmapWarmupQueue) {
    if (count >= 4 || (count > 0 && performance.now() - start >= 4)) break;
    drawableBitmapWarmupQueue.delete(source);
    warmDrawableBitmapForDrawNow(source, meta);
    count++;
  }
  if (drawableBitmapWarmupQueue.size) scheduleDrawableBitmapWarmupQueue();
}

function scheduleDrawableBitmapWarmupQueue() {
  if (drawableBitmapWarmupScheduled) return;
  drawableBitmapWarmupScheduled = true;
  const run = () => {
    drawableBitmapWarmupScheduled = false;
    runDrawableBitmapWarmupQueue();
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 400 });
  } else {
    setTimeout(run, 32);
  }
}

function scheduleDrawableBitmapWarmup(source, meta = {}) {
  if (!isImageVariantDrawableSource(source)) return;
  if (drawableBitmapWarmupReady.has(source) || drawableBitmapWarmupQueue.has(source)) {
    return;
  }
  drawableBitmapWarmupQueue.set(source, meta);

  scheduleDrawableBitmapWarmupQueue();
}

function scaledVariantEstimatedBytes(sourceW, sourceH, scale) {
  return Math.max(1, Math.ceil(sourceW * scale)) * Math.max(1, Math.ceil(sourceH * scale)) * 4;
}

function addPendingScaledVariantBytes(key, bytes) {
  imageScaledBitmapPending.set(key, bytes);
  imageScaledBitmapPendingByteTotal += bytes;
}

function removePendingScaledVariantBytes(key) {
  const bytes = imageScaledBitmapPending.get(key) || 0;
  if (imageScaledBitmapPending.delete(key)) {
    imageScaledBitmapPendingByteTotal -= bytes;
  }
}

function removeScaledImageVariant(key) {
  const entry = imageScaledBitmapCache.get(key);
  if (!entry) return;
  imageScaledBitmapCache.delete(key);
  imageScaledBitmapBytes -= entry.bytes || 0;
  entry.bitmap?.close?.();
  dropDrawableBitmapWarmup(entry.bitmap);

}

function setScaledImageVariant(key, entry) {
  removeScaledImageVariant(key);
  imageScaledBitmapCache.set(key, entry);
  imageScaledBitmapBytes += entry.bytes || 0;
  while (imageScaledBitmapBytes > IMAGE_VARIANT_MEMORY_LIMIT && imageScaledBitmapCache.size) {
    removeScaledImageVariant(imageScaledBitmapCache.keys().next().value);
  }
}

function clearScaledImageVariantCache() {
  for (const entry of imageScaledBitmapCache.values()) entry.bitmap?.close?.();
  imageScaledBitmapCache.clear();
  imageScaledBitmapBytes = 0;
}

function clearScaledImageVariants(key = null) {
  if (key) {
    removeScaledImageVariant(key);
    dropDrawableBitmapWarmupsForKey(key);
    if (imageScaledVariantQueue.length) {
      let write = 0;
      for (let read = 0; read < imageScaledVariantQueue.length; read++) {
        const task = imageScaledVariantQueue[read];
        if (task?.key === key) continue;
        imageScaledVariantQueue[write++] = task;
      }
      imageScaledVariantQueue.length = write;
      if (!imageScaledVariantQueue.length) cancelScheduledScaledVariantQueue();
    }
    removePendingScaledVariantBytes(key);
    return;
  }
  clearScaledImageVariantCache();
  imageScaledBitmapPending.clear();
  imageScaledBitmapPendingByteTotal = 0;
  imageScaledVariantQueue.length = 0;
  cancelScheduledScaledVariantQueue();
  clearTimeout(imageScaledVariantRenderTimer);
  imageScaledVariantRenderTimer = null;

  drawableBitmapWarmupQueue.clear();
  drawableBitmapWarmupReady = new WeakSet();

  clearTimeout(imageScaledVariantPrewarmTimer);
  imageScaledVariantPrewarmTimer = null;
}

function scheduleScaledVariantReadyRender() {
  invalidateOffscreen();
  if (imageScaledVariantRenderTimer) return;
  const inputIdleMs = performance.now() - lastViewportInputAt;
  imageScaledVariantRenderTimer = setTimeout(() => {
    imageScaledVariantRenderTimer = null;
    if (isActiveViewportInput()) {
      scheduleScaledVariantReadyRender();
      return;
    }
    scheduleRender(true);
  }, inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS ? Math.max(40, IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs) : 120);
}

function enqueueScaledVariantTask(task, priority = false) {
  task.priority = priority === true;
  if (task.priority) {
    imageScaledVariantQueue.unshift(task);
    cancelScheduledScaledVariantQueue();
  } else {
    imageScaledVariantQueue.push(task);
  }
  scheduleScaledVariantQueue();
}

function prioritizeScaledVariantQueue(key) {
  if (!key || !imageScaledVariantQueue.length) return false;
  const index = imageScaledVariantQueue.findIndex((task) => task?.key === key);
  if (index < 0) return false;
  const task = imageScaledVariantQueue[index];
  const boosted = task.priority !== true || index > 0;
  if (!boosted) return false;
  task.priority = true;
  if (index > 0) {
    imageScaledVariantQueue.splice(index, 1);
    imageScaledVariantQueue.unshift(task);
  }

  cancelScheduledScaledVariantQueue();
  scheduleScaledVariantQueue();
  return true;
}

function shouldBuildScaledImageVariant(key, generation) {
  return generation === _imageStoreGeneration && imageScaledBitmapPending.has(key);
}

async function createScaledImageVariantBitmap(source, sourceW, sourceH, scale) {
  const w = Math.max(1, Math.ceil(sourceW * scale));
  const h = Math.max(1, Math.ceil(sourceH * scale));
  try {
    return await createImageBitmap(source, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
  } catch (_) {
    if (typeof document === 'undefined') throw _;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(source, 0, 0, w, h);
    return await createImageBitmap(canvas);
  }
}

function cancelScheduledScaledVariantQueue() {
  if (imageScaledVariantQueueTimer !== null) clearTimeout(imageScaledVariantQueueTimer);
  imageScaledVariantQueueTimer = null;
}

function scheduleScaledVariantQueue() {
  const concurrency = IMAGE_VARIANT_QUEUE_CONCURRENCY;
  if (imageScaledVariantQueueActive >= concurrency) return;
  if (!imageScaledVariantQueue.length) return;
  if (imageScaledVariantQueueTimer !== null) return;
  const inputIdleMs = activeViewportInputIdleMs();
  const idleThresholdMs = imageScaledVariantQueue[0].priority === true ? IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS : IMAGE_VARIANT_INPUT_IDLE_MS;
  const delay = inputIdleMs < idleThresholdMs ? idleThresholdMs - inputIdleMs : 0;
  imageScaledVariantQueueTimer = setTimeout(() => {
    imageScaledVariantQueueTimer = null;
    const done = () => {
      imageScaledVariantQueueActive--;
      scheduleScaledVariantQueue();
    };
    while (imageScaledVariantQueue.length && imageScaledVariantQueueActive < concurrency) {
      const task = imageScaledVariantQueue[0];
      const inputIdleMs = activeViewportInputIdleMs();
      if (inputIdleMs < (task.priority === true ? IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS : IMAGE_VARIANT_INPUT_IDLE_MS)) break;
      imageScaledVariantQueue.shift();
      imageScaledVariantQueueActive++;
      task().then(done, done);
    }
    scheduleScaledVariantQueue();
  }, delay);
}

function chooseImageScaleForDraw(obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }, activeOverscale = false) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return 1;
  const viewZoom = view.zoom;
  const dpr = view.dpr;
  const neededW = obj.w * viewZoom * dpr;
  const neededH = obj.h * viewZoom * dpr;
  const overscaleLimit = activeOverscale === true ? IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT : 1;
  const scale = IMAGE_SCALE;
  return sourceW * scale * overscaleLimit >= neededW &&
    sourceH * scale * overscaleLimit >= neededH ? scale : 1;
}

function queueScaledImageVariant(key, source, scale, priority = false) {
  if (!viewportImageScalingEnabled || !key || !source || scale !== IMAGE_SCALE) {
    return (false);
  }
  if (imageScaledBitmapCache.has(key)) {
    return (false);
  }
  if (imageScaledBitmapPending.has(key)) {
    if (priority === true) prioritizeScaledVariantQueue(key);
    return (false);
  }
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) {
    return (false);
  }
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + imageScaledBitmapPendingByteTotal + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    return false;
  }
  addPendingScaledVariantBytes(key, estimatedBytes);
  const generation = _imageStoreGeneration;
  const task = async () => {
    if (!shouldBuildScaledImageVariant(key, generation)) {
      removePendingScaledVariantBytes(key);
      return;
    }

    let bitmap = null;
    try {
      bitmap = await createScaledImageVariantBitmap(source, sourceW, sourceH, scale);
      if (!shouldBuildScaledImageVariant(key, generation)) {
        bitmap.close?.();
        return;
      }
      const bytes = bitmapByteSize(bitmap);
      setScaledImageVariant(key, { bitmap, bytes });
      const warmupMeta = { kind: 'scaled-variant', key };

      scheduleDrawableBitmapWarmup(bitmap, warmupMeta);
      bitmap = null;
      scheduleScaledVariantReadyRender();
    } catch {
      bitmap?.close?.();
    } finally {
      removePendingScaledVariantBytes(key);
    }
  };
  task.key = key;
  enqueueScaledVariantTask(task, priority);
  return (true);
}

function queueScaledImageVariantForReadyImage(key, source) {
  if (!isImageVariantDrawableSource(source)) {
    return false;
  }
  const scale = IMAGE_SCALE;
  return queueScaledImageVariant(key, source, scale);
}

async function settleOpenImageDrawCaches(concurrency = IMAGE_VARIANT_QUEUE_CONCURRENCY) {
  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
  concurrency = Math.max(1, Math.min(8, Math.floor(Number(concurrency) || IMAGE_VARIANT_QUEUE_CONCURRENCY)));

  // Source hydration queues the shared 0.25x variant for every bitmap. Drain
  // that same queue before input is enabled so no device starts zooming while
  // another device is still building its draw sources in the background.
  for (;;) {
    cancelScheduledScaledVariantQueue();
    if (imageScaledVariantQueueActive > 0) await yieldToBrowser();
    else if (!imageScaledVariantQueue.length) break;
    else {
      const tasks = imageScaledVariantQueue.splice(0);

      await mapWithConcurrency(tasks, concurrency, (task) => task());
    }
  }

  // Drawing each decoded source once transfers the expensive first-use work
  // out of the first zoom/copy animation. Keep yielding so the opening pill can
  // continue to paint while a large board is prepared.
  let batchStartedAt = performance.now();
  let batchCount = 0;
  for (const [source, meta] of drawableBitmapWarmupQueue) {
    drawableBitmapWarmupQueue.delete(source);
    warmDrawableBitmapForDrawNow(source, meta);

    batchCount++;
    if (batchCount >= 8 || performance.now() - batchStartedAt >= 8) {
      await yieldToBrowser();
      batchStartedAt = performance.now();
      batchCount = 0;
    }
  }
}

function activeViewportInputIdleMs() {
  if (!(lastViewportInputAt > 0)) return Infinity;
  return Math.max(0, performance.now() - lastViewportInputAt);
}

function isActiveViewportInput() {
  return activeViewportInputIdleMs() < IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS;
}

function prewarmVisibleScaledImageVariants() {
  if (!viewportImageScalingEnabled || _boardOpening) {
    return;
  }
  const scale = IMAGE_SCALE;
  const rect = viewportWorldRect(IMAGE_VARIANT_PREWARM_PAD_PX);

  for (const obj of objects) {
    if (obj?.type !== 'image' || !obj.data?.imgKey || !objectIntersectsRect(obj, rect)) continue;

    const key = obj.data.imgKey;
    if (imageScaledBitmapCache.has(key) || imageScaledBitmapPending.has(key)) {
      continue;
    }
    const source = imageBitmapCache[key] || null;
    if (!isImageVariantDrawableSource(source)) {
      continue;
    }
    queueScaledImageVariant(key, source, scale);
  }
}

function scheduleVisibleImageWorkAfterIdle(delayMs = IMAGE_VARIANT_INPUT_IDLE_MS) {
  if (_boardOpening) return;
  if (imageScaledVariantPrewarmTimer !== null) return;
  imageScaledVariantPrewarmTimer = setTimeout(() => {
    imageScaledVariantPrewarmTimer = null;
    if (_boardOpening) return;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    if (inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS) {
      scheduleVisibleImageWorkAfterIdle(IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs);
      return;
    }
    queueVisibleImageHydration(1);
    if (!viewportImageScalingEnabled) return;
    prewarmVisibleScaledImageVariants();
  }, Math.max(0, delayMs));
}

function selectImageSourceForDraw(key, obj, fullSource, view = { zoom, dpr: window.devicePixelRatio || 1 }, activeInput = null) {
  if (!viewportImageScalingEnabled) {
    return (fullSource);
  }
  activeInput = activeInput === true || (activeInput !== false && isActiveViewportInput());
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view, activeInput);
  if (targetScale < 1) {
    const entry = imageScaledBitmapCache.get(key);
    if (entry) {
      return (entry.bitmap);
    }
    queueScaledImageVariant(key, fullSource, targetScale, activeInput);
  }
  return (fullSource);
}
