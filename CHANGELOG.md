# 变更记录

## 0.3.0 — 2026-11-10

### 界面与文案去 AI 味（V2 规格）

- **文案全量重写**：中英双语各 220 键，逐条按平实、直接的桌面软件语气改写；去掉装饰性 emoji 与「智能」「即刻」类强调词；废弃焦舞台、胶卷、抽卡、工坊、资产画廊、以此图微调、换种子抽卡等借喻，统一为画面预览、最近生成、创作、作品画廊、带回参数、生成变体。
- **布局**：删除 72px 图标栏（`RailNav.jsx`），改为固定 320px 单轨创作面板，视图切换与 GPU 状态全部收在顶栏；「最近生成」保留底部整页 dock。窄屏仍按「面板在上、画面在下」收纳。
- **悬浮提示**：新增 `Tooltip` 组件（悬停、键盘聚焦、触屏点击触发，`Esc` 或点击别处关闭），提示词、排除项、采样步数、引导强度、Kaggle 账号与空闲休眠六处把长篇说明收敛进 `(i)` / `(!)`。
- **灵感与润色**：提示词下方常驻 5 组灵感预设，输入框为空时填入、已有内容时换行追加；润色改为宿主模型返回光影 / 材质 / 构图 / 氛围四维标签，点击追加、再点撤销，按预设与语言自适应，模型不可用时使用同结构的本地建议。
- **创作助手**：对话模式改为大模型意图解析——一句话生成确认卡（整理后的提示词、比例、风格、「按此生成」）；用户要求互相矛盾时出澄清卡；模型不可用时按当前设置自动决定；后续消息作为增量修改继承上一轮描述。
- **作品画廊**：卡片悬停提供「带回参数 / 生成变体 / 查看大图」；顶栏新增「在文件夹中打开」，由宿主 `subprocess` 调起系统文件管理器且只允许产物目录；历史接口回传绝对路径，复制与批量导出都是绝对路径。
- **接口**：新增 `POST /imagen-api/intent`（意图解析）与 `POST /imagen-api/reveal`（打开产物目录，支持 `dryRun` 自检）；`/imagen-api/enhance` 改为四维结构化输出并接收 `presetId` / `locale`；`/imagen-api/history` 每条图片新增 `absolute`。
- **工程**：文案检查扩扫 `.jsx`；逻辑测试补润色标签、灵感文案与意图映射；新增 `lib/intent.js`、`src/logic/{refine,intent}.js`；预览工具新增润色面板与画廊悬停场景。
- **清理**：删除失效字典键 65 个、`src/studio/RailNav.jsx`、未引用的 `src/utils/clipboard.js`、比例死标签与已无对应 DOM 的 CSS。

### 可用性硬化（2026-11-10）

- **会话失效可感知**：进入 `ready` 后不再停掉 Kernel 状态轮询（30s）；心跳连续失败时先查 Kernel——已结束转 `session_ended`/`remote_error`，仍 `RUNNING` 则重取隧道地址，恢复窗口内仍失败转 `health_failed`。修复「空闲 30 分钟后界面永远显示在线、每张图都失败」。
- **会合失败快速报错**：解析 daemon 通过 ntfy 发出的 `type:'error'` 事件立即失败，并区分「仍在排队」与「容器已运行但未会合」；不再等满 45 分钟 `queue_timeout` 再给出归因错误的提示。
- **代理环境可用**：`/health`、`/generate`、`/shutdown` 全部改走 `lib/net.js`（fetch 失败降级本机 curl），curl 兜底按真实 HTTP 状态码解析并支持大响应体。
- **停止语义成立**：用户主动关机后排队任务不再自动拉起新 Kernel（`error.code='stopped'`）；start/stop 竞态不再留下僵尸轮询；dispose/fail 尽力通知远端退出，降低孤儿 Kernel 的配额浪费；push 失败清理含 token 的临时 Kernel 目录。
- **启动异常兜底**：`kaggleUsername` / `buildKernelFolder` / `pushKernel` 抛异常时统一收敛为可读错误并清理目录，不再永久卡在 provisioning。
- **历史与产物**：`/imagen-api/history` 回传完整 `params` 与 `finishedAt`（舞台提示词、以此图微调不再取错参数）；产物文件名改用本地序号，不再拼接远端返回的 name。
- **环境探测**：version 之后 auth/quota/username 三路并发（一次检查从 90s 降到约 20~30s）；区分 `cli_missing` 与 `cli_timeout`，修正重复的版本串；CLI 超时放宽到 30s。
- **客户端**：风格胶囊后缀真正进入最终 prompt、取消风格同步收回负向词；换种子抽卡基于当前选中图；风格/抽卡/重试均走可离线测试的纯逻辑模块；指引卡支持 cli/session/generate/generic 四类、可关闭、带详情行与正确动作；探测有进度、45s 超时兜底，成败只看 `payload.ok`；负向提示词在 cfg=0 时给出说明。
- **本地库**：`library.json` 改为进程内串行队列 + 临时文件 rename 原子写，多窗口并发收藏/删除不丢更新；文件损坏时返回 `notes` 并备份 `.corrupt-*`。
- **测试**：新增 `test/session-reliability.mjs`（26 项）、`test/session-race.mjs`（44 项）、`test/library-atomic.mjs`（12 项），客户端逻辑测试扩到 20 项、渲染场景扩到 12 项；`npm test` 纳入全部离线断言。

### 变更

- **工作台视觉重建（黑白灰工作室）**：整页改成 `工坊 / 画廊` 两视图 + 左图标栏 + 创作面板 + 悬浮画布 + 底部胶片坞的结构；主题色收敛为黑白灰，唯一强调色是墨黑（主按钮、选中环、激活图标），去掉彩色渐变、彩色光晕与「AI 产品画布」式装饰。深色主题按同一明度关系反相：深灰底、浅灰字、浅色主操作。样式从单文件 `src/styles.css` 拆成 `src/styles/` 下的 tokens / base / shell / panel / stage / filmstrip / gallery / chat / responsive 九个模块，由 `src/styles.js` 聚合并仍以文本形式打进单文件 bundle。
- **画廊改为作品卡片墙**：工具条收成一张玻璃卡（搜索、按模型过滤、只看收藏、批量选择、导出、删除），内容按「今天 / 本周 / 更早」分组；卡片按图片原始比例自然高度瀑布流，悬停轻抬升，含两行提示词、模型与种子标签、右上角收藏星标；批量模式下显示选择圆点与确认删除。
- **对话形态重做**：左侧面板的对话形态改为无头像消息流（用户浅灰气泡靠右、助手卡片带状态点与可选缩略图），生成中状态用微光条而不是转圈；底部输入区是悬浮卡片 + 圆形发送钮，扩写与清空入口收在输入区上方。
- **画布与舞台**：图片按比例居中并带柔和投影，右上角悬浮「查看原图 / 复制路径 / 收藏」玻璃按钮；图下一行提示词，右下角显示分辨率 · 耗时 · 种子；动作胶囊（以此图微调 / 换种子抽卡 / 复制文件路径）留在画布下方。
- **胶片坞**：从深色胶片带改为底部悬浮玻璃条，按批次展示缩略图与模型/张数标注；进行中任务显示带微光的骨架卡；右侧入口通往资产画廊。
- **顶栏**：品牌标 + 工坊/画廊分段切换 + 云端算力胶囊（点击查看免费额度、闲置休眠、设备与唤起/休眠/检查凭据）+ 模型预设选择 + 刷新历史。
- **图标**：补齐 `search / sparkles / message / images / expand / dots / plus / refresh / check / chevronRight / clock / cloud` 等手写图标，新增图标栏与对话面板需要的条目，全部保持 24×24、1.6px 圆角描边。
- **对话页徽章**：与工作台同一套黑白灰语言，改为中性胶囊 + 语义状态点，宿主深色主题下自动反相。
- **工程**：新增 `src/studio/RailNav.jsx`；`tools/preview.mjs` 支持整页、独立画廊、独立对话、深色与 390 宽 iframe 预览，占位图改为五种中性抽象构图；测试基准（`test/render-golden.json`）随 DOM 结构更新。

## 0.2.0 — 2026-11-09

### 新增

- **远端会话生命周期**：`lib/session.js` 完整实现 push → 排队 → 隧道 → 握手 → ready 的状态机，带排队/隧道超时、Kernel 状态轮询与失败原因回传。空转视为 `absent`，重复调用幂等。
- **Kernel 打包与配置注入**：`lib/kernel.js` 每次会话生成一次性 Kernel 目录，把 Token、ntfy topic、预载模型描述以 Base64 注入脚本；`--accelerator NvidiaTeslaT4` 申请 2×T4。
- **出图任务队列**：`lib/jobs.js` 串行队列，参数校验与钳制（尺寸取 8 的倍数、步数 1–60、CFG 0–20、张数 1–4），同批多张使用递增 seed。
- **本地产物**：`lib/output.js` 把图片与 `meta.json` 落到 `<workspace>/imagen-output/<时间戳>-<jobId>/`，并提供历史扫描与预览 URL。
- **Host 路由**：新增 `session/start`、`session/stop`、`generate`、`job`、`jobs`、`history`、`file`，`state` 扩展为完整工作台数据源。
- **Agent 工具**：`imagen_generate`、`imagen_session`、`imagen_history`，对话中可直接出图与查询历史。
- **前端工作台**：`client.js` 重写设置页，包含会话控制、参数区、进度、图墙（点击放大、复制路径）与历史；对话页头部徽章显示会话与任务状态。
- **远端 Daemon v2**：`remote/daemon.py` 重写为常驻服务，包含依赖安装、模型加载分支（`sdxl` / `sdxl-lora` / `flux2`）、日志环、`/logs` 增量拉取、错误分级与空闲退出。
- **出站网络降级**：`lib/net.js` 在进程内 `fetch` 失败时改用本机 `curl`，保证代理环境下的 ntfy 访问。
- **测试**：`test/host-e2e.mjs`（mock daemon，15 项断言）、`test/kaggle-live.mjs`（真实 Kaggle 链路）、`test/tunnel-probe.py`（不占 GPU 的探针）、`test/mock-daemon.py`（本地联调）。

### 修复

- **插件整体加载失败**：cordis 的服务访问是严格的，`inject` 未声明 `tools` 时读取 `ctx.tools` 会直接抛错，导致 `apply` 中断、`/imagen-api/*` 全部 404。已把 `tools` 加入 `inject`，并提供 `test/verify-loaded.mjs` 做重启后的加载检查。
- **Kernel 配置注入失效**：占位符按字面量首次匹配，会命中脚本注释里的同名字符串，导致真实赋值行未注入。改为行首锚定的正则替换。
- **Kernel 失败信息不可读**：`kaggle kernels logs` 输出是 JSON 事件流且混有 notebook 转换噪音，直接截尾会把 `Traceback` 挤掉。改为还原文本、过滤噪音后取尾段。
- **ntfy 发布失败**：`Content-Type: application/json` 会被 ntfy 当作发布指令解析而返回 400，改为 `text/plain` 携带 JSON 字符串。
- **cloudflared 管道阻塞**：拿到域名后不再读取 stderr 会让子进程写满管道卡死，改为独立线程持续 drain。
- **Kaggle 镜像依赖冲突**：镜像自带 `torchao 0.10.0` 与新版 `diffusers` 冲突，daemon 启动时先卸载再升级 `diffusers/transformers/accelerate/peft`。
- **权重下载撑爆磁盘**：SDXL 按 `fp16` 白名单预拉取，避免整仓几十 GB 占满 20GB 工作目录。

### 文档

- 新增 `docs/SPEC.md` 作为三端实现契约；根目录 `DESIGN.md` 重写为当前架构；`README.md` 补充使用与测试方式。

## 0.1.0 — 2026-11-09

### 新增与重构

- **文档与工程体系精简**：
  - 清理冗余的规格文档、过度抽象的 Provider 接口及 ADR 记录，聚焦核心开发。
  - 整合输出核心设计 `DESIGN.md` 与实测基准 `docs/SPEC.md` 第 4 节。
  - 明确技术演进路线 `docs/ROADMAP.md`。
- **DSH 插件骨架**：
  - Host 端：提供 `/imagen-api/state` 与 `/imagen-api/probe` 状态及探针路由。
  - Client 端：设置页与状态徽章，支持实时检查 Kaggle CLI、凭据有效性与 GPU 配额。
  - 远端运行环境：收敛至 `remote/daemon.py` 与 `remote/worker.py`。
