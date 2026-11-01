"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../shared/core.js");
const Download = require("../shared/download.js");
const Zip = require("../shared/zip.js");

class MemoryDirectory {
  constructor(name = "root") { this.name = name; this.entries = new Map(); }
  async getDirectoryHandle(name, options = {}) {
    if (!this.entries.has(name)) { if (!options.create) throw new DOMException("Missing", "NotFoundError"); this.entries.set(name, new MemoryDirectory(name)); }
    return this.entries.get(name);
  }
  async getFileHandle(name, options = {}) {
    if (!this.entries.has(name)) { if (!options.create) throw new DOMException("Missing", "NotFoundError"); this.entries.set(name, new MemoryFile(name)); }
    return this.entries.get(name);
  }
  async removeEntry(name) { this.entries.delete(name); }
}
class MemoryFile {
  constructor(name) { this.name = name; this.chunks = []; this.bytes = new Uint8Array(); }
  async createWritable() {
    return {
      write: async chunk => this.chunks.push(new Uint8Array(chunk)),
      close: async () => { const size = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0); this.bytes = new Uint8Array(size); let offset = 0; for (const chunk of this.chunks) { this.bytes.set(chunk, offset); offset += chunk.length; } },
      abort: async () => { this.chunks = []; }
    };
  }
}
function fileResponse(bytes) {
  return new Response(bytes, { headers: { "content-type": "application/pdf" } });
}
function signature(bytes, offset, value) { return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === value; }

test("creates a valid store-only ZIP in the selected project root", async () => {
  const destination = new MemoryDirectory("TECH");
  const fileBytes = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32])];
  const files = fileBytes.map((_, index) => ({ url: `https://drive.google.com/file/d/id${index}/view`, name: `notes-${index}.pdf`, type: "pdf", referrer: "https://classroom.google.com/u/3/c/course/m/post" }));
  const result = await Zip.writeArchive({ name: "Current post.zip", course: "Course", topic: "Current post", archiveFiles: files }, destination, { folderTemplate: "." }, {
    fetchImpl: async url => fileResponse(fileBytes[Number(new URL(url).searchParams.get("id").replace("id", ""))])
  });
  const archive = (await destination.getFileHandle("Current post.zip")).bytes;
  assert.equal(result.state, "complete");
  assert.equal(result.path, "Current post.zip");
  assert.equal(signature(archive, 0, 0x04034b50), true);
  assert.equal(signature(archive, archive.length - 22, 0x06054b50), true);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let offset = 0;
  for (let index = 0; index < fileBytes.length; index++) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const nameLength = view.getUint16(offset + 26, true);
    const dataOffset = offset + 30 + nameLength;
    const name = new TextDecoder().decode(archive.subarray(offset + 30, dataOffset));
    assert.equal(name, `notes-${index}.pdf`);
    assert.deepEqual(archive.subarray(dataOffset, dataOffset + fileBytes[index].length), fileBytes[index]);
    const descriptorOffset = dataOffset + fileBytes[index].length;
    assert.equal(view.getUint32(descriptorOffset, true), 0x08074b50);
    assert.equal(view.getUint32(descriptorOffset + 4, true), (Zip.crcUpdate(0xffffffff, fileBytes[index]) ^ 0xffffffff) >>> 0);
    assert.equal(view.getUint32(descriptorOffset + 8, true), fileBytes[index].length);
    offset = descriptorOffset + 16;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(archive.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(archive.length - 22 + 10, true), 2);
});

test("includes a real HTML attachment in a ZIP without treating its contents as a Drive preview", async () => {
  const destination = new MemoryDirectory("Course Downloads");
  const html = "<!doctype html><html><body><h1>Python tuples lesson</h1></body></html>";
  const result = await Zip.writeArchive({ name: "HTML lesson.zip", archiveFiles: [{
    url: "https://drive.google.com/file/d/html-lesson/view", name: "Lesson.html", type: "html"
  }] }, destination, { folderTemplate: "." }, {
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html", "content-disposition": 'attachment; filename="Lesson.html"' } })
  });
  assert.equal(result.state, "complete");
  const archive = (await destination.getFileHandle("HTML lesson.zip")).bytes;
  const content = new TextDecoder().decode(archive);
  assert.ok(content.includes("Lesson.html"));
  assert.ok(content.includes("Python tuples lesson"));
});

test("ZIP verification rejects a Drive error page and leaves no partial archive", async () => {
  const destination = new MemoryDirectory();
  const file = { url: "https://drive.google.com/file/d/private/view", name: "private.pdf", type: "pdf" };
  await assert.rejects(() => Zip.writeArchive({ name: "Private.zip", archiveFiles: [file] }, destination, { folderTemplate: "." }, {
    fetchImpl: async () => new Response("<html>no access</html>", { headers: { "content-type": "text/html" } })
  }), /HTML|web page|response/i);
  assert.equal(destination.entries.has("Private.zip"), false);
});

test("identifies the source attachment that caused a ZIP download failure", async () => {
  const destination = new MemoryDirectory();
  const file = { url: "https://drive.google.com/file/d/missing/view", name: "Lecture.html", type: "html" };
  await assert.rejects(() => Zip.writeArchive({ name: "Course files.zip", archiveFiles: [file] }, destination, { folderTemplate: "." }, {
    fetchImpl: async () => new Response("<html><body>Error 404 (Not Found)</body></html>", { status: 404, headers: { "content-type": "text/html" } })
  }), /Lecture\.html.*HTTP 404/);
  assert.equal(destination.entries.has("Course files.zip"), false);
});
