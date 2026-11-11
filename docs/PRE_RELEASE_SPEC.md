# 发布前预备规格书 (PRE_RELEASE_SPEC)

> **定位**：本文档供后续执行 Agent 与维护者阅读并按序执行，目标是将 `our-free-imagen`（包名 `dsh-our-free-imagen`）安全、合规地打磨至可公开发布到 GitHub（路径 B）并提交上架至 **[DeepSeek Harness 插件商店 (imsai-sh/awesome-deepseek-harness-plugins / deepseek1024.com)](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)** 的状态。
>
> **阅读前提**：当前仓库仍在持续开发中。执行本 SPEC 前，先确认作者正在进行的工程改动已经完成并验收。

---

## 0. 全局红线（执行 Agent 必须严格遵守）

1. **禁止丢失本地开发文档与资产**：
   - 作者明确要求保留本地开发过程中沉淀的文档与草稿，**严禁使用 `rm` 或不带 `--cached` 的 `git rm` 删除任何本地文档或草稿目录**。
   - 若某项本地文件/目录不应推送到 GitHub 公共仓库，必须采用 **「`.gitignore` + `git rm --cached -r <path>`」**（只从 Git 索引移除、保留本地磁盘文件），并在执行前后用 `Test-Path` / `ls` 核验本地文件完好无损。
2. **禁止擅自执行不可逆外部操作**：
   - **不得**在未获得用户明确授权的情况下执行 `git push`、`npm publish`、`gh repo edit`、修改 Git 历史（rebase/filter-repo）或向外部仓库发起 PR。
   - 本地文件修改、测试校验、打包演练可自主完成；涉及远端推送/发包/提 PR 时，必须先停下来向用户展示完整变更摘要与目标命令，获批后再执行。
3. **契约单一来源不可破坏**：
   - 任何版本升级、路由/字段调整或错误码改动，必须先改 [`shared/contract.js`](../shared/contract.js)，再同步生成物（`npm run contract:gen`、`npm run models:build`、`node build.mjs`）和文档 [`docs/SPEC.md`](SPEC.md)，最终以 `npm run test:contract && npm test` 全绿为准。

---

## 1. 背景检查清单（开工前先核对现状）

执行本 SPEC 时，先运行以下只读检查确认基线：

```powershell
git status
npm test
npm run contract:check
node build.mjs --check
```

已知截至 `0.4.1` 末期（撰写本 SPEC 时）的基线状态：
- 工作区存在 8 模型资产扩容（`models/*.json` 增至 8 个，且作者仍在继续接入如 `anima` 等新 loader/模型——执行前务必以当时 `models/*.json` 实际数量为准并同步更新 `README.md` / `README.en.md`）与模型海报选择卡（`src/studio/ModelCardPicker.jsx`、`src/studio/posters/*.webp`）等未提交改动；
- [`CHANGELOG.md`](../CHANGELOG.md) 顶部为 `## 未发布`，与 `package.json` / `shared/contract.js` 的 `0.4.1` 尚未对齐；
- 无 `.gitattributes`，Windows 下部分文档曾以 CRLF 写入造成全文件 diff 噪音；
- `design-demos/`（约 12 MB）未纳入 `.gitignore`；
- `bench/*/kernel-metadata.json` 等文件含个人 Kaggle 用户名 `mogudd`；
- `package.json` 含 `"private": true`（若要支持 1024 Store 一键安装，需发布到 npm）。

---

## 2. 阶段一：运行时日志打点与本地持久化（方案 A）

> **目的**：当前插件在运行时**不会把日志落盘**（[`lib/log.js`](../lib/log.js) 默认 no-op，`remote/daemon.py` 仅内存保留 400 行环），容器崩溃、隧道断开或代理异常时现场容易丢失。本阶段落地**纯本地、零隐私外泄风险**的观测与诊断能力。

### 2.1 Host 本地滚动日志文件（`lib/log.js`）

改造 [`lib/log.js`](../lib/log.js)，使控制台输出与本地文件落盘解耦：

1. **控制台行为保持兼容**：
   - 仍由 `OUR_FREE_IMAGEN_LOG=debug|info|warn|error` 控制是否向 DSH 控制台输出，默认不刷宿主终端噪音；
   - 测试注入 `sink` 时保持原有内存收集能力。
2. **新增本地文件持久化（默认开启 info/warn/error，可配置关闭/调级）**：
   - 存储位置：`<workspace>/.imagen/logs/host.log`（或 JSONL 格式 `host.jsonl`，目录 `0700` / 文件 `0600`，Windows 忽略 mode 差异；路径计算复用 [`lib/paths.js`](../lib/paths.js) 的 `workspaceRoot(ctx)`，无工作区上下文时安全退化为不写盘）。
   - **自动轮转与体积上限**：单文件达到 `2 MiB` 时轮转为 `host.log.1`（最多保留 1 个归档，总占用封顶 `4 MiB`），避免长期使用撑爆用户磁盘。
   - **非阻塞且容错**：文件写入走串行缓冲队列或异步 append，任何 IO 错误静默降级，绝对不能阻塞或拖垮主请求/状态机。
   - **强制脱敏过滤器（在日志出口统一执行）**：
     - 匹配并掩码以下敏感模式：Bearer Token、`token`、`secret`、`password`、`authorization`、`hfToken` / `hf_...`、`KGAT_...`、带敏感 query 参数的 URL；
     - **不得**把完整提示词正文（`prompt` / `negativePrompt`）或用户环境变量打印到持久化日志里（只记录 `promptLen` 字符数）。
   - 提供读取最近 N 行的纯函数/方法（如 `readHostLogTail(ctx, limit = 120)`），供诊断接口消费。

### 2.2 关键不稳定链路打点（Host 侧）

以下位置必须补齐结构化打点（注意遵循脱敏约束）：

1. **出图队列 [`lib/jobs.js`](../lib/jobs.js)**（目前完全无 `log` 调用）：
   - `JobQueue` 接入 `createLogger({ scope: 'jobs' })`；
   - 记录关键事件：`enqueue`（`jobId`、`presetId`、`size`、`steps`、`count`、`promptLen`、当前排队数 `pending`）、`wait_session_start` / `wait_session_done`（等待耗时 ms 与结果）、`remote_generate_start` / `remote_generate_done` / `remote_generate_failed`（耗时 ms、返回张数、错误码）、`canceled_by_stop`。
2. **会话状态机 [`lib/session.js`](../lib/session.js)**：
   - 所有状态/阶段跃迁记录 `transition(from -> to, phase, epoch, presetId, elapsedMs)`；
   - `restore()` 明确记录恢复分支（`probe_health_ok` / `ntfy_rejoin` / `kernel_ended_cleanup` / `invalid_record` / `no_record`）；
   - `ready` 阶段心跳丢失、触发隧道重连或判定 `session_ended` / `health_failed` 时记录 `warn`；
   - **失败现场抢救**：当会话进入 `error`（或检测到 `session_ended` / `health_failed`）时，尽力把最后一次拉到的远端日志尾（或 `kernelLogs` 尾部 30 行）写入本地 Host 日志，确保远端容器销毁后仍留有直接线索。
3. **网络降级与 CLI [`lib/net.js`](../lib/net.js) & [`lib/kaggle.js`](../lib/kaggle.js)**：
   - [`lib/net.js`](../lib/net.js)：记录 `fetch` 失败并降级 `curl` 的目标主机名（不含路径/参数）、错误类型、重试后状态码与耗时；
   - [`lib/kaggle.js`](../lib/kaggle.js)：记录 CLI 子命令类别（`version` / `auth` / `quota` / `push` / `status` / `logs`）、执行耗时 ms、退出码与 `failure` 类型（`spawn` / `timeout` / `null`）。

### 2.3 升级日志路由与「复制诊断信息」

1. **扩展 [`lib/routes/logs.js`](../lib/routes/logs.js)**（保持对既有响应字段 `{ ok, since, next, lines }` 的完全向后兼容）：
   - 建议在 `GET /imagen-api/logs` 响应体中增加可选字段 `hostLines: string[]`（或支持 `?includeHost=1`），返回近期脱敏后的 Host 持久化日志尾（即使当前没有活跃的 Kaggle 会话，也能拿到 Host 侧最近的错误原因与状态时间线）。
   - 如新增独立路由或错误码，务必先在 [`shared/contract.js`](../shared/contract.js) 登记。
2. **增强 [`src/logic/logs.js`](../src/logic/logs.js) 与 [`src/studio/LogsDrawer.jsx`](../src/studio/LogsDrawer.jsx)**：
   - [`buildDiagnostics()`](../src/logic/logs.js#L164-L187) 除原有 `version`、`session`（已剔除 token）、`probe`、`queue`、`lastJob` 与远端 `logs` 外，追加 `hostLogs` 段落；
   - 保持在离线/异常状态下日志抽屉仍可打开并一键复制诊断文本，方便用户贴进 GitHub Issue。

### 2.4 阶段一验收标准

- 新增或扩展单元测试覆盖：`lib/log.js` 的落盘、2 MiB 轮转、Token/HF Token/提示词脱敏；`JobQueue` 状态与错误打点；`GET /imagen-api/logs` 与 `buildDiagnostics()` 在无远端会话时仍能输出脱敏后的 Host 诊断时间线。
- 运行 `npm test` 全部通过。

---

## 3. 阶段二：仓库卫生、换行符规范与本地文档保留

### 3.1 统一换行符与添加 `.gitattributes`

1. 在仓库根目录创建 `.gitattributes`：
   ```gitattributes
   * text=auto eol=lf
   *.py text eol=lf
   *.js text eol=lf
   *.mjs text eol=lf
   *.jsx text eol=lf
   *.json text eol=lf
   *.md text eol=lf
   *.css text eol=lf
   *.yml text eol=lf
   *.svg text eol=lf
   *.png binary
   *.webp binary
   *.jpg binary
   ```
   > **原因**：[`build.mjs`](../build.mjs)（`--check`）、[`tools/build-assets.mjs`](../tools/build-assets.mjs)（`--check`）与 [`tools/gen-contract-json.mjs`](../tools/gen-contract-json.mjs)（`--check`）均采用 LF 逐字节字符串比对。若无 `.gitattributes`，Windows 开发者以默认 `core.autocrlf=true` 克隆后跑 `npm test` 会直接失败。
2. 把工作区已有文本文件的 CRLF 统一规范回 LF（执行后用 `git diff --stat` 确认不再有整篇换行符假 diff）。

### 3.2 区分「公开开源文件」与「仅本地保留的开发文档」

**操作准则**：所有仅留作本地开发参考的文件，**只做 `.gitignore` + `git rm --cached`（如已被跟踪），绝不删除磁盘原文件**。

建议按以下清单与用户做最终确认后归类：

| 路径 | 当前状态 | 建议开源去向 | 处理方式（不丢本地文件） |
| :--- | :--- | :--- | :--- |
| `design-demos/`（~12 MB） | 未跟踪 | **仅本地保留** | 加入 `.gitignore`，保留本地文件夹 |
| `.tmp/`、`bench-results/`、`tools/.preview/`、`dist/`、`.imagen/`、`imagen-output/` | 已忽略 | **仅本地保留** | 保持在 `.gitignore` |
| `.impeccable/`（`config.json` / `design.json` / `surfaces/`） | 已跟踪 | 建议**仅本地保留** | 加入 `.gitignore` 并 `git rm --cached -r .impeccable` |
| `docs/archive/`、`docs/CODE_REFACTOR_SPEC.md`、`docs/MINIMAX_H3_IMAGE_SPEC.md`、`docs/MODEL_EXPERIMENT_GUIDE.md`、`docs/PRE_RELEASE_SPEC.md` | 部分已跟踪 / 部分未跟踪 | 建议**仅本地保留**（与用户再确认哪些留公开仓库、哪些仅留本地） | 若不公开：加进 `.gitignore` 并对已跟踪项执行 `git rm --cached` |
| `bench/` | 已跟踪 | 建议**仅本地保留**，或保留脚本并脱敏 metadata | 若不公开：加进 `.gitignore` + `git rm --cached -r bench` |

> 若确认要保留上述任意文档在公开仓库中，请确保它们不包含真实本地绝对路径、个人账号或过时的误导链接。

### 3.3 个人标识与隐私脱敏扫描

1. **必须脱敏**：
   - 检查 `bench/kernel-metadata.json`、`bench/lightning/kernel-metadata.json`、`bench/probe/kernel-metadata.json`（若保留在仓库中）：把 `"id": "mogudd/..."` 改为 `"id": "your-kaggle-username/..."`。
   - 若 `docs/MODEL_EXPERIMENT_GUIDE.md`、`docs/archive/2026-11-refactor/GPU_LIVE_VERIFICATION.md` 仍保留在 Git 跟踪范围内，将其中的 `mogudd` 脱敏为 `<kaggle-username>`，本地路径 `D:\document\...` 改为相对路径或 `<repo-root>`。
2. **向用户确认 Git 提交历史处理方式**：
   - 当前提交历史含 `nanxfu <791219591@qq.com>` 及早期 `YG <yg@local>`，且历史上曾有含 `mogudd` 的提交记录。
   - **停下来询问用户**：是保留现有开发提交历史直接推往新仓库，还是在推向公共 GitHub 前做一次提交者邮箱替换 / 单基线压缩（注意此操作仅在用户明确要求时执行，且不得影响工作区未保存文档）。
3. **推前终检命令**：
   ```powershell
   Select-String -Path (git ls-files) -Pattern "(hf_[A-Za-z0-9]{10,}|KGAT_|AIza|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{10,}|C:\\Users\\|D:\\document\\|791219591|mogudd)" -CaseSensitive:$false
   ```
   确认公开跟踪文件零敏感命中。

### 3.4 准备 README 视觉截图（`docs/assets/`）

1. 本次 UI 改动定稿后，用 `node tools/preview.mjs`（或 DSH 实机出图）生成 3 张高质量代表性截图放入 `docs/assets/`（建议：浅色工作台主界面 `studio-light.png`、深色模型选择卡 `model-picker-dark.png`、作品画廊 `gallery.png`；也可附 1 张创作助手确认卡截图）。
2. 注意：**`package.json` 的 `files` 不包含 `docs/`**，因此截图放在 `docs/assets/` 不会增大 npm 包或 `dist/*.zip` 发布包体积。
3. 放好图片后，取消 `README.md` 与 `README.en.md` 中预留截图区块的 HTML 注释并检查路径正确。

### 3.5
将“免费生图”的侧边栏标题改为“生图工作台”。我们的中文产品名就定为这个。

dsh-our-imagen是我们的仓库名
---

## 4. 阶段三：版本收口、CI/CD 与 1024 Store 商店合规

> **商店调研结论（核实自 [`imsai-sh/awesome-deepseek-harness-plugins`](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) 源码）**：
> 1. 商店（`deepseek1024.com` / `dsh1024`）依赖自动化静态审查与 `dsh-plugin` GitHub Topic 发现；
> 2. 仓库默认分支必须存在申报 `dsh.bundle.patch` 的 `package.json`，且声明的入口文件（`exports["."]` / `main`）与补丁文件必须已提交在默认分支 Git Tree 中；
> 3. **安装方式关键约束**：1024 Store **仅支持从 npm 安装**（`dsh plugin --profile web add <pkg>`）。未发布 npm 包也能被收录进目录，但页面只能以**「浏览模式（browse-only）」**展示（有仓库链接、无安装命令）；发布到 npm 且 latest manifest 含 `dsh.bundle` 后，商店会自动识别并开放一键安装；
> 4. 已验证 npm 包名 `dsh-our-free-imagen` 当前未被占用（registry 返回 404）。

### 4.1 完善 `package.json`（对齐开源规范与 1024 Store）

编辑 [`package.json`](../package.json)：
1. **去掉 `"private": true`**（或向用户确认是否同时发布 npm；如确认不上 npm、只做浏览收录，则可保留并相应调整 README 安装说明）。
2. **补充标准元信息**：
   - `"author"`: `"nanxfu"`（或用户指定的 GitHub Handle）
   - `"repository"`: `{ "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }`
   - `"homepage"`: `"https://github.com/<owner>/<repo>#readme"`
   - `"bugs"`: `{ "url": "https://github.com/<owner>/<repo>/issues" }`
   - `"engines"`: `{ "node": ">=18.0.0" }`
   - `"keywords"`: `["deepseek-harness", "dsh", "dsh-plugin", "cordis", "kaggle", "image-generation", "stable-diffusion", "sdxl", "flux"]`
3. **补全 `exports` 兼容字段**（在现有导出基础上补充 `./package.json` 与 `./cordis.patch.yml`）：
   ```json
   "exports": {
     ".": "./index.js",
     "./client": "./client.js",
     "./package.json": "./package.json",
     "./cordis.patch.yml": "./cordis.patch.yml",
     "./locale/*.json": "./locale/*.json",
     "./icon": "./icon.svg"
   }
   ```
4. **校验打包内容**：执行 `npm pack --dry-run`，核对产物只包含运行所需文件（`index.js`、`client.js`、`lib/`、`shared/`、`locale/`、`icon.svg`、`cordis.patch.yml`、`remote/*.py`、`package.json`、`README.md`、`LICENSE`），不含 `docs/`、`test/`、`design-demos/`、`tools/`、`.tmp/`。

### 4.2 版本收口（建议升至 `0.5.0`）

1. 将 [`shared/contract.js`](../shared/contract.js) 的 `VERSION`、[`package.json`](../package.json) 的 `version`、[`remote/daemon.py`](../remote/daemon.py) 的 `VERSION`、[`docs/SPEC.md`](SPEC.md) 的版本标识统一升为 `0.5.0`（或经用户确认的目标版本号）。
2. 执行生成命令确保所有产物同步：
   ```powershell
   npm run contract:gen
   npm run models:build
   node build.mjs
   npm run test:contract
   npm test
   npm run package
   ```
3. 将 [`CHANGELOG.md`](../CHANGELOG.md) 顶部的 `## 未发布` 收口为正式版本条目（如 `## 0.5.0 — 2026-11-XX`），补充本轮新增的「本地持久化日志与诊断导出」记录。

### 4.3 补充 GitHub 开源工程配套

1. **`.github/workflows/ci.yml`**（push & pull_request 触发）：
   - 矩阵覆盖 `ubuntu-latest` 与 `windows-latest`（Node `20` + Python `3.11`）；
   - 执行步骤：`npm ci` → `npm run contract:check` → `npm run models:check` → `node build.mjs --check` → `npm test` → `npm pack --dry-run`。
2. **`.github/workflows/release.yml`**（推送 `v*` tag 时触发）：
   - 跑完 `npm test` 后执行 `npm run package`；
   - 自动创建 GitHub Release 并附上 `dist/dsh-our-free-imagen-*.zip`（方便无法用 npm 或想手动离线加载的用户下载）；
   - 若用户后续配置了 `NPM_TOKEN` Secret，可增加可选的 `npm publish --provenance --access public` 步骤。
3. **`.github/ISSUE_TEMPLATE/bug_report.yml`** & **`CONTRIBUTING.md`**：
   - Issue 模板引导用户填写：OS、DSH 版本、`kaggle --version`、使用模型预设，并粘贴工作台「复制诊断信息」导出的脱敏文本；
   - `CONTRIBUTING.md` 说明契约单源约定（`shared/contract.js`）、如何通过 `models/*.json` + `tools/verify-model.mjs` 贡献新模型，以及 `npm test` 校验要求。

---

## 5. 阶段四：推送 GitHub 与上架 `imsai-sh/awesome-deepseek-harness-plugins`

> ⚠️ **本阶段所有外部写入操作均需先向用户汇报并获得明确许可后再执行。**

1. **创建与推送 GitHub 仓库**：
   - 检查所有待提交文件列表，确认无未脱敏信息、无 `design-demos/` 等过程大文件；
   - 推送至公开 GitHub 仓库（确认默认分支为 `main` 或 `master`），更新 `README.md` / `README.en.md` / `package.json` 中的 `<owner>/<repo>` 占位符（若有）；
   - **设置仓库 Topic**：必须加上 **`dsh-plugin`**（可通过 GitHub 网页或 `gh repo edit <owner>/<repo> --add-topic dsh-plugin`），建议补充 `deepseek-harness`、`kaggle`、`sdxl`、`image-generation`。
2. **（推荐）发布到 npm**：
   - 在获得用户确认并完成 npm 登录/权限校验后，在干净构建状态下执行 `npm publish --access public`；
   - 验证 `https://registry.npmjs.org/dsh-our-free-imagen` 返回 latest manifest 且包含 `dsh.bundle.patch`。
3. **提交收录 PR 到 `imsai-sh/awesome-deepseek-harness-plugins`**：
   - **推荐方式**（商店官方 Skill）：
     ```bash
     npx skills add imsai-sh/awesome-deepseek-harness-plugins --skill submit-dsh-plugin -g
     ```
     按 `submit-dsh-plugin` 校验并生成 PR。
   - **或手动提交规范**：
     - 唯一改动文件：`catalog/plugins/<owner>--<repo>.json`（全小写、非字母数字转 `-`、段间用 `--` 连接，不得改其他任何文件）；
     - 推荐分类：`category: "tools"`（提供 Agent 生图工具 + 独立生图工作台，符合商店“按用户获得的主要能力分类”指南；也可在提交前与作者确认是否改选 `model`）；
     - 元数据示例（遵守 `catalog/schema/plugin.schema.json`，中英文简介必须客观中性、禁用最高级与号召词）：
       ```json
       {
         "$schema": "../schema/plugin.schema.json",
         "id": "<owner>/<repo>",
         "name": "<repo>",
         "repository": "https://github.com/<owner>/<repo>",
         "category": "tools",
         "description": {
           "en": "Image generation workbench and agent tools for DeepSeek Harness backed by Kaggle GPU kernels, supporting SDXL and FLUX.2 presets with local workspace output.",
           "zh": "基于 Kaggle GPU 容器的 DeepSeek Harness 文生图工作台与 Agent 工具插件，支持 SDXL 与 FLUX.2 预设并将产物直接保存至本地工作区。"
         },
         "added": "YYYY-MM-DD"
       }
       ```
     - PR 描述按官方模板填写 `Manifest: package.json`、`Bundle patch: ./cordis.patch.yml` 以及实际跑通的测试命令和结果（如 `npm test`、`npm run test:contract` 实测通过项数）。
     - 非草稿新增类 PR 通过 `Plugin submission review / static-review` 后会自动 squash merge 并同步到 `deepseek1024.com`。

---

## 6. 最终上线核对表（Done Checklist）

- [ ] **本地保留核验**：`.impeccable/`、`design-demos/`、`docs/archive/` 等作者本地开发文档完好留存在磁盘，未被删除
- [ ] **阶段一通过**：Host 本地滚动日志（`2 MiB` 轮转 + 严格脱敏）、`JobQueue` / `SessionManager` / `net` / `kaggle` 打点、增强版「复制诊断信息」及对应单测全部通过
- [ ] **阶段二通过**：`.gitattributes` 已就位，全仓统一 LF，敏感信息与个人 Kaggle 账号残留清零
- [ ] **阶段三通过**：`package.json` 符合 DSH Bundle 与 npm 规范，版本号统一，`npm test`、`npm run test:contract`、`node build.mjs --check`、`npm run package`、`npm pack --dry-run` 全绿，CI/Release workflow 就位
- [ ] **阶段四通过**：公开 GitHub 仓库已打 `dsh-plugin` topic、README 截图已渲染正常、GitHub Release zip（及可选 npm 包）已发布、`imsai-sh/awesome-deepseek-harness-plugins` PR 静态审查通过并合入
