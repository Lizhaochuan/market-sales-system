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

## V121 Ed25519 fixture proof preflight (not production IAM)
- 新增纯隔离 `src/cross-module-fixture-receipt-proof.mjs`，使用独立临时 Ed25519 密钥验证精确作用域字段，绑定机构、异常、通知、序号、负向状态、模拟签署者、授权 epoch、撤权水位、签发/截止时间。
- 断言签名有效、模拟时钟处于有效窗、可注入的模拟身份来源报告 active 且 epoch 和撤权水位完全相符；缺少信任来源、过期、签名篡改、标志注入、签署者撤权均拒绝。
- CI 增加签名测试；验证通过仅表示临时测试证书与注入身份快照匹配，不代表实际组织、员工或接收人认证。
- **关键未完成：验证器尚未被 `appendNegativeReceipt` SQL 写入路径强制调用。当前原有 CI-only 回执写入 API 仍可无签名写入；不得标注“签署回执端到端验收”。** 后续须将签署证明与 SQL 持久化以 fail-closed 方式绑定，且在提交后重查撤权来源，覆盖竞态。
- 真实 IAM/签名公钥分发、实际签署者授权、外部通知与正式 UAT 仍全部未验收。Draft / HOLD / 不部署。

## V121 signed receipt SQL gate (CI-only)
- SQL adapter 现强制要求带有临时 Ed25519 证明的负向回执，并在 SERIALIZABLE 事务内与提交后校验模拟身份来源、签名、时间窗口和水位。无签名或来源过期拒绝。
- 读取负向回执链时也复核模拟证明；若签署者后来撤权，读取时 fail closed，不表示已写历史被删除。
- 验证仅通过依赖注入的临时测试公钥、模拟时钟和模拟 authority。生产真实 IAM/证书分发、实时撤权竞态与持有人接收确认尚未解决。
- 仍有“成功写入后至客户端确认之间外部撤权变化”的竞态窗口；失败读回会拒绝输出，但写入审计事件保持不可改写。不得据此授权释放、合并或部署。

## V121 simulated authority/commit race tests
- 增加仅限隔离测试的 beforeReceiptCommit/afterReceiptCommit 注入钩子。数据库事务内部在真正 COMMIT 前再次验证模拟 Ed25519 回执签署者和撤权水位；提交后模拟撤权则拒绝返回成功，保留追加式 SQL 原记录供取证。
- 故障测试分别模拟 INSERT 后、COMMIT 前撤权，验证 SQL 整体 ROLLBACK；COMMIT 后撤权，验证历史不删除但 readback fail closed；以及提交前身份来源中断。
- **限制**：钩子只在 CI disposable SQL 中工作；即使提交前和提交后都检查，最后一次外部状态读取后的竞态窗口并未关闭。这不是可信真实 IAM 水位租约、分布式两阶段事务或现实中的跨系统原子撤销。
- 真实组织授权、实际接收人与签署身份、正式 UAT 仍未完成。所有业务输出继续 HOLD，PR 保持 Draft，不合并不部署。

## V121 bounded fixture authority lease (standalone contract only)
- 新增 `src/cross-module-fixture-authority-lease.mjs`：只接受固定字段、机构/异常/签署者/通知版本精确绑定的 Ed25519 模拟租约，最长 30 秒，受模拟时钟控制。
- 验证器要求模拟实时 authority 的 active、epoch、水位、lease sequence 与租约一致。进程内保存单调观察水位，拒绝回退；可检测后退模拟、过期、签名篡改、跨范围使用及身份服务故障。
- 新增 7 项 Node 合约测试及 CI。**此验证器目前是独立组件，尚未绑定 SQL 回执事务；不能标记为完整协调协议，也不能关闭分布式最后读竞态。**
- 租约有效不代表真实身份系统已授权、真实撤权水位已冻结、真实接收人已收到通知。进程内水位不会替代持久共享防回滚状态；后续需设计持久水位、SQL 绑定及失败恢复。
- 所有标志继续 HOLD；`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`。六方外部责任人及正式 UAT 仍未验收。

## V121 durable signer watermark (CI-only)
- 一次性 PostgreSQL 表 `fixture_signer_watermarks` 在租户/异常/模拟签署者维度保存最大已观察的 authority epoch 与撤权水位；FORCE RLS、受限角色禁止 DELETE，SQL trigger 禁止 UPDATE 回退。
- `appendNegativeReceipt` 的 SERIALIZABLE 事务在来源核验及模拟签名校验后，对签署者水位行加锁；旧水位拒绝，新水位与回执同事务持久化，失败 ROLLBACK。新进程使用同一测试数据库也能检测旧回执。
- 集成测试验证持久水位、跨 adapter 重启旧签名重放、直接 SQL 水位回退、删除权限和跨租户不可见。
- **安全限制**：当前仅测试数据库内的水位，尚未绑定独立短租约验证器的 lease_sequence；没有真实 IAM 授权签名、网络水位权威来源或跨系统原子一致性。持久水位仅记录本地最大已观察值，不代表能够证明实际外部撤权时刻。
- 继续保持六方真实负责人 UNASSIGNED、正式 UAT 未通过、HOLD、Draft、禁止合并和部署。

## V121 opted-in signed lease + SQL fencing (CI-only)
- `fixture_signer_watermarks` 新增持久 `lease_sequence`，数据库防回退触发器和 RLS 同时保护 epoch、水位与序号。
- 隔离 SQL adapter 在显式提供 `leaseGate` 时强制 `lease` 字段：临时 Ed25519 租约与回执证明必须绑定同一租户、异常、签署者、通知、epoch 和撤权水位；租约有效期最长 30 秒，写入前、COMMIT 前和提交后复核。
- `lease_sequence` 和负向回执在同一 SERIALIZABLE 事务中记录，新的 adapter 实例读取共享 SQL 水位即可拒绝旧序号；过期租约必须失败并保持 HOLD。
- **仍有阻断缺口**：为了兼容早期 CI 测试，未提供 `leaseGate` 的旧隔离 adapter 仍允许仅凭回执签名入库。这不是生产接口，不得描述成系统全局强制短租约；真实 IAM、可信共享授权租约颁发、双向租约序列的业务语义、外部跨系统原子性和正式 UAT 尚未完成。进程内 gate 状态不可视为权威来源。
- 全程仅在一次性 PostgreSQL 16 数据库测试，继续 Draft/HOLD/不合并/不部署。
