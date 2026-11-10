# 故障排查与已知环境问题 (TROUBLESHOOTING)

本文档记录 Kaggle 远端环境的已知坑、判断依据与处理方式。原则是：**能在本地复现或从错误尾部读出的，写进代码与测试；不能稳定获取的外部文档不作为运行时依赖。**

---

## 0. 先拿到错误详情

工作台顶栏 → 点击「云端在线 / 云端离线」胶囊 → 「查看运行日志」：

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

处理：
- 优先用权重预挂载（`datasetSources` + `localModels`），跳过下载；
- 或先跑一次小模型（SDXL Turbo / Lightning）确认链路，再换大模型；
- 远端日志里 `[env] disk ...` 行会列出挂载点可用空间。

---

## 4. 隧道与会合

| 现象 | 排查 |
| :--- | :--- |
| 一直「排队中」 | Kaggle 账号是否绑定手机号；`kaggle kernels status <kernelId>` 看是否 PENDING |
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
| `auth_required` | 没找到凭证或凭证失效 | 重新在 Kaggle 设置页生成 token，写入 `%USERPROFILE%\.kaggle\access_token` |
| 配额一直显示不可用 | Kaggle quota 接口偶发失败 | 算力弹层会回退展示最近一次成功检查时间与当时配额 |