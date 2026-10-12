'use strict';

var confirmDirtyBeforeOpen;
var openBoardFromPath;
var finishFailedOpen;

{
  document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
  startCanvasSizeTracking();
  resizeCanvas();
  snapshot();
  markSaved();

  confirmDirtyBeforeOpen = async function confirmDirtyBeforeOpen() {
    if (!isDirty()) return true;

    const choice = await showUnsavedDialog();

    if (choice === 'cancel') {
      return false;
    }
    if (choice !== 'save') return true;
    const saved = await saveBoard();

    if (!saved) {
      return false;
    }
    return true;
  };

  openBoardFromPath = async function openBoardFromPath(filePath) {
    try {
      const fileLabel = BoardfishRuntime.describeFileRef(filePath);
      _boardOpening = true;
      beginOpeningFreeze();
      showIslandMsg('Opening');
      const data = await invokeReadBoard(filePath);
      applyBoardData(data);
      currentFileRef = filePath;
      currentFilePath = fileLabel;
      await finishOpenedBoard();
    } catch (err) {
      finishFailedOpen(err);
    }
  };

  function openFailureIslandMessage(err) {
    if (err?.boardfishLimit) return err.boardfishUserMessage || 'Board Limit Exceeded';
    const raw = String(err?.message || err || '').replace(/^Error:\s*/i, '').trim();
    const name = String(err?.name || '');
    let detail = '';
    if (/^(NotAllowedError|SecurityError)$/i.test(name) || /^(permission|access denied|not allowed)\b/i.test(raw)) {
      detail = 'Permission Denied';
    } else if (/^(NotFoundError|NotReadableError)$/i.test(name) || /^(file unavailable|no file selected|(?:file|image) read failed|failed to fetch)\b/i.test(raw)) {
      detail = 'File Unavailable';
    } else if (name === 'NotSupportedError' || /^unsupported\b/i.test(raw)) {
      detail = 'Unsupported File';
    } else if (/^(file entry too large|ZIP size limit exceeded)\b/i.test(raw)) {
      detail = 'File Too Large';
    } else if (name === 'SyntaxError' || /^(invalid|truncated|missing|file checksum mismatch|image format mismatch|corrupt|expected image|base64)\b/i.test(raw)) {
      detail = 'Invalid File';
    }
    return detail ? `Open Failed: ${detail}` : 'Open Failed';
  }

  finishFailedOpen = function finishFailedOpen(err) {
    const message = openFailureIslandMessage(err);

    _boardOpening = false;
    finishPillTask({
      beforeFinish: endOpeningFreeze,
      finalMsg: message,
      duration: long_message,
    });
  };
}
