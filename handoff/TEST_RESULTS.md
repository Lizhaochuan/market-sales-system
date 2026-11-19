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

## 二、PC-03 客户列表紧凑列式视图与联系方式脱敏验证记录（chatgpt/ms-ui-003-pc-03）

- **开发分支**：`chatgpt/ms-ui-003-pc-03`（基于 PC-02 已验收文档 HEAD `09af1155092b6e8322359c4f29e5677d4dbc32b2` / 代码 `a36ba3984df6c3ae7962cc30698c2d43fa42fd46`）
- **最新受测代码 Commit SHA**：`3cfea70d831990bb5e7ba0b5f4d1df17e49e12a8`
- **当前状态**：`REVIEW_REQUIRED`（最新增量代码已通过 GitHub Actions 全流程 CI 验证；保持 Draft / CI-only / `HOLD=true` / `EXT-001=UNVERIFIED` / `merge_authorized=false` / `deploy_authorized=false`，待 ChatGPT 最终审核）

### 1. 本轮增量实现与安全边界

1. **后端最小化只读字段补充（`src/sales-workflow.mjs` `listing()`）**：
   - 在既有授权与组织隔离查询 `GET /workflow` 中只读补充：`a.kind AS activity_kind`、`last_communication`（取自 `ms.audit_events` 最新 `V34_COMMUNICATION`）、`latest_appointment`（取自 `ms_workspace.records WHERE kind='appointments'`，按活跃状态优先）。
   - 严格使用结构化业务事实，不从标题猜测面谈/试听/报名/到账；`ms_workspace.lead_directory.marketing_notes` 仍严禁进入销售列表与详情接口。
2. **紧凑列式视图与卡片视图切换（`web/sales-workflow.js`、`web/styles.css`）**：
   - 在 `renderPhoneIntake()` 的“我的客户列表”新增 `列式视图`（默认）与 `卡片视图` 切换按钮（`aria-pressed`），切换视图不丢失搜索、状态筛选、排序、选中客户、滚动位置及未保存草稿。
   - 展示学生（含多学生串联）、销售阶段与终态、获客来源、最近一次实际沟通结果、面谈/试听当前状态、明确下一步及执行时间、真实逾期红标（`.badge.warning`）。
   - `>=1080px` 非分栏时展示 6 列对齐表头与列表；分栏或 `390px` 窄屏自动折叠为无横向溢出紧凑布局。
   - 修复编辑中即时显现“放弃未保存修改”按钮（`#v35-discard-draft`）。
3. **联系方式默认脱敏与详情按需展示**：
   - 列表与卡片视图统一通过 `maskPhone()` 脱敏展示电话（如 `138****1122`），无电话显示 `未留电话`；不在列表 DOM 文本、`title`、`aria-label`、`data-*` 或隐藏元素输出明文电话。
   - 完整电话仅在经服务端权限校验的授权客户详情 `renderLead()` 中按需展示。
4. **Playwright 扩展回归（`tests/browser/zz-role-workspaces.spec.mjs`）**：
   - `PC-03a`：列式/卡片双视图切换与状态/草稿保持、结构化沟通/面谈试听/报价非误标、列表脱敏与无市场内部备注泄露、多学生/无电话/空状态、1440/1280/390px 零横向溢出。
   - `PC-03b`：授权详情展示完整电话且不含市场备注、跨员工 `sales-b` 列表及 API 403 隔离、403 fail-closed 清理。

### 2. 本地静态检查与合约测试
- `node --check src/sales-workflow.mjs`：退出码 **`0`**
- `node --check web/sales-workflow.js`：退出码 **`0`**
- `node --check tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（**8 passed, 0 failed**）

### 3. GitHub Actions 验证记录
- **最新实测代码 CI（通过）**：[Run 44525579636](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44525579636)
  - 对应提交：`3cfea70d831990bb5e7ba0b5f4d1df17e49e12a8`
  - 运行结果：`status=completed`, `conclusion=success`, 耗时 5m12s，全部步骤 `success`。
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` **exit 0**，**38 passed / 0 failed**（3.5m，含全部 PC-01、PC-02a/b 与新增 PC-03a/b）。
  - `Core API, authorization, idempotency and Chinese audit E2E`：**exit 0**（全量通过）。
  - `Restricted actual LOGIN and tenant row-level security E2E`：**exit 0**（全量通过）。
  - `Check frontend JavaScript syntax`：**exit 0**。
  - `Existing design contract regression`：**exit 0**（**8 passed / 0 failed**）。
- *历史失败尝试（已修复，不得混淆）*：`Run 44515061076`（`08bfa80`，测试 quote 传参多字段）、`Run 44516401867`/`44517094967`（`5a998bc`/`0798e5e`，测试 fixture `lead_state` 与 SQL 参数数）、`Run 44517946646`/`44520293271`/`44523324555`（GitHub runner 依赖安装超时/环境故障）、`Run 44521232808`/`44524377333`（`d6faecd` 缺少即时 unhide `#v35-discard-draft`）。

---

## 三、PC-02 客户列表与侧边详情优化验证记录（chatgpt/ms-ui-002-pc-02）

**2026-11-19 ChatGPT 最终复审勘误与验收签收**：交付报告把 CI 对应提交错写为 `a36ba392070e7e1f41b2c45ee2b1462ce4aa4533`（GitHub 不存在该提交）；实查 GitHub Actions [Run 44510026815](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44510026815) 的实际 `head_sha=a36ba3984df6c3ae7962cc30698c2d43fa42fd46`，状态 `completed/success`。该代码通过 Node/PG **722/722**、Chromium **36/36**、LOGIN/RLS **12/12**、合约 **8/8**。静态复审确认跨客户/导航保存当前内存草稿、独立恢复、主动放弃，以及 refresh/openLead/mutate/history 四类异步请求的 401/403/404 fail-closed 清理。新 PC-02b 实测 POST 400/503/403、GET 403/404；401 分支代码逻辑核查通过，但本次新增用例并未单独模拟 401，不得夸大。仅有 handoff 文档提交发生在上述受测代码后，不修改受测业务代码。结论：**PC-02=DONE（开发/测试验收）**，全局仍保持 `HOLD=true`、`EXT-001=UNVERIFIED`、`merge_authorized=false`、`deploy_authorized=false`。


- **开发分支**：`chatgpt/ms-ui-002-pc-02`（基于 `chatgpt/ms-ui-001-pc-01` 已验收基线）
- **基线实测代码 Commit SHA**：`2b5fe593b73d67fbb1f8d9ea3d569c2b13a61fa5`（历史基线 CI：[Run 44476779698](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44476779698)）
- **前期增量代码 Commit SHA**：`797fbc0156bcbcc3b5d62d357ceab8293e5ac2d5`（前期 CI：[Run 44496152941](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44496152941)）
- **最新实测代码 Commit SHA**：`a36ba3984df6c3ae7962cc30698c2d43fa42fd46`
- **当前状态**：`DONE`（ChatGPT 复核源码及 GitHub Actions 原始日志通过；仅代表 PC-02 开发测试验收完成。仍保持 Draft / CI-only / `HOLD=true` / `EXT-001=UNVERIFIED`；不合并、不部署）

### 1. 本轮增量修复与代码改进

针对 ChatGPT 最终验收指出的一“客户间直接切换导致未保存草稿丢失”与二“401/403/404 fail-closed 清理覆盖所有异步入口”两处遗漏进行针对性增强：

1. **未保存表单导航保护与客户直接切换隔离（内存安全暂存、独立草稿与主动放弃确认）**：
   - 在 `web/sales-workflow.js` 中引入会话级内存暂存结构 `leadDrafts = new Map()` 与辅助函数 `hasDirtyForm()`、`snapshotLead(leadId)`、`restoreLeadDraft(draft)`，并通过输入监听实时标记表单 `data-user-dirty`。
   - 用户在侧边详情编辑跟进备注、变更状态或操作卡片表单未保存时，点击“返回客户列表”、“返回我的待办”、顶部导航或**在客户间直接切换（A -> B）**时，`openLead(id, recordId)` 与各导航入口自动通过 `saveCurrentLeadDraft()` 将草稿快照安全保存在当前员工会话内存中（不持久化至 `localStorage` 或 `sessionStorage`，杜绝 XSS 泄露与跨会话残留）。
   - 切换到客户 B 时不会混淆或恢复客户 A 的表单草稿；再次点击打开客户 A 时，自动恢复客户 A 未保存的卡片、意向、备注内容并提示“已恢复本客户未保存的临时草稿”。
   - 操作卡片提交成功（如安排试听、记录到访、推进后续）进入的延续界面（`scheduled` / `recorded` / `trial-next`）不被作为未保存草稿暂存，避免掩盖后续正常操作卡片。
   - 在操作卡片区域显式提供“放弃未保存修改”按钮，点击触发 `confirm('确定放弃本次未保存的修改吗？')` 弹窗；用户主动确认后清除草稿并重置表单；未确认则保持原样。表单提交成功后（`mutate` 成功）自动清理该客户的草稿条目。普通无修改返回不受影响。

2. **401/403/404 权限异常 fail-closed 彻底清理覆盖全异步入口**：
   - 提取全局安全清理函数 `wipeState()` 与 `handleAuthFailure(e)`，统一接管 `refresh()`、`openLead()`、`mutate()` 及 `history()` 异步调用。
   - 遇 401/403/404 权限撤回或失效时，除了清空 `rows`、`selected`、`detail` 外，递增 `epoch++; seq++; busy=false;` 拦截并使任何在途滞后的异步响应彻底失效，彻底清理 `lookupPhone`、`lookupResult`、`claim`、`marketRows`、`incoming`、`options`、`staff`、`pendingLostFeedback` 及 `leadDrafts`，并显式隐藏 `#v35-sales-box` 工作台导航。
   - 严格保留 400（业务/参数错误）、503（服务端暂时不可用）与临时网络断网时的 `keepForm` 保护，保留正在编辑的表单与输入内容，并显示明确错误提示。
   - 在退出登录广播（`isolated-session-clear`）中同样调用 `wipeState()`，确保新员工登录后无法继承旧员工客户列表、详情或草稿。

3. **测试用例扩展（`tests/browser/zz-role-workspaces.spec.mjs`）**：
   - **`PC-02a`**：
     - 增加输入未保存跟进备注 -> 返回客户列表 -> 再次打开该客户 -> 断言未保存备注内容完整恢复；
     - 增加客户间直接切换：客户 A 输入未保存跟进备注 -> 直接点击客户 B -> 断言客户 B 处于干净初始状态无客户 A 的草稿；再次点击客户 A -> 断言客户 A 的未保存备注完整恢复；
     - 增加在编辑中直接点击顶部“我的待办”/“客户概览”安全保留草稿；
     - 点击“放弃未保存修改”确认弹窗 -> 断言表单已清空；普通无修改返回正常流畅。
   - **`PC-02b`**：
     - 增加 POST 400 业务错误断言：表单与输入内容安全保留，不被清空；
     - 增加 POST 503 服务端暂时不可用断言：表单与输入内容安全保留，不被清空；
     - 增加 POST 403 权限撤销断言：立即 fail-closed 清理，工作台导航隐藏，旧客户详情清空；
     - 增加 POST 403、GET 403 与 GET 404 导致工作台清空及导航隐藏的断言；401 走同一 `handleAuthFailure` 代码分支，但本次新增 PC-02b 用例没有单独模拟 401，不能将其误报为已单独实测；
     - 切换至新员工 `sales-b` 登录断言无法看到 `sales-a` 客户、侧边详情与草稿。
   - 修复 PC-01 用例中 `ms.leads` 缺少 `contact_name` 列的问题（通过 `JOIN ms.contacts c ON c.id=l.contact_id` 关联）。

### 2. 本地静态检查与合约测试
- `node --check src/sales-workflow.mjs`：退出码 **`0`**
- `node --check web/sales-workflow.js`：退出码 **`0`**
- `node --check tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（**8 passed, 0 failed**）

### 3. GitHub Actions 验证记录
- **历史基线 CI**：[Run 44476779698](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44476779698)（提交 `2b5fe593b73d67fbb1f8d9ea3d569c2b13a61fa5`，耗时 4m44s，17 步全绿通过）。
- **前期增量代码 CI（通过）**：[Run 44496152941](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44496152941)（提交 `797fbc0156bcbcc3b5d62d357ceab8293e5ac2d5`，耗时 5m01s，17 步全绿）。
- **最新增量代码 CI（通过）**：[Run 44510026815](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44510026815)
  - 对应提交：`a36ba3984df6c3ae7962cc30698c2d43fa42fd46`
  - 运行结果：`status=completed`, `conclusion=success`, 耗时 5m07s，17/17 步骤全部通过。
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` **exit 0**，**36 passed / 0 failed**（约 2.6m；含全部 10 项 `zz-role-workspaces.spec.mjs` 用例，涵盖 PC-01 与全面增强的 PC-02a、PC-02b）。
  - `Core API, authorization, idempotency and Chinese audit E2E`：**exit 0**，**722 passed / 0 failed**。
  - `Restricted actual LOGIN and tenant row-level security E2E`：**exit 0**，**12 passed / 0 failed**。
  - `Check frontend JavaScript syntax`：**exit 0**。
  - `Existing design contract regression`：**exit 0**，**8 passed / 0 failed**。

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
