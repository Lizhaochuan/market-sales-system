# Argon 七份规划文档独立复核（2026-11-19）

**状态：REVIEW_REQUIRED — 不得直接执行原 `IMPLEMENTATION_ROADMAP.md` 的 P0-A。**

## 输入范围
用户交付的七份文件：`AUDIT_CURRENT_SYSTEM.md`、`FEATURE_GAP_MATRIX.md`、`PC_UI_UX_PLAN.md`、`MINIAPP_UI_UX_PLAN.md`、`BOSS_DASHBOARD_PLAN.md`、`IMPLEMENTATION_ROADMAP.md`、`RESEARCH_MATERIALS_CHECK.md`。该报告是审查意见，不覆盖原始七份文件；各文件仍由原交付方保管，未自动写入仓库。

## 确认的重大基线错误

1. 原审计指定活跃开发分支 HEAD `38eb1690bf7282269c8e7ffd65e6ad81e9ef19dd`。GitHub `compare_commits` 已确认开发分支 `chatgpt/v3-2-121-m02-revocation-notices` 在该提交之后还有 **19 次提交**；在 `0b60319fdd44c4a24ec24279c326a1c8e888fd6d` 之后仍有 1 次提交。不可把 `38eb169` 的代码快照当当前系统。
2. 原开发分支真实存在 `src/sales-workflow.mjs`、`web/sales-workflow.js`、`db/workspace-migrations/039_v34_sales_loop.sql`、`db/workspace-migrations/040_role_workspaces.sql`。原方案将“防断链约束、面谈/试听预约、今日待办、报名标准 B”笼统判成未实现，属于严重重复建设风险。
3. 既有 `docs/V3.4_SALES_WORKFLOW.md` 明确：标准 B 是**有效协议经过独立核实 + 有效正额净收款已经核实**；正式 Closed Won 是全额有效净收与所有异常条件通过。原规划 `DEC-01` 推荐“只提交 `order-intents` 即标准 B”与已确认规则冲突，**不得采用**。
4. 原规划中的 `db/migrations/039_followup_chain_appointments_and_public_pool.sql` 尚未考虑现有 `db/workspace-migrations/039` 与 `040` 两次已落地迁移、既有 Lead/预约/任务记录/财务数据。不允许根据旧审计创建平行第二套事实表或重用模糊版本标号；先对照真实 schema 和 opt-in 模式提出最小增量方案。
5. 原规划“Boss 一键改派”不得绕过 V3.4 的主管申请、独立复核与接收人确认；“自动形成 CLOSED/RESOLVED”必须有匹配督办要求的业务证据，普通跟进记录不能自动消除所有督办。
6. 所有 `file:///home/antigravity/...` 证据链接只能在原 Agent 本机打开，无法作为跨机器持久交接证据；需统一为仓库相对路径或带 commit SHA 的 GitHub 永久链接。

## 可保留的有效成果

- 研究资料 PART1/PART2 的文件清单、SHA/CRC 验证：**由 Argon 报告宣称通过，本轮仅审阅文档，未重新取得两份原 ZIP 字节做独立复核**。
- 完整 UI 页面规范和测试矩阵可作为**候选需求**，但须以当前 PR #129 真实页面为起点按“保留/小改/新增/需决策”重做差异分类。
- GitHub 当前分支对请求路径 `src/boss-dashboard-service.mjs`、`web/boss-dashboard.js`、`miniprogram/app.json` 返回 404；可合理作为专门 Boss 大屏及微信小程序尚待建设的线索，不能以单个文件不存在推断完全无报表功能。
- 现有 V3.4 已有基础统计与待办；新的完整 Boss 指标下钻、管理动作闭环、小程序工程可作为优先新增方向。
- 移动端保存敏感家长/学生信息到 `wx.setStorageSync` 需独立安全审核，严格最小化、有效期与撤权清除；H5 手机尺寸截图不等于原生微信小程序或真机验收。
- Boss 的 `as_of_at` 只按 `created_at <= as_of_at` 筛选不能重现历史状态：需要按历史事件/版本/事务快照一致性设计；鉴权与授权范围要在请求时重新校验。
- `M14/M15` 及漏斗分母必须区分 Lead 去重、学生去重和事件场次的粒度。漏斗若允许非线性路径，不能随意用不同分母声称严格阶梯嵌套。
- 数据库新增迁移的回滚方案不能简单写“删除已执行的迁移”，应提供数据向前兼容、开关撤回与经过验证的补偿方案。

## 审计下一步（仅审计，禁止改业务代码）

1. 在真实 PR #129 开发分支核实最新 HEAD SHA、PR Draft 状态、对应 CI，并调查原报告基线为何落后 19 提交；检查 Agent 当前本机 `git status` 以防未推送更改。
2. 以 `docs/ROLE_WORKSPACES.md` → `docs/V3.4_SALES_WORKFLOW.md` → 实际 `src/sales-workflow.mjs`、`web/sales-workflow.js`、迁移 039/040 与测试为**当前业务基线**。
3. 对原 `FEATURE_GAP_MATRIX.md` 的 60 项逐项复核，尤其 A-06/A-11/A-13/A-14/A-19、B-03/B-05、E-05/E-06；标注可复用的真实接口与 UI。
4. 修订路线图：不重复 P0-A，优先核对 UI 体验差异、Boss 的真实指标与下钻需求、小程序独立工程，以及公海池是否符合已有角色/审批约束。未决策略独立提审。
5. 更新 `DEC-01` 为既定标准 B，修订 Boss `M15`、小程序 `MS-04`、PC `P03` 和所有对应测试，不可把意向单当已收首款。
6. 审核通过前，保持 `EXT-001=UNVERIFIED`、`HOLD=true`、`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`。不修改原 CRM，不合并、不部署。

## 核验使用的公开 GitHub 文件

- `https://github.com/Lizhaochuan/market-sales-system/blob/chatgpt/v3-2-121-m02-revocation-notices/docs/ROLE_WORKSPACES.md`
- `https://github.com/Lizhaochuan/market-sales-system/blob/chatgpt/v3-2-121-m02-revocation-notices/docs/V3.4_SALES_WORKFLOW.md`
- `https://github.com/Lizhaochuan/market-sales-system/blob/chatgpt/v3-2-121-m02-revocation-notices/src/sales-workflow.mjs`
- `https://github.com/Lizhaochuan/market-sales-system/blob/chatgpt/v3-2-121-m02-revocation-notices/db/workspace-migrations/039_v34_sales_loop.sql`
- `https://github.com/Lizhaochuan/market-sales-system/blob/chatgpt/v3-2-121-m02-revocation-notices/db/workspace-migrations/040_role_workspaces.sql`
- `https://github.com/Lizhaochuan/market-sales-system/pull/129`

**本次仅核对连接器可访问的远程文件与提交关系；没有执行本地测试、数据库迁移或代码变更。**
