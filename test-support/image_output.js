'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WebContainer = require('../src/js/web_board_container.js');

const pngBytes = fs.readFileSync(path.join(__dirname, '../src/boardfish-icon-192.png'));

function loadReadableImageSourceBlob({ container = WebContainer, decode = async () => ({ close() {} }) } = {}) {
  const context = vm.createContext({
    Blob,
    BoardfishWebBoardContainer: container,
    createImageBitmap: decode,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/image_state.js'), 'utf8'), context);
  return context.readableImageSourceBlob;
}

function singleImageBoard() {
  return {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
}

module.exports = { loadReadableImageSourceBlob, pngBytes, singleImageBoard };
