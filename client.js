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
  // ── 插件与页面 ────────────────────────────────────────────────
  "action.probing": "检查中…",
  "value.unknown": "未检查",
  "value.ok": "正常",
  "value.failed": "失败",
  "value.quotaUnavailable": "不可用",
  // ── 连接指引 ─────────────────────────────────────────────────
  // ── 模型与硬件 ───────────────────────────────────────────────
  "unit.second": "秒",
  "unit.min": "分",
  "unit.hour": "小时",
  "unit.image": "张",
  "chip.offline": "云端未连接",
  "chip.online": "云端在线",
  // ── 工作台通用 ───────────────────────────────────────────────
  "workbench.restartSession": "重新启动会话",
  "workbench.sessionEnded": "会话已结束",
  "workbench.needPrompt": "先写提示词",
  // ── 会话状态 ─────────────────────────────────────────────────
  "session.state.absent": "未启动",
  "session.state.provisioning": "排队中",
  "session.state.connecting": "建立隧道",
  "session.state.warming": "模型加载中",
  "session.state.ready": "就绪",
  "session.state.stopping": "正在关机",
  "session.state.error": "连接异常",
  "session.phase.push": "推送内核",
  "session.phase.queue": "Kaggle 排队",
  "session.phase.tunnel": "等待隧道",
  "session.phase.health": "健康检查",
  "session.phase.warm": "模型预热",
  "session.hint.provisioning": "正在向 Kaggle 申请 GPU 机器（排队通常需 5~10 分钟，请稍候…）",
  "session.hint.connecting": "已拿到云端地址，正在建立隧道并做连通检查…",
  "session.hint.warming": "云端机器已就绪，正在准备模型权重（即将完成）…",
  "session.hint.stopping": "正在安全关闭云端机器，释放 Kaggle 额度…",
  "session.hint.generating": "正在生成…（首次约 11 秒，之后约 6 秒）",
  "job.status.queued": "排队中",
  "job.status.waiting-session": "等待会话",
  "job.status.running": "生成中",
  "job.status.done": "完成",
  "job.status.failed": "失败",
  // ── 错误码 ───────────────────────────────────────────────────
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
  "error.code.timeout": "检查超时",
  "error.code.invalid_prompt": "提示词不符合远端要求",
  "error.code.queue_full": "云端队列已满",
  "error.code.session_absent": "云端会话不存在",
  "error.code.empty_result": "远端没有返回图片",
  "error.code.invalid_path": "文件路径无效",
  "error.code.disposed": "插件已停止，任务未执行",
  "error.code.session_timeout": "等待云端会话超时",
  "error.code.not_found": "没有找到对应内容",
  "error.code.invalid_body": "请求内容格式不正确",
  "error.code.too_many": "一次提交的数量过多",
  "error.code.output_missing": "找不到对应的生成结果",
  "error.code.reveal_failed": "无法打开文件所在位置",
  "error.code.logs_unavailable": "暂时拿不到远端运行日志",
  "error.code.internal_error": "本地服务内部错误",
  "error.code.session_error": "云端会话出错",
  "error.code.generate_failed": "出图没有成功",
  "error.code.cli_timeout": "kaggle 命令执行超时",
  "error.code.unknown": "未识别的错误",
  "error.code.unauthorized": "远端访问未授权",
  // ── 工作台骨架 ───────────────────────────────────────────────
  "studio.nav.label": "免费生图",
  "studio.brand": "免费生图",
  "studio.brandSub": "Studio",
  "studio.refresh": "刷新历史",
  "studio.tabs": "视图切换",
  "studio.tab.studio": "创作",
  "studio.tab.gallery": "画廊",
  // ── GPU 状态 ─────────────────────────────────────────────────
  "studio.compute.offline": "云端已休眠",
  "studio.compute.queued": "正在申请 GPU",
  "studio.compute.warming": "正在装载模型",
  "studio.compute.stopping": "正在释放实例",
  "studio.compute.online": "云端在线 · 6s/张",
  "studio.compute.error": "连接异常",
  "studio.compute.start": "唤醒",
  "studio.compute.stop": "休眠",
  "studio.compute.quota": "Kaggle 剩余算力",
  "studio.compute.idleFor": "闲置休眠",
  "studio.compute.idleTooltip": "云端实例闲置 30 分钟将自动关机，以节省你每周 30 小时的 Kaggle 免费 GPU 额度。",
  "studio.compute.queuedTooltip": "正在向 Kaggle 申请 GPU 机器，排队通常需要 3~8 分钟；就绪后单张约 6 秒。",
  "studio.compute.offlineTooltip": "云端当前未运行，首次生成会自动唤醒机器。",
  "studio.compute.authTooltip": "Kaggle 账号必须完成手机号绑定，未绑定的账号无法使用 GPU。",
  "studio.probe.cli": "命令行",
  "studio.probe.account": "账号",
  "studio.probe.quota": "剩余算力",
  "studio.probe.ok": "环境检查通过",
  "studio.probe.failed": "环境检查未通过",
  "studio.probe.timeout": "检查环境超时，可重试；首次检查需要 20~30 秒",
  // ── 提示词 ───────────────────────────────────────────────────
  "studio.promptHint": "先写画面描述",
  "studio.preset": "模型预设",
  "studio.style": "风格预设",
  "studio.style.photo": "写实摄影",
  "studio.style.concept": "概念原画",
  "studio.style.cyberpunk": "赛博朋克",
  "studio.style.ink": "水墨写意",
  "studio.style.clay": "3D 渲染",
  "studio.prompt": "提示词",
  "studio.promptPlaceholder": "描述画面内容，Ctrl+Enter 生成",
  "studio.promptTooltip": "支持中英文输入；英文提示词在多数开源模型上细节更丰富。",
  "studio.negative": "排除项",
  "studio.negativePlaceholder": "画面中不希望出现的元素（如模糊、文字）",
  "studio.negativeTooltip": "画面中不希望出现的元素。仅在引导强度 (CFG) > 0 时生效。",
  // ── 参数 ─────────────────────────────────────────────────────
  "studio.steps": "采样步数",
  "studio.stepsTooltip": "模型迭代去噪的步数。Lightning 预设推荐 4~8 步，Base 预设推荐 25~30 步。",
  "studio.cfg": "引导强度",
  "studio.cfgTooltip": "数值越高越贴合提示词，过高可能产生色彩失真。默认推荐 1.5~7.0。",
  "studio.seed": "随机种子",
  "studio.random": "随机",
  "studio.count": "生成张数",
  "studio.generate": "立即生成",
  "studio.generating": "提交中…",
  "studio.generateHint": "Ctrl+Enter 直接生成",
  // ── 画面预览 ─────────────────────────────────────────────────
  "studio.stage.empty": "画面预览",
  "studio.stage.emptyHint": "在左侧输入画面描述，点击生成即可开始出图。",
  "studio.stage.examples": "灵感示例",
  "studio.stage.zoom": "点击查看原图",
  "studio.stage.rendering": "正在生成…",
  "studio.meta.seed": "种子",
  "studio.action.iterate": "带回参数",
  "studio.action.reroll": "生成变体",
  "studio.action.copyPath": "复制文件路径",
  "studio.action.openFolder": "在文件夹中打开",
  "studio.action.favorite": "收藏",
  "studio.action.favorited": "已收藏",
  // ── 最近生成 ─────────────────────────────────────────────────
  "studio.filmstrip.empty": "生成的每一批作品会显示在这里",
  "studio.filmstrip.offline": "云端尚未启动",
  "studio.ghost.queued": "云端正在排队…",
  "studio.ghost.rendering": "正在生成，已耗时",
  "studio.toast.firstImage": "云端就绪，第一张图已生成",
  // ── 作品画廊 ─────────────────────────────────────────────────
  "studio.gallery.title": "作品画廊",
  "studio.gallery.empty": "暂无历史作品，前往创作页生成第一张图。",
  "studio.gallery.noMatch": "没有匹配的作品，换个关键词或清除筛选",
  "studio.gallery.clearFilters": "清除筛选",
  "studio.gallery.today": "今天",
  "studio.gallery.week": "本周",
  "studio.gallery.earlier": "更早",
  "studio.gallery.allPresets": "全部模型",
  "studio.gallery.search": "搜索提示词或模型",
  "studio.gallery.select": "批量选择",
  "studio.gallery.selectedCount": "已选",
  "studio.gallery.delete": "删除",
  "studio.gallery.cancel": "取消",
  "studio.gallery.confirmDelete": "确认删除",
  "studio.gallery.favoriteOnly": "只看收藏",
  "studio.gallery.export": "复制路径",
  "studio.gallery.open": "查看大图",
  "studio.toast.exported": "已复制所选路径",
  "studio.error.deleteFailed": "有图片没能删除",
  // ── 提示与收藏 ───────────────────────────────────────────────
  "studio.toast.copied": "已复制文件绝对路径",
  "studio.toast.submitted": "已加入云端队列",
  "studio.toast.recalled": "参数已回填",
  "studio.toast.favorited": "已加入收藏",
  "studio.toast.unfavorited": "已取消收藏",
  "studio.toast.deleted": "已删除",
  "studio.toast.revealFailed": "无法打开文件夹",
  "studio.dismiss": "知道了",
  // ── 指引卡 ───────────────────────────────────────────────────
  "studio.guidance.oom.title": "当前分辨率或步数过大，显存不足",
  "studio.guidance.oom.action": "重置为 1024×1024",
  "studio.guidance.sleep.title": "云端实例闲置超过 30 分钟已自动休眠，额度已节省",
  "studio.guidance.sleep.action": "重新唤醒",
  "studio.guidance.auth.title": "Kaggle 账号缺少手机号绑定或凭据不可用",
  "studio.guidance.auth.action": "打开 Kaggle 设置",
  "studio.guidance.cli.title": "本地没有检测到 Kaggle 命令行",
  "studio.guidance.cli.action": "重新检查环境",
  "studio.guidance.generic.title": "生成没有成功",
  "studio.guidance.generic.action": "重试一次",
  "studio.guidance.session.title": "云端连接中断",
  "studio.guidance.other.title": "操作没有完成",
  "studio.guidance.close": "关闭",
  "studio.guidance.cli.copy": "复制安装命令",
  "studio.guidance.cli.copied": "已复制安装命令",
  "studio.compute.check": "检查凭据",
  // ── 灵感与润色 ───────────────────────────────────────────────
  "studio.inspire.title": "灵感示例",
  "studio.inspire.1": "雨夜的未来城市街景，湿润地面倒映霓虹招牌，充满雾气与层次感",
  "studio.inspire.1.label": "科幻街景",
  "studio.inspire.2": "室内柔和自然光人像，35mm 胶片质感，细腻发丝与浅景深",
  "studio.inspire.2.label": "人像摄影",
  "studio.inspire.3": "传统水墨风格的远山苍茫，云雾缭绕中的孤舟与古松，大面积留白",
  "studio.inspire.3.label": "东方意境",
  "studio.inspire.4": "可爱的毛绒质感小动物，柔和暖色棚拍光，C4D 风格高细节粘土模型",
  "studio.inspire.4.label": "3D 萌系",
  "studio.inspire.5": "晨光下的晶莹露珠与叶片叶脉，极细腻微距摄影，梦幻光斑光晕",
  "studio.inspire.5.label": "微距自然",
  "studio.enhance.button": "润色",
  "studio.enhance.thinking": "正在润色…",
  "studio.enhance.local": "模型不可用，以下为通用建议",
  "studio.refine.title": "润色建议",
  "studio.refine.hint": "点击标签追加到提示词，再次点击撤销",
  "studio.refine.lighting": "光影",
  "studio.refine.material": "材质",
  "studio.refine.composition": "构图",
  "studio.refine.atmosphere": "氛围",
  // ── 创作面板 ─────────────────────────────────────────────────
  "studio.rail.title": "创作设置",
  "studio.rail.modeForm": "参数表单",
  "studio.rail.modeChat": "创作助手",
  "studio.rail.frame": "画面设置",
  "studio.rail.advanced": "高级设置",
  "studio.rail.params": "步数 / 引导强度 / 种子",
  // ── 创作助手 ─────────────────────────────────────────────────
  "studio.chat.assistant": "创作助手",
  "studio.chat.parsing": "正在解析你的描述…",
  "studio.chat.intent.title": "生成确认",
  "studio.chat.intent.generate": "按此生成",
  "studio.chat.clarify.title": "需要确认一个参数",
  "studio.chat.clarify.ratio": "画面比例用哪个？",
  "studio.chat.clarify.style": "风格用哪个？",
  "studio.chat.clarify.auto": "按当前设置",
  "studio.chat.intent.local": "模型未响应，已按当前设置整理",
  "studio.chat.send": "发送",
  "studio.chat.ratioAuto": "比例自动",
  "studio.chat.styleAuto": "风格自动",
  "studio.chat.pending": "已提交，正在排队…",
  "studio.chat.queued": "云端正在排队，请稍候…",
  "studio.chat.running": "正在生成…",
  "studio.chat.done": "已生成，点击缩略图放大。",
  "studio.chat.empty": "描述你想要的画面，Enter 发送。",
  "studio.chat.placeholder": "描述你想看到的画面…",
  "studio.chat.clear": "清空对话"
};

// src/dict/en.js
var en = {
  // ── Plugin and page ───────────────────────────────────────────
  "action.probing": "Checking…",
  "value.unknown": "Not checked",
  "value.ok": "OK",
  "value.failed": "Failed",
  "value.quotaUnavailable": "Unavailable",
  // ── Setup guide ───────────────────────────────────────────────
  // ── Models and hardware ───────────────────────────────────────
  "unit.second": "s",
  "unit.min": "m",
  "unit.hour": "h",
  "unit.image": "images",
  "chip.offline": "Cloud offline",
  "chip.online": "Cloud online",
  // ── Workbench shared ──────────────────────────────────────────
  "workbench.restartSession": "Restart session",
  "workbench.sessionEnded": "Session ended",
  "workbench.needPrompt": "Write a prompt first",
  // ── Session state ─────────────────────────────────────────────
  "session.state.absent": "Not started",
  "session.state.provisioning": "Queued",
  "session.state.connecting": "Connecting",
  "session.state.warming": "Loading model",
  "session.state.ready": "Ready",
  "session.state.stopping": "Stopping",
  "session.state.error": "Connection error",
  "session.phase.push": "pushing kernel",
  "session.phase.queue": "Kaggle queue",
  "session.phase.tunnel": "tunnel rendezvous",
  "session.phase.health": "health check",
  "session.phase.warm": "model warm-up",
  "session.hint.provisioning": "Asking Kaggle for a GPU machine (the queue usually takes 5–10 minutes)…",
  "session.hint.connecting": "Got the cloud address; opening the tunnel and checking connectivity…",
  "session.hint.warming": "The cloud machine is up; preparing model weights (almost there)…",
  "session.hint.stopping": "Shutting the cloud machine down safely to free Kaggle quota…",
  "session.hint.generating": "Generating… (about 11 s for the first image, about 6 s after that)",
  "job.status.queued": "Queued",
  "job.status.waiting-session": "Waiting for session",
  "job.status.running": "Generating",
  "job.status.done": "Done",
  "job.status.failed": "Failed",
  // ── Error codes ───────────────────────────────────────────────
  "error.network": "The local service is not responding; retrying automatically.",
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
  "error.code.warming": "The remote side is still loading the model; try again shortly",
  "error.code.oom": "GPU out of memory",
  "error.code.load_failed": "Model failed to load",
  "error.code.invalid_request": "The request was rejected by the daemon",
  "error.code.generation_failed": "Generation failed",
  "error.code.timeout": "Check timed out",
  "error.code.invalid_prompt": "The prompt was rejected by the daemon",
  "error.code.queue_full": "The cloud queue is full",
  "error.code.session_absent": "The cloud session does not exist",
  "error.code.empty_result": "The daemon returned no image",
  "error.code.invalid_path": "Invalid file path",
  "error.code.disposed": "The plugin stopped before the task ran",
  "error.code.session_timeout": "Timed out waiting for the cloud session",
  "error.code.not_found": "Not found",
  "error.code.invalid_body": "The request body is malformed",
  "error.code.too_many": "Too many items in one request",
  "error.code.output_missing": "The generated output was not found",
  "error.code.reveal_failed": "Could not open the containing folder",
  "error.code.logs_unavailable": "Remote runtime logs are temporarily unavailable",
  "error.code.internal_error": "The local service hit an internal error",
  "error.code.session_error": "The cloud session failed",
  "error.code.generate_failed": "Image generation did not succeed",
  "error.code.cli_timeout": "The kaggle command timed out",
  "error.code.unknown": "Unrecognized error",
  "error.code.unauthorized": "Remote access was not authorized",
  // ── Workbench shell ───────────────────────────────────────────
  "studio.nav.label": "Free imagen",
  "studio.brand": "Free imagen",
  "studio.brandSub": "Studio",
  "studio.refresh": "Refresh history",
  "studio.tabs": "Views",
  "studio.tab.studio": "Generate",
  "studio.tab.gallery": "Gallery",
  // ── GPU status ────────────────────────────────────────────────
  "studio.compute.offline": "Cloud asleep",
  "studio.compute.queued": "Requesting GPU",
  "studio.compute.warming": "Loading model",
  "studio.compute.stopping": "Releasing instance",
  "studio.compute.online": "Online · 6s per image",
  "studio.compute.error": "Connection error",
  "studio.compute.start": "Wake",
  "studio.compute.stop": "Sleep",
  "studio.compute.quota": "Kaggle quota",
  "studio.compute.idleFor": "Idle sleep",
  "studio.compute.idleTooltip": "The cloud instance shuts down after 30 idle minutes to save your 30 free GPU hours per week on Kaggle.",
  "studio.compute.queuedTooltip": "Asking Kaggle for a GPU machine. The queue usually takes 3–8 minutes; once ready, each image takes about 6 seconds.",
  "studio.compute.offlineTooltip": "The cloud is not running; the first generation wakes it automatically.",
  "studio.compute.authTooltip": "The Kaggle account needs a linked phone number; unverified accounts cannot use the GPU.",
  "studio.probe.cli": "CLI",
  "studio.probe.account": "Account",
  "studio.probe.quota": "Quota",
  "studio.probe.ok": "Environment check passed",
  "studio.probe.failed": "Environment check did not pass",
  "studio.probe.timeout": "The environment check timed out; try again. The first check takes 20–30 seconds.",
  // ── Prompt ────────────────────────────────────────────────────
  "studio.promptHint": "Write a description first",
  "studio.preset": "Model preset",
  "studio.style": "Style preset",
  "studio.style.photo": "Realistic photo",
  "studio.style.concept": "Concept art",
  "studio.style.cyberpunk": "Cyberpunk",
  "studio.style.ink": "Ink wash",
  "studio.style.clay": "3D render",
  "studio.prompt": "Prompt",
  "studio.promptPlaceholder": "Describe the image; press Ctrl+Enter to generate.",
  "studio.promptTooltip": "Chinese and English are both supported; English prompts tend to add more detail on most open models.",
  "studio.negative": "Exclusions",
  "studio.negativePlaceholder": "What should stay out of the picture (blur, text)",
  "studio.negativeTooltip": "Elements you do not want in the image. Only applies while guidance (CFG) is above 0.",
  // ── Parameters ────────────────────────────────────────────────
  "studio.steps": "Steps",
  "studio.stepsTooltip": "Denoising steps. The Lightning preset works at 4–8 steps; Base needs 25–30.",
  "studio.cfg": "Guidance",
  "studio.cfgTooltip": "Higher values follow the prompt more closely; too high can distort color. 1.5–7.0 is a safe range.",
  "studio.seed": "Seed",
  "studio.random": "Random",
  "studio.count": "Images",
  "studio.generate": "Generate",
  "studio.generating": "Submitting…",
  "studio.generateHint": "Ctrl+Enter also generates",
  // ── Preview ───────────────────────────────────────────────────
  "studio.stage.empty": "Preview",
  "studio.stage.emptyHint": "Describe the image on the left, then press Generate.",
  "studio.stage.examples": "Ideas",
  "studio.stage.zoom": "Click to view full size",
  "studio.stage.rendering": "Generating…",
  "studio.meta.seed": "Seed",
  "studio.action.iterate": "Recall settings",
  "studio.action.reroll": "New variant",
  "studio.action.copyPath": "Copy file path",
  "studio.action.openFolder": "Show in folder",
  "studio.action.favorite": "Favorite",
  "studio.action.favorited": "Favorited",
  // ── Recent ────────────────────────────────────────────────────
  "studio.filmstrip.empty": "Each batch you generate shows up here",
  "studio.filmstrip.offline": "The cloud is not running yet",
  "studio.ghost.queued": "Waiting in the cloud queue…",
  "studio.ghost.rendering": "Generating, elapsed",
  "studio.toast.firstImage": "The cloud is ready; your first image is here",
  // ── Gallery ───────────────────────────────────────────────────
  "studio.gallery.title": "Gallery",
  "studio.gallery.empty": "No images yet. Generate your first one on the Generate tab.",
  "studio.gallery.noMatch": "No matching images. Try another keyword or clear the filters.",
  "studio.gallery.clearFilters": "Clear filters",
  "studio.gallery.today": "Today",
  "studio.gallery.week": "This week",
  "studio.gallery.earlier": "Earlier",
  "studio.gallery.allPresets": "All models",
  "studio.gallery.search": "Search prompts or models",
  "studio.gallery.select": "Select",
  "studio.gallery.selectedCount": "Selected",
  "studio.gallery.delete": "Delete",
  "studio.gallery.cancel": "Cancel",
  "studio.gallery.confirmDelete": "Delete now",
  "studio.gallery.favoriteOnly": "Favorites only",
  "studio.gallery.export": "Copy paths",
  "studio.gallery.open": "View image",
  "studio.toast.exported": "Selected paths copied",
  "studio.error.deleteFailed": "Some images could not be deleted",
  // ── Toasts and favorites ──────────────────────────────────────
  "studio.toast.copied": "Absolute path copied",
  "studio.toast.submitted": "Added to the cloud queue",
  "studio.toast.recalled": "Settings restored",
  "studio.toast.favorited": "Added to favorites",
  "studio.toast.unfavorited": "Removed from favorites",
  "studio.toast.deleted": "Deleted",
  "studio.toast.revealFailed": "Could not open the folder",
  "studio.dismiss": "Got it",
  // ── Guidance cards ────────────────────────────────────────────
  "studio.guidance.oom.title": "Out of memory at this size or step count",
  "studio.guidance.oom.action": "Reset to 1024×1024",
  "studio.guidance.sleep.title": "The instance slept after 30 idle minutes; your quota is saved",
  "studio.guidance.sleep.action": "Wake it up",
  "studio.guidance.auth.title": "The Kaggle account needs phone verification or usable credentials",
  "studio.guidance.auth.action": "Open Kaggle settings",
  "studio.guidance.cli.title": "The Kaggle CLI was not found locally",
  "studio.guidance.cli.action": "Check again",
  "studio.guidance.generic.title": "The generation did not finish",
  "studio.guidance.generic.action": "Try again",
  "studio.guidance.session.title": "The cloud connection dropped",
  "studio.guidance.other.title": "That action did not complete",
  "studio.guidance.close": "Dismiss",
  "studio.guidance.cli.copy": "Copy install command",
  "studio.guidance.cli.copied": "Install command copied",
  "studio.compute.check": "Check credentials",
  // ── Ideas and refinement ──────────────────────────────────────
  "studio.inspire.title": "Ideas",
  "studio.inspire.1": "A future city street on a rainy night: wet ground mirrors neon signs, fog and depth",
  "studio.inspire.1.label": "Sci-fi street",
  "studio.inspire.2": "A portrait in soft indoor daylight, 35mm film look, fine hair detail and shallow depth of field",
  "studio.inspire.2.label": "Portrait",
  "studio.inspire.3": "Ink-wash mountains, a lone boat and old pine in mist, generous negative space",
  "studio.inspire.3.label": "Ink landscape",
  "studio.inspire.4": "A cute plush-textured animal under soft warm studio light, detailed C4D-style clay render",
  "studio.inspire.4.label": "Stylized 3D",
  "studio.inspire.5": "Morning dew on a leaf with visible veins, fine macro photography, dreamy bokeh",
  "studio.inspire.5.label": "Macro nature",
  "studio.enhance.button": "Refine",
  "studio.enhance.thinking": "Refining…",
  "studio.enhance.local": "Model unavailable; showing general suggestions",
  "studio.refine.title": "Refine suggestions",
  "studio.refine.hint": "Click a tag to append it; click again to undo",
  "studio.refine.lighting": "Light",
  "studio.refine.material": "Material",
  "studio.refine.composition": "Composition",
  "studio.refine.atmosphere": "Mood",
  // ── Creation panel ────────────────────────────────────────────
  "studio.rail.title": "Create",
  "studio.rail.modeForm": "Form",
  "studio.rail.modeChat": "Assistant",
  "studio.rail.frame": "Frame",
  "studio.rail.advanced": "Advanced",
  "studio.rail.params": "Steps / guidance / seed",
  // ── Creation assistant ────────────────────────────────────────
  "studio.chat.assistant": "Assistant",
  "studio.chat.parsing": "Reading your description…",
  "studio.chat.intent.title": "Ready to generate",
  "studio.chat.intent.generate": "Generate this",
  "studio.chat.clarify.title": "One setting to confirm",
  "studio.chat.clarify.ratio": "Which aspect ratio?",
  "studio.chat.clarify.style": "Which style?",
  "studio.chat.clarify.auto": "Use current settings",
  "studio.chat.intent.local": "The model did not respond; using current settings",
  "studio.chat.send": "Send",
  "studio.chat.ratioAuto": "Ratio auto",
  "studio.chat.styleAuto": "Style auto",
  "studio.chat.pending": "Submitted; queuing…",
  "studio.chat.queued": "Waiting in the cloud queue…",
  "studio.chat.running": "Generating…",
  "studio.chat.done": "Done. Click the thumbnail to enlarge.",
  "studio.chat.empty": "Describe the image you want; press Enter to send.",
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
  bg: "var(--dsw-alias-bg-layer-2)",
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
    width: 6,
    height: 6,
    minWidth: 6,
    borderRadius: 99,
    background: color,
    display: "inline-block"
  }),
  headerChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    maxWidth: 112,
    minWidth: 0,
    fontSize: 11,
    fontWeight: 550,
    color: token.textSub,
    padding: "2px 9px 2px 8px",
    border: `1px solid color-mix(in oklab, ${token.border} 72%, transparent)`,
    borderRadius: 999,
    background: `color-mix(in oklab, ${token.bg} 78%, transparent)`,
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
  return fallbackTranslate(document.documentElement.lang);
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

// shared/contract.js
var ROUTES = {
  state: { method: "GET", path: "/imagen-api/state" },
  probe: { method: "POST", path: "/imagen-api/probe" },
  // 远端运行日志（把 daemon 的日志环透传给工作台日志抽屉）。
  logs: { method: "GET", path: "/imagen-api/logs" },
  sessionStart: { method: "POST", path: "/imagen-api/session/start" },
  sessionStop: { method: "POST", path: "/imagen-api/session/stop" },
  generate: { method: "POST", path: "/imagen-api/generate" },
  job: { method: "GET", path: "/imagen-api/job" },
  jobs: { method: "GET", path: "/imagen-api/jobs" },
  history: { method: "GET", path: "/imagen-api/history" },
  file: { method: "GET", path: "/imagen-api/file" },
  library: { method: "GET", path: "/imagen-api/library" },
  libraryFavorite: { method: "POST", path: "/imagen-api/library/favorite" },
  libraryDelete: { method: "POST", path: "/imagen-api/library/delete" },
  enhance: { method: "POST", path: "/imagen-api/enhance" },
  intent: { method: "POST", path: "/imagen-api/intent" },
  reveal: { method: "POST", path: "/imagen-api/reveal" }
};
function clientPath(route) {
  return route.path.replace(/^\//, "");
}
var LIMITS = {
  prompt: { maxChars: 2e3 },
  negativePrompt: { maxChars: 1e3 },
  width: { min: 256, max: 1536, step: 8 },
  height: { min: 256, max: 1536, step: 8 },
  steps: { min: 1, max: 60 },
  cfg: { min: 0, max: 20 },
  count: { min: 1, max: 4 },
  // Kaggle / torch 侧接受 32 位有符号正整数；两端必须用同一个上界，否则用户输入的
  // seed 会被宿主静默取模改写，导致「带回参数」复现不出同一张图。
  seed: { max: 2147483647 },
  waitSeconds: { min: 0, max: 600, default: 90 },
  queue: { maxPending: 20, maxKept: 60 },
  history: { defaultLimit: 30, maxLimit: 100 },
  jobs: { defaultLimit: 20, maxLimit: 100 },
  historyTool: { defaultLimit: 5, maxLimit: 30 },
  libraryDelete: { maxPaths: 200 },
  intentText: { maxChars: 2e3 }
};
var TIMEOUTS = {
  // 远端 HTTP
  remoteHealthMs: 4e3,
  remoteLogsMs: 4e3,
  remoteGenerateMs: 3e5,
  remoteShutdownMs: 3e3,
  remoteGenerateMaxBytes: 32 * 1024 * 1024,
  // ntfy 会合轮询单次请求
  ntfyPollMs: 8e3,
  // 会话状态机
  sessionTickMs: 3e3,
  kernelPollMs: 3e4,
  healthyPollMs: 1e4,
  readyHealthMissesBeforeCheck: 3,
  reconnectMaxAttempts: 1,
  recoveryMs: 12e4,
  provisionMs: 45 * 60 * 1e3,
  tunnelMs: 15 * 60 * 1e3,
  sessionWaitMs: 45 * 60 * 1e3,
  idleShutdownSec: 1800,
  kernelRunMaxSec: 10800,
  // 宿主本地动作
  revealWaitMs: 1500,
  bodyMaxBytes: 256 * 1024,
  // kaggle CLI
  cliMs: 3e4,
  cliQuotaMs: 2e4,
  cliPushMs: 18e4,
  cliLogsMs: 45e3,
  // 客户端
  clientProbeMs: 45e3,
  clientStatePollMs: 1e4,
  clientStateActivePollMs: 2e3,
  clientLogsPollMs: 2e3
};

// src/api.js
function apiUrl(relative) {
  return new URL(relative, document.baseURI).toString();
}
function routePath(name) {
  const route = ROUTES[name];
  if (!route) throw new Error(`未知路由：${name}`);
  return clientPath(route);
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
    const aborted = Boolean(cause && (cause.name === "AbortError" || cause.code === "ABORT_ERR"));
    return {
      ok: false,
      status: 0,
      code: aborted ? "timeout" : "network",
      message: String(cause && cause.message || cause || (aborted ? "aborted" : "network error"))
    };
  }
}

// src/api/resources.js
function fetchState() {
  return request(routePath("state"), { method: "GET" });
}
function fetchHistory(limit = 60) {
  return request(`${routePath("history")}?limit=${limit}`, { method: "GET" });
}
function fetchLibrary() {
  return request(routePath("library"), { method: "GET" });
}
function startSession(presetId) {
  return request(routePath("sessionStart"), {
    method: "POST",
    body: JSON.stringify({ presetId })
  });
}
function stopSession() {
  return request(routePath("sessionStop"), { method: "POST" });
}
function submitGenerate(body) {
  return request(routePath("generate"), {
    method: "POST",
    body: JSON.stringify(body)
  });
}
function runProbe(signal) {
  return request(routePath("probe"), {
    method: "POST",
    ...signal ? { signal } : {}
  });
}
function enhancePromptRequest({ prompt, presetId, locale }) {
  return request(routePath("enhance"), {
    method: "POST",
    body: JSON.stringify({ prompt, presetId, locale })
  });
}
function parseIntentRequest({ text, previousPrompt, locale }) {
  return request(routePath("intent"), {
    method: "POST",
    body: JSON.stringify({ text, previousPrompt, locale })
  });
}
function revealOutput() {
  return request(routePath("reveal"), { method: "POST", body: JSON.stringify({}) });
}
function favoriteImage(path, favorite) {
  return request(routePath("libraryFavorite"), {
    method: "POST",
    body: JSON.stringify({ path, favorite })
  });
}
function deleteImages(paths) {
  return request(routePath("libraryDelete"), {
    method: "POST",
    body: JSON.stringify({ paths })
  });
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
    let timer = null;
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const tick = async () => {
      timer = null;
      if (document.hidden) return;
      const result = await fetchState();
      if (!aliveRef.current) return;
      let delay = TIMEOUTS.clientStatePollMs;
      if (result.ok && result.data && typeof result.data === "object") {
        setState(result.data);
        setError(null);
        delay = activeJobOf(result.data) ? TIMEOUTS.clientStateActivePollMs : TIMEOUTS.clientStatePollMs;
      } else {
        setError({ code: result.code, message: result.message });
      }
      timer = setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (document.hidden) {
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
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      clear();
      refreshRef.current = () => {
      };
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const refresh = import_react.default.useCallback(() => {
    refreshRef.current();
  }, []);
  return { state, error, refresh };
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
var import_react18 = __toESM(require("react"), 1);

// src/styles/tokens.css
var tokens_default = '/*\n * 设计变量：黑白灰工作室。\n *\n * 视觉立场：一间明度分层的工作室，而不是一块彩色 AI 画布。\n *  1. 地面是中性灰的柔光渐变，上面浮近白的实心卡片；不用彩色光晕，不用玻璃彩虹。\n *  2. 只有明度关系：墨黑做主操作与选中，灰阶做层级，语义色（成功/警告/错误）\n *     只以小圆点或窄条出现，不参与大面积装饰。\n *  3. 深色是同一套明度关系反相：深灰底、浅灰字、浅色主操作。\n *\n * 预览工具（tools/preview.mjs）用同一组值注入深色，改这里要同步那边。\n */\n\n.ofs-root {\n  /* 地面：三层中性柔光 + 一层底色 */\n  --ofs-ground-1: #e7e8ea;\n  --ofs-ground-2: #f1f1f2;\n  --ofs-ground-3: #e3e4e6;\n  --ofs-ground-base: #f5f5f6;\n\n  /* 表面 */\n  --ofs-window: rgb(255 255 255 / 86%);\n  --ofs-window-border: rgb(18 18 22 / 8%);\n  --ofs-card: #ffffff;\n  --ofs-card-solid: #ffffff;\n  --ofs-card-border: rgb(18 18 22 / 9%);\n  --ofs-hairline: rgb(18 18 22 / 7%);\n  --ofs-sunken: #f4f4f6;\n  --ofs-sunken-border: rgb(18 18 22 / 8%);\n\n  /* 文字 */\n  --ofs-ink: #141416;\n  --ofs-ink-2: #52525a;\n  --ofs-ink-3: #6b6b73;\n  --ofs-ink-4: #a8a8b0;\n\n  /* 主操作：墨黑 */\n  --ofs-accent: #141416;\n  --ofs-accent-2: #3f3f46;\n  --ofs-accent-ink: #ffffff;\n  --ofs-accent-soft: #f0f0f2;\n  --ofs-accent-soft-border: #dedee3;\n  --ofs-accent-grad: linear-gradient(180deg, #2b2b30 0%, #141416 100%);\n\n  /* 状态：只做小面积语义色 */\n  --ofs-ok: #2f8a5c;\n  --ofs-ok-soft: #eaf5ef;\n  --ofs-warn: #a96a18;\n  --ofs-warn-soft: #f7f0e4;\n  --ofs-error: #c04444;\n  --ofs-error-soft: #f9ecec;\n  --ofs-idle: #a0a0a8;\n  --ofs-idle-soft: #f1f1f3;\n\n  /* 几何 */\n  --ofs-r-xl: 24px;\n  --ofs-r-lg: 18px;\n  --ofs-r-md: 14px;\n  --ofs-r-sm: 10px;\n  --ofs-r-pill: 999px;\n  --ofs-blur: 18px;\n\n  /* 投影：始终带偏移与柔和扩散，不用零偏移光晕 */\n  --ofs-shadow-card: 0 1px 2px rgb(16 16 20 / 5%), 0 10px 24px -16px rgb(16 16 20 / 22%);\n  --ofs-shadow-lift: 0 2px 6px rgb(16 16 20 / 6%), 0 18px 40px -20px rgb(16 16 20 / 26%);\n  --ofs-shadow-window: 0 1px 3px rgb(16 16 20 / 5%), 0 36px 80px -48px rgb(16 16 20 / 32%);\n  --ofs-shadow-accent: 0 8px 18px -10px rgb(16 16 20 / 48%);\n  --ofs-focus-ring: 0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%);\n\n  --ofs-font: -apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;\n\n  /* 留白节奏 */\n  --ofs-pad: 18px;\n  --ofs-gap: 14px;\n\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  padding: 18px;\n  color: var(--ofs-ink);\n  font-family: var(--ofs-font);\n  font-size: 13px;\n  line-height: 1.55;\n  -webkit-font-smoothing: antialiased;\n  background:\n    radial-gradient(1100px 620px at 12% -8%, var(--ofs-ground-1) 0%, transparent 62%),\n    radial-gradient(900px 520px at 88% 4%, var(--ofs-ground-2) 0%, transparent 58%),\n    radial-gradient(780px 540px at 62% 108%, var(--ofs-ground-3) 0%, transparent 62%),\n    linear-gradient(160deg, var(--ofs-ground-base) 0%, var(--ofs-ground-base) 100%);\n}\n\n@media (prefers-color-scheme: dark) {\n  .ofs-root {\n    --ofs-ground-1: #232326;\n    --ofs-ground-2: #17171a;\n    --ofs-ground-3: #26262a;\n    --ofs-ground-base: #101012;\n\n    --ofs-window: rgb(24 24 27 / 88%);\n    --ofs-window-border: rgb(255 255 255 / 9%);\n    --ofs-card: #18181b;\n    --ofs-card-solid: #1c1c20;\n    --ofs-card-border: rgb(255 255 255 / 9%);\n    --ofs-hairline: rgb(255 255 255 / 8%);\n    --ofs-sunken: rgb(255 255 255 / 5%);\n    --ofs-sunken-border: rgb(255 255 255 / 9%);\n\n    --ofs-ink: #f2f2f4;\n    --ofs-ink-2: #a4a4ac;\n    --ofs-ink-3: #8d8d95;\n    --ofs-ink-4: #5c5c63;\n\n    --ofs-accent: #f2f2f4;\n    --ofs-accent-2: #c8c8cf;\n    --ofs-accent-ink: #161618;\n    --ofs-accent-soft: rgb(255 255 255 / 8%);\n    --ofs-accent-soft-border: rgb(255 255 255 / 14%);\n    --ofs-accent-grad: linear-gradient(180deg, #fafafa 0%, #dcdce1 100%);\n\n    --ofs-ok: #58c08a;\n    --ofs-ok-soft: rgb(88 192 138 / 14%);\n    --ofs-warn: #d8a55c;\n    --ofs-warn-soft: rgb(216 165 92 / 14%);\n    --ofs-error: #e07a7a;\n    --ofs-error-soft: rgb(224 122 122 / 14%);\n    --ofs-idle: #8a8a92;\n    --ofs-idle-soft: rgb(255 255 255 / 6%);\n\n    --ofs-shadow-card: 0 1px 2px rgb(0 0 0 / 40%), 0 12px 28px -18px rgb(0 0 0 / 70%);\n    --ofs-shadow-lift: 0 2px 6px rgb(0 0 0 / 44%), 0 20px 44px -22px rgb(0 0 0 / 76%);\n    --ofs-shadow-window: 0 1px 3px rgb(0 0 0 / 40%), 0 40px 88px -48px rgb(0 0 0 / 88%);\n    --ofs-shadow-accent: 0 8px 20px -10px rgb(0 0 0 / 60%);\n    --ofs-focus-ring: 0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(255 255 255 / 40%);\n  }\n}';

// src/styles/base.css
var base_default = "/*\n * 基础件：浏览器表面、通用原语（按钮 / 胶囊 / 图标钮 / 输入 / 分段控件）。\n *\n * 所有组件只从这里取原语，不在各自文件里重造按钮。类名都以 .ofs- 开头，\n * 避免污染宿主页面。\n */\n\n.ofs-root *,\n.ofs-root *::before,\n.ofs-root *::after {\n  box-sizing: border-box;\n}\n\n.ofs-root ::selection {\n  background: color-mix(in oklab, var(--ofs-ink) 16%, transparent);\n  color: var(--ofs-ink);\n}\n\n.ofs-root :focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-root :focus:not(:focus-visible) {\n  outline: none;\n}\n\n.ofs-root input,\n.ofs-root textarea,\n.ofs-root select {\n  font: inherit;\n  color: inherit;\n  caret-color: var(--ofs-accent);\n}\n\n.ofs-root button {\n  font: inherit;\n}\n\n.ofs-root img {\n  display: block;\n}\n\n.ofs-root h2,\n.ofs-root h3,\n.ofs-root h4,\n.ofs-root p {\n  margin: 0;\n}\n\n.ofs-root a {\n  color: var(--ofs-accent);\n  text-decoration-thickness: 1px;\n  text-underline-offset: 3px;\n}\n\n.ofs-icon {\n  display: block;\n  flex: 0 0 auto;\n}\n\n.ofs-grow {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.ofs-muted {\n  color: var(--ofs-ink-3);\n  font-size: 12px;\n}\n\n/* 滚动条：属于同一个世界，不做默认灰条 */\n.ofs-panel-scroll,\n.ofs-thread,\n.ofs-gallery,\n.ofs-roll {\n  scrollbar-width: thin;\n  scrollbar-color: var(--ofs-ink-4) transparent;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar,\n.ofs-thread::-webkit-scrollbar,\n.ofs-gallery::-webkit-scrollbar,\n.ofs-roll::-webkit-scrollbar {\n  width: 8px;\n  height: 8px;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar-thumb,\n.ofs-thread::-webkit-scrollbar-thumb,\n.ofs-gallery::-webkit-scrollbar-thumb,\n.ofs-roll::-webkit-scrollbar-thumb {\n  border: 2px solid transparent;\n  border-radius: 8px;\n  background: var(--ofs-ink-4);\n  background-clip: content-box;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar-thumb:hover,\n.ofs-thread::-webkit-scrollbar-thumb:hover,\n.ofs-gallery::-webkit-scrollbar-thumb:hover,\n.ofs-roll::-webkit-scrollbar-thumb:hover {\n  background: var(--ofs-ink-3);\n  background-clip: content-box;\n}\n\n/* ── 按钮 ───────────────────────────────────────────────────── */\n.ofs-btn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  height: 38px;\n  padding: 0 18px;\n  border: 1px solid transparent;\n  border-radius: 12px;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 13px;\n  font-weight: 600;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 160ms ease,\n    background-color 160ms ease,\n    border-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-btn:disabled {\n  cursor: default;\n}\n\n.ofs-btn.is-primary {\n  color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n.ofs-btn.is-primary:hover:not(:disabled) {\n  transform: translateY(-1px);\n  box-shadow: 0 14px 28px -12px rgb(16 16 20 / 50%);\n}\n\n.ofs-btn.is-primary:active:not(:disabled) {\n  transform: translateY(0) scale(0.99);\n}\n\n.ofs-btn.is-primary:disabled {\n  background: var(--ofs-accent-grad);\n  border-color: transparent;\n  color: color-mix(in oklab, #fff 82%, transparent);\n  box-shadow: none;\n  opacity: 0.36;\n  filter: saturate(0.6);\n}\n\n.ofs-btn.is-quiet {\n  background: var(--ofs-card);\n  border-color: var(--ofs-card-border);\n  color: var(--ofs-ink);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-btn.is-quiet:hover:not(:disabled) {\n  background: var(--ofs-card-solid);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n.ofs-btn.is-quiet:disabled {\n  color: var(--ofs-ink-4);\n  box-shadow: none;\n}\n\n.ofs-btn.is-ghost {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-btn.is-ghost:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-ink);\n}\n\n/* ── 图标按钮 ───────────────────────────────────────────────── */\n.ofs-icon-btn {\n  appearance: none;\n  display: inline-grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  border: 1px solid transparent;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    color 150ms ease,\n    border-color 150ms ease,\n    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-icon-btn:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-icon-btn:active:not(:disabled) {\n  transform: scale(0.96);\n}\n\n.ofs-icon-btn:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n.ofs-icon-btn.is-on {\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n/* ── 胶囊 / 标签 ────────────────────────────────────────────── */\n.ofs-chip {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 12px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 500;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-chip:hover:not(:disabled) {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-chip.is-on {\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n.ofs-chip.is-danger {\n  color: var(--ofs-error);\n  border-color: transparent;\n  background: var(--ofs-error-soft);\n}\n\n.ofs-chip.is-danger:hover:not(:disabled) {\n  color: var(--ofs-error);\n  border-color: var(--ofs-error);\n}\n\n.ofs-chip:disabled {\n  color: var(--ofs-ink-4);\n  background: transparent;\n  border-color: var(--ofs-sunken-border);\n  cursor: default;\n}\n\n/* ── 分段控件 ───────────────────────────────────────────────── */\n.ofs-seg {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  padding: 3px;\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  border: 1px solid var(--ofs-sunken-border);\n}\n\n.ofs-seg button {\n  appearance: none;\n  height: 26px;\n  padding: 0 12px;\n  border: 0;\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  transition:\n    background-color 160ms ease,\n    color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-seg button:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-seg button.is-on {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n  font-weight: 600;\n  box-shadow: 0 1px 2px rgb(16 16 20 / 8%);\n}\n\n/* ── 状态点 ─────────────────────────────────────────────────── */\n.ofs-dot {\n  display: inline-block;\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--ofs-idle);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-idle) 22%, transparent);\n}\n\n.ofs-dot.is-ok { background: var(--ofs-ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-ok) 20%, transparent); }\n.ofs-dot.is-warn { background: var(--ofs-warn); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-warn) 22%, transparent); }\n.ofs-dot.is-error { background: var(--ofs-error); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-error) 20%, transparent); }\n.ofs-dot.is-idle { background: var(--ofs-idle); }\n.ofs-dot.is-live { animation: ofs-pulse 2.4s ease-out infinite; }\n\n/* 排队 / 预热用琥珀点：呼吸圈也换成警告色。 */\n.ofs-dot.is-warn.is-live {\n  animation: ofs-warn-pulse 2.2s ease-out infinite;\n}\n\n@keyframes ofs-warn-pulse {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 34%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n}\n\n/* ── 动效 ───────────────────────────────────────────────────── */\n@keyframes ofs-pulse {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-ok) 34%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-ok) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-ok) 0%, transparent); }\n}\n\n@keyframes ofs-shimmer {\n  0% { background-position: -220% 0; }\n  100% { background-position: 220% 0; }\n}\n\n@keyframes ofs-fade-in {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n@keyframes ofs-pop-in {\n  from { opacity: 0; transform: translateY(6px) scale(0.985); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}\n\n/* ── 悬浮提示 ─────────────────────────────────────────────── */\n.ofs-tip {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  margin-left: 5px;\n  vertical-align: middle;\n}\n\n.ofs-tip-trigger {\n  appearance: none;\n  display: inline-grid;\n  place-items: center;\n  width: 15px;\n  height: 15px;\n  padding: 0;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-3);\n  font-size: 9.5px;\n  font-weight: 700;\n  line-height: 1;\n  cursor: help;\n}\n\n.ofs-tip-trigger:hover,\n.ofs-tip-trigger:focus-visible {\n  color: var(--ofs-ink);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-tip-trigger:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-tip--warn .ofs-tip-trigger {\n  color: var(--ofs-warn);\n  border-color: color-mix(in oklab, var(--ofs-warn) 45%, transparent);\n  background: var(--ofs-warn-soft);\n}\n\n/* 固定在视口坐标上，不被侧栏的滚动容器裁剪；位置由组件按触发点计算。 */\n.ofs-tip-pop {\n  position: fixed;\n  z-index: 90;\n  width: max-content;\n  max-width: 248px;\n  padding: 8px 10px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: 10px;\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink-2);\n  box-shadow: var(--ofs-shadow-lift);\n  font-size: 11.5px;\n  line-height: 1.55;\n  text-align: left;\n  white-space: normal;\n  transform: translateY(-100%);\n  pointer-events: none;\n}\n\n.ofs-tip-pop.is-below {\n  transform: none;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-root *,\n  .ofs-root *::before,\n  .ofs-root *::after {\n    animation-duration: 1ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 1ms !important;\n  }\n}";

// src/styles/shell.css
var shell_default = '/*\n * 外壳：整页容器、顶栏、布局骨架、异常指引与 Toast。\n *\n * 页面是一张浮在柔光地面上的雾面玻璃大卡：\n *   .ofs-root = 柔光底，.ofs-app = 玻璃大卡，内部再分顶栏 / 主体 / 最近生成栏。\n */\n\n.ofs-app {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-xl);\n  background: var(--ofs-window);\n  box-shadow: var(--ofs-shadow-window);\n  backdrop-filter: blur(24px) saturate(140%);\n  -webkit-backdrop-filter: blur(24px) saturate(140%);\n  overflow: hidden;\n}\n\n/* ── 顶栏 ───────────────────────────────────────────────────── */\n.ofs-topbar {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  height: 58px;\n  padding: 0 16px;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-brand {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  min-width: 0;\n}\n\n.ofs-brand-mark {\n  display: grid;\n  place-items: center;\n  width: 30px;\n  height: 30px;\n  border-radius: 9px;\n  color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n.ofs-brand-name {\n  font-size: 13.5px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n}\n\n.ofs-brand-sub {\n  padding-left: 2px;\n  font-size: 10px;\n  font-weight: 550;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-tabs {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  padding: 3px;\n  margin-left: 4px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n}\n\n.ofs-tab {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 12px;\n  border: 0;\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 160ms ease,\n    color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-tab:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-tab.is-on {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n  font-weight: 600;\n  box-shadow: 0 1px 2px rgb(16 16 20 / 8%);\n}\n\n/* 云端GPU 状态 */\n.ofs-pill-wrap {\n  position: relative;\n  flex: 0 0 auto;\n}\n\n.ofs-compute {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  box-shadow: var(--ofs-shadow-card);\n  transition:\n    border-color 160ms ease,\n    color 160ms ease,\n    background-color 160ms ease;\n}\n\n.ofs-compute:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-compute em {\n  font-style: normal;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-pill-caret {\n  display: grid;\n  place-items: center;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-popover {\n  position: absolute;\n  top: calc(100% + 8px);\n  right: 0;\n  z-index: 40;\n  width: 248px;\n  padding: 6px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 16px;\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-lift);\n  animation: ofs-pop-in 160ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-popover-head {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  padding: 8px 10px 10px;\n  margin-bottom: 4px;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-popover-head > span {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-popover-head > span b {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: var(--ofs-ink);\n}\n\n/* 检查结果 / 失败说明：弹层里的一行到三行小字，避免长 notes 撑开菜单。 */\n.ofs-popover-note {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n  border-bottom: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.5;\n}\n\n.ofs-popover-note span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-popover-row {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  height: 32px;\n  padding: 0 10px;\n  border: 0;\n  border-radius: 9px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-popover-row:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-popover-row:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* 模型预设 */\n.ofs-preset {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 10px 0 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  box-shadow: var(--ofs-shadow-card);\n  cursor: pointer;\n}\n\n.ofs-preset-label {\n  font-size: 11.5px;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-preset:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-preset select {\n  appearance: none;\n  max-width: 168px;\n  padding: 0 18px 0 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  font-weight: 600;\n  cursor: pointer;\n  text-overflow: ellipsis;\n}\n\n.ofs-preset select:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-preset select option {\n  color: var(--ofs-ink);\n  background: var(--ofs-card-solid);\n}\n\n.ofs-preset-meta {\n  padding-left: 8px;\n  border-left: 1px solid var(--ofs-hairline);\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-preset-caret {\n  position: absolute;\n  right: 10px;\n  color: var(--ofs-ink-3);\n  pointer-events: none;\n}\n\n/* ── 骨架 ───────────────────────────────────────────────────── */\n.ofs-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: grid;\n  /* 单轨创作面板 + 自适应预览区；视图切换与状态全部收在顶栏。 */\n  grid-template-columns: 320px minmax(0, 1fr);\n  grid-template-rows: minmax(0, 1fr);\n}\n\n.ofs-body.is-gallery {\n  grid-template-columns: minmax(0, 1fr);\n}\n\n.ofs-main {\n  position: relative;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  margin: 14px;\n}\n\n/* ── 异常指引 ───────────────────────────────────────────────── */\n.ofs-guidance {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 12px 16px 0;\n  padding: 10px 12px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 26%, transparent);\n  border-radius: 14px;\n  background: var(--ofs-warn-soft);\n  animation: ofs-fade-in 220ms ease;\n}\n\n.ofs-guidance-icon {\n  display: grid;\n  place-items: center;\n  flex: 0 0 auto;\n  width: 28px;\n  height: 28px;\n  border-radius: 9px;\n  background: color-mix(in oklab, var(--ofs-warn) 16%, transparent);\n  color: var(--ofs-warn);\n}\n\n.ofs-guidance-body {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  min-width: 0;\n}\n\n.ofs-guidance-title {\n  font-size: 12.5px;\n  color: var(--ofs-ink);\n}\n\n.ofs-guidance-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-guidance-actions .ofs-chip.is-on {\n  background: color-mix(in oklab, var(--ofs-warn) 16%, transparent);\n  border-color: color-mix(in oklab, var(--ofs-warn) 34%, transparent);\n  color: var(--ofs-warn);\n  text-decoration: none;\n}\n\n.ofs-guidance-detail {\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  line-height: 1.5;\n  overflow-wrap: anywhere;\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n  overflow: hidden;\n}\n\n.ofs-guidance-command {\n  display: inline-block;\n  max-width: 100%;\n  padding: 3px 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 8px;\n  background: color-mix(in oklab, var(--ofs-card-solid) 70%, transparent);\n  color: var(--ofs-ink);\n  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace;\n  font-size: 11.5px;\n  overflow-wrap: anywhere;\n}\n\n/* ── Toast ──────────────────────────────────────────────────── */\n.ofs-toast {\n  position: absolute;\n  left: 50%;\n  bottom: 132px;\n  z-index: 60;\n  transform: translateX(-50%);\n  max-width: 78%;\n  padding: 9px 16px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 88%, transparent);\n  box-shadow: var(--ofs-shadow-lift);\n  backdrop-filter: blur(14px);\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  animation: ofs-pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1);\n}';

// src/styles/panel.css
var panel_default = "/*\n * 左侧创作面板（表单 / 对话两种形态共用的卡片容器与表单控件）。\n */\n\n.ofs-panel {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  min-width: 0;\n  margin: 14px 0 14px 14px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  overflow: hidden;\n}\n\n.ofs-panel-head {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 15px 15px 11px;\n}\n\n.ofs-panel-head h2 {\n  font-size: 16px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n}\n\n.ofs-panel-scroll {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 0 15px 14px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n  scroll-behavior: smooth;\n}\n\n/* ── 分区 ───────────────────────────────────────────────────── */\n.ofs-fieldset {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 10px 0;\n}\n\n.ofs-fieldset:first-child {\n  padding-top: 2px;\n}\n\n.ofs-fieldset + .ofs-fieldset {\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-fieldset-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-fieldset-head h3 {\n  font-size: 12px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-2);\n}\n\n/* ── 提示词输入 ─────────────────────────────────────────────── */\n.ofs-composer {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 10px 10px 7px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: linear-gradient(180deg, var(--ofs-card-solid) 0%, var(--ofs-sunken) 100%);\n  transition:\n    border-color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-composer:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: 0 0 0 3px rgb(20 20 22 / 10%);\n}\n\n.ofs-composer-input {\n  width: 100%;\n  min-height: 66px;\n  resize: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 13px;\n  line-height: 1.62;\n}\n\n.ofs-composer-input:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-composer-input::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-composer-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-counter {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-text-action {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 3px 7px;\n  border: 0;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--ofs-accent);\n  font-size: 11.5px;\n  font-weight: 600;\n  cursor: pointer;\n  transition: background-color 150ms ease;\n}\n\n.ofs-text-action:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-text-action:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* ── 建议 chips ─────────────────────────────────────────────── */\n.ofs-suggestions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-suggestion {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  max-width: 100%;\n  height: 24px;\n  padding: 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 10.5px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-suggestion:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-suggestion.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n}\n\n/* ── 灵感与润色 ─────────────────────────────────────────────── */\n.ofs-inspire {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  padding-top: 2px;\n}\n\n.ofs-inspire-label,\n.ofs-refine-head,\n.ofs-refine-dim {\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-refine {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 9px 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-sunken);\n}\n\n.ofs-refine-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  color: var(--ofs-ink-2);\n  font-weight: 600;\n}\n\n.ofs-refine-group {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n/* ── 风格 tile ──────────────────────────────────────────────── */\n.ofs-tiles {\n  display: flex;\n  gap: 8px;\n}\n\n.ofs-tile {\n  appearance: none;\n  flex: 1 1 0;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  cursor: pointer;\n}\n\n.ofs-tile-art {\n  position: relative;\n  display: grid;\n  place-items: center;\n  width: 100%;\n  aspect-ratio: 1 / 1;\n  border-radius: var(--ofs-r-md);\n  border: 1px solid rgb(255 255 255 / 40%);\n  box-shadow:\n    inset 0 1px 0 rgb(255 255 255 / 40%),\n    0 8px 18px -12px rgb(16 16 20 / 22%);\n  color: rgb(255 255 255 / 94%);\n  transition:\n    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 180ms ease;\n}\n\n.ofs-tile-art::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: inherit;\n  background: linear-gradient(180deg, rgb(255 255 255 / 18%) 0%, transparent 42%, rgb(16 16 18 / 16%) 100%);\n}\n\n.ofs-tile-art .ofs-icon {\n  position: relative;\n  z-index: 1;\n  filter: drop-shadow(0 1px 2px rgb(16 16 18 / 35%));\n}\n\n.ofs-tile-art.is-film { background: linear-gradient(150deg, #5c5c64 0%, #2f2f34 52%, #19191c 100%); }\n.ofs-tile-art.is-concept { background: linear-gradient(150deg, #dcdce1 0%, #a6a6ae 52%, #7d7d86 100%); }\n.ofs-tile-art.is-cyberpunk { background: linear-gradient(150deg, #34343a 0%, #62626b 50%, #1d1d21 100%); }\n.ofs-tile-art.is-ink { background: linear-gradient(150deg, #f4f4f6 0%, #d3d3d9 52%, #a9a9b2 100%); }\n.ofs-tile-art.is-clay { background: linear-gradient(150deg, #ececef 0%, #c6c6cd 50%, #9d9da6 100%); }\n\n.ofs-tile-art.is-concept,\n.ofs-tile-art.is-ink,\n.ofs-tile-art.is-clay {\n  color: rgb(20 20 22 / 58%);\n}\n\n.ofs-tile:hover .ofs-tile-art {\n  transform: translateY(-1px);\n  box-shadow:\n    inset 0 1px 0 rgb(255 255 255 / 40%),\n    0 12px 22px -12px rgb(16 16 20 / 26%);\n}\n\n.ofs-tile-label {\n  font-size: 10.5px;\n  line-height: 1.3;\n  color: var(--ofs-ink-3);\n  text-align: center;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.ofs-tile.is-on .ofs-tile-art {\n  box-shadow:\n    0 0 0 2px var(--ofs-card-solid),\n    0 0 0 4px var(--ofs-accent),\n    0 10px 20px -12px rgb(16 16 20 / 30%);\n}\n\n.ofs-tile.is-on .ofs-tile-label {\n  color: var(--ofs-accent);\n  font-weight: 600;\n}\n\n/* ── 画面比例 ───────────────────────────────────────────────── */\n.ofs-ratio-row {\n  display: flex;\n  gap: 8px;\n}\n\n.ofs-ratio {\n  appearance: none;\n  flex: 1 1 0;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 6px;\n  padding: 10px 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-3);\n  cursor: pointer;\n  transition:\n    border-color 160ms ease,\n    background-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-ratio:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink-2);\n}\n\n.ofs-ratio.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  box-shadow: 0 0 0 1px var(--ofs-accent);\n}\n\n.ofs-ratio-glyph {\n  display: block;\n  border: 1.5px solid currentColor;\n  border-radius: 3px;\n}\n\n.ofs-ratio-glyph--1-1 { width: 19px; height: 19px; }\n.ofs-ratio-glyph--16-9 { width: 25px; height: 14px; }\n.ofs-ratio-glyph--9-16 { width: 14px; height: 25px; }\n.ofs-ratio-glyph--4-3 { width: 22px; height: 17px; }\n.ofs-ratio-glyph--3-4 { width: 17px; height: 22px; }\n\n.ofs-ratio-label {\n  font-size: 11px;\n  font-weight: 550;\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 高级设置行 ─────────────────────────────────────────────── */\n.ofs-rows {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n}\n\n.ofs-row {\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  overflow: hidden;\n  transition: border-color 160ms ease;\n}\n\n.ofs-row.is-open,\n.ofs-row:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-row-head {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 9px 12px;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n}\n\n.ofs-row-toggle {\n  appearance: none;\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-row-head:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-chevron {\n  display: grid;\n  place-items: center;\n  color: var(--ofs-ink-4);\n  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-chevron.is-open {\n  transform: rotate(180deg);\n}\n\n.ofs-row-textarea {\n  display: block;\n  width: calc(100% - 20px);\n  min-height: 64px;\n  margin: 0 10px 10px;\n  padding: 8px 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 10px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n  line-height: 1.55;\n  resize: vertical;\n}\n\n.ofs-grid2 {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n  padding: 0 10px 10px;\n}\n\n.ofs-field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.ofs-field > span {\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-field-label {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n}\n\n.ofs-field input,\n.ofs-field select {\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 9px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n}\n\n.ofs-field input:focus-visible,\n.ofs-field select:focus-visible {\n  outline: none;\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-focus-ring);\n}\n\n/* ── 底部生成 ───────────────────────────────────────────────── */\n.ofs-panel-foot {\n  position: relative;\n  z-index: 1;\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 12px 15px 14px;\n  border-top: 1px solid var(--ofs-hairline);\n  background: var(--ofs-card);\n  box-shadow: 0 -16px 20px -18px rgb(16 16 20 / 20%);\n}\n\n.ofs-generate {\n  width: 100%;\n  height: 42px;\n  border-radius: 14px;\n  font-size: 13.5px;\n  letter-spacing: 0.02em;\n}\n\n.ofs-hint {\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n  text-align: center;\n}\n\n.ofs-link {\n  appearance: none;\n  margin-left: 6px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-accent);\n  font-size: inherit;\n  cursor: pointer;\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}";

// src/styles/stage.css
var stage_default = "/*\n * 画面预览：画布卡、图片、浮动工具、信息行、动作坞、空态与放大层。\n */\n\n.ofs-stage {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.ofs-figure {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 26px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-xl);\n  background:\n    radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(--ofs-card-solid) 88%, transparent) 0%, transparent 70%),\n    color-mix(in oklab, var(--ofs-card) 62%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  overflow: hidden;\n}\n\n.ofs-figure-button {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  max-width: 94%;\n  max-height: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  cursor: zoom-in;\n}\n\n.ofs-image {\n  width: auto;\n  height: auto;\n  max-width: 100%;\n  max-height: 100%;\n  border-radius: 16px;\n  box-shadow: 0 30px 64px -28px rgb(16 16 20 / 38%);\n  object-fit: contain;\n}\n\n.ofs-figure-tools {\n  position: absolute;\n  top: 14px;\n  right: 14px;\n  display: flex;\n  gap: 6px;\n}\n\n.ofs-glass-btn {\n  appearance: none;\n  display: grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: 11px;\n  background: color-mix(in oklab, var(--ofs-card-solid) 68%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  color: var(--ofs-ink-2);\n  cursor: pointer;\n  transition:\n    color 150ms ease,\n    background-color 150ms ease,\n    border-color 150ms ease,\n    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-glass-btn:hover {\n  color: var(--ofs-accent);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-glass-btn:active {\n  transform: scale(0.95);\n}\n\n.ofs-glass-btn.is-on {\n  color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-stage-progress {\n  position: absolute;\n  left: 50%;\n  bottom: 16px;\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding: 7px 13px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 74%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  transform: translateX(-50%);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  white-space: nowrap;\n}\n\n.ofs-progress-label {\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-shimmer {\n  display: block;\n  width: 54px;\n  height: 4px;\n  border-radius: var(--ofs-r-pill);\n  background: linear-gradient(\n    90deg,\n    transparent 0%,\n    color-mix(in oklab, var(--ofs-accent) 70%, transparent) 50%,\n    transparent 100%\n  );\n  background-size: 220% 100%;\n  animation: ofs-shimmer 1.5s linear infinite;\n}\n\n/* ── 图片下的信息与动作 ─────────────────────────────────────── */\n.ofs-stage-foot {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 0 4px;\n  min-width: 0;\n}\n\n.ofs-stage-prompt {\n  flex: 1 1 auto;\n  min-width: 0;\n  font-size: 12px;\n  color: var(--ofs-ink-2);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.ofs-stage-meta {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.ofs-dock {\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-dock-button {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 30px;\n  padding: 0 11px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 78%, transparent);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  font-weight: 500;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-dock-button:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-dock-button.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* ── 空态 ───────────────────────────────────────────────────── */\n.ofs-figure--empty {\n  background:\n    radial-gradient(90% 80% at 18% 8%, color-mix(in oklab, var(--ofs-ink) 5%, transparent) 0%, transparent 62%),\n    radial-gradient(80% 70% at 86% 96%, color-mix(in oklab, var(--ofs-ink) 3%, transparent) 0%, transparent 60%),\n    color-mix(in oklab, var(--ofs-card) 58%, transparent);\n}\n\n.ofs-empty-card {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 9px;\n  max-width: 440px;\n  padding: 20px;\n  text-align: center;\n}\n\n.ofs-empty-icon {\n  display: grid;\n  place-items: center;\n  width: 54px;\n  height: 54px;\n  margin-bottom: 2px;\n  border: 1px solid var(--ofs-accent-soft-border);\n  border-radius: 18px;\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-empty-title {\n  font-size: 16px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n}\n\n.ofs-examples {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: center;\n  gap: 6px;\n  margin-top: 6px;\n}\n\n.ofs-examples-label {\n  width: 100%;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-example {\n  appearance: none;\n  padding: 5px 11px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-example:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* ── 放大层 ─────────────────────────────────────────────────── */\n.ofs-lightbox {\n  position: absolute;\n  inset: -14px;\n  z-index: 80;\n  display: grid;\n  place-items: center;\n  padding: 3vw;\n  background: rgb(16 16 18 / 72%);\n  backdrop-filter: blur(16px);\n  -webkit-backdrop-filter: blur(16px);\n  animation: ofs-fade-in 180ms ease;\n}\n\n.ofs-lightbox img {\n  max-width: 94%;\n  max-height: 92%;\n  border-radius: 12px;\n  box-shadow: 0 40px 90px -30px rgb(0 0 0 / 70%);\n}\n\n.ofs-lightbox-close {\n  position: absolute;\n  top: 18px;\n  right: 18px;\n  display: grid;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  border: 1px solid rgb(255 255 255 / 26%);\n  border-radius: 11px;\n  background: rgb(255 255 255 / 12%);\n  color: rgb(255 255 255 / 88%);\n  cursor: pointer;\n}\n\n.ofs-lightbox-close:hover {\n  background: rgb(255 255 255 / 20%);\n  color: #fff;\n}";

// src/styles/filmstrip.css
var filmstrip_default = "/*\n * 底部最近生成栏：悬浮玻璃条，左边是批次缩略图流，右边去画廊。\n */\n\n.ofs-filmstrip {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin: 0 14px 14px;\n  padding: 10px 12px;\n  min-height: 92px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: color-mix(in oklab, var(--ofs-card) 78%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(18px);\n  -webkit-backdrop-filter: blur(18px);\n}\n\n.ofs-roll {\n  flex: 1 1 auto;\n  min-width: 0;\n  display: flex;\n  align-items: stretch;\n  gap: 16px;\n  overflow-x: auto;\n  overflow-y: hidden;\n  padding-bottom: 2px;\n}\n\n.ofs-batch {\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n\n.ofs-batch-thumbs {\n  display: flex;\n  gap: 3px;\n}\n\n.ofs-thumb {\n  appearance: none;\n  flex: 0 0 auto;\n  display: block;\n  width: 62px;\n  height: 62px;\n  padding: 0;\n  border: 2px solid transparent;\n  border-radius: 12px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  cursor: pointer;\n  transition:\n    transform 170ms cubic-bezier(0.22, 1, 0.36, 1),\n    border-color 170ms ease,\n    box-shadow 170ms ease;\n}\n\n.ofs-thumb img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ofs-thumb:hover {\n  transform: translateY(-2px);\n}\n\n.ofs-thumb.is-on {\n  border-color: var(--ofs-accent);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-accent) 20%, transparent);\n}\n\n.ofs-batch-meta {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 6px;\n  font-size: 10px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-batch-meta em {\n  font-style: normal;\n  font-size: 9px;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n/* 进行中的骨架卡 */\n.ofs-ghost {\n  flex: 0 0 auto;\n  width: 148px;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  gap: 8px;\n  padding: 11px 12px;\n  border: 1px dashed color-mix(in oklab, var(--ofs-accent) 36%, transparent);\n  border-radius: 14px;\n  background: linear-gradient(140deg, var(--ofs-accent-soft) 0%, transparent 78%);\n}\n\n.ofs-ghost-bar {\n  height: 34px;\n  border-radius: 10px;\n  background: linear-gradient(\n    90deg,\n    color-mix(in oklab, var(--ofs-accent) 10%, transparent) 0%,\n    color-mix(in oklab, var(--ofs-accent) 32%, transparent) 50%,\n    color-mix(in oklab, var(--ofs-accent) 10%, transparent) 100%\n  );\n  background-size: 220% 100%;\n  animation: ofs-shimmer 1.8s linear infinite;\n}\n\n.ofs-ghost-label {\n  font-size: 10.5px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-ghost-time {\n  font-size: 10px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 空态 */\n.ofs-filmstrip-empty {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  flex: 1 1 auto;\n  color: var(--ofs-ink-3);\n  font-size: 12px;\n}\n\n.ofs-slots {\n  display: flex;\n  gap: 6px;\n}\n\n.ofs-slot {\n  display: block;\n  width: 46px;\n  height: 46px;\n  border: 1px dashed var(--ofs-sunken-border);\n  border-radius: 12px;\n  background: color-mix(in oklab, var(--ofs-card) 60%, transparent);\n}\n\n/* 去画廊 */\n.ofs-filmstrip-side {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  align-self: stretch;\n  padding-left: 12px;\n  border-left: 1px solid var(--ofs-hairline);\n}\n\n.ofs-filmstrip-link {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 10px;\n  border: 0;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-filmstrip-link:hover {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}";

// src/styles/gallery.css
var gallery_default = "/*\n * 作品画廊：作品集式的卡片墙。\n *\n * 结构：\n *   .ofs-gallery          自身滚动容器（高度由 .ofs-main 决定）\n *     .ofs-gallery-tools  轻浮的玻璃工具卡：标题 / 搜索 / 模型 / 收藏 / 批量动作\n *     .ofs-gallery-group  今天 / 本周 / 更早\n *       .ofs-gallery-wall CSS columns 瀑布流：图片按原始宽高比自然高度\n *\n * 卡片是「图片 + 两行提示词 + 标签行」的白卡：圆角、描边、阴影全部来自\n * tokens.css；网格只负责列宽，不裁切图片、不拉伸比例。\n */\n\n/* ── 容器 ───────────────────────────────────────────────────── */\n.ofs-gallery {\n  /* 吸顶工具卡要贴住滚动口，padding-top 用变量参与 top 偏移，避免内容从顶部缝隙露出 */\n  --ofs-gallery-pad-top: 18px;\n  position: relative;\n  flex: 1 1 auto;\n  height: 100%;\n  min-height: 0;\n  overflow-y: auto;\n  overflow-x: hidden;\n  display: flex;\n  flex-direction: column;\n  gap: var(--ofs-gap);\n  padding: var(--ofs-gallery-pad-top) 20px 26px;\n  overscroll-behavior: contain;\n}\n\n.ofs-gallery.is-empty {\n  min-height: 360px;\n}\n\n/* ── 工具卡 ─────────────────────────────────────────────────── */\n.ofs-gallery-tools {\n  position: sticky;\n  top: calc(-1 * var(--ofs-gallery-pad-top));\n  z-index: 3;\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px 12px;\n  padding: 12px 14px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-window);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(18px) saturate(140%);\n  -webkit-backdrop-filter: blur(18px) saturate(140%);\n}\n\n.ofs-gallery-headline {\n  display: flex;\n  align-items: baseline;\n  gap: 9px;\n  min-width: 0;\n}\n\n.ofs-gallery-title {\n  font-size: 15px;\n  font-weight: 650;\n  letter-spacing: -0.01em;\n  line-height: 1.3;\n  color: var(--ofs-ink);\n  white-space: nowrap;\n}\n\n.ofs-gallery-count {\n  font-size: 12px;\n  line-height: 1.4;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-gallery-count b {\n  font-weight: 600;\n  color: var(--ofs-ink-2);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 搜索：胶囊内嵌放大镜 */\n.ofs-gallery-search {\n  position: relative;\n  display: flex;\n  align-items: center;\n  flex: 1 1 200px;\n  max-width: 320px;\n  height: 34px;\n  padding: 0 12px 0 32px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-3);\n  cursor: text;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    box-shadow 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-gallery-search:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-focus-ring);\n  color: var(--ofs-accent);\n}\n\n.ofs-gallery-search-icon {\n  position: absolute;\n  left: 11px;\n  top: 50%;\n  transform: translateY(-50%);\n  pointer-events: none;\n}\n\n.ofs-gallery-search-input {\n  width: 100%;\n  height: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n}\n\n.ofs-gallery-search-input::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-gallery-search-input:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-gallery-search-input::-webkit-search-cancel-button,\n.ofs-gallery-search-input::-webkit-search-decoration {\n  appearance: none;\n  -webkit-appearance: none;\n}\n\n/* 模型过滤：原生 select，外观融进胶囊体系 */\n.ofs-gallery-select {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  flex: 0 0 auto;\n}\n\n.ofs-gallery-select-input {\n  appearance: none;\n  -webkit-appearance: none;\n  height: 34px;\n  max-width: 200px;\n  padding: 0 30px 0 13px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  text-overflow: ellipsis;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease;\n}\n\n.ofs-gallery-select-input:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-card-solid);\n}\n\n.ofs-gallery-select-input:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-gallery-select-input option {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n}\n\n.ofs-gallery-select-caret {\n  position: absolute;\n  right: 11px;\n  top: 50%;\n  transform: translateY(-50%);\n  color: var(--ofs-ink-3);\n  pointer-events: none;\n}\n\n/* 工具条里的 chip 与输入同高，避免一排控件高低不齐 */\n.ofs-gallery-tools .ofs-chip {\n  height: 32px;\n  padding: 0 13px;\n  font-size: 12.5px;\n}\n\n.ofs-gallery-actions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  margin-left: auto;\n}\n\n.ofs-gallery-selected {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 32px;\n  padding: 0 12px;\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  font-size: 12px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.ofs-gallery-selected b {\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 分组：小字重对比 + 一条极淡分隔 ─────────────────────────── */\n.ofs-gallery-group {\n  flex: 0 0 auto;\n}\n\n.ofs-gallery-group-title {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin: 0 0 12px;\n  padding-left: 2px;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 600;\n  line-height: 1.4;\n  letter-spacing: 0.02em;\n}\n\n.ofs-gallery-group-title::after {\n  content: '';\n  flex: 1 1 auto;\n  height: 1px;\n  border-radius: 1px;\n  background: var(--ofs-hairline);\n}\n\n/* ── 卡片墙：CSS columns，图片按原始比例撑高 ─────────────────── */\n.ofs-gallery-wall {\n  column-count: 5;\n  column-gap: var(--ofs-gap);\n}\n\n.ofs-gallery-card {\n  display: block;\n  width: 100%;\n  margin: 0 0 var(--ofs-gap);\n  padding: 6px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-card);\n  color: var(--ofs-ink);\n  break-inside: avoid;\n  box-shadow: var(--ofs-shadow-card);\n  transition:\n    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 180ms ease,\n    border-color 180ms ease;\n}\n\n.ofs-gallery-card:hover {\n  transform: translateY(-2px);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-gallery-card.is-picked {\n  border-color: var(--ofs-accent);\n  box-shadow: var(--ofs-focus-ring), var(--ofs-shadow-card);\n}\n\n.ofs-gallery-card.is-picked:hover {\n  box-shadow: var(--ofs-focus-ring), var(--ofs-shadow-lift);\n}\n\n/* 图片区：按钮铺满，悬浮操作覆盖在图片底部 */\n.ofs-gallery-stage {\n  position: relative;\n  display: block;\n  border-radius: calc(var(--ofs-r-lg) - 7px);\n  overflow: hidden;\n  background: var(--ofs-sunken);\n}\n\n.ofs-gallery-media {\n  appearance: none;\n  position: relative;\n  display: block;\n  width: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  cursor: pointer;\n}\n\n.ofs-gallery-media img {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n/* 悬停操作：带回参数 / 生成变体 / 查看大图 */\n.ofs-gallery-hover {\n  position: absolute;\n  right: 6px;\n  bottom: 6px;\n  left: 6px;\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 4px;\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 150ms ease;\n}\n\n.ofs-gallery-card:hover .ofs-gallery-hover,\n.ofs-gallery-card:focus-within .ofs-gallery-hover {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n.ofs-gallery-action {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 22px;\n  padding: 0 7px;\n  border: 1px solid rgb(255 255 255 / 26%);\n  border-radius: var(--ofs-r-pill);\n  background: rgb(20 20 22 / 62%);\n  color: #fff;\n  font-size: 10px;\n  white-space: nowrap;\n  cursor: pointer;\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n}\n\n.ofs-gallery-action:hover {\n  background: rgb(20 20 22 / 82%);\n}\n\n/* 触屏设备没有 hover：操作条常显，否则手机上无法「带回参数 / 生成变体」。 */\n@media (hover: none) {\n  .ofs-gallery-hover {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n/* 批量选择：左上角圆点，选中后墨黑填充 */\n.ofs-gallery-pick {\n  position: absolute;\n  top: 9px;\n  left: 9px;\n  display: grid;\n  place-items: center;\n  width: 20px;\n  height: 20px;\n  border: 1.5px solid rgb(20 20 22 / 16%);\n  border-radius: 50%;\n  background: rgb(255 255 255 / 72%);\n  color: var(--ofs-accent-ink);\n  box-shadow: 0 1px 4px rgb(24 24 27 / 22%);\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease;\n}\n\n.ofs-gallery-pick.is-on {\n  border-color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n/* 收藏星标：右上角玻璃圆点，已收藏用墨黑 */\n.ofs-gallery-star {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  display: grid;\n  place-items: center;\n  width: 24px;\n  height: 24px;\n  border-radius: 50%;\n  background: color-mix(in oklab, var(--ofs-card-solid) 84%, transparent);\n  color: var(--ofs-ink);\n  box-shadow: 0 1px 4px rgb(24 24 27 / 22%);\n  backdrop-filter: blur(4px);\n  -webkit-backdrop-filter: blur(4px);\n}\n\n/* 卡身：两行提示词 + 标签行；整块可点开大图 */\n.ofs-gallery-body {\n  appearance: none;\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  width: 100%;\n  min-width: 0;\n  padding: 10px 8px 8px;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-gallery-caption {\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n  overflow: hidden;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  font-weight: 500;\n  line-height: 1.5;\n  word-break: break-word;\n}\n\n.ofs-gallery-tags {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.3;\n}\n\n.ofs-gallery-tags em {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--ofs-ink-3);\n  font-style: normal;\n  font-weight: 500;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-gallery-tags span {\n  flex: 0 0 auto;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 空态：一张柔光卡片，一句话 ─────────────────────────────── */\n.ofs-gallery-empty {\n  flex: 0 0 auto;\n  margin: auto;\n  width: 100%;\n  max-width: 380px;\n  padding: 40px 30px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-xl);\n  background:\n    radial-gradient(120% 150% at 50% -18%, color-mix(in oklab, var(--ofs-ink) 6%, transparent) 0%, transparent 62%),\n    var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  text-align: center;\n}\n\n.ofs-gallery-empty p {\n  color: var(--ofs-ink-2);\n  font-size: 13px;\n  line-height: 1.7;\n}\n\n.ofs-gallery-empty-actions {\n  display: flex;\n  justify-content: center;\n  margin-top: 14px;\n}\n\n/* ── 响应式 ─────────────────────────────────────────────────── */\n@media (max-width: 1400px) {\n  .ofs-gallery-wall {\n    column-count: 4;\n  }\n}\n\n@media (max-width: 1180px) {\n  .ofs-gallery {\n    --ofs-gallery-pad-top: 16px;\n    padding: 16px 18px 24px;\n  }\n\n  .ofs-gallery-wall {\n    column-count: 3;\n  }\n\n  .ofs-gallery-search {\n    max-width: 260px;\n  }\n}\n\n@media (max-width: 900px) {\n  .ofs-gallery-wall {\n    column-count: 2;\n  }\n\n  /* 窄窗里工具卡不再吸顶：它本身会折成两三行，吸顶太占高度 */\n  .ofs-gallery-tools {\n    position: static;\n  }\n}\n\n@media (max-width: 700px) {\n  .ofs-gallery {\n    --ofs-gallery-pad-top: 12px;\n    gap: 12px;\n    padding: 12px 12px 22px;\n  }\n\n  .ofs-gallery-tools {\n    gap: 8px;\n    padding: 10px 11px;\n  }\n\n  .ofs-gallery-search {\n    flex: 1 1 100%;\n    max-width: none;\n  }\n\n  .ofs-gallery-select-input {\n    max-width: 116px;\n  }\n\n  .ofs-gallery-tools .ofs-chip {\n    padding: 0 10px;\n  }\n\n  .ofs-gallery-empty {\n    padding: 32px 22px;\n  }\n}";

// src/styles/chat.css
var chat_default = "/*\n * 对话式面板：柔和消息流。\n *\n * 卡片外壳（背景 / 圆角 / 阴影 / 外边距）、头部与分段控件都由 panel.css 提供，\n * 这里只写卡片内部：消息流、空态、建议行与底部悬浮输入区。\n * 所有选择器挂在 .ofs-panel--chat 下，避免和表单式面板共用的类名互相影响；\n * 对话专属的类名统一用 ofs-chat- / ofs-msg- 前缀。\n */\n\n/* ── 消息流 ─────────────────────────────────────────────────── */\n/* 面板落在单轨布局的第一列；单独挂载预览时这句不影响其它容器。 */\n.ofs-panel--chat {\n  grid-column: 1;\n}\n\n.ofs-panel--chat .ofs-thread {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 6px 15px 10px;\n}\n\n/* 空态用 auto 外边距居中，内容超高时自然回到顶部可滚动，不会被裁掉。 */\n.ofs-panel--chat .ofs-thread.is-empty {\n  justify-content: flex-start;\n}\n\n.ofs-chat-empty {\n  display: flex;\n  flex-direction: column;\n  align-items: stretch;\n  gap: 13px;\n  margin: auto 0;\n  /* 稍微上提，避免视觉重心压在输入区上。 */\n  padding-bottom: 26px;\n  animation: ofs-fade-in 260ms ease both;\n}\n\n.ofs-chat-empty-text {\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  line-height: 1.7;\n  text-align: center;\n}\n\n.ofs-chat-examples {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n}\n\n.ofs-panel--chat .ofs-chat-example {\n  display: flex;\n  align-items: center;\n  height: auto;\n  min-height: 30px;\n  padding: 7px 12px;\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  line-height: 1.5;\n  text-align: left;\n  white-space: normal;\n}\n\n.ofs-panel--chat .ofs-chat-example:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* ── 消息 ───────────────────────────────────────────────────── */\n.ofs-panel--chat .ofs-msg {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  max-width: 100%;\n  min-width: 0;\n  animation: ofs-fade-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;\n}\n\n.ofs-panel--chat .ofs-msg p {\n  font-size: 12.5px;\n  line-height: 1.62;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* 用户：右对齐的浅灰底，右下角收小圆角但不出气泡尾巴。 */\n.ofs-panel--chat .ofs-msg--user {\n  align-self: flex-end;\n  max-width: 88%;\n  padding: 8px 13px;\n  border: 1px solid var(--ofs-accent-soft-border);\n  border-radius: 16px 16px 6px 16px;\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-ink);\n}\n\n/* 助手：整宽白卡，左上角收小圆角，跟用户消息形成对角呼应。 */\n.ofs-panel--chat .ofs-msg--assistant {\n  align-self: stretch;\n}\n\n.ofs-chat-author {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding-left: 2px;\n}\n\n.ofs-chat-author-name {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.04em;\n}\n\n.ofs-chat-dot {\n  flex: 0 0 auto;\n}\n\n/* 排队与渲染中：状态点换成琥珀色呼吸，不用转圈。 */\n.ofs-panel--chat .ofs-chat-dot.is-live {\n  animation: ofs-chat-breathe 2.2s ease-out infinite;\n}\n\n@keyframes ofs-chat-breathe {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 36%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n}\n\n.ofs-msg-card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 13px 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 6px 16px 16px 16px;\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n/* 生成中：卡片留一条柔光微光条，扫过即表示在跑。 */\n.ofs-chat-shimmer {\n  display: block;\n  width: 58%;\n  height: 3px;\n  margin-top: -2px;\n  border-radius: var(--ofs-r-pill);\n  background: linear-gradient(90deg, transparent 0%, var(--ofs-accent-2) 52%, transparent 100%);\n  background-size: 220% 100%;\n  opacity: 0.62;\n  animation: ofs-shimmer 2s linear infinite;\n}\n\n/* 意图确认卡：整理后的提示词、比例与风格，一个提交按钮。 */\n.ofs-intent {\n  gap: 7px;\n}\n\n.ofs-intent-title {\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-intent-prompt {\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  line-height: 1.55;\n  word-break: break-word;\n}\n\n.ofs-intent-question {\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n}\n\n.ofs-intent-meta {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-intent-note {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.5;\n}\n\n.ofs-intent-go {\n  align-self: flex-start;\n  height: 30px;\n  margin-top: 2px;\n  padding: 0 14px;\n  border-radius: 10px;\n  font-size: 12px;\n}\n\n/* 结果缩略图：整宽图片卡，元信息压在右下角。 */\n.ofs-msg-thumb {\n  appearance: none;\n  position: relative;\n  display: block;\n  width: 100%;\n  margin-top: 1px;\n  padding: 0;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 12px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  cursor: pointer;\n  transition:\n    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 180ms ease,\n    border-color 180ms ease;\n}\n\n.ofs-msg-thumb img {\n  display: block;\n  width: 100%;\n  height: 132px;\n  object-fit: cover;\n}\n\n.ofs-msg-thumb:hover {\n  transform: translateY(-1px);\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-msg-thumb:active {\n  transform: translateY(0) scale(0.995);\n}\n\n.ofs-msg-thumb-meta {\n  position: absolute;\n  right: 7px;\n  bottom: 7px;\n  padding: 2px 8px;\n  border-radius: var(--ofs-r-pill);\n  background: rgb(17 17 20 / 52%);\n  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n  color: rgb(255 255 255 / 93%);\n  font-size: 10px;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: 0.01em;\n}\n\n/* ── 底部：建议 / 动作 / 输入 ────────────────────────────────── */\n.ofs-chat-dock {\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 15px 14px;\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-chat-tools {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-panel--chat .ofs-chat-tools .ofs-chip {\n  height: 27px;\n  padding: 0 11px;\n  font-size: 11.5px;\n}\n\n/* 输入区：白/玻璃的圆角卡，靠内发光描边和柔影浮起来。 */\n.ofs-chat-composer {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  padding: 9px 9px 9px 12px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: linear-gradient(180deg, var(--ofs-card-solid) 0%, var(--ofs-card) 100%);\n  box-shadow:\n    inset 0 1px 0 var(--ofs-window-border),\n    var(--ofs-shadow-card);\n  transition:\n    border-color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-chat-composer:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow:\n    inset 0 1px 0 var(--ofs-window-border),\n    0 0 0 3px color-mix(in oklab, var(--ofs-accent) 12%, transparent),\n    var(--ofs-shadow-card);\n}\n\n.ofs-chat-composer textarea {\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 42px;\n  max-height: 128px;\n  padding: 2px 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  line-height: 1.6;\n  resize: none;\n  overflow-y: auto;\n  /* 支持的浏览器里让输入框随内容长到 max-height；不支持时退化成固定两行。 */\n  field-sizing: content;\n}\n\n.ofs-chat-composer textarea:focus,\n.ofs-chat-composer textarea:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-chat-composer textarea::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n/* 发送：墨黑实心圆钮（深色主题由 tokens 反相成浅灰），hover 轻抬升，禁用降饱和。 */\n.ofs-chat-send {\n  appearance: none;\n  flex: 0 0 auto;\n  display: grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  padding: 0;\n  border: 0;\n  border-radius: 50%;\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n  box-shadow: var(--ofs-shadow-accent);\n  cursor: pointer;\n  transition:\n    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 160ms ease,\n    background-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-chat-send:hover:not(:disabled) {\n  transform: translateY(-1px);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-chat-send:active:not(:disabled) {\n  transform: translateY(0) scale(0.94);\n}\n\n.ofs-chat-send:disabled {\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-4);\n  box-shadow: none;\n  filter: saturate(0);\n  cursor: default;\n}\n\n/* 窄窗下面板被压到 46vh：收紧留白，让最后两条消息仍然可见。 */\n@media (max-width: 820px) {\n  .ofs-panel--chat .ofs-thread {\n    padding: 0 13px 8px;\n  }\n\n  .ofs-chat-dock {\n    padding: 8px 13px 12px;\n  }\n\n  .ofs-msg-thumb img {\n    height: 112px;\n  }\n}\n\n/* 动效停用时，微光条改成一条静态浅色线，信息不丢。 */\n@media (prefers-reduced-motion: reduce) {\n  .ofs-chat-shimmer {\n    background: var(--ofs-accent-soft-border);\n    opacity: 0.9;\n    animation: none;\n  }\n\n  .ofs-panel--chat .ofs-chat-dot.is-live {\n    animation: none;\n  }\n}";

// src/styles/responsive.css
var responsive_default = "/*\n * 响应式：这是桌面端的整页工作台，先保桌面；窄窗口按「面板在上、画布在下」收，\n * 不把桌面布局硬挤成不可用的三列。\n */\n\n@media (max-width: 1280px) {\n  .ofs-preset-meta {\n    display: none;\n  }\n}\n\n@media (max-width: 1120px) {\n  .ofs-brand-sub {\n    display: none;\n  }\n\n  .ofs-preset-label {\n    display: none;\n  }\n\n  .ofs-preset select {\n    max-width: 132px;\n  }\n\n  .ofs-dock-button {\n    padding: 0 9px;\n    font-size: 11px;\n  }\n}\n\n@media (max-width: 980px) {\n  .ofs-root {\n    padding: 10px;\n  }\n\n  .ofs-app {\n    border-radius: var(--ofs-r-lg);\n  }\n\n  .ofs-topbar {\n    gap: 10px;\n    padding: 0 12px;\n    height: 54px;\n  }\n\n  .ofs-brand-name {\n    font-size: 13px;\n  }\n\n  .ofs-tab {\n    padding: 0 9px;\n    font-size: 12px;\n  }\n\n  .ofs-panel {\n    margin: 10px 0 10px 10px;\n  }\n\n  .ofs-main {\n    margin: 10px;\n  }\n\n  .ofs-filmstrip {\n    margin: 0 10px 10px;\n    min-height: 84px;\n    padding: 8px 10px;\n    border-radius: var(--ofs-r-md);\n  }\n\n  .ofs-thumb {\n    width: 54px;\n    height: 54px;\n    border-radius: 10px;\n  }\n\n  .ofs-stage-foot {\n    flex-wrap: wrap;\n    gap: 6px;\n  }\n\n  .ofs-stage-meta {\n    font-size: 10.5px;\n  }\n\n  .ofs-dock {\n    gap: 4px;\n  }\n\n  .ofs-dock-button {\n    height: 28px;\n    padding: 0 8px;\n    font-size: 10.5px;\n    gap: 4px;\n  }\n\n  .ofs-figure {\n    padding: 10px;\n    border-radius: var(--ofs-r-lg);\n  }\n\n  .ofs-image {\n    border-radius: 12px;\n  }\n}\n\n/* 窄窗：面板在上、画面预览在下 */\n@media (max-width: 820px) {\n  .ofs-root {\n    padding: 8px;\n    font-size: 12.5px;\n  }\n\n  .ofs-topbar {\n    flex-wrap: wrap;\n    height: auto;\n    min-height: 52px;\n    padding: 8px 10px;\n    row-gap: 6px;\n  }\n\n  .ofs-tabs {\n    margin-left: 0;\n    order: 3;\n    flex: 1 1 100%;\n    justify-content: flex-start;\n  }\n\n  .ofs-compute em {\n    display: none;\n  }\n\n  .ofs-preset {\n    margin-left: auto;\n  }\n\n  .ofs-body,\n  .ofs-body.is-gallery {\n    display: flex;\n    flex-direction: column;\n    overflow-y: auto;\n    overflow-x: hidden;\n  }\n\n  .ofs-panel {\n    flex: 0 0 auto;\n    margin: 8px 8px 0;\n    max-height: none;\n  }\n\n  .ofs-main {\n    flex: 0 0 auto;\n    min-height: 340px;\n    height: 62vh;\n    margin: 8px;\n  }\n\n  .ofs-stage {\n    min-height: 300px;\n  }\n\n  .ofs-figure {\n    min-height: 240px;\n  }\n\n  .ofs-image {\n    max-height: 42vh;\n  }\n\n  .ofs-filmstrip {\n    display: none;\n  }\n\n  .ofs-panel-head {\n    padding: 12px 13px 9px;\n  }\n\n  .ofs-panel-scroll {\n    padding: 0 13px 12px;\n  }\n\n  .ofs-panel-foot {\n    padding: 10px 13px 12px;\n  }\n\n  .ofs-toast {\n    bottom: 24px;\n    max-width: 86%;\n  }\n\n  .ofs-stage-foot {\n    padding: 0 2px;\n  }\n\n  .ofs-stage-prompt {\n    flex: 1 1 100%;\n  }\n\n  .ofs-dock {\n    flex: 1 1 100%;\n    flex-wrap: wrap;\n  }\n\n  .ofs-tile-label {\n    font-size: 9.5px;\n  }\n\n  .ofs-composer-input {\n    min-height: 76px;\n  }\n}\n\n@media (max-width: 520px) {\n  .ofs-brand-name {\n    font-size: 12.5px;\n  }\n\n  .ofs-tab {\n    height: 26px;\n    padding: 0 8px;\n    font-size: 11.5px;\n  }\n\n  .ofs-preset select {\n    max-width: 108px;\n    font-size: 11.5px;\n  }\n\n  .ofs-compute {\n    height: 30px;\n    padding: 0 9px;\n  }\n\n  .ofs-preset {\n    height: 30px;\n  }\n\n  .ofs-panel-head h2 {\n    font-size: 14px;\n  }\n\n  .ofs-empty-title {\n    font-size: 15px;\n  }\n}";

// src/styles.js
var CSS = [tokens_default, base_default, shell_default, panel_default, stage_default, filmstrip_default, gallery_default, chat_default, responsive_default].join("\n");

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

// src/studio/icons.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var SHAPES = {
  // 胶片与时装：风格预设用
  film: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "5.5", width: "18", height: "13", rx: "1.8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.5 5.5v13M16.5 5.5v13" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.6 8.6h3.9M3.6 12h3.9M3.6 15.4h3.9M16.5 8.6h3.9M16.5 12h3.9M16.5 15.4h3.9" })
  ] }),
  palette: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3.6a8.4 8.4 0 0 0 0 16.8h1.1a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3h1.5a3.8 3.8 0 0 0 3.8-3.8c0-3.6-4.2-6.4-9.4-6.4z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8.4", cy: "9.2", r: "1.05" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "7.4", r: "1.05" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "15.6", cy: "9.2", r: "1.05" })
  ] }),
  skyline: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.5 20.2V11.4l3.8-1.9v10.7" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.3 20.2V6.6l4.6-1.9v15.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11.9 20.2V13l3.8-1.9v9.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15.7 20.2V9.6l4.8 2.2v8.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.6 20.2h18.8" })
  ] }),
  mountains: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.2 17.6 8.6 9.8l3.1 4.1 2.2-2.8 5.9 6.5z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.2 20.2h17.6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.4 12.9l1.7 1.1 1.3-1.6" })
  ] }),
  cube: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3.4 19.6 7.6v8.8L12 20.6 4.4 16.4V7.6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.4 7.6 12 11.8l7.6-4.2M12 11.8v8.8" })
  ] }),
  // 提示词动作
  expandText: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 6.6h9.4M4 11h6.2M4 15.4h9.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M17.8 17.4V8.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15.1 10.8l2.7-2.7 2.7 2.7" })
  ] }),
  focus: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 8.6V6.2a2.2 2.2 0 0 1 2.2-2.2h2.4M15.4 4h2.4A2.2 2.2 0 0 1 20 6.2v2.4M20 15.4v2.4a2.2 2.2 0 0 1-2.2 2.2h-2.4M8.6 20H6.2A2.2 2.2 0 0 1 4 17.8v-2.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "2.5" })
  ] }),
  sun: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "3.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M18.3 5.7l-1.5 1.5M7.2 16.8l-1.5 1.5" })
  ] }),
  // 通用
  star: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 4.4l2.35 4.76 5.25.77-3.8 3.7.9 5.24L12 16.39l-4.7 2.48.9-5.24-3.8-3.7 5.25-.77z" }),
  starFilled: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M12 4.4l2.35 4.76 5.25.77-3.8 3.7.9 5.24L12 16.39l-4.7 2.48.9-5.24-3.8-3.7 5.25-.77z",
      fill: "currentColor",
      stroke: "none"
    }
  ),
  alert: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 4.6 20.2 19H3.8z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 9.8v4.1M12 16.7v.1" })
  ] }),
  chevronDown: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.4 9.6 12 15.2l5.6-5.6" }),
  arrowUp: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 19.4V4.9" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.9 11 12 4.9 18.1 11" })
  ] }),
  copy: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "8.4", y: "8.4", width: "11.2", height: "11.2", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15.6 5.2H6.6a1.4 1.4 0 0 0-1.4 1.4v9" })
  ] }),
  reroll: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19.4 12a7.4 7.4 0 1 1-2.2-5.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19.8 4.6v4.8h-4.8" })
  ] }),
  sliders: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 8.4h8.4M17.2 8.4h2.8M4 15.6h2.8M11.6 15.6h8.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "14.8", cy: "8.4", r: "1.9" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "9.2", cy: "15.6", r: "1.9" })
  ] }),
  image: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3.4", y: "5", width: "17.2", height: "14", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.4 15.3 8 11l3.4 2.9 3-2.4 5.2 4.6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8.6", cy: "9.4", r: "1.25" })
  ] }),
  folder: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.4 7.4a2 2 0 0 1 2-2h3.5l1.8 2.2h7.9a2 2 0 0 1 2 2v7.9a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z" }),
  close: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" }),
  dot: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "2.6", fill: "currentColor", stroke: "none" }),
  // 导航与面板
  sparkles: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11.4 4.2 12.9 8l3.8 1.5-3.8 1.5-1.5 3.8-1.5-3.8L6.1 9.5 9.9 8z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M17.6 14.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.4 15.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" })
  ] }),
  message: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.4 7.2a2.8 2.8 0 0 1 2.8-2.8h9.6a2.8 2.8 0 0 1 2.8 2.8v6.2a2.8 2.8 0 0 1-2.8 2.8H9.6l-3.7 3v-3h-.7a.8.8 0 0 1-.8-.8z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8.4 9.6h7.2M8.4 12.8h4.4" })
  ] }),
  images: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "6.4", y: "5.2", width: "13.4", height: "11.4", rx: "2.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.6 8.6v8.6a2.2 2.2 0 0 0 2.2 2.2h9" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.4 13.4 9.8 10l2.6 2.4 2.1-1.7 3.7 3.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "15.2", cy: "8.6", r: "1.1" })
  ] }),
  expand: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.4 9V5.6a1.2 1.2 0 0 1 1.2-1.2H9M15 4.4h3.4a1.2 1.2 0 0 1 1.2 1.2V9M19.6 15v3.4a1.2 1.2 0 0 1-1.2 1.2H15M9 19.6H5.6a1.2 1.2 0 0 1-1.2-1.2V15" }) }),
  dots: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "6.2", cy: "12", r: "1.4", fill: "currentColor", stroke: "none" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "1.4", fill: "currentColor", stroke: "none" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "17.8", cy: "12", r: "1.4", fill: "currentColor", stroke: "none" })
  ] }),
  plus: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5.4v13.2M5.4 12h13.2" }),
  search: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10.9", cy: "10.9", r: "6.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15.4 15.4 20 20" })
  ] }),
  refresh: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19.4 12a7.4 7.4 0 1 1-2.2-5.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19.8 4.6v4.8h-4.8" })
  ] }),
  check: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.4 12.6 9.6 16.8 18.6 7.8" }),
  chevronRight: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.6 6.4 15.2 12l-5.6 5.6" }),
  cloud: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.4 18.2a3.8 3.8 0 0 1-.5-7.6 5.2 5.2 0 0 1 10-1.2 4.3 4.3 0 0 1 .9 8.4" }),
  clock: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "7.8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 7.6V12l3 1.8" })
  ] })
};
function Icon(props) {
  const name = props.name;
  const size = props.size || 16;
  const shape = SHAPES[name] || null;
  if (!shape) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      className: props.className ? `ofs-icon ${props.className}` : "ofs-icon",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: shape
    }
  );
}

// src/studio/capsules.js
var STYLE_CAPSULES = [
  {
    id: "film",
    icon: "film",
    labelKey: "studio.style.photo",
    suffix: "cinematic film photography, 35mm, natural skin texture, soft grain",
    negative: "blurry, low quality, distorted, text, watermark"
  },
  {
    id: "concept",
    icon: "palette",
    labelKey: "studio.style.concept",
    suffix: "concept art, painterly, dramatic lighting, detailed brushwork",
    negative: "photo, blurry, low quality, text, watermark"
  },
  {
    id: "cyberpunk",
    icon: "skyline",
    labelKey: "studio.style.cyberpunk",
    suffix: "cyberpunk neon city, volumetric light, reflective surfaces, night atmosphere",
    negative: "daylight, blurry, low quality, deformed, text"
  },
  {
    id: "ink",
    icon: "mountains",
    labelKey: "studio.style.ink",
    suffix: "traditional chinese ink wash painting, rice paper texture, negative space",
    negative: "photo, 3d, saturated colors, blurry, text"
  },
  {
    id: "clay",
    icon: "cube",
    labelKey: "studio.style.clay",
    suffix: "clay render, soft studio light, pastel palette, playful proportions",
    negative: "photo, harsh shadows, blurry, distorted, text"
  }
];

// src/studio/ChatPanel.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var EXAMPLES = ["studio.inspire.1", "studio.inspire.2", "studio.inspire.3", "studio.inspire.4", "studio.inspire.5"];
var WORKING_STAGES = ["pending", "queued", "running"];
function isWorking(stage) {
  return WORKING_STAGES.indexOf(stage) >= 0;
}
function dotClass(stage) {
  if (stage === "failed") return "ofs-dot ofs-chat-dot is-error";
  if (isWorking(stage)) return "ofs-dot ofs-chat-dot is-warn is-live";
  return "ofs-dot ofs-chat-dot is-ok";
}
function styleLabel(t, styleId) {
  const capsule = STYLE_CAPSULES.find((item) => item.id === styleId);
  return capsule ? t(capsule.labelKey) : t("studio.chat.styleAuto");
}
function ratioLabel(t, ratioId) {
  return ratioId || t("studio.chat.ratioAuto");
}
function ChatPanel(props) {
  const { t, ui, form, chat, library, actions } = props;
  const { panelMode: mode, setPanelMode: setMode } = ui;
  const { patchForm } = form;
  const { messages, interpreting, interpret, generateIntent, resolveClarify, clearThread } = chat;
  const { openMessage: openImage } = library;
  const { sending } = actions;
  const [draft, setDraft] = import_react2.default.useState("");
  const threadRef = import_react2.default.useRef(null);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastStage = lastMessage && lastMessage.stage || "";
  import_react2.default.useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [messages.length, lastStage, interpreting]);
  function send() {
    const text = draft.trim();
    if (!text || sending || interpreting) return;
    setDraft("");
    interpret(text);
  }
  function openMessage(message) {
    if (message.onOpen) message.onOpen();
    else if (message.imagePath) openImage(message.imagePath);
  }
  function renderIntent(message) {
    const clarify = message.clarify;
    if (clarify) {
      const isRatio = clarify.field === "ratio";
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-msg-card ofs-intent", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-intent-title", children: t("studio.chat.clarify.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ofs-intent-question", children: isRatio ? t("studio.chat.clarify.ratio") : t("studio.chat.clarify.style") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-suggestions", children: [
          clarify.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "ofs-suggestion",
              onClick: () => resolveClarify(message.id, clarify.field, option),
              children: isRatio ? option : styleLabel(t, option)
            },
            option
          )),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ofs-suggestion", onClick: () => resolveClarify(message.id, clarify.field, ""), children: t("studio.chat.clarify.auto") })
        ] })
      ] }, message.id);
    }
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-msg-card ofs-intent", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-intent-title", children: t("studio.chat.intent.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ofs-intent-prompt", children: message.prompt }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-intent-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: ratioLabel(t, message.ratioId) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": "true", children: "·" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: styleLabel(t, message.styleId) })
      ] }),
      message.source === "local" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ofs-intent-note", children: t("studio.chat.intent.local") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-btn is-primary ofs-intent-go",
          onClick: () => generateIntent(message),
          disabled: sending,
          children: sending ? t("studio.generating") : t("studio.chat.intent.generate")
        }
      )
    ] }, message.id);
  }
  function renderAssistant(message) {
    if (message.kind === "intent") return renderIntent(message);
    if (message.kind === "error") {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-msg-card", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: message.text }) }, message.id);
    }
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-msg-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: message.text }),
      isWorking(message.stage) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-chat-shimmer", "aria-hidden": "true" }) : null,
      message.image ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "button",
        {
          type: "button",
          className: "ofs-msg-thumb",
          onClick: () => openMessage(message),
          title: message.meta || void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: message.image, alt: "", loading: "lazy" }),
            message.meta ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-msg-thumb-meta", children: message.meta }) : null
          ]
        }
      ) : null
    ] }, message.id);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("aside", { className: "ofs-panel ofs-panel--chat", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "ofs-panel-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: t("studio.rail.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-seg", role: "tablist", "aria-label": t("studio.rail.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        className: messages.length === 0 && !interpreting ? "ofs-thread is-empty" : "ofs-thread",
        ref: threadRef,
        role: "log",
        "aria-live": "polite",
        children: [
          messages.length === 0 && !interpreting ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-chat-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ofs-chat-empty-text", children: t("studio.chat.empty") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-chat-examples", children: EXAMPLES.map((key) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: "ofs-chip ofs-chat-example",
                onClick: () => {
                  patchForm({ prompt: t(key) });
                  setDraft(t(key));
                },
                title: t(key),
                children: t(`${key}.label`)
              },
              key
            )) })
          ] }) : null,
          messages.map((message) => message.role === "user" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-msg ofs-msg--user", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: message.text }) }, message.id) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-msg ofs-msg--assistant", children: [
            message.kind === "intent" || message.kind === "error" ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-chat-author", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: dotClass(message.stage), "aria-hidden": "true" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-chat-author-name", children: t("studio.chat.assistant") })
            ] }),
            renderAssistant(message)
          ] }, message.id)),
          interpreting ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-msg ofs-msg--assistant", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-msg-card is-working", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("studio.chat.parsing") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "ofs-chat-shimmer", "aria-hidden": "true" })
          ] }) }) : null
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-chat-dock", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ofs-chat-tools", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ofs-chip", onClick: clearThread, disabled: messages.length === 0, children: t("studio.chat.clear") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-chat-composer", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "textarea",
          {
            rows: 2,
            value: draft,
            maxLength: LIMITS.prompt.maxChars,
            placeholder: t("studio.chat.placeholder"),
            "aria-label": t("studio.chat.placeholder"),
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              if (event.nativeEvent && event.nativeEvent.isComposing) return;
              event.preventDefault();
              send();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chat-send",
            onClick: send,
            disabled: sending || interpreting || draft.trim().length === 0,
            "aria-label": t("studio.chat.send"),
            title: t("studio.chat.send"),
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "arrowUp", size: 15 })
          }
        )
      ] })
    ] })
  ] });
}

// src/studio/Filmstrip.jsx
var import_react3 = __toESM(require("react"), 1);
var import_jsx_runtime3 = require("react/jsx-runtime");
function Filmstrip(props) {
  const { t, ui, compute, library, elapsedMs } = props;
  const { setView } = ui;
  const { activeJob, sessionState, queued: sessionQueued, startSession: startSession2 } = compute;
  const { batches, selected, selectImage } = library;
  const selectedPath = selected && selected.image ? selected.image.path : "";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("footer", { className: "ofs-filmstrip", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-roll", children: [
      activeJob ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-ghost", role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-ghost-bar", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-ghost-label", children: sessionQueued ? t("studio.ghost.queued") : t("studio.ghost.rendering") }),
        formatDuration(t, elapsedMs) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-ghost-time", children: formatDuration(t, elapsedMs) }) : null
      ] }) : null,
      batches.length === 0 && !activeJob ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-filmstrip-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-slots", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-slot" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-slot" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-slot" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
          sessionState === "absent" ? t("studio.filmstrip.offline") : t("studio.filmstrip.empty"),
          sessionState === "absent" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-link", onClick: startSession2, children: t("studio.compute.start") }) : null
        ] })
      ] }) : null,
      batches.map((batch) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-batch", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-batch-thumbs", children: batch.entries.map((entry) => {
          const path = entry.image.path || entry.image.file;
          const active = path === selectedPath;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: active ? "ofs-thumb is-on" : "ofs-thumb",
              onClick: () => selectImage(entry),
              title: batch.prompt || path,
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { src: entry.image.url, alt: entry.image.file || "thumb", loading: "lazy" })
            },
            path
          );
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ofs-batch-meta", children: [
          batch.presetId ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", { children: batch.presetId }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", {}),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            batch.entries.length,
            " ",
            t("unit.image")
          ] })
        ] })
      ] }, batch.key))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-filmstrip-side", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", className: "ofs-filmstrip-link", onClick: () => setView("gallery"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "images", size: 15 }),
      t("studio.gallery.title"),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "chevronRight", size: 13 })
    ] }) })
  ] });
}

// src/studio/Gallery.jsx
var import_react4 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
var DAY = 24 * 60 * 60 * 1e3;
var BUCKETS = ["today", "week", "earlier"];
function bucketOf(time, now) {
  if (!Number.isFinite(time)) return "earlier";
  const diff = now - time;
  if (diff < DAY) return "today";
  if (diff < 7 * DAY) return "week";
  return "earlier";
}
function keyOf(entry) {
  return entry.image.path || entry.image.file;
}
function aspectOf(entry) {
  const { image, item } = entry;
  const width = Number(image && image.width) || Number(item && item.params && item.params.width) || 0;
  const height = Number(image && image.height) || Number(item && item.params && item.params.height) || 0;
  if (width > 0 && height > 0) return String(width / height);
  return "";
}
function presetNameOf(presets, id) {
  const found = (presets || []).find((preset) => preset && preset.id === id);
  return found && found.label || id;
}
function Gallery(props) {
  const { t, gallery, now, presets, favorites, onOpen, onZoom, onDelete, onExport, onRecall, onVariant } = props;
  const [presetFilter, setPresetFilter] = import_react4.default.useState("");
  const [favoriteOnly, setFavoriteOnly] = import_react4.default.useState(false);
  const [selecting, setSelecting] = import_react4.default.useState(false);
  const [picked, setPicked] = import_react4.default.useState([]);
  const [confirming, setConfirming] = import_react4.default.useState(false);
  const [keyword, setKeyword] = import_react4.default.useState("");
  const items = Array.isArray(gallery) ? gallery : [];
  const favoriteSet = new Set(favorites ?? []);
  const groups = { today: [], week: [], earlier: [] };
  for (const entry of items) {
    if (presetFilter && entry.item.presetId !== presetFilter) continue;
    const key = keyOf(entry);
    if (favoriteOnly && !favoriteSet.has(key)) continue;
    if (keyword.trim()) {
      const needle = keyword.trim().toLowerCase();
      const haystack = [entry.item.prompt, entry.item.presetId, entry.item.jobId, key].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const time = Date.parse(entry.item.finishedAt || entry.item.createdAt || entry.item.mtime || "");
    groups[bucketOf(time, now)].push(entry);
  }
  const usedPresets = [...new Set(items.map((entry) => entry.item.presetId).filter(Boolean))];
  const visibleCount = BUCKETS.reduce((total, bucket) => total + groups[bucket].length, 0);
  const visiblePaths = BUCKETS.flatMap((bucket) => groups[bucket].map((entry) => keyOf(entry)));
  function togglePick(key) {
    setPicked((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }
  function exitSelect() {
    setSelecting(false);
    setPicked([]);
    setConfirming(false);
  }
  function clearFilters() {
    setKeyword("");
    setPresetFilter("");
    setFavoriteOnly(false);
  }
  async function confirmDelete() {
    if (picked.length === 0) return;
    const result = await onDelete(picked);
    if (result && Array.isArray(result.failed) && result.failed.length > 0) {
      setConfirming(false);
      return;
    }
    exitSelect();
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: visibleCount === 0 ? "ofs-gallery is-empty" : "ofs-gallery", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-gallery-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-gallery-headline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { className: "ofs-gallery-title", children: t("studio.gallery.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-gallery-count", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { children: visibleCount }),
          " ",
          t("unit.image")
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "ofs-gallery-search", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "search", size: 15, className: "ofs-gallery-search-icon" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            className: "ofs-gallery-search-input",
            type: "search",
            value: keyword,
            placeholder: t("studio.gallery.search"),
            "aria-label": t("studio.gallery.search"),
            onChange: (event) => setKeyword(event.target.value)
          }
        )
      ] }),
      usedPresets.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-gallery-select", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "select",
          {
            className: "ofs-gallery-select-input",
            value: presetFilter,
            "aria-label": t("studio.gallery.allPresets"),
            onChange: (event) => setPresetFilter(event.target.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: t("studio.gallery.allPresets") }),
              usedPresets.map((id) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: id, children: presetNameOf(presets, id) }, id))
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "chevronDown", size: 13, className: "ofs-gallery-select-caret" })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "button",
        {
          type: "button",
          className: favoriteOnly ? "ofs-chip is-on" : "ofs-chip",
          "aria-pressed": favoriteOnly,
          onClick: () => setFavoriteOnly((value) => !value),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: favoriteOnly ? "starFilled" : "star", size: 13 }),
            t("studio.gallery.favoriteOnly")
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ofs-gallery-actions", children: selecting ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-gallery-selected", children: [
          t("studio.gallery.selectedCount"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { children: picked.length })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ofs-chip", onClick: exitSelect, children: t("studio.gallery.cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "button",
          {
            type: "button",
            className: "ofs-chip",
            onClick: () => onExport(picked),
            disabled: picked.length === 0,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "copy", size: 13 }),
              t("studio.gallery.export")
            ]
          }
        ),
        confirming ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip is-danger",
            onClick: confirmDelete,
            disabled: picked.length === 0,
            children: t("studio.gallery.confirmDelete")
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip is-danger",
            onClick: () => setConfirming(true),
            disabled: picked.length === 0,
            children: t("studio.gallery.delete")
          }
        )
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ofs-chip", onClick: () => setSelecting(true), disabled: items.length === 0, children: t("studio.gallery.select") }) })
    ] }),
    visibleCount === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ofs-gallery-empty", children: items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("studio.gallery.noMatch") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ofs-gallery-empty-actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ofs-chip", onClick: clearFilters, children: t("studio.gallery.clearFilters") }) })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("studio.gallery.empty") }) }) : BUCKETS.map((bucket) => {
      const entries = groups[bucket];
      if (entries.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "ofs-gallery-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { className: "ofs-gallery-group-title", children: t(`studio.gallery.${bucket}`) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ofs-gallery-wall", children: entries.map((entry) => {
          const key = keyOf(entry);
          const checked = picked.includes(key);
          const favorite = favoriteSet.has(key);
          const aspect = aspectOf(entry);
          const prompt = entry.item.prompt || "";
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: checked ? "ofs-gallery-card is-picked" : "ofs-gallery-card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-gallery-stage", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                "button",
                {
                  type: "button",
                  className: "ofs-gallery-media",
                  style: aspect ? { aspectRatio: aspect } : void 0,
                  title: prompt || key,
                  "aria-pressed": selecting ? checked : void 0,
                  onClick: () => selecting ? togglePick(key) : onOpen(entry),
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { src: entry.image.url, alt: prompt || entry.image.file || "thumb", loading: "lazy" }),
                    selecting ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: checked ? "ofs-gallery-pick is-on" : "ofs-gallery-pick", "aria-hidden": "true", children: checked ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "check", size: 11 }) : null }) : null,
                    favorite ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-gallery-star", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "starFilled", size: 12 }) }) : null
                  ]
                }
              ),
              selecting ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ofs-gallery-hover", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onRecall(entry), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "focus", size: 12 }),
                  t("studio.action.iterate")
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onVariant(entry), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "reroll", size: 12 }),
                  t("studio.action.reroll")
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onZoom(entry), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "expand", size: 12 }),
                  t("studio.gallery.open")
                ] })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "button",
              {
                type: "button",
                className: "ofs-gallery-body",
                onClick: () => selecting ? togglePick(key) : onOpen(entry),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-gallery-caption", children: prompt || "—" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-gallery-tags", children: [
                    entry.item.presetId ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("em", { children: entry.item.presetId }) : null,
                    entry.image.seed != null ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
                      "#",
                      entry.image.seed
                    ] }) : null
                  ] })
                ]
              }
            )
          ] }, key);
        }) })
      ] }, bucket);
    })
  ] });
}

// src/studio/GuidanceCard.jsx
var import_react5 = __toESM(require("react"), 1);

// src/logic/guidance.js
var KAGGLE_SETTINGS_URL = "https://www.kaggle.com/settings/api";
var KAGGLE_INSTALL_COMMAND = "pip install -U kaggle";
var SESSION_CODES = /* @__PURE__ */ new Set([
  "push_failed",
  "queue_timeout",
  "tunnel_timeout",
  "health_failed",
  "remote_error",
  "session_error",
  "session_timeout",
  "session_absent",
  "disposed"
]);
var GENERATION_CODES = /* @__PURE__ */ new Set([
  "generation_failed",
  "generate_failed",
  "load_failed",
  "invalid_request",
  "empty_result",
  "invalid_prompt",
  "queue_full",
  "warming"
]);
function guidanceKindOf(code) {
  if (!code) return "";
  if (code === "need_prompt") return "";
  if (code === "oom") return "oom";
  if (code === "session_ended" || code === "stopped") return "sleep";
  if (code === "cli_missing") return "cli";
  if (code === "auth_required") return "auth";
  if (SESSION_CODES.has(code)) return "session";
  if (GENERATION_CODES.has(code)) return "generate";
  return "generic";
}
function shortText(value, max = 240) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function guidanceDetailOf(input) {
  const source = input || {};
  const session = source.session || null;
  const job = source.job || null;
  const candidates = [
    source.error && source.error.message,
    session && session.error && session.error.message,
    job && job.error && job.error.message,
    session && session.detail
  ];
  for (const candidate of candidates) {
    const text = shortText(candidate);
    if (text) return text;
  }
  return "";
}

// src/studio/GuidanceCard.jsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function GuidanceCard(props) {
  const { t, guidance, compute, actions, ui } = props;
  const { kind, detail, dismiss } = guidance;
  const { resetToSafe, retryFocusedJob } = actions;
  const { startSession: startSession2, runProbe: runProbe2 } = compute;
  const { copyInstallCommand } = ui;
  if (!kind) return null;
  const cards = {
    oom: {
      title: t("studio.guidance.oom.title"),
      actions: [{ key: "reset", label: t("studio.guidance.oom.action"), run: resetToSafe }]
    },
    sleep: {
      title: t("studio.guidance.sleep.title"),
      actions: [{ key: "wake", label: t("studio.guidance.sleep.action"), run: startSession2 }]
    },
    auth: {
      title: t("studio.guidance.auth.title"),
      actions: [
        { key: "settings", label: t("studio.guidance.auth.action"), href: KAGGLE_SETTINGS_URL },
        { key: "recheck", label: t("studio.guidance.cli.action"), run: runProbe2 }
      ]
    },
    cli: {
      title: t("studio.guidance.cli.title"),
      command: KAGGLE_INSTALL_COMMAND,
      actions: [
        { key: "copy", label: t("studio.guidance.cli.copy"), run: copyInstallCommand },
        { key: "recheck", label: t("studio.guidance.cli.action"), run: runProbe2 }
      ]
    },
    session: {
      title: t("studio.guidance.session.title"),
      actions: [{ key: "wake", label: t("studio.guidance.sleep.action"), run: startSession2 }]
    },
    generate: {
      title: t("studio.guidance.generic.title"),
      actions: [{ key: "retry", label: t("studio.guidance.generic.action"), run: retryFocusedJob }]
    },
    generic: {
      title: t("studio.guidance.other.title"),
      actions: []
    }
  };
  const card = cards[kind] || cards.generic;
  const actionList = card.actions.filter((action) => action.href ? true : typeof action.run === "function");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-guidance", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-guidance-icon", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: "alert", size: 15 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-guidance-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ofs-guidance-title", children: card.title }),
      card.command ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("code", { className: "ofs-guidance-command", children: card.command }) : null,
      detail ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "ofs-guidance-detail", title: detail, children: detail }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "ofs-guidance-actions", children: [
        actionList.map((action) => action.href ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "a",
          {
            className: "ofs-chip is-on",
            href: action.href,
            target: "_blank",
            rel: "noreferrer noopener",
            children: action.label
          },
          action.key
        ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "ofs-chip is-on", onClick: action.run, children: action.label }, action.key)),
        dismiss ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "ofs-chip", onClick: dismiss, children: t("studio.guidance.close") }) : null
      ] })
    ] })
  ] });
}

// src/studio/Rail.jsx
var import_react7 = __toESM(require("react"), 1);

// src/components/Tooltip.jsx
var import_react6 = __toESM(require("react"), 1);

// src/logic/tooltip.js
var GAP = 8;
var PAD = 8;
function tooltipPlacement(input) {
  const anchor = input.anchor || { left: 0, top: 0, bottom: 0, width: 0 };
  const frame = input.frame || null;
  const frameLeft = frame ? Number(frame.left) || 0 : 0;
  const frameTop = frame ? Number(frame.top) || 0 : 0;
  const frameWidth = frame && Number(frame.width) > 0 ? Number(frame.width) : 0;
  const requested = Number(input.width) > 0 ? Number(input.width) : 240;
  const maxWidth = frameWidth > 0 ? Math.min(requested, Math.max(120, frameWidth - PAD * 2)) : requested;
  const anchorLeft = (Number(anchor.left) || 0) - frameLeft;
  const anchorTop = (Number(anchor.top) || 0) - frameTop;
  const anchorBottom = (Number(anchor.bottom) || 0) - frameTop;
  const anchorWidth = Number(anchor.width) || 0;
  const centered = anchorLeft + anchorWidth / 2 - maxWidth / 2;
  const left = frameWidth > 0 ? Math.max(PAD, Math.min(centered, frameWidth - maxWidth - PAD)) : centered;
  const below = input.preferBelow === true || anchorTop < 140;
  return {
    left,
    top: below ? anchorBottom + GAP : anchorTop - GAP,
    below,
    maxWidth
  };
}

// src/components/Tooltip.jsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var POPUP_MAX = 248;
function Tooltip(props) {
  const { text, tone = "info", side = "top" } = props;
  const [open, setOpen] = import_react6.default.useState(false);
  const [pinned, setPinned] = import_react6.default.useState(false);
  const [pos, setPos] = import_react6.default.useState(null);
  const triggerRef = import_react6.default.useRef(null);
  const close = import_react6.default.useCallback(() => {
    setPinned(false);
    setOpen(false);
  }, []);
  const measure = import_react6.default.useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const anchor = node.getBoundingClientRect();
    const app = node.closest(".ofs-app");
    let frame = null;
    if (app) {
      frame = app.getBoundingClientRect();
    } else if (Number(window.innerWidth) > 0) {
      frame = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    setPos(tooltipPlacement({ anchor, frame, width: POPUP_MAX, preferBelow: side === "bottom" }));
  }, [side]);
  import_react6.default.useEffect(() => {
    if (!open) return void 0;
    measure();
    const remeasure = () => measure();
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, measure, close]);
  import_react6.default.useEffect(() => {
    if (!pinned) return void 0;
    const onDown = (event) => {
      const node = triggerRef.current;
      if (node && event && event.target && node.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned, close]);
  if (!text) return null;
  const popupStyle = pos ? { left: `${pos.left}px`, top: `${pos.top}px`, maxWidth: `${pos.maxWidth}px` } : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: `ofs-tip ofs-tip--${tone}${open ? " is-open" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: "ofs-tip-trigger",
        "aria-label": text,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => {
          if (!pinned) setOpen(false);
        },
        onFocus: () => setOpen(true),
        onBlur: () => {
          if (!pinned) setOpen(false);
        },
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pinned) close();
          else {
            setPinned(true);
            setOpen(true);
          }
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": "true", children: tone === "warn" ? "!" : "i" })
      }
    ),
    open && pos ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { role: "tooltip", className: pos.below ? "ofs-tip-pop is-below" : "ofs-tip-pop", style: popupStyle, children: text }) : null
  ] });
}

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
  const { min, max, step } = LIMITS.width;
  return Math.min(max, Math.max(min, Math.round(number / step) * step));
}
function parseSeed(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return -1;
  const value = Number(raw);
  if (!Number.isFinite(value)) return -1;
  const int = Math.trunc(value);
  if (int < 0) return -1;
  return Math.min(int, LIMITS.seed.max);
}

// src/studio/ratios.js
var DEFAULT_RATIOS = [
  { id: "1:1", width: 1024, height: 1024 },
  { id: "16:9", width: 1152, height: 648 },
  { id: "9:16", width: 648, height: 1152 },
  { id: "4:3", width: 1024, height: 768 },
  { id: "3:4", width: 768, height: 1024 }
];
function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) };
}

// src/studio/Rail.jsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var PROMPT_MAX = LIMITS.prompt.maxChars;
var INSPIRE_KEYS = ["studio.inspire.1", "studio.inspire.2", "studio.inspire.3", "studio.inspire.4", "studio.inspire.5"];
function Fieldset(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "ofs-fieldset", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-fieldset-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: props.title }),
      props.action ? props.action : null
    ] }),
    props.children
  ] });
}
function Rail(props) {
  const { t, ui, form, actions } = props;
  const {
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    panelMode: mode,
    setPanelMode: setMode
  } = ui;
  const {
    form: fields,
    patchForm,
    styleId,
    applyStyle,
    ratioId,
    applyRatio,
    refineGroups,
    refineSource,
    enhancing,
    enhance,
    toggleRefine,
    useInspiration
  } = form;
  const { sending, generate } = actions;
  const promptLength = fields.prompt.length;
  const hasPrompt = fields.prompt.trim().length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("aside", { className: "ofs-panel ofs-panel--form", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "ofs-panel-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h2", { children: t("studio.rail.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-seg", role: "tablist", "aria-label": t("studio.rail.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-panel-scroll", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        Fieldset,
        {
          title: t("studio.prompt"),
          action: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { text: t("studio.promptTooltip") }),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-composer", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "textarea",
                {
                  className: "ofs-composer-input",
                  value: fields.prompt,
                  maxLength: PROMPT_MAX,
                  placeholder: t("studio.promptPlaceholder"),
                  spellCheck: false,
                  onChange: (event) => patchForm({ prompt: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) generate();
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-composer-foot", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "ofs-counter", children: [
                  promptLength,
                  " / ",
                  PROMPT_MAX
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "ofs-text-action", onClick: enhance, disabled: enhancing, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "expandText", size: 13 }),
                  enhancing ? t("studio.enhance.thinking") : t("studio.enhance.button")
                ] })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-inspire", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-inspire-label", children: t("studio.inspire.title") }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-suggestions", children: INSPIRE_KEYS.map((key) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-suggestion",
                  onClick: () => useInspiration(t(key)),
                  title: t(key),
                  children: t(`${key}.label`)
                },
                key
              )) })
            ] }),
            refineGroups.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-refine", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-refine-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("studio.refine.title") }),
                refineSource === "local" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-muted", children: t("studio.enhance.local") }) : null
              ] }),
              refineGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-refine-group", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-refine-dim", children: t(`studio.refine.${group.dimension}`) }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-suggestions", children: group.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  "button",
                  {
                    type: "button",
                    className: option.applied ? "ofs-suggestion is-on" : "ofs-suggestion",
                    onClick: () => toggleRefine(option.text),
                    "aria-pressed": option.applied,
                    title: option.text,
                    children: option.text
                  },
                  option.id
                )) })
              ] }, group.dimension)),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ofs-hint", children: t("studio.refine.hint") })
            ] }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Fieldset, { title: t("studio.style"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-tiles", children: STYLE_CAPSULES.map((capsule) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        "button",
        {
          type: "button",
          className: styleId === capsule.id ? "ofs-tile is-on" : "ofs-tile",
          onClick: () => applyStyle(capsule.id),
          "aria-pressed": styleId === capsule.id,
          title: t(capsule.labelKey),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: `ofs-tile-art is-${capsule.id}`, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: capsule.icon, size: 16 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-tile-label", children: t(capsule.labelKey) })
          ]
        },
        capsule.id
      )) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Fieldset, { title: t("studio.rail.frame"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-ratio-row", children: DEFAULT_RATIOS.map((ratio) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        "button",
        {
          type: "button",
          className: ratioId === ratio.id ? "ofs-ratio is-on" : "ofs-ratio",
          onClick: () => applyRatio(ratio.id),
          "aria-pressed": ratioId === ratio.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: `ofs-ratio-glyph ofs-ratio-glyph--${ratio.id.replace(":", "-")}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-ratio-label", children: ratio.id })
          ]
        },
        ratio.id
      )) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Fieldset, { title: t("studio.rail.advanced"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-rows", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: negativeOpen ? "ofs-row is-open" : "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-row-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "button",
              {
                type: "button",
                className: "ofs-row-toggle",
                onClick: () => setNegativeOpen((open) => !open),
                "aria-expanded": negativeOpen,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("studio.negative") }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: negativeOpen ? "ofs-chevron is-open" : "ofs-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "chevronDown", size: 14 }) })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { text: t("studio.negativeTooltip") })
          ] }),
          negativeOpen ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "textarea",
            {
              className: "ofs-row-textarea",
              rows: 3,
              value: fields.negative,
              placeholder: t("studio.negativePlaceholder"),
              spellCheck: false,
              onChange: (event) => patchForm({ negative: event.target.value })
            }
          ) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: advancedOpen ? "ofs-row is-open" : "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "ofs-row-head", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-row-toggle",
              onClick: () => setAdvancedOpen((open) => !open),
              "aria-expanded": advancedOpen,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("studio.rail.params") }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: advancedOpen ? "ofs-chevron is-open" : "ofs-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "chevronDown", size: 14 }) })
              ]
            }
          ) }),
          advancedOpen ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-grid2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "ofs-field-label", children: [
                t("studio.steps"),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { text: t("studio.stepsTooltip") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "input",
                {
                  type: "number",
                  min: 1,
                  max: 60,
                  value: fields.steps,
                  "aria-label": t("studio.steps"),
                  onChange: (event) => patchForm({ steps: Number(event.target.value) })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "ofs-field-label", children: [
                t("studio.cfg"),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { text: t("studio.cfgTooltip") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "input",
                {
                  type: "number",
                  min: 0,
                  max: 20,
                  step: 0.5,
                  value: fields.cfg,
                  "aria-label": t("studio.cfg"),
                  onChange: (event) => patchForm({ cfg: Number(event.target.value) })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("studio.seed") }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "input",
                {
                  type: "text",
                  inputMode: "numeric",
                  value: fields.seed,
                  placeholder: t("studio.random"),
                  "aria-label": t("studio.seed"),
                  onChange: (event) => patchForm({ seed: event.target.value })
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("studio.count") }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "select",
                {
                  value: fields.count,
                  "aria-label": t("studio.count"),
                  onChange: (event) => patchForm({ count: Number(event.target.value) }),
                  children: [1, 2, 3, 4].map((value) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value, children: value }, value))
                }
              )
            ] })
          ] }) : null
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-panel-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "ofs-btn is-primary ofs-generate", onClick: () => generate(), disabled: sending || !hasPrompt, children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "sparkles", size: 16 }),
        sending ? t("studio.generating") : t("studio.generate")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ofs-hint", children: hasPrompt ? t("studio.generateHint") : t("studio.promptHint") })
    ] })
  ] });
}

// src/studio/Stage.jsx
var import_react8 = __toESM(require("react"), 1);
var import_jsx_runtime8 = require("react/jsx-runtime");
var INSPIRE_KEYS2 = ["studio.inspire.1", "studio.inspire.2", "studio.inspire.3", "studio.inspire.4", "studio.inspire.5"];
function Stage(props) {
  const { t, ui, compute, form, library, actions } = props;
  const { zoom, setZoom, copyPath } = ui;
  const { activeJob, queued: sessionQueued } = compute;
  const { useInspiration } = form;
  const { selected, isFavorite, toggleFavorite } = library;
  const { iterate, reroll } = actions;
  const image = selected && selected.image ? selected.image : null;
  const item = selected && selected.item || null;
  const params = item && item.params || null;
  const prompt = item && typeof item.prompt === "string" && item.prompt || params && typeof params.prompt === "string" && params.prompt || "";
  const closeRef = import_react8.default.useRef(null);
  import_react8.default.useEffect(() => {
    if (!zoom) return void 0;
    function onKey(event) {
      if (event.key === "Escape") setZoom(false);
    }
    document.addEventListener("keydown", onKey);
    if (closeRef.current) closeRef.current.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);
  if (!image) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("section", { className: "ofs-stage", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-figure ofs-figure--empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-empty-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-empty-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "images", size: 26 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "ofs-empty-title", children: t("studio.stage.empty") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "ofs-muted", children: t("studio.stage.emptyHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-examples", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-examples-label", children: t("studio.stage.examples") }),
          INSPIRE_KEYS2.map((key) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-example", onClick: () => useInspiration(t(key)), title: t(key), children: t(`${key}.label`) }, key))
        ] })
      ] }),
      activeJob ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-stage-progress", role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-progress-label", children: sessionQueued ? t("studio.compute.queued") : t("studio.stage.rendering") })
      ] }) : null
    ] }) });
  }
  const favorite = isFavorite(image.path || image.file);
  const copyTarget = image.absolute || image.path || image.file;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "ofs-stage", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("figure", { className: "ofs-figure", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-figure-button", onClick: () => setZoom(true), title: t("studio.stage.zoom"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("img", { src: image.url, alt: image.file || "image", className: "ofs-image" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-figure-tools", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-glass-btn", onClick: () => setZoom(true), title: t("studio.stage.zoom"), "aria-label": t("studio.stage.zoom"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "expand", size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-glass-btn", onClick: () => copyPath(copyTarget), title: t("studio.action.copyPath"), "aria-label": t("studio.action.copyPath"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "copy", size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            type: "button",
            className: favorite ? "ofs-glass-btn is-on" : "ofs-glass-btn",
            onClick: () => toggleFavorite(image.path || image.file),
            title: favorite ? t("studio.action.favorited") : t("studio.action.favorite"),
            "aria-label": favorite ? t("studio.action.favorited") : t("studio.action.favorite"),
            "aria-pressed": favorite,
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: favorite ? "starFilled" : "star", size: 16 })
          }
        )
      ] }),
      activeJob ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-stage-progress", role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "ofs-progress-label", children: sessionQueued ? t("studio.compute.queued") : t("studio.stage.rendering") })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-stage-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "ofs-stage-prompt", title: prompt || void 0, children: prompt }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-stage-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
          image.width || "—",
          " × ",
          image.height || "—"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": "true", children: "·" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: formatSeconds(t, image.seconds) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": "true", children: "·" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
          t("studio.meta.seed"),
          " ",
          image.seed ?? "—"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-dock", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("button", { type: "button", className: "ofs-dock-button", onClick: () => iterate(selected), children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "focus", size: 15 }),
        t("studio.action.iterate")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("button", { type: "button", className: "ofs-dock-button", onClick: () => reroll(selected), children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "reroll", size: 15 }),
        t("studio.action.reroll")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("button", { type: "button", className: "ofs-dock-button", onClick: () => copyPath(copyTarget), children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "copy", size: 15 }),
        t("studio.action.copyPath")
      ] })
    ] }),
    zoom ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "div",
      {
        className: "ofs-lightbox",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("studio.stage.zoom"),
        onClick: () => setZoom(false),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("img", { src: image.url, alt: image.file || "image", onClick: (event) => event.stopPropagation() }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              ref: closeRef,
              type: "button",
              className: "ofs-lightbox-close",
              onClick: () => setZoom(false),
              "aria-label": t("studio.dismiss"),
              children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "close", size: 16 })
            }
          )
        ]
      }
    ) : null
  ] });
}

// src/studio/Toast.jsx
var import_react9 = __toESM(require("react"), 1);
var import_jsx_runtime9 = require("react/jsx-runtime");
function Toast(props) {
  const { toast } = props;
  if (!toast) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-toast", role: "status", children: toast.text }, toast.id);
}

// src/studio/TopBar.jsx
var import_react11 = __toESM(require("react"), 1);

// src/studio/StudioIcon.jsx
var import_react10 = __toESM(require("react"), 1);
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

// src/logic/probe.js
function cliStatus(cli) {
  if (cli === true) return "ok";
  if (cli === false) return "failed";
  if (!cli || typeof cli !== "object") return "unknown";
  return cli.present === false ? "failed" : "ok";
}
function authStatus(auth) {
  if (!auth || typeof auth !== "object") return "unknown";
  return auth.ok === true ? "ok" : "failed";
}
function quotaStatus(quota) {
  if (!quota || typeof quota !== "object") return "unknown";
  return quota.available === true ? "ok" : "unavailable";
}
function probeStatusOf(probe) {
  if (!probe || typeof probe !== "object") return null;
  const notes = Array.isArray(probe.notes) ? probe.notes.filter((item) => typeof item === "string" && item.trim()) : [];
  return {
    cli: cliStatus(probe.cli),
    auth: authStatus(probe.auth),
    quota: quotaStatus(probe.quota),
    notes
  };
}
function probeFailureCode(probe) {
  const status = probeStatusOf(probe);
  if (!status) return "";
  if (status.cli === "failed") return "cli_missing";
  if (status.auth === "failed") return "auth_required";
  return "";
}
function probeOutcomeOf(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const probe = data.probe && typeof data.probe === "object" ? data.probe : null;
  if (data.ok === true) return { ok: true, probe, code: "", detail: "" };
  const code = probeFailureCode(probe) || "probe_failed";
  return { ok: false, probe, code, detail: probeFailureDetail(probe) };
}
function probeFailureDetail(probe) {
  const status = probeStatusOf(probe);
  if (status && status.notes.length > 0) return shortText(status.notes.slice(0, 2).join(" · "));
  const authDetail = probe && probe.auth && typeof probe.auth.detail === "string" ? probe.auth.detail : "";
  if (authDetail) return shortText(authDetail);
  const cliError = probe && probe.cli && typeof probe.cli.error === "string" ? probe.cli.error : "";
  return shortText(cliError);
}

// src/studio/TopBar.jsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function sessionPill(t, sessionState) {
  if (sessionState === "ready") return { tone: "ok", label: t("studio.compute.online") };
  if (sessionState === "provisioning") return { tone: "warn", label: t("studio.compute.queued") };
  if (sessionState === "connecting" || sessionState === "warming") return { tone: "warn", label: t("studio.compute.warming") };
  if (sessionState === "stopping") return { tone: "warn", label: t("studio.compute.stopping") };
  if (sessionState === "error") return { tone: "error", label: t("studio.compute.error") };
  return { tone: "idle", label: t("studio.compute.offline") };
}
function TopBar(props) {
  const { t, ui, compute, library } = props;
  const { form: fields, patchForm } = props.form;
  const { view, setView } = ui;
  const {
    sessionState,
    session,
    quota,
    presets,
    busy,
    probing,
    probe,
    probeReport,
    startSession: startSession2,
    stopSession: stopSession2,
    runProbe: runProbe2,
    openFolder
  } = compute;
  const pill = sessionPill(t, sessionState);
  const [open, setOpen] = import_react11.default.useState(false);
  const wrapRef = import_react11.default.useRef(null);
  import_react11.default.useEffect(() => {
    if (!open) return void 0;
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDown(event) {
      const node = wrapRef.current;
      if (node && !node.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  const idleMinutes = session && session.idleTimeoutSec ? Math.round(session.idleTimeoutSec / 60) : 0;
  const createTooltip = sessionState === "provisioning" ? t("studio.compute.queuedTooltip") : sessionState === "ready" ? t("studio.compute.idleTooltip") : t("studio.compute.offlineTooltip");
  const quotaUsed = quota && Number.isFinite(quota.usedHours) ? quota.usedHours : null;
  const quotaTotal = quota && Number.isFinite(quota.totalHours) ? quota.totalHours : null;
  const notReady = sessionState === "absent" || sessionState === "error";
  const activePreset = presets.find((item) => item.id === fields.presetId) || null;
  const probeInfo = probeStatusOf(probe || probeReport && probeReport.probe);
  const probeFailed = probeReport && probeReport.status && probeReport.status !== "ok" ? probeReport : null;
  const probeNote = probeInfo && probeInfo.notes.length > 0 ? probeInfo.notes[0] : "";
  const statusText = (status) => {
    if (status === "ok") return t("value.ok");
    if (status === "failed") return t("value.failed");
    if (status === "unavailable") return t("value.quotaUnavailable");
    return t("value.unknown");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("header", { className: "ofs-topbar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-brand", title: t("studio.nav.label"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-brand-mark", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(StudioIcon, { size: 18 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-brand-name", children: t("studio.brand") }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-brand-sub", children: t("studio.brandSub") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("nav", { className: "ofs-tabs", "aria-label": t("studio.tabs"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", className: view === "studio" ? "ofs-tab is-on" : "ofs-tab", onClick: () => setView("studio"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "sparkles", size: 15 }),
        t("studio.tab.studio")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", className: view === "gallery" ? "ofs-tab is-on" : "ofs-tab", onClick: () => setView("gallery"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "images", size: 15 }),
        t("studio.tab.gallery")
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-grow" }),
    openFolder ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      "button",
      {
        type: "button",
        className: "ofs-icon-btn",
        onClick: openFolder,
        title: t("studio.action.openFolder"),
        "aria-label": t("studio.action.openFolder"),
        children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "folder", size: 16 })
      }
    ) : null,
    library.loadHistory ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "ofs-icon-btn", onClick: library.loadHistory, title: t("studio.refresh"), "aria-label": t("studio.refresh"), children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "refresh", size: 16 }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-pill-wrap", ref: wrapRef, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
        "button",
        {
          type: "button",
          className: `ofs-compute is-${pill.tone}`,
          onClick: () => setOpen((value) => !value),
          "aria-expanded": open,
          "aria-haspopup": "menu",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("i", { className: `ofs-dot is-${pill.tone}${pill.tone === "ok" || pill.tone === "warn" ? " is-live" : ""}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: pill.label }),
            quotaUsed !== null && quotaTotal !== null ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("em", { children: [
              quotaUsed,
              " / ",
              quotaTotal,
              " ",
              t("unit.hour")
            ] }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-pill-caret", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "chevronDown", size: 13 }) })
          ]
        }
      ),
      open ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-popover", role: "menu", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-popover-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("i", { className: `ofs-dot is-${pill.tone}${pill.tone === "ok" || pill.tone === "warn" ? " is-live" : ""}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("b", { children: pill.label }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Tooltip, { text: createTooltip, side: "bottom" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.quota"),
            " ",
            quotaUsed !== null && quotaTotal !== null ? `${quotaUsed} / ${quotaTotal} ${t("unit.hour")}` : "—"
          ] }),
          idleMinutes > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.idleFor"),
            " ",
            idleMinutes,
            " ",
            t("unit.min")
          ] }) : null,
          session && session.device ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-muted", children: session.device }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-popover-note", children: [
          probing ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("action.probing") }) : null,
          probeInfo ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
              t("studio.probe.cli"),
              " · ",
              statusText(probeInfo.cli)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
              t("studio.probe.quota"),
              " · ",
              statusText(probeInfo.quota)
            ] })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
            t("studio.probe.account"),
            " · ",
            statusText(probeInfo ? probeInfo.auth : "unavailable"),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Tooltip, { text: t("studio.compute.authTooltip"), tone: "warn", side: "bottom" })
          ] }),
          probeFailed ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { title: probeFailed.message || void 0, children: [
            probeFailed.status === "timeout" ? t("studio.probe.timeout") : t("studio.probe.failed"),
            probeFailed.message ? ` · ${probeFailed.message}` : ""
          ] }) : null,
          probeNote ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { title: probeInfo.notes.join(" · "), children: probeNote }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", role: "menuitem", className: "ofs-popover-row", onClick: startSession2, disabled: !!busy || !notReady, children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "cloud", size: 15 }),
          t("studio.compute.start")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", role: "menuitem", className: "ofs-popover-row", onClick: stopSession2, disabled: !!busy || sessionState === "absent", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "clock", size: 15 }),
          t("studio.compute.stop")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "ofs-popover-row",
            onClick: runProbe2,
            disabled: !!busy || probing,
            "aria-busy": probing,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "refresh", size: 15 }),
              probing ? t("action.probing") : t("studio.compute.check")
            ]
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "ofs-preset", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "sliders", size: 14 }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-preset-label", children: t("studio.preset") }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
        "select",
        {
          value: fields.presetId,
          disabled: presets.length === 0,
          "aria-label": t("studio.preset"),
          onChange: (event) => {
            const id = event.target.value;
            const next = presets.find((item) => item.id === id);
            patchForm({
              presetId: id,
              ...next ? {
                width: next.size || fields.width,
                height: next.size || fields.height,
                steps: next.steps ?? fields.steps,
                cfg: next.cfg ?? fields.cfg
              } : {}
            });
          },
          children: [
            presets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: "", children: "—" }) : null,
            presets.map((item) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: item.id, children: item.label || item.id }, item.id))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-preset-meta", children: activePreset && activePreset.params ? activePreset.params : "" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "chevronDown", size: 13, className: "ofs-preset-caret" })
    ] })
  ] });
}

// src/studio/useStudio.js
var import_react17 = __toESM(require("react"), 1);

// src/logic/recall.js
function finiteNumber(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function positiveSize(value) {
  const number = finiteNumber(value);
  if (number === null || number <= 0) return null;
  return Math.round(number);
}
function presetOf(presets, id) {
  if (!id || !Array.isArray(presets)) return null;
  return presets.find((item) => item && item.id === id) || null;
}
function recallOf(entry, presets) {
  const image = entry && entry.image || null;
  const item = entry && entry.item || null;
  const params = item && item.params || null;
  const presetId = item && item.presetId || "";
  const preset = presetOf(presets, presetId);
  const prompt = item && typeof item.prompt === "string" && item.prompt || params && typeof params.prompt === "string" && params.prompt || "";
  const width = positiveSize(image && image.width) ?? positiveSize(params && params.width) ?? positiveSize(preset && preset.size);
  const height = positiveSize(image && image.height) ?? positiveSize(params && params.height) ?? positiveSize(preset && preset.size);
  const steps = finiteNumber(params && params.steps) ?? finiteNumber(preset && preset.steps);
  const cfg = finiteNumber(params && params.cfg) ?? finiteNumber(preset && preset.cfg);
  const seed = finiteNumber(image && image.seed) ?? finiteNumber(params && params.seed);
  const negative = params && typeof params.negativePrompt === "string" ? params.negativePrompt : null;
  return { image, item, params, presetId, prompt, width, height, steps, cfg, seed, negative };
}
function iteratePatch(entry, form, presets) {
  const base = form || {};
  const recall = recallOf(entry, presets);
  const patch = {};
  const prompt = recall.prompt.trim();
  if (prompt) {
    patch.prompt = prompt;
    patch.styleId = "";
  }
  if (recall.negative !== null) patch.negative = recall.negative;
  if (recall.width !== null) patch.width = recall.width;
  if (recall.height !== null) patch.height = recall.height;
  if (recall.steps !== null) patch.steps = recall.steps;
  if (recall.cfg !== null) patch.cfg = recall.cfg;
  if (recall.seed !== null && recall.seed >= 0) patch.seed = String(Math.trunc(recall.seed));
  if (recall.presetId) patch.presetId = recall.presetId;
  return patch;
}
function rerollOverrides(entry, presets) {
  const recall = recallOf(entry, presets);
  const prompt = recall.prompt.trim();
  if (!prompt) return null;
  const overrides = { prompt, seed: -1, count: 1 };
  if (recall.negative !== null) overrides.negativePrompt = recall.negative;
  if (recall.width !== null) overrides.width = recall.width;
  if (recall.height !== null) overrides.height = recall.height;
  if (recall.steps !== null) overrides.steps = recall.steps;
  if (recall.cfg !== null) overrides.cfg = recall.cfg;
  if (recall.presetId) overrides.presetId = recall.presetId;
  return overrides;
}
function retryOverrides(source) {
  const holder = source && typeof source === "object" ? source : null;
  if (!holder) return null;
  const params = holder.params && typeof holder.params === "object" ? holder.params : holder;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (!prompt) return null;
  const overrides = { prompt, seed: -1 };
  const count = finiteNumber(params.count);
  if (count !== null) overrides.count = Math.min(4, Math.max(1, Math.round(count)));
  const width = positiveSize(params.width);
  const height = positiveSize(params.height);
  if (width !== null) overrides.width = width;
  if (height !== null) overrides.height = height;
  const steps = finiteNumber(params.steps);
  const cfg = finiteNumber(params.cfg);
  if (steps !== null) overrides.steps = steps;
  if (cfg !== null) overrides.cfg = cfg;
  if (typeof params.negativePrompt === "string") overrides.negativePrompt = params.negativePrompt;
  const presetId = holder.presetId || params.presetId || "";
  if (presetId) overrides.presetId = presetId;
  return overrides;
}

// src/studio/hooks/useChatThread.js
var import_react12 = __toESM(require("react"), 1);

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

// src/logic/intent.js
function lastIntentPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "assistant" && message.kind === "intent" && typeof message.prompt === "string" && message.prompt.trim()) {
      return message.prompt.trim();
    }
  }
  return "";
}
function intentFormPatch(intent, ratios) {
  const patch = {};
  if (!intent || typeof intent !== "object") return patch;
  const prompt = typeof intent.prompt === "string" ? intent.prompt.trim() : "";
  if (prompt) patch.prompt = prompt;
  const ratio = (Array.isArray(ratios) ? ratios : []).find((item) => item && item.id === intent.ratioId);
  if (ratio) {
    patch.width = ratio.width;
    patch.height = ratio.height;
  }
  if (typeof intent.styleId === "string" && intent.styleId) patch.styleId = intent.styleId;
  return patch;
}
function intentPrompt(intent, capsules) {
  const base = String(intent && intent.prompt ? intent.prompt : "").trim();
  if (!base) return "";
  const capsule = (Array.isArray(capsules) ? capsules : []).find((item) => item && item.id === intent.styleId);
  return capsule ? `${base}, ${capsule.suffix}` : base;
}

// src/studio/hooks/useChatThread.js
function useChatThread({ t, isEn, alive, state, form, generate }) {
  const [messages, setMessages] = import_react12.default.useState([]);
  const [interpreting, setInterpreting] = import_react12.default.useState(false);
  const messageSeq = import_react12.default.useRef(0);
  const interpretingRef = import_react12.default.useRef(false);
  const activeJob = activeJobOf(state);
  const threadJob = activeJob || state && state.lastJob || null;
  const threadJobKey = threadJob ? `${threadJob.id}:${threadJob.status}` : "";
  import_react12.default.useEffect(() => {
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
  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: messageSeq.current += 1, ...entry }))]);
  }
  async function interpret(text) {
    const value = String(text ?? "").trim();
    if (!value || interpreting || interpretingRef.current) return;
    interpretingRef.current = true;
    const previousPrompt = lastIntentPrompt(messages);
    pushMessages([{ role: "user", text: value }]);
    setInterpreting(true);
    const result = await alive(parseIntentRequest({ text: value, previousPrompt, locale: isEn ? "en" : "zh" }));
    interpretingRef.current = false;
    if (!result) return;
    setInterpreting(false);
    if (result.ok && result.data && typeof result.data.prompt === "string") {
      const data = result.data;
      pushMessages([{
        role: "assistant",
        kind: "intent",
        prompt: data.prompt,
        ratioId: typeof data.ratioId === "string" ? data.ratioId : "",
        styleId: typeof data.styleId === "string" ? data.styleId : "",
        clarify: data.clarify || null,
        source: data.source === "model" ? "model" : "local"
      }]);
      return;
    }
    pushMessages([{ role: "assistant", kind: "error", text: errorText(t, result) }]);
  }
  function resolveClarify(messageId, field, value) {
    setMessages((prev) => prev.map((message) => {
      if (!message || message.id !== messageId) return message;
      const next = { ...message, clarify: null };
      if (field === "ratio") next.ratioId = value || "";
      if (field === "style") next.styleId = value || "";
      return next;
    }));
  }
  async function generateIntent(message) {
    if (!message || !message.prompt) return;
    const overrides = { prompt: intentPrompt(message, STYLE_CAPSULES) };
    const ratio = DEFAULT_RATIOS.find((item) => item.id === message.ratioId);
    if (ratio) {
      overrides.width = ratio.width;
      overrides.height = ratio.height;
    }
    const previous = state && state.lastJob && state.lastJob.params || null;
    if (previous && form.form.seed === "" && Number.isFinite(previous.seed) && previous.seed >= 0) {
      overrides.seed = previous.seed;
    }
    const patch = intentFormPatch(message, DEFAULT_RATIOS);
    if (Object.keys(patch).length > 0) form.patchForm(patch);
    await generate(overrides, { pushUser: false });
  }
  function clearThread() {
    setMessages([]);
  }
  return {
    messages,
    interpreting,
    interpret,
    resolveClarify,
    generateIntent,
    clearThread,
    pushMessages
  };
}

// src/studio/hooks/useSessionControl.js
var import_react13 = __toESM(require("react"), 1);
function useSessionControl({ t, host, ui, alive }) {
  const [busy, setBusy] = import_react13.default.useState("");
  const [probing, setProbing] = import_react13.default.useState(false);
  const [probeReport, setProbeReport] = import_react13.default.useState(null);
  const state = host.state;
  const session = state && state.session || null;
  const sessionState = session && session.state || "absent";
  const activeJob = activeJobOf(state);
  const focusedJob = activeJob || state && state.lastJob || stateJobs(state)[0] || null;
  const queued = sessionState === "provisioning" || Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "waiting-session"));
  const hostErrorKeyRef = import_react13.default.useRef("");
  import_react13.default.useEffect(() => {
    if (!host.error) return;
    const key = `${host.error.code}|${host.error.message ?? ""}`;
    if (hostErrorKeyRef.current === key) return;
    hostErrorKeyRef.current = key;
    ui.setError((prev) => prev || { code: host.error.code, message: host.error.message ?? "" });
  }, [host.error]);
  async function startSession2(presetId) {
    if (busy) return;
    setBusy("start");
    const result = await alive(startSession(presetId));
    if (!result) return;
    setBusy("");
    if (!result.ok) ui.fail(result.code, result.message);
    host.refresh();
  }
  async function stopSession2() {
    if (busy) return;
    setBusy("stop");
    const result = await alive(stopSession());
    if (!result) return;
    setBusy("");
    if (!result.ok) ui.fail(result.code, result.message);
    host.refresh();
  }
  async function openFolder() {
    const result = await alive(revealOutput());
    if (!result) return;
    if (!result.ok) ui.showToast(t("studio.toast.revealFailed"));
  }
  async function runProbe2() {
    if (probing) return;
    setProbing(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUTS.clientProbeMs);
    let result;
    try {
      result = await alive(runProbe(controller.signal));
    } finally {
      clearTimeout(timer);
    }
    if (!result) return;
    setProbing(false);
    if (!result.ok) {
      setProbeReport({ status: result.code === "timeout" ? "timeout" : "failed", message: result.message, probe: null });
      ui.showToast(result.code === "timeout" ? t("studio.probe.timeout") : t("studio.probe.failed"));
      return;
    }
    const outcome = probeOutcomeOf(result.data);
    if (outcome.ok) {
      setProbeReport({ status: "ok", message: "", probe: outcome.probe });
      if (ui.error && (ui.error.code === "cli_missing" || ui.error.code === "auth_required")) ui.setError(null);
      ui.showToast(t("studio.probe.ok"));
    } else {
      setProbeReport({ status: "failed", message: outcome.detail, probe: outcome.probe });
      if (outcome.code === "cli_missing" || outcome.code === "auth_required") ui.fail(outcome.code, outcome.detail);
      else ui.showToast(t("studio.probe.failed"));
    }
    host.refresh();
  }
  return {
    session,
    sessionState,
    activeJob,
    focusedJob,
    queued,
    quota: state && state.probe && state.probe.quota || null,
    probe: state && state.probe || null,
    busy,
    probing,
    probeReport,
    startSession: startSession2,
    stopSession: stopSession2,
    runProbe: runProbe2,
    openFolder
  };
}

// src/studio/hooks/useStudioForm.js
var import_react14 = __toESM(require("react"), 1);

// src/logic/prompt.js
function composePrompt(base, suffix) {
  const head = String(base ?? "").trim();
  const tail = String(suffix ?? "").trim();
  if (!head) return "";
  if (!tail) return head;
  if (head.includes(tail)) return head;
  return `${head}, ${tail}`;
}
function toggleStyle(form, capsule) {
  const prev = form || {};
  if (!capsule || !capsule.id) return { ...prev };
  if (prev.styleId === capsule.id) {
    return {
      ...prev,
      styleId: "",
      negative: prev.negative === capsule.negative ? "" : prev.negative
    };
  }
  return {
    ...prev,
    styleId: capsule.id,
    negative: String(prev.negative ?? "").trim() ? prev.negative : capsule.negative
  };
}

// src/logic/generate.js
function buildGenerateBody(form, options = {}) {
  const input = form || {};
  const overrides = options.overrides && typeof options.overrides === "object" ? options.overrides : null;
  const explicit = overrides && typeof overrides.prompt === "string" ? overrides.prompt : null;
  const maxPromptChars = LIMITS.prompt.maxChars;
  const prompt = explicit !== null ? explicit.trim().slice(0, maxPromptChars) : composePrompt(input.prompt, options.styleSuffix).slice(0, maxPromptChars);
  const body = {
    prompt,
    negativePrompt: String(input.negative ?? "").trim(),
    width: clampSize(input.width),
    height: clampSize(input.height),
    steps: clampInt(input.steps, LIMITS.steps.min, LIMITS.steps.max, 4),
    cfg: clampNumber(input.cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0),
    seed: parseSeed(input.seed),
    count: clampInt(input.count, LIMITS.count.min, LIMITS.count.max, 1),
    waitSeconds: 0,
    autoStart: true
  };
  const presetId = input.presetId || options.defaultPreset || "";
  if (presetId) body.presetId = presetId;
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === "prompt") continue;
      body[key] = value;
    }
  }
  return body;
}

// src/logic/refine.js
var SEPARATOR_CHARS = /[，,、;；\n\r\t ]/;
var CJK = /[\u3400-\u9fff]/;
function isBoundary(char) {
  return char === void 0 || SEPARATOR_CHARS.test(char);
}
function findDelimited(text, term) {
  let index = text.lastIndexOf(term);
  while (index >= 0) {
    if (isBoundary(text[index - 1]) && isBoundary(text[index + term.length])) return index;
    index = index > 0 ? text.lastIndexOf(term, index - 1) : -1;
  }
  return -1;
}
function refineSeparator(prompt) {
  return CJK.test(String(prompt ?? "")) ? "，" : ", ";
}
function isRefineApplied(prompt, term) {
  const text = String(prompt ?? "");
  const value = String(term ?? "").trim();
  if (!value) return false;
  return findDelimited(text, value) >= 0;
}
function toggleRefineTerm(prompt, term, separator) {
  const text = String(prompt ?? "");
  const value = String(term ?? "").trim();
  if (!value) return text;
  const sep = typeof separator === "string" && separator ? separator : refineSeparator(text);
  const index = findDelimited(text, value);
  if (index >= 0) {
    let start = index;
    let end = index + value.length;
    while (start > 0 && SEPARATOR_CHARS.test(text[start - 1])) start -= 1;
    if (start === index) {
      while (end < text.length && SEPARATOR_CHARS.test(text[end])) end += 1;
    }
    return (text.slice(0, start) + text.slice(end)).trim();
  }
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return value;
  if (/[，,、;；]$/.test(trimmed)) return trimmed + value;
  return trimmed + sep + value;
}

// src/studio/hooks/useStudioForm.js
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
function useStudioForm({ t, isEn, alive, ui, preset, initialPrompt }) {
  const { presets, defaultPreset } = preset;
  const [form, setForm] = import_react14.default.useState(() => ({
    ...EMPTY_FORM,
    prompt: initialPrompt
  }));
  const [refineGroups, setRefineGroups] = import_react14.default.useState([]);
  const [refineSource, setRefineSource] = import_react14.default.useState("");
  const [enhancing, setEnhancing] = import_react14.default.useState(false);
  const ratioId = (() => {
    const match = DEFAULT_RATIOS.find((ratio) => {
      const size = ratioToSize(ratio);
      return size.width === form.width && size.height === form.height;
    });
    return match ? match.id : "";
  })();
  const styleSuffix = (() => {
    const capsule = STYLE_CAPSULES.find((item) => item.id === form.styleId);
    return capsule ? capsule.suffix : "";
  })();
  import_react14.default.useEffect(() => {
    if (presets.length === 0) return;
    setForm((prev) => {
      if (prev.presetId && presets.some((item2) => item2.id === prev.presetId)) return prev;
      const initial = presets.some((item2) => item2.id === defaultPreset) ? defaultPreset : presets[0].id;
      const item = presets.find((option) => option.id === initial);
      if (!item) return prev;
      const size = clampSize(item.size);
      return {
        ...prev,
        presetId: initial,
        width: size,
        height: size,
        steps: clampInt(item.steps, LIMITS.steps.min, LIMITS.steps.max, 4),
        cfg: clampNumber(item.cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0)
      };
    });
  }, [presets.length, defaultPreset]);
  function patchForm(partial) {
    setForm((prev) => ({ ...prev, ...partial }));
  }
  function buildBody(overrides) {
    return buildGenerateBody(form, { styleSuffix, defaultPreset, overrides });
  }
  function applyStyle(capsuleId) {
    const capsule = STYLE_CAPSULES.find((item) => item.id === capsuleId);
    if (!capsule) return;
    setForm((prev) => toggleStyle(prev, capsule));
  }
  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id);
    if (!ratio) return;
    const size = ratioToSize(ratio);
    patchForm({ width: size.width, height: size.height });
  }
  async function enhance() {
    if (enhancing) return;
    if (!form.prompt.trim()) {
      ui.showToast(t("studio.promptHint"));
      return;
    }
    setEnhancing(true);
    const result = await alive(enhancePromptRequest({
      prompt: form.prompt,
      presetId: form.presetId,
      locale: isEn ? "en" : "zh"
    }));
    if (!result) return;
    setEnhancing(false);
    if (result.ok && result.data && Array.isArray(result.data.groups)) {
      const groups = result.data.groups.filter((group) => group && Array.isArray(group.options) && group.options.length > 0);
      setRefineGroups(groups);
      setRefineSource(result.data.source === "model" ? "model" : "local");
      return;
    }
    ui.fail(result.code, result.message);
  }
  function toggleRefine(term) {
    patchForm({ prompt: toggleRefineTerm(form.prompt, term, refineSeparator(form.prompt)) });
  }
  function useInspiration(text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    const base = form.prompt.trim();
    patchForm({ prompt: base ? `${base}
${value}` : value });
  }
  return {
    form,
    patchForm,
    buildBody,
    ratioId,
    styleId: form.styleId,
    applyStyle,
    applyRatio,
    refineGroups: refineGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, applied: isRefineApplied(form.prompt, option.text) }))
    })),
    refineSource,
    enhancing,
    enhance,
    toggleRefine,
    useInspiration
  };
}

// src/studio/hooks/useStudioUi.js
var import_react15 = __toESM(require("react"), 1);
function useStudioUi({ t, initialView, initialPanelMode }) {
  const [view, setView] = import_react15.default.useState(initialView);
  const [advancedOpen, setAdvancedOpen] = import_react15.default.useState(false);
  const [negativeOpen, setNegativeOpen] = import_react15.default.useState(false);
  const [error, setError] = import_react15.default.useState(null);
  const [dismissed, setDismissed] = import_react15.default.useState("");
  const [toast, setToast] = import_react15.default.useState(null);
  const [panelMode, setPanelMode] = import_react15.default.useState(initialPanelMode);
  const [zoom, setZoom] = import_react15.default.useState(false);
  function showToast(text) {
    setToast({ text, id: Date.now() });
  }
  function fail(code, message) {
    setDismissed("");
    setError({ code, message: message ?? "" });
  }
  function dismissGuidance(guidanceKey) {
    if (guidanceKey) setDismissed(guidanceKey);
    setError(null);
  }
  import_react15.default.useEffect(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  async function copyText(text, okKey) {
    const value = String(text ?? "").trim();
    if (!value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        showToast(t(okKey));
        return;
      }
    } catch {
    }
    showToast(value);
  }
  function copyPath(value) {
    return copyText(value, "studio.toast.copied");
  }
  function copyInstallCommand() {
    return copyText(KAGGLE_INSTALL_COMMAND, "studio.guidance.cli.copied");
  }
  return {
    view,
    setView,
    zoom,
    setZoom,
    panelMode,
    setPanelMode,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    toast,
    error,
    setError,
    dismissed,
    showToast,
    fail,
    dismissGuidance,
    copyPath,
    copyInstallCommand
  };
}

// src/studio/hooks/useWorkLibrary.js
var import_react16 = __toESM(require("react"), 1);
function flattenHistory(items) {
  const images = [];
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
    for (const image of list) images.push({ image, item });
  }
  return images;
}
function useWorkLibrary({ t, alive, ui, state }) {
  const [selectedPath, setSelectedPath] = import_react16.default.useState("");
  const [historyItems, setHistoryItems] = import_react16.default.useState([]);
  const [favorites, setFavorites] = import_react16.default.useState([]);
  const loadHistory = import_react16.default.useCallback(async () => {
    const result = await alive(fetchHistory(60));
    if (!result) return;
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setHistoryItems(result.data.items.filter(Boolean));
    } else if (!result.ok) {
      ui.fail(result.code, result.message);
    }
  }, [alive]);
  import_react16.default.useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const loadLibrary = import_react16.default.useCallback(async () => {
    const result = await alive(fetchLibrary());
    if (!result) return;
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites);
    } else if (!result.ok) {
      ui.fail(result.code, result.message);
    }
  }, [alive]);
  import_react16.default.useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);
  const firstImageRef = import_react16.default.useRef(false);
  const finished = state && state.lastJob && state.lastJob.status === "done" ? state.lastJob : null;
  import_react16.default.useEffect(() => {
    if (!finished || firstImageRef.current) return;
    const images = Array.isArray(finished.output?.images) ? finished.output.images : [];
    if (images.length === 0) return;
    firstImageRef.current = true;
    ui.showToast(t("studio.toast.firstImage"));
  }, [finished && finished.id]);
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ""}` : "";
  const lastSeenRef = import_react16.default.useRef("");
  import_react16.default.useEffect(() => {
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
  function selectImage(entry) {
    setSelectedPath(entry && entry.image ? entry.image.path : "");
  }
  function openMessage(path) {
    if (path) setSelectedPath(path);
  }
  function isFavorite(path) {
    return Boolean(path) && favorites.includes(String(path));
  }
  async function toggleFavorite(path) {
    const target = String(path ?? "");
    if (!target) return;
    const next = !isFavorite(target);
    setFavorites((prev) => next ? [...prev, target] : prev.filter((item) => item !== target));
    const result = await alive(favoriteImage(target, next));
    if (!result) return;
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites);
      ui.showToast(next ? t("studio.toast.favorited") : t("studio.toast.unfavorited"));
      return;
    }
    setFavorites((prev) => next ? prev.filter((item) => item !== target) : [...prev, target]);
    ui.fail(result.code, result.message);
  }
  async function deleteImages2(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (list.length === 0) return;
    const result = await alive(deleteImages(list));
    if (!result) return;
    if (!result.ok) {
      ui.fail(result.code, result.message);
      return null;
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : [];
    if (removed.length > 0) ui.showToast(t("studio.toast.deleted"));
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      ui.fail("delete_failed", t("studio.error.deleteFailed"));
    }
    setSelectedPath("");
    await Promise.all([loadHistory(), loadLibrary()]);
    return { removed, failed: Array.isArray(result.data.failed) ? result.data.failed : [] };
  }
  function zoomImage(entry) {
    if (!entry) return;
    selectImage(entry);
    ui.setView("studio");
    ui.setZoom(true);
  }
  async function exportPaths(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (list.length === 0) return;
    const absoluteOf = /* @__PURE__ */ new Map();
    for (const entry of gallery) {
      const image = entry && entry.image || {};
      if (image.path && image.absolute) absoluteOf.set(image.path, image.absolute);
    }
    const text = list.map((item) => absoluteOf.get(item) || item).join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ui.showToast(t("studio.toast.exported"));
        return;
      }
    } catch {
    }
    ui.showToast(text);
  }
  return {
    gallery,
    batches,
    selected,
    selectImage,
    openMessage,
    favorites,
    isFavorite,
    toggleFavorite,
    deleteImages: deleteImages2,
    exportPaths,
    zoomImage,
    loadHistory
  };
}

// src/studio/useStudio.js
function useAlive() {
  const ref = import_react17.default.useRef(true);
  import_react17.default.useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return import_react17.default.useCallback(async (promise) => {
    const value = await promise;
    return ref.current ? value : null;
  }, []);
}
function useStudio(props) {
  const t = translator(props);
  const isEn = !/^zh/i.test(String(document.documentElement.lang || "en"));
  const host = useHostState();
  const alive = useAlive();
  const state = host.state;
  const initialPrompt = props && typeof props.initialPrompt === "string" ? props.initialPrompt : "";
  const initialView = props && props.view === "gallery" ? "gallery" : "studio";
  const initialPanelMode = props && props.panelMode === "chat" ? "chat" : "form";
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : [];
  const defaultPreset = state && state.defaultPreset || "";
  const [sending, setSending] = import_react17.default.useState(false);
  const pendingRef = import_react17.default.useRef(null);
  const ui = useStudioUi({ t, initialView, initialPanelMode });
  const control = useSessionControl({ t, host, ui, alive });
  const form = useStudioForm({ t, isEn, alive, ui, preset: { presets, defaultPreset }, initialPrompt });
  const chat = useChatThread({ t, isEn, alive, state, form, generate });
  const library = useWorkLibrary({ t, alive, ui, state });
  function startSession2() {
    return control.startSession(form.form.presetId || defaultPreset);
  }
  const compute = { ...control, presets, defaultPreset, startSession: startSession2 };
  async function generate(overrides, options = {}) {
    if (sending) return;
    const body = form.buildBody(overrides);
    if (!body.prompt) {
      ui.fail("need_prompt", "");
      return;
    }
    pendingRef.current = body;
    setSending(true);
    ui.setError(null);
    const result = await alive(submitGenerate(body));
    if (!result) return;
    setSending(false);
    if (result.ok && result.data && result.data.id) {
      const jobId = result.data.id;
      const entries = [];
      if (options.pushUser !== false) entries.push({ role: "user", text: body.prompt });
      entries.push({ role: "assistant", kind: "job", jobId, stage: "pending", text: t("studio.chat.pending") });
      chat.pushMessages(entries);
      host.refresh();
      library.loadHistory();
      ui.showToast(t("studio.toast.submitted"));
      return;
    }
    ui.fail(result.code, result.message);
  }
  function reroll(entry) {
    const target = entry || library.selected;
    const overrides = rerollOverrides(target, presets);
    if (!overrides) {
      ui.showToast(t("workbench.needPrompt"));
      return;
    }
    generate(overrides);
  }
  function iterate(entry) {
    const target = entry || library.selected;
    const patch = iteratePatch(target, form.form, presets);
    if (Object.keys(patch).length === 0) return;
    form.patchForm(patch);
    ui.setView("studio");
    ui.setPanelMode("form");
    ui.showToast(t("studio.toast.recalled"));
  }
  function retryFocusedJob() {
    const overrides = retryOverrides(control.focusedJob) || (pendingRef.current ? retryOverrides(pendingRef.current) : null);
    if (!overrides) {
      ui.showToast(t("workbench.needPrompt"));
      return;
    }
    generate(overrides);
  }
  function resetToSafe() {
    form.patchForm({ width: 1024, height: 1024, steps: 4, cfg: 1 });
    ui.setError(null);
    ui.showToast(t("studio.guidance.oom.action"));
  }
  function dismissGuidance() {
    ui.dismissGuidance(guidanceKey);
  }
  const guidanceCode = ui.error && ui.error.code || control.session && control.session.error && control.session.error.code || control.focusedJob && control.focusedJob.status === "failed" && control.focusedJob.error && control.focusedJob.error.code || "";
  const guidanceDetail = guidanceDetailOf({ error: ui.error, session: control.session, job: control.focusedJob });
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : "";
  const guidanceKind = guidanceCode && ui.dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : "";
  return {
    t,
    ui,
    compute,
    form,
    chat,
    library,
    guidance: { kind: guidanceKind, detail: guidanceDetail, dismiss: dismissGuidance },
    actions: { sending, generate, reroll, iterate, retryFocusedJob, resetToSafe }
  };
}

// src/studio/Studio.jsx
var import_jsx_runtime12 = require("react/jsx-runtime");
function Studio(props) {
  const { t, ui, compute, form, chat, library, guidance, actions } = useStudio(props);
  const now = useNow(Boolean(compute.activeJob));
  const elapsedMs = compute.activeJob ? jobElapsed(compute.activeJob, now) : 0;
  const chatMode = ui.panelMode === "chat";
  const panel = chatMode ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ChatPanel, { t, ui, form, chat, library, actions }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Rail, { t, ui, form, actions });
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "ofs-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "ofs-app", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(TopBar, { t, ui, compute, form, library }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(GuidanceCard, { t, guidance, compute, actions, ui }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: `ofs-body${ui.view === "gallery" ? " is-gallery" : ""}`, children: [
        ui.view === "studio" ? panel : null,
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "ofs-main", children: ui.view === "gallery" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          Gallery,
          {
            t,
            gallery: library.gallery,
            now: Date.now(),
            presets: compute.presets,
            favorites: library.favorites,
            onDelete: library.deleteImages,
            onExport: library.exportPaths,
            onRecall: actions.iterate,
            onVariant: actions.reroll,
            onZoom: library.zoomImage,
            onOpen: (entry) => {
              library.selectImage(entry);
              ui.setView("studio");
            }
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Stage, { t, ui, compute, form, library, actions }) })
      ] }),
      ui.view === "studio" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Filmstrip, { t, ui, compute, library, elapsedMs }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Toast, { toast: ui.toast })
  ] });
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
