"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../shared/core.js");
const classroomMaterial = require("./fixtures/classroom-material.js");

test("rejects generic type labels and keeps supplied extensions", () => {
  assert.equal(Core.isGenericName("PDF.pdf"), true);
  assert.deepEqual(Core.resolveFilename(["Video", "Annual report.pdf"], "application/pdf"), { name: "Annual report.pdf", confidence: "high", warning: "" });
  assert.equal(Core.resolveFilename(["Document"], "").confidence, "low");
});
test("adds a known extension only when absent and does not double it", () => {
  assert.equal(Core.ensureExtension("homework", "application/pdf"), "homework.pdf");
  assert.equal(Core.ensureExtension("homework.PDF", "application/pdf"), "homework.PDF");
  assert.equal(Core.ensureExtension("scan.jpg", "application/pdf"), "scan.jpg");
});
test("recognizes HTML attachments from their filename and Classroom type hint", () => {
  assert.equal(Core.typeFromMetadata("Lecture.html"), "html");
  assert.equal(Core.typeFromMetadata("Lecture.htm"), "html");
  assert.equal(Core.typeFromMetadata("Lecture", "", "HTML"), "html");
  assert.equal(Core.resolveFilename(["Lecture"], "text/html").name, "Lecture.html");
});
test("preserves Bangla and Unicode while sanitizing invalid path characters", () => {
  assert.equal(Core.sanitizeSegment("বাংলা: গণিত?"), "বাংলা_ গণিত_");
  assert.equal(Core.organizePath("EkClick/{course}/{topic}", "বাংলা", "সপ্তাহ/১", "পাঠ.pdf"), "EkClick/বাংলা/সপ্তাহ_১/পাঠ.pdf");
  assert.equal(Core.organizePath(".", "বাংলা", "সপ্তাহ/১", "পাঠ.pdf"), "পাঠ.pdf");
});
test("avoids duplicate names without changing extensions", () => {
  const used = new Set();
  assert.equal(Core.uniqueName("notes.pdf", used), "notes.pdf");
  assert.equal(Core.uniqueName("notes.pdf", used), "notes (2).pdf");
  assert.equal(Core.uniqueName("notes.pdf", used), "notes (3).pdf");
});
test("filtering combines filename search and file type", () => {
  const files = [{ name: "Week 1.pdf" }, { name: "Week 2.mp4" }, { name: "Notes.txt" }];
  assert.deepEqual(Core.filterFiles(files, "week", "pdf"), [files[0]]);
  assert.deepEqual(Core.filterFiles(files, "", "video"), [files[1]]);
});
test("Download Manager history sorts newest records first without mutating storage order", () => {
  const items = [{ name: "older", createdAt: 10 }, { name: "newer", createdAt: 30 }, { name: "middle", createdAt: 20 }];
  assert.deepEqual(Core.newestFirst(items).map(item => item.name), ["newer", "middle", "older"]);
  assert.deepEqual(items.map(item => item.name), ["older", "newer", "middle"]);
});
test("settings use defaults for invalid values and retain local preferences", () => {
  const settings = Core.normalizeSettings({ theme: "neon", mode: "zip", duplicate: "overwrite", compact: true });
  assert.equal(settings.downloadMethod, "folder");
  assert.equal(Core.normalizeSettings({ downloadMethod: "browser" }).downloadMethod, "browser");
  assert.equal(Core.normalizeSettings({ downloadMethod: "folder" }).downloadMethod, "folder");
  assert.equal(Core.normalizeSettings({ downloadMethod: "unknown" }).downloadMethod, "folder");
  assert.equal(Core.normalizeSettings({ folderTemplate: "." }).folderTemplate, ".");
  assert.equal(Core.normalizeSettings({ folderTemplate: "anything-else" }).folderTemplate, "EkClick/{course}/{topic}");
  assert.equal(settings.theme, "system");
  assert.equal(settings.mode, "zip");
  assert.equal(Core.normalizeSettings({}).mode, "individual");
  assert.equal(settings.duplicate, "rename");
  assert.equal(settings.compact, true);
});
test("queue transitions cover start, completion, failure, retry and cancellation", () => {
  assert.equal(Core.queueTransition("queued", "start"), "downloading");
  assert.equal(Core.queueTransition("downloading", "complete"), "complete");
  assert.equal(Core.queueTransition("downloading", "fail"), "failed");
  assert.equal(Core.queueTransition("failed", "enqueue"), "queued");
  assert.equal(Core.queueTransition("queued", "cancel"), "skipped");
  assert.equal(Core.queueTransition("complete", "fail"), "complete");
});
test("recognizes Classroom material detail routes including account prefixes", () => {
  assert.equal(Core.isClassroomPostRoute(classroomMaterial.url), true);
  assert.equal(Core.isClassroomPostRoute("https://classroom.google.com/c/course-42/a/post-3/details"), true);
  assert.equal(Core.isClassroomPostRoute("https://classroom.google.com/c/course-42/w/work-3/details"), true);
  assert.equal(Core.isClassroomPostRoute("https://classroom.google.com/u/0/c/course-42"), false);
  assert.equal(Core.isClassroomPostRoute("https://drive.google.com/file/d/file-1/view"), false);
});
test("classroom page key ignores query and fragment but distinguishes posts", () => {
  const first = "https://classroom.google.com/u/3/c/course/m/post-1/details";
  const second = "https://classroom.google.com/u/3/c/course/m/post-2/details";
  const firstKey = Core.classroomPageKey(`${first}?authuser=3#section`);
  const secondKey = Core.classroomPageKey(second);
  assert.equal(firstKey, first);
  assert.notEqual(firstKey, secondKey);
});
test("discovers multiple Drive video and PDF attachments, preserves names, and deduplicates by file ID", () => {
  const result = Core.discoverAttachments(classroomMaterial.descriptors, {
    supportedPage: true, postContainerFound: true, course: classroomMaterial.course,
    topic: classroomMaterial.topic, url: classroomMaterial.url
  });
  assert.equal(result.files.length, 7); // four unique Drive files plus native Docs/Sheets/Slides entries
  assert.deepEqual(result.files.map(file => file.name), ["Motion lecture 04.mp4", "Worksheet A.pdf", "Worksheet B.pdf", "Problem set.pdf", "Lab notes", "Budget.xlsx", "Seminar.pptx"]);
  assert.deepEqual(result.files.slice(0, 4).map(file => file.type), ["video", "pdf", "pdf", "pdf"]);
  assert.ok(result.files.slice(0, 4).every(file => file.supported));
  assert.ok(result.files.slice(4).every(file => !file.supported)); // detected, but export is intentionally not implemented
  assert.ok(result.files.every(file => file.course === classroomMaterial.course && file.topic === classroomMaterial.topic));
  assert.equal(result.diagnostics.eligibleLinks, 8); // includes the repeated Drive URL
  assert.equal(result.diagnostics.reason, "ok");
});
test("ignores irrelevant page links and rejects generic attachment labels", () => {
  const result = Core.discoverAttachments(classroomMaterial.descriptors, { supportedPage: true, postContainerFound: true });
  assert.ok(result.files.every(file => !["Class folder", "Course navigation", "Profile"].includes(file.name)));
  assert.equal(Core.resolveFilename(["PDF", "Video", "Document"], "").confidence, "low");
  assert.equal(Core.resolveFilename(["Open PDF", "Worksheet C.pdf"], "application/pdf").name, "Worksheet C.pdf");
});
test("reports unsupported pages, missing post containers and empty discovery distinctly", () => {
  const unsupported = Core.discoverAttachments(classroomMaterial.descriptors, { supportedPage: false, postContainerFound: false });
  const missing = Core.discoverAttachments(classroomMaterial.descriptors, { supportedPage: true, postContainerFound: false });
  const empty = Core.discoverAttachments([], { supportedPage: true, postContainerFound: true });
  assert.equal(unsupported.diagnostics.reason, "unsupported_page");
  assert.equal(missing.diagnostics.reason, "post_container_not_found");
  assert.equal(empty.diagnostics.reason, "empty_post");
  assert.deepEqual(empty.files, []);
});
test("empty and malformed descriptors do not throw and report no eligible links", () => {
  const result = Core.discoverAttachments([null, {}, { url: "javascript:alert(1)" }, { url: "https://drive.google.com/drive/folders/1" }], { supportedPage: true, postContainerFound: true });
  assert.deepEqual(result.files, []);
  assert.equal(result.diagnostics.reason, "no_eligible_attachment_links");
});
