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

## 版本与融合边界

当前 V3.0 是独立设计稿，**并不代表软件已完成或接口已经实测通过**。后续技术设计、业务决策、实现和验收证据优先保留在本仓库。

现有 CRM 仓库： [edu-management-system](https://github.com/Lizhaochuan/edu-management-system)。

**仅在市场销售系统与现有 CRM 完成正式集成、联合测试和验收后，才执行跨项目技术文档融合。**在此之前，不修改既有 CRM 的技术说明作为本项目文档发布的前提。
