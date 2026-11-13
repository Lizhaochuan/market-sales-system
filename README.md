# 市场与销售系统（Market Sales System）

本仓库独立管理市场与销售系统的需求、技术设计、代码和验收记录。

**项目定位：** 与现有教培 CRM 分离开发、分离数据库，通过经过授权的 API 集成。既有 CRM 的技术文档与本项目文档暂不融合。

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

## 版本与融合边界

当前 V3.0 是独立设计稿，**并不代表软件已完成或接口已经实测通过**。后续技术设计、业务决策、实现和验收证据优先保留在本仓库。

现有 CRM 仓库： [edu-management-system](https://github.com/Lizhaochuan/edu-management-system)。

**仅在市场销售系统与现有 CRM 完成正式集成、联合测试和验收后，才执行跨项目技术文档融合。**在此之前，不修改既有 CRM 的技术说明作为本项目文档发布的前提。
