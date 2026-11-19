# 60 项功能差异重审矩阵（基于 PR #129 最新代码 `fda4ceb`）| REAUDITED_GAP_MATRIX_60_ITEMS

复核日期：2026-11-19 ｜ 审计基线：[`chatgpt/v3-2-121-m02-revocation-notices`](https://github.com/Lizhaochuan/market-sales-system/tree/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74) @ `fda4ceb8063248caed0a5f55f7c69d17fbaa8e74`

> **纠错声明**：原 60 项矩阵基于滞后 19 次提交的旧快照 `38eb169` 生成，错误地将 PR #129 已完成并经测试覆盖的 V3.4 防断链状态机、独立面谈/试听预约、角色待办工作台、协议+首款报名标准 B 等判为“未开发”或“存在冲突”。本文件逐项对照 `fda4ceb` 真实源码与迁移 `039`/`040` 完成重审，**剔除所有已完成的重复开发项**，保留并修正真正需要新增或优化的功能。

---

## 一、重审统计总览（旧基线 `38eb169` vs 真实基线 `fda4ceb`）

状态标签定义：
- `已完成且符合要求（剔除，无需重复开发）`
- `已完成底座，增量优化`
- `真正尚未开发（纳入新增规划）`
- `已确认规则冲突已消除 / 修正原规划错误`
- `待业务拍板决策（不可擅自假设）`

| 模块分域 | 合计 | 已完成且符合要求（**已剔除**） | 已完成底座，增量优化 | 真正尚未开发（新增） | 待业务决策 |
|---|:---:|:---:|:---:|:---:|:---:|
| **A. PC 端销售工作台（A-01 ~ A-20）** | 20 | **13** | 3 | 2 | 2 |
| **B. PC 端 Boss 经营驾驶舱（B-01 ~ B-12）** | 12 | **1** | 3 | 6 | 2 |
| **C. 微信小程序：销售顾问端（C-01 ~ C-09）** | 9 | **0** | 0 | 8 | 1 |
| **D. 微信小程序：Boss 管理端（D-01 ~ D-08）** | 8 | **0** | 0 | 7 | 1 |
| **E. 双端共用数据、状态机与权限（E-01 ~ E-11）** | 11 | **6** | 3 | 1 | 1 |
| **总计** | **60** | **20 项剔除** | **9 项优化** | **24 项新增** | **7 项待决策** |

### 重大剔除清单（原规划 P0-A 及重复后端建设全部取消）
以下能力已在 PR #129 (`fda4ceb`) 中落地且有 PostgreSQL + HTTP + Chromium 自动化测试，**严禁重建第二套表、第二套状态机或重用 `039`/`040` 编号**：
- **防断链核心与数据库延迟约束**（原 A-11, A-12, E-05）：已由 `db/workspace-migrations/039_v34_sales_loop.sql`（`valid_open_chain` / `retained_open_chain` / `assert_active_chain`）与 `src/sales-workflow.mjs`（L113–170）完整实现。
- **独立线下面谈与试听预约、改期、取消、爽约、主动到访**（原 A-13, A-14, A-15, E-06）：已由 `src/sales-workflow.mjs`（L134–170, L269–274）实现，且最新提交 `0b60319` 已确认线下面谈免填地点、试听使用 CRM 兼容教室名称字段（`options.classrooms` / `classroomField`）。
- **报名成功标准 B 与正式 Closed Won 严格分离**（原 A-19, B-05 部分）：已由 `src/sales-workflow.mjs`（L62, L186–220）严格落地——**标准 B = 主管独立核实协议 (`agreement_confirmed`) + 核款员独立核实有效正额净收 (`net_cents > 0`)**；**正式 Closed Won = 全部有效订单全额净收 (`balance_cents === 0`) + 无未决款项/纠正 + 写入唯一 `ms.sale_events`**。原 `DEC-01` 把 `order-intents` 当标准 B 的建议已作废。
- **按角色隔离工作台、我的待办（日期+实际逾期）、电话查重与市场交接、并发锁与幂等、单卡片草稿与内存恢复**（原 A-05 部分, A-06 部分, A-20, E-02, E-03, E-04 部分）：已由 `040_role_workspaces.sql`、`src/role-workspaces.mjs`、`web/sales-workflow.js` 完整落地。

---

## 二、A. PC 端销售工作台（A-01 ~ A-20）逐项重审

| 编号 | 功能项 | 旧状态 (`38eb169`) | 真实状态 (`fda4ceb`) | `fda4ceb` 源码/迁移/测试证据 | 处置结论 |
|---|---|---|---|---|---|
| **A-01** | 学生优先建档（Student-First）与多学生同家庭显式新增 | 已完成且符合要求 | **已完成且符合要求** | [`src/sales-workflow.mjs#L27-L35`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L27-L35)、[`web/sales-workflow.js#L57`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L57) | **剔除**（保留既有实现，支持同家庭新增学生，绝不按电话自动合并） |
| **A-02** | 家庭关系按需核验后绑定 | 已完成且符合要求 | **已完成且符合要求** | `db/migrations/001_initial_schema.sql`、[`docs/V3.4_SALES_WORKFLOW.md#L14`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/docs/V3.4_SALES_WORKFLOW.md#L14) | **剔除** |
| **A-03** | 电话查重、市场→销售免重输交接、自动维护商机 | 已完成且符合要求 | **已完成且符合要求** | [`db/workspace-migrations/040_role_workspaces.sql`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/db/workspace-migrations/040_role_workspaces.sql)、[`src/role-workspaces.mjs#L42-L72`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/role-workspaces.mjs#L42-L72)（`POST /workflow/lookup`, `POST /workflow/{id}/claim`） | **剔除**（已完成并由 `tests/core/role-workspaces.test.mjs` 覆盖） |
| **A-04** | 多课程报价、本地标准价目、优惠独立审批与报名订单 | 已完成且符合要求 | **已完成且符合要求** | [`src/sales-workflow.mjs#L68`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L68)、[`#L171-L194`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L171-L194)（含标准价防伪造与优惠审批/驳回闭环） | **剔除** |
| **A-05** | 家长电话录入、标准化查重与敏感联系方式权限控制 | 已完成但需要优化 | **已完成且符合要求**（列表脱敏展示可按需微调） | [`src/role-workspaces.mjs#L15-L26`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/role-workspaces.mjs#L15-L26)、[`src/sales-workflow.mjs#L107`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L107)（隔离目录 `lead_directory` 存标准化电话，不修改旧 `contacts` 表；列表/查重已做角色裁剪） | **剔除主体**（保留隔离目录结构；仅在 PC 列表卡片增加默认掩码显示与明确查看/复制边界） |
| **A-06** | 今日待办与逾期任务工作台 (`P01`) | 尚未开发 | **已完成底座，增量优化** | [`web/sales-workflow.js#L174-L184`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L174-L184) 已实现“我的待办”首页（选定日期待办 + 独立“逾期未完成” + 主管团队切换 + 待独立复核审批 + 待接手转交 + 待补安排） | **保留底座增量优化**：不重建待办页；增加“今日待联系 / 逾期 / 今日面谈试听 / 待审批或异常”快捷过滤胶囊与逾期时长标签，遵守“不展示未来第三栏”的已验收简化原则 |
| **A-07** | 客户列表信息层级与筛选增强 (`P02 Table`) | 已完成但需要优化 | **已完成底座，增量优化** | [`web/sales-workflow.js#L189-L192`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L189-L192) 已有“我的客户列表 / 销售客户列表”搜索（姓名/学生/电话）与状态筛选（全部/跟进中/已全款结案/已流失结案/待补安排） | **增量优化**：在不破坏现有电话查询主流程的前提下，为客户列表补充紧凑列式视图切换（展示阶段、来源、最近联系结果、面谈/试听状态、下一步动作与逾期标识），遵守角色数据隔离 |
| **A-08** | 只读阶段看板 (`Kanban`) 与日程日历 (`Calendar`) 视图 | 尚未开发 | **真正尚未开发** | `web/sales-workflow.js` 当前为纵向卡片列表 + 单日日期选择器 | **新增（只读投影视图）**：基于当前 `GET /workflow` 与权限过滤提供只读看板/周历视图；**严禁看板拖拽直接写入已到访/已试听/已报名/已收款事实**，任何变更必须走既定卡片与 API 校验 |
| **A-09** | Saved Views（常用筛选视图保存） | 尚未开发 | **真正尚未开发** | 仓库无保存视图存储或 UI | **新增（低优先级 P1）**：支持在当前授权数据范围内保存常用筛选条件（不绕过部门/机构隔离） |
| **A-10** | 列表上下文保留与侧边详情体验 (`P03` 优化) | 尚未开发 | **已完成底座，增量优化** | [`web/sales-workflow.js#L152-L173`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L152-L173) 已实现“单一客户概览 + 一次只展开一张操作卡片 + 返回我的待办/客户概览” | **增量优化**：保留单项操作卡片避免表单拥挤；在宽屏桌面端（`>=1280px`）支持从待办/客户列表打开侧边详情抽屉或分栏预览，关闭后不丢原列表筛选与滚动位置，并完整保留未保存草稿保护 |
| **A-11** | 快速记录联系结果 + 下一步任务同事务原子提交 | 与已确认规则冲突 | **已完成且符合要求** | [`src/sales-workflow.mjs#L113-L148`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L113-L148)、[`db/workspace-migrations/039_v34_sales_loop.sql#L22-L47`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/db/workspace-migrations/039_v34_sales_loop.sql#L22-L47) | **剔除**（已落地且有 DB 提交时延迟触发器 + 故障回滚测试） |
| **A-12** | 未接通、待回复、换方式、暂缓 (`paused`)、拒绝邀约不断链 | 已完成但需要优化 | **已完成且符合要求** | [`src/sales-workflow.mjs#L8-L11`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L8-L11)、[`#L115-L144`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L115-L144)、[`tests/core/v34-sales-workflow.test.mjs`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/tests/core/v34-sales-workflow.test.mjs)（TC01–TC14） | **剔除**（前端可在既有日期快捷按钮 `明天/三天后/一周后` 基础上按需补充 `+2h/+4h` 预设，不改状态机） |
| **A-13** | 线下面谈预约、确认、到访完成、主动到访、爽约、取消与改期 | 尚未开发 | **已完成且符合要求** | [`src/sales-workflow.mjs#L126-L169`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L126-L169)、[`#L269-L274`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L269-L274)（且 `0b60319` 已按用户要求实现线下面谈免填地点） | **剔除**（严禁新建平行 `VisitAppointment` 表或恢复已被移除的面谈地点输入框） |
| **A-14** | 试听课独立选定日期、CRM 兼容教室字段、到场反馈与改期历史 | 与已确认规则冲突 | **已完成且符合要求** | [`src/sales-workflow.mjs#L67`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L67)（`classrooms:[]`）、[`#L149-L170`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L149-L170)、[`web/sales-workflow.js#L56`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L56)（`classroomField`） | **剔除**（不依赖旧 CRM，已支持独立改期、反馈、历史版本及 CRM 教室下拉预留） |
| **A-15** | 非线性销售路径（跳过面谈直约试听、多次试听不回退阶段、跳过试听直做方案/报名） | 已完成但需要优化 | **已完成且符合要求** | [`src/sales-workflow.mjs#L51-L60`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L51-L60)（`advanceTrialStage` 防倒退）、[`#L149-L194`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L149-L194) | **剔除** |
| **A-16** | 公海池入池规则、原因分类与自动回收保护 | 尚未开发 | **待业务决策** | 当前仅有“市场→销售电话交接”（`lead_directory`）与“双主管审批+接收人确认转交”（`request-transfer/approve-transfer/accept-transfer`），二者均非公海池 | **保留为 Phase 4 专项**：须业务先确认是否启用公海及自动回收/保护规则，严禁未批先做自动回收 |
| **A-17** | 公海值班负责人 (`pool_duty_owner`) 与认领/改派原期限保留 | 尚未开发 | **待业务决策** | 同 A-16；现有 Lead 转交在 [`src/sales-workflow.mjs#L232-L247`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L232-L247) 中接手前由原负责人保持任务，接手后原子继承并保留原到期时间 | **保留为 Phase 4 专项**：与主管审批边界一并拍板，绝不绕过现有转交审批机制 |
| **A-18** | 主管配置中心（价目维护 + 审批提醒 + 渠道维护） | 已完成但需要优化 | **已完成且符合要求**（字典软停用/公海参数待 Phase 4 按需补充） | 本地标准价目维护 [`src/sales-workflow.mjs#L68`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L68)；待审批提醒 [`#L341-L345`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L341-L345)；M01 渠道审批已有严格员工独立模块 | **剔除主体**（后续仅在 Phase 4 审定公海策略后补充公海参数配置） |
| **A-19** | 报名成功标准 B 与正式 Closed Won 在工作台的区分操作 | 需要业务确认 | **已完成且符合要求（原 `DEC-01` 建议已纠错撤销）** | [`src/sales-workflow.mjs#L62`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L62)（标准 B = 协议核实 + 正额已核实净收）、[`#L195-L220`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L195-L220)（全款核实后方可 `close-won`）、[`web/sales-workflow.js#L165`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L165) | **剔除**（已确认规则不可改写；严禁把意向单当标准 B） |
| **A-20** | 防重复提交、并发乐观锁 (`expected_version`) 与草稿保护 | 已完成但需要优化 | **已完成且符合要求** | [`src/sales-workflow.mjs#L89`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L89)（`FOR UPDATE` 锁）、[`#L105`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L105)（`VERSION_CONFLICT`）、[`#L109-L111`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L109-L111)（服务端草稿）、[`web/sales-workflow.js#L218-L221`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L218-L221)（同员工内存草稿，不写 localStorage） | **剔除** |

---

## 三、B. PC 端 Boss 经营驾驶舱（B-01 ~ B-12）逐项重审

> **关键发现**：`fda4ceb` 已有 [`GET /api/v1/isolated-workspace/workflow/metrics`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L315-L349)（输出 30+ 项全量当前统计计数、按负责人过程表、流失原因统计与到期/逾期提醒），但**缺少时间区间筛选、队列/时期双口径、点击数字证据化下钻、时态历史快照与合规督办闭环**。因此 Boss 端应**基于并扩展 `/workflow/metrics` 与真实账本**，绝不另建平行指标事实源。

| 编号 | 功能项 | 旧状态 (`38eb169`) | 真实状态 (`fda4ceb`) | `fda4ceb` 源码证据 | 处置结论 |
|---|---|---|---|---|---|
| **B-01** | 驾驶舱全局筛选栏（时间窗口、校区/机构、渠道、负责人、时态快照 `as_of_at`） | 尚未开发 | **真正尚未开发** | [`src/sales-workflow.mjs#L315`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L315) 当前 `metrics()` 无时间区间与筛选参数 | **新增（Phase 2）**：扩展 `/workflow/metrics` 参数；`as_of_at` 必须基于事件/历史版本表 (`audit_events` / `ms_workspace.history` / 账本 `verified_at`) 重建，不能仅用 `created_at <= as_of_at` |
| **B-02** | 流量与建联指标（新增 Lead、有效率、首响 P50/P90、24h 接通率） | 尚未开发 | **真正尚未开发** | `metrics()` 目前返回累计 `leads / contacted_students / failed_attempts / waiting_leads`，尚无时间窗内新增、首响时长与 24h 接通率 | **新增（Phase 2）**：在扩展指标契约中补齐（营业时间首响 SLA 口径待业务拍板） |
| **B-03** | 跟进纪律与异常监控（逾期、断链/待补安排、连续失败、14天未更新、预约到期未确认） | 已完成但需要优化 | **已完成底座，增量优化** | [`src/sales-workflow.mjs#L337-L338`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L337-L338) 已计算 `due_today / completed_today / overdue / missing_next / unassigned_leads / continuous_failed_leads / stale_open_leads / paused_leads / appointment_result_due` | **增量优化（Phase 2）**：复用上述真实字段，按“异常优先级卡片 + 点击下钻到具体学生清单”重构视觉与交互 |
| **B-04** | 线下面谈与试听转化指标（区分主动到访与预约到访、试听完成率、面谈/试听后报名转化） | 尚未开发 | **已完成底座，增量优化** | [`src/sales-workflow.mjs#L332-L340`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L332-L340) 已实现学生去重口径的 `invited / agreed / confirmed / scheduled_meeting_attended / walk_in_meeting / trial_booked / trial_completed / meeting_to_enrollment / trial_to_enrollment`（含“完成时间不晚于首次报名成功时间”校验） | **增量优化（Phase 2）**：保留既有严谨逻辑，补齐“改期/爽约挽回率”及时间区间切片、点击下钻 |
| **B-05** | 双口径成单指标（`M15` 标准 B vs `M14` 正式 Closed Won）与净收/未结清/转化周期 | 尚未开发 | **已完成底座，增量优化** | [`src/sales-workflow.mjs#L335-L336`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L335-L336) 已严格分开 `enrollment_success_students / enrollment_success_orders / settled_orders / received_cents / unsettled_cents / won_leads / lost_leads` | **增量优化（Phase 2）**：严格锁定 `M15 = 标准 B（协议已独立核实 + 正额净收已核实）`、`M14 = 正式 Closed Won`，补齐转化周期 P50 与时间窗口切片 |
| **B-06** | 队列里程碑漏斗（Cohort）vs 当期发生量（Event）双视图与非线性分支展示 | 尚未开发 | **真正尚未开发** | [`web/sales-workflow.js#L145-L150`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/web/sales-workflow.js#L145-L150) 当前仅平铺静态统计数字 | **新增（Phase 2）**：明确区分 Lead 去重、学生去重（未知学生单列）与活动次数；非线性路径不强行宣称严格阶梯嵌套，显式列示直达分支 |
| **B-07** | 渠道质量分析与可选 CPL / CAC 成本核算 | 需要业务确认 | **待业务决策**（渠道转化率可先做，成本待业务拍板） | M01 渠道与 M02 活动费用草稿有独立安全契约，真实投放成本来源未核准 | **分步**：Phase 2 先做按来源/渠道的转化质量对比；真实费用/CPL/CAC 须待成本源与归属口径拍板，无真实证据时固定显示“待配置成本源” |
| **B-08** | 销售顾问执行力与过程对比表 | 尚未开发 | **已完成且符合要求（底座已齐，随下钻增强）** | [`src/sales-workflow.mjs#L346`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L346) 已实现 `by_owner`（leads/open/won/lost/overdue/missing_next/completed_communications/enrollment_success_orders/verified_net_cents） | **剔除重复统计逻辑**（Phase 2 仅将其升级为表格化展示并支持点击数字下钻，明示为“过程分析而非多人提成结算表”） |
| **B-09** | 公海池流转健康度 (`M22`) | 尚未开发 | **待业务决策**（依赖 Phase 4 公海模块） | 无公海池数据表 | **后置至 Phase 4**：在公海策略拍板后再建设，不将市场交接统计误称为公海池 |
| **B-10** | 战败原因 (Closed Lost) 结构化归因与下钻 | 尚未开发 | **真正尚未开发**（后端计数已有，前端图表与下钻未建） | [`src/sales-workflow.mjs#L340`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L340) 已有 `lost_reasons` 聚合计数 | **新增（Phase 2）**：在既有 `lost_reasons` 上增加占比可视化与点击下钻至对应流失 Lead 证据列表 |
| **B-11** | 全指标统一证据化下钻协议（同 SQL 口径 + 每次请求重校验权限） | 尚未开发 | **真正尚未开发** | 无 `/workflow/metrics/drilldown` 接口与明细抽屉 | **新增（Phase 2 核心）**：汇总与下钻共用过滤函数与授权范围裁剪，且每次下钻请求实时重查角色与撤销状态 |
| **B-12** | 异常预警与合规管理督办闭环 (`ManagementAction`) | 需要业务确认 | **真正尚未开发**（需修正原“一键改派/任意跟进自动销项”违规设计） | 无督办表；现有转交必须走双主管复核+接收人确认 | **新增（Phase 2）**：督办动作严格遵守部门权限与转交审批流（发起转交申请而非绕过审批一键改派）；督办销项须校验匹配督办要求的业务证据，不可由任意普通跟进自动销项 |

---

## 四、C. 微信小程序：销售顾问端（C-01 ~ C-09）逐项重审

> **全仓核实**：已扫描 `fda4ceb` 全仓库目录，**不存在 `miniprogram/`、`app.json`、`project.config.json` 或任何微信小程序工程**。小程序为纯粹的**真正新增模块（Phase 3）**，但**后端工作流/防断链/面谈试听/报价报名 API 全部直接复用 V3.4 `src/sales-workflow.mjs` 与 `src/role-workspaces.mjs`，不重建第二套后端或数据库**。

| 编号 | 功能项 | 旧状态 | 真实状态 (`fda4ceb`) | 证据与实施约束 | 处置结论 |
|---|---|---|---|---|---|
| **C-01** | 独立 `miniprogram/` 原生工程与员工身份绑定鉴权 | 尚未开发 | **真正尚未开发** | 全仓无小程序工程；须走审查后的最小权限员工身份绑定（外部微信登录/AppID/合法域名属外部阻塞依赖） | **新增（Phase 3）** |
| **C-02** | 顾问移动工作台 (`MS-01`)：选定日期待办 + 实际逾期 + 督办提醒 | 尚未开发 | **真正尚未开发** | 复用 `GET /workflow` 与 `GET /workflow/metrics`；保持“选定日期 + 实际逾期”口径一致 | **新增（Phase 3）** |
| **C-03** | 移动电话查重、市场线索接收与我的客户列表 (`MS-02`) | 尚未开发 | **真正尚未开发** | 复用 `POST /workflow/lookup`、`POST /workflow/{id}/claim` 与 `GET /workflow`；单列卡片无横向表格 | **新增（Phase 3）** |
| **C-04** | 学生概览与历史时间轴 (`MS-03`)：脱敏展示与权限审计 | 尚未开发 | **真正尚未开发** | 复用 `GET /workflow/{id}` 与 `/history`；严格遵守无权不展示、禁联提示与脱敏要求 | **新增（Phase 3）** |
| **C-05** | 单屏跟进与下一步联动表单 (`MS-04`) 与草稿安全设计 | 尚未开发 | **真正尚未开发** | 复用 `POST /workflow/{id}/followup` 与服务端草稿 `POST /workflow/{id}/draft`；**草稿优先内存与服务端受控草稿**，若需 `wx.setStorageSync` 须单独安全审批且禁存明文 PII/密钥 | **新增（Phase 3）** |
| **C-06** | 移动面谈/试听预约、签到/结果与改期弹层 (`MS-05`) | 尚未开发 | **真正尚未开发** | 复用 `POST /workflow/{id}/appointment` 与 `/activity`；同步落实“面谈免填地点、试听教室下拉预留”及“时间到达不自动完成” | **新增（Phase 3）** |
| **C-07** | 移动日程视图与待接手转交 (`MS-06`) | 尚未开发 | **真正尚未开发** | 复用 `GET /workflow`（`incoming` 待接手）与日程投影；**公海抢单暂不纳入 Phase 3**，待 Phase 4 策略批准后再接 | **新增（Phase 3，公海部分后置 Phase 4）** |
| **C-08** | 移动极简电话查重后新建线索（含市场录入角色分流） | 尚未开发 | **真正尚未开发** | 复用 `POST /workflow` 与 `POST /workflow/market`，遵守“先查重、不绕过候选、不按电话自动合并学生” | **新增（Phase 3）** |
| **C-09** | 微信订阅消息 / 外部提醒能力 | 需要业务确认 | **待业务决策** | 依赖真实微信 AppID、企业主体与模板审核；未批准前只做端内持久待办与红点提醒，不宣称后台外发推送 | **待外部微信平台与业务决策** |

---

## 五、D. 微信小程序：Boss 管理端（D-01 ~ D-08）逐项重审

| 编号 | 功能项 | 旧状态 | 真实状态 (`fda4ceb`) | 证据与实施约束 | 处置结论 |
|---|---|---|---|---|---|
| **D-01** | Boss 移动经营总览 (`MB-01`)：核心 KPI 与异常预警 | 尚未开发 | **真正尚未开发** | 复用 Phase 2 扩展后的 `/workflow/metrics`；严禁把意向单当标准 B | **新增（Phase 3，依赖 Phase 2 API）** |
| **D-02** | 移动端双口径折叠漏斗（Cohort/Event 与非线性说明） | 尚未开发 | **真正尚未开发** | 同 D-01，水平进度条展示，明确去重主体粒度 | **新增（Phase 3）** |
| **D-03** | 移动渠道与顾问横向分析 (`MB-02`) | 尚未开发 | **真正尚未开发** | 复用 `by_owner` / 渠道指标 / `lost_reasons` | **新增（Phase 3）** |
| **D-04** | 移动指标与异常下钻列表 (`MB-03`) | 尚未开发 | **真正尚未开发** | 复用 Phase 2 `/workflow/metrics/drilldown`，强制汇总与下钻权限/口径一致 | **新增（Phase 3）** |
| **D-05** | Boss 只读学生跟进审计详情 (`MB-04`) | 尚未开发 | **真正尚未开发** | 复用 `GET /workflow/{id}` 与 `/history`，遵守跨部门隔离（仅总管理者可跨看市场与销售） | **新增（Phase 3）** |
| **D-06** | 合规督办与审批入口 (`MB-05`) | 尚未开发 | **真正尚未开发** | 发起合规督办或进入既有独立审批（优惠/协议/转交/纠正），**严禁绕过双主管复核与接收人确认一键改派** | **新增（Phase 3）** |
| **D-07** | 督办追踪与证据化闭环 (`MB-06`) | 尚未开发 | **真正尚未开发** | 督办完结须校验匹配证据，不可被任意无关跟进自动销项 | **新增（Phase 3）** |
| **D-08** | 角色视角切换（总管理者 / 销售主管 / 市场主管数据裁剪） | 需要业务确认 | **待业务决策** | 后端 `workspaceAccess` 已明确定义 5 类角色隔离边界；移动端“主管切换管理视角 vs 本人待办”默认落点待 UI 复核确认 | **Phase 3 随权限矩阵确认** |

---

## 六、E. PC 与小程序共用数据、状态机与权限逻辑（E-01 ~ E-11）逐项重审

| 编号 | 共用能力域 | 旧状态 | 真实状态 (`fda4ceb`) | `fda4ceb` 源码证据 | 处置结论 |
|---|---|---|---|---|---|
| **E-01** | 学生主实体与家庭核验隔离模型 | 已完成且符合要求 | **已完成且符合要求** | `db/migrations/001_initial_schema.sql`、`src/sales-workflow.mjs#L27-L35` | **剔除** |
| **E-02** | 服务端员工鉴权、部门隔离与撤权实时重校验 | 已完成且符合要求 | **已完成且符合要求** | [`src/role-workspaces.mjs#L4-L14`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/role-workspaces.mjs#L4-L14)、[`src/sales-workflow.mjs#L90-L93`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L90-L93) | **剔除**（新接口须严格复用） |
| **E-03** | 全量审计日志 (`ms.audit_events`) 与不可变版本历史 (`ms_workspace.history`) | 已完成且符合要求 | **已完成且符合要求** | [`src/sales-workflow.mjs#L20-L25`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L20-L25)、[`#L96-L100`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L96-L100) | **剔除**（小程序接入时在审计元数据补充 `client_channel` 即可） |
| **E-04** | 主表 (`ms.*`) 与隔离工作区 (`ms_workspace.*`) 统一衔接 | 已完成但需要优化 | **已完成且符合要求** | `039_v34_sales_loop.sql` 与 `040_role_workspaces.sql` 已通过 `lead_id` 外键将工作流、预约、订单、收退款账本完整衔接，并禁止旧通用编辑入口绕过链条 | **剔除** |
| **E-05** | 防断链状态机不变量与 DB 提交时延迟约束 | 与已确认规则冲突 | **已完成且符合要求** | [`db/workspace-migrations/039_v34_sales_loop.sql#L22-L47`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/db/workspace-migrations/039_v34_sales_loop.sql#L22-L47)、[`src/sales-workflow.mjs#L44-L48`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L44-L48) | **剔除** |
| **E-06** | 面谈与试听独立预约事件流、改期历史与结果核销 | 尚未开发 | **已完成且符合要求** | [`src/sales-workflow.mjs#L149-L170`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L149-L170)、[`#L269-L274`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L269-L274) | **剔除** |
| **E-07** | 公海池状态机与策略参数迁移 (`041+`) | 尚未开发 | **待业务决策** | 不得重用 `039`/`040`，不得覆盖现有转交与市场交接语义 | **后置至 Phase 4（经策略审批后独立迁移）** |
| **E-08** | 逾期与旧缺口提醒/异常监测机制 | 尚未开发 | **已完成底座，增量优化** | [`src/sales-workflow.mjs#L337-L347`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/src/sales-workflow.mjs#L337-L347) 已基于持久 `due_at` 实时计算逾期、`missing_next`、`stale_open_leads`、`appointment_result_due`，页面在线每分钟刷新 | **增量优化（Phase 2）**：扩展首响超时与会后 24h 未跟进等只读异常查询，不自动改业务事实或自动结案 |
| **E-09** | Boss 指标聚合、时态快照与证据化下钻统一引擎 | 尚未开发 | **真正尚未开发**（基于既有 `metrics()` 增量扩展） | 现有 `metrics()` 无时间窗/下钻/督办 | **新增（Phase 2）**：PC 与小程序 100% 共用同一扩展接口 |
| **E-10** | 敏感联系方式分级展示与查看审计 | 已完成但需要优化 | **已完成底座，增量优化** | [`docs/V3.4_SALES_WORKFLOW.md#L83`](https://github.com/Lizhaochuan/market-sales-system/blob/fda4ceb8063248caed0a5f55f7c69d17fbaa8e74/docs/V3.4_SALES_WORKFLOW.md#L83) 约定敏感联系方式仅在已授权客户详情展示，不进入普通队列/报表 | **增量优化（Phase 1 & 3）**：在 PC/小程序列表层强化掩码展示，详情查看/复制写审计事件 |
| **E-11** | 跨端共享枚举、时区 (`Asia/Shanghai`)、幂等与乐观锁契约 | 需要业务确认 | **已完成底座，增量优化** | `Asia/Shanghai` 自然日、`expected_version`、`Idempotency-Key` 已在 `src/sales-workflow.mjs` 落地 | **增量优化（Phase 2 & 3）**：抽离只读共享契约给小程序复用；营业时间窗口待业务确认 |
