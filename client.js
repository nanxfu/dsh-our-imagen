window.__ModuleLoader__.load({
	id: "dsh-our-free-imagen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/constants.js
var NS = "our-free-imagen";
var ACTIVE_STATUS = { queued: true, "waiting-session": true, running: true };
var TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true };
var PHASE_STATE = {
  push: "provisioning",
  queue: "provisioning",
  tunnel: "connecting",
  health: "connecting",
  warm: "warming"
};

// src/dict/zh.js
var zh = {
  "nav.label": "免费生图工作台",
  "page.title": "免费生图工作台",
  "page.subtitle": "借用 Kaggle 免费算力跑开源生图模型，开机后单张仅需数秒。",
  "action.probe": "检查环境",
  "action.probing": "检查中…",
  "status.account": "Kaggle 账号",
  "status.quota": "免费 GPU 配额",
  "status.session": "会话",
  "status.defaultModel": "默认模型",
  "value.unknown": "未检查",
  "value.checking": "—",
  "value.ok": "正常",
  "value.failed": "失败",
  "value.quotaUnavailable": "不可用",
  "value.sessionAbsent": "未启动",
  "guide.title": "快速连接指引",
  "guide.step1": "1. 安装 Kaggle 命令行",
  "guide.step2": "2. 配置账号 Token",
  "guide.step3": "3. 确认已绑定手机号",
  "guide.step4": "4. 首次出图自动唤起",
  "guide.hint1": "执行 pip install -U kaggle",
  "guide.hint2": "在 Kaggle 设置页生成 token，写入 ~/.kaggle/access_token",
  "guide.hint3": "⚠️ 未绑定手机号的 Kaggle 账号无法使用 GPU",
  "guide.hint4": "首次排队约 5~10 分钟；开机后单张只需 6 秒",
  "models.title": "模型与硬件表现",
  "models.params": "参数",
  "models.download": "需下载权重",
  "models.gpus": "显卡配置",
  "models.steady": "单张耗时",
  "models.pending": "待测",
  "models.license.restricted": "许可受限",
  "models.tier.fast": "⚡ 极速推荐",
  "models.tier.usable": "经典多步",
  "models.tier.pending": "待测",
  "unit.card": "卡",
  "unit.second": "秒",
  "unit.min": "分",
  "unit.image": "张",
  "chip.offline": "云端未连接",
  "chip.online": "云端在线",
  "note.m2": "模型数据与显存占用均来自 Kaggle T4 实测基准（详见 docs/SPEC.md）。",
  "workbench.title": "免费生图工作台",
  "workbench.subtitle": "首次启动需要云端排队与下载模型，就绪后可连续秒级出图。",
  "workbench.prompt": "提示词",
  "workbench.promptPlaceholder": "描述你想看到的画面，按 Ctrl+Enter 立即生成",
  "workbench.negative": "反向提示词",
  "workbench.negativePlaceholder": "画面中要排除的内容（如模糊、畸变、文字）",
  "workbench.preset": "预设",
  "workbench.size": "尺寸",
  "workbench.width": "宽",
  "workbench.height": "高",
  "workbench.steps": "步数",
  "workbench.cfg": "CFG",
  "workbench.seed": "种子",
  "workbench.count": "张数",
  "workbench.random": "随机",
  "workbench.generate": "生成",
  "workbench.generating": "提交中…",
  "workbench.startSession": "启动会话",
  "workbench.stopSession": "关闭会话",
  "workbench.starting": "启动中…",
  "workbench.stopping": "关闭中…",
  "workbench.sessionHint": "云端实例已保持连接，可随时出图；闲置 30 分钟会自动关机省额度。",
  "workbench.gallery": "结果",
  "workbench.galleryEmpty": "还没有生成过图片，在左侧输入描述开始吧。",
  "workbench.history": "历史",
  "workbench.historyEmpty": "还没有历史产物。",
  "workbench.openFolder": "复制路径",
  "workbench.error": "出错了",
  "workbench.retry": "重试",
  "workbench.errorDetails": "错误详情",
  "workbench.expand": "展开",
  "workbench.collapse": "收起",
  "workbench.loadMore": "加载更多",
  "workbench.loading": "加载中…",
  "workbench.noMore": "没有更多了",
  "workbench.restartSession": "重新启动会话",
  "workbench.sessionEnded": "会话已结束",
  "workbench.copied": "已复制",
  "workbench.copyFallback": "已选中路径，按 Ctrl+C 复制",
  "workbench.elapsed": "已用",
  "workbench.needPrompt": "先写提示词",
  "workbench.close": "关闭",
  "workbench.kernel": "内核",
  "workbench.escClose": "Esc 关闭",
  "session.state.absent": "未启动",
  "session.state.provisioning": "排队中",
  "session.state.connecting": "建立隧道",
  "session.state.warming": "模型加载中",
  "session.state.ready": "就绪",
  "session.state.stopping": "正在关机",
  "session.state.error": "失败",
  "session.phase.push": "推送内核",
  "session.phase.queue": "Kaggle 排队",
  "session.phase.tunnel": "等待隧道",
  "session.phase.health": "健康检查",
  "session.phase.warm": "模型预热",
  "session.hint.provisioning": "正在向 Kaggle 申请 GPU 机器（排队通常需 5~10 分钟，请稍候…）",
  "session.hint.connecting": "已拿到云端地址，正在建立隧道并做连通检查…",
  "session.hint.warming": "云端机器已就绪，正在准备模型权重（即将完成）…",
  "session.hint.stopping": "正在安全关闭云端机器，释放 Kaggle 额度…",
  "session.hint.generating": "正在绘制中…（首次生成约 11 秒，之后约 6 秒）",
  "session.endedHint": "内核已结束，重新启动会话后可继续出图。",
  "job.status.queued": "排队中",
  "job.status.waiting-session": "等待会话",
  "job.status.running": "生成中",
  "job.status.done": "完成",
  "job.status.failed": "失败",
  "error.network": "本地服务暂无响应，正在自动重试。",
  "error.http": "请求失败",
  "error.code.need_prompt": "先写提示词",
  "error.code.cli_missing": "未安装 kaggle CLI",
  "error.code.auth_required": "缺少 kaggle 凭据",
  "error.code.push_failed": "内核推送失败",
  "error.code.queue_timeout": "Kaggle 排队超时",
  "error.code.tunnel_timeout": "隧道没有建立",
  "error.code.health_failed": "远端健康检查未通过",
  "error.code.remote_error": "远端守护进程报错",
  "error.code.stopped": "会话已关闭",
  "error.code.session_ended": "远端会话已结束",
  "error.code.warming": "远端仍在加载模型，稍后重试",
  "error.code.oom": "显存不足",
  "error.code.load_failed": "模型加载失败",
  "error.code.invalid_request": "请求参数不符合远端要求",
  "error.code.generation_failed": "生成失败",
  "studio.nav.label": "生图工作台",
  "studio.tabs": "工作台视图",
  "studio.tab.studio": "工坊",
  "studio.tab.gallery": "画廊",
  "studio.compute.offline": "离线（点击唤起）",
  "studio.compute.queued": "正在排队",
  "studio.compute.warming": "模型准备中",
  "studio.compute.stopping": "正在休眠",
  "studio.compute.online": "在线",
  "studio.compute.error": "连接异常",
  "studio.compute.start": "唤起",
  "studio.compute.stop": "休眠",
  "studio.preset": "模型",
  "studio.style": "风格",
  "studio.prompt": "提示词",
  "studio.promptPlaceholder": "描述你想看到的画面，按 Ctrl+Enter 即刻生成",
  "studio.negative": "排除项",
  "studio.negativePlaceholder": "画面中不要出现的内容",
  "studio.advanced": "专业参数",
  "studio.steps": "步数",
  "studio.cfg": "引导强度",
  "studio.seed": "种子",
  "studio.random": "随机",
  "studio.count": "张数",
  "studio.generate": "即刻生成",
  "studio.generating": "提交中…",
  "studio.generateHint": "Ctrl+Enter 也可生成",
  "studio.stage.empty": "还没有选中作品",
  "studio.stage.emptyHint": "在左侧写下描述，第一张图会出现在这里",
  "studio.stage.zoom": "点击查看原图",
  "studio.stage.rendering": "正在渲染…",
  "studio.meta.size": "分辨率",
  "studio.meta.elapsed": "耗时",
  "studio.meta.seed": "种子",
  "studio.action.iterate": "以此图微调",
  "studio.action.reroll": "换种子抽卡",
  "studio.action.copyPath": "复制文件路径",
  "studio.filmstrip.empty": "这里会出现你生成的每一批作品",
  "studio.filmstrip.offline": "云端还在休眠，先唤起再出图",
  "studio.gallery.title": "资产画廊",
  "studio.gallery.empty": "还没有作品，回工坊抽一张",
  "studio.gallery.today": "今天",
  "studio.gallery.week": "本周",
  "studio.gallery.earlier": "更早",
  "studio.gallery.allPresets": "全部模型",
  "studio.toast.copied": "已复制文件路径",
  "studio.toast.submitted": "已加入云端队列",
  "studio.toast.recalled": "参数已回填",
  "studio.dismiss": "知道了",
  "studio.action.favorite": "⭐ 收藏",
  "studio.action.favorited": "⭐ 已收藏",
  "studio.enhance.button": "AI 建议",
  "studio.enhance.thinking": "正在生成建议…",
  "studio.enhance.local": "模型暂不可用，以下是通用建议",
  "studio.gallery.select": "批量选择",
  "studio.gallery.selectedCount": "已选",
  "studio.gallery.delete": "删除",
  "studio.gallery.cancel": "取消",
  "studio.gallery.confirmDelete": "确认删除",
  "studio.gallery.favoriteOnly": "只看收藏",
  "studio.toast.favorited": "已加入收藏",
  "studio.toast.unfavorited": "已取消收藏",
  "studio.toast.deleted": "已删除",
  "studio.error.deleteFailed": "有图片没能删除",
  "studio.ghost.queued": "云端正在排队…",
  "studio.ghost.rendering": "正在渲染中，已耗时",
  "studio.ghost.batch": "批次",
  "studio.toast.firstImage": "云端生图就绪，第一张图片已生成",
  "studio.guidance.oom.title": "当前分辨率或步数过大，显存不足",
  "studio.guidance.oom.action": "重置为 1024×1024",
  "studio.guidance.sleep.title": "云端实例因闲置超过 30 分钟已自动休眠，额度已节省",
  "studio.guidance.sleep.action": "重新唤醒",
  "studio.guidance.auth.title": "Kaggle 账号缺少手机验证或凭据不可用",
  "studio.guidance.auth.action": "打开 Kaggle 设置",
  "studio.guidance.cli.title": "本地没有检测到 kaggle 命令行",
  "studio.guidance.cli.action": "重新检查环境",
  "studio.guidance.generic.title": "出图没有成功",
  "studio.guidance.generic.action": "重试一次",
  "studio.compute.check": "检查凭据",
  "studio.gallery.search": "搜索提示词或模型",
  "studio.gallery.export": "复制路径",
  "studio.toast.exported": "已复制所选路径",
  "studio.example.1": "黄昏的赛博朋克街道，湿润地面反射霓虹灯",
  "studio.example.2": "东方水墨的远山与孤舟，大面积留白",
  "studio.example.3": "3D 黏土质感的小熊，柔和棚拍光",
  "studio.rail.title": "创作设置",
  "studio.rail.modeForm": "表单",
  "studio.rail.modeChat": "对话",
  "studio.rail.frame": "画面设置",
  "studio.rail.advanced": "高级设置",
  "studio.rail.params": "采样器 / 步数 / 引导强度",
  "studio.chat.assistant": "生图助手",
  "studio.chat.pending": "已提交，正在排队…",
  "studio.chat.queued": "云端正在排队，请稍候…",
  "studio.chat.running": "正在渲染中…",
  "studio.chat.done": "已生成，点击缩略图可放大。",
  "studio.chat.empty": "描述你想要的画面，Enter 发送。",
  "studio.chat.placeholder": "描述你想看到的画面…",
  "studio.chat.clear": "清空对话"
};

// src/dict/en.js
var en = {
  "nav.label": "Free imagen",
  "page.title": "Free imagen workbench",
  "page.subtitle": "Run open image models on free Kaggle compute — after startup, each image takes seconds.",
  "action.probe": "Check environment",
  "action.probing": "Checking…",
  "status.account": "Kaggle account",
  "status.quota": "Free GPU quota",
  "status.session": "Session",
  "status.defaultModel": "Default model",
  "value.unknown": "Not checked",
  "value.checking": "—",
  "value.ok": "Ready",
  "value.failed": "Failed",
  "value.quotaUnavailable": "Unavailable",
  "value.sessionAbsent": "Not started",
  "guide.title": "Quick connect guide",
  "guide.step1": "1. Install the Kaggle CLI",
  "guide.step2": "2. Set up the account token",
  "guide.step3": "3. Confirm a phone number is linked",
  "guide.step4": "4. The first run starts it for you",
  "guide.hint1": "Run pip install -U kaggle",
  "guide.hint2": "Create a token in Kaggle settings, write it to ~/.kaggle/access_token",
  "guide.hint3": "⚠️ A Kaggle account without a linked phone number cannot use the GPU",
  "guide.hint4": "The first queue takes about 5–10 minutes; after startup each image takes 6 seconds",
  "models.title": "Models and hardware",
  "models.params": "Params",
  "models.download": "Weights to download",
  "models.gpus": "GPU setup",
  "models.steady": "Per image",
  "models.pending": "pending",
  "models.license.restricted": "restricted license",
  "models.tier.fast": "⚡ Pick for speed",
  "models.tier.usable": "Classic multi-step",
  "models.tier.pending": "pending",
  "unit.card": "GPU",
  "unit.second": "s",
  "unit.min": "m",
  "unit.image": "images",
  "chip.offline": "Cloud offline",
  "chip.online": "Cloud online",
  "note.m2": "Model metrics and memory usage are verified on Kaggle T4 (see docs/SPEC.md).",
  "workbench.title": "Free imagen workbench",
  "workbench.subtitle": "The first start queues in the cloud and downloads the model; once ready you can generate back to back in seconds.",
  "workbench.prompt": "Prompt",
  "workbench.promptPlaceholder": "Describe the image you want. Press Ctrl+Enter to generate.",
  "workbench.negative": "Negative prompt",
  "workbench.negativePlaceholder": "What to keep out of the picture (blurry, distorted, text)",
  "workbench.preset": "Preset",
  "workbench.size": "Size",
  "workbench.width": "W",
  "workbench.height": "H",
  "workbench.steps": "Steps",
  "workbench.cfg": "CFG",
  "workbench.seed": "Seed",
  "workbench.count": "Images",
  "workbench.random": "Random",
  "workbench.generate": "Generate",
  "workbench.generating": "Submitting…",
  "workbench.startSession": "Start session",
  "workbench.stopSession": "Stop session",
  "workbench.starting": "Starting…",
  "workbench.stopping": "Stopping…",
  "workbench.sessionHint": "The cloud instance stays connected, so you can generate anytime; it shuts down after 30 idle minutes to save quota.",
  "workbench.gallery": "Result",
  "workbench.galleryEmpty": "Nothing generated yet — describe an image on the left to start.",
  "workbench.history": "History",
  "workbench.historyEmpty": "No saved outputs yet.",
  "workbench.openFolder": "Copy path",
  "workbench.error": "Error",
  "workbench.retry": "Retry",
  "workbench.errorDetails": "Error details",
  "workbench.expand": "Expand",
  "workbench.collapse": "Collapse",
  "workbench.loadMore": "Load more",
  "workbench.loading": "Loading…",
  "workbench.noMore": "No more",
  "workbench.restartSession": "Restart session",
  "workbench.sessionEnded": "Session ended",
  "workbench.copied": "Copied",
  "workbench.copyFallback": "Path selected — press Ctrl+C",
  "workbench.elapsed": "Elapsed",
  "workbench.needPrompt": "Write a prompt first",
  "workbench.close": "Close",
  "workbench.kernel": "Kernel",
  "workbench.escClose": "Esc to close",
  "session.state.absent": "Not started",
  "session.state.provisioning": "Queued",
  "session.state.connecting": "Tunneling",
  "session.state.warming": "Loading model",
  "session.state.ready": "Ready",
  "session.state.stopping": "Stopping",
  "session.state.error": "Failed",
  "session.phase.push": "pushing kernel",
  "session.phase.queue": "Kaggle queue",
  "session.phase.tunnel": "tunnel rendezvous",
  "session.phase.health": "health check",
  "session.phase.warm": "model warm-up",
  "session.hint.provisioning": "Asking Kaggle for a GPU machine (the queue usually takes 5–10 minutes)…",
  "session.hint.connecting": "Got the cloud address; opening the tunnel and checking connectivity…",
  "session.hint.warming": "The cloud machine is up; preparing model weights (almost there)…",
  "session.hint.stopping": "Shutting the cloud machine down safely to free Kaggle quota…",
  "session.hint.generating": "Drawing… (about 11 s for the first image, about 6 s after that)",
  "session.endedHint": "The kernel has ended; restart the session to keep generating.",
  "job.status.queued": "Queued",
  "job.status.waiting-session": "Waiting for session",
  "job.status.running": "Generating",
  "job.status.done": "Done",
  "job.status.failed": "Failed",
  "error.network": "Local service is not responding; retrying automatically.",
  "error.http": "Request failed",
  "error.code.need_prompt": "Write a prompt first",
  "error.code.cli_missing": "kaggle CLI is not installed",
  "error.code.auth_required": "kaggle credentials are missing",
  "error.code.push_failed": "Kernel push failed",
  "error.code.queue_timeout": "Kaggle queue timed out",
  "error.code.tunnel_timeout": "Tunnel was not established",
  "error.code.health_failed": "Remote health check failed",
  "error.code.remote_error": "Remote daemon reported an error",
  "error.code.stopped": "Session was stopped",
  "error.code.session_ended": "Remote session ended",
  "error.code.warming": "Remote daemon is still warming up; retry shortly",
  "error.code.oom": "GPU ran out of memory",
  "error.code.load_failed": "Model failed to load",
  "error.code.invalid_request": "Request was rejected by the daemon",
  "error.code.generation_failed": "Generation failed",
  "studio.nav.label": "Imagen Studio",
  "studio.tabs": "Workbench views",
  "studio.tab.studio": "Studio",
  "studio.tab.gallery": "Gallery",
  "studio.compute.offline": "Offline (click to wake)",
  "studio.compute.queued": "Queued",
  "studio.compute.warming": "Preparing model",
  "studio.compute.stopping": "Sleeping",
  "studio.compute.online": "Online",
  "studio.compute.error": "Connection error",
  "studio.compute.start": "Wake",
  "studio.compute.stop": "Sleep",
  "studio.preset": "Model",
  "studio.style": "Style",
  "studio.prompt": "Prompt",
  "studio.promptPlaceholder": "Describe the image you want. Press Ctrl+Enter to generate.",
  "studio.negative": "Exclusions",
  "studio.negativePlaceholder": "What should stay out of the picture",
  "studio.advanced": "Advanced",
  "studio.steps": "Steps",
  "studio.cfg": "Guidance",
  "studio.seed": "Seed",
  "studio.random": "Random",
  "studio.count": "Images",
  "studio.generate": "Generate now",
  "studio.generating": "Submitting…",
  "studio.generateHint": "Ctrl+Enter works too",
  "studio.stage.empty": "No artwork selected yet",
  "studio.stage.emptyHint": "Describe something on the left and your first image lands here",
  "studio.stage.zoom": "Click to view full size",
  "studio.stage.rendering": "Rendering…",
  "studio.meta.size": "Size",
  "studio.meta.elapsed": "Took",
  "studio.meta.seed": "Seed",
  "studio.action.iterate": "Tune from this",
  "studio.action.reroll": "Reroll",
  "studio.action.copyPath": "Copy path",
  "studio.filmstrip.empty": "Every batch you generate shows up here",
  "studio.filmstrip.offline": "The cloud is asleep — wake it to generate",
  "studio.gallery.title": "Asset gallery",
  "studio.gallery.empty": "Nothing yet — head back and roll one",
  "studio.gallery.today": "Today",
  "studio.gallery.week": "This week",
  "studio.gallery.earlier": "Earlier",
  "studio.gallery.allPresets": "All models",
  "studio.toast.copied": "File path copied",
  "studio.toast.submitted": "Added to the cloud queue",
  "studio.toast.recalled": "Settings restored",
  "studio.dismiss": "Got it",
  "studio.action.favorite": "⭐ Favorite",
  "studio.action.favorited": "⭐ Favorited",
  "studio.enhance.button": "AI hints",
  "studio.enhance.thinking": "Writing hints…",
  "studio.enhance.local": "Model unavailable — showing generic hints",
  "studio.gallery.select": "Select",
  "studio.gallery.selectedCount": "Selected",
  "studio.gallery.delete": "Delete",
  "studio.gallery.cancel": "Cancel",
  "studio.gallery.confirmDelete": "Delete now",
  "studio.gallery.favoriteOnly": "Favorites only",
  "studio.toast.favorited": "Added to favorites",
  "studio.toast.unfavorited": "Removed from favorites",
  "studio.toast.deleted": "Deleted",
  "studio.error.deleteFailed": "Some images could not be deleted",
  "studio.ghost.queued": "Waiting in the cloud queue…",
  "studio.ghost.rendering": "Rendering, elapsed",
  "studio.ghost.batch": "Batch",
  "studio.toast.firstImage": "The cloud is ready — your first image is here",
  "studio.guidance.oom.title": "Out of memory at this size or step count",
  "studio.guidance.oom.action": "Reset to 1024×1024",
  "studio.guidance.sleep.title": "The cloud instance slept after 30 idle minutes, saving your quota",
  "studio.guidance.sleep.action": "Wake it up",
  "studio.guidance.auth.title": "Kaggle account needs phone verification or usable credentials",
  "studio.guidance.auth.action": "Open Kaggle settings",
  "studio.guidance.cli.title": "The kaggle CLI was not found locally",
  "studio.guidance.cli.action": "Check again",
  "studio.guidance.generic.title": "The generation did not finish",
  "studio.guidance.generic.action": "Try again",
  "studio.compute.check": "Check credentials",
  "studio.gallery.search": "Search prompts or models",
  "studio.gallery.export": "Copy paths",
  "studio.toast.exported": "Selected paths copied",
  "studio.example.1": "A cyberpunk street at dusk, wet asphalt mirroring neon",
  "studio.example.2": "Ink-wash mountains and a lone boat, plenty of negative space",
  "studio.example.3": "A clay-render bear cub under soft studio light",
  "studio.rail.title": "Creation",
  "studio.rail.modeForm": "Form",
  "studio.rail.modeChat": "Chat",
  "studio.rail.frame": "Frame",
  "studio.rail.advanced": "Advanced",
  "studio.rail.params": "Sampler / steps / guidance",
  "studio.chat.assistant": "Image assistant",
  "studio.chat.pending": "Submitted, queuing…",
  "studio.chat.queued": "Waiting in the cloud queue…",
  "studio.chat.running": "Rendering…",
  "studio.chat.done": "Done — click a thumbnail to enlarge.",
  "studio.chat.empty": "Describe what you want, then press Enter.",
  "studio.chat.placeholder": "Describe the image you want…",
  "studio.chat.clear": "Clear chat"
};

// src/dict/index.js
var DICT = { zh, en };

// src/runtime.js
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;

// src/theme.js
var token = {
  bg: "var(--dsw-alias-bg-layer-1)",
  border: "var(--dsw-alias-border-l1)",
  text: "var(--dsw-alias-label-primary)",
  textSub: "var(--dsw-alias-label-secondary)",
  ok: "var(--dsw-alias-state-success-primary)",
  warn: "var(--dsw-alias-state-warn-primary)",
  error: "var(--dsw-alias-state-error-primary)",
  idle: "var(--dsw-alias-state-idle-primary)",
  brand: "var(--dsw-alias-brand-primary)"
};
var styles = {
  dot: (color) => ({
    width: 7,
    height: 7,
    minWidth: 7,
    borderRadius: 99,
    background: color,
    display: "inline-block"
  }),
  headerChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: 96,
    minWidth: 0,
    fontSize: 11,
    color: token.textSub,
    padding: "1px 8px",
    border: `1px solid ${token.border}`,
    borderRadius: 999,
    background: token.bg,
    whiteSpace: "nowrap",
    overflow: "hidden"
  },
  headerChipText: { overflow: "hidden", textOverflow: "ellipsis" }
};

// src/i18n.js
function fallbackTranslate(lang) {
  const dict = lang && lang.toLowerCase().startsWith("zh") ? DICT.zh : DICT.en;
  return (key) => dict[key] ?? DICT.en[key] ?? key;
}
function translator(props) {
  if (props && typeof props.t === "function") return props.t;
  return fallbackTranslate(typeof document === "undefined" ? "en" : document.documentElement.lang);
}
function localized(t, key) {
  const value = t(key);
  return typeof value === "string" && value !== key ? value : "";
}

// src/logic/status.js
function sessionStateText(t, state) {
  const key = state ? `session.state.${state}` : "session.state.absent";
  return localized(t, key) || state || t("value.unknown");
}
function jobStatusText(t, status) {
  if (!status) return "";
  return localized(t, `job.status.${status}`) || status;
}
function phaseText(t, phase) {
  if (!phase) return "";
  return localized(t, `session.phase.${phase}`) || "";
}
function phaseHint(t, session) {
  if (!session) return "";
  const phase = typeof session.phase === "string" ? session.phase : "";
  const state = PHASE_STATE[phase] || (typeof session.state === "string" ? session.state : "");
  return state ? localized(t, `session.hint.${state}`) || "" : "";
}

// src/logic/color.js
function sessionColor(state) {
  if (state === "ready") return token.ok;
  if (state === "error") return token.error;
  if (state === "provisioning" || state === "connecting" || state === "warming" || state === "stopping") return token.warn;
  return token.idle;
}
function jobColor(status) {
  if (status === "done") return token.ok;
  if (status === "failed") return token.error;
  if (status === "running") return token.brand;
  if (status === "queued" || status === "waiting-session") return token.warn;
  return token.idle;
}

// src/logic/jobs.js
function stateJobs(state) {
  return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : [];
}
function activeJobOf(state) {
  return stateJobs(state).find((job) => ACTIVE_STATUS[job.status] === true) ?? null;
}

// src/logic/view.js
function buildSessionView(t, input) {
  const session = input.session;
  const state = session && session.state || "absent";
  const probe = input.probe || null;
  const busy = input.sessionBusy || "";
  const errorCode = session && session.error && session.error.code || "";
  const ended = state === "error" && errorCode === "session_ended";
  const warming = state === "error" && errorCode === "warming";
  const accountReady = probe ? probe.auth && probe.auth.ok === true : null;
  const quotaTotal = probe && probe.quota && probe.quota.totalHours != null ? probe.quota.totalHours : null;
  const hint = phaseHint(t, session);
  return {
    state,
    headline: ended ? t("workbench.sessionEnded") : sessionStateText(t, state),
    stateText: sessionStateText(t, state),
    phaseTag: phaseText(t, session && session.phase),
    hint,
    note: hint || session && session.detail || "",
    device: session && session.device || "",
    modelId: session && session.modelId || "",
    kernelStatus: session && session.kernelStatus || "",
    kernelUrl: session && typeof session.kernelUrl === "string" ? session.kernelUrl : "",
    color: ended || warming ? token.warn : sessionColor(state),
    ended,
    warming,
    transient: TRANSIENT_SESSION[state] === true,
    hasError: !!(session && session.error && (session.error.code || session.error.message)),
    errorCode,
    canStart: !busy && (state === "absent" || state === "error"),
    canStop: !busy && state !== "absent" && state !== "stopping",
    busy,
    probing: input.probeBusy === true,
    accountReady,
    accountLabel: accountReady === null ? t("value.unknown") : accountReady ? t("value.ok") : t("value.failed"),
    chipLabel: accountReady === true ? t("chip.online") : t("chip.offline"),
    quotaLabel: probe && probe.quota && probe.quota.available ? `${probe.quota.usedHours ?? "?"} / ${quotaTotal ?? "?"} h` : probe ? t("value.quotaUnavailable") : t("value.unknown"),
    defaultModel: input.defaultPreset || "—"
  };
}

// src/api.js
function apiUrl(relative) {
  if (typeof document === "undefined") return relative;
  return new URL(relative, document.baseURI).toString();
}
async function request(relative, init) {
  try {
    const res = await fetch(apiUrl(relative), {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: {
        accept: "application/json",
        ...init && init.body ? { "content-type": "application/json" } : {},
        ...init && init.headers ? init.headers : {}
      }
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const envelope = payload && payload.error ? payload.error : null;
      return {
        ok: false,
        status: res.status,
        // 远端 daemon 未就绪时 Host 回 503；没有明确错误码就按可重试的 warming 处理。
        code: envelope && envelope.code ? envelope.code : res.status === 503 ? "warming" : `http_${res.status}`,
        message: envelope && envelope.message ? envelope.message : `HTTP ${res.status}`
      };
    }
    return { ok: true, status: res.status, data: payload };
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      code: "network",
      message: String(cause && cause.message || cause || "network error")
    };
  }
}

// src/hooks/useHostState.js
function useHostState() {
  const [state, setState] = import_react.default.useState(null);
  const [error, setError] = import_react.default.useState(null);
  const aliveRef = import_react.default.useRef(false);
  const refreshRef = import_react.default.useRef(() => {
  });
  import_react.default.useEffect(() => {
    aliveRef.current = true;
    let stopped = false;
    let timer = null;
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const result = await request("imagen-api/state", { method: "GET" });
      if (stopped || !aliveRef.current) return;
      let delay = 1e4;
      if (result.ok && result.data && typeof result.data === "object") {
        setState(result.data);
        setError(null);
        delay = activeJobOf(result.data) ? 2e3 : 1e4;
      } else {
        setError({ code: result.code, message: result.message });
      }
      timer = setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) {
        clear();
        return;
      }
      clear();
      tick();
    };
    refreshRef.current = () => {
      clear();
      tick();
    };
    tick();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      aliveRef.current = false;
      clear();
      refreshRef.current = () => {
      };
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const refresh = import_react.default.useCallback(() => {
    refreshRef.current();
  }, []);
  const patch = import_react.default.useCallback((partial) => {
    setState((prev) => prev ? { ...prev, ...partial } : prev);
  }, []);
  return { state, error, refresh, patch };
}

// src/components/StatusChip.js
function StatusChip(props) {
  const t = translator(props);
  const host = useHostState();
  const state = host.state;
  const session = state && state.session || null;
  const view = buildSessionView(t, {
    session,
    probe: state && state.probe,
    defaultPreset: state && state.defaultPreset,
    sessionBusy: "",
    probeBusy: false
  });
  const running = activeJobOf(state);
  const label = running ? jobStatusText(t, running.status) : view.headline;
  const color = running ? jobColor(running.status) : view.color;
  const title = [
    running ? jobStatusText(t, running.status) : "",
    view.ended ? t("workbench.restartSession") : "",
    view.warming ? t("error.code.warming") : "",
    view.stateText,
    view.note,
    view.chipLabel
  ].filter(Boolean).join(" · ");
  return h(
    "span",
    { style: styles.headerChip, title },
    h("span", { style: styles.dot(color) }),
    h("span", { style: styles.headerChipText }, label)
  );
}

// src/studio/Studio.jsx
var import_react11 = __toESM(require("react"), 1);

// src/styles.css
var styles_default = "/*\n * 生图工作台样式。\n *\n * 设计约束：\n *  1. 视觉分层：画布 → 卡片 → 控件，三级不混用；卡片统一 16px 圆角与柔和投影。\n *  2. 颜色优先取宿主 --dsw-alias-* 变量；预览 / 独立运行时有兜底值，\n *     因此这里写 `var(--dsw-alias-x, #fallback)` 的形式。\n *  3. 结构：根用 flex 纵向三段（顶栏 / 弹性主体 / 胶卷流），主体内部左右两栏，\n *     避免用固定 grid 行数——某一层条件渲染时会错位。\n */\n\n/* ── 根与画布 ───────────────────────────────────────────────── */\n.ofs-root {\n  --ofs-card: var(--dsw-alias-bg-layer-1, #ffffff);\n  --ofs-sunken: var(--dsw-alias-bg-layer-2, #f5f6fa);\n  --ofs-line: var(--dsw-alias-border-l1, #e6e8f0);\n  --ofs-line-strong: color-mix(in oklab, var(--ofs-line) 72%, #000 28%);\n  --ofs-text: var(--dsw-alias-label-primary, #14161d);\n  --ofs-text-2: var(--dsw-alias-label-secondary, #6a7183);\n  --ofs-text-3: color-mix(in oklab, var(--ofs-text-2) 62%, #fff);\n  --ofs-brand: var(--dsw-alias-brand-primary, #4f46e5);\n  --ofs-brand-soft: color-mix(in oklab, var(--ofs-brand) 14%, transparent);\n  --ofs-ok: var(--dsw-alias-state-success-primary, #12a150);\n  --ofs-warn: var(--dsw-alias-state-warn-primary, #d97706);\n  --ofs-error: var(--dsw-alias-state-error-primary, #dc2626);\n  --ofs-idle: var(--dsw-alias-state-idle-primary, #9aa1b2);\n  --ofs-radius-lg: 18px;\n  --ofs-radius: 12px;\n  --ofs-radius-sm: 9px;\n  --ofs-shadow-card: 0 1px 2px rgb(16 24 40 / 4%), 0 12px 28px -18px rgb(16 24 40 / 22%);\n  --ofs-shadow-pop: 0 18px 46px -16px rgb(16 24 40 / 28%);\n\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  color: var(--ofs-text);\n  font-size: 13px;\n  line-height: 1.55;\n  background:\n    radial-gradient(900px 420px at 4% -8%, rgb(99 102 241 / 10%), transparent 62%),\n    radial-gradient(760px 400px at 102% -4%, rgb(14 165 233 / 9%), transparent 58%),\n    var(--dsw-alias-bg-canvas, #eef0f6);\n}\n\n/* ── 顶栏 ───────────────────────────────────────────────────── */\n.ofs-topbar {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 14px 22px 6px;\n  min-width: 0;\n}\n\n.ofs-tabs {\n  display: inline-flex;\n  gap: 2px;\n  padding: 3px;\n  border-radius: 999px;\n  background: color-mix(in oklab, var(--ofs-card) 70%, transparent);\n  border: 1px solid var(--ofs-line);\n}\n\n.ofs-tabs button {\n  appearance: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 12.5px;\n  padding: 5px 16px;\n  border-radius: 999px;\n  cursor: pointer;\n  transition: background 140ms ease, color 140ms ease;\n}\n\n.ofs-tabs button.is-on {\n  background: var(--ofs-card);\n  color: var(--ofs-text);\n  font-weight: 550;\n  box-shadow: 0 1px 3px rgb(16 24 40 / 10%);\n}\n\n.ofs-grow { flex: 1 1 auto; min-width: 0; }\n\n.ofs-pill-wrap { position: relative; }\n\n.ofs-pill {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 12px 6px 13px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n  white-space: nowrap;\n  box-shadow: 0 1px 2px rgb(16 24 40 / 5%);\n}\n\n.ofs-pill i {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--ofs-idle);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-idle) 22%, transparent);\n}\n\n.ofs-pill--ok i { background: var(--ofs-ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-ok) 22%, transparent); }\n.ofs-pill--warn i { background: var(--ofs-warn); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-warn) 22%, transparent); }\n.ofs-pill--error i { background: var(--ofs-error); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-error) 22%, transparent); }\n\n.ofs-pill-caret { color: var(--ofs-text-3); font-size: 9px; }\n\n.ofs-pill-card {\n  position: absolute;\n  top: calc(100% + 8px);\n  right: 0;\n  z-index: 40;\n  display: grid;\n  gap: 2px;\n  min-width: 156px;\n  padding: 6px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-pop);\n}\n\n.ofs-pill-card button {\n  appearance: none;\n  border: 0;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12.5px;\n  text-align: left;\n  padding: 7px 10px;\n  cursor: pointer;\n}\n\n.ofs-pill-card button:hover:not(:disabled) { background: var(--ofs-sunken); }\n.ofs-pill-card button:disabled { opacity: 0.38; cursor: default; }\n\n.ofs-preset {\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  font-size: 12px;\n  color: var(--ofs-text-2);\n}\n\n.ofs-preset select,\n.ofs-gallery-bar select {\n  appearance: none;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12px;\n  padding: 6px 12px;\n  max-width: 280px;\n  cursor: pointer;\n  box-shadow: 0 1px 2px rgb(16 24 40 / 5%);\n}\n\n/* ── 主体：灵感卡 + 主舞台 ──────────────────────────────────── */\n.ofs-shell {\n  flex: 1 1 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 6px 22px 0;\n}\n\n.ofs-body {\n  flex: 1 1 0;\n  min-height: 0;\n  display: grid;\n  grid-template-columns: 340px minmax(0, 1fr);\n  grid-template-rows: minmax(0, 1fr);\n  gap: 16px;\n  overflow: hidden;\n}\n\n.ofs-main { min-width: 0; min-height: 0; display: flex; }\n\n/* ── 左侧灵感与控制卡 ───────────────────────────────────────── */\n.ofs-rail {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-height: 0;\n  padding: 16px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius-lg);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  overflow-y: auto;\n  overflow-x: hidden;\n}\n\n.ofs-block {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 0;\n}\n\n/* 提示词块吃掉多余高度，主按钮自然落到底部 */\n.ofs-block--grow { flex: 1 1 auto; min-height: 0; }\n.ofs-block--grow .ofs-textarea { flex: 1 1 auto; min-height: 96px; }\n\n.ofs-block > h3 {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.06em;\n  color: var(--ofs-text-3);\n  text-transform: uppercase;\n}\n\n.ofs-capsules { display: flex; flex-wrap: wrap; gap: 6px; }\n\n.ofs-capsule {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 5px 11px;\n  cursor: pointer;\n  transition: border-color 140ms ease, color 140ms ease, background 140ms ease;\n}\n\n.ofs-capsule:hover { border-color: var(--ofs-line-strong); color: var(--ofs-text); }\n\n.ofs-capsule.is-on {\n  border-color: transparent;\n  background: var(--ofs-brand-soft);\n  color: var(--ofs-brand);\n  font-weight: 550;\n}\n\n.ofs-textarea {\n  box-sizing: border-box;\n  width: 100%;\n  resize: none;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-sunken);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.65;\n  padding: 11px 12px;\n  min-height: 118px;\n  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;\n}\n\n.ofs-textarea--short { min-height: 66px; }\n\n.ofs-textarea::placeholder { color: var(--ofs-text-3); }\n\n.ofs-textarea:focus {\n  outline: none;\n  background: var(--ofs-card);\n  border-color: var(--ofs-brand);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-brand) 16%, transparent);\n}\n\n.ofs-boosts { display: flex; flex-wrap: wrap; gap: 6px; }\n\n.ofs-boost {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  border: 1px dashed var(--ofs-line-strong);\n  border-radius: var(--ofs-radius-sm);\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11px;\n  padding: 5px 9px;\n  cursor: pointer;\n  max-width: 100%;\n}\n\n.ofs-boost:hover { border-color: var(--ofs-brand); color: var(--ofs-brand); border-style: solid; }\n\n.ofs-boost.is-ai {\n  border-style: solid;\n  border-color: color-mix(in oklab, var(--ofs-brand) 32%, var(--ofs-line));\n  background: var(--ofs-brand-soft);\n  color: var(--ofs-text);\n  text-align: left;\n}\n\n.ofs-boost.is-ai span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n.ofs-boost-row { display: flex; align-items: center; gap: 8px; min-width: 0; }\n\n.ofs-enhance {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 5px 12px;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: border-color 140ms ease, color 140ms ease;\n}\n\n.ofs-enhance:hover:not(:disabled) { border-color: var(--ofs-brand); color: var(--ofs-brand); }\n.ofs-enhance:disabled { opacity: 0.55; cursor: default; }\n\n.ofs-disclosure {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  width: 100%;\n  border: 0;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 4px 2px;\n  cursor: pointer;\n}\n\n.ofs-disclosure:hover { color: var(--ofs-text); }\n\n.ofs-advanced {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 9px;\n}\n\n.ofs-ratios {\n  grid-column: 1 / -1;\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 7px;\n}\n\n.ofs-ratio {\n  appearance: none;\n  display: grid;\n  justify-items: center;\n  gap: 5px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius-sm);\n  background: var(--ofs-sunken);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 10.5px;\n  padding: 8px 2px;\n  cursor: pointer;\n  transition: border-color 140ms ease, color 140ms ease;\n}\n\n.ofs-ratio:hover { border-color: var(--ofs-line-strong); color: var(--ofs-text); }\n.ofs-ratio.is-on { border-color: var(--ofs-brand); color: var(--ofs-brand); background: var(--ofs-brand-soft); }\n\n.ofs-ratio-glyph { display: block; border: 1.5px solid currentcolor; border-radius: 3px; }\n.ofs-ratio-glyph--1-1 { width: 16px; height: 16px; }\n.ofs-ratio-glyph--16-9 { width: 24px; height: 13.5px; }\n.ofs-ratio-glyph--9-16 { width: 13.5px; height: 24px; }\n\n.ofs-field { display: grid; gap: 4px; font-size: 10.5px; color: var(--ofs-text-2); }\n\n.ofs-field input,\n.ofs-field select {\n  box-sizing: border-box;\n  width: 100%;\n  border: 1px solid var(--ofs-line);\n  border-radius: 8px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12px;\n  padding: 6px 8px;\n  text-align: center;\n}\n\n.ofs-field input:focus,\n.ofs-field select:focus {\n  outline: none;\n  border-color: var(--ofs-brand);\n  background: var(--ofs-card);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-brand) 16%, transparent);\n}\n\n/* 主按钮固定在卡片底部，不被输入区挤走 */\n.ofs-generate {\n  appearance: none;\n  margin-top: auto;\n  border: 1px solid transparent;\n  border-radius: 999px;\n  background: var(--ofs-text);\n  color: var(--ofs-card);\n  font: inherit;\n  font-size: 13.5px;\n  font-weight: 600;\n  padding: 12px 18px;\n  cursor: pointer;\n  box-shadow: 0 10px 24px -14px rgb(16 24 40 / 70%);\n  transition: transform 120ms ease, opacity 140ms ease;\n}\n\n.ofs-generate:hover:not(:disabled) { transform: translateY(-1px); }\n.ofs-generate:disabled { opacity: 0.45; cursor: default; transform: none; }\n\n.ofs-hint {\n  margin: -4px 0 0;\n  font-size: 10.5px;\n  color: var(--ofs-text-3);\n  text-align: center;\n}\n\n/* ── 焦点舞台 ───────────────────────────────────────────────── */\n.ofs-stage {\n  flex: 1 1 0;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n  min-height: 0;\n}\n\n.ofs-figure {\n  position: relative;\n  flex: 1 1 auto;\n  margin: 0;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius-lg);\n  padding: 14px;\n  background:\n    radial-gradient(120% 90% at 50% 0%, var(--ofs-card), var(--ofs-sunken) 78%);\n  box-shadow: var(--ofs-shadow-card);\n  overflow: hidden;\n}\n\n.ofs-figure-button {\n  appearance: none;\n  border: 0;\n  background: transparent;\n  padding: 0;\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: zoom-in;\n}\n\n.ofs-image {\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  display: block;\n  border-radius: 10px;\n}\n\n.ofs-meta {\n  position: absolute;\n  top: 14px;\n  left: 50%;\n  transform: translateX(-50%);\n  display: inline-flex;\n  align-items: center;\n  gap: 9px;\n  padding: 6px 15px;\n  border-radius: 999px;\n  background: rgb(17 20 28 / 58%);\n  color: #f7f8fb;\n  font-size: 11.5px;\n  letter-spacing: 0.01em;\n  backdrop-filter: blur(10px) saturate(140%);\n  white-space: nowrap;\n}\n\n.ofs-meta span[aria-hidden=\"true\"] { opacity: 0.45; }\n\n.ofs-dock {\n  display: flex;\n  justify-content: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.ofs-dock-button {\n  appearance: none;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12.5px;\n  padding: 8px 16px;\n  cursor: pointer;\n  box-shadow: 0 1px 2px rgb(16 24 40 / 5%);\n  transition: border-color 140ms ease, color 140ms ease, transform 120ms ease;\n}\n\n.ofs-dock-button:hover {\n  border-color: var(--ofs-brand);\n  color: var(--ofs-brand);\n  transform: translateY(-1px);\n}\n\n.ofs-stage-prompt {\n  margin: 0;\n  font-size: 11.5px;\n  color: var(--ofs-text-3);\n  text-align: center;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-stage-progress {\n  display: grid;\n  gap: 6px;\n  font-size: 11.5px;\n  color: var(--ofs-text-2);\n}\n\n.ofs-progress-label { justify-self: start; }\n\n.ofs-shimmer {\n  position: relative;\n  display: block;\n  width: 100%;\n  height: 3px;\n  border-radius: 999px;\n  background: var(--ofs-line);\n  overflow: hidden;\n}\n\n.ofs-shimmer::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  width: 40%;\n  border-radius: 999px;\n  background: var(--ofs-brand);\n  animation: ofs-slide 1.4s ease-in-out infinite;\n}\n\n@keyframes ofs-slide {\n  0% { transform: translateX(-120%); }\n  100% { transform: translateX(340%); }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-shimmer::after { animation: none; width: 45%; }\n}\n\n.ofs-empty {\n  display: grid;\n  justify-items: center;\n  gap: 8px;\n  padding: 32px;\n  text-align: center;\n  color: var(--ofs-text-2);\n  font-size: 13px;\n}\n\n.ofs-empty p { margin: 0; }\n\n.ofs-empty-glyph {\n  font-size: 34px;\n  line-height: 1;\n  color: var(--ofs-brand);\n  opacity: 0.32;\n}\n\n.ofs-muted { color: var(--ofs-text-3); font-size: 11.5px; }\n.ofs-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }\n\n.ofs-link {\n  appearance: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-brand);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 0 4px;\n  cursor: pointer;\n}\n\n.ofs-lightbox {\n  position: fixed;\n  inset: 0;\n  z-index: 60;\n  display: grid;\n  place-items: center;\n  padding: 32px;\n  background: rgb(9 11 16 / 82%);\n  backdrop-filter: blur(6px);\n  cursor: zoom-out;\n}\n\n.ofs-lightbox img {\n  max-width: 94vw;\n  max-height: 88vh;\n  object-fit: contain;\n  border-radius: 10px;\n  cursor: default;\n  box-shadow: 0 30px 80px rgb(0 0 0 / 45%);\n}\n\n/* ── 胶卷流 ─────────────────────────────────────────────────── */\n.ofs-filmstrip {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin: 12px 22px 18px;\n  padding: 12px 14px;\n  height: 132px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius-lg);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  overflow: hidden;\n}\n\n.ofs-ghost {\n  position: relative;\n  flex: 0 0 auto;\n  display: grid;\n  align-content: center;\n  justify-items: center;\n  gap: 5px;\n  width: 128px;\n  height: 96px;\n  padding: 8px;\n  border: 1px dashed var(--ofs-line-strong);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-sunken);\n  color: var(--ofs-text-2);\n  font-size: 10.5px;\n  text-align: center;\n  overflow: hidden;\n}\n\n.ofs-ghost-bar {\n  position: absolute;\n  inset: 0;\n  background: linear-gradient(110deg, transparent 20%, rgb(255 255 255 / 55%) 50%, transparent 80%);\n  animation: ofs-sweep 1.6s linear infinite;\n}\n\n@keyframes ofs-sweep {\n  0% { transform: translateX(-100%); }\n  100% { transform: translateX(100%); }\n}\n\n.ofs-ghost-label { position: relative; line-height: 1.35; }\n.ofs-ghost-time { position: relative; color: var(--ofs-text-3); }\n\n.ofs-roll {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n  overflow-x: auto;\n  overflow-y: hidden;\n  padding: 2px;\n}\n\n.ofs-batch {\n  flex: 0 0 auto;\n  display: grid;\n  gap: 5px;\n  padding: 5px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-sunken);\n}\n\n.ofs-batch-thumbs { display: flex; gap: 4px; }\n\n.ofs-thumb {\n  appearance: none;\n  flex: 0 0 auto;\n  padding: 0;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n  cursor: pointer;\n  overflow: hidden;\n  line-height: 0;\n  transition: border-color 140ms ease, transform 120ms ease;\n}\n\n.ofs-thumb img {\n  width: 84px;\n  height: 84px;\n  object-fit: cover;\n  display: block;\n  border-radius: 8px;\n}\n\n.ofs-thumb:hover { transform: translateY(-1px); }\n\n.ofs-thumb.is-on {\n  border-color: var(--ofs-brand);\n  box-shadow: 0 0 0 2px color-mix(in oklab, var(--ofs-brand) 30%, transparent);\n}\n\n.ofs-batch-meta {\n  display: flex;\n  justify-content: space-between;\n  gap: 6px;\n  padding: 0 2px;\n  font-size: 10px;\n  color: var(--ofs-text-3);\n}\n\n.ofs-batch-meta em {\n  font-style: normal;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-filmstrip-empty { margin: 0; }\n\n/* ── 画廊 ───────────────────────────────────────────────────── */\n.ofs-gallery {\n  flex: 1 1 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  min-height: 0;\n  padding: 18px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius-lg);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  overflow-y: auto;\n}\n\n.ofs-gallery-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }\n\n.ofs-gallery-bar h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }\n\n.ofs-search {\n  box-sizing: border-box;\n  width: 210px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12px;\n  padding: 6px 13px;\n}\n\n.ofs-search:focus {\n  outline: none;\n  background: var(--ofs-card);\n  border-color: var(--ofs-brand);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-brand) 16%, transparent);\n}\n\n.ofs-gallery-group { display: grid; gap: 10px; }\n\n.ofs-gallery-group h4 {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.06em;\n  color: var(--ofs-text-3);\n  text-transform: uppercase;\n}\n\n.ofs-gallery-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));\n  gap: 14px;\n}\n\n.ofs-gallery-card {\n  appearance: none;\n  position: relative;\n  display: grid;\n  gap: 6px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  min-width: 0;\n}\n\n.ofs-gallery-card img {\n  width: 100%;\n  aspect-ratio: 1;\n  object-fit: cover;\n  border-radius: var(--ofs-radius);\n  border: 1px solid var(--ofs-line);\n  display: block;\n  transition: transform 160ms ease, box-shadow 160ms ease;\n}\n\n.ofs-gallery-card:hover img {\n  transform: translateY(-2px);\n  box-shadow: 0 14px 30px -18px rgb(16 24 40 / 55%);\n}\n\n.ofs-gallery-card.is-picked img {\n  border-color: var(--ofs-brand);\n  box-shadow: 0 0 0 2px var(--ofs-brand);\n}\n\n.ofs-gallery-caption {\n  font-size: 11.5px;\n  color: var(--ofs-text-2);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  line-height: 1.5;\n}\n\n.ofs-gallery-tags { display: flex; gap: 7px; font-size: 10px; color: var(--ofs-text-3); }\n.ofs-gallery-tags em { font-style: normal; }\n\n.ofs-gallery-star {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  font-size: 12px;\n  line-height: 1;\n  filter: drop-shadow(0 1px 3px rgb(0 0 0 / 45%));\n}\n\n.ofs-gallery-check {\n  position: absolute;\n  top: 8px;\n  left: 8px;\n  width: 15px;\n  height: 15px;\n  border-radius: 5px;\n  border: 1.5px solid #fff;\n  background: rgb(0 0 0 / 30%);\n}\n\n.ofs-gallery-check.is-on { background: var(--ofs-brand); border-color: var(--ofs-brand); }\n\n.ofs-gallery-empty { margin: 0; }\n\n/* ── 通用小控件 ─────────────────────────────────────────────── */\n.ofs-chip {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 5px 12px;\n  cursor: pointer;\n  white-space: nowrap;\n  text-decoration: none;\n  transition: border-color 140ms ease, color 140ms ease, background 140ms ease;\n}\n\n.ofs-chip:hover:not(:disabled) { border-color: var(--ofs-line-strong); color: var(--ofs-text); }\n.ofs-chip.is-on { border-color: transparent; background: var(--ofs-brand-soft); color: var(--ofs-brand); font-weight: 550; }\n.ofs-chip.is-danger { border-color: color-mix(in oklab, var(--ofs-error) 40%, var(--ofs-line)); color: var(--ofs-error); }\n.ofs-chip:disabled { opacity: 0.42; cursor: default; }\n\n/* ── 错误与指引 ─────────────────────────────────────────────── */\n.ofs-error,\n.ofs-guidance {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 14px;\n  border-radius: var(--ofs-radius);\n  font-size: 12px;\n}\n\n.ofs-error {\n  justify-content: space-between;\n  border: 1px solid color-mix(in oklab, var(--ofs-error) 35%, var(--ofs-line));\n  background: color-mix(in oklab, var(--ofs-error) 8%, var(--ofs-card));\n}\n\n.ofs-error button {\n  appearance: none;\n  border: 1px solid color-mix(in oklab, var(--ofs-error) 30%, var(--ofs-line));\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-error);\n  font: inherit;\n  font-size: 11px;\n  padding: 4px 11px;\n  cursor: pointer;\n}\n\n.ofs-guidance {\n  align-items: flex-start;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 32%, var(--ofs-line));\n  background: color-mix(in oklab, var(--ofs-warn) 7%, var(--ofs-card));\n}\n\n.ofs-guidance-icon { font-size: 14px; line-height: 1.4; }\n\n.ofs-guidance-body { display: grid; gap: 8px; min-width: 0; }\n\n.ofs-guidance-title { margin: 0; font-size: 12.5px; line-height: 1.55; }\n\n.ofs-guidance-actions { display: flex; gap: 7px; flex-wrap: wrap; }\n\n/* ── Toast ──────────────────────────────────────────────────── */\n.ofs-toast {\n  position: fixed;\n  right: 26px;\n  bottom: 26px;\n  z-index: 80;\n  max-width: 340px;\n  padding: 10px 16px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-text);\n  color: var(--ofs-card);\n  font-size: 12.5px;\n  box-shadow: var(--ofs-shadow-pop);\n  animation: ofs-toast-in 180ms ease-out;\n}\n\n@keyframes ofs-toast-in {\n  from { opacity: 0; transform: translateY(6px); }\n  to { opacity: 1; transform: none; }\n}\n\n/* ── 窄屏 ───────────────────────────────────────────────────── */\n@media (max-width: 1040px) {\n  .ofs-body { grid-template-columns: 300px minmax(0, 1fr); }\n  .ofs-search { width: 140px; }\n}\n\n@media (max-width: 860px) {\n  .ofs-shell { padding: 6px 14px 0; }\n  .ofs-body { grid-template-columns: minmax(0, 1fr); }\n  .ofs-rail { max-height: 42vh; }\n  .ofs-filmstrip { margin: 10px 14px 14px; height: 116px; }\n  .ofs-thumb img { width: 72px; height: 72px; }\n}\n\n/* 灵感卡底部：次要折叠项与主按钮成组，避免卡片中间出现空洞 */\n.ofs-rail-foot {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  margin-top: auto;\n  padding-top: 12px;\n  border-top: 1px solid var(--ofs-line);\n}\n\n.ofs-rail-foot .ofs-generate { margin-top: 0; }\n\n\n/* ── 空状态卡片 ─────────────────────────────────────────────── */\n.ofs-figure--empty { justify-content: center; align-items: center; }\n\n.ofs-empty-card {\n  display: grid;\n  justify-items: center;\n  gap: 9px;\n  padding: 32px 28px;\n  text-align: center;\n  max-width: 680px;\n}\n\n.ofs-empty-title {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  letter-spacing: -0.01em;\n  color: var(--ofs-text);\n}\n\n.ofs-empty-card .ofs-muted { font-size: 12px; }\n\n.ofs-examples {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: center;\n  gap: 7px;\n  margin-top: 6px;\n}\n\n.ofs-example {\n  appearance: none;\n  border: 1px dashed var(--ofs-line-strong);\n  border-radius: 999px;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 6px 13px;\n  cursor: pointer;\n  transition: border-color 140ms ease, color 140ms ease;\n}\n\n.ofs-example:hover { border-style: solid; border-color: var(--ofs-brand); color: var(--ofs-brand); }\n\n/* ── 胶卷流空态占位 ─────────────────────────────────────────── */\n.ofs-filmstrip-empty {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  min-width: 0;\n}\n\n.ofs-slots { display: flex; gap: 8px; }\n\n.ofs-slot {\n  display: block;\n  width: 84px;\n  height: 84px;\n  border-radius: var(--ofs-radius);\n  border: 1px dashed var(--ofs-line-strong);\n  background: linear-gradient(180deg, transparent, color-mix(in oklab, var(--ofs-sunken) 70%, transparent));\n  opacity: 0.75;\n}\n\n\n\n/* ══ 左侧创作面板（表单式） ══════════════════════════════════ */\n.ofs-rail-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  padding-bottom: 12px;\n  border-bottom: 1px solid var(--ofs-line);\n}\n\n.ofs-rail-head h2 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  letter-spacing: -0.01em;\n}\n\n.ofs-mode {\n  display: inline-flex;\n  gap: 2px;\n  padding: 2px;\n  border-radius: 999px;\n  background: var(--ofs-sunken);\n  border: 1px solid var(--ofs-line);\n}\n\n.ofs-mode button {\n  appearance: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 4px 12px;\n  border-radius: 999px;\n  cursor: pointer;\n}\n\n.ofs-mode button.is-on {\n  background: var(--ofs-card);\n  color: var(--ofs-text);\n  font-weight: 550;\n  box-shadow: 0 1px 3px rgb(16 24 40 / 12%);\n}\n\n.ofs-rail-scroll {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  overflow-x: hidden;\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  padding: 4px 2px 8px;\n  margin-right: -4px;\n}\n\n.ofs-fieldset { display: flex; flex-direction: column; gap: 10px; }\n\n.ofs-fieldset-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-fieldset-head h3 {\n  margin: 0;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  font-weight: 600;\n  letter-spacing: -0.005em;\n  color: var(--ofs-text);\n}\n\n.ofs-num {\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--ofs-text-3);\n  letter-spacing: 0.04em;\n}\n\n.ofs-text-action {\n  appearance: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11.5px;\n  padding: 2px 0;\n  cursor: pointer;\n}\n\n.ofs-text-action:hover:not(:disabled) { color: var(--ofs-brand); }\n.ofs-text-action:disabled { opacity: 0.5; cursor: default; }\n\n.ofs-composer {\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;\n}\n\n.ofs-composer:focus-within {\n  border-color: var(--ofs-brand);\n  background: var(--ofs-card);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-brand) 16%, transparent);\n}\n\n.ofs-composer-input {\n  box-sizing: border-box;\n  display: block;\n  width: 100%;\n  min-height: 132px;\n  resize: vertical;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.65;\n  padding: 12px 13px 6px;\n}\n\n.ofs-composer-input:focus { outline: none; }\n.ofs-composer-input::placeholder { color: var(--ofs-text-3); }\n\n.ofs-composer-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 6px 11px 8px;\n}\n\n.ofs-counter { font-size: 10.5px; color: var(--ofs-text-3); font-variant-numeric: tabular-nums; }\n\n.ofs-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }\n\n.ofs-suggestion {\n  appearance: none;\n  max-width: 100%;\n  border: 1px solid var(--ofs-line);\n  border-radius: 999px;\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 11px;\n  padding: 5px 11px;\n  cursor: pointer;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  transition: border-color 140ms ease, color 140ms ease;\n}\n\n.ofs-suggestion:hover { border-color: var(--ofs-brand); color: var(--ofs-brand); }\n\n/* 风格tile */\n.ofs-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }\n\n.ofs-tile {\n  appearance: none;\n  display: grid;\n  justify-items: center;\n  gap: 5px;\n  padding: 10px 4px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  cursor: pointer;\n  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;\n}\n\n.ofs-tile:hover { border-color: var(--ofs-line-strong); color: var(--ofs-text); }\n\n.ofs-tile.is-on {\n  border-color: var(--ofs-brand);\n  background: var(--ofs-brand-soft);\n  color: var(--ofs-brand);\n}\n\n.ofs-tile-icon { font-size: 15px; line-height: 1; }\n.ofs-tile-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }\n.ofs-tile-label { font-size: 11.5px; }\n\n/* 比例 */\n.ofs-ratio-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }\n\n.ofs-ratio {\n  appearance: none;\n  display: grid;\n  justify-items: center;\n  gap: 7px;\n  padding: 12px 6px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  cursor: pointer;\n  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;\n}\n\n.ofs-ratio.is-on { border-color: var(--ofs-brand); background: var(--ofs-brand-soft); color: var(--ofs-brand); }\n.ofs-ratio-label { font-size: 11px; }\n\n/* 高级设置行 */\n.ofs-rows {\n  display: flex;\n  flex-direction: column;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-card);\n  overflow: hidden;\n}\n\n.ofs-row + .ofs-row { border-top: 1px solid var(--ofs-line); }\n\n.ofs-row-head {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 12px;\n  padding: 11px 12px;\n  cursor: pointer;\n  text-align: left;\n}\n\n.ofs-row-head:hover { background: var(--ofs-sunken); color: var(--ofs-text); }\n.ofs-chevron { color: var(--ofs-text-3); font-size: 11px; }\n\n.ofs-row-textarea {\n  box-sizing: border-box;\n  width: 100%;\n  resize: vertical;\n  border: 1px solid var(--ofs-line);\n  border-radius: 9px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12px;\n  line-height: 1.6;\n  padding: 8px 10px;\n  margin: 0 12px 12px;\n  width: calc(100% - 24px);\n}\n\n.ofs-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; padding: 0 12px 12px; }\n\n.ofs-rail-bottom {\n  padding-top: 12px;\n  border-top: 1px solid var(--ofs-line);\n  display: grid;\n  gap: 6px;\n}\n\n.ofs-rail-bottom .ofs-generate { margin-top: 0; }\n\n/* ══ 对话式面板 ══════════════════════════════════════════════ */\n.ofs-thread {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding: 2px 2px 6px;\n}\n\n.ofs-thread-empty { display: grid; gap: 10px; color: var(--ofs-text-2); font-size: 12px; }\n.ofs-thread-empty p { margin: 0; }\n\n.ofs-msg { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }\n\n.ofs-msg p { margin: 0; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }\n\n.ofs-msg--user {\n  align-self: flex-end;\n  max-width: 92%;\n  padding: 9px 13px;\n  border-radius: 14px 14px 4px 14px;\n  background: var(--ofs-brand);\n  color: #fff;\n}\n\n.ofs-msg--user p { color: inherit; }\n\n.ofs-msg--assistant {\n  align-self: flex-start;\n  max-width: 96%;\n  padding: 10px 13px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 14px 14px 14px 4px;\n  background: var(--ofs-sunken);\n}\n\n.ofs-msg-head {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 10.5px;\n  color: var(--ofs-text-3);\n}\n\n.ofs-msg-avatar { color: var(--ofs-brand); }\n\n.ofs-msg-thumb {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 2px;\n  padding: 4px;\n  border: 1px solid var(--ofs-line);\n  border-radius: 10px;\n  background: var(--ofs-card);\n  color: var(--ofs-text-2);\n  font: inherit;\n  font-size: 10.5px;\n  cursor: pointer;\n  text-align: left;\n}\n\n.ofs-msg-thumb img { width: 52px; height: 52px; object-fit: cover; border-radius: 7px; display: block; }\n\n.ofs-thread-suggestions { display: flex; gap: 6px; flex-wrap: wrap; }\n\n.ofs-quick { display: flex; gap: 6px; flex-wrap: wrap; }\n\n.ofs-chat-composer {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  padding: 8px;\n  border: 1px solid var(--ofs-line);\n  border-radius: var(--ofs-radius);\n  background: var(--ofs-sunken);\n}\n\n.ofs-chat-composer:focus-within {\n  border-color: var(--ofs-brand);\n  background: var(--ofs-card);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-brand) 16%, transparent);\n}\n\n.ofs-chat-composer textarea {\n  flex: 1 1 auto;\n  min-width: 0;\n  resize: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-text);\n  font: inherit;\n  font-size: 12.5px;\n  line-height: 1.55;\n  padding: 4px 2px;\n}\n\n.ofs-chat-composer textarea:focus { outline: none; }\n.ofs-chat-composer textarea::placeholder { color: var(--ofs-text-3); }\n\n.ofs-chat-send {\n  appearance: none;\n  flex: 0 0 auto;\n  width: 32px;\n  height: 32px;\n  border: 0;\n  border-radius: 50%;\n  background: var(--ofs-text);\n  color: var(--ofs-card);\n  font-size: 15px;\n  line-height: 1;\n  cursor: pointer;\n}\n\n.ofs-chat-send:disabled { opacity: 0.35; cursor: default; }\n\n/* ══ 暗色兜底（宿主变量缺失时生效；DSH 提供变量时以宿主为准） ══ */\n@media (prefers-color-scheme: dark) {\n  .ofs-root {\n    --ofs-card: var(--dsw-alias-bg-layer-1, #1b1e26);\n    --ofs-sunken: var(--dsw-alias-bg-layer-2, #22262f);\n    --ofs-line: var(--dsw-alias-border-l1, #313643);\n    --ofs-line-strong: color-mix(in oklab, var(--ofs-line) 78%, #fff 22%);\n    --ofs-text: var(--dsw-alias-label-primary, #e9ecf2);\n    --ofs-text-2: var(--dsw-alias-label-secondary, #a2a9ba);\n    --ofs-text-3: color-mix(in oklab, var(--ofs-text-2) 68%, transparent);\n    background:\n      radial-gradient(900px 420px at 4% -8%, rgb(99 102 241 / 16%), transparent 62%),\n      radial-gradient(760px 400px at 102% -4%, rgb(14 165 233 / 12%), transparent 58%),\n      var(--dsw-alias-bg-canvas, #14161c);\n    --ofs-shadow-card: 0 1px 2px rgb(0 0 0 / 30%), 0 14px 32px -20px rgb(0 0 0 / 60%);\n    --ofs-shadow-pop: 0 20px 50px -18px rgb(0 0 0 / 70%);\n  }\n\n  .ofs-msg--user { background: color-mix(in oklab, var(--ofs-brand) 72%, #000 28%); }\n  .ofs-tabs button.is-on,\n  .ofs-mode button.is-on { box-shadow: 0 1px 3px rgb(0 0 0 / 45%); }\n  .ofs-meta { background: rgb(8 10 14 / 66%); }\n}\n\n/* ══ 响应式 ══════════════════════════════════════════════════ */\n@media (max-width: 1180px) {\n  .ofs-body { grid-template-columns: 320px minmax(0, 1fr); }\n}\n\n@media (max-width: 980px) {\n  .ofs-shell { padding: 6px 14px 0; }\n  .ofs-body {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-rows: minmax(0, auto) minmax(0, 1fr);\n    gap: 12px;\n  }\n  .ofs-rail { max-height: 44vh; }\n  .ofs-rail-scroll { gap: 16px; }\n  .ofs-filmstrip { margin: 10px 14px 14px; height: 112px; }\n  .ofs-thumb img { width: 76px; height: 76px; }\n  .ofs-topbar { padding: 12px 14px 4px; gap: 8px; }\n  .ofs-preset span:first-child { display: none; }\n}\n\n@media (max-width: 720px) {\n  .ofs-tiles { grid-template-columns: 1fr 1fr; }\n  .ofs-preset select { max-width: 150px; }\n  .ofs-tabs button { padding: 5px 12px; }\n}\n\n/* 面板滚动可见性：细滚动条 + 底部渐隐，提示还有内容 */\n.ofs-rail { position: relative; }\n.ofs-rail-scroll { scrollbar-width: thin; scrollbar-color: var(--ofs-line-strong) transparent; }\n.ofs-rail-scroll::-webkit-scrollbar { width: 6px; }\n.ofs-rail-scroll::-webkit-scrollbar-thumb { background: var(--ofs-line-strong); border-radius: 3px; }\n.ofs-rail-scroll::-webkit-scrollbar-track { background: transparent; }\n.ofs-rail::after {\n  content: '';\n  position: absolute;\n  left: 1px;\n  right: 1px;\n  bottom: 78px;\n  height: 22px;\n  pointer-events: none;\n  background: linear-gradient(to bottom, transparent, var(--ofs-card));\n  border-radius: 0 0 var(--ofs-radius-lg) var(--ofs-radius-lg);\n}\n.ofs-composer-input { min-height: 118px; }\r\n\n/* 对话面板空态：整块居中，建议项占满宽度便于阅读 */\n.ofs-thread.is-empty { justify-content: center; }\n.ofs-thread-empty { text-align: left; }\n.ofs-thread-empty .ofs-suggestion {\n  display: block;\n  width: 100%;\n  border-radius: 10px;\n  padding: 9px 12px;\n  white-space: normal;\n  line-height: 1.5;\n  text-align: left;\n}\n.ofs-quick { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }\n.ofs-quick::-webkit-scrollbar { display: none; }\n.ofs-quick .ofs-chip { flex: 0 0 auto; }\r\n";

// src/hooks/useNow.js
function useNow(enabled) {
  const [now, setNow] = import_react.default.useState(() => Date.now());
  import_react.default.useEffect(() => {
    if (!enabled) return void 0;
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

// src/logic/format.js
function formatDuration(t, ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "—";
  const seconds = Math.max(0, value) / 1e3;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}${t("unit.second")}`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}${t("unit.min")} ${rest}${t("unit.second")}` : `${minutes}${t("unit.min")}`;
}
function formatSeconds(t, seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${t("unit.second")}`;
}
function jobElapsed(job, now) {
  if (!job) return null;
  if (job.status === "done" || job.status === "failed") {
    const seconds = Number(job.seconds);
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1e3;
    const start2 = Date.parse(job.startedAt ?? job.createdAt ?? "");
    const end = Date.parse(job.finishedAt ?? "");
    if (Number.isFinite(start2) && Number.isFinite(end)) return Math.max(0, end - start2);
    return null;
  }
  const start = Date.parse(job.startedAt ?? job.createdAt ?? "");
  return Number.isFinite(start) ? Math.max(0, now - start) : null;
}

// src/studio/ChatPanel.jsx
var import_react2 = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
function ChatPanel(props) {
  const {
    t,
    form,
    patchForm,
    sending,
    onGenerate,
    messages,
    onReroll,
    onIterate,
    onClearThread,
    hasSelection,
    mode,
    setMode,
    onEnhance,
    enhancing,
    suggestions,
    onApplySuggestion
  } = props;
  const [draft, setDraft] = import_react2.default.useState("");
  const threadRef = import_react2.default.useRef(null);
  import_react2.default.useEffect(() => {
    const node = threadRef.current;
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight });
  }, [messages.length]);
  function send() {
    const text = draft.trim();
    if (!text) return;
    patchForm({ prompt: text });
    setDraft("");
    onGenerate(text);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { className: "ofs-rail ofs-rail--chat", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "ofs-rail-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("studio.rail.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-mode", role: "tablist", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "form",
            className: mode === "form" ? "is-on" : "",
            onClick: () => setMode("form"),
            children: t("studio.rail.modeForm")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "chat",
            className: mode === "chat" ? "is-on" : "",
            onClick: () => setMode("chat"),
            children: t("studio.rail.modeChat")
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: messages.length === 0 ? "ofs-thread is-empty" : "ofs-thread", ref: threadRef, children: [
      messages.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-thread-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("studio.chat.empty") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ofs-suggestions", children: ["studio.example.1", "studio.example.2", "studio.example.3"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-suggestion",
            onClick: () => {
              patchForm({ prompt: t(key) });
              setDraft(t(key));
            },
            children: t(key)
          },
          key
        )) })
      ] }) : null,
      messages.map(
        (message) => message.role === "user" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ofs-msg ofs-msg--user", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: message.text }) }, message.id) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-msg ofs-msg--assistant", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-msg-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ofs-msg-avatar", "aria-hidden": "true", children: "✧" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("studio.chat.assistant") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: message.text }),
          message.image ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "ofs-msg-thumb", onClick: message.onOpen, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: message.image, alt: "", loading: "lazy" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: message.meta })
          ] }) : null
        ] }, message.id)
      )
    ] }),
    suggestions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ofs-thread-suggestions", children: suggestions.slice(0, 3).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "ofs-suggestion",
        onClick: () => onApplySuggestion(entry.text),
        title: entry.text,
        children: entry.text
      },
      entry.id
    )) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-quick", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ofs-chip", onClick: onEnhance, disabled: enhancing, children: enhancing ? t("studio.enhance.thinking") : `✨ ${t("studio.enhance.button")}` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ofs-chip", onClick: onReroll, children: t("studio.action.reroll") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ofs-chip", onClick: onIterate, disabled: !hasSelection, children: t("studio.action.iterate") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ofs-chip", onClick: onClearThread, disabled: messages.length === 0, children: t("studio.chat.clear") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ofs-chat-composer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          rows: 2,
          value: draft,
          maxLength: 2e3,
          placeholder: t("studio.chat.placeholder"),
          spellCheck: false,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ofs-chat-send", onClick: send, disabled: sending || draft.trim().length === 0, "aria-label": t("studio.generate"), children: "↑" })
    ] })
  ] });
}

// src/studio/Filmstrip.jsx
var import_react3 = __toESM(require("react"), 1);
var import_jsx_runtime2 = require("react/jsx-runtime");
function Filmstrip(props) {
  const {
    t,
    batches,
    activeJob,
    selected,
    onSelect,
    elapsedMs,
    onSessionStart,
    sessionState,
    sessionQueued
  } = props;
  const selectedPath = selected && selected.image ? selected.image.path : "";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("footer", { className: "ofs-filmstrip", children: [
    activeJob ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-ghost", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-ghost-bar", "aria-hidden": "true" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-ghost-label", children: sessionQueued ? t("studio.ghost.queued") : t("studio.ghost.rendering") }),
      formatDuration(t, elapsedMs) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-ghost-time", children: formatDuration(t, elapsedMs) }) : null
    ] }) : null,
    batches.length === 0 && !activeJob ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-filmstrip-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-slots", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-slot" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-slot" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-slot" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "ofs-muted", children: [
        sessionState === "absent" ? t("studio.filmstrip.offline") : t("studio.filmstrip.empty"),
        sessionState === "absent" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ofs-link", onClick: onSessionStart, children: t("studio.compute.start") }) : null
      ] })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-roll", children: batches.map((batch) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-batch", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-batch-thumbs", children: batch.entries.map((entry) => {
        const path = entry.image.path || entry.image.file;
        const active = path === selectedPath;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            className: active ? "ofs-thumb is-on" : "ofs-thumb",
            onClick: () => onSelect(entry),
            title: batch.prompt || path,
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: entry.image.url, alt: entry.image.file || "thumb", loading: "lazy" })
          },
          path
        );
      }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "ofs-batch-meta", children: [
        batch.presetId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("em", { children: batch.presetId }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: batch.entries.length })
      ] })
    ] }, batch.key)) })
  ] });
}

// src/studio/Gallery.jsx
var import_react4 = __toESM(require("react"), 1);
var import_jsx_runtime3 = require("react/jsx-runtime");
var DAY = 24 * 60 * 60 * 1e3;
function bucketOf(time, now) {
  if (!Number.isFinite(time)) return "earlier";
  const diff = now - time;
  if (diff < DAY) return "today";
  if (diff < 7 * DAY) return "week";
  return "earlier";
}
function Gallery(props) {
  const { t, gallery, now, onOpen, favorites, onDelete, onExport } = props;
  const [presetFilter, setPresetFilter] = import_react4.default.useState("");
  const [favoriteOnly, setFavoriteOnly] = import_react4.default.useState(false);
  const [selecting, setSelecting] = import_react4.default.useState(false);
  const [picked, setPicked] = import_react4.default.useState([]);
  const [confirming, setConfirming] = import_react4.default.useState(false);
  const [keyword, setKeyword] = import_react4.default.useState("");
  const favoriteSet = new Set(favorites ?? []);
  const groups = { today: [], week: [], earlier: [] };
  for (const entry of gallery) {
    if (presetFilter && entry.item.presetId !== presetFilter) continue;
    const key = entry.image.path || entry.image.file;
    if (favoriteOnly && !favoriteSet.has(key)) continue;
    if (keyword.trim()) {
      const needle = keyword.trim().toLowerCase();
      const haystack = [entry.item.prompt, entry.item.presetId, entry.item.jobId, key].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const time = Date.parse(entry.item.finishedAt || entry.item.createdAt || entry.item.mtime || "");
    groups[bucketOf(time, now)].push(entry);
  }
  const usedPresets = [...new Set(gallery.map((entry) => entry.item.presetId).filter(Boolean))];
  const visibleCount = groups.today.length + groups.week.length + groups.earlier.length;
  const visiblePaths = ["today", "week", "earlier"].flatMap(
    (bucket) => groups[bucket].map((entry) => entry.image.path || entry.image.file)
  );
  function togglePick(key) {
    setPicked((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }
  function exitSelect() {
    setSelecting(false);
    setPicked([]);
    setConfirming(false);
  }
  async function confirmDelete() {
    if (picked.length === 0) return;
    await onDelete(picked);
    exitSelect();
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "ofs-gallery", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-gallery-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: t("studio.gallery.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "input",
        {
          className: "ofs-search",
          type: "search",
          value: keyword,
          placeholder: t("studio.gallery.search"),
          onChange: (event) => setKeyword(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-grow" }),
      usedPresets.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: presetFilter, onChange: (event) => setPresetFilter(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: t("studio.gallery.allPresets") }),
        usedPresets.map((id) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: id, children: id }, id))
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "button",
        {
          type: "button",
          className: favoriteOnly ? "ofs-chip is-on" : "ofs-chip",
          onClick: () => setFavoriteOnly((value) => !value),
          children: [
            "⭐ ",
            t("studio.gallery.favoriteOnly")
          ]
        }
      ),
      selecting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ofs-muted", children: [
          t("studio.gallery.selectedCount"),
          " ",
          picked.length
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip", onClick: exitSelect, children: t("studio.gallery.cancel") }),
        confirming ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip is-danger", onClick: confirmDelete, disabled: picked.length === 0, children: t("studio.gallery.confirmDelete") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip is-danger",
            onClick: () => setConfirming(true),
            disabled: picked.length === 0,
            children: t("studio.gallery.delete")
          }
        )
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip", onClick: () => setSelecting(true), disabled: gallery.length === 0, children: t("studio.gallery.select") }),
      selecting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-chip",
          onClick: () => onExport(picked.length > 0 ? picked : visiblePaths),
          disabled: picked.length === 0 && visiblePaths.length === 0,
          children: t("studio.gallery.export")
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-muted", children: visibleCount })
    ] }),
    visibleCount === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-muted ofs-gallery-empty", children: t("studio.gallery.empty") }) : null,
    ["today", "week", "earlier"].map((bucket) => {
      const entries = groups[bucket];
      if (entries.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-gallery-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: t(`studio.gallery.${bucket}`) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-gallery-grid", children: entries.map((entry) => {
          const key = entry.image.path || entry.image.file;
          const checked = picked.includes(key);
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: checked ? "ofs-gallery-card is-picked" : "ofs-gallery-card",
              onClick: () => selecting ? togglePick(key) : onOpen(entry),
              title: entry.item.prompt || key,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { src: entry.image.url, alt: entry.image.file || "thumb", loading: "lazy" }),
                favoriteSet.has(key) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-gallery-star", children: "⭐" }) : null,
                selecting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: checked ? "ofs-gallery-check is-on" : "ofs-gallery-check" }) : null,
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-gallery-caption", children: entry.item.prompt || "—" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ofs-gallery-tags", children: [
                  entry.item.presetId ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", { children: entry.item.presetId }) : null,
                  entry.image.seed != null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                    "#",
                    entry.image.seed
                  ] }) : null
                ] })
              ]
            },
            key
          );
        }) })
      ] }, bucket);
    })
  ] });
}

// src/studio/GuidanceCard.jsx
var import_react5 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
var KAGGLE_SETTINGS = "https://www.kaggle.com/settings";
function guidanceKindOf(code) {
  if (!code) return "";
  if (code === "oom") return "oom";
  if (code === "session_ended" || code === "stopped") return "sleep";
  if (code === "auth_required" || code === "cli_missing") return "auth";
  if (code === "need_prompt") return "";
  return "generic";
}
function GuidanceCard(props) {
  const { t, kind, onReset, onWake, onRecheck, onRetry } = props;
  if (!kind) return null;
  const presets = {
    oom: { title: t("studio.guidance.oom.title"), action: t("studio.guidance.oom.action"), run: onReset },
    sleep: { title: t("studio.guidance.sleep.title"), action: t("studio.guidance.sleep.action"), run: onWake },
    auth: { title: t("studio.guidance.auth.title"), action: t("studio.guidance.auth.action"), href: KAGGLE_SETTINGS },
    generic: { title: t("studio.guidance.generic.title"), action: t("studio.guidance.generic.action"), run: onRetry }
  };
  const preset = presets[kind] ?? presets.generic;
  const secondary = kind === "auth" ? t("studio.guidance.cli.action") : "";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-guidance", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-guidance-icon", "aria-hidden": "true", children: "⚠️" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-guidance-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "ofs-guidance-title", children: preset.title }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-guidance-actions", children: [
        preset.href ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { className: "ofs-chip is-on", href: preset.href, target: "_blank", rel: "noreferrer noopener", children: preset.action }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ofs-chip is-on", onClick: preset.run, children: preset.action }),
        secondary && onRecheck ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ofs-chip", onClick: onRecheck, children: secondary }) : null
      ] })
    ] })
  ] });
}

// src/studio/Rail.jsx
var import_react6 = __toESM(require("react"), 1);

// src/studio/capsules.js
var STYLE_CAPSULES = [
  {
    id: "film",
    icon: "📷",
    zh: "真实胶片",
    en: "Cinematic Film",
    suffix: "cinematic film photography, 35mm, natural skin texture, soft grain",
    negative: "blurry, low quality, distorted, text, watermark"
  },
  {
    id: "concept",
    icon: "🎨",
    zh: "概念原画",
    en: "Concept Art",
    suffix: "concept art, painterly, dramatic lighting, detailed brushwork",
    negative: "photo, blurry, low quality, text, watermark"
  },
  {
    id: "cyberpunk",
    icon: "🌆",
    zh: "赛博霓虹",
    en: "Cyberpunk",
    suffix: "cyberpunk neon city, volumetric light, reflective surfaces, night atmosphere",
    negative: "daylight, blurry, low quality, deformed, text"
  },
  {
    id: "ink",
    icon: "🖌️",
    zh: "东方水墨",
    en: "Ink Wash",
    suffix: "traditional chinese ink wash painting, rice paper texture, negative space",
    negative: "photo, 3d, saturated colors, blurry, text"
  },
  {
    id: "clay",
    icon: "🧸",
    zh: "3D 黏土",
    en: "Cute Clay",
    suffix: "clay render, soft studio light, pastel palette, playful proportions",
    negative: "photo, harsh shadows, blurry, distorted, text"
  }
];
var PROMPT_BOOSTS = [
  {
    id: "light",
    icon: "✨",
    zh: "丰富光影与材质细节",
    en: "Richer light and material detail",
    suffix: "rich cinematic lighting, detailed materials, subtle reflections"
  },
  {
    id: "cinema",
    icon: "🎬",
    zh: "增加电影级景深景别",
    en: "Cinematic depth of field",
    suffix: "cinematic composition, shallow depth of field, 35mm lens"
  }
];

// src/logic/clamp.js
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function clampSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1024;
  return Math.min(1536, Math.max(256, Math.round(number / 8) * 8));
}
function parseSeed(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return -1;
  const value = Number(raw);
  if (!Number.isFinite(value)) return -1;
  const int = Math.trunc(value);
  if (int < 0) return -1;
  return Math.min(int, 4294967295);
}

// src/studio/ratios.js
var DEFAULT_RATIOS = [
  { id: "1:1", zh: "1:1 方形", en: "1:1 Square", width: 1024, height: 1024 },
  { id: "16:9", zh: "16:9 横屏", en: "16:9 Landscape", width: 1152, height: 648 },
  { id: "9:16", zh: "9:16 竖屏", en: "9:16 Portrait", width: 648, height: 1152 }
];
function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) };
}

// src/studio/Rail.jsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var PROMPT_MAX = 2e3;
function Fieldset(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "ofs-fieldset", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-fieldset-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("h3", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-num", children: props.index }),
        props.title
      ] }),
      props.action ? props.action : null
    ] }),
    props.children
  ] });
}
function Rail(props) {
  const {
    t,
    form,
    patchForm,
    isEn,
    styleId,
    applyStyle,
    ratioId,
    applyRatio,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    sending,
    onGenerate,
    suggestions,
    suggestSource,
    enhancing,
    onEnhance,
    onApplySuggestion,
    presets,
    mode,
    setMode
  } = props;
  const promptLength = form.prompt.length;
  const styleList = STYLE_CAPSULES;
  const activeSuggestion = suggestions.length > 0 ? suggestions : [];
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("aside", { className: "ofs-rail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { className: "ofs-rail-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { children: t("studio.rail.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-mode", role: "tablist", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "form",
            className: mode === "form" ? "is-on" : "",
            onClick: () => setMode("form"),
            children: t("studio.rail.modeForm")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "chat",
            className: mode === "chat" ? "is-on" : "",
            onClick: () => setMode("chat"),
            children: t("studio.rail.modeChat")
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-rail-scroll", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(Fieldset, { index: "01", title: t("studio.prompt"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-composer", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "textarea",
            {
              className: "ofs-composer-input",
              value: form.prompt,
              maxLength: PROMPT_MAX,
              placeholder: t("studio.promptPlaceholder"),
              spellCheck: false,
              onChange: (event) => patchForm({ prompt: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onGenerate();
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-composer-foot", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "ofs-counter", children: [
              promptLength,
              " / ",
              PROMPT_MAX
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "ofs-text-action", onClick: onEnhance, disabled: enhancing, children: [
              enhancing ? t("studio.enhance.thinking") : t("studio.enhance.button"),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": "true", children: " ✨" })
            ] })
          ] })
        ] }),
        activeSuggestion.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-suggestions", children: [
          activeSuggestion.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              className: "ofs-suggestion",
              onClick: () => onApplySuggestion(entry.text),
              title: entry.text,
              children: entry.text
            },
            entry.id
          )),
          suggestSource === "local" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-muted", children: t("studio.enhance.local") }) : null
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-suggestions", children: PROMPT_BOOSTS.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
          "button",
          {
            type: "button",
            className: "ofs-suggestion",
            onClick: () => onApplySuggestion(entry.suffix),
            title: entry.suffix,
            children: [
              entry.icon,
              " ",
              isEn ? entry.en : entry.zh
            ]
          },
          entry.id
        )) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Fieldset, { index: "02", title: t("studio.style"), children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-tiles", children: styleList.map((capsule) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "button",
        {
          type: "button",
          className: styleId === capsule.id ? "ofs-tile is-on" : "ofs-tile",
          onClick: () => applyStyle(capsule.id),
          "aria-pressed": styleId === capsule.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-tile-icon", "aria-hidden": "true", children: capsule.icon }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-tile-label", children: isEn ? capsule.en : capsule.zh })
          ]
        },
        capsule.id
      )) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Fieldset, { index: "03", title: t("studio.rail.frame"), children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-ratio-row", children: DEFAULT_RATIOS.map((ratio) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "button",
        {
          type: "button",
          className: ratioId === ratio.id ? "ofs-ratio is-on" : "ofs-ratio",
          onClick: () => applyRatio(ratio.id),
          "aria-pressed": ratioId === ratio.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `ofs-ratio-glyph ofs-ratio-glyph--${ratio.id.replace(":", "-")}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-ratio-label", children: ratio.id })
          ]
        },
        ratio.id
      )) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Fieldset, { index: "04", title: t("studio.rail.advanced"), children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-rows", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-row-head",
              onClick: () => setNegativeOpen((open) => !open),
              "aria-expanded": negativeOpen,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.negative") }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-chevron", "aria-hidden": "true", children: negativeOpen ? "⌃" : "⌄" })
              ]
            }
          ),
          negativeOpen ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "textarea",
            {
              className: "ofs-row-textarea",
              rows: 3,
              value: form.negative,
              placeholder: t("studio.negativePlaceholder"),
              spellCheck: false,
              onChange: (event) => patchForm({ negative: event.target.value })
            }
          ) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-row-head",
              onClick: () => setAdvancedOpen((open) => !open),
              "aria-expanded": advancedOpen,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.rail.params") }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-chevron", "aria-hidden": "true", children: advancedOpen ? "⌃" : "⌄" })
              ]
            }
          ),
          advancedOpen ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-grid2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.steps") }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "input",
                {
                  type: "number",
                  min: 1,
                  max: 60,
                  value: form.steps,
                  onChange: (event) => patchForm({ steps: Number(event.target.value) })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.cfg") }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "input",
                {
                  type: "number",
                  min: 0,
                  max: 20,
                  step: 0.5,
                  value: form.cfg,
                  onChange: (event) => patchForm({ cfg: Number(event.target.value) })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.seed") }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "input",
                {
                  type: "text",
                  inputMode: "numeric",
                  value: form.seed,
                  placeholder: t("studio.random"),
                  onChange: (event) => patchForm({ seed: event.target.value })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("studio.count") }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("select", { value: form.count, onChange: (event) => patchForm({ count: Number(event.target.value) }), children: [1, 2, 3, 4].map((value) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value, children: value }, value)) })
            ] })
          ] }) : null
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-rail-bottom", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "ofs-generate", onClick: onGenerate, disabled: sending, children: sending ? t("studio.generating") : t("studio.generate") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ofs-hint", children: t("studio.generateHint") })
    ] })
  ] });
}

// src/studio/Stage.jsx
var import_react7 = __toESM(require("react"), 1);
var import_jsx_runtime6 = require("react/jsx-runtime");
function Stage(props) {
  const { t, selected, activeJob, onIterate, onReroll, onCopy, zoom, setZoom, isFavorite, onToggleFavorite, onUseExample } = props;
  const image = selected && selected.image ? selected.image : null;
  const params = selected && selected.item && selected.item.params || null;
  if (!image) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("section", { className: "ofs-stage", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ofs-figure ofs-figure--empty", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-empty-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-empty-glyph", "aria-hidden": "true", children: "✧" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "ofs-empty-title", children: t("studio.stage.empty") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "ofs-muted", children: t("studio.stage.emptyHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ofs-examples", children: ["studio.example.1", "studio.example.2", "studio.example.3"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-example", onClick: () => onUseExample(t(key)), children: t(key) }, key)) })
    ] }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "ofs-stage", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("figure", { className: "ofs-figure", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-figure-button", onClick: () => setZoom(true), title: t("studio.stage.zoom"), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("img", { src: image.url, alt: image.file || "image", className: "ofs-image" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("figcaption", { className: "ofs-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
          t("studio.meta.size"),
          " ",
          image.width || "—",
          "×",
          image.height || "—"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": "true", children: "·" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
          t("studio.meta.elapsed"),
          " ",
          formatSeconds(t, image.seconds)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": "true", children: "·" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
          t("studio.meta.seed"),
          " ",
          image.seed ?? "—"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-dock", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-dock-button", onClick: () => onIterate(selected), children: t("studio.action.iterate") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-dock-button", onClick: onReroll, children: t("studio.action.reroll") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-dock-button", onClick: () => onToggleFavorite(image.path || image.file), children: isFavorite(image.path || image.file) ? t("studio.action.favorited") : t("studio.action.favorite") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-dock-button", onClick: () => onCopy(image.path || image.file), children: t("studio.action.copyPath") })
    ] }),
    params && params.prompt ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "ofs-stage-prompt", children: params.prompt }) : null,
    activeJob ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-stage-progress", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-progress-label", children: t("studio.stage.rendering") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-shimmer" })
    ] }) : null,
    zoom ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ofs-lightbox", role: "presentation", onClick: () => setZoom(false), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("img", { src: image.url, alt: image.file || "image", onClick: (event) => event.stopPropagation() }) }) : null
  ] });
}

// src/studio/Toast.jsx
var import_react8 = __toESM(require("react"), 1);
var import_jsx_runtime7 = require("react/jsx-runtime");
function Toast(props) {
  const { toast } = props;
  if (!toast) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-toast", role: "status", children: toast.text }, toast.id);
}

// src/studio/TopBar.jsx
var import_react9 = __toESM(require("react"), 1);
var import_jsx_runtime8 = require("react/jsx-runtime");
function sessionPill(t, sessionState, busy, onStart, onStop) {
  if (sessionState === "ready") return { tone: "ok", label: t("studio.compute.online"), action: onStop, actionLabel: t("studio.compute.stop") };
  if (sessionState === "provisioning") return { tone: "warn", label: t("studio.compute.queued") };
  if (sessionState === "connecting" || sessionState === "warming") return { tone: "warn", label: t("studio.compute.warming") };
  if (sessionState === "stopping") return { tone: "warn", label: t("studio.compute.stopping") };
  if (sessionState === "error") return { tone: "error", label: t("studio.compute.error"), action: onStart, actionLabel: t("studio.compute.start") };
  return { tone: "idle", label: t("studio.compute.offline"), action: onStart, actionLabel: t("studio.compute.start") };
}
function TopBar(props) {
  const { t, view, setView, sessionState, presets, form, patchForm, busy, onStart, onStop, onProbe } = props;
  const pill = sessionPill(t, sessionState, busy, onStart, onStop);
  const [open, setOpen] = import_react9.default.useState(false);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("header", { className: "ofs-topbar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("nav", { className: "ofs-tabs", "aria-label": t("studio.tabs"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: view === "studio" ? "is-on" : "", onClick: () => setView("studio"), children: t("studio.tab.studio") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: view === "gallery" ? "is-on" : "", onClick: () => setView("gallery"), children: t("studio.tab.gallery") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-grow" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-pill-wrap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "button",
        {
          type: "button",
          className: `ofs-pill ofs-pill--${pill.tone}`,
          onClick: () => setOpen((value) => !value),
          "aria-expanded": open,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("i", { "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: pill.label }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-pill-caret", "aria-hidden": "true", children: "▾" })
          ]
        }
      ),
      open ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-pill-card", role: "dialog", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: onStop, disabled: !!busy || sessionState === "absent", children: t("studio.compute.stop") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: onStart, disabled: !!busy || sessionState === "ready", children: t("studio.compute.start") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: onProbe, disabled: !!busy, children: t("studio.compute.check") })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "ofs-preset", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("studio.preset") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "select",
        {
          value: form.presetId,
          disabled: presets.length === 0,
          onChange: (event) => {
            const id = event.target.value;
            const next = presets.find((item) => item.id === id);
            patchForm({
              presetId: id,
              ...next ? {
                width: next.size || form.width,
                height: next.size || form.height,
                steps: next.steps ?? form.steps,
                cfg: next.cfg ?? form.cfg
              } : {}
            });
          },
          children: [
            presets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "", children: "—" }) : null,
            presets.map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: item.id, children: item.label ? `${item.label} · ${item.id}` : item.id }, item.id))
          ]
        }
      )
    ] })
  ] });
}

// src/studio/useStudio.js
var import_react10 = __toESM(require("react"), 1);

// src/logic/error.js
function errorText(t, error) {
  if (!error) return "";
  if (error.code === "need_prompt") return t("workbench.needPrompt");
  if (error.code === "network") return t("error.network");
  const label = localized(t, `error.code.${error.code}`);
  const detail = error.message && error.message !== error.code ? String(error.message) : "";
  if (label && detail) return `${label} · ${detail}`;
  if (label) return label;
  if (detail) return detail;
  return t("error.http");
}

// src/studio/useStudio.js
var EMPTY_FORM = {
  prompt: "",
  negative: "",
  presetId: "",
  width: 1024,
  height: 1024,
  steps: 4,
  cfg: 0,
  seed: "",
  count: 1,
  styleId: ""
};
function flattenHistory(items) {
  const images = [];
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
    for (const image of list) images.push({ image, item });
  }
  return images;
}
function useStudio(props) {
  const t = translator(props);
  const host = useHostState();
  const state = host.state;
  const refresh = host.refresh;
  const session = state && state.session || null;
  const sessionState = session && session.state || "absent";
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : [];
  const defaultPreset = state && state.defaultPreset || "";
  const activeJob = activeJobOf(state);
  const [form, setForm] = import_react10.default.useState(EMPTY_FORM);
  const [view, setView] = import_react10.default.useState("studio");
  const [advancedOpen, setAdvancedOpen] = import_react10.default.useState(false);
  const [negativeOpen, setNegativeOpen] = import_react10.default.useState(false);
  const [sending, setSending] = import_react10.default.useState(false);
  const [busy, setBusy] = import_react10.default.useState("");
  const [error, setError] = import_react10.default.useState(null);
  const [toast, setToast] = import_react10.default.useState(null);
  const [selectedPath, setSelectedPath] = import_react10.default.useState("");
  const [historyItems, setHistoryItems] = import_react10.default.useState([]);
  const [historyDone, setHistoryDone] = import_react10.default.useState(false);
  const [favorites, setFavorites] = import_react10.default.useState([]);
  const [suggestions, setSuggestions] = import_react10.default.useState([]);
  const [suggestSource, setSuggestSource] = import_react10.default.useState("");
  const [enhancing, setEnhancing] = import_react10.default.useState(false);
  const [panelMode, setPanelMode] = import_react10.default.useState(props && props.panelMode === "chat" ? "chat" : "form");
  const [messages, setMessages] = import_react10.default.useState([]);
  const messageSeq = import_react10.default.useRef(0);
  const [zoom, setZoom] = import_react10.default.useState(false);
  const [ratioId, setRatioId] = import_react10.default.useState("1:1");
  const pendingRef = import_react10.default.useRef(null);
  const aliveRef = import_react10.default.useRef(true);
  import_react10.default.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  import_react10.default.useEffect(() => {
    if (presets.length === 0) return;
    setForm((prev) => {
      if (prev.presetId && presets.some((item) => item.id === prev.presetId)) return prev;
      const initial = presets.some((item) => item.id === defaultPreset) ? defaultPreset : presets[0].id;
      const preset2 = presets.find((item) => item.id === initial);
      if (!preset2) return prev;
      const size = clampSize(preset2.size);
      return {
        ...prev,
        presetId: initial,
        width: size,
        height: size,
        steps: clampInt(preset2.steps, 1, 60, 4),
        cfg: clampNumber(preset2.cfg, 0, 20, 0)
      };
    });
  }, [presets.length, defaultPreset]);
  const loadHistory = import_react10.default.useCallback(async () => {
    const result = await request("imagen-api/history?limit=60", { method: "GET" });
    if (!aliveRef.current) return;
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setHistoryItems(result.data.items.filter(Boolean));
    }
    setHistoryDone(true);
  }, []);
  import_react10.default.useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const loadLibrary = import_react10.default.useCallback(async () => {
    const result = await request("imagen-api/library", { method: "GET" });
    if (!aliveRef.current) return;
    if (result.ok && result.data && Array.isArray(result.data.favorites)) setFavorites(result.data.favorites);
  }, []);
  import_react10.default.useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);
  const threadJob = activeJob || state && state.lastJob || null;
  const threadJobKey = threadJob ? `${threadJob.id}:${threadJob.status}` : "";
  import_react10.default.useEffect(() => {
    if (!threadJob || messages.length === 0) return;
    setMessages((prev) => {
      const index = prev.map((item) => item.jobId).lastIndexOf(threadJob.id);
      if (index < 0) return prev;
      const current = prev[index];
      let next = null;
      if (threadJob.status === "queued" || threadJob.status === "waiting-session") {
        next = { ...current, stage: "queued", text: t("studio.chat.queued") };
      } else if (threadJob.status === "running") {
        next = { ...current, stage: "running", text: t("studio.chat.running") };
      } else if (threadJob.status === "done") {
        const images = Array.isArray(threadJob.output?.images) ? threadJob.output.images : [];
        const first = images[0] || null;
        next = {
          ...current,
          stage: "done",
          text: t("studio.chat.done"),
          image: first ? first.url : current.image,
          imagePath: first ? first.path : current.imagePath,
          meta: first ? `${formatSeconds(t, first.seconds)} · ${t("studio.meta.seed")} ${first.seed ?? "—"}` : current.meta
        };
      } else if (threadJob.status === "failed") {
        next = { ...current, stage: "failed", text: errorText(t, threadJob.error || { code: "", message: "" }) };
      }
      if (!next) return prev;
      if (current.stage === next.stage && current.text === next.text && current.image === next.image) return prev;
      const copy = prev.slice();
      copy[index] = next;
      return copy;
    });
  }, [threadJobKey]);
  const firstImageRef = import_react10.default.useRef(false);
  const finished = state && state.lastJob && state.lastJob.status === "done" ? state.lastJob : null;
  import_react10.default.useEffect(() => {
    if (!finished || firstImageRef.current) return;
    const images = Array.isArray(finished.output?.images) ? finished.output.images : [];
    if (images.length === 0) return;
    firstImageRef.current = true;
    setToast({ text: t("studio.toast.firstImage"), id: Date.now() });
  }, [finished && finished.id]);
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ""}` : "";
  const lastSeenRef = import_react10.default.useRef("");
  import_react10.default.useEffect(() => {
    if (!lastJobId || lastSeenRef.current === lastJobId) return;
    lastSeenRef.current = lastJobId;
    loadHistory();
  }, [lastJobId, loadHistory]);
  const gallery = flattenHistory(historyItems);
  const batches = historyItems.map((item) => ({
    key: item.jobId || item.dir || String(item.prompt),
    prompt: item.prompt || "",
    presetId: item.presetId || "",
    entries: (Array.isArray(item.images) ? item.images.filter(Boolean) : []).map((image) => ({ image, item }))
  })).filter((batch) => batch.entries.length > 0);
  const newest = gallery[0] || null;
  const selected = selectedPath && gallery.find((entry) => entry.image.path === selectedPath) || newest;
  const focusedJob = activeJob || state && state.lastJob || stateJobs(state)[0] || null;
  const sessionQueued = sessionState === "provisioning" || Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "waiting-session"));
  const preset = presets.find((item) => item.id === form.presetId) || null;
  function patchForm(partial) {
    setForm((prev) => ({ ...prev, ...partial }));
  }
  function showToast(text) {
    setToast({ text, id: Date.now() });
  }
  import_react10.default.useEffect(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => {
      if (aliveRef.current) setToast(null);
    }, 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  async function copyPath(value) {
    const text = String(value ?? "").trim();
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(t("studio.toast.copied"));
        return;
      }
    } catch {
    }
    showToast(text);
  }
  async function startSession() {
    if (busy) return;
    setBusy("start");
    const result = await request("imagen-api/session/start", { method: "POST", body: JSON.stringify({ presetId: form.presetId || defaultPreset }) });
    if (!aliveRef.current) return;
    setBusy("");
    if (!result.ok) setError({ code: result.code, message: result.message });
    refresh();
  }
  async function stopSession() {
    if (busy) return;
    setBusy("stop");
    const result = await request("imagen-api/session/stop", { method: "POST" });
    if (!aliveRef.current) return;
    setBusy("");
    if (!result.ok) setError({ code: result.code, message: result.message });
    refresh();
  }
  function buildBody(overrides) {
    const base = {
      prompt: form.prompt.trim().slice(0, 2e3),
      negativePrompt: form.negative.trim(),
      width: clampSize(form.width),
      height: clampSize(form.height),
      steps: clampInt(form.steps, 1, 60, 4),
      cfg: clampNumber(form.cfg, 0, 20, 0),
      seed: parseSeed(form.seed),
      count: clampInt(form.count, 1, 4, 1),
      waitSeconds: 0,
      autoStart: true
    };
    const presetId = form.presetId || defaultPreset;
    if (presetId) base.presetId = presetId;
    return { ...base, ...overrides };
  }
  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: messageSeq.current += 1, ...entry }))]);
  }
  async function generate(overrides) {
    if (sending) return;
    const body = buildBody(overrides);
    if (!body.prompt) {
      setError({ code: "need_prompt", message: "" });
      return;
    }
    pendingRef.current = body;
    setSending(true);
    setError(null);
    const result = await request("imagen-api/generate", { method: "POST", body: JSON.stringify(body) });
    if (!aliveRef.current) return;
    setSending(false);
    if (result.ok && result.data && result.data.id) {
      const jobId = result.data.id;
      pushMessages([
        { role: "user", text: body.prompt },
        { role: "assistant", jobId, stage: "pending", text: t("studio.chat.pending") }
      ]);
      refresh();
      loadHistory();
      showToast(t("studio.toast.submitted"));
      return;
    }
    setError({ code: result.code, message: result.message });
  }
  function reroll() {
    generate({ seed: -1 });
  }
  function iterate(entry) {
    const image = entry && entry.image ? entry.image : entry;
    const item = entry && entry.item ? entry.item : null;
    const params = item && item.params || focusedJob && focusedJob.params || {};
    patchForm({
      prompt: params.prompt || form.prompt,
      negative: params.negativePrompt || form.negative,
      width: params.width || form.width,
      height: params.height || form.height,
      steps: params.steps || form.steps,
      cfg: params.cfg ?? form.cfg,
      seed: image && Number.isFinite(image.seed) ? String(image.seed) : form.seed,
      ...item && item.presetId ? { presetId: item.presetId } : {}
    });
    showToast(t("studio.toast.recalled"));
  }
  function applyStyle(capsuleId) {
    const capsule = STYLE_CAPSULES.find((item) => item.id === capsuleId);
    if (!capsule) return;
    setForm((prev) => {
      if (prev.styleId === capsuleId) return { ...prev, styleId: "" };
      return { ...prev, styleId: capsuleId, negative: prev.negative.trim() ? prev.negative : capsule.negative };
    });
  }
  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id);
    if (!ratio) return;
    const size = ratioToSize(ratio);
    setRatioId(id);
    patchForm({ width: size.width, height: size.height });
  }
  function isFavorite(path) {
    return Boolean(path) && favorites.includes(String(path));
  }
  async function toggleFavorite(path) {
    const target = String(path ?? "");
    if (!target) return;
    const next = !isFavorite(target);
    setFavorites((prev) => next ? [...prev, target] : prev.filter((item) => item !== target));
    const result = await request("imagen-api/library/favorite", {
      method: "POST",
      body: JSON.stringify({ path: target, favorite: next })
    });
    if (!aliveRef.current) return;
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites);
      showToast(next ? t("studio.toast.favorited") : t("studio.toast.unfavorited"));
      return;
    }
    setFavorites((prev) => next ? prev.filter((item) => item !== target) : [...prev, target]);
    setError({ code: result.code, message: result.message });
  }
  async function deleteImages(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (list.length === 0) return;
    const result = await request("imagen-api/library/delete", {
      method: "POST",
      body: JSON.stringify({ paths: list })
    });
    if (!aliveRef.current) return;
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      return;
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : [];
    if (removed.length > 0) showToast(t("studio.toast.deleted"));
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      setError({ code: "delete_failed", message: t("studio.error.deleteFailed") });
    }
    setSelectedPath("");
    await Promise.all([loadHistory(), loadLibrary()]);
  }
  function resetToSafe() {
    patchForm({ width: 1024, height: 1024, steps: 4, cfg: 1 });
    setError(null);
    showToast(t("studio.guidance.oom.action"));
  }
  async function runProbe() {
    const result = await request("imagen-api/probe", { method: "POST" });
    if (!aliveRef.current) return;
    if (result.ok) showToast(t("studio.compute.check"));
    else setError({ code: result.code, message: result.message });
  }
  async function exportPaths(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (list.length === 0) return;
    const text = list.join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(t("studio.toast.exported"));
        return;
      }
    } catch {
    }
    showToast(text);
  }
  async function enhance() {
    if (enhancing) return;
    setEnhancing(true);
    const result = await request("imagen-api/enhance", {
      method: "POST",
      body: JSON.stringify({ prompt: form.prompt })
    });
    if (!aliveRef.current) return;
    setEnhancing(false);
    if (result.ok && result.data && Array.isArray(result.data.suggestions)) {
      setSuggestions(result.data.suggestions.filter((item) => item && item.text));
      setSuggestSource(result.data.source === "model" ? "model" : "local");
      return;
    }
    setError({ code: result.code, message: result.message });
  }
  const styleSuffix = (() => {
    const capsule = STYLE_CAPSULES.find((item) => item.id === form.styleId);
    return capsule ? capsule.suffix : "";
  })();
  function composePrompt() {
    const base = form.prompt.trim();
    if (!base) return "";
    if (!styleSuffix) return base;
    return `${base}, ${styleSuffix}`;
  }
  const guidanceCode = error && error.code || session && session.error && session.error.code || focusedJob && focusedJob.status === "failed" && focusedJob.error && focusedJob.error.code || "";
  return {
    guidanceCode,
    batches,
    panelMode,
    setPanelMode,
    messages,
    clearThread: () => setMessages([]),
    generateWithText: (text) => generate({ prompt: String(text ?? "").trim() }),
    openMessage: (path) => {
      if (path) setSelectedPath(path);
    },
    sessionQueued,
    resetToSafe,
    runProbe,
    exportPaths,
    t,
    isEn: !/^zh/i.test(String(typeof document !== "undefined" && document.documentElement && document.documentElement.lang || "en")),
    view,
    setView,
    session,
    sessionState,
    presets,
    preset,
    activeJob,
    focusedJob,
    gallery,
    selected,
    selectImage: (entry) => setSelectedPath(entry && entry.image ? entry.image.path : ""),
    form,
    patchForm,
    styleSuffix,
    composePrompt,
    styleId: form.styleId,
    applyStyle,
    ratioId,
    applyRatio,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    sending,
    busy,
    error,
    clearError: () => setError(null),
    toast,
    showToast,
    favorites,
    isFavorite,
    toggleFavorite,
    deleteImages,
    suggestions,
    suggestSource,
    enhancing,
    enhance,
    applySuggestion: (text) => {
      const base = form.prompt.trim();
      patchForm({ prompt: base ? `${base}, ${text}` : text });
    },
    zoom,
    setZoom,
    historyDone,
    generate,
    reroll,
    iterate,
    copyPath,
    startSession,
    stopSession,
    loadHistory
  };
}

// src/studio/Studio.jsx
var import_jsx_runtime9 = require("react/jsx-runtime");
function Studio(props) {
  const s = useStudio(props);
  const now = useNow(Boolean(s.activeJob));
  const elapsedMs = s.activeJob ? jobElapsed(s.activeJob, now) : 0;
  const guidanceKind = guidanceKindOf(s.guidanceCode);
  const chatMode = s.panelMode === "chat";
  const panel = chatMode ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
    ChatPanel,
    {
      t: s.t,
      form: s.form,
      patchForm: s.patchForm,
      sending: s.sending,
      onGenerate: s.generateWithText,
      messages: s.messages,
      onReroll: s.reroll,
      onIterate: () => s.iterate(s.selected),
      onClearThread: s.clearThread,
      onOpenMessage: s.openMessage,
      hasSelection: Boolean(s.selected),
      mode: s.panelMode,
      setMode: s.setPanelMode,
      onEnhance: s.enhance,
      enhancing: s.enhancing,
      suggestions: s.suggestions,
      onApplySuggestion: s.applySuggestion
    }
  ) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
    Rail,
    {
      t: s.t,
      form: s.form,
      patchForm: s.patchForm,
      isEn: s.isEn,
      styleId: s.styleId,
      applyStyle: s.applyStyle,
      ratioId: s.ratioId,
      applyRatio: s.applyRatio,
      advancedOpen: s.advancedOpen,
      setAdvancedOpen: s.setAdvancedOpen,
      negativeOpen: s.negativeOpen,
      setNegativeOpen: s.setNegativeOpen,
      sending: s.sending,
      onGenerate: () => s.generate(),
      suggestions: s.suggestions,
      suggestSource: s.suggestSource,
      enhancing: s.enhancing,
      onEnhance: s.enhance,
      onApplySuggestion: s.applySuggestion,
      presets: s.presets,
      mode: s.panelMode,
      setMode: s.setPanelMode
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "ofs-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("style", { children: styles_default }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      TopBar,
      {
        t: s.t,
        view: s.view,
        setView: s.setView,
        sessionState: s.sessionState,
        presets: s.presets,
        form: s.form,
        patchForm: s.patchForm,
        busy: s.busy,
        onStart: s.startSession,
        onStop: s.stopSession,
        onProbe: s.runProbe
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "ofs-shell", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        GuidanceCard,
        {
          t: s.t,
          kind: guidanceKind,
          onReset: s.resetToSafe,
          onWake: s.startSession,
          onRecheck: s.runProbe,
          onRetry: s.reroll
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: `ofs-body ${chatMode ? "is-chat" : ""}`, children: [
        panel,
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-main", children: s.view === "gallery" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          Gallery,
          {
            t: s.t,
            gallery: s.gallery,
            now: Date.now(),
            presets: s.presets,
            favorites: s.favorites,
            onDelete: s.deleteImages,
            onExport: s.exportPaths,
            onOpen: (entry) => {
              s.selectImage(entry);
              s.setView("studio");
            }
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          Stage,
          {
            t: s.t,
            selected: s.selected,
            activeJob: s.activeJob,
            zoom: s.zoom,
            setZoom: s.setZoom,
            onIterate: s.iterate,
            onReroll: s.reroll,
            onCopy: s.copyPath,
            isFavorite: s.isFavorite,
            onToggleFavorite: s.toggleFavorite,
            onUseExample: (text) => s.patchForm({ prompt: text })
          }
        ) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      Filmstrip,
      {
        t: s.t,
        batches: s.batches,
        activeJob: s.activeJob,
        selected: s.selected,
        onSelect: s.selectImage,
        now,
        elapsedMs,
        sessionState: s.sessionState,
        sessionQueued: s.sessionQueued,
        onSessionStart: s.startSession
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Toast, { toast: s.toast })
  ] });
}

// src/studio/StudioIcon.jsx
var import_react12 = __toESM(require("react"), 1);
var import_jsx_runtime10 = require("react/jsx-runtime");
function StudioIcon(props) {
  const size = props && props.size || 20;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("path", { d: "M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("circle", { cx: "12", cy: "12", r: "3.2" })
      ]
    }
  );
}

// src/index.js
var PANEL_ID = "our-free-imagen";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, "zh", DICT.zh), "imagen:locale-zh");
  ctx.effect(() => ctx.locale.register(NS, "en", DICT.en), "imagen:locale-en");
  const studioLabel = () => {
    try {
      return ctx.locale.bind(NS)("studio.nav.label");
    } catch {
      return DICT.zh["studio.nav.label"];
    }
  };
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS
      },
      Studio
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 40,
        label: studioLabel,
        locale: NS
      },
      StudioIcon
    )
  );
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () => ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "our-free-imagen-status",
        order: 30,
        label: studioLabel,
        locale: NS
      },
      StatusChip
    )
  );
}

		return module.exports;
	}
});
