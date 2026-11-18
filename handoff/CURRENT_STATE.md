# AI 接力基线 | CURRENT_STATE

更新时间：2026-11-19（Asia/Tokyo）；执行者：ChatGPT / GPT-6

## 权威来源与分支

- 开发仓库：`Lizhaochuan/market-sales-system`。
- 当前交接文档分支：`chatgpt/ms-ai-handoff-20261119`，从 `chatgpt/v3-2-121-m02-revocation-notices` 分出；**不代表主开发分支已切换到此分支**。
- 原开发分支：`chatgpt/v3-2-121-m02-revocation-notices`，对应 Draft PR [#129](https://github.com/Lizhaochuan/market-sales-system/pull/129)。
- `main` 仅存早期 V3.0 文档，**不可作为已实现功能的唯一判断依据**。
- 准确的最新 HEAD SHA：**待下次执行者通过 Git 实时确认**（PR 描述中标记最终 `d1dcbdc...`，分支文档记录业务实现 `0b60319...`；二者都不能替代实时 HEAD）。
- 原 CRM `Lizhaochuan/edu-management-system` 仅供背景参考，不修改、不集成。
- 现场工作区是否有未提交文件、当前本机服务是否运行：**未取得；远程连接无法证明本地状态**。

## 已核实的开发现状

根据原开发分支 `docs/ROLE_WORKSPACES.md`、`docs/V3.4_SALES_WORKFLOW.md` 及 PR #129：

- 已有按销售、市场、两类主管、总管理者分开的角色工作台，以及电话查询/接收市场线索。
- V3.4 实现了未结案 Lead 有有效下一步任务或预约、原子接续、幂等与版本校验；支持线上沟通、线下面谈、独立试听、方案、报名及付款核实。
- 报名成功标准 B 为已核实有效协议且有效净收款 > 0；正式 Closed Won 仍要求有效订单全额净收并通过异常约束。
- 原分支文档记录最近一次本机验证 `722/722` API/权限/安全与 `33/33` Chromium；**这些是历史记录，不是本分支本次重新测试的结果**。
- `EXT-001=UNVERIFIED`、`HOLD=true`、`release_eligible=false`、`merge_authorized=false`、`deploy_authorized=false`；不得合并、部署、进行生产迁移或连接旧 CRM。

## 本次实际工作

- 建立文档专用交接分支，不修改市场销售业务代码。
- 新增本目录接力基线、任务板、决策日志、测试记录（具体以实际 GitHub 提交为准）。
- 本次未执行代码测试、数据库迁移或浏览器 UAT；未创建业务 PR。

## 当前状态与下一步

1. **先核实实际原开发分支 HEAD、PR #129 状态、CI 运行与本地工作区 Git status**，不可用历史验收数字代替。
2. 阅读 `docs/ROLE_WORKSPACES.md`、`docs/V3.4_SALES_WORKFLOW.md`、`docs/V3.4_DEVELOPMENT_REPORT.md`，并读取已经上传的竞品研究包。
3. 生成现有 PC 与小程序、Boss 驾驶舱的逐项差异审计。未核实具体实现的项目不得记为缺失。
4. 只有经过审核才开始业务代码修改；遵守原 Draft / CI-only / HOLD 约束。
5. 本交接分支与正在开发的 PR #129 **不应平行修改相同业务文件**。接力时先以最新原开发分支为基线重核，再移植已审查的交接文档或设计改动。

## 交接门槛

接手人必须记录：最新仓库/分支/HEAD SHA、未提交文件、任务状态、已经运行的测试及结果、阻塞点、准确的下一步。缺少证据必须写“未验证”。
