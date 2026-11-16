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
  "promptStyle": "concise",
  "qualityPrefix": "",
  "sizeOptions": [768, 1024, 1152],
  "runtime": "default",
  "supportsImg2Img": true,
  "supportsInpaint": true,
  "supportsNegative": true,
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
| `promptStyle` / `qualityPrefix` | 提示词配方：提示词的书写口径与质量词前缀，见 §2.1 |
| `runtime` | 运行时底座。当前只允许 `"default"`（统一验证过的环境） |
| `supportsImg2Img` | 图生图（垫图重绘）能力。可缺省，缺省按 `false`；只有能用 `AutoPipelineForImage2Image.from_pipe` 复用整管的模型才能标 `true`，见 §2.2 |
| `supportsInpaint` | 局部重绘（涂抹蒙版）能力。可缺省，缺省按 `false`；只有能用 `AutoPipelineForInpainting.from_pipe` 复用同一底座的模型才能标 `true`，且必须同时 `supportsImg2Img = true`，见 §2.2 |
| `inpaintOnly` | 专用局部重绘权重：只能带蒙版使用，不能文生图 / 纯图生图。可缺省，缺省按 `false`；标 `true` 时 `supportsInpaint` 必须为 `true` 且 `pipeline.nativeInpaint` 必须为 `true`，见 §2.2 |
| `supportsNegative` | 负向提示词能力：模型管线是否真的消费 `negative_prompt`。必填布尔值，见 §2.3 |
| `pipeline` | 下发给远端 Daemon 的加载描述；`downloadGb` 用于下载前磁盘预检 |
| `measured` | 靶场实测指标：峰值显存、加载耗时、稳态耗时、实际下载量。未实测的字段填 `null` |

`runtime` 规则：

- 默认全部使用统一验证过的运行时底座（`"default"`），由 daemon 全局的依赖安装流程负责；
- 生产侧保持“一次会话一套环境”。未来出现需要特殊运行时的模型时，Host 只提示“切换该模型需要重启远端会话”，不做远端热重装。

### 2.1 提示词配方（promptStyle / qualityPrefix）

九个预设都按英文提示词训练，但不同模型对提示词的书写口径不同。这两个字段只描述“怎么写给这个模型看”，不参与远端加载。

| 字段 | 说明 |
| :--- | :--- |
| `promptStyle` | 提示词书写口径，只允许 `danbooru` / `natural` / `concise`（见下表） |
| `qualityPrefix` | 质量词前缀，字符串，可为空串；非空时写在提示词最前面（如 `masterpiece, best quality, highres`） |

`promptStyle` 取值：

| 取值 | 含义 | 要求 |
| :--- | :--- | :--- |
| `danbooru` | Danbooru 标签流模型（如 Animagine） | 英文逗号分隔的标签：质量词前缀、主体、外观、场景、构图、光影；不写完整句子 |
| `natural` | 自然语言段落型模型（SDXL Base / RealVis / FLUX 等） | 一到两句完整英文句子：主体、环境、光线、材质、镜头 |
| `concise` | 少步快速模型（Lightning / Hyper / Turbo） | 简短英文短语（约 25 词以内），优先主体、场景与光影，少用修辞 |

消费方：`lib/intent.js` 的对话意图解析按当前预设的这两个字段动态约束宿主模型，要求 `prompt` 永远是英文；`qualityPrefix` 会作为固定质量词要求写进提示词开头。中文只出现在确认卡的 `summary`（UI 语言摘要）里，不进入发给模型的提示词。

校验：`tools/build-assets.mjs` 要求两个字段必须存在，且 `promptStyle` 必须在上表枚举内；`npm run models:check` 会一并校验。

### 2.2 图生图与局部重绘能力（supportsImg2Img / supportsInpaint）

图生图与局部重绘共用同一条「复用已加载底座」的零显存路径，因此放在一起说明。

`supportsImg2Img`：

| 取值 | 含义 |
| :--- | :--- |
| `true` | 支持垫图重绘：客户端可以放参考图，远端用 `AutoPipelineForImage2Image.from_pipe()` 复用已加载的文生图底座，不额外占显存 |
| `false`（缺省） | 不支持：客户端参考图槽位不可用（自动切到支持的预设）；远端对带 `reference` 的请求返回 `invalid_request`，文案为「该模型不支持垫图重绘」 |

`supportsInpaint`：

| 取值 | 含义 |
| :--- | :--- |
| `true` | 支持局部重绘：参考图上可以附带黑白蒙版（白 = 重绘区域、黑 = 保留区域），远端用 `AutoPipelineForInpainting.from_pipe()` 复用同一底座，不额外占显存 |
| `false`（缺省） | 不支持：客户端不显示涂抹入口；远端对带 `reference.mask` 的请求返回 `invalid_request`，文案明确「该模型不支持局部重绘」 |

判定标准：

- 模型必须是可被 diffusers 整管复用的模型（当前 `pipeline.loader` 为 `sdxl` / `sdxl-lora`），其组件能被 `AutoPipelineForImage2Image.from_pipe()` / `AutoPipelineForInpainting.from_pipe()` 直接复用；
- 首期（0.12.0）只开放 SDXL 家族（含 SDXL + LoRA 组合）；`flux2` / `anima` 等特殊 loader 暂不支持，两者都标 `false`；
- `supportsInpaint = true` 必须同时 `supportsImg2Img = true`（蒙版叠在参考图上，没有参考图就无从重绘），`tools/build-assets.mjs` 会校验这条联合约束；
- 标 `true` 前必须在真机用一张参考图（局部重绘还要加一张蒙版）跑通一次，并按 §3 的验证流程记录结果。

**专用局部重绘权重（`inpaintOnly` + `pipeline.nativeInpaint`）**：

通用底座（4 通道 UNet）的局部重绘靠 `from_pipe` 派生，走的是「每步把未涂抹区域混回」的兼容路径，边界融合质量有限。
对「只做局部重绘」的专用权重（9 通道 UNet，如 `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`）：

| 字段 | 取值 | 说明 |
| :--- | :--- | :--- |
| `inpaintOnly` | `true` | 模型只能带蒙版使用：客户端缺蒙版时拦下生成并提示，Host 入队前拒绝，daemon 提交期再兜一层 |
| `pipeline.nativeInpaint` | `true` | 告诉 daemon 用 `AutoPipelineForInpainting.from_pretrained` 加载（而不是文生图工厂）；加载后的底座本身就是 inpaint 管线，`ensure_inpaint_pipeline()` 直接复用、不再 `from_pipe` |

约束与消费方：

- `inpaintOnly = true` 时 `supportsInpaint` 必须为 `true`、`pipeline.nativeInpaint` 必须为 `true`，`supportsImg2Img` 仍建议标 `true`（界面据此保留参考图槽位）；
- 客户端：`inpaintOnlyOf()` 判断专用模型；缺参考图或蒙版时 `maskRequiredBlocked` 置位，生成被拦下并提示先「以此图重绘」+ 涂抹；参考图兜底预设（`referencePresetOf`）跳过这类模型；
- Host：`JobQueue.submit` 在入队前拒绝「专用模型 + 无蒙版」的请求（`invalid_request`）；
- daemon：提交期 `parse_reference_spec` 拒绝无蒙版的文生图/纯图生图请求；执行期 `run_task` 有同等兜底；这类模型不参与 `img2img_loaders` 的 `from_pipe` 路径。

通用能力字段（`supportsImg2Img` / `supportsInpaint`）的消费方：
- 客户端：`shared/contract.js` 的 `publicPresets()` 只剔除 `pipeline`，能力字段随预设公开视图下发；参考图槽位、画廊「以此图重绘」与涂抹入口按字段决定是否可用，不支持时自动切到支持预设或置灰提示。
- Host：提交 `/generate` 前校验参考图与蒙版的来源、格式、体积、尺寸边界与 `strength`；二进制不进任务公开视图，只把 `sourcePath` / `strength` / 是否带蒙版记进产物 meta。
- daemon：`SUPPORTED_IMG2IMG_LOADERS` / `SUPPORTED_INPAINT_LOADERS`（均为 `sdxl` / `sdxl-lora`）是最后一道兜底，其它 loader 一律按 `invalid_request` 拒绝，不信任客户端标记。

校验：`tools/build-assets.mjs` 要求两个字段若存在必须是布尔值，且 `supportsInpaint` 不能脱离 `supportsImg2Img`；缺省按 `false` 归一后写入 `shared/models.generated.js`（`npm run models:check` 会一并校验生成物同步）。

### 2.3 负向提示词能力（supportsNegative）

`supportsNegative` 描述**模型管线是否真的消费 `negative_prompt`**，与「CFG 是否大于 0」是两件事：前者是管线能力，后者决定本次请求里的负向词是否生效。

| 取值 | 含义 |
| :--- | :--- |
| `true` | 管线接受负向提示词：`negative_prompt` 会参与条件编码（SDXL 家族在 `cfg > 0` 时生效，`anima` 运行时在 CFG > 1 时作为无条件分支参与引导，推荐 CFG=4） |
| `false` | 管线没有负向词输入，传了也会被丢弃；客户端与助手应隐藏「排除项」，避免用户填写无效参数 |

当前 10 个预设中只有 `flux2-klein-4b` 为 `false`：diffusers 的 `Flux2Pipeline.__call__` 没有 `negative_prompt` 参数，`remote/daemon.py` 的 `run_task()` 按 `__call__` 签名（`STATE.sig_params`）过滤参数，即使请求里带了负向词也不会传进管线。其余 9 个（`sdxl-lightning` / `hyper-sdxl-8step` / `sdxl-turbo` / `playground-v2.5` / `sdxl-base` / `sdxl-inpaint` / `realvis-v5` / `animagine-xl-3.1` / `anima-light-lavender`）为 `true`：SDXL 家族走 diffusers 的 `negative_prompt` 形参（专用 inpaint 权重同样支持）；`anima-light-lavender` 的自定义运行时显式接收并使用负向词。

判定标准：

- 查看 loader 对应生成管线的 `__call__` 是否接受 `negative_prompt`（diffusers 源码 / 模型卡），或真机确认负向词确实改变出图；
- 不确定时填 `false`：标错的成本不对称——`false` 只是隐藏了可用能力，`true` 会让界面多出一个实际被丢弃的输入框，并让助手输出无效负向词；
- 该字段与 `negativeHint`（模型推荐默认负向词）相互独立：支持负向词但默认不推荐时 `negativeHint` 可以是空串（如 `anima-light-lavender`），此时排除项默认隐藏，用户主动抬高 CFG 后出现。

联合判定：是否展示/使用负向词由 `shared/models-guide.js` 的 `negativePromptActive(preset, cfg)` 决定，Host 与 Client 共用同一份规则，不得各写一套：

1. 预设缺失（旧宿主 / 尚未拿到预设）→ 只看 `cfg > 0`；
2. 预设带 `supportsNegative` → 必须为 `true`；旧宿主预设没有该字段时，用 `negativeHint` 非空兜底；
3. 必须 `cfg > 0`（CFG=0 的采样会忽略负向词，daemon 也不会传）；
4. 且 `negativeHint` 非空，或用户把 CFG 抬到高于预设推荐值。

结果：默认 `cfg = 0` 的 4 步极速模型（`sdxl-lightning` / `hyper-sdxl-8step` / `sdxl-turbo`）与 `flux2-klein-4b` 默认隐藏排除项；用户抬高 CFG 后出现，恢复默认后再次隐藏。

消费方：

- 构建：`tools/build-assets.mjs` 把 `supportsNegative` 列为必填字段，缺失或非布尔值直接失败；归一后写入 `shared/models.generated.js` 的 `MODELS` 与 `PRESETS`。
- 下发：`shared/contract.js` 的 `publicPresets()` 只剔除 `pipeline`，`supportsNegative` 随 `/state` 的 `presets` 原样下发给客户端。
- 客户端：按 `negativePromptActive()` 决定「排除项」显隐；提交时不可用则把 `negativePrompt` 置空串，不发无效参数。
- Host 助手：`lib/intent.js` 用同一函数决定响应里的 `negative` 是否必须为空串，`lib/enhance.js` / `lib/tools.js` 复用同一模型目录生成提示词与工具描述。
- daemon：不读该字段，按「`negative_prompt` 在 `__call__` 签名内」且 `cfg > 0` 双条件兜底，不信任客户端标记。

校验：`npm run models:check` 与 `node test/check-contract.mjs` 会校验生成物与 `models/` 同步。

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
5. **loader 单份源码 + 打包内联**：`remote/daemon.py` 是生产常驻实现；`tools/payload/verify-model.py` 是一次性验证 payload。Kaggle 只接受单个 `code_file`，但**不需要**在仓库里维护两份实现：公共运行时（当前是 Anima）只有 `remote/anima_runtime.py` 一份，两边各保留一行带 `# @@INLINE:<模块>.py@@` 标记的普通 import；`lib/kernel.js` 的 `inlineMarkedModules()` 在打包时把标记行整行替换为模块全文，最终推送产物仍是自包含单文件（`tools/verify-model.mjs` 复用同一打包器）。本地测试走同目录普通 import。改动加载逻辑时只改这一份，不要复制回去；`test/kernel-package.mjs` / `test/check-verify-model.mjs` 会断言打包产物没有未内联的 import、运行时只包含一份实现且能通过 Python 语法编译。

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
- [x] **阶段 E：新增 loader `anima`（2026-11-11）**：`anima-light-lavender` 是单文件 ComfyUI checkpoint（Cosmos-Predict2 2B DiT + Qwen3-0.6B 文本编码器 + Qwen-Image VAE + Qwen2/T5 双分词器），没有 diffusers 仓库结构，因此新增 loader `anima`：Anima 运行时抽成单份源码 `remote/anima_runtime.py`（模型定义、结构化 caption、euler+simple 采样、CFG-Zero★、dtype 策略、文本编码器卸载与缓存、VAE 解码兜底），`remote/daemon.py` 与 `tools/payload/verify-model.py` 各保留一行带 `@@INLINE@@` 标记的 import，由 `lib/kernel.js` 在打包时内联成自包含单文件，`pipeline` 增加 `weight` / `textEncoder` / `vae` / `tokenizers` / `dtype` / `shift` 字段。`models/` 模型总数 8 → 9；实测由 `tools/verify-model.mjs --write` 回填（峰值显存 8470 MB / 加载 43.5 s / 稳态 80.64 s / 下载 5.25 GiB）。模型事实、loader 契约、T4 上的 bf16/fp16 数值问题与三轮修复记录见 [`ANIMA_LOADER_SPEC.md`](ANIMA_LOADER_SPEC.md)。
- [ ] **后续：特殊运行时**：按实际需求再开放 `runtime` 取值与 Host 重启会话提示；当前不实现。
- [ ] **前沿大模型预研**：超大规模开源底座技术调研与部署规格详见 [`docs/MINIMAX_H3_IMAGE_SPEC.md`](MINIMAX_H3_IMAGE_SPEC.md)（针对 MiniMax-H3-Image 33.1B 的硬件边界、量化与部署路径评估）；Kaggle 真机可行性结论见该文档第 7 节。