(function (root) {
  "use strict";
  const GENERIC = new Set(["pdf", "video", "document", "file", "attachment", "image", "spreadsheet", "presentation", "google drive", "google doc", "google sheet", "google slides"]);
  const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;
  const EXTENSION_BY_MIME = {
    "application/pdf": ".pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc", "application/vnd.ms-excel": ".xls", "application/vnd.ms-powerpoint": ".ppt",
    "text/plain": ".txt", "text/csv": ".csv", "image/jpeg": ".jpg", "image/png": ".png", "video/mp4": ".mp4"
  };
  const DEFAULT_SETTINGS = Object.freeze({ theme: "system", mode: "individual", downloadMethod: "folder", folderTemplate: "EkClick/{course}/{topic}", duplicate: "rename", compact: false, warnGeneric: true });

  function cleanCandidate(value) {
    if (typeof value !== "string") return "";
    return value.trim().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ");
  }
  function isGenericName(value) {
    const name = cleanCandidate(value).replace(/\.[a-z0-9]{1,8}$/i, "").trim().toLocaleLowerCase();
    return !name || GENERIC.has(name);
  }
  function filenameFromUrl(value) {
    try {
      const url = new URL(value);
      const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      if (segment && /\.[a-z0-9]{1,10}$/i.test(segment) && !/^file\.[a-z0-9]+$/i.test(segment)) return segment;
      return "";
    } catch (_) { return ""; }
  }
  function isClassroomPostRoute(value) {
    try { return /^\/(?:u\/\d+\/)?c\/[^/]+\/(?:a|w|m)\/[^/]+(?:\/|$)/.test(new URL(value, "https://classroom.google.com").pathname); }
    catch (_) { return false; }
  }
  function isClassroomStreamRoute(value) {
    try { return /^\/(?:u\/\d+\/)?c\/[^/]+\/?$/.test(new URL(value, "https://classroom.google.com").pathname); }
    catch (_) { return false; }
  }
  function classroomPageKey(value) {
    try {
      const url = new URL(value);
      if (url.hostname !== "classroom.google.com") return "";
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${path}`;
    } catch (_) { return ""; }
  }
  function attachmentKind(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const path = url.pathname;
      const id = path.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/?#]+)/i)?.[1] || url.searchParams.get("id") || "";
      if (host === "drive.google.com" && (id && (/^\/file\/d\//i.test(path) || /^\/(?:open|uc|download)$/i.test(path)))) return { kind: "drive", id };
      if (host === "drive.usercontent.google.com" && id && /^\/download$/i.test(path)) return { kind: "drive", id };
      if (host === "docs.google.com" && id && /^\/(document|spreadsheets|presentation)\/d\//i.test(path)) return { kind: path.split("/")[1].toLowerCase(), id };
      return null;
    } catch (_) { return null; }
  }
  function typeFromMetadata(name, mime = "", hint = "", url = "") {
    const ext = (cleanCandidate(name).match(/\.([a-z0-9]{1,10})$/i)?.[1] || "").toLowerCase();
    const metadata = `${mime} ${hint} ${url}`.toLowerCase();
    if (ext === "pdf" || metadata.includes("application/pdf") || /\bpdf\b/.test(metadata)) return "pdf";
    if (["mp4", "mov", "avi", "webm", "mkv", "m4v"].includes(ext) || /video\//.test(metadata) || /\bvideo\b/.test(metadata)) return "video";
    const kind = attachmentKind(url)?.kind;
    if (kind === "document") return "document";
    if (kind === "spreadsheets") return "spreadsheet";
    if (kind === "presentation") return "presentation";
    return "file";
  }
  function discoverAttachments(descriptors, context = {}) {
    const diagnostics = {
      supportedPage: context.supportedPage === true,
      postContainerFound: context.postContainerFound === true,
      candidates: Array.isArray(descriptors) ? descriptors.length : 0,
      eligibleLinks: 0,
      extracted: 0,
      reason: ""
    };
    if (!diagnostics.supportedPage) { diagnostics.reason = "unsupported_page"; return { files: [], diagnostics }; }
    if (!diagnostics.postContainerFound) { diagnostics.reason = "post_container_not_found"; return { files: [], diagnostics }; }
    const files = [];
    const seen = new Set();
    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
      const sourceUrl = typeof descriptor?.url === "string" ? descriptor.url : "";
      const kind = attachmentKind(sourceUrl);
      if (!kind) continue;
      diagnostics.eligibleLinks++;
      const url = new URL(sourceUrl);
      const key = `file:${kind.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hint = descriptor.typeHint || "";
      const mime = descriptor.mime || (/\bpdf\b/i.test(hint) ? "application/pdf" : "");
      const filename = resolveFilename([...(descriptor.candidates || []), filenameFromUrl(url.href)], mime);
      files.push({
        id: key,
        url: url.href,
        name: filename.name,
        confidence: filename.confidence,
        warning: filename.warning,
        course: cleanCandidate(descriptor.course) || cleanCandidate(context.course) || "Google Classroom",
        topic: cleanCandidate(descriptor.topic) || cleanCandidate(context.topic) || "Uncategorized",
        type: typeFromMetadata(filename.name, mime, hint, url.href),
        sourceLabel: cleanCandidate(descriptor.sourceLabel).slice(0, 200),
        supported: kind.kind === "drive",
        postKey: cleanCandidate(context.postKey) || locationSafePath(context.url)
      });
    }
    diagnostics.extracted = files.length;
    diagnostics.reason = files.length ? "ok" : diagnostics.eligibleLinks ? "extraction_zero" : diagnostics.candidates ? "no_eligible_attachment_links" : "empty_post";
    return { files, diagnostics };
  }
  function locationSafePath(value) { try { return new URL(value).pathname; } catch (_) { return ""; } }
  function ensureExtension(name, mime = "") {
    const cleanMime = String(mime).split(";")[0].trim().toLowerCase();
    const ext = EXTENSION_BY_MIME[cleanMime];
    if (!ext) return name;
    const existing = name.match(/\.([a-z0-9]{1,10})$/i);
    if (!existing) return name + ext;
    if (existing[1].toLowerCase() === ext.slice(1)) return name;
    return name;
  }
  function sanitizeSegment(value, fallback = "Untitled") {
    let result = cleanCandidate(value).replace(INVALID, "_").replace(/[. ]+$/g, "").replace(/^\.+/g, "");
    result = result.replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, "_$1");
    return (result || fallback).slice(0, 160);
  }
  function resolveFilename(candidates, mime = "") {
    const rawCandidates = Array.isArray(candidates) ? candidates : [candidates];
    const valid = rawCandidates.map(cleanCandidate).map(value => value.replace(/^(?:open|download|view)\s+(?:the\s+)?(?:pdf|video|file|attachment)\s*[:\-–]?\s*/i, "").trim())
      .filter(value => value && value.length < 240 && !/^(?:pdf|video|document|file|attachment|image|spreadsheet|presentation|google drive)(?:\s+(?:file|attachment|preview|document))?$/i.test(value));
    const filenameLike = valid.find(value => /\.[a-z0-9]{1,10}$/i.test(value));
    const candidate = filenameLike || valid.find(value => !isGenericName(value));
    if (candidate) return { name: ensureExtension(candidate, mime), confidence: filenameLike || mime ? "high" : "medium", warning: "" };
    const extension = EXTENSION_BY_MIME[String(mime).split(";")[0].trim().toLowerCase()] || "";
    return { name: `Review filename${extension}`, confidence: "low", warning: "The original filename could not be confirmed. Review it before downloading." };
  }
  function uniqueName(name, used) {
    const key = name.toLocaleLowerCase();
    if (!used.has(key)) { used.add(key); return name; }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let index = 2;
    while (used.has(`${base} (${index})${ext}`.toLocaleLowerCase())) index++;
    const result = `${base} (${index})${ext}`;
    used.add(result.toLocaleLowerCase());
    return result;
  }
  function organizePath(template, course, topic, filename) {
    const selectedTemplate = String(template ?? DEFAULT_SETTINGS.folderTemplate);
    const rendered = selectedTemplate === "." ? "" : selectedTemplate
      .replaceAll("{course}", sanitizeSegment(course, "Unknown course"))
      .replaceAll("{topic}", sanitizeSegment(topic, "Uncategorized"));
    const folders = rendered.split(/[\\/]+/).filter(Boolean).map(part => sanitizeSegment(part, "EkClick"));
    return [...folders, sanitizeSegment(filename, "Review filename")].join("/");
  }
  function filterFiles(files, query = "", type = "all") {
    const needle = String(query).trim().toLocaleLowerCase();
    return files.filter(file => {
      const ext = (file.name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
      const byQuery = !needle || file.name.toLocaleLowerCase().includes(needle);
      const byType = type === "all" || (type === "pdf" ? ext === "pdf" : type === "video" ? ["mp4", "mov", "avi", "webm", "mkv"].includes(ext) : ext !== "pdf" && !["mp4", "mov", "avi", "webm", "mkv"].includes(ext));
      return byQuery && byType;
    });
  }
  function newestFirst(items) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0));
  }
  function normalizeSettings(value = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...(value && typeof value === "object" ? value : {}) };
    if (!["system", "light", "dark"].includes(settings.theme)) settings.theme = "system";
    settings.mode = settings.mode === "zip" ? "zip" : "individual";
    if (!["rename", "skip"].includes(settings.duplicate)) settings.duplicate = "rename";
    settings.folderTemplate = settings.folderTemplate === "." ? "." : DEFAULT_SETTINGS.folderTemplate;
    settings.downloadMethod = settings.downloadMethod === "browser" ? "browser" : "folder";
    return settings;
  }
  function queueTransition(current, event) {
    if (event === "enqueue" && ["failed", "skipped"].includes(current)) return "queued";
    if (event === "start" && current === "queued") return "downloading";
    if (event === "complete" && current === "downloading") return "complete";
    if (event === "fail" && ["queued", "downloading"].includes(current)) return "failed";
    if (event === "cancel" && ["queued", "downloading"].includes(current)) return "skipped";
    return current;
  }
  const api = { DEFAULT_SETTINGS, cleanCandidate, isGenericName, filenameFromUrl, isClassroomPostRoute, isClassroomStreamRoute, classroomPageKey, attachmentKind, typeFromMetadata, discoverAttachments, ensureExtension, sanitizeSegment, resolveFilename, uniqueName, organizePath, filterFiles, newestFirst, normalizeSettings, queueTransition };
  root.Core = api;
  root.EkClickCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
