"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const BatchQueue = require("../shared/batch-queue.js");

test("a one-file batch cannot pick queued items from the previous 122-file batch", () => {
  const oldBatch = Array.from({ length: 122 }, (_, index) => ({ id: `old-${index}`, batchId: "old-batch", state: "queued" }));
  const selected = { id: "only-selected", batchId: "new-batch", state: "queued" };
  assert.equal(BatchQueue.nextQueuedItem([...oldBatch, selected], "new-batch"), selected);
  assert.equal(BatchQueue.nextQueuedItem(oldBatch, "new-batch"), null);
  assert.equal(BatchQueue.nextQueuedItem(oldBatch, undefined), null);
});
