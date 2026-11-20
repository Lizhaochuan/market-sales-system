# 验证与测试台账 | TEST_RESULTS

更新时间：2026-11-19。原则：**历史测试记录、GitHub 远端 CI 记录与本轮亲自执行的检查严格分开；缺失实测一律标“未验证”。**

---

## PC-05 手动跟进时间独立验收（2026-11-20）

Antigravity 对原提交 `aa7e8d6` 的独立验收指出，测试可能把电话查询留下的提示误认为新建保存成功。修订后的 PC-05 用例等待实际新建请求成功，并在客户详情和重新登录后的待办中核对同一时间。用例验证原有三个日期预设、手动覆盖已生效的预设，以及上海时间 22:37 原样保存。

**PC-05=DONE。** Antigravity 独立复验确认受测提交为 `52edab5b1a919c9a9c32e06e6f0bb98e715b9a1e`，保存同步、预设覆盖和上海时间 22:37 原样保存三项通过。

- 首轮 PC-05 通过，既有 `isolated-workspace.spec.mjs:182` 等待 `#toast` 超时。Chromium 41/42，合约步骤未运行。日志 `.tmp/pc05.vgb7MY/full-10.log`。
- 第二轮从空的隔离库完整复跑。核心、界面与安全 750/750、Chromium 42/42、LOGIN/RLS 12/12、合约 8/8。日志 `.tmp/pc05.drVgWs/full-6.log` 至 `full-11.log`。
- UTC 浏览器定向复跑 1/1。日志 `.tmp/pc05.drVgWs/pc05-utc.log`。

证据为本地独立复验，未运行本分支的 GitHub Actions。保留 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。

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

## 二、PC-04 只读阶段看板、周日程与 Saved Views 验证记录（chatgpt/ms-ui-004-pc-04）

- **开发分支**：`chatgpt/ms-ui-004-pc-04`（基于 PC-03 已验收文档 HEAD `a3edeb14fa24dff40e66291d602c6ab7f5710a1c` / 代码 `0eb982d7b7981b69a82aa38506bb8289a22adbf0`）
- **最终验收代码 Commit SHA**：`4d9cdb991510afec3ee2b0a02dc1004107233e7d`
- **当前状态**：`DONE`（2026-11-20 开发验收通过）。保持 Draft / CI-only、`HOLD=true`、`EXT-001=UNVERIFIED`、`merge_authorized=false`、`deploy_authorized=false`。PC-05 未启动。
- **最终验收证据**：Mac 使用全新隔离 PostgreSQL 16 测试库执行主工作流完整回归。GitHub Actions [Run 44585452635](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44585452635) 的 HEAD 与受测 SHA 一致，结果为 `completed / success`，21/21 步通过。两处结果均为核心、界面与安全 750/750，Chromium 41/41，LOGIN/RLS 12/12，合约 8/8。
- **源码复核**：`isSensitivePhonePattern()` 在视图名称与搜索词写入会话前执行，修复相邻号码因数字总位数过长而漏检。PC-04c 验证两处输入拒绝指定号码，普通含数字名称可保存和恢复。

### 1. 本轮增量实现与安全边界（含 Saved Views 敏感电话号码防护）

1. **只读阶段看板 Kanban（`web/sales-workflow.js` `renderPhoneIntake()`、`web/styles.css`）**：
   - 在“我的客户列表”新增 `阶段看板` 视图切换（保留 `列式视图` 默认与 `卡片视图`），切换不丢失搜索、状态筛选、排序、选中客户及内存草稿。
   - 仅基于已授权 `GET /workflow` 投影：按真实 `stage`（`options.stages`）及终态（`Closed Won` / `Closed Lost` / `旧终态`）分组，每个 Lead 仅出现一次。
   - **严格只读**：无 `draggable="true"`、无拖拽事件、无阶段下拉框或内联改写；列表卡片仅展示 `contact_info_masked`；点击`打开客户`进入既有授权 `#v35-side-detail` 与单项操作卡片。
2. **会话内存级 Saved Views 与敏感号码输入校验（`web/sales-workflow.js` `#v35-saved-views`）**：
   - 允许当前员工保存当前筛选配置（名称、搜索词、状态筛选、排序、视图模式 `table|cards|kanban`）、一键切换及删除。
   - **敏感电话号码严格阻断**：增加 `isSensitivePhonePattern` 校验；凡搜索词或视图名称包含 11 位手机号、带空格/连字符等分隔符的号码格式、或连续 7 位以上数字的号码形态，一律拒绝保存并弹出明确 UI 安全提示（`#v35-saved-view-hint`：“安全提示：视图名称和搜索条件不能包含电话号码。请清除号码后保存非敏感筛选条件”）；允许含数字的普通客户名称（如 `04A`、`学生1`）正常保存。
   - 仅存于前端闭包内存（`savedViews`），严禁写入 `localStorage` / `sessionStorage`，不缓存明文电话或客户明细；在 `wipeState()` 及员工切换（`session !== token`）时立即清空。未新增数据库迁移或表结构。
3. **只读周日程 Calendar（`web/sales-workflow.js` `renderRoleTasks()`、`web/styles.css`）**：
   - 在“我的待办”新增 `日待办视图`（默认，PC-01 行为零改动）与 `周日程视图` 切换。
   - 基于已授权 `GET /workflow/metrics` `reminders` 与 `rows` 按 `Asia/Shanghai` 自然日展示周一至周日日程，使用纯 UTC 日历运算处理跨月、跨年与上海午夜边界（如 `2026-12-31T16:30:00Z` 归入 `2027-01-01`），支持`上一周`、`回到本周`、`下一周`及主管范围切换（`taskScope`）。
   - 严格使用结构化字段标注类型（`试听` / `面谈` / `跟进待办`），不从任务标题猜测；展示真实执行时间、负责人、逾期红标，点击`查看进展 / 继续跟进`进入既有侧边详情。
   - `1440×900`、`1280×720` 及 `390×844`（纵向堆叠）零横向溢出；401/403/404 `wipeState()` 立即清空看板、周日程与 Saved Views。
4. **Playwright 扩展回归（`tests/browser/zz-role-workspaces.spec.mjs`）**：
   - `PC-04a`：验证完整 11 位手机号、带空格/连字符号码及名称内嵌号码均被阻断并提示、含数字普通姓名/标识正常保存与恢复搜索/筛选/排序/看板、Saved Views 删除及跨员工隔离、看板无拖拽/无内联修改控件、列表脱敏、侧边详情全号展示与切视图草稿保留、1280/390px 零横向溢出。
   - `PC-04b`：验证周日程跨月/跨年（`2026-12-28 ~ 2027-01-03`）与 `Asia/Shanghai` 午夜归日、防标题误判（`假装试听`仍标`跟进待办`）、周导航、从周日程打开侧边详情、390px 零横向溢出及 403 fail-closed 清理。

### 2. 本地静态检查与合约测试
- `node --check web/sales-workflow.js tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（**8 passed, 0 failed**）

### 3. GitHub Actions 验证记录
- **早期实测代码 CI（历史记录）**：[Run 44559047616](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44559047616)
  - 对应提交：`80522677aac5947546d8d9af90ee44eaf4e88be2`
  - 运行结果：`status=completed`, `conclusion=success`, 耗时 4m20s，全部 21/21 步 `success`。
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` **exit 0**，**40 passed / 0 failed**（2.6m，含 PC-01、PC-02a/b、PC-03a/b 与更新后 PC-04a/b）。
  - `Core API, authorization, idempotency and Chinese audit E2E`：**exit 0**（全量通过）。
  - `Restricted actual LOGIN and tenant row-level security E2E`：**exit 0**（全量通过）。
  - `Check frontend JavaScript syntax`：**exit 0**。
  - `Existing design contract regression`：**exit 0**（**8 passed / 0 failed**）。
- *历史阶段记录（已修复并 superseded，不得混淆）*：`Run 44547031262`（`2bf1a79`，未加电话号码敏感防护前版本）、`Run 44544370705`（`0e3d666`）、`Run 44545402451`（`e189839`）。

---

## 三、PC-03 客户列表紧凑列式视图与联系方式脱敏验证记录（chatgpt/ms-ui-003-pc-03）

**ChatGPT 复审签收（2026-11-19）**：直接核实 [Run 44534751901](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44534751901) `status=completed/conclusion=success`，实测代码 SHA `0eb982d7b7981b69a82aa38506bb8289a22adbf0`。真实日志：Chromium **38/38**、核心 API/权限/安全 **722/722**、LOGIN/RLS **12/12**、合约 **8/8**。审阅 `src/sales-workflow.mjs` 确认列表查询内临时使用 `w.contact_info` 完成服务端匹配，但返回前通过 `({contact_info,...r})` 删除明文，仅返回 `contact_info_masked`；授权详情接口仍单独校验权限。核实 API 与 Playwright 断言已验证普通列表、`?q=` 搜索列表原始 JSON 不含完整电话，并验证跨员工搜索无结果、市场备注不可见和草稿/视图回归。该 SHA 后仅更新交接 Markdown，未修改受测代码。**PC-03=DONE**。注意：搜索时用户输入的完整电话仍随 `GET ?q=` 请求 URL 发送，未来正式部署前需单独评估 HTTP 访问日志、代理日志与监控中的敏感参数脱敏/改用受控 POST 查询；这一项不是列表 API 响应泄露，亦不构成本轮开发验收的合并/上线授权。



- **开发分支**：`chatgpt/ms-ui-003-pc-03`（基于 PC-02 已验收文档 HEAD `09af1155092b6e8322359c4f29e5677d4dbc32b2` / 代码 `a36ba3984df6c3ae7962cc30698c2d43fa42fd46`）
- **最新受测代码 Commit SHA**：`0eb982d7b7981b69a82aa38506bb8289a22adbf0`
- **当前状态**：`DONE`（ChatGPT 对源码、JSON 返回、权限约束及 CI 原始日志核验通过；仅代表 PC-03 开发与测试验收完成。Draft / CI-only / `HOLD=true` / `EXT-001=UNVERIFIED` / `merge_authorized=false` / `deploy_authorized=false` 不变。）

### 1. 本轮增量实现与安全边界（含电话号码数据最小化修复）

1. **后端接口数据最小化与服务端搜索（`src/app.mjs`、`src/isolated-business-workspace.mjs`、`src/sales-workflow.mjs`）**：
   - `src/app.mjs` 与 `src/isolated-business-workspace.mjs` 将 URL `query` 参数透传至 `salesWorkflow(..., { query })`。
   - `src/sales-workflow.mjs` `listing(c, ctx, query)` 从 `GET /workflow` 响应中彻底剥离明文 `contact_info`，仅返回 `contact_info_masked`（如 `139****0045`，无电话返回 `""`）；同时只读补充 `a.kind AS activity_kind`、`last_communication`、`latest_appointment`。
   - 支持可选 `?q=` 参数在服务端 SQL 层匹配联系人/学生姓名及（`>=4` 位数字时）电话号码，严格在既有 `organization_id`、非市场部门与 `owner_user_id = actor OR manager` 隔离范围内查询，返回结果同样仅含 `contact_info_masked`、不含明文 `contact_info`。
   - 完整原始电话号码仅通过经权限校验的 `GET /workflow/:id` 详情接口按需获取；`ms_workspace.lead_directory.marketing_notes` 仍严禁进入销售列表与详情接口。
2. **紧凑列式视图与卡片视图切换（`web/sales-workflow.js`、`web/styles.css`）**：
   - `renderPhoneIntake()` 列表与卡片均改用 `l.contact_info_masked` 展示脱敏电话，不在前端列表状态、DOM、隐藏属性或本地存储保留明文电话。
   - 搜索框输入 `>=4` 位数字时自动触发 `GET /api/v1/isolated-workspace/workflow?q=...` 服务端检索（带 `token` / `epoch` / `searchSeq` 并发护栏及 401/403/404 `handleAuthFailure`），姓名/学生关键字仍走本地快速过滤；切换列式/卡片视图保留搜索、筛选、排序、选中客户、滚动位置及未保存草稿。
3. **API 与 Playwright 扩展回归（`tests/core/role-workspaces.test.mjs`、`tests/browser/zz-role-workspaces.spec.mjs`）**：
   - `tests/core/role-workspaces.test.mjs`：断言 `GET /workflow` 列表及 `?q=` 响应不含明文 `contact_info` 且仅含 `contact_info_masked`，`GET /workflow/:id` 授权详情返回完整 `contact_info`，跨员工 `sales-b` 查询 `?q=` 返回 0 条。
   - `PC-03a`/`PC-03b`：拦截并断言 `GET /api/v1/isolated-workspace/workflow` 及 `?q=` 响应 JSON 绝不含原始电话号码，验证按完整电话搜索命中自身客户且不泄露明文，验证跨员工 `?q=` 隔离、授权详情显示完整电话、1440/1280/390px 零横向溢出及 403 fail-closed 清理。

### 2. 本地静态检查与合约测试
- `node --check src/app.mjs src/isolated-business-workspace.mjs src/sales-workflow.mjs web/sales-workflow.js tests/core/role-workspaces.test.mjs tests/browser/zz-role-workspaces.spec.mjs`：退出码 **`0`**
- `node --test tests/contracts/contracts.test.mjs`：退出码 **`0`**（**8 passed, 0 failed**）

### 3. GitHub Actions 验证记录
- **最新实测代码 CI（通过）**：[Run 44534751901](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44534751901)
  - 对应提交：`0eb982d7b7981b69a82aa38506bb8289a22adbf0`
  - 运行结果：`status=completed`, `conclusion=success`, 耗时 4m59s，全部 21/21 步 `success`。
  - `Real headless Chromium workflow and responsive UI`：`npx playwright test` **exit 0**，**38 passed / 0 failed**（2.6m，含全部 PC-01、PC-02a/b 与更新后 PC-03a/b）。
  - `Core API, authorization, idempotency and Chinese audit E2E`：**exit 0**（全量通过）。
  - `Restricted actual LOGIN and tenant row-level security E2E`：**exit 0**（全量通过）。
  - `Check frontend JavaScript syntax`：**exit 0**。
  - `Existing design contract regression`：**exit 0**（**8 passed / 0 failed**）。
- *历史阶段 CI（已 superseded，不得混淆）*：`Run 44525579636`（`3cfea70d831990bb5e7ba0b5f4d1df17e49e12a8`，修复列表 API 明文电话前）。

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

## 六、Boss 驾驶舱有效线索核验与服务校区归属（2026-11-21）

Mac 使用空白 PostgreSQL 16 独立测试库及虚拟校区、虚拟线索运行完整回归，退出码为 `0`。受限 SQL 冒烟、前后端 JavaScript 语法检查通过，LOGIN/RLS 12/12，Core API/UI/安全 779/779，真实 Chromium 49/49，设计合约 8/8。角色工作台单独复跑 31/31。

用例覆盖无效审批、驳回、改判、重复归并、核验率及覆盖率、首次登记并发、跨校区审批、换顾问和预约改期、按历史归属回放、按事件时间归属、撤权与校区汇总及下钻一致。Chromium 实测顾问提交、主管从待办审批、按新校区筛选并通过核验明细找到该线索。真实校区目录、历史归属与主管授权，以及财务确认的费用与历史账本待补充。保持 `HOLD=true`、`EXT-001=UNVERIFIED` 和 Draft / CI-only。

### Boss 验收复核与归并校验修正（2026-11-21）

[GitHub Actions #44771565409](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44771565409) 对应 `739ca446e6d4afc6077f9b74860e1b11cf728230`，全部通过。后续源码复核发现归并校验对同一个 UUID 的大小写写法处理不一致。修正后拒绝自我归并，合法归并保留规范主线索编号，也不会形成多级归并。新增断言覆盖这三种情况。

修正后在新建 Mac 独立 PostgreSQL 库全量复跑，退出码 `0`。LOGIN/RLS 12/12，Core API/UI/安全 779/779，真实 Chromium 49/49，设计合约 8/8。受限 SQL 冒烟和 JavaScript 语法检查通过。该修正当时只通过本地回归。Boss 保持 `REVIEW_REQUIRED`、`HOLD=true`、Draft / CI-only。真实校区映射和财务数据待补充。

### Boss 隔离功能验收签收（2026-11-21）

按用户授权签收 `MS-BOSS-001` 本轮功能，在任务板标记 `DONE`。受测代码为 `b9b24753d80278af8e1b1d08ebcadbb70068eb15`。[GitHub Actions #44777368124](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44777368124) 状态为 `completed / success`，与 Mac 独立库回归一致。LOGIN/RLS 12/12，Core API/UI/安全 779/779，Chromium 49/49，设计合约 8/8。受限 SQL 冒烟和 JavaScript 语法检查通过。CI 原始日志包含新增归并断言所在的集成用例。

签收范围为虚拟数据和隔离测试。真实校区目录、历史归属和授权映射仍待补充。财务确认的渠道费用和历史应收／余额账本仍待补充。保持 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。
