'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../test-support/source.js');

test('web runtime owns local board file IO', () => {
  const runtime = readSource('src/js/web_runtime.js');
  const io = readSource('src/js/io_close.js');

  assert.match(runtime, /showOpenFilePicker/);
  assert.match(runtime, /showSaveFilePicker/);
  assert.match(runtime, /downloadBlob\(payload\.blob, fileNameFromRef\(ref, 'board\.bf'\)\)/);
  assert.match(io, /const chooseFile = BoardfishRuntime\.openFileDialog;/);
  assert.match(readSource('src/js/app_bootstrap.js'), /BoardfishRuntime\.readBoard\(filePath\)/);
  assert.match(io, /BoardfishRuntime\.saveBoard\(fileRef, data, \{ imageStore, \.\.\.options \}\)/);
});

test('image storage is web-ref and data-url based', () => {
  const imageInsert = readSource('src/js/image_insert.js');

  assert.match(imageInsert, /createWebImageSourceFromBlob\(file, imgKey\)/);
  assert.doesNotMatch(imageInsert, /readAsArrayBuffer/);
  assert.match(imageInsert, /const WEB_IMAGE_INSERT_CONCURRENCY = 3;/);
});

test('dirty tracking treats net-empty boards as clean only against an empty saved baseline', () => {
  const io = readSource('src/js/io_close.js');
  const history = readSource('src/js/history_state.js');
  const objectCommands = readSource('src/js/object_commands.js');
  assert.match(io, /function isDefaultEmptyBoardState\(objectList = objects\) \{[\s\S]*for \(const obj of objectList \|\| \[\]\)[\s\S]*return true;\s*\}/);
  assert.match(io, /function isCleanDefaultEmptyBoardState\(\) \{\s*return savedDefaultEmptyBoard && isDefaultEmptyBoardState\(objects\);\s*\}/);
  assert.match(history, /revision: reason === 'text-edit-enter' && !contentChanged \? prevEntry\?\.revision : \+\+_historyRevision/);
  assert.match(objectCommands, /if \(isCleanDefaultEmptyBoardState\(\) && !currentFileRef\) \{\s*return;\s*\}/);
});

test('startup marks the initial empty board snapshot clean', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(bootstrap, /resizeCanvas\(\);\s*snapshot\(\);\s*markSaved\(\);/);
});

test('dark mode icon is local and offline-safe', () => {
  const html = readSource('src/index.html');
  const styles = readSource('src/styles.css');
  const sw = readSource('src/sw.js');

  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|Material Symbols|material-symbols-outlined/i);
  assert.doesNotMatch(styles, /material-symbols-outlined/i);
  assert.doesNotMatch(sw, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  assert.match(sw, /if \(isCacheFirstAssetUrl\(url\)\)[\s\S]*\[a-f0-9\]\{12\}[\s\S]*cached\.then\(\(hit\) => hit \|\| fetchAndCacheRequest\(event, request, url\)\)/);
  assert.match(sw, /const update = fetchAndCacheRequest[\s\S]*event\.waitUntil\(update\)/);
  assert.match(sw, /const currentCache = caches\.open\(BOARDFISH_CACHE\);[\s\S]*event\.waitUntil\(currentCache\.then\(\(cache\) => cache\.put\(request, copy\)/);
  assert.match(sw, /BOARDFISH_CACHE_NAMESPACE[\s\S]*encodeURIComponent\(self\.registration\.scope\)/);
  assert.match(sw, /key\.startsWith\(BOARDFISH_CACHE_NAMESPACE\)/);
  assert.match(sw, /function matchCurrentCache\(request\)[\s\S]*currentCache\.then\(\(cache\) => cache\.match\(request\)\)/);
  assert.doesNotMatch(sw, /caches\.match\(/);
  assert.doesNotMatch(sw, /await cache\.put/);
});

test('dev server returns 400 for malformed URL encodings', () => {
  const server = readSource('scripts/serve-web.mjs');

  assert.match(server, /catch \(err\) \{\s*if \(err instanceof URIError\) \{\s*res\.writeHead\(400\)\.end\('Bad Request'\);/);
});

test('image hydration queue processes until its time budget is consumed', () => {
  const imageState = readSource('src/js/image_state.js');

  assert.match(imageState, /var _imageHydrationQueue = new Set\(\);/);
  assert.match(imageState, /if \(count > 0 && performance\.now\(\) - batchStart >= 6\) break;/);
  assert.match(imageState, /cacheImage\(key, source\s*\);/);
});

test('save and open validation stay at the authoritative container boundaries', () => {
  const container = readSource('src/js/web_board_container.js');
  const createStart = container.indexOf('async function createBoardContainerBlob');
  const createEnd = container.indexOf('\n  async function readBoardContainer', createStart);
  const createSource = container.slice(createStart, createEnd);
  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.equal((createSource.match(/JSON\.stringify/g) || []).length, 1);

  const runtime = readSource('src/js/web_runtime.js');
  const saveStart = runtime.indexOf('async function saveBoard');
  const saveEnd = runtime.indexOf('\n  const api =', saveStart);
  const saveSource = runtime.slice(saveStart, saveEnd);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.doesNotMatch(saveSource, /handle\.getFile|refreshImageSources/);
  assert.match(runtime, /waitForFileOperation\(\(\) => writable\.write\(blob\), stage, timeoutMs\)/);
  assert.match(runtime, /waitForFileOperation\([\s\S]*?\(\) => writable\.abort\(failure\)/);
});
