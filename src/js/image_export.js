'use strict';

function finishImageExport(busyPill, releaseInputShield, finalMsg = null) {
  if (busyPill) finishPillTask({ beforeFinish: releaseInputShield, busyPill, finalMsg });
  else releaseInputShield();
}

async function saveSelectedImages(imageObjs) {
  const single = imageObjs.length === 1;
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  let busyPill = null;
  let updateProgress = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs, {
      targetMode: single ? 'file' : 'folder',
      onStart: single ? () => {
        busyPill = startIslandBusyMsg('Exporting');
      } : () => {
        busyPill = startIslandBusyMsg(`0/${imageObjs.length}`);
        updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
      },
      onProgress: single ? ({ phase, preparedCount, finishedCount }) => {
        if (phase === 'save-progress' && busyPill) busyPill.update(`${finishedCount || preparedCount || 1}/1`);
      } : ({ preparedCount, finishedCount }) => updateProgress?.(preparedCount ?? finishedCount ?? imageObjs.length),
    });
    const downloadedCount = downloadResult?.downloadedCount || 0;
    const finalMsg = downloadedCount > 0
      ? (single ? '1 Image Exported' : `${downloadedCount} Image${downloadedCount === 1 ? '' : 's'} Exported`)
      : null;
    finishImageExport(busyPill, releaseInputShield, finalMsg);
  } catch {
    finishImageExport(busyPill, releaseInputShield);
  }
}

function exportSelectedImages() {
  const imageObjs = BoardfishExportUtils.selectedImageObjects();
  if (imageObjs.length) saveSelectedImages(imageObjs);
}
