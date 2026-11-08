# ADR-0004：凭据交给 kaggle CLI，插件不持久化 token

- 状态：已采纳；**接入路径部分被 [ADR-0008](0008-api-token-primary.md) 取代**（主路径改为 API token，OAuth 降为兜底），"插件不持有凭据"这一条不变
- 日期：2026-11-08
- 相关：[PROVIDER-INTERFACE.md](../PROVIDER-INTERFACE.md)

## 背景

Kaggle CLI 2.2.5 提供 `kaggle auth login`（支持 `--no-launch-browser`）与 API token 两种接入方式。本机已出现"本地记录显示已登录、实际 API 未认证"的状态，说明登录态存在两套真相。另一方面，Harness 的 Config 值会明文写进 profile 的 `cordis.patch.yml`。

## 决策

插件不读写任何 Kaggle token 文件，也不把 token 存进 Config 或 credentials 服务。登录由 `kaggle` CLI 完成；插件以子进程方式托管 `kaggle auth login --force --no-launch-browser`，从 stdout 取授权链接展示给用户，再把用户从浏览器拿到的一次性验证码转发给子进程 stdin。插件只保存"上次验证成功的时间 + 账号句柄"用于展示，判定依据是 `kaggle quota` 的真实退出码。

## 后果

- 凭据只有一份权威副本，插件卸载或升级都不会泄漏或失效。
- 引导可以完全在面板内闭环，不需要用户切到终端；但浏览器授权那一下仍不可省。
- 插件会在内存中短暂持有一串一次性验证码（非长期凭据）：禁止落盘、禁止写日志、禁止回显；子进程超时必须终止。
- 需要处理"看似已登录、实际未认证"的分支，并在引导里给出一键清空重登的指引。

## 备选与否决理由

- **插件自管 API token**：可以做到全图形化，但等于在插件里再存一份长期凭据，随仓库或备份泄漏的风险更高。
- **两套都支持**：增加分支与状态组合，v1 不取。
