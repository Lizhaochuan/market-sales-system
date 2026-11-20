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
- **原生验证**可用安装包自带的 `wcc` 编译三个 WXML 页面、`wcsc` 编译 `app.wxss`。模拟器交互与 375/390/414px 真机验收单独记录。

正式微信绑定审批、AppID、合法 HTTPS 域名、订阅消息模板与真机凭据待补充。真实校区映射和财务数据待补充。继续 `HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。
