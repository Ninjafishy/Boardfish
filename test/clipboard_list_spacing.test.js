'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('../test-support/browser_vm.js');
const { readSource } = require('../test-support/source.js');
const { element: el, clipboardHtmlFixture, listNames, namesListFixture } = require('../test-support/clipboard.js');

function loadClipboardIO(fixture, clipboard = {}) {
  const context = vm.createContext({
    document: { createElement: () => fixture.createTemplate() },
    navigator: { clipboard },
  });
  vm.runInContext(readSource('src/js/clipboard_io.js'), context);
  return context.BoardfishClipboardIO;
}

for (const separator of ['\n\n', '\n\n\n\n', '\r\n \t\r\n\r\n']) {
  test(`copied list paragraphs become adjacent lines (${JSON.stringify(separator)})`, () => {
    const fixture = namesListFixture();
    const io = loadClipboardIO(fixture);
    assert.equal(io.readClipboardTextFromEvent(fixture.clipboardData(listNames.join(separator))), listNames.join('\n'));
  });
}

test('plain-text list markers, indentation, and spaces stay intact', () => {
  const fixture = namesListFixture();
  const lines = listNames.map((name, index) => `  ${index + 1}.\t${name}  `);
  assert.equal(loadClipboardIO(fixture).readClipboardTextFromEvent(fixture.clipboardData(lines.join('\n\n'))), lines.join('\n'));
});

test('only list boundaries lose blank lines, including when prose repeats list text', () => {
  const fixture = clipboardHtmlFixture(
    el('p', 'Elizabeth'), el('p', 'Dana'),
    el('ul', el('li', 'Elizabeth'), el('li', 'Dana')),
    el('p', 'End'),
  );
  const text = 'Elizabeth\n\nDana\n\nElizabeth\n\n\nDana\n\nEnd';
  assert.equal(loadClipboardIO(fixture).readClipboardTextFromEvent(fixture.clipboardData(text)),
    'Elizabeth\n\nDana\n\nElizabeth\nDana\n\nEnd');
});

test('paragraph breaks within an item stay intact', () => {
  const fixture = clipboardHtmlFixture(el('ol',
    el('li', el('p', 'First paragraph'), el('p', 'Second paragraph')),
    el('li', 'Next item'),
  ));
  const text = 'First paragraph\n\nSecond paragraph\n\n\nNext item';
  assert.equal(loadClipboardIO(fixture).readClipboardTextFromEvent(fixture.clipboardData(text)),
    'First paragraph\n\nSecond paragraph\nNext item');
});

test('explicit breaks and empty list items keep their spacing', () => {
  for (const children of [
    [el('li', 'Elizabeth', el('br'), el('br')), el('li', 'Dana')],
    [el('li', 'Elizabeth'), el('li', ''), el('li', 'Dana')],
  ]) {
    const fixture = clipboardHtmlFixture(el('ol', ...children));
    const text = 'Elizabeth\n\nDana';
    assert.equal(loadClipboardIO(fixture).readClipboardTextFromEvent(fixture.clipboardData(text)), text);
  }
});

test('plain text without matching list HTML keeps intentional blank lines', () => {
  const fixture = namesListFixture();
  const io = loadClipboardIO(fixture);
  const text = 'A paragraph.\n\nAnother paragraph.';
  assert.equal(io.readClipboardTextFromEvent(fixture.clipboardData(text)), text);
  assert.equal(io.readClipboardTextFromEvent({ getData: (type) => type === 'text/plain' ? text : '' }), text);
});

test('Paste menu reads list HTML and text from the same clipboard snapshot', async () => {
  const fixture = namesListFixture();
  const io = loadClipboardIO(fixture, {
    async read() { return [fixture.clipboardItem(listNames.join('\n\n\n\n'))]; },
    async readText() { throw new Error('Must use the same clipboard item'); },
  });
  assert.equal(await io.readClipboardTextFromBrowser(), listNames.join('\n'));
});

test('unavailable rich clipboard data still falls back to plain text', async () => {
  const text = 'Elizabeth\n\nDana';
  const io = loadClipboardIO(namesListFixture(), {
    async read() { throw new Error('Rich clipboard denied'); },
    async readText() { return text; },
  });
  assert.equal(await io.readClipboardTextFromBrowser(), text);
  assert.equal(await io.readClipboardTextFromBrowser([{
    types: ['text/plain', 'text/html'],
    async getType(type) {
      if (type === 'text/html') throw new Error('HTML unavailable');
      return new Blob([text], { type });
    },
  }]), text);
});
