import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHref, routeQuery } from "../js/core/router.js";

test("router normalizes unknown routes", () => {
  assert.equal(parseRoute("#departments"), "departments");
  assert.equal(parseRoute("#unknown"), "overview");
  assert.equal(routeHref("tokens"), "#tokens");
  assert.deepEqual(routeQuery("#departments?department=quality"), { department: "quality" });
});
