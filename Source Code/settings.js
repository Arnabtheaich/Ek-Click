"use strict";
const $ = id => document.getElementById(id);
let settings = Core.normalizeSettings();
const directoryStore = EkClickDirectoryStore.createDirectoryStore();
let currentDirectory = null, folderSelectionRevision = 0;
function applyTheme() { const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.body.classList.toggle("theme-dark", dark); }
function fill() { $("theme").value = settings.theme; $("mode").value = settings.mode; $("downloadMethod").value = settings.downloadMethod; syncDownloadMode(); $("folderTemplate").value = settings.folderTemplate; $("duplicate").value = settings.duplicate; $("compact").checked = !!settings.compact; $("warnGeneric").checked = !!settings.warnGeneric; }
function syncDownloadMode() { const zipOption = $("mode").querySelector('option[value="zip"]'); zipOption.disabled = $("downloadMethod").value !== "folder"; if (zipOption.disabled && $("mode").value === "zip") $("mode").value = "individual"; }
function read() { return Core.normalizeSettings({ theme: $("theme").value, mode: $("mode").value, downloadMethod: $("downloadMethod").value, folderTemplate: $("folderTemplate").value, duplicate: $("duplicate").value, compact: $("compact").checked, warnGeneric: $("warnGeneric").checked }); }
async function save() { settings = read(); await chrome.storage.local.set({ settings }); applyTheme(); if (currentDirectory) updateFolderUi(currentDirectory, await EkClickDirectoryStore.queryWritePermission(currentDirectory)); else await refreshFolderStatus(); $("saveStatus").textContent = "Preferences saved locally."; }
function updateFolderUi(handle, permission = "prompt") {
  currentDirectory = handle || null;
  const capabilities = EkClickDirectoryStore.pickerCapabilities(window);
  const supported = capabilities.pickerAvailable;
  $("chooseFolder").textContent = handle ? "Change Folder" : "Choose Folder";
  // Lack of a selected handle must not disable selection. Only an absent API
  // disables the picker; storage limitations are explained separately.
  $("chooseFolder").disabled = EkClickDirectoryStore.chooseFolderDisabled(capabilities);
  $("folderName").textContent = handle?.name || "No folder selected";
  $("grantFolderAccess").hidden = !handle || permission === "granted";
  $("folderDiagnostics").textContent = `secure context: ${capabilities.secureContext ? "yes" : "no"}; showDirectoryPicker: ${capabilities.pickerAvailable ? "available" : "not exposed"}; IndexedDB: ${capabilities.indexedDbAvailable ? "available" : "not available"}; saved directory handle: ${handle ? "present" : "absent"}; write permission: ${permission}`;
  if (settings.downloadMethod === "browser") $("folderStatus").textContent = "Not used in Default browser location mode. Files go to the browser configured Downloads folder.";
  else if (!supported || !capabilities.indexedDbAvailable) $("folderStatus").textContent = EkClickDirectoryStore.pickerStatusMessage(capabilities);
  else if (!handle) $("folderStatus").textContent = "Choose a destination folder once for EkClick batches.";
  else if (permission === "granted") $("folderStatus").textContent = "Folder selected and writable in this session.";
  else $("folderStatus").textContent = "Folder handle remembered; grant write access before the next batch.";
}
async function refreshFolderStatus() {
  const revision = folderSelectionRevision;
  const capabilities = EkClickDirectoryStore.pickerCapabilities(window);
  try {
    const handle = await directoryStore.get();
    const permission = await EkClickDirectoryStore.queryWritePermission(handle);
    if (revision !== folderSelectionRevision) return;
    updateFolderUi(handle, permission);
  } catch (error) {
    if (revision !== folderSelectionRevision) return;
    updateFolderUi(null, "denied"); $("folderStatus").textContent = error.message; console.warn("[EkClick][folder] handle_restore_failed", error?.name || "Error", capabilities);
  }
}
$("chooseFolder").addEventListener("click", async () => {
  try {
    const handle = await EkClickDirectoryStore.pickAndStore(window, directoryStore);
    folderSelectionRevision++;
    // Choosing a folder means the user wants EkClick's saved directory to be
    // the active destination. Browser mode deliberately ignores this handle.
    settings = Core.normalizeSettings({ ...settings, downloadMethod: "folder" });
    $("downloadMethod").value = settings.downloadMethod;
    syncDownloadMode();
    await chrome.storage.local.set({ settings, directorySelectionRevision: `${Date.now()}-${crypto.randomUUID()}` });
    const permission = await EkClickDirectoryStore.queryWritePermission(handle);
    updateFolderUi(handle, permission);
    $("folderStatus").textContent = permission === "granted" ? "Folder selected and writable. EkClick downloads will use this folder." : "Folder selected. Grant access before downloading.";
    $("saveStatus").textContent = "Selected folder mode is active; downloads will use this folder.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("[EkClick][folder] picker_failed", { name: error?.name || "Error", message: String(error?.message || "").slice(0, 180) });
    $("folderStatus").textContent = error?.message || "Could not select this folder.";
  }
});
$("grantFolderAccess").addEventListener("click", async () => {
  if (!currentDirectory) return;
  const permission = await EkClickDirectoryStore.requestWritePermission(currentDirectory);
  updateFolderUi(currentDirectory, permission);
  $("folderStatus").textContent = settings.downloadMethod === "browser" ? "Folder permission saved, but Default browser location mode does not use it." : (permission === "granted" ? "Folder write access granted." : "Folder access was not granted. Choose the folder again or check browser permissions.");
});
chrome.storage.local.get(["settings"]).then(data => { settings = Core.normalizeSettings(data.settings); fill(); applyTheme(); });
refreshFolderStatus();
$("saveSettings").addEventListener("click", save);
$("downloadMethod").addEventListener("change", syncDownloadMode);
for (const id of ["theme", "mode", "downloadMethod", "folderTemplate", "duplicate", "compact", "warnGeneric"]) $(id).addEventListener("change", save);
$("themeToggle").addEventListener("click", () => { settings.theme = ({ system: "light", light: "dark", dark: "system" })[settings.theme]; $("theme").value = settings.theme; save(); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
