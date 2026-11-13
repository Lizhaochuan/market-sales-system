# V3.1-02：市场销售系统与 CRM API 接口契约（独立技术设计）

**编号**：MS-API-001；**版本**：V3.1-02；**状态**：拟议合同（DRAFT，未部署、未验收）  
**基线**：需求 V2.8（BR-M04-001）/ 技术 V3.0 / V3.1-01 数据库设计 PR #1  
**仓库**：Lizhaochuan/market-sales-system；**当前 CRM 核查参考**：edu-management-system/work 提交 30c097f3776caf709b2a55577f3f98d83c09f928（不是生产部署验证）  
**文档融合边界**：只在市场销售独立仓库维护；真实联合集成及验收完成后，才与既有 CRM 技术文档融合。

> **重要**：本文中以 /integration/v1 开头的路径是**提议 CRM 未来新增的接口**，不是现有 CRM 已有路由。新市场销售系统自己的 /api/v1 端点也尚未开发。随附 OpenAPI JSON 是可供接口评审的机器可读草案，不等于可以直接调用。尤其不能把 CRM 当前的管理员通用数据库接口当作市场销售对外接口。

## 1. 三类系统和唯一权威

| 系统/接口边界 | 拥有的事实 | 不应拥有的事实 |
|---|---|---|
| 新市场销售系统（/api/v1） | 学生销售档案、联系人、可选家庭关系、线索、商机、跟进、报价快照、订单、业绩和营销报表 | CRM 真实课时和教学排课、真实银行到账 |
| 既有教培 CRM（拟议 /integration/v1） | 正式学员标识、课程及标准价、教师/班级/教室、权威试听预约、购买课时权益、实际消课 | 原始获客归因、销售商机及销售人员业绩 |
| **待指定**的财务权威（独立 adapter） | 权威收款、退款、交易撤销事实和真实财务流水 | 不能由销售人员自行确认真实到账 |

**独立数据库**：新系统使用自己的数据存储；不编辑 CRM 的 data/db.json、不共享数据库写入、不用跨系统单一 SQL 事务。

**关键阶段区别**：线索、商机和草稿报价可在 CRM 未准备好时独立推进；CRM 试听、正式学员创建、课程权益、财务成交不能用假的“已成功”状态替代真实结果。

## 2. HTTP 合同通用规则

### 2.1 传输、身份与授权

- 强制 HTTPS，正式部署禁止明文 HTTP、Query Token、把密码/私钥存进库；服务身份使用独立凭据与最小权限（例如经过批准的 OAuth2 客户端凭据或短期签名服务令牌，具体协议待双方架构评审）。
- 对内员工 API：使用新销售系统员工会话或权限令牌；所有权限由服务端判断；从令牌认证真实员工，不信任请求体自报 user_id/role。
- 对 CRM 集成 API：仅 M13 服务身份可调用；每条接口实施服务级 scope 和**具体对象授权**；不能复用 CRM 超级管理员登录态，也不能返回全量学生资料。
- 机构上下文必须从认证服务身份的授权租户推导或经授权核验，**不得只信任请求参数中的 organization_id**。
- 共享联系人、同电话、同家庭均不提供跨学生访问或批量修改权限；日志中只记录安全关联标识，不写原始电话、微信号、授权密钥或真实账单细节。
- 身份查询中敏感匹配信息建议使用 POST 请求体，避免手机号和其他私人信息进入查询 URL、代理访问日志及浏览器历史。后续可保留只允许可信学号的 GET 查询。
- 返回用户能理解的中文 message，但禁止将内部错误栈、原始 JSON 业务快照、数据库字段或凭据直接显示为员工界面说明。

### 2.2 请求与返回格式

建议统一：
- Header：Authorization: Bearer <受控令牌>、X-Request-Id: <单次请求链路追踪值>。
- 所有**创建或改变业务事实**的 POST：Idempotency-Key（16~128 字符、按来源/业务操作命名空间唯一），必要时 If-Match 或 expected_version 做并发保护。
- 响应成功：code="OK"、message="中文业务结果"、request_id、data、source_version（权威系统版本，适用时）。
- 响应错误：code（稳定机器错误码）、message（中文）、request_id、retryable（仅网络传输/短暂资源失败等可安全重试场景），必要时 current_version。
- 统一人民币金额：amount_cents（整数分）、currency="CNY"。时刻使用 UTC RFC3339，课程课时数量用 decimal string 或精确十进制，时长 duration_minutes 独立，不允许把 1.5 课时当 1.5 分钟。
- 分页 GET 必须限定 page_size 上限、过滤对象权限、返回 next_cursor；列表和汇总不允许绕过对象字段权限。
- 版本：破坏性合同变更走 /v2，不悄悄复用同名字段；可选字段应保留向后兼容，明确弃用计划。

### 2.3 幂等、重试和状态核实（强制）

同一 Idempotency-Key + 同业务主体 + 同规范化负载：
1. 第一次成功：只创建一份实际业务事实，持久保存请求摘要与结果。
2. 重复发送：返回原结果或与其等价的最终状态；不能创建第二个学生、试听预约或课时包。
3. 同键不同内容：409 IDEMPOTENCY_CONFLICT；不可覆盖原请求。
4. 连接中断、5xx、响应丢失：**结果未知 UNKNOWN**；前端展示“结果待核实”，必须先 GET /integration/v1/requests/{requestKey} 查询，再根据查询结果用**原键原负载**继续安全恢复，绝不盲目换新键。
5. CRM 明确拒绝：业务规则冲突、无效价格、时段占用、权限不足等不应自动改写请求参数再次提交。
6. 消息队列不是交易事实源；M13 使用本地业务事务 + outbox + inbox + 原始请求持久键 + 对账。跨系统调用不承诺分布式原子事务。
7. 如果 CRM 的原请求记录丢失或状态不可靠，保持 manual_review，不得简单以“查不到”认定第一次未执行并生成新键。

**注意**：当前 CRM 仅有内部 command 信封幂等机制及有限回执容量，并不代表上述跨系统长期请求结果查询已经实现。

## 3. 市场销售系统自身 API（草案）

下列 API 归新市场销售系统所有，路径均为示例，**不需要在 CRM 仓库创建这些业务对象**。

| 方法 | 路径 | 输入要点 / 结果 / 权限 | 状态 |
|---|---|---|---|
| POST | /api/v1/leads | 可仅有关联联系人和来源；返回线索编号；销售/主管 | 拟建 |
| POST | /api/v1/leads/{leadId}/students | 指认一个或多个学生并保存证据；不得按电话自动合并 | 拟建 |
| POST | /api/v1/students | 学生档案，姓名与归属；不自动创建家庭组 | 拟建 |
| POST | /api/v1/students/{studentId}/contacts | 关联共享联系人及关系核实/监护授权；按学生权限 | 拟建 |
| POST | /api/v1/family-groups | 仅确认至少两名同一家庭学生后激活；保留证据 | 拟建 |
| POST | /api/v1/opportunities | student_id 必填，负责人默认学生负责人，可授权改派 | 拟建 |
| POST | /api/v1/interactions | 一次真实沟通记录一次，可明确关联多个学生/商机 | 拟建 |
| POST | /api/v1/trials | 发起预约任务，不代表 CRM 已确认；返回 requested | 拟建 |
| GET | /api/v1/trials/{trialId} | 同步状态、真实 CRM 预约编号、失败及待核实情况 | 拟建 |
| POST | /api/v1/quotes | CRM 标准价来源版本、学生、商机、项目数量和优惠明细 | 拟建 |
| POST | /api/v1/quotes/{quoteId}/submit-approval | 绑定版本提交特殊优惠审批；不可旧审批跨版本使用 | 拟建 |
| POST | /api/v1/orders | 根据有效报价生成**一名学生**订单和明细 | 拟建 |
| POST | /api/v1/orders/{orderId}/allocation-proposals | 只提交带依据的付款分配**申请**，不直接确认到账 | 阻断 BP-02/TP-03 |
| GET | /api/v1/orders/{orderId}/settlement | 应付、权威核实已分配、未付、成交/权益状态独立输出 | 拟建 |
| POST | /api/v1/sales/{saleId}/credit-approvals | 授权审批多人业绩分配/版本，不可重复增加机构成交 | 拟建 |
| GET | /api/v1/integrations/tasks | 授权查看集成任务状态，支持待核实与人工处理 | 拟建 |
| GET | /api/v1/reports/acquisition | 学生新客、首次来源与商机来源清晰区分 | 拟建 |
| GET | /api/v1/audit | 按业务对象授权返回**可理解的中文变更** | 拟建 |

用户只能请求自己有权操作的学生和商机；不允许通过共享联系方式绕过权限，报表仅聚合已授权且明确口径的数据。

## 4. 提议 CRM 新增的 /integration/v1 接口

**以下接口全部需要 CRM 技术负责人审阅、实现或适配；不是现有 CRM 已提供的稳定接口。**

| 方法 | 路径（拟建） | 请求重要字段 | 响应重要字段 / 保证 |
|---|---|---|---|
| POST | /integration/v1/students/lookup | lookup_kind、trusted_student_ref 或受控候选条件 | 0/1/多候选，最小字段，可信身份与仅相似候选分开 |
| POST | /integration/v1/students/ensure | trusted identity/approved provisional trial intent、Idempotency-Key | crm_student_id、身份验证状态；不直接开通课时 |
| GET | /integration/v1/courses | cursor、limit、only_sellable | 课程/班型/计费单位/标准价格/版本/可售时间 |
| POST | /integration/v1/availability/search | course_id、指定时段、教师或班级及校区 | 可用候选、资源版本、expires_at；仅供展示，不占位 |
| POST | /integration/v1/trials | CRM 学员编号、课程、时段、资源候选版本、Idempotency-Key | **原子冲突验证并占用资源**、crm_trial_id、confirmed/明确拒绝 |
| POST | /integration/v1/trials/{trialId}/reschedule | 原预约编号、目标时段、expected_version、Idempotency-Key | 原子完成改期或明确冲突，不能先取消后误丢预约 |
| POST | /integration/v1/trials/{trialId}/cancel | 预约编号、expected_version、理由、Idempotency-Key | 释放资源、保留审计和状态 |
| GET | /integration/v1/requests/{requestKey} | 原请求键 | 原操作 pending/confirmed/rejected/unknown、原业务结果 |
| POST | /integration/v1/entitlements | studentId、external_order_item_id、课程、付费/赠送课时、权威付款依据及策略版本、Idempotency-Key | crm_package_id、交接状态，领域防重 |
| GET | /integration/v1/entitlements/{entitlementId} | CRM 课程权益编号 | 已创建/撤销/待核实、业务版本和来源 |

### 4.1 学员查询与正式身份（M04/M13）

- 市场销售先检查本地 crm_identity_links。已有效关联且双方编号一致时复用。
- CRM 若有**可信且唯一、经 CRM 验证**的正式学号，可以返回 verified_unique；才允许自动关联。
- 同名、同电话、共用家长或疑似年龄匹配，返回 candidates 或 needs_human_review，只能人工核实，不自动合并。
- 身份未知且 CRM 查询报错时，**不能“查不到就新建”**。
- 新学生未报名但申请试听时可能需要 CRM **临时试听身份**；当前 CRM 内部试听登记仍要求 student_id。上面的 ensure 只表述拟议能力，不代表可直接创建正式已报名学员；必须保证 trial_provisional 身份不自动形成缴费与教学权益，开发前核实 CRM 是否能支持。
- 两个兄弟姐妹始终分别拥有自己的 CRM 学员映射，家庭关联不会被同步成一个“合并学生”。

### 4.2 课程与报价（M08）

- CRM 返回当前可售课程标准价、货币、计费单位和源版本。班级**特殊价格**不能冒充标准价格；只有经正式授权的规则才能作为可用报价依据。
- 没有可信价格源、版本或有效性时，销售可保存草稿，但不得伪称已生成可正式履约报价。
- 报价保留原价/优惠/最终价的不可覆盖快照；BP-03 “价格变动后旧报价是否继续有效”仍待负责人决策。
- 一份报价只有一名学生，一个订单默认一名学生。家庭折扣（BP-04）必须逐学生/课程明细落实。

### 4.3 试听预约（M07）

1. 市场销售 POST /api/v1/trials 建本地请求记录：state=requested。
2. M13 先完成该学生的受控 CRM 身份核验，不能以同电话代替身份核验。
3. CRM availability/search 查询只是信息提示；真正 POST /integration/v1/trials 必须在 CRM **原子再校验**教师、班级、教室和时段冲突，成功时持久分配预约标识。
4. 收到 crm_trial_id + confirmed 才能显示“预约成功”；暂未响应或 5xx 显示“结果待核实”。
5. 取消和改期使用原预约版本与唯一操作键；原确认记录不被删除，试听实际反馈仍以参与学生分别记录。
6. 试听学生不自动计入正式班级开班人数、不扣付费课时、不自动成为已报名缴费学员。符合现有 CRM 试听生基础规则，但新增的预约与资源锁仍待实现。

### 4.4 订单、财务事实与发课（M09/M13）

**特别区分三件事：**
- 市场销售订单和应付金额：由市场销售系统管理。
- 家长实际付款与退款：由**尚待正式指定的财务权威**证明，且有可验证外部交易唯一标识。
- 课程权益/课时包：由 CRM 负责生成，且每条有效订单明细最多一次。

#### 组合付款

家长实际确认付款 6,000 元，哥哥订单 6,000 元，妹妹订单 4,000 元：

- 分配哥哥 6,000 元、妹妹 0 元：哥哥在其他条件满足时可成交，妹妹不成交。
- 分配哥哥 3,000 元、妹妹 3,000 元：两个学生均未全额付款，均不成交。
- 用途不清：保留待分配，不默认给任何学生成交。

**BP-02：** 收款分配由谁根据何种证据确认尚未冻结。/allocation-proposals 只创建提案，不能让销售单方面“核实到账”。有效分配需经授权财务事务确认后，单订单独立计算已付净额。

#### 发放 CRM 课时权益

- 不得因为销售把本地 payment_state 改为 fully_paid 就触发发课。
- 生成正式成交仅由“订单有效 + 已权威确认且足额的付款分配 + 无业务异常”组成。
- 是否在**付款未足额时提前上课/发课**属于 BP-01；未经批准先禁止自动发放。
- 发送正式权益必须携带市场销售 order_item_id 作为领域唯一性依据；CRM 实际生成的 package_id 需持久映射。单条明细重复请求、断线恢复或服务重启均不能发第二份权益。
- 当前 CRM 存在手工付款对账及 package.purchase，但它只面向既有学生/课程和单付款凭据；**不能**视为已满足兄弟姐妹组合付款、正式新销售订单映射与权益幂等合同。
- 退款发生后新增退款事实和销售业绩调整；不能删除原 SaleEvent 或重新认定一个首次成交。

## 5. 典型消息与错误语义

### 5.1 正确的“结果待核实”示例

对 CRM 发起试听确认，得到网络连接中断。客户端不能显示“预约失败，请再次提交”，也不能显示“已预约成功”。

建议反馈业务语言：**“试听预约正在核实。系统会继续查询原预约结果，请不要重复提交。”**

自动任务使用原始请求键查询结果，并显示对应 CRM 编号或明确失败原因。若无法安全核实，进入人工处理，保留全部证据。

### 5.2 统一错误表

| HTTP | code | 业务含义 | 动作 |
|---|---|---|---|
| 400/422 | VALIDATION_ERROR | 字段、金额、计费单位错误 | 修正业务输入；不是网络重试 |
| 401 | AUTH_REQUIRED | 身份凭据失效 | 重新授权；旧业务请求状态仍需核实 |
| 403 | FORBIDDEN | 对当前学生/课程/操作无权限 | 拒绝并审计，禁止改用超管共享账号 |
| 404 | NOT_FOUND | 该业务对象不存在或不可见 | 防资源枚举；不得泄露其他学员 |
| 409 | IDEMPOTENCY_CONFLICT | 同请求键不同内容 | 阻止覆盖；人工核实 |
| 409 | VERSION_CONFLICT | 业务版本已变化 | 刷新权威信息、重新判断 |
| 409 | RESOURCE_CONFLICT | 教师、教室或课程资源冲突 | 换合法时段并生成**新的业务意图** |
| 409 | STUDENT_MATCH_AMBIGUOUS | 学员候选多名/身份不可信 | 人工核实，不自动建正式学员 |
| 409 | PRICE_STALE | CRM 价格或可售状态变更 | 重查 CRM，依据 BP-03 确定履约 |
| 409 | PAYMENT_NOT_VERIFIED | 缺乏权威付款证明 | 禁止正式成交及自动发课 |
| 409 | ALLOCATION_UNCONFIRMED | 尚未形成有效分配 | 无法将订单判定付清 |
| 429 | RATE_LIMITED | 请求频率过高 | 尊重 Retry-After；不能变更原请求键 |
| 500/502/503/504 | OUTCOME_UNKNOWN | 写请求可能已执行但响应不明 | 查原请求结果，再同键恢复，不生成第二业务事实 |

**重要补充**：HTTP 5xx 本身不等于“CRM 明确失败”，反之成功的 HTTP 200 也必须检查 data.status 和来源对象编号。认证或接口策略发生变化时不可悄悄跳过受控验证。

## 6. 接口对象、最少字段及样例

### 6.1 学生身份查询（只读 POST，因为可能含个人信息）

请求：
```json
{
  "lookup_kind": "trusted_external_id",
  "external_tenant": "default",
  "trusted_student_ref": "CRM-STU-001"
}
```
响应：
```json
{
  "code": "OK",
  "message": "找到一名已核实的学员",
  "request_id": "trace-lookup-01",
  "data": {
    "match_status": "verified_unique",
    "crm_student_id": "stu_1",
    "identity_proof": "trusted_crm_student_reference",
    "source_version": "crm-student-rev-17"
  }
}
```
上例字段与编号均为**草案和虚构示例**，不证明实际 CRM 已支持。

### 6.2 课程价格查询

响应每门课程应至少提供：
```json
{
  "crm_course_id": "crs_1",
  "display_name": "少儿机器人编程",
  "class_type": "1v3小班",
  "standard_price_cents": 18000,
  "currency": "CNY",
  "billing_unit": "teaching_hour",
  "duration_minutes": 90,
  "sellable": true,
  "source_version": "price-rev-05"
}
```
**单位说明**：90 分钟是此示例课程的一次上课时长，并不直接证明一个“课时”是多少分钟；计价单位与教学时长须以 CRM 实际定义为准。

### 6.3 试听预约（有真实资源验证才返回 confirmed）

请求：
```json
{
  "crm_student_id": "stu_1",
  "crm_course_id": "crs_1",
  "slot_start": "2026-11-21T01:00:00Z",
  "slot_end": "2026-11-21T02:30:00Z",
  "class_id": "cls_1",
  "availability_version": "slot-rev-23",
  "external_trial_request_id": "sales-trial-unique-001"
}
```
请求头 Idempotency-Key: sales-trial-unique-001。
CRM 必须原子验证仍可预约，成功后才返回独立 crm_trial_id 和 confirmed 状态；如果资源已被占用，明确拒绝，不伪造预约。

### 6.4 课程权益交接

请求：
```json
{
  "external_order_item_id": "order-line-001",
  "crm_student_id": "stu_1",
  "crm_course_id": "crs_1",
  "paid_units": "20.0000",
  "gift_units": "2.0000",
  "billing_unit": "teaching_hour",
  "financial_evidence_ref": "verified-finance-evidence-001",
  "entitlement_policy_version": "approved-policy-version"
}
```
申请人和财务依据由服务端核实，不能靠请求文字“已付款”就创建权益。BP-01 未批准前，未付清订单默认拒绝发放。CRM 必须用外部订单明细领域键做永久防重。

## 7. 安全、运营与可观测性

- 外部集成使用独立凭据、IP/网络边界如适用、TLS、密钥轮换和 scope 白名单；不会共用 CRM 超管密码。
- 权限检查：本人学生、本商机、允许的字段；家长共享联系人不扩展对兄弟姐妹敏感资料的阅读权。
- 涉及真实个人信息的查询要有最少字段和留痕；访问日志留 request_id 而不是手机号/完整请求体。
- API 限流不能导致不确定的已发课事件被二次执行；监测请求积压、UNKNOWN 比例、重复请求、安全拒绝、对账差异。
- 审批与审计界面必须展示“原学生/新学生”“原金额/新金额”“状态及原因”这种中文业务语义，不直接暴露 JSON、程序栈或数据库列名。
- 响应字段中本人权限之外的信息须**物理省略或脱敏**，不可依赖前端隐藏。
- 集成对账应核实学生映射唯一、试听真实确认、订单-实收-发课金额及次数一致；异常进入可追踪人工处理。

## 8. 接口交付与负责边界

| 交付成果 | 归属 | 何时才能宣称完成 |
|---|---|---|
| 本文和两个 OpenAPI 草案 | market-sales-system | 完成设计并审核，仅可称“合同草案” |
| /api/v1 内部业务端点 | 新市场销售系统 | 服务端实现 + 对象权限/业务测试通过 |
| /integration/v1 CRM 端点 | 原有 CRM 仓库未来独立 PR | CRM 侧代码审核、隔离测试、对接签名/权限审查 |
| 财务权威凭证来源 | 后续指定的财务系统与财务负责人 | 实际确认交易证明、退款和分配审计 |
| 联合 API 集成与验收 | 双系统 | 部署版本/请求追踪/端到端、故障恢复及 GUI 证据齐全 |
| 技术文档融合 | 项目负责人批准的最终阶段 | 完成真实双系统集成和联合验收后才实施 |

**当前仅推进 API 契约设计；未修改现有 CRM 任何接口或代码。**

## 9. 必须保留的待确认事项

- **BP-01**：部分付款先开课/先建课时权益的政策和审批边界。
- **BP-02**：家长组合付款的分配依据、谁可以确认、误分配纠正。
- **BP-03**：有效期内 CRM 改价后旧报价是否保障。
- **BP-04**：家庭优惠分配到两个学生订单各条明细的规则。
- **BP-05**：退款影响提成及已发业绩的处理。
- **BP-06**：多校区/多机构边界。
- **TP-01**：CRM 权威课程标准价是否提供可核实价格版本。
- **TP-02**：CRM 临时试听身份、排课资源冲突检查。
- **TP-03/04**：实际财务权威、付款交易与跨学生订单分配。
- **TP-05**：每订单明细在 CRM 的永久业务防重标识。
- **TP-06~08**：真实部署版本、服务凭据、测试/预发布及设备验收。

## 10. 下一阶段

V3.1-03 实施前的优先技术任务是：将上述接口契约中的状态机与数据库 V3.1-01 的不变量逐一建立服务端事务测试，完成隔离环境 CRM stub/contract test；只有 CRM 侧接口正式实现并通过联合测试后才更改端点的“拟建”标识。
