import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Busboy from "busboy";
import { HttpError } from "./http.mjs";

const HTML_EXT = /\.(html?|xhtml)$/i;
const HTML_MIME = new Set(["text/html", "application/xhtml+xml", "application/octet-stream"]);

export function validateUpload({ filename, mime, bytes }, config) {
  if (!HTML_EXT.test(filename || "") || !HTML_MIME.has((mime || "").toLowerCase())) {
    return { ok: false, code: "HTML_ONLY", message: "仅支持 .html 或 .htm 报告" };
  }
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, code: "EMPTY_FILE", message: "上传文件为空" };
  if (bytes > config.maxFileBytes) return { ok: false, code: "FILE_TOO_LARGE", message: "单份报告超过大小限制" };
  return { ok: true };
}

export function detectHtmlEncoding(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return "utf-8";
  const head = buffer.subarray(0, 4096).toString("latin1");
  const charset = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (!charset || charset === "utf-8" || charset === "utf8") return "utf-8";
  throw new HttpError(422, "ENCODING_REQUIRED", "无法确定 HTML 编码，请将报告另存为 UTF-8 后重新上传。");
}

export async function storeHtmlBuffer({ buffer, filename, mime, metadata, periodId, store, config }) {
  const check = validateUpload({ filename, mime, bytes: buffer.length }, config);
  if (!check.ok) throw new HttpError(422, check.code, check.message);
  detectHtmlEncoding(buffer);
  const period = await store.getPeriod(periodId);
  if (!period) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (period.files.some((file) => file.sha256 === sha256)) throw new HttpError(409, "DUPLICATE_FILE", "同一文件已经加入本期草稿");
  const used = period.files.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  if (used + buffer.length > config.maxPeriodBytes) throw new HttpError(422, "PERIOD_TOO_LARGE", "本期上传总量超过限制");
  const fileId = randomUUID();
  const dir = store.uploadDir(periodId);
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${fileId}.html`);
  const temp = `${target}.upload-part`;
  await writeFile(temp, buffer);
  await rename(temp, target);
  const file = { fileId, filename, title: metadata.title || filename, reportType: metadata.reportType || "other", departmentId: metadata.departmentId || null, publishOriginal: metadata.publishOriginal === "true", mime, bytes: buffer.length, sha256, encoding: "utf-8", uploadedAt: new Date().toISOString() };
  await store.savePeriod(periodId, { ...period, files: [...period.files, file] });
  await store.appendAudit(periodId, { type: "file_uploaded", fileId, sha256 });
  return file;
}

export async function receiveHtmlUpload(req, { periodId, store, config }) {
  if (!req.headers["content-type"]?.startsWith("multipart/form-data")) throw new HttpError(415, "MULTIPART_REQUIRED", "上传请求必须使用 multipart/form-data");
  return new Promise((resolve, reject) => {
    const fields = {};
    const chunks = [];
    let fileMeta;
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: config.maxFileBytes + 1 } });
    busboy.on("field", (name, value) => { fields[name] = value; });
    busboy.on("file", (_name, stream, info) => {
      fileMeta = info;
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => reject(new HttpError(422, "FILE_TOO_LARGE", "单份报告超过大小限制")));
    });
    busboy.on("error", reject);
    busboy.on("finish", async () => {
      try {
        if (!fileMeta) throw new HttpError(422, "FILE_REQUIRED", "请选择 HTML 报告文件");
        resolve(await storeHtmlBuffer({ buffer: Buffer.concat(chunks), filename: fileMeta.filename, mime: fileMeta.mimeType, metadata: fields, periodId, store, config }));
      } catch (error) { reject(error); }
    });
    req.pipe(busboy);
  });
}
