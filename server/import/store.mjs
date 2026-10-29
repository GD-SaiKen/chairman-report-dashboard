import * as nodeFs from "node:fs/promises";
import { join, resolve } from "node:path";
import { HttpError } from "./http.mjs";

const PERIOD_ID = /^\d{4}-\d{2}-\d{2}$/;

export function assertPeriodId(periodId) {
  // 非法期次 id 是客户端错误，不该报成 500
  if (!PERIOD_ID.test(periodId || "")) throw new HttpError(400, "INVALID_PERIOD_ID", "期次 ID 必须是 YYYY-MM-DD 格式");
  return periodId;
}

async function readJson(fs, path, fallback = null) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(fs, path, value) {
  await fs.mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, path);
}

/**
 * 按 key 串行的乐观锁。
 * 文件存储的读—改—写天然有竞态：两个并发上传或发布会互相覆盖，
 * 这里不需要引入锁服务，按 key 排队就足以保证同一期次的操作互斥。
 */
const locks = new Map();

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((done) => { release = done; });
  const chained = previous.then(() => gate);
  locks.set(key, chained);
  await previous;
  try {
    return await task();
  } finally {
    release();
    // 只有链条上最后一个任务才回收条目，避免 Map 无限增长
    if (locks.get(key) === chained) locks.delete(key);
  }
}

export class FileImportStore {
  constructor(storageRoot, { fs = nodeFs } = {}) {
    this.root = resolve(storageRoot);
    this.fs = fs;
  }

  /** 串行执行同一期次的读—改—写，避免并发互相覆盖 */
  transaction(periodId, task) {
    return withLock(`period:${assertPeriodId(periodId)}`, task);
  }

  draftDir(periodId) {
    return join(this.root, "drafts", assertPeriodId(periodId));
  }

  uploadDir(periodId) {
    return join(this.root, "uploads", assertPeriodId(periodId), "files");
  }

  periodPath(periodId) { return join(this.draftDir(periodId), "period.json"); }
  draftPath(periodId) { return join(this.draftDir(periodId), "draft.json"); }
  qualityPath(periodId) { return join(this.draftDir(periodId), "quality.json"); }

  async createPeriod(input) {
    const id = assertPeriodId(input.id);
    if (await this.getPeriod(id)) throw new Error("period already exists");
    const period = {
      id,
      label: input.label || `${id} 期`,
      window: input.window || id,
      asOf: input.asOf || null,
      status: "uploaded",
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.fs, this.periodPath(id), period);
    await writeJsonAtomic(this.fs, this.draftPath(id), { period: { id }, files: [], candidates: {}, quality: { issues: [] }, revisions: [] });
    await writeJsonAtomic(this.fs, this.qualityPath(id), { status: "ok", issues: [] });
    return period;
  }

  async getPeriod(periodId) { return readJson(this.fs, this.periodPath(periodId)); }
  async getDraft(periodId) { return readJson(this.fs, this.draftPath(periodId)); }
  async getQuality(periodId) { return readJson(this.fs, this.qualityPath(periodId)); }

  async savePeriod(periodId, period) {
    assertPeriodId(periodId);
    return writeJsonAtomic(this.fs, this.periodPath(periodId), { ...period, id: periodId, updatedAt: new Date().toISOString() });
  }

  async saveDraft(periodId, draft) { return writeJsonAtomic(this.fs, this.draftPath(periodId), draft); }
  async saveQuality(periodId, quality) { return writeJsonAtomic(this.fs, this.qualityPath(periodId), quality); }

  async appendAudit(periodId, event) {
    const path = join(this.draftDir(periodId), "audit.jsonl");
    await this.fs.mkdir(this.draftDir(periodId), { recursive: true });
    await this.fs.appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
  }
}
