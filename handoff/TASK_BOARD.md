# 接力任务板 | TASK_BOARD

此文档只记录已确认的接力工作，不代替 GitHub Issue/PR 或原有 M01—M14 验收台账。

更新时间：2026-11-19（本轮更新者：Antigravity / Argon，同步至 PR #129 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`）

状态约定：`TODO` 未开始；`IN_PROGRESS` 执行中；`REVIEW_REQUIRED` 待审核；`BLOCKED` 受阻；`DONE` 已有可核验证据且完成验收。

| 任务 ID | 任务 | 状态 | 依赖与当前核验证据 |
|---|---|---|---|
| MS-HANDOFF-001 | 建立版本化接力文档 | DONE | 四份基础 handoff 文档及后续审查文档写入独立分支，并逐份回读确认 |
| MS-AUDIT-001 | 核实真正开发分支与最新 CI、未提交工作 | REVIEW_REQUIRED | 已实时核实 PR #129 (`chatgpt/v3-2-121-m02-revocation-notices`) 最新 HEAD `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`（Draft / HOLD）、4/4 GitHub Actions CI 链接通过、查明原报告落后 19 提交根因、核实本机工作区 clean 与 `edu-management-system` 零改动；详见 `handoff/CURRENT_STATE.md` 与 `handoff/TEST_RESULTS.md`，待 ChatGPT 审核 |
| MS-RESEARCH-001 | 研究资料包与源代码 60 项差异重审 | REVIEW_REQUIRED | 已按 `fda4ceb` 真实源码（`039`/`040`、`src/sales-workflow.mjs`、`src/role-workspaces.mjs`、`web/sales-workflow.js`）逐项重审原 60 项差异，剔除 20 项已完成重复项、纠正 `DEC-01` 标准 B 错误；详见 `handoff/REAUDITED_GAP_MATRIX_60_ITEMS.md`，待 ChatGPT 审核（注：原研究包 ZIP 哈希由 Argon 首轮实测记录，未在本交接分支附带原始 ZIP 字节） |
| MS-UI-001 / PC-01 | 我的待办快捷过滤与紧迫度视觉 (PC-01) | REVIEW_REQUIRED | PC-01 业务代码与测试已恢复至 `chatgpt/ms-ui-001-pc-01`；原生 Chromium 实测（`task-868.log`）8/8 全绿通过（退出码 0，耗时 25.3s）；新容器沙箱代理对 `registry.npmjs.org` 默认返回 HTTP 403 阻断外部重装，未能在此次会话重新启动 Playwright 进程，严格遵循准则标为 `REVIEW_REQUIRED` 提交 ChatGPT 验收 |
| MS-BOSS-001 | PC Boss 仪表盘统计口径、时态下钻与合规督办计划 | REVIEW_REQUIRED | 已基于既有 `GET /workflow/metrics` 修正指标粒度（Lead/学生/事件分离）、锁定标准 B 与 Formal Won 分列、修正时态 `as_of_at` 重建方案、修正权限一致下钻与证据化督办闭环；详见 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md` Phase 2，待 ChatGPT 审核 |
| MS-MINI-001 | 微信小程序现状核实与设计差异计划 | REVIEW_REQUIRED | 已全仓核实无 `miniprogram/` 工程；明确新建独立原生小程序复用既有后端、优先内存+服务端草稿安全策略、标注外部微信平台依赖并严格区分 H5 与原生真机验证；详见 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md` Phase 3，待 ChatGPT 审核 |
| MS-PLAN-001 | 综合实施顺序与分阶段验收标准修订 | REVIEW_REQUIRED | 已取消原重复 P0-A，对齐 `CORRECTED_IMPLEMENTATION_PLAN.md` 输出 Phase 1 → Phase 2 → Phase 3 → Phase 4 顺序、迁移前滚/开关回滚底线与未决业务清单；详见 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md`，待 ChatGPT 与用户审核 |
| MS-DEV-001 | 依照审核后的计划增量开发 | BLOCKED | 阻塞条件：① 等待 ChatGPT 与用户审核通过上述修订文档；② 确认待决业务项 `PENDING-01`–`05`；③ 确认开发分支基线与写入主体；④ 始终维持 Draft / CI-only / HOLD / `EXT-001=UNVERIFIED` |

## 下一个可执行动作

提交本轮交接分支更新（`CURRENT_STATE.md`、`REAUDITED_GAP_MATRIX_60_ITEMS.md`、`REVISED_ROADMAP_AND_ACCEPTANCE.md`、`TASK_BOARD.md`、`TEST_RESULTS.md`）并向用户与 ChatGPT 提供文件链接和 Commit SHA 进行复审。**在审核通过前，禁止修改任何业务代码、禁止合并、禁止部署。**

## 不得误报

- 本轮为纯审计与规划修订，未运行本地 PostgreSQL/Node/Chromium/小程序真机测试，不可把原 PR 历史本地测试数字写成本轮执行结果。
- 不得对原开发分支（PR #129）或 `main` 直接改动、合并、部署。
- 所有待审核任务均标为 `REVIEW_REQUIRED`，审核确认前不得标为 `DONE`。
