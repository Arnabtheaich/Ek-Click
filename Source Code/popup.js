"use strict";
const $ = id => document.getElementById(id);
let files = [], streamPosts = [], streamPage = false, settings = Core.normalizeSettings(), selected = new Set(), toastTimer, currentPageUrl = "", batchStarting = false;
const directoryStore = EkClickDirectoryStore.createDirectoryStore();
const DRIVE_ORIGINS = ["https://drive.google.com/*", "https://drive.usercontent.google.com/*", "https://*.googleusercontent.com/*"];
const send = message => chrome.runtime.sendMessage(message);
let currentDirectory = null, directoryPermission = "denied", drivePermissionGranted = false, folderStateReady = false, folderAction = "";
function setFolderAction(message, label = "", action = "") {
  folderAction = action;
  $("folderActionText").textContent = message;
  $("folderActionButton").textContent = label;
  $("folderActionButton").hidden = !label;
  $("folderActionPanel").hidden = !message;
}
async function saveSelectionDraft() {
  await chrome.storage.local.set({ [EkClickBatchDraft.DRAFT_KEY]: EkClickBatchDraft.makeDraft(files, selected, currentPageUrl) });
}
async function refreshFolderSummary() {
  const capabilities = EkClickDirectoryStore.pickerCapabilities(window);
  try {
    currentDirectory = await directoryStore.get();
    directoryPermission = await EkClickDirectoryStore.queryWritePermission(currentDirectory);
  } catch (error) {
    currentDirectory = null; directoryPermission = "denied";
    console.warn("[EkClick][folder] directory_handle_read_failed", error?.name || "Error");
  }
  try { drivePermissionGranted = await chrome.permissions.contains({ origins: DRIVE_ORIGINS }); }
  catch (_) { drivePermissionGranted = false; }
  folderStateReady = true;
  const zipOption = $("downloadMode").querySelector('option[value="zip"]');
  zipOption.disabled = settings.downloadMethod !== "folder";
  if (zipOption.disabled && settings.mode === "zip") { settings.mode = "individual"; $("downloadMode").value = "individual"; await chrome.storage.local.set({ settings }); }
  $("folderSummary").textContent = settings.downloadMethod === "browser" ? "Default browser location" : (currentDirectory ? `${currentDirectory.name} / ${settings.folderTemplate === "." ? "Project root" : settings.folderTemplate}` : "No EkClick destination selected");
  $("destinationTitle").textContent = settings.downloadMethod === "browser" ? "Download to default browser location" : "Save to selected folder";
  $("browserNote").textContent = settings.downloadMethod === "browser" ? "Your browser default download location and save-dialog preference apply." : "EkClick writes directly to the selected folder; browser download settings are unchanged.";
  console.info("[EkClick][folder] capability_state", { ...capabilities, method: settings.downloadMethod, handleExists: !!currentDirectory, writePermission: directoryPermission, drivePermissionGranted });
  if (settings.downloadMethod === "browser") {
    setFolderAction("Downloads use Brave's configured Downloads location. Your selected EkClick folder is not used in this mode.");
    return;
  }
  if (!currentDirectory) {
    const gate = EkClickDirectoryStore.evaluateBatchGate({ capabilities });
    const message = gate === "folder-picker-unavailable" ? "This Brave extension context does not expose the folder picker. See Settings diagnostics; EkClick will not save into Downloads." : gate === "folder-storage-unavailable" ? "IndexedDB is unavailable here, so EkClick cannot remember a chosen folder." : "Choose your destination folder before granting Drive access.";
    setFolderAction(message, "Open Settings", "settings");
  } else if (directoryPermission !== "granted") {
    setFolderAction("The chosen folder needs write access before this batch can start.", "Grant Folder Access", "settings");
  } else if (!drivePermissionGranted) {
    setFolderAction("EkClick needs optional access to Drive file hosts to retrieve the original bytes. This is separate from folder access.", "Grant Drive Access", "drive");
  } else setFolderAction("");
}
function showToast(text) { const el = $("toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }
function applyTheme() { const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.body.classList.toggle("theme-dark", dark); document.body.classList.toggle("compact", !!settings.compact); }
async function cycleTheme() { settings.theme = ({ system: "light", light: "dark", dark: "system" })[settings.theme]; await chrome.storage.local.set({ settings }); applyTheme(); showToast(`Theme: ${settings.theme}`); }
function fileTypeTag(file) { return file.type === "pdf" ? "PDF" : file.type === "video" ? "VID" : file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"; }
function filtered() { return Core.filterFiles(files, $("search").value, $("typeFilter").value); }
function showStreamPost(key) {
  const post = streamPosts.find(item => item.key === key);
  files = post?.files || [];
  selected = new Set();
  $("postTitle").textContent = post ? post.title : "Choose an announcement to view its attachments.";
  $("scanStatus").textContent = post ? `${post.count} attachment${post.count === 1 ? "" : "s"} in this announcement` : `${streamPosts.length} announcements found. Choose one to see its files.`;
  render();
}
function render() {
  const list = $("files"), visible = filtered(); list.replaceChildren();
  $("fileCount").textContent = `${files.length} found`;
  if (!visible.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = files.length ? "No attachments match this filter." : streamPage ? streamPosts.length ? "Choose an announcement above to see its attachments." : "No announcement attachments found. Scroll to load more posts, then refresh." : "Open an individual Classroom post, material or assignment details page, then refresh."; list.append(empty); }
  for (const file of visible) {
    const row = document.createElement("div"); row.className = "file-row";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected.has(file.id); check.disabled = !file.supported; check.setAttribute("aria-label", `Select ${file.name}`); check.addEventListener("change", () => { check.checked ? selected.add(file.id) : selected.delete(file.id); updateButton(); saveSelectionDraft().catch(() => {}); });
    const glyph = document.createElement("div"); glyph.className = "file-glyph"; glyph.textContent = fileTypeTag(file);
    const meta = document.createElement("div"); meta.className = "file-meta";
    const label = document.createElement("div"); label.className = "file-name"; label.title = file.name; label.textContent = file.name;
    if (file.confidence !== "high") { const tag = document.createElement("span"); tag.className = "warning-tag"; tag.textContent = "Review name"; tag.title = file.warning || "Filename is uncertain"; label.append(tag); }
    const sub = document.createElement("div"); sub.className = "file-sub"; sub.textContent = `${file.topic || "Classroom attachment"}${file.supported ? "" : " · Google Docs export not supported yet"}`;
    meta.append(label, sub);
    const rename = document.createElement("button"); rename.className = "rename-button"; rename.type = "button"; rename.textContent = "✎"; rename.title = "Review filename"; rename.setAttribute("aria-label", `Rename ${file.name}`); rename.addEventListener("click", () => { const input = document.createElement("input"); input.className = "rename-input"; input.value = file.name; input.setAttribute("aria-label", "Filename before download"); meta.replaceChildren(input, sub); input.focus(); input.select(); const save = () => { const name = Core.sanitizeSegment(input.value, "Review filename"); file.name = Core.ensureExtension(name); file.renamed = true; if (file.confidence !== "high") file.confidence = "reviewed"; render(); saveSelectionDraft().catch(() => {}); }; input.addEventListener("keydown", e => { if (e.key === "Enter") save(); if (e.key === "Escape") render(); }); input.addEventListener("blur", save, { once: true }); });
    row.append(check, glyph, meta, rename); list.append(row);
  }
  updateButton();
}
function updateButton() { const n = [...selected].filter(id => files.some(file => file.id === id && file.supported)).length; $("selectedCount").textContent = n; $("downloadButton").disabled = n === 0 || batchStarting; $("downloadButton").firstElementChild.textContent = batchStarting ? "Starting…" : "Download selected"; $("selectAll").textContent = n && n === files.filter(file => file.supported).length ? "Deselect all" : "Select all"; }
async function discover() {
  $("scanStatus").textContent = "Scanning current page…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); const tab = tabs[0];
    if (!tab?.url?.startsWith("https://classroom.google.com/")) { console.info("[EkClick][discovery] active_tab_unsupported"); files = []; streamPosts = []; streamPage = false; $("streamPostPicker").hidden = true; $("courseTitle").textContent = "Google Classroom not active"; $("postTitle").textContent = "Open a class or post to discover attachments."; $("scanStatus").textContent = "Classroom page required"; render(); return; }
    let result;
    try { result = await chrome.tabs.sendMessage(tab.id, { type: "EKCLICK_DISCOVER" }); }
    catch (_) {
      console.info("[EkClick][discovery] content_script_unavailable; attempting one-time injection");
      const [corePresent] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => Boolean(globalThis.EkClickCore) });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: corePresent?.result ? ["content.js"] : ["shared/core.js", "content.js"] });
      result = await chrome.tabs.sendMessage(tab.id, { type: "EKCLICK_DISCOVER" });
    }
    if (result?.error) throw new Error(result.message || "Attachment discovery failed.");
    files = result?.files || [];
    streamPosts = result?.posts || [];
    streamPage = result?.streamPage === true;
    currentPageUrl = result?.page?.url || tab.url;
    await send({ type: "EKCLICK_SET_CURRENT_PAGE", pageUrl: currentPageUrl });
    const draftData = await chrome.storage.local.get(EkClickBatchDraft.DRAFT_KEY);
    const draft = draftData[EkClickBatchDraft.DRAFT_KEY];
    if (streamPage) {
      const picker = $("streamPostPicker"), select = $("streamPostSelect");
      picker.hidden = false;
      select.replaceChildren(new Option("Choose an announcement…", ""));
      for (const post of streamPosts) select.add(new Option(`${post.title} (${post.count})`, post.key));
      select.value = "";
      files = []; selected = new Set();
      $("postTitle").textContent = streamPosts.length ? `${streamPosts.length} announcement${streamPosts.length === 1 ? "" : "s"} found. Choose one below.` : "No announcement attachments detected yet.";
      $("scanStatus").textContent = streamPosts.length ? `${streamPosts.length} announcements found` : "Scroll the Stream to load posts, then Refresh.";
    } else {
      $("streamPostPicker").hidden = true;
      $("streamPostSelect").replaceChildren();
      EkClickBatchDraft.restoreRenames(files, draft, currentPageUrl);
      selected = new Set(EkClickBatchDraft.restoreSelection(files, draft, currentPageUrl));
    }
    await saveSelectionDraft();
    $("courseTitle").textContent = result?.page?.course || "Google Classroom";
    if (!streamPage) $("postTitle").textContent = result?.page?.title || "Current Classwork or stream page";
    const reason = result?.diagnostics?.reason;
    const message = {
      unsupported_page: "Open an individual post, material or assignment details page.",
      post_container_not_found: "Post content is not ready. Refresh the Classroom tab, then try again.",
      no_eligible_attachment_links: "Post found; no supported Drive attachment links were recognized.",
      empty_post: "Post found; no attachment links were present.",
      extraction_zero: "Drive links were found, but no attachment records could be extracted. Try Refresh."
    }[reason];
    if (!streamPage) $("scanStatus").textContent = files.length ? `${files.length} attachment${files.length === 1 ? "" : "s"} discovered` : message || "No attachments found.";
  } catch (error) { console.warn("[EkClick][discovery] message_or_injection_error", error?.name || "Error"); files = []; streamPosts = []; streamPage = false; $("streamPostPicker").hidden = true; $("scanStatus").textContent = "Could not reach the page script. Reload the Classroom tab and try again."; showToast(error?.message || "Discovery failed"); }
  render();
}
$("selectAll").addEventListener("click", () => { const visible = filtered().filter(file => file.supported); const allSelected = visible.every(file => selected.has(file.id)); for (const file of visible) allSelected ? selected.delete(file.id) : selected.add(file.id); render(); saveSelectionDraft().catch(() => {}); });
$("streamPostSelect").addEventListener("change", event => { showStreamPost(event.target.value); saveSelectionDraft().catch(() => {}); });
$("search").addEventListener("input", render); $("typeFilter").addEventListener("change", render); $("refresh").addEventListener("click", discover); $("themeToggle").addEventListener("click", cycleTheme);
$("settingsButton").addEventListener("click", () => { saveSelectionDraft().finally(() => chrome.runtime.openOptionsPage()); }); $("openManager").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") }));
$("downloadMode").addEventListener("change", async () => { settings.mode = $("downloadMode").value === "zip" ? "zip" : "individual"; await chrome.storage.local.set({ settings }); showToast(settings.mode === "zip" ? "Selected attachments will be packaged into one ZIP archive." : "Individual file downloads selected."); });
async function startDownloadBatch() {
  const chosen = files.filter(file => file.supported && selected.has(file.id));
  if (!chosen.length) return;
  await saveSelectionDraft();
  if (!folderStateReady) await refreshFolderSummary();
  if (settings.downloadMethod === "folder") {
    let handle = currentDirectory, permission = directoryPermission;
    try {
      handle = await directoryStore.get(); currentDirectory = handle;
      permission = await EkClickDirectoryStore.queryWritePermission(handle); directoryPermission = permission;
    } catch (error) {
      console.warn("[EkClick][download] destination_check_failed", error?.name || "Error");
      setFolderAction("EkClick could not restore its saved folder handle. Check the folder diagnostic in Settings.", "Open Settings", "settings"); return;
    }
    const capabilities = EkClickDirectoryStore.pickerCapabilities(window);
    const gate = EkClickDirectoryStore.evaluateBatchGate({ capabilities, handle, writePermission: permission, drivePermission: drivePermissionGranted });
    console.info("[EkClick][download] batch_gate", { gate, hasHandle: !!handle, writePermission: permission, drivePermissionGranted, pickerAvailable: capabilities.pickerAvailable, indexedDbAvailable: capabilities.indexedDbAvailable });
    if (["folder-required", "folder-picker-unavailable", "folder-storage-unavailable"].includes(gate)) { await refreshFolderSummary(); return; }
    if (gate === "folder-permission-required") { setFolderAction("The selected folder needs write access before this batch can start.", "Grant Folder Access", "settings"); return; }
    if (gate === "drive-permission-required") { setFolderAction("Allow optional Drive host access once so EkClick can retrieve the original attachment bytes.", "Grant Drive Access", "drive"); return; }
  }
  if (settings.warnGeneric && chosen.some(file => file.confidence === "low")) {
    const review = chosen.filter(file => file.confidence === "low").map(file => file.name).join("\n");
    if (!confirm(`Some original filenames could not be confirmed. Review these names before downloading:\n\n${review}\n\nContinue?`)) return;
  }
  try {
    const state = await send({ type: "EKCLICK_ADD_BATCH", files: chosen, settings, referrer: currentPageUrl });
    if (state?.error) throw new Error(state.error);
    await chrome.storage.local.remove(EkClickBatchDraft.DRAFT_KEY);
    const queuedCount = Number.isInteger(state?.addedCount) ? state.addedCount : chosen.length;
    showToast(queuedCount ? `Queued ${queuedCount} selected file${queuedCount === 1 ? "" : "s"} for ${settings.downloadMethod === "browser" ? "the default browser location" : "the selected folder"}.` : "No supported selected files were queued.");
    if (!state?.managerReady) chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
  } catch (error) { console.warn("[EkClick][download] batch_start_failed", error?.name || "Error"); showToast(error?.message || "Could not start downloads."); }
}
$("downloadButton").addEventListener("click", async () => { if (batchStarting) return; batchStarting = true; updateButton(); try { await startDownloadBatch(); } finally { batchStarting = false; updateButton(); } });
$("folderActionButton").addEventListener("click", async () => {
  if (folderAction === "settings") {
    await saveSelectionDraft();
    chrome.runtime.openOptionsPage();
    return;
  }
  if (folderAction === "drive") {
    // Keep the optional host-access prompt on this explicit user click.
    try {
      const granted = await chrome.permissions.request({ origins: DRIVE_ORIGINS });
      drivePermissionGranted = granted;
      if (!granted) { setFolderAction("Drive host access was not granted. EkClick did not start downloads.", "Grant Drive Access", "drive"); return; }
      await refreshFolderSummary();
      await startDownloadBatch();
    } catch (error) {
      console.warn("[EkClick][download] drive_permission_request_failed", error?.name || "Error");
      setFolderAction("The browser could not grant Drive host access. Check the extension's site access and retry.", "Grant Drive Access", "drive");
    }
  }
});
chrome.permissions.onAdded.addListener(() => { refreshFolderSummary(); });
chrome.permissions.onRemoved.addListener(() => { refreshFolderSummary(); });
chrome.storage.local.get(["settings"]).then(data => { settings = Core.normalizeSettings(data.settings); applyTheme(); $("downloadMode").value = settings.mode; refreshFolderSummary(); discover(); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
