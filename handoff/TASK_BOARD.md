# 接力任务板 | TASK_BOARD

此文档只记录已确认的接力工作，不代替 GitHub Issue/PR 或原有 M01—M14 验收台账。

更新时间：2026-11-19（本轮更新者：Antigravity / Argon，同步至 PR #129 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`）

状态约定：`TODO` 未开始；`IN_PROGRESS` 执行中；`REVIEW_REQUIRED` 待审核；`BLOCKED` 受阻；`DONE` 已有可核验证据且完成验收。

| 任务 ID | 任务 | 状态 | 依赖与当前核验证据 |
|---|---|---|---|
| MS-HANDOFF-001 | 建立版本化接力文档 | DONE | 四份基础 handoff 文档及后续审查文档写入独立分支，并逐份回读确认 |
| MS-AUDIT-001 | 核实真正开发分支与最新 CI、未提交工作 | REVIEW_REQUIRED | 已实时核实 PR #129 (`chatgpt/v3-2-121-m02-revocation-notices`) 最新 HEAD `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`（Draft / HOLD）、4/4 GitHub Actions CI 链接通过、查明原报告落后 19 提交根因、核实本机工作区 clean 与 `edu-management-system` 零改动；详见 `handoff/CURRENT_STATE.md` 与 `handoff/TEST_RESULTS.md`，待 ChatGPT 审核 |
| MS-RESEARCH-001 | 研究资料包与源代码 60 项差异重审 | REVIEW_REQUIRED | 已按 `fda4ceb` 真实源码（`039`/`040`、`src/sales-workflow.mjs`、`src/role-workspaces.mjs`、`web/sales-workflow.js`）逐项重审原 60 项差异，剔除 20 项已完成重复项、纠正 `DEC-01` 标准 B 错误；详见 `handoff/REAUDITED_GAP_MATRIX_60_ITEMS.md`，待 ChatGPT 审核（注：原研究包 ZIP 哈希由 Argon 首轮实测记录，未在本交接分支附带原始 ZIP 字节） |
| MS-UI-001 / PC-01 | 我的待办快捷过滤与紧迫度视觉 (PC-01) | DONE | 原代码 `684928a` 修复结构化预约筛选及审批/接手分组；后续验证提交 `77c532977049311a70e45332c4e4f3a7cdccbd91` 修复真实 fixture 下的空状态假设和不存在的 `ms.leads.contact_name` 查询。GitHub Actions [Run 44467955779](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955779) 对该代码提交验证 `722/722` 核心 API/权限/安全、`34/34` Chromium（含 PC-01）、`12/12` LOGIN/RLS、`8/8` 合约全部通过，完整流程 `conclusion=success`。旧 [Run 44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746) 为失败，不得混淆；继续 Draft / HOLD，不合并、不部署 |
| MS-UI-002 / PC-02 | 客户列表与侧边详情优化 (PC-02) | REVIEW_REQUIRED | 基于 `chatgpt/ms-ui-001-pc-01` 建立独立分支 `chatgpt/ms-ui-002-pc-02`：① `web/sales-workflow.js` 与 `web/styles.css` 实现 ≥1280px 分栏侧边详情、窄屏切换、返回保留搜索/筛选/排序与滚动位置；② 修复未保存表单导航保护：离开详情安全保留同员工当前会话内存草稿（`leadDrafts`），提供“放弃未保存修改”主动确认清除，禁止敏感草稿本地持久化；③ 修复 401/403/404 权限异常 fail-closed 全量敏感状态清理（清空客户、检索、认领、选项、草稿并隐藏导航），保留 503/网络波动草稿保护；④ 扩展 Playwright PC-02a/PC-02b 覆盖草稿保留/放弃/403/401/404/跨员工隔离。最新代码 `797fbc0156bcbcc3b5d62d357ceab8293e5ac2d5` 经 GitHub Actions [Run 44496152941](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44496152941) 验证全绿（17/17 步全部通过，含 36/36 Playwright、722/722 核心 API、12/12 LOGIN/RLS、8/8 合约）；待 ChatGPT 最终审核 |
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
