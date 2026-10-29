import test from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../server/import/diff.mjs";

test("treats a missing previous snapshot (first publish) as all-new instead of crashing", () => {
  const next = {
    departments: { departments: [{ id: "quality", activeUsers: 8 }] },
    demands: { demands: [{ id: "d1", title: "品质数据" }] },
    capabilities: { capabilities: [] },
    radar: { items: [] },
  };
  const result = diffSnapshots(null, next);
  assert.deepEqual(result.added, [{ entity: "department", id: "quality" }, { entity: "demand", id: "d1" }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.removed, []);
});

test("diffs stable entity IDs instead of array order", () => {
  const previous = { departments: { departments: [{ id: "quality", activeUsers: 8 }] } };
  const next = { departments: { departments: [{ id: "legal", activeUsers: 2 }, { id: "quality", activeUsers: 9 }] } };
  const result = diffSnapshots(previous, next);
  assert.deepEqual(result.added, [{ entity: "department", id: "legal" }]);
  assert.equal(result.changed[0].id, "quality");
  assert.deepEqual(result.removed, []);
});
