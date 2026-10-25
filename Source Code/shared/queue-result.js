(function (root) {
  "use strict";
  function fromSuccess(result) {
    return {
      state: result.state,
      progress: result.progress ?? 0,
      bytesWritten: result.bytesWritten,
      totalBytes: result.totalBytes,
      actualName: result.name,
      path: result.path,
      message: result.message
    };
  }
  function fromFailure(error) {
    const cancelled = error?.name === "AbortError";
    return {
      state: cancelled ? "skipped" : "failed",
      message: cancelled ? "Cancelled by the user." : (error?.message || "The file could not be verified and saved.")
    };
  }
  const api = { fromSuccess, fromFailure };
  root.EkClickQueueResult = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
