# 技术规格与接口契约 (SPEC)

本文档是 `our-free-imagen` 的唯一规格真理源（Single Source of Truth），涵盖接口入参出参、错误码、Agent 工具定义以及实测硬件基准。

---

## 1. 核心状态与生命周期

### 会话状态（Session State）
会话由 Host 单例管理，对应远端 Kaggle 容器实例：

| 状态 (`state`) | 含义 | 触发场景 / 转换条件 |
| :--- | :--- | :--- |
| `absent` | 未运行 | 初始状态，或已正常关机 / 远端超时退出 |
| `provisioning` | 启动排队中 | 已推送 Kernel 脚本，等待 Kaggle 分配 GPU 容器 |
| `connecting` | 建立连接中 | 已从会合点拿到 Cloudflare 临时域名，正在探测健康状态 |
| `warming` | 模型准备中 | 隧道已通，远端正在安装依赖或加载模型权重 |
| `ready` | 就绪 | 模型已装载完毕，随时可以接收生图请求 |
| `stopping` | 正在关机 | 正在向远端发送退出通知 |
| `error` | 异常中断 | 任一阶段超时或失败（附带具体的错误码与日志片段） |

### 错误码字典 (`error.code`)
- `cli_missing`: 本地未安装 `kaggle` 命令行工具。
- `auth_required`: 未找到 Kaggle 凭证文件或凭据已失效。
- `push_failed`: 推送 Kernel 代码至 Kaggle 平台失败。
- `queue_timeout`: Kaggle GPU 排队超过配置阈值（默认 45 分钟）。
- `tunnel_timeout`: 远端容器启动后，未能在规定时间内建立公网隧道。
- `health_failed`: 隧道已建立，但探针接口无法联通。
- `remote_error`: 远端执行推理异常（如 CUDA 显存不足 OOM）。
- `session_ended`: 远端会话非预期中断（如达到 Kaggle 单次运行上限或被平台回收）。
- `stopped`: 用户主动关机。

---

## 2. Host HTTP 路由

所有插件接口统一挂载在 `/imagen-api` 前缀下，响应格式固定为 `application/json; charset=utf-8`。  
异常响应统一为：`{ "error": { "code": "...", "message": "..." } }`。

### 2.1 会话管理

#### `GET /imagen-api/state`
获取当前插件运行状态全貌（前端轮询面板与徽章的数据来源）。

- **响应示例**：
```json
{
  "version": "0.2.0",
  "defaultPreset": "sdxl-lightning",
  "presets": [
    {
      "id": "sdxl-lightning",
      "name": "SDXL Lightning (极速平衡)",
      "width": 1024,
      "height": 1024,
      "steps": 4,
      "cfg": 1.0
    }
  ],
  "session": {
    "state": "ready",
    "presetId": "sdxl-lightning",
    "kernelId": "username/imagen-1a2b3c4d",
    "kernelUrl": "https://www.kaggle.com/code/username/imagen-1a2b3c4d",
    "kernelStatus": "RUNNING",
    "device": "Tesla T4",
    "deviceCount": 2,
    "startedAt": "2026-11-09T04:00:00.000Z",
    "readyAt": "2026-11-09T04:06:00.000Z",
    "idleTimeoutSec": 1800,
    "error": null
  },
  "jobs": [],
  "lastJob": null
}
```

#### `POST /imagen-api/probe`
主动触发本地 Kaggle 环境检测。
- **响应**：`{ "ok": true, "probe": { "cli": true, "auth": true, "quota": true, "notes": [] } }`

#### `POST /imagen-api/session/start`
启动远端 GPU 会话。具备幂等性（若会话已在运行中，直接返回当前会话信息）。
- **请求体**：`{ "presetId": "sdxl-lightning" }`
- **响应**：`{ "ok": true, "session": { ... } }`

#### `POST /imagen-api/session/stop`
关机。通知远端容器退出并清理本地连接状态。
- **响应**：`{ "ok": true, "session": { "state": "absent" } }`

---

### 2.2 出图任务

#### `POST /imagen-api/generate`
提交新的文生图请求。任务进入本地串行队列（同一时刻只执行一个任务）。

- **请求体**：
```json
{
  "prompt": "a cinematic portrait of an astronaut exploring a lush neon forest, 8k",
  "negativePrompt": "blurry, low quality, distorted",
  "presetId": "sdxl-lightning",
  "width": 1024,
  "height": 1024,
  "steps": 4,
  "cfg": 1.0,
  "seed": 42,
  "count": 1
}
```
- **参数硬性约束与自动钳制（不报错，自动校正）**：
  - `width` / `height`: 必须为 8 的整数倍，范围 256 ~ 1536。
  - `steps`: 范围 1 ~ 60。
  - `cfg`: 范围 0.0 ~ 20.0。
  - `count`: 范围 1 ~ 4。多张生成时，第 `i` 张图片的随机种子为 `seed + i`。
- **响应**：
```json
{
  "ok": true,
  "jobId": "job-101f2d4c",
  "status": "pending",
  "job": { "id": "job-101f2d4c", "prompt": "..." }
}
```

#### `GET /imagen-api/job?id=<jobId>`
查询单个任务状态与生成结果。
- **完成态数据**：包含生成耗时、本地保存路径、图片访问相对 URL 列表。

#### `GET /imagen-api/history?limit=20`
获取工作区 `imagen-output/` 目录下的历史生成记录，按时间倒序排列。

#### `GET /imagen-api/file?path=<encodedPath>`
读取保存在当前工作区内的图片二进制流，供前端直接预览（带路径安全穿透保护）。

---

## 3. DSH 会话 Agent 工具规范

插件向 DSH 会话模型注入 3 个标准 Tool，支持对话中直接出图：

### 3.1 `imagen_generate`
- **描述**：调用远程 Kaggle GPU 生成一张或多张图片。若会话未启动会自动唤起。
- **输入参数**：
  - `prompt` (string, required): 画面内容描述。
  - `negative_prompt` (string, optional): 排除的画面内容。
  - `preset` (string, optional): 预设模型，如 `sdxl-lightning`。
  - `seed` (integer, optional): 随机种子。
- **模型返回样例**：
  - 任务提交成功：返回任务 ID、预计等待时间和本地保存目录。
  - 正在排队时：明确返回当前排队进度，提示用户稍后通过 `imagen_history` 查看。

### 3.2 `imagen_session`
- **描述**：管理云端 GPU 会话（查询状态、主动开机、主动关机）。
- **输入参数**：`action` (`"start"` | `"stop"` | `"status"`)。

### 3.3 `imagen_history`
- **描述**：获取当前工作区最近生成的图片文件列表与参数信息。
- **输入参数**：`limit` (integer, optional, default=5)。

---

## 4. 模型基准与硬件实测数据

运行环境：Kaggle Nvidia Tesla T4（分配 2 块 T4，每卡可用显存 14.56 GiB，CUDA 12.x）。

| 模型预设 ID | 基础模型与权重 | 推荐分辨率 | 步数 / CFG | 单张生成耗时 | 显存占用 | 显存与运行策略 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`sdxl-lightning`** *(默认)* | `ByteDance/SDXL-Lightning` (4-step) | 1024×1024 | 4 步 / 1.0 | **6.2s** (首张 11.6s) | 10.3 GB | 单卡平稳运行，画质与速度最佳平衡 |
| **`sdxl-turbo`** | `stabilityai/sdxl-turbo` | 512×512 | 1 步 / 0.0 | **1.9s** | 7.2 GB | 单卡运行，极速生成草图 |
| **`sdxl-base`** | `stabilityai/stable-diffusion-xl-base-1.0` | 1024×1024 | 30 步 / 5.0 | **27.8s** | 10.5 GB | 单卡运行，传统多步采样 |
| **`flux2-klein-4b`** *(实验)* | `black-forest-labs/FLUX.2-klein-4B` | 1024×1024 | 4 步 / 1.0 | **10.2s** | 整管 > 15 GB | **必须启用双卡平衡** (`device_map="balanced"`)，单卡直接 OOM |

> **首张生成延迟说明**：  
> 远端服务已支持预载模型（Preload）。但首次生成（First Inference）需要建立 CUDA Context 并初始化内存池，耗时通常为 11~12 秒；从第二张开始即恢复为 6.2 秒的稳定速度。
