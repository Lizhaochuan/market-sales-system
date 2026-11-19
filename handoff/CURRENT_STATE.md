# AI 接力基线 | CURRENT_STATE

更新时间：2026-11-19（本轮复核执行者：Antigravity / Argon；上一版基线建立者：ChatGPT / GPT-6）

> **发布与隔离红线（保持不变）**：`EXT-001=UNVERIFIED`、`HOLD=true`、`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`。Draft PR [#129](https://github.com/Lizhaochuan/market-sales-system/pull/129) 保持 Draft / CI-only；严禁合并 `main`、严禁部署生产、严禁修改或对接 `Lizhaochuan/edu-management-system`。

---

## 一、实时核实的权威分支、HEAD SHA 与 CI 状态

本次复核已通过 `git fetch`、`git ls-remote`、`gh pr view 129`、`gh pr checks 129` 与 `gh run list` 实时核验 GitHub 远端权威状态：

| 核验项 | 实时核实结果 | 证据链接 / 依据 |
|---|---|---|
| **目标开发仓库** | `Lizhaochuan/market-sales-system` | [Repository](https://github.com/Lizhaochuan/market-sales-system) |
| **只读背景仓库** | `Lizhaochuan/edu-management-system`（`main` 工作区 clean，零改动） | `git status -sb` = `## main...origin/main` |
| **主开发分支（PR #129）** | `chatgpt/v3-2-121-m02-revocation-notices` | [PR #129](https://github.com/Lizhaochuan/market-sales-system/pull/129)（`state: OPEN`, `isDraft: true`，标题：`角色工作台与连续销售卡片：待办、沟通、试听及回访（Draft / HOLD）`） |
| **PR #129 实时 HEAD SHA** | `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` | `fda4ceb docs: record 0b60319 meeting location omission and CRM-ready trial classroom field`（最近业务代码提交为 `0b60319fdd44c4a24ec24279c326a1c8e888fd6d`） |
| **PR #129 HEAD 对应 GitHub CI** | 4/4 检查通过（仅代表隔离 CI，不解除 HOLD）：<br>- `core-api` (`V3.2 isolated core business API`): `pass` (`4m46s`)<br>- `isolated-integration-audit` (`V3.2-100 M02 cross-stage integration audit`): `pass` (`9s`)<br>- `notice-unit-and-postgres` (`V3.2-121 M02 isolated notice contract`): `pass` (`25s` / `27s`) | [Run 44280774627](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774627)<br>[Run 44280774706](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774706)<br>[Run 44280774642](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774642)<br>[Run 44280768108](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280768108) |
| **AI 交接文档分支** | `chatgpt/ms-ai-handoff-20261119`（从 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` 分出，仅存放 `handoff/*.md`，不修改业务代码） | `git merge-base` = `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` |
| **默认分支 (`origin/main`)** | `2d7f4f5310af4c962ab3d11b1a31b42c9bed2ea1`（仅含早期 V3.0 索引与边界文档，不代表当前实现） | [README.md](https://github.com/Lizhaochuan/market-sales-system/blob/main/README.md) |
| **本机工作区状态** | 切换交接分支前本机工作区 clean（无未提交业务改动）；本轮仅更新 `handoff/` 文档 | `git status -sb` 实测确认 |

### 上一轮基线滞后 19 次提交的根因说明
- 上一轮 Argon 审计使用了本地未执行 `git fetch` 的旧分支 `pr-129`（停留在 `38eb1690bf7282269c8e7ffd65e6ad81e9ef19dd`），因而漏读了远端 `chatgpt/v3-2-121-m02-revocation-notices` 随后新增的 **19 次提交**（`38eb169..fda4ceb`，涵盖 `lead-desk`、V3.4 独立销售闭环、按角色隔离工作台、电话查重与市场交接、单项连续操作卡片、线下面谈免填地点与 CRM 兼容试听教室字段）。
- 本轮已拉取 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` 全量代码并逐文件重读核对，彻底纠偏。

---

## 二、基于 `fda4ceb` 源码核实的当前系统真实能力

所有以下结论均基于直接读取 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` 源码、迁移脚本与测试文件（非仅凭文档宣称）：

1. **数据库与防断链硬约束已落地（opt-in 隔离工作区）**：
   - [`db/workspace-migrations/039_v34_sales_loop.sql`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/db/workspace-migrations/039_v34_sales_loop.sql)：新增 `ms_workspace.lead_workflow`（1:1 关联 `ms.leads`）、扩展 `ms_workspace.records` 类型（含 `appointments / enrollments / payments / refunds / corrections / discounts / workflow-drafts / course-catalog`），并通过延迟约束触发器 `valid_open_chain` 与 `retained_open_chain`（`ms_workspace.assert_active_chain`）在数据库提交层硬禁止 Open Lead 断链。
   - [`db/workspace-migrations/040_role_workspaces.sql`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/db/workspace-migrations/040_role_workspaces.sql)：新增 `ms_workspace.lead_directory`，以标准化电话支持市场录入、同机构精准查重与市场→销售交接（不向旧 `ms.contacts` 表增加电话列）。
2. **V3.4 独立销售闭环与角色隔离后端已落地**：
   - [`src/sales-workflow.mjs`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs)（349 行）：实现 `/api/v1/isolated-workspace/workflow/*` 全套接口，包含：接单+首次安排、两级沟通方式/结果/条件化失败原因、待回复检查、线下面谈（免填地点）与独立试听（含 CRM 兼容教室字段 `options.classrooms`）、主动到访面谈、改期历史/爽约/取消均不断链、多课程本地标准价目与优惠独立审批、报名订单、协议独立核实、`finance_verifier` 独立核款、**报名成功标准 B（`agreement_confirmed && net_cents > 0`）**、**全款正式 Closed Won（`balance_cents === 0` 且无未决款项/纠正，写唯一 `ms.sale_events`）**、Closed Lost 结构化原因与 `do_not_contact`、主管申请+独立第二主管复核+接收人确认的 Lead 转交、退款/取消纠正、乐观锁 `expected_version` 与幂等、以及 `GET /workflow/metrics`。
   - [`src/role-workspaces.mjs`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/role-workspaces.mjs)（76 行）：实现销售/销售主管/市场/市场主管/总管理者/财务核实员的严格部门边界、`POST /workflow/lookup` 电话查重（防抢单，仅提示负责人）、`GET/POST /workflow/market`（市场内部备注对销售不可见）、`POST /workflow/{leadId}/claim` 事务锁接单。
3. **PC 前端角色工作台与连续操作卡片已落地**：
   - [`web/sales-workflow.js`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js)（225 行）：已按角色分首页（销售进入“我的待办”，按选定日期+实际逾期展示；主管可切换团队；市场进入“市场 Leads”；核款员进入“收款核实”；总管理者进入“统计与提醒”），支持电话查询与市场交接、单项连续操作卡片、未保存表单刷新保护、同员工内存草稿恢复（不写 `localStorage`/`sessionStorage`）及服务端个人草稿 `workflow-drafts`。
4. **经全仓文件扫描确认尚未建设的部分**：
   - **微信小程序**：仓库内无 `miniprogram/`、`app.json`、`project.config.json` 或任何 Taro/uni-app 工程（0 行小程序代码）。
   - **Boss 专项驾驶舱与下钻/督办**：已有 `GET /workflow/metrics`（[`src/sales-workflow.mjs`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L315-L349)）和基础平铺统计卡片（[`web/sales-workflow.js`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L145-L150)），但**尚无**时间区间/队列(Cohort) vs 时期(Event)双口径切换、点击数字下钻明细、时态 `as_of_at` 一致性快照、渠道质量与成本(`CPL/CAC`)分析及合规督办闭环。
   - **PC 端多视图与右侧上下文抽屉**：已有单页客户概览与单项卡片，但尚无保留列表筛选位置的侧边详情体验、只读看板/日历视图与 Saved Views。
   - **独立公海池策略**：现有为“市场→销售电话交接”与“双主管审批+接收人确认的 Lead 转交”，尚无单独决策后的公海自动回收/值班主管托管模块。

---

## 三、本轮实际完成工作

- 实时同步并核验 PR #129 (`fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`) 及全部 4 项 GitHub Actions CI 状态。
- 完整阅读 `handoff/AUDIT_REVIEW_20261119.md`、`handoff/CORRECTED_IMPLEMENTATION_PLAN.md`、`docs/ROLE_WORKSPACES.md`、`docs/V3.4_SALES_WORKFLOW.md`、`docs/V3.4_DEVELOPMENT_REPORT.md`、`db/workspace-migrations/039`–`040`、`src/sales-workflow.mjs`、`src/role-workspaces.mjs`、`web/sales-workflow.js` 及 V3.4/角色测试清单。
- 在交接分支 `chatgpt/ms-ai-handoff-20261119` 交付修订后的 60 项逐项复核矩阵（[`handoff/REAUDITED_GAP_MATRIX_60_ITEMS.md`](REAUDITED_GAP_MATRIX_60_ITEMS.md)）与修订版实施顺序及验收标准（[`handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md`](REVISED_ROADMAP_AND_ACCEPTANCE.md)），同步更新 `CURRENT_STATE.md`、`TASK_BOARD.md`、`TEST_RESULTS.md`。
- 本轮**未修改任何业务代码、未执行本地测试/迁移、未合并、未部署**。

---

## 四、下一步交接门槛

1. 请 ChatGPT 与用户审核 `handoff/REAUDITED_GAP_MATRIX_60_ITEMS.md` 与 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md`。
2. 审核通过且对 `REVISED_ROADMAP_AND_ACCEPTANCE.md` 中的待决业务策略拍板后，方可进入独立受控开发分支启动 Phase 1（PC 增量体验优化）或 Phase 2（Boss 指标契约与证据化下钻）。
3. 任何代码实施必须以 PR #129 最新 HEAD 为基线，不得与 PR #129 并行改写冲突文件，且始终维持 `EXT-001=UNVERIFIED` / `HOLD=true` / `Draft`。
