'use strict';

const assert = require('node:assert/strict');

const textNode = (value) => ({ nodeType: 3, nodeValue: value });
const element = (localName, ...children) => ({
  nodeType: 1,
  localName,
  childNodes: children.map((child) => typeof child === 'string' ? textNode(child) : child),
});
const serialize = (node) => node.nodeType === 3
  ? node.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  : `<${node.localName}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;

// Supply the inert DOM fragment at the browser boundary without introducing a
// second HTML parser into the runtime or the Node test suite.
function clipboardHtmlFixture(...children) {
  const fragment = element('div', ...children);
  const html = serialize(fragment);
  return {
    html,
    createTemplate() {
      return {
        content: { childNodes: [fragment] },
        set innerHTML(value) { assert.equal(value, html); },
      };
    },
    clipboardData(text) {
      return { getData: (type) => ({ 'text/plain': text, 'text/html': html })[type] || '' };
    },
    clipboardItem(text) {
      return {
        types: ['text/plain', 'text/html'],
        async getType(type) {
          return new Blob([type === 'text/plain' ? text : html], { type });
        },
      };
    },
  };
}

const listNames = ['Elizabeth', 'Dana', 'Chen', 'Cinnamon', 'Lisa', 'Deloris', 'Nancy', 'Joe', 'Bronwyn'];
const namesListFixture = () => clipboardHtmlFixture(element('ol',
  ...listNames.map((name) => element('li', element('p', name))),
));

module.exports = { element, clipboardHtmlFixture, listNames, namesListFixture };
