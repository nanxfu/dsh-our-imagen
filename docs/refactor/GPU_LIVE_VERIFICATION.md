# 真机 GPU 链路验证记录（2026-11-10）

## 结论

重构后的完整链路在真实 Kaggle GPU 上端到端通过：

`推送 Kernel → GPU 排队 → ntfy 隧道会合 → 依赖安装 → 模型加载 → /health 就绪 → 生成 1 张 → 关机`

- 命令：`npm run test:gpu`（`test/gpu-live.mjs`）
- 结果：exit code 0，5/5 步骤全部完成
- 验证后 `kaggle kernels status mogudd/imagen-26b921d5` → `KernelWorkerStatus.COMPLETE`（未遗留运行实例）

## 本次运行参数与实测

| 项目 | 值 |
| --- | --- |
| 预设 | `sdxl-lightning`（SDXL Base + SDXL-Lightning LoRA，4 步 / cfg 0） |
| 设备 | 2 × Tesla T4 |
| 已加载 pipeline | `sdxl-lora:stabilityai/stable-diffusion-xl-base-1.0` |
| 分辨率 / 产物 | 1024×1024 PNG，1,206,607 B，PNG 校验通过 |
| 单张耗时 | 10.75 s（`loadSeconds` 0，模型在启动阶段已预载） |
| 生成 + 传输墙钟 | 13 s |
| Kernel | `mogudd/imagen-26b921d5` |

产物（不提交，见 `.gitignore` 的 `bench-results/`）：

- `bench-results/gpu-live/2026-11-10T13-33-23/01.png`
- `bench-results/gpu-live/2026-11-10T13-33-23/report.json`

## 这次真机运行覆盖的重构改动

- `shared/contract.js` 契约注入：daemon 读取注入的 `config.contract`，合法请求未被误拒；
- P9 鉴权收紧：session 注入的随机 token 正常通过，未触发匿名访问路径；
- 版本号统一（插件 / 内核注入 / daemon 均 0.3.0）与 `fail_boot` 收敛后的启动路径；
- 状态对象化后的 `/health`、`/generate`、`/shutdown` 协议字段；
- `lib/remote.js` 简化后的错误解析与 1.2 MB base64 大响应传输（经 `lib/net.js`）。

## 未覆盖的部分

本测试只验证 `sdxl-lightning`。其余预设（`sdxl-turbo` / `sdxl-base` / `flux2-klein-4b`，其中 flux 需双卡 `device_map="balanced"`）、隧道中途重连、会话本地持久化等仍未在真机验证。

## 复现方式

```powershell
# 需要本机 kaggle CLI、~/.kaggle/access_token、可访问 Kaggle / ntfy / trycloudflare
npm run test:gpu
# 指定其他预设或提示词：
node test/gpu-live.mjs --preset sdxl-base --prompt "…"
```