# HTML 报告导入与审核发布（第二阶段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统一 Basic Auth 保护下提供线上 HTML 报告上传、混合提取、人工审核、原子发布和版本回滚能力，用多份报告生成公司 AI 驾驶舱周快照。

**Architecture:** 保留现有原生 ES Module 驾驶舱与模块化 JSON 快照，将 `server.mjs` 拆为静态服务和 `/api/import/*` 导入服务。原始 HTML、草稿和发布版本落在 Git 外的文件存储；规则提取与可替换 AI Provider 生成带证据的候选，人工审核通过后通过临时目录与原子重命名更新 `data/manifest.json`、`data/snapshots/` 和 `reports/`。

**Tech Stack:** Node.js ≥18、原生 HTTP、Busboy 1.x、parse5 7.x、原生 ES Modules、Node Test Runner、HTML/CSS、JSON、Nginx Basic Auth。

---

## 文件结构

新增：

```text
server/app.mjs                         # HTTP 装配与启动
server/static-files.mjs                # 只读静态文件响应
server/import/config.mjs               # 路径、大小与环境配置
server/import/http.mjs                 # JSON、错误、请求体和路由辅助
server/import/security.mjs             # Origin 与 CSRF 校验
server/import/store.mjs                # 草稿、任务和发布索引持久化
server/import/state-machine.mjs        # 导入状态转换
server/import/upload.mjs               # multipart 与 HTML 文件校验
server/import/sanitize.mjs             # 不可信 HTML 清洗
server/import/segment.mjs              # 章节、表格、列表、数字分块
server/import/rule-extractor.mjs        # 确定性字段与证据提取
server/import/extraction-schema.mjs     # AI 输出契约
server/import/extraction-provider.mjs   # 可替换 AI Provider
server/import/merge-draft.mjs           # 多报告合并、冲突与质量报告
server/import/diff.mjs                  # 与上一发布版本的差异
server/import/publish.mjs               # 生成、校验、原子发布和回滚
server/import/routes.mjs                # /api/import/* 路由
manage/import/index.html                # 掩门工作台外壳
manage/import/manage.css                # 工作台样式
manage/import/app.js                    # 工作台状态与流程
manage/import/api.js                    # API 客户端与 CSRF
manage/import/views.js                  # 上传、审核、差异和历史视图
tests/fixtures/import/*.html            # 安全、冲突、多报告测试样本
tests/import-*.test.mjs                 # 导入链路测试
deploy/systemd/ai-cockpit.service.example
```

修改：

```text
server.mjs                              # 兼容启动入口，转发到 server/app.mjs
package.json
package-lock.json
.gitignore
deploy/nginx/ai-cockpit.conf.example
README.md
```

不修改：

```text
data/catalog.json                       # 历史迁移兼容
reports/ 已发布历史内容
现有六专题数据结构的字段语义
```

---

### Task 1: 建立导入服务骨架和文件存储配置

**Files:**

- Create: `server/app.mjs`
- Create: `server/static-files.mjs`
- Create: `server/import/config.mjs`
- Create: `server/import/http.mjs`
- Create: `tests/import-server.test.mjs`
- Modify: `server.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

- [ ] **Step 1: 安装最小解析依赖**

Run:

```powershell
npm install busboy@1 parse5@7
```

Expected: `package.json` 增加 `busboy` 和 `parse5`，生成或更新锁文件；不引入 Web 框架、数据库或前端构建工具。

- [ ] **Step 2: 写失败的服务边界测试**

创建 `tests/import-server.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

test("serves dashboard and exposes import health under the same server", async (t) => {
  const storageRoot = await mkdtemp(join(tmpdir(), "ai-cockpit-"));
  const app = createApp({ root: process.cwd(), storageRoot, allowedOrigin: "http://127.0.0.1" });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const { port } = app.address();

  const page = await fetch(`http://127.0.0.1:${port}/index.html`);
  const health = await fetch(`http://127.0.0.1:${port}/api/import/health`);
  assert.equal(page.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: "html-import" });
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
node --test tests/import-server.test.mjs
```

Expected: FAIL，提示找不到 `server/app.mjs`。

- [ ] **Step 4: 实现配置和 HTTP 骨架**

`server/import/config.mjs` 导出：

```js
export function createImportConfig(overrides = {}) {
  const root = overrides.root || process.cwd();
  const storageRoot = overrides.storageRoot || process.env.AI_COCKPIT_STORAGE;
  if (!storageRoot) throw new Error("AI_COCKPIT_STORAGE is required");
  return {
    root,
    storageRoot,
    maxFileBytes: Number(process.env.IMPORT_MAX_FILE_BYTES || 10 * 1024 * 1024),
    maxPeriodBytes: Number(process.env.IMPORT_MAX_PERIOD_BYTES || 40 * 1024 * 1024),
    allowedOrigin: overrides.allowedOrigin || process.env.AI_COCKPIT_ORIGIN || "",
  };
}
```

`server/import/http.mjs` 至少提供：

```js
export function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
```

`server/app.mjs` 导出 `createApp(options)`，先支持静态响应与 `GET /api/import/health`；`server.mjs` 只读取 `HOST`、`PORT` 并启动 `createApp()`。

- [ ] **Step 5: 隔离运行时文件**

`.gitignore` 增加：

```gitignore
storage/
.publish-tmp/
*.upload-part
```

- [ ] **Step 6: 验证并提交**

Run:

```powershell
node --test tests/import-server.test.mjs
npm run check
```

Expected: PASS。

```powershell
git add package.json package-lock.json .gitignore server.mjs server tests/import-server.test.mjs
git commit -m "feat: add HTML import service foundation"
```

---

### Task 2: 实现草稿存储和导入状态机

**Files:**

- Create: `server/import/store.mjs`
- Create: `server/import/state-machine.mjs`
- Create: `tests/import-store.test.mjs`
- Create: `tests/import-state-machine.test.mjs`

- [ ] **Step 1: 写状态转换失败测试**

`tests/import-state-machine.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { transitionImport } from "../server/import/state-machine.mjs";

test("allows the reviewed happy path", () => {
  assert.equal(transitionImport("uploaded", "sanitizing"), "sanitizing");
  assert.equal(transitionImport("validating", "review_required"), "review_required");
  assert.equal(transitionImport("approved", "publishing"), "publishing");
});

test("does not publish an unapproved draft", () => {
  assert.throws(() => transitionImport("review_required", "publishing"), /invalid transition/);
});

test("processing states may fail", () => {
  assert.equal(transitionImport("extracting", "failed"), "failed");
});
```

- [ ] **Step 2: 写持久化恢复失败测试**

`tests/import-store.test.mjs` 使用临时目录创建 `FileImportStore`，保存期次后重新实例化，断言仍能读取：

```js
const first = new FileImportStore(root);
await first.createPeriod({ id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00" });
const second = new FileImportStore(root);
assert.equal((await second.getPeriod("2026-10-27")).status, "uploaded");
```

- [ ] **Step 3: 实现固定状态机**

`state-machine.mjs` 固定状态：

```js
export const IMPORT_STATES = [
  "uploaded", "sanitizing", "extracting", "validating",
  "review_required", "approved", "publishing", "published", "failed",
];

const NEXT = {
  uploaded: ["sanitizing", "failed"],
  sanitizing: ["extracting", "failed"],
  extracting: ["validating", "failed"],
  validating: ["review_required", "failed"],
  review_required: ["approved", "sanitizing", "failed"],
  approved: ["publishing", "review_required"],
  publishing: ["published", "failed"],
  failed: ["sanitizing"],
  published: [],
};
```

`transitionImport(from, to)` 只允许 `NEXT[from]` 中的状态。

- [ ] **Step 4: 实现文件存储**

`FileImportStore` 使用以下目录：

```text
{storageRoot}/uploads/{periodId}/files/
{storageRoot}/drafts/{periodId}/period.json
{storageRoot}/drafts/{periodId}/draft.json
{storageRoot}/drafts/{periodId}/quality.json
{storageRoot}/drafts/{periodId}/audit.jsonl
{storageRoot}/releases/index.json
{storageRoot}/releases/{releaseId}/release.json
```

所有 JSON 更新使用“写入同目录临时文件 → `rename`”方式，避免进程中断留下半份 JSON。对 period ID 使用 `/^\d{4}-\d{2}-\d{2}$/` 校验，任何路径参数不得直接拼接到文件系统路径。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-state-machine.test.mjs tests/import-store.test.mjs
git add server/import/store.mjs server/import/state-machine.mjs tests
git commit -m "feat: persist import drafts and state transitions"
```

---

### Task 3: 实现安全上传和 HTML 文件检查

**Files:**

- Create: `server/import/upload.mjs`
- Create: `server/import/routes.mjs`
- Create: `tests/import-upload.test.mjs`
- Create: `tests/fixtures/import/valid-info-weekly.html`
- Create: `tests/fixtures/import/not-html.txt`
- Modify: `server/import/routes.mjs`

- [ ] **Step 1: 写上传规则失败测试**

覆盖：

```js
assert.equal(validateUpload({ filename: "report.html", mime: "text/html", bytes: 1024 }, config).ok, true);
assert.equal(validateUpload({ filename: "report.pdf", mime: "application/pdf", bytes: 1024 }, config).ok, false);
assert.equal(validateUpload({ filename: "report.html", mime: "text/html", bytes: config.maxFileBytes + 1 }, config).code, "FILE_TOO_LARGE");
```

再以同一期两次上传相同内容，断言第二次返回 `409 DUPLICATE_FILE`。

- [ ] **Step 2: 实现流式 multipart 接收**

使用 Busboy，接口固定为：

```js
export async function receiveHtmlUpload(req, { periodId, store, config })
```

接受字段：

```text
file             HTML 文件
title            报告标题
reportType       info-weekly | project-report | department-report | other
departmentId     来源一级部门 ID
publishOriginal  true | false
```

上传过程中计算 SHA-256 并写入 `.upload-part`；只有扩展名、MIME、大小、期次总量和重复哈希全部通过后才原子重命名为 `{fileId}.html`。客户端文件名只作为元数据，不能作为磁盘文件名。

- [ ] **Step 3: 实现编码检查**

第一版仅接受 UTF-8、UTF-8 BOM，或 `<meta charset>` 明确声明且可由 `TextDecoder` 支持的编码。无法确定编码时返回：

```json
{
  "code": "ENCODING_REQUIRED",
  "message": "无法确定 HTML 编码，请将报告另存为 UTF-8 后重新上传。"
}
```

不得以替换字符静默解析后发布。

- [ ] **Step 4: 注册创建期次和上传路由**

`server/import/routes.mjs` 先实现 `POST /api/import/periods` 与 `POST /api/import/periods/:id/files`。创建期次请求体固定为 `{ id, label, window, asOf }`；上传成功返回 `{ fileId, title, sha256, bytes, status: "uploaded" }`。路由通过构造参数接收 `store`、`config` 和上传函数，禁止在模块顶层读取生产路径，确保测试使用临时目录。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-upload.test.mjs
git add server/import/upload.mjs server/import/routes.mjs tests/fixtures/import tests/import-upload.test.mjs
git commit -m "feat: validate and store HTML report uploads"
```

---

### Task 4: 清洗不可信 HTML 并生成可追溯分块

**Files:**

- Create: `server/import/sanitize.mjs`
- Create: `server/import/segment.mjs`
- Create: `tests/import-sanitize.test.mjs`
- Create: `tests/import-segment.test.mjs`
- Create: `tests/fixtures/import/unsafe-report.html`
- Create: `tests/fixtures/import/structured-report.html`

- [ ] **Step 1: 写危险内容清洗失败测试**

`unsafe-report.html` 包含 `script`、`iframe`、`form`、`onclick`、`javascript:` URL、`meta refresh` 和远程图片。测试断言：

```js
const result = sanitizeHtml(source);
assert.doesNotMatch(result.html, /<script|<iframe|onclick|javascript:/i);
assert.equal(result.remoteResources.length, 1);
assert.ok(result.warnings.some((item) => item.code === "REMOTE_RESOURCE_REMOVED"));
```

- [ ] **Step 2: 写结构分块失败测试**

测试标题、段落、列表和表格转换为统一块：

```js
const blocks = segmentHtml(sanitized.document);
assert.deepEqual(blocks[0], {
  id: "block-0001",
  kind: "heading",
  sectionTitle: "AI 使用情况",
  text: "AI 使用情况",
  locator: "body>main>h2:nth-of-type(1)",
});
assert.equal(blocks.find((item) => item.kind === "table").rows[0][0], "部门");
```

- [ ] **Step 3: 用 parse5 实现清洗**

`sanitizeHtml(source)` 返回：

```js
{
  html,
  document,
  warnings,
  remoteResources,
  removedNodeCount,
}
```

删除元素：`script`、`iframe`、`object`、`embed`、`form`、`base`、刷新型 `meta`。删除所有 `on*` 属性；拒绝 `javascript:`、`data:text/html` 和协议相对远程 URL。隐藏节点不进入文本分块，并生成 `HIDDEN_TEXT_IGNORED` 警告。

- [ ] **Step 4: 实现分块和证据定位**

`segmentHtml(document)` 输出 `heading`、`paragraph`、`list`、`table`、`link` 五类块。每块包含稳定块 ID、最近章节标题、DOM 定位路径、规范化文本和表格二维数组。单块文本上限 6,000 字符，超限按段落边界拆分并保留相同章节标题。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-sanitize.test.mjs tests/import-segment.test.mjs
git add server/import/sanitize.mjs server/import/segment.mjs tests
git commit -m "feat: sanitize and segment uploaded HTML reports"
```

---

### Task 5: 实现带证据的规则提取

**Files:**

- Create: `server/import/rule-extractor.mjs`
- Create: `tests/import-rule-extractor.test.mjs`
- Create: `tests/fixtures/import/token-and-capability-report.html`

- [ ] **Step 1: 写确定性提取失败测试**

测试 HTML 表格包含部门、活跃人数、Token、Skill 与 Agent。断言：

```js
const result = extractByRules(blocks, { sourceFileId: "file-01" });
assert.equal(result.departments[0].name, "品质");
assert.equal(result.departments[0].activeUsers, 8);
assert.equal(result.tokenCandidates[0].cacheRead, 176201072);
assert.deepEqual(result.tokenCandidates[0].evidence, {
  sourceFileId: "file-01",
  sectionTitle: "Token 使用情况",
  blockId: "block-0004",
  method: "rule",
  confidence: 1,
  reviewStatus: "pending",
});
```

- [ ] **Step 2: 实现数字和单位解析**

导出：

```js
parseLocalizedNumber("1,523,000") === 1523000
parseLocalizedNumber("176.2M") === 176200000
parsePercent("94%") === 0.94
```

空值、`—`、含糊区间和无法识别单位返回 `null` 并附质量警告，不返回 `0`。

- [ ] **Step 3: 实现规则提取结果**

`extractByRules(blocks, context)` 返回：

```js
{
  periodCandidates: [],
  departmentCandidates: [],
  peopleCandidates: [],
  demandCandidates: [],
  capabilityCandidates: [],
  tokenCandidates: [],
  radarCandidates: [],
  reportLinks: [],
  warnings: [],
}
```

只有表头和附近语义能够确定字段时才提取数值。每个字段必须附证据；无证据对象不得进入后续合并。

- [ ] **Step 4: 验证并提交**

```powershell
node --test tests/import-rule-extractor.test.mjs
git add server/import/rule-extractor.mjs tests
git commit -m "feat: extract evidence-backed facts from HTML reports"
```

---

### Task 6: 实现可替换 AI 提取 Provider 和严格契约

**Files:**

- Create: `server/import/extraction-schema.mjs`
- Create: `server/import/extraction-provider.mjs`
- Create: `tests/import-extraction-provider.test.mjs`

- [ ] **Step 1: 写 Provider 失败与修复测试**

使用 mock `fetch` 覆盖：

- 合法 JSON 返回候选和证据引用。
- 第一次返回 Markdown 包裹 JSON，结构修复后成功。
- 两次均不符合契约时返回规则结果和 `AI_EXTRACTION_FAILED` 警告。
- 请求负载不包含原始 `<script>`、隐藏文本或完整 HTML。

示例断言：

```js
const result = await provider.extract({ blocks, ruleResult });
assert.equal(result.demands[0].status, "captured");
assert.equal(result.demands[0].evidence.blockId, "block-0007");
assert.equal(result.warnings.length, 0);
```

- [ ] **Step 2: 定义 AI 输出契约**

`validateExtractionResult(value)` 必须校验：

```js
{
  departments: [],
  people: [],
  demands: [],
  capabilities: [],
  tokens: [],
  radar: [],
  warnings: [],
}
```

所有候选引用已存在的 `blockId`。AI 需求状态只允许 `captured` 或 `assessed`；更后状态必须由人工审核填写。AI 雷达条目的 `reviewStatus` 固定为 `candidate`。

- [ ] **Step 3: 实现 Provider 接口**

```js
export class ExtractionProvider {
  async extract({ blocks, ruleResult, period }) {
    throw new Error("not implemented");
  }
}

export class HttpExtractionProvider extends ExtractionProvider {
  constructor({ endpoint, apiKey, model, fetchImpl = fetch }) {
    super();
    Object.assign(this, { endpoint, apiKey, model, fetchImpl });
  }
  async extract(input) {
    return requestStructuredExtraction({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      fetchImpl: this.fetchImpl,
      input,
      maxRepairs: 1,
    });
  }
}
```

环境变量固定为：

```text
AI_EXTRACTION_ENDPOINT
AI_EXTRACTION_API_KEY
AI_EXTRACTION_MODEL
```

日志只能记录模型名、请求 ID、耗时和成功/失败，不记录 API Key 或完整提示词。

- [ ] **Step 4: 实现无模型降级**

未配置 Provider 时，解析流程仍使用规则结果生成草稿，并添加阻断型 `AI_PROVIDER_MISSING` 质量项；审核人员可以人工补齐后继续发布。不得把缺少模型配置表现为服务崩溃。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-extraction-provider.test.mjs
git add server/import/extraction-schema.mjs server/import/extraction-provider.mjs tests
git commit -m "feat: add schema-constrained AI report extraction"
```

---

### Task 7: 合并多报告草稿并阻断口径冲突

**Files:**

- Create: `server/import/merge-draft.mjs`
- Create: `tests/import-merge-draft.test.mjs`
- Modify: `js/core/dashboard-schema.js`

- [ ] **Step 1: 写多报告合并失败测试**

至少创建以下具名测试，并使用完整 fixture 构造输入和期望值：

```text
does not add aikey reconciliation to effective tokens
flags conflicting active user totals
deduplicates same person source and first 150 normalized chars
does not auto-create unknown departments
does not promote demands beyond assessed
requires deliverable evidence for outputs
```

其中第一项必须断言 `effective === 1200`、`reconciliationOnly === 9000`；未知部门测试必须断言产生一个未解决的 `blocking` 问题；需求状态测试必须断言 AI 返回的 `delivered` 被降为 `assessed` 并产生质量警告。

- [ ] **Step 2: 扩展草稿契约**

新增但不改变正式快照字段语义：

```js
export const REVIEW_STATES = ["pending", "accepted", "edited", "rejected"];
export const ISSUE_SEVERITIES = ["info", "warning", "blocking"];
export function validateImportDraft(raw) {
  const errors = [];
  if (!raw?.period?.id) errors.push("draft.period.id is required");
  if (!Array.isArray(raw?.files)) errors.push("draft.files must be an array");
  if (!raw?.candidates || typeof raw.candidates !== "object") errors.push("draft.candidates must be an object");
  if (!Array.isArray(raw?.quality?.issues)) errors.push("draft.quality.issues must be an array");
  if (!Array.isArray(raw?.revisions)) errors.push("draft.revisions must be an array");
  return { ok: errors.length === 0, errors };
}
```

正式发布仍使用既有 `validateManifest`、`validateDepartment`、`validateDemand`、`validateCapability`、`validateTokenRecord` 和 `validateRadarItem`。

- [ ] **Step 3: 实现合并优先级**

`mergeDraft({ files, ruleResults, aiResults, curation, departmentDictionary })`：

1. 已审核 curation 优先。
2. 同来源、同口径、同证据的重复项折叠。
3. 不同来源的相同指标保留候选并创建 `SOURCE_CONFLICT`。
4. 未知部门创建 `UNKNOWN_DEPARTMENT`，不进入正式部门集合。
5. Token 根据 `sourceClass` 分入业务、非业务和对账，不跨类相加。
6. 未审核雷达只保留在草稿候选。

- [ ] **Step 4: 输出发布阻断状态**

草稿质量结构：

```json
{
  "status": "warning",
  "issues": [{
    "id": "issue-001",
    "code": "SOURCE_CONFLICT",
    "severity": "blocking",
    "message": "活跃人数存在两个不同来源值",
    "candidateIds": ["candidate-a", "candidate-b"],
    "resolved": false
  }]
}
```

存在未解决 `blocking` 项时，`canApproveDraft()` 必须返回 `false`。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-merge-draft.test.mjs tests/dashboard-schema.test.mjs tests/metrics.test.mjs
git add server/import/merge-draft.mjs js/core/dashboard-schema.js tests
git commit -m "feat: merge report candidates with blocking quality checks"
```

---

### Task 8: 实现 Origin、CSRF 和导入 API

**Files:**

- Create: `server/import/security.mjs`
- Modify: `server/import/routes.mjs`
- Create: `tests/import-security.test.mjs`
- Create: `tests/import-routes.test.mjs`
- Modify: `server/app.mjs`

- [ ] **Step 1: 写安全失败测试**

覆盖：

```js
assert.equal(validateOrigin("https://cockpit.example.com", config), true);
assert.equal(validateOrigin("https://evil.example", config), false);
assert.equal(validateCsrf({ cookieToken: "a", headerToken: "a" }), true);
assert.equal(validateCsrf({ cookieToken: "a", headerToken: "b" }), false);
```

并通过集成请求断言：无 Origin、Origin 不匹配、缺少 `X-CSRF-Token` 的写请求均返回 `403`。

- [ ] **Step 2: 实现会话令牌**

`GET /api/import/session` 生成 32 字节随机令牌，返回 JSON 并设置：

```text
Set-Cookie: ai_cockpit_csrf=<token>; Path=/api/import/; SameSite=Strict; Secure
```

本地 `http://127.0.0.1` 开发环境省略 `Secure`。写请求必须同时携带同源 `Origin`、Cookie 和 `X-CSRF-Token`，并使用恒定时间比较令牌。

- [ ] **Step 3: 实现路由表**

实现：

```text
POST   /api/import/periods
POST   /api/import/periods/:id/files
POST   /api/import/periods/:id/extract
GET    /api/import/periods/:id
PATCH  /api/import/periods/:id/draft
POST   /api/import/periods/:id/approve
GET    /api/import/periods/:id/diff
POST   /api/import/periods/:id/publish
GET    /api/import/releases
POST   /api/import/releases/:releaseId/rollback
```

所有错误返回：

```json
{
  "error": {
    "code": "UNKNOWN_DEPARTMENT",
    "message": "存在未确认的一级部门",
    "diagnosticId": "diag-20261027-a1b2c3"
  }
}
```

客户端错误不包含堆栈、磁盘路径、密钥或完整报告原文。

- [ ] **Step 4: 实现单期互斥**

解析和发布分别按 period ID 加锁。同一期已有解析或发布任务时返回 `409 PERIOD_BUSY`；不同期次可以并行。服务重启后若发现 `sanitizing`、`extracting`、`validating` 或 `publishing`，将任务标记为 `failed` 并提供可重试诊断，不能假装仍在运行。

- [ ] **Step 5: 验证并提交**

```powershell
node --test tests/import-security.test.mjs tests/import-routes.test.mjs
git add server/import/security.mjs server/import/routes.mjs server/app.mjs tests
git commit -m "feat: expose protected HTML import APIs"
```

---

### Task 9: 构建掩门上传与审核工作台

**Files:**

- Create: `manage/import/index.html`
- Create: `manage/import/manage.css`
- Create: `manage/import/api.js`
- Create: `manage/import/views.js`
- Create: `manage/import/app.js`
- Create: `tests/import-view-model.test.mjs`

- [ ] **Step 1: 写视图模型失败测试**

`tests/import-view-model.test.mjs` 覆盖：

```js
assert.equal(buildSteps({ status: "review_required" }).find((step) => step.id === "review").current, true);
assert.equal(canPublish({ status: "approved", quality: { issues: [] } }), true);
assert.equal(canPublish({ status: "approved", quality: { issues: [{ severity: "blocking", resolved: false }] } }), false);
assert.equal(groupCandidates(draft).tokens.length, 2);
```

- [ ] **Step 2: 实现页面外壳**

页面标题为“HTML 报告导入”，不在 `index.html`、侧栏、README 的用户导航区或站点地图中添加入口。工作台包含：

```text
创建期次
上传报告
解析进度
文件检查
提取审核
质量问题
发布差异
发布历史
```

页面复用 `css/tokens.css`，新增 `manage.css`，不引入构建系统。

- [ ] **Step 3: 实现 API 客户端**

`createImportApi()` 首次调用获取 CSRF Token，所有写请求自动设置 `X-CSRF-Token`。上传使用 `FormData`；JSON 请求统一解析 `{ error }` 并抛出包含 `code`、`message`、`diagnosticId` 的 `ImportApiError`。

- [ ] **Step 4: 实现四步审核界面**

界面必须同时显示结构化值和证据：

```text
候选值 | 来源报告 | 章节 | 原文片段 | 提取方式 | 置信度 | 审核状态
```

审核操作固定为“接受”“编辑后接受”“拒绝”。编辑后保存旧值和新值。阻断问题必须选择候选、填写修订值或拒绝相关项后才能解决，不能提供“一键忽略全部”。

- [ ] **Step 5: 实现发布差异和回滚确认**

差异按 `新增 / 修改 / 删除 / 质量变化` 分组。发布按钮文案为“确认发布本期”，二次确认中显示期次、文件数量、未阻断警告数量和操作者显示名。回滚按钮必须显示目标发布 ID 与时间，并要求再次输入操作者显示名。

- [ ] **Step 6: 移动端与可访问性**

在 960px、720px、420px：

- 步骤导航可横向滚动。
- 证据表格可横向滚动且首列保持可读。
- 文件上传可由键盘触发。
- 状态同时使用文字、图标和颜色。
- API 进度和错误写入 `aria-live`。
- 对话框支持 Escape、焦点陷阱和关闭后焦点恢复。
- `prefers-reduced-motion` 下禁用进度动画。

- [ ] **Step 7: 验证并提交**

```powershell
node --test tests/import-view-model.test.mjs
node --check manage/import/api.js
node --check manage/import/views.js
node --check manage/import/app.js
git add manage/import tests/import-view-model.test.mjs
git commit -m "feat: add hidden HTML import review workbench"
```

---

### Task 10: 实现快照生成、差异和原子发布

**Files:**

- Create: `server/import/diff.mjs`
- Create: `server/import/publish.mjs`
- Create: `tests/import-diff.test.mjs`
- Create: `tests/import-publish.test.mjs`
- Modify: `scripts/build-snapshot.mjs`
- Modify: `scripts/validate-snapshot.mjs`
- Modify: `server/import/routes.mjs`
- Modify: `server/app.mjs`

- [ ] **Step 1: 写差异失败测试**

`diffSnapshots(previous, next)` 返回稳定结构：

```js
{
  added: [{ entity: "department", id: "legal" }],
  changed: [{ entity: "overview.kpis", field: "activeUsers", from: 20, to: 24 }],
  removed: [],
  qualityChanges: [{ code: "SOURCE_STALE", from: "open", to: "resolved" }],
}
```

数组顺序变化不能被误判为业务修改；实体按稳定 ID 比较。

- [ ] **Step 2: 写发布失败保护测试**

创建已有 manifest 和快照，注入在写第三个文件时抛错的文件系统适配器，断言：

```js
    await assert.rejects(() => publishDraft({ periodId: "2026-10-27", draft, paths, fs: failingFs }), /injected failure/);
assert.deepEqual(await readJson(liveManifest), originalManifest);
assert.equal(await exists(originalSnapshot), true);
```

再测试完整成功发布和回滚均恢复所有七份专题文件、报告全文和默认期次。

- [ ] **Step 3: 抽取可复用快照生成函数**

将 `scripts/build-snapshot.mjs` 的核心逻辑移动为可导入函数：

```js
export async function buildSnapshot({ periodId, source, curation, outputDir })
```

CLI 仅负责解析参数并调用该函数。生成文件仍固定为：

```text
overview.json
departments.json
demands.json
capabilities.json
tokens.json
radar.json
quality.json
```

- [ ] **Step 4: 实现发布前完整校验**

发布前必须通过：

- `validateManifest()`
- 六类实体 Schema 校验
- 所有报告和专题路径存在
- 不存在未解决阻断项
- 雷达条目全部 `approved`
- 需求状态无非法跳级
- 成功产出存在交付证据
- Token 对账量未进入有效业务量

- [ ] **Step 5: 实现原子发布**

`publishDraft()`：

1. 在发布根目录内创建 `.publish-tmp/{releaseId}`。
2. 生成快照和净化后的报告全文。
3. 生成候选 manifest 并完整校验。
4. 将本次版本复制到 `{storageRoot}/releases/{releaseId}`。
5. 同文件系统内把新期次目录原子重命名到正式目录。
6. 最后原子替换 `data/manifest.json`。
7. 写入发布索引并把任务设为 `published`。

任何失败都清理临时目录；manifest 未替换前不改变默认期次。已存在正式期次使用带 release ID 的版本目录，通过 manifest 指向新版本，避免覆盖正在被读取的文件。

- [ ] **Step 6: 实现回滚**

`rollbackRelease(releaseId, actor)` 校验版本文件摘要后，原子恢复目标 manifest。历史记录追加新的 rollback 事件而不是删除较新的发布记录。

- [ ] **Step 7: 验证并提交**

```powershell
node --test tests/import-diff.test.mjs tests/import-publish.test.mjs
npm run snapshot:validate -- --period 2026-10-12
git add server/import/diff.mjs server/import/publish.mjs scripts tests
git commit -m "feat: atomically publish and roll back reviewed snapshots"
```

---

### Task 11: 加固部署配置和运维文档

**Files:**

- Create: `deploy/systemd/ai-cockpit.service.example`
- Create: `scripts/check-import-storage.mjs`
- Modify: `deploy/nginx/ai-cockpit.conf.example`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: 更新 Nginx 配置**

同一 Basic Auth 继续覆盖根路径。增加上传限制和 API 代理：

```nginx
client_max_body_size 12m;

location /api/import/ {
    auth_basic "Company AI Cockpit";
    auth_basic_user_file /etc/nginx/secrets/ai-cockpit.htpasswd;
    proxy_pass http://127.0.0.1:5175;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_no_cache 1;
}

location / {
    auth_basic "Company AI Cockpit";
    auth_basic_user_file /etc/nginx/secrets/ai-cockpit.htpasswd;
    proxy_pass http://127.0.0.1:5175;
}
```

- [ ] **Step 2: 添加 systemd 示例**

`deploy/systemd/ai-cockpit.service.example` 使用专用非登录用户，设置：

```ini
[Service]
WorkingDirectory=/srv/company-ai-cockpit
ExecStart=/usr/bin/node /srv/company-ai-cockpit/server.mjs
Environment=HOST=127.0.0.1
Environment=PORT=5175
Environment=AI_COCKPIT_STORAGE=/var/lib/company-ai-cockpit
Environment=AI_COCKPIT_ORIGIN=https://ai-cockpit.example.com
EnvironmentFile=/etc/company-ai-cockpit/import.env
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/company-ai-cockpit /srv/company-ai-cockpit/data /srv/company-ai-cockpit/reports
```

模型密钥只存在 `/etc/company-ai-cockpit/import.env`，权限为服务用户可读，不能写入 unit 文件或仓库。

- [ ] **Step 3: 增加运维命令**

`package.json`：

```json
{
  "scripts": {
    "import:check": "node scripts/check-import-storage.mjs",
    "test": "node --test",
    "check": "node --test && node --check js/app.js && node --check manage/import/app.js && node --check server/app.mjs"
  }
}
```

README 记录：存储目录权限、环境变量、备份范围、恢复演练、日志字段、上传限额、无 AI Provider 时的人工审核流程，以及掩门路径不构成授权边界。

- [ ] **Step 4: 验证未认证和认证访问**

```powershell
curl.exe -I https://<dashboard-host>/index.html
curl.exe -I https://<dashboard-host>/manage/import/
curl.exe -I https://<dashboard-host>/api/import/health
```

Expected: 三者均为 `401 Unauthorized`。

```powershell
curl.exe -I -u cockpit https://<dashboard-host>/index.html
curl.exe -I -u cockpit https://<dashboard-host>/manage/import/
curl.exe -I -u cockpit https://<dashboard-host>/api/import/health
```

Expected: 三者均为 `200 OK`。

- [ ] **Step 5: 提交**

```powershell
git add deploy README.md package.json scripts/check-import-storage.mjs
git commit -m "docs: deploy protected HTML import service"
```

---

### Task 12: 全链路回归与发布验收

**Files:**

- Create: `tests/import-end-to-end.test.mjs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-27-html-report-import-publishing-design.md`

- [ ] **Step 1: 编写端到端测试**

测试使用临时存储目录、mock AI Provider 和两份 HTML：

```text
创建期次
→ 上传信息部周报和项目报告
→ 执行解析
→ 验证冲突阻断发布
→ 提交人工修订
→ 审核通过
→ 查看差异
→ 发布
→ 读取新 manifest 和六专题
→ 回滚
→ 确认恢复旧 manifest
```

测试不能写真实 `data/`、`reports/` 或生产存储目录。

- [ ] **Step 2: 运行全量自动检查**

```powershell
npm test
npm run check
npm run snapshot:validate -- --period 2026-10-12
$files = rg --files -g "*.js" -g "*.mjs"
foreach ($file in $files) { node --check $file }
git diff --check
```

Expected: 全部退出码为 0。

- [ ] **Step 3: 浏览器桌面验收**

验证：

- 普通驾驶舱导航中没有管理入口。
- 直接访问 `/manage/import/` 可创建期次。
- 同一期可上传多份 HTML，重复文件被拒绝。
- 解析进度、失败诊断和重试可用。
- 六类候选都能查看原文证据。
- 阻断问题未解决时不能审核或发布。
- 发布差异准确，发布后驾驶舱默认期次更新。
- 已发布报告全文可打开并返回驾驶舱。
- 回滚后默认期次和所有专题一致恢复。

- [ ] **Step 4: 移动端和可访问性验收**

验证 960px、720px、420px：

- 上传区域、步骤导航和审核操作可用。
- 无隐形遮罩吞点击。
- 表格横向滚动不截断操作。
- Escape 和焦点恢复正常。
- 状态不只依赖颜色。
- 进度和错误有读屏播报。
- 减弱动态效果生效。

- [ ] **Step 5: 安全验收**

```powershell
rg -n -i "password|secret|api[_-]?key|token" . -g "!reports/**" -g "!storage/**" -g "!.git/**"
git ls-files storage .env "*.upload-part"
git status --short
```

逐项确认：

- 命中内容仅为字段名、文档或环境变量说明。
- Git 未跟踪上传件、草稿、模型密钥或环境变量文件。
- 上传 HTML 中的脚本、远程资源和事件属性不会进入正式报告。
- API 错误和日志不泄露磁盘路径、凭据或完整原文。

- [ ] **Step 6: 完成交付文档和提交**

README 增加“操作员流程”和“故障恢复”章节，设计文档仅补充最终确定的实现偏差，不修改已确认的业务范围。

```powershell
git add tests/import-end-to-end.test.mjs README.md docs/superpowers/specs/2026-10-27-html-report-import-publishing-design.md
git commit -m "docs: complete HTML report import rollout guide"
```

- [ ] **Step 7: 发布后冒烟测试**

确认：

- 页面、管理入口、API、JSON 和报告全文均受同一 Basic Auth 保护。
- 管理入口不出现在普通导航。
- 上传两份真实 HTML 可生成待审核草稿。
- 所有正式指标可回溯到原文证据或人工修订记录。
- 发布前线上期次不变，发布后一次性更新。
- 发布历史可见，上一版本可以完整回滚。

---

## 后续阶段边界

本计划完成后，系统仍不实施：

- 实时业务数据库、日志平台和第三方 API 接入
- PDF、Word、Excel、图片和压缩包导入
- 独立账号体系和按角色授权
- 自动管理推送和异常通知
- 默认每日视图与实时 AI 运营
- 金额收益、节省工时和员工绩效核算

这些能力只有在 HTML 报告导入、证据追溯、审核发布和回滚流程稳定运行后，才进入后续独立设计周期。

