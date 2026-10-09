// ─── Clipboard / image debugger ──────────────────────────────────────────────
var ClipDebug = (() => {
  const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

  const MAX_EVENTS = 2000;

  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish clipboard]',
    sanitize: sanitizeDebugMeta,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish clipboard debugger enabled. Use finishDebug({ clipboard: ["textPasteLagReport", "textClipboardReport", "copyPanReport", "copyBreakdown", "pasteBreakdown", "largePasteReport", "status", "phaseSummary", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish clipboard debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function debugRow(e, includeSkipped = true) {
    return {
      id: e.id,
      op: e.op,
      step: e.step,
      total: e.total,
      dt: e.dt,
      ms: e.meta?.ms ?? '',
      path: e.meta?.path || '',
      objectId: e.meta?.objectId || '',
      ...debugMetaFields(e, 'selectedCount objectCount imageCount textObjectCount textCharCount largestTextChars'),
      ...debugMetaFields(e, 'trimmedTextObjects additionalTextBytes processed accepted historyIndex'),
      imgKey: e.meta?.imgKey || '',
      ...debugMetaFields(e, 'added objectDelta blobSize'),
      blobType: e.meta?.type || '',
      fileName: e.meta?.fileName || '',
      fileSize: e.meta?.fileSize ?? '',
      source: e.meta?.source || '',
      sourceKind: e.meta?.sourceKind || '',
      sourceLen: e.meta?.sourceLen ?? '',
      sourcePrefix: e.meta?.sourcePrefix || '',
      ...debugMetaFields(e, 'sourceBytes bytes width height clipboardWriteMs textLen boardfishTokenWritten richAttempted'),
      inputType: e.meta?.inputType || '',
      eventType: e.meta?.eventType || '',
      ...debugMetaFields(e, 'eventAgeMs eventAt inputDataLength isComposing isTrusted cancelable defaultPrevented sourceTextLen fallbackTextChars'),
      ...debugMetaFields(e, 'candidateTextLen selectedChars selectionStart selectionEnd replacementStart replacementEnd replacementChars oldChars nextChars'),
      ...debugMetaFields(e, 'insertedChars removedChars proxyChars textBytes textLineCount largestLineChars objectWidth objectHeight editStartChars'),
      ...debugMetaFields(e, 'layoutCachePresent layoutCacheLines layoutPatched layoutPatchOldLines layoutPatchNewLines layoutPatchRemovedLines layoutPatchInsertedLines layoutPatchLineDelta layoutPatchLogicalLineDelta'),
      layoutPatchReason: e.meta?.layoutPatchReason || '',
      ...debugMetaFields(e, 'historyActionMs historyPushed setRangeTextMs valueAssignMs valueBuildMs valueSetMs selectionSetMs textareaMutationMs'),
      textareaMutationMethod: e.meta?.textareaMutationMethod || '',
      ...debugMetaFields(e, 'dispatchMs heightChanged restoredMinLinesReset updatedObjectHeight updatedLogicalLines updatedCachedLines'),
      updatedCachedLineSource: e.meta?.updatedCachedLineSource || '',
      ...debugMetaFields(e, 'updatedExpectedLogicalHeight updatedExpectedCachedHeight updatedHeightDeltaFromLogical updatedHeightDeltaFromCached'),
      ...debugMetaFields(e, 'beforeAutoHeightObjectHeight beforeAutoHeightLogicalLines beforeAutoHeightCachedLines'),
      beforeAutoHeightCachedLineSource: e.meta?.beforeAutoHeightCachedLineSource || '',
      ...debugMetaFields(e, 'beforeAutoHeightExpectedLogicalHeight beforeAutoHeightExpectedCachedHeight beforeAutoHeightHeightDeltaFromLogical beforeAutoHeightHeightDeltaFromCached'),
      ...debugMetaFields(e, 'afterAutoHeightObjectHeight afterAutoHeightLogicalLines afterAutoHeightCachedLines'),
      afterAutoHeightCachedLineSource: e.meta?.afterAutoHeightCachedLineSource || '',
      ...debugMetaFields(e, 'afterAutoHeightExpectedLogicalHeight afterAutoHeightExpectedCachedHeight afterAutoHeightHeightDeltaFromLogical afterAutoHeightHeightDeltaFromCached'),
      ...debugMetaFields(e, 'inputEndObjectHeight inputEndLogicalLines inputEndCachedLines'),
      inputEndCachedLineSource: e.meta?.inputEndCachedLineSource || '',
      ...debugMetaFields(e, 'inputEndExpectedLogicalHeight inputEndExpectedCachedHeight inputEndHeightDeltaFromLogical inputEndHeightDeltaFromCached'),
      ...debugMetaFields(e, 'proxyScrollHeight proxyClientHeight renderBoard renderOverlay'),
      renderSource: e.meta?.renderSource || '',
      ...debugMetaFields(e, 'pasted seq expected current'),
      ...(includeSkipped ? { skipped: e.meta?.skipped ?? '' } : {}),
      error: e.meta?.error || '',
    };
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function stepRows(filter, includeSkipped) {
    const rows = events.filter(e => e.step && e.step !== 'start' && filter(e)).map(e => debugRow(e, includeSkipped));
    console.table(rows);
    return rows;
  }
  const summary = () => stepRows(() => true, false);
  const phaseSummary = () => stepRows(() => true);
  const copyBreakdown = () => stepRows(e => e.op === 'copySelected' || e.op === 'copyTextEditSelection');

  function lastRunOf(op, runsKey) {
    const starts = events.filter(e => e.op === op && e.step === 'start');
    const start = starts[starts.length - 1];
    if (!start) {
      const empty = { [runsKey]: 0, verdict: `no ${op} events captured` };
      console.table([empty]);
      return { empty };
    }
    const run = events.filter(e => e.id === start.id && e.op === op);
    return {
      starts,
      start,
      run,
      latest: (stepName) => debugLast(run, e => e.step === stepName),
      first: (stepName) => run.find(e => e.step === stepName),
    };
  }

  function copyPanReport() {
    const { empty, starts: copyStarts, start: copyStart, run, latest } = lastRunOf('copySelected', 'copyRuns');
    if (empty) return empty;
    const copyEnd = latest('end');
    const copyDoneAt = copyEnd?.at ?? run[run.length - 1]?.at ?? copyStart.at;
    const copyWindowRows = events.filter(e => e.at >= copyStart.at && e.at <= copyDoneAt + 1);
    const renderCanvasEnd = copyWindowRows.find(e => e.op === 'renderImageToCanvas' && e.step === 'end');
    const pngBlobEnd = copyWindowRows.find(e => e.op === 'canvasToPngBlob' && e.step === 'end');
    const webSourcePngBlob = latest('copy:web-source-png-blob');
    const webClipboardWriteEnd = latest('copy:web-clipboard-write-end');

    const viewportEvents = typeof ViewportDebug !== 'undefined' ? ViewportDebug.events : [];
    const frameStarts = new Map();
    for (const e of viewportEvents) {
      if (e.op === 'frame' && e.step === 'start') frameStarts.set(e.id, e);
    }
    const frameRows = viewportEvents
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => ({
        kind: 'pan-frame',
        at: e.at,
        id: e.id,
        ...(frameStarts.get(e.id)?.meta || {}),
        ...(e.meta || {}),
      }))
      .filter(row => row.at >= copyStart.at && /pan/.test(String(row.inputSource || row.sources || '')));

    const timeline = [];
    for (const e of viewportEvents) {
      if (e.at < copyStart.at) continue;
      if (e.op === 'wheel' && e.step === 'end' && e.meta?.mode === 'pan') {
        timeline.push({
          kind: 'wheel-pan',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          gapMs: '',
          deltaX: e.meta?.appliedDX ?? e.meta?.deltaX ?? '',
          deltaY: e.meta?.appliedDY ?? e.meta?.deltaY ?? '',
        });
      } else if (e.op === 'mousePan' && e.step === 'start') {
        timeline.push({
          kind: 'mouse-pan-start',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          startX: e.meta?.startX ?? '',
          startY: e.meta?.startY ?? '',
        });
      } else if (e.op === 'eventLoop' && e.step === 'gap') {
        timeline.push({
          kind: 'event-loop-gap',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          gapMs: e.meta?.gapMs ?? '',
          overMs: e.meta?.overMs ?? '',
        });
      } else if (e.op === 'longTask' && e.step === 'entry') {
        timeline.push({
          kind: 'long-task',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          durationMs: e.meta?.duration ?? '',
          startTime: e.meta?.startTime ?? '',
        });
      }
    }
    for (const row of frameRows) {
      timeline.push({
        kind: row.kind,
        at: row.at,
        afterCopyMs: round(row.at - copyStart.at),
        inputSource: row.inputSource || '',
        inputAgeMs: row.inputAgeMs ?? '',
        queueMs: row.queueMs ?? '',
        frameMs: row.frameMs ?? '',
        rafGap: row.rafGap ?? '',
        sources: row.sources || '',
      });
    }
    timeline.sort((a, b) => a.at - b.at);
    const wheelPanRows = timeline.filter(row => row.kind === 'wheel-pan');
    for (let i = 1; i < wheelPanRows.length; i++) {
      wheelPanRows[i].gapMs = round(wheelPanRows[i].at - wheelPanRows[i - 1].at);
    }
    const rawInputRows = viewportEvents
      .filter(e => e.op === 'input' && e.at >= copyStart.at)
      .map(e => ({
        at: e.at,
        step: e.step,
        ...(e.meta || {}),
      }));

    const firstPan = timeline.find(row => /pan/.test(row.kind));
    const firstPanFrame = timeline.find(row => row.kind === 'pan-frame');
    const windowEndAt = Math.max(copyDoneAt, firstPan?.at || copyDoneAt);
    const eventLoopGapsDuringCopy = timeline
      .filter(row => row.kind === 'event-loop-gap' && row.at <= windowEndAt)
      .map(row => Number(row.gapMs) || 0);
    const maxEventLoopGapMs = eventLoopGapsDuringCopy.reduce((max, value) => Math.max(max, value), 0);
    const copyPendingAtFirstPan = !!firstPan && copyDoneAt > firstPan.at;
    const sourceBytes = webSourcePngBlob?.meta?.sourceBytes || '';
    const renderCanvasMs = renderCanvasEnd?.total ?? '';
    const pngBlobMs = pngBlobEnd?.total ?? '';
    const webSourcePngBlobMs = webSourcePngBlob?.meta?.ms ?? '';
    const webBlobReady = pngBlobEnd || webSourcePngBlob;
    const webClipboardWriteAfterBlobMs = webBlobReady && (webClipboardWriteEnd || copyEnd)
      ? round((webClipboardWriteEnd?.at ?? copyEnd.at) - webBlobReady.at)
      : '';
    const maxWheelPanGapMs = wheelPanRows.reduce((max, row) => Math.max(max, Number(row.gapMs) || 0), 0);
    const postCopyWheelPanGapMs = wheelPanRows
      .filter(row => row.at >= copyDoneAt && row.at <= copyDoneAt + 1500)
      .reduce((max, row) => Math.max(max, Number(row.gapMs) || 0), 0);
    const maxPanFrameRafGapMs = timeline
      .filter(row => row.kind === 'pan-frame')
      .reduce((max, row) => Math.max(max, Number(row.rafGap) || 0), 0);
    const firstRawInput = rawInputRows.find(row => row.at >= copyDoneAt);
    const firstRawWheel = rawInputRows.find(row => row.eventType === 'wheel' && row.at >= copyDoneAt);
    const blockedInputsAfterCopy = rawInputRows
      .filter(row => row.step === 'shield-block' && row.at >= copyDoneAt && row.at <= copyDoneAt + 1500)
      .length;
    const firstRawWheelDeliveryAgeMs = Number(firstRawWheel?.eventAgeMs) || 0;
    const firstPanFrameMs = Number(firstPanFrame?.frameMs) || 0;
    const firstPanInputAgeMs = Number(firstPanFrame?.inputAgeMs) || 0;
    const likelyBlock = Math.max(
      maxEventLoopGapMs,
      firstPanInputAgeMs,
      firstPanFrameMs,
      postCopyWheelPanGapMs,
      maxPanFrameRafGapMs,
      firstRawWheelDeliveryAgeMs
    ) > 32;
    const webRenderedPath = copyEnd?.meta?.path === 'image-web-rendered';
    let verdict = 'no >32ms copy-to-pan stall captured';
    if (!firstPan) {
      verdict = blockedInputsAfterCopy
        ? 'copy captured; post-copy input was blocked by Boardfish input shield'
        : 'copy captured; no pan input captured after copy';
    } else if (blockedInputsAfterCopy) {
      verdict = 'post-copy input reached Boardfish but was blocked by input shield';
    } else if (firstRawWheelDeliveryAgeMs > 32) {
      verdict = 'pan input was generated earlier but delivered late to Boardfish';
    } else if (likelyBlock && webRenderedPath) {
      verdict = 'stutter captured on web image copy; inspect render/png/clipboard timings and pan gaps';
    } else if (likelyBlock && copyPendingAtFirstPan) {
      verdict = 'stutter overlaps browser clipboard write; inspect clipboard timing and pan gaps';
    } else if (likelyBlock) {
      verdict = 'pan frame or event-loop gap is slow; inspect viewport timeline';
    }

    const summary = {
      copyRuns: copyStarts.length,
      copyPath: copyEnd?.meta?.path || '',
      sourceBytes,
      webClipboardWriteMs: webClipboardWriteEnd?.meta?.ms ?? '',
      webSourcePngBlobMs,
      renderCanvasMs,
      pngBlobMs,
      webClipboardWriteAfterBlobMs,
      maxWheelPanGapMs: round(maxWheelPanGapMs),
      postCopyWheelPanGapMs: round(postCopyWheelPanGapMs),
      maxPanFrameRafGapMs: round(maxPanFrameRafGapMs),
      firstRawInputAfterCopyEndMs: firstRawInput ? round(firstRawInput.at - copyDoneAt) : '',
      firstRawInputType: firstRawInput?.eventType || '',
      firstRawWheelAfterCopyEndMs: firstRawWheel ? round(firstRawWheel.at - copyDoneAt) : '',
      firstRawWheelEventAfterCopyEndMs: firstRawWheel?.eventAt ? round(firstRawWheel.eventAt - copyDoneAt) : '',
      firstRawWheelDeliveryAgeMs: firstRawWheel?.eventAgeMs ?? '',
      blockedInputsAfterCopy,
      copyEndMs: copyEnd?.total ?? '',
      firstPanAfterCopyEndMs: firstPan ? round(firstPan.at - copyDoneAt) : '',
      firstPanAfterCopyMs: firstPan?.afterCopyMs ?? '',
      firstPanKind: firstPan?.kind || '',
      copyPendingAtFirstPan,
      firstPanInputAgeMs: firstPanFrame?.inputAgeMs ?? '',
      firstPanFrameMs: firstPanFrame?.frameMs ?? '',
      firstPanRafGapMs: firstPanFrame?.rafGap ?? '',
      eventLoopGapsDuringCopy: eventLoopGapsDuringCopy.length,
      maxEventLoopGapMs: round(maxEventLoopGapMs),
      verdict,
    };
    console.table([summary]);
    console.table(timeline.slice(0, 80));
    return {
      summary,
      timeline: timeline.slice(0, 200),
      rawInputRows: rawInputRows.slice(0, 200),
      copyRows: copyWindowRows.map(e => debugRow(e)),
    };
  }

  function memorySnapshotFromEvent(e) {
    const bytes = Number(e?.meta?.blobSize) || 0;
    return {
      blobMB: bytes ? Math.round(bytes / 1024 / 1024 * 100) / 100 : '',
    };
  }

  function largePasteReport() {
    const { empty, starts: pasteStarts, start: pasteStart, run, latest } = lastRunOf('pasteAtPos', 'pasteRuns');
    if (empty) return empty;
    const stepNames = new Set(run.map(e => e.step));
    const firstError = run.find(e => /(?:error|miss|empty)$/i.test(e.step) || e.meta?.error);
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const addObject = latest('paste:objects-add-start') || webInsertEnd;
    const end = latest('end');
    const objectCountBefore = pasteStart?.meta?.objectCountBefore ?? '';
    const objectCountAfter = end?.meta?.objectCountAfter ?? '';
    const objectDelta = typeof objectCountBefore === 'number' && typeof objectCountAfter === 'number'
      ? objectCountAfter - objectCountBefore
      : '';
    const pathDetected = webInsertEnd
      ? end?.meta?.path || 'web-paste-blob'
      : blobEvent
      ? 'event-or-browser-blob'
      : stepNames.has('event-clipboard:inspect')
        ? 'paste-event'
        : 'unknown';
    const checkpoints = [
      ['pasteStarted', true],
      ['eventInspected', true],
      ['imagePayloadFound', !!blobEvent || !!webInsertEnd],
      ['imagePayloadRead', !!blobEvent || !!webInsertEnd || pathDetected !== 'unknown'],
      ['objectAddStarted', !!addObject],
      ['pasteEndedAdded', end?.meta?.added === true || objectDelta > 0],
    ];
    const failedCheckpoint = checkpoints.find(([, ok]) => !ok);
    const sizeEvent = blobEvent;
    const out = {
      pasteRuns: pasteStarts.length,
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      path: end?.meta?.path || '',
      added: end?.meta?.added ?? '',
      displayReady: webInsertEnd ? true : '',
      objectCountBefore,
      objectCountAfter,
      objectDelta,
      ...debugPick(end?.meta, 'textObjectCount textCharCount largestTextChars'),
      pathDetected,
      imageSource: blobEvent?.meta?.type || '',
      blobSize: blobEvent?.meta?.blobSize ?? '',
      ...memorySnapshotFromEvent(sizeEvent),
      failedCheckpoint: failedCheckpoint ? failedCheckpoint[0] : '',
      firstErrorStep: firstError?.step || '',
      firstError: firstError?.meta?.error || '',
      verdict: failedCheckpoint
        ? `inspect ${failedCheckpoint[0]} and surrounding rows`
        : 'all paste checkpoints reached in captured run',
    };
    console.table([out]);
    console.table(checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })));
    return { summary: out, checkpoints: checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })), rows: run.map(e => debugRow(e)) };
  }

  function pasteBreakdown() {
    const { empty, starts: pasteStarts, run, latest, first } = lastRunOf('pasteAtPos', 'pasteRuns');
    if (empty) return empty;
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const objectAdd = latest('paste:objects-add-start');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const cloneDone = latest('paste:clone-done');
    const trimDone = latest('paste:text-trim-done');
    const contentLimitDone = latest('paste:content-limit-done');
    const historyStart = latest('paste:boardHistory-start');
    const historyDone = latest('paste:boardHistory-done');
    const end = latest('end');
    const imageReadAt = blobEvent?.total ?? webInsertEnd?.total ?? '';
    const objectAt = objectAdd?.total ?? webInsertEnd?.total ?? '';
    const displayAt = webInsertEnd?.total ?? '';
    const out = {
      pasteRuns: pasteStarts.length,
      path: end?.meta?.path || '',
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      imagePayloadAtMs: imageReadAt,
      objectAtMs: objectAt,
      displayReadyAtMs: displayAt,
      objectToDisplayMs: typeof objectAt === 'number' && typeof displayAt === 'number' ? Math.round((displayAt - objectAt) * 100) / 100 : '',
      ...debugPick(end?.meta, 'textObjectCount textCharCount largestTextChars'),
      cloneMs: cloneDone?.meta?.ms ?? '',
      trimMs: trimDone?.meta?.ms ?? '',
      trimmedTextObjects: trimDone?.meta?.trimmedTextObjects ?? '',
      contentLimitMs: contentLimitDone?.meta?.ms ?? '',
      contentLimitAccepted: contentLimitDone?.meta?.accepted ?? '',
      additionalTextBytes: contentLimitDone?.meta?.additionalTextBytes ?? '',
      historyMs: typeof historyStart?.total === 'number' && typeof historyDone?.total === 'number'
        ? Math.round((historyDone.total - historyStart.total) * 100) / 100
        : '',
      blobSize: blobEvent?.meta?.blobSize ?? '',
      displayReady: webInsertEnd ? true : '',
      added: end?.meta?.added ?? '',
      objectDelta: webInsertEnd?.meta?.objectDelta ?? '',
      firstPayloadStep: first('event-image-blob')?.step || first('browser-image-blob')?.step || '',
      verdict: end?.meta?.added || webInsertEnd?.meta?.added
        ? 'paste produced a drawable object'
        : 'paste did not add an image; inspect rows',
    };
    console.table([out]);
    return { summary: out, rows: run.map(e => debugRow(e)) };
  }

  function latestMetaValue(run, names) {
    for (const event of [...run].reverse()) {
      for (const name of names) {
        const value = event.meta?.[name];
        if (value !== undefined && value !== '') return value;
      }
    }
    return '';
  }

  function textPasteLagReport(options = {}) {
    const { empty, starts: pasteStarts, start: pasteStart, run, latest, first } = lastRunOf('pasteTextEditSelection', 'pasteRuns');
    if (empty) return empty;
    const summarizePasteRun = (start) => {
      const runEvents = events.filter(e => e.id === start.id && e.op === start.op);
      const runLatest = (stepName) => debugLast(runEvents, e => e.step === stepName);
      const nativeAllowed = runLatest('paste:text-edit-native-textarea-allowed');
      const end = runLatest('end');
      const last = end || runEvents[runEvents.length - 1] || start;
      const inputEndForRun = runLatest('text-edit-input:end');
      const rangeTextForRun = runLatest('paste:text-edit-range-text-set');
      const dispatchForRun = runLatest('paste:text-edit-input-dispatched');
      const inputMs = Number(inputEndForRun?.meta?.totalMs ?? inputEndForRun?.dt) || 0;
      const textareaMs = Number(rangeTextForRun?.meta?.textareaMutationMs ?? rangeTextForRun?.meta?.setRangeTextMs) || 0;
      let runVerdict = 'no >32ms paste/input stall captured';
      if (nativeAllowed && !end) runVerdict = 'native paste allowed; waiting for input/end capture';
      else if (inputMs > 32 || Number(dispatchForRun?.meta?.dispatchMs || 0) > 32) runVerdict = 'input handler slow';
      else if (textareaMs > 32) runVerdict = `textarea ${rangeTextForRun?.meta?.textareaMutationMethod || 'mutation'} slow`;
      return {
        id: start.id,
        path: end?.meta?.path || (nativeAllowed ? 'jsClipboard-text-selection-native' : ''),
        pasted: end?.meta?.pasted ?? '',
        totalMs: end?.total ?? last?.total ?? '',
        nativeAllowed: !!nativeAllowed,
        inputCaptured: !!inputEndForRun,
        fallbackTextChars: runLatest('paste:text-edit-event-read-done')?.meta?.fallbackTextChars ?? '',
        candidateTextLen: runLatest('paste:text-edit-event-read-done')?.meta?.candidateTextLen ?? '',
        insertedChars: runLatest('text-edit-input:replacement-ready')?.meta?.insertedChars ?? end?.meta?.textCharCount ?? '',
        inputHandlerMs: inputEndForRun?.meta?.totalMs ?? inputEndForRun?.dt ?? '',
        dispatchMs: dispatchForRun?.meta?.dispatchMs ?? '',
        textareaMutationMs: rangeTextForRun?.meta?.textareaMutationMs ?? rangeTextForRun?.meta?.setRangeTextMs ?? '',
        textareaMutationMethod: rangeTextForRun?.meta?.textareaMutationMethod || '',
        verdict: runVerdict,
      };
    };
    const runSummaries = pasteStarts.map(summarizePasteRun);
    const pasteEnd = latest('end') || run[run.length - 1] || pasteStart;
    const inputStart = first('text-edit-input:start');
    const inputEnd = latest('text-edit-input:end');
    const renderScheduled = latest('text-edit-input:render-scheduled');
    const layoutPatch = latest('text-edit-input:layout-patched') || latest('text-edit-input:layout-invalidated');
    const history = latest('text-edit-input:history-recorded');
    const replacement = latest('text-edit-input:replacement-ready');
    const rangeText = latest('paste:text-edit-range-text-set');
    const dispatch = latest('paste:text-edit-input-dispatched');
    const windowBeforeMs = Number(options.windowBeforeMs ?? 40) || 40;
    const windowAfterMs = Number(options.windowAfterMs ?? 1200) || 1200;
    const startAt = Math.max(0, pasteStart.at - windowBeforeMs);
    const endAt = (pasteEnd.at || pasteStart.at) + windowAfterMs;
    const viewportEvents = typeof ViewportDebug !== 'undefined' ? ViewportDebug.events : [];
    const frameStarts = new Map();
    for (const event of viewportEvents) {
      if (event.op === 'frame' && event.step === 'start') frameStarts.set(event.id, event);
    }
    const frameRows = viewportEvents
      .filter(e => e.op === 'frame' && e.step === 'end' && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        afterPasteEndMs: pasteEnd?.at ? round(e.at - pasteEnd.at) : '',
        ...(frameStarts.get(e.id)?.meta || {}),
        ...(e.meta || {}),
      }));
    const rawInputRows = viewportEvents
      .filter(e => e.op === 'input' && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        step: e.step,
        eventType: e.meta?.eventType || '',
        inputType: e.meta?.inputType || '',
        eventAgeMs: e.meta?.eventAgeMs ?? '',
        source: e.meta?.source || '',
        target: e.meta?.target || '',
        defaultPrevented: e.meta?.defaultPrevented ?? '',
        blocked: e.meta?.blocked ?? '',
      }));
    const eventLoopRows = viewportEvents
      .filter(e => (e.op === 'eventLoop' || e.op === 'longTask') && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        kind: e.op,
        step: e.step,
        gapMs: e.meta?.gapMs ?? '',
        durationMs: e.meta?.duration ?? '',
      }));
    const max = (rows, field) => rows.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    const maxFrameMs = max(frameRows, 'frameMs');
    const maxDrawMs = max(frameRows, 'totalMeasuredMs');
    const maxEditingOverlayMs = max(frameRows, 'editingOverlayMs');
    const maxEditLayoutMs = max(frameRows, 'editLayoutMs');
    const maxEditTextDrawMs = max(frameRows, 'editTextDrawMs');
    const maxEditSelectionMs = max(frameRows, 'editSelectionMs');
    const maxEventLoopGapMs = max(eventLoopRows, 'gapMs');
    const maxLongTaskMs = max(eventLoopRows, 'durationMs');
    const firstFrameAfterInput = inputEnd
      ? frameRows.find(row => row.at >= inputEnd.at)
      : frameRows.find(row => row.at >= pasteEnd.at);
    const browserPasteEventAgeMs = Number(pasteStart.meta?.eventAgeMs) || 0;
    const inputEventAgeMs = Number(inputStart?.meta?.eventAgeMs) || 0;
    const inputHandlerMs = Number(inputEnd?.meta?.totalMs ?? inputEnd?.dt) || 0;
    const dispatchMs = Number(dispatch?.meta?.dispatchMs) || 0;
    const textareaMutationMs = Number(rangeText?.meta?.textareaMutationMs ?? rangeText?.meta?.setRangeTextMs) || 0;
    const historyRecordMs = Number(history?.dt) || 0;
    const renderToFirstFrameMs = firstFrameAfterInput && renderScheduled
      ? round(firstFrameAfterInput.at - renderScheduled.at)
      : '';
    let verdict = 'no >32ms paste/input/render stall captured';
    if (browserPasteEventAgeMs > 32 || inputEventAgeMs > 32) {
      verdict = 'native paste/input event delivery was delayed before Boardfish handled it';
    } else if (inputHandlerMs > 32 || dispatchMs > 32) {
      verdict = 'Boardfish text input handler was slow; inspect text-edit-input rows';
    } else if (textareaMutationMs > 32) {
      verdict = `browser textarea ${rangeText?.meta?.textareaMutationMethod || 'mutation'} was slow for the large value`;
    } else if (historyRecordMs > 32) {
      verdict = 'text edit history checkpoint was slow';
    } else if (maxFrameMs > 32 || maxDrawMs > 32 || maxEditingOverlayMs > 32) {
      verdict = 'post-paste render frame was slow; inspect frame and draw rows';
    } else if (maxEventLoopGapMs > 32 || maxLongTaskMs > 32) {
      verdict = 'event loop gap or browser long task overlapped the paste';
    }
    const summary = {
      pasteRuns: pasteStarts.length,
      path: pasteEnd?.meta?.path || '',
      pasted: pasteEnd?.meta?.pasted ?? '',
      totalMs: pasteEnd?.total ?? '',
      browserPasteEventAgeMs: pasteStart.meta?.eventAgeMs ?? '',
      inputEventAgeMs: inputStart?.meta?.eventAgeMs ?? '',
      inputHandlerMs: inputEnd?.meta?.totalMs ?? inputEnd?.dt ?? '',
      dispatchMs: dispatch?.meta?.dispatchMs ?? '',
      ...debugPick(rangeText?.meta, 'setRangeTextMs valueAssignMs valueBuildMs valueSetMs selectionSetMs'),
      textareaMutationMs: rangeText?.meta?.textareaMutationMs ?? rangeText?.meta?.setRangeTextMs ?? '',
      textareaMutationMethod: rangeText?.meta?.textareaMutationMethod || '',
      historyRecordMs: history?.dt ?? '',
      historyPushed: history?.meta?.historyPushed ?? '',
      renderScheduleMs: renderScheduled?.dt ?? '',
      renderToFirstFrameMs,
      firstFrameAfterInputMs: firstFrameAfterInput ? round(firstFrameAfterInput.at - (inputEnd?.at || pasteEnd.at)) : '',
      maxFrameMs: round(maxFrameMs),
      maxDrawMs: round(maxDrawMs),
      maxEditingOverlayMs: round(maxEditingOverlayMs),
      maxEditLayoutMs: round(maxEditLayoutMs),
      maxEditTextDrawMs: round(maxEditTextDrawMs),
      maxEditSelectionMs: round(maxEditSelectionMs),
      maxEventLoopGapMs: round(maxEventLoopGapMs),
      maxLongTaskMs: round(maxLongTaskMs),
      oldChars: replacement?.meta?.oldChars ?? '',
      nextChars: replacement?.meta?.nextChars ?? '',
      insertedChars: latestMetaValue(run, ['insertedChars', 'textLen', 'fallbackTextChars', 'textCharCount']),
      selectedChars: latestMetaValue(run, ['selectedChars']),
      textBytes: latestMetaValue(run, ['textBytes']),
      textLineCount: latestMetaValue(run, ['textLineCount']),
      largestLineChars: latestMetaValue(run, ['largestLineChars']),
      layoutPatched: layoutPatch?.meta?.layoutPatched ?? '',
      layoutPatchMs: layoutPatch?.dt ?? '',
      layoutPatchLineDelta: layoutPatch?.meta?.layoutPatchLineDelta ?? '',
      layoutPatchLogicalLineDelta: layoutPatch?.meta?.layoutPatchLogicalLineDelta ?? '',
      layoutPatchReason: layoutPatch?.meta?.layoutPatchReason || '',
      objectWidth: latestMetaValue(run, ['objectWidth']),
      objectHeight: latestMetaValue(run, ['objectHeight']),
      layoutCachePresent: latestMetaValue(run, ['layoutCachePresent']),
      layoutCacheLines: latestMetaValue(run, ['layoutCacheLines']),
      rawInputs: rawInputRows.length,
      frames: frameRows.length,
      slowFramesOver16ms: frameRows.filter(row => Number(row.frameMs) > 16.7).length,
      eventLoopOrLongTaskRows: eventLoopRows.length,
      verdict,
    };
    const rowLimit = Math.max(1, Number(options.limit) || 200);
    console.table([summary]);
    if (runSummaries.length > 1) console.table(runSummaries.slice(-rowLimit));
    console.table(run.map(e => debugRow(e)).slice(-rowLimit));
    if (frameRows.length) console.table(frameRows.slice(-Math.min(rowLimit, 80)));
    return {
      summary,
      runSummaries,
      rows: run.map(e => debugRow(e)),
      frameRows: frameRows.slice(-rowLimit),
      rawInputRows: rawInputRows.slice(-rowLimit),
      eventLoopRows: eventLoopRows.slice(-rowLimit),
    };
  }

  function textClipboardReport() {
    const textOps = new Set(['copySelected', 'copyTextEditSelection', 'pasteAtPos', 'pasteTextEditSelection']);
    const rows = events
      .filter(e => textOps.has(e.op) && e.step && e.step !== 'start')
      .map(e => debugRow(e));
    const latestRun = (ops) => {
      const start = debugLast(events, e => ops.includes(e.op) && e.step === 'start');
      if (!start) return { start: null, run: [], end: null };
      const run = events.filter(e => e.id === start.id && e.op === start.op);
      const end = debugLast(run, e => e.step === 'end') || null;
      return { start, run, end };
    };
    const copy = latestRun(['copyTextEditSelection', 'copySelected']);
    const paste = latestRun(['pasteTextEditSelection', 'pasteAtPos']);
    const stepTotal = (run, name) => debugLast(run, e => e.step === name)?.total ?? '';
    const summary = {
      copyRuns: events.filter(e => (e.op === 'copySelected' || e.op === 'copyTextEditSelection') && e.step === 'start').length,
      pasteRuns: events.filter(e => (e.op === 'pasteAtPos' || e.op === 'pasteTextEditSelection') && e.step === 'start').length,
      lastCopyOp: copy.start?.op || '',
      lastCopyPath: copy.end?.meta?.path || '',
      lastCopyTotalMs: copy.end?.total ?? '',
      lastCopyTextChars: latestMetaValue(copy.run, ['textCharCount', 'textLen', 'sourceTextLen']),
      lastCopyTextBytes: latestMetaValue(copy.run, ['textBytes']),
      lastCopyLines: latestMetaValue(copy.run, ['textLineCount']),
      lastCopyClipboardWriteMs: latestMetaValue(copy.run, ['clipboardWriteMs']),
      lastCopyPayloadReadyAtMs: stepTotal(copy.run, 'copy:text-selection-payload-ready') || stepTotal(copy.run, 'copy:text-payload-ready'),
      lastPasteOp: paste.start?.op || '',
      lastPastePath: paste.end?.meta?.path || '',
      lastPasteTotalMs: paste.end?.total ?? '',
      lastPasteTextChars: latestMetaValue(paste.run, ['textCharCount', 'textLen', 'insertedChars', 'fallbackTextChars']),
      lastPasteTextBytes: latestMetaValue(paste.run, ['textBytes', 'additionalTextBytes']),
      lastPasteLines: latestMetaValue(paste.run, ['textLineCount']),
      lastPasteSetRangeTextMs: latestMetaValue(paste.run, ['setRangeTextMs']),
      lastPasteDispatchMs: latestMetaValue(paste.run, ['dispatchMs']),
      lastPasteInputEventAgeMs: latestMetaValue(paste.run, ['eventAgeMs']),
      lastPasteInputHandlerMs: latestMetaValue(paste.run, ['totalMs']),
      lastPasteInputEndAtMs: stepTotal(paste.run, 'text-edit-input:end'),
      lastPasteAutoHeightAtMs: stepTotal(paste.run, 'text-edit-input:auto-height-done') || stepTotal(paste.run, 'addText:auto-height-done'),
      lastPasteHistoryAtMs: stepTotal(paste.run, 'text-edit-input:history-recorded') || stepTotal(paste.run, 'paste:boardHistory-done') || stepTotal(paste.run, 'addText:history-pushed'),
      lastPasteObjectCountAfter: paste.end?.meta?.objectCountAfter ?? '',
      verdict: paste.start
        ? 'text copy/paste capture present'
        : copy.start
          ? 'copy captured; no paste captured'
          : 'no text copy/paste events captured',
    };
    console.table([summary]);
    console.table(rows.slice(-160));
    return { summary, rows };
  }

  function status() {
    const last = events[events.length - 1];
    const latest = (stepName) => debugLast(events, e => e.step === stepName);
    const copyEnd = debugLast(events, e => (e.op === 'copySelected' || e.op === 'copyTextEditSelection') && e.step === 'end');
    const pasteEnd = debugLast(events, e => (e.op === 'pasteAtPos' || e.op === 'pasteTextEditSelection') && e.step === 'end');
    const copyProgress = latest('copy:multi-progress');
    const pasteProgress = latest('paste:objects-add-progress');
    const out = {
      lastOp: last?.op || '',
      lastStep: last?.step || '',
      totalMs: last?.total ?? '',
      path: last?.meta?.path || '',
      copyObjects: copyEnd?.meta?.objectCount ?? copyProgress?.meta?.objectCount ?? '',
      copyImages: copyEnd?.meta?.imageCount ?? copyProgress?.meta?.imageCount ?? '',
      copyTextChars: copyEnd?.meta?.textCharCount ?? copyEnd?.meta?.textLen ?? '',
      pasteObjects: pasteEnd?.meta?.objectCount ?? pasteProgress?.meta?.objectCount ?? '',
      pasteTextObjects: pasteEnd?.meta?.textObjectCount ?? '',
      pasteTextChars: pasteEnd?.meta?.textCharCount ?? pasteEnd?.meta?.textLen ?? '',
      largestTextChars: pasteEnd?.meta?.largestTextChars ?? '',
      processed: pasteProgress?.meta?.processed ?? copyProgress?.meta?.processed ?? '',
      ...debugPick(pasteEnd?.meta, 'historyIndex objectCountBefore objectCountAfter'),
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  const reset = core.reset;
  const clear = reset;


  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    dump,
    summary,
    phaseSummary,
    copyBreakdown,
    copyPanReport,
    textPasteLagReport,
    textClipboardReport,
    largePasteReport,
    pasteBreakdown,
    status,
    reset,
    clear,
    get events() { return events.slice(); },
  };
})();

exposeDebug({ clipboard: ClipDebug });

// ─── History debugger ───────────────────────────────────────────────────────
var HistoryDebug = (() => {
  const MAX_EVENTS = 1200;
  const stats = {
    snapshots: 0,
    pushHistory: 0,
    restores: 0,
    undo: 0,
    redo: 0,
    cloneObjectCalls: 0,
    cloneObjectsCalls: 0,
    clonedObjects: 0,
    reusedObjects: 0,
    maxSnapshotMs: 0,
    maxPushHistoryMs: 0,
    maxRestoreMs: 0,
    maxCloneObjectsMs: 0,
  };

  const round = round2;

  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: null, roundNumbers: true });
  }
  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish history]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish history debugger enabled. Use finishDebug({ history: ["textUndoRedoReport", "largeTextReport", "pushes", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish history debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function count(key, amount = 1) {
    if (!core.enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] += amount;
  }

  function max(key, value) {
    if (!core.enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] = Math.max(stats[key], value || 0);
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      ...debugMetaFields(e, 'objectCount historyLength historyIndex cloned reused dirtyCount selectedCount editState'),
      ...debugMetaFields(e, 'restoredEdit actionReason targetReason sourceReason flushedCheckpoint skipped textObjectCount textCharCount'),
      ...debugMetaFields(e, 'largestTextChars textLineCount largestTextLineChars runtimeTextLayoutObjects runtimeTextLayoutLines runtimeTextLayoutPrefixEntries'),
      restoreCloneMs: e.meta?.cloneObjectsMs ?? '',
      ...debugMetaFields(e, 'replaceBoardObjectsMs enterEditMs renderScheduleMs reason ms'),
    }));
    console.table(rows);
    return rows;
  }

  function pushes() {
    const rows = events.filter(e => e.op === 'pushHistory' && e.step === 'end').map(e => ({
      id: e.id,
      ...debugMetaFields(e, 'objectCount historyLength historyIndex cloned reused reason textObjectCount'),
      ...debugMetaFields(e, 'textCharCount largestTextChars textLineCount largestTextLineChars runtimeTextLayoutLines runtimeTextLayoutPrefixEntries ms'),
    }));
    console.table(rows);
    return rows;
  }

  function largeTextReport() {
    const rows = events
      .filter(e => (
        e.step === 'end' ||
        e.step === 'cloneObjects' ||
        e.step === 'clone-dirty-objects' ||
        e.step === 'clone-snapshot-objects' ||
        e.step === 'replace-board-objects' ||
        e.step === 'restore-selection' ||
        e.step === 'renderAll-scheduled' ||
        e.step === 'enter-edit-restored' ||
        e.step === 'restore-edit-caret' ||
        e.step === 'flush-edit-history' ||
        e.step === 'restore-done'
      ))
      .filter(e => (
        Number(e.meta?.textCharCount || 0) ||
        Number(e.meta?.largestTextChars || 0) ||
        Number(e.meta?.runtimeTextLayoutLines || 0) ||
        ['snapshot', 'pushHistory', 'restoreSnapshot', 'undo', 'redo'].includes(e.op)
      ))
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        ...debugMetaFields(e, 'reason ms objectCount cloned reused textObjectCount textCharCount largestTextChars'),
        ...debugMetaFields(e, 'largestTextId textLineCount largestTextLineChars runtimeTextLayoutObjects runtimeTextLayoutLines runtimeTextLayoutPrefixEntries actionReason targetReason'),
        ...debugMetaFields(e, 'sourceReason editStateId editValueChars selectionStart selectionEnd cloneObjectsMs replaceBoardObjectsMs enterEditMs'),
        ...debugMetaFields(e, 'reusedEditProxy proxyDomSyncedForSelection proxyDomSyncReason proxyDomSyncMs proxyDomCharsBeforeSelection proxyDomCharsAfterSelection setSelectionRangeMs focusMs'),
        ...debugMetaFields(e, 'focusSkipped renderScheduleMs flushedCheckpoint historyLength historyIndex'),
      }));
    console.table(rows);
    return rows;
  }

  function textUndoRedoReport(options = {}) {
    const rowLimit = Math.max(1, Math.min(MAX_EVENTS, Number(options.limit) || 240));
    const rows = events
      .filter(e => (
        ['undo', 'redo', 'restoreSnapshot', 'pushHistory'].includes(e.op) ||
        e.step === 'flush-edit-history'
      ))
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        ...debugMetaFields(e, 'ms reason actionReason targetReason sourceReason flushedCheckpoint flushMs'),
        ...debugMetaFields(e, 'restoreMs skipped objectCount selectedCount editState restoredEdit'),
	        ...debugMetaFields(e, 'editStateId editValueChars selectionStart selectionEnd editStateSelectionStart'),
	        ...debugMetaFields(e, 'editStateSelectionEnd editStateSelectedChars actionEditStateSelectionStart actionEditStateSelectionEnd actionEditStateSelectedChars'),
	        ...debugMetaFields(e, 'actionBeforeEditStateSelectionStart actionBeforeEditStateSelectionEnd actionBeforeEditStateSelectedChars targetEditStateSelectionStart targetEditStateSelectionEnd'),
	        ...debugMetaFields(e, 'targetEditStateSelectedChars sourceEditStateSelectionStart sourceEditStateSelectionEnd sourceEditStateSelectedChars textObjectCount'),
        ...debugMetaFields(e, 'textCharCount largestTextChars largestTextId textLineCount largestTextLineChars runtimeTextLayoutObjects runtimeTextLayoutLines'),
        ...debugMetaFields(e, 'runtimeTextLayoutPrefixEntries cloneObjectsMs replaceBoardObjectsMs setSelectionMs renderScheduleMs enterEditMs reusedEditProxy'),
        ...debugMetaFields(e, 'proxyDomSyncedForSelection proxyDomSyncReason proxyDomSyncMs proxyDomCharsBeforeSelection proxyDomCharsAfterSelection setSelectionRangeMs focusMs'),
        ...debugMetaFields(e, 'focusSkipped proxyChars historyLength historyIndex'),
      }));
    const max = (field) => rows.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    const endRows = rows.filter(row => row.step === 'end');
    const restoreEnds = endRows.filter(row => row.op === 'restoreSnapshot');
    const summaryOut = {
      undoCount: events.filter(e => e.op === 'undo' && e.step === 'start').length,
      redoCount: events.filter(e => e.op === 'redo' && e.step === 'start').length,
      restoreCount: events.filter(e => e.op === 'restoreSnapshot' && e.step === 'start').length,
      textEditCheckpointPushes: events.filter(e => e.op === 'pushHistory' && e.step === 'end' && e.meta?.reason === 'text-edit-checkpoint').length,
      maxRestoreMs: restoreEnds.reduce((value, row) => Math.max(value, Number(row.ms) || Number(row.total) || 0), 0),
      maxOuterRestoreMs: max('restoreMs'),
      maxFlushMs: max('flushMs'),
      maxCloneObjectsMs: max('cloneObjectsMs'),
      maxReplaceBoardObjectsMs: max('replaceBoardObjectsMs'),
      maxEnterEditMs: max('enterEditMs'),
      maxSetSelectionRangeMs: max('setSelectionRangeMs'),
      maxFocusMs: max('focusMs'),
      maxRenderScheduleMs: max('renderScheduleMs'),
      maxTextCharCount: max('textCharCount'),
      maxLargestTextChars: max('largestTextChars'),
      maxRuntimeTextLayoutLines: max('runtimeTextLayoutLines'),
      restoredEditCount: restoreEnds.filter(row => row.restoredEdit === true).length,
      skippedRows: rows.filter(row => row.skipped).length,
    };
    const opEnds = endRows.filter(row => row.op === 'undo' || row.op === 'redo');
    summaryOut.maxUndoMs = opEnds
      .filter(row => row.op === 'undo')
      .reduce((value, row) => Math.max(value, Number(row.total) || 0), 0);
    summaryOut.maxRedoMs = opEnds
      .filter(row => row.op === 'redo')
      .reduce((value, row) => Math.max(value, Number(row.total) || 0), 0);
    for (const key of Object.keys(summaryOut)) {
      if (typeof summaryOut[key] === 'number') summaryOut[key] = round(summaryOut[key]);
    }
    if (options.table !== false) {
      console.table([summaryOut]);
      console.table(rows.slice(-rowLimit));
    }
    return { summary: summaryOut, rows: rows.slice(-rowLimit) };
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function reset() {
    core.reset();
    for (const key of Object.keys(stats)) stats[key] = 0;
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    count,
    max,
    summary,
    pushes,
    largeTextReport,
    textUndoRedoReport,
    dump,
    reset,
    clear: reset,
    isEnabled: () => core.enabled,
    get enabled() { return core.enabled; },
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ history: HistoryDebug });
var ViewportDebug = (() => {
  const MAX_EVENTS = 10000;
  const MAX_SLOW_RECORDS = 100;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];
  const slowRecords = [];
  const stats = {
    wheel: 0,
    wheelPan: 0,
    wheelZoom: 0,
    mousePanMoves: 0,
    frameCount: 0,
    frameTotalMs: 0,
    frameQueueTotalMs: 0,
    inputFrameCount: 0,
    inputAgeTotalMs: 0,
    scheduledFrames: 0,
    coalescedFrames: 0,
    transformFrames: 0,
    boardFrames: 0,
    overlayFrames: 0,
    selectionOverlaySkipped: 0,
    slowFrames: 0,
    maxFrameMs: 0,
    maxQueueMs: 0,
    maxInputAgeMs: 0,
    lastRafGapMs: 0,
    maxRafGapMs: 0,
    eventLoopGaps: 0,
    maxEventLoopGapMs: 0,
    longTasks: 0,
    maxLongTaskMs: 0,
    rawInputEvents: 0,
    shieldBlockedInputs: 0,
    panZoomEvents: 0,
    panZoomPanEvents: 0,
    panZoomZoomEvents: 0,
    panZoomBlockedEvents: 0,
    motionEvents: 0,
    motionJiggleStarts: 0,
    motionJiggleProgressSamples: 0,
    motionRafTicks: 0,
    motionRenderSchedules: 0,
    frameScheduleEvents: 0,
    maxFrameScheduleSources: 0,
    maxPanDistancePx: 0,
    maxZoomDeltaPct: 0,
    wheelHandlerCount: 0,
    wheelHandlerTotalMs: 0,
    maxWheelHandlerMs: 0,
    mousePanHandlerCount: 0,
    mousePanHandlerTotalMs: 0,
    maxMousePanHandlerMs: 0,
    imageAdds: 0,
    imageDecodeQueued: 0,
    maxImageDecodeQueueDepth: 0,
    imageDecodes: 0,
    imageBitmaps: 0,
    imageBitmapFailures: 0,
    imageDrawMissing: 0,
    imageDrawErrors: 0,
    croppedImages: 0,
    maxImageAddMs: 0,
    maxImageBitmapMs: 0,
  };
  let lastRafAt = 0;
  let eventLoopTimer = null;
  let longTaskObserver = null;
  let rawInputMonitorActive = false;
  const EVENT_LOOP_INTERVAL_MS = 50;
  const EVENT_LOOP_GAP_THRESHOLD_MS = 80;
  const RAW_INPUT_TYPES = [
    'wheel',
    'keydown',
    'keyup',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mousemove',
    'mouseup',
  ];

  const sanitize = sanitizeRoundedDebugMeta;

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish viewport]', entry);
  }

  function startEventLoopMonitor(options = {}) {
    if (eventLoopTimer || typeof setInterval !== 'function') return;
    const thresholdMs = Math.max(16, Number(options.eventLoopGapThresholdMs) || EVENT_LOOP_GAP_THRESHOLD_MS);
    const requestedIntervalMs = Number(options.eventLoopIntervalMs);
    const intervalMs = Math.max(8, Number.isFinite(requestedIntervalMs) && requestedIntervalMs > 0
      ? requestedIntervalMs
      : Math.min(EVENT_LOOP_INTERVAL_MS, Math.max(8, thresholdMs / 2)));
    let eventLoopLastTick = performance.now();
    eventLoopTimer = setInterval(() => {
      const now = performance.now();
      const gapMs = now - eventLoopLastTick;
      eventLoopLastTick = now;
      if (gapMs < thresholdMs) return;
      stats.eventLoopGaps++;
      stats.maxEventLoopGapMs = Math.max(stats.maxEventLoopGapMs, gapMs);
      push({
        op: 'eventLoop',
        step: 'gap',
        meta: sanitize({
          gapMs,
          expectedMs: intervalMs,
          thresholdMs,
          overMs: gapMs - thresholdMs,
          panX,
          panY,
          zoom,
        }),
      });
    }, intervalMs);
  }

  function stopEventLoopMonitor() {
    if (!eventLoopTimer) return;
    clearInterval(eventLoopTimer);
    eventLoopTimer = null;
  }

  function startLongTaskObserver() {
    if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration) || 0;
          stats.longTasks++;
          stats.maxLongTaskMs = Math.max(stats.maxLongTaskMs, duration);
          push({
            op: 'longTask',
            step: 'entry',
            meta: sanitize({
              startTime: entry.startTime,
              duration,
              name: entry.name || '',
            }),
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver = null;
    }
  }

  function stopLongTaskObserver() {
    if (!longTaskObserver) return;
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }

  function round(value, places = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    const factor = 10 ** places;
    return Math.round(numeric * factor) / factor;
  }

  function wheelEventMeta(event = null) {
    if (!event || !('deltaY' in event || 'deltaX' in event)) return {};
    const deltaMode = Number(event.deltaMode) || 0;
    const [deltaModeLabel, scale] = deltaMode === 1 ? ['line', 16]
      : deltaMode === 2 ? ['page', Math.max(1, (typeof window !== 'undefined' ? Number(window.innerHeight) : 1) || 1)]
      : ['pixel', 1];
    return {
      deltaMode,
      deltaModeLabel,
      deltaZ: event.deltaZ ?? '',
      wheelDeltaXPx: (Number(event.deltaX) || 0) * scale,
      wheelDeltaYPx: (Number(event.deltaY) || 0) * scale,
      wheelDeltaZPx: (Number(event.deltaZ) || 0) * scale,
    };
  }

  function viewportStateMeta() {
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const rect = typeof viewportWorldRect === 'function'
      ? viewportWorldRect(0)
      : null;
    return {
      panX: typeof panX !== 'undefined' ? panX : '',
      panY: typeof panY !== 'undefined' ? panY : '',
      zoom: typeof zoom !== 'undefined' ? zoom : '',
      dpr,
      viewportX1: rect?.x1 ?? '',
      viewportY1: rect?.y1 ?? '',
      viewportX2: rect?.x2 ?? '',
      viewportY2: rect?.y2 ?? '',
      viewportW: rect ? rect.x2 - rect.x1 : '',
      viewportH: rect ? rect.y2 - rect.y1 : '',
      canvasW: typeof boardCanvas !== 'undefined' ? boardCanvas?.width ?? '' : '',
      canvasH: typeof boardCanvas !== 'undefined' ? boardCanvas?.height ?? '' : '',
      objectCount: typeof objects !== 'undefined' ? objects.length : '',
      selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
      editing: typeof editingId !== 'undefined' ? !!editingId : '',
    };
  }

  function inputShieldState() {
    const shieldActive = typeof openingShield !== 'undefined' &&
      !!openingShield?.classList?.contains?.('active');
    return {
      shieldActive,
      inputShieldCount: typeof _inputShieldStack !== 'undefined' ? _inputShieldStack.length : '',
      boardOpening: typeof _boardOpening !== 'undefined' ? !!_boardOpening : '',
      rubberBandDragActive: typeof _rubberBandDragActive !== 'undefined' ? !!_rubberBandDragActive : '',
      spaceDown: typeof _spaceDown !== 'undefined' ? !!_spaceDown : '',
      editingId: typeof editingId !== 'undefined' ? (editingId || '') : '',
    };
  }

  function inputEventMeta(event, extra = {}) {
    const eventAt = debugEventTimestampMs(event);
    return sanitize({
      source: extra.source || '',
      eventType: event?.type || '',
      eventAt,
      eventAgeMs: Math.max(0, performance.now() - eventAt),
      key: event?.key || '',
      code: event?.code || '',
      repeat: !!event?.repeat,
      deltaX: event?.deltaX ?? '',
      deltaY: event?.deltaY ?? '',
      ...wheelEventMeta(event),
      ...debugPick(event, 'button buttons clientX clientY movementX movementY offsetX offsetY pointerId'),
      pointerType: event?.pointerType || '',
      pressure: event?.pressure ?? '',
      isPrimary: event?.isPrimary ?? '',
      isTrusted: event?.isTrusted ?? '',
      ctrlKey: !!event?.ctrlKey,
      metaKey: !!event?.metaKey,
      shiftKey: !!event?.shiftKey,
      altKey: !!event?.altKey,
      defaultPrevented: !!event?.defaultPrevented,
      cancelable: !!event?.cancelable,
      target: debugEventTargetLabel(event?.target),
      ...inputShieldState(),
      ...extra,
    });
  }

  function recordRawInput(event, source = 'raw-capture') {
    if (!enabled) return;
    stats.rawInputEvents++;
    push({
      op: 'input',
      step: 'raw',
      meta: inputEventMeta(event, { source }),
    });
  }

  function recordShieldBlock(event, meta = {}) {
    if (!enabled) return;
    stats.shieldBlockedInputs++;
    push({
      op: 'input',
      step: 'shield-block',
      meta: inputEventMeta(event, { source: 'input-shield', blocked: true, ...meta }),
    });
  }

  function updatePanZoomStats(stepName, meta = {}) {
    stats.panZoomEvents++;
    const mode = meta.mode || '';
    if (mode === 'pan') stats.panZoomPanEvents++;
    if (mode === 'zoom') stats.panZoomZoomEvents++;
    if (meta.blocked || /blocked/.test(stepName)) stats.panZoomBlockedEvents++;
    const panDistance = Number(meta.panDistancePx) || Math.hypot(Number(meta.panDeltaX) || 0, Number(meta.panDeltaY) || 0);
    stats.maxPanDistancePx = Math.max(stats.maxPanDistancePx, panDistance);
    stats.maxZoomDeltaPct = Math.max(stats.maxZoomDeltaPct, Math.abs(Number(meta.zoomDeltaPct) || 0));
  }

  function recordPanZoom(stepName, meta = {}, event = null) {
    if (!enabled) return;
    const eventMeta = event ? inputEventMeta(event, { source: meta.source || '' }) : {};
    const currentViewport = viewportStateMeta();
    const payload = sanitize({
      ...currentViewport,
      ...eventMeta,
      ...meta,
    });
    updatePanZoomStats(stepName, payload);
    push({
      op: 'panZoom',
      step: stepName,
      meta: payload,
    });
  }

  function recordFrameSchedule(stepName, meta = {}) {
    if (!enabled) return;
    const payload = sanitize({
      ...viewportStateMeta(),
      ...meta,
    });
    stats.frameScheduleEvents++;
    stats.maxFrameScheduleSources = Math.max(stats.maxFrameScheduleSources, Number(payload.pendingSources) || 0);
    push({
      op: 'frameSchedule',
      step: stepName,
      meta: payload,
    });
  }

  function recordMotion(stepName, meta = {}) {
    if (!enabled) return;
    const payload = sanitize({
      ...viewportStateMeta(),
      ...meta,
    });
    stats.motionEvents++;
    if (stepName === 'jiggle-start') stats.motionJiggleStarts++;
    if (stepName === 'jiggle-progress') stats.motionJiggleProgressSamples++;
    if (stepName === 'raf-fired') stats.motionRafTicks++;
    if (stepName === 'render-scheduled') stats.motionRenderSchedules++;
    push({
      op: 'motion',
      step: stepName,
      meta: payload,
    });
  }

  function onRawInputCapture(event) {
    if (!enabled) return;
    try {
      if (event.__boardfishViewportRawInputLogged) return;
      event.__boardfishViewportRawInputLogged = true;
    } catch {}
    recordRawInput(event, 'window-capture');
  }

  function startRawInputMonitor(options = {}) {
    if (rawInputMonitorActive || options.rawInput !== true || typeof window === 'undefined') return;
    rawInputMonitorActive = true;
    for (const type of RAW_INPUT_TYPES) {
      window.addEventListener(type, onRawInputCapture, { capture: true, passive: true });
    }
  }

  function stopRawInputMonitor() {
    if (!rawInputMonitorActive || typeof window === 'undefined') return;
    for (const type of RAW_INPUT_TYPES) {
      window.removeEventListener(type, onRawInputCapture, { capture: true, passive: true });
    }
    rawInputMonitorActive = false;
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    startEventLoopMonitor(options);
    startLongTaskObserver();
    startRawInputMonitor(options);

    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish viewport debugger enabled. Use finishDebug({ viewport: ["jiggleReport", "panZoomReport", "report", "summary", "frameSummary", "motionSummary", "motionTimeline", "panZoomSummary", "panZoomTimeline", "wheelSummary", "drawSummary", "slowFrames", "eventLoopTimeline", "rawInputTimeline", "imageHealth", "dump"] }) to collect results.');
  }

  function disable() {
    enabled = false;
    stopEventLoopMonitor();
    stopLongTaskObserver();
    stopRawInputMonitor();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish viewport debugger disabled.');
  }

  function setVerbose(value) {
    if (!DEBUG_TOOLS_ENABLED) return;
    verbose = !!value;

    console.info(`Boardfish viewport verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!ctx.steps) ctx.steps = {};
    ctx.steps[stepName] = {
      ms: meta?.ms ?? (now - ctx.last),
      total: now - ctx.t0,
      meta: sanitize(meta),
    };
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  function count(name, amount = 1) {
    if (!enabled) return;
    stats[name] = (stats[name] || 0) + amount;
  }

  function max(name, value) {
    if (!enabled) return;
    stats[name] = Math.max(stats[name] || 0, value || 0);
  }

  function timing(name, value) {
    if (!enabled) return;
    const ms = value || 0;
    stats[`${name}Count`] = (stats[`${name}Count`] || 0) + 1;
    stats[`${name}TotalMs`] = (stats[`${name}TotalMs`] || 0) + ms;
    stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] = Math.max(
      stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] || 0,
      ms
    );
  }

  function frameStart(queueMs, extra = {}) {
    if (!enabled) return null;
    const now = performance.now();
    const rafGap = lastRafAt ? now - lastRafAt : 0;
    lastRafAt = now;
    const inputAgeMs = Number(extra.inputAgeMs) || 0;
    stats.lastRafGapMs = rafGap;
    stats.maxRafGapMs = Math.max(stats.maxRafGapMs, rafGap);
    stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs || 0);
    stats.maxInputAgeMs = Math.max(stats.maxInputAgeMs, inputAgeMs);
    const meta = { queueMs, rafGap, inputAgeMs, inputSource: extra.inputSource || '', panX, panY, zoom };
    const ctx = start('frame', meta);
    if (ctx) ctx.startMeta = meta;
    return ctx;
  }

  function frameEnd(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    const total = performance.now() - ctx.t0;
    const startMeta = ctx.startMeta || {};
    const queueMs = Number(startMeta.queueMs) || 0;
    const inputAgeMs = Number(startMeta.inputAgeMs) || 0;
    const hasInput = !!startMeta.inputSource || inputAgeMs > 0;
    stats.frameCount++;
    stats.frameTotalMs += total;
    stats.frameQueueTotalMs += queueMs;
    if (hasInput) {
      stats.inputFrameCount++;
      stats.inputAgeTotalMs += inputAgeMs;
    }
    stats.maxFrameMs = Math.max(stats.maxFrameMs, total);
    if (total > 16.7) {
      stats.slowFrames++;
      slowRecords.push({
        id: ctx.id,
        frameMs: Math.round(total * 100) / 100,
        ...(ctx.startMeta || {}),
        steps: ctx.steps || {},
        ...sanitize(meta),
      });
      if (slowRecords.length > MAX_SLOW_RECORDS) slowRecords.shift();
    }
    end(ctx, { ...meta, frameMs: total, slow: total > 16.7 });
  }

  function summary() {
    const rows = [
      { metric: 'wheel', value: stats.wheel },
      { metric: 'perfMode', value: viewportPerfModeSummary().label },
      { metric: 'cullingEnabled', value: viewportCullingEnabled },
      { metric: 'imageScalingSupported', value: VIEWPORT_IMAGE_SCALING_SUPPORTED },
      { metric: 'imageScalingEnabled', value: viewportImageScalingEnabled },
      { metric: 'imageScaleLevels', value: String(IMAGE_SCALE) },
      { metric: 'wheelPan', value: stats.wheelPan },
      { metric: 'wheelZoom', value: stats.wheelZoom },
      { metric: 'mousePanMoves', value: stats.mousePanMoves },
      { metric: 'frames', value: stats.frameCount },
      { metric: 'inputFrames', value: stats.inputFrameCount },
      { metric: 'scheduledFrames', value: stats.scheduledFrames },
      { metric: 'coalescedFrames', value: stats.coalescedFrames },
      { metric: 'transformFrames', value: stats.transformFrames },
      { metric: 'boardFrames', value: stats.boardFrames },
      { metric: 'overlayFrames', value: stats.overlayFrames },
      { metric: 'selectionOverlaySkipped', value: stats.selectionOverlaySkipped },
      { metric: 'slowFramesOver16ms', value: stats.slowFrames },
      { metric: 'maxFrameMs', value: Math.round(stats.maxFrameMs * 100) / 100 },
      { metric: 'maxQueueMs', value: Math.round(stats.maxQueueMs * 100) / 100 },
      { metric: 'maxInputAgeMs', value: Math.round(stats.maxInputAgeMs * 100) / 100 },
      { metric: 'maxRafGapMs', value: Math.round(stats.maxRafGapMs * 100) / 100 },
      { metric: 'eventLoopGapsOverThreshold', value: stats.eventLoopGaps },
      { metric: 'maxEventLoopGapMs', value: Math.round(stats.maxEventLoopGapMs * 100) / 100 },
      { metric: 'longTasks', value: stats.longTasks },
      { metric: 'maxLongTaskMs', value: Math.round(stats.maxLongTaskMs * 100) / 100 },
      { metric: 'rawInputEvents', value: stats.rawInputEvents },
      { metric: 'shieldBlockedInputs', value: stats.shieldBlockedInputs },
      { metric: 'panZoomEvents', value: stats.panZoomEvents },
      { metric: 'panZoomPanEvents', value: stats.panZoomPanEvents },
      { metric: 'panZoomZoomEvents', value: stats.panZoomZoomEvents },
      { metric: 'panZoomBlockedEvents', value: stats.panZoomBlockedEvents },
      { metric: 'motionEvents', value: stats.motionEvents },
      { metric: 'motionJiggleStarts', value: stats.motionJiggleStarts },
      { metric: 'motionJiggleProgressSamples', value: stats.motionJiggleProgressSamples },
      { metric: 'motionRafTicks', value: stats.motionRafTicks },
      { metric: 'motionRenderSchedules', value: stats.motionRenderSchedules },
      { metric: 'frameScheduleEvents', value: stats.frameScheduleEvents },
      { metric: 'maxFrameScheduleSources', value: stats.maxFrameScheduleSources },
      { metric: 'maxPanDistancePx', value: Math.round(stats.maxPanDistancePx * 100) / 100 },
      { metric: 'maxZoomDeltaPct', value: Math.round(stats.maxZoomDeltaPct * 100) / 100 },
      { metric: 'avgWheelHandlerMs', value: stats.wheelHandlerCount ? Math.round(stats.wheelHandlerTotalMs / stats.wheelHandlerCount * 100) / 100 : 0 },
      { metric: 'maxWheelHandlerMs', value: Math.round(stats.maxWheelHandlerMs * 100) / 100 },
      { metric: 'avgMousePanHandlerMs', value: stats.mousePanHandlerCount ? Math.round(stats.mousePanHandlerTotalMs / stats.mousePanHandlerCount * 100) / 100 : 0 },
      { metric: 'maxMousePanHandlerMs', value: Math.round(stats.maxMousePanHandlerMs * 100) / 100 },
      { metric: 'imageAdds', value: stats.imageAdds },
      { metric: 'imageDecodeQueued', value: stats.imageDecodeQueued },
      { metric: 'maxImageDecodeQueueDepth', value: stats.maxImageDecodeQueueDepth },
      { metric: 'imageDecodes', value: stats.imageDecodes },
      { metric: 'imageBitmaps', value: stats.imageBitmaps },
      { metric: 'imageBitmapFailures', value: stats.imageBitmapFailures },
      { metric: 'imageDrawMissing', value: stats.imageDrawMissing },
      { metric: 'imageDrawErrors', value: stats.imageDrawErrors },
      { metric: 'croppedImages', value: stats.croppedImages },
      { metric: 'maxImageAddMs', value: Math.round(stats.maxImageAddMs * 100) / 100 },
      { metric: 'maxImageBitmapMs', value: Math.round(stats.maxImageBitmapMs * 100) / 100 },
    ];
    console.table(rows);
    return rows;
  }

  function frameSummary() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'frame' && e.step === 'start') starts.set(e.id, e.meta || {});
    }
    const frames = events
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), ...(e.meta || {}) }));
    const inputFrames = frames.filter(row => row.inputSource || Number(row.inputAgeMs) > 0);
    const max = (field) => frames.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      frames: stats.frameCount,
      recentFrames: frames.length,
      inputFrames: stats.inputFrameCount,
      recentInputFrames: inputFrames.length,
      slowFramesOver16ms: stats.slowFrames,
      recentSlowFramesOver16ms: frames.filter(row => row.slow).length,
      avgFrameMs: stats.frameCount ? Math.round(stats.frameTotalMs / stats.frameCount * 100) / 100 : 0,
      maxFrameMs: Math.round(stats.maxFrameMs * 100) / 100,
      recentMaxFrameMs: Math.round(max('frameMs') * 100) / 100,
      avgQueueMs: stats.frameCount ? Math.round(stats.frameQueueTotalMs / stats.frameCount * 100) / 100 : 0,
      maxQueueMs: Math.round(stats.maxQueueMs * 100) / 100,
      avgInputAgeMs: stats.inputFrameCount ? Math.round(stats.inputAgeTotalMs / stats.inputFrameCount * 100) / 100 : 0,
      maxInputAgeMs: Math.round(stats.maxInputAgeMs * 100) / 100,
      recentMaxInputAgeMs: Math.round(max('inputAgeMs') * 100) / 100,
      maxRafGapMs: Math.round(stats.maxRafGapMs * 100) / 100,
      recentMaxRafGapMs: Math.round(max('rafGap') * 100) / 100,
      eventLoopGapsOverThreshold: stats.eventLoopGaps,
      maxEventLoopGapMs: Math.round(stats.maxEventLoopGapMs * 100) / 100,
      longTasks: stats.longTasks,
      maxLongTaskMs: Math.round(stats.maxLongTaskMs * 100) / 100,
      rawInputEvents: stats.rawInputEvents,
      shieldBlockedInputs: stats.shieldBlockedInputs,
      transformFrames: stats.transformFrames,
      boardFrames: stats.boardFrames,
      overlayFrames: stats.overlayFrames,
    };
    console.table([out]);
    return out;
  }

  function wheelRows() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'wheel' && e.step === 'start') starts.set(e.id, { at: e.at, ...(e.meta || {}) });
    }
    return events
      .filter(e => e.op === 'wheel' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), endAt: e.at, ...(e.meta || {}) }))
      .filter(row => row.at != null);
  }

  function wheelSummary() {
    const rows = wheelRows();
    const zoomRows = rows.filter(row => row.mode === 'zoom');
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].at - rows[i - 1].at);
    const sum = (values) => values.reduce((n, value) => n + (Number(value) || 0), 0);
    const max = (values) => values.reduce((n, value) => Math.max(n, Number(value) || 0), 0);
    const avg = (values) => values.length ? round(sum(values) / values.length) : 0;
    const absDeltaY = rows.map(row => Math.abs(Number(row.deltaY) || 0));
    const zoomStepPct = zoomRows.map(row => {
      const before = Number(row.zoom) || 0;
      const after = Number(row.newZoom) || 0;
      return before && after ? Math.abs((after / before) - 1) * 100 : 0;
    });
    let directionChanges = 0;
    let lastDir = 0;
    for (const row of zoomRows) {
      const dy = Number(row.deltaY) || 0;
      const dir = dy === 0 ? 0 : dy > 0 ? 1 : -1;
      if (dir && lastDir && dir !== lastDir) directionChanges++;
      if (dir) lastDir = dir;
    }
    const out = {
      bufferedWheelEvents: rows.length,
      zoomEvents: zoomRows.length,
      panEvents: rows.filter(row => row.mode === 'pan').length,
      avgWheelGapMs: avg(gaps),
      maxWheelGapMs: round(max(gaps)),
      gapsOver16ms: gaps.filter(gap => gap > 16.7).length,
      gapsOver32ms: gaps.filter(gap => gap > 32).length,
      gapsOver80ms: gaps.filter(gap => gap > 80).length,
      avgAbsDeltaY: avg(absDeltaY),
      maxAbsDeltaY: round(max(absDeltaY)),
      avgZoomStepPct: avg(zoomStepPct),
      maxZoomStepPct: round(max(zoomStepPct)),
      directionChanges,
      firstAt: rows[0]?.at ?? '',
      lastAt: rows[rows.length - 1]?.at ?? '',
    };
    console.table([out]);
    return out;
  }

  function wheelTimeline(limit = 80) {
    const rowLimit = typeof limit === 'object' ? limit.limit : limit;
    const rows = wheelRows();
    const start = Math.max(0, rows.length - Math.max(1, Number(rowLimit) || 80));
    const recent = rows.slice(start).map((row, idx, list) => ({
      at: row.at,
      gapMs: idx ? Math.round((row.at - list[idx - 1].at) * 100) / 100 : '',
      mode: row.mode || '',
      ...debugPick(row, 'deltaX deltaY deltaMode wheelDeltaXPx wheelDeltaYPx'),
      ctrl: !!row.ctrlKey,
      meta: !!row.metaKey,
      ...debugPick(row, 'zoom newZoom panX panY panDeltaX panDeltaY zoomDeltaPct handlerMs'),
    }));
    console.table(recent);
    return recent;
  }

  function panZoomRows() {
    return events
      .filter(e => e.op === 'panZoom')
      .map(e => ({ at: e.at, step: e.step, ...(e.meta || {}) }));
  }

  function panZoomSummary() {
    const rows = panZoomRows();
    const panRows = rows.filter(row => row.mode === 'pan');
    const zoomRows = rows.filter(row => row.mode === 'zoom');
    const inputRows = rows.filter(row => /wheel|mouse|pointer|key/.test(String(row.eventType || row.step || '')));
    const scheduleRows = events.filter(e => e.op === 'frameSchedule');
    const gaps = [];
    for (let i = 1; i < inputRows.length; i++) gaps.push(inputRows[i].at - inputRows[i - 1].at);
    const maxValue = (items, field) => items.reduce((value, row) => Math.max(value, Math.abs(Number(row[field]) || 0)), 0);
    const sumValue = (items, field) => items.reduce((value, row) => value + Math.abs(Number(row[field]) || 0), 0);
    const panDistanceTotal = panRows.reduce((value, row) => {
      const distance = Number(row.panDistancePx);
      return value + (Number.isFinite(distance) ? Math.abs(distance) : Math.hypot(Number(row.panDeltaX) || 0, Number(row.panDeltaY) || 0));
    }, 0);
    const minZoom = zoomRows.reduce((value, row) => {
      const after = Number(row.zoomAfter ?? row.newZoom ?? row.zoom);
      return Number.isFinite(after) ? Math.min(value, after) : value;
    }, Infinity);
    const maxZoom = zoomRows.reduce((value, row) => {
      const after = Number(row.zoomAfter ?? row.newZoom ?? row.zoom);
      return Number.isFinite(after) ? Math.max(value, after) : value;
    }, 0);
    const out = {
      events: rows.length,
      panEvents: panRows.length,
      zoomEvents: zoomRows.length,
      blockedEvents: rows.filter(row => row.blocked || /blocked/.test(row.step)).length,
      wheelPanEvents: panRows.filter(row => row.source === 'wheel-pan').length,
      mousePanMoves: panRows.filter(row => row.step === 'mouse-pan-move').length,
      wheelZoomEvents: zoomRows.filter(row => row.source === 'wheel-zoom').length,
      frameScheduleEvents: scheduleRows.length,
      coalescedFrameSchedules: scheduleRows.filter(row => row.step === 'coalesced').length,
      scheduledFrames: stats.scheduledFrames,
      coalescedFrames: stats.coalescedFrames,
      transformFrames: stats.transformFrames,
      slowFramesOver16ms: stats.slowFrames,
      maxFrameMs: round(stats.maxFrameMs),
      maxQueueMs: round(stats.maxQueueMs),
      maxInputAgeMs: round(stats.maxInputAgeMs),
      maxRafGapMs: round(stats.maxRafGapMs),
      eventLoopGapsOverThreshold: stats.eventLoopGaps,
      maxEventLoopGapMs: round(stats.maxEventLoopGapMs),
      maxInputGapMs: round(gaps.reduce((value, gap) => Math.max(value, Number(gap) || 0), 0)),
      inputGapsOver16ms: gaps.filter(gap => gap > 16.7).length,
      inputGapsOver32ms: gaps.filter(gap => gap > 32).length,
      maxPanDistancePx: round(Math.max(stats.maxPanDistancePx, maxValue(panRows, 'panDistancePx'))),
      totalPanDistancePx: round(panDistanceTotal),
      maxPanDeltaX: round(maxValue(panRows, 'panDeltaX')),
      maxPanDeltaY: round(maxValue(panRows, 'panDeltaY')),
      maxZoomDeltaPct: round(Math.max(stats.maxZoomDeltaPct, maxValue(zoomRows, 'zoomDeltaPct'))),
      totalAbsZoomDeltaPct: round(sumValue(zoomRows, 'zoomDeltaPct')),
      minZoom: minZoom === Infinity ? '' : round(minZoom, 4),
      maxZoom: maxZoom ? round(maxZoom, 4) : '',
      firstAt: rows[0]?.at ?? '',
      lastAt: rows[rows.length - 1]?.at ?? '',
      durationMs: rows.length > 1 ? round(rows[rows.length - 1].at - rows[0].at) : 0,
      framesPerNavigationEvent: rows.length ? round(stats.transformFrames / rows.length, 3) : 0,
    };
    console.table([out]);
    return out;
  }

  function frameScheduleTimeline(limit = 120) {
    const rowLimit = typeof limit === 'object' ? limit.limit : limit;
    const rows = events
      .filter(e => e.op === 'frameSchedule')
      .slice(-Math.max(1, Number(rowLimit) || 120))
      .map(e => ({
        at: e.at,
        step: e.step,
        source: e.meta?.source || '',
        ...debugMetaFields(e, 'pendingSources needTransform needBoardRender needOverlayRender'),
        inputSource: e.meta?.inputSource || '',
        ...debugMetaFields(e, 'inputAgeMs panX panY zoom'),
      }));
    console.table(rows);
    return rows;
  }

  function timelineTable(timeline, limit) {
    timeline.sort((a, b) => a.at - b.at);
    const rows = timeline.slice(-limit).map((row, index, list) => ({
      ...row,
      timelineGapMs: index ? round(row.at - list[index - 1].at) : '',
    }));
    console.table(rows);
    return rows;
  }

  function panZoomTimeline(options = {}) {
    const opts = options && typeof options === 'object' ? options : { limit: options };
    const limit = Math.max(1, Number(opts.limit) || 300);
    const timeline = [];
    for (const e of events) {
      if (e.op === 'panZoom') {
        timeline.push({
          at: e.at,
          kind: 'panZoom',
          step: e.step,
          mode: e.meta?.mode || '',
          source: e.meta?.source || '',
          eventType: e.meta?.eventType || '',
          ...debugMetaFields(e, 'eventAgeMs deltaX deltaY deltaMode wheelDeltaXPx wheelDeltaYPx clientX clientY'),
          ...debugMetaFields(e, 'panXBefore panYBefore panXAfter panYAfter panDeltaX panDeltaY panDistancePx zoomBefore'),
          zoomAfter: e.meta?.zoomAfter ?? e.meta?.newZoom ?? '',
          ...debugMetaFields(e, 'zoomDeltaPct handlerMs rafPending pendingSources'),
        });
      } else if (e.op === 'frame' && (e.step === 'start' || e.step === 'end')) {
        timeline.push({
          at: e.at,
          kind: 'frame',
          step: e.step,
          source: e.meta?.inputSource || e.meta?.sources || '',
          ...debugMetaFields(e, 'queueMs inputAgeMs rafGap frameMs doTransform doBoard doOverlay slow'),
        });
      } else if (e.op === 'frameSchedule') {
        timeline.push({
          at: e.at,
          kind: 'frameSchedule',
          step: e.step,
          source: e.meta?.source || '',
          ...debugMetaFields(e, 'inputAgeMs rafPending pendingSources needTransform needBoardRender needOverlayRender'),
        });
      } else if (e.op === 'applyTransform' && e.step === 'end') {
        timeline.push({
          at: e.at,
          kind: 'applyTransform',
          step: 'end',
          source: e.meta?.source || '',
          totalMs: e.meta?.totalMeasuredMs ?? e.total ?? '',
          ...debugMetaFields(e, 'drawMs overlayMs panX panY zoom'),
        });
      } else if (e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped) {
        timeline.push({
          at: e.at,
          kind: 'drawBoard',
          step: 'end',
          source: e.meta?.source || '',
          totalMs: e.meta?.totalMeasuredMs ?? e.total ?? '',
          ...debugMetaFields(e, 'objectLoopMs visibleObjects testedObjects drawnImages drawnText drawnTextLines textDrawUnits textDrawCalls'),
          ...debugMetaFields(e, 'textRuns textPlanCacheHits textPlanCacheMisses textLineDrawMs maxTextLineDrawMs slowTextLineDrawCount textDirectDraws imageContextFirstDraws'),
          ...debugMetaFields(e, 'scaledImageContextFirstDraws culledImages culledText scaledImages scaledFallbackFull activeInputFullFallbackImages fullScaleImages zoom'),
        });
      } else if (e.op === 'eventLoop' || e.op === 'longTask') {
        timeline.push({
          at: e.at,
          kind: e.op,
          step: e.step,
          gapMs: e.meta?.gapMs ?? '',
          durationMs: e.meta?.duration ?? '',
        });
      }
    }
    return timelineTable(timeline, limit);
  }

  function drawSummary() {
    const draws = events
      .filter(e => e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ms: e.total, ...(e.meta || {}) }));
    const retainedSlowDraws = slowRecords
      .map(e => ({
        ...e.steps?.drawBoard?.meta,
        drawMs: e.steps?.drawBoard?.ms ?? e.steps?.drawBoard?.meta?.totalMeasuredMs ?? 0,
      }))
      .filter(row => Number(row.drawMs) > 0);
    const sum = (field) => draws.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => draws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const slowMax = (field) => retainedSlowDraws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const avg = (field) => draws.length ? Math.round(sum(field) / draws.length * 100) / 100 : 0;
    const peak = (field) => Math.max(max(field), slowMax(field));
    const recentMaxDrawMs = Math.round(max('ms') * 100) / 100;
    const retainedMaxSlowDrawMs = Math.round(slowMax('drawMs') * 100) / 100;
    const recentMaxObjectLoopMs = Math.round(max('objectLoopMs') * 100) / 100;
    const retainedMaxSlowObjectLoopMs = Math.round(slowMax('objectLoopMs') * 100) / 100;
    const textDrawUnits = sum('textDrawUnits');
    const textDrawCalls = sum('textDrawCalls');
    const out = {
      draws: draws.length,
      retainedSlowDraws: retainedSlowDraws.length,
      avgDrawMs: avg('ms'),
      maxDrawMs: Math.max(recentMaxDrawMs, retainedMaxSlowDrawMs),
      recentMaxDrawMs,
      retainedMaxSlowDrawMs,
      avgDrawnImages: avg('drawnImages'),
      maxDrawnImages: max('drawnImages'),
      avgTestedObjects: avg('testedObjects'),
      maxTestedObjects: max('testedObjects'),
      avgVisibleObjects: avg('visibleObjects'),
      maxVisibleObjects: max('visibleObjects'),
      avgObjectLoopMs: avg('objectLoopMs'),
      maxObjectLoopMs: Math.max(recentMaxObjectLoopMs, retainedMaxSlowObjectLoopMs),
      recentMaxObjectLoopMs,
      retainedMaxSlowObjectLoopMs,
      avgBackgroundSetupMs: avg('backgroundSetupMs'),
      maxBackgroundSetupMs: Math.round(max('backgroundSetupMs') * 100) / 100,
      avgOffscreenBlitMs: avg('offscreenBlitMs'),
      maxOffscreenBlitMs: Math.round(max('offscreenBlitMs') * 100) / 100,
      avgEditingOverlayMs: avg('editingOverlayMs'),
      maxEditingOverlayMs: Math.round(max('editingOverlayMs') * 100) / 100,
      avgCulledImages: avg('culledImages'),
      maxCulledImages: max('culledImages'),
      avgBitmapImages: avg('bitmapImages'),
      avgScaledImages: avg('scaledImages'),
      maxScaledImages: max('scaledImages'),
      avgFullScaleImages: avg('fullScaleImages'),
      maxFullScaleImages: max('fullScaleImages'),
      avgScaledFallbackFull: avg('scaledFallbackFull'),
      maxScaledFallbackFull: peak('scaledFallbackFull'),
      avgActiveInputFullFallbackImages: avg('activeInputFullFallbackImages'),
      maxActiveInputFullFallbackImages: peak('activeInputFullFallbackImages'),
      avgMotionObjects: avg('motionObjects'),
      maxMotionObjects: peak('motionObjects'),
      avgMotionImages: avg('motionImages'),
      maxMotionImages: peak('motionImages'),
      avgMotionText: avg('motionText'),
      maxMotionText: peak('motionText'),
      avgMotionTranslatedObjects: avg('motionTranslatedObjects'),
      maxMotionTranslatedObjects: peak('motionTranslatedObjects'),
      avgMotionScaledObjects: avg('motionScaledObjects'),
      maxMotionScaledObjects: peak('motionScaledObjects'),
      avgMotionScaledImages: avg('motionScaledImages'),
      maxMotionScaledImages: peak('motionScaledImages'),
      avgMotionFullScaleImages: avg('motionFullScaleImages'),
      maxMotionFullScaleImages: peak('motionFullScaleImages'),
      avgMotionFullFallbackImages: avg('motionFullFallbackImages'),
      maxMotionFullFallbackImages: peak('motionFullFallbackImages'),
      avgMotionActiveInputFullFallbackImages: avg('motionActiveInputFullFallbackImages'),
      maxMotionActiveInputFullFallbackImages: peak('motionActiveInputFullFallbackImages'),
      avgScaledImageScale: sum('scaledImages') ? Math.round(sum('scaledImageScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgTargetImageScale: sum('scaledImages') ? Math.round(sum('scaledImageTargetScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgImageSourceFirstDraws: avg('imageSourceFirstDraws'),
      maxImageSourceFirstDraws: peak('imageSourceFirstDraws'),
      avgImageSourceWarmDraws: avg('imageSourceWarmDraws'),
      maxImageSourceWarmDraws: peak('imageSourceWarmDraws'),
      avgImageContextFirstDraws: avg('imageContextFirstDraws'),
      maxImageContextFirstDraws: peak('imageContextFirstDraws'),
      avgImageContextWarmDraws: avg('imageContextWarmDraws'),
      maxImageContextWarmDraws: peak('imageContextWarmDraws'),
      avgScaledImageContextFirstDraws: avg('scaledImageContextFirstDraws'),
      maxScaledImageContextFirstDraws: peak('scaledImageContextFirstDraws'),
      avgFullScaleImageContextFirstDraws: avg('fullScaleImageContextFirstDraws'),
      maxFullScaleImageContextFirstDraws: peak('fullScaleImageContextFirstDraws'),
      avgMissingImages: avg('missingImages'),
      maxMissingImages: max('missingImages'),
      avgErroredImages: avg('erroredImages'),
      avgCroppedImages: avg('croppedImages'),
      maxRetainedSlowCroppedImages: slowMax('croppedImages'),
      avgDrawnText: avg('drawnText'),
      avgCulledText: avg('culledText'),
      avgTextLayoutMs: avg('textLayoutMs'),
      maxTextLayoutMs: Math.round(max('maxTextLayoutMs') * 100) / 100,
      avgTextLayoutObjects: avg('textLayoutObjects'),
      maxTextCharCount: max('textCharCount'),
      largestTextChars: max('largestTextChars'),
      largestTextLayoutLines: max('largestTextLayoutLines'),
      avgTextLines: avg('textLines'),
      avgDrawnTextLines: avg('drawnTextLines'),
      maxDrawnTextLines: peak('drawnTextLines'),
      avgCulledTextLines: avg('culledTextLines'),
      maxCulledTextLines: peak('culledTextLines'),
      avgTextDrawUnits: avg('textDrawUnits'),
      maxTextDrawUnits: peak('textDrawUnits'),
      avgTextDrawCalls: avg('textDrawCalls'),
      maxTextDrawCalls: peak('textDrawCalls'),
      textDrawCallReductionPct: textDrawUnits > 0
        ? Math.round((1 - textDrawCalls / textDrawUnits) * 10000) / 100
        : 0,
      avgTextRuns: avg('textRuns'),
      maxTextRuns: peak('textRuns'),
      avgTextSkippedTabs: avg('textSkippedTabs'),
      maxTextSkippedTabs: peak('textSkippedTabs'),
      avgTextSkippedSpaces: avg('textSkippedSpaces'),
      maxTextSkippedSpaces: peak('textSkippedSpaces'),
      avgTextPlanCacheHits: avg('textPlanCacheHits'),
      maxTextPlanCacheHits: peak('textPlanCacheHits'),
      avgTextPlanCacheMisses: avg('textPlanCacheMisses'),
      maxTextPlanCacheMisses: peak('textPlanCacheMisses'),
      avgTextLineDrawMs: avg('textLineDrawMs'),
      maxTextLineDrawMs: Math.round(peak('maxTextLineDrawMs') * 100) / 100,
      maxSlowTextLineDrawCount: peak('slowTextLineDrawCount'),
      maxTextDrawUnitsPerLine: peak('maxTextDrawUnitsPerLine'),
      maxTextDrawCallsPerLine: peak('maxTextDrawCallsPerLine'),
      maxTextRunsPerLine: peak('maxTextRunsPerLine'),
      avgTextDirectDraws: avg('textDirectDraws'),
      maxTextDirectDraws: peak('textDirectDraws'),
      avgEditLayoutMs: avg('editLayoutMs'),
      maxEditLayoutMs: Math.round(peak('editLayoutMs') * 100) / 100,
      avgEditTextDrawMs: avg('editTextDrawMs'),
      maxEditTextDrawMs: Math.round(peak('editTextDrawMs') * 100) / 100,
      avgEditSelectionMs: avg('editSelectionMs'),
      maxEditSelectionMs: Math.round(peak('editSelectionMs') * 100) / 100,
      maxEditSelectedChars: peak('editSelectedChars'),
      maxEditSelectionLines: peak('editSelectionLines'),
      maxEditSelectionVisibleLines: peak('editSelectionVisibleLines'),
      avgEditCaretMs: avg('editCaretMs'),
      maxEditCaretMs: Math.round(peak('editCaretMs') * 100) / 100,
      avgEditVisibleLines: avg('editVisibleLines'),
      maxEditVisibleLines: peak('editVisibleLines'),
      avgEditCulledLines: avg('editCulledLines'),
      maxEditCulledLines: peak('editCulledLines'),
    };
    console.table([out]);
    return out;
  }

  function imageHealth(limit = 40) {
    const rows = (typeof objects === 'undefined' ? [] : objects)
      .filter(obj => obj.type === 'image')
      .map(obj => {
        const key = obj.data?.imgKey || '';
        const bitmap = key ? imageBitmapCache[key] : null;
        const src = key ? imageStore[key] : null;
        const ready = key ? imageReadyPromises.get(key) : null;
        let status = 'ok';
        if (!key) status = 'missing-key';
        else if (!src) status = 'missing-store';
        else if (imageBitmapFailed.has(key)) status = 'bitmap-failed-no-fallback';
        else if (!bitmap) status = 'missing-image-element';
        return {
          id: obj.id,
          key,
          status,
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          w: Math.round(obj.w),
          h: Math.round(obj.h),
          sourceKind: typeof isWebImageRef === 'function' && isWebImageRef(src) ? 'web-ref' : typeof src,
          bytes: src?.bytes ?? '',
          complete: !!(bitmap?.width && bitmap?.height),
          naturalW: bitmap?.width || 0,
          naturalH: bitmap?.height || 0,
          hasBitmap: !!bitmap,
          bitmapFailed: key ? imageBitmapFailed.has(key) : false,
          hasReadyPromise: !!ready,
        };
      });
    const bad = rows.filter(row => row.status !== 'ok');
    console.table((bad.length ? bad : rows).slice(0, limit));
    return { total: rows.length, badCount: bad.length, bad, rows };
  }

  function imageHealthSummary() {
    const health = imageHealth(0);
    const counts = health.rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});
    const out = {
      total: health.total,
      badCount: health.badCount,
      ok: counts.ok || 0,
      missingKey: counts['missing-key'] || 0,
      missingStore: counts['missing-store'] || 0,
      missingImageElement: counts['missing-image-element'] || 0,
      bitmapFailedNoFallback: counts['bitmap-failed-no-fallback'] || 0,
    };
    console.table([out]);
    return out;
  }

  function imageScaleCacheSummary(options = {}) {
    const variantCount = imageScaledBitmapCache.size;
    const rows = variantCount ? [{
      scale: IMAGE_SCALE,
      count: variantCount,
      mb: Math.round(imageScaledBitmapBytes / 1024 / 1024 * 100) / 100,
    }] : [];
    const out = {
      variants: variantCount,
      cacheMB: Math.round(imageScaledBitmapBytes / 1024 / 1024 * 100) / 100,
      limitMB: Math.round(IMAGE_VARIANT_MEMORY_LIMIT / 1024 / 1024),
	      pending: imageScaledBitmapPending.size,
	      pendingMB: Math.round(imageScaledBitmapPendingByteTotal / 1024 / 1024 * 100) / 100,
	      queued: imageScaledVariantQueue.length,
	      queueActive: imageScaledVariantQueueActive,
	      queueConcurrency: IMAGE_VARIANT_QUEUE_CONCURRENCY,
	      renderBatchPending: !!imageScaledVariantRenderTimer,
      renderBatchCount: imageScaledVariantRenderCount,
      inputIdleMs: Math.round((performance.now() - lastViewportInputAt) * 10) / 10,
      inputIdleThresholdMs: IMAGE_VARIANT_INPUT_IDLE_MS,
      activeInputQueueDelayMs: IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS,
      activeInputPriorityMs: IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS,
      builds: imageScaledVariantBuildCount,
      avgBuildMs: imageScaledVariantBuildCount ? Math.round(imageScaledVariantBuildTotalMs / imageScaledVariantBuildCount * 10) / 10 : 0,
      maxBuildMs: Math.round(imageScaledVariantBuildMaxMs * 10) / 10,
      resizeBitmapBuilds: imageScaledVariantResizeBitmapCount,
      canvasFallbackBuilds: imageScaledVariantCanvasFallbackCount,
      evictions: imageScaledVariantEvictionCount,
      memorySkips: imageScaledVariantMemorySkipCount,
      activeInputFullFallbacks: imageScaledVariantActiveInputFullFallbackCount,
      priorityBoosts: imageScaledVariantPriorityBoostCount,
      prewarmRuns: imageScaledVariantPrewarmRunCount,
      prewarmCandidates: imageScaledVariantPrewarmCandidateCount,
      prewarmReady: imageScaledVariantPrewarmReadyCount,
      prewarmQueued: imageScaledVariantPrewarmQueuedCount,
      prewarmNoSource: imageScaledVariantPrewarmNoSourceCount,
      prewarmPending: !!imageScaledVariantPrewarmTimer,
      prewarmPadPx: IMAGE_VARIANT_PREWARM_PAD_PX,
      sourceReadyCandidates: imageScaledVariantSourceReadyCandidateCount,
      sourceReadyQueued: imageScaledVariantSourceReadyQueuedCount,
      sourceReadyReady: imageScaledVariantSourceReadyReadyCount,
      sourceReadyNoSource: imageScaledVariantSourceReadyNoSourceCount,
      drawWarmupQueued: drawableBitmapWarmupQueuedCount,
      drawWarmupPending: drawableBitmapWarmupQueue.size,
	      drawWarmupWarmed: drawableBitmapWarmupWarmedCount,
	      drawWarmupAvgMs: drawableBitmapWarmupWarmedCount ? Math.round(drawableBitmapWarmupTotalMs / drawableBitmapWarmupWarmedCount * 10) / 10 : 0,
	      drawWarmupMaxMs: Math.round(drawableBitmapWarmupMaxMs * 10) / 10,
	      drawWarmupAvgPixels: drawableBitmapWarmupWarmedCount ? Math.round(drawableBitmapWarmupTotalPixels / drawableBitmapWarmupWarmedCount) : 0,
	      drawWarmupMaxPixels: drawableBitmapWarmupMaxPixels,
	      drawWarmupErrors: drawableBitmapWarmupErrorCount,
      drawWarmupUnsupported: drawableBitmapWarmupUnsupportedCount,
      drawWarmupFullImageQueued: drawableBitmapWarmupQueuedByKind.fullImage || 0,
      drawWarmupFullImageWarmed: drawableBitmapWarmupWarmedByKind.fullImage || 0,
      drawWarmupScaledVariantQueued: drawableBitmapWarmupQueuedByKind.scaledVariant || 0,
      drawWarmupScaledVariantWarmed: drawableBitmapWarmupWarmedByKind.scaledVariant || 0,
      levels: String(IMAGE_SCALE),
      supported: VIEWPORT_IMAGE_SCALING_SUPPORTED,
      enabled: viewportImageScalingEnabled,
    };
    if (options.table !== false) {
      console.table([out]);
      if (rows.length) console.table(rows);
    }
    return { ...out, byScale: rows };
  }

  function cullingSummary() {
    const paddingPx = 0;
    const rect = viewportWorldRect(paddingPx);
    let visibleImages = 0;
    let visibleText = 0;
    let culledImages = 0;
    let culledText = 0;
    let visibleImagesWithScaledVariant = 0;
    let visibleImagesMissingScaledVariant = 0;
    let visibleScaledVariantMB = 0;
    for (const obj of objects) {
      const visible = objectIntersectsRect(obj, rect);
      if (obj.type === 'image') {
        if (visible) {
          visibleImages++;
          const key = obj.data?.imgKey;
          const bitmap = key ? imageBitmapCache[key] : null;
          const fullSource = bitmap || null;
          const scalingActive = typeof isViewportImageScalingActive === 'function'
            ? isViewportImageScalingActive()
            : viewportImageScalingEnabled;
          const targetScale = scalingActive && fullSource ? chooseImageScaleForDraw(obj, fullSource) : 1;
          if (targetScale < 1) {
            const sourceW = fullSource?.width || 0;
            const sourceH = fullSource?.height || 0;
            visibleScaledVariantMB += scaledVariantEstimatedBytes(sourceW, sourceH, targetScale) / 1024 / 1024;
            if (hasScaledImageVariant(key, targetScale)) visibleImagesWithScaledVariant++;
            else visibleImagesMissingScaledVariant++;
          }
        } else culledImages++;
      } else if (obj.type === 'text') {
        if (visible) visibleText++;
        else culledText++;
      }
    }
    const out = {
      paddingPx,
      enabled: viewportCullingEnabled,
      zoom: Math.round(zoom * 1000) / 1000,
      padWorld: Math.round((paddingPx / Math.max(zoom, 0.001)) * 100) / 100,
      visibleImages,
      culledImages,
      visibleImagesWithScaledVariant,
      visibleImagesMissingScaledVariant,
      visibleScaledVariantMB: Math.round(visibleScaledVariantMB * 100) / 100,
      visibleText,
      culledText,
      rectX1: Math.round(rect.x1),
      rectY1: Math.round(rect.y1),
      rectX2: Math.round(rect.x2),
      rectY2: Math.round(rect.y2),
    };
    console.table([out]);
    return out;
  }

  function slowFrames(limit = 20) {
    const rows = slowRecords
      .map((e) => {
        const draw = e.steps?.drawBoard, meta = draw?.meta;
        return {
          id: e.id,
          ...debugPick(e, 'frameMs queueMs inputAgeMs inputSource rafGap sources doTransform doBoard doOverlay'),
          applyTransformCallMs: e.steps?.applyTransformCall?.ms ?? '',
          drawBoardMs: draw?.ms ?? '',
          ...debugPick(meta, 'objectLoopMs backgroundSetupMs offscreenBlitMs editingOverlayMs testedObjects visibleObjects drawnImages drawnText'),
          ...debugPick(meta, 'textLayoutMs maxTextLayoutMs textLayoutObjects textCharCount largestTextChars largestTextLayoutLines textLines'),
          ...debugPick(meta, 'drawnTextLines culledTextLines textDrawUnits textDrawCalls textRuns textSkippedTabs textSkippedSpaces'),
          ...debugPick(meta, 'textPlanCacheHits textPlanCacheMisses textLineDrawMs maxTextLineDrawMs slowTextLineDrawCount maxTextDrawUnitsPerLine'),
          ...debugPick(meta, 'maxTextDrawCallsPerLine maxTextRunsPerLine textDirectDraws editLayoutMs editTextDrawMs editSelectionMs editCaretMs'),
          ...debugPick(meta, 'editLayoutLines editVisibleLines editCulledLines editSelectionRuns editSelectedChars editSelectionLines'),
          ...debugPick(meta, 'editSelectionVisibleLines editCaretDrawn bitmapImages scaledImages scaledFallbackFull activeInputFullFallbackImages'),
          ...debugPick(meta, 'motionObjects motionImages motionText motionTranslatedObjects motionScaledObjects motionScaledImages'),
          ...debugPick(meta, 'motionFullScaleImages motionFullFallbackImages motionActiveInputFullFallbackImages imageSourceFirstDraws'),
          ...debugPick(meta, 'imageSourceWarmDraws imageContextFirstDraws imageContextWarmDraws scaledImageContextFirstDraws'),
          ...debugPick(meta, 'fullScaleImageContextFirstDraws fullScaleImages missingImages croppedImages culledImages culledText'),
          slowDrawObjects: (meta?.slowDrawObjects || [])
            .map(row => `${row.type || ''}:${row.id || ''}${row.imgKey ? ':' + row.imgKey : ''}:${row.ms ?? ''}ms`)
            .join(' | '),
          slowDrawObjectRows: (meta?.slowDrawObjects || []).map(row => ({ ...row })),
          slowTextLineDraws: (meta?.slowTextLineDraws || [])
            .map(row => `${row.objectId || row.id || ''}:${row.logicalLineIndex ?? ''}:${row.ms ?? ''}ms`)
            .join(' | '),
          slowTextLineRows: (meta?.slowTextLineDraws || []).map(row => ({ ...row })),
          ...debugPick(meta, 'canvasW canvasH'),
          zoom: meta?.zoom ?? e.zoom ?? '',
          updateSelectionOverlayMs: e.steps?.updateSelectionOverlay?.ms ?? '',
        };
      })
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function slowFrameDetails(limit = 5) {
    const rows = slowRecords
      .slice()
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit)
      .map(e => ({
        id: e.id,
        ...debugPick(e, 'frameMs queueMs inputAgeMs inputSource rafGap sources'),
        start: {
          panX: e.panX,
          panY: e.panY,
          zoom: e.zoom,
        },
        flags: {
          doTransform: e.doTransform,
          doBoard: e.doBoard,
          doOverlay: e.doOverlay,
        },
        steps: Object.fromEntries(Object.entries(e.steps || {}).map(([name, step]) => ([
          name,
          {
            ms: Math.round((step.ms || 0) * 100) / 100,
            total: Math.round((step.total || 0) * 100) / 100,
            meta: step.meta || {},
          },
        ]))),
      }));
    console.log(rows);
    return rows;
  }

  function transformSummary() {
    const stepsById = new Map();
    const starts = new Map();
    for (const e of events) {
      if (e.op !== 'applyTransform') continue;
      if (e.step === 'start') starts.set(e.id, e.meta || {});
      else if (e.step !== 'end') {
        if (!stepsById.has(e.id)) stepsById.set(e.id, {});
        stepsById.get(e.id)[e.step] = e.meta?.ms ?? e.total ?? 0;
      }
    }
    const rows = events
      .filter(e => e.op === 'applyTransform' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ...(starts.get(e.id) || {}), ...(stepsById.get(e.id) || {}), totalMs: e.total }));
    const sum = (field) => rows.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => rows.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const avg = (field) => rows.length ? Math.round(sum(field) / rows.length * 100) / 100 : 0;
    const out = {
      transforms: rows.length,
      avgTotalMs: avg('totalMs'),
      maxTotalMs: Math.round(max('totalMs') * 100) / 100,
      avgDrawBoardMs: avg('drawBoard'),
      maxDrawBoardMs: Math.round(max('drawBoard') * 100) / 100,
      avgOverlayMs: avg('updateSelectionOverlay'),
      maxOverlayMs: Math.round(max('updateSelectionOverlay') * 100) / 100,
    };
    console.table([out]);
    return out;
  }

  function eventLoopTimeline(limit = 80) {
    const rowLimit = typeof limit === 'object' ? limit.limit : limit;
    const rows = events
      .filter(e => e.op === 'eventLoop' || e.op === 'longTask')
      .slice(-Math.max(1, Number(rowLimit) || 80))
      .map(e => ({
        at: e.at,
        kind: e.op,
        step: e.step,
        gapMs: e.meta?.gapMs ?? '',
        overMs: e.meta?.overMs ?? '',
        durationMs: e.meta?.duration ?? '',
        startTime: e.meta?.startTime ?? '',
      }));
    console.table(rows);
    return rows;
  }

  function rawInputTimeline(limit = 120) {
    const rowLimit = typeof limit === 'object' ? limit.limit : limit;
    const rows = events
      .filter(e => e.op === 'input')
      .slice(-Math.max(1, Number(rowLimit) || 120))
      .map(e => ({
        at: e.at,
        step: e.step,
        source: e.meta?.source || '',
        eventType: e.meta?.eventType || '',
        ...debugMetaFields(e, 'eventAgeMs deltaX deltaY deltaMode wheelDeltaXPx wheelDeltaYPx'),
        key: e.meta?.key || '',
        code: e.meta?.code || '',
        ...debugMetaFields(e, 'repeat button buttons'),
        ctrl: !!e.meta?.ctrlKey,
        meta: !!e.meta?.metaKey,
        ...debugMetaFields(e, 'shieldActive inputShieldCount blocked'),
        target: e.meta?.target || '',
      }));
    console.table(rows);
    return rows;
  }

  function sourceIncludesMotion(value) {
    return String(value || '').split(',').map(item => item.trim()).includes('motion') ||
      String(value || '').includes('motion');
  }

  function motionRows() {
    return events
      .filter(e => e.op === 'motion')
      .map(e => ({ at: e.at, step: e.step, ...(e.meta || {}) }));
  }

  function motionFrameRows() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'frame' && e.step === 'start') starts.set(e.id, { at: e.at, ...(e.meta || {}) });
    }
    return events
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => {
        const startMeta = starts.get(e.id) || {};
        const source = e.meta?.sources || startMeta.inputSource || '';
        return {
          id: e.id,
          at: e.at,
          source,
          queueMs: startMeta.queueMs ?? '',
          inputAgeMs: startMeta.inputAgeMs ?? '',
          rafGap: startMeta.rafGap ?? '',
          ...debugMetaFields(e, 'frameMs doTransform doBoard doOverlay slow'),
        };
      })
      .filter(row => sourceIncludesMotion(row.source));
  }

  function motionDrawRows() {
    return events
      .filter(e => e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped && sourceIncludesMotion(e.meta?.source))
      .map(e => ({
        at: e.at,
        drawMs: e.meta?.totalMeasuredMs ?? e.total ?? '',
        ...debugMetaFields(e, 'objectLoopMs drawnImages drawnText motionObjects motionImages motionText motionTranslatedObjects'),
        ...debugMetaFields(e, 'motionScaledObjects motionScaledImages motionFullScaleImages motionFullFallbackImages motionActiveInputFullFallbackImages scaledFallbackFull activeInputFullFallbackImages'),
        ...debugMetaFields(e, 'croppedImages imageSourceFirstDraws imageSourceWarmDraws imageContextFirstDraws imageContextWarmDraws'),
        slowDrawObjects: (e.meta?.slowDrawObjects || []).map(row => ({ ...row })),
      }));
  }

  function motionSummary() {
    const rows = motionRows();
    const jiggleStarts = rows.filter(row => row.step === 'jiggle-start');
    const progress = rows.filter(row => row.step === 'jiggle-progress');
    const rafFired = rows.filter(row => row.step === 'raf-fired');
    const renderScheduled = rows.filter(row => row.step === 'render-scheduled');
    const frames = motionFrameRows();
    const draws = motionDrawRows();
    const progressGaps = [];
    const lastProgressById = new Map();
    for (const row of progress) {
      const key = `${row.id || ''}:${row.objectType || ''}`;
      const previousAt = lastProgressById.get(key);
      if (previousAt != null) progressGaps.push(row.at - previousAt);
      lastProgressById.set(key, row.at);
    }
    const firstProgressLatencies = [];
    for (const start of jiggleStarts) {
      const match = progress.find(row => row.at >= start.at && row.id === start.id && row.objectType === start.objectType);
      if (match) firstProgressLatencies.push(match.at - start.at);
    }
    const num = (item, field) => Number(field ? item[field] : item) || 0;
    const sumValues = (items, field) => items.reduce((value, row) => value + num(row, field), 0);
    const maxValue = (items, field) => items.reduce((value, row) => Math.max(value, num(row, field)), 0);
    const avgOf = (items, field) => items.length ? round(sumValues(items, field) / items.length) : 0;
    const out = {
      motionEvents: rows.length,
      starts: jiggleStarts.length,
      jiggleStarts: jiggleStarts.length,
      imageJiggleStarts: jiggleStarts.filter(row => row.objectType === 'image').length,
      textJiggleStarts: jiggleStarts.filter(row => row.objectType === 'text').length,
      textSelectionJiggleStarts: jiggleStarts.filter(row => row.objectType === 'text-selection').length,
      progressSamples: progress.length,
      rafTicks: rafFired.length,
      renderSchedules: renderScheduled.length,
      motionFrames: frames.length,
      slowMotionFramesOver16ms: frames.filter(row => row.slow || Number(row.frameMs) > 16.7).length,
      motionDraws: draws.length,
      avgMotionFrameMs: avgOf(frames, 'frameMs'),
      maxMotionFrameMs: round(maxValue(frames, 'frameMs')),
      avgMotionRafGapMs: avgOf(frames, 'rafGap'),
      maxMotionRafGapMs: round(maxValue(frames, 'rafGap')),
      avgMotionQueueMs: avgOf(frames, 'queueMs'),
      maxMotionQueueMs: round(maxValue(frames, 'queueMs')),
      avgProgressGapMs: avgOf(progressGaps),
      maxProgressGapMs: round(maxValue(progressGaps)),
      progressGapsOver16ms: progressGaps.filter(gap => gap > 16.7).length,
      progressGapsOver32ms: progressGaps.filter(gap => gap > 32).length,
      avgFirstProgressLatencyMs: avgOf(firstProgressLatencies),
      maxFirstProgressLatencyMs: round(maxValue(firstProgressLatencies)),
      avgMotionDrawMs: avgOf(draws, 'drawMs'),
      maxMotionDrawMs: round(maxValue(draws, 'drawMs')),
      avgMotionObjectLoopMs: avgOf(draws, 'objectLoopMs'),
      maxMotionObjectLoopMs: round(maxValue(draws, 'objectLoopMs')),
      maxMotionImages: maxValue(draws, 'motionImages'),
      maxMotionScaledImages: maxValue(draws, 'motionScaledImages'),
      maxMotionFullScaleImages: maxValue(draws, 'motionFullScaleImages'),
      maxMotionFullFallbackImages: maxValue(draws, 'motionFullFallbackImages'),
      maxMotionActiveInputFullFallbackImages: maxValue(draws, 'motionActiveInputFullFallbackImages'),
      firstAt: rows[0]?.at ?? '',
      lastAt: rows[rows.length - 1]?.at ?? '',
      durationMs: rows.length > 1 ? round(rows[rows.length - 1].at - rows[0].at) : 0,
    };
    console.table([out]);
    return out;
  }

  function motionTimeline(options = {}) {
    const opts = options && typeof options === 'object' ? options : { limit: options };
    const limit = Math.max(1, Number(opts.limit) || 240);
    const motionEvents = motionRows();
    if (!motionEvents.length) {
      console.table([]);
      return [];
    }
    const firstAt = motionEvents[0]?.at ?? -Infinity;
    const lastAt = motionEvents[motionEvents.length - 1]?.at ?? Infinity;
    const windowStart = Number.isFinite(Number(opts.beforeMs)) ? firstAt - Number(opts.beforeMs) : firstAt;
    const windowEnd = Number.isFinite(Number(opts.afterMs)) ? lastAt + Number(opts.afterMs) : lastAt + 80;
    const timeline = [];
    for (const row of motionEvents) {
      timeline.push({
        at: row.at,
        kind: 'motion',
        step: row.step,
        id: row.id || '',
        objectType: row.objectType || '',
        action: row.action || '',
        ...debugPick(row, 't translateX translateY scaleX scaleY opacity waitMs duration jelloObjectMotions textSelectionJelloMotions'),
      });
    }
    for (const e of events) {
      if (e.at < windowStart || e.at > windowEnd) continue;
      if (e.op === 'frameSchedule' && (sourceIncludesMotion(e.meta?.source) || sourceIncludesMotion(e.meta?.inputSource))) {
        timeline.push({
          at: e.at,
          kind: 'frameSchedule',
          step: e.step,
          source: e.meta?.source || '',
          ...debugMetaFields(e, 'pendingSources rafPending needBoardRender needOverlayRender'),
        });
      } else if (e.op === 'frame' && e.step === 'end' && sourceIncludesMotion(e.meta?.sources)) {
        timeline.push({
          at: e.at,
          kind: 'frame',
          step: 'end',
          source: e.meta?.sources || '',
          ...debugMetaFields(e, 'frameMs doBoard doOverlay slow'),
        });
      } else if (e.op === 'drawBoard' && e.step === 'end' && sourceIncludesMotion(e.meta?.source)) {
        timeline.push({
          at: e.at,
          kind: 'drawBoard',
          step: 'end',
          source: e.meta?.source || '',
          drawMs: e.meta?.totalMeasuredMs ?? e.total ?? '',
          ...debugMetaFields(e, 'objectLoopMs motionImages motionScaledImages motionFullFallbackImages motionActiveInputFullFallbackImages'),
        });
      } else if (e.op === 'eventLoop' || e.op === 'longTask') {
        timeline.push({
          at: e.at,
          kind: e.op,
          step: e.step,
          gapMs: e.meta?.gapMs ?? '',
          overMs: e.meta?.overMs ?? '',
          durationMs: e.meta?.duration ?? '',
        });
      }
    }
    return timelineTable(timeline, limit);
  }

  function jiggleReport(options = {}) {
    const opts = options && typeof options === 'object' ? options : { limit: options };
    const out = {
      motionSummary: motionSummary(),
      motionTimeline: motionTimeline({
        limit: opts.timelineLimit ?? opts.limit ?? 400,
        beforeMs: opts.beforeMs,
        afterMs: opts.afterMs,
      }),
      frameSummary: frameSummary(),
      drawSummary: drawSummary(),
      slowFrames: slowFrames(opts.slowFrames ?? opts.limit ?? 80),
      imageScaleCache: imageScaleCacheSummary({ table: opts.cacheTable === true }),
      eventLoopTimeline: eventLoopTimeline(opts.eventLoopLimit ?? opts.limit ?? 160),
      rawInputTimeline: rawInputTimeline(opts.rawInputLimit ?? opts.limit ?? 160),
    };
    if (opts.details === true) out.slowFrameDetails = slowFrameDetails(opts.detailLimit ?? 8);
    if (opts.log !== false) console.log(out);
    return out;
  }

  function panZoomReport(options = {}) {
    const opts = options && typeof options === 'object' ? options : { limit: options };
    const out = {
      summary: panZoomSummary(),
      panZoomTimeline: panZoomTimeline(opts.timelineLimit ? { limit: opts.timelineLimit } : opts),
      wheelSummary: wheelSummary(),
      wheelTimeline: wheelTimeline(opts.wheelLimit ?? opts.limit ?? 120),
      frameSummary: frameSummary(),
      frameScheduleTimeline: frameScheduleTimeline(opts.frameScheduleLimit ?? opts.limit ?? 120),
      transformSummary: transformSummary(),
      drawSummary: drawSummary(),
      slowFrames: slowFrames(opts.slowFrames ?? opts.limit ?? 40),
      eventLoopTimeline: eventLoopTimeline(opts.eventLoopLimit ?? opts.limit ?? 120),
      rawInputTimeline: rawInputTimeline(opts.rawInputLimit ?? opts.limit ?? 240),
      imageScaleCache: imageScaleCacheSummary({ table: opts.cacheTable === true }),
      textLayoutPrewarm: typeof getLastVisibleTextLayoutPrewarm === 'function'
        ? getLastVisibleTextLayoutPrewarm()
        : null,
      bestTextLayoutPrewarm: typeof getBestVisibleTextLayoutPrewarm === 'function'
        ? getBestVisibleTextLayoutPrewarm()
        : null,
      textLayoutPrewarmHistory: typeof getVisibleTextLayoutPrewarmHistory === 'function'
        ? getVisibleTextLayoutPrewarmHistory(opts.textPrewarmHistoryLimit ?? 8)
        : null,
      culling: cullingSummary(),
    };
    if (opts.details === true) out.slowFrameDetails = slowFrameDetails(opts.detailLimit ?? 5);
    if (opts.log !== false) console.log(out);
    return out;
  }

  function report(options = {}) {
    const out = {
      summary: summary(),
      frameSummary: frameSummary(),
      panZoomSummary: panZoomSummary(),
      panZoomTimeline: panZoomTimeline(options.panZoomLimit ?? options.limit ?? 160),
      wheelSummary: wheelSummary(),
      drawSummary: drawSummary(),
      transformSummary: transformSummary(),
      eventLoopTimeline: eventLoopTimeline(options.eventLoopLimit ?? 80),
      rawInputTimeline: rawInputTimeline(options.rawInputLimit ?? 120),
      slowFrames: slowFrames(options.slowFrames ?? options.limit ?? 20),
      imageScaleCache: imageScaleCacheSummary(),
      textLayoutPrewarm: typeof getLastVisibleTextLayoutPrewarm === 'function'
        ? getLastVisibleTextLayoutPrewarm()
        : null,
      bestTextLayoutPrewarm: typeof getBestVisibleTextLayoutPrewarm === 'function'
        ? getBestVisibleTextLayoutPrewarm()
        : null,
      textLayoutPrewarmHistory: typeof getVisibleTextLayoutPrewarmHistory === 'function'
        ? getVisibleTextLayoutPrewarmHistory(options.textPrewarmHistoryLimit ?? 8)
        : null,
      culling: cullingSummary(),
    };
    if (options.details !== false) out.slowFrameDetails = slowFrameDetails(options.detailLimit ?? 3);
    if (options.log !== false) console.log(out);
    return out;
  }

  const dump = () => dumpDebugEvents(events);

  function reset() {
    events.length = 0;
    slowRecords.length = 0;
    for (const key of Object.keys(stats)) stats[key] = 0;
    lastRafAt = 0;
    eventLoopLastTick = performance.now();
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    count,
    max,
    timing,
    frameStart,
    frameEnd,
    recordPanZoom,
    recordFrameSchedule,
    recordMotion,
    report,
    jiggleReport,
    panZoomReport,
    summary,
    frameSummary,
    drawSummary,
    imageHealth,
    imageHealthSummary,
    imageScaleCacheSummary,
    cullingSummary,
    setPerfMode: (modeKey) => (
      typeof setViewportPerfMode === 'function' ? setViewportPerfMode(modeKey) : null
    ),
    perfMode: (modeKey = null) => (
      typeof viewportPerfModeSummary === 'function' ? viewportPerfModeSummary(modeKey) : null
    ),
    transformSummary,
    eventLoopTimeline,
    rawInputTimeline,
    frameScheduleTimeline,
    recordRawInput,
    recordShieldBlock,
    motionSummary,
    motionTimeline,
    panZoomSummary,
    panZoomTimeline,
    wheelSummary,
    wheelTimeline,
    slowFrames,
    slowFrameDetails,
    dump,
    reset,
    isEnabled: () => enabled,
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ viewport: ViewportDebug });

// ─── Manual performance debugger ─────────────────────────────────────────────

// ─── Save debugger ───────────────────────────────────────────────────────────

// ─── Open debugger ───────────────────────────────────────────────────────────

// ─── Export debugger ─────────────────────────────────────────────────────────
