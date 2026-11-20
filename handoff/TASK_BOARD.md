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
| MS-UI-002 / PC-02 | 客户列表与侧边详情优化 (PC-02) | DONE | 基于 `chatgpt/ms-ui-001-pc-01` 建立独立分支 `chatgpt/ms-ui-002-pc-02`：① `web/sales-workflow.js` 与 `web/styles.css` 实现 ≥1280px 分栏侧边详情、窄屏切换、返回保留搜索/筛选/排序与滚动位置；② 完善未保存表单导航保护：离开详情及客户间直接切换均在同员工当前会话内安全保留内存草稿（`leadDrafts`），A/B 独立互不干扰，完成卡片不存草稿，提供“放弃未保存修改”主动确认清除，禁止敏感草稿本地持久化；③ 完善 401/403/404 权限异常 fail-closed 全量敏感状态清理（清空客户、检索、认领、选项、草稿，递增 `epoch`/`seq` 拦截残留异步回调，并隐藏导航），保留 400/503/网络波动草稿保护；④ 扩展 Playwright PC-02a/PC-02b 覆盖草稿保留/放弃/直接切客户/POST 400/POST 503/POST 403/GET 403/GET 404/跨员工隔离。最新代码 `a36ba3984df6c3ae7962cc30698c2d43fa42fd46` 经 GitHub Actions [Run 44510026815](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44510026815) 验证全绿（17/17 步全部通过，含 36/36 Playwright、722/722 核心 API、12/12 LOGIN/RLS、8/8 合约）；经 ChatGPT 源码与 CI 原始日志复核通过，PC-02 开发验收 DONE（仅测试验收，不解除 HOLD） |
| MS-UI-003 / PC-03 | 客户列表紧凑列式视图与联系方式脱敏 (PC-03) | DONE | 基于 PC-02 已验收分支 `09af1155092b6e8322359c4f29e5677d4dbc32b2` 建立独立分支 `chatgpt/ms-ui-003-pc-03`：① 修复 `GET /workflow` 数据最小化：`src/sales-workflow.mjs` `listing()` 移除明文 `contact_info`，仅返回 `contact_info_masked`，并支持最小化服务端 `?q=` 过滤（严格保留组织/部门/负责人隔离）；② `src/app.mjs` 与 `src/isolated-business-workspace.mjs` 透传 `query`；③ `web/sales-workflow.js` 列表与卡片改用 `contact_info_masked`，`>=4` 位数字搜索走服务端 `?q=` 过滤且不缓存明文；④ 保留列式/卡片视图切换、结构化沟通与预约状态、非误标、状态/草稿保留与 390px 零横向溢出；⑤ 扩展 API 与 Playwright 测试断言 `GET /workflow` 响应 JSON 绝不含明文电话且跨员工 `?q=` 隔离。最新受测代码 `0eb982d7b7981b69a82aa38506bb8289a22adbf0` 经 GitHub Actions [Run 44534751901](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44534751901) 全绿通过（全部 21/21 步 `success`，含 Playwright **38/38 passed**、Core API/LOGIN-RLS/Contracts 全通过）；ChatGPT 已对受测源码、列表 JSON 数据最小化、授权边界、电话搜索和原始 CI 日志复核签收；仅为开发测试验收，不解除 HOLD、不得合并部署 |
| MS-UI-004 / PC-04 | 只读阶段看板、周日程与 Saved Views (PC-04) | DONE | 2026-11-20 最终验收通过。复核代码 `4d9cdb991510afec3ee2b0a02dc1004107233e7d`、Mac 独立数据库完整回归和 GitHub Actions [Run 44585452635](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44585452635)，两处均为核心、界面与安全 750/750，Chromium 41/41，LOGIN/RLS 12/12，合约 8/8。PC-04a/b/c 覆盖看板只读、上海时区周日程、电话号码拒存、普通含数字名称保存恢复与会话隔离。继续 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only，PC-05 验收进度见下一行 |
| MS-UI-005 / PC-05 | 手动安排下次跟进时间 | DONE | 2026-11-20 Antigravity 独立复验通过，受测提交 `52edab5b1a919c9a9c32e06e6f0bb98e715b9a1e`。三项修正均通过，Mac 空库全量与 UTC 定向回归见 TEST_RESULTS.md。保留 HOLD / Draft / CI-only。 |
| MS-BOSS-001 | PC Boss 驾驶舱 | DONE | 2026-11-21 完成本轮隔离功能验收。受测提交 `b9b24753d80278af8e1b1d08ebcadbb70068eb15` 通过 Mac 独立库全量回归和 [GitHub Actions #44777368124](https://github.com/Lizhaochuan/market-sales-system/actions/runs/44777368124)。签收包括首响与接通率、有效线索核验与归并、服务校区审批及历史筛选。真实校区目录、历史归属与主管授权映射待补充。财务确认的渠道费用和历史应收／余额账本待补充，两个财务数据源可独立接入。保持 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。 |
| MS-MINI-001 | 微信小程序现状核实与设计差异计划 | REVIEW_REQUIRED | 已全仓核实无 `miniprogram/` 工程；明确新建独立原生小程序复用既有后端、优先内存+服务端草稿安全策略、标注外部微信平台依赖并严格区分 H5 与原生真机验证；详见 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md` Phase 3，待 ChatGPT 审核 |
| MS-PLAN-001 | 综合实施顺序与分阶段验收标准修订 | REVIEW_REQUIRED | 已取消原重复 P0-A，对齐 `CORRECTED_IMPLEMENTATION_PLAN.md` 输出 Phase 1 → Phase 2 → Phase 3 → Phase 4 顺序、迁移前滚/开关回滚底线与未决业务清单；详见 `handoff/REVISED_ROADMAP_AND_ACCEPTANCE.md`，待 ChatGPT 与用户审核 |
| MS-DEV-001 | 依照审核后的计划增量开发 | BLOCKED | 阻塞条件：① 等待 ChatGPT 与用户审核通过上述修订文档；② 确认待决业务项 `PENDING-01`–`05`；③ 确认开发分支基线与写入主体；④ 始终维持 Draft / CI-only / HOLD / `EXT-001=UNVERIFIED` |

## 下一个可执行动作

PC-05 和本轮 Boss 驾驶舱隔离功能验收均已完成。Boss 的真实数据接入等权威校区映射及财务数据补齐后再逐项核对。

## 不得误报

- 本轮为纯审计与规划修订，未运行本地 PostgreSQL/Node/Chromium/小程序真机测试，不可把原 PR 历史本地测试数字写成本轮执行结果。
- 不得对原开发分支（PR #129）或 `main` 直接改动、合并、部署。
- 所有待审核任务均标为 `REVIEW_REQUIRED`，审核确认前不得标为 `DONE`。
