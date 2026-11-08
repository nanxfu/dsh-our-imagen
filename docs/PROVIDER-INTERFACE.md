# Provider 契约（PROVIDER-INTERFACE）

本文定义宿主编排层与算力提供方之间的 TypeScript 契约。当前唯一实现是 `kaggle`；契约的目标是"接入第二个 Provider 时不改 Service 与 UI"。

---

## 1. 类型

```ts
/** 探测结果：任何时候都可调用，不改变会话状态 */
export interface ProbeResult {
  provider: string                 // 'kaggle'
  cli: { present: boolean; version?: string; path?: string }
  auth: { ok: boolean; account?: string; checkedAt: string; errorCode?: string }
  quota?: { usedHours?: number; totalHours?: number; resetsAt?: string; raw?: string }
  gpuVerified?: boolean            // 账号是否已完成手机验证（影响是否降级到 CPU）
  notes: string[]                  // 面向用户的一句一条
}

/** 会话：全局单例，落盘于插件数据目录 */
export interface Session {
  provider: string
  kernelId: string
  endpointUrl: string              // 隧道地址，形如 https://xxx.trycloudflare.com
  authToken: string                // 与远端 daemon 约定的 Bearer token
  modelId: string
  startedAt: string
  idleTimeoutSec: number
  accelerator: string              // 例：'NvidiaTeslaT4'（CLI 语义为 GPU T4 x2）
  gpuCount: number                 // 实际生效的卡数：1 或 2
}

export interface Health {
  status: 'ok' | string
  modelId: string | null
  device: string                   // 例：'Tesla T4'
  devices: string[]                // 双卡时长度 2
  idleSeconds: number
  idleTimeoutSec: number
  gpuMemUsedMb?: number
  gpuMemTotalMb?: number
}

export interface GenerateSpec {
  modelId: string
  tasks: Array<{
    name: string
    prompt: string
    negativePrompt?: string
    seed: number
    width: number
    height: number
    steps: number
    cfg: number
  }>
}

export interface GenItem {
  name: string
  file: string                     // 相对产物目录的文件名
  prompt: string
  seed: number
  seconds: number
  modelId: string
  bytes: Buffer                    // Host 侧直接落盘，Base64 只在内存中存在
}
```

---

## 2. 接口

```ts
export interface Provider {
  readonly id: string
  readonly displayName: string

  /** 探测环境与账号；不产生计费 */
  probe(): Promise<ProbeResult>

  /** 启动会话；返回时 endpoint 已可服务，或抛出带 code 的错误 */
  start(opts: {
    modelId: string
    idleTimeoutMin: number
    useSecondGpu: boolean
    onProgress?: (p: { phase: string; detail?: string; elapsedMs: number }) => void
    signal?: AbortSignal
  }): Promise<Session>

  /** 主动关机；失败不抛异常，返回是否确认 */
  stop(session: Session): Promise<boolean>

  health(session: Session): Promise<Health>

  generate(
    session: Session,
    spec: GenerateSpec,
    hooks: {
      /** 每完成一张调用一次，用于增量落盘与进度 */
      onItem?: (item: GenItem, index: number, total: number) => void
      onPhase?: (phase: string) => void
      signal?: AbortSignal
    }
  ): Promise<{ items: GenItem[]; elapsedSeconds: number }>

  readonly capabilities: {
    sessionMode: boolean           // 是否支持常驻会话
    secondGpu: boolean             // 是否支持双卡
    quantization: boolean          // 是否支持量化档（v1 恒为 false）
    maxTasksPerJob: number
  }
}
```

错误一律抛 `ImagenError`，其 `code` 取自 [ARCHITECTURE.md](ARCHITECTURE.md) 第 4 节的错误码表，并附 `detail`（原始日志尾部或 CLI 输出）。

---

## 3. Kaggle 实现要点

| 环节 | 做法 | 注意事项 |
| :--- | :--- | :--- |
| 环境探测 | `kaggle --version`、`kaggle quota`、`kaggle auth login`（只读回显） | **不能**用 `auth login` 的成功与否判断登录态；以 `kaggle quota` 退出码为准 |
| 配额解析 | 解析 `kaggle quota` 文本中的小时数与重置时间 | 文本格式可能调整，解析失败时只保留 `raw`，UI 退化为"显示原文" |
| 推送内核 | 组装 `kernel-metadata.json` 与代码文件，`kaggle kernels push -p <dir> --accelerator NvidiaTeslaT4` | `--accelerator NvidiaTeslaT4` 的语义是 **GPU T4 ×2** |
| 握手 | 生成本次专用 ntfy 主题，轮询消息 JSON | 主题随机化，消息内容含 `endpoint_url`、`model_id`、`device` |
| 健康检查 | `GET {endpoint}/health` 带 Bearer | 连续 3 次成功才置 `ready`，避免隧道刚建立时的偶发失败 |
| 出图 | `POST {endpoint}/generate` | 单张失败不终止整批，记录该项 `failed` 并继续 |
| 关机 | `POST {endpoint}/shutdown`，随后清理本地状态 | 关机失败也清理本地状态，并在 UI 提示"远端可能仍在计费" |
| 日志 | `kaggle kernels logs <id>` | 仅在失败或用户点开"诊断"时拉取，避免轮询开销 |

内核代码注入沿用现有机制：把配置序列化为 JSON 后 Base64 嵌入 `daemon.py` / `worker.py` 的占位常量。v1 不引入运行时拉取代码的方式。

---

## 3.1 账号接入（主路径：API token；兜底：OAuth 托管）

登录方式由 ADR-0008 决定：token 为主，OAuth 为辅。两种方式都由 CLI 持有凭据，插件不读取、不解析、不代管 token 内容。

### 主路径：API token

引导只提供命令，用户自己把 token 写进 CLI 的凭据位置：

```powershell
Set-Content -NoNewline "$env:USERPROFILE\.kaggle\access_token" "<token>"
```

验证：执行一次 `kaggle kernels list --user <handle> --page-size 1`。
- 成功 → `auth.ok = true`；
- 输出含 `Authentication required` 或 `Permission ... denied` → `auth_required`，并提示"若同时存在 OAuth 残留凭据，先清理再重试"。

不使用 `kaggle auth login` 的本地回显做判定（它只读本地记录，E10 已证伪），也不使用 `kaggle quota`（E4 显示长期不可用）。

### 兜底：OAuth 托管登录

```ts
const handle = ctx.subprocess.spawn({
  argv: [kagglePath, 'auth', 'login', '--force', '--no-launch-browser'],
  cwd: workspaceDir,
  stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  graceMs: 3000,
})
// handle.stdin 是 Writable；写入验证码后追加 "\n"
```

| 阶段 | 动作 | 失败处理 |
| :--- | :--- | :--- |
| 启动 | spawn，读取 stdout | `ENOENT` → `cli_missing` |
| 取链接 | 正则匹配 `https://www\.kaggle\.com/api/v1/oauth2/authorize\S+` | 10 秒内未匹配到 → 退回 token 路径 |
| 等待用户 | 面板输入框接收一次性验证码 | 5 分钟无输入 → 终止子进程，提示重试 |
| 写回 | `handle.stdin.write(code + "\n")` | 写入失败 → 终止并重试 |
| 收尾 | 等 `done`，退出码 0 → 再做一次真实 API 调用复核 | 复核失败 → `auth_required` |
| 清理 | 无论成败终止残留子进程 | 面板关闭也必须执行 |

### 失效检测

OAuth 的 access token 有效期约 3 小时且不自动续期（E10）。因此：

- `probe()` 每次都要做一次真实 API 调用，不缓存"已登录"结论超过 5 分钟；
- 连续两次真实调用失败即置 `auth_required`，并优先引导走 token 路径；
- 资源条在检测到失效时提示"账号接入已失效，建议改用 API token（长期有效）"，而不是只让用户重登。

安全约束：验证码只存在于内存；禁止写入日志、插件数据目录、错误详情；UI 中输入框按密码类型渲染；`~/.kaggle/access_token` 必须列入 `.gitignore` 提示。

---

## 4. Config 声明（示意）

```ts
export const Config = z.object({
  provider: z.string().default('kaggle'),
  defaultPreset: z.string().default('flux2-klein-4b'),
  outputDir: z.string().default('imagen-output'),
  idleTimeoutMin: z.number().min(5).max(120).default(30),
  maxWaitMin: z.number().min(5).max(60).default(30),
  useSecondGpu: z.boolean().default(false),
  pollIntervalMs: z.number().min(500).max(60000).default(2000),
})
```

规则：**敏感内容不进 Config**（会明文落到 `cordis.patch.yml`）。

---

## 5. 接入第二个 Provider 的验收清单

新 Provider 合入前必须全部满足：

1. 实现第 2 节的接口，`capabilities` 如实声明。
2. `probe()` 在未配置、配置错误、配置正确三态下返回可区分的结果，且不产生计费。
3. `start()` 的超时上限与 `maxWaitMin` 一致，超时抛出 `failed` 而非挂死。
4. `stop()` 在远端已不可达时仍返回 `false` 且不抛异常。
5. `generate()` 支持取消，取消后已完成的图不丢。
6. 所有错误带 `code` + `detail`，能映射到 [ARCHITECTURE.md](ARCHITECTURE.md) 的错误码表。
7. UI 不需要为新 Provider 增加分支判断（若需要，说明契约缺字段，先补契约）。
8. 在 [MODEL-CATALOG.md](MODEL-CATALOG.md) 的准入基准下至少跑通一张模型卡。
