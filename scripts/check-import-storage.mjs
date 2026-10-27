import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const storage = resolve(process.env.AI_COCKPIT_STORAGE || join(root, ".local-data", "import-storage"));
const targets = [storage, join(root, "data", "snapshots"), join(root, "reports"), join(root, ".publish-tmp")];
for (const target of targets) {
  await mkdir(target, { recursive: true });
  await access(target, constants.R_OK | constants.W_OK);
  const probe = join(target, `.write-check-${process.pid}`);
  await writeFile(probe, "ok", "utf8");
  await unlink(probe);
  console.log(`ok: ${target}`);
}
