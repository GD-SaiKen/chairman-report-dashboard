import test from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../server/import/diff.mjs";

test("diffs stable entity IDs instead of array order", () => {
  const previous = { departments: { departments: [{ id: "quality", activeUsers: 8 }] } };
  const next = { departments: { departments: [{ id: "legal", activeUsers: 2 }, { id: "quality", activeUsers: 9 }] } };
  const result = diffSnapshots(previous, next);
  assert.deepEqual(result.added, [{ entity: "department", id: "legal" }]);
  assert.equal(result.changed[0].id, "quality");
  assert.deepEqual(result.removed, []);
});
