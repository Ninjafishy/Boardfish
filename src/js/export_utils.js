'use strict';

(function initExportUtils(root) {
  const { dataUrlMime, extForMime, mimeForExt: mimeForImageExt } = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);
  function guessImageExtFromDataUrl(dataUrl) {
    return extForMime(dataUrlMime(dataUrl));
  }

  function guessImageExtForObjectExport(obj) {
    return imageNeedsRendering(obj) ? 'png' : guessImageExtForSource(BoardfishImageStore.getSource(obj?.data?.imgKey));
  }

  function guessImageExtForSource(src) {
    if (isWebImageRef(src)) return src.ext === 'jpeg' ? 'jpg' : (src.ext || 'png');
    if (typeof src === 'string') return guessImageExtFromDataUrl(src);
    return 'png';
  }

  function randomHex() {
    return Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  }

  function uniqueImageExportName(obj, usedNames = new Set()) {
    const ext = guessImageExtForObjectExport(obj);
    for (let i = 0; i < 1000; i++) {
      const name = `image_${randomHex()}.${ext}`;
      const key = name.toLowerCase();
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return name;
      }
    }
    const fallback = `image_${Date.now().toString(36)}.${ext}`;
    usedNames.add(fallback.toLowerCase());
    return fallback;
  }

  function progressText(totalCount, preparedCount) {
    const n = Math.max(1, Number(totalCount) || 1);
    const value = Math.max(0, Math.min(n, Number(preparedCount) || 0));
    return `${value}/${n}`;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function createProgressUpdater(totalCount, busyPill) {
    let currentProgressText = progressText(totalCount, 0);

    return (preparedCount) => {
      const text = progressText(totalCount, preparedCount);
      if (text === currentProgressText) return;
      currentProgressText = text;
      if (busyPill) busyPill.update(text);
    };
  }

  async function imageObjectDownloadEntry(obj, name) {
    const source = BoardfishImageStore.getSource(obj?.data?.imgKey);
    const needsRendering = imageNeedsRendering(obj);
    if (!needsRendering) {
      const sourceEntry = await imageSourceDownloadEntry(source, name);
      if (sourceEntry) return sourceEntry;
    }

    const canvas = renderImageToCanvas(obj) || await renderStoredImageToCanvas(obj, source);
    if (!canvas) return null;
    const data = await canvasToPngBlob(canvas);
    if (!data) return null;

    return {
      name: withImageExtension(name, 'png'),
      data,
      mime: 'image/png',
    };
  }

  async function imageSourceDownloadEntry(source, name) {
    const webRef = isWebImageRef(source);
    if (!webRef && !(typeof source === 'string' && source.startsWith('data:'))) return null;
    try {
      const data = await readableImageSourceBlob(source);
      const ext = guessImageExtForSource(source);
      return { name: withImageExtension(name, ext), data, mime: webRef ? source.mime || mimeForImageExt(ext) : dataUrlMime(source) };
    } catch {
      return null;
    }
  }

  async function downloadImageObjects(imageObjs, options = {}) {
    const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const target = await pickWebExportTarget(imageObjs, options);
    if (target?.cancelled) return { downloadedCount: 0 };
    if (typeof options.onStart === 'function') options.onStart();

    if (target?.directoryHandle) {
      return saveImageObjectsToDirectory(imageObjs, target.directoryHandle, options
      );
    }

    const downloads = [];
    const usedNames = new Set();
    for (let i = 0; i < imageObjs.length; i++) {
      const entry = await imageObjectDownloadEntry(imageObjs[i], (imageObjs.length === 1 && options.filename) || uniqueImageExportName(imageObjs[i], usedNames),
      );
      if (!entry) continue;
      downloads.push(entry);

      progress?.({
        phase: 'prepare-progress',
        preparedCount: downloads.length,
      });
      if (i % 2 === 1 || i === imageObjs.length - 1) {
        await delay(0);
      }
    }

    if (!downloads.length) return { downloadedCount: 0 };

    const single = downloads.length === 1;
    let data, filename, mime;

    if (single) {
      const item = downloads[0];
      data = item.data;
      filename = item.name;
      mime = item.mime || 'image/png';
    } else {
      await delay(0);

      const zip = await root.BoardfishWebBoardContainer.createZipBlob(downloads);

      data = zip.blob;
      filename = target?.filename || `images_${randomHex()}.zip`;
      mime = 'application/zip';
    }
    progress?.({ phase: 'save-start', preparedCount: downloads.length });

    await saveExportData(data, target, filename, mime);

    progress?.({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length });
    return { downloadedCount: downloads.length };
  }

  async function pickWebExportTarget(imageObjs, options = {}) {
    const mode = options.targetMode || 'auto';
    if (mode === 'folder') {
      const folderTarget = await pickWebExportDirectory();
      if (folderTarget) return folderTarget;
    }
    if (typeof root.showSaveFilePicker !== 'function') return null;
    const single = imageObjs.length === 1;
    const ext = single ? guessImageExtForObjectExport(imageObjs[0]) : 'zip';
    const mime = single ? mimeForImageExt(ext) : 'application/zip';
    const filename = single
      ? withImageExtension(options.filename || `image_${randomHex()}.${ext}`, ext)
      : (options.filename || `images_${randomHex()}.zip`);
    try {
      const handle = await root.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: single ? 'Image' : 'ZIP archive',
          accept: { [mime]: [`.${ext}`] },
        }],
        excludeAcceptAllOption: false,
      });
      return handle ? { handle, filename } : { cancelled: true };
    } catch (err) {
      if (err?.name === 'AbortError') return { cancelled: true };

      return null;
    }
  }

  async function pickWebExportDirectory() {
    if (typeof root.showDirectoryPicker !== 'function') return null;
    try {
      const handle = await root.showDirectoryPicker({ mode: 'readwrite' });
      return handle ? { directoryHandle: handle } : { cancelled: true };
    } catch (err) {
      if (err?.name === 'AbortError') return { cancelled: true };

      return null;
    }
  }

  async function writeFileHandle(handle, data) {
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async function writeEntryToDirectory(directoryHandle, entry) {
    await writeFileHandle(await directoryHandle.getFileHandle(entry.name, { create: true }), entry.data);
  }

  async function saveImageObjectsToDirectory(imageObjs, directoryHandle, options = {}) {
    const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const usedNames = new Set();
    let savedCount = 0;

    for (let i = 0; i < imageObjs.length; i++) {
      const name = uniqueImageExportName(imageObjs[i], usedNames);

      const entry = await imageObjectDownloadEntry(imageObjs[i], name
      );
      if (!entry) {
        progress?.({
          phase: 'prepare-progress',
          preparedCount: i + 1,
        });
        continue;
      }

      progress?.({
        phase: 'prepare-progress',
        preparedCount: i + 1,
      });

      try {
        await writeEntryToDirectory(directoryHandle, entry);
        savedCount++;
      } catch {}

      progress?.({
        phase: 'save-progress',
        preparedCount: i + 1,
        finishedCount: i + 1,
      });
      if (i % 2 === 1 || i === imageObjs.length - 1) {
        await delay(0);
      }
    }

    return { downloadedCount: savedCount };
  }

  async function saveExportData(data, target, fallbackName, type) {
    if (target?.handle) {
      await writeFileHandle(target.handle, data);
      return;
    }
    root.BoardfishRuntime.downloadBlob(data instanceof Blob && data.type === type ? data : new Blob([data], { type }), fallbackName);
  }

  function withImageExtension(name, ext) {
    const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase() || 'png';
    return String(name || `image.${cleanExt}`).replace(/\.(png|jpe?g|webp|gif)$/i, '') + `.${cleanExt}`;
  }

  function selectedImageObjects() {
    const selectedObjs = [];
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (obj?.type === 'image') selectedObjs.push(obj);
    }
    return selectedObjs;
  }

  root.BoardfishExportUtils = Object.freeze({
    createProgressUpdater,
    downloadImageObjects,
    guessImageExtFromDataUrl,
    randomHex,
    selectedImageObjects,
  });
})(typeof window !== 'undefined' ? window : globalThis);
