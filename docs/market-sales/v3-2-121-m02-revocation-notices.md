# V3.2-121 M02 撤权通知与持有人缺口（独立设计记录）
状态：**partial implementation / CI-only / proposed-unimplemented**。上游：V3.2-120 Draft PR #127。追踪：Issue #128。

## 已实现（纯 JavaScript 隔离契约）
- 通知标识绑定机构、异常、V119 清单版本/摘要、V120 不可逆撤权事件摘要、模拟接收人和单调 epoch。
- 输入必须恰好为七个业务字段；夹带财务审批或放行标志拒绝。
- 依赖注入的 ledger.appendNotice 必须由未来的 SQL adapter 实现事务内的 V119/V120 来源核验；当前模块不会自动联网或发真实通知。
- 提交后检查来源 head，发生变化保持拒绝。报告只把模拟接收人列为 QUEUED/SENT_UNCONFIRMED/NEGATIVE_RECEIPT/COPY_NOT_RETRACTABLE/PROOF_EXPIRED/FIXTURE_ACKNOWLEDGED 等；遗漏识别为 NOT_QUEUED。
- 即使所有模拟回执已确认，仍永久 hold_active=true、release_eligible=false；不意味着可撤回已经下载的副本。

## 本轮新增（仍需 CI 验证）
- 一次性 PostgreSQL 16 schema 与受限角色 FORCE RLS；服务写入通过 SERIALIZABLE 事务、作用域锁，复核 V119 清单与 V120 已撤权事件后追加 QUEUED 记录。
- 清单/撤权事件负载摘要校验、重复 notice ID 幂等处理、受限角色无 UPDATE/DELETE 权限；测试数据库由 fixture 管理员预置接收人集合。
- 隔离 PostgreSQL 集成脚本覆盖持久化、重复提交、缺失接收人、跨租户 RLS、不可改写、伪造源拒绝。
- 上述功能只可视为本轮 SQL 部分实现；在 GitHub Actions 通过之前不得视为已验收。

## 尚未实现，禁止假称已验收
- V119、V120 的**全量历史哈希链**与真实接收人名单来源证明，当前 SQL adapter 只校验目标事件及最新 head，无法证明中间历史无缺口。
- 真实权威接收人来源及全量名单完整性、跨进程并发竞态和失败回滚完整验收；当前 SQL registry 由测试管理员预置，不代表实际持有人。
- 真实 IAM、外部网络通知、可信组织签名、真实持有人接收确认、自动重试 worker、外部三方原子交接、生产 UAT。
- 不能证明下载文件已撤销或现实人员获知；接收人清单须取权威来源，不能相信调用方提交的子集。

## 生产禁止
不修改已有订单、收付款、SaleEvent、课时、补偿或历史归因；学生为主单位，家庭只在真实多子女时按需关联；不修改 edu-management-system、主 CRM 生产入口及主文档；不新增生产迁移 039，不合并不部署。六方真实负责人仍 UNASSIGNED，16项外部准入、R01—R10及正式UAT仍未验收。

## 下一验收门
为 ledger 实现 PostgreSQL 一次性数据库 adapter + 受限角色 FORCE RLS；以 V120 revocation event、V119 export head 为原始只读权威，在同一 SERIALIZABLE 事务验证并追加通知，不接受调用方自报的源状态。补充至少并发、重放、负向回执乱序、跨租户、失败回滚、持有人不完整的 SQL 集成测试。完成前不得将本 PR 标成可合并。
