import test from "node:test";
import assert from "node:assert/strict";
import { selectPeriod } from "../js/core/dashboard-data.js";

test("selectPeriod falls back to manifest default", () => {
  const manifest = { defaultPeriodId: "new", periods: [{ id: "new" }, { id: "old" }] };
  assert.equal(selectPeriod(manifest, "missing").id, "new");
  assert.equal(selectPeriod(manifest, "old").id, "old");
});
