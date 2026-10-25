"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../shared/core.js");
const stream = require("./fixtures/classroom-stream.js");
const material = require("./fixtures/classroom-material.js");

function matches(element, selector) {
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0]?.toLowerCase();
  if (tag && element.tagName !== tag) return false;
  for (const [, attr, expected] of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    if (!(attr in element.attrs)) return false;
    if (expected !== undefined && String(element.attrs[attr]) !== expected) return false;
  }
  return true;
}
class Node {
  constructor(tag, attrs = {}, text = "") { this.tagName = tag.toLowerCase(); this.attrs = { ...attrs }; this.text = text; this.children = []; this.parentElement = null; }
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name) { return this.attrs[name] == null ? null : String(this.attrs[name]); }
  get href() { return this.attrs.href || ""; }
  get textContent() { return [this.text, ...this.children.map(child => child.textContent)].filter(Boolean).join(" "); }
  get innerText() { return this.textContent; }
  getClientRects() { return [1]; }
  matches(selector) { return selector.split(",").some(part => matches(this, part.trim())); }
  querySelectorAll(selector) {
    const parts = selector.split(",").map(part => part.trim());
    const found = [];
    const visit = node => { for (const child of node.children) { if (parts.some(part => matches(child, part))) found.push(child); visit(child); } };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  contains(other) { return this === other || this.children.some(child => child.contains(other)); }
}
function runDiscover(body, url) {
  const document = {
    body,
    title: "Classroom",
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector)
  };
  const sandbox = { Core, document, location: { href: url, pathname: new URL(url).pathname }, window: { addEventListener() {} }, chrome: { runtime: { onMessage: { addListener() {} } } }, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), console, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"), sandbox);
  return sandbox.module.exports.discover();
}
function driveLink(file) {
  return new Node("a", { href: `https://drive.google.com/file/d/${file.id}/view?usp=classroom_web`, "aria-label": file.label, title: file.name }, file.name);
}

test("Stream discovery groups inline files by announcement and preserves original metadata", () => {
  const body = new Node("body");
  body.append(new Node("h1", {}, stream.course));
  body.append(new Node("a", { href: "https://classroom.google.com/u/3/c/course-42/stream" }, "Stream navigation"));
  body.append(new Node("a", { href: "https://drive.google.com/drive/folders/navigation-only" }, "Drive navigation"));
  body.append(new Node("div", { "data-course-name": stream.course }, stream.course));
  for (const announcement of stream.announcements) {
    const card = body.append(new Node("div", { "data-stream-item-id": announcement.id }));
    card.append(new Node("button", { "aria-label": announcement.menu }, "More"));
    for (const file of announcement.files) card.append(driveLink(file));
    card.append(new Node("a", { href: "https://classroom.google.com/u/3/c/course-42" }, "Course"));
  }
  const result = runDiscover(body, stream.url);
  assert.equal(result.streamPage, true);
  assert.deepEqual(Array.from(result.posts, post => post.title), ["Date:19.10.2026 Programming Exercise", "Date:15.10.2026 Module 02: Lecture 08"]);
  assert.deepEqual(Array.from(result.posts, post => post.count), [3, 1]);
  assert.deepEqual(Array.from(result.posts[0].files, file => file.name), ["Problem 01.pdf", "Problem 02.pdf", "Problem 03.pdf"]);
  assert.equal(result.posts[0].files[0].url, "https://drive.google.com/file/d/drive-pdf-1/view?usp=classroom_web");
  assert.equal(result.posts[0].files[0].id, "file:drive-pdf-1");
  assert.ok(result.posts.every(post => post.files.every(file => file.postKey === post.key && file.course === stream.course)));
  assert.equal(result.files.length, 0); // nothing downloads until the user chooses one announcement
  assert.equal(result.diagnostics.reason, "stream_posts_found");
});

test("re-scanning after lazy Stream rendering discovers newly loaded announcement cards", () => {
  const body = new Node("body");
  body.append(new Node("h1", {}, stream.course));
  for (const announcement of stream.announcements.slice(0, 1)) {
    const card = body.append(new Node("div", { "data-stream-item-id": announcement.id }));
    card.append(new Node("button", { "aria-label": announcement.menu }, "More"));
    for (const file of announcement.files) card.append(driveLink(file));
  }
  assert.equal(runDiscover(body, stream.url).posts.length, 1);
  const loaded = { id: "drive-new", name: "Newly loaded.pdf", label: "Attachment: PDF: Newly loaded.pdf" };
  const card = body.append(new Node("div", { "data-stream-item-id": "stream-lazy" }));
  card.append(new Node("button", { "aria-label": "Announcement options for New announcement" }, "More"));
  card.append(driveLink(loaded));
  const refreshed = runDiscover(body, stream.url);
  assert.equal(refreshed.posts.length, 2);
  assert.equal(refreshed.posts[1].files[0].name, loaded.name);
});

test("individual post/details route still extracts its scoped attachments", () => {
  const body = new Node("body");
  body.append(new Node("h1", {}, material.topic));
  const article = body.append(new Node("article", { "data-material-id": "material-7" }));
  for (const descriptor of material.descriptors.slice(0, 5)) {
    const name = descriptor.candidates?.find(value => /\.[a-z0-9]{1,10}$/i.test(value)) || "PDF";
    article.append(new Node("a", { href: descriptor.url, title: name, "aria-label": descriptor.typeHint }, name));
  }
  const result = runDiscover(body, material.url);
  assert.equal(result.streamPage, undefined);
  assert.equal(result.files.length, 4); // duplicate Drive ID remains deduplicated
  assert.deepEqual(result.files.map(file => file.name), ["Motion lecture 04.mp4", "Worksheet A.pdf", "Worksheet B.pdf", "Problem set.pdf"]);
  assert.ok(result.files.every(file => file.postKey === new URL(material.url).pathname));
});

