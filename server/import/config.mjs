import { join, resolve } from "node:path";

export function createImportConfig(overrides = {}) {
  const root = resolve(overrides.root || process.cwd());
  const storageRoot = overrides.storageRoot || process.env.AI_COCKPIT_STORAGE || join(root, ".local-data", "import-storage");
  return {
    root,
    storageRoot: resolve(storageRoot),
    maxFileBytes: Number(process.env.IMPORT_MAX_FILE_BYTES || 10 * 1024 * 1024),
    maxPeriodBytes: Number(process.env.IMPORT_MAX_PERIOD_BYTES || 40 * 1024 * 1024),
    allowedOrigin: overrides.allowedOrigin || process.env.AI_COCKPIT_ORIGIN || "",
  };
}
