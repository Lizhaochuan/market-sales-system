# 验证与测试台账 | TEST_RESULTS

更新时间：2026-11-19。原则：**历史测试记录、GitHub 远端 CI 记录与本轮亲自执行的检查严格分开；缺失实测一律标“未验证”。**

---

## 一、本轮复核与交接文档修订（2026-11-19，Antigravity / Argon）

| 检查项目 | 实际执行的命令 / 方法 | 退出码 / 结果 | 结论 |
|---|---|---|---|
| **GitHub 远端分支实时同步** | `git fetch origin chatgpt/v3-2-121-m02-revocation-notices chatgpt/ms-ai-handoff-20261119` | `exit 0` | 同步成功；确认 PR #129 实时 HEAD 为 `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`，交接分支基线为 `8c90477a664b8e7a2e145fa54405c29cb8972c2a`（merge-base = `fda4ceb`） |
| **PR #129 状态核验** | `gh pr view 129 --json number,title,state,isDraft,headRefName,headRefOid,url` | `exit 0` | `OPEN`、`isDraft: true`、`headRefOid: fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` |
| **PR #129 HEAD 对应 GitHub Actions CI 查询** | `gh pr checks 129` 与 `gh run list --branch chatgpt/v3-2-121-m02-revocation-notices -L 5` | `exit 0` | `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74` 对应 4/4 检查 `pass`（见第二节完整链接）；**绿色 CI 不解除 HOLD** |
| **最新业务源码与迁移逐文件核读** | 读取 `docs/ROLE_WORKSPACES.md`、`docs/V3.4_SALES_WORKFLOW.md`、`docs/V3.4_DEVELOPMENT_REPORT.md`、`db/workspace-migrations/039`–`040`、`src/sales-workflow.mjs`、`src/role-workspaces.mjs`、`web/sales-workflow.js` 及 V3.4/角色测试清单 | 完成 | 核实防断链 DB 触发器、独立面谈/试听、标准 B 与 Won 分离、角色隔离与待办已落地；确认无 `miniprogram/` 及独立 Boss 驾驶舱文件 |
| **仓库工作区与隔离检查** | `git status -sb`（`market-sales-system` 与 `edu-management-system`） | `exit 0` | 仅更新 `chatgpt/ms-ai-handoff-20261119` 下 `handoff/*.md`；未触碰业务代码，未触碰 `edu-management-system` |
| **本地后端 API / 权限 / 安全测试** | 本轮**没有运行**（纯审计与文档修订） | — | **未验证** |
| **本地 PostgreSQL 迁移执行** | 本轮**没有运行** | — | **未验证** |
| **本地 Chromium 浏览器 UAT (PC-01)** | `npx playwright test tests/browser/zz-role-workspaces.spec.mjs`（取证自 `task-868.log`） | `exit 0` (8 passed, 25.3s) | **历史实测全绿**：涵盖原 7 项及新增 PC-01 测试；本轮新容器受 npm registry 403 策略限制未能重新跑通，严谨标为 `REVIEW_REQUIRED` 交付审核 |
| **微信小程序开发者工具 / 真机测试** | 仓库无小程序工程，本轮**没有运行** | — | **未验证** |
| **生产环境 / 外部系统集成** | 本轮**没有接触** | — | 不适用；禁止部署 |

---

## 二、PC-01 原生验证日志与交接记录（chatgpt/ms-ui-001-pc-01）

- **恢复提交文件**：
  - `web/sales-workflow.js`（增加待办快捷过滤胶囊 `all / overdue / appointments / handover`，增加逾期时长标识）
  - `tests/browser/zz-role-workspaces.spec.mjs`（追加第 8 项用例 `PC-01: daily todo quick filters, overdue badges, refresh preservation, and 390px layout`）
- **原生运行核验证据（取证自持久化日志 `task-868.log`）**：
  - 测试命令：`npx playwright test tests/browser/zz-role-workspaces.spec.mjs`
  - 退出码：`0`
  - 耗时：`25.3s`
  - 实际通过数量：**`8 passed, 0 failed`**（含 8 项全部 Chromium 测试）
- **此前初测失败与修复归因（取证自持久化日志 `task-863.log`）**：
  - 报错：`Error: page.evaluate: Error: 请选择学生，或补充一次学生姓名`
  - 归因：用例在 `page.evaluate` 中调用 `/api/v1/isolated-workspace/workflow` 时漏传 `student_name`，触发了 V3.4 状态机业务防御拦截；补齐后在 `task-868` 全绿通过。
- **新会话未重新运行声明**：
  - 平台新分配容器实例对外限制访问 `registry.npmjs.org`（HTTP 403 Forbidden），未重装 `node_modules`。
  - 严格遵守指令要求 4 与 5，明确区分历史真实通过与本次未能重跑，将 PC-01 状态标记为 `REVIEW_REQUIRED` 供 ChatGPT 最终复核。

---

## 三、PR #129 当前 HEAD (`fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`) 远端 GitHub Actions CI 实查结果

以下为 2026-11-19 通过 `gh pr checks 129` 与 `gh run list` 实时查询的远端 CI 记录（均对应 `headSha = fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`，触发时间 `2026-11-18T09:57Z`）：

| Check / Workflow 名称 | 状态 | 耗时 | GitHub Actions 链接 |
|---|---|---|---|
| `core-api` (`V3.2 isolated core business API`) | `pass` | `4m46s` | [Run 44280774627](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774627) |
| `isolated-integration-audit` (`V3.2-100 M02 cross-stage integration audit`) | `pass` | `9s` | [Run 44280774706](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774706) |
| `notice-unit-and-postgres` (`V3.2-121 M02 isolated notice contract`) | `pass` | `25s` | [Run 44280774642](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280774642) |
| `notice-unit-and-postgres` (`V3.2-121 M02 isolated notice contract`) | `pass` | `27s` | [Run 44280768108](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44280768108) |

> 注：以上为隔离 CI 自动化检查结果，仅证明 PR #129 在隔离测试环境构建与测试通过，**不代表生产准入，不解除 `HOLD=true` 与 `EXT-001=UNVERIFIED`**。

---

## 四、原开发分支引用的历史本地验证记录（非本轮执行结果）

以下数据直接引用自 [`docs/ROLE_WORKSPACES.md`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/docs/ROLE_WORKSPACES.md#L9-L10) 与 [`docs/V3.4_DEVELOPMENT_REPORT.md`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/docs/V3.4_DEVELOPMENT_REPORT.md#L63-L70)，属于**引用的历史结果**：
- 业务提交 `0b60319fdd44c4a24ec24279c326a1c8e888fd6d` 文档声明的本地验证：接口/权限/安全 `722/722`、Chromium `33/33`、独立 LOGIN/RLS `12/12`、既有设计合约 `8/8`。
- 后续任何进入 Phase 1–4 业务代码修改的接手者，均须亲自在修改后重新运行完整 Node/PG、LOGIN/RLS、合约、Chromium 及（Phase 3 适用时）独立标注的微信小程序开发者工具/真机验证，并如实记录命令、退出码与失败复测情况。

---

## 五、发布边界（保持不变）

`EXT-001=UNVERIFIED`、`HOLD=true`、`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`。禁止合并主分支、生产部署、主 CRM 代码修改和跨系统数据同步。
