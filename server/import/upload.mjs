import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
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

async function readHead(path, size = 4096) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * 边收边落盘，同时累计字节数与哈希。
 * 之前是把整份文件先缓冲进内存再校验，单文件上限与期次配额都要等收完才生效，
 * 40MB 的期次上限形同虚设；这里在写入过程中就判定，超限立刻中止并删除临时文件。
 */
function receiveToDisk(req, { dir, config, usedBytes }) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let meta;
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: config.maxFileBytes + 1 } });
    busboy.on("error", (error) => settle(error));
    busboy.on("field", (name, value) => { fields[name] = value; });
    busboy.on("file", (_name, stream, info) => {
      if (meta) {
        stream.resume();
        return;
      }
      meta = info;

      // 类型不对直接拒绝，一个字节都不写盘
      const typeCheck = validateUpload({ filename: info.filename, mime: info.mimeType, bytes: 1 }, config);
      if (!typeCheck.ok) {
        stream.resume();
        settle(new HttpError(422, typeCheck.code, typeCheck.message));
        return;
      }

      const fileId = randomUUID();
      const temp = join(dir, `${fileId}.html.upload-part`);
      const hash = createHash("sha256");
      let bytes = 0;
      let aborted = false;
      const out = createWriteStream(temp);

      const abort = (error) => {
        if (aborted) return;
        aborted = true;
        out.destroy();
        stream.resume();
        unlink(temp).catch(() => {});
        settle(error);
      };

      out.on("error", abort);
      // 用 data 处理器手动写盘（配合 pause/resume 做背压），不再 pipe，避免重复写入
      stream.on("data", (chunk) => {
        if (aborted) return;
        bytes += chunk.length;
        if (bytes > config.maxFileBytes) {
          abort(new HttpError(422, "FILE_TOO_LARGE", "单份报告超过大小限制"));
          return;
        }
        if (usedBytes + bytes > config.maxPeriodBytes) {
          abort(new HttpError(422, "PERIOD_TOO_LARGE", "本期上传总量超过限制"));
          return;
        }
        hash.update(chunk);
        if (!out.write(chunk)) {
          stream.pause();
          out.once("drain", () => stream.resume());
        }
      });
      stream.on("limit", () => abort(new HttpError(422, "FILE_TOO_LARGE", "单份报告超过大小限制")));
      stream.on("end", () => {
        if (aborted) return;
        const finalCheck = validateUpload({ filename: info.filename, mime: info.mimeType, bytes }, config);
        if (!finalCheck.ok) {
          abort(new HttpError(422, finalCheck.code, finalCheck.message));
          return;
        }
        out.end(() => settle(null, { fields, filename: info.filename, mime: info.mimeType, bytes, sha256: hash.digest("hex"), fileId, temp }));
      });
    });
    busboy.on("finish", () => {
      if (!meta) settle(new HttpError(422, "FILE_REQUIRED", "请选择 HTML 报告文件"));
    });
    req.pipe(busboy);
  });
}

/** 落盘后做编码与去重校验，再登记到期次草稿 */
async function finalizeUpload({ fields, filename, mime, bytes, sha256, fileId, temp, dir, period, periodId, store }) {
  const target = join(dir, `${fileId}.html`);
  try {
    detectHtmlEncoding(await readHead(temp));
    if (period.files.some((file) => file.sha256 === sha256)) throw new HttpError(409, "DUPLICATE_FILE", "同一文件已经加入本期草稿");
    await rename(temp, target);
    const file = {
      fileId, filename,
      title: fields.title || filename,
      reportType: fields.reportType || "other",
      departmentId: fields.departmentId || null,
      publishOriginal: fields.publishOriginal === "true",
      mime, bytes, sha256, encoding: "utf-8",
      uploadedAt: new Date().toISOString(),
    };
    await store.savePeriod(periodId, { ...period, files: [...period.files, file] });
    await store.appendAudit(periodId, { type: "file_uploaded", fileId, sha256 });
    return file;
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function receiveHtmlUpload(req, { periodId, store, config }) {
  if (!req.headers["content-type"]?.startsWith("multipart/form-data")) throw new HttpError(415, "MULTIPART_REQUIRED", "上传请求必须使用 multipart/form-data");

  // 期次与已用容量在落盘前读取，让配额判断能前置
  const period = await store.getPeriod(periodId);
  if (!period) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
  const usedBytes = period.files.reduce((total, file) => total + Number(file.bytes || 0), 0);
  const dir = store.uploadDir(periodId);
  await mkdir(dir, { recursive: true });

  const received = await receiveToDisk(req, { dir, config, usedBytes });
  return finalizeUpload({ ...received, dir, period, periodId, store });
}
