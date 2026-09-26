'use strict';

function finishImageExport(busyPill, releaseInputShield, finalMsg = null) {
  if (busyPill) finishPillTask({ beforeFinish: releaseInputShield, busyPill, finalMsg });
  else releaseInputShield();
}

async function saveSelectedImage(imageObjs) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ExportDebug.startMassive('exportImage', imageObjs);
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  let busyPill = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
      targetMode: 'file',
      onStart: () => {
        busyPill = startIslandBusyMsg('Exporting');
        ExportDebug.step(dbg, 'web-export:pill-start', { imageCount: 1 });
      },
      onProgress: ({ phase, preparedCount, finishedCount }) => {
        if (phase === 'save-progress' && busyPill) busyPill.update(`${finishedCount || preparedCount || 1}/1`);
      },
    });
    const saved = (downloadResult?.downloadedCount || 0) > 0;
    ExportDebug.end(dbg, { saved, ...downloadResult });
    finishImageExport(busyPill, releaseInputShield, saved ? '1 Image Exported' : null);
  } catch (err) {
    finishImageExport(busyPill, releaseInputShield);
    ExportDebug.end(dbg, { saved: false, error: String(err) });
    console.error('Export Failed:', err);
  }
}

async function saveSelectedImages(imageObjs) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ExportDebug.start('exportImages', { selectedCount: selectedIds.size });
  const stopTotalWatch = ExportDebug.watch(dbg, 'export-total', { mode: 'selected' }, 5000);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ExportDebug.step(dbg, 'images:found', { imageCount: imageObjs.length });
  ExportDebug.startMassive('exportImages', imageObjs);
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  let busyPill = null;
  let updateProgress = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
      targetMode: 'folder',
      onStart: () => {
        busyPill = startIslandBusyMsg(`0/${imageObjs.length}`);
        updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
        ExportDebug.step(dbg, 'web-export:pill-start', { imageCount: imageObjs.length });
      },
      onProgress: ({ /* BOARDFISH_DEV_DIAGNOSTICS_START */ phase, totalCount, /* BOARDFISH_DEV_DIAGNOSTICS_END */ preparedCount, finishedCount }) => updateProgress?.(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ phase || 'prepare-progress', /* BOARDFISH_DEV_DIAGNOSTICS_END */
        preparedCount ?? finishedCount ?? imageObjs.length,
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ { finishedCount: finishedCount ?? '', totalCount: totalCount ?? imageObjs.length }, /* BOARDFISH_DEV_DIAGNOSTICS_END */
      ),
    });
    const downloadedCount = downloadResult?.downloadedCount || 0;
    const saved = downloadedCount > 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stopTotalWatch?.({ saved, ...downloadResult });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ExportDebug.end(dbg, { saved, imageCount: imageObjs.length, ...downloadResult });
    finishImageExport(busyPill, releaseInputShield, saved ? `${downloadedCount} Image${downloadedCount === 1 ? '' : 's'} Exported` : null);
  } catch (err) {
    finishImageExport(busyPill, releaseInputShield);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stopTotalWatch?.({ error: String(err) });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ExportDebug.end(dbg, { saved: false, imageCount: imageObjs.length, error: String(err) });
    console.error('Export Failed:', err);
  }
}

function exportSelectedImages() {
  const imageObjs = BoardfishExportUtils.selectedImageObjects();
  if (imageObjs.length === 1) saveSelectedImage(imageObjs);
  else if (imageObjs.length) saveSelectedImages(imageObjs);
}
