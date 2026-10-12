'use strict';

const { readSource, runScript, plain } = require('../test-support/source.js');
const test = require('node:test');
const assert = require('node:assert/strict');

function cloneObject(obj, runtimeTextCache = false) {
  const cloned = plain(obj);
  if (obj?.type !== 'text') return cloned;
  if (runtimeTextCache) return cloned;
  clearTextRuntimeCache(cloned);
  return cloned;
}

function clearTextRuntimeCache(obj) {
  if (obj?.type !== 'text') return;
  delete obj._layoutCache;
  delete obj._layoutCacheContent;
  delete obj._layoutCacheW;
  delete obj._layoutCacheY;
}

function cloneTextObjectRuntimeCaches(source, target) {
  if (!source || !target || source.type !== 'text' || target.type !== 'text') return;
  const content = String(target.data?.content ?? '').replace(/\r\n?/g, '\n');
  if (
    Array.isArray(source._layoutCache) &&
    source._layoutCacheContent === content &&
    source._layoutCacheW === target.w
  ) {
    target._layoutCache = source._layoutCache.map((line) => ({ ...line }));
    target._layoutCacheContent = source._layoutCacheContent;
    target._layoutCacheW = source._layoutCacheW;
    target._layoutCacheY = target.y;
  }
}

function makeEditProxy({
  value = '',
  selectionStart = 0,
  selectionEnd = selectionStart,
  selectionDirection = 'none',
} = {}) {
  return {
    value,
    selectionStart,
    selectionEnd,
    selectionDirection,
    _boardfishLogicalValue: value,
    _boardfishDomValueStale: false,
    _boardfishSetLogicalValue(nextValue, domSynced = true) {
      this._boardfishLogicalValue = String(nextValue ?? '');
      this._boardfishDomValueStale = domSynced === false || this.value !== this._boardfishLogicalValue;
    },
    remove() {},
    focus() {},
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
  };
}

function loadHistoryHarness() {
  const imagePruneCalls = [];
  const context = {
    clearInterval() {},
    clearTimeout() {},
    document: {
      addEventListener() {},
      removeEventListener() {},
    },
    jsClipboard: null,
    _jsClipboardToken: 0,
    objects: [],
    objectsMap: new Map(),
    selectedIds: new Set(),
    editingId: null,
    _dirtyIds: new Set(),
    _caretBlinkInterval: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: null,
    _editHistoryActionStartState: null,
    _textInputSelectionHistorySuppress: null,
    _selChangeListener: null,
    _editEl: null,
    imagePruneCalls,
    BoardfishEditorState: {
      replaceBoardObjects(nextObjects) {
        context.objects = nextObjects;
        context.objectsMap = new Map(nextObjects.map((obj) => [obj.id, obj]));
        return nextObjects;
      },
      setSelection(ids = []) {
        context.selectedIds.clear();
        for (const id of ids) {
          if (!context.objectsMap.has(id)) continue;
          context.selectedIds.add(id);
        }
        return context.selectedIds.size;
      },
    },

    cloneObject,
    cloneObjects(list, runtimeTextCache = false) {
      return list.map((obj) => cloneObject(obj, runtimeTextCache));
    },
    cloneTextObjectRuntimeCaches,
    textEditProxyValue(proxy) { return proxy._boardfishLogicalValue ?? proxy.value; },
    setTextEditProxyLogicalValue(proxy, value = '', domSynced = true) {
      proxy._boardfishLogicalValue = String(value ?? '');
      proxy._boardfishDomValueStale = !domSynced;
    },
    flushEditHistoryCheckpoint() { return false; },
    invalidateOffscreen() {},
    markDirty(id) {
      context._dirtyIds.add(id);
    },
    pruneImageCachesToKeys(retainedKeys) {
      imagePruneCalls.push([...retainedKeys].sort());
      return null;
    },
    scheduleRender() {},
    setTextEditMinLinesForSession(obj) { obj._editMinLines = 1; },
    enterEdit(id, options = {}) {
      context.editingId = id;
      const obj = context.objectsMap.get(id);
      if (obj && !options.preserveSize) obj.h = 32;
      context._editEl = makeEditProxy({
        value: obj?.data?.content || '',
        selectionStart: 0,
        selectionEnd: 0,
        selectionDirection: 'none',
      });
    },
  };

  runScript(
    readSource('src/js/history_state.js'),
    context,
    { filename: 'history_state.js' },
  );
  return context;
}

function loadTextEditHistoryStateHarness() {
  const source = readSource('src/js/selection_input.js');
  const start = source.indexOf('const normalizeTextEditHistoryState');
  const context = {
    editingId: 'text-1',
    objectsMap: new Map(),
    _editEl: null,
    _editHistoryTimer: null,
    _editHistoryActionStartState: null,
    textEditProxyValue(proxy) {
      if (typeof proxy?._boardfishLogicalValue === 'string') return proxy._boardfishLogicalValue;
      return String(proxy?.value ?? '');
    },
  };
  runScript(
    source.slice(start) +
      '\nglobalThis.normalizeTextEditHistoryState = normalizeTextEditHistoryState;\n' +
      'globalThis.beginTextEditHistoryAction = beginTextEditHistoryAction;\n',
    context,
    { filename: 'selection_input_history_state_slice.js' },
  );
  return context;
}

test('text edit history state clamps against logical proxy length when DOM is stale', () => {
  const context = loadTextEditHistoryStateHarness();
  const obj = { id: 'text-1', type: 'text', data: { content: '0123456789' } };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({ value: '0123', selectionStart: 4, selectionEnd: 4 });
  context._editEl._boardfishSetLogicalValue(obj.data.content, false);

  const normalized = context.normalizeTextEditHistoryState(obj.id, {
    start: 0,
    end: obj.data.content.length,
    direction: 'forward',
  });

  assert.equal(normalized.selectionStart, 0);
  assert.equal(normalized.selectionEnd, obj.data.content.length);
  assert.equal(normalized.selectionDirection, 'forward');
});

function setBoard(context, objects, selectedIds = []) {
  context.objects = objects.map(cloneObject);
  context.objectsMap = new Map(context.objects.map((obj) => [obj.id, obj]));
  context.selectedIds = new Set(selectedIds);
}

const historyImage = (key) => ({ id: key, type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: key } });

function attachTextRuntimeCache(obj, content, label = content) {
  obj._layoutCache = [{
    text: label,
    startIndex: 0,
    endIndex: String(content).length,
    prefixWidths: [0, 10],
  }];
  obj._layoutCacheContent = content;
  obj._layoutCacheW = obj.w;
  obj._layoutCacheY = obj.y;
}

test('text-only history skips image cache pruning when no image cache state exists', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
  ], ['text-1']);

  context.snapshot();
  context.objectsMap.get('text-1').data.content = 'hello world';
  context.pushHistory('text-edit-checkpoint', [{ obj: context.objectsMap.get('text-1') }]);

  assert.deepEqual(context.imagePruneCalls, []);
});

test('ordinary history pushes skip image cache pruning while prior entries retain deleted images', () => {
  const context = loadHistoryHarness();
  setBoard(context, [historyImage('img-1')], ['img-1']);

  context.snapshot();
  setBoard(context, [], []);
  context.pushHistory('delete-selected');

  assert.deepEqual(context.imagePruneCalls, []);
});

test('branching after undo prunes image caches after redo entries are discarded', () => {
  const context = loadHistoryHarness();
  setBoard(context, [historyImage('img-1')]);
  context.snapshot();
  setBoard(context, [historyImage('img-2')]);
  context.pushHistory('replace-image');
  context.undo();
  setBoard(context, [historyImage('img-3')]);
  context.pushHistory('branch-image');

  assert.deepEqual(context.imagePruneCalls, [['img-1', 'img-3']]);
});

test('MAX_HISTORY trimming prunes image caches after the oldest entry is discarded', () => {
  const context = loadHistoryHarness();
  context.MAX_HISTORY = 2;
  setBoard(context, [historyImage('img-1')]);
  context.snapshot();
  setBoard(context, [historyImage('img-2')]);
  context.pushHistory('replace-image-2');
  setBoard(context, [historyImage('img-3')]);
  context.pushHistory('replace-image-3');

  assert.deepEqual(context.imagePruneCalls, [['img-2', 'img-3']]);
});

test('clipboard token changes trigger pruning and keep current clipboard image keys', () => {
  const context = loadHistoryHarness();
  setBoard(context, []);
  context.snapshot();
  context.jsClipboard = { type: 'objects', objects: [historyImage('img-old')] };
  context._jsClipboardToken++;
  context.pushHistory('clipboard-old');
  context.jsClipboard = { type: 'objects', objects: [historyImage('img-new')] };
  context._jsClipboardToken++;
  context.pushHistory('clipboard-new');

  assert.deepEqual(context.imagePruneCalls, [['img-old'], ['img-new']]);
});

test('history entries and restores omit inert motion metadata', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'image-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1', flipX: false } },
  ], ['image-1']);

  context.snapshot();
  context.objects[0].data.flipX = true;
  context.markDirty('image-1');
  context.pushHistory('flip-image-x');

  assert.equal('motion' in context.boardHistory[0], false);
  assert.equal('motion' in context.boardHistory[1], false);

  context.undo();
  assert.equal(context.objectsMap.get('image-1').data.flipX, false);
  context.redo();
  assert.equal(context.objectsMap.get('image-1').data.flipX, true);
});

test('undo clears transient dirty ids before rebuilding caches', () => {
  const context = loadHistoryHarness();
  setBoard(context, [historyImage('img-1')]);
  context.snapshot();
  const savedRevision = context.boardHistory[context.historyIndex].revision;
  context.objectsMap.get('img-1').x = 20;
  context.markDirty('img-1');
  context.pushHistory('move-image');
  context.invalidateOffscreen = () => { throw new Error('restore failed'); };

  assert.throws(() => context.undo(), /restore failed/);
  assert.equal(context.boardHistory[context.historyIndex].revision, savedRevision);
  assert.equal(context._dirtyIds.size, 0);
});

test('undo flushes a pending text edit checkpoint before restoring it', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'before' } },
  ], ['text-1']);
  context.snapshot();

  const text = context.objectsMap.get('text-1');
  text.data.content = 'after';
  context.editingId = text.id;
  context._editEl = makeEditProxy({
    value: 'after',
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: 'none',
  });
  context._editHistoryLastContent = 'before';
  context.flushEditHistoryCheckpoint = () => {
    context.markDirty(text.id);
    context.pushHistory('text-edit-checkpoint');
    return true;
  };

  context.undo();

  assert.equal(context.historyIndex, 0);
  assert.equal(context.objectsMap.get('text-1').data.content, 'before');
});

test('immediate text edit history actions replace stale start selection', () => {
  const context = loadTextEditHistoryStateHarness();
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: 'one two three' },
  };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({
    value: obj.data.content,
    selectionStart: 1,
    selectionEnd: 1,
    selectionDirection: 'none',
  });

  context.beginTextEditHistoryAction('text-1', {
    start: 1,
    end: 1,
    direction: 'none',
  });
  context._editEl.setSelectionRange(4, 7, 'forward');
  const state = context.beginTextEditHistoryAction('text-1', {
    start: 4,
    end: 7,
    direction: 'forward',
  });

  assert.deepEqual(plain(state), {
    id: 'text-1',
    selectionStart: 4,
    selectionEnd: 7,
    selectionDirection: 'forward',
  });
});

test('text edit history start state clamps selection to captured pre-edit value', () => {
  const context = loadTextEditHistoryStateHarness();
  const oldValue = 'prefix selected text suffix';
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: oldValue },
  };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({
    value: 'prefix paste suffix',
    selectionStart: 12,
    selectionEnd: 12,
    selectionDirection: 'none',
  });

  const state = context.beginTextEditHistoryAction('text-1', {
    start: 7,
    end: 20,
    direction: 'forward',
    value: oldValue,
  });

  assert.deepEqual(plain(state), {
    id: 'text-1',
    selectionStart: 7,
    selectionEnd: 20,
    selectionDirection: 'forward',
  });
});

test('undoing and redoing text edits hydrate unchanged text runtime caches from live objects', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 700, h: 1200, z: 1, data: { content: 'before' } },
    { id: 'text-2', type: 'text', x: 0, y: 1200, w: 500, h: 120, z: 2, data: { content: 'unchanged' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: 'before',
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
  });
  attachTextRuntimeCache(context.objectsMap.get('text-1'), 'before', 'cached-before');
  context.pushHistory('text-edit-enter');

  const edited = context.objectsMap.get('text-1');
  const unchanged = context.objectsMap.get('text-2');
  attachTextRuntimeCache(unchanged, 'unchanged', 'live-unchanged-cache');
  edited.data.content = 'after';
  context._editEl.value = 'after';
  context._editEl._boardfishSetLogicalValue('after');
  context._editEl.selectionStart = 5;
  context._editEl.selectionEnd = 5;
  attachTextRuntimeCache(edited, 'after', 'cached-after');
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', null, {
      id: 'text-1',
      selectionStart: 6,
      selectionEnd: 6,
      selectionDirection: 'none',
  });

  context.undo();

  let restoredUnchanged = context.objectsMap.get('text-2');
  assert.notEqual(restoredUnchanged, unchanged);
  assert.equal(restoredUnchanged.data.content, 'unchanged');
  assert.equal(restoredUnchanged._layoutCacheContent, 'unchanged');
  assert.equal(restoredUnchanged._layoutCache[0].text, 'live-unchanged-cache');

  context.redo();

  restoredUnchanged = context.objectsMap.get('text-2');
  assert.equal(restoredUnchanged.data.content, 'unchanged');
  assert.equal(restoredUnchanged._layoutCacheContent, 'unchanged');
  assert.equal(restoredUnchanged._layoutCache[0].text, 'live-unchanged-cache');
});
