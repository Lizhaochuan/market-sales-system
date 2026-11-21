# Phase 3 微信小程序隔离工作台

微信开发者工具导入本目录。工程使用本机虚构身份和独立 PostgreSQL 测试库。顾问、销售主管、市场人员、市场主管和总管理者按后端角色进入对应工作台。`touristappid` 和本机网络设置用于开发测试。

## 运行

使用一个全新的本机 `ms_test` 或 `ms_workspace_test` 数据库。先在当前终端设置 `DATABASE_URL`、至少 32 字符的测试专用 `AUTH_HMAC_SECRET` 和 `DEV_LOGIN_SECRET`，再从仓库根目录执行。

```sh
export MS_STAGE=isolated-test
export MS_ENABLE_ISOLATED_WORKSPACE=1
export MS_ENABLE_V34_WORKFLOW=1
export MS_ENABLE_ROLE_WORKSPACES=1
MS_WORKSPACE_SETUP=YES_EMPTY_TEST_DATABASE node scripts/setup-isolated-workspace.mjs
PORT=33105 node src/server.mjs
```

在开发者工具模拟器选用 `sales-a`、`supervisor`、`market-a` 或 `general-admin` 等虚构账号，并输入 `DEV_LOGIN_SECRET`。客户端只请求 `127.0.0.1:33105`。业务写入与 PC 共用版本冲突校验、幂等记录和数据库事务。弱网可重试原请求，冲突时先刷新。登录令牌和临时输入仅留内存，个人跟进草稿走既有服务端接口。

## 验证范围

- **销售**覆盖待办和逾期、电话查重、市场接收、客户概览、记跟进、面谈与试听预约及处理、移动日程和转交接手。
- **主管**覆盖经营总览、异常、渠道与顾问比较、当前及历史筛选、明细、审计、已有独立审批和督办证据。
- **跨端测试**由 `tests/core/mini-workspace.test.mjs` 将实际小程序页面脚本接入隔离 HTTP/PostgreSQL，覆盖 PC 互通、弱网重放、版本冲突、草稿安全、越权及撤权清理。现有 Chromium 套件验证网页回归。
- **原生验证**可用安装包自带的 `wcc` 编译三个 WXML 页面、`wcsc` 编译 `app.wxss`。开发者工具游客窗口可用于本机模拟器交互。当前版本的 CLI 自动化需要有效测试 AppID。375/390/414px 模拟宽度抽检与真机验收分别记录。

已用 Sales 测试 AppID 验证手机扫码能打开「员工工作台」。测试员工认证、隔离 HTTPS 域名和订阅消息配置待补充。真实校区映射和财务数据待补充。继续 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。

## 真机验收准备

使用 Sales 专用测试 AppID 和已加入体验名单的微信账号。手机端接入隔离 HTTPS 测试后端后，先用测试顾问和主管分别验证身份及权限。当前 `127.0.0.1:33105` 回环接口和演示口令仅用于 Mac 模拟器。真机接入须使用经批准的测试员工认证，保留现有回环登录限制。

真机记录须包含测试 AppID 对应的项目、设备与微信版本、受测 SHA 和实际结果。验收路径包括顾问登录及保存跟进、主管独立审批、撤权后清除会话和客户页，并核对保存时间与同一隔离库记录。真机复验使用虚构业务数据。

## 正式员工登录接入方案

由机构管理员选择现有 Sales 员工并发起微信身份绑定申请，另一位授权管理员复核。复用已有身份变更申请和审计机制，身份键为受信任发行方与稳定主体标识。员工角色和机构权限从 Sales 目录读取。员工微信身份缺少绑定时拒绝登录。

小程序把短期微信登录凭证提交给隔离 HTTPS 后端。后端验证凭证后查找获批绑定，并发出短期工作台会话。每次受保护请求重新核对账号状态、当前绑定及角色。停用、解除绑定或失去工作台权限后，现有会话的下一次请求须被拒绝，手机清除会话和客户资料并返回登录页。既有身份适配与严格模式可作接入基础，但严格模式当前与隔离工作台模式互斥，需接入并验证 Sales 工作台所需的受限读写路径。

验收覆盖未绑定和跨机构账号拒绝、自审拒绝、绑定后按角色进入工作台、重复或过期登录凭证拒绝、角色降级及解绑后旧会话拒绝、手机清理客户页。先用虚构身份验证这些用例，固定 HTTPS 域名就绪后，再关闭微信调试模式复跑。正式认证保持待接入，保留 HOLD。

严格认证服务可显式配置 `MS_WECHAT_APP_ID`、`MS_WECHAT_APP_SECRET`、`MS_WECHAT_SIGNING_KEY_PEM` 与 `MS_WECHAT_SIGNING_KEY_ID` 以启用 `POST /api/v1/mobile/wechat/session`。签名公钥须匹配已配置的员工 JWT 信任根。服务器使用已获批准的身份目录绑定，凭证有效期为 5 分钟。密钥由服务器进程读取，不能打包进小程序。未配置时接口关闭。当前小程序登录页仍使用隔离演示流程。
