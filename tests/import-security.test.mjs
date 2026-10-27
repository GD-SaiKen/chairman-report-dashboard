import test from "node:test";
import assert from "node:assert/strict";
import { validateCsrf, validateOrigin } from "../server/import/security.mjs";

test("checks same-origin and matching CSRF values", () => {
  assert.equal(validateOrigin("https://cockpit.example.com", { allowedOrigin: "https://cockpit.example.com" }), true);
  assert.equal(validateOrigin("https://evil.example", { allowedOrigin: "https://cockpit.example.com" }), false);
  assert.equal(validateCsrf({ cookieToken: "a", headerToken: "a" }), true);
  assert.equal(validateCsrf({ cookieToken: "a", headerToken: "b" }), false);
});
