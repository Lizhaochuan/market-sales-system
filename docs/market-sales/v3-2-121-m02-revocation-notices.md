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

## V121 全局强制租约入口（隔离适配器）
- 移除 `leaseGate` 可选回退：现有 CI-only SQL adapter 在构造时若没有有效租约验证器立即失败。每一条负向回执都必须有独立模拟签名证明与签名短期租约；无租约拒绝，回读及重放同样校验租约。
- 所有旧的 CI 集成测试迁移至签名租约路径；原有撤权水位、模拟租户隔离及故障注入继续执行。不保留能够只凭回执签名调用写入服务的旧路径。
- 但受限测试数据库仍允许 fixture 测试角色直接 INSERT 回执表，以便模拟和验证 SQL 事务；真实产品 API/网络投递路径尚不存在，不能宣称数据库层已从根本杜绝绕过、真实 IAM 授权或解决跨系统竞态。
- 当租约失效，历史记录保留不可修改且查询 fail closed，恢复需要新的可信租约及最新水位；不允许通过复用过期令牌自行恢复。

## V121 跨 adapter 并发与过期恢复验收（CI-only）
- 添加三个 PostgreSQL 16 集成用例：两个独立 adapter 并发写同一签署者不同 lease_sequence；较高水位必须持久保留，随后旧租约不得重放；模拟租约失效时拒绝写入，新签发且更高 sequence 的有效租约允许独立的新负向记录（仍永久 HOLD）；COMMIT 前故障必须同时回滚回执与租约水位。
- SQL 的 SERIALIZABLE 与 signer 行锁提供测试库内的单调顺序，跨进程可见；并发用例允许低序号先提交或被后提交的高序号阻断，但必须保持最终高水位与旧令牌隔离。
- **限制**：当前故障恢复只测试同一一次性数据库和模拟时钟/身份来源；没有真实身份签发服务、持久网络队列、业务 UAT 或跨系统原子撤权。无权解除隔离、合并或部署。

## V121 ordinary-writer INSERT removal (disposable SQL)
- `v106_writer_a` / `v106_writer_b` 不再拥有 `fixture_revocation_negative_receipts` 的直接 INSERT；由隔离环境专属 `v106_receipt_writer_a` 角色连接写入。SQL adapter 必须明确提供独立 `receiptPool`，并验证数据库角色后才执行已通过模拟签名和租约检查的回执写入。
- 普通角色仍有 SELECT 以执行只读报告；新增直接 INSERT 权限拒绝和使用普通角色冒充回执连接的测试。
- 注意：**专属回执角色拥有直接 INSERT 权限，绕过 adapter 使用其凭据仍可写入模拟表。** 本轮属于数据库角色权限收敛，不代表数据库原生验证 Ed25519 签名，不能声称全面根除数据库直写。后续仍需权限更小的安全执行入口、可信验证证据/签名校验以及权限审计。
- 仅测试数据库使用的模拟凭据，不可作为生产 IAM、投递确认或解除 HOLD 的依据。PR 保持 Draft，不合并不部署。

## V121 SQL SECURITY DEFINER 受控写入入口（隔离测试）
- `v106_receipt_writer_a` 现在也不再具有负向回执表的表级 INSERT；仅授予 `fixture_append_negative_receipt` 函数执行权，函数固定 `search_path` 并显式核对 `session_user`、租户 UUID、回执类型、序号、SHA-256 摘要及证明/租约字段结构。
- SQL adapter 在 JS 模拟签名和短期租约校验后，通过受控函数向一次性 PostgreSQL 追加回执。权限测试覆盖普通角色/专用角色直写拒绝、摘要不匹配、缺少证明及事务回滚。
- **特别限制：数据库函数只做结构与摘要一致性校验，不验证 Ed25519 签名或真实 IAM 授权。** 拥有该函数执行权的专用角色仍可伪造结构完整但无真实签名的 JSON 包。只有“不可直接 INSERT”这一数据库权限边界得以验证，不能声称已经构成完全不可绕过的可信写入系统。
- 正式方案需要数据库端可信签名校验或隔离的强认证签名服务、受控角色凭据管理与授权审计。依旧 CI-only、永久 HOLD、Draft、没有真实投递或 UAT，不合并不部署。

## V121 SQL 可信服务认证码验证（一次性 CI）
- 引入隔离测试环境的 `fixture_receipt_attestation_secrets`（32 字节随机密钥、仅 fixture 管理员可读）；普通写入与专属回执角色都没有 SELECT 权限。
- JS adapter 先独立验证临时 Ed25519 回执及短租约，再对确切序列化的回执 payload 计算 HMAC-SHA256；数据库 `SECURITY DEFINER` 入口验证 payload 的 SHA-256 及 HMAC，失败则拒绝插入，不产生回执。密钥在每次 disposable CI 初始化时由管理员注入，不存入仓库，也不回传到任何业务事件。
- 专属回执角色不能读取服务认证码密钥，未持有密钥的调用者即使提供结构正确的 JSON 和伪造签名，也无法通过数据库认证码检查。新增权限、错认证码与无入库测试。
- **安全边界**：HMAC 证明的是“某个持有隔离测试密钥的调用端曾签发该 payload”，不是数据库对 Ed25519 的自主验签，也不代表真实 IAM 身份或接收人真实回执。服务内的可注入验证器、HMAC 密钥的分发/轮换、防重放语义、真实权限审计和跨系统撤权窗口仍需正式设计与验收。不得把本轮描述为完整生产可信签名方案。
- 继续 `hold_active=true`、`release_eligible=false`、Draft / CI-only / 不合并 / 不部署。

## V121 隔离 HMAC 密钥版本与不可逆退役
- 一次性测试库密钥存储由 `organization_id` 唯一改为 `(organization_id,key_version)` 主键，新增仅允许一个 `active=true` 的部分唯一索引。SQL 受控写入函数新增显式 `p_key_version` 参数，只有该机构、该版本且仍为活动状态的 32 字节密钥才能校验回执 MAC。
- `fixture_attestation_no_reactivation` 触发器禁止修改密钥原文、组织与版本，也禁止退役版本再次激活；退役旧版后只能签发更高版本的新密钥。普通及专用测试角色仍无密钥 SELECT/UPDATE 权限。
- 兼容测试 adapter 默认使用版本 1；轮换后必须创建带新 32 字节密钥与 `receiptAttestationVersion=2` 的新实例。旧实例继续调用时将收到 `V121_RECEIPT_ATTESTATION_REJECTED`，事务内已观察水位与待写回执一起回滚。有效新版本仍只允许追加负向记录，始终 HOLD。
- CI 新增旧版本撤销/重放、错误版本、密钥权限、版本不可逆、同机构多活动密钥及新版本恢复验证。保留旧版记录用于取证，不允许复活旧密钥。
- **剩余限制：**本轮是一次性数据库与模拟管理员手工轮换；不是生产密钥托管、HSM/KMS、双人审批或可信根轮换。持有新版本真实密钥仍能签发数据库 MAC，不等于数据库独立验证 Ed25519 或完成真实 IAM。外部投递、正式 UAT 和跨系统撤权仍未通过；继续 Draft / CI-only / HOLD / 不部署。

## V121 simulated key-compromise incident audit (CI-only)
- 为一次性数据库密钥表新增 AFTER INSERT / UPDATE 事件触发器：自动记录 `KEY_ISSUED` 和 `KEY_REVOKED` 元数据，包括租户、密钥版本、SQL 会话角色、记录时间及 SHA-256 元数据摘要。**不记录密钥原文、完整回执或认证码。** 审计表不向普通和专用回执角色开放读写，UPDATE/DELETE 触发器阻断修改；管理员及拥有数据库超级权限者仍可通过高级操作绕过，因此不能承诺物理不可篡改。
- 模拟泄露场景：管理员退役被泄露的 v2 密钥，旧 v2 MAC 即使掌握原密钥也无法入库；无活动密钥期间写入 fail closed。随后用独立 v3 密钥恢复模拟负向回执写入，`hold_active` 永远为 true，v2 无法复活。
- 用例校验五条先后发生的发行/撤销事件、每条元数据摘要、权限隔离及审计 UPDATE/DELETE 阻断。审计摘要目前是**单条事件完整性校验**，不是跨事件不可篡改哈希链或外部时间戳锚定，正式验收仍需要可信追加存储、双人审批、可追溯事件来源、外部 IAM 与密钥托管审计。
- 该模拟只由一次性 CI 数据库管理员执行，绝不表示真实事故被报告、真实泄露发生或任何现实审批已完成。继续 PR Draft、CI-only、HOLD、禁止生产读写、禁止合并和部署。

## V121 audit-only role + fail-closed issuance metadata integrity (isolated CI)
- 新增 `v106_audit_reader`：只读 `fixture_receipt_key_audit` 发行/撤销元数据，不可读密钥、不可操作负向回执、不可写审计记录；测试验证最小权限。
- 数据库受控回执函数现在校验当前活动认证密钥版本的 `KEY_ISSUED` 审计记录：要求记录存在、事件类型正确、SHA-256 元数据摘要与其租户/版本/角色一致，否则拒绝新写入并回滚水位。测试用超级管理员临时绕过模拟审计篡改，验证 fail closed，再恢复原始摘要，HOLD 仍为 true。
- 此校验只验证当前活动密钥对应的发行元数据，而不是完整事件历史、外部锚定或双人审批。数据库超级用户仍可同时篡改元数据及其摘要，也能控制模拟时钟/数据库；不能声称独立抗管理员篡改或已实施真实审批。
- 后续阻断：需要独立外部 append-only 审计锚、最小权限双批准者的真实授权签署机制、密钥事故工单与 UAT；未完成之前始终 CI-only / Draft / HOLD / 不合并 / 不部署。

## V121 独立双人审批与模拟外部审计锚契约（standalone fixture）
- 新增 `src/cross-module-fixture-dual-approval-anchor.mjs`：恢复请求必须绑定机构、异常、唯一请求 ID、新密钥版本（至少 2）、密钥发行审计摘要及最长 30 秒时窗。两个不同审批人分别以临时 Ed25519 密钥签署同一规范化请求摘要，角色分别为 `SECURITY_REVIEW` 与 `AUDIT_REVIEW`；重复身份、缺少角色、替换签名、修改机构/异常/版本/审计摘要一律拒绝。
- 只读 `readAudit` 和 `readAnchor` 分别校验模拟 SQL 发行审计元数据以及**模拟独立归档**返回的请求/审计双摘要；来源必须明确标注 `FIXTURE_SEPARATE_ARCHIVE`，不可用、摘要不一致或缺失时拒绝。回放集当前仅驻留进程内，不支持重启后可靠防重放，不能替代事务型持久去重。
- 所有通过返回 `external_anchor_verified=false`、`real_person_approval=false`、`hold_active=true`、`release_eligible=false`、`merge_authorized=false` 和 `deploy_authorized=false`，不触发密钥变更或解除隔离。
- CI 新增 7 项契约测试，验证双人独立签署、作用域防篡改、超时、审计/归档故障以及进程内重放。
- **明确未完成**：真实 IAM 身份绑定、组织级双人职责隔离、可信外部 WORM 存储、签名密钥托管、持久化审批消费与事务原子性、正式 UAT。本契约尚未连接隔离 SQL 密钥轮换函数，更没有运行真实审批；不可把 standalone fixture 测试理解为生产恢复授权。

## V121 signed recovery to durable fixture issuance transaction
- Approval `audit_digest` is bound to the **previous key version's KEY_REVOKED** event: the new `KEY_ISSUED` event cannot exist before approval, so binding approvals to that future event would be circular. The contract and its tests now verify `KEY_REVOKED` for `key_version-1`.
- Added `fixture_recovery_consumptions`: unique `(organization_id,request_id)` plus `(organization_id,key_version)`, with request digest, previous-key revocation digest, distinct audit/security reviewer IDs, simulated archive source and permanent `hold_active=true`. No keys, signatures or MAC values are written into this ledger; UPDATE/DELETE denied by trigger and no application-role write grants.
- CI-only `createFixtureRecoveryIssuance` verifies the dual Ed25519 fixture approvals and separate-archive fixture, then uses a **single PostgreSQL transaction** to verify the previous key is retired, its revocation audit digest matches and has valid metadata, consume the request, invoke the optional fault hook, and insert the new active key. Abort rolls back both the consumption row and key issuance; a restarted/new fixture issuer is fenced by durable SQL uniqueness checks.
- Dedicated PostgreSQL tests cover missing reviewer, unavailable fixture archive, replay after new issuer creation, concurrent issuance attempts, injected failure before key insertion, and immutable consumption evidence; none of these tests issues real credentials.
- **Security limitations:** the test-only issuance helper holds an administrator pool and its approvals are verified in JS before SQL transaction; malicious database administrators, compromised application signing keys, and races with a real external approval provider are not solved. The mock external archive is not WORM storage and the in-process verifier still has a local used-set. It is unsafe to deploy or generalize the admin-pool helper to production. Production IAM identities, dual-human workflow, external attestation and UAT remain blockers. Permanent HOLD / Draft / no merge / no deploy.

## V121 受限发行角色 + 单入口事务（CI-only）
- 隔离数据库新增 `v106_key_issuer` 独立角色。该角色**无密钥表、审批消费表的直接 SELECT、INSERT、UPDATE、DELETE 权限**，也不可读取密钥原文或模拟审计表；只允许执行 `fixture_issue_recovery_key` 受控 `SECURITY DEFINER` 函数。
- DB 函数检查调用会话身份、租户、密钥长度、审批人身份不同、旧版密钥必须撤销、上一密钥撤销审计摘要正确、同一请求未消费且版本恰好连续；在一次函数调用中写入唯一审批消费记录并发行新密钥。调用端事务在函数调用后、COMMIT 前允许故障注入；失败时同时回滚两条记录。
- 原 JS CI-only `createFixtureRecoveryIssuance` 不再使用 `postgres` 超级管理员连接，改用专用 `issuerPool` 且检查 `session_user`。集成测试覆盖通过角色的直接表操作拒绝，以及回执角色无权调用发行函数。
- **剩余关键限制：**数据库函数本身无法独立验证 Ed25519 双人签名或模拟外部锚定；握有专用发行角色凭据的人仍可能绕过 JS 校验并直接调用该函数，提交结构完整但未经真实审批的数据。当前属于最小权限收敛，不代表完整防绕过或生产级发行安全；后续必须将签名验证的独立信任根、审批证据及持久防重放绑定到 DB 入口。数据库管理员依然可直接修改表。保持 HOLD / Draft，不合并、不部署。

## V121 独立审批认证码绑定数据库发行入口（隔离测试）
- 隔离数据库新增独立的 `fixture_recovery_approval_attestation`，使用临时 32 字节审批认证密钥；`v106_key_issuer`、普通角色、审计角色及回执角色均无此密钥表的 SELECT/UPDATE 权限。
- JS 模拟双人 Ed25519 签名及独立归档验证通过后，构造固定域分隔的 `v121-recovery-attestation-v1` HMAC-SHA256。认证内容包含：租户 UUID、异常 UUID、请求 UUID、请求摘要、目标密钥版本、前序撤销审计摘要、两名审批者 ID 以及**待发行新密钥 SHA-256 指纹**。数据库 `fixture_issue_recovery_key` 在事务中独立校验认证码，失败则不写入新密钥和审批消费记录。
- CI 验证专用发行角色独立调用数据库函数却未提供正确认证码会被拒绝；替换待发行密钥或更换版本不能借用原认证码；认证密钥不可由发行/审计角色读取。真实流程仍通过模拟双人签名与归档契约，保持持久请求去重、事务回滚和永久 HOLD。
- **关键边界**：数据库验证的是独立服务认证码，不是自主验证两名真实人员的 Ed25519 签名；当前 CI 的认证密钥由测试代码持有，若签发服务失陷仍可能伪造认证码。缺少可信外部签发者、密钥托管、真实身份审批、时效绑定的数据库重验及外部 WORM 审计。不可据此合并或部署。

## V121 审批认证密钥轮换与数据库时效复核（CI-only）
- 将测试审批认证密钥改为 `(organization_id,attestation_version)` 版本化存储，采用每机构最多一个活动版本的唯一索引。触发器禁止变更密钥原文、组织及版本，也禁止将已撤销版本重新启用。专用发行角色既不能读取密钥，也不能自行修改活动状态。
- 审批 HMAC 升级为域分隔 `v121-recovery-attestation-v2`，在原有审批/发行参数和新密钥摘要之外，额外绑定**认证密钥版本、签发起始时间和截止时间**。数据库发行函数要求版本仍在活动状态，且独立复核 `issued_at_ms <= fixture_now < expires_at_ms`、有效窗口不超过 30 秒。时钟在 CI 中通过仅管理员可操作的 `fixture_recovery_clock` 模拟；这是测试工具，绝非生产可信时间源。
- 新增 DB 集成测试模拟时钟已经到达截止时间、旧版审批密钥撤销、旧认证码重放、升级新版后发行恢复，以及发行角色擅自读取/调整审批密钥与数据库时钟被拒绝。认证缺失、窗口无效、版本已退役时拒绝 SQL 写入并保持 HOLD。
- **剩余风险**：独立签发密钥目前仍驻留同一 CI 测试进程中，不构成真正隔离的签名服务或硬件密钥托管；能够控制签发进程的攻击者可制造合法 MAC。模拟时钟由数据库管理员设置，高级管理者仍可绕过测试边界。真实 IAM、独立 KMS/HSM、外部不可改审计、持久化签发服务审批及正式 UAT 均未完成。Draft、CI-only、不合并不部署。

## V121 签发密钥泄露模拟与三模块紧急隔离（CI-only）
- 新增独立 `fixture_recovery_emergency_stops`，按租户和异常保存签发停止位。受控 SQL 发行函数在检验审批认证码之前检查该记录，**记录缺失或停止位为 true 时 fail closed**。专用发行角色、回执角色没有直接读写该表的权限；由一次性测试管理员模拟事故响应人员启用停止位。
- 新增 `fixture_cross_module_holds`：SALES / FINANCE / ACADEMIC 三个隔离投影，均固定 `hold_active=true`、`release_eligible=false`；业务角色无权限修改，UPDATE / DELETE 触发器阻断更改。此处仅是隔离 fixture，不是实际销售、财务、教务模块的真实数据库。
- PostgreSQL 测试由模拟“泄露审批认证密钥”的测试进程生成**数学上有效**的签发认证码，验证紧急停止位启用时受控入口仍拒绝发行；同时验证无需签发权限就不能关闭停止位、新密钥及审批消费记录没有写入、三个模块 HOLD 保留。停止位缺失也应拒绝。
- 需要强调：**若攻击者掌握仍有效的审批认证密钥，且管理员尚未启用停止位，受控函数不能辨别攻击者与合法签发者。** 本阶段验证的是明确触发后的隔离，不是自动检测签发端入侵。攻击发生前的密钥托管、真实 IAM、多方批准、外部 WORM 存证及跨模块实库验收仍未完成。保持 Draft / CI-only / HOLD / 禁止合并及部署。

## V121 显式密钥撤销事件自动触发隔离（CI-only）
- 数据库在审批认证密钥由 active=true 退役为 false 时，通过 AFTER UPDATE 触发器在**同一事务**将该租户已有 `fixture_recovery_emergency_stops` 标为禁止发行，并向 `fixture_recovery_security_signals` 写入 `APPROVAL_KEY_REVOKED` 元数据。普通发行角色不能修改停止开关或读写信号表；信号表 UPDATE/DELETE 由触发器拒绝。触发器与撤销变更共同提交或回滚。
- 发行动作在独立安全停止启用时拒绝（包括拥有合法 MAC 的模拟失陷签发端）；旧版 MAC 退役后仍被拒绝。受测试管理员显式解除停止且提供新活动密钥的模拟恢复路径继续保持 HOLD。
- 测试覆盖 v1 与 v2 两次退役均自动生成信号并拉起紧急停止、信号不可由普通角色读取/篡改、三个业务域隔离投影保持 `hold_active=true` 与 `release_eligible=false`，且不会发行 v9 密钥。
- **安全边界：**自动化触发条件是已观察到的**显式密钥撤销事件**，并非自动检测真正的密钥泄露、签发服务入侵或数据库审计篡改；攻击者若掌握仍有效的签发密钥，在事件发生之前可能制作有效 MAC。跨模块投影仅为隔离测试，不等于真实销售/财务/教务系统强制一致。真实事故信号来源、可独立认证的事件接入、持续监测、真实 IAM、外部不可改审计与 UAT 均仍需独立验收；Draft / HOLD / 不合并 / 不部署。

## V121 独立安全事件接入模拟（CI-only）
- 新增隔离安全事件入口 `fixture_accept_external_security_event`，只有测试角色 `v106_security_event_writer` 可以调用，且其账号不能读取事件认证密钥、操作紧急停止状态或修改销售、财务、教务 HOLD。
- 模拟独立监控系统按固定 `v121-security-event-v1` 域分隔签发 HMAC-SHA256，绑定机构、异常、唯一事件 UUID、来源、事件类型和签发时间。受控 SQL 函数独立验证来源固定为 `FIXTURE_INDEPENDENT_MONITOR`、三种安全事件类别（`SIGNER_COMPROMISE` / `APPROVAL_ANOMALY` / `AUDIT_INTEGRITY_MISMATCH`）、测试时钟窗口、身份与认证码。真实外部 SIEM 未接入。
- 验证成功后，同一 SQL 事务追加安全事件（机构+事件 ID 唯一，禁止更改和删除），并把登记的事故紧急停止开关置为 true。伪造、超期、篡改类别和重复事件均拒绝；失败时不会留下半条事件或误更改停止位。普通发行角色无权调用接入函数。
- 集成测试模拟接收到 `SIGNER_COMPROMISE` 后，尝试通过审批恢复函数发行新密钥失败，三个隔离域继续保持 HOLD。该保护要求数据库已收到有效安全事件；**不能自动侦测未知入侵**。高级数据库管理员仍可绕过模拟数据库约束，真实机构级认证密钥托管、独立事件源、可信时钟、外部不可改存证及正式 UAT 仍待验收。
- 继续 Draft、CI-only、不合并、不部署；此接口只接受受控测试 SQL 调用，并非生产 HTTP webhook。

## V121 安全事件后的恢复阻断闭环（隔离 CI）
- 对每次尝试发行新密钥，SQL 入口除已有签名认证码、撤销审计、时效和停止位外，还要求该事故对应 **SALES / FINANCE / ACADEMIC 三项完整的 HOLD 投影**，且每项均为 `hold_active=true`、`release_eligible=false`。隔离管理员模拟丢失财务 HOLD 行时，新版本密钥和审批消费记录均不得提交；恢复行后仍不会解除 HOLD。
- 新增 `fixture_unresolved_security_alert` 触发器：收到至少一条已认证且持久化的外部安全事件后，直接把紧急停止从 `true` 设回 `false` 会被数据库拒绝，错误标识 `V121_SECURITY_ALERT_UNRESOLVED`。缺少真正独立的事件结案证据时，本轮**不创建任何解除流程**。
- 测试覆盖：三模块 HOLD 缺失导致发行 fail closed、恢复测试数据后可继续受控发行（但不解隔离）；已持久化的安全告警阻止管理员直接关闭紧急停止，三个模块仍处于 HOLD。
- 限制：这不是生产审批恢复工作流。没有真实事故结案、独立双人结案身份及可外部核验的不可篡改证据，因此不能自动恢复业务，也不能凭模拟事件消除风险。高级数据库管理员理论上仍可禁用触发器。继续 PR Draft、CI-only、禁止合并、部署和生产写入。

## V121 安全事件结案复核记录与双职责签署（CI-only）
- 新增隔离 `fixture_closeout_reviews` 审核账本：`(organization_id,event_id)` 唯一绑定一个已认证外部告警，记录独立 review UUID、告警摘要、调查证据 SHA-256、两名不同职责审核人、复核时间，以及不可变的 `REVIEWED_STILL_HOLD` 状态。不得 UPDATE/DELETE；账本记录属于复核，不代表真正结案或解除事故。
- `fixture_append_closeout_review` 为独立 `v106_closeout_writer` 执行的 `SECURITY DEFINER` 入口，必须验证原始外部告警存在且摘要匹配、事故紧急停止仍启用、销售/财务/教务完整 HOLD、时钟窗口及两份绑定同一调查证据的角色专用 HMAC（`SECURITY_REVIEW`、`AUDIT_REVIEW`）。两名审核人必须是不同标识；角色密钥在测试表中隔离，调用者无权读取。
- 成功仅新增复核留痕，**绝不清除外部告警、解除紧急停止、释放 HOLD 或发行密钥**。数据库既有 `V121_SECURITY_ALERT_UNRESOLVED` 仍拒绝直接关闭停止位。测试包含伪造审核签名、修改调查摘要、错绑告警摘要、同一人冒充双角色、重复复核和越权操作。
- **实际安全限制**：测试 HMAC 密钥及审核人标识由同一隔离 CI 程序模拟，不是组织级真实人员审批、外部可信调查证据或真实 IAM。此阶段特意不提供解除 HOLD 的生产授权路径；未来必须有独立事故结案流程、证据来源校验、撤销与争议处理，以及跨销售/财务/教务正式 UAT。Draft / HOLD / 不合并 / 不部署。

## V121 正式结案验收清单的隔离诊断（UAT 准备，不授权恢复）
- 新增 `fixture_closeout_uat_evidence` 仅追加证据清单：安全事件来源认证、审计链核对、销售撤销影响核对、财务归属影响核对、教务履约影响核对；每项绑定事故、事件、证据摘要、责任域与复核人员 UUID。重复类别、篡改和删除由数据库限制拒绝。这里记录的是测试元数据，不是外部凭证的真实性证明。
- `fixture_closeout_uat_readiness` 只读诊断投影分别统计**正确责任域覆盖的证据数量**（满项 5）、独立复核人员数量（期望 5）、三模块 HOLD 数量（3）、停止发行状态、双职责复核记录是否存在。即使全部条件满足，仍固定 `release_eligible=false` 且 `hold_active=true`。
- PostgreSQL 集成测试覆盖证据缺失、责任域标注错误、重复类别、不可变性和三模块继续隔离；隔离数据库超级管理员通过临时停用测试触发器模拟纠错，只用于验证诊断输出，**不是可接受的生产纠错路径**。
- 验收责任边界：安全团队核验事件来源，审计团队核验不可变证据及链路，销售负责客户/订单影响核对，财务负责金额与归属差异核对，教务负责课程和履约归属核对。任何环节不通过均不得提出解除隔离请求；真正的释放还要求外部独立审批、法律/资金合规检查、生产连接的 UAT 及正式授权。
- 本阶段故意不实现真实 release、部署或合并入口。Draft / HOLD / CI-only。

## V121 UAT 失败项的追加式整改与独立复核（CI-only）
- 新增 `fixture_uat_failures`、`fixture_uat_remediations` 和 `fixture_uat_remediation_reviews` 三组仅追加表。失败记录绑定事故及已认证安全事件，保留失败原因、旧证据摘要及原审核者；整改新增独立记录，必须给出新证据摘要、整改人员和整改说明摘要，不覆盖初次失败。
- 由 `v106_closeout_writer` 调用的受限复核函数 `fixture_record_uat_remediation_review` 仅支持 SECURITY / AUDIT 两类复核，阻断整改人自审、原失败审核者重新审核及相同人员跨双职责重复签署；要求事故紧急停止继续处于激活状态。复核记录可写 `ACCEPTED_FOR_REVIEW` 或 `REJECTED`，不能更改历史。
- `fixture_uat_remediation_diagnostics` 只用于展示整改尝试、复核通过的职责数量，以及保留原失败记录的事实。即使两个职责均表示复核接受，也恒定 `hold_active=true`、`release_eligible=false`。
- PostgreSQL CI 检查证据不可改、相同复核者角色冲突、整改人员自审、重复复核和三业务域持续 HOLD。
- **限制**：审核人 UUID 当前由隔离函数调用者提供，尚未连接真实 IAM，也没有审核人签名原件；独立角色账号的调用权限不构成真实人员认证。数据库超级管理员仍可绕过测试触发器。不得把模拟双职责复核作为生产真实结案或解除 HOLD 的依据。保持 Draft、CI-only、不合并、不部署。

## V121 整改版本冲突、旧复核失效与最新证据绑定（CI-only）
- 每个失败项的整改记录新增正整数 `remediation_version`，按 `(organization_id,failure_id)` 独立连续递增。数据库触发器在事务级锁保护下拒绝跳号、并发抢号和重复使用相同证据 SHA-256。历史失败和每个整改版本均不可修改或删除。
- 受控 `fixture_record_uat_remediation_review` 仅接受**当前最新整改版本**，且每份审核传入的证据摘要必须与该版本 `new_evidence_digest` 相同；旧版本即使历史上已有两项 ACCEPTED_FOR_REVIEW，后续也不允许继续补签或挪用到最新版本。
- `fixture_uat_remediation_diagnostics` 统计总尝试次数、最新版本和最新整改 ID，但 `accepted_review_roles` **只统计最新版本的 ACCEPTED_FOR_REVIEW**；出现新版本后自动归零，新的 REJECTED 决定不当作通过。历史审核可保留用于追溯，不继承授权。
- 测试覆盖 v1→v2→v3：跳号、历史证据复用、复核指向过时版本、证据摘要不匹配、拒绝意见、新版复核重新计数、旧记录不可改，以及始终 `hold_active=true`、`release_eligible=false`。
- 这里的“审核通过”只是隔离模拟的诊断计数，不是正式 IAM 身份签署或真实业务解除隔离授权；继续保持 Draft、HOLD、CI-only、不合并、不部署。

## V121 并发整改与审核竞争一致性（CI-only）
- 新版整改 INSERT 与复核函数采用同一机构+失败项的 PostgreSQL 事务级 advisory lock。审核先根据整改 ID 查询失败项锁作用域，获得锁后**重新进行最新版本、证据摘要、人员独立性与 HOLD 校验**，并在该锁保护下提交复核，避免版本切换期间的检查-写入竞争。
- 并发测试同时提交两个 `remediation_version=4` 候选，要求严格恰好一个成功、另一个被版本递增或唯一键规则拒绝；旧版证据、失败候选 ID 均无法获取新版复核。另测试 v5 版本新增与 v4 最后一次复核竞争：v4 复核可以在线性化时先于新版本提交，也可能被拒绝，但**v5 的最新复核计数必须为 0**，不会继承 v4 的任何审核结论。
- 事故紧急停止仍保持启用；销售/财务/教务 HOLD 不存在解除路径。此锁仅在本隔离 PostgreSQL 实例中提供顺序化，不保证跨真实系统/服务的全局一致性。正式上线还需要真实 IAM、审计源、跨库消息边界和 UAT。

## V121 整改与复核重试幂等性、提交前断连（CI-only）
- 新增 `fixture_submit_uat_remediation` 受限 SQL 入口，按 `(organization_id,remediation_id)` 作为幂等键，持有机构+失败项的事务级 advisory lock。只有同一失败项、版本、证据、整改人员、备注全部一致且仍是**当前最新整改版本**，才返回 `ALREADY_RECORDED`；新提交返回 `RECORDED`；同 ID 不同负载拒绝 `V121_REMEDIATION_IDEMPOTENCY_CONFLICT`，过期版本拒绝，事故 STOP 不存在或已关闭时 fail closed。
- `fixture_record_uat_remediation_review` 在原有最新版本检查、证据绑定和事故 HOLD 验证之后，支持同一复核职责、同一人员、相同意见及证据的**严格幂等重试**。复核职责相同而内容改变则拒绝 `V121_UAT_REVIEW_IDEMPOTENCY_CONFLICT`；不同身份跨审核职责仍要求独立。记录始终只追加，不覆盖历史。
- PostgreSQL CI 测试以 `BEGIN`→写入→`ROLLBACK` 模拟异常回滚，并用 `pg_terminate_backend` 在事务已执行、但未 COMMIT 时主动终止模拟客户端连接；两者均不得保留半提交的整改。随后两个同参数请求同时重试，应只生成一条记录；审核的事务回滚、双请求重试和冲突重试同样受检。最终三个模块均保持 HOLD，安全告警未解决，仍禁止恢复密钥发行。
- 限制：这是同一 PostgreSQL 事务内的精确重试验证，不能替代跨服务的可靠投递、断网分区及多数据库分布式事务演练。真实 IAM、外部密钥托管、独立不可改审计和生产 UAT 仍未完成。继续 Draft / CI-only / 不合并 / 不部署。

## V121 冷启动状态重建与历史一致性检测（CI-only）
- 新增受限、只读的 `fixture_rebuild_uat_state(organization_id, failure_id)`。只有独立测试账号 `v106_state_reader` 可调用，SQL 函数从 PostgreSQL 已提交持久记录重新计算整改版本总数、最新版本/整改 ID、最新版本通过复核的职责数量、原始告警来源、复核记录和整改证据的一致性、三模块 HOLD 完整性及事故紧急停止状态。不使用服务进程缓存、不写入业务或审批状态。
- 检测规则包括：版本必须从 1 连续到当前最大值、每版证据摘要不得重复；审核证据必须对应其整改版本，审核人不得与整改人/原失败审核者重叠或跨双职责冒用；事故对应的 SALES / FINANCE / ACADEMIC HOLD 必须齐全，已认证外部告警和紧急停止必须存在。明确返回 `HISTORY_INCOMPLETE`、`REVIEW_INTEGRITY_INVALID`、`CROSS_MODULE_HOLD_INCOMPLETE`、`ALERT_PROVENANCE_MISSING` 或 `EMERGENCY_STOP_MISSING`，正常历史也只返回 `REBUILT_STILL_HOLD`。
- 隔离 PostgreSQL 测试使用新数据库客户端模拟状态读取服务重建、客户端关闭再连接，并断言两次读取完全一致。测试超级管理员临时模拟版本跳号、审核摘要被破坏和教务 HOLD 行丢失；新连接必须检测异常，恢复测试数据后状态重新一致。测试角色不能直接读取或修改基础记录，不能跨租户重建。
- 所有重建结果恒定 `hold_active=true`、`release_eligible=false`，**并不是恢复批准或生产数据修复**。本轮只覆盖单个隔离 PostgreSQL 实例的已提交可见状态；外部历史真实完整性、跨服务日志比对、进程崩溃后的真实部署恢复、可信备份和正式 UAT 仍待独立验收。继续 Draft、CI-only、不合并、不部署。

## V121 状态快照与重建历史交叉校验（CI-only）
- 新增不可变的 `fixture_uat_state_snapshots` 作为隔离数据库内的**模拟快照基线**。每个机构和验收失败项的 `snapshot_sequence` 必须严格连续递增；UPDATE/DELETE 受阻。快照记录重建版本、最新版本接受复核数、完整历史状态 SHA-256 指纹，以及固定 HOLD / 禁止释放。**快照由隔离测试管理员写入，未连接独立备份、第三方时间戳或外部 WORM 存储。**
- `fixture_observe_uat_snapshot` 使用确定性顺序构造历史指纹，纳入事故与原失败证据、各整改版本 ID 与证据/备注摘要、每个版本复核职责和结论、三模块 HOLD 记录、紧急停止及重建状态。仅授权独立 `v106_state_reader` 调用，不授予底层表权限。
- `fixture_verify_uat_snapshot` 将**最新快照**与当次历史重建及状态指纹交叉校验：快照不存在返回 `SNAPSHOT_MISSING`；新整改版本超过快照返回 `SNAPSHOT_STALE`；版本或历史指纹不一致返回 `SNAPSHOT_VERSION_CONFLICT` / `SNAPSHOT_MISMATCH`；重建本身出现缺失与异常则优先返回 `REBUILD_INVALID`。完全相符也只返回 `SNAPSHOT_MATCH_STILL_HOLD`。
- PostgreSQL 测试覆盖未建快照、跳号和不可变性、复核新增造成指纹变化、新整改造成旧快照过期、更新快照后匹配，以及模拟管理员篡改历史备注但保持版本数量不变时仍能发现指纹不一致。模拟数据恢复后重新匹配，全程 `hold_active=true`、`release_eligible=false`、安全停止保持启用。
- 此指纹用于测试**同一数据库内的历史与快照一致性**，并不能证明快照具有外部不可篡改性：如果高权限攻击者同时修改历史和快照，单库比较可能无法发现。后续需要独立不可篡改锚点、签名快照、可信时间、独立恢复主体及真实跨模块 UAT。继续 Draft、CI-only、不合并、不部署。
