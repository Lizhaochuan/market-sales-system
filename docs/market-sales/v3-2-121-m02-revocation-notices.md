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

## 本次追加：本地链完整性校验
- 在通知入队的 SQL 快照内逐条读取 V119 与 V120 的全部本地事件，验证序号连续、上一条摘要、事件摘要、机构/异常作用域及 head 摘要一致。缺少任何中间记录、摘要篡改或 head 不一致都拒绝入队。
- 新增历史缺口、篡改和并发同版本重放的 PostgreSQL 测试。以上仍仅是**本地结构/摘要链校验**，并不是对全部 V119/V120 语义、真实组织签署者或接收者的权威证明。

## 尚未实现，禁止假称已验收
- V119、V120 的**完整语义及外部真实性验收**与真实接收人名单来源证明；本地哈希链无法独立证明真实业务事实。
- 真实权威接收人来源及全量名单完整性、跨进程并发竞态和失败回滚完整验收；当前 SQL registry 由测试管理员预置，不代表实际持有人。
- 真实 IAM、外部网络通知、可信组织签名、真实持有人接收确认、自动重试 worker、外部三方原子交接、生产 UAT。
- 不能证明下载文件已撤销或现实人员获知；接收人清单须取权威来源，不能相信调用方提交的子集。

## 生产禁止
不修改已有订单、收付款、SaleEvent、课时、补偿或历史归因；学生为主单位，家庭只在真实多子女时按需关联；不修改 edu-management-system、主 CRM 生产入口及主文档；不新增生产迁移 039，不合并不部署。六方真实负责人仍 UNASSIGNED，16项外部准入、R01—R10及正式UAT仍未验收。

## 下一验收门
新增只追加式的模拟负向回执及单调状态水位，覆盖过期、乱序、撤销后重放与跨租户访问；补充 SQL 故障回滚和可信模拟接收人集快照一致性。完整外部责任人认证及真实接收确认仍属阻断项；不得将本 PR 标成可合并。

## V121 negative-only receipt extension (CI-only)
- 增加一次性 PostgreSQL `fixture_revocation_negative_receipts`，仅限受限租户角色追加写入；FORCE RLS、禁止受限角色 UPDATE/DELETE、强制 `hold_active=true`。
- `appendNegativeReceipt` 采用 SERIALIZABLE 与通知级作用域锁；根据已入队通知核对 V119/V120 来源，仅接受 `NEGATIVE_RECEIPT` 与 `COPY_NOT_RETRACTABLE`。序号必须连续，前摘要必须匹配；同序号同状态重试幂等，冲突状态或插队均拒绝。
- 回读覆盖报告会验证模拟负向回执链，取同一接收人的最高通知 epoch；同一 epoch 重复记录被拒绝。不能将任何模拟负向回执视为真实接收确认或解除 HOLD。
- SQL 测试新增回执顺序、重放、伪造正向 ACK、跨租户 RLS、篡改、不可改写及永久隔离断言。本地 fixture 接收人登记仍不等于真实持有人权威清单；没有对真实外部系统发送或接收任何消息。
- 尚未实现真实投递/回执证书、过期签名校验、事务性接收人全集快照以及消息网络重试 worker。SQL 当前只保障隔离测试表内的一致性；不得合并、部署或声称真实撤权成功。

## V121 receipt coverage snapshot hardening
- PostgreSQL adapter 新增 `captureCoverageSnapshot`：一次 REPEATABLE READ 事务读取并验证 V119/V120 本地历史、当前模拟接收人全集和通知/负向回执链；报告使用同一快照，不再在三个独立事务内拼接结果。
- 隔离单元测试使用旧的 mock 查询兼容接口；真实 SQL adapter 采用单事务快照，不可把 mock 的非原子结果当作生产证明。
- 补充快照一致性及 SQL 失败后 ROLLBACK 无遗留回执的集成测试。事务内一致性不等于现实持有人登记完整或可信签名验证。
- 真实接收人权威名单、外部签名/时效/撤权水位及网络通知仍未验收，保持 HOLD 和 Draft。
