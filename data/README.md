# data/

运行期数据目录，**默认不纳入版本库**（见根目录 `.gitignore`）。真实周报数据只保存在目标机或本地的存档里，仓库只分发代码。

```
data/
├─ manifest.json           # 期次清单，由发布或 npm run data:init 生成
├─ snapshots/{period}/     # 七份专题快照：overview / departments / demands / capabilities / tokens / radar / quality
└─ curation/{period}.json  # 人工策展（可选）
```

新克隆的仓库先执行一次：

```bash
npm run data:init
```

会生成一份**合成示例数据**（`data/snapshots/demo/` + `reports/demo/index.html`），用于打开页面和跑通渲染链路；它不对应任何真实部门、人员或指标。

目标机不要执行 `data:init`：目标机已有自己的 `data/` 与 `reports/` 存档，示例只用于空仓库演练。若误执行且 `manifest.json` 已存在，脚本默认拒绝覆盖，需显式 `--force`。
