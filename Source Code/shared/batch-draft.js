(function (root) {
  "use strict";
  const DRAFT_KEY = "popupBatchDraft";
  function pageKey(value) {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch (_) { return ""; }
  }
  function makeDraft(files, selectedIds, pageUrl, now = Date.now()) {
    return {
      pageKey: pageKey(pageUrl),
      ids: files.filter(file => selectedIds.has(file.id)).map(file => file.id),
      renames: files.filter(file => file.renamed).map(file => ({ id: file.id, name: file.name })),
      savedAt: now
    };
  }
  function restoreSelection(files, draft, pageUrl, now = Date.now(), maxAge = 24 * 60 * 60 * 1000) {
    const supported = files.filter(file => file.supported);
    if (!draft || draft.pageKey !== pageKey(pageUrl) || !Array.isArray(draft.ids) || now - Number(draft.savedAt || 0) > maxAge) return supported.map(file => file.id);
    const ids = new Set(draft.ids);
    return supported.filter(file => ids.has(file.id)).map(file => file.id);
  }
  function restoreRenames(files, draft, pageUrl, now = Date.now(), maxAge = 24 * 60 * 60 * 1000) {
    if (!draft || draft.pageKey !== pageKey(pageUrl) || !Array.isArray(draft.renames) || now - Number(draft.savedAt || 0) > maxAge) return files;
    const renames = new Map(draft.renames.filter(rename => rename && typeof rename.id === "string" && typeof rename.name === "string").map(rename => [rename.id, rename.name]));
    for (const file of files) if (renames.has(file.id)) {
      file.name = Core.sanitizeSegment(renames.get(file.id), file.name);
      file.renamed = true;
      if (file.confidence !== "high") file.confidence = "reviewed";
    }
    return files;
  }
  const api = { DRAFT_KEY, pageKey, makeDraft, restoreSelection, restoreRenames };
  root.EkClickBatchDraft = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
