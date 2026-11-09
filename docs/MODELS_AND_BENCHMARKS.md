# 模型实测与运行基准

测试环境：Kaggle Nvidia Tesla T4（单卡可用显存 14.56 GiB，PyTorch 2.x，CUDA 12.x）。

## 模型性能对比

| 模型预设 | 分辨率 | 默认步数 / CFG | 单张稳态耗时 | 显存占用 | 权重下载量 | 状态与建议 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ByteDance/SDXL-Lightning` | 1024×1024 | 4 步 / 1.0 | 6.2s | 10.3 GB | 6.6 GB | 默认推荐，画质与速度平衡 |
| `stabilityai/sdxl-turbo` | 512×512 | 1 步 / 0.0 | 1.9s | 7.2 GB | 6.8 GB | 可选，极速草图 |
| `stabilityai/stable-diffusion-xl-base-1.0` | 1024×1024 | 30 步 / 5.0 | 27.8s | 10.5 GB | 6.6 GB | 可选，传统多步生成 |
| `black-forest-labs/FLUX.2-klein-4B` | 1024×1024 | 4 步 / 1.0 | 10.2s（双卡）/ 27s（CPU offload） | 单卡整管 >14.5 GB (OOM) | 8.0 GB | 单卡显存不足，需双卡或 offload |

## 运行约束与环境特性

1. **调度排队**：
   - GPU 任务排队通常需 10~30 分钟，CPU 任务通常在一分钟内就绪。
   - 界面上需展示实际排队状态，避免误报为启动超时。
2. **显存限制**：
   - 单卡 T4 可用显存为 14.56 GiB。
   - SDXL 系列（FP16）显存占用在 7~10.5 GB，可在单卡稳定运行。
   - 4B 以上整管模型（如 FLUX.2-klein-4B）单卡直接加载会报 OOM，必须配置 `device_map="balanced"` 走双卡，或退化为 CPU offload。
3. **磁盘配额**：
   - Kaggle 容器工作目录 `/kaggle/working` 配额为 20GB，容器写入层达到约 52GB 后转为只读。
   - 代码中应限制模型权重拉取列表，避免多模型并发下载撑爆磁盘。
4. **鉴权机制**：
   - 网页生成的 `access_token` 为长期有效 Token。
   - 浏览器 OAuth 获取的 Token 约 3 小时过期，且过期后 `kernels.*` 接口报错 401。
   - Kaggle `kernels.*` API 存在偶发性请求抖动，客户端调用需包含指数退避重试（3 次）。
