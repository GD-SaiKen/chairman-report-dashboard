import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../server/app.mjs";
import { resolveStaticFile } from "../server/static-files.mjs";

function responseCapture() {
  const output = { status: 0, headers: {}, body: "" };
  return {
    output,
    writeHead(status, headers) { output.status = status; output.headers = headers; },
    end(body = "") { output.body += body; },
  };
}

test("serves dashboard files and exposes import health under the same handler", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "ai-cockpit-"));
  const root = process.cwd();
  const handler = createRequestHandler({ root, storageRoot, allowedOrigin: "http://127.0.0.1" });
  const response = responseCapture();
  await handler({ method: "GET", url: "/api/import/health" }, response);

  assert.equal((await resolveStaticFile(root, "/index.html")).endsWith("index.html"), true);
  assert.equal(response.output.status, 200);
  assert.deepEqual(JSON.parse(response.output.body), { ok: true, service: "html-import" });
});
