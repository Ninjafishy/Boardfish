'use strict';

function createUnitTextContext() {
  return {
    font: '',
    textBaseline: '',
    measureText(text) {
      return {
        width: String(text).length,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      };
    },
  };
}

module.exports = { createUnitTextContext };
