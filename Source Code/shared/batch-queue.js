(function (root) {
  "use strict";
  function nextQueuedItem(items, activeBatchId) {
    if (typeof activeBatchId !== "string" || !activeBatchId) return null;
    return (Array.isArray(items) ? items : []).find(item => item?.batchId === activeBatchId && item.state === "queued") || null;
  }
  const api = { nextQueuedItem };
  root.EkClickBatchQueue = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
