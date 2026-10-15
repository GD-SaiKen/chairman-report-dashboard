# 信息部与 Hermes 项目报告

信息部周报与 Hermes 双周报的**一屏判断面板**：站内只看结论（红灯、黄灯、待决策），下钻回到两份报告全文。

---

## 一、设计目标

| 维度 | 目标 | 落地手段 |
| --- | --- | --- |
| 视觉风格 | 克制的「白底蓝字」政务/企业级质感，可信、不喧哗 | 白底 + 1px 细描边 + 三级轻阴影；无渐变装饰、无 emoji；图标统一 24×24 线性 |
| 配色 | 颜色即语义，绝不用于装饰 | 主色 `#3B6FE0` 仅用于品牌与主操作；红 `#C23B33` 只给红灯与「待建」，黄 `#D9822B` 给黄灯与「待签署 / 待演示」，其余状态一律浅蓝 |
| 排版 | 让管理层 3 秒读到结论 | 结论条（Hero）→ 仪表带（6 个数字）→ 三块区（判断/风险/待决策）→ 两扇门（报告入口），信息密度自上而下递减 |
| 动效 | 帮助理解层级，绝不制造等待 | 数字滚动（缓出 720ms）、区块入场位移 10px + 错峰 55ms、hover 抬升 2px；全部在系统「减弱动态效果」下自动关闭 |
| 交互 | 少而准 | 期次切换、锚点跳转（滚动高亮侧栏）、报告全文、深浅色切换；不引入登录 / 搜索 / 通知这类空壳功能 |

**可访问性底线**：正文只有两种字色（`--ink-900` / `--ink-600`），均 ≥ 4.5:1；`--ink-400` 只允许承载图标与分隔线。红灯/黄灯同时输出「红灯 / 黄灯」文字，不靠颜色单独传达信息。

---

## 二、技术选型理由

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 框架 | **无框架**（原生 ES Module） | 页面本质是「取一份 JSON → 渲染 20 个节点」。引入 React/Vue 会带来构建产物，破坏与本项目两份报告 HTML 同源部署、CloudStudio 直接托管静态目录的现状；`js/core/dom.js` 里 40 行的 `h()` 已覆盖全部渲染需求，且文本走 `textContent`，天然免疫 XSS |
| 状态管理 | **40 行发布订阅 store** | 全局状态只有三项：目录数据、当前期次、主题。一次 `set` → 全量重渲染的单向数据流最易读，也免去 diff 带来的心智负担 |
| 样式 | **CSS 自定义属性 + BEM** | 设计令牌全部集中在 `css/tokens.css`，组件样式零硬编码；换肤只需覆写变量（暗色主题正是这么实现的，组件选择器一行没改） |
| 数据 | `data/catalog.json` 单一数据源 | 保留既有约定。`core/catalog.js` 负责校验与归一化，缺字段自动补默认值，将来换成后端接口只需替换 `loadCatalog()` |
| 构建 | **零依赖、零构建** | `package.json` 无 `dependencies`，`npm start` 走 Node 内置模块起的静态服务，`git clone` 后 5 秒可跑 |

---

## 三、启动步骤

```bash
# 依赖：Node.js ≥ 18（无需 npm install，项目无第三方依赖）
npm start              # → http://localhost:5175

PORT=6000 npm start    # 换端口
```

也可用任意静态服务器：

```bash
python -m http.server 5175
npx serve . -l 5175
```

> ⚠️ 直接双击 `index.html`（`file://`）会因浏览器拦截 `fetch` 而报错——页面会给出明确提示，而不是白屏。

---

## 四、文件结构

```
chairman-report-dashboard/
├─ index.html            # 语义化外壳 + 内联图标 sprite（无内联样式与脚本）
├─ css/
│  ├─ tokens.css         # 设计令牌：色板 / 字阶 / 间距 / 圆角 / 阴影 / 动效 + 暗色覆盖
│  └─ app.css            # Reset → Base → A11y 工具类 → 布局 → 组件 → 状态 → 动效 → 响应式
├─ js/
│  ├─ core/
│  │  ├─ dom.js          # h() / icon() / mount() / countUp() 等无依赖工具
│  │  ├─ store.js        # 极简发布订阅状态容器
│  │  └─ catalog.js      # 取数 → 校验 → 归一化 → 派生指标（不碰 DOM）
│  ├─ ui/views.js        # 纯渲染函数：传入数据，返回 DOM 节点
│  └─ app.js             # 装配层：唯一持有状态与副作用的文件
├─ server.mjs            # 零依赖本地静态服务
├─ data/catalog.json     # 唯一数据源（未改动）
└─ reports/…             # 两份报告全文（未改动）
```

**分层约束**：`views.js` 与 `core/catalog.js` 都不接触 DOM，可单独单元测试；所有事件监听、观察器、定时器集中在 `app.js`，保证重渲染时先销毁再重建。

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

### 2. 替换主题

- **暗色**：已内置（`[data-theme="dark"]`），右上角按钮切换，选择写入 `localStorage`；未手动选择过时跟随系统 `prefers-color-scheme`。
- **新增主题**：复制 `tokens.css` 末尾的 `:root[data-theme="xxx"]` 块，覆写需要的变量，然后在 `app.js` 的 `toggleTheme()` 里把主题枚举从两项扩成数组即可。

### 3. 复用组件

```js
import { renderMeters, renderRisks } from "./ui/views.js";
document.querySelector("#slot").append(renderRisks(period));
```

所有 `render*` 都是纯函数，可任意组合进别的容器。需要新面板时，在 `views.js` 里复用私有的 `section()` / `panel()` 骨架即可保持视觉一致。

### 4. 新增数据源 / 期次

- **新来源标签**：在 `core/catalog.js` 的 `SOURCE_META` 登记 `{ label, icon, tone }`，并在 `index.html` 的 sprite 中补上同名 symbol。
- **新状态语义**：`DECISION_TONE` 负责 `tone → 徽标样式` 映射，新增一种紧急度只需在此加一行。

---

## 六、报告接入（无后台上传）

站点是静态目录：**新一期 = 拷贝报告全文到 `reports/` + 在 `data/catalog.json` 登记**。侧栏、期次下拉、报告入口均从 JSON 动态生成，无需改站点代码。

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
- 报告自带的 css/图片放在同一子目录，用相对路径引用；不要改站点的 `css/`、`js/`。
- `onlineUrl` 可选：有 WorkBuddy 等线上原件就填，没有可只保留 `localPath`。

### 6.2 登记 catalog.json

在 `periods` **数组最前面**追加一期（新期在上），并把 `defaultPeriodId` 改为新期的 `id`。

字段约定：

| 字段 | 说明 |
| --- | --- |
| `id` | 建议用窗口起始日 `YYYY-MM-DD`，供下拉与 localStorage |
| `label` / `window` / `updated` | 期次名、数据窗口、更新日期 |
| `meters` | 4–6 个指标；`source` 仅 `info` / `sino` / `deck`，**禁止跨报告加总** |
| `judgments` | 3–5 条短句，须能在原文中找到出处 |
| `risks` | `level` 仅 `red` 或 `amber` |
| `decisions` | `tone` 仅 `urgent` / `wait` / `watch` |
| `reports[]` | `localPath` 为相对站点根的路径；`onlineUrl` 可选 |

可复制模板（按需改文案与路径）：

```json
{
  "id": "2026-10-13",
  "label": "2026-10-13 期",
  "window": "2026-10-13 ~ 10-27（跨两周）",
  "updated": "2026-10-27",
  "meters": [
    { "value": "0", "unit": "条", "label": "有效需求消息", "hint": "Sino 应用侧", "source": "sino" }
  ],
  "judgments": [
    { "text": "本期一句话结论。", "source": "deck" }
  ],
  "risks": [
    { "level": "amber", "fact": "事实描述。", "meaning": "对管理层的含义。" }
  ],
  "decisions": [
    { "item": "待办事项", "owner": "责任人", "status": "待处理", "tone": "watch" }
  ],
  "reports": [
    {
      "id": "info-dept-weekly",
      "title": "信息部周报",
      "window": "2026-10-13 ~ 10-27",
      "scope": "六条数据源摘要",
      "localPath": "reports/2026-10-13_10-27/info-dept-weekly/index.html",
      "onlineUrl": "https://example.app.workbuddy.host/"
    }
  ]
}
```

### 6.3 接入后自检

- `npm start` 打开首页，期次下拉能选到新期。
- 「阅读全文」能打开本地 `index.html`；若有 `onlineUrl`，「线上原件」可打开。
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

## 七、可访问性清单

- 语义化：`aside` / `header` / `main` / `nav` / `section[aria-labelledby]` / `article` / `footer`，一级 `h1` 唯一。
- 键盘：首个焦点是「跳到主要内容」skip link；全站 `:focus-visible` 统一 2px 焦点环；移动端抽屉支持 `Esc` 关闭与 `Tab` 循环，收起时置 `inert` 使其对 Tab 键完全不可达。
- 读屏：期次切换通过 `aria-live="polite"` 播报；KPI 数字滚动动画期间为读屏单独提供定值文本（`.sr-only`）。
- 对比度：正文 5.0:1 以上，徽标文字 4.5:1 以上。
- 动效：`prefers-reduced-motion: reduce` 时关闭全部动画与数字滚动。
- 触控：所有可点元素最小命中区 40–44px。
- 响应式：`1180px`（三栏收一栏）、`960px`（侧栏变抽屉）、`720px`（单栏 + 隐去时钟）、`420px`（字号降级）。
