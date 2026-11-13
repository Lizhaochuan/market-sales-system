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

## 版本与融合边界

当前 V3.0 是独立设计稿，**并不代表软件已完成或接口已经实测通过**。后续技术设计、业务决策、实现和验收证据优先保留在本仓库。

现有 CRM 仓库： [edu-management-system](https://github.com/Lizhaochuan/edu-management-system)。

**仅在市场销售系统与现有 CRM 完成正式集成、联合测试和验收后，才执行跨项目技术文档融合。**在此之前，不修改既有 CRM 的技术说明作为本项目文档发布的前提。
