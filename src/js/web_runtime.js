'use strict';

(function initBoardfishRuntime(root) {
  const BOARD_FILE_TYPES = Object.freeze([
    {
      description: 'Boardfish board',
      accept: {
        'application/octet-stream': ['.bf'],
      },
    },
  ]);
  const FILE_OPERATION_TIMEOUT_MS = 30000;
  const FILE_OPERATION_MAX_TIMEOUT_MS = 5 * 60 * 1000;
  const FILE_ABORT_TIMEOUT_MS = 5000;
  const FILE_COMPARISON_TIMEOUT_MS = 5000;
  const FILE_WRITE_MIN_BYTES_PER_SECOND = 2 * 1024 * 1024;

  function webFileRef(file, name = '') {
    return {
      kind: 'web-file',
      file,
      name: name || file?.name || 'board.bf',
    };
  }

  function webFileHandleRef(handle) {
    return {
      kind: 'web-file-handle',
      handle,
      name: handle?.name || 'board.bf',
    };
  }

  function webDownloadRef(name) {
    return {
      kind: 'web-download',
      name: name || 'board.bf',
    };
  }

  function describeFileRef(ref) {
    if (!ref) return '';
    return ref.name || ref.handle?.name || ref.file?.name || '';
  }

  function fileNameFromRef(ref, fallback = 'board.bf') {
    const value = describeFileRef(ref) || fallback;
    return String(value).split(/[\\/]/).pop() || fallback;
  }

  function canSaveToExistingTarget(ref) {
    if (!ref) return false;
    return ref.unusable !== true && ref.kind === 'web-file-handle';
  }

  function persistentFileHandleFromRef(ref) {
    if (ref?.kind !== 'web-file-handle') return null;
    return ref.handle || null;
  }

  async function fileRefsAreSameEntry(firstRef, secondRef) {
    const firstHandle = persistentFileHandleFromRef(firstRef);
    const secondHandle = persistentFileHandleFromRef(secondRef);
    if (!firstHandle || !secondHandle) return null;
    if (firstHandle === secondHandle) return true;

    for (const handle of [firstHandle, secondHandle]) {
      const otherHandle = handle === firstHandle ? secondHandle : firstHandle;
      if (typeof handle?.isSameEntry !== 'function') continue;
      try {
        return !!(await waitForFileOperation(() => handle.isSameEntry(otherHandle), 'Comparing Files', FILE_COMPARISON_TIMEOUT_MS));
      } catch (err) {
        // An unavailable comparison is not evidence that the files differ.
        if (err?.name === 'TimeoutError') return null;
      }
    }
    return null;
  }

  function isRecoverableImageSourceError(err) {
    if (!err || err.boardfishSaveTargetUncertain || err.boardfishLimit) return false;
    const name = String(err.name || '');
    if (/^(AbortError|NotAllowedError|SecurityError|QuotaExceededError|TimeoutError)$/i.test(name)) {
      return false;
    }
    if (/^NotReadableError$/i.test(name)) return true;
    const message = String(err.message || err);
    return /^TypeError$/i.test(name) && /failed to fetch|blob|read(?:ing)? (?:the )?file/i.test(message);
  }

  async function recoverBoardImageSources(sourceRef, board, rawImageStore) {
    const sourceHandle = persistentFileHandleFromRef(sourceRef);
    if (!sourceHandle || typeof sourceHandle.getFile !== 'function') return null;
    const freshFile = await waitForFileOperation(() => sourceHandle.getFile(), 'Refreshing Images');
    return root.BoardfishWebBoardContainer.recoverMatchingVolatileImageRefsFromContainer(board, rawImageStore, freshFile);
  }

  function fileOperationTimeoutError(stage) {
    const err = new Error(`Save Timed Out: ${stage}`);
    err.name = 'TimeoutError';
    err.boardfishSaveTargetUncertain = true;
    return err;
  }

  function markSaveTargetUncertain(err) {
    if (err && (typeof err === 'object' || typeof err === 'function')) {
      try {
        err.boardfishSaveTargetUncertain = true;
        if (err.boardfishSaveTargetUncertain === true) return err;
      } catch {
        // Some browser-provided errors are non-extensible; wrap them below.
      }
    }
    const wrapped = new Error(err?.message || String(err || 'Save Failed'));
    wrapped.name = err?.name || 'Error';
    wrapped.boardfishSaveTargetUncertain = true;
    return wrapped;
  }

  async function waitForFileOperation(run, stage, timeoutMs = FILE_OPERATION_TIMEOUT_MS) {
    let timeoutId = 0;
    const operation = Promise.resolve(run());
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(fileOperationTimeoutError(stage)), timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function fileWriteTimeoutMs(blob) {
    const bytes = Math.max(0, Number(blob?.size) || 0);
    const transferMs = bytes / FILE_WRITE_MIN_BYTES_PER_SECOND * 1000;
    return Math.min(FILE_OPERATION_MAX_TIMEOUT_MS, FILE_OPERATION_TIMEOUT_MS + transferMs);
  }

  function pickFileWithInput(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      let settled = false;
      let focusHandler = null;
      let focusCancelTimer = 0;
      const removeFocusFallback = () => {
        if (focusHandler) {
          root.removeEventListener('focus', focusHandler);
          focusHandler = null;
        }
        if (focusCancelTimer) {
          clearTimeout(focusCancelTimer);
          focusCancelTimer = 0;
        }
      };
      const done = (value) => {
        if (settled) return;
        settled = true;
        removeFocusFallback();
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => {
        const file = input.files?.[0] || null;
        done(file ? webFileRef(file) : null);
      });
      setTimeout(() => {
        if (settled) return;
        focusHandler = () => {
          focusHandler = null;
          focusCancelTimer = setTimeout(() => {
            focusCancelTimer = 0;
            if (!input.files?.length) done(null);
          }, 500);
        };
        root.addEventListener('focus', focusHandler, { once: true });
      }, 0);
      document.body.appendChild(input);
      input.click();
    });
  }

  const unlessAborted = (picker) => picker.catch((err) => {
    if (err?.name === 'AbortError') return null;
    throw err;
  });

  async function openFileDialog() {
    if (typeof root.showOpenFilePicker !== 'function') return pickFileWithInput('.bf');
    const handles = await unlessAborted(root.showOpenFilePicker({
      multiple: false,
      types: BOARD_FILE_TYPES,
      excludeAcceptAllOption: false,
    }));
    return handles?.[0] ? webFileHandleRef(handles[0]) : null;
  }

  async function saveFileDialog(defaultName = 'board.bf') {
    if (typeof root.showSaveFilePicker !== 'function') return webDownloadRef(defaultName);
    const handle = await unlessAborted(root.showSaveFilePicker({
      suggestedName: defaultName,
      types: BOARD_FILE_TYPES,
      excludeAcceptAllOption: false,
    }));
    return handle ? webFileHandleRef(handle) : null;
  }

  async function fileFromRef(ref) {
    if (ref?.kind === 'web-file') return ref.file;
    if (ref?.kind === 'web-file-handle') return ref.handle.getFile();
    throw new Error('File Unavailable');
  }

  async function readBoard(ref) {
    const file = await fileFromRef(ref);
    if (!file) throw new Error('No File Selected');
    if (file.size > root.BoardfishWebLimits.LIMITS.maxBoardContentBytes + 10 * 1024 * 1024) {
      throw root.BoardfishWebLimits.limitError(root.BoardfishWebLimits.boardContentLimitMessage());
    }
    return root.BoardfishWebBoardContainer.readBoardContainer(file, {
      lazyImageRefs: true,

      maxBoardContentBytes: root.BoardfishWebLimits.LIMITS.maxBoardContentBytes,
      validateBoardPayload: root.BoardfishWebLimits.validateBoardPayload,
    });
  }

  async function ensureReadWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    const options = { mode: 'readwrite' };
    const permission = await waitForFileOperation(() => handle.queryPermission(options), 'Checking Permission');
    if (permission === 'granted') return true;
    return (await waitForFileOperation(() => handle.requestPermission(options), 'Requesting Permission')) === 'granted';
  }

  async function writeBlobToHandle(handle, blob) {
    if (!(await ensureReadWritePermission(handle))) {
      throw new Error('Permission Denied');
    }
    const timeoutMs = fileWriteTimeoutMs(blob);
    const writable = await waitForFileOperation(() => handle.createWritable(), 'Opening File');
    let stage = 'Writing File';
    try {
      await waitForFileOperation(() => writable.write(blob), stage, timeoutMs);
      stage = 'Closing File';
      await waitForFileOperation(() => writable.close(), stage, timeoutMs);
    } catch (err) {
      let failure = err;
      if (stage === 'Closing File') failure = markSaveTargetUncertain(failure);
      if (typeof writable.abort === 'function') {
        try {
          await waitForFileOperation(() => writable.abort(failure), 'Aborting Save', FILE_ABORT_TIMEOUT_MS);
        } catch {
          failure = markSaveTargetUncertain(failure);
        }
      }
      throw failure;
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function saveBoard(ref, board, options = {}) {
    const rawImageStore = options.imageStore || root.imageStore || {};
    const validateBoardPayload = root.BoardfishWebLimits.validateBoardPayload;
    const writesExistingHandle = ref?.kind === 'web-file-handle';
    const sourceTargetSameEntry = writesExistingHandle && Object.hasOwn(options, 'sourceFileRef')
      ? await fileRefsAreSameEntry(ref, options.sourceFileRef)
      : null;
    const stabilizeImageSources = root.BoardfishWebBoardContainer.stabilizeVolatileImageRefs;

    const preparePayload = async () => {
      if (writesExistingHandle && sourceTargetSameEntry !== false && typeof stabilizeImageSources === 'function') {
        await stabilizeImageSources(board, rawImageStore);
      }

      return await root.BoardfishWebBoardContainer.createBoardContainerBlob(
        board,
        rawImageStore,
        {
          validateBoardPayload,
        },
      );
    };

    const writePayload = async (payload) => {
      if (writesExistingHandle) {
        try {
          await writeBlobToHandle(ref.handle, payload.blob);
        } catch (err) {
          if (err?.boardfishSaveTargetUncertain) ref.unusable = true;
          throw err;
        }
      } else {
        downloadBlob(payload.blob, fileNameFromRef(ref, 'board.bf'));
      }
    };

    let payload;
    try {
      payload = await preparePayload();
      await writePayload(payload);
    } catch (err) {
      if (!isRecoverableImageSourceError(err)) throw err;
      const recovered = await recoverBoardImageSources(
        options.sourceFileRef,
        board,
        rawImageStore,
      );
      if (recovered !== true) throw err;

      payload = await preparePayload();
      await writePayload(payload);
    }
  }

  const api = Object.freeze({
    canSaveToExistingTarget,
    downloadBlob,
    fileRefFromFile: webFileRef,
    openFileDialog,
    readBoard,
    saveBoard,
    saveFileDialog,
  });

  root.BoardfishRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
