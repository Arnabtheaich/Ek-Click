(function (root) {
  "use strict";
  const ALLOWED_FINAL_HOSTS = ["drive.google.com", "drive.usercontent.google.com", "googleusercontent.com"];
  const HTML_TYPES = ["text/html", "application/xhtml+xml", "application/json"];
  const KNOWN_EXT = /\.[a-z0-9]{1,10}$/i;

  function allowedHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_FINAL_HOSTS.some(allowed => host === allowed || (allowed === "googleusercontent.com" && host.endsWith(`.${allowed}`)));
  }
  function classroomAccountIndex(referrer) {
    try {
      const page = new URL(referrer);
      if (page.hostname !== "classroom.google.com") return "";
      return page.pathname.match(/(?:^|\/)u\/(\d+)(?:\/|$)/i)?.[1] || "";
    } catch (_) { return ""; }
  }
  function applyAccountHint(target, source, referrer) {
    if (target.searchParams.has("authuser")) return;
    const explicit = source.searchParams.get("authuser");
    const account = /^\d+$/.test(explicit || "") ? explicit : classroomAccountIndex(referrer);
    if (account) target.searchParams.set("authuser", account);
  }
  function buildDownloadUrl(sourceUrl, options = {}) {
    const source = new URL(sourceUrl);
    const kind = Core.attachmentKind(source.href);
    if (!kind || kind.kind !== "drive") throw new Error("This attachment is not a supported downloadable Drive file.");
    if (source.hostname === "drive.usercontent.google.com") {
      const target = new URL(source.href);
      applyAccountHint(target, source, options.referrer);
      return target.href;
    }
    if (source.hostname !== "drive.google.com") throw new Error("The attachment host is not supported.");
    if (/^\/file\/d\//i.test(source.pathname) || /^\/(?:open|uc|download)$/i.test(source.pathname)) {
      const target = new URL("https://drive.google.com/uc");
      target.searchParams.set("export", "download");
      target.searchParams.set("id", kind.id);
      // Include Drive's direct-download confirmation token rather than using the viewer URL.
      target.searchParams.set("confirm", "t");
      const resourceKey = source.searchParams.get("resourcekey") || source.searchParams.get("resourceKey");
      if (resourceKey) target.searchParams.set("resourcekey", resourceKey);
      applyAccountHint(target, source, options.referrer);
      return target.href;
    }
    throw new Error("The Drive link does not identify a downloadable file.");
  }
  async function limitedRawText(response, limit = 12288) {
    if (!response.body?.getReader) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (length < limit) {
        const { value, done } = await reader.read();
        if (done) break;
        const part = value.subarray(0, Math.max(0, limit - length));
        chunks.push(part); length += part.byteLength;
        if (length >= limit) break;
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  async function limitedText(response, limit = 12288) {
    return (await limitedRawText(response, limit)).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 360);
  }
  async function responseFailure(response) {
    const preview = await limitedText(response);
    return previewFailure(preview, response.status);
  }
  function previewFailure(preview, status) {
    const lower = String(preview || "").toLowerCase();
    if (/referer[^.]{0,60}null|requests from referer/.test(lower)) return "Drive rejected the request because it did not accept the Classroom referrer. Reopen the attachment in Classroom and retry.";
    if (/sign in|signin|accounts\.google|choose an account/.test(lower)) return "Google returned a sign-in page. Reopen the attachment in your signed-in Classroom tab, then retry.";
    if (/download.{0,35}disabled|owner.{0,35}disabled|cannot download|can't download/.test(lower)) return "The file owner or course policy does not allow downloading this attachment.";
    if (status === 401 || status === 403) return `Drive denied this request (HTTP ${status}). Check that the signed-in account can download the file and retry.`;
    return `Drive returned an HTML or non-file response (HTTP ${status || "unknown"})${preview ? `: ${String(preview).slice(0, 240)}` : "."}`;
  }
  function pdfSignature(bytes) {
    const limit = Math.min(bytes.length - 5, 1024);
    for (let i = 0; i <= limit; i++) if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
    return false;
  }
  function mp4Signature(bytes) {
    for (let i = 4; i + 4 <= Math.min(bytes.length, 16); i++) if (bytes[i] === 0x66 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x79 && bytes[i + 3] === 0x70) return true;
    return false;
  }
  function looksHtml(bytes) {
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64))).replace(/^\uFEFF/, "").trimStart().toLowerCase();
    return text.startsWith("<!doctype html") || text.startsWith("<html") || text.startsWith("<head") || text.startsWith("<body");
  }
  function isDriveErrorHtml(value) {
    const text = String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    return /accounts\.google\.com|you need access to this file|request access to this file|sign in to continue|google drive.{0,40}(?:access denied|error|unavailable)|sorry, you can't view or download|too many users have viewed|download quota|file owner's download quota|virus scan warning|couldn't preview this file|could not preview this file/.test(text);
  }
  function validateHeader(mime, type) {
    const clean = String(mime || "").split(";")[0].trim().toLowerCase();
    const htmlFile = type === "html" && (clean === "text/html" || clean === "application/xhtml+xml");
    if ((HTML_TYPES.some(prefix => clean === prefix) || clean.startsWith("text/")) && !htmlFile) throw new Error("Drive returned a web page or text response instead of a file.");
    if (type === "pdf" && clean && !["application/pdf", "application/octet-stream", "binary/octet-stream"].includes(clean)) throw new Error(`Expected a PDF, but Drive returned ${clean}.`);
    if (type === "video" && clean && !clean.startsWith("video/") && !["application/octet-stream", "binary/octet-stream"].includes(clean)) throw new Error(`Expected a video, but Drive returned ${clean}.`);
  }
  function validatePrefix(bytes, type, mime) {
    if (looksHtml(bytes) && (type !== "html" || isDriveErrorHtml(new TextDecoder().decode(bytes)))) throw new Error("Drive returned an HTML preview, sign-in or access error page instead of the original file.");
    if (type === "pdf" && !pdfSignature(bytes)) throw new Error(`The response did not contain a PDF signature (received ${mime || "unknown content"}).`);
    if (type === "video" && /mp4|quicktime|x-m4v/i.test(mime) && !mp4Signature(bytes)) throw new Error("The response did not contain an MP4/MOV file signature.");
  }
  function confirmationUrl(html, sourceUrl, expectedId) {
    const decode = value => String(value || "").replace(/&amp;/gi, "&").replace(/&#(?:0*38|x0*26);/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
    const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));
    const forms = [...String(html).matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)].map(match => match[0]);
    for (const form of forms) {
      const formTag = form.match(/<form\b[^>]*>/i)?.[0] || "";
      const formAttrs = attrs(formTag);
      if (formAttrs.method && formAttrs.method.toLowerCase() !== "get") continue;
      let target;
      try { target = new URL(formAttrs.action || sourceUrl, sourceUrl); } catch (_) { continue; }
      if (!allowedConfirmHost(target.hostname)) continue;
      for (const input of form.matchAll(/<input\b[^>]*>/gi)) {
        const inputAttrs = attrs(input[0]);
        if (!inputAttrs.name) continue;
        target.searchParams.set(inputAttrs.name, inputAttrs.value || "");
      }
      if (isExpectedConfirmation(target, expectedId)) return target.href;
    }
    for (const anchor of String(html).matchAll(/<a\b[^>]*>/gi)) {
      const link = attrs(anchor[0]);
      if (!link.href) continue;
      try {
        const target = new URL(link.href, sourceUrl);
        if (allowedConfirmHost(target.hostname) && isExpectedConfirmation(target, expectedId)) return target.href;
      } catch (_) { /* ignore malformed links */ }
    }
    return "";
  }
  function allowedConfirmHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "drive.google.com" || host === "drive.usercontent.google.com";
  }
  function isExpectedConfirmation(url, expectedId) {
    const hasConfirmation = url.searchParams.has("confirm") || url.searchParams.has("export") && /download/i.test(url.searchParams.get("export"));
    const id = url.searchParams.get("id") || url.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] || "";
    return hasConfirmation && id === expectedId && /^\/(?:uc|download|file\/d\/)/i.test(url.pathname);
  }
  async function subdirectory(rootHandle, names) {
    let current = rootHandle;
    for (const name of names) current = await current.getDirectoryHandle(Core.sanitizeSegment(name, "EkClick"), { create: true });
    return current;
  }
  async function exists(directory, name) {
    try { await directory.getFileHandle(name); return true; }
    catch (error) { if (error?.name === "NotFoundError") return false; throw error; }
  }
  async function uniqueTarget(directory, proposed, used, duplicateMode = "rename") {
    const safe = Core.sanitizeSegment(proposed, "download");
    const split = safe.match(/^(.*?)(\.[^.]+)?$/);
    const base = split?.[1] || safe, extension = split?.[2] || "";
    let name = safe, index = 1;
    while (used.has(name.toLocaleLowerCase()) || await exists(directory, name)) {
      if (duplicateMode === "skip") return { skipped: true, name };
      index++;
      name = `${base} (${index})${extension}`;
    }
    used.add(name.toLocaleLowerCase());
    return { skipped: false, name };
  }
  async function getVerifiedResponse(file, options = {}, confirmationAttempted = false, overrideUrl = "") {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const requestUrl = overrideUrl || buildDownloadUrl(file.url, { referrer: options.referrer });
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
        referrer: options.referrer || "https://classroom.google.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: options.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error("Could not reach Drive with the signed-in Classroom session. Check Drive site access, sign-in, and the attachment link, then retry.");
    }
    const contentType = response.headers?.get?.("content-type") || "";
    if (response.ok && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) && !confirmationAttempted) {
      // Inspect a clone so a genuine .html/.htm attachment keeps its original stream.
      const html = await limitedRawText(typeof response.clone === "function" ? response.clone() : response);
      const fileId = Core.attachmentKind(file.url)?.id;
      const confirmedUrl = confirmationUrl(html, response.url || requestUrl, fileId);
      if (confirmedUrl) return getVerifiedResponse(file, options, true, confirmedUrl);
      if (file.type === "html" && /\.html?$/i.test(file.name || "") && !isDriveErrorHtml(html)) {
        // Drive serves real HTML attachments as text/html; accept those while
        // continuing to reject preview, sign-in and access-denied documents.
        return { response, contentType, totalBytes: Number(response.headers?.get?.("content-length")) || 0, suggestedName: filenameFromContentDisposition(response.headers?.get?.("content-disposition") || "") };
      }
      throw new Error(previewFailure(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 360), response.status));
    }
    if (!response.ok) throw new Error(await responseFailure(response));
    try { validateHeader(contentType, file.type); }
    catch (_) { throw new Error(await responseFailure(response)); }
    if (response.url) {
      let finalUrl;
      try { finalUrl = new URL(response.url); } catch (_) { throw new Error("Drive redirected to an invalid URL."); }
      if (!allowedHost(finalUrl.hostname)) throw new Error("Drive redirected outside a trusted Google file host; EkClick stopped the download.");
    }
    if (!response.body?.getReader) throw new Error("Drive did not provide a readable file stream.");
    return { response, contentType, totalBytes: Number(response.headers?.get?.("content-length")) || 0, suggestedName: filenameFromContentDisposition(response.headers?.get?.("content-disposition") || "") };
  }
  function filenameFromContentDisposition(header) {
    const extended = String(header).match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, "");
    if (extended) { try { return decodeURIComponent(extended); } catch (_) { /* fall back to filename= */ } }
    const quoted = String(header).match(/filename\s*=\s*"([^"]+)"/i)?.[1];
    const plain = String(header).match(/filename\s*=\s*([^;\s]+)/i)?.[1];
    return (quoted || plain || "").trim();
  }
  function usableSuggestedName(name) {
    const clean = Core.sanitizeSegment(name, "");
    return !!clean && !/^(?:download|file|attachment|untitled)(?:\s*\(\d+\))?(?:\.[a-z0-9]{1,10})?$/i.test(clean) && !Core.isGenericName(clean);
  }
  async function readHtmlTail(reader, chunks, initialLength, cap = 12288) {
    let size = initialLength;
    while (size < cap) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, Math.max(0, cap - size)); chunks.push(part); size += part.byteLength;
      if (size >= cap) break;
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { const count = Math.min(chunk.byteLength, bytes.length - offset); if (count <= 0) break; bytes.set(chunk.subarray(0, count), offset); offset += count; }
    return new TextDecoder().decode(bytes);
  }
  async function downloadToDirectory(file, directoryHandle, settings = {}, options = {}) {
    const { response, contentType, totalBytes, suggestedName } = await getVerifiedResponse(file, options);
    const reader = response.body.getReader();
    const prefixChunks = [];
    let prefixLength = 0;
    try {
      while (prefixLength < 1024) {
        const next = await reader.read();
        if (next.done) break;
        prefixChunks.push(next.value); prefixLength += next.value.byteLength;
      }
      const prefix = new Uint8Array(Math.min(prefixLength, 1024)); let start = 0;
      for (const chunk of prefixChunks) { const count = Math.min(chunk.byteLength, prefix.length - start); if (count > 0) { prefix.set(chunk.subarray(0, count), start); start += count; } }
      if (looksHtml(prefix) && (file.type !== "html" || isDriveErrorHtml(new TextDecoder().decode(prefix)))) throw new Error(previewFailure(await readHtmlTail(reader, prefixChunks, prefixLength), response.status));
      validatePrefix(prefix, file.type, contentType);
      const relativePath = typeof file.path === "string" && file.path ? file.path.split(/[\\/]+/).map(part => Core.sanitizeSegment(part, "EkClick")).join("/") : Core.organizePath(settings.folderTemplate, file.course, file.topic, file.name);
      const parts = relativePath.split("/").filter(Boolean);
      let filename = parts.pop() || Core.sanitizeSegment(file.name, "download");
      if (!file.renamed && suggestedName && usableSuggestedName(suggestedName)) filename = Core.sanitizeSegment(suggestedName, filename);
      const expectedExtension = file.type === "pdf" ? ".pdf" : file.type === "html" ? ".html" : file.type === "video" && /video\/mp4|quicktime|x-m4v/i.test(contentType) ? (contentType.toLowerCase().includes("quicktime") ? ".mov" : ".mp4") : "";
      const directory = await subdirectory(directoryHandle, parts);
      if (expectedExtension && !KNOWN_EXT.test(filename)) filename += expectedExtension;
      if (file.type === "pdf" && KNOWN_EXT.test(filename) && !filename.toLowerCase().endsWith(".pdf")) throw new Error(`The attachment title ends in a non-PDF extension (${filename}). EkClick stopped to avoid misnaming the downloaded content.`);
      const finalName = filename;
      const target = await uniqueTarget(directory, finalName, options.usedNames || new Set(), file.duplicate || settings.duplicate);
      if (target.skipped) return { state: "skipped", name: target.name, path: relativePath, bytesWritten: 0, message: "A file with this name already exists in the selected folder." };
      const fileHandle = await directory.getFileHandle(target.name, { create: true });
      const writable = await fileHandle.createWritable({ keepExistingData: false });
      let bytesWritten = 0, lastReport = 0;
      try {
        for (const chunk of prefixChunks) { await writable.write(chunk); bytesWritten += chunk.byteLength; }
        await options.onProgress?.({ bytesWritten, totalBytes, progress: totalBytes ? Math.min(99, Math.round(bytesWritten / totalBytes * 100)) : null });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          await writable.write(value);
          bytesWritten += value.byteLength;
          const now = Date.now();
          if (now - lastReport > 250 || (totalBytes && bytesWritten >= totalBytes)) {
            await options.onProgress?.({ bytesWritten, totalBytes, progress: totalBytes ? Math.min(99, Math.round(bytesWritten / totalBytes * 100)) : null });
            lastReport = now;
          }
        }
        await writable.close();
      } catch (error) {
        await writable.abort(error).catch(() => {});
        await reader.cancel().catch(() => {});
        if (typeof directory.removeEntry === "function") await directory.removeEntry(target.name).catch(() => {});
        throw error;
      }
      return { state: "complete", name: target.name, destinationName: directoryHandle.name || "Selected folder", path: [...parts, target.name].join("/"), bytesWritten, totalBytes, progress: 100, message: "Verified file content saved to the selected folder." };
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
  }
  const api = { buildDownloadUrl, classroomAccountIndex, allowedHost, limitedText, limitedRawText, responseFailure, confirmationUrl, filenameFromContentDisposition, usableSuggestedName, validateHeader, validatePrefix, isDriveErrorHtml, subdirectory, uniqueTarget, getVerifiedResponse, downloadToDirectory };
  root.EkClickDownload = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
