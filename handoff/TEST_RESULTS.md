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
| **后端 API / 权限 / 安全测试（本地受阻，CI 验证）** | `npm test` 在新容器因缺 `pg` 包无法运行；[GitHub Actions Run 44467955779](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955779) 在隔离 PostgreSQL 16/Node 22 Runner 执行完整核心测试 | CI `exit 0`；`722 passed / 0 failed` | **CI 实测通过**，本地未复跑；不能混淆两种环境 |
| **本地合约语法与设计测试** | 独立运行 `node --check src/sales-workflow.mjs` (exit 0)、`node --check web/sales-workflow.js` (exit 0)、`node --check tests/browser/zz-role-workspaces.spec.mjs` (exit 0) 与 `node --test tests/contracts/contracts.test.mjs` (exit 0, 8 passed) | `exit 0` | **全部通过**：逐文件语法检查与设计不变量无误 |
| **PostgreSQL 迁移执行（GitHub Actions CI）** | [Run 44467955779](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955779) 中创建完整隔离 Schema 和 fixture | CI `exit 0` | **CI 通过**，未执行本地迁移 |
| **Chromium 浏览器 UAT (PC-01)** | [Run 44467955779](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955779)，提交 `77c532977049311a70e45332c4e4f3a7cdccbd91`，执行 `npx playwright test` | CI `exit 0`，`34 passed / 0 failed`，约 2.4 分钟 | **全部通过**：含 8 项角色工作台浏览器用例及 PC-01；旧 Run 44465869746 实为失败，不得混淆 |
| **微信小程序开发者工具 / 真机测试** | 仓库无小程序工程，本轮**没有运行** | — | **未验证** |
| **生产环境 / 外部系统集成** | 本轮**没有接触** | — | 不适用；禁止部署 |

---

## 二、PC-02 客户列表与侧边详情优化验证记录（chatgpt/ms-ui-002-pc-02）

- **开发分支**：`chatgpt/ms-ui-002-pc-02`（基于 `chatgpt/ms-ui-001-pc-01` 已验收基线）
- **基线实测代码 Commit SHA**：`2b5fe593b73d67fbb1f8d9ea3d569c2b13a61fa5`（历史基线 CI：[Run 44476779698](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44476779698)）
- **当前状态**：`REVIEW_REQUIRED`（待本轮增量修复 CI 运行验证；保持 Draft / CI-only / `HOLD=true` / `EXT-001=UNVERIFIED`）

### 1. 本轮增量修复与代码改进

针对 ChatGPT 静态代码审查指出的两处遗漏进行针对性增强：

1. **未保存表单导航保护（内存安全暂存与主动放弃确认）**：
   - 在 `web/sales-workflow.js` 中引入会话级内存暂存结构 `leadDrafts = new Map()` 与辅助函数 `hasDirtyForm()`、`snapshotLead(leadId)`、`restoreLeadDraft(draft)`。
   - 用户在侧边详情编辑跟进备注、变更状态或操作卡片表单未保存时，点击“返回客户列表”或“返回我的待办”，前端自动将草稿快照安全保存在当前员工会话内存中（不持久化至 `localStorage` 或 `sessionStorage`，杜绝 XSS 泄露与跨会话残留）。
   - 再次点击打开该客户时，自动恢复未保存的卡片、意向、备注内容并提示“已恢复本客户未保存的临时草稿”。
   - 在操作卡片区域显式提供“放弃未保存修改”按钮，点击触发 `confirm('确定放弃本次未保存的修改吗？')` 弹窗；用户主动确认后清除草稿并重置表单；未确认则保持原样。表单提交成功后（`mutate` 成功）自动清理该客户的草稿条目。普通无修改返回不受影响。

2. **401/403/404 权限异常 fail-closed 彻底清理**：
   - 提取全局安全清理函数 `wipeState()`，遇 401/403/404 权限撤回或失效时，除了清空 `rows`、`selected`、`detail` 外，彻底清理 `lookupPhone`、`lookupResult`、`claim`、`marketRows`、`incoming`、`options`、`staff`、`pendingLostFeedback` 及 `leadDrafts`，并显式隐藏 `#v35-sales-box` 工作台导航。
   - 在导航点击回调和 `display()` 中强制校验 `options?.access?.enabled`，权限撤回后 fail-closed 阻断任何导航切换与数据展示。
   - 严格保留 503 与临时网络断网时的 `keepForm` 保护，避免偶发网络波动误伤正在编辑的表单。
   - 在退出登录广播（`isolated-session-clear`）中同样调用 `wipeState()`，确保新员工登录后无法继承旧员工客户列表、详情或草稿。

3. **测试用例扩展（`tests/browser/zz-role-workspaces.spec.mjs`）**：
   - **`PC-02a`**：增加输入未保存跟进备注 -> 返回客户列表 -> 再次打开该客户 -> 断言未保存备注内容完整恢复；点击“放弃未保存修改”确认弹窗 -> 断言表单已清空；普通无修改返回正常流畅。
   - **`PC-02b`**：增加 403 权限撤权后工作台导航隐藏、旧客户详情清空断言；401/404 安全报错断言；切换至新员工 `sales-b` 登录断言无法看到 `sales-a` 客户、侧边详情与草稿。
   - 修复 PC-01 用例中 `ms.leads` 缺少 `contact_name` 列的问题（通过 `JOIN ms.contacts c ON c.id=l.contact_id` 关联）。

### 2. 本地静态检查与合约测试
- `node --check src/sales-workflow.mjs`：退出码 **`0`**
- `node --check web/sales-workflow.js`：退出码 **`0`**
- `node --check tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（**8 passed, 0 failed**）

### 3. GitHub Actions 验证记录
- **历史基线 CI**：[Run 44476779698](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44476779698)（提交 `2b5fe593b73d67fbb1f8d9ea3d569c2b13a61fa5`，耗时 4m44s，17 步全绿通过）。
- **本轮最新代码 CI**：将在提交推送后实时触发并回填 Run 链接、耗时与各步骤结论。

---

## 三、PC-01 审查修复与全流程 CI 验证记录（chatgpt/ms-ui-001-pc-01）

### 1. ChatGPT 审查指出的功能缺陷、时区隐患与断言补齐

根据 ChatGPT 对第一版 PC-01 真实代码审核反馈，完成了以下精准修改：

1. **`src/sales-workflow.mjs`（第 347 行）**：
   - 在 `metrics()` 返回的 `reminders` 中显式输出已有数据库记录真实类型（`kind`、`type`、`appointment_type`），消除标题关键字模糊匹配。
2. **`web/sales-workflow.js`（第 178–247 行）**：
   - 创建独立受控容器 `#v35-handover-tasks`，将审批、接手、待补安排统一由 `renderHandover()` 动态管理；
   - 在 `taskFilter==='handover'` 时排他显示待审批/待接手，无事项时渲染语义化空状态；严格遵守 `options.manager` 权限控制；
   - 在 `taskFilter==='appointments'` 时依据结构化字段排他过滤；
   - 保持 60 秒刷新及草稿保护。
3. **`tests/browser/zz-role-workspaces.spec.mjs`**：
   - 消除跨时区/跨午夜风险（按 Asia/Shanghai 锚定自然日）；
   - 增加排他性正反断言及空状态断言；
   - 强制主管独立复核权限断言（拒绝静默跳过）；
   - 390px 移动端无横向溢出断言。

### 2. 逐文件静态检查结果
- `node --check src/sales-workflow.mjs`：退出码 **`0`**
- `node --check web/sales-workflow.js`：退出码 **`0`**
- `node --check tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（8 passed，0 failed）

### 3. GitHub Actions CI 真实运行与验证证据（含失败复盘）

**严格按每次运行的真实状态记录；旧失败不得被后续成功覆盖或冒称已通过。**

- **首次失败**：[Run 44465869746](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44465869746)；对应代码 `ed2b1884ab776e51bb1ff8584da5a9ee2e4ddd99`，结论 **failure**。Playwright **33 passed / 1 failed**；PC-01 测试错误假定待审批/待接手容器为空，而既有 fixture 含真实待补安排客户。
- **第二次失败**：[Run 44467709039](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467709039)；对应 `aafeffd89af60f0142844fe3d390c09d3cce0c26`，结论 **failure**。Playwright **33 passed / 1 failed**；修正空列表假设后，新用例查询不存在的 `ms.leads.contact_name` 数据库列而失败。
- **最终通过**：[Run 44467955779](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955779)（Job ID `135370195511`），**`status=completed`、`conclusion=success`、`head_sha=77c532977049311a70e45332c4e4f3a7cdccbd91`**：
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` **exit 0**，**34 passed / 0 failed**（约 2.4m；含全部 8 项 `zz-role-workspaces.spec.mjs` 用例）。
  - `Core API, authorization, idempotency and Chinese audit E2E`：**exit 0**，**722 passed / 0 failed**。
  - `Restricted actual LOGIN and tenant row-level security E2E`：**exit 0**，**12 passed / 0 failed**。
  - `Check frontend JavaScript syntax`：**exit 0**。
  - `Existing design contract regression`：**exit 0**，**8 passed / 0 failed**。
  - 关联 [跨阶段隔离审计 Run 44467955638](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955638) 与 [通知契约 Run 44467955661](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44467955661) 均为 **success**。
- **代码与日志对应关系**：PC-01 原开发分支 `chatgpt/ms-ui-001-pc-01` 已安全快进到该 CI 验证的代码提交 `77c5329`，经 ChatGPT 验收。所有原始 CI 输出、退出状态和失败证据均保存在上述 GitHub Actions Run 页面。

---

## 四、PR #129 当前 HEAD (`fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`) 远端 GitHub Actions CI 实查结果

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
