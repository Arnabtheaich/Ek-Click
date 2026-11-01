"use strict";
const $ = id => document.getElementById(id);
let settings = Core.normalizeSettings(), state = { items: [] }, search = "", filter = "all";
let processing = false, activeController = null, activeDirectoryRevision = "", folderChangePending = false;
const send = message => chrome.runtime.sendMessage(message);
const directoryStore = EkClickDirectoryStore.createDirectoryStore();
const managerPort = chrome.runtime.connect({ name: "ekclick-manager" });
managerPort.onMessage.addListener(message => { if (message?.type === "CANCEL_ACTIVE") activeController?.abort(); if (message?.type === "QUEUE_CHANGED") processQueue(); });
function applyTheme() { const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.body.classList.toggle("theme-dark", dark); }
function makeStat(label, count, cls = "") { const card = document.createElement("div"); card.className = `stat-card ${cls}`; const title = document.createElement("span"); title.textContent = label; const value = document.createElement("b"); value.textContent = count; card.append(title, value); return card; }
function render() {
  const items = Core.newestFirst(state.items), counts = Object.fromEntries(["queued", "downloading", "complete", "failed", "skipped"].map(key => [key, items.filter(item => item.state === key).length]));
  $("stats").replaceChildren(makeStat("Total files", items.length), makeStat("Completed", counts.complete, "good"), makeStat("In progress", counts.downloading), makeStat("Failed", counts.failed, "bad"));
  const pct = items.length ? Math.round((counts.complete / items.length) * 100) : 0;
  $("progressLabel").textContent = `${pct}% complete`; $("progressBar").style.width = `${pct}%`; $("progressText").textContent = items.length ? `${counts.complete} complete · ${counts.downloading} downloading · ${counts.queued} queued · ${counts.failed} failed` : "No EkClick downloads yet.";
  const list = $("managerList"); list.replaceChildren();
  const shown = items.filter(item => (filter === "all" || item.state === filter) && (!search || item.name.toLocaleLowerCase().includes(search)));
  if (!shown.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = items.length ? "No files match these filters." : "Your EkClick batches will appear here."; list.append(empty); }
  for (const item of shown) {
    const row = document.createElement("div"); row.className = "manager-row";
    const file = document.createElement("div"); file.className = "manager-file"; const name = document.createElement("b"); name.textContent = item.actualName || item.name; name.title = item.downloadId != null ? `Default browser location: ${item.actualName || item.name}` : `${item.destinationName || "Selected folder"}/${item.path || ""}`; const location = item.downloadId != null ? `Default browser location · ${item.actualName || item.name}` : `${item.destinationName ? `${item.destinationName} / ` : ""}${item.path || ""}`; const sub = document.createElement("small"); sub.textContent = `${item.course || "Classroom"} · ${item.topic || "Uncategorized"} · ${location}`; file.append(name, sub);
    const type = document.createElement("span"); type.className = "muted"; type.textContent = (item.type || "file").toUpperCase();
    const status = document.createElement("div"); status.className = "manager-status"; const pill = document.createElement("span"); pill.className = `status-pill ${item.state}`; pill.textContent = ({ queued: "Queued", downloading: "Downloading", complete: "Completed", failed: "Failed", skipped: "Skipped" })[item.state] || item.state; status.append(pill); if (item.message) { const note = document.createElement("small"); note.textContent = item.message; status.append(note); }
    const progress = document.createElement("div"); progress.className = "manager-progress"; if (item.state === "downloading") { const pctText = document.createElement("small"); pctText.textContent = typeof item.progress === "number" ? `${item.progress}%` : (item.bytesWritten ? `${Math.round(item.bytesWritten / 1048576)} MB written` : "Receiving data"); const track = document.createElement("div"); track.className = "item-progress"; const bar = document.createElement("span"); bar.style.width = `${item.progress || 0}%`; track.append(bar); progress.append(pctText, track); }
    row.append(file, type, status, progress); list.append(row);
  }
  $("retryFailed").disabled = !counts.failed; $("cancelPending").disabled = !counts.queued && !counts.downloading; $("clearAll").disabled = items.length === 0; $("managerStatus").textContent = `${items.length} file${items.length === 1 ? "" : "s"} in this browser-local history.`;
}
async function refresh() { const result = await send({ type: "EKCLICK_RESTORE_BROWSER_HISTORY" }); if (result && !result.error) { state = result; render(); } }
async function writeItem(id, fields) { state = await send({ type: "EKCLICK_UPDATE_ITEM", id, ...fields }); render(); }
async function waitForBrowserDownload(downloadId) {
  while (true) {
    const current = await send({ type: "EKCLICK_GET_STATE" });
    const item = current?.items?.find(entry => entry.downloadId === downloadId);
    if (!item || ["complete", "failed", "skipped"].includes(item.state)) return item;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    await navigator.locks.request("ekclick-selected-folder-queue", { ifAvailable: true }, async lock => {
      if (!lock) return;
      let current = await send({ type: "EKCLICK_GET_STATE" });
      if (settings.downloadMethod === "browser" && current?.browserQueuePaused) { $("managerStatus").textContent = "Browser queue paused after a failed download. Review the error, then choose Retry failed to continue."; return; }
      if (settings.downloadMethod === "folder") for (const item of current.items || []) if (item.state === "downloading") await writeItem(item.id, { state: "queued", message: "Resuming after the manager page was closed." });
      while (true) {
        current = await send({ type: "EKCLICK_GET_STATE" });
        const item = EkClickBatchQueue.nextQueuedItem(current.items, current.activeBatchId);
        if (!item) break;
        if (item.format === "zip" && settings.downloadMethod !== "folder") {
          await writeItem(item.id, { state: "failed", message: "ZIP archives require Selected EkClick folder mode. Change Download destination in Settings, then retry." });
          continue;
        }
        if (settings.downloadMethod === "browser") {
          try {
            const directUrl = EkClickDownload.buildDownloadUrl(item.url, { referrer: item.referrer });
            const filename = Core.sanitizeSegment(item.name, "download");
            const downloadId = await chrome.downloads.download({ url: directUrl, filename, saveAs: false, conflictAction: "uniquify" });
            await writeItem(item.id, { state: "downloading", downloadId, actualName: filename, progress: 0, bytesWritten: 0, message: "Started in the default browser location…" });
            const synced = await send({ type: "EKCLICK_SYNC_BROWSER_DOWNLOAD", downloadId });
            if (synced?.error) throw new Error(synced.error);
            const result = await waitForBrowserDownload(downloadId);
            if (result?.state === "failed") {
              await send({ type: "EKCLICK_PAUSE_BROWSER_QUEUE" });
              $("managerStatus").textContent = "Batch paused after the first failed browser download. Check its error, then retry.";
              break;
            }
          } catch (error) {
            await writeItem(item.id, { state: "failed", message: error?.message || "Brave could not start this download." });
            await send({ type: "EKCLICK_PAUSE_BROWSER_QUEUE" });
            $("managerStatus").textContent = "Batch paused after the first failed browser download. Check its error, then retry.";
            break;
          }
          continue;
        }
        let handle, selectionRevision;
        try {
          const before = await chrome.storage.local.get("directorySelectionRevision");
          selectionRevision = before.directorySelectionRevision || "";
          handle = await directoryStore.get();
        } catch (error) { handle = null; }
        if (!handle) {
          const message = "No destination folder is selected. Choose a folder in Settings, then retry this batch.";
          for (const queued of current.items.filter(entry => entry.state === "queued")) await writeItem(queued.id, { state: "failed", message });
          break;
        }
        const permission = await EkClickDirectoryStore.queryWritePermission(handle);
        const after = await chrome.storage.local.get("directorySelectionRevision");
        if ((after.directorySelectionRevision || "") !== selectionRevision) continue;
        if (permission !== "granted") {
          const message = "The selected folder's write permission expired or was revoked. Grant access in Settings, then retry.";
          for (const queued of current.items.filter(entry => entry.state === "queued")) await writeItem(queued.id, { state: "failed", message });
          break;
        }
        activeDirectoryRevision = selectionRevision;
        folderChangePending = false;
        activeController = new AbortController();
        await writeItem(item.id, { state: "downloading", destinationName: handle.name || "Selected folder", progress: 0, bytesWritten: 0, message: "Validating Drive response…" });
        try {
          const progressOptions = {
            signal: activeController.signal,
            referrer: item.referrer,
            onProgress: progress => writeItem(item.id, { state: "downloading", ...progress, message: progress.message || "Streaming verified content to the selected folder…" })
          };
          const result = item.format === "zip"
            ? await EkClickZip.writeArchive(item, handle, settings, progressOptions)
            : await EkClickDownload.downloadToDirectory(item, handle, settings, progressOptions);
          if (folderChangePending && activeController.signal.aborted) throw new DOMException("The destination folder changed; restarting in the newly selected folder.", "AbortError");
          await writeItem(item.id, EkClickQueueResult.fromSuccess(result));
        } catch (error) {
          if (folderChangePending) {
            folderChangePending = false;
            await writeItem(item.id, { state: "queued", progress: 0, bytesWritten: 0, message: "Destination folder changed; restarting in the newly selected folder." });
          } else await writeItem(item.id, EkClickQueueResult.fromFailure(error));
        } finally { activeController = null; activeDirectoryRevision = ""; }
      }
    });
  } catch (error) { $("managerStatus").textContent = error?.message || "Could not start the download queue."; }
  finally { processing = false; await refresh(); }
}
$("managerSearch").addEventListener("input", e => { search = e.target.value.toLocaleLowerCase(); render(); }); $("stateFilter").addEventListener("change", e => { filter = e.target.value; render(); });
$("retryFailed").addEventListener("click", async () => { state = await send({ type: "EKCLICK_RETRY_FAILED" }); render(); await processQueue(); });
$("cancelPending").addEventListener("click", async () => { state = await send({ type: "EKCLICK_CANCEL_PENDING" }); activeController?.abort(); render(); $("managerStatus").textContent = "Cancellation requested for EkClick's active downloads and queued files."; });
$("clearFinished").addEventListener("click", async () => { state = await send({ type: "EKCLICK_CLEAR_FINISHED" }); render(); });
$("clearAll").addEventListener("click", async () => {
  if (!confirm("Clear all EkClick download records? Downloaded files and Brave's download history will stay untouched.")) return;
  state = await send({ type: "EKCLICK_CLEAR_ALL" }); render();
  $("managerStatus").textContent = "All EkClick download records were cleared.";
});
$("themeToggle").addEventListener("click", async () => { settings.theme = ({ system: "light", light: "dark", dark: "system" })[settings.theme]; await chrome.storage.local.set({ settings }); applyTheme(); });
chrome.storage.local.get(["settings"]).then(data => { settings = Core.normalizeSettings(data.settings); applyTheme(); refresh().then(processQueue); });
chrome.storage.onChanged.addListener(changes => {
  if (changes.downloadState) { state = changes.downloadState.newValue || { items: [] }; render(); if (state.items.some(item => item.state === "queued")) processQueue(); }
  if (changes.settings) { settings = Core.normalizeSettings(changes.settings.newValue); applyTheme(); }
  if (changes.directorySelectionRevision && changes.directorySelectionRevision.newValue !== activeDirectoryRevision) {
    folderChangePending = true;
    activeController?.abort();
  }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
