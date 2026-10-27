# 公司级 AI 运转驾驶舱（第一阶段）Implementation Plan

> **For agentic workers:** Use this plan task-by-task with tests and review checkpoints.

**Goal:** 将现有周报判断页升级为覆盖公司 AI 普及、部门使用、需求机会、Skills/Agents、Token 效率和前沿雷达的周快照驾驶舱。

**Architecture:** 原生 ES Module + 静态 JSON + Hash 路由。快照由 Node.js 脚本生成并校验，前端按专题加载；部署层用共享口令保护页面和 JSON。

**Scope:** 本阶段交付周快照全模块薄切片；每日化、实时接口、复杂权限和收益核算留到后续阶段。

## Task checklist

- [ ] 数据契约、纯指标计算与 Node 测试
- [ ] 模块化快照、manifest 和生成/校验脚本
- [ ] Hash 路由、驾驶舱外壳与专题导航
- [ ] 公司总览、部门采用、AI 需求、Skills/Agents、Token 和雷达
- [ ] 共享口令部署样例、文档和安全检查
- [ ] 浏览器、移动端、无障碍与发布前回归

## Acceptance criteria

- 首页能回答活跃部门、活跃人员、需求、能力产出、Token 异常和热门雷达六类问题。
- 任一汇总可下钻到部门、实名人员、需求、能力、Token 或来源。
- Token 主口径与 aikey 对账口径不重复相加。
- 缺失、过期和未审核数据不会静默显示为零或进入正式雷达。
- 页面和 JSON 均由部署层共享口令保护。
- `npm test`、快照校验、脚本语法检查和浏览器回归全部通过。
