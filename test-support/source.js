'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath));
}

function listFiles(dir, predicate = () => true) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(relativePath, predicate));
    else if (predicate(relativePath)) files.push(relativePath);
  }
  return files;
}

function runScript(source, context, options) {
  vm.createContext(context);
  return vm.runInContext(source, context, options);
}

function loadBoardLimits(objects) {
  const context = { objects, TextEncoder };
  runScript(readSource('src/js/board_limits.js'), context);
  return context.BoardfishWebLimits;
}

const plain = value => JSON.parse(JSON.stringify(value));

module.exports = { plain, readSource, readJson, listFiles, runScript, loadBoardLimits };
