import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGithubRepo } from "../scripts/collect-radar.mjs";

test("normalizes GitHub repository candidates", () => {
  const item = normalizeGithubRepo({ full_name: "acme/agent-kit", html_url: "https://github.com/acme/agent-kit", stargazers_count: 3200, agent: true }, { period: "2026-10-12" });
  assert.equal(item.type, "agent-tool");
  assert.equal(item.stars, 3200);
  assert.equal(item.reviewStatus, "candidate");
  assert.equal(item.period, "2026-10-12");
});
