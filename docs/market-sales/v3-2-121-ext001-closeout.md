# V3.2-121 / EXT-001 隔离开发收口

## 固定范围与完成判据

本轮只交付三项：外部锚定服务不可用、签名密钥撤销后的历史核验、检查点存储故障的失败保护。继续使用 Draft PR #129，不新开 PR，不追加下一阶段模拟契约。

完成判据是这三项代码、故障测试、现有 PostgreSQL 16 集成测试和跨阶段审计通过，并记录证据边界。满足这些判据即结束本轮隔离开发；不会自动转入生产验收或反复细化新的模拟能力。

## 已实现行为

- `appendFixtureIamKeyCheckpoint` 从调用方固定的外部 head 摘要开始，读取并验证已有检查点，核验历史前缀后请求签名。新签名者必须为 ACTIVE。读取、信任注册表或签名服务不可用或超时均返回失败，不使用本地缓存代替外部检查点。
- 使用按租户原子 compare-and-append 的适配器接口。并发写入只有匹配固定 head 的操作可成功；写入后必须重读同一检查点与上一检查点，并再次读取签名者状态、检查签名与时效。
- 写入拒绝、无确认、超时、重读丢失或内容变化均失败。写入后的撤销或过期也失败。失败不等于外部写入回滚；已经保存的记录继续用于取证。写入结果不明时必须先核对外部 head，不自动换 pin 重试。
- `inspectFixtureArchivedIamKeyAnchor` 接受可信注册表中已撤销签名者的公钥，核验签名、租户、事件链、历史前缀与最低事件数量。过期历史只返回 `HISTORICAL_FIXTURE_KEY_AUDIT_ONLY`；当前核验入口继续拒绝撤销密钥。新 ACTIVE 签名者可以延伸经取证核验的旧签名者检查点。
- 所有成功结果仍保持 `hold_active=true`、`release_eligible=false`、`release_authorized=false`、`production_evidence_collected=false`；历史核验明确 `current_authority=false`、`pre_revocation_issuance_proven=false`。

## 测试与证据

本轮沿用现有工作流 `.github/workflows/v3-2-121-m02-notices.yml`，不添加新的 CI 阶段：

- 合约测试：原有全部 V121 用例，加上签名服务拒绝/超时、注册表故障、存储读取/写入/重读故障、确认丢失、并发冲突、签名期间和写入后撤销、过期、伪造、撤销后历史核验与签名者轮换。
- PostgreSQL 集成：从真实一次性 PG16 重连读取的密钥事件行，验证签名服务失败、外部写入确认丢失和撤销后的历史取证。没有修改 SQL 表、授权或业务数据路径。
- 结果以对应提交的 GitHub Actions 为准。绿色 CI 仅结束隔离开发，不改变外部验收状态。

## 人工依赖与停止边界

EXT-001=UNVERIFIED；HOLD=true；release_eligible=false；PR 保持 Draft / CI-only。merge_authorized=false；deploy_authorized=false。其余生产缺口和六方签署保持原状。

| 人工责任域 | 所需真实证据 | 当前状态 |
| --- | --- | --- |
| SECURITY | 真实 IAM、主体权限和撤权记录、实名责任人独立复核 | NOT_COLLECTED / NOT_REVIEWED / NOT_SIGNED |
| SECURITY | 独立 KMS/HSM、不可导出密钥、撤销生效和失陷响应验收 | UNVERIFIED |
| AUDIT / OPERATIONS | 外部 WORM、可信时间、备份、原子存储行为及故障恢复实测 | UNVERIFIED |
| SALES / FINANCE / ACADEMIC | 外部订单、资金、履约等业务证据独立对账 | NOT_COLLECTED / NOT_REVIEWED / NOT_SIGNED |
| 六方责任人 | 生产 UAT、隔离解除和发布审批 | NOT_SIGNED |

这些是人工验收依赖，不是继续生成模拟契约的任务列表。用户另行确定生产验收范围并提供真实环境与授权前，开发推进在本轮判据处停止。

## 明确限制

外部 store 和信任注册表仍为 CI 内存适配器；接口要求不证明真实服务具备 WORM 或原子性。超时只停止等待，不能保证远端操作已取消。重读和返回之间仍有跨系统竞态。本轮没有实现生产分布式原子撤权，也没有接入真实 IAM/KMS。

历史有效签名不证明签署时间早于撤销；密钥失陷后可能生成回填日期的签名。可信时间、独立存档固定和密钥失陷调查必须由外部真实证据提供。CI fixture 私钥、内存存储及同一执行环境不能替代这些证据。
