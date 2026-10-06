'use strict';

const vm = require('node:vm');
const { readSource } = require('./source.js');
const viewSource = readSource('src/js/view_context.js');

// Browser modules share the active-view service before their own startup, just
// as they do in startup_manifest. Individual tests still provide their DOM.
function createContext(sandbox = {}, options) {
  const context = vm.createContext(sandbox, options);
  vm.runInContext(viewSource, context, { filename: 'src/js/view_context.js' });
  return context;
}

module.exports = {
  ...vm,
  createContext,
  runInNewContext(code, sandbox, options) {
    return vm.runInContext(code, createContext(sandbox), options);
  },
};
