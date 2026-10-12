'use strict';

function finishImageExport(busyPill, releaseInputShield, finalMsg = null) {
  if (busyPill) finishPillTask({ beforeFinish: releaseInputShield, busyPill, finalMsg });
  else releaseInputShield();
}

async function saveSelectedImage(imageObjs) {
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  let busyPill = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs, {
      targetMode: 'file',
      onStart: () => {
        busyPill = startIslandBusyMsg('Exporting');
      },
      onProgress: ({ phase, preparedCount, finishedCount }) => {
        if (phase === 'save-progress' && busyPill) busyPill.update(`${finishedCount || preparedCount || 1}/1`);
      },
    });
    const saved = (downloadResult?.downloadedCount || 0) > 0;

    finishImageExport(busyPill, releaseInputShield, saved ? '1 Image Exported' : null);
  } catch {
    finishImageExport(busyPill, releaseInputShield);
  }
}

async function saveSelectedImages(imageObjs) {
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  let busyPill = null;
  let updateProgress = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs, {
      targetMode: 'folder',
      onStart: () => {
        busyPill = startIslandBusyMsg(`0/${imageObjs.length}`);
        updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
      },
      onProgress: ({  preparedCount, finishedCount }) => updateProgress?.(preparedCount ?? finishedCount ?? imageObjs.length),
    });
    const downloadedCount = downloadResult?.downloadedCount || 0;
    const saved = downloadedCount > 0;

    finishImageExport(busyPill, releaseInputShield, saved ? `${downloadedCount} Image${downloadedCount === 1 ? '' : 's'} Exported` : null);
  } catch {
    finishImageExport(busyPill, releaseInputShield);
  }
}

function exportSelectedImages() {
  const imageObjs = BoardfishExportUtils.selectedImageObjects();
  if (imageObjs.length === 1) saveSelectedImage(imageObjs);
  else if (imageObjs.length) saveSelectedImages(imageObjs);
}
