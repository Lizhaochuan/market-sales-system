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
| **本地后端 API / 权限 / 安全测试** | `npm test`（本地因新容器无 `node_modules` 报 `ERR_MODULE_NOT_FOUND`；GitHub Actions CI [44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746) 中全绿通过） | `exit 0` (CI) | **全部通过**：CI 独立 PostgreSQL 16 环境完整跑通 |
| **本地合约语法与设计测试** | 独立运行 `node --check src/sales-workflow.mjs` (exit 0)、`node --check web/sales-workflow.js` (exit 0)、`node --check tests/browser/zz-role-workspaces.spec.mjs` (exit 0) 与 `node --test tests/contracts/contracts.test.mjs` (exit 0, 8 passed) | `exit 0` | **全部通过**：逐文件语法检查与设计不变量无误 |
| **本地 PostgreSQL 迁移执行** | GitHub Actions CI [44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746) 执行完整迁移与测试数据播种 | `exit 0` | **全部通过** |
| **Chromium 浏览器 UAT (PC-01)** | GitHub Actions CI [44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746) 官方 Runner 执行 `npx playwright test` | `exit 0` (33 passed, 22.2s) | **实测全绿通过**：涵盖 `tests/browser/zz-role-workspaces.spec.mjs` 全部 8 项用例及全仓 33 项浏览器回归 |
| **微信小程序开发者工具 / 真机测试** | 仓库无小程序工程，本轮**没有运行** | — | **未验证** |
| **生产环境 / 外部系统集成** | 本轮**没有接触** | — | 不适用；禁止部署 |

---

## 二、PC-01 审查修复与全流程 CI 验证记录（chatgpt/ms-ui-001-pc-01）

### 1. ChatGPT 审查指出的功能缺陷、时区隐患与断言补齐

根据 ChatGPT 对第一版 PC-01 真实代码审核反馈，完成了以下精准修改：

1. **`src/sales-workflow.mjs`（第 347 行）**：
   - **修复**：在 `metrics()` 返回的 `reminders` 中显式输出已有数据库记录真实类型：
     ```javascript
     kind: r.kind,
     type: r.kind === 'appointments' ? r.body.type : (r.body.action || 'call'),
     appointment_type: r.kind === 'appointments' ? r.body.type : null
     ```
   - **效果**：不破坏已有预约数据结构，不新建第二套任务体系，前端获得稳定的结构化类型判别依据，消除标题关键字模糊匹配。

2. **`web/sales-workflow.js`（第 178–247 行）**：
   - **修复**：
     - 创建独立受控容器 `#v35-handover-tasks`，将审批、接手、待补安排统一由 `renderHandover()` 动态管理。
     - 在 `taskFilter==='handover'` 时，彻底隐藏当日普通待办（`#v35-day-tasks`）、逾期待办（`#v35-overdue-tasks`）、概览统计与日期标题，仅显示 `#v35-handover-tasks`；无事项时渲染语义化空状态：“暂无待审批或待接手事项”。
     - 严格遵守 `options.manager` 权限控制，普通销售（`sales-a`）永不渲染 `#v35-approvals`，不越权暴露主管独立复核区块。
     - 在 `taskFilter==='appointments'` 时，依据结构化字段排他过滤，无预约时渲染空状态：“当天没有面谈或试听安排”。
     - 胶囊切换至 `all` 时恢复一体化视图，且在自动/手动刷新（`__refreshBusinessWorkspace()`）及草稿保护下维持筛选态。

3. **`tests/browser/zz-role-workspaces.spec.mjs`（用例 8 时区稳定化与强制断言）**：
   - **消除跨时区/跨午夜风险**：摒弃使用本地运行环境时区计算“今日”，改为通过 `Intl.DateTimeFormat(..., {timeZone:'Asia/Shanghai'})` 显式计算上海自然日（如 `shTodayStr`），并以 UTC 04:00 构造上海正午 12:00 基准时间戳。无论测试在 UTC、PST 还是北京时间运行，均稳定对应同一自然日。
   - **排他性正反断言**：同一天内同时生成“普通电话跟进”与“试听预约”，筛选后正向断言试听预约存在，反向断言普通电话被严格过滤（`not.toContainText`）；切换至无预约日期断言显示空状态；刷新后断言筛选状态依然保持。
   - **强制主管独立复核权限断言（拒绝静默跳过）**：取消原 `if(leadRow)` 可选分支，改为明确依据当日创建的客户检索 `lead_id`，强制断言检索成功（`expect(leadRes.rows.length).toBe(1)`）；插入待复核记录后以 `supervisor` 登录断言 `#v35-approvals` 呈现“待主管独立复核”且当日待办隐藏；再切回 `sales-a` 强制断言复核区块不存在（count 0）。
   - **390px 移动端断言**：无横向滚动溢出断言。

### 2. 逐文件静态检查结果

逐一执行 `node --check` 命令（无批量跳过）：
- `node --check src/sales-workflow.mjs`：退出码 **`0`**
- `node --check web/sales-workflow.js`：退出码 **`0`**
- `node --check tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（8 passed，0 failed）

### 3. GitHub Actions CI 真实运行与验证证据

在具备完整依赖环境的 GitHub Actions 官方 Runner 上针对分支 `chatgpt/ms-ui-001-pc-01` 成功触发全流程 CI：
- **CI 运行链接**：[Run 44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746)（Job ID `135363397698`，耗时 3m11s）
- **对应 Commit SHA**：`ed2b188c0119e8cf9698d254589d318359b3d2b2`
- **实际执行结果**：
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` 退出码 `0`，**`33 passed (22.2s)`**（包含全部 8 项 `zz-role-workspaces.spec.mjs` 角色工作台测试）
  - `Restricted actual LOGIN and tenant row-level security E2E`：退出码 `0`，**`12 passed, 0 failed`**
  - `Core API, authorization, idempotency and Chinese audit E2E`：退出码 `0`，全部通过
  - `Check frontend JavaScript syntax`：31 个前端/后端关键脚本 `node --check` 退出码 `0`
  - `Existing design contract regression`：退出码 `0`，**`8 passed, 0 failed`**
- **当前状态评定**：依据 GitHub Actions 官方独立环境实测全绿证据，正式将 PC-01 标为 **`DONE`**。

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
