# 远端协议（PROTOCOL）

本文定义本地编排与远端 Python 运行时之间的接口，以及内核交付、隧道握手、超时与错误归类。

---

## 1. 内核交付

| 项 | 值 |
| :--- | :--- |
| 交付方式 | `kaggle kernels push -p <staging> --accelerator NvidiaTeslaT4`（该参数语义为 GPU T4 ×2） |
| 代码注入 | 配置序列化为 JSON → Base64 → 替换 `daemon.py` / `worker.py` 中的占位常量 |
| 常驻模式代码文件 | `daemon.py` |
| 一次性模式代码文件 | `worker.py` |
| 内核元数据要点 | `enable_gpu: true`、`enable_internet: true`、`is_private: true`、`kernel_type: "script"` |
| 权重缓存（v1.1） | `dataset_sources` 挂载预置权重，避免每次冷启动重复下载 |

---

## 2. 隧道与握手

```
daemon 启动
  → 下载 cloudflared（/tmp/cloudflared，已存在则跳过）
  → cloudflared tunnel --url http://127.0.0.1:7860
  → 从 stderr 解析 https://<随机>.trycloudflare.com
  → POST https://ntfy.sh/<topic>  Body: {"endpoint_url": "...", "model_id": "...", "device": "..."}
本地编排
  → 轮询 https://ntfy.sh/<topic>/json?poll=1&since=all（每 12 秒）
  → 取最后一条 message，解析出 endpoint_url
  → GET /health 连续 3 次成功 → 置 ready
```

约束：

- 主题名每次启动随机生成（`fimg-<16 位十六进制>`），不重复使用。
- ntfy 只是会合点，不承载业务流量；业务流量全部走隧道 + Bearer。
- 隧道域名是临时的，会话结束后不可恢复；恢复方式是重建会话。

---

## 3. 远端 HTTP 接口

所有请求需携带 `Authorization: Bearer <authToken>`，未通过返回 `401 {"error":"Unauthorized"}`。

### 3.1 `GET /health`

```json
{
  "status": "ok",
  "model_id": "black-forest-labs/FLUX.2-klein-4B",
  "device": "Tesla T4",
  "devices": ["Tesla T4", "Tesla T4"],
  "idle_seconds": 14.2,
  "idle_timeout_sec": 900,
  "gpu_mem_used_mb": 9160,
  "gpu_mem_total_mb": 15360
}
```

`devices` 与 `gpu_mem_*` 为 v1 新增字段，用于资源条；旧版守护进程缺字段时 UI 显示"未知"，不得报错。

### 3.2 `POST /generate`

请求：

```json
{
  "model_id": "black-forest-labs/FLUX.2-klein-4B",
  "tasks": [
    { "name": "img01", "prompt": "...", "negative_prompt": "", "seed": 42,
      "width": 1024, "height": 1024, "steps": 4, "cfg": 1.0 }
  ]
}
```

响应 `200`：

```json
{
  "status": "ok",
  "results": [
    { "name": "img01", "file": "img01_seed42.png", "prompt": "...", "negative_prompt": "",
      "seed": 42, "width": 1024, "height": 1024, "steps": 4, "cfg": 1.0,
      "seconds": 2.4, "model_id": "...", "image_b64": "<base64 PNG>" }
  ]
}
```

单张失败时该项带 `"error": "<原因>"` 且不含 `image_b64`，整批继续。

### 3.3 `POST /shutdown`

返回 `200 {"status":"shutting_down"}` 后 0.5 秒内 `os._exit(0)`；容器主进程退出后内核状态变为 `COMPLETE`，计费停止。

---

## 4. 空闲与超时

| 项 | 默认 | 说明 |
| :--- | :--- | :--- |
| 空闲自动关机 | 30 分钟 | 守护进程侧计时，任何 `/health` 与 `/generate` 都算活跃。取值理由：重新拉起要排 13~27 分钟的队，误关机的用户成本远高于挂机消耗的配额（30 分钟约为周额度的 2.8%） |
| 启动等待上限 | 30 分钟 | 覆盖调度排队 + 镜像拉取 + 模型下载 + 加载 |
| 单次出图超时 | 600 秒 | 覆盖冷启动后首图的编译开销 |
| 健康检查间隔 | 30 秒 | `ready` 态心跳 |
| 内核状态轮询 | 15 秒 | `booting` 态 |

---

## 5. 错误归类

| 本地错误码 | 远端/CLI 证据 | 首选动作 |
| :--- | :--- | :--- |
| `auth_required` | `kaggle quota` 退出码 1，输出含 `Authentication required` | 引导重新登录 |
| `cli_missing` | 子进程 `ENOENT` | 显示安装命令 `pip install -U kaggle` |
| `cpu_fallback` | 日志含 `No GPU detected`、`cuda available: false`、`+cpu` | 提示完成手机验证 |
| `quota_exhausted` | 配额解析为 0，或推送返回配额相关错误 | 显示重置时间 |
| `tunnel_failed` | `maxWaitMin` 内未收到握手 | 提示重试，附日志尾部 |
| `daemon_unreachable` | `/health` 连续 3 次失败 | 提供"重建会话" |
| `kernel_error` | 内核状态 `ERROR`/`CANCELLED` | 展示 `kaggle kernels logs` 尾部 |
| `generation_failed` | `/generate` 返回非 `ok` | 展示该项错误，允许重试该张 |

日志尾部展示上限 60 行；完整日志保留在插件数据目录 `logs/`。

---

## 6. 配额解析

`kaggle quota` 的输出是文本，解析策略：

1. 优先匹配"小时数 / 总数"形式（如 `GPU: 12.5h / 30h`）；
2. 匹配失败则保留原文，`quota.raw` 字段供 UI 折叠展示；
3. 解析失败**不得**阻断出图流程——配额只是展示信息。

实测补充（2026-11-09）：配额是否可用取决于凭据类型。

- **API token**：`kaggle quota` 正常返回表格（`resource / used / remaining / total / refreshAt`），可直接解析；
- **OAuth**：同一条命令返回 `Authentication required`（E4）。

因此 `probe()` 的配额分支要同时支持两种情形：能解析就展示真实数字，不能就退化为"配额不可用"并给出改用 API token 的提示，绝不把配额当作发出任务的前置条件。

---

## 7. 鉴权抖动与重试（实测）

> 证据见 [EXPERIMENTS.md](EXPERIMENTS.md) E3。本节只给实现要求。

同一份 OAuth 凭据下，`kaggle` CLI 的 `kernels.*` 子命令会**间歇性**返回 `Authentication required`：

- 观测：轮询同一内核时，20 秒间隔出现"成功 / 失败"交替；
- 复现：`kaggle kernels push` 一次失败、8 秒后同一条命令成功，期间凭据文件未变；
- 同期 `kaggle datasets list`、`kaggle competitions list` 一直正常。

因此编排层必须遵守：

1. 所有 `kernels push/status/logs/output` 调用包一层重试：最多 4 次，退避 2/4/8 秒；
2. 仅当"退出码非 0"且"输出含 `Authentication required`"时，判定为可重试的鉴权抖动；
3. 重试全败才置 `auth_required`，并把最后一次输出写进诊断；
4. 轮询循环里不要因为单次失败把状态置红，连续 3 次失败才算异常。

`kaggle quota` 属于长期不可用（见第 6 节），不适用本条重试策略。

---

## 8. 远端下载预算与磁盘保护（E9）

容器写入层有配额，写满后文件系统转为**只读**，会话直接报废。因此远端运行时必须自己管住下载：

1. 只允许白名单文件类型（`*.json`、`*.txt`、`**/*.fp16.safetensors` 等），禁止整仓拉取；
2. 维护单会话累计下载量，超过 20GB 时先清理最久未使用的模型目录，再继续；
3. 下载失败若伴随 `Errno 30 (Read-only file system)`，上报专门的错误码 `disk_exhausted`，而不是笼统的加载失败；
4. `/health` 增加 `disk_used_gb` 与 `disk_budget_gb`，让资源条能提前示警。

---

## 9. 与旧实现的差异

v1 的远端脚本与现有 `daemon.py` 相比只做两处扩展：

1. `/health` 增加 `devices` 与 `gpu_mem_*` 字段；
2. 加载失败时返回结构化错误（`error.code`）而不是裸异常字符串。

其余行为（Bearer 鉴权、空闲退出、`/shutdown` 立即退出、cloudflared 下载）保持不变。
