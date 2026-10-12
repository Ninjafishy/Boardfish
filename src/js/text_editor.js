

// This selects the textarea mutation backend, not text layout or sizing behavior.
const TEXT_EDIT_DOM_REPLACE_CHARS = 20000;

const textEditNavigationKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function textEditWordBoundary(value, index, direction) {
  const text = String(value ?? '');
  const position = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, text.length));
  const moveRight = direction === 'right';

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text);
    let part = segments.containing(moveRight ? position : position - 1);
    while (part && !part.isWordLike) {
      part = segments.containing(moveRight ? part.index + part.segment.length : part.index - 1);
    }
    return part ? part.index + (moveRight ? part.segment.length : 0) : moveRight ? text.length : 0;
  }

  const isWordChar = (char) => /[A-Za-z0-9_]/.test(char || '');
  let cursor = position;
  if (moveRight) {
    while (cursor < text.length && !isWordChar(text[cursor])) cursor++;
    while (cursor < text.length && isWordChar(text[cursor])) cursor++;
  } else {
    while (cursor > 0 && !isWordChar(text[cursor - 1])) cursor--;
    while (cursor > 0 && isWordChar(text[cursor - 1])) cursor--;
  }
  return cursor;
}

function textEditProxyValue(proxy) {
  return proxy._boardfishLogicalValue ?? proxy.value;
}

function setTextEditProxyLogicalValue(proxy, value = '', domSynced = true) {
  const text = String(value ?? '');
  proxy._boardfishLogicalValue = text;
  proxy._boardfishDomValueStale = !domSynced;
}

function syncTextEditProxyDomValue(proxy, value = '', selection = null) {
  if (!proxy._boardfishDomValueStale) {
    return;
  }
  const text = String(value ?? '');
  proxy.value = text;
  setTextEditProxyLogicalValue(proxy, text);
  if (selection) {
    const max = text.length;
    const start = Math.max(0, Math.min(Math.trunc(Number(selection.start)) || 0, max));
    const end = Math.max(start, Math.min(Math.trunc(Number(selection.end ?? start)) || start, max));
    proxy.setSelectionRange(start, end, selection.direction || 'none');
  }
}

function setTextEditProxySelectionRange(proxy, start, end = start, direction = 'none', value) {
  const text = value ?? textEditProxyValue(proxy);
  const max = text.length;
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
  const to = Math.max(from, Math.min(Math.trunc(Number(end ?? start)) || from, max));
  if (proxy._boardfishDomValueStale && to > proxy.value.length) syncTextEditProxyDomValue(proxy, text, { start: from, end: to, direction });
  else proxy.setSelectionRange(from, to, direction);
}

const textEditSelectionState = (proxy) => {
  const valueLength = textEditProxyValue(proxy).length;
  const start = Math.max(0, Math.min(proxy.selectionStart, valueLength));
  const end = Math.max(0, Math.min(proxy.selectionEnd, valueLength));
  return {
    start,
    end,
    direction: proxy.selectionDirection || 'none',
    hasSelection: start !== end,
  };
};

const TEXT_EDIT_INDENT = '\t';

const textEditLineStartAt = (value, index) => {
  const text = String(value ?? '');
  const clamped = Math.max(0, Math.min(index ?? 0, text.length));
  if (clamped <= 0) return 0;
  return text.lastIndexOf('\n', clamped - 1) + 1;
};

const textEditLineIndentAt = (value, index) => {
  const text = String(value ?? '');
  const lineStart = textEditLineStartAt(text, index);
  let end = lineStart;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  return text.slice(lineStart, end);
};

const applyTextEditLineIndent = (value, selection, outdent = false) => {
  const text = String(value ?? '');
  const selectionState = {
    start: Math.max(0, Math.min(selection?.start ?? 0, text.length)),
    end: Math.max(0, Math.min(selection?.end ?? selection?.start ?? 0, text.length)),
    direction: selection?.direction || 'none',
  };
  const lastSelectedIndex = selectionState.end > selectionState.start
    ? selectionState.end - 1
    : selectionState.start;
  const firstLineStart = textEditLineStartAt(text, selectionState.start);
  const lastLineStart = textEditLineStartAt(text, lastSelectedIndex);
  if (
    outdent &&
    firstLineStart === lastLineStart &&
    text[firstLineStart] !== TEXT_EDIT_INDENT &&
    text[firstLineStart] !== ' '
  ) return { ...selectionState, value: text, changed: false };

  const newlineAt = text.indexOf('\n', lastLineStart);
  const blockEnd = newlineAt === -1 ? text.length : newlineAt;
  const selectedText = text.slice(firstLineStart, blockEnd);
  let nextStart = selectionState.start;
  let nextEnd = selectionState.end;
  let nextSelectedText;
  if (outdent) {
    nextSelectedText = selectedText.replace(/(^|\n)(\t| {1,4})/g, (_, prefix, indent, offset) => {
      const lineStart = firstLineStart + offset + prefix.length;
      nextStart -= Math.min(indent.length, Math.max(0, selectionState.start - lineStart));
      nextEnd -= Math.min(indent.length, Math.max(0, selectionState.end - lineStart));
      return prefix;
    });
  } else {
    if (selectionState.start >= firstLineStart) nextStart += TEXT_EDIT_INDENT.length;
    if (selectionState.end >= firstLineStart) nextEnd += TEXT_EDIT_INDENT.length;
    nextSelectedText = TEXT_EDIT_INDENT + selectedText.replace(/\n/g, (_, offset) => {
      const lineStart = firstLineStart + offset + 1;
      if (selectionState.start >= lineStart) nextStart += TEXT_EDIT_INDENT.length;
      if (selectionState.end >= lineStart) nextEnd += TEXT_EDIT_INDENT.length;
      return `\n${TEXT_EDIT_INDENT}`;
    });
  }
  if (nextSelectedText === selectedText) return { ...selectionState, value: text, changed: false };

  return {
    value: text.slice(0, firstLineStart) + nextSelectedText + text.slice(blockEnd),
    start: nextStart,
    end: nextEnd,
    direction: selectionState.direction,
    changed: true,
  };
};

const applyTextEditLineBreakIndent = (value, selection) => {
  const text = String(value ?? '');
  const selectionState = {
    start: Math.max(0, Math.min(selection?.start ?? 0, text.length)),
    end: Math.max(0, Math.min(selection?.end ?? selection?.start ?? 0, text.length)),
  };
  const start = Math.min(selectionState.start, selectionState.end);
  const end = Math.max(selectionState.start, selectionState.end);
  const insert = '\n' + textEditLineIndentAt(text, start);
  const nextValue = text.slice(0, start) + insert + text.slice(end);
  const nextCaret = start + insert.length;
  return {
    value: nextValue,
    start: nextCaret,
    end: nextCaret,
    direction: 'none',
  };
};

const textEditInputReplacement = (oldText = '', nextText = '', inputState = {}, inputType = '') => {
  const baseStart = Math.max(0, Math.min(inputState.start ?? 0, oldText.length));
  const baseEnd = Math.max(baseStart, Math.min(inputState.end ?? baseStart, oldText.length));
  const selectedLength = baseEnd - baseStart;
  const type = inputType;

  if (!selectedLength && type.startsWith('delete')) {
    const removedLength = Math.max(0, oldText.length - nextText.length);
    if (removedLength > 0) {
      if (type.includes('Backward')) {
        return {
          start: Math.max(0, baseStart - removedLength),
          end: baseStart,
          insertedText: '',
        };
      }
      return {
        start: baseStart,
        end: Math.min(oldText.length, baseStart + removedLength),
        insertedText: '',
      };
    }
  }

  const insertedLength = Math.max(0, nextText.length - (oldText.length - selectedLength));
  return {
    start: baseStart,
    end: baseEnd,
    insertedText: nextText.slice(baseStart, baseStart + insertedLength),
  };
};

const textEditBeforeInputReplacement = (text = '', selection = {}, event = null) => {
  const start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(start, Math.min(selection.end ?? start, text.length));
  const inputType = String(event?.inputType || '');
  if (inputType === 'insertText' || inputType === 'insertCompositionText') {
    return { start, end, insertedText: String(event?.data ?? '') };
  }
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
    return { start, end, insertedText: '\n' };
  }
  if (inputType.startsWith('delete')) {
    if (start !== end) return { start, end, insertedText: '' };
    const blankLineRange = textEditBlankLineDeleteRange(text, start, inputType);
    if (blankLineRange) return blankLineRange;
    if (inputType.includes('Backward')) return { start: Math.max(0, start - 1), end: start, insertedText: '' };
    if (inputType.includes('Forward')) return { start, end: Math.min(text.length, end + 1), insertedText: '' };
  }
  return null;
};

const textEditBlankLineDeleteRange = (text = '', index, keyOrInputType = '') => {
  const pos = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, text.length));
  const backward = keyOrInputType === 'Backspace' || keyOrInputType.includes('Backward');
  if (backward ? pos > 0 && !' \t\n'.includes(text[pos - 1]) : !' \t\n'.includes(text[pos] || '\n')) return null;
  // Intentional: do not replace with textEditLineStartAt(). At pos 0 with an
  // empty first line this yields start 1, so Backspace there does nothing
  // instead of deleting that line. Keep this behavior.
  const before = text.lastIndexOf('\n', Math.max(0, pos - 1));
  const start = before < 0 ? 0 : before + 1;
  const after = text.indexOf('\n', pos);
  const end = after < 0 ? text.length : after;
  if (!/^[ \t]*$/.test(text.slice(start, end))) return null;
  if (backward && pos > start) return { start: pos - 1, end: pos, insertedText: '' };
  if (!backward && end < text.length) return { start, end: end + 1, insertedText: '' };
  if (start > 0) return { start: start - 1, end, insertedText: '' };
  if (end < text.length) return { start, end: end + 1, insertedText: '' };
  return null;
};

const dispatchTextEditInputEvent = (proxy, inputType) => {
  let event;
  try {
    event = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, inputType })
      : new Event('input', { bubbles: true });
  } catch {
    event = document.createEvent('Event');
    event.initEvent('input', true, false);
  }
  if (event && !event.inputType) {
    try { Object.defineProperty(event, 'inputType', { value: inputType }); } catch {}
  }
  proxy.dispatchEvent(event);
};

const syncFreshTextEditWidth = (obj) => {
  if (obj._editStartContent !== '') return false;
  const width = getTextRenderedContentWidth(obj);
  if (!Number.isFinite(width) || width <= obj.w) return false;
  obj.w = width;
  clearTextObjectLayoutRuntime(obj);
  return true;
};

const exactTextEditLineCountForHeight = (height) => {
  const lines = (Number(height) - TEXT_PAD * 2) / LINE_H;
  if (!Number.isFinite(lines) || lines <= 0) return 0;
  const rounded = Math.round(lines);
  return Math.abs(lines - rounded) < 1e-6 ? Math.max(1, rounded) : 0;
};

const textEditMinLinesForSession = (obj, preserveSize = false) => {
  if (!preserveSize) return 1;
  const currentLines = exactTextEditLineCountForHeight(obj.h);
  return currentLines > 1 ? currentLines : 1;
};

const setTextEditMinLinesForSession = (obj, preserveSize = false) => {
  const minLines = textEditMinLinesForSession(obj, preserveSize);
  obj._editMinLines = minLines;
  if (preserveSize && minLines > 1) {
    obj._textEditPreservedMinLines = minLines;
  } else {
    delete obj._textEditPreservedMinLines;
  }
};

const resetTextEditPreservedMinLines = (obj) => {
  if (!obj || obj.type !== 'text' || !obj._textEditPreservedMinLines) return false;
  obj._editMinLines = 1;
  delete obj._textEditPreservedMinLines;
  return true;
};

const resetTextEditNavigation = (obj) => {
  delete obj._textEditNavigationSelection;
};

const setTextEditCaretIndex = (obj, index, lineStartIndex = null, clearLineStartIndex = false, preserveNavigation = false) => {
  if (!obj) return;
  if (!preserveNavigation) resetTextEditNavigation(obj);
  const length = (obj.data?.content || '').length;
  const nextIndex = Math.max(0, Math.min(Math.trunc(index ?? 0), length));
  if (obj._textEditCaretIndex !== nextIndex || clearLineStartIndex) {
    delete obj._textEditCaretLineStartIndex;
  }
  obj._textEditCaretIndex = nextIndex;
  if (Number.isFinite(lineStartIndex)) {
    obj._textEditCaretLineStartIndex = Math.max(0, Math.min(Math.trunc(lineStartIndex), length));
  }
};

const clearTextEditCaretIndex = (obj) => {
  if (!obj) return;
  resetTextEditNavigation(obj);
  delete obj._textEditCaretIndex;
  delete obj._textEditCaretLineStartIndex;
};

// A soft wrap has two visual positions for the same text index. Choose the
// side approached by an arrow.
const textEditCaretLineAtIndex = (layout, index, affinity) => {
  if (!layout.length) return -1;
  let lo = 0, hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const line = layout[mid];
    const end = line.caretEndIndex ?? line.endIndex ?? (line.startIndex + line.text.length);
    if (index <= end) hi = mid;
    else lo = mid + 1;
  }
  let result = lo;
  // Crossing consumed wrap whitespace reaches the next row's beginning. A
  // hard word wrap, in contrast, still has a caret at the preceding row's end.
  const line = layout[lo];
  const visibleEnd = line.endIndex ?? (line.startIndex + line.text.length);
  if (index > visibleEnd && layout[lo + 1]?.startIndex === index) result = lo + 1;
  if (affinity === 'forward') {
    while (lo < layout.length && layout[lo].startIndex <= index) result = lo++;
  }
  return result;
};

const rememberTextEditNavigationSelection = (obj, proxy, index, lineStartIndex) => {
  setTextEditCaretIndex(obj, index, lineStartIndex, true, true);
  obj._textEditNavigationSelection = {
    start: proxy.selectionStart,
    end: proxy.selectionEnd,
    direction: proxy.selectionDirection || 'none',
  };
};

const applyTextEditNavigationSelection = (obj, proxy, selection, index, lineStartIndex, extend) => {
  const anchor = selection.direction === 'backward' ? selection.end : selection.start;
  if (extend) {
    setTextEditProxySelectionRange(proxy, Math.min(anchor, index), Math.max(anchor, index),
      index < anchor ? 'backward' : 'forward');
  } else {
    setTextEditProxySelectionRange(proxy, index, index, 'none');
  }
  if (obj) rememberTextEditNavigationSelection(obj, proxy, index, lineStartIndex);
};

const textEditVisibleSelectionReplacementRange = (content, selection = {}) => {
  const length = String(content ?? '').length;
  const first = Math.max(0, Math.min(Math.trunc(Number(selection.start)) || 0, length));
  const second = Math.max(0, Math.min(Math.trunc(Number(selection.end ?? first)) || 0, length));
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  return { start, end };
};

const createTextSelectionClipboardPayload = (value, selection = {}) => {
  const content = String(value ?? '');
  const range = textEditVisibleSelectionReplacementRange(content, selection);
  return {
    type: 'text-selection',
    text: textSelectionForClipboard(content.slice(range.start, range.end)),
  };
};

const textSelectionPayloadFromBoardfishClipboardValue = (clipboard) => {
  if (!clipboard) return null;
  if (clipboard.type === 'text-selection') {
    return { type: 'text-selection', text: textSelectionForClipboard(clipboard.text) };
  }
  const source = clipboard.objects?.length === 1 ? clipboard.objects[0] : null;
  if (source?.type !== 'text') return null;
  const content = String(source.data?.content ?? '');
  return createTextSelectionClipboardPayload(content, { start: 0, end: content.length });
};

const currentBoardfishTextSelectionClipboardPayload = () => (
  textSelectionPayloadFromBoardfishClipboardValue(jsClipboard)
);

const copyTextEditSelectionFromProxy = async (
  id,
  proxy,
  selection = textEditSelectionState(proxy),
  options = {},
) => {
  if (!selection?.hasSelection) return false;
  const sourceValue = textEditProxyValue(proxy);

  const clipboardText = createTextSelectionClipboardPayload(sourceValue, selection).text;

  if (clipboardText) {
    setJsClipboard({
      type: 'text-selection',
      text: clipboardText,
    });
  } else {
    clearJsClipboard();
  }
  const shouldAnimateCopy = options.animateCopy !== false && editingId === id && _editEl === proxy;
  const meta = {};
  const webToken = getJsClipboardWebToken();
  if (webToken) meta.boardfishToken = webToken;

  const writePromise = BoardfishClipboardIO.copyTextToClipboard(clipboardText, meta);
  writePromise
    .then((result) => {
      if (result?.boardfishTokenWritten && meta.boardfishToken) {
        markJsClipboardWebTokenWritten(meta.boardfishToken);
      }
      // A large text write can occupy the main thread; start jiggle only once it settles.
      if (shouldAnimateCopy && editingId === id && _editEl === proxy) {
        BoardfishMotion.applyCopyFeedback({
          textSelection: {
            id,
            ...selection,
          },
        });
      }
    })
    .catch(() => {});

  return true;
};

const boardfishTextClipboardStillCurrent = async (event = null) => {
  let webClipboardTokenChecked = false;
  let webClipboardToken = '';

  if (
    event?.clipboardData
  ) {
    webClipboardTokenChecked = true;
    webClipboardToken = BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(event.clipboardData);
  } else if (_jsClipboardWebMaybeStale) {
    try {
      const result = await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser();
      webClipboardTokenChecked = result?.checked === true;
      webClipboardToken = result?.token || '';
    } catch {}
  }

  const currentOptions = { webClipboardTokenChecked, webClipboardToken };
  return jsClipboardStillCurrent(currentOptions);
};

const readBoardfishTextClipboardPayloadForPaste = async (event = null) => {
  const payload = currentBoardfishTextSelectionClipboardPayload();
  if (!payload) return null;

  const current = await boardfishTextClipboardStillCurrent(event);
  if (!current) {
    clearJsClipboard();

    return null;
  }
  return currentBoardfishTextSelectionClipboardPayload();
};

const replaceTextEditProxyRange = (proxy, text, start, end, selectionMode = 'end', deferDomValue = false) => {
  const value = textEditProxyValue(proxy);
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, value.length));
  const to = Math.max(from, Math.min(Math.trunc(Number(end)) || from, value.length));
  const inserted = normalizeTextContent(text);
  const nextLength = value.length + inserted.length - (to - from);
  const largeValue = value.length + inserted.length > TEXT_EDIT_DOM_REPLACE_CHARS;
  deferDomValue = deferDomValue && nextLength > TEXT_EDIT_DOM_REPLACE_CHARS;
  if (largeValue) {
    const nextValue = `${value.slice(0, from)}${inserted}${value.slice(to)}`;

    const caret = selectionMode === 'start' ? from : from + inserted.length;

    if (!deferDomValue) proxy.value = nextValue;
    setTextEditProxyLogicalValue(proxy, nextValue, !deferDomValue);

    proxy.setSelectionRange(caret, caret, 'none');

    return;
  }

    syncTextEditProxyDomValue(proxy, value);
  proxy.setRangeText(inserted, from, to, selectionMode);
  setTextEditProxyLogicalValue(proxy, proxy.value);
};

const canApplyTextEditReplacement = (obj, value, start, end, text) => {
  const nextValue = value.slice(0, start) + text + value.slice(end);
  return BoardfishWebLimits.canReplaceText(obj, nextValue);
};

const synchronousBoardfishClipboardTokenFromPasteEvent = (event) => {
  if (!event?.clipboardData) return '';
  return BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(event.clipboardData);
};

const boardfishPasteEventMatchesCurrentTextSelectionClipboard = (event) => {
  const eventToken = synchronousBoardfishClipboardTokenFromPasteEvent(event);
  const currentToken = getJsClipboardWebToken();
  return !!eventToken && !!currentToken && eventToken === currentToken;
};

const tryNativeTextEditPaste = (id, proxy, readText, options = {}) => {
  const obj = objectsMap.get(id);
  if (!obj) return false;
  const { selection } = options;
  if (selection.hasSelection) return false;

  const inputType = 'insertFromPaste';
  const currentProxyValue = textEditProxyValue(proxy);
  if (proxy._boardfishDomValueStale || proxy.value !== currentProxyValue) return false;
  const text = readText();
  if (!text) return false;
  if (!canApplyTextEditReplacement(obj, currentProxyValue, selection.start, selection.end, text)) {
    options.event.preventDefault();
    return true;
  }
  const inputState = {
    ...selection,
    value: currentProxyValue,
    inputType,
    replacement: {
      start: selection.start,
      end: selection.end,
      insertedText: text,
    },
    nativePasteHandled: true,
  };

  beginTextEditHistoryAction(id, inputState);
  proxy?._boardfishSetPendingInputState?.(inputState);
  return true;
};

const tryNativeBoardfishTextSelectionPaste = (id, proxy, payload, options = {}) =>
  tryNativeTextEditPaste(id, proxy, () => {
    if (!boardfishPasteEventMatchesCurrentTextSelectionClipboard(options.event)) return '';
    const text = textForTextObjectPaste(payload.text || '');
    return normalizeTextContent(options.fallbackText || '') === text ? text : '';
  }, options);

const tryNativeExternalTextPaste = (id, proxy, text, options = {}) =>
  tryNativeTextEditPaste(id, proxy, () => {
    const rawPastedText = normalizeTextContent(text);
    const pastedText = textForTextObjectPaste(rawPastedText);
    return pastedText === rawPastedText ? pastedText : '';
  }, options);

const replaceTextEditSelectionWithPayload = (id, proxy, payload, options = {}) => {
  if (!proxy) return false;

  const currentProxyValue = textEditProxyValue(proxy);

  const text = textForTextObjectPaste(payload.text || '');

  if (!text) {
    return false;
  }
  const obj = objectsMap.get(id);
  if (!obj) {
    return false;
  }
  let selection = options.selection || textEditSelectionState(proxy);
  const replacementRange = selection.hasSelection
    ? textEditVisibleSelectionReplacementRange(obj.data?.content, selection)
    : selection;
  if (!canApplyTextEditReplacement(obj, currentProxyValue, replacementRange.start, replacementRange.end, text)) {
    options.limitRejected = true;
    return false;
  }
  const inputType = 'insertFromPaste';

  const inputState = {
    ...selection,
    value: currentProxyValue,
    inputType,
    replacement: {
      start: replacementRange.start,
      end: replacementRange.end,
      insertedText: text,
    },
  };

  beginTextEditHistoryAction(id, inputState);

  proxy?._boardfishSetPendingInputState?.(inputState);

    replaceTextEditProxyRange(proxy, text, replacementRange.start, replacementRange.end, 'end');

  _caretVisible = true;

  dispatchTextEditInputEvent(proxy, inputType);

  return true;
};

const pasteBoardfishTextSelectionIntoEditSelection = async (options = {}) => {
  const proxy = options.proxy || _editEl;
  const id = options.id || editingId;

  const payload = await readBoardfishTextClipboardPayloadForPaste(options.event || null);
  if (!payload) return false;

  const pasteOptions = {
    selection: options.selection,
  };

  const pasted = replaceTextEditSelectionWithPayload(id, proxy, payload, pasteOptions);
  options.limitRejected = pasteOptions.limitRejected === true;
  return pasted;
};

function enterEdit(id, {
  history = true,
  preserveSize = false,
  placeInitialCaret = true,
} = {}) {
  if (editingId === id) return;
  if (editingId) exitEdit();

  const obj = objectsMap.get(id);
  if (!obj) return;
  editingId = id;
  invalidateOffscreen();

  obj._editStartContent = obj.data.content;
  setTextEditMinLinesForSession(obj, preserveSize);
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;

  const proxy = document.createElement('textarea');
  proxy.wrap = 'off';
  proxy.spellcheck = false;
  proxy.tabIndex = -1;
  proxy.setAttribute('autocomplete', 'off');
  proxy.setAttribute('autocorrect', 'off');
  proxy.setAttribute('autocapitalize', 'off');
  proxy.setAttribute('aria-label', 'Boardfish text editor');
  proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;overflow:hidden;white-space:pre;contain:strict;transform:translate(-100vw,-100vh)';
  proxy.value = obj.data.content;
  setTextEditProxyLogicalValue(proxy, obj.data.content);
  document.body.appendChild(proxy);
  _editEl = proxy;

  let pendingInputState = null;
  proxy._boardfishSetPendingInputState = (state) => { pendingInputState = state; };

  proxy.addEventListener('beforeinput', (event) => {
    resetTextEditNavigation(obj);
    if (pendingInputState?.nativePasteHandled && event?.inputType === 'insertFromPaste') {
      return;
    }
    const selection = textEditSelectionState(proxy);
    const currentProxyValue = textEditProxyValue(proxy);
    const nativeReplacement = textEditBeforeInputReplacement(currentProxyValue, selection, event);
    if (event.cancelable !== false && nativeReplacement && !canApplyTextEditReplacement(obj, currentProxyValue,
      nativeReplacement.start, nativeReplacement.end, nativeReplacement.insertedText)) {
      event.preventDefault();
      pendingInputState = null;
      return;
    }
    pendingInputState = {
      ...selection,
      value: currentProxyValue,
      inputType: event?.inputType || '',
    };
    if (nativeReplacement) pendingInputState.replacement = nativeReplacement;

      syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
    beginTextEditHistoryAction(id, pendingInputState);
  });
	  proxy.addEventListener('input', (event) => {
	    const inputState = pendingInputState || textEditSelectionState(proxy);
	    const inputType = event?.inputType || inputState.inputType || '';

    pendingInputState = null;
	    const oldValue = inputState.value ?? obj.data.content ?? '';
	    let replacement = inputState.replacement || null;
	    let synthesizedStaleReplacement = false;
	    let nextRawValue = '';
	    if (proxy._boardfishDomValueStale && !replacement) {
	      replacement = textEditBeforeInputReplacement(oldValue, inputState, event);
	      synthesizedStaleReplacement = !!replacement;
	    }
	    if (proxy._boardfishDomValueStale && replacement) {
	      const replacementStart = Math.max(0, Math.min(replacement.start ?? 0, oldValue.length));
	      const replacementEnd = Math.max(replacementStart, Math.min(replacement.end ?? replacementStart, oldValue.length));
	      nextRawValue = normalizeTextContent(
	        oldValue.slice(0, replacementStart) +
	        String(replacement.insertedText ?? '') +
	        oldValue.slice(replacementEnd)
	      );
	    } else {
	      nextRawValue = proxy.value;
	      replacement = replacement || textEditInputReplacement(oldValue, nextRawValue, inputState, inputType);
	    }

    if (!BoardfishWebLimits.canReplaceText(obj, nextRawValue)) {
      proxy.value = oldValue;
      setTextEditProxyLogicalValue(proxy, oldValue);
      proxy.setSelectionRange(inputState.start ?? replacement.start,
        inputState.end ?? replacement.end, inputState.direction || 'none');
      return;
    }
	    obj.data.content = nextRawValue;
	    markDirty(obj);

	    if (proxy._boardfishDomValueStale) {
	      if (synthesizedStaleReplacement) {
	        const caret = Math.max(0, Math.min(
	          (replacement.start ?? 0) + String(replacement.insertedText ?? '').length,
	          obj.data.content.length
	        ));
	        syncTextEditProxyDomValue(proxy, obj.data.content, {
	          start: caret,
	          end: caret,
	          direction: 'none',
	        });
	      } else {
	        setTextEditProxyLogicalValue(proxy, obj.data.content, false);
	      }
	    } else {
	      setTextEditProxyLogicalValue(proxy, obj.data.content);
	    }

    const selectionStart = proxy.selectionStart;
    const selectionEnd = proxy.selectionEnd;
    if (selectionStart === selectionEnd) setTextEditCaretIndex(obj, selectionStart, null, true);
    else clearTextEditCaretIndex(obj);

    const layoutPatched = patchTextObjectLayoutAfterInput(obj, {
      oldContent: oldValue,
      newContent: obj.data.content,
      start: replacement.start,
      end: replacement.end,
      insertedText: replacement.insertedText,
    });
    if (!layoutPatched) clearTextObjectLayoutRuntime(obj);

      resetTextEditPreservedMinLines(obj);

    // The exact line count reuses the patched layout or builds the wrapped-row
    // index that rendering needs, keeping bounds current for every edit.
    const heightChanged = syncTextAutoHeight(obj, getTextMinLines(obj));

    _textInputSelectionHistorySuppress = textEditSelectionState(proxy);

      recordTextEditInputHistory(id, inputType, !!inputState.hasSelection);

    scheduleRender(true, heightChanged);
  });
  proxy.addEventListener('paste', (event) => {
    const eventSelection = textEditSelectionState(proxy);

    const candidate = currentBoardfishTextSelectionClipboardPayload();
    const fallbackText = BoardfishClipboardIO.readClipboardTextFromEvent(event.clipboardData) || '';

    if (!candidate && !fallbackText) {
      return;
    }
    const selection = eventSelection;
    if (candidate) {
      const nativePasteOptions = {
        event,
        selection,
        fallbackText,
      };

      const nativePaste = tryNativeBoardfishTextSelectionPaste(id, proxy, candidate, nativePasteOptions);
      if (nativePaste) return;
    }
    if (fallbackText) {
      const nativeExternalOptions = {
        event,
        selection,
      };

      const nativeExternalPaste = tryNativeExternalTextPaste(id, proxy, fallbackText, nativeExternalOptions);
      if (nativeExternalPaste) return;
    }
    event.preventDefault();
    const pasteEventText = () => {
      const replaceOptions = { selection };

      replaceTextEditSelectionWithPayload(id, proxy, { text: fallbackText }, replaceOptions);
    };
    if (!candidate) {
      pasteEventText();
      return;
    }
    const pasteOptions = {
      id,
      proxy,
      event,
      selection,
    };

    pasteBoardfishTextSelectionIntoEditSelection(pasteOptions).then((pasted) => {
      if (pasted || pasteOptions.limitRejected || !fallbackText) {
        return;
      }

      pasteEventText();
    }).catch(() => {
      if (!fallbackText) {
        return;
      }
      pasteEventText();
    });
  });
  proxy.addEventListener('blur', flushEditHistoryCheckpoint);
  proxy.addEventListener('keydown', (e) => {
    resetTextEditNavigation(obj);
    const wakeCaret = !_caretVisible;
    _caretVisible = true;

    const isIndentKey = e.key === 'Tab';
    if ((isIndentKey || (e.key === 'Enter' && !e.isComposing)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      const result = isIndentKey
        ? applyTextEditLineIndent(currentProxyValue, selection, e.shiftKey)
        : applyTextEditLineBreakIndent(currentProxyValue, selection);
      if (isIndentKey && !result.changed) {
        if (wakeCaret) scheduleRender(true, false);
        return;
      }
      if (!BoardfishWebLimits.canReplaceText(obj, result.value)) return;
      const inputType = isIndentKey
        ? (e.shiftKey ? 'deleteContentBackward' : 'insertText')
        : 'insertLineBreak';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState);
      proxy.value = result.value;
      setTextEditProxyLogicalValue(proxy, result.value);
      proxy.setSelectionRange(result.start, result.end, result.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    const shortcutKey = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase();
    const cut = shortcutKey === 'x';
    if ((cut || shortcutKey === 'c') && proxy.selectionStart !== proxy.selectionEnd) {
      e.preventDefault();
      const selection = textEditSelectionState(proxy);
      if (cut) BoardfishMotion.cancelTextSelectionMotion(id);
      copyTextEditSelectionFromProxy(id, proxy, selection, { animateCopy: !cut });
      if (!cut) return;
      const inputType = 'deleteByCut';
      pendingInputState = {
        ...selection,
        value: textEditProxyValue(proxy),
        inputType,
        replacement: {
          start: selection.start,
          end: selection.end,
          insertedText: '',
        },
      };
      beginTextEditHistoryAction(id, pendingInputState);
      proxy.setRangeText('', selection.start, selection.end, 'start');
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if (shortcutKey === 'a') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const currentProxyValue = textEditProxyValue(proxy);
      setTextEditProxySelectionRange(proxy, 0, currentProxyValue.length, 'none', currentProxyValue);

      scheduleRender(true, false);
      return;
    }

    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing
    ) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
      const moveRight = e.key === 'ArrowRight';
      const nextPosition = textEditWordBoundary(
        currentProxyValue,
        (e.shiftKey ? selection.direction === 'backward' : !moveRight) ? selection.start : selection.end,
        moveRight ? 'right' : 'left',
      );
      const layout = getTextLayout(obj);
      const lineIndex = textEditCaretLineAtIndex(layout, nextPosition, moveRight ? 'backward' : 'forward');
      applyTextEditNavigationSelection(obj, proxy, selection, nextPosition,
        layout[lineIndex]?.startIndex, e.shiftKey);
      scheduleRender(true, false);
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const selection = textEditSelectionState(proxy);
      let deletion;

      if (selection.hasSelection) {
        deletion = { start: selection.start, end: selection.end };
      } else {
        deletion = textEditBlankLineDeleteRange(textEditProxyValue(proxy), selection.start, e.key);
      }
      if (deletion && deletion.end > deletion.start) {
        e.preventDefault();
        const inputType = e.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';

        const replacement = { start: deletion.start, end: deletion.end, insertedText: '' };

        pendingInputState = {
          ...selection,
          value: textEditProxyValue(proxy),
          inputType,
          replacement,
        };

        beginTextEditHistoryAction(id, pendingInputState);

          replaceTextEditProxyRange(
            proxy, replacement.insertedText, replacement.start, replacement.end, 'start', true,
          );

        dispatchTextEditInputEvent(proxy, inputType);

        return;
      }
    }

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const layout = getTextLayout(obj);
      if (!layout.length) { scheduleRender(true, false); return; }

      const isUp = e.key === 'ArrowUp';
      const selection = textEditSelectionState(proxy);

      // Which end of the selection to navigate from
      const refPos = (e.shiftKey ? selection.direction === 'backward' : isUp) ? selection.start : selection.end;

      // Find the line containing refPos
      let lo = 0, hi = layout.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1, ln = layout[mid];
        if (refPos <= (ln.caretEndIndex ?? ln.endIndex ?? (ln.startIndex + ln.text.length))) hi = mid; else lo = mid + 1;
      }
      const refLineIdx = lo;
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = Math.min(refPos - refLine.startIndex, refLine.text.length);
      const caretX = lineCaretXAtOffset(refLine, obj, off);

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = textEditProxyValue(proxy).length;
      } else {
        newPos = layoutHitTestCaret([layout[targetIdx]], caretX, layout[targetIdx].y, obj).index;
      }

      applyTextEditNavigationSelection(null, proxy, selection, newPos, null, e.shiftKey);
      scheduleRender(true, false);
      return;
    }

    if (textEditNavigationKeys.has(e.key)) flushEditHistoryCheckpoint();
    if (wakeCaret) scheduleRender(true, false);
  });

  let _prevSelStart = -1, _prevSelEnd = -1;
  _selChangeListener = () => {
    if (document.activeElement !== proxy) return;
    let s = proxy.selectionStart, e = proxy.selectionEnd;
    const suppressed = _textInputSelectionHistorySuppress;
    if (typeof suppressed?.hasSelection === 'boolean' && suppressed.start === s && suppressed.end === e) {
      _textInputSelectionHistorySuppress = null;
      _prevSelStart = s; _prevSelEnd = e; _caretVisible = true;
      return;
    }
    const currentObj = objectsMap.get(id);
    if (s === _prevSelStart && e === _prevSelEnd && _caretVisible) return;
    _prevSelStart = s; _prevSelEnd = e;
    _textInputSelectionHistorySuppress = null;
    if (!suppressed || suppressed.start !== s || suppressed.end !== e) flushEditHistoryCheckpoint();

    _caretVisible = true;
    if (currentObj) {
      const navigation = currentObj._textEditNavigationSelection;
      const direction = proxy.selectionDirection || 'none';
      if (!navigation || navigation.start !== s || navigation.end !== e || navigation.direction !== direction) {
        if (s === e) setTextEditCaretIndex(currentObj, s);
        else clearTextEditCaretIndex(currentObj);
      }
    }
    scheduleRender(true, false);
  };
  document.addEventListener('selectionchange', _selChangeListener);

  _caretVisible = true;
  _caretBlinkInterval = setInterval(() => {
    if (!editingId) return;
    const hasSelection = proxy.selectionStart !== proxy.selectionEnd;
    if (hasSelection) { _caretVisible = true; return; }
    _caretVisible = !_caretVisible;
    scheduleRender(true, false);
  }, 500);

  if (placeInitialCaret) {
    proxy.focus({ preventScroll: true });
    proxy.setSelectionRange(proxy.value.length, proxy.value.length);
    setTextEditCaretIndex(obj, proxy.value.length);
  }

  if (history) {
    pushHistory('text-edit-enter');
  }
  scheduleRender(true, true);
}

function exitEdit() {
  if (!editingId) return;

  const id = editingId;
  const proxy = _editEl;

  editingId = null;
  _editEl = null;

  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;

  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
  }

  if (proxy) proxy.remove();

  const obj = objectsMap.get(id);
  if (obj) {
    if (isTextContentEmpty(obj.data.content)) {
      BoardfishEditorState.removeObjectsById([id]);
      delete obj._editStartContent;
      delete obj._editMinLines;
      clearTextEditCaretIndex(obj);
      _editHistoryLastContent = null;
      _editHistoryActionStartState = null;
      scheduleRender(true, true);

      pushHistory('delete-empty-text');

      return;
    }
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    const startedEmpty = obj._editStartContent === '';

    const needsExitSizeSync = contentChanged || startedEmpty;

    let widthChanged = false;
    let heightChanged = false;
    if (needsExitSizeSync) {
      widthChanged = syncFreshTextEditWidth(obj);

      heightChanged = syncTextAutoHeight(obj);

      if (widthChanged || heightChanged) {
        markDirty(obj);
      }
    }

    pushEditHistoryIfChanged(id);

    if ((widthChanged || heightChanged) && !contentChanged) {
      pushHistory('text-height-change');
    }
    delete obj._editStartContent;
    delete obj._editMinLines;
    clearTextEditCaretIndex(obj);
  }

  _editHistoryLastContent = null;
  _editHistoryActionStartState = null;

  scheduleRender(true, true);

  window.getSelection()?.removeAllRanges();
}
