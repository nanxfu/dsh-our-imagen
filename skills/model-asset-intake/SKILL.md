---
name: model-asset-intake
description: Use when the user drops a HuggingFace model link, model card, blog post, or training/script snippet and wants it added as a model preset in this repo (our-free-imagen), or asks to "新增模型 / 收录模型 / 用 verify-model 验证 / 回填 measured". Covers turning external model information into a models/<id>.json asset, running tools/verify-model.mjs on Kaggle GPU, healing classified failures, then moving the verified asset into models/ and rebuilding the generated contract.
version: 1.0.0
user-invocable: true
---

# 模型资产录入 SOP

目标：把用户随手给的外部模型信息，变成仓库里一个经过真机实测、可被 Host/Client 直接使用的模型资产。

工作目录必须是本仓库根目录（`our-free-imagen`）。所有命令在仓库根执行。

## 0. 先确认两件事

1. 输入是什么：HuggingFace 链接 / 模型卡 / 博客或训练脚本片段 / 已有 repo id。
2. 用户是否允许消耗 Kaggle GPU 配额。**真实验证必须先用一句话问用户确认**（排队 + 冷启动通常 10~30 分钟）。用户没确认前只做草稿和 dry-run。

## 1. 提取模型信息

从链接或代码里提取以下内容，缺的向用户确认，不要猜：

- 底座仓库（`pipeline.base`）与权重变体（fp16 / safetensors）；
- 是否 LoRA：LoRA 仓库 + 权重文件名 + 底座仓库；
- 架构/loader：`sdxl`（整管 SDXL 类）、`sdxl-lora`、`flux2`（FLUX.2 klein 这类需要双卡 `deviceMap: "balanced"`）；
- 推荐参数：尺寸、步数、CFG、负向提示词、许可证、是否 gated。

判断不了 loader 时停下来问用户，或读取模型卡 `model_index.json` 的 `_class_name`。不要用 `trust_remote_code` 的模型（当前 daemon 不支持，也不建议收录）。

## 2. 生成草稿 `.tmp/models/<id>.json`

- `id` 用仓库名的短横线小写形式（`FLUX.2-klein-4B` → `flux2-klein-4b`），不能与 `models/` 现有文件重名；
- `order` 取现有最大值 + 10；
- `measured` 四个字段先填 `null`，等真机验证回填；
- `runtime` 只能是 `"default"`；
- 字段格式见本 skill 末尾模板，完整定义见 `docs/MODEL_ASSET_SPEC.md`。

写完后先自检一遍 JSON 合法性，再进入下一步。

## 3. 离线演练（不花配额）

```powershell
node tools/verify-model.mjs --config .tmp/models/<id>.json --dry-run
```

它会校验配置字段并完整打包一次 Kernel 目录。报错按提示修 JSON，直到退出码 0。

## 4. 真机验证（先获得用户同意）

```powershell
node tools/verify-model.mjs --config .tmp/models/<id>.json --write --timeout 30
```

`--write` 会在成功后把实测的 `measured` 就地写回草稿。成功时还会生成：

- `.tmp/verify/<id>.png`：样张，用 `read_image` 看一眼再汇报；
- `.tmp/verify/<id>.report.json`：完整报告（环境、耗时、显存等）。

## 5. 失败自愈

脚本会给出分类和最后 20 行日志。按分类处理，**同一类最多重试 2 次**，仍失败就把日志尾部贴给用户，不要盲目重跑浪费配额：

| 分类 | 先做什么 |
| :--- | :--- |
| `invalid_config` | 按日志修 `.tmp/models/<id>.json`（字段缺失、loader 不支持、base 拼错），再 `--dry-run` |
| `pip_conflict` | 检查草稿没有手写版本约束；重试一次；仍失败看 `docs/TROUBLESHOOTING.md` 第 1 节 |
| `cuda_oom` | 降低 `size` / `steps`，FLUX.2 确认 `pipeline.deviceMap` 为 `"balanced"` |
| `import_error` | 见 TROUBLESHOOTING 第 2 节（torchao / 版本组合），通常重跑一次即可 |
| `download_failed` | 确认 `pipeline.base` 拼写；gated 仓库需要用户提供 HF Token，不要自己编 |
| `disk_full` | 减小模型或改用预挂载权重，见 TROUBLESHOOTING 第 3 节 |
| `timeout` | 询问用户是否调大 `--timeout` 后重试 |
| `auth_required` / `push_failed` | Kaggle 凭证问题，交给用户处理（TROUBLESHOOTING 第 6 节） |
| `kernel_error` | 读日志找第一处 Traceback，判断是配置还是环境；拿不准就停下来汇报 |

## 6. 验证通过后入库

```powershell
mv .tmp/models/<id>.json models/<id>.json
npm run models:build
npm run models:check
npm test
```

任一步失败：把 `models/<id>.json` 移回草稿位置，把报错汇报给用户，不要手改 `shared/models.generated.js` 或 `shared/contract.js`。

`npm test` 通过后告诉用户：新模型会在 DSH 重启 / 插件重载后出现在工作台预设里。

## 7. 汇报

给用户一段简短结果：

- 模型 id、loader、底座仓库；
- 实测表：显存峰值 / 加载耗时 / 首图耗时 / 稳态中位 / 下载体积；
- 样张路径（`.tmp/verify/<id>.png`）；
- 执行过的命令与测试结果；
- 如果做过失败重试，说明原因和最终修法。

## 硬性约束

- `measured` 只能来自 `tools/verify-model.mjs` 的真实输出；禁止手填，禁止抄上游宣称值。迁移历史 `bench-results/` 数据时要在草稿里注明来源。
- 只改 `models/*.json` 与 `.tmp/`；生成文件 `shared/models.generated.js` 和契约 `shared/contract.js` 不手改。
- 不在未确认配额的情况下跑真机验证。
- 不执行用户给的外部脚本，不开启 `trust_remote_code`。
- 许可证、是否 gated 如实记录；信息缺失先问，不编造。

## 字段模板

```json
{
  "id": "<id>",
  "order": 999,
  "label": "<中文展示名>",
  "repo": "<owner/name>",
  "params": "<参数规模说明>",
  "license": "<许可证>",
  "licenseKind": "open",
  "gated": false,
  "gpus": 1,
  "tier": "fast",
  "size": 1024,
  "steps": 4,
  "cfg": 0,
  "negativeHint": "",
  "sizeOptions": [768, 1024],
  "runtime": "default",
  "pipeline": {
    "loader": "sdxl",
    "base": "<owner/name>",
    "lora": null,
    "scheduler": null,
    "variant": "fp16",
    "downloadGb": 6.8,
    "allowPatterns": null,
    "deviceMap": null
  },
  "measured": {
    "peakVramMb": null,
    "loadSeconds": null,
    "steadySeconds": null,
    "downloadGb": null
  }
}
```

参考：`docs/MODEL_ASSET_SPEC.md`（格式与流程）、`docs/TROUBLESHOOTING.md`（远端环境问题）。