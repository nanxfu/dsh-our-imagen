# ADR-0008：凭据主路径改为 Kaggle API Token，OAuth 仅作兜底

- 状态：已采纳（部分取代 ADR-0004 的接入路径，不取代"插件不持有凭据"这一条）
- 日期：2026-11-09
- 相关：[ADR-0004](0004-credentials-owned-by-cli.md)、[EXPERIMENTS.md](../EXPERIMENTS.md) E10

## 背景

E10 实测：OAuth 登录后的 access token 有效期约 3 小时，本机 CLI 不自动续期；到期后所有 `kernels.*` 调用被拒（先是 `Authentication required`，随后变成 `Permission 'kernels.get' was denied`），而 `datasets.*` 仍可用。

工作台的典型用法是"开一次、挂半天"，与 3 小时的可信窗口直接冲突；而且失败文案指向"kernel 不存在"，会把用户引到完全错误的方向。

## 决策

1. **主路径**：Kaggle API token。用户在 Kaggle 网页 `Settings → API` 生成一次，写入 CLI 的凭据位置（`~/.kaggle/access_token` 或环境变量 `KAGGLE_API_TOKEN`），此后长期有效。
2. **兜底**：OAuth 托管登录（`kaggle auth login --force --no-launch-browser`，验证码写回子进程 stdin），面板内完成。
3. **不变**：插件不读取、不解析、不代管任何 token 内容；引导只提供命令让用户自己写入；判定依据仍是真实 API 调用的成败。

## 后果

- 引导第二步从"面板内 OAuth"改为"复制一条写文件的命令，粘贴你的 token，回来点重新检查"。插件全程看不到 token，这是有意的。
- 同时存在 OAuth 残留凭据时，CLI 会优先用哪一个尚未实测；引导需要提供"清理 OAuth 残留后重试"的可选步骤。
- token 长期有效意味着泄露后果更重，引导里必须提示：不要把 `~/.kaggle/access_token` 提交到仓库，`.gitignore` 需覆盖。
- 3 小时过期不再是日常故障，但仍可能出现（例如用户先用 OAuth 接入），所以过期检测与托管重登必须保留。

## 备选与否决理由

- **只做 OAuth + 每 3 小时托管重登**：授权动作本身需要用户在场，等于每半天打断一次，与工作台定位冲突。
- **插件代写 token 文件**：能让引导全自动，但插件就成为了凭据的搬运者与持有者，违背 ADR-0004 的安全边界。

## 待验证

1. ~~CLI 在 `credentials.json`（OAuth）与 `access_token` 同时存在时的优先级。~~ **已部分确认（2026-11-09）**：把 `credentials.json` 移走后，仅凭 `access_token` 即可正常调用 `kernels list`，说明 token 路径独立可用；两者并存时的优先顺序仍不影响使用（两条路都能过）。
2. OAuth 凭据存在但已过期时，CLI 是否会自动回落到 `access_token`（需要在 12:09 之后复测）。
3. API token 是否存在有效期或失效条件。
4. token 权限范围是否覆盖 `kernels.push/status/logs/output`（E3 显示 `quota` 无论如何都不可用）。
