# 故障排查与已知环境问题 (TROUBLESHOOTING)

本文档记录 Kaggle 远端环境的已知坑、判断依据与处理方式。原则是：**能在本地复现或从错误尾部读出的，写进代码与测试；不能稳定获取的外部文档不作为运行时依赖。**

---

## 0. 先拿到错误详情

工作台顶栏 → 点击云端状态胶囊（显示「云端就绪 / 正在准备模型 / 正在排队等 GPU」等）→「查看运行日志」：

- 日志抽屉展示远端 daemon 的安装、隧道、模型加载与生成日志（增量轮询，最多 400 行）；
- 「复制诊断信息」会拼出版本、会话快照（不含 token）、环境探测、队列与最近 60 行日志，便于贴给开发者或模型排查；
- 会话因 `load_failed` 结束前，Host 已经把 daemon 的 `last_error` 写进 `/state` 的错误文案；0.4.1 起错误文案里会带 pip 输出的最后几行。

如果界面已回到离线态、日志拉不到，可以按下面的「手动取日志」执行：

```powershell
$env:OUR_FREE_IMAGEN_LOG = "debug"   # 重启 DSH 后宿主会输出 [imagen:*] 事件
kaggle kernels logs <kernelId> --utf8  # kernelId 在会话快照 kernelId 字段
```

---

## 1. `load_failed: pip install 失败（退出码 1）`

### 1.1 0.4.0 事故复盘（已修复）

0.4.0 曾把「依赖版本固化」实现为内置上限：

```
diffusers<1.0
transformers<5
accelerate<2
peft<1
```

实测这组约束与当前 diffusers 新版不兼容：

- `diffusers 0.42+` 依赖 `huggingface-hub>=1.32`；
- `transformers 4.x` 要求 `huggingface-hub<1.0`；
- 两者无法同时满足，pip 只能一路回溯到 2019 年的 `transformers 4.12.2`；
- Kaggle 镜像里已有较新的 `tokenizers` / `huggingface-hub` 预装包，解析最终以退出码 1 失败。

**修复（0.4.1）**：默认不再下发任何版本约束；`pipConstraints` 变回纯可选项；带约束安装失败时自动去掉约束重试一次；错误文案带 pip 尾部输出；Host 侧错误截断放宽到 700 字符。

### 1.2 现在遇到这个错误怎么判断

0.4.1 的错误文案形如：

```
远端进入错误状态：load_failed: LoadError: pip install 失败（退出码 1）：ERROR: ... | ...
```

按尾部输出的关键字判断：

| 尾部关键字 | 原因 | 处理 |
| :--- | :--- | :--- |
| `Could not find a version that satisfies` / `ResolutionImpossible` | `pipConstraints` 里自己写的版本组合不可解析 | 删掉或放宽 `pipConstraints`，让插件装最新兼容组合 |
| `Could not build wheels for ...` | 镜像缺少编译工具，通常是某个依赖需要本地编译 | 先不钉版本重试；仍失败时把包名与镜像版本信息贴出来 |
| `Read timed out` / `ConnectionResetError` / `Temporary failure in name resolution` | Kaggle 容器到 PyPI 的网络抖动 | 重试会话；反复出现可换镜像源（见 1.3） |
| `No space left on device` | `/kaggle/working` 或根分区写满 | 见第 3 节磁盘问题；清空旧权重缓存后重试 |

### 1.3 固定版本 / 换镜像源

`pipConstraints` 只在**你自己验证过**的时候使用，例如：

```yaml
# 插件配置示例：整组配套钉死（版本号需按实际验证结果填写）
pipConstraints:
  - diffusers==0.42.1
  - transformers==5.22.2
  - huggingface-hub==2.4.0
  - accelerate==1.15.0
  - peft==0.21.2
```

只钉单个包（例如 `transformers==5.22.2`）通常没问题，但不要把「上限」当成固化手段：生态里任何一个包的大版本跃迁都可能改变依赖图。当前没有单独的 pip 镜像源配置项，如果你的环境需要 PyPI 镜像，建议在 Kaggle 侧用 `pip config` 或自带 `PIP_INDEX_URL`（插件不代管网络出口配置）。

遇到依赖冲突时，优先参考第 8 节的「已知良好版本参考（LKGR）」——那是一组在真机上验证过的组合，可直接填进设置抽屉的 `pipConstraints`。

### 1.4 为什么不用 venv

考虑过给远端建 venv，但没有采用：

- Kaggle 容器是**一次性**的，每次冷启动都要重装一遍依赖，venv 不能复用；
- 镜像里已有 CUDA 版 torch，`venv` 如果要复用必须加 `--system-site-packages`，隔离效果有限；
- venv 创建的包不在 daemon 当前解释器的 `sys.path` 里，要么在 venv 里重新执行 daemon（HTTP 端口与启动时序都要重排），要么手工改 `sys.path`，复杂度明显高于收益；
- 真正解决 ABI 冲突的是「先卸载 torchao + 升级 diffusers 栈 + 独立进程导入自检」这条已验证路径。

如果后续确实要隔离，正确的形态是「bootstrap 阶段建 venv 并 re-exec daemon」，而不是在现有进程里临时切解释器。

---

## 2. `load_failed: 依赖导入自检失败`

说明 pip 装完了，但新起的 Python 进程 `import torch / diffusers / ...` 失败。常见原因：

- **torchao 残留**：镜像自带 `torchao 0.10.0`，与新 diffusers 的 C++ ABI 冲突；daemon 每次都会先 `pip uninstall -y torchao`，如果自检仍报 `torchao` 相关符号错误，检查卸载是否真的成功。
- **版本组合不兼容**：日志里会打印各包版本，对比是否与第 1.3 节验证组合偏离。
- **磁盘/权限**：安装只写进去一半（`No space left on device` 被吞掉时也会表现成 import 失败）。

处理：重试会话；仍失败时把「依赖导入自检失败」后面附带的尾部输出贴出来。

---

## 3. 磁盘空间不足

Kaggle 容器的 `/kaggle/working` 通常只有 20 GB，写入层满了会转只读。daemon 在下载权重前会按预设的 `downloadGb` × 1.15 做预检，并给出「需 X GiB / 可用 Y GiB」。

0.8.0 起，daemon 还会在**切换模型前**按 LRU 清理 HuggingFace 缓存：先释放旧 pipeline，再保留目标模型依赖的全部仓库与 `localModels` 预挂载仓库，把其余 `models--*` 按最近修改时间从旧到新删除；日志里出现 `[cache] evicted <repo> freed=<X>GiB` 即清理生效。清理完仍不够时才会报「磁盘空间不足：需 X GiB / 可用 Y GiB」。

**实测基线（2026-11-13，2×Tesla T4）**：远端 `[cache]` 探针输出为
`HF_HUB_CACHE=/root/.cache/huggingface/hub | mount=/ | free=966.6GiB | /kaggle/working mount=/kaggle/working free=19.5GiB`。
也就是说当前镜像的权重缓存落在根卷 `/`（约 966 GiB 可用），不在 20 GB 的 `/kaggle/working` 上；
同一会话内连续切换 sdxl-lightning → flux2-klein-4b → anima-light-lavender（合计约 27 GB 权重）未触发逐出
（`evictedCount=0`）、磁盘未爆。逐出逻辑是**小容量镜像 / 未来镜像变更时的兜底**，由 `test/daemon-unit.py`
的 8 项缓存清理用例覆盖；判断依据始终是缓存目录自己所在盘的余量（`disk_usage_target()`），而不是写死 `/kaggle/working`。

处理：
- 优先用权重预挂载（`datasetSources` + `localModels`），跳过下载；
- 或先跑一次小模型（SDXL Turbo / Lightning）确认链路，再换大模型；
- 远端日志里 `[cache]` / `[env] disk ...` 行会列出缓存目录与挂载点可用空间。

---

## 4. 隧道与会合

| 现象 | 排查 |
| :--- | :--- |
| 一直显示「正在排队等 GPU」 | Kaggle 账号是否绑定手机号；`kaggle kernels status <kernelId>` 看是否 PENDING |
| 「隧道握手超时」 | 容器内 cloudflared 没拿到地址；日志里搜 `[tunnel]` 与 `[cloudflared]` |
| 在线但每张图都失败 | Host 心跳丢失后会重取隧道地址；0.4.x 远端会在隧道重建后重播 ready，搜 `[tunnel] 通道 ... 就绪` |
| 国内网络访问 Cloudflare 不稳定 | 可配置自建 https 隧道（`fallbackTunnelCommand` + `trustedTunnelDomains`）；未登记域名不会被信任 |

Host 侧网络问题（代理环境）由 `lib/net.js` 处理：内置 fetch 失败会自动降级为系统 `curl`。

---

## 5. 会话恢复相关

- 会话记录在 `<workspace>/.imagen/session.json`，含远端 token，只落盘、不进日志。
- 正常关机（`session/stop`）或成功卸载会删除记录；进程崩溃留下的记录会在下次启动时探活、重新会合或清理。
- 如果怀疑记录异常（例如工作区从别的机器拷过来），删除该文件即可，下次启动会当成「无历史会话」。
- 开发模式（注入 `devEndpoint`）不读写该记录。

---

## 6. Kaggle CLI / 凭证

| 错误码 | 含义 | 处理 |
| :--- | :--- | :--- |
| `cli_missing` | 本机没有 `kaggle` 命令 | `pip install -U kaggle` |
| `cli_timeout` | CLI 启动或调用超过 30 秒 | 检查代理/DNS；重试环境检查 |
| `auth_required` | 没找到凭证或凭证失效 | 新版 CLI 直接运行 `kaggle auth login`（自动写入 `%USERPROFILE%\.kaggle\access_token`）；旧版 CLI 在 Kaggle 设置页生成 Token 后保存为 `%USERPROFILE%\.kaggle\kaggle.json`，或直接写入 `%USERPROFILE%\.kaggle\access_token` |
| `gpu_unavailable` | 远端容器没拿到 GPU（`torch.cuda.is_available()` 为 `False`） | 检查 Kaggle 账号是否已完成手机号验证，并确认已启用 GPU 加速器；修复后重新唤醒云端 |
| 配额一直显示不可用 | Kaggle quota 接口偶发失败 | 算力弹层会回退展示最近一次成功检查时间与当时配额 |
---

## 7. 模型验证失败（tools/verify-model.mjs）

验证脚本会把失败归到一类并打印最后 20 行日志：

| 分类 | 常见原因 | 处理 |
| :--- | :--- | :--- |
| `pip_conflict` | 模型配置里钉的版本组合不可解析，或 PyPI 暂不可用 | 先去掉 `runtime` 里的版本约束重试；仍失败见第 1 节 |
| `cuda_oom` | 显存不足（单卡 14.5 GiB，FLUX.2 需要双卡 balanced） | 降低分辨率/步数，或检查 `deviceMap` 是否为 `balanced` |
| `import_error` | 依赖装上了但 import 失败（torchao ABI、版本组合） | 见第 2 节 |
| `download_failed` | 权重下载失败、仓库不存在、匿名限流 | 配置 `hfToken`；确认 `pipeline.base` 拼写 |
| `disk_full` | `/kaggle/working` 写满 | 清理或改用预挂载权重，见第 3 节 |
| `invalid_config` | 模型 JSON 缺字段、loader 不支持 | 对照 `docs/MODEL_ASSET_SPEC.md` 修正 |
| `timeout` | 排队+冷启动超过 `--timeout`（默认 30 分钟） | 调大 `--timeout`，或避开 Kaggle 高峰 |
| `auth_required` / `push_failed` | Kaggle 凭证或推送失败 | 见第 6 节 |

成功产物在 `.tmp/verify/`：`<id>.png` 样张与 `<id>.report.json` 完整报告；带 `--write` 时 `measured` 会写回原 JSON。

---

## 8. 已知良好版本参考（LKGR）

LKGR（Last Known Good Revision）是一组**在真实 Kaggle GPU 上跑通过图、且依赖可解析**的 Python 依赖版本组合。用途只有一个：当你遇到上游依赖冲突（第 1、2 节）时，把某一行的版本填进运行设置 →「高级预挂载与依赖锁定 → `pip` 依赖约束」，让远端按这组已验证组合安装。

使用前先明确三点：

- **这不是插件的默认行为**。`remote/daemon.py` 的 `PIP_CONSTRAINTS` 默认仍是空对象 `{}`，每次冷启动都按镜像当前状态安装最新兼容组合，再用导入自检兜底；本表只是可选的「回退基线」。
- **只在出问题时用**。日常不需要预先钉版本：生态里任何一次大版本跃迁都会改变依赖图，钉死旧组合反而可能把 pip 卡在更老的版本上。
- **表中的组合必须来自真机实测**（`npm run test:gpu`），不要手填「看起来合理」的版本号。

| diffusers | transformers | accelerate | peft | huggingface-hub | 验证模型与设备 | 验证日期 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0.43.0 | 5.22.2 | 1.15.0 | 0.21.2 | 1.33.0 | sdxl-lightning（SDXL-LoRA）+ flux2-klein-4b（FLUX.2）+ anima-light-lavender（Anima）/ Kaggle 2×Tesla T4 | 2026-11-13 |

> 同次实测的完整版本快照：python 3.13.16、torch 2.11.0+cu130、safetensors 0.8.0、pillow 13.0.0
> （`report.json` 的 `versions` 字段）。三个模型在**同一会话**内连续切换均出图成功，
> 加载耗时分别为 0s / 125.9s / 89.6s，出图 16.2s / 10.1s / 76.3s。
> 复现命令：`npm run test:gpu -- --presets sdxl-lightning,flux2-klein-4b,anima-light-lavender`。

填写说明：

1. 在真机上跑一次连续切模型验证（会消耗 GPU 配额）：
   ```powershell
   npm run test:gpu -- --presets sdxl-lightning,flux2-klein-4b,anima-light-lavender
   ```
   脚本会把 `/health.versions`（python / torch / diffusers / transformers / accelerate / peft / huggingface_hub / safetensors / pillow 的纯版本号）、每个模型的加载/出图耗时与远端 `[cache]` 日志摘要写进 `report.json`。
2. 把当次运行 `versions` 里的 diffusers / transformers / accelerate / peft / huggingface_hub 抄到本表新行，同时记录验证过的模型与设备（例如「SDXL Lightning + FLUX.2 klein + Anima / 2×Tesla T4」）和日期。
3. 用户遇到冲突时，按行把版本写成逐行约束填入设置抽屉，例如：
   ```text
   diffusers==0.42.1
   transformers==5.22.2
   accelerate==1.15.0
   peft==0.21.2
   huggingface-hub==2.4.0
   ```
   保存后**下次唤醒会话生效**（设置抽屉顶部会提示「当前云端实例已运行，修改将在下次唤醒时生效」）。
4. 某一行在后续版本里失效时（例如能装上但 `import` 自检失败），在该行标注失效日期并补一行新的验证组合，**不要直接覆盖历史行**——历史行是回退依据。
