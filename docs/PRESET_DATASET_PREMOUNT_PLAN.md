# 按模型按需预挂载官方 Kaggle Dataset 规划

> **状态**：📝 规划阶段（待准备 Kaggle 公开 Dataset 资产后交由开发专员实施）  
> **目标**：让普通用户无需理解或手填「高级 → 预挂载 Kaggle Dataset / 本地模型映射」，在启动远端算力时自动根据当前所选模型挂载对应的精简权重包，实现冷启动秒开；同时在运行中切换模型或托管源异常时无缝回退 HuggingFace 在线下载。

---

## 一、 核心设计原则

1. **按模型拆包，按需单挂**：不把全部 10 个模型（合计 ~61 GB）打进一个大 Dataset，避免拖慢 Kaggle 容器调度或触发挂载上限；每次启动会话只挂载当前 `presetId` 对应的 1 个 Dataset（约 5.3～15.2 GB）。
2. **共用底座合并**：`sdxl-base`、`sdxl-lightning`、`hyper-sdxl-8step` 共用同一个 SDXL 1.0 底座，打包为 1 个 Dataset（~7.4 GB）即可同时加速 3 个模型。
3. **显式开关 + 自动降级（无单点故障）**：
   - 设置中提供显式开关（默认开启），用户可一键关闭回退；
   - 若内置托管 Dataset 临时失效导致 `pushKernel` 报错，Host 自动剥离内置挂载并重试一次纯 HuggingFace 启动；
   - 运行中切换到其它未挂载模型时，远端 `remote/cache_ops.py` 现有逻辑会自动回退到 HuggingFace 在线下载。
4. **用户手动配置优先**：用户在「运行设置 → 高级」里自行填写的 `datasetSources` 与 `localModels` 始终优先于内置映射。

---

## 二、 Kaggle Dataset 资产拆分与目录规范（资产侧）

### 2.1 建议拆分清单（首批优先覆盖许可清晰的模型）

> 注：非商用或特殊社区许可模型（`sdxl-turbo`、`playground-v2.5`、`anima-light-lavender`）建议在确认再分发条款后再决定是否二期补充，或继续默认走 HuggingFace 在线拉取。

| 建议 Dataset Slug（示例） | 覆盖模型 `presetId` | 预计体积 | 协议 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `<owner>/imagen-sdxl-core` | `sdxl-base`<br>`sdxl-lightning`<br>`hyper-sdxl-8step` | ~7.4 GB | OpenRAIL++ / OpenRAIL++-M | 包含 SDXL 1.0 底座（仅 `fp16`）+ Lightning 4-step LoRA + Hyper-SDXL 8-step LoRA |
| `<owner>/imagen-realvis-v5` | `realvis-v5` | ~6.5 GB | OpenRAIL++ | 写实 SDXL 精简 `fp16` 权重 |
| `<owner>/imagen-animagine-xl-31` | `animagine-xl-3.1` | ~6.5 GB | OpenRAIL++ | 二次元 SDXL 精简 `fp16` 权重 |
| `<owner>/imagen-flux2-klein-4b` | `flux2-klein-4b` | ~15.2 GB | Apache-2.0 | FLUX.2 Klein 4B（双卡向） |

### 2.2 远端加载器对目录结构的强约束

远端 [`remote/cache_ops.py`](../remote/cache_ops.py) 在读取 `local_models` 时有以下校验规则，打包 Dataset 时必须严格满足：

1. **Diffusers 底座仓库（`sdxl` / `flux2` 等）**：
   - `resolve_local_model_from(repo, local_models)` 要求映射目录根下**必须存在 `model_index.json`**；
   - 按对应 `models/<id>.json` 中的 `pipeline.allowPatterns` 过滤拉取（通常仅保留 `model_index.json`、`**/*.json`、`**/*.txt`、`**/*.fp16.safetensors`），避免冗余权重撑大体积。
2. **LoRA / 单文件权重仓库（`sdxl-lora` 等）**：
   - `resolve_local_weight_from(repo, weight_name, local_models)` 会在映射目录下拼接 `pipeline.lora.weight` 文件名；
   - 建议每个 HuggingFace 仓库在 Dataset 内各自独占一个子目录，例如 `<owner>/imagen-sdxl-core` 挂载到 `/kaggle/input/imagen-sdxl-core/` 后，内部结构为：
     ```text
     /kaggle/input/imagen-sdxl-core/
     ├── stabilityai--stable-diffusion-xl-base-1.0/
     │   ├── model_index.json
     │   ├── scheduler/
     │   ├── text_encoder/
     │   ├── ...
     ├── ByteDance--SDXL-Lightning/
     │   └── sdxl_lightning_4step_lora.safetensors
     └── ByteDance--Hyper-SD/
         └── Hyper-SDXL-8steps-lora.safetensors
     ```
   - 打包时务必在 `dataset-metadata.json` 中保持目录层级（或确认 Kaggle 解压后的实际挂载路径），并在发布后用真机探针核对一次 `/kaggle/input/<slug>/...` 实际路径。

---

## 三、 代码改造规划（开发专员实施清单）

> 远端推理与缓存模块（`remote/cache_ops.py`、`remote/config.py`）已原生支持按仓库查 `local_models` 并在缺失时回退 HuggingFace，**本次改造主要集中在 `shared/`、Host 侧（`lib/`）与工作台 UI（`src/`）**。

### 3.1 预置映射表（唯一口径）

- **位置建议**：在 `models/*.json` 增加可选字段（如 `premount: { dataset, localModels }`）并由 `tools/build-assets.mjs` 统一校验生成到 `shared/models.generated.js`，或新建 `shared/preset-datasets.js` 集中维护 `PRESET_DATASETS` 映射表。
- **结构示例**：
  ```js
  export const PRESET_DATASETS = {
    'sdxl-lightning': {
      datasetSource: '<owner>/imagen-sdxl-core',
      localModels: {
        'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/imagen-sdxl-core/stabilityai--stable-diffusion-xl-base-1.0',
        'ByteDance/SDXL-Lightning': '/kaggle/input/imagen-sdxl-core/ByteDance--SDXL-Lightning',
      },
    },
    // ... 其余预设按需填入；未配置的预设返回 null，走纯 HF 下载
  }
  ```
- **约束**：校验 `datasetSource` 符合 `owner/dataset` 格式、`localModels` 值均以 `/kaggle/input/` 开头。

### 3.2 运行设置开关与合并规则

1. **契约与设置存储**（`shared/contract.js`、`lib/settings.js`、`lib/routes/settings.js`、`shared/validation.js`）：
   - 新增布尔字段 `useBuiltinDatasetPremount`（默认 `true`）；
   - `settings.json` 仍遵循「只保存用户显式修改过的覆盖项」原则，默认 `true` 不落盘，用户显式关闭时保存 `false`。
2. **UI 设置抽屉**（`src/studio/settings/`）：
   - 在「运行设置 → 常规」中增加开关：「自动预挂载官方加速权重（下次唤醒生效）」（附简短说明：按当前所选模型自动挂载精简权重包，加速冷启动；若挂载异常可关闭回退在线下载）；
   - 「高级」折叠区原有的 `datasetSources` 与 `localModels` 保持不变，供高阶用户自备私有模型。
3. **合并优先级**：
   - 在构造启动参数时：
     - 若 `useBuiltinDatasetPremount === true` 且当前 `presetId` 在映射表中有配置：
       - 将内置 `datasetSource` 并入 `datasetSources`（去重，且遵守 `SETTINGS.maxItems` 32 项上限）；
       - 将内置 `localModels` 与用户手动 `localModels` 合并：**用户手动配置的同 key 映射覆盖内置映射**。
     - 若 `useBuiltinDatasetPremount === false`，完全不下发内置映射，仅使用用户手动配置。

### 3.3 会话启动链路传参核查（`lib/session.js` + `src/`）

- `lib/jobs/queue.js`（出图自动唤醒）与 `lib/routes/session.js`（`POST /imagen-api/session/start`）已将 `presetId` 传入 `session.start(presetId)`。
- **需核查并补齐**：前端所有触发手动「唤醒算力 / 启动会话」的入口（例如顶栏算力弹层或空态启动按钮），确保请求 `/imagen-api/session/start` 时把**当前创作面板选中的 `presetId`** 一并传入，避免总是落到默认 `sdxl-lightning`。
- **诊断字段**：`lib/diagnostics.js` 中的 `hasCustomDatasets` 建议保持表达「用户是否配置了自定义预挂载」，或另增字段区分内置预挂载，避免排障时混淆用户自配与内置加速。

### 3.4 `pushKernel` 失效自动降级（消除单点故障）

- 在 `lib/session.js` 启动推送 Kernel 阶段：
  - 若本次请求附加了内置 `datasetSource`，且 Kaggle 返回与 Dataset 不存在 / 无权限相关的错误（如 `404` / `403` / `Dataset not found`）；
  - Host 自动**剥离本次注入的内置 `datasetSource` 与对应的内置 `localModels`**（保留用户手动配置的项），记录一条明确的 `warn` 日志并**重试一次 `pushKernel`**；
  - 并在会话状态或日志中标记已自动回退在线下载，确保即使外部 Dataset 失效，用户依然可以正常出图。

---

## 四、 验收标准

### 4.1 离线测试
1. **设置与合并单测**（`test/settings-host.mjs`）：验证 `useBuiltinDatasetPremount` 默认为 `true`、关闭后不下发内置挂载、用户手动 `localModels` 覆盖同 key 内置映射。
2. **启动编排单测**（`test/kernel-package.mjs` / `test/host-e2e.mjs`）：
   - 传入不同 `presetId` 时，`kernel-metadata.json` 中的 `dataset_sources` 与注入配置的 `local_models` 仅包含对应模型的那 1 份配置；
   - 模拟内置 Dataset 触发 `pushKernel` 404 时，自动剔除内置挂载并重试一次成功。
3. **客户端与文案校验**：`npm test` 全量通过（含 `check-client-logic`、`check-client-render`、`check-client-locale`）。

### 4.2 真机验证
1. 选 `sdxl-lightning` 唤醒会话：日志出现从 `/kaggle/input/...` 本地加载，跳过 HuggingFace 下载与磁盘预检，记录冷启动加载耗时。
2. 同一会话内切换至未预挂载模型（如 `playground-v2.5`）：能正常触发 HuggingFace 在线下载并出图，无报错。
3. 故意填入不存在的内置 Dataset 占位符验证降级重试：首次推送失败后自动剥离并二次推送成功。
