# 市场与销售系统（Market Sales System）

本仓库独立管理市场与销售系统的需求、技术设计、代码和验收记录。

**项目定位：** 与现有教培 CRM 分离开发、分离数据库，通过经过授权的 API 集成。既有 CRM 的技术文档与本项目文档暂不融合。

## 最新交付状态（V3.2-48 · 独立收敛审查）

- **[市场销售模块交付收敛与 M01—M14 证据差距报告](docs/V3.2-48_MARKET_SALES_DELIVERY_CLOSURE.md)**：在已有隔离实现基础上逐模块区分设计、部分运行能力及真实外部权威阻断。
- [机器可读 PR 主线及验收清单](spec/v3-2-48-delivery-closure-manifest.json)：当前主线 Draft PR #4—26、#28—36、#39—54；不选用并行 #27、#37、#38，避免误并入重复迁移 032/035。
- [V3.2-49 未选方案独有功能与迁移冲突审计](docs/V3.2-49_ALTERNATE_PR_DELTA_AUDIT.md)：逐项核对 #27/#37/#38 与被选主链的实际 SQL/功能差异；暂不丢弃独有需求，不直接重放冲突 027/032/035，等待明确安全评审。
- [V3.2-50 财务＋教务联合只读 UAT 阻断报告](docs/V3.2-50_JOINT_BLOCKED_UAT_READONLY.md)：复用现有 035 受限 SQL 和安全 LOGIN，在隔离测试环境将两份 12 项报告组合为 16 项，保留不同来源缺失计数。不新增数据库迁移，不对外开放正式 API。
- [V3.2-51 M01 渠道目录隔离只读接口](docs/V3.2-51_M01_CHANNEL_CATALOG_READONLY.md)：复用 001 渠道表，提供按机构过滤、层级及停用继承校验的可运行 GET；严格员工模式仍拒绝，渠道 CRUD、真实归因与生产联调未开放。
- [V3.2-52 M01 中文获客渠道只读工作台](docs/V3.2-52_M01_CHINESE_CHANNEL_WORKBENCH.md)：在虚构业务演示中展示真实机构渠道树，区分自身停用与上级停用，并通过 Chromium 检查脚本注入、刷新失败清空、退出清空和移动窄屏；严格员工模式继续禁止。
- [V3.2-53 M01 严格员工受限渠道目录](docs/V3.2-53_M01_STRICT_SCOPED_CHANNEL_READ.md)：后续独立增量在 CI 一次性数据库中通过 PostgreSQL SESSION_USER 安全视图与签名员工身份实现严格模式只读渠道目录；不复用宽权限登录、不增加数据库迁移或生产授权。
- [V3.2-54 M01 渠道维护申请与独立主管审批](docs/V3.2-54_M01_CHANNEL_MAINTENANCE_APPROVAL.md)：在 CI 一次性数据库中使用受限员工写入函数，实际测试新增、编辑、停用的申请、复核、历史审计与防重复；只有不同销售主管批准后才会修改虚构渠道。尚未开放正式写入界面或生产迁移。
- [V3.2-55 M01 中文渠道维护申请与主管审批工作台](docs/V3.2-55_M01_CHANNEL_REVIEW_WORKBENCH.md)：在原获客渠道页面接入严格签名员工申请与另一名销售主管审批表单；通过只读受限视图展示本人记录及同机构可审待办，退出与接口失败后清空数据，不开放真实渠道、生产权限或财务联调。
- [V3.2-56 M01 渠道变更审计时间线与权限隔离](docs/V3.2-56_M01_CHANNEL_AUDIT_HISTORY.md)：复用原 audit_events 的只读最小投影，只允许本人申请、本人已审核及当期可审事件；不暴露原审计 JSON/证据，读取异常禁用渠道写入 UI，CI 验证无原始表权限。
- 上游 **PR #54** 在自身最新 HEAD `9f438cdbb9ab85cb0a3ea2686b8d927c2e7bcb0a` 的 [隔离 CI #43586142266](https://github.com/Lizhaochuan/market-sales-system/actions/runs/43586142266) 已成功。**不代表主分支已合并、业务 M01—M14 全部完成或真实财务/CRM UAT 通过。**
- PostgreSQL 迁移仍限于 001—038；生产对接、正式收退款/课时、补偿与真正错绑的 `hold_active` 解除继续阻断。旧 `edu-management-system` 不改动，技术文档不提前融合。

## 当前技术文档 · V3.0

- [市场与销售系统技术规格说明书](docs/MARKET_SALES_TECHNICAL_SPEC_V3.0.md)：涵盖 M01—M14、数据模型、状态机、API 设计及验收。
- [经营决策与技术阻断项](docs/DECISIONS_AND_BLOCKERS_V3.0.md)：尚待确认的政策和实施前置条件。
- [技术文档使用说明](docs/README.md)：独立文档版本与基线说明。

## 核心设计原则

- 以学生为主要管理单位；确认兄弟姐妹关系后，按需建立家庭关联。
- 市场销售系统保留独立的身份、线索、商机、报价、订单和业绩。
- 既有 CRM 为正式学员、课程标准价格、教学排课和课程权益的权威来源。
- 全额付清且经过财务权威确认后，才认定正式销售成交。
- 收款、退款、数据同步及自动化必须遵守服务端权限、幂等和审计要求。

## V3.1-04 开发前技术整合审核候选

本次以 **PR #1（数据库）+ PR #2（API）+ PR #3（财务状态机）** 三份草稿的原有文件为基础建立独立整合分支。此前 PR 均未合并，不应重复合并造成覆盖。

- [整合差距与实施阻断审查](docs/INTEGRATION_REVIEW_V3.1-04.md)：8 项差距、已补充的约束与未关闭的生产风险。
- [追加财务完整性迁移草案](db/migrations/002_financial_integrity_draft.sql)：隔离 PostgreSQL 测试用，**未批准生产运行**。
- [模拟数据 PostgreSQL 冒烟测试](tests/sql/financial_integrity.smoke.sql)：验证基本金额守恒、跨学生身份、退款及原成交历史。
- [Node 合同静态检查](tests/contracts/contracts.test.mjs)：验证数据库表名、API 引用及状态机结构。
- [CI 隔离验证工作流](.github/workflows/v3-1-isolated-review.yml)：预定运行 PostgreSQL 16、Node 22；是否通过需看 GitHub Actions 实际证据。

**不变边界：** 新市场销售系统资料独立维护；现有 CRM 仓库代码和技术文档未因本 PR 改动。最终完成两系统真实集成和联合验收后才融合技术说明。

## V3.2-01 核心业务后端（草稿 PR #5）

新增可以在独立 PostgreSQL 隔离环境运行的学生/联系人/线索/商机 Node.js 后端。

- [第一阶段实现与限制说明](docs/V3.2-01_CORE_IMPLEMENTATION.md)
- [HTTP 业务服务](src/app.mjs)
- [员工身份和学生/线索权限](src/auth.mjs)
- [隔离环境端到端测试](tests/core/core-api.test.mjs)
- [CI 自动化测试](.github/workflows/v3-2-core-api.yml)
- [联系人/真实咨询权限迁移](db/migrations/004_contact_event_owner_scope.sql)

**只用于 isolated-test 本机环境**，没有生产身份提供方、Web 管理界面、真实支付、正式订单、CRM 预约或课时写入。相关接口仍保持关闭。PR #5 以 V3.1-04 PR #4 为基础，在 #4 审核后才能按依赖顺序处理；不要重复合并旧的 #1/#2/#3。

## V3.2-02 中文业务管理工作台（草稿 PR #6）

本阶段已新增真实可运行的中文网页操作界面，但**只允许在本机隔离演示环境**启动。正式登录、真实支付和 CRM 写入均未开放。

- [八个中文业务模块与演示操作说明](docs/V3.2-02_ADMIN_UI.md)
- [工作台页面](web/index.html)、[交互代码](web/app.js)、[界面样式](web/styles.css)
- [V3.2-01 已实现的14个核心接口](api/openapi/core-implemented.v3.2.json)
- [V3.2-02 新增的7个列表及演示登录接口](api/openapi/admin-ui-implemented.v3.2.json)
- [同一次咨询只生成一条销售线索的数据库约束](db/migrations/005_unique_consultation_lead.sql)
- [实际 Chromium 浏览器自动化测试](tests/browser/admin.spec.mjs)
- [GitHub Actions 自动化执行证据](https://github.com/Lizhaochuan/market-sales-system/actions/runs/43462743543)：虚构数据、PostgreSQL、浏览器操作成功；**不代表真人或生产验收**。

PR #6 从 V3.2-01 PR #5 叠加开发，而后者依赖 V3.1-04 PR #4。以上均待审核、未合并主分支；旧 PR #1/#2/#3 不应与整合 PR 重复合并。既有教培 CRM 代码与技术文档不受影响。

## V3.2-03 员工身份核验与家庭双人审批（草稿 PR #7）

本阶段在 V3.2-02 中文工作台上增加受控员工身份适配和两名主管的家庭关系审批；继续仅在虚构数据和本机隔离 PostgreSQL 环境运行。

- [员工令牌核验、审批规则与操作说明](docs/V3.2-03_IDENTITY_FAMILY_APPROVAL.md)
- [外部 RS256 令牌验证与预绑定员工检查](src/external-identity.mjs)：**技术适配，不代表已有正式身份供应商**。
- [家庭审批及外部员工身份迁移](db/migrations/006_identity_family_review.sql)：两人分权、审批不可直接修改、角色及机构保护。
- [新增的 2 条实际低风险接口](api/openapi/security-approvals-implemented.v3.2.json)：当前员工权限、自他分离家庭审核；此前14+7条接口保持独立规范。
- [真实 PostgreSQL 授权和身份安全测试](tests/security/identity-family.test.mjs)
- [真实 Chromium 双主管申请/批准操作测试](tests/browser/admin.spec.mjs)

**实际隔离验证：** [GitHub Actions Run #43465641326](https://github.com/Lizhaochuan/market-sales-system/actions/runs/43465641326) 通过了31项后端/安全测试、3项 Chromium 自动浏览器测试以及8项原有技术合同回归。通过这些自动化测试仍**不能**代替正式员工登录、真实亲属材料核验、人工 GUI/真机验收或生产安全上线。

PR #7 基于 V3.2-02 PR #6，且依赖 #5 和 #4；在依赖审核和基线明确前不得直接合并 main。现有 CRM 和技术文档不修改，真正完成双系统集成与联合验收后才融合文档。

## V3.2-04 员工身份绑定/撤销治理与受限数据库运行角色（草稿 PR #8）

新建身份关联不再只是直接写入员工身份表，而是由本机构两名不同主管完成申请、独立核实及最终批准。正式账号离职/身份撤销也需独立审核，批准后外部身份令牌立即失去对应员工访问资格。

- [V3.2-04 技术实现、审批操作和生产阻断说明](docs/V3.2-04_IDENTITY_GOVERNANCE_AND_RUNTIME_SECURITY.md)
- [身份变更审批与不可变审核记录](db/migrations/007_identity_change_governance.sql)
- [隔离低风险数据库角色及身份变更约束](db/migrations/008_lowrisk_runtime_permissions.sql)
- [中文身份审批界面](web/identity.js)
- [5个新实现的低风险身份管理接口规范](api/openapi/identity-governance-implemented.v3.2.json)
- [双主管绑定/撤销、员工停用和角色撤销测试](tests/security/identity-governance.test.mjs)
- [受限数据库角色拒绝财务、审计篡改和随意授权的实际 SQL](tests/sql/lowrisk_runtime_permissions.smoke.sql)
- [真实 Chromium 全流程自动化测试](tests/browser/admin.spec.mjs)

**累计 28 个隔离测试接口，不包括真实收款、自动成交、CRM 课时发放。** 本轮增加一项字段保护：跨负责人被明确授权查看的学生，其年级信息在列表中显示“已隐藏”，并通过独立安全用例验证授权撤销生效。

该项目仍然 **MS_STAGE=isolated-test + localhost + 虚构数据**，尚无生产身份供应商或已完整验证的低权限生产运行账号。旧的 PR #4–#7 都是待审草稿，本 PR 依赖 PR #7；不可多分支重复合并。**不修改现有 edu-management-system 的代码及技术文档，实际完成双系统集成和联合验收后才融合文档。**

## V3.2-05 非所有者数据库账号与首批租户行级隔离（草稿 PR #9）

本轮把 V3.2-04 仅有的受限数据库角色升级为**真实独立非所有者 LOGIN 的隔离测试**，增加第一批 PostgreSQL 租户行级策略和数据库事务内的机构上下文。

- [V3.2-05 技术实现、两机构隔离试验和生产安全阻断](docs/V3.2-05_RUNTIME_TENANT_ISOLATION.md)
- [009 核心表 RLS 及继承角色身份审批修复](db/migrations/009_isolated_tenant_rls.sql)
- [隔离测试独立数据库 LOGIN 初始化](tests/sql/create_isolated_runtime_login.sql)
- [数据库受限运行账号启动前安全验证](src/runtime-preflight.mjs)
- [真实非所有者 LOGIN、两机构 HTTP 和数据库行级安全测试](tests/security/isolated-login-tenant-rls.test.mjs)

**必须特别注意：** 本轮 RLS 使用的自定义 PostgreSQL 机构上下文变量并非不可伪造，具备任意 SQL 执行权限者可以修改该变量，因此目前只是纵深保护，而非已经通过生产级多租户隔离审查。间接关系表、正式身份供应商、完整 PKCE 登录和全部数据库权限审查均未完成。

服务仍强制 `MS_STAGE=isolated-test` 与本机回环地址，收款、自动成交、退款和 CRM 实际课时操作继续关闭。PR #9 依赖 #8，且原有 CRM 数据、代码及技术文档均未修改。

## V3.2-06 可信数据库机构身份与 24 张表行级隔离（草稿 PR #10）

此前以普通 `ms.tenant_org` 会话参数选择机构的设计存在被 SQL 修改的风险。本阶段将隔离依据改为**受迁移管理员保护的数据库原始登录身份 `session_user` 与机构一对一绑定**。当前低权限角色能够访问的 24 张业务表均加入机构行级政策；两个虚构机构分别使用自己的非管理员数据库 LOGIN 和本机 HTTP 实例接受测试。

- [V3.2-06 核心安全方案、完整 24 表覆盖和上线阻断](docs/V3.2-06_DATABASE_PRINCIPAL_TENANT_BOUNDARY.md)
- [010 可信机构映射与 RLS 迁移](db/migrations/010_database_principal_tenant_boundary.sql)
- [第二机构与独立数据库账号的 CI 测试数据](tests/sql/create_second_tenant_principal.sql)
- [真实双数据库 LOGIN 的跨机构、关联表、伪造会话参数测试](tests/security/isolated-login-tenant-rls.test.mjs)
- [更新后的受限账号启动安全检查](src/runtime-preflight.mjs)

**生产仍未允许：** 正式 OIDC 身份、受控连接池动态路由、机构内部按员工权限进一步限制字段和记录、完整运维部署、付款与 CRM 发课均未完成。PR #10 基于 #9，仍为 Draft，且不修改现有 CRM 项目或技术文档。完成实际跨系统集成和联合验收后才融合两套说明。

## V3.2-07 签名身份可信路由与学生目录字段最小授权（草稿 PR #11）

本阶段新增**只在本机隔离测试运行**的可信身份路由入口：先验 RS256 外部令牌，再依据由管理员预先配置的精确 `issuer + subject` 映射路由到机构数据库服务；机构后端必须重复验证身份绑定和数据库权限。机构由可信映射决定，不能由前端提交的机构编号、角色声明或 Host 决定。

- [完整独立技术文档：路由、数据库只读视图与上线阻断](docs/V3.2-07_TRUSTED_ROUTING_AND_FIELD_PROJECTION.md)
- [可信身份路由网关](src/isolated-identity-gateway.mjs)
- [真实双机构 RSA 签名与可信路由的 HTTP 测试](tests/security/trusted-identity-routing.test.mjs)
- [011 号学生目录数据库字段投影](db/migrations/011_student_directory_read_projection.sql)
- [两个独立只读机构 LOGIN](tests/sql/create_directory_projection_readers.sql)
- [只读投影、隐藏年级和跨机构阻断测试](tests/security/directory-field-projection.test.mjs)

**上线阻断未解除：** 路由映射仍为演示管理员静态配置，没有正式 IdP 或受控身份目录同步；大部分业务 API 尚未改为只读字段最小授权角色；仍不允许真实收款、课程/CRM 权益、自动成交或生产员工登录。现有教培 CRM 不修改，技术说明独立维护。

## V3.2-08 已审批身份实时路由与同机构销售专属学生视图（草稿 PR #12）

本阶段用数据库中的有效独立审批记录来决定员工的机构路由，不再要求管理员逐人更新网关静态主体清单。审批待办时身份不生效、批准后实时可用、撤销或员工停用后立即拒绝。

同时建立独立员工只读数据库登录，让同一机构销售 A/B 对学生目录具有不同的可见范围：自己负责的学生默认可见，被具体授权共享的学生在授权期间可见，撤销后不可见；年级、联系人、基础业务表及财务不向该只读角色授权。

- [V3.2-08 独立完整技术说明与上线阻断](docs/V3.2-08_APPROVED_IDENTITY_ROUTING_STAFF_SCOPE.md)
- [012 审批有效机构解析与员工专属目录迁移](db/migrations/012_approved_identity_directory_staff_projection.sql)
- [真实身份审批数据库只读查询](src/approved-identity-directory.mjs)
- [统一签名身份机构路由网关](src/isolated-identity-gateway.mjs)
- [同机构销售权限、具体授权和撤销测试](tests/security/employee-student-assignment.test.mjs)
- [真实审批后身份路由、取消和员工停用的测试](tests/security/approved-directory-routing.test.mjs)

**仅测试环境：** 仍无正式 IdP/PKCE/MFA；原业务 API 尚未全部改为员工专属数据库视图，不能称所有员工/字段最小权限已完成。收款、退款、成交及 CRM 课时仍关闭。PR #12 基于 #11，保持草稿，原教培 CRM 代码及技术文档未修改。

## V3.2-09 员工专属五类销售查询接口（草稿 PR #13）

此前只是数据库中的员工专属学生目录，本阶段新增**真实、可在本机调用的五类只读 HTTP 接口**：学生、家长联系人、咨询记录、线索、商机。查询使用员工专属非管理员数据库 LOGIN 与受保护的只读视图，每次核验 RSA 签名令牌及当前有效的身份审批记录。真实家长电话/微信密文、学生年级、商机金额和原始业务凭证不会出现在响应中。

- [V3.2-09 独立技术说明、业务权限与验收边界](docs/V3.2-09_EMPLOYEE_SCOPED_BUSINESS_READ_APIS.md)
- [013 数据库员工级最小字段只读视图](db/migrations/013_employee_scoped_read_business_views.sql)
- [五类实际可调用的受限 HTTP 服务](src/scoped-employee-read-api.mjs)
- [安全校验后启动本机只读服务](src/scoped-read-server.mjs)
- [五个真实 HTTP 接口的 OpenAPI 规范](api/openapi/employee-scoped-read-implemented.v3.2.json)
- [真实数据库与 HTTP 越权、授权/撤销、身份吊销测试](tests/security/scoped-business-read-api.test.mjs)

**学生为主要单位，家庭按核实后关联。** 共享学生允许查看该学生必要的关联联系人，不代表自动获得同一位家长名下其他孩子的咨询、其他销售的线索或商机；咨询记录目前严格限制为员工本人登记。

本轮仍然**只开放新建的独立只读接口**，旧销售 CRUD 服务的所有访问尚未迁移至员工级数据库最小权限。正式 OIDC/PKCE/MFA、财务收款/退款、自动成交及 CRM 教学课时继续关闭。原教培 CRM 未更改，技术文档直到真实集成联合验收才合并。

## V3.2-10 原有八条销售查询路径迁移到员工受限数据库（草稿 PR #14）

V3.2-09 的员工专属接口是新的只读服务；V3.2-10 开始**真正改造旧销售系统已存在的接口**。使用可信服务器配置的员工独立数据库连接池，接管学生/联系人/咨询/线索/商机 5 条列表及学生/线索/商机 3 条详情 `GET`，从受限视图读取。在严格模式下，账号不存在、员工身份未经批准或数据库员工映射不符，均**直接拒绝**，不返回旧机构级数据库查询。

- [V3.2-10 独立技术文档与业务权限说明](docs/V3.2-10_LEGACY_SALES_SCOPED_READ_MIGRATION.md)
- [014 旧销售查询必需的受限详情与关联视图](db/migrations/014_legacy_sales_scoped_read_details.sql)
- [八类原有业务接口的最小权限查询适配](src/scoped-legacy-read-adapter.mjs)
- [真实主管/销售 A/B 的原接口 HTTP 越权、角色和共享撤销测试](tests/security/legacy-scoped-read-migration.test.mjs)
- [主管专属非管理员只读数据库测试账号](tests/sql/create_v3_2_10_manager_readonly_login.sql)

**谨慎主管规则：** 主管不能因管理角色自动查看全机构学生、家长、线索和商机；需要获明确具体授权且不会自动得到其他销售的咨询或业绩金额。学生为主单位、家庭按需核实关联。当前只是在**隔离模式的可选路径**实现受限读取，旧写入、审批、其他模块和正式 OIDC 等尚未完成 SQL 最小授权。旧教培 CRM 未修改，文档只在实际联合集成验收之后融合。

## V3.2-11 学生客户共享、负责人转交与独立审批（草稿 PR #15）

本阶段实现可真正调用的本机学生授权工作流：学生当前负责人可申请**最多30天临时共享**或正式**负责人转交**，另一名有效主管独立审核后才改变权限；共享授权到期自动不可见，学生负责人或被授权员工可以低风险即时撤销指定共享。转交只改变指定学生负责人，**不改变兄弟姐妹、家庭关系、其他销售的线索/商机业绩、财务或课时**。

- [V3.2-11 独立中文技术与业务操作说明](docs/V3.2-11_STUDENT_ACCESS_APPROVAL_AND_TRANSFER.md)
- [015 号数据库授权申请、独立审批、转交历史与过期权限](db/migrations/015_student_access_governance.sql)
- [五条实际可运行的受限学生权限 HTTP API](src/student-access-api.mjs)
- [独立低权限本机服务启动入口](src/student-access-server.mjs)
- [已实现 API 的 OpenAPI 规范](api/openapi/student-access-governance-implemented.v3.2.json)
- [真实数据库、HTTP、RSA、过期及独立审批回归测试](tests/security/student-access-governance.test.mjs)

三名虚构员工分别使用只能执行指定数据库函数的非所有者 LOGIN，不能读取或直接修改学生、家长、授权表、财务及审计原始数据。**本阶段没有给原有中文工作台接入授权操作界面，也尚未将原有所有写接口升级为同等级权限。** 新权限通过独立 HTTP API 和自动化测试验证；不能声称正式系统已经提供完整上线的客户转交页面。

只在 `MS_STAGE=isolated-test` 的本机运行；旧教培 CRM 及其技术文档未修改。正式 IdP、真实财务、自动成交和 CRM 课时操作全部继续关闭；完成双系统真实集成和联合验收后才统一技术资料。

## V3.2-12 中文客户授权操作界面及员工专属低风险写入（草稿 PR #16）

本阶段把学生客户共享、另一位主管独立审核、负责人转交和即时撤销做成**真实可在本机浏览器使用的中文页面**，同时新建两个只接受员工本人数据的低权限 API：学生独立档案和无电话/微信的联系人登记。

- [完整独立中文技术/业务/上线阻断说明](docs/V3.2-12_CHINESE_ACCESS_UI_AND_SCOPED_LOWRISK_WRITES.md)
- [中文授权工作台](web/access.html)、[响应式样式](web/access.css)、[安全事件交互](web/access.js)；权限服务本机地址 `http://127.0.0.1:3300/app`。
- [016 数据库迁移：安全表单选项与两种防重的员工专属低风险写入函数](db/migrations/016_access_ui_choices_and_scoped_lowrisk_writes.sql)
- [隔离学生/联系人登记 HTTP 服务](src/scoped-lowrisk-write-api.mjs)、[低权限启动入口](src/scoped-lowrisk-write-server.mjs)，默认本机 3400 端口。
- [中文权限页面 Chromium 实际完整操作测试](tests/browser/access.spec.mjs)
- [真实 PostgreSQL/HTTP/RSA 低风险写入、重复提交和越权拒绝测试](tests/security/scoped-lowrisk-writes.test.mjs)
- [授权页面 7 条已实现接口规范](api/openapi/student-access-governance-implemented.v3.2.json)及[低风险写入 2 条接口规范](api/openapi/scoped-lowrisk-write-implemented.v3.2.json)。

**清晰区分安全边界：** 此中文页面是独立、本机、虚构数据的员工授权控制台，旧演示工作台只提供安全的独立入口，**没有正式统一身份登录**。旧工作台学生/联系人创建按钮尚未切换到新的员工专属低权限 API，不能称旧 POST 路径全部完成数据库最小权限迁移。新控制台的测试签名凭据仅保存于当前页面内存，刷新即清除，禁止用于生产。

客户仍以学生为主要单位；只有确实有两个或更多经核实同家庭学生，家庭才按需关联。共享一名学生不等于共享其兄弟姐妹或其他销售商机。正式收款、退款、成交和 CRM 课时操作继续关闭；原教培 CRM 代码、数据与技术说明均未修改，真实集成联合验收后才考虑融合。

## V3.2-13 原有学生/联系人创建入口严格员工数据库权限（草稿 PR #17）

本阶段**直接改造原有** `POST /api/v1/students` 和 `POST /api/v1/contacts`：服务器启用受控的 `MS_STRICT_STAFF_MODE=1` 后，必须通过已批准的 RSA 外部测试员工身份，并以该员工专用、不能直接读写原始学生/联系人/财务表的 PostgreSQL LOGIN 调用 016 号迁移的防重写入函数。员工账号缺失、错配、权限不足或身份撤销时绝不回退到旧机构级业务 SQL。

同一模式下，**原中文工作台**增加员工 RSA 签名身份的本机测试登录选项，原“保存学生档案”“保存联系人”按钮实际走严格路径；只显示已迁移的学生、联系人查询和创建，其余未迁移的业务 GET/POST 在服务器端拒绝。原虚构演示登录仍可供非严格模式回归，不属于生产登录。

- [V3.2-13 独立完整中文技术/业务/安全说明](docs/V3.2-13_LEGACY_STAFF_WRITE_AND_TRUSTED_UI.md)
- [原两条 POST 低权限写入适配器](src/scoped-legacy-write-adapter.mjs)
- [严格员工数据库读写池配对及安全启动预检](src/strict-staff-pools.mjs)
- [真实 PostgreSQL/HTTP/并发/越权/禁回退测试](tests/security/legacy-scoped-writes.test.mjs)
- [原中文工作台 RSA 测试签名登录与旧按钮实际操作 Chromium 测试](tests/browser/strict-employee.spec.mjs)
- [两条原销售写入接口的严格模式 OpenAPI](api/openapi/legacy-scoped-lowrisk-implemented.v3.2.json)

**严格模式仍是本机虚构数据测试**：正式企业登录 / OIDC Code+PKCE / MFA、全量旧写入迁移及真实财务/教培 CRM 集成均未完成。原 `edu-management-system` 及其技术文档保持独立不修改，全部草稿 PR 不合并，真实跨系统集成与联合验收后才考虑融合技术资料。

## V3.2-14 原有学生—联系人待核实关联与一次真实咨询登记（草稿 PR #18）

本阶段在 V3.2-13 已迁移原学生/联系人新增的基础上，进一步把**原中文工作台**的 `POST /api/v1/students/{studentId}/contacts` 与 `POST /api/v1/contact-events` 接入员工专属、函数-only 的低权限数据库写入。严格模式总计有 **4 条原有低风险 POST** 完成迁移；未迁移的线索创建、商机、家庭审批、收款与课时仍拒绝。

- [V3.2-14 独立中文技术和业务权限说明](docs/V3.2-14_SCOPED_CONTACT_LINKS_AND_CONSULTATIONS.md)
- [017 数据库：单学生待核实关系、一次咨询以及共同防重收据](db/migrations/017_scoped_contact_links_consultations.sql)
- [原业务 POST 员工函数-only SQL 适配](src/scoped-legacy-write-adapter.mjs)
- [真实 PostgreSQL/HTTP 的跨销售、兄弟姐妹与咨询单次计数安全回归](tests/security/legacy-scoped-writes.test.mjs)
- [实际 Chromium 原中文页面联系人关联及咨询登记测试](tests/browser/strict-employee.spec.mjs)
- [原四条已迁移低风险接口 OpenAPI](api/openapi/legacy-scoped-lowrisk-implemented.v3.2.json)

**学生是主要单位；家庭只有在两个及以上确实同属家庭的学生核实后才按需关联。** 普通销售可给本人学生关联本人联系人，但只能标记“待核实”，不能确认监护人与兄弟姐妹。一次真实家长咨询只计**一条**，不会按关联孩子数复制咨询、线索或业绩。共享某名学生给销售 B 也不让 B 自动取得这名家长在其他销售处的客户、咨询或商机。

严格模式需要本机虚构 RSA 员工凭据和不同员工的受限数据库账号，不是生产统一登录。独立市场销售仓库交付；旧教培 CRM、数据和技术说明不动，正式收退款/成交/课时继续关闭。所有 PR 保持 Draft，只有实际跨系统集成与联合验收后才融合技术资料。

## V3.2-15 员工身份目录去高权化与联系人管理权独立审批（草稿 PR #19）

本阶段真正把**严格员工模式**原先使用机构级业务数据库账号的身份/角色查询迁移到仅可执行 `ms.resolve_strict_verified_staff` 的独立认证目录 LOGIN。严格模式服务器**不再创建原较宽业务数据库连接池**，员工身份和实时角色只从函数-only 认证目录取得；客户查询与写入继续分别使用员工专属的非所有者数据库账号。

新建受保护的联系人当前管理权登记、交接申请和独立主管审批。**不重写 `contacts.created_by` 原创建人历史**，不转移关联学生、既往咨询、家庭、线索、商机、财务、CRM 课时或归因。原中文管理页面可以由销售提出交接，另一位真实有效主管独立批准后接收员工才得到联系人当前管理权；申请人与接收人不可自批，所有写操作受真实数据库权限及审计约束。

- [V3.2-15 独立完整中文技术和业务审批说明](docs/V3.2-15_AUTH_DIRECTORY_AND_CONTACT_CUSTODY.md)
- [018 号：函数-only 员工身份目录](db/migrations/018_strict_function_only_auth_directory.sql)、[独立认证服务适配器](src/strict-auth-directory.mjs)
- [019 号：联系人当前管理权、待审核申请和独立主管审批](db/migrations/019_independent_contact_custody_approval.sql)
- [真实 PostgreSQL、HTTP、伪造身份和旧高权限连接次数为 0 的安全测试](tests/security/strict-auth-directory.test.mjs)
- [真实三员工联系人交接审批、不转移学生/旧咨询/业绩的安全测试](tests/security/contact-custody-approval.test.mjs)
- [原中文页面 Chromium 三员工交接实操](tests/browser/contact-custody.spec.mjs)
- [联系人交接四条实际接口 OpenAPI](api/openapi/contact-custody-implemented.v3.2.json)

**仍仅本机虚构环境**：没有正式企业 IdP/OIDC Code+PKCE/MFA；其他旧线索/商机/家庭业务接口尚未全量低权限迁移，收款退款与 CRM 课时继续关闭。所有 PR 保持草稿、不合并，旧 `edu-management-system` 代码和文档完全不改。真实跨系统联合验收后才考虑合并技术资料。

## 版本与融合边界

当前 V3.0 是独立设计稿，**并不代表软件已完成或接口已经实测通过**。后续技术设计、业务决策、实现和验收证据优先保留在本仓库。

现有 CRM 仓库： [edu-management-system](https://github.com/Lizhaochuan/edu-management-system)。

**仅在市场销售系统与现有 CRM 完成正式集成、联合测试和验收后，才执行跨项目技术文档融合。**在此之前，不修改既有 CRM 的技术说明作为本项目文档发布的前提。
