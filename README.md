# 信息部报告站

信息部周报的**一屏导读**：首屏只给本期结论、关键进展、待关注与关键数字，点「阅读全文」进入同域名 HTML 全文；历史期次用页首下拉切换，五个专题（部门采用 / 需求机会 / Skills & Agents / Token 效率 / AI 前沿雷达）留给需要核对数字时下钻。

新一期走 `/manage/import/`：上传单文件 HTML → 解析出带原文证据的导读候选 → 审核人编辑、舍弃、排序 → 批准 → 原子发布。全文落到 `reports/{期次}-{版本}/index.html`，导读写入 `overview.digest`，manifest 自动登记。没有后台时也可按第六节手工接入历史期次。

站点是零依赖静态站：`npm start` 起 Node 内置服务即可查看；只有导入管理台需要 `busboy` + `parse5`。


---

## 一、设计目标

| 维度 | 目标 | 落地手段 |
| --- | --- | --- |
| 视觉风格 | 克制的「白底蓝字」政务/企业级质感，可信、不喧哗 | 白底 + 1px 细描边 + 三级轻阴影；无渐变装饰、无 emoji；图标统一 24×24 线性 |
| 配色 | 颜色即语义，绝不用于装饰 | 主色 `#3B6FE0` 仅用于品牌与主操作；黄 `#D9822B` 只给待关注与质量警告；绿 `#22A06B` 只给数据正常；红 `#C23B33` 只给阻断与数据缺失 |
| 排版 | 让管理层 3 秒读到结论 | 结论（Hero）→ 本期要点（关键进展 / 待关注）→ 关键数字 → 专题入口，信息密度自上而下递减 |
| 动效 | 帮助理解层级，绝不制造等待 | 卡片 hover 抬升 2px、主题切换即时生效；`.reveal` 入场位移与 `countUp()` 数字滚动作为预留工具，启用时仍受 `prefers-reduced-motion` 全量关闭约束 |
| 交互 | 少而准 | 期次切换、专题路由、部门下钻、报告全文、深浅色切换；不引入登录 / 搜索 / 通知这类空壳功能 |

**可访问性底线**：正文只有两种字色（`--ink-900` / `--ink-600`），均 ≥ 4.5:1；`--ink-400` 只允许承载图标与分隔线。质量状态、待关注项都同时输出文字，不靠颜色单独传达信息。

---

## 二、技术选型理由

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 框架 | **无框架**（原生 ES Module） | 页面本质是「取一份 JSON → 渲染 20 个节点」。引入 React/Vue 会带来构建产物，破坏与本项目两份报告 HTML 同源部署、CloudStudio 直接托管静态目录的现状；`js/core/dom.js` 里 40 行的 `h()` 已覆盖全部渲染需求，且文本走 `textContent`，天然免疫 XSS |
| 状态管理 | **40 行发布订阅 store** | 全局状态只有三项：目录数据、当前期次、主题。一次 `set` → 全量重渲染的单向数据流最易读，也免去 diff 带来的心智负担 |
| 样式 | **CSS 自定义属性 + BEM** | 设计令牌全部集中在 `css/tokens.css`，组件样式零硬编码；换肤只需覆写变量（暗色主题正是这么实现的，组件选择器一行没改） |
| 数据 | `data/manifest.json` 期次清单 + `data/snapshots/{period}/` 专题快照 | 七个快照文件的结构由 `js/core/snapshot-contract.js` 单点定义，`snapshot:build` 与导入发布两端共用同一契约，产出必然一致 |
| 构建 | **零构建** | 导读页本身零第三方依赖，`npm start` 起 Node 内置静态服务即可查看；仅 HTML 导入管理台用到 `busboy` 与 `parse5`，不导入报告时无需安装 |

---

## 三、启动步骤

```bash
# 依赖：Node.js ≥ 18
# 只看导读与专题无需任何依赖；使用 HTML 导入管理台才需要安装下列两个依赖
npm install            # 仅 busboy + parse5

# 导入管理台的写操作是 fail-closed 的：不设来源会全数 403
$env:AI_COCKPIT_ORIGIN = "http://localhost:5175"
npm start              # → http://localhost:5175

PORT=6000 npm start    # 换端口
```

也可用任意静态服务器：

```bash
python -m http.server 5175
npx serve . -l 5175
```

> ⚠️ 直接双击 `index.html`（`file://`）会因浏览器拦截 `fetch` 而报错——页面会给出明确提示，而不是白屏。

验证：

```powershell
npm test               # node --test，78 个用例
npm run check          # 测试 + node --check
npm run snapshot:validate -- --period 2026-10-12
```

> 受限沙箱里 `node --test` 可能因无法 `spawn` 子进程而报 `EPERM`；此时用 `node --test --test-isolation=none` 在当前进程内跑同一批用例。

---

## 四、文件结构

```
chairman-report-dashboard/
├─ index.html            # 语义化外壳 + 内联图标 sprite（无内联样式与脚本）
├─ css/
│  ├─ tokens.css         # 设计令牌：色板 / 字阶 / 间距 / 圆角 / 阴影 / 动效 + 暗色覆盖
│  ├─ app.css            # Reset → Base → A11y 工具类 → 布局 → 组件 → 状态 → 动效 → 响应式
│  ├─ dashboard.css      # 导读与专题的组件层，只消费 tokens.css 的令牌
│  └─ report-return.css  # 全文页「首页」悬浮入口
├─ js/
│  ├─ core/
│  │  ├─ dom.js               # h() / icon() / mount() / countUp() 等无依赖工具
│  │  ├─ store.js             # 极简发布订阅状态容器
│  │  ├─ dashboard-schema.js  # 数据契约校验（前端 / 脚本 / 服务端共用）
│  │  ├─ metrics.js           # 派生指标：采用、需求漏斗、能力、Token
│  │  ├─ snapshot-contract.js # 七个快照文件的唯一产出契约（两端共用）
│  │  └─ dashboard-data.js    # 取数 → 契约校验 → 缺文件时标记质量状态
│  ├─ ui/                     # 导读 + 五个专题的纯渲染函数：传入数据，返回 DOM 节点
│  └─ app.js                  # 装配层：唯一持有状态与副作用的文件
├─ server/
│  ├─ app.mjs / static-files.mjs
│  └─ import/                 # 上传 → 净化 → 分块 → 规则/AI 抽取 → 导读 → 发布 → 回滚
│     └─ digest.mjs           # 导读候选抽取与审核（结论卡优先，标题兜底）
├─ manage/import/             # 导入管理工作台（不出现在普通导航中）
├─ deploy/                    # Nginx Basic Auth 与 systemd 示例
├─ data/
│  ├─ manifest.json           # 期次清单
│  ├─ snapshots/{period}/     # 七个专题快照文件
│  └─ curation/{period}.json  # 人工策展（可选增强项）
├─ tests/                     # node --test + 自写 DOM 桩；含 CSS 令牌回归测试
└─ reports/…                  # 报告全文；导入发布的版本目录为 {期次}-{releaseId}
```

**分层约束**：`ui/*` 与 `core/*` 都不接触 DOM，可单独单元测试（渲染测试用 `tests/helpers/dom-stub.mjs` 提供极简 DOM 桩）；所有事件监听、观察器、定时器集中在 `app.js`，保证重渲染时先销毁再重建。

---

## 五、扩展方式

### 1. 调整参数（改 `css/tokens.css` 即可）

```css
:root {
  --brand-500: #0f7b6c;   /* 换主色，全站按钮/徽标/焦点环同步 */
  --radius-md: 4px;       /* 全局卡片圆角收紧 */
  --dur-slow: 260ms;      /* 入场动画更快 */
  --content-max: 1440px;  /* 宽屏放更多列 */
}
```

**约束**：组件层（`app.css` / `dashboard.css`）只能使用 `tokens.css` 声明过的变量，也不写死色值。历史缺陷是 `dashboard.css` 用了从未定义的 `--ink/--muted/--accent/--wash`，组件一直吃 `var(--x, #hex)` 的回退值，暗色主题只改令牌却改不动它们。`tests/css-tokens.test.mjs` 会把这条约束变成测试：未定义变量、硬编码色值、失效的 `.theme-dark` 选择器都会失败。

### 2. 替换主题

- **暗色**：已内置（`[data-theme="dark"]`），右上角按钮切换，选择写入 `localStorage`；未手动选择过时跟随系统 `prefers-color-scheme`。
- **新增主题**：复制 `tokens.css` 末尾的 `:root[data-theme="xxx"]` 块，覆写需要的变量，然后在 `app.js` 的 `toggleTheme()` 里把主题枚举从两项扩成数组即可。

### 3. 复用组件

```js
import { renderOverview } from "./ui/overview.js";
document.querySelector("#slot").append(renderOverview(snapshot, {}));
```

所有 `render*` 都是纯函数，可任意组合进别的容器。需要新面板时，在 `js/ui/shared.js` 里复用 `section()` / `panel()` 骨架即可保持视觉一致；`section()` 会用 `slugifyId()` 生成无空格的 id，保证 `aria-labelledby` 能被读屏正确解析。

### 4. 新增数据源 / 期次

- **新来源标签**：在 `js/core/dashboard-schema.js` 的 `RADAR_TYPES` 登记类型，在 `RADAR_DECISIONS` 登记结论；若要在页面上用新图标，再在 `index.html` 的 sprite 中补同名 symbol。
- **新状态语义**：`js/ui/shared.js` 的 `qualityBadge()` 负责 `quality.status → 徽标样式` 映射，新增一种质量状态只需在 `dashboard.css` 加一行 `.quality--xxx` 并补上文案。
- **新的报告版式**：若周报生成器改了结论卡类名，改 `server/import/segment.mjs` 的 `verdictItems()` 即可；导读只认结构，不认具体报告。

---

## 六、手工接入历史期次

> 新报告请走第八节的导入工作台：它会同时生成导读、净化全文并原子更新 manifest。本节只适用于补历史期次、或没有 Node 服务端、只能手工改静态目录的场景。

站点是静态目录：**一期 = 拷贝报告全文到 `reports/` + 在 `data/manifest.json` 登记 + 在 `data/snapshots/{period}/` 放好七个快照文件**；快照可由 `npm run snapshot:build` 生成，也可由管理台导入发布产生。侧栏、期次下拉、报告入口均从 JSON 动态生成，无需改站点代码。

手工接入的目录约定与导入发布不同：手工用「窗口起止日 / 报告短名」，导入发布用「期次 ID / releaseId」，两者可以并存，`report.localPath` 各指各的。

### 6.1 放置全文

目录约定（窗口起止日作文件夹名，报告短名作子目录）：

```
reports/{YYYY-MM-DD}_{YYYY-MM-DD}/
  info-dept-weekly/
    index.html
  sino-biweekly/
    index.html
```

示例（窗口 2026-10-13 ~ 10-27）：

- `reports/2026-10-13_10-27/info-dept-weekly/index.html`
- `reports/2026-10-13_10-27/sino-biweekly/index.html`

规则：

- 每个报告一个子目录，入口文件必须叫 `index.html`（`localPath` 直链该文件）。
- 在全文 `index.html` 的 `<head>` 引用样式，并在 `</body>` 前加入返回首页入口（相对路径向上三级到站点根）：

```html
<link rel="stylesheet" href="../../../css/report-return.css">
```

```html
<a class="report-return" href="../../../index.html" aria-label="返回报告首页">
  <svg class="report-return__icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
  首页
</a>
```

- 报告自带的 css/图片放在同一子目录，用相对路径引用；不要改站点的 `css/`、`js/`（`report-return.css` 除外，由全文页引用）。
- 首页只使用本站 `localPath`。旧的外部在线链接不作为阅读入口。

### 6.2 登记 manifest.json

在 `periods` **数组最前面**追加一期（新期在上），并把 `defaultPeriodId` 改为新期的 `id`。

```json
{
  "site": { "title": "信息部与 Hermes 项目报告", "subtitle": "一屏判断面板" },
  "defaultPeriodId": "2026-10-13",
  "periods": [
    {
      "id": "2026-10-13",
      "label": "2026-10-13 期",
      "window": "2026-10-13 ~ 10-27",
      "asOf": "2026-10-27T18:00:00+08:00",
      "files": {
        "overview": "data/snapshots/2026-10-13/overview.json",
        "departments": "data/snapshots/2026-10-13/departments.json",
        "demands": "data/snapshots/2026-10-13/demands.json",
        "capabilities": "data/snapshots/2026-10-13/capabilities.json",
        "tokens": "data/snapshots/2026-10-13/tokens.json",
        "radar": "data/snapshots/2026-10-13/radar.json",
        "quality": "data/snapshots/2026-10-13/quality.json"
      }
    }
  ]
}
```

字段约定：

| 字段 | 说明 |
| --- | --- |
| `id` | 窗口起始日 `YYYY-MM-DD`，供下拉与 localStorage；只能是该格式，否则接口返回 400 |
| `label` / `window` / `asOf` | 期次名、数据窗口、数据截止时间 |
| `files` | 七个专题快照的相对站点根路径，**七个键缺一不可**，否则 `validateManifest` 直接报错 |

报告全文入口来自 `overview.json` 的 `report.localPath`。导入工作台发布时会自动生成该路径，并将审核后的导读写入 `overview.digest`。

手工维护旧快照时，导读字段示例：

```json
{
  "report": { "title": "信息部周报", "window": "2026-10-13 ~ 10-27", "localPath": "reports/2026-10-13_10-27/info-dept-weekly/index.html" },
  "digest": {
    "headline": "本期一句话结论。",
    "highlights": ["关键进展一。", "关键进展二。"],
    "watchItems": ["待关注事项。"]
  }
}
```

### 6.3 接入后自检

- `npm start` 打开首页，期次下拉能选到新期。
- 「阅读全文」能打开本站 `index.html`，并可返回导读。
- 旧期仍保留在 `periods` 中；浏览器会记住上次选择的期次。

### 6.4 推送到 GitHub

远程仓库：`GD-SaiKen/chairman-report-dashboard`。本机使用专用 deploy key（私钥路径 `%USERPROFILE%\.ssh\id_ed25519_chairman_report`，**勿提交进仓库**），SSH Host 别名 `github.com-chairman-report`（见用户目录下 `~/.ssh/config`）。

登记公钥到仓库（二选一）：

```powershell
# 已安装 GitHub CLI 且已登录时
gh repo deploy-key add $env:USERPROFILE\.ssh\id_ed25519_chairman_report.pub `
  --repo GD-SaiKen/chairman-report-dashboard `
  --title local-deploy-chairman-report --allow-write

# 或运行项目内脚本（无 gh 时会打印公钥与网页入口）
.\scripts\register-github-deploy-key.ps1
```

本地仓库远程（已 `git init` 时可核对）：

```bash
git remote add origin git@github.com-chairman-report:GD-SaiKen/chairman-report-dashboard.git
ssh -T git@github.com-chairman-report
```

---

## 七、专题数据与快照契约

首页是报告导读，下面五个专题：部门 AI 采用、AI 需求机会、Skills & Agents、Token 效率、AI 前沿雷达。数据由 `data/manifest.json` 按期次加载，专题快照位于 `data/snapshots/{period}/`；`reports/` 保留用于全文回溯。

七个快照文件的结构由 `js/core/snapshot-contract.js` 单点定义：`snapshot:build` 与导入发布两端都只负责归一化输入，产出必然一致。契约的硬规矩是**缺失一律 `null`，绝不补 0**——原始消息数（去重前）这类无法从条目推导的指标留空，页面显示「—」并由质量报告标记，避免管理层把「没数据」读成「真的是 0」。

### 本地生成与校验

```powershell
npm test
npm run snapshot:validate -- --period 2026-10-12
npm run snapshot:build -- --period 2026-10-12 --input .local-data/2026-10-12
npm start
```

原始标准化输入只放在 `.local-data/` 或 `data/inbox/`，不要提交仓库。快照中缺失数字保持 `—`，由质量报告标记为 `warning` / `missing`，不得静默补零。Token 的有效业务消耗、缓存读取、非业务消耗和 aikey 对账口径分开计算，避免重复相加。

### 雷达采集

```powershell
$env:GITHUB_TOKEN = "<只在当前终端设置>"
npm run radar:collect -- --period 2026-10-12 --output .local-data/2026-10-12/radar-candidates.json
```

采集结果默认是未审核候选，不会自动进入正式 `radar.json`；信息部需补充公司适用性、风险和“关注 / 安排试用 / 建议引入 / 暂不采用”结论后再发布。

### 共享口令门禁

生产环境使用 `deploy/nginx/ai-cockpit.conf.example`，在站点根路径启用 Nginx Basic Auth。`.htpasswd`、明文口令、API Token 和 `.env` 均不得提交。发布前检查页面与快照 JSON 均返回 `401`，认证后返回 `200`：

```powershell
curl.exe -I https://<dashboard-host>/index.html
curl.exe -I https://<dashboard-host>/data/manifest.json
curl.exe -I -u cockpit https://<dashboard-host>/index.html
curl.exe -I -u cockpit https://<dashboard-host>/data/manifest.json
```

上线前还应运行 `rg -n -i "password|secret|api[_-]?key|token" . -g "!reports/**"`，逐项确认命中仅为字段名、文档或环境变量说明。

---

## 八、HTML 报告导入与审核发布

管理工作台位于 `/manage/import/`，不出现在普通导航中。该路径只是降低误触，页面和 `/api/import/` 必须与导读页共用 Nginx Basic Auth。

操作流程：创建期次（必须填截至时间）、上传 UTF-8 单文件 HTML、开始解析、**审核导读**、处理阻断问题、填写审核人、确认发布。未配置 AI Provider 时系统保留规则提取结果并提示人工补齐，不会因缺少模型而丢失上传文件。

**导读候选**：信息部周报的候选优先取报告里的结论卡（`.verdict` / `.v-t` 标题 / `.v-m` 支撑数据），第 1 条判断作结论，`good` 作关键进展，`warn` 作待关注；没有结论卡的报告按章节标题兜底（核心结论、主要发现、待办与风险、下周动作等）。每条候选都带原文证据，审核时只能改文字、不能换来源，关键进展最多 3 条、待关注最多 2 条。

解析结果与 AI 结果会合并进候选集：需求、能力、Token 明细与雷达全部进入草稿，供信息部在工作台逐项审核；雷达候选默认「待审核」，未经审核不会进入正式快照。

发布前会做三件事：净化全文并拒绝引用未上传相对资源的 HTML、校验七个快照文件、校验 manifest；任一失败都不落盘。成功后全文写入 `reports/{期次}-{releaseId}/index.html` 并注入「返回导读」入口，导读写入 `overview.digest`，manifest 原子替换。

**本地同样必须配置 `AI_COCKPIT_ORIGIN`**：来源校验是 fail-closed 的，未配置时工作台的所有写操作都会被拒绝，且页面会明确提示原因；若不设置，点击按钮只会看到红色的失败提示而没有其他线索。

```bash
# 本地（Windows PowerShell）
$env:AI_COCKPIT_ORIGIN = "http://localhost:5175"
npm start
```

发布或解析失败后，期次会退回「已审核 / 失败」状态而不是卡在处理中，草稿未变，修复原因后可直接重试；重复发布会被并发控制挡下并返回 409。

生产环境变量：

```text
AI_COCKPIT_STORAGE=/var/lib/company-ai-cockpit
AI_COCKPIT_ORIGIN=https://ai-cockpit.example.com
AI_EXTRACTION_ENDPOINT=https://<approved-provider>/extract
AI_EXTRACTION_API_KEY=<仅保存在服务器环境文件>
AI_EXTRACTION_MODEL=<approved-model>
IMPORT_MAX_FILE_BYTES=10485760
IMPORT_MAX_PERIOD_BYTES=41943040
```

部署前运行：

```powershell
npm run import:check
npm run check
```

备份必须同时包含 `AI_COCKPIT_STORAGE`、`data/manifest.json`、`data/snapshots/` 和 `reports/`。模型密钥、Basic Auth 文件、上传原件和草稿不得提交 Git。故障恢复优先选择管理工作台中的已发布版本回滚；发布失败时保留当前 manifest，不手工拼接半份快照。

## 九、可访问性清单

- 语义化：`aside` / `header` / `main` / `nav` / `section[aria-labelledby]` / `article` / `footer`，一级 `h1` 唯一。
- 键盘：首个焦点是「跳到主要内容」skip link；全站 `:focus-visible` 统一 2px 焦点环；移动端抽屉支持 `Esc` 关闭与 `Tab` 循环，收起时置 `inert` 使其对 Tab 键完全不可达。
- 读屏：期次切换通过 `aria-live="polite"` 播报；期次下拉有隐藏标签与 `aria-label`，质量徽标带文本与 `title` 说明。
- 对比度：正文 5.0:1 以上，徽标文字 4.5:1 以上。
- 动效：`prefers-reduced-motion: reduce` 时关闭全部动画与数字滚动。
- 触控：所有可点元素最小命中区 40–44px。
- 响应式：`1180px`（三栏收一栏）、`960px`（侧栏变抽屉）、`720px`（单栏 + 隐去时钟）、`420px`（字号降级）。
