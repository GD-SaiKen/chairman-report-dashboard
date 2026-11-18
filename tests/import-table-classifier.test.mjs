import test from "node:test";
import assert from "node:assert/strict";
import { classifyTable, parseQuantity, parseRate, metricKey, isSummaryRow, splitUnit } from "../server/import/table-classifier.mjs";

/*
 * 这些用例锁的是「表语义识别」的判定边界。
 * 背景：周报表头每期都在漂，靠死表头别名匹配会让整期数据抽空、页面只剩「—」。
 */

test("recognises the five table shapes actually used in the weekly reports", () => {
  const scale = classifyTable([["指标", "上期", "本期", "变化"], ["业务活跃用户", "50", "44", "−12.0%"]]);
  assert.equal(scale.kind, "scale");

  const departments = classifyTable([["部门", "发任务人数", "业务 Run", "失败", "占比"], ["品管部", "9", "174", "22", "43.8%"]]);
  assert.equal(departments.kind, "departments");

  const departmentsByName = classifyTable([["名次", "部门", "参与人数", "Run", "占比"], ["1", "品管部", "12", "132", "47.7%"]]);
  assert.equal(departmentsByName.kind, "departments");

  const capabilities = classifyTable([["能力", "业务调用", "真失败", "真失败率", "说明"], ["query_objects", "182", "24", "13.2%", "偶发失败"]]);
  assert.equal(capabilities.kind, "capabilities");

  const tokens = classifyTable([["#", "通道", "请求", "输入(M)", "输出(M)", "合计(M)"], ["1", "阿里云服务器", "9,149", "1,356.20", "10.05", "1,366.25"]]);
  assert.equal(tokens.kind, "tokens");

  const demands = classifyTable([["#", "主题", "提出人（条数）", "本期要点", "状态"], ["T1", "月报与推送配置", "杨高峰（81）", "…", "推送链路运行中"]]);
  assert.equal(demands.kind, "demands");
});

test("does not mistake per-user rankings or change logs for department summaries", () => {
  // 逐人明细表带部门列，但不是部门汇总
  assert.equal(classifyTable([["名次", "用户", "部门", "有效条数", "占比"], ["1", "杨高峰", "五金部", "78", "28.3%"]]).kind, "people");
  // 源码改动表里有「来源」，但不是 Token 通道
  assert.equal(classifyTable([["来源", "提交", "文件次", "新增行"], ["api-monitor", "32", "179", "15,058"]]).kind, null);
  // 消息渠道清洗表有「渠道 / 有效消息」，不是 Token
  assert.equal(classifyTable([["渠道", "原始消息", "有效消息", "占有效"], ["sino 单聊", "469", "274", "98.2%"]]).kind, null);
  // 局部指标的「成功率」表只有一行指标，不足以当业务口径（由 extractKpis 的门槛再兜一层）
  assert.equal(classifyTable([["指标", "数值"], ["成功率", "99.53%"]]).kind, "scale");
});

test("parses quantities with units and percentages without inventing numbers", () => {
  assert.equal(parseQuantity("4,949.11M"), 4949110000);
  assert.equal(parseQuantity("89.8K"), 89800);
  assert.equal(parseQuantity("1,366.25", 1e6), 1366250000);
  assert.equal(parseQuantity("3 人"), 3);
  assert.equal(parseQuantity("—"), null);
  assert.equal(parseQuantity("BLOCKED"), null);
  assert.equal(parseQuantity("OK（41 部门）"), null);
  assert.equal(parseRate("90.7%"), 0.907);
  assert.equal(parseRate("—"), null);
  assert.deepEqual(splitUnit("合计(M)"), { base: "合计", unit: 1e6 });
  assert.deepEqual(splitUnit("提出人（条数）"), { base: "提出人", unit: 1 });
});

test("refuses ambiguous metric names instead of mapping them to the wrong KPI", () => {
  assert.equal(metricKey("业务活跃用户"), "activeUsers");
  assert.equal(metricKey("业务用户（剔平台角色）"), "activeUsers");
  // agent 平台的账号数 / 消息条数不是 dsh-work 的业务口径
  assert.equal(metricKey("活跃账号"), null);
  assert.equal(metricKey("有效需求条数"), null);
  assert.equal(metricKey("API 调用 / 总量"), null);
});

test("skips summary rows including the annotated total row", () => {
  assert.equal(isSummaryRow(["合计（25 把有量 / 共 54 把）", "55,116", "", "", "4,949.11"]), true);
  assert.equal(isSummaryRow(["合计", "33", "397", "32", "100%"]), true);
  assert.equal(isSummaryRow(["—", "14 个部门", "51", "276", "100%"]), true);
  assert.equal(isSummaryRow(["品管部", "9", "174", "22", "43.8%"]), false);
});
