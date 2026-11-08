# ADR-0001：本地编排用 TypeScript，远端保留 Python

- 状态：已采纳
- 日期：2026-11-08
- 相关：[ARCHITECTURE.md](../ARCHITECTURE.md)

## 背景

现有实现是纯 Python：`imagen.py` 负责 CLI 编排，`providers/kaggle/provider.py` 负责推送内核、轮询状态、握手与下载，`worker.py` 与 `daemon.py` 在内核里执行推理。插件化后需要常驻后台、实时刷新 UI、并向 Agent 暴露 tool。

## 决策

本地编排层改为 TypeScript，运行在 Harness 宿主进程内；远端 `worker.py` 与 `daemon.py` 保留 Python，作为模板注入配置后推送到 Kaggle。`kaggle` CLI 通过子进程调用。

## 后果

- 编排层与 UI 同进程，状态、事件、取消信号都在一个运行时里，无需跨语言序列化。
- 需要把约 400 行编排逻辑移植，且冷启动一次 2~4 分钟，验证周期长；缓解方式是先移植一次性路径再移植常驻路径。
- 推理侧依赖（torch、diffusers、fp16 变体加载）完全不受影响，继续留在 Python。

## 备选与否决理由

- **保留 Python 编排、Node 只做壳**：短期最快，但两套状态写者必然出现"UI 说在线、CLI 说离线"的分裂。
- **全 Node 重写包括推理**：T4 上不存在可用的 Node 推理栈，否决。
