# 模型资产规范与录入指南 (MODEL_ASSET_SPEC)

本规范定义 `our-free-imagen` 的模型资产组织方式、运行数据记录格式，以及模型从外部引入到验证沉淀的流程。

## 1. 原则

- **单模型单文件**：一个模型一个 `models/<id>.json`，字段扁平，不拆子文件。
- **可用性只看物理结果**：进程正常退出、图片文件能正常解码。显存、冷启动、稳态耗时等只作为客观测量值记录，不做主观拦截。
- **不重复造工具**：复用现有 Kaggle CLI 与 Kernel 打包逻辑，验证编排用 Node，不在本地另起 Python 守护进程。
- **不做防篡改设计**：自研项目，实测数据如实填写即可，不加哈希、签名、防伪校验。
- **模型定义唯一来源**：`models/*.json` 是唯一来源；`shared/contract.js` 只做 re-export，不手写预设数据。

## 2. 资产格式

文件路径：`models/<id>.json`，文件名必须等于 `id`。

```json
{
  "id": "sdxl-lightning",
  "order": 10,
  "label": "SDXL Lightning",
  "family": "SDXL",
  "short": "Lightning",
  "description": {
    "zh": "4 步极速出图，平衡画质与耗时",
    "en": "4-step fast generation, balanced quality"
  },
  "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
  "params": "3.5B + LoRA",
  "license": "OpenRAIL++",
  "licenseKind": "open",
  "gated": false,
  "gpus": 1,
  "tier": "fast",
  "size": 1024,
  "steps": 4,
  "cfg": 0,
  "negativeHint": "blurry, low quality, deformed, extra limbs",
  "sizeOptions": [768, 1024, 1152],
  "runtime": "default",
  "pipeline": {
    "loader": "sdxl-lora",
    "base": "stabilityai/stable-diffusion-xl-base-1.0",
    "lora": {
      "repo": "ByteDance/SDXL-Lightning",
      "weight": "sdxl_lightning_4step_lora.safetensors"
    },
    "scheduler": { "type": "euler", "timestepSpacing": "trailing" },
    "variant": "fp16",
    "downloadGb": 6.78,
    "allowPatterns": [
      "model_index.json",
      "**/config.json",
      "**/*.json",
      "**/*.txt",
      "**/*.fp16.safetensors"
    ],
    "deviceMap": null
  },
  "measured": {
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "downloadGb": 6.78
  }
}
```

字段说明：

| 字段 | 说明 |
| :--- | :--- |
| `id` | 唯一标识（短横线命名），必须等于文件名 |
| `order` | 预设顺序（数字唯一），决定工作台下拉顺序 |
| `label` / `family` / `short` / `description` | 界面用的人类数据：完整商业名 / 家族徽标 / 触发器短名 / 双语定位描述 |
| `params` / `license` / `licenseKind` / `gated` / `gpus` / `tier` | 说明与筛选用的人类数据 |
| `size` / `steps` / `cfg` / `sizeOptions` / `negativeHint` | 推荐默认参数 |
| `runtime` | 运行时底座。当前只允许 `"default"`（统一验证过的环境） |
| `pipeline` | 下发给远端 Daemon 的加载描述；`downloadGb` 用于下载前磁盘预检 |
| `measured` | 靶场实测指标：峰值显存、加载耗时、稳态耗时、实际下载量。未实测的字段填 `null` |

`runtime` 规则：

- 默认全部使用统一验证过的运行时底座（`"default"`），由 daemon 全局的依赖安装流程负责；
- 生产侧保持“一次会话一套环境”。未来出现需要特殊运行时的模型时，Host 只提示“切换该模型需要重启远端会话”，不做远端热重装。

## 3. 录入与验证流程

> Agent 执行入口：[`skills/model-asset-intake/SKILL.md`](../skills/model-asset-intake/SKILL.md)。
> 该 skill 包含具体操作步骤、失败分类自愈表、硬性约束和 JSON 模板；本节只保留流程与约定。
> 仓库内的 skill 需要复制到 `~/.dsh/skills/`（命令见 README）或由插件分发后，Agent 才能自动发现。

```
外部素材 / 代码段 / 博客 / 论文 / 链接
        │
        ▼
编写草稿 .tmp/models/<id>.json（只填展示字段、pipeline、runtime，measured 先留 null）
        │
        ▼
node tools/verify-model.mjs --config .tmp/models/<id>.json
        │
   ┌────┴────┐
   ▼         ▼
报错退出    正常出图
按 Traceback 调整   回填 measured 后
依赖或参数重试      移到 models/<id>.json
        │
        ▼
npm run models:build   → 生成 shared/models.generated.js
npm run models:check   → 校验生成文件同步
npm test               → 全仓回归
```

### 3.1 可用性判定

`tools/verify-model.mjs` 在远端只检查两件事：

1. Python 进程正常退出（无未捕获异常、无 CUDA OOM）；
2. 指定输出路径存在可解码的图片文件（校验 PNG 文件头，不只看字节数）。

### 3.2 实测数据采集

通过可用性检查后，自动采集并写入 `measured`：

- `peakVramMb`：`torch.cuda.max_memory_allocated()` 峰值；
- `loadSeconds`：Pipeline 加载耗时；
- `steadySeconds`：后续出图耗时的中位数（至少 3 次，丢弃首张）；
- `downloadGb`：实际拉取的权重体积。

允许先人工按已知实测值填写（例如从 `bench-results/` 迁移已有数据），但不得用上游宣称值编造。

## 4. 构建与集成

1. `models/*.json` 为唯一来源；`npm run models:build` 生成 `shared/models.generated.js`（导出 `MODELS` 与 `PRESETS`）。
2. `shared/contract.js` 从生成文件导入并 re-export `PRESETS`；`DEFAULT_PRESET`、`presetById()`、`publicPresets()` 保持原有语义。
3. 校验：
   - `npm run models:check`：校验模型 JSON、id/order 唯一性、生成文件是否同步；
   - `node test/check-contract.mjs`：第 k 项检查 `shared/models.generated.js` 与 `models/` 同步；
   - `npm test` 已包含以上检查。
4. 生成文件不含时间戳，相同输入产出相同内容，git diff 只反映模型变化。
5. **双份 loader 维护约定**：`remote/daemon.py` 是生产常驻实现；`tools/payload/verify-model.py` 是一次性验证 payload（Kaggle 只接受单个 code_file，两者无法共享模块）。改动加载逻辑时必须同步两处：loader 分支、variant 回退、LoRA 挂载、scheduler、deviceMap。以 daemon 为准，verify payload 只保留采样所需的最小分支；`test/check-verify-model.mjs` 只覆盖编排侧，payload 的加载分支靠真机验证兜底。

## 5. 实施状态

- [x] **阶段 A：资产抽象**：`models/*.json` 拆出 4 个现有预设；`tools/build-assets.mjs` 生成 `shared/models.generated.js`；`contract.js` re-export；`check-contract` 增加同步检查；旧 `PRESETS` 深度对比一致。
- [x] **阶段 B：验证脚本**：`tools/verify-model.mjs` + 远端 payload `tools/payload/verify-model.py`：
  - `--config <path>` 读取草稿或正式文件，复跑 `--config models/<id>.json` 可刷新实测数据；
  - 复用 `lib/kernel.js` 打包、`lib/kaggle.js` 推送/日志/产物下载，不另写推送轮子；
  - `--dry-run` 只做配置校验与 Kernel 打包演练，不调用 Kaggle，可进离线回归（`test/check-verify-model.mjs`）；
  - `--timeout <min>` 整体超时，默认 30 分钟；
  - 成功后样张保存到 `.tmp/verify/<id>.png`，控制台打印显存/加载/首图/稳态/下载体积；`--write` 把 `measured` 写回原 JSON；
  - 失败按 `pip_conflict / cuda_oom / import_error / download_failed / disk_full / invalid_config / timeout / auth_required / push_failed / kernel_error` 分类，并打印最后 20 行日志，退出码非 0。
- [x] **阶段 C：Agent 操作闭环**：新增 [`skills/model-asset-intake/SKILL.md`](../skills/model-asset-intake/SKILL.md)，覆盖「外部链接 → 草稿 → dry-run → 真机验证（先确认配额）→ 失败自愈 → 入库 → build/check/test」全流程；skill 与本文档互为入口。
- [x] **阶段 D：模型资产扩容（2026-11-11）**：按 [`docs/MODEL_EXPERIMENT_GUIDE.md`](MODEL_EXPERIMENT_GUIDE.md) 完成 4 个 SDXL 系列候选的 Kaggle 真机验证并入库（`playground-v2.5`、`realvis-v5`、`animagine-xl-3.1`、`hyper-sdxl-8step`），模型总数 4 → 8；`measured` 全部由 `tools/verify-model.mjs --write` 回填。实测结果与草案修正见该指南 1.4 节。
- [x] **阶段 E：新增 loader `anima`（2026-11-11）**：`anima-light-lavender` 是单文件 ComfyUI checkpoint（Cosmos-Predict2 2B DiT + Qwen3-0.6B 文本编码器 + Qwen-Image VAE + Qwen2/T5 双分词器），没有 diffusers 仓库结构，因此新增 loader `anima`：`tools/payload/verify-model.py` 与 `remote/daemon.py` 各含一份逐字一致的运行时（模型定义、结构化 caption、euler+simple 采样、CFG-Zero★、dtype 策略、文本编码器卸载与缓存、VAE 解码兜底），`pipeline` 增加 `weight` / `textEncoder` / `vae` / `tokenizers` / `dtype` / `shift` 字段。`models/` 模型总数 8 → 9；实测由 `tools/verify-model.mjs --write` 回填（峰值显存 8470 MB / 加载 43.5 s / 稳态 80.64 s / 下载 5.25 GiB）。模型事实、loader 契约、T4 上的 bf16/fp16 数值问题与三轮修复记录见 [`ANIMA_LOADER_SPEC.md`](ANIMA_LOADER_SPEC.md)。
- [ ] **后续：特殊运行时**：按实际需求再开放 `runtime` 取值与 Host 重启会话提示；当前不实现。
- [ ] **前沿大模型预研**：超大规模开源底座技术调研与部署规格详见 [`docs/MINIMAX_H3_IMAGE_SPEC.md`](MINIMAX_H3_IMAGE_SPEC.md)（针对 MiniMax-H3-Image 33.1B 的硬件边界、量化与部署路径评估）；Kaggle 真机可行性结论见该文档第 7 节。