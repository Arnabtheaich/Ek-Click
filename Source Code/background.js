"use strict";
const STATE_KEY = "downloadState";
const managerPorts = new Set();

async function getState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  return data[STATE_KEY] || { items: [], updatedAt: Date.now() };
}
async function putState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
async function addBatch(files, settings, referrer) {
  if (settings.mode === "zip" && settings.downloadMethod !== "folder") return { batchId: "", addedCount: 0, managerReady: managerPorts.size > 0, error: "ZIP archives require Selected EkClick folder mode. Change Download destination in Settings, then retry." };
  const state = await getState();
  const pageKey = Core.classroomPageKey(referrer);
  const oldDownloadIds = [];
  for (const item of state.items) {
    if (item.state === "queued") { item.state = "skipped"; item.message = "Stopped when a new batch was started."; delete item.url; delete item.referrer; delete item.archiveFiles; }
    else if (item.state === "downloading") {
      if (Number.isInteger(item.downloadId)) oldDownloadIds.push(item.downloadId);
      item.state = "skipped"; item.cancelRequested = true; item.message = "Stopped when a new batch was started."; delete item.url; delete item.referrer; delete item.archiveFiles;
    }
  }
  for (const port of managerPorts) port.postMessage({ type: "CANCEL_ACTIVE" });
  await putState(state);
  await cancelEkClickDownloads(oldDownloadIds).catch(error => console.warn("[EkClick][downloads] previous_batch_cancel_failed", error?.name || "Error"));
  const batchId = crypto.randomUUID();
  if (settings.mode === "zip") {
    const archiveFiles = [];
    for (const file of files) {
      if (!file || typeof file.url !== "string" || !file.supported) continue;
      let url;
      try { url = new URL(file.url); } catch (_) { continue; }
      if (!/^https?:$/.test(url.protocol) || !["classroom.google.com", "drive.google.com", "docs.google.com", "drive.usercontent.google.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
      archiveFiles.push({ url: url.href, name: Core.sanitizeSegment(file.name, "Review filename"), type: file.type || "file", course: file.course || "", topic: file.topic || "", confidence: file.confidence || "low", renamed: file.renamed === true, referrer: typeof referrer === "string" && referrer.startsWith("https://classroom.google.com/") ? referrer : "https://classroom.google.com/" });
    }
    if (!archiveFiles.length) return { ...state, batchId, addedCount: 0, managerReady: managerPorts.size > 0 };
    const first = archiveFiles[0];
    const archiveName = `${Core.sanitizeSegment(first.topic || "Classroom files", "Classroom files")}.zip`;
    const archive = { id: crypto.randomUUID(), batchId, pageKey, name: archiveName, path: Core.organizePath(settings.folderTemplate, first.course, first.topic, archiveName), state: "queued", message: "", format: "zip", archiveFiles, duplicate: settings.duplicate, type: "zip", course: first.course, topic: first.topic, createdAt: Date.now() };
    state.items.push(archive); state.activeBatchId = batchId; state.browserQueuePaused = false;
    await putState(state);
    for (const port of managerPorts) port.postMessage({ type: "QUEUE_CHANGED", batchId });
    return { ...state, batchId, addedCount: 1, managerReady: managerPorts.size > 0 };
  }
  const used = new Set();
  const added = [];
  for (const file of files) {
    if (!file || typeof file.url !== "string" || !file.supported) continue;
    let url;
    try { url = new URL(file.url); } catch (_) { continue; }
    if (!/^https?:$/.test(url.protocol) || !["classroom.google.com", "drive.google.com", "docs.google.com", "drive.usercontent.google.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    const proposed = Core.sanitizeSegment(file.name, "Review filename");
    let path = Core.organizePath(settings.folderTemplate, file.course, file.topic, proposed);
    if (used.has(path.toLocaleLowerCase()) && settings.duplicate === "skip") {
      added.push({ id: crypto.randomUUID(), batchId, pageKey, name: proposed, path, url: url.href, state: "skipped", message: "A file with this name is already in this EkClick batch.", confidence: file.confidence || "low", type: file.type || "file", course: file.course, topic: file.topic, createdAt: Date.now() });
      continue;
    }
    if (used.has(path.toLocaleLowerCase())) {
      const folder = path.slice(0, path.lastIndexOf("/") + 1);
      const name = Core.uniqueName(proposed, new Set(added.map(item => item.name.toLocaleLowerCase())));
      path = folder + name;
    }
    used.add(path.toLocaleLowerCase());
    added.push({ id: crypto.randomUUID(), batchId, pageKey, name: proposed, path, url: url.href, referrer: typeof referrer === "string" && referrer.startsWith("https://classroom.google.com/") ? referrer : "https://classroom.google.com/", state: "queued", message: file.warning || "", confidence: file.confidence || "low", renamed: file.renamed === true, duplicate: settings.duplicate, type: file.type || "file", course: file.course, topic: file.topic, createdAt: Date.now() });
  }
  state.items.push(...added);
  if (added.length) { state.activeBatchId = batchId; state.browserQueuePaused = false; }
  await putState(state);
  for (const port of managerPorts) port.postMessage({ type: "QUEUE_CHANGED", batchId });
  return { ...state, batchId, addedCount: added.filter(item => item.state === "queued").length, managerReady: managerPorts.size > 0 };
}
async function setCurrentClassroomPage(pageUrl) {
  const pageKey = Core.classroomPageKey(pageUrl);
  if (!pageKey) return getState();
  const state = await getState();
  if (state.currentPageKey === pageKey) return state;
  state.currentPageKey = pageKey;
  await putState(state);
  return state;
}
async function restoreBrowserDownloadHistory() {
  const state = await getState();
  if (state.browserHistoryRecovered) return state;
  const downloads = await chrome.downloads.search({ limit: 0 });
  const known = new Set(state.items.map(item => item.downloadId).filter(Number.isInteger));
  const restored = [];
  for (const download of downloads) {
    if (download.byExtensionId !== chrome.runtime.id || known.has(download.id)) continue;
    const sourceUrl = download.url || download.finalUrl || "";
    if (Core.attachmentKind(sourceUrl)?.kind !== "drive") continue;
    const name = String(download.filename || "download").split(/[\\/]/).pop() || "download";
    const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || "";
    const stateName = download.state === "complete" && !/\.html?$/i.test(name) ? "complete" : download.state === "in_progress" ? "downloading" : "failed";
    const message = stateName === "complete" ? "Recovered from Brave download history." : download.error === "SERVER_FORBIDDEN" ? "Google denied this download for the Classroom account. Check the account's download access." : stateName === "downloading" ? "Recovered as an active Brave download." : `Recovered failed download${download.error ? ` (${download.error})` : ""}.`;
    restored.push({
      id: `brave-${download.id}`, batchId: `history-${download.id}`, pageKey: "", downloadId: download.id,
      name, actualName: name, path: `Default browser location/${name}`, url: stateName === "complete" ? undefined : sourceUrl,
      state: stateName, progress: stateName === "complete" ? 100 : (download.totalBytes > 0 ? Math.round(download.bytesReceived / download.totalBytes * 100) : 0),
      bytesWritten: download.bytesReceived || 0, totalBytes: download.totalBytes || 0,
      message, course: "Classroom", topic: "Recovered download history", confidence: "high",
      type: extension === "pdf" ? "pdf" : ["mp4", "mov", "avi", "webm", "mkv"].includes(extension) ? "video" : "file",
      createdAt: Date.parse(download.startTime || "") || Date.now()
    });
    known.add(download.id);
  }
  state.items.push(...restored);
  state.browserHistoryRecovered = true;
  await putState(state);
  return state;
}
async function cancelEkClickDownloads(extraIds = []) {
  const active = await chrome.downloads.search({ state: "in_progress" });
  const ids = new Set(extraIds);
  for (const download of active) if (download.byExtensionId === chrome.runtime.id) ids.add(download.id);
  await Promise.allSettled([...ids].map(id => chrome.downloads.cancel(id)));
}
async function updateItem(message) {
  const state = await getState();
  const item = state.items.find(entry => entry.id === message.id);
  if (!item) return state;
  const transitions = new Set(["queued", "downloading", "complete", "failed", "skipped"]);
  if (transitions.has(message.state)) item.state = message.state;
  if (typeof message.progress === "number" && Number.isFinite(message.progress)) item.progress = Math.max(0, Math.min(100, message.progress));
  if (typeof message.bytesWritten === "number") item.bytesWritten = message.bytesWritten;
  if (typeof message.totalBytes === "number") item.totalBytes = message.totalBytes;
  if (typeof message.actualName === "string") item.actualName = Core.sanitizeSegment(message.actualName, item.name);
  if (typeof message.path === "string") item.path = message.path;
  if (typeof message.destinationName === "string") item.destinationName = message.destinationName;
  if (Number.isInteger(message.downloadId)) item.downloadId = message.downloadId;
  if (message.clearDownloadId) delete item.downloadId;
  if (typeof message.message === "string") item.message = message.message.slice(0, 400);
  if (["complete", "skipped"].includes(item.state)) { delete item.url; delete item.referrer; delete item.archiveFiles; }
  await putState(state);
  return state;
}
async function syncBrowserDownload(downloadId, delta = {}) {
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (!download) return;
  const state = await getState();
  const item = state.items.find(entry => entry.downloadId === downloadId);
  if (!item) return;
  const downloadedName = String(download.filename || item.actualName || item.name).split(/[\\/]/).pop();
  const patch = { id: item.id, bytesWritten: download.bytesReceived || 0, totalBytes: download.totalBytes || 0, actualName: downloadedName };
  if (download.state === "complete") {
    if (/\.html?$/i.test(downloadedName) || /^text\/html(?:;|$)/i.test(download.mime || "")) {
      patch.state = "failed"; patch.progress = 0;
      patch.message = `Google returned an HTML page instead of the original file${downloadedName ? ` (${downloadedName})` : ""}. Remove that HTML file from the default browser location and retry.`;
    } else {
      patch.state = "complete"; patch.progress = 100; patch.path = downloadedName;
      patch.message = "Completed in Brave's configured Downloads location.";
    }
  } else if (download.state === "interrupted") {
    patch.state = item.cancelRequested ? "skipped" : "failed";
    if (item.cancelRequested) patch.message = "Cancelled in the default browser location.";
    else if (download.error === "SERVER_FORBIDDEN") patch.message = "Google denied this download for the Classroom account. Check that this exact account is allowed to download the file; the owner may have restricted downloads.";
    else if (download.error === "SERVER_UNAUTHORIZED") patch.message = "Google requires a signed-in account for this file. Sign in to the same Google account used by Classroom, then retry.";
    else patch.message = `Brave could not download this file${delta.error?.current ? ` (${delta.error.current})` : download.error ? ` (${download.error})` : "."}`;
  } else {
    patch.state = "downloading";
    patch.progress = download.totalBytes > 0 ? Math.min(99, Math.round(download.bytesReceived / download.totalBytes * 100)) : 0;
    patch.message = "Downloading through Brave…";
  }
  await updateItem(patch);
}
chrome.downloads.onChanged.addListener(delta => {
  if (!Number.isInteger(delta.id)) return;
  syncBrowserDownload(delta.id, delta).catch(error => console.warn("[EkClick][downloads] status_update_failed", error?.name || "Error"));
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "ekclick-manager") return;
  managerPorts.add(port);
  port.onDisconnect.addListener(() => managerPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  (async () => {
    if (message?.type === "EKCLICK_GET_STATE") return getState();
    if (message?.type === "EKCLICK_RESTORE_BROWSER_HISTORY") return restoreBrowserDownloadHistory();
    if (message?.type === "EKCLICK_SET_CURRENT_PAGE") return setCurrentClassroomPage(message.pageUrl);
    if (message?.type === "EKCLICK_ADD_BATCH") return addBatch(message.files || [], Core.normalizeSettings(message.settings), message.referrer);
    if (message?.type === "EKCLICK_UPDATE_ITEM") return updateItem(message);
    if (message?.type === "EKCLICK_SYNC_BROWSER_DOWNLOAD") return syncBrowserDownload(message.downloadId);
    if (message?.type === "EKCLICK_PAUSE_BROWSER_QUEUE") {
      const state = await getState(); state.browserQueuePaused = true; await putState(state); return state;
    }
    if (message?.type === "EKCLICK_CANCEL_PENDING") {
      const state = await getState();
      const ids = [];
      for (const item of state.items) if (item.state === "queued") { item.state = "skipped"; item.message = "Cancelled before starting."; delete item.url; delete item.referrer; delete item.archiveFiles; }
      for (const item of state.items) if (item.state === "downloading" && Number.isInteger(item.downloadId)) {
        ids.push(item.downloadId);
        item.cancelRequested = true;
        item.state = "skipped"; item.message = "Cancellation requested in the default browser location."; delete item.url; delete item.referrer; delete item.archiveFiles;
      }
      await putState(state);
      for (const port of managerPorts) port.postMessage({ type: "CANCEL_ACTIVE" });
      cancelEkClickDownloads(ids).catch(error => console.warn("[EkClick][downloads] cancel_failed", error?.name || "Error"));
      return state;
    }
    if (message?.type === "EKCLICK_RETRY_FAILED") {
      const state = await getState();
      state.browserQueuePaused = false;
      for (const item of state.items) if (item.state === "failed") { item.state = Core.queueTransition(item.state, "enqueue"); item.message = ""; item.progress = 0; delete item.downloadId; delete item.cancelRequested; }
      await putState(state);
      for (const port of managerPorts) port.postMessage({ type: "QUEUE_CHANGED" });
      return state;
    }
    if (message?.type === "EKCLICK_CLEAR_FINISHED") {
      const state = await getState(); state.items = state.items.filter(item => !["complete", "skipped"].includes(item.state)); await putState(state); return state;
    }
    if (message?.type === "EKCLICK_CLEAR_ALL") {
      const state = await getState();
      state.items = []; state.activeBatchId = ""; state.browserQueuePaused = false; state.browserHistoryRecovered = true;
      await putState(state);
      for (const port of managerPorts) port.postMessage({ type: "QUEUE_CHANGED" });
      return state;
    }
    return { error: "Unknown request" };
  })().then(respond).catch(error => respond({ error: error?.message || "Request failed" }));
  return true;
});

importScripts("shared/core.js");

const FOLDER_DEFAULT_MIGRATION_KEY = "folderDownloadDefaultMigrated";
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const data = await chrome.storage.local.get(["settings", FOLDER_DEFAULT_MIGRATION_KEY]);
    if (data[FOLDER_DEFAULT_MIGRATION_KEY]) return;
    const settings = Core.normalizeSettings(data.settings);
    settings.downloadMethod = "folder";
    await chrome.storage.local.set({ settings, [FOLDER_DEFAULT_MIGRATION_KEY]: true });
  })().catch(error => console.warn("[EkClick][settings] folder_default_migration_failed", error?.name || "Error"));
});
