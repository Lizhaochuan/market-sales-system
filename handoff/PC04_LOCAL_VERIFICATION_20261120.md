# PC-04 Mac 本地 Saved Views 复核（2026-11-20）

状态：**PC-04=REVIEW_REQUIRED**；`HOLD=true`、`EXT-001=UNVERIFIED`、Draft / CI-only。未启动 PC-05；不合并、不部署，不修改 edu-management-system。

## 基线与修复

从 `Lizhaochuan/market-sales-system` 的 `chatgpt/ms-ui-004-pc-04` 独立克隆，基线 SHA `07d30fc8aad374d0e8f83658bc4079e3a8a7c73b`。保留已有 market-sales-system 快照分支及全部未提交修改。

该基线的函数与浏览器 PC-04a 已能拒绝 `电话139 1234 5678视图`、`客户+86-139-1234-5678`、`家长(139)1234-5678`，本轮不将其描述为仍然复现的绕过。新增测试确保这三类输入在搜索词与视图名两个入口均受保护。

实际复现的漏洞是候选数字串超过 15 位即跳过：两个电话号码用空格相连，或号码前后追加数字，可绕过校验。修复为在文本中识别含合法分隔符的数字片段，累计达到 7 位即拒绝，不设可绕过的长度上限；不跨普通文字拼接数字。保留既有日期豁免，以及 `学生1`、`04A`、`2026课程计划` 等普通标识。Saved Views 仍只存在会话内存。

## 验证范围

- 新增 28 项函数正反向测试，直接运行前端闭包中的实际函数。修复前 25 通过、3 失败；修复后 28/28 通过。
- 新增 PC-04c Chromium 用例：6 类敏感输入 × 两个入口拒绝保存；5 类普通数字标识可保存、恢复搜索；重新登录后视图清空。
- 完整本地回归按 `.github/workflows/v3-2-core-api.yml` 顺序执行：迁移与 fictional fixtures、受限 LOGIN/RLS、语法、全部 core/ui/security、全部浏览器与 contracts。不是声称执行仓库所有独立历史工作流。
- 本地使用 Node.js 25.9.0（满足 >=22）、PostgreSQL 16.16、Playwright 1.56.1 / Chromium 141。测试库独占 127.0.0.1:55434；浏览器服务改为 33104，保留已有 3100 服务。远端 CI 使用 Node.js 22 / PostgreSQL 16。
- 首轮重复使用定向测试数据库，因残留过期待办/预约导致两个既有浏览器断言失败；原始日志保留。最终结果应以全新测试实例、从空库初始化的完整运行记录为准。

## 最终本地结果

全新独立测试实例从空库执行主工作流，全部退出码为 0：

| 检查 | 结果 |
|---|---|
| Saved Views 函数正反向测试（也包含在完整 core 套件） | 28/28 |
| 实际受限 LOGIN 与租户 RLS | 12/12，另含 restricted runtime preflight 通过 |
| 全部 core / ui / security | 750/750，0 skipped |
| 全部 Chromium 浏览器 | 41/41，含 PC-04a、PC-04b、PC-04c |
| 合约 | 8/8 |
| 迁移、SQL 权限 smoke、前后端语法 | 全部通过 |

本地完整日志保存在独立克隆的 `.tmp/full-summary.log`、`.tmp/full-6.log` 至 `.tmp/full-11.log`，第一次污染数据运行的日志保存在 `.tmp/first-run/`。本机复跑与数据库启停说明见 `.tmp/LOCAL-PC04.md`。这些临时环境、浏览器缓存、测试数据库与日志均未提交。

最终提交 SHA 与该 SHA 的 GitHub Actions 链接在本次交付回复中报告；CI 成功不代替最终审核或解除 HOLD。
