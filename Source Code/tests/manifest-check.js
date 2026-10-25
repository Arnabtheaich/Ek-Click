"use strict";
const fs = require("node:fs");
const path = require("node:path");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Expected Manifest V3");
if (!manifest.permissions.includes("scripting")) throw new Error("Active-tab script injection requires the scripting permission");
if (!manifest.permissions.includes("downloads")) throw new Error("Default browser location mode requires the downloads permission");
for (const origin of ["https://drive.google.com/*", "https://drive.usercontent.google.com/*", "https://*.googleusercontent.com/*"]) {
  if (!manifest.optional_host_permissions?.includes(origin)) throw new Error(`Missing optional Drive host permission ${origin}`);
}
for (const size of [16, 32, 48, 128]) {
  const expected = `assets/icons/${size}.png`;
  if (manifest.icons?.[String(size)] !== expected || manifest.action?.default_icon?.[String(size)] !== expected) throw new Error(`Missing ${size}px manifest icon mapping`);
  const png = fs.readFileSync(path.join(__dirname, "..", expected));
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${expected} is not a valid PNG`);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`${expected} must be ${size}x${size}`);
}
for (const page of ["popup.html", "manager.html", "settings.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^\"]+)"/g)) {
    if (/^(?:https?:|#)/.test(ref)) continue;
    if (!fs.existsSync(path.join(__dirname, "..", ref))) throw new Error(`${page} references missing ${ref}`);
  }
}
if (!fs.existsSync(path.join(__dirname, "..", "shared", "zip.js"))) throw new Error("ZIP writer is missing");
console.log("Manifest V3, browser Downloads permission, optional Drive hosts, local assets, and 16/32/48/128 PNG icons validated.");
