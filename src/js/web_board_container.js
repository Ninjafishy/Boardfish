'use strict';

(function initWebBoardContainer(root) {
  const { mimeForExt, normalizeImageExt } = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);
  const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
  const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
  const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const ZIP_METHOD_STORED = 0;
  const ZIP_METHOD_DEFLATED = 8;
  const ZIP_EOCD_MIN_SIZE = 22;
  const ZIP_EOCD_MAX_COMMENT = 0xFFFF;
  const ZIP16_SENTINEL = 0xFFFF;
  const ZIP32_SENTINEL = 0xFFFFFFFF;

  let crcTable = null;
  let utf8TextEncoder = null;
  let utf8TextDecoder = null;
  const imageSourceCrcCache = new WeakMap();
  const imageSourceArchiveIdentityCache = new WeakMap();

  function utf8Encode(text) {
    return (utf8TextEncoder ||= new TextEncoder()).encode(String(text));
  }

  function utf8Decode(bytes) {
    return (utf8TextDecoder ||= new TextDecoder()).decode(bytes);
  }

  function boardTextCharacters(board) {
    const limits = root.BoardfishWebLimits ||
      (typeof require === 'function' ? require('./board_limits.js') : null);
    return limits.currentTextCharacters(board?.objects || []);
  }

  function unsupportedContainerError() {
    return new Error('Unsupported File Format');
  }

  function invalidContainerError(entryName = '') {
    return new Error(entryName ? `Invalid File Entry: ${entryName}` : 'Invalid Board File');
  }

  function ensureByteRange(bytes, offset, length) {
    const start = Number(offset);
    const size = Number(length);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(size) ||
      start < 0 ||
      size < 0 ||
      start + size > bytes.length
    ) {
      throw invalidContainerError();
    }
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  function crc32Update(crc, bytes) {
    if (!crcTable) crcTable = makeCrcTable();
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return crc >>> 0;
  }

  function yieldToEventLoop() {
    if (root.scheduler?.yield) return root.scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  const CRC_CHUNK_SIZE = 1024 * 1024;

  async function crc32Async(source, yieldFinal = false) {
    const blob = isNativeBlobPart(source);
    const size = blob ? source.size : source.length;
    let crc = 0xFFFFFFFF;
    for (let start = 0; start < size; start += CRC_CHUNK_SIZE) {
      const end = Math.min(size, start + CRC_CHUNK_SIZE);
      const chunk = blob ? new Uint8Array(await source.slice(start, end).arrayBuffer()) : source.subarray(start, end);
      if (chunk.length !== end - start) throw new Error('Image Read Failed');
      crc = crc32Update(crc, chunk);
      if (yieldFinal || end < size) await yieldToEventLoop();
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    return {
      time: (hours << 11) | (minutes << 5) | seconds,
      date: ((year - 1980) << 9) | (month << 5) | day,
    };
  }

  function localFileHeader(entry, offset) {
    const name = utf8Encode(entry.name);
    if (name.length > ZIP16_SENTINEL) throw new Error(`ZIP Entry Name Too Long: ${entry.name}`);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength >= ZIP32_SENTINEL) {
      throw new Error(`ZIP Entry Too Large: ${entry.name}`);
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= ZIP32_SENTINEL) {
      throw new Error('ZIP Size Limit Exceeded');
    }
    const { time, date } = dosDateTime(entry.date);
    const bytes = new Uint8Array(30 + name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_LOCAL_FILE_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, ZIP_METHOD_STORED, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.byteLength, true);
    view.setUint32(22, entry.byteLength, true);
    view.setUint16(26, name.length, true);
    bytes.set(name, 30);
    return { offset, name, bytes };
  }

  function centralDirectoryHeader(local) {
    const bytes = new Uint8Array(46 + local.name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_CENTRAL_DIRECTORY, true);
    view.setUint16(4, 20, true);
    // Version needed through extra length repeat the local header fields.
    bytes.set(local.bytes.subarray(4, 30), 6);
    view.setUint32(42, local.offset, true);
    bytes.set(local.name, 46);
    return bytes;
  }

  function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    if (
      !Number.isSafeInteger(centralSize) ||
      !Number.isSafeInteger(centralOffset) ||
      centralSize < 0 ||
      centralOffset < 0 ||
      centralSize >= ZIP32_SENTINEL ||
      centralOffset >= ZIP32_SENTINEL
    ) {
      throw new Error('ZIP Size Limit Exceeded');
    }
    const bytes = new Uint8Array(ZIP_EOCD_MIN_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return bytes;
  }

  async function createZipBlob(entries) {
    if (!Array.isArray(entries) || entries.length >= ZIP16_SENTINEL) {
      throw new Error('ZIP Entry Limit Exceeded');
    }
    const normalized = new Array(entries.length), defaultDate = new Date();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let data;
      if (isNativeBlobPart(entry.data)) data = entry.data;
      else if (isBlobLike(entry.data)) data = await blobToBytes(entry.data);
      else data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
      const suppliedCrc = entry.crc === null || entry.crc === undefined ? NaN : Number(entry.crc);
      normalized[i] = {
        name: entry.name,
        data,
        byteLength: isNativeBlobPart(data) ? Number(data.size) : data.length,
        date: entry.date || defaultDate,
        crc: Number.isInteger(suppliedCrc) && suppliedCrc >= 0 && suppliedCrc <= 0xFFFFFFFF
          ? suppliedCrc >>> 0
          : null,
      };
    }

    for (const entry of normalized) {
      if (entry.crc !== null) {
        continue;
      }
      entry.crc = await crc32Async(entry.data, true);
    }

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.byteLength;
      const central = centralDirectoryHeader(local);
      centralParts.push(central);
      centralSize += central.length;
    }
    const centralOffset = offset;
    const eocd = endOfCentralDirectory(normalized.length, centralSize, centralOffset);
    const blob = new Blob(localParts.concat(centralParts, eocd), { type: 'application/octet-stream' });
    return {
      blob,
      crcs: normalized.map((entry) => entry.crc),
    };
  }

  async function blobToBytes(blob) {
    if (blob?.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
    throw unsupportedContainerError();
  }

  function isBlobLike(value) {
    return !!(
      value &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.slice === 'function' &&
      Number.isFinite(Number(value.size))
    );
  }

  function isNativeBlobPart(value) {
    return typeof Blob === 'function' && value instanceof Blob;
  }

  async function blobRangeToBytes(blob, start, end) {
    const size = Number(blob?.size);
    const from = Number(start);
    const to = Number(end);
    if (
      !Number.isFinite(size) ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to < from ||
      to > size
    ) {
      throw invalidContainerError();
    }
    const slice = blob.slice(from, to);
    if (Number(slice?.size) !== to - from) {
      throw invalidContainerError();
    }
    const bytes = await blobToBytes(slice);
    if (bytes.length !== to - from) {
      throw invalidContainerError();
    }
    return bytes;
  }

  function findEndOfCentralDirectory(bytes) {
    const min = Math.max(0, bytes.length - ZIP_EOCD_MIN_SIZE - ZIP_EOCD_MAX_COMMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.length - ZIP_EOCD_MIN_SIZE; offset >= min; offset--) {
      if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + ZIP_EOCD_MIN_SIZE + commentLength === bytes.length) return offset;
    }
    throw unsupportedContainerError();
  }

  function endOfCentralDirectoryInfo(bytes, baseOffset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const diskNumber = view.getUint16(eocdOffset + 4, true);
    const centralDisk = view.getUint16(eocdOffset + 6, true);
    const diskEntryCount = view.getUint16(eocdOffset + 8, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
      throw new Error('Unsupported ZIP Format');
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('Unsupported ZIP Format');
    }
    // The EOCD record sits inside the container, so this also bounds the container size.
    if (centralOffset + centralSize > baseOffset + eocdOffset) throw invalidContainerError();
    return {
      entryCount,
      centralSize,
      centralOffset,
    };
  }

  function parseCentralDirectoryBytes(bytes, entryCount) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = new Map();
    let offset = 0;
    for (let i = 0; i < entryCount; i++) {
      ensureByteRange(bytes, offset, 46);
      if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY) {
        throw invalidContainerError();
      }
      const method = view.getUint16(offset + 10, true);
      const crc = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error('Unsupported ZIP Format');
      }
      const nameStart = offset + 46;
      const nextOffset = nameStart + nameLength + extraLength + commentLength;
      if (nextOffset > bytes.length) throw invalidContainerError();
      const name = utf8Decode(bytes.subarray(nameStart, nameStart + nameLength));
      entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localOffset });
      offset = nextOffset;
    }
    return entries;
  }

  async function parseCentralDirectoryFromBlob(blob) {
    const containerSize = Number(blob?.size) || 0;
    if (containerSize < ZIP_EOCD_MIN_SIZE) throw unsupportedContainerError();
    const tailSize = Math.min(containerSize, ZIP_EOCD_MIN_SIZE + ZIP_EOCD_MAX_COMMENT);
    const tailOffset = containerSize - tailSize;
    const tailBytes = await blobRangeToBytes(blob, tailOffset, containerSize);
    const info = endOfCentralDirectoryInfo(tailBytes, tailOffset);
    const centralBytes = info.centralOffset >= tailOffset
      ? tailBytes.subarray(info.centralOffset - tailOffset, info.centralOffset - tailOffset + info.centralSize)
      : await blobRangeToBytes(blob, info.centralOffset, info.centralOffset + info.centralSize);
    return {
      entries: parseCentralDirectoryBytes(centralBytes, info.entryCount),
    };
  }

  function assertStoredEntrySize(entry) {
    if (
      entry?.method === ZIP_METHOD_STORED &&
      Number(entry.compressedSize) !== Number(entry.uncompressedSize)
    ) {
      throw invalidContainerError(entry?.name || '');
    }
  }

  async function compressedEntryBlob(blob, entry, type = '') {
    const containerSize = Number(blob?.size) || 0;
    const localOffset = Number(entry?.localOffset);
    assertStoredEntrySize(entry);
    if (!Number.isFinite(localOffset) || localOffset < 0 || localOffset + 30 > containerSize) {
      throw invalidContainerError(entry?.name || '');
    }
    const header = await blobRangeToBytes(blob, localOffset, localOffset + 30);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw invalidContainerError(entry.name);
    }
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + Number(entry.compressedSize || 0);
    if (dataStart < localOffset + 30 || dataEnd > containerSize) {
      throw invalidContainerError(entry.name);
    }
    const out = blob.slice(dataStart, dataEnd, type || '');
    if (Number(out?.size) !== dataEnd - dataStart) {
      throw invalidContainerError(entry.name);
    }
    return out;
  }

  function throwEntryTooLarge(entry) {
    throw new Error(`File Entry Too Large: ${entry.name}`);
  }

  async function inflateRaw(bytes, entry) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Unsupported Compression');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        total += chunk.length;
        // readZipEntry already capped the advertised size at the caller's budget.
        if (total > entry.uncompressedSize) {
          try { await reader.cancel(); } catch {}
          throwEntryTooLarge(entry);
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function zipEntryContentBytes(entry) {
    const uncompressedSize = Number(entry?.uncompressedSize || 0);
    if (entry?.method === ZIP_METHOD_STORED) {
      return Math.max(uncompressedSize, Number(entry?.compressedSize || 0));
    }
    return uncompressedSize;
  }

  async function validateReadZipEntry(out, entry, options = {}) {
    if (Number(entry.uncompressedSize) !== out.length) {
      throw invalidContainerError(entry.name);
    }
    if (options.verifyCrc !== false && Number.isFinite(Number(entry.crc))) {
      const actualCrc = await crc32Async(out);
      if ((entry.crc >>> 0) !== actualCrc) {
        throw new Error(`File Checksum Mismatch: ${entry.name}`);
      }
    }
    return out;
  }

  async function readZipEntry(input, entry, options = {}) {
    // A missing budget is NaN, which never compares greater.
    if (zipEntryContentBytes(entry) > options.maxBytes) throwEntryTooLarge(entry);
    let compressed = await compressedEntryBlob(input, entry);
    if (isBlobLike(compressed) && (entry.method === ZIP_METHOD_STORED || !isNativeBlobPart(compressed))) {
      compressed = await blobToBytes(compressed);
    }
    if ((compressed.size ?? compressed.length) !== Number(entry.compressedSize)) {
      throw invalidContainerError(entry.name);
    }
    let out;
    if (entry.method === ZIP_METHOD_STORED) out = compressed;
    else if (entry.method === ZIP_METHOD_DEFLATED) out = await inflateRaw(compressed, entry);
    else throw new Error(`Unsupported Compression: ${entry.method} (${entry.name})`);
    return validateReadZipEntry(out, entry, options);
  }

  function base64ToBytes(base64) {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    throw new Error('Base64 Decoder Unavailable');
  }

  function dataUrlParts(dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) throw new Error('Invalid Image Data');
    return { mime: match[1].toLowerCase(), base64: match[2] };
  }

  function dataUrlToBytes(dataUrl) {
    return base64ToBytes(dataUrlParts(dataUrl).base64);
  }

  function dataUrlByteLength(dataUrl) {
    const base64 = dataUrlParts(dataUrl).base64.replace(/\s/g, '');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }

  function createWebImageRef({ path, mime, ext, bytes, blob, volatileBlob = false, archiveCrc = null }) {
    const normalizedExt = normalizeImageExt(ext, mime);
    const normalizedMime = mime || mimeForExt(normalizedExt);
    const sourceBlob = isBlobLike(blob)
      ? (blob.type === normalizedMime ? blob : blob.slice(0, blob.size, normalizedMime))
      : null;
    const byteLength = bytes?.length || Number(sourceBlob?.size || 0);
    const ref = {
      web: true,
      path,
      mime: normalizedMime,
      ext: normalizedExt,
      bytes: byteLength,
    };
    if (bytes) {
      Object.defineProperty(ref, '__bytes', {
        value: bytes,
      });
    }
    if (sourceBlob) {
      Object.defineProperties(ref, {
        __blob: { value: sourceBlob, writable: true },
        __blobVolatile: { value: volatileBlob === true, writable: true },
      });
    }
    if (Number.isInteger(archiveCrc)) {
      cacheImageSourceArchiveIdentity(ref, byteLength, archiveCrc >>> 0);
    }
    return ref;
  }

  function replaceWebImageRefBlob(source, blob, crc = null, { volatile = false } = {}) {
    if (!isWebImageRef(source) || !isBlobLike(source.__blob) || !isNativeBlobPart(blob)) return false;
    const typedBlob = blob.type === source.mime
      ? blob
      : blob.slice(0, blob.size, source.mime || 'image/png');
    source.__blob = typedBlob;
    source.__blobVolatile = volatile === true;
    source.bytes = typedBlob.size;
    if (Number.isInteger(crc)) cacheImageSourceCrc(source, typedBlob.size, crc >>> 0);
    return true;
  }

  async function snapshotImageBlob(blob, mime = blob.type || 'image/png') {
    // Wrapping or slicing a File keeps its backing storage. Read its contents
    // before retaining or handing off a Blob that must survive changes on disk.
    const snapshot = typeof root.Response === 'function' && typeof blob.stream === 'function'
      ? await new root.Response(blob.stream(), { headers: { 'Content-Type': mime } }).blob()
      : new Blob([await blob.arrayBuffer()], { type: mime });
    if (snapshot.size !== blob.size) throw new Error('Image Read Failed');
    return snapshot.type === mime ? snapshot : snapshot.slice(0, snapshot.size, mime);
  }

  async function stabilizeVolatileImageRefs(board, rawImageStore = {}) {
    const imageStore = board?.imageStore || {};

    for (const key in imageStore) {
      if (!Object.hasOwn(imageStore, key)) continue;
      const source = rawImageStore[key];
      if (!source?.__blobVolatile || !isBlobLike(source.__blob)) continue;
      const sourceBlob = source.__blob;
      const cachedCrc = cachedImageSourceCrc(source, sourceBlob.size);
      const stableBlob = await snapshotImageBlob(sourceBlob, source.mime || 'image/png');
      if (!replaceWebImageRefBlob(source, stableBlob, cachedCrc, { volatile: false })) {
        throw new Error(`Image Read Failed: ${key}`);
      }
    }
  }

  function isWebImageRef(source) {
    return !!(source && typeof source === 'object' && source.web === true && (source.__bytes || source.__blob));
  }

  function imageSourceCrcIdentity(source) {
    if (!isWebImageRef(source)) return null;
    return isBlobLike(source.__blob) ? source.__blob : null;
  }

  function cachedImageSourceCrc(source, byteLength) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity) return null;
    const cached = imageSourceCrcCache.get(source);
    if (!cached || cached.identity !== identity || cached.byteLength !== byteLength) return null;
    return cached.crc;
  }

  function cacheImageSourceCrc(source, byteLength, crc) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity || !Number.isInteger(crc)) return;
    imageSourceCrcCache.set(source, { identity, byteLength, crc: crc >>> 0 });
  }

  function archivedImageSourceIdentity(source, byteLength) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity) return null;
    const cached = imageSourceArchiveIdentityCache.get(source);
    if (!cached || cached.identity !== identity || cached.byteLength !== byteLength) return null;
    return cached;
  }

  function cacheImageSourceArchiveIdentity(source, byteLength, crc) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity || !Number.isInteger(crc)) return;
    imageSourceArchiveIdentityCache.set(source, {
      identity,
      byteLength,
      crc: crc >>> 0,
    });
  }

  function blobForWebImageRef(source) {
    if (isBlobLike(source?.__blob)) return source.__blob;
    const bytes = source.__bytes;
    if (!bytes || typeof Blob !== 'function') return null;
    return new Blob([bytes], { type: source?.mime || 'image/png' });
  }

  function manifestEntryForKey(board, key) {
    const entry = board?.imageStore?.[key];
    return entry && typeof entry === 'object' ? entry : {};
  }

  function imageEntryPath(key, manifest) {
    if (typeof manifest.path === 'string' && manifest.path) return manifest.path;
    const ext = manifest.ext || (manifest.mime === 'image/jpeg' ? 'jpg' : 'png');
    return `images/${key}.${ext}`;
  }

  function canonicalImageEntryPath(key, manifest = {}) {
    const ext = normalizeImageExt(manifest.ext, manifest.mime);
    return `images/${key}.${ext}`;
  }

  function resolveManifestImageEntry(entries, key, manifest = {}) {
    const path = imageEntryPath(key, manifest);
    const entry = entries.get(path);
    if (entry) return { path, entry };
    for (const fallbackPath of [
      canonicalImageEntryPath(key, manifest),
      `images/${key}.png`,
      `images/${key}.jpg`,
      `images/${key}.jpeg`,
      `images/${key}.webp`,
      `images/${key}.gif`,
    ]) {
      const fallbackEntry = entries.get(fallbackPath);
      if (fallbackEntry) return { path: fallbackPath, entry: fallbackEntry };
    }
    throw new Error(`Missing File Entry: ${path}`);
  }

  function mimeForImageSource(source) {
    if (isWebImageRef(source) && source.mime) return source.mime;
    if (typeof source === 'string') return dataUrlParts(source).mime;
    return 'image/png';
  }

  function bytesForImageSource(source) {
    if (isWebImageRef(source)) {
      return source.__bytes || null;
    }
    if (typeof source === 'string') return dataUrlToBytes(source);
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    throw new Error('Unsupported Image Source');
  }

  function blobForImageSource(source) {
    if (isWebImageRef(source)) return blobForWebImageRef(source);
    if (isBlobLike(source)) return source;
    const bytes = bytesForImageSource(source);
    if (!bytes || typeof Blob !== 'function') return null;
    return new Blob([bytes], { type: mimeForImageSource(source) });
  }

  async function bytesForImageSourceAsync(source) {
    if (isWebImageRef(source)) {
      const bytes = source.__bytes;
      if (bytes) return bytes;
      const blob = blobForWebImageRef(source);
      if (blob) return new Uint8Array(await blob.arrayBuffer());
    }
    if (isBlobLike(source)) return new Uint8Array(await source.arrayBuffer());
    return bytesForImageSource(source);
  }

  async function recoverMatchingVolatileImageRefsFromContainer(board, rawImageStore = {}, containerBlob) {
    if (!isNativeBlobPart(containerBlob)) {
      return false;
    }
    const directory = await parseCentralDirectoryFromBlob(containerBlob);
    const imageStore = board?.imageStore || {};
    const replacements = [];
    for (const key in imageStore) {
      if (!Object.hasOwn(imageStore, key)) continue;
      const source = rawImageStore[key];
      if (!source?.__blobVolatile || !isBlobLike(source.__blob)) continue;
      const manifest = manifestEntryForKey(board, key);
      const resolved = resolveManifestImageEntry(directory.entries, key, manifest);
      const byteLength = Number(source.bytes || source.__blob.size);
      const expectedIdentity = archivedImageSourceIdentity(source, byteLength);
      const persistedByteLength = zipEntryContentBytes(resolved.entry);
      if (
        !Number.isInteger(expectedIdentity?.crc) ||
        resolved.entry.method !== ZIP_METHOD_STORED ||
        persistedByteLength !== byteLength ||
        (resolved.entry.crc >>> 0) !== (expectedIdentity.crc >>> 0)
      ) {
        throw new Error(`Image Source Changed: ${key}`);
      }
      const blob = await compressedEntryBlob(
        containerBlob,
        resolved.entry,
        source.mime || manifest.mime || 'image/png',
      );
      replacements.push({ source, blob, crc: expectedIdentity.crc });
    }

    for (const replacement of replacements) {
      if (!replaceWebImageRefBlob(
        replacement.source,
        replacement.blob,
        null,
        { volatile: true },
      )) {
        throw new Error('Image Recovery Failed');
      }
      cacheImageSourceArchiveIdentity(
        replacement.source,
        replacement.blob.size,
        replacement.crc,
      );
    }

    return replacements.length > 0;
  }

  async function createBoardContainerBlob(board, rawImageStore = {}, options = {}) {
    const boardJson = JSON.stringify(board);

    const boardBytes = utf8Encode(boardJson);

    const validateBoardPayload = typeof options.validateBoardPayload === 'function'
      ? options.validateBoardPayload
      : null;
    const textCharacters = validateBoardPayload ? boardTextCharacters(board) : 0;

    const validate = (images) => {
      if (!validateBoardPayload) return;

      validateBoardPayload({
        objectCount: board?.objects?.length || 0,
        textCharacters,
        boardJsonBytes: boardBytes.length,
        imageBytes: images,
      });
    };
    validate(0);

    const imageEntries = [];
    const zipEntries = [{ name: 'board.json', data: boardBytes }];
    let imageBytes = 0;

    const imageStore = board?.imageStore || {};
    for (const key in imageStore) {
      if (!Object.hasOwn(imageStore, key)) continue;
      const manifest = manifestEntryForKey(board, key);
      const source = rawImageStore[key];
      const sourceBlob = isWebImageRef(source) && isNativeBlobPart(source.__blob)
        ? source.__blob
        : (isNativeBlobPart(source) ? source : null);
      const bytes = sourceBlob ? null : await bytesForImageSourceAsync(source);
      const data = sourceBlob || bytes;
      if (!data) throw new Error(`Missing Image: ${key}`);
      const byteLength = sourceBlob ? Number(sourceBlob.size) : bytes.length;
      const entry = {
        path: canonicalImageEntryPath(key, manifest),
        source,
        byteLength,
        crc: cachedImageSourceCrc(source, byteLength),
      };
      imageEntries.push(entry);
      imageBytes += byteLength;
      zipEntries.push({ name: entry.path, data, crc: entry.crc });
    }

    validate(imageBytes);

    const zip = await createZipBlob(zipEntries);

    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i];
      const crc = zip.crcs[i + 1];
      cacheImageSourceCrc(entry.source, entry.byteLength, crc);
    }
    return {
      blob: zip.blob,
    };
  }

  async function readBoardContainer(input, options = {}) {
    const directory = await parseCentralDirectoryFromBlob(input);
    const entries = directory.entries;

    const boardEntry = entries.get('board.json');
    if (!boardEntry) throw new Error('Missing File Entry: board.json');
    const validateBoardPayload = typeof options.validateBoardPayload === 'function'
      ? options.validateBoardPayload
      : null;
    const maxBoardContentBytes = Number(options.maxBoardContentBytes);
    if (validateBoardPayload) {
      validateBoardPayload({
        objectCount: 0,
        boardJsonBytes: zipEntryContentBytes(boardEntry),
        imageBytes: 0,
      });
    }

    const boardJsonBytes = await readZipEntry(input, boardEntry, { maxBytes: maxBoardContentBytes });

    const board = JSON.parse(utf8Decode(boardJsonBytes));

    const objectCount = board?.objects?.length || 0;
    const textCharacters = validateBoardPayload ? boardTextCharacters(board) : 0;
    const lazyImageRefs = options.lazyImageRefs === true;
    if (validateBoardPayload) {
      validateBoardPayload({ objectCount, textCharacters, boardJsonBytes: boardJsonBytes.length, imageBytes: 0 });
    }
    const nextSources = {};
    let imageBytes = 0;

    let lazyStoredImageBlobs, recordIndex = 0;
    const records = lazyImageRefs ? [] : null;
    const imageStore = board.imageStore || {};
    const resolve = (key, manifest) => {
      const manifestObject = manifest && typeof manifest === 'object' ? manifest : {};
      const { path, entry } = resolveManifestImageEntry(entries, key, manifestObject);
      const size = zipEntryContentBytes(entry);
      const ext = manifestObject.ext || normalizeImageExt(path.split('.').pop(), manifestObject.mime);
      return { path, entry, size, ext, mime: manifestObject.mime || mimeForExt(ext) };
    };

    if (lazyImageRefs) {
      const tasks = [];
      const seen = new Set();
      for (const key in imageStore) {
        if (!Object.hasOwn(imageStore, key)) continue;
        const record = resolve(key, imageStore[key]);
        records.push(record);
        if (record.entry.method !== ZIP_METHOD_STORED || seen.has(record.path)) continue;
        seen.add(record.path);
        tasks.push(record);
      }
      lazyStoredImageBlobs = new Map();
      let next = 0;
      const workerCount = Math.min(8, tasks.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (next < tasks.length) {
          const task = tasks[next++];
          lazyStoredImageBlobs.set(task.path, await compressedEntryBlob(input, task.entry, task.mime));
        }
      }));
    }
    for (const key in imageStore) {
      if (!Object.hasOwn(imageStore, key)) continue;
      const { path, entry: imageEntry, size: advertisedImageBytes, ext, mime } = records?.[recordIndex++] || resolve(key, imageStore[key]);
      if (path.includes('\0')) throw new Error('Invalid Image Path');
      if (typeof mime !== 'string' || !/^image\/(?:png|jpe?g|webp|gif)$/.test(mime.toLowerCase())) {
        throw new Error(`Unsupported Image Format: ${path}`);
      }
      if (validateBoardPayload) {
        validateBoardPayload({
          objectCount,
          textCharacters,
          boardJsonBytes: boardJsonBytes.length,
          imageBytes: imageBytes + advertisedImageBytes,
        });
      }

      let bytes;
      let imageBlob;
      const canUseLazyRef = lazyImageRefs && imageEntry.method === ZIP_METHOD_STORED;
      if (canUseLazyRef) {
        imageBytes += advertisedImageBytes;
        const untypedBlob = lazyStoredImageBlobs?.get(path);
        if (!untypedBlob) throw new Error(`Missing File Entry: ${path}`);
        imageBlob = untypedBlob.type === mime
          ? untypedBlob
          : untypedBlob.slice(0, untypedBlob.size, mime);
      } else {
        bytes = await readZipEntry(
          input,
          imageEntry,
          {
            maxBytes: maxBoardContentBytes - boardJsonBytes.length - imageBytes,

            verifyCrc: false,
          },
        );

        imageBytes += bytes.length;
      }

      nextSources[key] = canUseLazyRef
        ? createWebImageRef({
            path,
            mime,
            ext,
            blob: imageBlob,
            volatileBlob: true,
            archiveCrc: imageEntry.crc,
          })
        : createWebImageRef({ path, mime, ext, bytes });
    }
    board.imageStore = nextSources;
    return { board };
  }

  const api = Object.freeze({
    createBoardContainerBlob,
    createWebImageRef,
    createZipBlob,
    blobForImageSource,
    bytesForImageSource,
    bytesForImageSourceAsync,
    dataUrlByteLength,
    isWebImageRef,
    readBoardContainer,
    recoverMatchingVolatileImageRefsFromContainer,
    snapshotImageBlob,
    stabilizeVolatileImageRefs,
  });

  root.BoardfishWebBoardContainer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
