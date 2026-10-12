'use strict';

(function initClipboardIO(root) {
  const BOARDFISH_CLIPBOARD_TOKEN_RE = /<!--\s*boardfish-clipboard:([A-Za-z0-9._:-]+)\s*-->/i;

  function createBoardfishClipboardMarker(token) {
    return token ? `<!--boardfish-clipboard:${token}-->` : '';
  }

  function textToClipboardHtml(text, token) {
    const marker = createBoardfishClipboardMarker(token);
    const html = String(text ?? '').replace(/[&<]|\r\n?|\n/g, (value) => (
      value === '&' ? '&amp;' : value === '<' ? '&lt;' : '<br>'
    ));
    return `${marker}<div>${html}</div>`;
  }

  function boardfishTokenClipboardHtml(token) {
    return `${createBoardfishClipboardMarker(token)}<span></span>`;
  }

  function imageClipboardHtml(token, dataUrl = '') {
    const marker = createBoardfishClipboardMarker(token);
    const src = String(dataUrl || '');
    if (!src) return boardfishTokenClipboardHtml(token);
    return `${marker}<img src="${src}" alt="">`;
  }

  async function blobToDataUrl(blob) {
    if (typeof FileReader !== 'undefined') {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Image Read Failed'));
        reader.readAsDataURL(blob);
      });
    }
    if (typeof blob.arrayBuffer !== 'function') return '';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (typeof Buffer !== 'undefined') {
      return `data:${blob.type || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    if (typeof btoa !== 'function') return '';
    // Complete base64 groups need three bytes, so only the final chunk may add padding.
    const chunkSize = 0x7ffe;
    let base64 = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      let binary = '';
      const chunk = bytes.subarray(offset, offset + chunkSize);
      for (const byte of chunk) binary += String.fromCharCode(byte);
      base64 += btoa(binary);
    }
    return `data:${blob.type || 'image/png'};base64,${base64}`;
  }

  function readBoardfishClipboardTokenFromHtml(html = '') {
    return BOARDFISH_CLIPBOARD_TOKEN_RE.exec(String(html || ''))?.[1] || '';
  }

  function readBoardfishClipboardTokenFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return readBoardfishClipboardTokenFromHtml(clipboardData.getData?.('text/html') || '');
  }

  function supportsRichClipboardWrite() {
    return !!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && typeof Blob !== 'undefined';
  }

  const writeClipboardItem = (parts) => navigator.clipboard.write([new ClipboardItem(parts)]);

  function supportedClipboardImageFile(items = [], files = []) {
    for (const item of items) {
      if (item.kind === 'file' && (item.type === 'image/png' || item.type === 'image/jpeg')) {
        const file = item.getAsFile?.();
        if (file) return file;
        break;
      }
    }
    for (const file of files) {
      if (file.type === 'image/png' || file.type === 'image/jpeg') return file;
    }
    return null;
  }

  function readClipboardImageFileFromEvent(clipboardData) {
    if (!clipboardData) {
      return null;
    }

    const imageFile = supportedClipboardImageFile(clipboardData.items || [], clipboardData.files || []);
    if (!imageFile) {
      return null;
    }

    return imageFile;
  }

  function readClipboardTextFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
  }

  async function copyTextToClipboard(text, options = {}) {
    const boardfishToken = options?.boardfishToken || '';

    if (boardfishToken && supportsRichClipboardWrite()) {
      try {
        await writeClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([textToClipboardHtml(text, boardfishToken)], { type: 'text/html' }),
        });

        return { boardfishTokenWritten: true };
      } catch {}
    }

    await navigator.clipboard.writeText(text);

    return { boardfishTokenWritten: false };
  }

  async function readBoardfishClipboardTokenFromBrowser() {
    if (!navigator.clipboard?.read) return { checked: false, token: '', items: null };

    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types?.includes?.('text/html')) continue;
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const token = readBoardfishClipboardTokenFromHtml(html);

      return { checked: true, token, items };
    }

    return { checked: true, token: '', items };
  }

  async function copyBoardfishTokenToClipboard(token) {
    if (!token || !supportsRichClipboardWrite()) return { boardfishTokenWritten: false };
    try {
      await writeClipboardItem({
        'text/plain': new Blob([''], { type: 'text/plain' }),
        'text/html': new Blob([boardfishTokenClipboardHtml(token)], { type: 'text/html' }),
      });
      return { boardfishTokenWritten: true };
    } catch {
      return { boardfishTokenWritten: false };
    }
  }

  function copyImageBlobToClipboard(blobOrPromise, token = '') {
    const imagePart = Promise.resolve(blobOrPromise).then((blob) => {
      if (!blob) throw new Error('Clipboard Image Creation Failed');
      return blob;
    });
    const writeImageOnly = () => {
      try {
        return Promise.resolve(writeClipboardItem({ 'image/png': imagePart }))
          .then(() => ({ boardfishTokenWritten: false }));
      } catch (err) {
        return Promise.reject(err);
      }
    };
    if (token && supportsRichClipboardWrite()) {
      const htmlBlobPromise = imagePart
        .then(blobToDataUrl)
        .catch(() => {
          return '';
        })
        .then((dataUrl) => new Blob([imageClipboardHtml(token, dataUrl)], { type: 'text/html' }));
      let richWrite;
      try {
        // ClipboardItem accepts promised representations. Starting write() before
        // image encoding finishes keeps it inside the trusted copy gesture.
        richWrite = writeClipboardItem({
          'image/png': imagePart,
          'text/html': htmlBlobPromise,
        });
      } catch {
        return writeImageOnly();
      }
      return Promise.resolve(richWrite)
        .then(() => ({ boardfishTokenWritten: true }))
        .catch(() => {
          return writeImageOnly();
        });
    }
    return writeImageOnly();
  }

  const clipboardIoApi = {
    copyBoardfishTokenToClipboard,
    copyImageBlobToClipboard,
    copyTextToClipboard,
    readBoardfishClipboardTokenFromBrowser,
    readBoardfishClipboardTokenFromEvent,
    readClipboardImageFileFromEvent,
    readClipboardTextFromEvent,
  };

  root.BoardfishClipboardIO = Object.freeze(clipboardIoApi);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BoardfishClipboardIO;
  }
})(typeof window !== 'undefined' ? window : globalThis);
