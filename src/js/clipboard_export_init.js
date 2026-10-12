const finishWebClipboardTokenWrite = (result, token) => {
  if (!result?.boardfishTokenWritten) return;
  globalThis.markJsClipboardWebTokenWritten?.(token);
};

const writeWebClipboardTokenForJsClipboard = () => {
  if (globalThis.document?.visibilityState === 'hidden') {
    return Promise.resolve({ boardfishTokenWritten: false });
  }
  const webToken = globalThis.getJsClipboardWebToken?.() || '';
  let clipboardWrite;
  try {
    // Start the protected browser write synchronously in the copy gesture.
    clipboardWrite = BoardfishClipboardIO.copyBoardfishTokenToClipboard(webToken);
  } catch {
    return Promise.resolve({ boardfishTokenWritten: false });
  }
  return Promise.resolve(clipboardWrite)
    .then((result) => {
      finishWebClipboardTokenWrite(result, webToken);
      return result;
    })
    .catch(() => {
      return { boardfishTokenWritten: false };
    });
};

const readWebClipboardTokenForPaste = async (clipboardData) => {
  if (clipboardData) {
    return {
      checked: true,
      token: BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(clipboardData),
    };
  }
  try {
    return await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser();
  } catch {
    return { checked: false, token: '' };
  }
};

const trimPastedTextObjectContent = (obj) => {
  if (obj?.type !== 'text') return;
  const content = textForTextObjectPaste(obj.data?.content);
  if (content === obj.data.content) return;
  obj.data.content = content;
  clearTextObjectLayoutRuntime(obj);
  syncTextAutoHeight(obj);
};

const webSourceClipboardMime = (source) => {
  if (isWebImageRef(source)) return String(source.mime || '').toLowerCase();
  if (typeof source === 'string') return (/^data:([^;,]+)/i.exec(source)?.[1] || '').toLowerCase();
  return '';
};

const createWebSourcePngClipboardBlob = (obj, source) => {
  if (imageNeedsRendering(obj)) return null;
  if (typeof Blob === 'undefined') return null;
  if (webSourceClipboardMime(source) !== 'image/png') return null;

  return readableImageSourceBlob(source).catch(() => {
    return null;
  });
};

async function pasteWebImageBlob(blob, wx, wy) {
  const imageBlob = blob.type ? blob : blob.slice(0, blob.size, 'image/png');

  await insertImageFiles([imageBlob], wx, wy);
}

const copySelected = (options = {}) => {
  const animateCopy = options.animateCopy !== false;

  if (!selectedIds.size) {
    return false;
  }

  if (selectedIds.size > 1) {
    const clonedObjs = [];

    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj, true);

      clonedObjs.push(cloned);
    }
    if (!clonedObjs.length) {
      return false;
    }

    setJsClipboard({ type: 'objects', objects: clonedObjs });
    const webClipboardWrite = writeWebClipboardTokenForJsClipboard();

    // The in-app clipboard is populated above; wait until its browser marker write settles
    // before starting the copied objects' jiggle.
    if (animateCopy) {
      webClipboardWrite
        .then(() => BoardfishMotion.applyCopyFeedback({ objects: clonedObjs }))
        .catch(() => {});
    }
    return true;
  }

  const obj = getFirstSelectedObject();
  if (!obj) {
    return false;
  }

  const cloned = cloneObject(obj, true);

  setJsClipboard({ type: 'objects', objects: [cloned] });

  if (obj.type === 'text') {
    const clipboardText = textForClipboard(obj.data.content);

    const webToken = globalThis.getJsClipboardWebToken?.() || '';

    BoardfishClipboardIO.copyTextToClipboard(
      clipboardText, {
        boardfishToken: webToken
      }
    )
      .then((result) => {
        finishWebClipboardTokenWrite(result, webToken);
        // Do not start a full-board jiggle while large clipboard serialization is running.
        if (animateCopy) BoardfishMotion.applyCopyFeedback({ objects: [obj] });
      })

      .catch(() => {})

      ;
    return true;
  }

  if (obj.type === 'image') {
    const writeWebPngBlob = async (blobOrPromise) => {
      const webToken = globalThis.getJsClipboardWebToken?.() || '';

      try {
        const result = await BoardfishClipboardIO.copyImageBlobToClipboard(blobOrPromise, webToken);

        finishWebClipboardTokenWrite(result, webToken);
        // Wait for PNG encoding and the system write before scheduling jiggle frames.
        if (animateCopy) BoardfishMotion.applyCopyFeedback({ objects: [obj] });
        return true;
      } catch {
        return false;
      }
    };
    const storedSource = BoardfishImageStore.getSource(obj.data.imgKey);
    const renderedPngBlob = async () => {
      const canvas = renderImageToCanvas(cloned) || await renderStoredImageToCanvas(cloned, storedSource);
      if (!canvas) throw new Error('Image Unavailable');
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw new Error('Clipboard Image Creation Failed');
      return blob;
    };
    const sourcePngBlob = createWebSourcePngClipboardBlob(obj, storedSource);
    // Pass the pending encode into ClipboardItem so clipboard.write starts in
    // the trusted copy gesture instead of after canvas.toBlob completes.
    return writeWebPngBlob(sourcePngBlob ? sourcePngBlob.then((blob) => blob || renderedPngBlob()) : renderedPngBlob());
  }
};

const cutSelected = () => {
  if (!hasSelection() || editingId) return false;
  let copyResult;
  try {
    copyResult = copySelected({ animateCopy: false });
  } catch {
    return false;
  }
  if (copyResult === false) return false;
  deleteSelected();
  if (copyResult && typeof copyResult.catch === 'function') {
    copyResult.catch(() => {});
  }
  return true;
};

async function pasteAtPos(wx, wy, clipboardData = null) {
  if (_pasteInProgress) {
    return;
  }
  _pasteInProgress = true;
  try {
    let browserClipboardItems = null;
    if (jsClipboard && (clipboardData || _jsClipboardWebMaybeStale)) {
      const webClipboardToken = await readWebClipboardTokenForPaste(clipboardData);
      browserClipboardItems = webClipboardToken.items || null;
      if (!jsClipboardStillCurrent(

        {
          webClipboardTokenChecked: webClipboardToken.checked,
          webClipboardToken: webClipboardToken.token,
        }
      )) {
        clearJsClipboard();
      }
    }
    if (jsClipboard) {
      if (jsClipboard.type === 'objects') {
        const sourceObjects = jsClipboard.objects;
        if (!BoardfishWebLimits.canAddObjects(sourceObjects.length)) return;
        let additionalTextCharacters = 0;
        for (const obj of sourceObjects) {
          if (obj?.type === 'text') {
            additionalTextCharacters += BoardfishWebLimits.textCharacterCount(textForTextObjectPaste(obj.data?.content));
          }
        }
        if (!BoardfishWebLimits.canAcceptAdditionalTextCharacters(additionalTextCharacters)) return;

        const clones = cloneObjects(sourceObjects, true);

        let additionalTextBytes = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const obj of clones) {
          trimPastedTextObjectContent(obj);

          if (obj?.type === 'text') {
            additionalTextBytes += BoardfishWebLimits.textByteLength(String(obj.data?.content || ''));
          }
          minX = Math.min(minX, obj.x); minY = Math.min(minY, obj.y);
          maxX = Math.max(maxX, obj.x + obj.w); maxY = Math.max(maxY, obj.y + obj.h);
        }

        const canAcceptContent = BoardfishWebLimits.canAcceptAdditionalContentBytes(
          additionalTextBytes,
          clones.length
        );

        if (!canAcceptContent) {
          return;
        }
        const dx = wx - (minX + maxX) / 2, dy = wy - (minY + maxY) / 2;
        const pastedIds = [];

        for (const o of clones) {
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
          BoardfishEditorState.addObject(o);
          pastedIds.push(o.id);
        }
        BoardfishEditorState.setSelection(pastedIds, {
          primaryId: pastedIds[pastedIds.length - 1],
        });

        scheduleRender(true, true);

        pushHistory('paste-objects');

        return;
      }
    }
    const eventImageFile = BoardfishClipboardIO.readClipboardImageFileFromEvent(clipboardData);
    if (eventImageFile) {
      await pasteWebImageBlob(eventImageFile, wx, wy);
      return;
    }
    const eventText = BoardfishClipboardIO.readClipboardTextFromEvent(clipboardData);

    const pastePlainText = (text) => {
      if (text) {
        addText(wx, wy, text, { anchor: 'center', contentPrepared: true });
      }
    };
    if (/\S/.test(eventText)) {
      pastePlainText(textForExternalTextObjectPaste(eventText));
      return;
    }
    const releaseInputShield = acquireInputShield();
    try {
      const clipboardItems = browserClipboardItems || (
        navigator.clipboard?.read ? await navigator.clipboard.read() : []
      );
      let imageBlob = null;
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type !== 'image/png' && type !== 'image/jpeg') continue;
          imageBlob = await item.getType(type);

          break;
        }
        if (imageBlob) break;
      }
      if (imageBlob) {
        releaseInputShield();
        await pasteWebImageBlob(imageBlob, wx, wy);
        return;
      }

      const browserText = await navigator.clipboard.readText();

      pastePlainText(textForExternalTextObjectPaste(browserText));
    } catch {} finally {
      releaseInputShield();
    }
  } finally {
    _pasteInProgress = false;
  }
}

document.addEventListener('paste', (e) => {
  if (editingId) return;
  e.preventDefault();
  if (isBoardInputBlocked()) return;
  const point = boardCursorWorldPoint();
  pasteAtPos(point.x, point.y, e.clipboardData);
});
