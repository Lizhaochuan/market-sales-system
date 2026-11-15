# 隔离工作台 8 步 UAT 修复与 AI/开发交接记录

> **用途**：本文件记录在 Draft PR #129 基线提交 `47cbfa6`（`fix: preserve workspace sessions during delayed saves and improve mobile layout`）之后，针对 8 步人工 UAT 反馈所做的代码修复、安全边界约定与自动化测试，供后续 **ChatGPT** 或其他开发者无缝接手。
>
> **状态约束（未改变）**：继续保持 `MS_STAGE=isolated-test`、`EXT-001=UNVERIFIED`、`HOLD=true`、`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`。本轮修复仅改善隔离演示工作台的真实可用性与界面衔接，不构成生产验收、不接入真实 CRM/财务。

---

## 一、基线、分支与不变红线

1. **基准提交与分支**：
   - 上游 PR #129（Draft）远程源分支为 `chatgpt/v3-2-121-m02-revocation-notices`（`HEAD` 原为 `47cbfa6`）。
   - 本轮修复工作在本地分支 `pr-129` 提交，未擅自合并、部署或覆盖生产设置。
2. **严禁破坏的架构与安全边界**：
   - **数据库迁移冻结**：不得修改 `db/migrations/001`–`038`，未创建 `039+` 新迁移；咨询备注复用了已有表列 `ms.contact_events.original_source_text`。
   - **静态契约文件保留原样**：本轮未修改 `api/openapi/*.json`。
   - **零浏览器持久化存储**：严禁使用 `localStorage` / `sessionStorage` / URL hash / cookie 存储令牌或未保存草稿（Playwright 已显式断言 `localStorage.length + sessionStorage.length === 0`）。
   - **严格员工权限模式（`MS_STRICT_STAFF_MODE=1`）完全隔离**：
     - 不得绕过受限 PostgreSQL `LOGIN` 池或回退到宽权限 SQL。
     - 严格模式下 `#event-notes-row` 与 `#demo-events-card` 隐藏且禁用，前端 `event-form` 不发送 `original_source_text`，保持 `src/scoped-legacy-write-adapter.mjs` 对未知字段 fail-closed。
   - **Student-First 原则与最小作用域**：
     - 同名家长关联到多名学生时，严禁自动生成家庭或跨销售泄露兄弟姐妹；普通销售关联学生仍保持 `pending_review`。
     - `tasks`（跟进任务）的 `student_id` 继续允许为空，保留“通用待办”能力。
   - **演示口令要求**：`src/dev-login.mjs` 与登录页均要求 `DEV_LOGIN_SECRET` 长度 `>= 32` 字符（测试与示例使用 40 字符 `fictional-strong-ui-demo-passphrase-0001`）。

---

## 二、8 步 UAT 问题逐项修复对照

| UAT 步骤 | 原反馈问题 | 实际修改内容 | 相关文件与关键符号 |
| --- | --- | --- | --- |
| **Step 1** | 学生/家长表单无手机号/微信号 | **按演示边界有意保留**：隔离演示刻意禁止采集明文手机号/微信号 PII，`createContact` 继续拒绝未允许字段，等待正式加密与授权策略立项。 | `src/app.mjs` (`createContact`)、`web/index.html` |
| **Step 2(a)** | 咨询表单缺少沟通备注，无法记录家长诉求 | 为 `POST /api/v1/contact-events` 与 `GET /api/v1/contact-events` 增加可选 `original_source_text`（trim 校验 `<= 1000` 字，超限返回 422）；前端“记录真实咨询”新增选填多行备注框及列表展示卡片 `#demo-events-card` / `#events-list`（严格员工模式禁用并隐藏）。 | `src/app.mjs` (`optionalText`, `createEvent`, `listEvents`)、`web/index.html` (`#event-notes-row`, `#events-list`)、`web/app.js` (`applyStrictLayout`, `render`, `fillOptions`) |
| **Step 2(b)** | Step 1 已关联学生，但 Step 2 转线索后仍显示“未识别具体学生”且不带出学生 | `GET /api/v1/leads` 新增 `linked_students` 与按权限严格过滤的 `contact_linked_students`（仅返回主管或本人名下/显式授权未过期的学生，绝不泄露共享家长名下其他销售的孩子）以及来源咨询备注/方式；前端在线索关联过学生后角标更新为 `已关联学生（待核实/已核实）`；当联系人仅关联 1 名有权查看的学生时自动预选并展示 `#lead-link-candidate-hint` 提示，多学生时提示手动选择，仍保留必填核实依据和 `pending_review` 状态；线索卡片提供“带入关联表单”快捷按钮。 | `src/app.mjs` (`listLeads`)、`web/index.html` (`#lead-link-candidate-hint`)、`web/app.js` (`syncLeadLinkCandidate`, `fillOptions`, `render`) |
| **Step 2(c)** | 商机页面独立，与已关联学生的线索缺少显式衔接，需手工重选学生 | 线索卡片在存在 `linked_students` 时渲染 `去建商机（<学生名>） →` 按钮，点击切换至“销售商机”并自动选中对应学生、在 `#opportunity-carry-hint` 带入原咨询备注并聚焦预计金额框；提交后清空提示。 | `web/index.html` (`#opportunity-carry-hint`)、`web/app.js` (`openOpportunityForStudent`, `render`, `opportunity-form`) |
| **Step 3** | 跟进任务默认时间为“当前时间”，新建后立刻算作逾期 | `defaultAtFor('tasks')` 改为默认次日 `10:00`（尊重 `atDirty` 与编辑状态），使新建任务默认不计入逾期；保持 `student_id` 可选，新增 `#business-task-scope-hint`（`updateTaskHint`）提示通用待办或已关联学生/商机；记录卡片增加 `[业务类型] · 学生名` 展示，学生与商机下拉实现双向联动。 | `web/business-workspace.js` (`defaultAtFor`, `updateTaskHint`, `syncOpportunityOptions`, `describe`) |
| **Step 4** | 试听只改日期会静默保留当前时间；怀疑未按保存即入库；缺乏不排课二次说明 | `defaultAtFor('trials')` 默认次日 `10:00`，新增说明与 4 个快捷时段按钮 `#business-trial-presets`（上午 10:00 / 下午 14:00 / 下午 16:00 / 晚上 19:00），点击仅修改时间部分并保留日期；经排查，后台仅 `business-form` 的 `submit` 会 POST `trials`，轮询 `scan()` 仅调 `POST .../automation/run` 并在 `forceRefresh \|\| result.created > 0` 时刷新，不会隐式创建试听。 | `web/business-workspace.js` (`defaultAtFor`, `fields`, `[data-trial-time]`, `scan`)、`web/styles.css` |
| **Step 5(a)** | 多课程报价第 1 门单价叫“计划金额”且排在第 2 门下方，极易填反 | 将第 1 门课程（课程名、数量、单价）调整至 `#business-extra-lines` 上方；动态文案与 `renumberExtraLines()` 明确区分 `第 1 门课程 · 拟选课程/拟购数量/拟议单价（元）` 与 `第 2/N 门课程明细`；新增整数分实时合计预览 `#business-quote-preview`（`updateQuotePreview`）。 | `web/business-workspace.js` (`fields`, `extraLine`, `renumberExtraLines`, `updateQuotePreview`)、`web/styles.css` |
| **Step 5(b)** | 30 分钟演示登录到期无提示，提交时被踢回登录页导致未保存草稿丢失 | 顶栏新增 JWT `exp` 倒计时徽标 `#session-countdown`（剩余 5 分钟/1 分钟发出提示）；任意 API 返回 401 时调用 `logout('expired')`，仅向 JS **内存** `state.expiredDraft` 暂存主表单与 `business-form` 草稿并显示 `#session-expired-notice`；仅当**同一 `staffId` 且相同 `strict` 模式**重新登录后通过 `restoreExpiredDraft` / `__restoreBusinessDraft` 自动恢复并回到原视图；切换其他员工或主动退出则立即丢弃。 | `web/index.html` (`#session-expired-notice`, `#session-countdown`)、`web/app.js` (`parseTokenExp`, `startSessionCountdown`, `updateSessionCountdown`, `snapshotMainForms`, `restoreExpiredDraft`, `logout`, `api`)、`web/business-workspace.js` (`snapshotDraft`, `restoreDraft`) |
| **Step 6** | 基于最新报价生成报名意向 | 已直接受益于 Step 5 清晰的课程标签、实时分计算与报价快照版本号选择，原核心功能无变更且通过回归。 | `web/business-workspace.js` |
| **Step 7** | 切换销售顾问 B 后，“记录真实咨询”发生时间残留为 A 刚才的时间（如 `17:21`） | `setDefaultDate()` 增加 `if(!state.token)return;` 并跳过 `#business-form` / `#campaign-workbench`，移除未登录预填充；`logout()` 遍历重置全部 `#workspace form` 并显式清空所有 `datetime-local` 值与联动提示，确保另一位顾问登录时获得当前时间而非上一位用户的遗留时间。 | `web/app.js` (`setDefaultDate`, `logout`) |
| **Step 8** | 侧边栏“学生共享与转交审批”死链指向未启动的 `127.0.0.1:3300/app`；窄屏样式适配 | 移除指向 `127.0.0.1:3300/app` 的 `<a href>` 死链，替换为可展开说明按钮 `<button id="student-access-entry">` 与 `#student-access-note`，告知需另行启动严格模式 `student-access-server`；在 `web/styles.css` 补充 780px 窄屏规则（`.topbar-actions`、`.session-pill`、`.record`、`.record-side`、`.record-actions`、`#student-access-entry`），确保 390px 视口无横向滚动条。 | `web/index.html` (`#student-access-entry`, `#student-access-note`)、`web/app.js`、`web/styles.css` |

---

## 三、新增与更新的测试覆盖

1. **HTTP / 安全权限回归**：[tests/ui/admin-ui.http.test.mjs](file:///home/antigravity/Lizhaochuan/market-sales-system/tests/ui/admin-ui.http.test.mjs)
   - 验证 `original_source_text` 超过 1000 字符返回 `422`；验证空白修剪、存储和列表读取。
   - 验证 `GET /api/v1/leads` 返回来源备注与方式、未关联前 `linked_students === []`、单学生待核实候选 `contact_linked_students` 仅返回本员工有权查看的学生（同家长关联了销售 B 的学生时，**绝不**出现在销售 A 的线索响应中）。
2. **真实 Chromium 浏览器 E2E**：[tests/browser/isolated-workspace.spec.mjs](file:///home/antigravity/Lizhaochuan/market-sales-system/tests/browser/isolated-workspace.spec.mjs)
   - 用例 `UAT fixes: Step 2 notes/carryover/jump, Step 3 future default, Step 4 presets, Step 5 quote order & Step 8 toggle`：完整串联 Step 1–5、Step 8 说明展开按钮、报价第 1 门位置在 `#business-extra-lines` 上方的 `boundingBox().y` 检查、以及 `390x844` 窄屏零横向溢出检查。
   - 用例 `Step 5 & Step 7: switching consultants clears consultation time; 401 expiry restores draft only for same employee in memory`：验证切换顾问 B 不继承 A 的 `17:21` 咨询时间；拦截保存返回 401 后验证 `localStorage.length + sessionStorage.length === 0`，同账号 A 重登自动恢复草稿及总额预览并成功保存，另一次过期草稿在切换为顾问 B 时被清空且绝不恢复给 B。
   - 编写提醒：侧边栏导航按钮含状态字形（如 `◉学生客户`），定位建议使用 `nav button[data-view="..."]` 或 `exact: false`。

---

## 四、给后续 ChatGPT 会话的待办建议（未擅自越界改动）

1. **真实联系方式采集策略（如推进到下一正式阶段）**：当前 `contacts` 不接收电话/微信。若后续经安全评审需接入，需新增正式加密字段迁移、脱敏/查看授权与严格员工数据库视图，不要直接改旧 001–038 迁移。
2. **OpenAPI 契约与旧文档同步（如需对外对齐规范）**：若后续决定更新已实现规范快照，可在专门的契约 PR 中将 `POST/GET /api/v1/contact-events` 的 `original_source_text` 与 `GET /api/v1/leads` 的增量字段补入 `api/openapi/admin-ui-implemented.v3.2.json` 与 `api/openapi/core-implemented.v3.2.json` 并说明严格模式除外策略。
3. **严格模式下的备注与工作台能力（如后续立项）**：目前计划/报价/意向及咨询备注仅面向隔离演示模式；如要在 `MS_STRICT_STAFF_MODE=1` 启用，需配套新的低权限 PostgreSQL 函数、`SECURITY DEFINER` 权限审查与严格安全测试。
4. **本地双服务联启（可选）**：如需演示页面同时打开 `student-access-server`（3300 端口），可在后续启动脚本中同时拉起两个服务并提供独立测试凭据，无需修改 `server.mjs` 核心安全边界。
