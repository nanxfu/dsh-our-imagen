# 贡献指南

感谢参与 `dsh-our-free-imagen`（生图工作台）。本文说明本地开发、契约约定、新增模型与测试要求。

## 1. 环境准备

- Node.js >= 18（CI 使用 Node 20）
- Python 3.11+（远端 daemon 单元测试与模型验证需要）
- Kaggle CLI（仅真机验证与本地联调需要；`kaggle --version` 可运行即可）

```bash
npm install
npm test
```

`npm test` 会依次构建客户端 Bundle、校验生成物一致性，并运行契约、客户端、Host 与远端 daemon 测试。提交前请保证它在本地全绿。

## 2. 契约单一来源

`shared/contract.js` 是接口契约的**唯一来源**：API 路由、字段、错误码、版本号、预设与比例等常量都先在这里定义。

当改动涉及契约时，按以下顺序执行：

1. 修改 `shared/contract.js`；
2. 重新生成派生产物：`npm run contract:gen`（`remote/contract.json`）、`npm run models:build`（`shared/models.generated.js`）、`node build.mjs`（`client.js`）；
3. 同步更新 `docs/SPEC.md` 中的接口说明；
4. 以 `npm run test:contract && npm test` 全绿为准。

不要手改生成文件（`client.js`、`remote/contract.json`、`shared/models.generated.js`），它们由脚本生成并由 `--check` 校验。

## 3. 新增模型预设

1. 参照 [`docs/MODEL_ASSET_SPEC.md`](docs/MODEL_ASSET_SPEC.md) 在 `models/<id>.json` 编写配置（loader、模型仓库、采样参数、`promptStyle`、`negativeHint` 等）。
2. 本地静态校验：
   ```bash
   node tools/verify-model.mjs --config models/<id>.json --dry-run
   ```
3. 真机验证（需要已配置的 Kaggle 凭据，消耗 GPU 额度）：
   ```bash
   node tools/verify-model.mjs --config models/<id>.json
   # 确认体检数据后回填 measured
   node tools/verify-model.mjs --config models/<id>.json --write
   ```
4. 重新生成模型资产：`npm run models:build`，并用 `npm run models:check` 确认生成物一致。
5. 启动失败时按 `verify-model.mjs` 打印的失败分类（如 `pip_conflict` / `cuda_oom` / `download_failed`）排查，不要直接提交未验证的配置。

## 4. 代码与提交约定

- 前端源码在 `src/`，构建产物 `client.js` 由 `node build.mjs` 生成；Host 端在 `lib/`，远端在 `remote/`。
- 提交前运行 `npm test`；只改客户端时可先跑 `npm run test:client`，只改 Host/远端时可先跑 `npm run test:host`。
- 小步提交，提交信息说明「为什么改」，避免夹带无关格式化改动。
- 以下目录/文件只保留在本地，已被 `.gitignore` 忽略，不要提交：`.impeccable/`、`bench/`、`docs/archive/`、`docs/CODE_REFACTOR_SPEC.md`、`docs/MINIMAX_H3_IMAGE_SPEC.md`、`docs/MODEL_EXPERIMENT_GUIDE.md`、`docs/PRE_RELEASE_SPEC.md`、`design-demos/`、`dist/`、`.tmp/`、`imagen-output/`。

## 5. 安全与隐私

- 不要提交 Kaggle Token、Hugging Face Token、API Key、账号用户名或本地绝对路径。
- 提交前逐行检查 diff，可用以下命令粗筛疑似凭据字段（按需调整关键词）：
  ```powershell
  git diff | Select-String -Pattern '(?i)(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*\S+'
  ```
  命中的行需人工确认；账号名与本机绝对路径请自行核对。
- 在 Issue / PR 中粘贴「复制诊断信息」的文本前，先人工核对并删除敏感内容。

## 6. 问题反馈

使用 [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.yml) 提交，并附上脱敏后的诊断信息，便于快速定位。
