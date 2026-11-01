(function (root) {
  "use strict";
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[n] = value >>> 0;
    }
    return table;
  })();
  const encoder = new TextEncoder();
  function header(signature, size) {
    const bytes = new Uint8Array(size);
    new DataView(bytes.buffer).setUint32(0, signature, true);
    return bytes;
  }
  function crcUpdate(crc, bytes) {
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return crc >>> 0;
  }
  function localHeader(name) {
    const nameBytes = encoder.encode(name);
    const bytes = header(0x04034b50, 30 + nameBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 20, true); view.setUint16(6, 0x0808, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, 0, true); view.setUint32(18, 0, true); view.setUint32(22, 0, true);
    view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true); bytes.set(nameBytes, 30);
    return bytes;
  }
  function dataDescriptor(crc, size) {
    const bytes = header(0x08074b50, 16); const view = new DataView(bytes.buffer);
    view.setUint32(4, crc, true); view.setUint32(8, size, true); view.setUint32(12, size, true);
    return bytes;
  }
  function centralHeader(entry) {
    const nameBytes = encoder.encode(entry.name);
    const bytes = header(0x02014b50, 46 + nameBytes.length); const view = new DataView(bytes.buffer);
    view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x0808, true);
    view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true); view.setUint32(20, entry.size, true); view.setUint32(24, entry.size, true);
    view.setUint16(28, nameBytes.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true);
    view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true); bytes.set(nameBytes, 46);
    return bytes;
  }
  function endRecord(count, centralSize, centralOffset) {
    const bytes = header(0x06054b50, 22); const view = new DataView(bytes.buffer);
    view.setUint16(4, 0, true); view.setUint16(6, 0, true); view.setUint16(8, count, true); view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, centralOffset, true); view.setUint16(20, 0, true);
    return bytes;
  }
  async function writeArchive(item, rootDirectory, settings = {}, options = {}) {
    const files = Array.isArray(item.archiveFiles) ? item.archiveFiles : [];
    if (!files.length) throw new Error("This ZIP batch has no files to archive.");
    if (files.length > 65535) throw new Error("This ZIP archive exceeds the supported file count.");
    const relativePath = typeof item.path === "string" && item.path ? item.path : Core.organizePath(settings.folderTemplate, item.course, item.topic, item.name);
    const parts = relativePath.split("/").filter(Boolean);
    const archiveName = parts.pop() || "Classroom files.zip";
    const directory = await EkClickDownload.subdirectory(rootDirectory, parts);
    const target = await EkClickDownload.uniqueTarget(directory, archiveName, options.usedNames || new Set(), "rename");
    const fileHandle = await directory.getFileHandle(target.name, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    let offset = 0, written = 0, committed = false;
    const entries = [], usedNames = new Set();
    const push = async bytes => { await writable.write(bytes); offset += bytes.byteLength; };
    try {
      for (let index = 0; index < files.length; index++) {
        if (options.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        const file = files[index];
        let verified;
        try { verified = await EkClickDownload.getVerifiedResponse(file, { ...options, referrer: file.referrer || options.referrer }); }
        catch (error) {
          if (error?.name === "AbortError") throw error;
          throw new Error(`Could not add "${file.name || `file ${index + 1}`}" to the ZIP: ${error?.message || "Drive download failed."}`);
        }
        const { response, contentType, totalBytes, suggestedName } = verified;
        const reader = response.body.getReader();
        const prefixChunks = []; let prefixLength = 0;
        try {
          while (prefixLength < 1024) {
            const next = await reader.read();
            if (next.done) break;
            prefixChunks.push(next.value); prefixLength += next.value.byteLength;
          }
          const prefix = new Uint8Array(Math.min(prefixLength, 1024)); let prefixOffset = 0;
          for (const chunk of prefixChunks) { const count = Math.min(chunk.byteLength, prefix.length - prefixOffset); if (count > 0) { prefix.set(chunk.subarray(0, count), prefixOffset); prefixOffset += count; } }
          EkClickDownload.validatePrefix(prefix, file.type, contentType);
          let filename = !file.renamed && EkClickDownload.usableSuggestedName(suggestedName) ? suggestedName : file.name;
          filename = Core.sanitizeSegment(filename, "download");
          if (usedNames.has(filename.toLocaleLowerCase()) && (file.duplicate || settings.duplicate) === "skip") continue;
          filename = Core.uniqueName(filename, usedNames);
          const entry = { name: filename, offset, size: 0, crc: 0xffffffff };
          await push(localHeader(filename));
          const writeData = async chunk => {
            if (options.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
            entry.size += chunk.byteLength;
            if (entry.size + chunk.byteLength > 0xffffffff || offset + chunk.byteLength > 0xffffffff) throw new Error("A file is too large for this ZIP format (4 GB maximum per file/archive). Use Individual files instead.");
            entry.crc = crcUpdate(entry.crc, chunk);
            await push(chunk); written += chunk.byteLength;
            const estimatedTotal = totalBytes ? Math.max(totalBytes, written) : written;
            const progress = Math.min(99, Math.round(((index + (totalBytes ? Math.min(entry.size / totalBytes, 0.99) : 0.5)) / files.length) * 100));
            await options.onProgress?.({ progress, bytesWritten: written, totalBytes: estimatedTotal, message: `Adding file ${index + 1} of ${files.length} to ZIP…` });
          };
          for (const chunk of prefixChunks) await writeData(chunk);
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            await writeData(next.value);
          }
          entry.crc = (entry.crc ^ 0xffffffff) >>> 0;
          await push(dataDescriptor(entry.crc, entry.size));
          entries.push(entry);
        } finally { await reader.cancel().catch(() => {}); }
      }
      const centralOffset = offset;
      for (const entry of entries) await push(centralHeader(entry));
      const centralSize = offset - centralOffset;
      if (offset > 0xffffffff || centralSize > 0xffffffff) throw new Error("This ZIP archive exceeds the supported 4 GB size. Use Individual files instead.");
      await push(endRecord(entries.length, centralSize, centralOffset));
      await writable.close(); committed = true;
      return { state: "complete", name: target.name, actualName: target.name, destinationName: rootDirectory.name || "Selected folder", path: [...parts, target.name].join("/"), progress: 100, bytesWritten: offset, totalBytes: offset, message: `ZIP archive created with ${entries.length} file${entries.length === 1 ? "" : "s"}.` };
    } catch (error) {
      await writable.abort(error).catch(() => {});
      await directory.removeEntry(target.name).catch(() => {});
      throw error;
    } finally {
      if (!committed) await writable.abort().catch(() => {});
    }
  }
  const api = { writeArchive, crcUpdate };
  root.EkClickZip = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
