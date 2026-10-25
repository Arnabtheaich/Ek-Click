(function (root) {
  "use strict";
  const DB_NAME = "ekclick-directory-access";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const HANDLE_KEY = "download-directory";

  function openIndexedDB(factory = globalThis.indexedDB) {
    if (!factory) return Promise.reject(new Error("IndexedDB is unavailable in this extension page."));
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local directory storage."));
      request.onblocked = () => reject(new Error("Directory storage upgrade is blocked by another open EkClick page. Close and reopen EkClick."));
    });
  }
  function createIndexedDbAdapter(factory = globalThis.indexedDB) {
    return {
      async get(key) {
        const db = await openIndexedDB(factory);
        try {
          return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const request = tx.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Could not read the selected folder."));
            tx.onabort = () => reject(tx.error || new Error("Could not read the selected folder."));
          });
        } finally { db.close(); }
      },
      async set(key, value) {
        const db = await openIndexedDB(factory);
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not save the selected folder handle."));
            tx.onabort = () => reject(tx.error || new Error("Could not save the selected folder handle."));
          });
        } finally { db.close(); }
      },
      async delete(key) {
        const db = await openIndexedDB(factory);
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not remove the selected folder."));
            tx.onabort = () => reject(tx.error || new Error("Could not remove the selected folder."));
          });
        } finally { db.close(); }
      }
    };
  }
  function createDirectoryStore(adapter = createIndexedDbAdapter()) {
    return {
      get: () => adapter.get(HANDLE_KEY),
      save: handle => {
        if (!handle || handle.kind !== "directory" || typeof handle.getDirectoryHandle !== "function") return Promise.reject(new Error("The selected item is not a usable directory handle."));
        return adapter.set(HANDLE_KEY, handle);
      },
      clear: () => adapter.delete(HANDLE_KEY)
    };
  }
  function pickerCapabilities(win = globalThis.window) {
    return {
      secureContext: !!win?.isSecureContext,
      pickerAvailable: !!win && typeof win.showDirectoryPicker === "function",
      indexedDbAvailable: typeof globalThis.indexedDB !== "undefined"
    };
  }
  function chooseFolderDisabled(capabilities) { return !capabilities?.pickerAvailable; }
  function pickerStatusMessage(capabilities) {
    if (!capabilities?.pickerAvailable) return `This extension page cannot call showDirectoryPicker()${capabilities?.secureContext ? " even though it is a secure context" : " because it is not a secure context"}. A site permission cannot enable a missing browser API. EkClick will not use Downloads as a fallback.`;
    if (!capabilities.indexedDbAvailable) return "The folder picker is available, but IndexedDB is not; EkClick cannot persist a folder handle in this context.";
    return "The folder picker and local handle storage are available in this extension page.";
  }
  function evaluateBatchGate({ capabilities = {}, handle = null, writePermission = "denied", drivePermission = false } = {}) {
    if (handle) {
      if (writePermission !== "granted") return "folder-permission-required";
      if (!drivePermission) return "drive-permission-required";
      return "ready";
    }
    if (!capabilities.pickerAvailable) return "folder-picker-unavailable";
    if (!capabilities.indexedDbAvailable) return "folder-storage-unavailable";
    return "folder-required";
  }
  async function pickAndStore(win = globalThis.window, store = createDirectoryStore()) {
    if (!win || typeof win.showDirectoryPicker !== "function") {
      throw new Error("This Brave extension page does not expose showDirectoryPicker(). The picker cannot be enabled by granting site permission. EkClick will not fall back to Downloads.");
    }
    // Keep this first awaited operation directly inside the Choose Folder click handler.
    const handle = await win.showDirectoryPicker({ mode: "readwrite" });
    await store.save(handle);
    return handle;
  }
  async function queryWritePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return "denied";
    try { return await handle.queryPermission({ mode: "readwrite" }); }
    catch (_) { return "denied"; }
  }
  async function requestWritePermission(handle) {
    if (!handle || typeof handle.requestPermission !== "function") return "denied";
    try { return await handle.requestPermission({ mode: "readwrite" }); }
    catch (_) { return "denied"; }
  }
  const api = { DB_NAME, STORE_NAME, HANDLE_KEY, createIndexedDbAdapter, createDirectoryStore, pickerCapabilities, chooseFolderDisabled, pickerStatusMessage, evaluateBatchGate, pickAndStore, queryWritePermission, requestWritePermission };
  root.EkClickDirectoryStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
