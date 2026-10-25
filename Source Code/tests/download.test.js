"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../shared/core.js");
const Download = require("../shared/download.js");
const Directory = require("../shared/directory-store.js");
const BatchDraft = require("../shared/batch-draft.js");
const QueueResult = require("../shared/queue-result.js");

class MemoryDirectory {
  constructor(name = "root") { this.name = name; this.kind = "directory"; this.entries = new Map(); }
  async getDirectoryHandle(name, options = {}) {
    if (!this.entries.has(name)) {
      if (!options.create) throw new DOMException("Missing", "NotFoundError");
      this.entries.set(name, new MemoryDirectory(name));
    }
    const value = this.entries.get(name);
    if (!(value instanceof MemoryDirectory)) throw new DOMException("Not a directory", "TypeMismatchError");
    return value;
  }
  async getFileHandle(name, options = {}) {
    if (!this.entries.has(name)) {
      if (!options.create) throw new DOMException("Missing", "NotFoundError");
      this.entries.set(name, new MemoryFile(name));
    }
    const value = this.entries.get(name);
    if (!(value instanceof MemoryFile)) throw new DOMException("Not a file", "TypeMismatchError");
    return value;
  }
}
class MemoryFile {
  constructor(name) { this.name = name; this.kind = "file"; this.bytes = new Uint8Array(); }
  async createWritable() {
    const chunks = [];
    return {
      write: async chunk => { chunks.push(new Uint8Array(chunk)); },
      close: async () => { const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); this.bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { this.bytes.set(chunk, offset); offset += chunk.length; } },
      abort: async () => { chunks.length = 0; }
    };
  }
}
function response(body, { status = 200, type = "application/pdf", url = "https://drive.google.com/uc?export=download&id=abc", headers = {} } = {}) {
  const result = new Response(body, { status, headers: { "content-type": type, ...headers } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function pdfBytes(fill = 0x41, size = 32) { const bytes = new Uint8Array(size).fill(fill); bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); return bytes; }
function mp4Bytes(size = 32) { const bytes = new Uint8Array(size).fill(0x41); bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); return bytes; }
const pdf = (name = "notes.pdf", id = "abc", extra = {}) => ({ url: `https://drive.google.com/file/d/${id}/view`, type: "pdf", name, path: `Course/Topic/${name}`, confidence: "high", ...extra });

test("resolves supported Drive attachment URLs and retains resource keys", () => {
  assert.equal(Download.buildDownloadUrl("https://drive.google.com/file/d/abc/view?resourcekey=rk"), "https://drive.google.com/uc?export=download&id=abc&confirm=t&resourcekey=rk");
  assert.equal(Download.buildDownloadUrl("https://drive.google.com/file/d/abc/view", { referrer: "https://classroom.google.com/u/3/c/course/m/material" }), "https://drive.google.com/uc?export=download&id=abc&confirm=t&authuser=3");
  assert.equal(Download.buildDownloadUrl("https://drive.google.com/file/d/abc/view?authuser=1", { referrer: "https://classroom.google.com/u/3/c/course/m/material" }), "https://drive.google.com/uc?export=download&id=abc&confirm=t&authuser=1");
  assert.equal(Download.buildDownloadUrl("https://drive.usercontent.google.com/download?id=abc&export=download", { referrer: "https://classroom.google.com/u/3/c/course/m/material" }), "https://drive.usercontent.google.com/download?id=abc&export=download&authuser=3");
  assert.equal(Download.classroomAccountIndex("https://classroom.google.com/u/3/c/course/m/material"), "3");
  assert.equal(Download.classroomAccountIndex("https://example.com/u/3/page"), "");
  assert.equal(Download.buildDownloadUrl("https://drive.usercontent.google.com/download?id=abc&export=download"), "https://drive.usercontent.google.com/download?id=abc&export=download");
  assert.throws(() => Download.buildDownloadUrl("https://example.com/file.pdf"), /not a supported/);
});

test("saves verified PDF content directly and prefers the original server filename unless the user renamed it", async () => {
  const destination = new MemoryDirectory("IELTS");
  const fetchCalls = [];
  const result = await Download.downloadToDirectory(pdf("classroom label.pdf"), destination, {}, {
    referrer: "https://classroom.google.com/c/course/m/material/m/details",
    fetchImpl: async (url, init) => { fetchCalls.push({ url, init }); return response(pdfBytes(), { headers: { "content-disposition": "attachment; filename*=UTF-8''source%20name.pdf", "content-length": "32" } }); }
  });
  const folder = await (await destination.getDirectoryHandle("Course")).getDirectoryHandle("Topic");
  assert.equal(result.state, "complete");
  assert.equal(result.name, "source name.pdf");
  assert.deepEqual([...((await folder.getFileHandle("source name.pdf")).bytes)], [...pdfBytes()]);
  assert.equal(fetchCalls[0].init.credentials, "include");
  assert.equal(fetchCalls[0].init.referrer, "https://classroom.google.com/c/course/m/material/m/details");
  assert.equal(fetchCalls[0].init.referrerPolicy, "strict-origin-when-cross-origin");
});

test("keeps a user-reviewed filename over the server suggestion and ignores generic server names", async () => {
  const destination = new MemoryDirectory();
  const fetchImpl = async () => response(pdfBytes(), { headers: { "content-disposition": 'attachment; filename="download.pdf"' } });
  const renamed = await Download.downloadToDirectory(pdf("my reviewed name.pdf", "abc", { renamed: true }), destination, {}, { fetchImpl });
  assert.equal(renamed.name, "my reviewed name.pdf");
  const another = new MemoryDirectory();
  const sourceTitle = await Download.downloadToDirectory(pdf("classroom source.pdf"), another, {}, { fetchImpl });
  assert.equal(sourceTitle.name, "classroom source.pdf");
});

test("streams MP4 chunks, updates progress, and retains the requested extension", async () => {
  const destination = new MemoryDirectory();
  const chunks = [mp4Bytes(256 * 1024), new Uint8Array(256 * 1024).fill(7)];
  const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  const progress = [];
  const result = await Download.downloadToDirectory({ url: "https://drive.google.com/file/d/abc/view", type: "video", name: "lecture.mp4", path: "Course/Topic/lecture.mp4", confidence: "high" }, destination, {}, {
    fetchImpl: async () => response(body, { type: "video/mp4", headers: { "content-length": String(chunks.reduce((n, x) => n + x.length, 0)) } }),
    onProgress: value => progress.push(value)
  });
  assert.equal(result.name, "lecture.mp4");
  assert.equal(result.bytesWritten, 512 * 1024);
  assert.ok(progress.length >= 1);
  const saved = await (await (await destination.getDirectoryHandle("Course")).getDirectoryHandle("Topic")).getFileHandle("lecture.mp4");
  assert.equal(saved.bytes.length, 512 * 1024);
  assert.deepEqual([...saved.bytes.subarray(0, 8)], [...mp4Bytes().subarray(0, 8)]);
});

test("rejects HTML preview, login, and referer-block pages rather than saving them", async t => {
  for (const [html, expected] of [
    ["<html><body>Drive preview</body></html>", /HTML|preview/],
    ["<html><body>Sign in to continue</body></html>", /sign-in page/i],
    ["<html><body>Requests from referer null are blocked.</body></html>", /Classroom referrer/i]
  ]) {
    await t.test(expected.toString(), async () => {
      const destination = new MemoryDirectory();
      await assert.rejects(() => Download.downloadToDirectory(pdf(), destination, {}, { fetchImpl: async () => response(html, { type: "text/html" }) }), expected);
      assert.equal(destination.entries.size, 0);
    });
  }
});

test("keeps HTTP authorization failures visible as failures", async () => {
  await assert.rejects(
    () => Download.getVerifiedResponse(pdf(), { fetchImpl: async () => response("<html>Access denied</html>", { status: 403, type: "text/html" }) }),
    /Drive denied this request \(HTTP 403\)/
  );
});

test("follows one legitimate Google Drive confirmation form and rejects untrusted final redirects", async () => {
  const destination = new MemoryDirectory();
  const urls = [];
  const result = await Download.downloadToDirectory(pdf(), destination, {}, { fetchImpl: async url => {
    urls.push(url);
    if (urls.length === 1) return response('<html><form action="https://drive.google.com/uc" method="get"><input type="hidden" name="id" value="abc"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"></form></html>', { type: "text/html" });
    return response(pdfBytes(), { url: "https://drive.google.com/uc?export=download&id=abc&confirm=t" });
  } });
  assert.equal(result.state, "complete");
  assert.equal(urls.length, 2);
  assert.match(urls[1], /confirm=t/);
  await assert.rejects(() => Download.getVerifiedResponse(pdf(), { fetchImpl: async () => response(pdfBytes(), { url: "https://evil.example/file.pdf" }) }), /outside a trusted/);
});

test("renames existing duplicates and can skip them without overwriting", async () => {
  const destination = new MemoryDirectory();
  const folder = await destination.getDirectoryHandle("Course", { create: true });
  const topic = await folder.getDirectoryHandle("Topic", { create: true });
  const existing = await topic.getFileHandle("notes.pdf", { create: true });
  existing.bytes = pdfBytes(0x5a);
  const fetchImpl = async () => response(pdfBytes());
  const renamed = await Download.downloadToDirectory(pdf(), destination, {}, { fetchImpl });
  assert.equal(renamed.name, "notes (2).pdf");
  assert.deepEqual([...existing.bytes], [...pdfBytes(0x5a)]);
  const skipped = await Download.downloadToDirectory(pdf("notes.pdf", "abc", { duplicate: "skip" }), destination, {}, { fetchImpl });
  assert.equal(skipped.state, "skipped");
  assert.deepEqual([...existing.bytes], [...pdfBytes(0x5a)]);
});

test("writes several batch files independently and leaves one failed item visible to the caller", async () => {
  const destination = new MemoryDirectory();
  const files = [pdf("one.pdf", "abc"), pdf("bad.pdf", "bad"), pdf("three.pdf", "xyz")];
  const outcomes = await Promise.allSettled(files.map(file => Download.downloadToDirectory(file, destination, {}, { fetchImpl: async () => file.name === "bad.pdf" ? response("<html>no access</html>", { type: "text/html" }) : response(pdfBytes()) })));
  assert.deepEqual(outcomes.map(result => result.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(outcomes[1].reason.message.includes("HTML"), true);
  assert.equal((await (await (await destination.getDirectoryHandle("Course")).getDirectoryHandle("Topic")).getFileHandle("one.pdf")).bytes.length, 32);
  assert.equal((await (await (await destination.getDirectoryHandle("Course")).getDirectoryHandle("Topic")).getFileHandle("three.pdf")).bytes.length, 32);
});

test("handles directory selection, IndexedDB-adapter persistence, and permission revocation", async () => {
  const data = new Map();
  const store = Directory.createDirectoryStore({ get: async key => data.get(key), set: async (key, value) => data.set(key, value), delete: async key => data.delete(key) });
  const handle = new MemoryDirectory("Chosen");
  handle.queryPermission = async () => "prompt";
  let currentPermission = "prompt";
  handle.queryPermission = async () => currentPermission;
  handle.requestPermission = async () => { currentPermission = "denied"; return currentPermission; };
  const picked = await Directory.pickAndStore({ showDirectoryPicker: async options => { assert.deepEqual(options, { mode: "readwrite" }); return handle; } }, store);
  assert.equal((await store.get()), picked);
  assert.equal(await Directory.queryWritePermission(picked), "prompt");
  assert.equal(await Directory.requestWritePermission(picked), "denied");
  handle.requestPermission = async () => { currentPermission = "granted"; return currentPermission; };
  assert.equal(await Directory.requestWritePermission(picked), "granted");
  assert.equal(await Directory.queryWritePermission(picked), "granted");
  await assert.rejects(() => Directory.pickAndStore({}, store), /will not fall back to Downloads/);
});

test("enables Choose Folder whenever the picker exists, and explains unsupported extension contexts", () => {
  const supported = { secureContext: true, pickerAvailable: true, indexedDbAvailable: true };
  assert.equal(Directory.chooseFolderDisabled(supported), false);
  assert.equal(Directory.evaluateBatchGate({ capabilities: supported }), "folder-required");
  assert.equal(Directory.pickerStatusMessage(supported), "The folder picker and local handle storage are available in this extension page.");
  const unavailable = { secureContext: true, pickerAvailable: false, indexedDbAvailable: true };
  assert.equal(Directory.chooseFolderDisabled(unavailable), true);
  assert.match(Directory.pickerStatusMessage(unavailable), /A site permission cannot enable a missing browser API/);
  assert.equal(Directory.evaluateBatchGate({ capabilities: unavailable }), "folder-picker-unavailable");
});

test("blocks Download All before Drive permission when there is no folder, then allows a saved folder after access is granted", () => {
  let sitePermissionRequests = 0;
  const capabilities = { pickerAvailable: true, indexedDbAvailable: true };
  const noFolder = Directory.evaluateBatchGate({ capabilities, handle: null, drivePermission: false });
  if (noFolder === "drive-permission-required") sitePermissionRequests++;
  assert.equal(noFolder, "folder-required");
  assert.equal(sitePermissionRequests, 0);
  const selectedHandle = new MemoryDirectory("Chosen");
  assert.equal(Directory.evaluateBatchGate({ capabilities, handle: selectedHandle, writePermission: "granted", drivePermission: true }), "ready");
  assert.equal(sitePermissionRequests, 0);
});

test("retains attachment selection while Settings is opened and restores it on the same Classroom post", () => {
  const files = [{ id: "file:a", supported: true }, { id: "file:b", name: "Reviewed.pdf", renamed: true, supported: true }, { id: "file:c", supported: false }];
  const pageUrl = "https://classroom.google.com/c/abc/m/post/details?authuser=0";
  const draft = BatchDraft.makeDraft(files, new Set(["file:b"]), pageUrl, 1000);
  assert.deepEqual(BatchDraft.restoreSelection(files, draft, "https://classroom.google.com/c/abc/m/post/details?authuser=1", 2000), ["file:b"]);
  assert.deepEqual(BatchDraft.restoreSelection(files, draft, "https://classroom.google.com/c/else/m/post/details", 2000), ["file:a", "file:b"]);
  const rediscovered = [{ id: "file:a", supported: true }, { id: "file:b", name: "Detected.pdf", supported: true }];
  BatchDraft.restoreRenames(rediscovered, draft, pageUrl, 2000);
  assert.equal(rediscovered[1].name, "Reviewed.pdf");
  assert.equal(rediscovered[1].renamed, true);
});

test("maps verified downloads and failures to visible Download Manager states", () => {
  assert.deepEqual(QueueResult.fromSuccess({ state: "complete", name: "notes.pdf", path: "Course/notes.pdf", progress: 100, bytesWritten: 32, totalBytes: 32, message: "Verified content saved." }), {
    state: "complete", progress: 100, bytesWritten: 32, totalBytes: 32, actualName: "notes.pdf", path: "Course/notes.pdf", message: "Verified content saved."
  });
  assert.deepEqual(QueueResult.fromFailure(new Error("Google returned a sign-in page.")), { state: "failed", message: "Google returned a sign-in page." });
  assert.deepEqual(QueueResult.fromFailure(new DOMException("Cancelled", "AbortError")), { state: "skipped", message: "Cancelled by the user." });
});

