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
| `supportsReference` | 模型原生参考生图能力。**必填布尔值**；基础管线原生接收 `image=[PIL...]` 图像条件、宽高仍由请求决定的模型才能标 `true`，见 §2.2.1 |
| `inpaintOnly` | 专用局部重绘权重：只能带蒙版使用，不能文生图 / 纯图生图。可缺省，缺省按 `false`；标 `true` 时 `supportsInpaint` 必须为 `true` 且 `pipeline.nativeInpaint` 必须为 `true`，见 §2.2 |
| `supportsNegative` | 负向提示词能力：模型管线是否真的消费 `negative_prompt`。必填布尔值，见 §2.3 |
| `providers` | 算力来源能力位：模型能在哪些远端后端运行。可缺省，缺省 = `kaggle` / `colab` 全可用；显式给出时必须是非空、无重复的 `kaggle` / `colab` 数组，见 §2.5 |
| `pipeline` | 下发给远端 Daemon 的加载描述；`downloadGb` 用于下载前磁盘预检；可选 `accel` 推理加速开关，见 §2.4 |
| `measured` | 靶场实测指标：峰值显存、加载耗时、稳态耗时、实际下载量。未实测的字段填 `null` |

`runtime` 规则：

- 默认全部使用统一验证过的运行时底座（`"default"`），由 daemon 全局的依赖安装流程负责；
- 生产侧保持“一次会话一套环境”。未来出现需要特殊运行时的模型时，Host 只提示“切换该模型需要重启远端会话”，不做远端热重装。

`pipeline` 的加载描述字段（细节见 `remote/daemon.py` 顶部说明）：

- `variant`：`from_pretrained` 的权重变体目录后缀（如 `"fp16"`）；**仓库没有 `*_fp16` 变体文件时必须写 `null`**，
  否则 diffusers 会先按变体探测、失败后再回退，在真实链路里浪费一次 15~20s 的长下载探测。
  主权重为 BF16 的仓库也写 `null`，加载时由 `torch_dtype=fp16` 现场转换。
- `allowPatterns`：预下载白名单（与 `snapshot_download` 的 `allow_patterns` 同词法：`model_index.json`、
  `scheduler/**`、`transformer/**` 这类 glob；`null` 表示整仓下载）。目录里同时存在
  单文件整包副本（如 `*.safetensors` 7.75GB）与示意图时，用组件目录白名单避免重复下载；
  白名单必须覆盖 diffusers 需要的全部组件，缺文件会加载失败——真机验证过再收紧。
- `downloadGb`：按白名单预期下载量的规划值（磁盘预检按它乘 1.15 余量）；`measured.downloadGb`
  是最近一次真机的实测值，收紧白名单后重测前保持 `null`（build-assets 允许 null，但非 null 时必须与
  `pipeline.downloadGb` 相等，避免「规划变了、实测没更新」的静默漂移）。

### 2.1 提示词配方（promptStyle / qualityPrefix）

九个预设都按英文提示词训练，但不同模型对提示词的书写口径不同。这两个字段只描述“怎么写给这个模型看”，不参与远端加载。

| 字段 | 说明 |
| :--- | :--- |
| `promptStyle` | 提示词书写口径，只允许 `danbooru` / `natural` / `concise`（见下表） |
| `qualityPrefix` | 质量词前缀，字符串，可为空串；非空时写在提示词最前面（如 `masterpiece, best quality, highres`） |

`promptStyle` 取值：

| 取值 | 含义 | 要求 |
| :--- | :--- | :--- |
| `danbooru` | Danbooru 标签流模型（如 `anima-turbo-v1.1`） | 英文逗号分隔的标签：质量词前缀、主体、外观、场景、构图、光影；不写完整句子 |
| `natural` | 自然语言段落型模型（`sana-sprint-1.6b` / `z-image-turbo` / `qwen-image-2.1` / FLUX 等） | 一到两句完整英文句子：主体、环境、光线、材质、镜头 |
| `concise` | 少步快速模型（如 `sdxl-lightning` 的 4 步档） | 简短英文短语（约 25 词以内），优先主体、场景与光影，少用修辞 |

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

- 模型必须是可被 diffusers 整管复用的模型（当前 `pipeline.loader` 为 `sdxl` / `sdxl-lora` / `zimage`），其组件能被 `AutoPipelineForImage2Image.from_pipe()` / `AutoPipelineForInpainting.from_pipe()` 直接复用；
- 当前开放给 `sdxl-lora`（`sdxl-lightning`）与 `zimage`（`z-image-turbo`）两个 loader；`flux2` / `anima` / `sana-sprint` / `qwen-image-2.1` 等 loader 暂不支持，均标 `false`；
- `supportsInpaint = true` 必须同时 `supportsImg2Img = true`（蒙版叠在参考图上，没有参考图就无从重绘），`tools/build-assets.mjs` 会校验这条联合约束；
- 标 `true` 前必须在真机用一张参考图（局部重绘还要加一张蒙版）跑通一次，并按 §3 的验证流程记录结果。

**专用局部重绘权重（`inpaintOnly` + `pipeline.nativeInpaint`）**：

通用底座（4 通道 UNet）的局部重绘靠 `from_pipe` 派生，走的是「每步把未涂抹区域混回」的兼容路径，边界融合质量有限。
对「只做局部重绘」的专用权重（9 通道 UNet，如 `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`）：
契约保留 `inpaintOnly` + `pipeline.nativeInpaint` 两个标记（阶段十七起 7 款现役资产均未使用，
原 `sdxl-inpaint` 已下线；能力位与远端 nativeInpaint 加载分支仍保留，供后续专用权重复用）。

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
- daemon：`img2img_names()` / `inpaint_names()`（当前 `sdxl` / `sdxl-lora` / `zimage`）是最后一道兜底，其它 loader 一律按 `invalid_request` 拒绝，不信任客户端标记。

校验：`tools/build-assets.mjs` 要求两个字段若存在必须是布尔值，且 `supportsInpaint` 不能脱离 `supportsImg2Img`；缺省按 `false` 归一后写入 `shared/models.generated.js`（`npm run models:check` 会一并校验生成物同步）。

### 2.2.1 模型原生参考生图能力（supportsReference）

与 `supportsImg2Img` / `supportsInpaint` 是**三条独立的能力位**，语义不同：

| 字段 | 请求形状 | 远端路径 | 尺寸 / 强度 |
| :--- | :--- | :--- | :--- |
| `supportsImg2Img` | `reference`（单图 + `strength`） | `AutoPipelineForImage2Image.from_pipe` 复用底座 | 出图跟随参考图，吃 strength |
| `supportsInpaint` | `reference` + `mask` | `AutoPipelineForInpainting.from_pipe` 复用底座 | 出图跟随参考图，strength 上限 `inpaintMax` |
| `supportsReference` | `references`（1~N 张作品路径） | 基础管线直接接收 `image=[PIL...]` 条件 | 宽高取请求值，没有 strength / 蒙版 |

| 取值 | 含义 |
| :--- | :--- |
| `true` | 支持模型原生参考生图：客户端可提交 `references` 数组，远端把解码后的 PIL 列表作为 `image=` 传给基础管线（不 from_pipe） |
| `false` | 不支持：客户端参考槽位不提供「原生参考」入口；Host 入队前拒绝 `references`，远端按 loader 白名单返回 `invalid_request` |

判定标准：

- 模型的基础生成管线 `__call__` 原生接收 `image`（`list[PIL.Image.Image] | PIL.Image.Image`）且仍保留
  `width` / `height` / `num_inference_steps` / `guidance_scale` / `generator`；
- 当前登记 `flux2`（`Flux2KleinPipeline`，`flux2-klein-4b` / `flux2-klein-9b`）与 `qwen-image-2.1`
  （`QwenImage21Pipeline`）两个 loader；其它家族需先真机验证再标 `true`；
- **与 `supportsImg2Img` 互斥**：两种请求形状不同（`references` 数组 vs `reference` 单图），同一预设
  同时标 `true` 会让 Host / 客户端无法判断走哪条路径，`tools/build-assets.mjs` 会拒绝这种组合。
  未来若某个模型确实两条都支持，再放开该联合约束并补「优先走哪条」的客户端口径；
- 标 `true` 前必须在真机验证 1~N 张参考图的耗时 / 显存 / 成片效果，并按契约
  `LIMITS.referenceImages`（`maxCount` / `maxBytes` / `maxEdge` / `minEdge`）记录安全边界；
  Klein 4B 的参考条件是**弱参考**（提示词与 seed 仍主导），不要按「强一致参考」宣传。

消费方：

- 客户端：`supportsReference` 随 `publicPresets()` 下发，参考槽位据此决定是否可用与提示文案；
- Host：`references` 只允许在预设 `supportsReference=true` 且 `tool=generate` 时放行，与 `reference` 互斥，
  路径形状 / 数量按契约校验，读盘后的体积与魔数校验在执行阶段完成；
- daemon：`reference_names()`（当前 `flux2` 与 `qwen-image-2.1`）是最后一道兜底，非支持 loader 一律 400，
  不信任客户端标记。

校验：`supportsReference` 为**必填**布尔值；`npm run models:check` 与 `node test/check-contract.mjs`
会校验必填、互斥约束、`PUBLIC_PRESETS` 透传与生成物同步。

### 2.3 负向提示词能力（supportsNegative）

`supportsNegative` 描述**模型管线是否真的消费 `negative_prompt`**，与「CFG 是否大于 0」是两件事：前者是管线能力，后者决定本次请求里的负向词是否生效。

| 取值 | 含义 |
| :--- | :--- |
| `true` | 管线接受负向提示词：`negative_prompt` 会参与条件编码（SDXL 系在 `cfg > 0` 时生效；`qwen-image-2.1` 走 `true_cfg_scale`，仅在 CFG > 1 时传递；`anima` 运行时在 CFG > 1 时作为无条件分支参与引导，当前 `anima-turbo-v1.1` 推荐 CFG=1） |
| `false` | 管线没有负向词输入，传了也会被丢弃；客户端与助手应隐藏「排除项」，避免用户填写无效参数 |

当前 7 款现役预设中 4 款为 `false`：`sana-sprint-1.6b`、`z-image-turbo`、`flux2-klein-4b`、
`flux2-klein-9b`（SANA、Z-Image 与 diffusers FLUX.2 管线的 `__call__` 没有 `negative_prompt` 参数，
`remote/daemon.py` 的 `run_task()` 按 `__call__` 签名过滤参数，即使请求里带了负向词也不会传进管线）。
其余 3 款为 `true`：`sdxl-lightning`（SDXL 走 diffusers 的 `negative_prompt` 形参）、
`qwen-image-2.1`（`true_cfg_scale` 语义，CFG > 1 时才传负向词）与 `anima-turbo-v1.1`
（自定义运行时显式接收并使用负向词）。

判定标准：

- 查看 loader 对应生成管线的 `__call__` 是否接受 `negative_prompt`（diffusers 源码 / 模型卡），或真机确认负向词确实改变出图；
- 不确定时填 `false`：标错的成本不对称——`false` 只是隐藏了可用能力，`true` 会让界面多出一个实际被丢弃的输入框，并让助手输出无效负向词；
- 该字段与 `negativeHint`（模型推荐默认负向词）相互独立：支持负向词但默认不推荐时 `negativeHint` 可以是空串（如 `anima-turbo-v1.1`），此时排除项默认隐藏，用户主动抬高 CFG 后出现。

联合判定：是否展示/使用负向词由 `shared/models-guide.js` 的 `negativePromptActive(preset, cfg)` 决定，Host 与 Client 共用同一份规则，不得各写一套：

1. 预设缺失（旧宿主 / 尚未拿到预设）→ 只看 `cfg > 0`；
2. 预设带 `supportsNegative` → 必须为 `true`；旧宿主预设没有该字段时，用 `negativeHint` 非空兜底；
3. 必须 `cfg > 0`（CFG=0 的采样会忽略负向词，daemon 也不会传）；
4. 且 `negativeHint` 非空，或用户把 CFG 抬到高于预设推荐值。

结果：7 款默认参数下排除项均隐藏——`sdxl-lightning` 与 `z-image-turbo` 默认 CFG=0；`sana-sprint-1.6b`、`flux2-klein-4b`、`flux2-klein-9b` 管线不消费负向词；`qwen-image-2.1` 与 `anima-turbo-v1.1` 的推荐负向词为空串。用户抬高 CFG 后，`sdxl-lightning`、`qwen-image-2.1`、`anima-turbo-v1.1` 可出现排除项，恢复默认后再次隐藏。

消费方：

- 构建：`tools/build-assets.mjs` 把 `supportsNegative` 列为必填字段，缺失或非布尔值直接失败；归一后写入 `shared/models.generated.js` 的 `MODELS` 与 `PRESETS`。
- 下发：`shared/contract.js` 的 `publicPresets()` 只剔除 `pipeline`，`supportsNegative` 随 `/state` 的 `presets` 原样下发给客户端。
- 客户端：按 `negativePromptActive()` 决定「排除项」显隐；提交时不可用则把 `negativePrompt` 置空串，不发无效参数。
- Host 助手：`lib/intent.js` 用同一函数决定响应里的 `negative` 是否必须为空串，`lib/enhance.js` / `lib/tools.js` 复用同一模型目录生成提示词与工具描述。
- daemon：不读该字段，按「`negative_prompt` 在 `__call__` 签名内」且 `cfg > 0` 双条件兜底，不信任客户端标记。

校验：`npm run models:check` 与 `node test/check-contract.mjs` 会校验生成物与 `models/` 同步。

### 2.4 推理加速开关（pipeline.accel）

阶段十五 Phase C1 引入的**脚手架**：模型资产可在 `pipeline` 下声明可选 `accel` 对象，远端 loader
在构建管线后按开关启用对应优化。缺省（整块省略）表示全部关闭，代码路径与改造前逐字一致；
开关只在真机 A/B（同 seed / 同尺寸对照）数据确认后才会写进 `models/*.json`。

| 键 | 类型 | 作用 | 风险 |
| :--- | :--- | :--- | :--- |
| `vaeTiling` | boolean | `vae.enable_tiling()`：VAE 解码分块，压低高分辨率瞬间显存峰值 | 无损（需肉眼复核瓦片接缝） |
| `vaeSlicing` | boolean | `vae.enable_slicing()`：batch > 1 时逐张解码 | 无损 |
| `channelsLast` | boolean | SDXL `unet.to(memory_format=torch.channels_last)`：NHWC 访存，T4 Tensor Core 友好 | 无损（SDXL UNet 才适用） |
| `fuseQkv` | boolean | SDXL `unet.fuse_qkv_projections()`：Q/K/V 投影合批 | 无损；只能 fuse 一次，from_pipe 派生管线共享 UNet 时按已 fuse 状态跳过 |

校验：`tools/build-assets.mjs` 对 `pipeline.accel` 做严格校验——必须是对象、键只能来自
`shared/contract.js` 的 `PIPELINE_ACCEL_KEYS`（`vaeTiling` / `vaeSlicing` / `channelsLast` / `fuseQkv`），
未知键直接报错（开关名写错会让 A/B 数据失真），值必须是布尔。远端镜像名在
`remote/inference/loaders/diffusers.py` 的 `ACCEL_FLAGS`，`test/check-contract.mjs` 校验两侧同名。

### 2.5 算力来源能力位（providers）

部分大模型只在特定远端后端跑得动：例如 `FLUX.2 Klein 9B` 组件权重 32.32 GiB，需要 Colab
`A100` 这类大显存档（Kaggle 2×T4 合计 29.12 GiB，加载即 OOM）。`providers` 让工作台在
**选择模型**与**生成前预检**两处就挡住「注定失败、还会白烧一次配额」的组合，而不是等远端报 OOM。
**阶段十七起已有 3 个随包发布的资产声明该字段**：`z-image-turbo`、`qwen-image-2.1`、
`flux2-klein-9b` 均声明 `providers: ["colab"]`；其余 4 款缺省（两种来源都可用）。
`flux2-klein-9b` 已在 Colab L4 真机验证（18,107 MiB / 加载 98.9s / 单张 130.87s，
见 [ROADMAP.md](ROADMAP.md) 第十七节）。

| 取值 | 含义 |
| :--- | :--- |
| `["colab"]` | 仅 Colab（`A100` 等大显存档）可运行。Kaggle 用户在模型卡里看到置灰且标「仅 Colab」的选项，无法选择；若通过历史回填 / 草稿恢复等路径让表单停在该预设上，点生成也会被本地预检拦下，宿主请求不会发出 |
| `["kaggle"]` | 仅 Kaggle 可运行（当前无此类资产，能力位先留好，UI 与预检对称生效） |
| 缺省（不写该字段） | 两种来源都支持。生成物里**不会出现** `providers` 字段，既有模型的对外快照逐字不变 |

JSON 示例（与 `supportsNegative` 同级、平铺在顶层；阶段十七已随 `flux2-klein-9b` 等资产发布）：

```json
{
  "id": "flux2-klein-9b",
  "supportsNegative": false,
  "supportsReference": true,
  "providers": ["colab"]
}
```

取值与缺省口径：

- 取值域只有 `kaggle` / `colab`，与 `shared/contract.js` 的 `SETTINGS.providers` 是唯一来源；
- 必须是**非空数组**且**无重复**：写 `[]` 会被构建拒绝（它的语义和「缺省」重叠，容易让人误以为不可用）；
- 缺省 = 两种来源全可用，与现有 4 个未声明 `providers` 的资产语义一致，不需要补字段；
- 旧宿主下发的预设没有该字段时，客户端按「全可用」处理，不会误伤既有流程。

消费方：

- **构建**：`tools/build-assets.mjs` 校验上述规则，合法时把字段透传到 `shared/models.generated.js`
  的 `PRESETS` / `PUBLIC_PRESETS`；`shared/contract.js` 的 `publicPresets()` 只剔除 `pipeline`，
  因此该字段随 `/state.presets` 自动下发客户端。
- **客户端**：`src/logic/preset.js` 的 `presetProvidersOf()` / `presetAvailableForProvider()` /
  `presetProviderRestrictionOf()` 是唯一判定口径（缺省 / 空数组 = 全可用，`provider` 非法回退
  `kaggle`）。模型卡 `ModelCardPicker` 对当前 provider 不可用的预设置灰、标「仅 Colab」角标并给
  原因提示，键盘导航按现有 `disabled` 过滤自动跳过；`generateCapabilityOf()` 在生成前预检里以
  `studio.form.blockedProvider` 拦下（文案含模型名与当前 / 所需算力来源），宿主请求不会发出。
- **Host**：`lib/jobs/queue.js` 的 `providerGateOf(preset, settings.provider)` 在入队前再判一次
  （Agent 工具 / 旧客户端 / 直连 API 绕不过），不匹配时返回 `invalid_request`、任务不占队列、
  不触达远端。daemon 不读该字段：远端是否真跑得动仍以 OOM / 加载失败为准（首道防线在客户端，
  第二道在 Host，最后一道是远端的显存现实）。

校验：`tools/build-assets.mjs` 拒绝非数组、空数组、未知来源与重复项；`npm run models:check`
与 `node test/check-contract.mjs` 校验生成物与 `models/` 同步；客户端行为由
`test/check-client-logic.mjs`（缺省 / 单来源 / 非法 provider 回退 / 阻断与放行）与
`test/check-client-provider.mjs`（置灰、角标、不可用时点生成不发请求）覆盖，Host 兜底由
`test/jobs-wait.mjs` 的 `providerGateOf` 用例覆盖。

### 2.6 FLUX.2 可选 LoRA（pipeline.lora）

`pipeline.lora` 原本只服务 `sdxl-lora` loader（LoRA 是底座的一部分）；阶段十六起
`flux2` loader 也接受这一字段，作为**底座上的可选叠加项**（缺省 `null` 时行为不变）。
当前仓库没有模型资产默认启用它，该能力用于「特定用途 LoRA」的请求级评估与后续接入
（例如扩图 LoRA：`fal/flux-2-klein-4B-outpaint-lora`）。

| 键 | 类型 | 说明 |
| :--- | :--- | :--- |
| `repo` | string | HuggingFace 仓库；与 `pipeline.base` 相同口径 |
| `weight` | string | 仓库内的权重文件名，例如 `flux-outpaint-lora.safetensors` |
| `scale` | number \| null | 可选权重系数，缺省 / `null` = 1.0；≠1 时按 `set_adapters` 应用，非数字 / NaN 直接报请求错误 |

- **格式**：diffusers 0.43 的 `Flux2LoraLoaderMixin` 同时接受 diffusers 与 PEFT
  （`base_model.model.*`）两种 state dict，后者会自动转成 `diffusion_model.*`；Kohya 格式也会转换。
- **预挂载优先**：命中 `localModels` 映射时直接用本地权重，否则 `hf_hub_download` 后挂载；
  下载体积会计入验证 payload 的 `downloadGb`。
- **错误语义**：字段缺失 / `scale` 非法属请求错误（在加载底座前拦下）；下载或挂载失败属加载失败
  （回收显存、不静默出图不带 LoRA）。
- **真机证据**：Kaggle 2×T4 上 `flux2-klein-4b + 上述扩图 LoRA`（scale=1.1）可正常加载与出图，
  详见 [ROADMAP.md](ROADMAP.md) 第十六节与 [CHANGELOG](../CHANGELOG.md)。

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