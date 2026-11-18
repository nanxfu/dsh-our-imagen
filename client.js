window.__ModuleLoader__.load({
	id: "dsh-our-imagen",
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
var NS = "our-imagen";
var ACTIVE_STATUS = { queued: true, "waiting-session": true, running: true };
var TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true };
var PHASE_STATE = {
  push: "provisioning",
  queue: "provisioning",
  tunnel: "connecting",
  warm: "warming"
};
var INSPIRE_KEYS = [
  "studio.inspire.1",
  "studio.inspire.2",
  "studio.inspire.3",
  "studio.inspire.4",
  "studio.inspire.5"
];
var COUNT_OPTIONS = [1, 2, 3, 4];

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
  // ── 工作台通用 ───────────────────────────────────────────────
  "workbench.needPrompt": "先写提示词",
  // ── 会话状态 ─────────────────────────────────────────────────
  "session.state.absent": "云端未启动",
  "session.state.provisioning": "正在申请 GPU",
  "session.state.push": "正在准备云端",
  "session.state.queue": "正在排队等 GPU",
  "session.state.connecting": "正在连接云端",
  "session.state.warming": "正在准备模型",
  "session.state.ready": "云端就绪",
  "session.state.stopping": "正在关闭云端",
  "session.state.error": "云端异常",
  "session.state.errorAuth": "账号凭据不可用",
  "session.state.errorCli": "未安装 Kaggle CLI",
  "session.state.errorTimeout": "等待超时",
  "session.state.errorPush": "推送失败",
  "session.state.asleep": "云端已关闭",
  "session.phase.push": "推送内核",
  "session.phase.queue": "Kaggle 排队",
  "session.phase.tunnel": "建立隧道",
  "session.phase.warm": "加载模型",
  "session.hint.provisioning": "正在向 Kaggle 申请 GPU 机器。",
  "session.hint.push": "正在把运行环境推送到 Kaggle，推送完成后进入排队。",
  "session.hint.queue": "正在等待 Kaggle 分配 GPU；多数会话能在几十秒内启动。",
  "session.hint.queueSlow": "排队比平时久（多数会话几十秒内就能启动）。",
  "session.hint.connecting": "正在建立隧道并等待远端响应。",
  "session.hint.warming": "正在安装运行环境并加载模型权重，通常需要几分钟；完成后即可连续出图。",
  "session.hint.stopping": "正在结束会话；若任务仍在排队，可能需要在 Kaggle 网页上停止对应 Kernel。",
  "session.hint.asleep": "会话已结束；点「唤醒」可以重新开始。",
  "job.status.queued": "排队中",
  "job.status.waiting-session": "等待云端就绪",
  "job.status.running": "生成中",
  "job.status.done": "完成",
  "job.status.failed": "失败",
  // ── 错误码 ───────────────────────────────────────────────────
  "error.network": "本地服务暂无响应，请稍后重试。",
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
  "error.code.gpu_unavailable": "云端没有拿到 GPU",
  // ── 工作台骨架 ───────────────────────────────────────────────
  "studio.nav.label": "生图工作台",
  "studio.brand": "生图工作台",
  "studio.brandSub": "Studio",
  "studio.refresh": "刷新历史",
  "studio.tabs": "视图切换",
  "studio.tab.studio": "创作",
  "studio.tab.gallery": "画廊",
  // ── GPU 状态 ─────────────────────────────────────────────────
  "studio.compute.start": "唤醒",
  "studio.compute.stop": "关闭云端",
  "studio.compute.quota": "Kaggle 算力（已用/总量）",
  "studio.compute.phase": "阶段",
  "studio.compute.idleFor": "闲置休眠阈值",
  "studio.compute.idleCountdown": "已空闲 {idle} 分钟 · 满 {total} 分钟自动关机",
  "studio.compute.idleTooltip": "云端实例默认闲置 30 分钟自动关机，以节省你每周 30 小时的 Kaggle 免费 GPU 额度。",
  "studio.compute.offlineTooltip": "云端当前未运行，不占用 Kaggle 额度；点「唤醒」或直接生成都会自动启动（排队通常几十秒，首次装载模型需要几分钟）。",
  "studio.compute.asleepTooltip": "会话已结束，额度会在实例释放后归还；若启动过程被中断，对应 Kernel 可能仍在 Kaggle 运行，可到 Kaggle 网页停止。",
  "studio.compute.errorTooltip": "云端会话没有就绪；具体原因见下方提示，可查看运行日志后重试。",
  "studio.compute.speedLine": "云端模型实测：单张约",
  "studio.compute.authTooltip": "Kaggle 账号必须完成手机号绑定，未绑定的账号无法使用 GPU。",
  "studio.probe.cli": "命令行",
  "studio.probe.direct": "直连",
  "studio.probe.directOk": "直连正常",
  "studio.probe.directLoginRequired": "直连未登录",
  "studio.probe.account": "账号",
  "studio.probe.quota": "配额",
  "studio.probe.ok": "环境检查通过",
  "studio.probe.failed": "环境检查未通过",
  "studio.probe.timeout": "检查环境超时，可重试；首次检查需要 20~30 秒",
  "studio.compute.tunnel": "隧道通道",
  "studio.compute.tunnel.cloudflare": "Cloudflare",
  "studio.compute.tunnel.custom": "自建通道",
  "studio.compute.quotaFallback": "配额暂时读不到，先看本地统计",
  "studio.compute.lastGood": "最近一次成功检查",
  "studio.compute.neverChecked": "还没有成功检查过配额",
  "studio.compute.sessionRan": "本次会话已运行",
  "studio.compute.kaggleSettings": "打开 Kaggle 账户设置",
  // ── 进度提示 ─────────────────────────────────────────────────
  "studio.progress.waitingSession": "等待云端就绪…",
  "studio.progress.queued": "排队等待出图…",
  "studio.progress.loading": "正在加载模型…",
  "studio.progress.running": "正在生成…",
  "studio.progress.generatingCount": "正在生成第 {done}/{total} 张",
  "studio.session.elapsed": "已等待",
  // ── 生图流水线 ───────────────────────────────────────────────
  // 顶部节点条：会话段 + 生成段折算成固定五节点（行为见 docs/SPEC.md §5.13）。
  "studio.pipeline.label": "生图流水线",
  "studio.pipeline.node.push": "推送内核",
  "studio.pipeline.node.queue": "Kaggle 排队",
  "studio.pipeline.node.tunnel": "建立隧道",
  "studio.pipeline.node.model": "准备模型",
  "studio.pipeline.node.generate": "生成",
  "studio.pipeline.node.ready": "云端已就绪",
  "studio.pipeline.node.done": "出图完成",
  "studio.pipeline.node.failed": "生成失败",
  "studio.pipeline.node.closing": "正在关闭云端…",
  "studio.pipeline.hint.generate": "正在逐张出图；单张任务不显示张数。",
  "studio.pipeline.hint.ready": "这次生成复用了已经就绪的云端会话。",
  "studio.pipeline.count": "第 {done}/{total} 张",
  "studio.pipeline.busy": "另有 {count} 个排队",
  "studio.pipeline.slow": "比平时久",
  "studio.pipeline.queued": "排队等待出图…",
  "studio.pipeline.elapsed": "已等待",
  "studio.pipeline.elapsedDone": "用时",
  // ── 提示词 ───────────────────────────────────────────────────
  "studio.promptHint": "先写画面描述",
  "studio.preset": "模型预设",
  "studio.preset.menuTitle": "出图模型",
  "studio.preset.measured": "实测稳态耗时",
  "studio.preset.default": "默认",
  "studio.preset.langZhEn": "中英双语",
  "studio.preset.langEnOnly": "仅英文",
  // 专用局部重绘权重只出现在舞台图片工具里，主表单模型卡标成不可选。
  "studio.preset.imageToolOnly": "仅图片工具",
  // 算力来源能力位：当前来源跑不了的模型置灰 + 角标（如 9B 只在 Colab 大显存后端可用）。
  "studio.preset.providerOnly": "仅 {provider}",
  "studio.preset.providerBlocked": "当前算力来源（{provider}）跑不了这个模型；切换到 {needed} 后可用。",
  "studio.preset.providerName.kaggle": "Kaggle",
  "studio.preset.providerName.colab": "Colab",
  "studio.preset.stepsUnit": "步",
  "studio.preset.dualGpu": "双 GPU",
  "studio.preset.footer": "海报为概念示意，非出图样例；切换会套用推荐尺寸与步数。",
  "studio.prompt": "提示词",
  "studio.promptPlaceholder": "描述画面内容，Ctrl+Enter 生成",
  "studio.promptTooltip": "大多数模型仅按英文语料训练（标有「中英双语」的模型支持直接写中文）。输入中文给仅英文模型时会出现提示，可点「转为英文」一键翻译。",
  "studio.prompt.englishHint": "当前模型按英文提示词训练，中文描述可能出图偏差；可点上方「转为英文」直接转换。",
  "studio.negative": "排除项",
  "studio.negativePlaceholder": "画面中不希望出现的元素（如模糊、文字）",
  "studio.negativeTooltip": "画面中不希望出现的元素。仅在所选模型支持负向词且引导强度 (CFG) > 0 时可用；默认 4 步极速模型的 CFG 为 0，不适用排除项。",
  // ── 参数 ─────────────────────────────────────────────────────
  "studio.steps": "采样步数",
  "studio.stepsTooltip": "模型迭代去噪的步数；不同档位对应不同精细度与耗时。",
  "studio.stepsFixedTooltip": "该模型为蒸馏/极速架构，步数已按最优甜点锁定；大幅增减会破坏出图或拖慢耗时。",
  "studio.stepsReadout": "{steps} 步 · {tier}",
  "studio.stepsTier.fixed": "极速锁定",
  "studio.stepsTier.fast": "较快",
  "studio.stepsTier.balanced": "均衡",
  "studio.stepsTier.fine": "精绘",
  "studio.cfg": "引导强度",
  "studio.cfgTooltip": "数值越高越贴合提示词，过高可能产生色彩失真。默认推荐 1.5~7.0。",
  "studio.seed": "随机种子",
  "studio.random": "随机",
  "studio.seed.reset": "恢复随机",
  "studio.count": "生成张数",
  "studio.countShort": "张数",
  "studio.generate": "立即生成",
  "studio.generating": "提交中…",
  "studio.generateHint": "Ctrl+Enter 直接生成",
  // 专用局部重绘预设不能文生图：主表单本次请求自动切兜底预设 / 一个可用预设都没有时拦下。
  "studio.form.autoText2Image": "当前预设只支持局部重绘，本次已改用 {preset} 文生图",
  "studio.form.blockedInpaintOnly": "当前预设只支持局部重绘，且没有可用的文生图预设；请切换模型。",
  // 算力来源不匹配（模型资产 providers 能力位）：明确当前 / 所需来源与模型名，不静默换模型。
  "studio.form.blockedProvider": "「{preset}」只能运行在 {needed} 上，当前算力来源是 {provider}；请到运行设置里切换算力来源，或改用其他模型。",
  // ── 画面预览 ─────────────────────────────────────────────────
  "studio.stage.empty": "画面预览",
  "studio.stage.emptyHint": "在左侧输入画面描述，点击生成即可开始出图。",
  "studio.stage.stoppedHint": "云端已关闭，先点「唤醒」再生成。",
  // 阶段十三：显式新建绘图态（模糊动态背景 + 取景框）。
  "studio.stage.newDraftTitle": "一张还没生成的新画布",
  "studio.stage.newDraftHint": "在左侧填写画面描述，或把图片拖入取景框。",
  "studio.stage.newDraftPending": "已提交，第一张出图后自动切到作品。",
  "studio.stage.examples": "灵感示例",
  "studio.stage.steady": "稳定出图约",
  "studio.stage.zoom": "点击查看原图",
  "studio.stage.close": "关闭大图",
  "studio.image.alt": "生成的图片",
  "studio.meta.seed": "种子",
  "studio.action.reroll": "重新生成",
  "studio.action.copyPath": "复制文件路径",
  "studio.action.openFolder": "在文件夹中打开",
  "studio.action.favorite": "收藏",
  "studio.action.favorited": "已收藏",
  "studio.action.reference": "以此图重绘",
  // ── 最近生成 ─────────────────────────────────────────────────
  "studio.filmstrip.empty": "生成的每一批作品会显示在这里",
  "studio.filmstrip.offline": "云端尚未启动",
  "studio.filmstrip.offlineClosed": "云端已关闭",
  // 阶段十三：新建草稿卡、按根折叠的作品卡与版本派生面板。
  "studio.filmstrip.newDraft": "新建绘图",
  "studio.filmstrip.draftHint": "回到新画布",
  "studio.filmstrip.draftActive": "正在配置新画布",
  "studio.filmstrip.draftPending": "已提交，等待出图",
  "studio.filmstrip.versionsCount": "{count} 个版本",
  "studio.filmstrip.versionBadge": "⎇ {count}",
  "studio.filmstrip.versionBadgeHint": "版本分支",
  "studio.filmstrip.versionPanelTitle": "版本分支",
  "studio.filmstrip.versionPanelEmpty": "暂无派生版本",
  "studio.filmstrip.versionInFlight": "生成中",
  "studio.filmstrip.versionLoading": "正在拉取版本…",
  "studio.filmstrip.treeUnavailable": "当前宿主不支持版本树，仅显示已加载分页",
  "studio.filmstrip.versionKind.text": "文生图",
  "studio.filmstrip.versionKind.img2img": "整图重绘",
  "studio.filmstrip.versionKind.inpaint": "局部重绘",
  "studio.filmstrip.versionKind.upscale": "高清放大",
  "studio.filmstrip.versionKind.outpaint": "扩图",
  "studio.filmstrip.sourceDeleted": "来源作品已删除",
  "studio.filmstrip.draftDot": "有未提交的编辑",
  "studio.filmstrip.draftTitle": "已修改：{items}",
  "studio.filmstrip.draftClear": "清空草稿",
  "studio.filmstrip.draftItems.mask": "涂抹区域",
  "studio.filmstrip.draftItems.prompt": "提示词",
  "studio.filmstrip.draftItems.params": "参数",
  // 窄屏队列胶囊：胶片条在窄屏收起后用它显示后续待执行任务数。
  "studio.queue.waiting": "另有 {count} 张排队",
  // 排队卡住（10 分钟档）顶部横幅：非错误提示，主操作换新实例重排。
  "studio.queue.notice.title": "排队超过 {minutes} 分钟还没拿到 GPU",
  "studio.queue.notice.note": "多数会话推送后几十秒内就能启动；这次已经等了好几分钟，可能是这条排队卡住了。可以继续等待，也可以换新实例重排。",
  "studio.queue.notice.requeue": "换新实例重排",
  "studio.queue.notice.wait": "继续等待",
  "studio.toast.firstImage": "云端就绪，第一张图已生成",
  // ── 运行日志 ─────────────────────────────────────────────────
  "studio.logs.open": "查看运行日志",
  "studio.logs.title": "运行日志",
  "studio.logs.loading": "正在读取远端日志…",
  "studio.logs.empty": "暂无日志，云端会话启动后会出现安装与运行记录。",
  "studio.logs.copy": "复制诊断信息",
  "studio.logs.copied": "诊断信息已复制",
  "studio.logs.close": "关闭日志",
  "studio.logs.diag.title": "生图工作台诊断信息",
  "studio.logs.hostNote": "云端暂无远端日志，以下为 Host 本地运行日志（已脱敏），可据此排查启动与连接问题。",
  // ── 运行设置抽屉 ─────────────────────────────────────────────
  "studio.settings.open": "运行设置",
  "studio.settings.title": "运行设置",
  "studio.settings.close": "关闭设置",
  "studio.settings.loading": "正在读取运行设置…",
  "studio.settings.loadFailed": "读取运行设置失败",
  "studio.settings.retry": "重试",
  "studio.settings.effectiveNext": "当前云端实例已运行，修改将在下次唤醒时生效。",
  "studio.settings.saved": "运行设置已保存",
  "studio.settings.save": "保存设置",
  "studio.settings.saving": "保存中…",
  "studio.settings.cancel": "取消",
  "studio.settings.invalid": "有 {count} 行需要修正后才能保存",
  "studio.settings.section.runtime": "常规运行",
  "studio.settings.idle.label": "空闲自动关机",
  "studio.settings.idle.quick": "{minutes} 分钟",
  "studio.settings.idle.custom": "自定义分钟（{min}–{max}）",
  "studio.compute.ccu": "CCU {balance}",
  "studio.settings.provider.label": "算力来源",
  "studio.settings.provider.kaggle": "Kaggle（免费 GPU）",
  "studio.settings.provider.colab": "Colab Pro（需授权）",
  "studio.settings.colabGpu.label": "Colab GPU",
  "studio.settings.colabGpu.T4": "T4 16GB",
  "studio.settings.colabGpu.L4": "L4 24GB（推荐）",
  "studio.settings.colabGpu.A100": "A100 40GB",
  "studio.settings.colabGpu.G4": "G4 24GB",
  "studio.settings.colabHighRam.label": "高内存机型",
  "studio.settings.colabHighRam.hint": "仅对 T4 / A100 / G4 生效；L4 只有高内存机型，勾选会被忽略。",
  "studio.settings.colabAuth.label": "Google / Colab 授权",
  "studio.settings.colabAuth.ready": "已授权（{email}）",
  "studio.settings.colabAuth.readyAnon": "已授权（本地凭据有效）",
  "studio.settings.colabAuth.missing": "尚未完成 Google / Colab 授权",
  "studio.settings.colabAuth.login": "在浏览器中授权",
  "studio.settings.colabAuth.relogin": "重新授权",
  "studio.settings.accelerator.label": "GPU 加速器",
  "studio.settings.accelerator.NvidiaTeslaT4": "2× Tesla T4（默认推荐）",
  "studio.settings.accelerator.NvidiaTeslaP100": "Tesla P100",
  "studio.settings.kaggleTransport.label": "Kaggle 访问方式",
  "studio.settings.kaggleTransport.option.direct": "直连 Kaggle（默认，免安装 CLI）",
  "studio.settings.kaggleTransport.option.cli": "本机 kaggle CLI（兼容）",
  "studio.settings.kaggleTransport.directHint": "直连模式不需要安装 kaggle CLI；登录凭据写入 {path}。切换在下次唤醒或下次环境检查时生效。",
  "studio.settings.section.download": "模型下载与限流防护",
  "studio.settings.hfToken.label": "HuggingFace Token",
  "studio.settings.hfToken.placeholder": "粘贴 Token 可避免匿名限流",
  "studio.settings.hfToken.placeholderSet": "已配置，留空保持不变",
  "studio.settings.hfToken.clear": "清除 Token",
  "studio.settings.hfToken.clearPending": "保存后将清除已配置的 Token",
  "studio.settings.hfToken.source": "来源：{source}",
  "studio.settings.hfToken.sourceValue.settings": "设置抽屉",
  "studio.settings.hfToken.sourceValue.config": "宿主配置",
  "studio.settings.hfToken.sourceValue.none": "未配置",
  "studio.settings.advanced.toggle": "高级：预挂载与依赖锁定",
  "studio.settings.dataset.label": "预挂载 Kaggle Dataset",
  "studio.settings.dataset.placeholder": "每行一个，如 username/my-dataset",
  "studio.settings.dataset.hint": "每行一个 owner/dataset，最多 {max} 行。",
  "studio.settings.localModels.label": "本地模型目录映射",
  "studio.settings.localModels.placeholder": "每行一个，如 stabilityai/stable-diffusion-xl-base-1.0=/kaggle/input/sdxl",
  "studio.settings.localModels.hint": "每行一条 repo=容器路径；repo 是 HuggingFace 模型 ID，路径以 / 开头。",
  "studio.settings.localModels.errorFormat": "第 {line} 行：缺少 =，格式应为 repo=容器路径",
  "studio.settings.localModels.errorRepo": "第 {line} 行：repo 应为 owner/name 形式的 HuggingFace 模型 ID",
  "studio.settings.localModels.errorPath": "第 {line} 行：容器路径不能为空且应以 / 开头",
  "studio.settings.localModels.errorTooLong": "第 {line} 行：这一行过长",
  "studio.settings.localModels.errorTooMany": "第 {line} 行：最多只接受 {max} 项",
  "studio.settings.pip.label": "pip 依赖约束",
  "studio.settings.pip.placeholder": "每行一条，如 diffusers==0.31.0",
  "studio.settings.pip.hint": "每行一条约束，例如 diffusers==0.31.0。",
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
  "studio.toast.submitted": "已提交生图任务",
  "studio.toast.recalled": "参数已回填",
  // 胶卷点击遇到未提交的手动修改：只换预览、保留草稿。
  "studio.toast.draftKept": "已保留当前草稿",
  "studio.toast.newCreation": "已开始新的创作",
  "studio.toast.favorited": "已加入收藏",
  "studio.toast.unfavorited": "已取消收藏",
  "studio.toast.deleted": "已删除",
  "studio.toast.revealFailed": "无法打开文件夹",
  "studio.toast.generationDone": "页面隐藏期间，生成已完成",
  // ── 指引卡 ───────────────────────────────────────────────────
  "studio.guidance.oom.title": "当前分辨率或步数过大，显存不足",
  "studio.guidance.oom.action": "重置为 1024×1024",
  "studio.guidance.oom.reset": "已重置为 {size}×{size} · {steps} 步安全参数",
  "studio.guidance.sleep.title": "云端会话已结束，额度已释放",
  "studio.guidance.sleep.action": "唤醒云端",
  "studio.guidance.closed.title": "云端已关闭，任务没有执行",
  "studio.guidance.auth.title": "Kaggle 账号缺少手机号绑定或凭据不可用",
  "studio.guidance.auth.action": "打开 Kaggle 设置",
  "studio.guidance.auth.credentialHint": "kaggle auth login 会把 OAuth 凭据写入 {path}（含 refresh_token，过期可自动续期）；也可使用 Kaggle 网页生成的 API Token 保存为 {token}；旧版 CLI 仍兼容 {legacy}。",
  "studio.guidance.auth.copyLogin": "复制登录命令",
  "studio.guidance.auth.copied": "已复制登录命令",
  "studio.guidance.auth.directTitle": "Kaggle 账号未登录或凭据不可用",
  "studio.guidance.auth.directHint": "直接访问 Kaggle 不需要安装 kaggle CLI；登录成功后凭据写入 {path}，可随时重新发起。",
  "studio.guidance.auth.loginAction": "在浏览器中登录 Kaggle",
  "studio.guidance.auth.colabTitle": "Google / Colab 账号未授权或凭据已失效",
  "studio.guidance.auth.colabHint": "点击下方按钮完成 Google OAuth 授权，凭据保存在本地 {path}。",
  "studio.guidance.auth.colabAction": "在浏览器中登录 Google / Colab",
  "studio.guidance.auth.colabWaitingManual": "浏览器没有自动打开？复制下面的授权链接在浏览器完成授权，然后把跳转后的 http://localhost:... 完整地址或授权码粘贴到下方。",
  "studio.guidance.auth.colabCodePlaceholder": "粘贴回调地址（http://localhost:...）或授权码",
  "studio.guidance.auth.colabRetryWake": "重新唤醒云端",
  "studio.guidance.auth.colabDone": "Google / Colab 授权成功",
  "studio.guidance.auth.colabDoneWithUser": "Google / Colab 授权成功：{username}",
  "studio.guidance.auth.retry": "重新发起登录",
  "studio.guidance.auth.waiting": "正在等待浏览器完成授权…",
  "studio.guidance.auth.waitingManual": "浏览器没有自动打开？复制下面的授权链接，在浏览器中完成授权后把授权码粘贴到下面。",
  "studio.guidance.auth.cancel": "取消登录",
  "studio.guidance.auth.cancelled": "已取消登录，可重新发起。",
  "studio.guidance.auth.loginDone": "Kaggle 登录成功",
  "studio.guidance.auth.loginDoneWithUser": "Kaggle 登录成功：{username}",
  "studio.guidance.auth.failed": "登录失败：{reason}",
  "studio.guidance.auth.copyUrl": "复制授权链接",
  "studio.guidance.auth.urlCopied": "已复制授权链接",
  "studio.guidance.auth.codeLabel": "授权码",
  "studio.guidance.auth.codePlaceholder": "粘贴浏览器中显示的授权码",
  "studio.guidance.auth.codeSubmit": "提交授权码",
  "studio.guidance.auth.codeEmpty": "授权码不能为空",
  "studio.guidance.auth.codeTooShort": "授权码长度不足，请确认粘贴完整",
  "studio.guidance.auth.codeTooLong": "授权码过长，请只粘贴授权码本身",
  "studio.guidance.auth.codeFormat": "授权码包含无法识别的字符",
  "studio.guidance.auth.reason.timeout": "等待浏览器授权超时，可重新发起。",
  "studio.guidance.auth.reason.state": "授权回调校验失败，请重新发起登录。",
  "studio.guidance.auth.reason.browser": "无法自动打开浏览器，请改用粘贴授权码。",
  "studio.guidance.auth.reason.exchange": "授权码换取凭据失败，请重新发起登录。",
  "studio.guidance.auth.reason.network": "网络连接失败，登录没有完成。",
  "studio.guidance.auth.reason.unavailable": "当前宿主不支持直连登录（接口不可用）。",
  "studio.guidance.auth.reason.request": "登录请求失败，请稍后重试。",
  "studio.guidance.auth.reason.unknown": "登录没有完成。",
  "studio.guidance.gpu.title": "云端没有拿到 GPU",
  "studio.guidance.gpu.action": "打开 Kaggle 账户设置",
  "studio.guidance.gpu.hint": "请确认 Kaggle 账号已完成手机号验证，并在账户设置中启用 GPU 加速器，然后重新唤醒云端。",
  "studio.guidance.cli.title": "本地没有检测到 Kaggle 命令行",
  "studio.guidance.cli.action": "重新检查环境",
  "studio.guidance.cli.pathHint": "Windows 用户安装后若仍提示找不到命令，请确认 Python Scripts 目录已加入系统 PATH，并重启 DSH Desktop。",
  "studio.guidance.generic.title": "生成没有成功",
  "studio.guidance.generic.action": "重试一次",
  "studio.guidance.session.title": "云端会话没有就绪",
  "studio.guidance.queueTimeout.requeue": "换新实例重排",
  "studio.guidance.queueTimeout.hint": "排队 45 分钟仍未拿到 GPU，这次排队已经卡住。换新实例重排会删除这条排不上的 Kernel 并重新推送一个新实例，等待中的任务会继续等新会话。",
  "studio.guidance.network.title": "连不上本地服务",
  "studio.guidance.network.action": "重试",
  "studio.guidance.other.title": "操作没有完成",
  "studio.guidance.close": "关闭",
  "studio.guidance.cli.copy": "复制安装命令",
  "studio.guidance.cli.copied": "已复制安装命令",
  "studio.compute.check": "检查环境",
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
  "studio.refine.collapse": "收起",
  "studio.refine.expand": "展开",
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
  "studio.rail.params": "步数 / 引导强度 / 随机种子",
  // 版本微调：当前表单参数来自哪张作品；「新建创作」清掉这层绑定回到干净起点。
  "studio.rail.tuning": "正在微调：{prompt}",
  "studio.rail.tuningUnknown": "当前作品",
  "studio.rail.newCreation": "新建创作",
  // 左栏不再承载图片处理：告诉用户入口在舞台底部动作坞。
  "studio.rail.imageToolsHint": "图片处理（局部重绘 / 整图重绘）在舞台底部的动作坞里。",
  // ── 原生参考图槽（阶段十五 Phase C2） ────────────────────────
  // 文案口径：Klein 4B 的参考条件是弱条件（真机实测），不宣称「强一致参考」。
  "studio.reference.title": "参考图",
  "studio.reference.empty": "添加参考图（最多 {count} 张）",
  "studio.reference.emptyHint": "从电脑选择、拖入，或点「从作品选择」",
  "studio.reference.addMore": "添加参考图（{count}/{max}）",
  "studio.reference.full": "参考图已满 {max} 张",
  "studio.reference.remove": "移除参考图",
  "studio.reference.pickWork": "从作品选择",
  "studio.reference.pickClose": "收起作品列表",
  "studio.reference.pickEmpty": "还没有可加入的作品",
  "studio.reference.qualityHint": "参考图是弱条件：构图仍由提示词与种子主导，参考图越多耗时越长。",
  "studio.reference.unsupported": "当前模型不支持原生参考生图",
  "studio.reference.unsupportedHint": "换到支持参考的模型可以直接使用这些参考图；也可以改用整图重绘。",
  "studio.reference.switchPreset": "切换到 {preset}",
  "studio.reference.switched": "已切换到 {preset}，参考图保留",
  "studio.reference.useImg2img": "改用整图重绘",
  "studio.reference.uploading": "正在导入参考图…",
  "studio.reference.tooLarge": "参考图超过 {size} MiB",
  "studio.reference.added": "已加入 {count} 张参考图",
  "studio.reference.addedToSlot": "已设为参考图",
  "studio.reference.addedUnsupported": "已加入参考槽，但当前模型不支持原生参考生图",
  "studio.reference.duplicate": "这张图已在参考图槽里",
  "studio.reference.limit": "最多 {max} 张参考图，多出的没有加入",
  "studio.reference.importFailed": "参考图导入失败，请重试",
  "studio.reference.invalidPath": "只能使用工作区里已落盘的作品作为参考图",
  "studio.reference.noTarget": "没有可设为参考图的作品，请先在舞台选中一张",
  "studio.reference.noPreset": "当前没有支持原生参考生图的模型",
  "studio.reference.emptySlot": "参考图槽还是空的",
  "studio.reference.blockedUnsupported": "当前模型不支持原生参考生图：请换成支持参考的模型，或先移除参考图。",
  "studio.reference.setAsReference": "设为参考图",
  // ── 舞台图片工具（动作坞 / 轻量提交栏） ───────────────────────
  "studio.imageTool.title": "图片工具",
  "studio.imageTool.groupLabel": "图片处理",
  "studio.imageTool.inpaint": "局部重绘",
  "studio.imageTool.img2img": "整图重绘",
  "studio.imageTool.upscale": "高清放大",
  "studio.imageTool.outpaint": "扩图",
  "studio.imageTool.planned": "规划中，暂未开放",
  "studio.imageTool.autoPreset": "已自动改用 {preset}",
  "studio.imageTool.presetLabel": "模型",
  "studio.imageTool.promptLabel": "修改描述",
  "studio.imageTool.promptPlaceholder": "留空则沿用原作品提示词",
  "studio.imageTool.strengthLabel": "重绘强度",
  "studio.imageTool.submit": "重绘",
  "studio.imageTool.exit": "取消",
  "studio.imageTool.resumeDraft": "继续编辑",
  "studio.imageTool.draftStatus": "已涂 {percent}%",
  "studio.imageTool.maskEmpty": "尚未涂抹蒙版",
  "studio.imageTool.blockedNoPreset": "没有可用的模型，无法执行图片工具。",
  "studio.imageTool.blockedNoPrompt": "请填写修改描述，或让原作品带有提示词。",
  "studio.imageTool.blockedTarget": "没有可处理的底图，请先在舞台选中一张作品。",
  "studio.imageTool.submitted": "已提交图片处理任务",
  // 高清放大是零参数即时工具：点击即提交，源图超限在提交前拦下。
  "studio.imageTool.upscaleSubmitted": "已提交高清放大任务",
  "studio.imageTool.upscaleTooLarge": "源图过大，超出高清放大的输入上限；请选择更小的作品后再放大。",
  // 失败重试指向舞台工具：左栏「重试一次」不再重放带底图的任务。
  "studio.imageTool.retryMoved": "图片工具任务请在舞台动作坞中点「继续编辑」恢复后重新提交。",
  // ── 局部涂抹画布（MaskEditor 工具栏） ────────────────────────
  "studio.mask.title": "局部重绘",
  "studio.mask.hint": "在图上涂抹要重绘的区域；未涂抹的区域保持不变。",
  "studio.mask.brush": "画笔大小",
  "studio.mask.eraser": "橡皮擦",
  "studio.mask.undo": "撤销",
  "studio.mask.clear": "清空蒙版",
  "studio.mask.invert": "反选区域",
  "studio.mask.close": "暂存涂抹",
  "studio.mask.resetView": "复位视图",
  "studio.mask.coverage": "已涂抹 {percent}%",
  "studio.mask.tooLarge": "蒙版体积超过上限，未保存；请减少涂抹面积后重试。",
  "studio.mask.canvasLabel": "局部重绘画布：方向键移动画笔，回车键落笔，按住空格或中键拖动平移，滚轮缩放，Esc 暂存涂抹。",
  "studio.mask.shortcutsTitle": "快捷键",
  "studio.mask.shortcuts.zoom": "滚轮 · 缩放画面",
  "studio.mask.shortcuts.pan": "空格 / 中键拖动 · 移动画面",
  "studio.mask.shortcuts.brush": "Shift+滚轮 / [ ] · 调画笔",
  "studio.mask.shortcuts.eraser": "E / B · 橡皮 / 画笔",
  "studio.mask.shortcuts.undo": "Ctrl+Z · 撤销",
  "studio.mask.shortcuts.reset": "0 / 双击 · 复位画面",
  // ── 创作助手 ─────────────────────────────────────────────────
  "studio.chat.assistant": "创作助手",
  "studio.chat.parsing": "正在解析你的描述…",
  "studio.chat.intent.title": "生成确认",
  "studio.chat.intent.summary": "中文摘要",
  "studio.chat.intent.promptLabel": "英文提示词",
  "studio.chat.intent.negativeLabel": "排除项",
  "studio.chat.intent.negativePlaceholder": "不希望出现的元素，可留空",
  "studio.chat.intent.editHint": "可直接修改后再生成，不必重新对话。",
  "studio.chat.intent.generate": "按此生成",
  "studio.chat.intent.handoff": "带入参数面板",
  "studio.chat.intent.handoffDone": "已带入参数面板，可继续调参与批量抽卡。",
  "studio.chat.intent.modelHint": "更合适的模型：{model}（{reason}）",
  "studio.chat.intent.lockSeed": "沿用上张构图（锁定种子）",
  "studio.chat.clarify.title": "想先确认一下",
  "studio.chat.clarify.auto": "先按当前设置",
  "studio.chat.intent.local": "模型未响应，已按当前设置整理",
  "studio.chat.send": "发送",
  "studio.chat.ratioAuto": "比例自动",
  "studio.chat.pending": "已提交，等待开始…",
  "studio.chat.waitingSession": "等待云端就绪…",
  "studio.chat.queued": "排队等待出图…",
  "studio.chat.running": "正在生成…",
  "studio.chat.done": "已生成，点击缩略图放大。",
  "studio.chat.empty": "描述你想要的画面，Enter 发送。",
  "studio.chat.placeholder": "描述你想看到的画面…",
  "studio.chat.newChat": "新建对话",
  // 表单提交同步到助手：记录标题 + 参数胶囊标签（记录本身不进意图上下文）。
  "studio.chat.formSync.form": "来自参数表单",
  "studio.chat.formSync.variant": "生成变体",
  "studio.chat.formSync.retry": "重试上次参数",
  "studio.chat.formSync.seed": "种子 {seed}",
  "studio.chat.formSync.seedRandom": "随机种子",
  // ── 第二批：任务取消 / 英译 / 尺寸档位 / 分页 / 日志诊断 ──────────────
  "job.status.cancelled": "已取消",
  "studio.job.cancel": "取消",
  "studio.job.cancelling": "正在停止…",
  "studio.job.cancelHint": "当前这张画完后停止，已完成的图片会保留",
  "studio.toast.cancelled": "任务已取消",
  "studio.toast.cancelPartial": "已取消，保留已完成 {done} 张",
  "studio.translate.button": "转为英文",
  "studio.translate.thinking": "正在翻译…",
  "studio.translate.done": "提示词已转为英文",
  "studio.translate.local": "模型不可用，未能翻译；请手动改写为英文",
  "studio.rail.ratio": "画幅比例",
  "studio.rail.customSize": "自定义宽高",
  "studio.rail.custom": "自定义",
  "studio.rail.width": "宽",
  "studio.rail.height": "高",
  "studio.gallery.loadMore": "加载更多",
  "studio.gallery.allLoaded": "已加载全部作品",
  "studio.logs.tab.remote": "远端日志",
  "studio.logs.tab.host": "Host 日志",
  "studio.logs.hostFallbackTitle": "远端日志为空，已切换到 Host 本地日志",
  "studio.logs.hostEmpty": "Host 本地日志为空，云端会话启动后这里会出现安装与运行记录。",
  "studio.guidance.viewLogs": "查看日志",
  "studio.guidance.copyDiag": "复制诊断信息",
  "studio.update.badge": "有新版本可用",
  "studio.update.available": "新版本 v{latest} 可用（当前 v{current}）",
  "studio.update.hint": "可在 DSH 设置 → 插件管理里更新，或按 README 的安装方式重新安装并重启 DSH。",
  "studio.update.notes": "查看更新说明",
  "studio.update.requiresDsh": "新版本要求 DSH {range}，请先升级 DSH。",
  "studio.mask.guide": "小技巧：蒙版要包住要替换的整个物体（含边缘），一次只改一个物体；大面积整块涂抹容易出现接缝。",
  "studio.mask.fastModelHint": "当前是少步快速模型，局部重绘的改动幅度有限；需要明显改写时建议换 SDXL Base / RealVis 等多步模型。",
  "studio.mask.onlyHint": "当前是局部重绘专用模型：请先在画布上涂抹蒙版再提交。",
  // ── 阶段十五 Phase A：动作语义、草稿托管、助手时间线与本地导入 ──
  "studio.action.redraw": "重绘编辑",
  "studio.action.openStudio": "在工作台打开",
  "studio.filmstrip.draftUnsaved": "未提交草稿",
  "studio.filmstrip.draftFrom": "源自此图",
  "studio.filmstrip.draftFromPrompt": "源自：{prompt}",
  "studio.rail.draftStatus": "正在新草稿中编辑（源自此图）",
  "studio.rail.restoreOriginal": "还原原图",
  "studio.toast.restoredOriginal": "已还原原图参数",
  // 来源作品已被删除（或不在已加载列表）：参数照常还原，但舞台不再停在别的图上冒充来源。
  "studio.toast.restoredOriginalMissing": "来源作品已不在列表中，参数已还原",
  "studio.stage.draftFrom": "源自：{prompt}",
  "studio.chat.gridLabel": "本次生成 {count} 张",
  "studio.chat.focus.back": "返回上一层（{label}）",
  "studio.chat.focus.title": "单图聚焦",
  "studio.chat.focus.batch": "{count} 张生成结果",
  "studio.chat.focus.empty": "这张图没有上一层记录",
  "studio.chat.tool.inpaint": "对当前图发起了局部涂抹",
  "studio.chat.tool.img2img": "对当前图发起了整图重绘",
  "studio.chat.tool.upscale": "对当前图发起了高清放大",
  "studio.chat.tool.outpaint": "对当前图发起了扩图",
  "studio.chat.tool.strength": "重绘强度 {value}",
  "studio.chat.actions.compare": "对比原图",
  "studio.chat.actions.continueInpaint": "继续涂抹",
  "studio.chat.actions.regenerate": "重新生成",
  "studio.chat.actions.zoom": "查看大图",
  "studio.import.dropHint": "松开以导入图片",
  "studio.import.choose": "选择图片",
  "studio.import.blockedEditing": "请先退出或暂存当前涂抹，再导入新图片",
  "studio.import.importing": "正在导入…",
  "studio.import.done": "图片已导入",
  "studio.import.metaFound": "已识别生成参数，可在胶片条点这张图回填",
  "studio.import.invalidType": "只支持 PNG / JPEG 图片",
  "studio.import.tooLarge": "图片超过 {size} MiB",
  "studio.import.tooSmall": "图片长边至少 {edge} 像素",
  "studio.import.failed": "导入失败，请重试",
  "studio.import.needPrompt": "导入图没有原始提示词：请先在左栏写描述生成新作品，或用「整图重绘」基于这张图改图。",
  "studio.stage.importHint": "已导入为作品：用底部「整图重绘」或「局部涂抹」基于这张图改图；左栏生成的是新作品，参考图生新图暂未开放。",
  "studio.compare.toggle": "对比原图",
  "studio.compare.before": "原图",
  "studio.compare.after": "当前",
  "studio.compare.hint": "拖动分隔线对比原图",
  "studio.gallery.imported": "导入",
  // ── 阶段十五 Phase B：扩图画布 ───────────────────────────────
  "studio.outpaint.title": "扩图",
  "studio.outpaint.hint": "拖动内容框调整原图在画布里的位置；方向键微调，双击或点「回中」复位。新增区域会重新生成。",
  "studio.outpaint.ratioLabel": "扩图比例",
  "studio.outpaint.ratio.expand": "四边扩 20%",
  "studio.outpaint.ratio.16x9": "16:9",
  "studio.outpaint.ratio.9x16": "9:16",
  "studio.outpaint.ratio.4x3": "4:3",
  "studio.outpaint.coverage": "新增画面 {percent}%",
  "studio.outpaint.center": "回中",
  "studio.outpaint.dragHint": "拖动内容框调整留白位置",
  "studio.outpaint.canvasLabel": "扩图画布预览：内容框之外是新增区域。",
  "studio.outpaint.blockedCanvas": "扩图画布尚未生成，请调整比例或重新打开工具后重试。",
  "studio.outpaint.invalidCanvas": "扩图画布数据无效，本次导出已忽略；请重新拖动内容框后再试。",
  "studio.outpaint.tooLarge": "扩图画布或蒙版体积超过上限，未提交；请改用更小的比例。"
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
  // ── Workbench shared ──────────────────────────────────────────
  "workbench.needPrompt": "Write a prompt first",
  // ── Session state ─────────────────────────────────────────────
  "session.state.absent": "Cloud not running",
  "session.state.provisioning": "Requesting GPU",
  "session.state.push": "Preparing cloud",
  "session.state.queue": "Waiting for GPU",
  "session.state.connecting": "Connecting",
  "session.state.warming": "Preparing model",
  "session.state.ready": "Cloud ready",
  "session.state.stopping": "Shutting down",
  "session.state.error": "Cloud error",
  "session.state.errorAuth": "No credentials",
  "session.state.errorCli": "CLI missing",
  "session.state.errorTimeout": "Timed out",
  "session.state.errorPush": "Push failed",
  "session.state.asleep": "Cloud closed",
  "session.phase.push": "Pushing kernel",
  "session.phase.queue": "Kaggle queue",
  "session.phase.tunnel": "Connecting tunnel",
  "session.phase.warm": "Loading model",
  "session.hint.provisioning": "Asking Kaggle for a GPU machine.",
  "session.hint.push": "Pushing the environment to Kaggle; the queue opens as soon as the push finishes.",
  "session.hint.queue": "Waiting for Kaggle to assign a GPU; most sessions start within a minute.",
  "session.hint.queueSlow": "This queue is slower than usual (most sessions start within a minute).",
  "session.hint.connecting": "Setting up the tunnel and waiting for the remote side to answer.",
  "session.hint.warming": "Installing the runtime and loading model weights; this usually takes a few minutes.",
  "session.hint.stopping": "Ending the session; a queued Kernel may still need to be stopped on the Kaggle website.",
  "session.hint.asleep": "The session ended. Press Wake to start again.",
  "job.status.queued": "Queued",
  "job.status.waiting-session": "Waiting for the cloud",
  "job.status.running": "Generating",
  "job.status.done": "Done",
  "job.status.failed": "Failed",
  // ── Error codes ───────────────────────────────────────────────
  "error.network": "The local service is not responding; try again shortly.",
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
  "error.code.gpu_unavailable": "The cloud instance did not get a GPU",
  // ── Workbench shell ───────────────────────────────────────────
  "studio.nav.label": "Imagen Studio",
  "studio.brand": "Imagen Studio",
  "studio.brandSub": "Studio",
  "studio.refresh": "Refresh history",
  "studio.tabs": "Views",
  "studio.tab.studio": "Generate",
  "studio.tab.gallery": "Gallery",
  // ── GPU status ────────────────────────────────────────────────
  "studio.compute.start": "Wake",
  "studio.compute.stop": "Shut down",
  "studio.compute.quota": "Kaggle quota (used/total)",
  "studio.compute.phase": "Phase",
  "studio.compute.idleFor": "Auto-sleep after",
  "studio.compute.idleCountdown": "Idle for {idle} min · shuts down at {total} min",
  "studio.compute.idleTooltip": "The cloud instance shuts down after 30 idle minutes by default, to save your 30 free GPU hours per week on Kaggle.",
  "studio.compute.offlineTooltip": "The cloud is not running and uses no quota. Press Wake, or just generate — either starts it automatically (the queue usually takes under a minute; the first model load takes a few minutes).",
  "studio.compute.asleepTooltip": "The session ended; quota is returned once the instance is released. If startup was interrupted, its Kernel may still be running on Kaggle — stop it on the Kaggle website.",
  "studio.compute.errorTooltip": "The cloud session is not ready; see the notice below or the runtime logs, then retry.",
  "studio.compute.speedLine": "Measured on the loaded model: about",
  "studio.compute.authTooltip": "The Kaggle account needs a linked phone number; unverified accounts cannot use the GPU.",
  "studio.probe.cli": "CLI",
  "studio.probe.direct": "Direct",
  "studio.probe.directOk": "Direct OK",
  "studio.probe.directLoginRequired": "Direct, not signed in",
  "studio.probe.account": "Account",
  "studio.probe.quota": "Quota",
  "studio.probe.ok": "Environment check passed",
  "studio.probe.failed": "Environment check did not pass",
  "studio.probe.timeout": "The environment check timed out; try again. The first check takes 20–30 seconds.",
  "studio.compute.tunnel": "Tunnel",
  "studio.compute.tunnel.cloudflare": "Cloudflare",
  "studio.compute.tunnel.custom": "Custom tunnel",
  "studio.compute.quotaFallback": "Quota is unavailable; local stats below",
  "studio.compute.lastGood": "Last good check",
  "studio.compute.neverChecked": "No successful quota check yet",
  "studio.compute.sessionRan": "Session running for",
  "studio.compute.kaggleSettings": "Open Kaggle account settings",
  // ── Progress ──────────────────────────────────────────────────
  "studio.progress.waitingSession": "Waiting for the cloud…",
  "studio.progress.queued": "Waiting for the previous image…",
  "studio.progress.loading": "Loading the model…",
  "studio.progress.running": "Generating…",
  "studio.progress.generatingCount": "Generating image {done} of {total}",
  "studio.session.elapsed": "Waiting for",
  // ── Generation pipeline ──────────────────────────────────────
  // Top node strip: cloud session + job stages folded into five fixed nodes (see SPEC §5.13).
  "studio.pipeline.label": "Generation pipeline",
  "studio.pipeline.node.push": "Push kernel",
  "studio.pipeline.node.queue": "Kaggle queue",
  "studio.pipeline.node.tunnel": "Open tunnel",
  "studio.pipeline.node.model": "Prepare model",
  "studio.pipeline.node.generate": "Generate",
  "studio.pipeline.node.ready": "Cloud ready",
  "studio.pipeline.node.done": "Image ready",
  "studio.pipeline.node.failed": "Generation failed",
  "studio.pipeline.node.closing": "Shutting the cloud down…",
  "studio.pipeline.hint.generate": "Generating images one by one; single-image jobs hide the counter.",
  "studio.pipeline.hint.ready": "This run reuses the cloud session that is already ready.",
  "studio.pipeline.count": "Image {done}/{total}",
  "studio.pipeline.busy": "{count} more queued",
  "studio.pipeline.slow": "Slower than usual",
  "studio.pipeline.queued": "Waiting to generate…",
  "studio.pipeline.elapsed": "Elapsed",
  "studio.pipeline.elapsedDone": "Took",
  // ── Prompt ────────────────────────────────────────────────────
  "studio.promptHint": "Write a description first",
  "studio.preset": "Model preset",
  "studio.preset.menuTitle": "Models",
  "studio.preset.measured": "Measured steady time",
  "studio.preset.default": "Default",
  "studio.preset.langZhEn": "CN/EN",
  "studio.preset.langEnOnly": "EN only",
  // Dedicated inpainting weights live in the stage image tools only; the form picker marks them unselectable.
  "studio.preset.imageToolOnly": "Image tools only",
  // Compute-source capability: models the current provider cannot run are greyed out with a badge.
  "studio.preset.providerOnly": "Only {provider}",
  "studio.preset.providerBlocked": "This model cannot run on the current compute source ({provider}); switch to {needed} to use it.",
  "studio.preset.providerName.kaggle": "Kaggle",
  "studio.preset.providerName.colab": "Colab",
  "studio.preset.stepsUnit": "steps",
  "studio.preset.dualGpu": "Dual GPU",
  "studio.preset.footer": "Posters are conceptual, not model outputs. Switching applies the recommended size and steps.",
  "studio.prompt": "Prompt",
  "studio.promptPlaceholder": "Describe the image; press Ctrl+Enter to generate.",
  "studio.promptTooltip": "Most models only understand English prompts (models badged “CN/EN” understand Chinese directly). When writing Chinese for an English-only model, a hint appears so you can translate in one click.",
  "studio.prompt.englishHint": "This model is trained on English prompts, so a Chinese description may drift. Press “Translate to English” above to convert it.",
  "studio.negative": "Exclusions",
  "studio.negativePlaceholder": "What should stay out of the picture (blur, text)",
  "studio.negativeTooltip": "Elements you do not want in the image. Available only when the selected model consumes negative prompts and guidance (CFG) is above 0; the default 4-step models run at CFG 0 and ignore exclusions.",
  // ── Parameters ────────────────────────────────────────────────
  "studio.steps": "Steps",
  "studio.stepsTooltip": "Denoising steps; higher quality tiers trade speed for finer detail.",
  "studio.stepsFixedTooltip": "This distilled fast model locks steps to its optimal sweet spot; changing it significantly degrades output or wastes time.",
  "studio.stepsReadout": "{steps} steps · {tier}",
  "studio.stepsTier.fixed": "Locked",
  "studio.stepsTier.fast": "Fast",
  "studio.stepsTier.balanced": "Balanced",
  "studio.stepsTier.fine": "Fine",
  "studio.cfg": "Guidance",
  "studio.cfgTooltip": "Higher values follow the prompt more closely; too high can distort color. 1.5–7.0 is a safe range.",
  "studio.seed": "Seed",
  "studio.random": "Random",
  "studio.seed.reset": "Back to random",
  "studio.count": "Images",
  "studio.countShort": "Count",
  "studio.generate": "Generate",
  "studio.generating": "Submitting…",
  "studio.generateHint": "Ctrl+Enter also generates",
  // An inpaint-only preset cannot do text-to-image: the form falls back for this request, or blocks if none exists.
  "studio.form.autoText2Image": "The current preset only supports partial redraw; this request uses {preset} for text-to-image",
  "studio.form.blockedInpaintOnly": "The current preset only supports partial redraw and no text-to-image preset is available. Switch models.",
  // Compute-source mismatch (asset `providers` capability): name the model and both sources; never switch silently.
  "studio.form.blockedProvider": "“{preset}” requires {needed}, but the current compute source is {provider}. Switch the compute source in Run settings or pick another model.",
  // ── Preview ───────────────────────────────────────────────────
  "studio.stage.empty": "Preview",
  "studio.stage.emptyHint": "Describe the image on the left, then press Generate.",
  "studio.stage.stoppedHint": "The cloud is closed; press Wake before generating.",
  // Stage 13: explicit new-drawing mode (blurred animated backdrop + viewfinder frame).
  "studio.stage.newDraftTitle": "A canvas not generated yet",
  "studio.stage.newDraftHint": "Describe the image on the left, or drop an image into the frame.",
  "studio.stage.newDraftPending": "Submitted; the first image will open automatically when ready.",
  "studio.stage.examples": "Ideas",
  "studio.stage.steady": "Steady about",
  "studio.stage.zoom": "Click to view full size",
  "studio.stage.close": "Close preview",
  "studio.image.alt": "Generated image",
  "studio.meta.seed": "Seed",
  "studio.action.reroll": "Regenerate",
  "studio.action.copyPath": "Copy file path",
  "studio.action.openFolder": "Show in folder",
  "studio.action.favorite": "Favorite",
  "studio.action.favorited": "Favorited",
  "studio.action.reference": "Redraw from this",
  // ── Recent ────────────────────────────────────────────────────
  "studio.filmstrip.empty": "Each batch you generate shows up here",
  "studio.filmstrip.offline": "The cloud is not running yet",
  "studio.filmstrip.offlineClosed": "The cloud is closed",
  // Stage 13: new-draft card, root-folded work cards and the version panel.
  "studio.filmstrip.newDraft": "New drawing",
  "studio.filmstrip.draftHint": "New canvas",
  "studio.filmstrip.draftActive": "Configuring a new canvas",
  "studio.filmstrip.draftPending": "Submitted, waiting for output",
  "studio.filmstrip.versionsCount": "{count} versions",
  "studio.filmstrip.versionBadge": "⎇ {count}",
  "studio.filmstrip.versionBadgeHint": "Version branches",
  "studio.filmstrip.versionPanelTitle": "Version branches",
  "studio.filmstrip.versionPanelEmpty": "No derived versions yet",
  "studio.filmstrip.versionInFlight": "Generating",
  "studio.filmstrip.versionLoading": "Loading versions…",
  "studio.filmstrip.treeUnavailable": "This host has no version tree API; showing loaded pages only",
  "studio.filmstrip.versionKind.text": "Text to image",
  "studio.filmstrip.versionKind.img2img": "Whole-image redraw",
  "studio.filmstrip.versionKind.inpaint": "Partial redraw",
  "studio.filmstrip.versionKind.upscale": "Upscale",
  "studio.filmstrip.versionKind.outpaint": "Outpaint",
  "studio.filmstrip.sourceDeleted": "Source work was deleted",
  "studio.filmstrip.draftDot": "Unsubmitted edits",
  "studio.filmstrip.draftTitle": "Modified: {items}",
  "studio.filmstrip.draftClear": "Clear draft",
  "studio.filmstrip.draftItems.mask": "Mask",
  "studio.filmstrip.draftItems.prompt": "Prompt",
  "studio.filmstrip.draftItems.params": "Parameters",
  // Narrow-screen queue pill: the filmstrip is hidden below 820px, this keeps the pending count visible.
  "studio.queue.waiting": "{count} more queued",
  // Stalled queue (10 min) banner: not an error; the primary action requeues a fresh instance.
  "studio.queue.notice.title": "In queue for over {minutes} minutes without a GPU",
  "studio.queue.notice.note": "Most sessions start within a minute of the push; this queue has been waiting for several minutes, so it is likely stuck. You can keep waiting or requeue a fresh instance.",
  "studio.queue.notice.requeue": "Requeue a fresh instance",
  "studio.queue.notice.wait": "Keep waiting",
  "studio.toast.firstImage": "The cloud is ready; your first image is here",
  // ── Runtime logs ──────────────────────────────────────────────
  "studio.logs.open": "View runtime logs",
  "studio.logs.title": "Runtime logs",
  "studio.logs.loading": "Fetching remote logs…",
  "studio.logs.empty": "No logs yet. Install and runtime records appear after the cloud session starts.",
  "studio.logs.copy": "Copy diagnostics",
  "studio.logs.copied": "Diagnostics copied",
  "studio.logs.close": "Close logs",
  "studio.logs.diag.title": "Imagen Studio diagnostics",
  "studio.logs.hostNote": "No remote logs yet; showing the local host log (redacted) below.",
  // ── Runtime settings drawer ───────────────────────────────────
  "studio.settings.open": "Settings",
  "studio.settings.title": "Runtime settings",
  "studio.settings.close": "Close settings",
  "studio.settings.loading": "Loading runtime settings…",
  "studio.settings.loadFailed": "Could not load runtime settings",
  "studio.settings.retry": "Retry",
  "studio.settings.effectiveNext": "The cloud instance is running now; changes take effect the next time it wakes up.",
  "studio.settings.saved": "Runtime settings saved",
  "studio.settings.save": "Save settings",
  "studio.settings.saving": "Saving…",
  "studio.settings.cancel": "Cancel",
  "studio.settings.invalid": "{count} line(s) need fixing before saving",
  "studio.settings.section.runtime": "Runtime",
  "studio.settings.idle.label": "Auto-shutdown when idle",
  "studio.settings.idle.quick": "{minutes} min",
  "studio.settings.idle.custom": "Custom minutes ({min}–{max})",
  "studio.compute.ccu": "CCU {balance}",
  "studio.settings.provider.label": "Compute source",
  "studio.settings.provider.kaggle": "Kaggle (free GPU)",
  "studio.settings.provider.colab": "Colab Pro (authorization required)",
  "studio.settings.colabGpu.label": "Colab GPU",
  "studio.settings.colabGpu.T4": "T4 16GB",
  "studio.settings.colabGpu.L4": "L4 24GB (recommended)",
  "studio.settings.colabGpu.A100": "A100 40GB",
  "studio.settings.colabGpu.G4": "G4 24GB",
  "studio.settings.colabHighRam.label": "High-RAM machine",
  "studio.settings.colabHighRam.hint": "Applies to T4 / A100 / G4 only; L4 is high-RAM by default, so this flag is ignored.",
  "studio.settings.colabAuth.label": "Google / Colab auth",
  "studio.settings.colabAuth.ready": "Authorized ({email})",
  "studio.settings.colabAuth.readyAnon": "Authorized (local credentials saved)",
  "studio.settings.colabAuth.missing": "Google / Colab authorization required",
  "studio.settings.colabAuth.login": "Authorize in browser",
  "studio.settings.colabAuth.relogin": "Re-authorize",
  "studio.settings.accelerator.label": "GPU accelerator",
  "studio.settings.accelerator.NvidiaTeslaT4": "2× Tesla T4 (recommended)",
  "studio.settings.accelerator.NvidiaTeslaP100": "Tesla P100",
  "studio.settings.kaggleTransport.label": "Kaggle access method",
  "studio.settings.kaggleTransport.option.direct": "Direct Kaggle (default, no CLI)",
  "studio.settings.kaggleTransport.option.cli": "Local kaggle CLI (compatibility)",
  "studio.settings.kaggleTransport.directHint": "Direct mode does not require the kaggle CLI; sign-in credentials are written to {path}. The change takes effect at the next wake-up or environment check.",
  "studio.settings.section.download": "Model downloads and rate limits",
  "studio.settings.hfToken.label": "HuggingFace token",
  "studio.settings.hfToken.placeholder": "Paste a token to avoid anonymous rate limits",
  "studio.settings.hfToken.placeholderSet": "Already configured; leave empty to keep it",
  "studio.settings.hfToken.clear": "Clear token",
  "studio.settings.hfToken.clearPending": "The saved token will be cleared when you save",
  "studio.settings.hfToken.source": "Source: {source}",
  "studio.settings.hfToken.sourceValue.settings": "Saved here",
  "studio.settings.hfToken.sourceValue.config": "Plugin config",
  "studio.settings.hfToken.sourceValue.none": "Not configured",
  "studio.settings.advanced.toggle": "Advanced: preloads and pinned dependencies",
  "studio.settings.dataset.label": "Pre-mounted Kaggle datasets",
  "studio.settings.dataset.placeholder": "One per line, e.g. username/my-dataset",
  "studio.settings.dataset.hint": "One owner/dataset per line, up to {max} lines.",
  "studio.settings.localModels.label": "Local model directories",
  "studio.settings.localModels.placeholder": "One per line, e.g. stabilityai/stable-diffusion-xl-base-1.0=/kaggle/input/sdxl",
  "studio.settings.localModels.hint": "One repo=container-path per line; repo is a HuggingFace model ID and the path starts with /.",
  "studio.settings.localModels.errorFormat": "Line {line}: missing =; use repo=container-path",
  "studio.settings.localModels.errorRepo": "Line {line}: repo should be a HuggingFace model ID in owner/name form",
  "studio.settings.localModels.errorPath": "Line {line}: the container path must start with /",
  "studio.settings.localModels.errorTooLong": "Line {line}: this line is too long",
  "studio.settings.localModels.errorTooMany": "Line {line}: at most {max} entries",
  "studio.settings.pip.label": "pip dependency constraints",
  "studio.settings.pip.placeholder": "One per line, e.g. diffusers==0.31.0",
  "studio.settings.pip.hint": "One constraint per line, for example diffusers==0.31.0.",
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
  "studio.toast.submitted": "Generation submitted",
  "studio.toast.recalled": "Settings restored",
  // Filmstrip click with unsaved manual edits: preview switches, draft stays.
  "studio.toast.draftKept": "Current draft kept",
  "studio.toast.newCreation": "Started a new creation",
  "studio.toast.favorited": "Added to favorites",
  "studio.toast.unfavorited": "Removed from favorites",
  "studio.toast.deleted": "Deleted",
  "studio.toast.revealFailed": "Could not open the folder",
  "studio.toast.generationDone": "Generation finished while the page was hidden",
  // ── Guidance cards ────────────────────────────────────────────
  "studio.guidance.oom.title": "Out of memory at this size or step count",
  "studio.guidance.oom.action": "Reset to 1024×1024",
  "studio.guidance.oom.reset": "Reset to safe {size}×{size} · {steps} steps",
  "studio.guidance.sleep.title": "The cloud session ended and released your quota",
  "studio.guidance.sleep.action": "Wake the cloud",
  "studio.guidance.closed.title": "The cloud is closed, so the task did not run",
  "studio.guidance.auth.title": "The Kaggle account needs phone verification or usable credentials",
  "studio.guidance.auth.action": "Open Kaggle settings",
  "studio.guidance.auth.credentialHint": "kaggle auth login writes OAuth credentials to {path} (with a refresh_token, so it renews automatically). You can also save an API token generated on the Kaggle website as {token}; older CLIs still accept {legacy}.",
  "studio.guidance.auth.copyLogin": "Copy login command",
  "studio.guidance.auth.copied": "Login command copied",
  "studio.guidance.auth.directTitle": "The Kaggle account is not signed in or its credentials are unusable",
  "studio.guidance.auth.directHint": "Direct Kaggle access does not require the kaggle CLI. After sign-in the credentials are written to {path}; you can start again at any time.",
  "studio.guidance.auth.loginAction": "Sign in to Kaggle in the browser",
  "studio.guidance.auth.colabTitle": "Google / Colab is not authorized or its credentials expired",
  "studio.guidance.auth.colabHint": "Sign in with Google to authorize Colab; credentials are saved locally to {path}.",
  "studio.guidance.auth.colabAction": "Sign in to Google / Colab in browser",
  "studio.guidance.auth.colabWaitingManual": "Browser did not open automatically? Copy the link below, finish Google sign-in, then paste the redirected http://localhost:... URL or code below.",
  "studio.guidance.auth.colabCodePlaceholder": "Paste redirected URL (http://localhost:...) or code",
  "studio.guidance.auth.colabRetryWake": "Wake cloud again",
  "studio.guidance.auth.colabDone": "Google / Colab authorized",
  "studio.guidance.auth.colabDoneWithUser": "Google / Colab authorized: {username}",
  "studio.guidance.auth.retry": "Start sign-in again",
  "studio.guidance.auth.waiting": "Waiting for the browser to finish authorization…",
  "studio.guidance.auth.waitingManual": "Browser did not open automatically? Copy the authorization link below, finish authorization in the browser, then paste the code here.",
  "studio.guidance.auth.cancel": "Cancel sign-in",
  "studio.guidance.auth.cancelled": "Sign-in cancelled. You can start again.",
  "studio.guidance.auth.loginDone": "Kaggle sign-in succeeded",
  "studio.guidance.auth.loginDoneWithUser": "Kaggle sign-in succeeded: {username}",
  "studio.guidance.auth.failed": "Sign-in failed: {reason}",
  "studio.guidance.auth.copyUrl": "Copy authorization link",
  "studio.guidance.auth.urlCopied": "Authorization link copied",
  "studio.guidance.auth.codeLabel": "Authorization code",
  "studio.guidance.auth.codePlaceholder": "Paste the code shown in the browser",
  "studio.guidance.auth.codeSubmit": "Submit code",
  "studio.guidance.auth.codeEmpty": "The authorization code is required",
  "studio.guidance.auth.codeTooShort": "The authorization code is too short; make sure it is complete",
  "studio.guidance.auth.codeTooLong": "The authorization code is too long; paste only the code itself",
  "studio.guidance.auth.codeFormat": "The authorization code contains unsupported characters",
  "studio.guidance.auth.reason.timeout": "Timed out waiting for browser authorization. You can start again.",
  "studio.guidance.auth.reason.state": "The authorization callback failed validation. Start the sign-in again.",
  "studio.guidance.auth.reason.browser": "Could not open the browser automatically; paste the authorization code instead.",
  "studio.guidance.auth.reason.exchange": "Could not exchange the authorization code for credentials. Start again.",
  "studio.guidance.auth.reason.network": "The network request failed; sign-in did not complete.",
  "studio.guidance.auth.reason.unavailable": "This host does not support direct sign-in (endpoint unavailable).",
  "studio.guidance.auth.reason.request": "The sign-in request failed. Try again later.",
  "studio.guidance.auth.reason.unknown": "Sign-in did not complete.",
  "studio.guidance.gpu.title": "The cloud instance did not get a GPU",
  "studio.guidance.gpu.action": "Open Kaggle account settings",
  "studio.guidance.gpu.hint": "Make sure your Kaggle account has a verified phone number and that the GPU accelerator is enabled in account settings, then wake the cloud again.",
  "studio.guidance.cli.title": "The Kaggle CLI was not found locally",
  "studio.guidance.cli.action": "Check again",
  "studio.guidance.cli.pathHint": "On Windows, if the command is still not found after installing, make sure the Python Scripts folder is on the system PATH and restart DSH Desktop.",
  "studio.guidance.generic.title": "The generation did not finish",
  "studio.guidance.generic.action": "Try again",
  "studio.guidance.session.title": "The cloud session is not ready",
  "studio.guidance.queueTimeout.requeue": "Requeue a fresh instance",
  "studio.guidance.queueTimeout.hint": "The queue has been stuck for 45 minutes without a GPU. Requeueing deletes the stuck Kernel and pushes a fresh instance; pending jobs keep waiting for the new session.",
  "studio.guidance.network.title": "Cannot reach the local service",
  "studio.guidance.network.action": "Retry",
  "studio.guidance.other.title": "That action did not complete",
  "studio.guidance.close": "Dismiss",
  "studio.guidance.cli.copy": "Copy install command",
  "studio.guidance.cli.copied": "Install command copied",
  "studio.compute.check": "Check environment",
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
  "studio.refine.collapse": "Collapse",
  "studio.refine.expand": "Expand",
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
  // Version tuning: which work the current form comes from; "New creation" clears that tie.
  "studio.rail.tuning": "Tuning from: {prompt}",
  "studio.rail.tuningUnknown": "current work",
  "studio.rail.newCreation": "New creation",
  // The left panel no longer hosts image processing: point at the stage action dock.
  "studio.rail.imageToolsHint": "Image processing (partial redraw / whole-image redraw) lives in the action dock at the bottom of the stage.",
  // ── Native reference slot (Phase C2) ─────────────────────────
  // Wording: Klein 4B references are weak conditions (measured), never claim strong consistency.
  "studio.reference.title": "References",
  "studio.reference.empty": "Add reference images (up to {count})",
  "studio.reference.emptyHint": "Choose from your computer, drop here, or pick from works",
  "studio.reference.addMore": "Add reference ({count}/{max})",
  "studio.reference.full": "Reference slot is full ({max})",
  "studio.reference.remove": "Remove reference",
  "studio.reference.pickWork": "Pick from works",
  "studio.reference.pickClose": "Hide works",
  "studio.reference.pickEmpty": "No more works available",
  "studio.reference.qualityHint": "References are weak conditions: prompt and seed still lead, and more references take longer.",
  "studio.reference.unsupported": "Current model does not support native reference images",
  "studio.reference.unsupportedHint": "Switch to a model that supports references, or use full-image redraw instead.",
  "studio.reference.switchPreset": "Switch to {preset}",
  "studio.reference.switched": "Switched to {preset}, references kept",
  "studio.reference.useImg2img": "Use full redraw",
  "studio.reference.uploading": "Importing reference…",
  "studio.reference.tooLarge": "Reference exceeds {size} MiB",
  "studio.reference.added": "Added {count} reference image(s)",
  "studio.reference.addedToSlot": "Set as reference",
  "studio.reference.addedUnsupported": "Added to the reference slot, but the current model does not support references",
  "studio.reference.duplicate": "This image is already in the reference slot",
  "studio.reference.limit": "Up to {max} reference images; extra images were skipped",
  "studio.reference.importFailed": "Failed to import the reference image, please retry",
  "studio.reference.invalidPath": "Only works already saved in the workspace can be references",
  "studio.reference.noTarget": "Select a work on the stage first",
  "studio.reference.noPreset": "No model supports native reference images right now",
  "studio.reference.emptySlot": "The reference slot is empty",
  "studio.reference.blockedUnsupported": "This model does not support native reference images: switch models or remove the references.",
  "studio.reference.setAsReference": "Set as reference",
  // ── Stage image tools (action dock / inline submit bar) ───────
  "studio.imageTool.title": "Image tools",
  "studio.imageTool.groupLabel": "Image processing",
  "studio.imageTool.inpaint": "Partial redraw",
  "studio.imageTool.img2img": "Whole-image redraw",
  "studio.imageTool.upscale": "Upscale",
  "studio.imageTool.outpaint": "Outpaint",
  "studio.imageTool.planned": "Planned, not available yet",
  "studio.imageTool.autoPreset": "Switched to {preset} automatically",
  "studio.imageTool.presetLabel": "Model",
  "studio.imageTool.promptLabel": "Change description",
  "studio.imageTool.promptPlaceholder": "Leave empty to reuse the original prompt",
  "studio.imageTool.strengthLabel": "Redraw strength",
  "studio.imageTool.submit": "Redraw",
  "studio.imageTool.exit": "Cancel",
  "studio.imageTool.resumeDraft": "Keep editing",
  "studio.imageTool.draftStatus": "{percent}% painted",
  "studio.imageTool.maskEmpty": "Not painted yet",
  "studio.imageTool.blockedNoPreset": "No usable model, so the image tool cannot run.",
  "studio.imageTool.blockedNoPrompt": "Write a change description, or use a work that has a prompt.",
  "studio.imageTool.blockedTarget": "No base image to process. Select a work on the stage first.",
  "studio.imageTool.submitted": "Image processing task submitted",
  // 高清放大是零参数即时工具：点击即提交，源图超限在提交前拦下。
  "studio.imageTool.upscaleSubmitted": "Upscale task submitted",
  "studio.imageTool.upscaleTooLarge": "The source image is too large for upscale; pick a smaller work and try again.",
  // Failed tasks fall back to the stage tool: the left panel no longer replays reference jobs.
  "studio.imageTool.retryMoved": "This task came from an image tool. Use “Keep editing” in the stage dock to restore it and submit again.",
  // ── Partial redraw canvas (MaskEditor toolbar) ────────────────
  "studio.mask.title": "Partial redraw",
  "studio.mask.hint": "Paint the area to redraw; untouched areas stay unchanged.",
  "studio.mask.brush": "Brush size",
  "studio.mask.eraser": "Eraser",
  "studio.mask.undo": "Undo",
  "studio.mask.clear": "Clear mask",
  "studio.mask.invert": "Invert selection",
  "studio.mask.close": "Stash mask",
  "studio.mask.resetView": "Reset view",
  "studio.mask.coverage": "Painted {percent}%",
  "studio.mask.tooLarge": "The mask exceeds the size limit and was not saved. Paint a smaller area and try again.",
  "studio.mask.canvasLabel": "Mask painting canvas: arrow keys move, Enter paints, hold Space or middle-drag to pan, wheel zooms, Esc stashes mask.",
  "studio.mask.shortcutsTitle": "Shortcuts",
  "studio.mask.shortcuts.zoom": "Wheel · Zoom view",
  "studio.mask.shortcuts.pan": "Space / Middle drag · Pan",
  "studio.mask.shortcuts.brush": "Shift+Wheel / [ ] · Brush size",
  "studio.mask.shortcuts.eraser": "E / B · Eraser / Brush",
  "studio.mask.shortcuts.undo": "Ctrl+Z · Undo stroke",
  "studio.mask.shortcuts.reset": "0 / Double-click · Reset view",
  // ── Creation assistant ────────────────────────────────────────
  "studio.chat.assistant": "Assistant",
  "studio.chat.parsing": "Reading your description…",
  "studio.chat.intent.title": "Ready to generate",
  "studio.chat.intent.summary": "Summary",
  "studio.chat.intent.promptLabel": "English prompt",
  "studio.chat.intent.negativeLabel": "Exclusions",
  "studio.chat.intent.negativePlaceholder": "What to keep out; can be left empty",
  "studio.chat.intent.editHint": "Edit these fields, then generate — no need to rephrase.",
  "studio.chat.intent.generate": "Generate this",
  "studio.chat.intent.handoff": "Move to the form",
  "studio.chat.intent.handoffDone": "Moved to the form; keep tuning and generate several images.",
  "studio.chat.intent.modelHint": "Better model: {model} ({reason})",
  "studio.chat.intent.lockSeed": "Reuse last composition (lock seed)",
  "studio.chat.clarify.title": "A quick check",
  "studio.chat.clarify.auto": "Use current settings",
  "studio.chat.intent.local": "The model did not respond; using current settings",
  "studio.chat.send": "Send",
  "studio.chat.ratioAuto": "Ratio auto",
  "studio.chat.pending": "Submitted; waiting to start…",
  "studio.chat.waitingSession": "Waiting for the cloud…",
  "studio.chat.queued": "Waiting for the previous image…",
  "studio.chat.running": "Generating…",
  "studio.chat.done": "Done. Click the thumbnail to enlarge.",
  "studio.chat.empty": "Describe the image you want; press Enter to send.",
  "studio.chat.placeholder": "Describe the image you want…",
  "studio.chat.newChat": "New chat",
  // Form submissions synced into the assistant: record title + parameter chip labels.
  "studio.chat.formSync.form": "From the form",
  "studio.chat.formSync.variant": "Variant",
  "studio.chat.formSync.retry": "Retry last params",
  "studio.chat.formSync.seed": "Seed {seed}",
  "studio.chat.formSync.seedRandom": "Random seed",
  // ── Batch 2: job cancel / translation / size options / paging / log diagnostics ──
  "job.status.cancelled": "Cancelled",
  "studio.job.cancel": "Cancel",
  "studio.job.cancelling": "Stopping…",
  "studio.job.cancelHint": "Stops after the current image; finished images are kept",
  "studio.toast.cancelled": "Job cancelled",
  "studio.toast.cancelPartial": "Cancelled; kept {done} finished image(s)",
  "studio.translate.button": "Translate to English",
  "studio.translate.thinking": "Translating…",
  "studio.translate.done": "Prompt translated to English",
  "studio.translate.local": "Model unavailable, not translated. Please rewrite it in English manually.",
  "studio.rail.ratio": "Aspect ratio",
  "studio.rail.customSize": "Custom size",
  "studio.rail.custom": "Custom",
  "studio.rail.width": "Width",
  "studio.rail.height": "Height",
  "studio.gallery.loadMore": "Load more",
  "studio.gallery.allLoaded": "All works loaded",
  "studio.logs.tab.remote": "Remote logs",
  "studio.logs.tab.host": "Host logs",
  "studio.logs.hostFallbackTitle": "No remote logs — switched to Host logs",
  "studio.logs.hostEmpty": "No Host logs yet. Install and runtime records appear after the cloud session starts.",
  "studio.guidance.viewLogs": "View logs",
  "studio.guidance.copyDiag": "Copy diagnostics",
  "studio.update.badge": "Update available",
  "studio.update.available": "Update available: v{latest} (current v{current})",
  "studio.update.hint": "Update it in DSH Settings → Plugins, or reinstall following the README and restart DSH.",
  "studio.update.notes": "Release notes",
  "studio.update.requiresDsh": "The new version requires DSH {range}; upgrade DSH first.",
  "studio.mask.guide": "Tip: cover the whole object you want to repaint (including its edges) and change one object at a time; large block masks tend to show seams.",
  "studio.mask.fastModelHint": "This is a few-step fast model, so local repaints change less; switch to a multi-step model (SDXL Base / RealVis) when you need a bigger rewrite.",
  "studio.mask.onlyHint": "This is a dedicated inpainting model: paint a mask on the canvas before submitting.",
  // ── Stage 15 Phase A: action semantics, draft hosting, assistant timeline, local import ──
  "studio.action.redraw": "Redraw",
  "studio.action.openStudio": "Open in studio",
  "studio.filmstrip.draftUnsaved": "Unsaved draft",
  "studio.filmstrip.draftFrom": "From this image",
  "studio.filmstrip.draftFromPrompt": "From: {prompt}",
  "studio.rail.draftStatus": "Editing a new draft from this image",
  "studio.rail.restoreOriginal": "Restore original",
  "studio.toast.restoredOriginal": "Original settings restored",
  // Source work deleted (or not in the loaded list): settings are restored, the stage does not
  // keep showing another image as if it were the source.
  "studio.toast.restoredOriginalMissing": "Source work is no longer listed; settings restored",
  "studio.stage.draftFrom": "From: {prompt}",
  "studio.chat.gridLabel": "{count} results",
  "studio.chat.focus.back": "Back ({label})",
  "studio.chat.focus.title": "Focused image",
  "studio.chat.focus.batch": "{count} results",
  "studio.chat.focus.empty": "No previous level for this image",
  "studio.chat.tool.inpaint": "Started inpainting on this image",
  "studio.chat.tool.img2img": "Started a full redraw of this image",
  "studio.chat.tool.upscale": "Started upscaling this image",
  "studio.chat.tool.outpaint": "Started outpainting this image",
  "studio.chat.tool.strength": "Strength {value}",
  "studio.chat.actions.compare": "Compare original",
  "studio.chat.actions.continueInpaint": "Continue inpainting",
  "studio.chat.actions.regenerate": "Regenerate",
  "studio.chat.actions.zoom": "View large",
  "studio.import.dropHint": "Drop to import",
  "studio.import.choose": "Choose image",
  "studio.import.blockedEditing": "Exit or stash the current paint job before importing a new image",
  "studio.import.importing": "Importing…",
  "studio.import.done": "Image imported",
  "studio.import.metaFound": "Generation settings found; click this work in the filmstrip to restore them",
  "studio.import.invalidType": "Only PNG / JPEG images are supported",
  "studio.import.tooLarge": "Image exceeds {size} MiB",
  "studio.import.tooSmall": "Image edge must be at least {edge} px",
  "studio.import.failed": "Import failed, please retry",
  "studio.import.needPrompt": 'An imported image has no original prompt: write a description on the left to create a new work, or use "Full redraw" to edit this image.',
  "studio.stage.importHint": 'Imported as a work: use "Full redraw" or "Inpaint" below to edit it. The left form creates a new work; reference-based generation is not available yet.',
  "studio.compare.toggle": "Compare original",
  "studio.compare.before": "Original",
  "studio.compare.after": "Current",
  "studio.compare.hint": "Drag the divider to compare",
  "studio.gallery.imported": "Imported",
  // ── 阶段十五 Phase B：扩图画布 ───────────────────────────────
  "studio.outpaint.title": "Outpaint",
  "studio.outpaint.hint": "Drag the content frame to place the original in the canvas; arrow keys nudge it, double-click or “Center” resets. The new area is regenerated.",
  "studio.outpaint.ratioLabel": "Outpaint ratio",
  "studio.outpaint.ratio.expand": "Expand 20% all sides",
  "studio.outpaint.ratio.16x9": "16:9",
  "studio.outpaint.ratio.9x16": "9:16",
  "studio.outpaint.ratio.4x3": "4:3",
  "studio.outpaint.coverage": "New area {percent}%",
  "studio.outpaint.center": "Center",
  "studio.outpaint.dragHint": "Drag the content frame to adjust the padding",
  "studio.outpaint.canvasLabel": "Outpaint canvas preview: the area outside the content frame is newly generated.",
  "studio.outpaint.blockedCanvas": "The outpaint canvas is not ready yet. Change the ratio or reopen the tool and try again.",
  "studio.outpaint.invalidCanvas": "The outpaint canvas data is invalid and was ignored. Drag the content frame again and retry.",
  "studio.outpaint.tooLarge": "The outpaint canvas or mask exceeds the size limit, so it was not submitted. Try a smaller ratio."
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

// src/logic/format.js
function percentOf(coverage) {
  const value = Number(coverage);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const percent = Math.min(100, value * 100);
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
}
function positiveSize(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}
function formatText(template, values) {
  const text = typeof template === "string" ? template : "";
  if (!text) return "";
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values ? values[name] : void 0;
    return value === void 0 || value === null ? match : String(value);
  });
}
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
  return `${value.toFixed(1)}${t("unit.second")}`;
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

// shared/models.generated.js
var PUBLIC_PRESETS = [
  {
    "id": "sdxl-lightning",
    "label": "SDXL Lightning",
    "family": "SDXL",
    "short": "Lightning",
    "description": {
      "zh": "4 步极速出图，平衡画质与耗时",
      "en": "4-step fast generation, balanced quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  },
  {
    "id": "hyper-sdxl-8step",
    "label": "Hyper-SDXL 8-Step",
    "family": "SDXL",
    "short": "Hyper-SD 8",
    "description": {
      "zh": "8 步蒸馏，速度与画质的折中",
      "en": "8-step distilled balance of speed and quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/Hyper-SD",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++-M",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 7.35,
    "size": 1024,
    "steps": 8,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 14.3,
    "steadySeconds": 7.74,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "sdxl-turbo",
    "label": "SDXL Turbo",
    "family": "SDXL",
    "short": "Turbo",
    "description": {
      "zh": "实时低延迟，适合构图灵感与草稿速探",
      "en": "Real-time low latency, ideal for drafting"
    },
    "repo": "stabilityai/sdxl-turbo",
    "params": "3.5B",
    "license": "非商用研究许可",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.62,
    "size": 512,
    "steps": 4,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 7666,
    "loadSeconds": 4,
    "steadySeconds": 1.87,
    "tier": "fast",
    "negativeHint": "blurry, low quality",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      512,
      768,
      1024
    ]
  },
  {
    "id": "playground-v2.5",
    "label": "Playground v2.5",
    "family": "SDXL",
    "short": "Playground 2.5",
    "description": {
      "zh": "美学取向，画面干净耐看",
      "en": "Aesthetic-first, clean and polished"
    },
    "repo": "playgroundai/playground-v2.5-1024px-aesthetic",
    "params": "3.5B",
    "license": "Playground v2.5 Community License",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 30,
    "stepRange": {
      "min": 20,
      "max": 45,
      "step": 1,
      "fast": 22,
      "balanced": 30,
      "fine": 40
    },
    "cfg": 3,
    "peakVramMb": 9967,
    "loadSeconds": 5.7,
    "steadySeconds": 28.34,
    "tier": "usable",
    "negativeHint": "ugly, deformed, noisy, blurry, distorted",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "sdxl-base",
    "label": "SDXL Base 1.0",
    "family": "SDXL",
    "short": "Base 1.0",
    "description": {
      "zh": "25 步原生精绘，结构完整细节扎实",
      "en": "25-step native base, rich structural details"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 25,
    "stepRange": {
      "min": 18,
      "max": 45,
      "step": 1,
      "fast": 20,
      "balanced": 25,
      "fine": 38
    },
    "cfg": 7.5,
    "peakVramMb": 9966,
    "loadSeconds": 5.8,
    "steadySeconds": 27.8,
    "tier": "usable",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  },
  {
    "id": "sdxl-inpaint",
    "label": "SDXL Inpaint",
    "family": "SDXL",
    "short": "Inpaint",
    "description": {
      "zh": "局部重绘专用权重（9 通道），涂抹边界融合最自然",
      "en": "Dedicated 9-channel inpainting weights for seamless local repaints"
    },
    "repo": "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 30,
    "stepRange": null,
    "cfg": 8,
    "peakVramMb": null,
    "loadSeconds": null,
    "steadySeconds": 22.4,
    "tier": "quality",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": true,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  },
  {
    "id": "realvis-v5",
    "label": "RealVisXL V5.0",
    "family": "SDXL",
    "short": "RealVis V5",
    "description": {
      "zh": "超写实摄影质感，人像与皮肤细节",
      "en": "Photorealistic detail for portraits and skin"
    },
    "repo": "SG161222/RealVisXL_V5.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 30,
    "stepRange": {
      "min": 24,
      "max": 45,
      "step": 1,
      "fast": 25,
      "balanced": 30,
      "fine": 40
    },
    "cfg": 5,
    "peakVramMb": 9967,
    "loadSeconds": 5.2,
    "steadySeconds": 24.53,
    "tier": "usable",
    "negativeHint": "blurry, low quality, deformed, extra limbs, ugly, bad anatomy",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "flux2-klein-4b",
    "label": "FLUX.2 Klein 4B",
    "family": "FLUX",
    "short": "Klein 4B",
    "description": {
      "zh": "下一代前沿架构，商业级质感与光影",
      "en": "Next-gen architecture, commercial grade"
    },
    "repo": "black-forest-labs/FLUX.2-klein-4B",
    "params": "3.88B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 2,
    "downloadGb": null,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 7929,
    "loadSeconds": 28.2,
    "steadySeconds": 10.24,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "animagine-xl-3.1",
    "label": "Animagine XL 3.1",
    "family": "SDXL",
    "short": "Animagine 3.1",
    "description": {
      "zh": "二次元插画与角色表现",
      "en": "Anime illustration and character art"
    },
    "repo": "cagliostrolab/animagine-xl-3.1",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 28,
    "stepRange": {
      "min": 20,
      "max": 45,
      "step": 1,
      "fast": 22,
      "balanced": 28,
      "fine": 38
    },
    "cfg": 7,
    "peakVramMb": 9176,
    "loadSeconds": 4.8,
    "steadySeconds": 26.17,
    "tier": "usable",
    "negativeHint": "nsfw, lowres, (bad), text, error, fewer, extra, missing, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
    "promptStyle": "danbooru",
    "qualityPrefix": "masterpiece, best quality, highres",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "anima-light-lavender",
    "label": "Anima Light Lavender",
    "family": "Anima",
    "short": "Lavender",
    "description": {
      "zh": "长自然语言驱动的二次元插画，Cosmos-Predict2 2B 底座",
      "en": "Anime illustration driven by long natural-language prompts"
    },
    "repo": "Johnny-Z/Anima-Light-Lavender",
    "params": "2B DiT + Qwen3-0.6B",
    "license": "CircleStone Labs Non-Commercial",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 5.25,
    "size": 1024,
    "steps": 25,
    "stepRange": {
      "min": 18,
      "max": 40,
      "step": 1,
      "fast": 20,
      "balanced": 25,
      "fine": 35
    },
    "cfg": 4,
    "peakVramMb": 8470,
    "loadSeconds": 43.5,
    "steadySeconds": 80.64,
    "tier": "usable",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": false,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  }
];

// shared/contract.js
var VERSION = "0.12.0";
var ROUTES = {
  state: { method: "GET", path: "/imagen-api/state" },
  probe: { method: "POST", path: "/imagen-api/probe" },
  // 远端运行日志（把 daemon 的日志环透传给工作台日志抽屉）。
  logs: { method: "GET", path: "/imagen-api/logs" },
  sessionStart: { method: "POST", path: "/imagen-api/session/start" },
  sessionStop: { method: "POST", path: "/imagen-api/session/stop" },
  generate: { method: "POST", path: "/imagen-api/generate" },
  job: { method: "GET", path: "/imagen-api/job" },
  // 取消任务：queued / waiting-session 立即出队失效；running 合作式停止（见 JOB_CANCEL）。
  jobCancel: { method: "POST", path: "/imagen-api/job/cancel" },
  jobs: { method: "GET", path: "/imagen-api/jobs" },
  // 历史分页：limit / offset 查询参数，响应补 hasMore（向后兼容只读 items 的旧客户端）。
  history: { method: "GET", path: "/imagen-api/history" },
  // 版本树：按根作品路径（root，工作区相对路径）返回整棵派生树，供作品条版本面板按需展开。
  // 旧宿主没有该路由时客户端按 404 降级为「仅用已加载分页」。
  historyTree: { method: "GET", path: "/imagen-api/history/tree" },
  file: { method: "GET", path: "/imagen-api/file" },
  // 本地图片导入（阶段十五 Phase A）：用户选择的 PNG / JPEG 落盘到产物目录并登记为导入作品。
  importFile: { method: "POST", path: "/imagen-api/import" },
  library: { method: "GET", path: "/imagen-api/library" },
  libraryFavorite: { method: "POST", path: "/imagen-api/library/favorite" },
  libraryDelete: { method: "POST", path: "/imagen-api/library/delete" },
  enhance: { method: "POST", path: "/imagen-api/enhance" },
  intent: { method: "POST", path: "/imagen-api/intent" },
  reveal: { method: "POST", path: "/imagen-api/reveal" },
  // 运行设置抽屉：GET 读脱敏视图（hfToken 只回布尔与来源），POST 保存用户覆盖项。
  settings: { method: "GET", path: "/imagen-api/settings" },
  settingsSave: { method: "POST", path: "/imagen-api/settings" },
  // 工作台界面状态（高级设置折叠等）：GET 读归一化视图，POST 合并保存白名单字段。
  uiState: { method: "GET", path: "/imagen-api/ui-state" },
  uiStateSave: { method: "POST", path: "/imagen-api/ui-state" },
  // Kaggle 直连登录（试验特性）：GET 读登录态，POST 按 action 发起 / 取消 / 提交授权码。
  kaggleLogin: { method: "GET", path: "/imagen-api/kaggle/login" },
  kaggleLoginAction: { method: "POST", path: "/imagen-api/kaggle/login" },
  // Colab Google OAuth 登录：GET 读登录态与授权摘要，POST 按 action 发起 / 取消 / 提交回调或授权码。
  colabLogin: { method: "GET", path: "/imagen-api/colab/login" },
  colabLoginAction: { method: "POST", path: "/imagen-api/colab/login" }
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
  // 图生图（M3）参考图：maxBytes 是原始图片字节上限（Host 与 daemon 双重校验，
  // 受 `remoteGenerateMaxBytes`（base64 后体积）约束）；解码后长边超过 maxEdge 由远端
  // 按比例缩小（不超过 minEdge 的图直接拒绝），避免小图放大出噪点、大图占显存。
  reference: { maxBytes: 8 * 1024 * 1024, maxEdge: 1536, minEdge: 128 },
  // 模型原生参考生图（阶段十五 Phase C1，`supportsReference`）的独立口径：
  // 与 `reference` 的单图垫图（img2img / 局部重绘，尺寸跟随参考图）完全隔离——
  // 原生参考走基础管线 `image=[PIL...]` 条件，宽高严格取请求值，没有 strength / mask 语义。
  //  - maxCount：单次请求的参考图张数上限（真机实测：1 张 1024² 约 21~22s、2 张约 31s、
  //    3 张约 52s，耗时近似线性而显存几乎不增；参考收益主要来自 1~2 张，因此收紧到 2，
  //    真机探针数据见 docs/INFERENCE_ACCELERATION_RESEARCH.md 与 CHANGELOG）；
  //  - maxBytes：单张原始字节上限。模型内部已按约 1 MP 面积缩放，超过 4 MiB 对成片没有
  //    额外价值；2×4 MiB 的 base64 约 11.2 MB，仍落在 TIMEOUTS.remoteGenerateMaxBytes
  //    （32 MB）预算内，不需要放宽 Host / daemon 的全局请求体上限（见 lib/jobs/reference-loader.js
  //    的总体积前置校验与 remote/config.py 的 request_body_limit 推导）。
  //  - maxEdge：执行期解码后长边上限；模型内部还会按约 1 MP 面积等比缩放，
  //    因此这里按「长边 ≤ 1024」近似 1 MP 预算，避免把大图原样塞进 CPU 侧预处理；
  //  - minEdge：长边下限（与 `reference` 语义一致：宽、高都不会小于它才不会被放大成噪点）。
  // 下发远端：daemonContract().limits.referenceImages（详见 remote/config.py 的 request_body_limit）。
  referenceImages: { maxCount: 2, maxBytes: 4 * 1024 * 1024, maxEdge: 1024, minEdge: 128 },
  // 重绘强度：越小越贴近原图，越大越放飞；首期只对 SDXL 家族（supportsImg2Img）开放。
  // 上限按场景区分：`max` 是普通垫图（img2img）的保守上限，避免把原图丢得太狠；
  // `inpaintMax` 是带蒙版局部重绘的上限——9 通道 inpaint 模型在全重绘时需要更高替换力度，
  // 只放宽这一档，img2img 行为完全不变。
  strength: { min: 0.2, max: 0.9, inpaintMax: 1, step: 0.05, default: 0.6 },
  // 局部重绘（Inpaint）蒙版：客户端导出的黑白 PNG（白 = 重绘区域，黑 = 保留区域），
  // 与参考图一起提交；尺寸由远端按参考图精确对齐，因此这里只管字节上限与最小覆盖率。
  // `minCoverage` 是「白色重绘像素占全图的最小比例」：低于它的蒙版视为空蒙版直接拒绝
  // （错误码 invalid_request，远端在加载模型前失败），全白（整图重绘）必须放行。
  // 0.0005 = 0.05%：挡掉误传全黑蒙版这类「整图重绘但实际没有涂抹区域」的请求。
  // 单独成项而不挂在 reference 下：远端 limit_spec() 只按「单层数值键」合并兜底值。
  mask: { maxBytes: 2 * 1024 * 1024, minCoverage: 5e-4 },
  // Kaggle / torch 侧接受 32 位有符号正整数；两端必须用同一个上界，否则用户输入的
  // seed 会被宿主静默取模改写，导致「带回参数」复现不出同一张图。
  seed: { max: 2147483647 },
  waitSeconds: { min: 0, max: 600, default: 90 },
  queue: { maxPending: 20, maxKept: 60 },
  // pageSize 是前端「加载更多」每次请求的固定步长，取契约上限 100：
  // Host 的 limit 仍按 maxLimit 钳制，旧客户端只传 limit 时行为不变。
  history: { defaultLimit: 30, maxLimit: 100, pageSize: 100 },
  jobs: { defaultLimit: 20, maxLimit: 100 },
  historyTool: { defaultLimit: 5, maxLimit: 30 },
  libraryDelete: { maxPaths: 200 },
  // Agent 批量创作（imagen_batch）：单次对话最多规划多少条任务。
  // 队列本身另有 maxPending 上限，两者叠加后不会把云端排队撑爆。
  batch: { maxItems: 8 },
  intentText: { maxChars: 2e3 },
  // 对话多轮上下文：客户端只回传最近若干条消息，Host 路由再裁剪一次，
  // 避免把整段聊天记录塞进模型（也约束请求体大小）。
  intentHistory: { maxMessages: 12, maxMessageChars: 2e3 }
};
var IMPORT = {
  // 只接受这两种位图：PNG 无损失、JPEG 是相机/截图最常见的格式。
  mimeTypes: ["image/png", "image/jpeg"],
  // 解码后的原始字节上限（与图生图参考图一致，Host 同时受请求体上限约束）。
  maxBytes: LIMITS.reference.maxBytes,
  // 长边上限 / 短边下限（宽、高都要 >= minEdge，避免把小图放大成噪点）。
  maxEdge: LIMITS.reference.maxEdge,
  minEdge: LIMITS.reference.minEdge,
  // 展示名上限：只用于 meta.prompt 与列表标题，不参与落盘路径。
  maxNameChars: 120
};
var UPSCALE = {
  // 记录到 meta.presetId 的超分模型标识（不是可选的扩散预设，不进模型选择器）。
  id: "realesrgan-x2plus",
  factor: 2,
  maxInputEdge: 1280,
  maxOutputEdge: 2560
};
var OUTPAINT = {
  // 快捷比例胶囊（顺序即界面顺序）：source = 跟随原图比例、四边扩 20%。
  expandId: "source",
  // 目标画幅比例胶囊（canvas 以该比例为准，原图等比缩放后居中）。
  ratioIds: ["16:9", "9:16", "4:3"],
  // 「四边扩 20%」= 画布尺寸 ×1.2（每边 10%）。
  expandRatio: 1.2,
  // 画布长边 / 总像素上限：1536×1024 量级，与远端 width/height 契约上限对齐，
  // 也保证 2×T4 上 9 通道 inpaint 不 OOM（真机验收见 CHANGELOG）。
  maxEdge: 1536,
  maxPixels: 16e5,
  minEdge: 256,
  // 扩图覆盖面积大，默认走满步数；契约的带蒙版上限是 1.0。
  strength: 1,
  // 扩图产物原图内容框（`outpaintContent`，归一化 0~1、相对画布左上角，4 位小数）：
  // 随提交请求 → meta.json → HistoryItem 透传，供「对比原图」拉帘把原图放回它在
  // 扩图画布里的真实位置（画布可能比原图更大、且原图位置可按锚点偏移）。
  // 只属于 Host/Client，不经 `daemonContract()` 下发远端。
  content: { fields: ["x", "y", "width", "height"], precision: 4 }
};
var PIPELINE_ACCEL_KEYS = Object.freeze(["vaeTiling", "vaeSlicing", "channelsLast", "fuseQkv"]);
var REQUEST_TOOLS = Object.freeze(["generate", "upscale", "outpaint"]);
var TIMEOUTS = {
  // 远端 HTTP
  remoteHealthMs: 4e3,
  remoteLogsMs: 4e3,
  // 生成任务：远端改为异步 job（POST /generate 只入队，GET /job 轮询）。
  // 提交与轮询都是短请求，长耗时只存在于远端队列里，隧道/代理不会因为长连接空闲掐断。
  remoteSubmitMs: 15e3,
  remoteJobRequestMs: 8e3,
  remoteJobPollMs: 2e3,
  // 单个任务整体预算（可在配置里用 generateTimeoutSeconds 覆盖）。
  remoteJobMs: 6e5,
  // 出图轮询容错（P0-A3）：隧道重建期间 GET /job 会成串失败，旧实现在第 6 次
  // 连续失败（约 12~60 秒）就判任务失败，把仍在远端算图的任务判死。改为按
  // 「连续失败持续时长」容忍，并在窗口用尽后用同一 jobId 幂等重投接回任务。
  remoteJobPollFailureGraceMs: 12e4,
  // 失败重试的指数退避上限：隧道重建期不打满远端，恢复后又能快速接上。
  remoteJobPollBackoffMaxMs: 8e3,
  // 幂等重投次数上限：daemon 保留窗口为 600s / 最多 8 个已完成 job，
  // 超窗重投会重新入队出图（重复消耗 GPU），所以必须限次。
  remoteJobResumeMaxAttempts: 2,
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
  // 恢复窗口续期上限：ready 失联后每向 Kaggle 确认一次 Kernel 仍 RUNNING，
  // 就把 recoveryMs 窗口续期一轮；续期用尽仍恢复不了才判定 health_failed。
  // 总兜底时长约 recoveryMs + recoveryMaxRenewals × kernelPollMs（约 7 分钟），
  // 避免隧道重建稍久就杀掉一个仍在 RUNNING 的 Kernel（重新排队代价很高）。
  recoveryMaxRenewals: 10,
  // 排队分级提示：本机历史日志里 6 次正常会话从推送完成到隧道会合约 14–22 秒
  // （从会话启动算 18–30 秒）；样本很小，只用于挑提示阈值，不代表 Kaggle 排队的普遍保证。
  // 超过慢档只更新一句状态提示（不打断用户），超过卡住档才建议换新实例重排（不自动执行）。
  // 两档都可以被插件配置覆盖（见 index.js 的 queueSlowMinutes / queueStalledMinutes）。
  queueSlowMs: 3 * 60 * 1e3,
  queueStalledMs: 10 * 60 * 1e3,
  provisionMs: 45 * 60 * 1e3,
  tunnelMs: 15 * 60 * 1e3,
  sessionWaitMs: 45 * 60 * 1e3,
  idleShutdownSec: 1800,
  // Kernel 启动后等待宿主接管的时限（秒）：超过仍没有收到任何带 Token 的 Host 请求，
  // daemon 自行退出。用于回收「放弃排队后仍被调度到」的孤儿 Kernel，避免空转到
  // idleShutdownSec 才释放 GPU 配额。
  kernelClaimSec: 600,
  kernelRunMaxSec: 10800,
  // 宿主本地动作
  revealWaitMs: 1500,
  bodyMaxBytes: 256 * 1024,
  // kaggle CLI
  cliMs: 3e4,
  cliQuotaMs: 2e4,
  cliPushMs: 18e4,
  cliLogsMs: 45e3,
  cliOutputMs: 18e4,
  // 客户端
  clientProbeMs: 45e3,
  clientStatePollMs: 1e4,
  clientStateActivePollMs: 2e3,
  clientLogsPollMs: 2e3
};
var SETTINGS = {
  // 空闲自动关机：秒。quickMinutes 是客户端快捷档位（分钟），自定义输入按 min/max 钳制。
  idleTimeoutSec: { min: 300, max: 10800, quickMinutes: [15, 30, 60, 120] },
  // GPU 加速器白名单：值必须是 `kaggle kernels push` 接受的 accelerator 名称。
  accelerators: ["NvidiaTeslaT4", "NvidiaTeslaP100"],
  defaultAccelerator: "NvidiaTeslaT4",
  // 高级项上限：数组/映射最多 32 项，单条最长 256 字符。
  maxItems: 32,
  maxItemChars: 256,
  // `publicSettingsView()` 的脱敏字段取值域：settings=用户在抽屉里设置的，config=宿主插件配置。
  hfTokenSources: ["settings", "config", "none"],
  // Kaggle 访问方式：direct = Node 直连 Kaggle JSON API + 内置 OAuth 登录（默认，无需本机
  // kaggle CLI）；cli = 调用本机 `kaggle` CLI（兼容退路，排障或直连不可用时手动切回）。
  // 切换在下次操作/唤醒时生效，不需要重载插件。数组顺序即设置抽屉里的选项顺序。
  kaggleTransports: ["direct", "cli"],
  defaultKaggleTransport: "direct",
  // 远端算力来源：kaggle 默认；colab 需要先完成一次 Google 授权（tools/colab/probe-auth.mjs），
  // 且只在 Colab Pro 账号下有意义（免费档申请不到 L4/A100）。切换在下次唤醒/启动时生效。
  providers: ["kaggle", "colab"],
  defaultProvider: "kaggle",
  // Colab 可用加速器：必须在 assign 接口接受的白名单内；H100 等按账号权益可能被后端 400。
  colabGpus: ["T4", "L4", "A100", "G4"],
  defaultColabGpu: "L4"
};
var KAGGLE_LOGIN = {
  actions: ["start", "cancel", "submit-code"],
  // idle 未开始 / pending 等待浏览器授权 / done 成功 / failed 失败 / cancelled 用户取消
  states: ["idle", "pending", "done", "failed", "cancelled"],
  // browser = 拉起本机浏览器 + 本地回环回调；manual = 复制授权链接 + 粘贴授权码。
  modes: ["browser", "manual"],
  // 客户端轮询登录态的间隔；host 等待授权的总时限（超时转 failed，可重新发起）。
  pollMs: 1500,
  timeoutMs: 5 * 60 * 1e3
};
var UI_STATE = {
  version: 1,
  defaults: {
    // 表单「高级设置」折叠区是否展开：默认收起，没有记录时也回落到 false。
    advancedOpen: false
  },
  // 落盘文件大小上限：超过按损坏记录处理（界面态丢失不影响出图）。
  maxBytes: 64 * 1024
};
var RATIO_IDS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
var INTENT = {
  // 中文摘要只进界面，给用户的确认信息，写太长没有意义。
  summaryMaxChars: 400,
  // 通用澄清：一条问题 + 2~4 个选项（点击后作为新一轮用户输入重新解析）。
  clarifyMinOptions: 2,
  clarifyMaxOptions: 4,
  clarifyQuestionMaxChars: 80,
  clarifyOptionMaxChars: 40,
  // 模型建议：只允许合法预设 id，且不能是当前预设。
  modelHintReasonMaxChars: 80
};
var LOGS = {
  // 远端 daemon 日志环与客户端保留行数上限。
  remoteLineLimit: 400,
  // GET /logs 下发的 Host 本地日志尾部行数上限（Host 路由与客户端归一都按它）。
  hostLineLimit: 120,
  // 诊断文本附带的行数：远端可多给一些，Host 更短以控制粘贴长度。
  diagRemoteTail: 120,
  diagHostTail: 80
};
var DIAGNOSTICS = {
  envFields: ["platform", "nodeVersion", "hasProxyEnv", "hasFallbackTunnel", "hasCustomDatasets", "hasPipConstraints", "hasHfToken"],
  timingFields: ["sessionStartMs", "sessionUptimeMs", "readyUptimeMs"]
};
var DEFAULT_PRESET = "sdxl-lightning";
function publicPresets() {
  return PUBLIC_PRESETS.map((preset) => ({ ...preset }));
}

// src/logic/queue.js
function queuePolicyOf(state) {
  const raw = state && state.queuePolicy && typeof state.queuePolicy === "object" ? state.queuePolicy : null;
  const slowRaw = Number(raw && raw.slowMs);
  const stalledRaw = Number(raw && raw.stalledMs);
  const slowMs = Number.isFinite(slowRaw) && slowRaw > 0 ? slowRaw : TIMEOUTS.queueSlowMs;
  const stalledMs = Number.isFinite(stalledRaw) && stalledRaw > 0 ? stalledRaw : TIMEOUTS.queueStalledMs;
  return { slowMs, stalledMs: Math.max(slowMs, stalledMs) };
}
function queueWaitMsOf(session, now) {
  if (!session || session.state !== "provisioning" || session.phase !== "queue") return null;
  const start = Date.parse(String(session.startedAt ?? ""));
  if (!Number.isFinite(start)) return null;
  const current = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, current - start);
}
function queueLevelOf(waitMs, policy) {
  if (!Number.isFinite(waitMs)) return "";
  const resolved = policy || queuePolicyOf(null);
  if (waitMs >= resolved.stalledMs) return "stalled";
  if (waitMs >= resolved.slowMs) return "slow";
  return "";
}
function queueRoundKeyOf(session) {
  if (!session) return "";
  const startedAt = typeof session.startedAt === "string" ? session.startedAt.trim() : "";
  if (!startedAt) return "";
  const presetId = typeof session.presetId === "string" ? session.presetId.trim() : "";
  return presetId ? `${startedAt}|${presetId}` : startedAt;
}
function queueStalledMinutesOf(policy) {
  const resolved = policy || queuePolicyOf(null);
  return Math.max(1, Math.round(resolved.stalledMs / 6e4));
}

// src/logic/status.js
function sessionStateText(t, state) {
  const key = state ? `session.state.${state}` : "session.state.absent";
  return localized(t, key) || (state ? String(state) : t("value.unknown"));
}
function jobStatusText(t, status) {
  if (!status) return "";
  return localized(t, `job.status.${status}`) || String(status);
}
function phaseText(t, phase) {
  if (!phase) return "";
  return localized(t, `session.phase.${phase}`) || "";
}
function isAsleepSession(session) {
  return Boolean(
    session && session.state === "error" && session.error && session.error.code === "session_ended"
  );
}
function phaseHint(t, session) {
  if (!session) return "";
  const state = typeof session.state === "string" ? session.state : "";
  const phase = typeof session.phase === "string" ? session.phase : "";
  const resolved = state || PHASE_STATE[phase] || "";
  if (resolved === "provisioning") {
    const key = phase === "push" ? "session.hint.push" : phase === "queue" ? "session.hint.queue" : "session.hint.provisioning";
    return localized(t, key) || "";
  }
  if (isAsleepSession(session)) return localized(t, "session.hint.asleep") || "";
  return resolved ? localized(t, `session.hint.${resolved}`) || "" : "";
}
function toneOf(state, asleep) {
  if (asleep) return "idle";
  if (state === "ready") return "ok";
  if (state === "error") return "error";
  if (TRANSIENT_SESSION[state] === true) return "warn";
  return "idle";
}
var ERROR_LABEL_KEY = {
  auth_required: "session.state.errorAuth",
  cli_missing: "session.state.errorCli",
  push_failed: "session.state.errorPush",
  queue_timeout: "session.state.errorTimeout",
  tunnel_timeout: "session.state.errorTimeout",
  session_timeout: "session.state.errorTimeout"
};
function labelKeyOf(state, phase, session, asleep) {
  if (asleep) return "session.state.asleep";
  if (state === "absent" && session && session.stoppedByUser === true) return "session.state.asleep";
  if (state === "provisioning") {
    if (phase === "push") return "session.state.push";
    if (phase === "queue") return "session.state.queue";
  }
  if (state === "error") {
    const code = session && session.error && session.error.code;
    return ERROR_LABEL_KEY[code] || "session.state.error";
  }
  return `session.state.${state}`;
}
function computeStatusOf(t, input = {}) {
  const session = input && input.session ? input.session : null;
  const state = session && typeof session.state === "string" && session.state ? session.state : "absent";
  const phase = session && typeof session.phase === "string" ? session.phase : "";
  const asleep = isAsleepSession(session);
  const stopped = state === "absent" && Boolean(session && session.stoppedByUser === true);
  const policy = queuePolicyOf({ queuePolicy: input && input.queuePolicy });
  const queueWaitMs = queueWaitMsOf(session, input && input.now);
  const queueLevel = queueLevelOf(queueWaitMs, policy);
  const label = localized(t, labelKeyOf(state, phase, session, asleep)) || sessionStateText(t, state);
  const baseHint = phaseHint(t, session) || (stopped ? localized(t, "session.hint.asleep") : "");
  const hint = queueLevel ? localized(t, "session.hint.queueSlow") || baseHint : baseHint;
  const errorMessage = session && session.error && typeof session.error.message === "string" ? session.error.message.split("\n")[0].trim() : "";
  let tooltip = hint;
  if (state === "ready") tooltip = localized(t, "studio.compute.idleTooltip") || hint;
  else if (asleep || stopped) tooltip = localized(t, "studio.compute.asleepTooltip") || hint;
  else if (state === "absent") tooltip = localized(t, "studio.compute.offlineTooltip") || hint;
  else if (state === "error") tooltip = localized(t, "studio.compute.errorTooltip") || errorMessage;
  return {
    state,
    phase,
    asleep,
    stopped,
    tone: toneOf(state, asleep || stopped),
    label,
    hint,
    tooltip,
    phaseLabel: phaseText(t, phase),
    // 排队分级：'slow' 只改提示，'stalled' 由组合层加一张「换新实例重排」横幅。
    queueLevel,
    queueWaitMs,
    // 过渡态：需要持续刷新进度、显示状态条并计时的状态。
    transient: TRANSIENT_SESSION[state] === true,
    // 正在启动/等待云端（stopping 不计时）。
    starting: state === "provisioning" || state === "connecting" || state === "warming",
    ready: state === "ready",
    canStart: state === "absent" || state === "error",
    canStop: state !== "absent"
  };
}
function idleShutdownOf(session) {
  if (!session || typeof session !== "object") return null;
  const idleSeconds = Number(session.idleSeconds);
  const timeoutSeconds = Number(session.idleTimeoutSec);
  if (!Number.isFinite(idleSeconds) || !Number.isFinite(timeoutSeconds)) return null;
  if (idleSeconds <= 0 || timeoutSeconds <= 0) return null;
  const idleMinutes = Math.floor(idleSeconds / 60);
  if (idleMinutes < 1) return null;
  return {
    idleSeconds: Math.floor(idleSeconds),
    idleMinutes,
    totalMinutes: Math.max(1, Math.round(timeoutSeconds / 60))
  };
}
var STAGE_CODES = /* @__PURE__ */ new Set(["queued", "waiting-session", "loading", "running", "done", "failed", "cancelled"]);
function stageCodeOf(job) {
  if (job.status === "cancelled") return "cancelled";
  const code = typeof job.stageCode === "string" ? job.stageCode : "";
  if (STAGE_CODES.has(code)) return code;
  return STAGE_CODES.has(job.status) ? job.status : "";
}
function jobCountOf(job) {
  const progress = job && job.progress;
  if (!progress || typeof progress !== "object") return null;
  const done = Number(progress.done);
  const total = Number(progress.total);
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null;
  const count = Math.floor(total);
  if (count <= 1) return null;
  return { done: Math.min(Math.max(0, Math.floor(done)) + 1, count), total: count };
}
function jobCountText(t, job) {
  const count = jobCountOf(job);
  if (!count) return "";
  return formatText(localized(t, "studio.pipeline.count"), count);
}
function jobProgressText(t, job, sessionState) {
  if (!job) return "";
  const stage = stageCodeOf(job);
  if (stage === "cancelled") return jobStatusText(t, "cancelled");
  if (job.cancelRequested === true) return localized(t, "studio.job.cancelling") || "";
  if (stage === "running") {
    const progress = jobCountOf(job);
    if (progress) {
      const text = formatText(localized(t, "studio.progress.generatingCount"), progress);
      if (text) return text;
    }
    return localized(t, "studio.progress.running") || "";
  }
  if (stage === "loading") {
    return localized(t, "studio.progress.loading") || localized(t, "studio.progress.waitingSession") || "";
  }
  if (stage === "waiting-session") return localized(t, "studio.progress.waitingSession") || "";
  if (stage === "queued") {
    const key = sessionState === "ready" ? "studio.progress.queued" : "studio.progress.waitingSession";
    return localized(t, key) || "";
  }
  return jobStatusText(t, job.status);
}

// src/logic/color.js
function toneColor(tone) {
  if (tone === "ok") return token.ok;
  if (tone === "warn") return token.warn;
  if (tone === "error") return token.error;
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
var ACTIVE_RANK = { running: 0, "waiting-session": 1, queued: 2 };
function rankOf(job) {
  const rank = ACTIVE_RANK[job.status];
  return rank === void 0 ? 9 : rank;
}
function submittedAt(job) {
  const value = Date.parse(String(job.createdAt ?? ""));
  return Number.isFinite(value) ? value : 0;
}
function comparePending(left, right) {
  const rank = rankOf(left) - rankOf(right);
  if (rank !== 0) return rank;
  const submitted = submittedAt(left) - submittedAt(right);
  if (submitted !== 0) return submitted;
  return String(left.id).localeCompare(String(right.id));
}
function pendingJobsOf(state) {
  return stateJobs(state).filter((job) => ACTIVE_STATUS[job.status] === true).sort(comparePending);
}
function activeJobOf(state) {
  return pendingJobsOf(state)[0] ?? null;
}
function isJobCancellable(job) {
  return Boolean(job && ACTIVE_STATUS[job.status] === true);
}
function isJobCancelling(job, cancellingIds) {
  if (!job) return false;
  if (job.cancelRequested === true) return true;
  if (!Array.isArray(cancellingIds)) return false;
  return cancellingIds.includes(job.id);
}
function jobCardClass(job, cancellingIds) {
  const classes = ["ofs-ghost"];
  if (job && job.status === "queued") classes.push("is-queued");
  if (isJobCancelling(job, cancellingIds)) classes.push("is-cancelling");
  return classes.join(" ");
}
function historyKeyOf(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.jobId === "string" && item.jobId) return `job:${item.jobId}`;
  if (typeof item.dir === "string" && item.dir) return `dir:${item.dir}`;
  const prompt = typeof item.prompt === "string" ? item.prompt : "";
  const stamp = item.finishedAt || item.createdAt || item.mtime || "";
  if (!prompt && !stamp) return "";
  return `raw:${stamp}|${prompt}`;
}
function mergeHistoryPages(previous, incoming) {
  const head = Array.isArray(previous) ? previous : [];
  const tail = Array.isArray(incoming) ? incoming : [];
  if (tail.length === 0) return head;
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const item of head.concat(tail)) {
    if (!item || typeof item !== "object") continue;
    const key = historyKeyOf(item);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    merged.push(item);
  }
  return merged;
}
function nextHistoryOffset(offset, pageLength) {
  const start = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Math.floor(Number(offset)) : 0;
  const length = Number.isFinite(Number(pageLength)) && Number(pageLength) > 0 ? Math.floor(Number(pageLength)) : 0;
  return start + length;
}
function historyHasMore(data, requestedLimit) {
  const holder = data && typeof data === "object" ? data : {};
  if (typeof holder.hasMore === "boolean") return holder.hasMore;
  const items = Array.isArray(holder.items) ? holder.items : [];
  const limit = Number.isFinite(Number(requestedLimit)) && Number(requestedLimit) > 0 ? Math.floor(Number(requestedLimit)) : LIMITS.history.pageSize;
  return items.length >= limit;
}

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

// src/logic/kaggleLogin.js
var LOGIN_ACTIONS = KAGGLE_LOGIN.actions;
var LOGIN_STATES = KAGGLE_LOGIN.states;
var LOGIN_MODES = KAGGLE_LOGIN.modes;
var LOGIN_POLL_MS = KAGGLE_LOGIN.pollMs;
var LOGIN_TIMEOUT_MS = KAGGLE_LOGIN.timeoutMs;
var LOGIN_CODE_MIN_CHARS = 8;
var LOGIN_CODE_MAX_CHARS = 4096;
var LOGIN_CODE_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}
function emptyLoginView() {
  return {
    state: "idle",
    mode: "browser",
    url: null,
    message: null,
    username: null,
    startedAt: null,
    finishedAt: null
  };
}
function normalizeLoginView(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const state = LOGIN_STATES.includes(source.state) ? source.state : "idle";
  const mode = LOGIN_MODES.includes(source.mode) ? source.mode : "browser";
  const rawUrl = trimmedOrNull(source.url);
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
  return {
    state,
    mode,
    url,
    message: trimmedOrNull(source.message),
    username: trimmedOrNull(source.username),
    startedAt: trimmedOrNull(source.startedAt),
    finishedAt: trimmedOrNull(source.finishedAt)
  };
}
function loginViewOf(result) {
  if (!result || result.ok !== true) return null;
  const data = result.data && typeof result.data === "object" ? result.data : null;
  if (!data || data.ok !== true) return null;
  const view = data.login;
  if (!view || typeof view !== "object" || Array.isArray(view)) return null;
  return normalizeLoginView(view);
}
function isLoginPending(view) {
  return Boolean(view) && view.state === "pending";
}
function loginTimedOut(startedAtMs, nowMs) {
  const start = Number(startedAtMs);
  const now = Number(nowMs);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false;
  return now - start >= LOGIN_TIMEOUT_MS;
}
function loginUsernameOf(view) {
  return view && typeof view.username === "string" && view.username.trim() ? view.username.trim() : "";
}
function cleanLoginCode(raw) {
  let text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  const urlMatch = text.match(/(?:^|[?&])code=([^&\s#]+)/i);
  if (urlMatch) {
    text = urlMatch[1];
    if (text.includes("%")) {
      try {
        text = decodeURIComponent(text);
      } catch {
      }
    }
  }
  text = text.replace(/^code\s*=\s*/i, "").trim();
  const quoted = text.match(/^["'`<]([\s\S]+)[>"'`]$/);
  if (quoted) text = quoted[1];
  return text.replace(/\s+/g, "");
}
function validateLoginCode(raw) {
  const code = cleanLoginCode(raw);
  if (!code) return { ok: false, code: "", message: "studio.guidance.auth.codeEmpty" };
  if (code.length < LOGIN_CODE_MIN_CHARS) {
    return { ok: false, code, message: "studio.guidance.auth.codeTooShort" };
  }
  if (code.length > LOGIN_CODE_MAX_CHARS) {
    return { ok: false, code, message: "studio.guidance.auth.codeTooLong" };
  }
  if (!LOGIN_CODE_PATTERN.test(code)) {
    return { ok: false, code, message: "studio.guidance.auth.codeFormat" };
  }
  return { ok: true, code, message: "" };
}
function loginCodeCanSubmit(raw) {
  return validateLoginCode(raw).ok;
}
var FAILURE_RULES = [
  { pattern: /timeout|timed?\s*out|超时/i, key: "studio.guidance.auth.reason.timeout" },
  { pattern: /\bstate\b|csrf|校验/i, key: "studio.guidance.auth.reason.state" },
  { pattern: /browser|launch|open|浏览器/i, key: "studio.guidance.auth.reason.browser" },
  { pattern: /exchange|token|credential|凭据/i, key: "studio.guidance.auth.reason.exchange" },
  { pattern: /network|fetch|connect|ECONN|socket|网络|连接/i, key: "studio.guidance.auth.reason.network" }
];
function loginFailureKey(view) {
  if (!view || view.state !== "failed") return "";
  const message = typeof view.message === "string" ? view.message : "";
  for (const rule of FAILURE_RULES) {
    if (rule.pattern.test(message)) return rule.key;
  }
  return "studio.guidance.auth.reason.unknown";
}
function loginActionBody(action, code) {
  if (!LOGIN_ACTIONS.includes(action)) return null;
  if (action === "submit-code") {
    const cleaned = cleanLoginCode(code);
    return cleaned ? { action, code: cleaned } : { action };
  }
  return { action };
}

// src/api/resources.js
function fetchState() {
  return request(routePath("state"), { method: "GET" });
}
function fetchLogs(since = 0) {
  const cursor = Number.isFinite(Number(since)) && Number(since) > 0 ? Math.floor(Number(since)) : 0;
  return request(`${routePath("logs")}?since=${cursor}`, { method: "GET" });
}
function fetchHistory(limit = LIMITS.history.pageSize, offset = 0) {
  const size = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(LIMITS.history.maxLimit, Math.floor(Number(limit))) : LIMITS.history.pageSize;
  const start = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Math.floor(Number(offset)) : 0;
  return request(`${routePath("history")}?limit=${size}&offset=${start}`, { method: "GET" });
}
function fetchLibrary() {
  return request(routePath("library"), { method: "GET" });
}
function fetchHistoryTree(root, limit = LIMITS.history.pageSize) {
  const value = typeof root === "string" ? root.trim() : "";
  if (!value) {
    return Promise.resolve({ ok: false, status: 0, code: "invalid_request", message: "root 不能为空" });
  }
  const size = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(LIMITS.history.maxLimit, Math.floor(Number(limit))) : LIMITS.history.pageSize;
  return request(`${routePath("historyTree")}?root=${encodeURIComponent(value)}&limit=${size}`, { method: "GET" });
}
function startSession(presetId, options = {}) {
  const body = { presetId };
  if (options && options.forceNew === true) body.forceNew = true;
  if (options && options.replace === true) body.replace = true;
  return request(routePath("sessionStart"), {
    method: "POST",
    body: JSON.stringify(body)
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
function cancelJob(id) {
  return request(routePath("jobCancel"), {
    method: "POST",
    body: JSON.stringify({ id })
  });
}
function runProbe(signal) {
  return request(routePath("probe"), {
    method: "POST",
    ...signal ? { signal } : {}
  });
}
function enhancePromptRequest({ prompt, presetId, locale, mode } = {}) {
  const body = { prompt, presetId, locale };
  if (typeof mode === "string" && mode) body.mode = mode;
  return request(routePath("enhance"), {
    method: "POST",
    body: JSON.stringify(body)
  });
}
function parseIntentRequest({ text, previousPrompt, locale, presetId, cfg, history } = {}) {
  const body = { text, previousPrompt, locale, presetId };
  const cfgValue = Number(cfg);
  if (cfg !== "" && cfg !== null && cfg !== void 0 && Number.isFinite(cfgValue)) body.cfg = cfgValue;
  if (Array.isArray(history) && history.length > 0) body.history = history;
  return request(routePath("intent"), {
    method: "POST",
    body: JSON.stringify(body)
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
function fetchSettings() {
  return request(routePath("settings"), { method: "GET" });
}
function saveSettings(payload) {
  return request(routePath("settingsSave"), {
    method: "POST",
    body: JSON.stringify(payload && typeof payload === "object" ? payload : {})
  });
}
function fetchUiState() {
  return request(routePath("uiState"), { method: "GET" });
}
function saveUiState(patch) {
  return request(routePath("uiStateSave"), {
    method: "POST",
    body: JSON.stringify(patch && typeof patch === "object" ? patch : {})
  });
}
function postLoginAction(routeName, action, code) {
  const body = loginActionBody(action, code);
  if (!body) {
    return Promise.resolve({ ok: false, status: 0, code: "invalid_request", message: `未知的登录动作：${action}` });
  }
  return request(routePath(routeName), {
    method: "POST",
    body: JSON.stringify(body)
  });
}
function fetchKaggleLogin() {
  return request(routePath("kaggleLogin"), { method: "GET" });
}
function kaggleLoginAction(action, code) {
  return postLoginAction("kaggleLoginAction", action, code);
}
function startKaggleLogin() {
  return kaggleLoginAction("start");
}
function cancelKaggleLogin() {
  return kaggleLoginAction("cancel");
}
function submitKaggleLoginCode(code) {
  return kaggleLoginAction("submit-code", code);
}
function fetchColabLogin() {
  return request(routePath("colabLogin"), { method: "GET" });
}
function colabLoginAction(action, code) {
  return postLoginAction("colabLoginAction", action, code);
}
function startColabLogin() {
  return colabLoginAction("start");
}
function cancelColabLogin() {
  return colabLoginAction("cancel");
}
function submitColabLoginCode(code) {
  return colabLoginAction("submit-code", code);
}
function importImageFile({ data, name } = {}) {
  const body = { data: typeof data === "string" ? data : "" };
  const label = typeof name === "string" ? name.trim() : "";
  if (label) body.name = label;
  return request(routePath("importFile"), {
    method: "POST",
    body: JSON.stringify(body)
  });
}

// src/hooks/useHostState.js
var EMPTY_SNAPSHOT = { state: null, error: null };
var snapshot = EMPTY_SNAPSHOT;
var subscribers = /* @__PURE__ */ new Set();
var timer = null;
var generation = 0;
var inFlight = false;
var listeningVisibility = false;
function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
function notify() {
  for (const listener of [...subscribers]) listener(snapshot);
}
async function tick() {
  timer = null;
  if (subscribers.size === 0 || document.hidden || inFlight) return;
  inFlight = true;
  const myGen = generation;
  let result;
  try {
    result = await fetchState();
  } finally {
    if (myGen === generation) inFlight = false;
  }
  if (subscribers.size === 0 || myGen !== generation) return;
  let delay = TIMEOUTS.clientStatePollMs;
  if (result.ok && result.data && typeof result.data === "object") {
    snapshot = { state: result.data, error: null };
    delay = activeJobOf(result.data) ? TIMEOUTS.clientStateActivePollMs : TIMEOUTS.clientStatePollMs;
  } else {
    snapshot = { state: snapshot.state, error: { code: result.code, message: result.message } };
  }
  notify();
  if (subscribers.size > 0 && myGen === generation && !document.hidden) {
    timer = setTimeout(tick, delay);
  }
}
function onVisible() {
  if (document.hidden) {
    clearTimer();
    return;
  }
  clearTimer();
  tick();
}
function refresh() {
  if (subscribers.size === 0) return;
  generation += 1;
  inFlight = false;
  clearTimer();
  tick();
}
function subscribe(listener) {
  const first = subscribers.size === 0;
  subscribers.add(listener);
  if (!first) return;
  if (!listeningVisibility) {
    document.addEventListener("visibilitychange", onVisible);
    listeningVisibility = true;
  }
  tick();
}
function unsubscribe(listener) {
  subscribers.delete(listener);
  if (subscribers.size > 0) return;
  resetHostStateStore();
}
function resetHostStateStore() {
  clearTimer();
  generation += 1;
  inFlight = false;
  if (listeningVisibility) {
    document.removeEventListener("visibilitychange", onVisible);
    listeningVisibility = false;
  }
  snapshot = EMPTY_SNAPSHOT;
}
function useHostState() {
  const [current, setCurrent] = import_react.default.useState(() => snapshot);
  import_react.default.useEffect(() => {
    subscribe(setCurrent);
    setCurrent(snapshot);
    return () => unsubscribe(setCurrent);
  }, []);
  return { state: current.state, error: current.error, refresh };
}

// src/components/StatusChip.js
function StatusChip(props) {
  const t = translator(props);
  const host = useHostState();
  const state = host.state;
  const session = state && state.session || null;
  const status = computeStatusOf(t, { session });
  const running = activeJobOf(state);
  const label = running ? jobStatusText(t, running.status) : status.label;
  const color = running ? jobColor(running.status) : toneColor(status.tone);
  const title = [
    running ? jobStatusText(t, running.status) : "",
    status.label,
    status.hint
  ].filter(Boolean).join(" · ");
  return h(
    "span",
    { style: styles.headerChip, title },
    h("span", { style: styles.dot(color) }),
    h("span", { style: styles.headerChipText }, label)
  );
}

// src/studio/Studio.jsx
var import_react48 = __toESM(require("react"), 1);

// src/styles/tokens.css
var tokens_default = '/*\n * 设计变量：黑白灰工作室。\n *\n * 视觉立场：一间明度分层的工作室，而不是一块彩色 AI 画布。\n *  1. 地面是中性灰的柔光渐变，上面浮近白的实心卡片；不用彩色光晕，不用玻璃彩虹。\n *  2. 只有明度关系：墨黑做主操作与选中，灰阶做层级，语义色（成功/警告/错误）\n *     只以小圆点或窄条出现，不参与大面积装饰。\n *  3. 深色是同一套明度关系反相：深灰底、浅灰字、浅色主操作。\n *\n * 预览工具（tools/preview/render.mjs）与宿主页面直接读取这里的深色变量（支持系统 prefers-color-scheme 与显式 [data-theme="dark"]）。\n */\n\n.ofs-root {\n  /* 地面：三层中性柔光 + 一层底色 */\n  --ofs-ground-1: #e7e8ea;\n  --ofs-ground-2: #f1f1f2;\n  --ofs-ground-3: #e3e4e6;\n  --ofs-ground-base: #f5f5f6;\n\n  /* 表面 */\n  --ofs-window: rgb(255 255 255 / 86%);\n  --ofs-window-border: rgb(18 18 22 / 8%);\n  --ofs-card: #ffffff;\n  --ofs-card-solid: #ffffff;\n  --ofs-card-border: rgb(18 18 22 / 9%);\n  --ofs-hairline: rgb(18 18 22 / 7%);\n  --ofs-sunken: #f4f4f6;\n  --ofs-sunken-border: rgb(18 18 22 / 8%);\n\n  /* 文字 */\n  --ofs-ink: #141416;\n  --ofs-ink-2: #52525a;\n  --ofs-ink-3: #6b6b73;\n  --ofs-ink-4: #a8a8b0;\n\n  /* 主操作：墨黑 */\n  --ofs-accent: #141416;\n  --ofs-accent-2: #3f3f46;\n  --ofs-accent-ink: #ffffff;\n  --ofs-accent-soft: #f0f0f2;\n  --ofs-accent-soft-border: #dedee3;\n  --ofs-accent-grad: linear-gradient(180deg, #2b2b30 0%, #141416 100%);\n\n  /* 状态：只做小面积语义色 */\n  --ofs-ok: #2f8a5c;\n  --ofs-ok-soft: #eaf5ef;\n  --ofs-warn: #a96a18;\n  --ofs-warn-soft: #f7f0e4;\n  --ofs-error: #c04444;\n  --ofs-error-soft: #f9ecec;\n  --ofs-idle: #a0a0a8;\n  --ofs-idle-soft: #f1f1f3;\n\n  /* 光桌与相纸：舞台是一张下凹的光桌，出图是一张落在桌上的相纸。\n     这是界面里唯一带实物感的表面，其余控件都保持扁平卡片。 */\n  --ofs-mat: #f0f0f2;\n  --ofs-mat-lit: rgb(255 255 255 / 92%);\n  --ofs-mat-inner: inset 0 1px 3px rgb(16 16 20 / 6%);\n  --ofs-print-paper: #ffffff;\n  --ofs-print-edge: rgb(18 18 22 / 10%);\n  --ofs-print-shadow: 0 20px 40px -24px rgb(16 16 20 / 42%), 0 4px 10px -6px rgb(16 16 20 / 18%);\n  --ofs-print-shadow-hover: 0 26px 50px -24px rgb(16 16 20 / 46%), 0 6px 14px -6px rgb(16 16 20 / 20%);\n  --ofs-mark: rgb(18 18 22 / 26%);\n\n  /* 几何 */\n  --ofs-r-xl: 24px;\n  --ofs-r-lg: 18px;\n  --ofs-r-md: 14px;\n  --ofs-r-sm: 10px;\n  --ofs-r-pill: 999px;\n  --ofs-blur: 18px;\n\n  /* 投影：始终带偏移与柔和扩散，不用零偏移光晕 */\n  --ofs-shadow-card: 0 1px 2px rgb(16 16 20 / 5%), 0 10px 24px -16px rgb(16 16 20 / 22%);\n  --ofs-shadow-lift: 0 2px 6px rgb(16 16 20 / 6%), 0 18px 40px -20px rgb(16 16 20 / 26%);\n  --ofs-shadow-window: 0 1px 3px rgb(16 16 20 / 5%), 0 36px 80px -48px rgb(16 16 20 / 32%);\n  --ofs-shadow-accent: 0 8px 18px -10px rgb(16 16 20 / 48%);\n  --ofs-focus-ring: 0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%);\n\n  --ofs-font: -apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;\n\n  /* 留白节奏 */\n  --ofs-pad: 18px;\n  --ofs-gap: 14px;\n\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  padding: 18px;\n  color: var(--ofs-ink);\n  font-family: var(--ofs-font);\n  font-size: 13px;\n  line-height: 1.55;\n  -webkit-font-smoothing: antialiased;\n  background:\n    radial-gradient(1100px 620px at 12% -8%, var(--ofs-ground-1) 0%, transparent 62%),\n    radial-gradient(900px 520px at 88% 4%, var(--ofs-ground-2) 0%, transparent 58%),\n    radial-gradient(780px 540px at 62% 108%, var(--ofs-ground-3) 0%, transparent 62%),\n    linear-gradient(160deg, var(--ofs-ground-base) 0%, var(--ofs-ground-base) 100%);\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) .ofs-root:not([data-theme="light"]) {\n    --ofs-ground-1: #232326;\n    --ofs-ground-2: #17171a;\n    --ofs-ground-3: #26262a;\n    --ofs-ground-base: #101012;\n\n    --ofs-window: rgb(24 24 27 / 88%);\n    --ofs-window-border: rgb(255 255 255 / 9%);\n    --ofs-card: #18181b;\n    --ofs-card-solid: #1c1c20;\n    --ofs-card-border: rgb(255 255 255 / 9%);\n    --ofs-hairline: rgb(255 255 255 / 8%);\n    --ofs-sunken: rgb(255 255 255 / 5%);\n    --ofs-sunken-border: rgb(255 255 255 / 9%);\n\n    --ofs-ink: #f2f2f4;\n    --ofs-ink-2: #a4a4ac;\n    --ofs-ink-3: #8d8d95;\n    --ofs-ink-4: #5c5c63;\n\n    --ofs-accent: #f2f2f4;\n    --ofs-accent-2: #c8c8cf;\n    --ofs-accent-ink: #161618;\n    --ofs-accent-soft: rgb(255 255 255 / 8%);\n    --ofs-accent-soft-border: rgb(255 255 255 / 14%);\n    --ofs-accent-grad: linear-gradient(180deg, #fafafa 0%, #dcdce1 100%);\n\n    --ofs-ok: #58c08a;\n    --ofs-ok-soft: rgb(88 192 138 / 14%);\n    --ofs-warn: #d8a55c;\n    --ofs-warn-soft: rgb(216 165 92 / 14%);\n    --ofs-error: #e07a7a;\n    --ofs-error-soft: rgb(224 122 122 / 14%);\n    --ofs-idle: #8a8a92;\n    --ofs-idle-soft: rgb(255 255 255 / 6%);\n\n    /* 深色里相纸仍然是整间暗房里最亮的表面：光桌 > 相纸 > 卡片 > 地面 */\n    --ofs-mat: #1e1e22;\n    --ofs-mat-lit: rgb(255 255 255 / 7%);\n    --ofs-mat-inner: inset 0 1px 3px rgb(0 0 0 / 36%);\n    --ofs-print-paper: #2b2b31;\n    --ofs-print-edge: rgb(255 255 255 / 13%);\n    --ofs-print-shadow: 0 22px 44px -24px rgb(0 0 0 / 78%), 0 4px 12px -6px rgb(0 0 0 / 50%);\n    --ofs-print-shadow-hover: 0 28px 54px -24px rgb(0 0 0 / 82%), 0 6px 16px -6px rgb(0 0 0 / 54%);\n    --ofs-mark: rgb(255 255 255 / 28%);\n\n    --ofs-shadow-card: 0 1px 2px rgb(0 0 0 / 40%), 0 12px 28px -18px rgb(0 0 0 / 70%);\n    --ofs-shadow-lift: 0 2px 6px rgb(0 0 0 / 44%), 0 20px 44px -22px rgb(0 0 0 / 76%);\n    --ofs-shadow-window: 0 1px 3px rgb(0 0 0 / 40%), 0 40px 88px -48px rgb(0 0 0 / 88%);\n    --ofs-shadow-accent: 0 8px 20px -10px rgb(0 0 0 / 60%);\n    --ofs-focus-ring: 0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(255 255 255 / 40%);\n  }\n}\n\n/* 显式深色主题（预览脚本 / 宿主切换 `data-theme="dark"` 时生效），与上面同源。 */\n[data-theme="dark"] .ofs-root,\n.ofs-root[data-theme="dark"] {\n  --ofs-ground-1: #232326;\n  --ofs-ground-2: #17171a;\n  --ofs-ground-3: #26262a;\n  --ofs-ground-base: #101012;\n\n  --ofs-window: rgb(24 24 27 / 88%);\n  --ofs-window-border: rgb(255 255 255 / 9%);\n  --ofs-card: #18181b;\n  --ofs-card-solid: #1c1c20;\n  --ofs-card-border: rgb(255 255 255 / 9%);\n  --ofs-hairline: rgb(255 255 255 / 8%);\n  --ofs-sunken: rgb(255 255 255 / 5%);\n  --ofs-sunken-border: rgb(255 255 255 / 9%);\n\n  --ofs-ink: #f2f2f4;\n  --ofs-ink-2: #a4a4ac;\n  --ofs-ink-3: #8d8d95;\n  --ofs-ink-4: #5c5c63;\n\n  --ofs-accent: #f2f2f4;\n  --ofs-accent-2: #c8c8cf;\n  --ofs-accent-ink: #161618;\n  --ofs-accent-soft: rgb(255 255 255 / 8%);\n  --ofs-accent-soft-border: rgb(255 255 255 / 14%);\n  --ofs-accent-grad: linear-gradient(180deg, #fafafa 0%, #dcdce1 100%);\n\n  --ofs-ok: #58c08a;\n  --ofs-ok-soft: rgb(88 192 138 / 14%);\n  --ofs-warn: #d8a55c;\n  --ofs-warn-soft: rgb(216 165 92 / 14%);\n  --ofs-error: #e07a7a;\n  --ofs-error-soft: rgb(224 122 122 / 14%);\n  --ofs-idle: #8a8a92;\n  --ofs-idle-soft: rgb(255 255 255 / 6%);\n\n  --ofs-mat: #1e1e22;\n  --ofs-mat-lit: rgb(255 255 255 / 7%);\n  --ofs-mat-inner: inset 0 1px 3px rgb(0 0 0 / 36%);\n  --ofs-print-paper: #2b2b31;\n  --ofs-print-edge: rgb(255 255 255 / 13%);\n  --ofs-print-shadow: 0 22px 44px -24px rgb(0 0 0 / 78%), 0 4px 12px -6px rgb(0 0 0 / 50%);\n  --ofs-print-shadow-hover: 0 28px 54px -24px rgb(0 0 0 / 82%), 0 6px 16px -6px rgb(0 0 0 / 54%);\n  --ofs-mark: rgb(255 255 255 / 28%);\n\n  --ofs-shadow-card: 0 1px 2px rgb(0 0 0 / 40%), 0 12px 28px -18px rgb(0 0 0 / 70%);\n  --ofs-shadow-lift: 0 2px 6px rgb(0 0 0 / 44%), 0 20px 44px -22px rgb(0 0 0 / 76%);\n  --ofs-shadow-window: 0 1px 3px rgb(0 0 0 / 40%), 0 40px 88px -48px rgb(0 0 0 / 88%);\n  --ofs-shadow-accent: 0 8px 20px -10px rgb(0 0 0 / 60%);\n  --ofs-focus-ring: 0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(255 255 255 / 40%);\n}';

// src/styles/base.css
var base_default = "/*\n * 基础件：浏览器表面、通用原语（按钮 / 胶囊 / 图标钮 / 输入 / 分段控件）。\n *\n * 所有组件只从这里取原语，不在各自文件里重造按钮。类名都以 .ofs- 开头，\n * 避免污染宿主页面。\n */\n\n.ofs-root *,\n.ofs-root *::before,\n.ofs-root *::after {\n  box-sizing: border-box;\n}\n\n.ofs-root ::selection {\n  background: color-mix(in oklab, var(--ofs-ink) 16%, transparent);\n  color: var(--ofs-ink);\n}\n\n/* 浏览器表面：滚动条也属于设计系统。宿主的默认滚动条会破坏黑白灰的观感；\n   这里统一成细的墨灰滚动条，轨道透明，不抢内容。 */\n.ofs-root * {\n  scrollbar-width: thin;\n  scrollbar-color: color-mix(in oklab, var(--ofs-ink-4) 62%, transparent) transparent;\n}\n\n.ofs-root ::-webkit-scrollbar {\n  width: 8px;\n  height: 8px;\n}\n\n.ofs-root ::-webkit-scrollbar-thumb {\n  border: 2px solid transparent;\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-ink-4) 62%, transparent);\n  background-clip: padding-box;\n}\n\n.ofs-root ::-webkit-scrollbar-track,\n.ofs-root ::-webkit-scrollbar-corner {\n  background: transparent;\n}\n\n.ofs-root :focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-root :focus:not(:focus-visible) {\n  outline: none;\n}\n\n.ofs-root input,\n.ofs-root textarea,\n.ofs-root select {\n  font: inherit;\n  color: inherit;\n  caret-color: var(--ofs-accent);\n}\n\n.ofs-root button {\n  font: inherit;\n}\n\n.ofs-root img {\n  display: block;\n}\n\n.ofs-root h2,\n.ofs-root h3,\n.ofs-root h4,\n.ofs-root p {\n  margin: 0;\n}\n\n.ofs-root a {\n  color: var(--ofs-accent);\n  text-decoration-thickness: 1px;\n  text-underline-offset: 3px;\n}\n\n.ofs-icon {\n  display: block;\n  flex: 0 0 auto;\n}\n\n.ofs-grow {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.ofs-muted {\n  color: var(--ofs-ink-3);\n  font-size: 12px;\n}\n\n/* 滚动条：属于同一个世界，不做默认灰条 */\n.ofs-panel-scroll,\n.ofs-thread,\n.ofs-gallery,\n.ofs-roll {\n  scrollbar-width: thin;\n  scrollbar-color: var(--ofs-ink-4) transparent;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar,\n.ofs-thread::-webkit-scrollbar,\n.ofs-gallery::-webkit-scrollbar,\n.ofs-roll::-webkit-scrollbar {\n  width: 8px;\n  height: 8px;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar-thumb,\n.ofs-thread::-webkit-scrollbar-thumb,\n.ofs-gallery::-webkit-scrollbar-thumb,\n.ofs-roll::-webkit-scrollbar-thumb {\n  border: 2px solid transparent;\n  border-radius: 8px;\n  background: var(--ofs-ink-4);\n  background-clip: content-box;\n}\n\n.ofs-panel-scroll::-webkit-scrollbar-thumb:hover,\n.ofs-thread::-webkit-scrollbar-thumb:hover,\n.ofs-gallery::-webkit-scrollbar-thumb:hover,\n.ofs-roll::-webkit-scrollbar-thumb:hover {\n  background: var(--ofs-ink-3);\n  background-clip: content-box;\n}\n\n/* ── 按钮 ───────────────────────────────────────────────────── */\n.ofs-btn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  height: 38px;\n  padding: 0 18px;\n  border: 1px solid transparent;\n  border-radius: 12px;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 13px;\n  font-weight: 600;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 160ms ease,\n    background-color 160ms ease,\n    border-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-btn:disabled {\n  cursor: default;\n}\n\n.ofs-btn.is-primary {\n  color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n.ofs-btn.is-primary:hover:not(:disabled) {\n  transform: translateY(-1px);\n  box-shadow: 0 14px 28px -12px rgb(16 16 20 / 50%);\n}\n\n.ofs-btn.is-primary:active:not(:disabled) {\n  transform: translateY(0) scale(0.99);\n}\n\n.ofs-btn.is-primary:disabled {\n  background: var(--ofs-accent-grad);\n  border-color: transparent;\n  /* 文字色必须跟主题的主操作文字色（--ofs-accent-ink）：深色主题的主操作是浅色渐变\n     配墨黑字，写死白色会变成白字浅底，禁用时整行字看不见。 */\n  color: color-mix(in oklab, var(--ofs-accent-ink) 82%, transparent);\n  box-shadow: none;\n  opacity: 0.36;\n  filter: saturate(0.6);\n}\n\n.ofs-btn.is-quiet {\n  background: var(--ofs-card);\n  border-color: var(--ofs-card-border);\n  color: var(--ofs-ink);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-btn.is-quiet:hover:not(:disabled) {\n  background: var(--ofs-card-solid);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n.ofs-btn.is-quiet:disabled {\n  color: var(--ofs-ink-4);\n  box-shadow: none;\n}\n\n.ofs-btn.is-ghost {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-btn.is-ghost:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-ink);\n}\n\n/* ── 图标按钮 ───────────────────────────────────────────────── */\n.ofs-icon-btn {\n  appearance: none;\n  display: inline-grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  border: 1px solid transparent;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    color 150ms ease,\n    border-color 150ms ease,\n    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-icon-btn:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-icon-btn:active:not(:disabled) {\n  transform: scale(0.96);\n}\n\n.ofs-icon-btn:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n.ofs-icon-btn.is-on {\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n/* ── 胶囊 / 标签 ────────────────────────────────────────────── */\n.ofs-chip {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 12px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 500;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-chip:hover:not(:disabled) {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-chip.is-on {\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-accent);\n}\n\n.ofs-chip.is-danger {\n  color: var(--ofs-error);\n  border-color: transparent;\n  background: var(--ofs-error-soft);\n}\n\n.ofs-chip.is-danger:hover:not(:disabled) {\n  color: var(--ofs-error);\n  border-color: var(--ofs-error);\n}\n\n.ofs-chip:disabled {\n  color: var(--ofs-ink-4);\n  background: transparent;\n  border-color: var(--ofs-sunken-border);\n  cursor: default;\n}\n\n/* ── 分段控件 ───────────────────────────────────────────────── */\n.ofs-seg {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  padding: 3px;\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  border: 1px solid var(--ofs-sunken-border);\n}\n\n.ofs-seg button {\n  appearance: none;\n  height: 26px;\n  padding: 0 12px;\n  border: 0;\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  transition:\n    background-color 160ms ease,\n    color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-seg button:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-seg button.is-on {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n  font-weight: 600;\n  box-shadow: 0 1px 2px rgb(16 16 20 / 8%);\n}\n\n/* ── 状态点 ─────────────────────────────────────────────────── */\n.ofs-dot {\n  display: inline-block;\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--ofs-idle);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-idle) 22%, transparent);\n}\n\n.ofs-dot.is-ok { background: var(--ofs-ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-ok) 20%, transparent); }\n.ofs-dot.is-warn { background: var(--ofs-warn); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-warn) 22%, transparent); }\n.ofs-dot.is-error { background: var(--ofs-error); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-error) 20%, transparent); }\n.ofs-dot.is-idle { background: var(--ofs-idle); }\n.ofs-dot.is-live { animation: ofs-pulse 2.4s ease-out infinite; }\n\n/* 排队 / 预热用琥珀点：呼吸圈也换成警告色。 */\n.ofs-dot.is-warn.is-live {\n  animation: ofs-warn-pulse 2.2s ease-out infinite;\n}\n\n@keyframes ofs-warn-pulse {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 34%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n}\n\n/* ── 动效 ───────────────────────────────────────────────────── */\n@keyframes ofs-pulse {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-ok) 34%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-ok) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-ok) 0%, transparent); }\n}\n\n@keyframes ofs-shimmer {\n  0% { background-position: -220% 0; }\n  100% { background-position: 220% 0; }\n}\n\n@keyframes ofs-fade-in {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n@keyframes ofs-pop-in {\n  from { opacity: 0; transform: translateY(6px) scale(0.985); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}\n\n/* ── 悬浮提示 ─────────────────────────────────────────────── */\n.ofs-tip {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  margin-left: 5px;\n  vertical-align: middle;\n}\n\n.ofs-tip-trigger {\n  appearance: none;\n  display: inline-grid;\n  place-items: center;\n  width: 15px;\n  height: 15px;\n  padding: 0;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-3);\n  font-size: 9.5px;\n  font-weight: 700;\n  line-height: 1;\n  cursor: help;\n}\n\n.ofs-tip-trigger:hover,\n.ofs-tip-trigger:focus-visible {\n  color: var(--ofs-ink);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-tip-trigger:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-tip--warn .ofs-tip-trigger {\n  color: var(--ofs-warn);\n  border-color: color-mix(in oklab, var(--ofs-warn) 45%, transparent);\n  background: var(--ofs-warn-soft);\n}\n\n/* 固定在视口坐标上，不被侧栏的滚动容器裁剪；位置由组件按触发点计算。 */\n.ofs-tip-pop {\n  position: fixed;\n  z-index: 90;\n  width: max-content;\n  max-width: 248px;\n  padding: 8px 10px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: 10px;\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink-2);\n  box-shadow: var(--ofs-shadow-lift);\n  font-size: 11.5px;\n  line-height: 1.55;\n  text-align: left;\n  white-space: normal;\n  transform: translateY(-100%);\n  pointer-events: none;\n}\n\n.ofs-tip-pop.is-below {\n  transform: none;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-root *,\n  .ofs-root *::before,\n  .ofs-root *::after {\n    animation-duration: 1ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 1ms !important;\n  }\n}";

// src/styles/shell.css
var shell_default = "/*\n * 外壳：整页容器、顶栏、云端过渡状态条、布局骨架与 Toast。\n * 模型选卡、异常指引与抽屉样式已拆至 model-picker.css / guidance.css / drawers.css。\n *\n * 页面是一张浮在柔光地面上的雾面玻璃大卡：\n *   .ofs-root = 柔光底，.ofs-app = 玻璃大卡，内部再分顶栏 / 主体 / 最近生成栏。\n */\n\n.ofs-app {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-xl);\n  background: var(--ofs-window);\n  box-shadow: var(--ofs-shadow-window);\n  backdrop-filter: blur(24px) saturate(140%);\n  -webkit-backdrop-filter: blur(24px) saturate(140%);\n  overflow: hidden;\n}\n\n/* ── 顶栏 ───────────────────────────────────────────────────── */\n.ofs-topbar {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  height: 58px;\n  padding: 0 16px;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-brand {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  min-width: 0;\n}\n\n.ofs-brand-mark {\n  display: grid;\n  place-items: center;\n  width: 30px;\n  height: 30px;\n  border-radius: 9px;\n  color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n.ofs-brand-name {\n  font-size: 13.5px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n}\n\n.ofs-brand-sub {\n  padding-left: 2px;\n  font-size: 10px;\n  font-weight: 550;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-tabs {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  padding: 3px;\n  margin-left: 4px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n}\n\n.ofs-tab {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 12px;\n  border: 0;\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 160ms ease,\n    color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-tab:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-tab.is-on {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n  font-weight: 600;\n  box-shadow: 0 1px 2px rgb(16 16 20 / 8%);\n}\n\n/* 云端GPU 状态 */\n.ofs-pill-wrap {\n  position: relative;\n  flex: 0 0 auto;\n}\n\n.ofs-compute {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  box-shadow: var(--ofs-shadow-card);\n  transition:\n    border-color 160ms ease,\n    color 160ms ease,\n    background-color 160ms ease;\n}\n\n.ofs-compute:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-compute em {\n  font-style: normal;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 插件自身有新版本：胶囊内的小圆点；详情与更新说明在弹层里，不打断出图。 */\n.ofs-update-dot {\n  width: 7px;\n  height: 7px;\n  flex: 0 0 auto;\n  border-radius: 50%;\n  background: var(--ofs-warn);\n}\n\n.ofs-pill-caret {\n  display: grid;\n  place-items: center;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-popover {\n  position: absolute;\n  top: calc(100% + 8px);\n  right: 0;\n  z-index: 40;\n  width: 248px;\n  padding: 6px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 16px;\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-lift);\n  animation: ofs-pop-in 160ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-popover-head {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  padding: 8px 10px 10px;\n  margin-bottom: 4px;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-popover-head > span {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-popover-head > span b {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: var(--ofs-ink);\n}\n\n/* 检查结果 / 失败说明：弹层里的一行到三行小字，避免长 notes 撑开菜单。 */\n.ofs-popover-note {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n  border-bottom: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.5;\n}\n\n.ofs-popover-note span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* 弹层里的一句话状态说明：允许换行，不截断。 */\n.ofs-popover-hint {\n  margin: 0;\n  padding: 8px 10px 9px;\n  border-bottom: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.55;\n}\n\n/* 配额回退：接口不可读时给出的本地统计，与检查结果行区分开。 */\n.ofs-popover-fallback {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  padding: 8px 10px 9px;\n  margin-bottom: 4px;\n  border-bottom: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.5;\n}\n\n.ofs-popover-fallback-title {\n  color: var(--ofs-ink-2);\n  font-weight: 600;\n}\n\n.ofs-popover-link {\n  align-self: flex-start;\n  margin-top: 2px;\n  border-radius: 4px;\n  color: var(--ofs-accent);\n  font-size: 11px;\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}\n\n.ofs-popover-link:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-popover-row {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  height: 32px;\n  padding: 0 10px;\n  border: 0;\n  border-radius: 9px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-popover-row:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-popover-row:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* ── 骨架 ───────────────────────────────────────────────────── */\n.ofs-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: grid;\n  /* 单轨创作面板 + 自适应预览区；放宽左栏以在顶栏稳妥容纳标题、新建创作与模式切换。 */\n  grid-template-columns: 376px minmax(0, 1fr);\n  grid-template-rows: minmax(0, 1fr);\n}\n\n.ofs-body.is-gallery {\n  grid-template-columns: minmax(0, 1fr);\n}\n\n.ofs-main {\n  position: relative;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  margin: 14px;\n}\n\n/* ── 状态区：流水线 / 排队卡 / 阻塞指引的堆叠容器 ─────────────────── */\n/* 单独成层，右上角通知才能挂在这条带子的下沿展开，而不是压住流水线的计时。 */\n.ofs-status-area {\n  position: relative;\n  z-index: 5;\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n}\n\n/* ── 右上角轻量通知区（瞬时反馈 + 非全局阻塞的可恢复异常） ──────────── */\n/* 无流水线时贴着顶栏下沿；有流水线或横幅时自动让到状态区下方。 */\n.ofs-toast-stack {\n  position: absolute;\n  top: calc(100% + 8px);\n  right: 14px;\n  z-index: 60;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 8px;\n  max-width: min(380px, calc(100% - 32px));\n  pointer-events: none;\n}\n\n.ofs-toast {\n  pointer-events: auto;\n  max-width: 100%;\n  padding: 9px 14px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 90%, transparent);\n  box-shadow: var(--ofs-shadow-lift);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  animation: ofs-toast-in 180ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-toast--notice {\n  display: flex;\n  align-items: flex-start;\n  gap: 9px;\n  width: 100%;\n  padding: 10px 12px;\n  border-color: color-mix(in oklab, var(--ofs-warn) 28%, transparent);\n  border-radius: 14px;\n  background: color-mix(in oklab, var(--ofs-card-solid) 92%, var(--ofs-warn-soft));\n  white-space: normal;\n  overflow: visible;\n}\n\n.ofs-toast-icon {\n  display: grid;\n  place-items: center;\n  flex: 0 0 auto;\n  width: 24px;\n  height: 24px;\n  border-radius: 8px;\n  background: color-mix(in oklab, var(--ofs-warn) 16%, transparent);\n  color: var(--ofs-warn);\n}\n\n.ofs-toast-body {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  min-width: 0;\n  flex: 1 1 auto;\n}\n\n.ofs-toast-title {\n  margin: 0;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--ofs-ink);\n  line-height: 1.4;\n}\n\n.ofs-toast-detail {\n  margin: 0;\n  color: var(--ofs-ink-2);\n  font-size: 11px;\n  line-height: 1.45;\n  overflow-wrap: anywhere;\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n  overflow: hidden;\n}\n\n.ofs-toast-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n  margin-top: 2px;\n}\n\n.ofs-toast-actions .ofs-chip.is-on {\n  background: color-mix(in oklab, var(--ofs-warn) 16%, transparent);\n  border-color: color-mix(in oklab, var(--ofs-warn) 34%, transparent);\n  color: var(--ofs-warn);\n}\n\n@keyframes ofs-toast-in {\n  from {\n    opacity: 0;\n    transform: translateY(-6px);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n";

// src/styles/pipeline.css
var pipeline_default = '/*\n * 生图流水线：顶栏下方一条 40px 高的单行节点条。\n *\n * 左边是固定五段的节点序列（申请 GPU 的四段 + 生成），右边是排队数与总等待时长。\n * 只在有等待时出现，由组合层决定内容；这里只管形态：中性卡片、小圆点、连接线与克制的动效。\n *\n * 配色立场（见 tokens.css）：语义色只以小圆点与窄条出现——\n *   已完成 = ok 绿点；当前 = 墨黑点 + 1.5 秒呼吸；\n *   排队变慢 = 琥珀点 + 琥珀文字；失败 = 红点；待开始 = 空心灰点。\n */\n\n.ofs-pipeline {\n  position: relative;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  height: 40px;\n  margin: 12px 16px 0;\n  padding: 0 12px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  line-height: 1.4;\n  overflow: hidden;\n  animation: ofs-fade-in 220ms ease;\n  /* 出现/消失用高度过渡：等待超过 1.5 秒才出现，快速出图不闪条。 */\n  transition:\n    height 200ms ease,\n    margin-top 200ms ease,\n    opacity 180ms ease,\n    border-color 200ms ease;\n}\n\n/* 收起态：高度归零但不移除节点（外层常驻，避免工作区上下跳动）。 */\n.ofs-pipeline.is-hidden {\n  height: 0;\n  margin-top: 0;\n  border-color: transparent;\n  opacity: 0;\n  pointer-events: none;\n}\n\n/* ── 左侧：节点与连接线 ─────────────────────────────────────── */\n.ofs-pl-rail {\n  position: relative;\n  display: flex;\n  align-items: center;\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.ofs-pl-node {\n  position: relative;\n  z-index: 1;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  flex: 0 0 auto;\n  padding: 4px 8px;\n  border-radius: var(--ofs-r-pill);\n}\n\n/* 当前节点：一枚浅浅的底，让「现在在这一格」不靠颜色也能读出来。 */\n.ofs-pl-node.is-active {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-pl-dot {\n  flex: 0 0 auto;\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: transparent;\n  box-shadow: inset 0 0 0 1.5px var(--ofs-ink-4);\n}\n\n.ofs-pl-node.is-done .ofs-pl-dot {\n  background: var(--ofs-ok);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-ok) 16%, transparent);\n}\n\n.ofs-pl-node.is-active .ofs-pl-dot {\n  background: var(--ofs-accent);\n  animation: ofs-pl-breathe 1.5s ease-in-out infinite;\n}\n\n.ofs-pl-node.is-warn .ofs-pl-dot {\n  background: var(--ofs-warn);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-warn) 18%, transparent);\n  animation: ofs-warn-pulse 2.2s ease-out infinite;\n}\n\n.ofs-pl-node.is-failed .ofs-pl-dot {\n  background: var(--ofs-error);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-error) 18%, transparent);\n}\n\n.ofs-pl-label {\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-pl-node.is-done .ofs-pl-label {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-pl-node.is-active .ofs-pl-label {\n  color: var(--ofs-ink);\n  font-weight: 650;\n}\n\n.ofs-pl-node.is-warn .ofs-pl-label {\n  color: var(--ofs-warn);\n  font-weight: 600;\n}\n\n.ofs-pl-node.is-failed .ofs-pl-label {\n  color: var(--ofs-error);\n  font-weight: 600;\n}\n\n/* 生成节点的分张计数：跟着当前节点，不另开一行。 */\n.ofs-pl-sub {\n  margin-left: 1px;\n  color: var(--ofs-ink-2);\n  font-weight: 500;\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n/* 「比平时久」：只给文字上色，不垫色底。 */\n.ofs-pl-tag {\n  margin-left: 1px;\n  color: var(--ofs-warn);\n  font-size: 10.5px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.ofs-pl-tag::before {\n  content: "·";\n  margin-right: 5px;\n  color: var(--ofs-ink-4);\n  font-weight: 400;\n}\n\n/* 连接线：走完的段是实线，正在走的那一段有一道很慢的流光。 */\n.ofs-pl-link {\n  position: relative;\n  flex: 1 1 12px;\n  min-width: 14px;\n  height: 1px;\n  background: var(--ofs-hairline);\n  overflow: hidden;\n}\n\n.ofs-pl-link.is-filled {\n  background: color-mix(in oklab, var(--ofs-ink) 20%, transparent);\n}\n\n.ofs-pl-link.is-flowing::after {\n  content: "";\n  position: absolute;\n  inset: -0.5px 0;\n  background: linear-gradient(\n    90deg,\n    transparent 0%,\n    color-mix(in oklab, var(--ofs-ink) 42%, transparent) 50%,\n    transparent 100%\n  );\n  background-size: 220% 100%;\n  animation: ofs-pl-flow 2.6s linear infinite;\n}\n\n/* 折叠态（云端已就绪 → 生成）：只剩两个锚点时不要拉满整行，\n   否则那条长线会被读成「还有很长一段进度要走」。 */\n.ofs-pl-rail.is-folded .ofs-pl-link {\n  flex: 0 0 26px;\n}\n\n/* ── 右侧：排队数与总等待 ───────────────────────────────────── */\n.ofs-pl-meta {\n  flex: 0 1 auto;\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding-left: 14px;\n  border-left: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.ofs-pl-queue {\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-pl-time {\n  color: var(--ofs-ink-2);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 完成态：最后节点亮一次（一次显影），整条随后淡出。 */\n.ofs-pipeline.is-complete .ofs-pl-node.is-done:last-child .ofs-pl-dot {\n  animation: ofs-pl-develop 800ms cubic-bezier(0.22, 1, 0.36, 1) 1;\n}\n\n.ofs-pipeline.is-complete .ofs-pl-node.is-done:last-child .ofs-pl-label {\n  color: var(--ofs-ok);\n  font-weight: 600;\n}\n\n/* 关闭云端：不属于生成流程，只留一行「正在关闭云端…」，不画节点。 */\n.ofs-pipeline.is-closing .ofs-pl-meta {\n  display: none;\n}\n\n/* ── 动效 ───────────────────────────────────────────────────── */\n@keyframes ofs-pl-breathe {\n  0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, var(--ofs-accent) 16%, transparent); }\n  50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-accent) 3%, transparent); }\n}\n\n@keyframes ofs-pl-flow {\n  from { background-position: 220% 0; }\n  to { background-position: -120% 0; }\n}\n\n@keyframes ofs-pl-develop {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-ok) 55%, transparent); }\n  100% { box-shadow: 0 0 0 12px color-mix(in oklab, var(--ofs-ok) 0%, transparent); }\n}\n';

// src/styles/model-picker.css
var model_picker_default = '/* 模型选择卡（ModelCardPicker） */\n.ofs-model-wrap {\n  position: relative;\n  flex: 0 0 auto;\n}\n\n.ofs-model {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 10px 0 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  box-shadow: var(--ofs-shadow-card);\n  transition:\n    border-color 160ms ease,\n    color 160ms ease,\n    background-color 160ms ease;\n}\n\n.ofs-model:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-model:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-model[aria-expanded="true"] {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-card-solid);\n}\n\n.ofs-model > svg {\n  flex: 0 0 auto;\n}\n\n.ofs-model.is-empty {\n  cursor: default;\n}\n\n.ofs-model-family {\n  display: inline-flex;\n  align-items: center;\n  height: 16px;\n  padding: 0 4px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: 4px;\n  color: var(--ofs-ink-2);\n  font-size: 10px;\n  font-weight: 650;\n  line-height: 1;\n  letter-spacing: .05em;\n}\n\n.ofs-model-now {\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  font-weight: 600;\n  line-height: 1;\n  letter-spacing: .01em;\n}\n\n.ofs-model-div {\n  width: 1px;\n  height: 12px;\n  background: var(--ofs-hairline);\n}\n\n.ofs-model-eta {\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  font-weight: 550;\n  line-height: 1;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-model-caret {\n  color: var(--ofs-ink-3);\n  transition: transform 180ms cubic-bezier(.22, 1, .36, 1);\n}\n\n.ofs-model[aria-expanded="true"] .ofs-model-caret {\n  transform: rotate(180deg);\n}\n\n/* 弹层：与云端状态弹层同构；列表自身滚动，头尾固定。 */\n.ofs-model-menu {\n  position: absolute;\n  top: calc(100% + 8px);\n  right: 0;\n  z-index: 40;\n  display: flex;\n  flex-direction: column;\n  width: min(380px, calc(100vw - 32px));\n  max-height: 420px;\n  padding: 8px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 16px;\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-lift);\n  animation: ofs-pop-in 160ms cubic-bezier(.22, 1, .36, 1);\n}\n\n.ofs-model-head {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  padding: 4px 10px 9px;\n  border-bottom: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: .03em;\n}\n\n.ofs-model-head span:last-child {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 500;\n  letter-spacing: .02em;\n}\n\n.ofs-model-list {\n  flex: 1 1 auto;\n  min-height: 0;\n  max-height: 304px; /* 4 行 × 76px：避免截出半行，剩余模型用滚动查看 */\n  overflow-y: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 6px 0 0;\n  overscroll-behavior: contain;\n  scrollbar-gutter: stable;\n  scrollbar-width: thin;\n  scrollbar-color: var(--ofs-ink-4) transparent;\n}\n\n.ofs-model-list::-webkit-scrollbar {\n  width: 6px;\n}\n\n.ofs-model-list::-webkit-scrollbar-thumb {\n  border-radius: 3px;\n  background: var(--ofs-ink-4);\n}\n\n.ofs-model-option {\n  appearance: none;\n  display: grid;\n  grid-template-columns: 56px minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 12px;\n  width: 100%;\n  padding: 9px 10px;\n  border: 1px solid transparent;\n  border-radius: 12px;\n  background: color-mix(in oklab, var(--ofs-sunken) 55%, transparent);\n  color: var(--ofs-ink);\n  text-align: left;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease;\n}\n\n.ofs-model-option:hover {\n  border-color: var(--ofs-hairline);\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-model-option.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-model-option:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-model-poster {\n  display: block;\n  width: 56px;\n  height: 56px;\n  overflow: hidden;\n  border: 1px solid var(--ofs-print-edge);\n  border-radius: 10px;\n  background: var(--ofs-sunken);\n}\n\n.ofs-model-poster img {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  filter: saturate(.96) brightness(.98);\n  transition:\n    filter 170ms ease,\n    transform 220ms cubic-bezier(.22, 1, .36, 1);\n}\n\n.ofs-model-option:hover .ofs-model-poster img {\n  filter: saturate(1.03) brightness(1.05);\n  transform: scale(1.03);\n}\n\n.ofs-model-poster-fallback {\n  display: grid;\n  place-items: center;\n  width: 100%;\n  height: 100%;\n  color: var(--ofs-ink-3);\n  font-size: 18px;\n  font-weight: 650;\n}\n\n.ofs-model-copy {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  min-width: 0;\n}\n\n.ofs-model-line {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.ofs-model-fam {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  height: 16px;\n  padding: 0 4px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: 4px;\n  color: var(--ofs-ink-3);\n  font-size: 9.5px;\n  font-weight: 650;\n  line-height: 1;\n  letter-spacing: .05em;\n}\n\n.ofs-model-option.is-on .ofs-model-fam {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink-2);\n}\n\n.ofs-model-name {\n  overflow: hidden;\n  color: var(--ofs-ink);\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 1.3;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.ofs-model-default {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  height: 16px;\n  padding: 0 5px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: 4px;\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink-2);\n  font-size: 10px;\n  font-weight: 600;\n  line-height: 1;\n}\n\n.ofs-model-lang {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  height: 16px;\n  padding: 0 5px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: 4px;\n  color: var(--ofs-ink-3);\n  font-size: 9.5px;\n  font-weight: 550;\n  line-height: 1;\n}\n\n.ofs-model-lang.is-zh {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* 模型卡选项里的算力来源角标（与语言角标同形，用告警色区分「当前来源跑不了」）。 */\n.ofs-model-provider {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  height: 16px;\n  padding: 0 5px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 34%, transparent);\n  border-radius: 4px;\n  background: var(--ofs-warn-soft);\n  color: var(--ofs-warn);\n  font-size: 9.5px;\n  font-weight: 550;\n  line-height: 1;\n  letter-spacing: .02em;\n}\n\n/* 置灰项不响应 hover 高亮：disabled 属性由浏览器挡住点击，视觉上也别给「可选」暗示。 */\n.ofs-model-option.is-provider-gated:hover {\n  border-color: transparent;\n  background: color-mix(in oklab, var(--ofs-sunken) 55%, transparent);\n}\n\n.ofs-model-desc {\n  overflow: hidden;\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  font-weight: 500;\n  line-height: 1.45;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.ofs-model-spec {\n  overflow: hidden;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  font-weight: 500;\n  line-height: 1.4;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-model-side {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 4px;\n  min-width: 46px;\n}\n\n.ofs-model-option-eta {\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  font-weight: 550;\n  line-height: 1.2;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: .01em;\n  white-space: nowrap;\n}\n\n.ofs-model-option.is-on .ofs-model-option-eta {\n  color: var(--ofs-ink);\n  font-weight: 600;\n}\n\n.ofs-model-check {\n  display: grid;\n  place-items: center;\n  width: 16px;\n  height: 16px;\n  color: var(--ofs-accent);\n  opacity: 0;\n  transition: opacity 140ms ease;\n}\n\n.ofs-model-option.is-on .ofs-model-check {\n  opacity: 1;\n}\n\n.ofs-model-foot {\n  flex: 0 0 auto;\n  margin-top: 4px;\n  padding: 9px 10px 3px;\n  border-top: 1px solid var(--ofs-hairline);\n  color: var(--ofs-ink-3);\n  font-size: 11.5px;\n  font-weight: 500;\n  line-height: 1.5;\n  letter-spacing: .01em;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-model-menu {\n    animation: none;\n  }\n\n  .ofs-model,\n  .ofs-model-caret,\n  .ofs-model-option,\n  .ofs-model-poster img,\n  .ofs-model-check {\n    transition: none;\n  }\n}\n';

// src/styles/guidance.css
var guidance_default = '/* ── 异常指引 ───────────────────────────────────────────────── */\n/*\n * 中性卡片 + 左缘 2px 窄条：与生图流水线、创作面板同一套材质。\n * tokens.css 的立场是「语义色只以小圆点或窄条出现，不参与大面积装饰」，\n * 所以不再用整块琥珀/红底——等待与环境前置用琥珀窄条，硬错误用红窄条。\n */\n.ofs-guidance {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 12px 16px 0;\n  padding: 10px 12px;\n  border: 1px solid var(--ofs-hairline);\n  border-left: 2px solid var(--ofs-warn);\n  border-radius: 14px;\n  background: var(--ofs-card);\n  animation: ofs-fade-in 220ms ease;\n}\n\n/* 硬错误（显存不足、连接中断、会话异常、生成失败…）：只把窄条换成红色。 */\n.ofs-guidance.is-error {\n  border-left-color: var(--ofs-error);\n}\n\n.ofs-guidance-icon {\n  display: grid;\n  place-items: center;\n  flex: 0 0 auto;\n  width: 28px;\n  height: 28px;\n  border-radius: 9px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-3);\n}\n\n.ofs-guidance-body {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  min-width: 0;\n}\n\n.ofs-guidance-title {\n  font-size: 12.5px;\n  color: var(--ofs-ink);\n}\n\n.ofs-guidance-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n/* ── 排队卡住提示（10 分钟档，非错误态）──────────────────────── */\n/* 沿用指引卡布局；色调用默认的琥珀窄条，和真正的报错（红窄条）区分开。 */\n\n/* 横幅主操作：墨黑实心胶囊（工作台自己的主操作语言），靠层级而不是颜色抢注意力。 */\n.ofs-guidance-actions .ofs-chip.is-on {\n  border-color: transparent;\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n  font-weight: 600;\n  text-decoration: none;\n}\n\n.ofs-guidance-detail {\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  line-height: 1.5;\n  overflow-wrap: anywhere;\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n  overflow: hidden;\n}\n\n/* 指引卡的可执行提示（Windows PATH、凭据文件位置、GPU 开启步骤）：不截断，允许换行。 */\n.ofs-guidance-note {\n  margin: 0;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.55;\n  overflow-wrap: anywhere;\n}\n\n.ofs-guidance-command {\n  display: inline-block;\n  max-width: 100%;\n  padding: 3px 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 8px;\n  background: color-mix(in oklab, var(--ofs-card-solid) 70%, transparent);\n  color: var(--ofs-ink);\n  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace;\n  font-size: 11.5px;\n  overflow-wrap: anywhere;\n}\n\n/* 直连登录的 manual 兜底：授权链接 + 复制按钮 + 授权码输入 + 行内校验错误。 */\n.ofs-guidance-manual {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  min-width: 0;\n}\n\n.ofs-guidance-url {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px;\n  min-width: 0;\n}\n\n.ofs-guidance-code {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-guidance-code-input {\n  flex: 1 1 200px;\n  min-width: 0;\n  height: 30px;\n  font-size: 11.5px;\n}\n\n.ofs-guidance-code-error {\n  margin: 0;\n  color: var(--ofs-error);\n  font-size: 11px;\n  line-height: 1.5;\n}\n';

// src/styles/drawers.css
var drawers_default = '/* ── 右侧抽屉共用骨架（LogsDrawer / SettingsDrawer） ──────────── */\n.ofs-logs,\n.ofs-settings {\n  position: fixed;\n  inset: 0;\n  z-index: 100;\n  display: flex;\n  justify-content: flex-end;\n  background: rgb(16 16 18 / 38%);\n  backdrop-filter: blur(2px);\n  -webkit-backdrop-filter: blur(2px);\n  animation: ofs-fade-in 160ms ease;\n}\n\n.ofs-logs-panel,\n.ofs-settings-panel {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  border-left: 1px solid var(--ofs-window-border);\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-window);\n  animation: ofs-slide-in 200ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-logs-panel {\n  width: min(560px, 100%);\n}\n\n/* 设置项是短表单，不需要日志那样的整屏宽度。 */\n.ofs-settings-panel {\n  width: min(440px, 100%);\n}\n\n.ofs-logs-head,\n.ofs-settings-head {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 16px;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-logs-head {\n  flex-wrap: wrap;\n}\n\n.ofs-logs-title,\n.ofs-settings-title {\n  font-size: 13.5px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n  color: var(--ofs-ink);\n  white-space: nowrap;\n}\n\n.ofs-logs-body,\n.ofs-settings-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n  scrollbar-color: var(--ofs-ink-4) transparent;\n}\n\n.ofs-logs-body::-webkit-scrollbar,\n.ofs-settings-body::-webkit-scrollbar {\n  width: 8px;\n}\n\n.ofs-logs-body::-webkit-scrollbar-thumb,\n.ofs-settings-body::-webkit-scrollbar-thumb {\n  border: 2px solid transparent;\n  border-radius: 8px;\n  background: var(--ofs-ink-4);\n  background-clip: content-box;\n}\n\n.ofs-logs-note,\n.ofs-settings-note {\n  margin: 0;\n  padding: 18px 16px;\n  color: var(--ofs-ink-3);\n  font-size: 12px;\n  line-height: 1.6;\n}\n\n@keyframes ofs-slide-in {\n  from {\n    opacity: 0;\n    transform: translateX(18px);\n  }\n  to {\n    opacity: 1;\n    transform: translateX(0);\n  }\n}\n\n/* ── 运行日志抽屉专属规则 ───────────────────────────────────── */\n/* 远端 / Host 双视图切换：紧凑胶囊，与 header 里的复制按钮同一视觉语言。 */\n.ofs-logs-tabs {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ofs-logs-tab {\n  height: 26px;\n  padding: 0 10px;\n  font-size: 11.5px;\n}\n\n.ofs-logs-copy {\n  height: 30px;\n}\n\n.ofs-logs-body {\n  background: var(--ofs-sunken);\n}\n\n.ofs-logs-lines {\n  margin: 0;\n  padding: 14px 16px 22px;\n  color: var(--ofs-ink-2);\n  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace;\n  font-size: 11.5px;\n  line-height: 1.65;\n  font-variant-numeric: tabular-nums;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n\n.ofs-logs-note.is-warn {\n  color: var(--ofs-warn);\n}\n\n/* 自动兜底提示：远端没有日志、已切到 Host 本地日志时说明来源。 */\n.ofs-logs-fallback {\n  margin: 0;\n  padding: 9px 16px;\n  border-bottom: 1px solid color-mix(in oklab, var(--ofs-accent) 22%, transparent);\n  background: color-mix(in oklab, var(--ofs-accent) 10%, transparent);\n  color: var(--ofs-accent);\n  font-size: 11.5px;\n  line-height: 1.5;\n}\n\n/* ── 运行设置抽屉专属规则 ───────────────────────────────────── */\n/* 读取失败：不白屏，给原因 + 重试。 */\n.ofs-settings-error-state {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 18px 16px;\n}\n\n.ofs-settings-form {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 4px 16px 16px;\n}\n\n/* 生效提示：温和的暖色窄条，说明改动要等下次唤醒。 */\n.ofs-settings-effective {\n  margin: 10px 0 2px;\n  padding: 8px 10px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 26%, transparent);\n  border-radius: 10px;\n  background: var(--ofs-warn-soft);\n  color: var(--ofs-warn);\n  font-size: 11.5px;\n  line-height: 1.5;\n}\n\n.ofs-settings-section {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n  padding: 13px 0;\n  border-bottom: 1px solid var(--ofs-hairline);\n}\n\n.ofs-settings-section:last-of-type {\n  border-bottom: 0;\n}\n\n.ofs-settings-section-title {\n  font-size: 12px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-settings-row {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.ofs-settings-label {\n  font-size: 11.5px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-settings-quick {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-settings-quick-item {\n  height: 26px;\n  padding: 0 10px;\n  font-size: 11.5px;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-settings-field {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n\n.ofs-settings-input,\n.ofs-settings-textarea {\n  width: 100%;\n  padding: 0 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 10px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n}\n\n.ofs-settings-input {\n  height: 32px;\n}\n\n.ofs-settings-textarea {\n  min-height: 66px;\n  padding: 8px 10px;\n  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace;\n  font-size: 11.5px;\n  line-height: 1.55;\n  resize: vertical;\n}\n\n.ofs-settings-input:focus-visible,\n.ofs-settings-textarea:focus-visible {\n  outline: none;\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-settings-options {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n/* 加速器单选：原生 radio 收进 label 里，视觉仍是轻量卡片。 */\n.ofs-settings-option {\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 32px;\n  padding: 0 12px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 10px;\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    background-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-settings-option:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-settings-option input {\n  margin: 0;\n  accent-color: var(--ofs-accent);\n}\n\n.ofs-settings-option.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  box-shadow: 0 0 0 1px var(--ofs-accent);\n}\n\n.ofs-settings-inline {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.ofs-settings-muted {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-settings-clear {\n  height: 26px;\n  padding: 0 10px;\n  font-size: 11px;\n}\n\n/* 高级折叠头：一行标题 + 箭头，默认收起，不占表单纵向空间。 */\n.ofs-settings-advanced-toggle {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 600;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-settings-advanced-toggle:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-settings-advanced {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding-top: 9px;\n}\n\n.ofs-settings-hint {\n  font-size: 10.5px;\n  line-height: 1.5;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-settings-errors {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.ofs-settings-error-item {\n  color: var(--ofs-error);\n  font-size: 11px;\n  line-height: 1.5;\n  overflow-wrap: anywhere;\n}\n\n.ofs-settings-error {\n  margin: 0;\n  color: var(--ofs-error);\n  font-size: 11.5px;\n  line-height: 1.5;\n}\n\n/* 底部操作条：滚动时贴住抽屉底部，保存按钮始终可点。 */\n.ofs-settings-foot {\n  position: sticky;\n  bottom: 0;\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin-top: 4px;\n  padding: 12px 0 4px;\n  border-top: 1px solid var(--ofs-hairline);\n  background: var(--ofs-card-solid);\n}\n\n.ofs-settings-save {\n  height: 32px;\n  padding: 0 16px;\n  font-size: 12.5px;\n}\n';

// src/styles/panel.css
var panel_default = "/*\n * 左侧创作面板（表单 / 对话两种形态共用的卡片容器与表单控件）。\n */\n\n.ofs-panel {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  min-width: 0;\n  margin: 14px 0 14px 14px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  overflow: hidden;\n}\n\n.ofs-panel-head {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 14px 14px 10px;\n}\n\n.ofs-panel-head-title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.ofs-panel-head h2 {\n  font-size: 16px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n  white-space: nowrap;\n}\n\n.ofs-head-new {\n  flex: 0 0 auto;\n  height: 26px;\n  padding: 0 9px;\n  gap: 4px;\n  font-size: 11.5px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.ofs-panel-head .ofs-seg {\n  flex: 0 0 auto;\n}\n\n.ofs-panel-head .ofs-seg button {\n  padding: 0 9px;\n  white-space: nowrap;\n}\n\n.ofs-panel-scroll {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 0 15px 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n  scroll-behavior: smooth;\n  /* 内容偶尔超出时（等待流水线、错误横幅），用一条常驻细滚动条说明还有内容，\n     而不是把某一行硬切在页脚上沿。gutter 稳定，状态切换时文字不会左右跳。 */\n  scrollbar-width: thin;\n  scrollbar-color: color-mix(in oklab, var(--ofs-ink-4) 72%, transparent) transparent;\n  scrollbar-gutter: stable;\n}\n\n/* ── 微调来源与新建创作 ────────────────────────────────────── */\n/* 面板顶部一条轻量状态行：左侧「正在微调：某张作品」，右侧「新建创作」重置入口。 */\n.ofs-tuning {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 0 15px 10px;\n}\n\n.ofs-tuning.is-idle {\n  justify-content: flex-end;\n}\n\n.ofs-tuning-source {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.4;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* 阶段十五 A1：有未提交草稿时，状态行换成琥珀色的草稿提示 + 「还原原图」轻量按钮。 */\n.ofs-tuning.is-draft .ofs-tuning-source {\n  color: var(--ofs-warn);\n}\n\n.ofs-tuning-restore {\n  appearance: none;\n  flex: 0 0 auto;\n  height: 22px;\n  padding: 0 9px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 34%, transparent);\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-warn);\n  font-family: var(--ofs-font);\n  font-size: 11px;\n  line-height: 1;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-tuning-restore:hover {\n  border-color: color-mix(in oklab, var(--ofs-warn) 58%, transparent);\n  background: var(--ofs-warn-soft);\n}\n\n.ofs-tuning-restore:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n/* ── 分区 ───────────────────────────────────────────────────── */\n.ofs-fieldset {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 8px 0;\n}\n\n.ofs-fieldset:first-child {\n  padding-top: 2px;\n}\n\n.ofs-fieldset + .ofs-fieldset {\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-fieldset-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-fieldset-head h3 {\n  font-size: 12px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-2);\n}\n\n/* ── 提示词输入 ─────────────────────────────────────────────── */\n.ofs-composer {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 10px 10px 7px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: linear-gradient(180deg, var(--ofs-card-solid) 0%, var(--ofs-sunken) 100%);\n  transition:\n    border-color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-composer:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: 0 0 0 3px rgb(20 20 22 / 10%);\n}\n\n.ofs-composer-input {\n  width: 100%;\n  min-height: 60px;\n  resize: none;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 13px;\n  line-height: 1.62;\n}\n\n.ofs-composer-input:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-composer-input::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-composer-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-counter {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-text-action {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 3px 7px;\n  border: 0;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--ofs-accent);\n  font-size: 11.5px;\n  font-weight: 600;\n  cursor: pointer;\n  transition: background-color 150ms ease;\n}\n\n.ofs-text-action:hover:not(:disabled) {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-text-action:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* ── 建议 chips ─────────────────────────────────────────────── */\n/* 5 个灵感示例要在 330px 里排成一行：只用缩小内边距与间距换行，不缩小字号。 */\n.ofs-suggestions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-suggestion {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  max-width: 100%;\n  height: 24px;\n  padding: 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 11px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-suggestion:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-suggestion.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n}\n\n/* ── 润色建议 ───────────────────────────────────────────────── */\n.ofs-refine-head,\n.ofs-refine-dim {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-refine {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 9px 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-sunken);\n}\n\n.ofs-refine-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  color: var(--ofs-ink-2);\n  font-weight: 600;\n}\n\n/* 头部右侧：来源说明 + 收起/展开，弱化处理，不与标题抢层级。 */\n.ofs-refine-head-actions {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  min-width: 0;\n}\n\n.ofs-refine-toggle {\n  padding: 2px 4px;\n  font-size: 11px;\n  font-weight: 550;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-refine-toggle:hover:not(:disabled) {\n  color: var(--ofs-accent);\n}\n\n.ofs-refine-group {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n/* ── 画面比例 ───────────────────────────────────────────────── */\n.ofs-ratio-row {\n  display: flex;\n  gap: 8px;\n}\n\n.ofs-ratio {\n  appearance: none;\n  flex: 1 1 0;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 5px;\n  padding: 8px 0 7px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-3);\n  cursor: pointer;\n  transition:\n    border-color 160ms ease,\n    background-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-ratio:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink-2);\n}\n\n.ofs-ratio.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  box-shadow: 0 0 0 1px var(--ofs-accent);\n}\n\n.ofs-ratio-glyph {\n  display: block;\n  border: 1.5px solid currentColor;\n  border-radius: 3px;\n}\n\n.ofs-ratio-glyph--1-1 { width: 19px; height: 19px; }\n.ofs-ratio-glyph--16-9 { width: 25px; height: 14px; }\n.ofs-ratio-glyph--9-16 { width: 14px; height: 25px; }\n.ofs-ratio-glyph--4-3 { width: 22px; height: 17px; }\n.ofs-ratio-glyph--3-4 { width: 17px; height: 22px; }\n\n.ofs-ratio-label {\n  font-size: 11px;\n  font-weight: 550;\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 高级设置行 ─────────────────────────────────────────────── */\n.ofs-rows {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n}\n\n.ofs-row {\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-card);\n  overflow: hidden;\n  transition: border-color 160ms ease;\n}\n\n.ofs-row.is-open,\n.ofs-row:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-row-head {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 9px 12px;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n}\n\n.ofs-row-toggle {\n  appearance: none;\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-row-head:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-chevron {\n  display: grid;\n  place-items: center;\n  color: var(--ofs-ink-4);\n  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-chevron.is-open {\n  transform: rotate(180deg);\n}\n\n.ofs-row-textarea {\n  display: block;\n  width: calc(100% - 20px);\n  min-height: 64px;\n  margin: 0 10px 10px;\n  padding: 8px 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 10px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n  line-height: 1.55;\n  resize: vertical;\n}\n\n.ofs-grid2 {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n  padding: 0 10px 10px;\n}\n\n.ofs-field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.ofs-field > span {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-field-label {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n}\n\n/* 种子字段占满两列：输入框与「恢复随机」并排 */\n.ofs-field--wide {\n  grid-column: 1 / -1;\n}\n\n.ofs-seed-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.ofs-seed-row input {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.ofs-seed-reset {\n  flex: 0 0 auto;\n  padding: 2px 4px;\n  font-size: 11px;\n  font-weight: 550;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-seed-reset:hover:not(:disabled) {\n  color: var(--ofs-accent);\n}\n\n.ofs-field input,\n.ofs-field select,\n.ofs-size-custom-field input {\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 9px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n}\n\n.ofs-field input:focus-visible,\n.ofs-field select:focus-visible,\n.ofs-size-custom-field input:focus-visible {\n  outline: none;\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-focus-ring);\n}\n\n/* 步数按模型分治：连续滑块与档位刻度覆盖通用 .ofs-field input 盒子样式 */\n.ofs-step-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ofs-step-readout {\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--ofs-accent);\n}\n\n.ofs-step-readout.is-fixed {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-field input.ofs-step-slider {\n  height: 18px;\n  padding: 0;\n  border: none;\n  background: transparent;\n  box-shadow: none;\n  accent-color: var(--ofs-accent);\n  cursor: pointer;\n}\n\n.ofs-field input.ofs-step-slider:disabled {\n  opacity: 0.55;\n  cursor: default;\n}\n\n.ofs-step-ticks {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 4px;\n}\n\n.ofs-step-tick {\n  appearance: none;\n  padding: 2px 4px;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 500;\n  text-align: center;\n  cursor: pointer;\n  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;\n}\n\n.ofs-step-tick:hover {\n  color: var(--ofs-ink);\n  background: var(--ofs-card);\n}\n\n.ofs-step-tick.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  font-weight: 600;\n}\n\n/* ── 底部生成：张数分段 / 主按钮 / 规格摘要 ───────────────────── */\n.ofs-qty-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ofs-qty-label {\n  flex: 0 0 auto;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-qty {\n  flex: 1 1 auto;\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 4px;\n}\n\n.ofs-qty-option {\n  appearance: none;\n  height: 28px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: 9px;\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    background-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-qty-option:hover {\n  border-color: var(--ofs-accent-soft-border);\n  color: var(--ofs-ink);\n}\n\n.ofs-qty-option.is-on {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  box-shadow: inset 0 0 0 1px var(--ofs-accent);\n}\n\n/* 规格摘要：尺寸 · 比例 · 张数（有参考图补一项），等宽数字不抖动 */\n.ofs-spec-summary {\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  text-align: center;\n}\n\n/* ── 底部生成 ───────────────────────────────────────────────── */\n.ofs-panel-foot {\n  position: relative;\n  z-index: 1;\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 15px 12px;\n  border-top: 1px solid var(--ofs-hairline);\n  background: var(--ofs-card);\n  box-shadow: 0 -10px 16px -16px rgb(16 16 20 / 16%);\n}\n\n.ofs-generate {\n  position: relative;\n  overflow: hidden;\n  width: 100%;\n  height: 42px;\n  border-radius: 14px;\n  font-size: 13.5px;\n  letter-spacing: 0.02em;\n}\n\n/* 主操作上的一道扫光：光从相纸表面扫过去，只出现在悬停与提交中 */\n.ofs-generate::after {\n  content: '';\n  position: absolute;\n  inset: -34% -40%;\n  background: linear-gradient(102deg, transparent 42%, rgb(255 255 255 / 17%) 50%, transparent 58%);\n  opacity: 0;\n  transform: translateX(-72%);\n  pointer-events: none;\n}\n\n.ofs-generate:hover:not(:disabled)::after {\n  animation: ofs-light-sweep 820ms cubic-bezier(0.3, 0.8, 0.35, 1) 1;\n}\n\n.ofs-generate.is-busy::after {\n  animation: ofs-light-sweep 2600ms cubic-bezier(0.45, 0, 0.55, 1) infinite;\n}\n\n@keyframes ofs-light-sweep {\n  from {\n    opacity: 0;\n    transform: translateX(-72%);\n  }\n  16% {\n    opacity: 1;\n  }\n  to {\n    opacity: 0;\n    transform: translateX(72%);\n  }\n}\n\n.ofs-hint {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  text-align: center;\n}\n\n/* ── 提示词动作（英译 / 润色并列，实心操作仍只有底部生成） ─────── */\n.ofs-composer-actions {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n}\n\n/* 英译是次级动作：默认用静色，悬停或含中文建议翻译时提到强调色，不另占一行说明。 */\n.ofs-translate-action {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-translate-action.is-suggested {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-translate-action:hover:not(:disabled) {\n  color: var(--ofs-accent);\n}\n\n/* ── 画面设置：画幅比例 / 自定义宽高两段同构 ───────────────────── */\n.ofs-frame-group {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.ofs-frame-label {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n/* 标题栏右侧的实时读数：等宽数字，位数变化时不左右跳动 */\n.ofs-frame-readout {\n  flex: 0 0 auto;\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n/* 高级设置折叠态的读数摘要：一眼看清将用什么参数生成 */\n.ofs-row-readout {\n  flex: 0 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n/* 紧凑一行两列：宽 [1024] × 高 [1024]（不复用带卡片内边距的 .ofs-grid2） */\n.ofs-size-custom {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-size-custom-field {\n  display: flex;\n  flex: 1 1 0;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.ofs-size-custom-field > span {\n  flex: 0 0 auto;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-size-custom-field input {\n  flex: 1 1 auto;\n  min-width: 0;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-size-custom-times {\n  flex: 0 0 auto;\n  color: var(--ofs-ink-4);\n  font-size: 11px;\n}\n\n/* ── 自定义宽高（默认折叠，按需展开精调） ────────────────────── */\n.ofs-custom-toggle {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-custom-toggle:hover {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-custom-body {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding-top: 2px;\n}\n\n.ofs-link {\n  appearance: none;\n  margin-left: 6px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-accent);\n  font-size: inherit;\n  cursor: pointer;\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}\n\n/* 主表单模型卡：专用局部重绘预设标记为「仅图片工具」且不可选（决策 D3）。\n * 样式放在面板样式表里，不占 model-picker.css（主表单容器随面板一起加载）。 */\n.ofs-model-option[aria-disabled='true'] {\n  opacity: 0.55;\n  cursor: default;\n}\n\n.ofs-model-option[aria-disabled='true']:hover {\n  border-color: var(--ofs-sunken-border);\n}\n\n.ofs-model-lang.is-tool-only {\n  border-color: var(--ofs-warn-border, #e6c9a8);\n  background: var(--ofs-warn-soft, #f7f0e4);\n  color: var(--ofs-warn, #a96a18);\n}\n\n/* ── 矮窗口（≤ 860px 高）─────────────────────────────────────────\n * 面板高度被压缩时按一档收紧内部留白与控件高度，让「高级设置」这一行仍然完整落在\n * 可视区（1440×800 / 1280×800 等笔记本窗口）。只改高度相关的间距，不改字号。 */\n@media (max-height: 860px) {\n  .ofs-panel-head {\n    padding: 9px 14px 6px;\n  }\n\n  .ofs-fieldset {\n    padding: 5px 0;\n  }\n\n  .ofs-composer-input {\n    min-height: 48px;\n  }\n\n  .ofs-ratio {\n    padding: 5px 0 4px;\n  }\n\n  .ofs-panel-scroll {\n    padding-bottom: 8px;\n  }\n\n  .ofs-qty-option {\n    height: 26px;\n  }\n\n  .ofs-panel-foot {\n    gap: 3px;\n    padding: 7px 15px 8px;\n  }\n\n  .ofs-generate {\n    height: 40px;\n  }\n}\n\n/* ── 原生参考图槽（阶段十五 Phase C2） ──────────────────────────────\n * 参考图小节外再包一层 .ofs-ref-zone 作为拖放目标：内层 Fieldset 仍沿用左栏分区的\n * 标题行与分隔线，拖拽悬停时只给外框一个轻底色。 */\n.ofs-ref-zone .ofs-fieldset {\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-ref-zone + .ofs-fieldset {\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-ref-zone.is-dragging {\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-ref-zone.is-dragging .ofs-fieldset {\n  border-top-color: transparent;\n}\n\n.ofs-ref-count {\n  color: var(--ofs-ink-4);\n  font-size: 10.5px;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-ref-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.ofs-ref-item {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  overflow: hidden;\n  background: var(--ofs-sunken);\n}\n\n.ofs-ref-thumb {\n  display: block;\n  width: 100%;\n  aspect-ratio: 1;\n  object-fit: cover;\n  background: var(--ofs-sunken);\n}\n\n.ofs-ref-remove {\n  appearance: none;\n  position: absolute;\n  top: 3px;\n  right: 3px;\n  display: grid;\n  place-items: center;\n  width: 22px;\n  height: 22px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 84%, transparent);\n  color: var(--ofs-ink-2);\n  cursor: pointer;\n  transition:\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n/* 触控热区扩到 44px：视觉只占 22px，避免压住缩略图。 */\n.ofs-ref-remove::after {\n  content: '';\n  position: absolute;\n  inset: -11px;\n}\n\n.ofs-ref-remove:hover {\n  color: var(--ofs-error);\n}\n\n.ofs-ref-remove:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-ref-name {\n  padding: 3px 6px 4px;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.3;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-ref-add,\n.ofs-ref-more {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  width: 100%;\n  min-height: 44px;\n  padding: 0 10px;\n  border: 1px dashed var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-md);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-family: var(--ofs-font);\n  font-size: 11.5px;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-ref-add:hover,\n.ofs-ref-more:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-ref-add:focus-visible,\n.ofs-ref-more:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-ref-add:disabled,\n.ofs-ref-more:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n.ofs-ref-more {\n  min-height: 32px;\n}\n\n.ofs-ref-pick {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.ofs-ref-pick-toggle {\n  align-self: flex-start;\n}\n\n.ofs-ref-works {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 5px;\n}\n\n.ofs-ref-work {\n  appearance: none;\n  min-height: 44px;\n  padding: 0;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  overflow: hidden;\n  background: var(--ofs-sunken);\n  cursor: pointer;\n}\n\n.ofs-ref-work img {\n  display: block;\n  width: 100%;\n  aspect-ratio: 1;\n  object-fit: cover;\n}\n\n.ofs-ref-work:hover {\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-ref-work:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n/* 不支持原生参考时的降级引导：琥珀色说明 + 「换模型 / 改用整图重绘」两个动作。 */\n.ofs-ref-warn {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  padding: 8px 9px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 30%, transparent);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-warn-soft);\n}\n\n.ofs-ref-warn-title {\n  color: var(--ofs-warn);\n  font-size: 11.5px;\n  font-weight: 600;\n}\n\n.ofs-ref-warn .ofs-hint {\n  color: var(--ofs-ink-2);\n}\n\n.ofs-ref-warn-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-ref-switch,\n.ofs-ref-fallback {\n  appearance: none;\n  min-height: 30px;\n  padding: 0 10px;\n  border: 1px solid color-mix(in oklab, var(--ofs-warn) 32%, transparent);\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-warn);\n  font-family: var(--ofs-font);\n  font-size: 11px;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-ref-switch:hover,\n.ofs-ref-fallback:hover {\n  border-color: color-mix(in oklab, var(--ofs-warn) 55%, transparent);\n  background: color-mix(in oklab, var(--ofs-warn-soft) 70%, transparent);\n}\n\n.ofs-ref-switch:focus-visible,\n.ofs-ref-fallback:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-ref-busy {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-ref-busy .ofs-shimmer {\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n}\n\n.ofs-ref-quality {\n  color: var(--ofs-ink-4);\n}";

// src/styles/stage.css
var stage_default = '/*\n * 画面预览：光桌上的相纸。\n *\n * 舞台（.ofs-figure）不是又一张白卡，而是一张下凹的光桌：中性灰表面、顶部一层\n * 柔光、发丝描边、内阴影。图落在桌上时是一张相纸（11px 纸边 + 偏移柔影），\n * 等待出图时桌上只有一只按当前比例画出的取景框和四角裁切标记。\n *\n * 相纸与取景框的尺寸都用容器单位算（cqw / cqh），因为「按比例装进剩余空间」\n * 用百分比 + aspect-ratio 在非替换元素上收不回宽度（实测 1:1 会变成 526×326）。\n *\n * 深色值在 tokens.css 与 tools/preview.mjs 的 DARK_TOKENS 里各有一份，改要同步。\n */\n\n.ofs-stage {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n/* figure 是浏览器默认带 1em 40px 外边距的元素；舞台的尺寸完全由容器单位算，\n   这条外边距会让「出图后」的相纸比「空态取景框」小一圈，必须归零。 */\n.ofs-figure {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-xl);\n  background:\n    radial-gradient(76% 58% at 50% 34%, var(--ofs-mat-lit) 0%, transparent 72%),\n    var(--ofs-mat);\n  box-shadow: var(--ofs-mat-inner);\n  overflow: hidden;\n  /* 相纸 / 取景框的容器查询基准：cqw 是这块光桌的内容盒宽度 */\n  container-type: size;\n}\n\n/* ── 相纸 ───────────────────────────────────────────────────── */\n.ofs-print {\n  appearance: none;\n  display: block;\n  /* 比例来自远端下发的图片像素；环形纸边靠阴影画，不占布局 */\n  width: min(calc(100cqw - 44px), calc((100cqh - 44px) * var(--ofs-print-r, 1)));\n  aspect-ratio: var(--ofs-print-r, 1);\n  padding: 0;\n  border: 0;\n  border-radius: 3px;\n  background: var(--ofs-print-paper);\n  box-shadow:\n    0 0 0 11px var(--ofs-print-paper),\n    0 0 0 12px var(--ofs-print-edge),\n    var(--ofs-print-shadow);\n  cursor: zoom-in;\n  transition:\n    box-shadow 220ms ease,\n    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-print:hover {\n  box-shadow:\n    0 0 0 11px var(--ofs-print-paper),\n    0 0 0 12px var(--ofs-print-edge),\n    var(--ofs-print-shadow-hover);\n  transform: translateY(-2px);\n}\n\n.ofs-print:focus-visible {\n  outline: none;\n  box-shadow:\n    0 0 0 11px var(--ofs-print-paper),\n    0 0 0 14px var(--ofs-accent),\n    var(--ofs-print-shadow);\n}\n\n.ofs-image {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  border-radius: 3px;\n}\n\n/*\n * 落定：新出的图从潜影显到清晰，只播一次。\n * fill-mode 用 backwards——结束时回到基础样式，悬停抬升才不会被动画终帧钉住。\n */\n.ofs-print.is-developing {\n  animation: ofs-paper-settle 720ms cubic-bezier(0.22, 1, 0.36, 1) backwards;\n}\n\n.ofs-print.is-developing .ofs-image {\n  animation: ofs-develop 760ms cubic-bezier(0.3, 0.9, 0.3, 1) backwards;\n}\n\n@keyframes ofs-paper-settle {\n  from {\n    opacity: 0.42;\n    transform: translateY(10px) scale(0.99);\n  }\n  55% {\n    opacity: 1;\n  }\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@keyframes ofs-develop {\n  from {\n    filter: blur(18px) grayscale(1) contrast(0.5) brightness(1.22);\n  }\n  55% {\n    filter: blur(7px) grayscale(0.75) contrast(0.82) brightness(1.08);\n  }\n  to {\n    filter: none;\n  }\n}\n\n/* ── 浮动工具 ───────────────────────────────────────────────── */\n/* 工具组贴住相纸自身的右上角（而不是光桌角）：任何画幅下都不会骑在纸边上下不来。 */\n.ofs-print-slot {\n  position: relative;\n  display: flex;\n  flex: 0 0 auto;\n  max-width: 100%;\n}\n\n.ofs-figure-tools {\n  position: absolute;\n  top: 10px;\n  right: 10px;\n  z-index: 2;\n  display: flex;\n  gap: 6px;\n}\n\n.ofs-glass-btn {\n  appearance: none;\n  display: grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: 11px;\n  background: color-mix(in oklab, var(--ofs-card-solid) 68%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  color: var(--ofs-ink-2);\n  cursor: pointer;\n  transition:\n    color 150ms ease,\n    background-color 150ms ease,\n    border-color 150ms ease,\n    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-glass-btn:hover {\n  color: var(--ofs-accent);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n.ofs-glass-btn:active {\n  transform: scale(0.95);\n}\n\n.ofs-glass-btn.is-on {\n  color: var(--ofs-accent);\n  background: var(--ofs-accent-soft);\n  border-color: var(--ofs-accent-soft-border);\n}\n\n/* ── 等待出图：一只按比例画出的取景框 ───────────────────────── */\n/*\n * 空态与等待出图时，桌上是一张还没曝光的空白相纸：比例跟当前画幅走，\n * 出图时同一位置换成显影完成的相纸——所以纸边、投影与 .ofs-print 同一套材质。\n * 外框负责按比例定尺寸（裁切标记贴它的四角），内框负责裁掉溢出的内容。\n */\n.ofs-frame {\n  position: relative;\n  width: min(calc(100cqw - 44px), calc((100cqh - 44px) * var(--ofs-frame-r, 1)));\n  aspect-ratio: var(--ofs-frame-r, 1);\n  border-radius: 3px;\n  background: var(--ofs-print-paper);\n  box-shadow:\n    0 0 0 1px var(--ofs-print-edge),\n    var(--ofs-print-shadow);\n  animation: ofs-frame-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards;\n}\n\n.ofs-frame-body {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  padding: 20px 22px;\n  border-radius: 3px;\n  overflow: hidden;\n}\n\n@keyframes ofs-frame-in {\n  from {\n    opacity: 0;\n    transform: scale(0.994);\n  }\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n/* 四角裁切标记：纸上要被框住的那块区域 */\n.ofs-marks {\n  position: absolute;\n  inset: -12px;\n  pointer-events: none;\n}\n\n.ofs-marks span {\n  position: absolute;\n  width: 15px;\n  height: 15px;\n  border: 0 solid var(--ofs-mark);\n}\n\n.ofs-marks span:nth-child(1) {\n  top: 0;\n  left: 0;\n  border-top-width: 1px;\n  border-left-width: 1px;\n}\n\n.ofs-marks span:nth-child(2) {\n  top: 0;\n  right: 0;\n  border-top-width: 1px;\n  border-right-width: 1px;\n}\n\n.ofs-marks span:nth-child(3) {\n  bottom: 0;\n  left: 0;\n  border-bottom-width: 1px;\n  border-left-width: 1px;\n}\n\n.ofs-marks span:nth-child(4) {\n  bottom: 0;\n  right: 0;\n  border-bottom-width: 1px;\n  border-right-width: 1px;\n}\n\n/* ── 进度胶囊 ───────────────────────────────────────────────── */\n.ofs-stage-progress {\n  position: absolute;\n  left: 50%;\n  bottom: 16px;\n  z-index: 2;\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding: 7px 13px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 74%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  transform: translateX(-50%);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  white-space: nowrap;\n}\n\n.ofs-progress-label {\n  font-variant-numeric: tabular-nums;\n}\n\n/* 还没有图时，胶囊落在这只空取景框的正中：像正在曝光的那一格。 */\n.ofs-stage-progress.is-inside {\n  bottom: 50%;\n  transform: translate(-50%, 50%);\n}\n\n/* 取景框里已有引导文案时，胶囊排进文案流里（标题 → 说明 → 进度），不再浮层压字。 */\n.ofs-stage-progress.is-flow {\n  position: static;\n  margin-top: 3px;\n  transform: none;\n}\n\n.ofs-shimmer {\n  display: block;\n  width: 54px;\n  height: 4px;\n  border-radius: var(--ofs-r-pill);\n  background: linear-gradient(\n    90deg,\n    transparent 0%,\n    color-mix(in oklab, var(--ofs-accent) 70%, transparent) 50%,\n    transparent 100%\n  );\n  background-size: 220% 100%;\n  animation: ofs-shimmer 1.5s linear infinite;\n}\n\n/* ── 图片下的信息与动作 ─────────────────────────────────────── */\n.ofs-stage-foot {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 0 4px;\n  min-width: 0;\n}\n\n.ofs-stage-prompt {\n  flex: 1 1 auto;\n  min-width: 0;\n  font-size: 12px;\n  color: var(--ofs-ink-2);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n/* 题注按印相室的标签写：小一号、拉开字距、齐宽数字 */\n.ofs-stage-meta {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  font-weight: 500;\n  letter-spacing: 0.07em;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.ofs-dock {\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-dock-button {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 30px;\n  padding: 0 11px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 78%, transparent);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  font-weight: 500;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-dock-button:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-dock-button.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* 续绘闭环的主入口：以此结果继续重绘，强调一档但不抢生成按钮。 */\n/* ── 空态 ───────────────────────────────────────────────────── */\n.ofs-figure--empty {\n  background:\n    radial-gradient(64% 54% at 50% 40%, var(--ofs-mat-lit) 0%, transparent 76%),\n    var(--ofs-mat);\n}\n\n.ofs-empty-card {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 9px;\n  width: 100%;\n  max-width: 400px;\n  text-align: center;\n}\n\n.ofs-empty-title {\n  font-size: 16px;\n  font-weight: 650;\n  letter-spacing: 0.01em;\n}\n\n.ofs-examples {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: center;\n  gap: 6px;\n  margin-top: 4px;\n}\n\n.ofs-examples-label {\n  width: 100%;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-example {\n  appearance: none;\n  padding: 5px 11px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-example:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* 曝光单：这条桌子上的机器大概多久出一张，先给个准话。\n   它落在纸面下沿的留白里（像印相纸边的标注），不再和居中引导文案挤成一团。 */\n.ofs-exposure {\n  position: absolute;\n  left: 44px;\n  right: 44px;\n  bottom: 34px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin: 0;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  letter-spacing: 0.04em;\n  white-space: nowrap;\n}\n\n.ofs-exposure-rule {\n  flex: 1 1 auto;\n  height: 1px;\n  background: var(--ofs-mark);\n}\n\n/*\n * 纸上的辅助文字：纸面比卡片亮一档，固定用 ink-3 在深色下只有 4.3:1。\n * 这里按墨色与纸色混合取一档「纸面次级文字色」，浅深两套主题各自都 ≥ 4.5:1。\n */\n.ofs-frame .ofs-muted,\n.ofs-frame .ofs-examples-label,\n.ofs-frame .ofs-exposure {\n  color: color-mix(in oklab, var(--ofs-ink) 62%, var(--ofs-print-paper));\n}\n\n/* ── 放大层 ─────────────────────────────────────────────────── */\n.ofs-lightbox {\n  position: absolute;\n  inset: -14px;\n  z-index: 80;\n  display: grid;\n  place-items: center;\n  padding: 3vw;\n  background: rgb(16 16 18 / 72%);\n  backdrop-filter: blur(16px);\n  -webkit-backdrop-filter: blur(16px);\n  animation: ofs-fade-in 180ms ease;\n}\n\n.ofs-lightbox img {\n  max-width: 94%;\n  max-height: 92%;\n  border-radius: 12px;\n  box-shadow: 0 40px 90px -30px rgb(0 0 0 / 70%);\n}\n\n.ofs-lightbox-close {\n  position: absolute;\n  top: 18px;\n  right: 18px;\n  display: grid;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  border: 1px solid rgb(255 255 255 / 26%);\n  border-radius: 11px;\n  background: rgb(255 255 255 / 12%);\n  color: rgb(255 255 255 / 88%);\n  cursor: pointer;\n}\n\n.ofs-lightbox-close:hover {\n  background: rgb(255 255 255 / 20%);\n  color: #fff;\n}\n\n/* 大图预览底部的主操作：以此为参考图重绘 */\n.ofs-lightbox-action {\n  position: absolute;\n  bottom: 26px;\n  left: 50%;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 36px;\n  padding: 0 16px;\n  border: 1px solid rgb(255 255 255 / 30%);\n  border-radius: var(--ofs-r-pill);\n  background: rgb(20 20 22 / 66%);\n  color: #fff;\n  font-size: 12.5px;\n  font-weight: 600;\n  cursor: pointer;\n  transform: translateX(-50%);\n  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n}\n\n.ofs-lightbox-action:hover {\n  background: rgb(20 20 22 / 84%);\n}\n\n/* ── 局部重绘：涂抹蒙版 ─────────────────────────────────────── */\n/*\n * 极简光桌布局：\n *  - 光桌内绝大部分空间留给画布本身（与正常预览 .ofs-print 近乎等大），不因表单挤压缩小；\n *  - 左上角轻胶囊显示「局部重绘 · 已涂抹 X%」，右上角 `?` 胶囊悬停展开操作提示；\n *  - 画布正下方紧贴一条紧凑毛玻璃画笔胶囊；提交控件统一落在光桌外下方的 .ofs-tool-bar。\n */\n.ofs-mask-editor {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 10px;\n  width: 100%;\n  height: 100%;\n  padding: 12px 14px 10px;\n  overflow: hidden;\n}\n\n.ofs-mask-head {\n  position: absolute;\n  top: 12px;\n  left: 14px;\n  z-index: 5;\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 5px 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 86%, transparent);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  box-shadow: var(--ofs-shadow-card);\n  pointer-events: none;\n}\n\n.ofs-mask-title {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: var(--ofs-ink);\n}\n\n.ofs-mask-coverage {\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-mask-zoom {\n  appearance: none;\n  pointer-events: auto;\n  padding: 1px 7px;\n  border: 1px solid var(--ofs-accent-soft-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  font-size: 10.5px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n  cursor: pointer;\n}\n\n.ofs-mask-zoom:hover {\n  border-color: var(--ofs-accent);\n}\n\n/* 右上角提示胶囊：平时只占一个圆按钮，hover / 键盘聚焦时向下展开说明浮层。 */\n.ofs-mask-help {\n  position: absolute;\n  top: 12px;\n  right: 14px;\n  z-index: 6;\n}\n\n.ofs-mask-help-btn {\n  position: relative;\n  font-size: 13px;\n  font-weight: 650;\n}\n\n.ofs-mask-help.is-warn .ofs-mask-help-btn::after {\n  content: "";\n  position: absolute;\n  top: 5px;\n  right: 5px;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ofs-warn, #b45309);\n}\n\n.ofs-mask-tips {\n  position: absolute;\n  top: calc(100% + 6px);\n  right: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  width: min(320px, 72vw);\n  padding: 10px 12px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-md);\n  background: color-mix(in oklab, var(--ofs-card-solid) 96%, transparent);\n  box-shadow: var(--ofs-shadow-lift);\n  opacity: 0;\n  pointer-events: none;\n  transform: translateY(-4px);\n  transition:\n    opacity 150ms ease,\n    transform 150ms ease;\n}\n\n.ofs-mask-help:hover .ofs-mask-tips,\n.ofs-mask-help:focus-within .ofs-mask-tips {\n  opacity: 1;\n  pointer-events: auto;\n  transform: translateY(0);\n}\n\n.ofs-mask-shortcuts {\n  margin-top: 4px;\n  padding-top: 6px;\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-mask-shortcuts-title {\n  display: block;\n  margin-bottom: 4px;\n  font-size: 10.5px;\n  font-weight: 600;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-mask-shortcuts-list {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 3px 10px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n/* 缩放与平移裁切视口：占满工具胶囊之上的全部光桌，防止放大后的画布遮挡底部工具条。 */\n.ofs-mask-viewport {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  overflow: hidden;\n  container-type: size;\n}\n\n/*\n * 画布外框：按 .ofs-mask-viewport 的宽高自适应到最大尺寸（不再受 560px 限制）。\n */\n.ofs-mask-stage {\n  position: relative;\n  flex: 0 0 auto;\n  width: min(\n    calc(100cqw - 28px),\n    max(160px, calc((100cqh - 22px) * var(--ofs-mask-r, 1)))\n  );\n  aspect-ratio: var(--ofs-mask-r, 1);\n  border-radius: 4px;\n  overflow: hidden;\n  background: #000;\n  transform-origin: center center;\n  box-shadow:\n    0 0 0 8px var(--ofs-print-paper),\n    0 0 0 9px var(--ofs-print-edge),\n    var(--ofs-print-shadow);\n}\n\n.ofs-mask-stage.is-panning .ofs-mask-canvas {\n  cursor: grab;\n}\n\n.ofs-mask-stage.is-panning-active .ofs-mask-canvas {\n  cursor: grabbing;\n}\n\n/* 参考图按 fill 铺满画布：导出的蒙版与参考图同比例，这里不能留 contain 的边。 */\n.ofs-mask-photo {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  object-fit: fill;\n  user-select: none;\n}\n\n/* 蒙版层是透明底白色笔迹，叠在参考图上用 screen 混色只提亮涂过的地方。 */\n.ofs-mask-canvas {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  touch-action: none;\n  cursor: crosshair;\n  mix-blend-mode: screen;\n  opacity: 0.85;\n}\n\n/* 画笔光标圈：left / top / width / height 由指针或键盘移动时直接写内联样式。 */\n.ofs-mask-cursor {\n  position: absolute;\n  border: 1px solid var(--ofs-accent);\n  border-radius: 50%;\n  transform: translate(-50%, -50%);\n  pointer-events: none;\n  display: none;\n}\n\n/* 画笔工具条：紧贴画布下方的圆角毛玻璃胶囊，不抢画面；在常见窗口宽度下尽量保持单行。 */\n.ofs-mask-tools {\n  flex: 0 0 auto;\n  display: inline-flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: center;\n  gap: 2px;\n  max-width: 100%;\n  padding: 2px 6px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 92%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-mask-tools .ofs-dock-button {\n  padding: 0 9px;\n  border-color: transparent;\n  background: transparent;\n  box-shadow: none;\n}\n\n.ofs-mask-tools .ofs-dock-button:hover {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-mask-tools .ofs-dock-button.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n}\n\n/* 画笔大小：滑块与工具栏同高、宽度紧凑，拖动时不带着整行抖动。 */\n.ofs-mask-brush {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 44px;\n  padding: 0 6px 0 6px;\n  font-size: 11.5px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-mask-brush b {\n  min-width: 18px;\n  font-variant-numeric: tabular-nums;\n  text-align: right;\n}\n\n.ofs-mask-range {\n  width: 64px;\n  height: 44px;\n  accent-color: var(--ofs-accent);\n}\n\n.ofs-mask-hint,\n.ofs-mask-warn {\n  margin: 0;\n  text-align: left;\n}\n\n.ofs-mask-guide,\n.ofs-mask-fast {\n  margin: 0;\n  line-height: 1.5;\n  text-align: left;\n}\n\n.ofs-mask-fast {\n  color: var(--ofs-warn, #b45309);\n}\n\n/* ── 图片工具：动作坞分组 ─────────────────────────────────────── */\n.ofs-dock-group {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.ofs-dock-group[data-group=\'reuse\'] {\n  margin-left: auto;\n}\n\n/* 草稿恢复：继续编辑是编辑态之外的唯一入口，强调一档并用灰色小字标出改动摘要。 */\n.ofs-dock-resume,\n.ofs-dock-close {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-dock-draft {\n  padding-left: 2px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 图片工具：舞台下方单行紧凑提交条 ──────────────────────────── */\n/*\n * 局部涂抹画布与整图重绘条共用这一条，直接落在光桌下方替代动作坞，\n * 不占光桌内部高度。主行单行横排，窄屏温和换行；覆盖率 / 拦截状态收在下方细注。\n */\n.ofs-tool-bar {\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  width: 100%;\n  padding: 8px 10px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: color-mix(in oklab, var(--ofs-card) 90%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-tool-row {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n}\n\n.ofs-tool-bar-head {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-tool-name {\n  display: none;\n}\n\n.ofs-tool-preset {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-tool-preset-label {\n  display: none;\n}\n\n.ofs-tool-preset-name {\n  max-width: 150px;\n  overflow: hidden;\n  padding: 0 8px;\n  height: 34px;\n  line-height: 32px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  background: var(--ofs-sunken);\n  font-size: 11.5px;\n  color: var(--ofs-ink-2);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-tool-select {\n  max-width: 138px;\n  height: 34px;\n  padding: 0 8px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.ofs-tool-prompt {\n  flex: 1 1 120px;\n  display: flex;\n  align-items: center;\n  min-width: 0;\n}\n\n.ofs-tool-label {\n  flex: 0 0 auto;\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-tool-prompt .ofs-tool-label {\n  display: none;\n}\n\n.ofs-tool-prompt-input {\n  width: 100%;\n  height: 34px;\n  min-height: 34px;\n  max-height: 76px;\n  padding: 7px 10px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font: inherit;\n  font-size: 12.5px;\n  line-height: 1.4;\n  resize: none;\n}\n\n.ofs-tool-prompt-input::placeholder {\n  color: var(--ofs-ink-4);\n}\n\n.ofs-tool-prompt-input:focus-visible {\n  border-color: transparent;\n  outline: 2px solid var(--ofs-accent);\n  outline-offset: 1px;\n}\n\n.ofs-tool-strength {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 0 7px;\n  height: 34px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-sm);\n  background: var(--ofs-sunken);\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-tool-range {\n  width: 60px;\n  height: 24px;\n  accent-color: var(--ofs-accent);\n}\n\n.ofs-tool-readout {\n  min-width: 30px;\n  color: var(--ofs-ink);\n  font-size: 11.5px;\n  font-variant-numeric: tabular-nums;\n  text-align: right;\n}\n\n.ofs-tool-actions {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ofs-tool-submit {\n  height: 34px;\n  padding: 0 16px;\n  border-radius: var(--ofs-r-sm);\n}\n\n.ofs-tool-exit {\n  height: 34px;\n  padding: 0 12px;\n  border-radius: var(--ofs-r-sm);\n  border-color: color-mix(in oklab, var(--ofs-error) 34%, transparent);\n  background: var(--ofs-error-soft);\n  color: var(--ofs-error);\n}\n\n.ofs-tool-exit:hover:not(:disabled) {\n  border-color: var(--ofs-error);\n  background: color-mix(in oklab, var(--ofs-error) 14%, transparent);\n  color: var(--ofs-error);\n}\n\n.ofs-tool-meta {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 0 2px;\n}\n\n.ofs-tool-mask,\n.ofs-tool-blocked {\n  margin: 0;\n  text-align: left;\n  font-size: 11px;\n}\n\n.ofs-tool-blocked {\n  color: var(--ofs-warn, #b45309);\n}\n\n/* ── 图片工具：整图重绘条 ─────────────────────────────────────── */\n/*\n * 不切画布：上方沿用光桌质感与 .ofs-print 的容器单位尺寸，\n * 下方接同一条单行提交栏。\n */\n.ofs-inline-tool {\n  flex: 1 1 auto;\n  display: flex;\n  flex-direction: column;\n  align-items: stretch;\n  gap: 10px;\n  width: 100%;\n  min-height: 0;\n}\n\n.ofs-inline-stage {\n  position: relative;\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  min-height: 0;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-xl);\n  background:\n    radial-gradient(76% 58% at 50% 34%, var(--ofs-mat-lit) 0%, transparent 72%),\n    var(--ofs-mat);\n  box-shadow: var(--ofs-mat-inner);\n  overflow: hidden;\n  container-type: size;\n}\n\n/* 这是预览而不是可放大的相纸按钮：不显示缩放光标。 */\n.ofs-inline-stage .ofs-print {\n  cursor: default;\n}\n\n/* ── 阶段十三：显式新建绘图态（模糊动态背景 + 取景框）────────────────── */\n\n.ofs-figure--draft {\n  overflow: hidden;\n  background:\n    radial-gradient(70% 58% at 50% 42%, var(--ofs-mat-lit) 0%, transparent 74%),\n    var(--ofs-mat);\n}\n\n/* 背景是几团缓慢漂移的柔光，表达「画布还在酝酿」；取景框保持静止，不干扰阅读。 */\n.ofs-draft-backdrop {\n  position: absolute;\n  inset: -12%;\n  z-index: 0;\n  pointer-events: none;\n}\n\n.ofs-draft-backdrop span {\n  position: absolute;\n  display: block;\n  border-radius: 50%;\n  filter: blur(46px);\n  opacity: 0.5;\n  background: color-mix(in oklab, var(--ofs-ink) 16%, transparent);\n  animation: ofs-draft-drift 18s ease-in-out infinite alternate;\n}\n\n.ofs-draft-backdrop span:nth-child(1) {\n  top: 8%;\n  left: 12%;\n  width: 46%;\n  height: 42%;\n}\n\n.ofs-draft-backdrop span:nth-child(2) {\n  right: 6%;\n  bottom: 10%;\n  width: 42%;\n  height: 46%;\n  animation-delay: -6s;\n  animation-duration: 22s;\n  background: color-mix(in oklab, var(--ofs-ink) 11%, transparent);\n}\n\n.ofs-draft-backdrop span:nth-child(3) {\n  top: 34%;\n  left: 42%;\n  width: 34%;\n  height: 32%;\n  animation-delay: -12s;\n  animation-duration: 26s;\n  background: color-mix(in oklab, var(--ofs-ink) 8%, transparent);\n}\n\n@keyframes ofs-draft-drift {\n  0% {\n    transform: translate3d(0, 0, 0) scale(1);\n  }\n  50% {\n    transform: translate3d(3%, -2.5%, 0) scale(1.06);\n  }\n  100% {\n    transform: translate3d(-2.5%, 3%, 0) scale(0.97);\n  }\n}\n\n/* 取景框：虚线纸边 + 透明底，和空舞台的实心相纸区分开。 */\n.ofs-frame.ofs-frame--draft {\n  z-index: 1;\n  border: 1px dashed color-mix(in oklab, var(--ofs-ink) 22%, transparent);\n  background: color-mix(in oklab, var(--ofs-card-solid) 42%, transparent);\n  box-shadow: none;\n}\n\n.ofs-frame.ofs-frame--draft .ofs-frame-body {\n  background: transparent;\n}\n\n.ofs-draft-blank .ofs-empty-title {\n  color: var(--ofs-ink);\n}\n\n.ofs-draft-blank .ofs-muted {\n  color: var(--ofs-ink-3);\n}\n\n/* 阶段十五 A1：点草稿卡恢复后，取景框注明这份草稿的来源作品。 */\n.ofs-draft-source {\n  margin: 0;\n  max-width: 30ch;\n  overflow: hidden;\n  color: var(--ofs-warn);\n  font-size: 11px;\n  line-height: 1.5;\n  text-align: center;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* ── 扩图：扩张画布 + 比例胶囊 ───────────────────────────────── */\n/*\n * 与 MaskEditor 同一套光桌布局：顶部一条「标题 / 覆盖率 + 比例胶囊」，\n * 中间是可拖拽的扩张画布，底部一条紧凑胶囊放「回中」与操作提示。\n * 画布里的新增区域用斜纹半透明着色，内容框是虚线拖拽区（命中区 44px 起）。\n */\n.ofs-outpaint-editor {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 10px;\n  width: 100%;\n  height: 100%;\n  padding: 12px 14px 10px;\n  overflow: hidden;\n}\n\n.ofs-outpaint-top {\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n}\n\n.ofs-outpaint-head {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 5px 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 86%, transparent);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-outpaint-title {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: var(--ofs-ink);\n}\n\n.ofs-outpaint-coverage {\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-outpaint-ratios {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n}\n\n/* 比例胶囊：高度沿用工具栏 44px 触控热区，键盘 Tab 顺序即视觉顺序。 */\n.ofs-outpaint-ratio {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 44px;\n  padding: 0 14px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 78%, transparent);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  font-weight: 500;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-outpaint-ratio:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-outpaint-ratio.is-on {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-outpaint-viewport {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  overflow: hidden;\n  container-type: size;\n}\n\n/* 扩张后的画布：保持与导出 PNG 相同的宽高比，外圈沿用相纸装裱。 */\n.ofs-outpaint-stage {\n  position: relative;\n  flex: 0 0 auto;\n  width: min(\n    calc(100cqw - 28px),\n    max(160px, calc((100cqh - 22px) * var(--ofs-outpaint-r, 1)))\n  );\n  aspect-ratio: var(--ofs-outpaint-r, 1);\n  border-radius: 4px;\n  overflow: hidden;\n  background: #000;\n  touch-action: none;\n  box-shadow:\n    0 0 0 8px var(--ofs-print-paper),\n    0 0 0 9px var(--ofs-print-edge),\n    var(--ofs-print-shadow);\n}\n\n/* 预览层与内容框分层：预览整体是角色 img 的图形，内容框是独立的可操作控件。 */\n.ofs-outpaint-preview {\n  position: absolute;\n  inset: 0;\n}\n\n/* 原图按内容框铺满（导出时也是拉伸到同一矩形，预览与产出保持一致）。 */\n.ofs-outpaint-photo {\n  position: absolute;\n  object-fit: fill;\n  user-select: none;\n  pointer-events: none;\n}\n\n/* 新增区域着色：低透明度底色 + 斜纹，表达「这块会重新生成」。 */\n.ofs-outpaint-shade {\n  position: absolute;\n  pointer-events: none;\n  background-color: color-mix(in oklab, var(--ofs-accent) 20%, transparent);\n  background-image: repeating-linear-gradient(\n    45deg,\n    color-mix(in oklab, var(--ofs-accent) 30%, transparent) 0 6px,\n    transparent 6px 12px\n  );\n}\n\n/* 内容框：虚线 + 居中抓手，pointer capture 拖拽；最小 44px 保证触控热区。 */\n.ofs-outpaint-content {\n  position: absolute;\n  appearance: none;\n  min-width: 44px;\n  min-height: 44px;\n  padding: 0;\n  border: 1px dashed color-mix(in oklab, #fff 76%, transparent);\n  border-radius: 2px;\n  background: transparent;\n  cursor: grab;\n  touch-action: none;\n}\n\n.ofs-outpaint-content:active {\n  cursor: grabbing;\n}\n\n.ofs-outpaint-content:focus-visible {\n  outline: 2px solid var(--ofs-accent);\n  outline-offset: 2px;\n}\n\n.ofs-outpaint-grip {\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  display: block;\n  width: 34px;\n  height: 34px;\n  border: 1px solid rgb(255 255 255 / 55%);\n  border-radius: 50%;\n  background: rgb(20 20 22 / 48%);\n  transform: translate(-50%, -50%);\n  pointer-events: none;\n}\n\n.ofs-outpaint-grip::after {\n  content: "";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  background: rgb(255 255 255 / 74%);\n  transform: translate(-50%, -50%);\n}\n\n/* 底部工具胶囊：紧贴画布下方，与 MaskEditor 的工具栏视觉一致。 */\n.ofs-outpaint-tools {\n  flex: 0 0 auto;\n  display: inline-flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  max-width: 100%;\n  padding: 2px 8px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card) 92%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-outpaint-tools .ofs-dock-button {\n  padding: 0 9px;\n  border-color: transparent;\n  background: transparent;\n  box-shadow: none;\n}\n\n.ofs-outpaint-tools .ofs-dock-button:hover {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-outpaint-hint {\n  margin: 0;\n  font-size: 11px;\n  text-align: left;\n}\n\n.ofs-outpaint-empty {\n  margin: 0;\n}\n\n.ofs-outpaint-warn {\n  margin: 0;\n  color: var(--ofs-warn, #b45309);\n  font-size: 11px;\n  text-align: left;\n}\n\n@media (max-width: 720px) {\n  .ofs-outpaint-top {\n    flex-direction: column;\n    align-items: stretch;\n  }\n\n  .ofs-outpaint-ratios {\n    justify-content: flex-start;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-draft-backdrop span {\n    animation: none;\n  }\n}\n';

// src/styles/filmstrip.css
var filmstrip_default = '/*\n * 底部最近生成栏：悬浮玻璃条，左边是批次缩略图流，右边去画廊。\n */\n\n.ofs-filmstrip {\n  position: relative;\n  z-index: 10;\n  isolation: isolate;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin: 0 14px 14px;\n  padding: 4px 12px 10px;\n  min-height: 92px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n/* 毛玻璃背景放进 ::before 伪元素：避免 .ofs-filmstrip 自身带有 backdrop-filter\n   创建新的 containing block，从而让内部版本面板的 position: fixed 严格按视口定位。 */\n.ofs-filmstrip::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  border-radius: inherit;\n  background: color-mix(in oklab, var(--ofs-card) 78%, transparent);\n  backdrop-filter: blur(18px);\n  -webkit-backdrop-filter: blur(18px);\n  pointer-events: none;\n}\n\n.ofs-roll {\n  flex: 1 1 auto;\n  min-width: 0;\n  display: flex;\n  align-items: stretch;\n  gap: 16px;\n  overflow-x: auto;\n  overflow-y: hidden;\n  /* 预留上/左内边距，保证 top: -6px 的版本角标与草稿圆点不被滚动容器边缘裁剪。 */\n  padding: 8px 6px 2px;\n}\n\n.ofs-batch {\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n\n.ofs-batch-thumbs {\n  display: flex;\n  gap: 3px;\n}\n\n.ofs-thumb {\n  appearance: none;\n  flex: 0 0 auto;\n  display: block;\n  width: 62px;\n  height: 62px;\n  padding: 0;\n  border: 2px solid transparent;\n  border-radius: 12px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  cursor: pointer;\n  transition:\n    transform 170ms cubic-bezier(0.22, 1, 0.36, 1),\n    border-color 170ms ease,\n    box-shadow 170ms ease;\n}\n\n.ofs-thumb img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ofs-thumb:hover {\n  transform: translateY(-2px);\n}\n\n.ofs-thumb.is-on {\n  border-color: var(--ofs-accent);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-accent) 20%, transparent);\n}\n\n.ofs-batch-meta {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 6px;\n  font-size: 10px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-batch-meta em {\n  font-style: normal;\n  font-size: 9px;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n/* 进行中的暗房计时卡：一格还在显影的相纸 + 阶段与已用时间 */\n.ofs-ghost {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 12px 8px 8px;\n  border: 1px solid var(--ofs-hairline);\n  border-radius: 14px;\n  background: color-mix(in oklab, var(--ofs-card) 70%, transparent);\n}\n\n.ofs-ghost-frame {\n  position: relative;\n  flex: 0 0 auto;\n  display: grid;\n  place-items: center;\n  width: 46px;\n  height: 46px;\n  overflow: hidden;\n  border: 1px dashed color-mix(in oklab, var(--ofs-accent) 30%, transparent);\n  border-radius: 10px;\n  background: var(--ofs-sunken);\n}\n\n/* 一道从下往上推的显影光，说明这一格还在出 */\n.ofs-ghost-bar {\n  width: 100%;\n  height: 100%;\n  background: linear-gradient(\n    180deg,\n    transparent 0%,\n    color-mix(in oklab, var(--ofs-accent) 18%, transparent) 46%,\n    color-mix(in oklab, var(--ofs-accent) 4%, transparent) 100%\n  );\n  background-size: 100% 240%;\n  animation: ofs-develop-scan 2.8s ease-in-out infinite;\n}\n\n@keyframes ofs-develop-scan {\n  0% {\n    background-position: 0 110%;\n  }\n  100% {\n    background-position: 0 -130%;\n  }\n}\n\n/* 排队中的卡：这一格还没开始显影，取景框里写位次，旁边写已排队时长 */\n.ofs-ghost.is-queued {\n  background: color-mix(in oklab, var(--ofs-card) 52%, transparent);\n}\n\n.ofs-ghost.is-queued .ofs-ghost-frame {\n  border-color: var(--ofs-sunken-border);\n}\n\n.ofs-ghost-slot {\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.ofs-ghost.is-queued .ofs-ghost-label {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-ghost-text {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n}\n\n.ofs-ghost-label {\n  max-width: 168px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  font-size: 11px;\n  color: var(--ofs-ink-2);\n  white-space: nowrap;\n}\n\n.ofs-ghost-time {\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 取消：排队卡立即出队，运行中的卡当前这张画完后停止 */\n.ofs-ghost-cancel {\n  appearance: none;\n  flex: 0 0 auto;\n  height: 24px;\n  padding: 0 9px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    background-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-ghost-cancel:hover:not(:disabled) {\n  border-color: color-mix(in oklab, var(--ofs-error) 34%, transparent);\n  background: var(--ofs-error-soft);\n  color: var(--ofs-error);\n}\n\n.ofs-ghost-cancel:disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* 取消中的卡：显影光停下，只保留阶段文案说明「正在停止…」 */\n.ofs-ghost.is-cancelling {\n  border-color: color-mix(in oklab, var(--ofs-warn) 26%, transparent);\n}\n\n.ofs-ghost.is-cancelling .ofs-ghost-bar {\n  animation: none;\n  opacity: 0.45;\n}\n\n.ofs-ghost.is-cancelling .ofs-ghost-label {\n  color: var(--ofs-ink-3);\n}\n\n/* 空态 */\n.ofs-filmstrip-empty {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  flex: 1 1 auto;\n  color: var(--ofs-ink-3);\n  font-size: 12px;\n}\n\n.ofs-slots {\n  display: flex;\n  gap: 6px;\n}\n\n.ofs-slot {\n  display: block;\n  width: 46px;\n  height: 46px;\n  border: 1px dashed var(--ofs-sunken-border);\n  border-radius: 12px;\n  background: color-mix(in oklab, var(--ofs-card) 60%, transparent);\n}\n\n/* 去画廊 */\n.ofs-filmstrip-side {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  align-self: stretch;\n  padding-left: 12px;\n  border-left: 1px solid var(--ofs-hairline);\n}\n\n.ofs-filmstrip-link {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 10px;\n  border: 0;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-filmstrip-link:hover {\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n/* ── 阶段十三：作品条版本角标 / 派生面板 / 新建草稿卡 ───────────────── */\n\n/* 版本角标容器：包裹一张作品缩略图，角标压在右上角，面板向上浮出。\n   面板与缩略图同处一个容器，鼠标从缩略图移进面板时不会触发鼠标离开，\n   配合 JS 的延迟收起构成 hover bridge。 */\n.ofs-version-anchor {\n  position: relative;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n}\n\n.ofs-version-badge {\n  appearance: none;\n  position: absolute;\n  top: -6px;\n  right: -7px;\n  z-index: 2;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 20px;\n  height: 17px;\n  padding: 0 5px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink-2);\n  font-family: var(--ofs-font);\n  font-size: 9.5px;\n  font-weight: 600;\n  line-height: 1;\n  letter-spacing: 0.02em;\n  box-shadow: var(--ofs-shadow-card);\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-version-badge:hover,\n.ofs-version-badge.is-on,\n.ofs-version-anchor.is-pinned .ofs-version-badge {\n  border-color: var(--ofs-accent);\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n}\n\n/* 生成中的角标轻呼吸，提示这棵树还有在途分支。 */\n.ofs-version-anchor.has-pending .ofs-version-badge::after {\n  content: "";\n  width: 4px;\n  height: 4px;\n  margin-left: 3px;\n  border-radius: 50%;\n  background: var(--ofs-warn);\n}\n\n/* 派生面板：fixed 脱离 .ofs-roll 横向裁剪，具体 left / bottom / width 由锚点实时算好并钳在视口内；\n   面板下方留一条透明 hover bridge，指针穿过 10px 间隙时仍算在容器内。 */\n.ofs-version-panel {\n  position: fixed;\n  z-index: 120;\n  width: min(272px, calc(100vw - 24px));\n  max-height: min(58vh, 360px);\n  padding: 8px;\n  overflow-y: auto;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-md);\n  background: color-mix(in oklab, var(--ofs-card-solid) 96%, transparent);\n  box-shadow: var(--ofs-shadow-lift);\n  animation: ofs-version-rise 160ms cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.ofs-version-panel::before {\n  content: "";\n  position: absolute;\n  left: 0;\n  right: 0;\n  bottom: -14px;\n  height: 14px;\n}\n\n@keyframes ofs-version-rise {\n  0% {\n    opacity: 0;\n    transform: translateY(4px);\n  }\n  100% {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n\n.ofs-version-note {\n  padding: 5px 6px 7px;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.4;\n}\n\n.ofs-version-empty {\n  padding: 10px 6px;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  text-align: center;\n}\n\n.ofs-version-rows {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n/* 面板行：左侧按 depth 缩进，行尾可带清空草稿按钮。 */\n.ofs-version-row {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ofs-version-row-main {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex: 1 1 auto;\n  min-width: 0;\n  padding: 4px 6px;\n  border: 1px solid transparent;\n  border-radius: var(--ofs-r-sm);\n  background: transparent;\n  color: var(--ofs-ink-2);\n  text-align: left;\n  cursor: pointer;\n  transition:\n    background-color 140ms ease,\n    border-color 140ms ease;\n}\n\n.ofs-version-row-main:hover {\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-version-row.is-on .ofs-version-row-main {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-ink);\n}\n\n.ofs-version-row.is-ghost .ofs-version-row-main {\n  cursor: default;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-version-label {\n  flex: 0 0 auto;\n  min-width: 38px;\n  font-size: 10px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-version-row.is-on .ofs-version-label {\n  color: var(--ofs-accent);\n}\n\n.ofs-version-row.is-ghost .ofs-version-label {\n  color: var(--ofs-warn);\n}\n\n.ofs-version-kind {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  color: var(--ofs-ink-4);\n}\n\n.ofs-version-thumb {\n  position: relative;\n  flex: 0 0 auto;\n  display: block;\n  width: 28px;\n  height: 28px;\n  overflow: hidden;\n  border-radius: 7px;\n  background: var(--ofs-sunken);\n}\n\n.ofs-version-thumb img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n/* 在途幽灵缩略图：复用作品条已有的显影扫描光。 */\n.ofs-version-thumb-ghost {\n  display: block;\n  width: 100%;\n  height: 100%;\n  border: 1px dashed color-mix(in oklab, var(--ofs-accent) 30%, transparent);\n  border-radius: 7px;\n  background: linear-gradient(\n    180deg,\n    transparent 0%,\n    color-mix(in oklab, var(--ofs-accent) 18%, transparent) 46%,\n    color-mix(in oklab, var(--ofs-accent) 4%, transparent) 100%\n  );\n  background-size: 100% 240%;\n  animation: ofs-develop-scan 2.8s ease-in-out infinite;\n}\n\n.ofs-version-prompt {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n}\n\n/* 草稿圆点：该版本上留有未提交的编辑草稿。 */\n.ofs-version-draft-dot {\n  flex: 0 0 auto;\n  display: inline-block;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ofs-warn);\n  box-shadow: 0 0 0 2px color-mix(in oklab, var(--ofs-warn) 16%, transparent);\n}\n\n.ofs-version-draft-clear {\n  appearance: none;\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 22px;\n  padding: 0 6px;\n  border: 1px solid transparent;\n  border-radius: var(--ofs-r-pill);\n  background: transparent;\n  color: var(--ofs-ink-3);\n  font-family: var(--ofs-font);\n  font-size: 9.5px;\n  white-space: nowrap;\n  cursor: pointer;\n  opacity: 0;\n  transition:\n    opacity 140ms ease,\n    background-color 140ms ease,\n    color 140ms ease;\n}\n\n.ofs-version-row:hover .ofs-version-draft-clear,\n.ofs-version-draft-clear:focus-visible {\n  opacity: 1;\n}\n\n.ofs-version-draft-clear:hover {\n  background: var(--ofs-warn-soft);\n  color: var(--ofs-warn);\n}\n\n.ofs-version-draft-label {\n  line-height: 1;\n}\n\n/* 父图被删后提升的局部根：行内没有徽标位，用左侧窄条说明来源已断。 */\n.ofs-version-row.is-orphan .ofs-version-label {\n  color: var(--ofs-ink-4);\n}\n\n/* 新建绘图草稿卡：作品条最左端的待执行位，取景框按当前画幅比例展示。 */\n.ofs-draft-card {\n  appearance: none;\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink-2);\n  font-family: var(--ofs-font);\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-draft-frame {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: space-between;\n  width: 74px;\n  height: 62px;\n  padding: 5px 4px 4px;\n  border: 1px dashed var(--ofs-sunken-border);\n  border-radius: 12px;\n  background: color-mix(in oklab, var(--ofs-card) 60%, transparent);\n  transition:\n    border-color 160ms ease,\n    background-color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-draft-card:hover .ofs-draft-frame {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n}\n\n.ofs-draft-card.is-on .ofs-draft-frame {\n  border-color: var(--ofs-accent);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-accent) 16%, transparent);\n}\n\n.ofs-draft-viewfinder {\n  margin: auto 0;\n  display: grid;\n  place-items: center;\n  border: 1px dashed color-mix(in oklab, var(--ofs-accent) 32%, transparent);\n  border-radius: 6px;\n  color: var(--ofs-ink-4);\n  background: color-mix(in oklab, var(--ofs-card-solid) 72%, transparent);\n}\n\n.ofs-draft-card.is-pending .ofs-draft-viewfinder {\n  border-style: solid;\n  border-color: color-mix(in oklab, var(--ofs-warn) 34%, transparent);\n  color: var(--ofs-warn);\n}\n\n/* 阶段十五 A1：未提交草稿托管态。卡片多一行「源自此图」，取景框按内容自动长高。 */\n.ofs-draft-card.has-draft .ofs-draft-frame {\n  height: auto;\n  min-height: 70px;\n  border-style: solid;\n  border-color: color-mix(in oklab, var(--ofs-warn) 30%, var(--ofs-sunken-border));\n}\n\n.ofs-draft-card.has-draft .ofs-draft-viewfinder {\n  margin: 2px 0 0;\n  border-color: color-mix(in oklab, var(--ofs-warn) 32%, transparent);\n  color: var(--ofs-warn);\n}\n\n.ofs-draft-from {\n  flex: 0 0 auto;\n  width: 100%;\n  overflow: hidden;\n  color: var(--ofs-warn);\n  font-size: 8.5px;\n  line-height: 1.2;\n  text-align: center;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-draft-state {\n  flex: 0 0 auto;\n  width: 100%;\n  overflow: hidden;\n  color: var(--ofs-ink-4);\n  font-size: 9px;\n  line-height: 1.2;\n  text-align: center;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-draft-card.has-draft .ofs-draft-state {\n  color: var(--ofs-warn);\n}\n\n.ofs-draft-card.is-pending .ofs-draft-state {\n  color: var(--ofs-warn);\n}\n\n.ofs-draft-meta {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 5px;\n  min-width: 0;\n  font-size: 9.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-draft-meta em {\n  flex: 0 0 auto;\n  font-style: normal;\n  font-size: 9px;\n  letter-spacing: 0.04em;\n  font-variant-numeric: tabular-nums;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-draft-preset {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 9px;\n  color: var(--ofs-ink-4);\n}\n\n/* 窄屏：面板贴住作品条左缘，避免浮到窗口外。 */\n@media (max-width: 720px) {\n  .ofs-version-panel {\n    width: min(260px, 72vw);\n  }\n}\n\n/* ── 阶段十三：作品条缩略图草稿圆点与版本面板开合 ─────────────────── */\n\n/* 草稿圆点：该树有未提交的编辑时压在缩略图左上角（右上角留给 ⎇ N 角标）。\n   视觉只有 9px，但用透明外扩伪元素把点击热区撑到 22px。 */\n.ofs-thumb-dot {\n  appearance: none;\n  position: absolute;\n  top: -6px;\n  left: -6px;\n  z-index: 3;\n  width: 9px;\n  height: 9px;\n  padding: 0;\n  border: 1px solid var(--ofs-card-solid);\n  border-radius: 50%;\n  background: var(--ofs-warn);\n  box-shadow: 0 0 0 2px color-mix(in oklab, var(--ofs-warn) 18%, transparent);\n  cursor: pointer;\n  transition:\n    transform 140ms ease,\n    box-shadow 140ms ease;\n}\n\n.ofs-thumb-dot::before {\n  content: "";\n  position: absolute;\n  inset: -7px;\n  border-radius: 50%;\n}\n\n.ofs-thumb-dot:hover {\n  transform: scale(1.25);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-warn) 26%, transparent);\n}\n';

// src/styles/gallery.css
var gallery_default = "/*\n * 作品画廊：作品集式的卡片墙。\n *\n * 结构：\n *   .ofs-gallery          自身滚动容器（高度由 .ofs-main 决定）\n *     .ofs-gallery-tools  轻浮的玻璃工具卡：标题 / 搜索 / 模型 / 收藏 / 批量动作\n *     .ofs-gallery-group  今天 / 本周 / 更早\n *       .ofs-gallery-wall CSS columns 瀑布流：图片按原始宽高比自然高度\n *\n * 卡片是「图片 + 两行提示词 + 标签行」的白卡：圆角、描边、阴影全部来自\n * tokens.css；网格只负责列宽，不裁切图片、不拉伸比例。\n */\n\n/* ── 容器 ───────────────────────────────────────────────────── */\n.ofs-gallery {\n  /* 吸顶工具卡要贴住滚动口，padding-top 用变量参与 top 偏移，避免内容从顶部缝隙露出 */\n  --ofs-gallery-pad-top: 18px;\n  position: relative;\n  flex: 1 1 auto;\n  height: 100%;\n  min-height: 0;\n  overflow-y: auto;\n  overflow-x: hidden;\n  display: flex;\n  flex-direction: column;\n  gap: var(--ofs-gap);\n  padding: var(--ofs-gallery-pad-top) 20px 26px;\n  overscroll-behavior: contain;\n}\n\n.ofs-gallery.is-empty {\n  min-height: 360px;\n}\n\n/* ── 工具卡 ─────────────────────────────────────────────────── */\n.ofs-gallery-tools {\n  position: sticky;\n  top: calc(-1 * var(--ofs-gallery-pad-top));\n  z-index: 3;\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px 12px;\n  padding: 12px 14px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-window);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(18px) saturate(140%);\n  -webkit-backdrop-filter: blur(18px) saturate(140%);\n}\n\n.ofs-gallery-headline {\n  display: flex;\n  align-items: baseline;\n  gap: 9px;\n  min-width: 0;\n}\n\n.ofs-gallery-title {\n  font-size: 15px;\n  font-weight: 650;\n  letter-spacing: -0.01em;\n  line-height: 1.3;\n  color: var(--ofs-ink);\n  white-space: nowrap;\n}\n\n.ofs-gallery-count {\n  font-size: 12px;\n  line-height: 1.4;\n  color: var(--ofs-ink-3);\n  white-space: nowrap;\n}\n\n.ofs-gallery-count b {\n  font-weight: 600;\n  color: var(--ofs-ink-2);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 搜索：胶囊内嵌放大镜 */\n.ofs-gallery-search {\n  position: relative;\n  display: flex;\n  align-items: center;\n  flex: 1 1 200px;\n  max-width: 320px;\n  height: 34px;\n  padding: 0 12px 0 32px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-3);\n  cursor: text;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease,\n    box-shadow 150ms ease,\n    color 150ms ease;\n}\n\n.ofs-gallery-search:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-focus-ring);\n  color: var(--ofs-accent);\n}\n\n.ofs-gallery-search-icon {\n  position: absolute;\n  left: 11px;\n  top: 50%;\n  transform: translateY(-50%);\n  pointer-events: none;\n}\n\n.ofs-gallery-search-input {\n  width: 100%;\n  height: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n}\n\n.ofs-gallery-search-input::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-gallery-search-input:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-gallery-search-input::-webkit-search-cancel-button,\n.ofs-gallery-search-input::-webkit-search-decoration {\n  appearance: none;\n  -webkit-appearance: none;\n}\n\n/* 模型过滤：原生 select，外观融进胶囊体系 */\n.ofs-gallery-select {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  flex: 0 0 auto;\n}\n\n.ofs-gallery-select-input {\n  appearance: none;\n  -webkit-appearance: none;\n  height: 34px;\n  max-width: 200px;\n  padding: 0 30px 0 13px;\n  border: 1px solid var(--ofs-sunken-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  text-overflow: ellipsis;\n  cursor: pointer;\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease;\n}\n\n.ofs-gallery-select-input:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-card-solid);\n}\n\n.ofs-gallery-select-input:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-gallery-select-input option {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-ink);\n}\n\n.ofs-gallery-select-caret {\n  position: absolute;\n  right: 11px;\n  top: 50%;\n  transform: translateY(-50%);\n  color: var(--ofs-ink-3);\n  pointer-events: none;\n}\n\n/* 工具条里的 chip 与输入同高，避免一排控件高低不齐 */\n.ofs-gallery-tools .ofs-chip {\n  height: 32px;\n  padding: 0 13px;\n  font-size: 12.5px;\n}\n\n.ofs-gallery-actions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  margin-left: auto;\n}\n\n.ofs-gallery-selected {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 32px;\n  padding: 0 12px;\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n  font-size: 12px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.ofs-gallery-selected b {\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 分组：小字重对比 + 一条极淡分隔 ─────────────────────────── */\n.ofs-gallery-group {\n  flex: 0 0 auto;\n}\n\n.ofs-gallery-group-title {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin: 0 0 12px;\n  padding-left: 2px;\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n  font-weight: 600;\n  line-height: 1.4;\n  letter-spacing: 0.02em;\n}\n\n.ofs-gallery-group-title::after {\n  content: '';\n  flex: 1 1 auto;\n  height: 1px;\n  border-radius: 1px;\n  background: var(--ofs-hairline);\n}\n\n/* ── 卡片墙：JS 分列，图片按原始比例撑高 ─────────────────────── */\n/*\n * CSS 多列是列优先填充，最新作品会先占满左列；这里改成「每列一个纵向 flex」，\n * 由 Gallery.jsx 按行优先分桶（断点见 logic/gallery.js）。图片仍按原始宽高比\n * 撑高，不裁切、不拉伸。\n */\n.ofs-gallery-wall {\n  display: flex;\n  align-items: flex-start;\n  gap: var(--ofs-gap);\n}\n\n.ofs-gallery-col {\n  flex: 1 1 0;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n\n.ofs-gallery-card {\n  display: block;\n  width: 100%;\n  margin: 0 0 var(--ofs-gap);\n  padding: 6px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: var(--ofs-card);\n  color: var(--ofs-ink);\n  break-inside: avoid;\n  box-shadow: var(--ofs-shadow-card);\n  transition:\n    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 180ms ease,\n    border-color 180ms ease;\n}\n\n.ofs-gallery-card:hover {\n  transform: translateY(-2px);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-gallery-card.is-picked {\n  border-color: var(--ofs-accent);\n  box-shadow: var(--ofs-focus-ring), var(--ofs-shadow-card);\n}\n\n.ofs-gallery-card.is-picked:hover {\n  box-shadow: var(--ofs-focus-ring), var(--ofs-shadow-lift);\n}\n\n/* 图片区：按钮铺满，悬浮操作覆盖在图片底部 */\n.ofs-gallery-stage {\n  position: relative;\n  display: block;\n  border-radius: calc(var(--ofs-r-lg) - 7px);\n  overflow: hidden;\n  background: var(--ofs-sunken);\n}\n\n.ofs-gallery-media {\n  appearance: none;\n  position: relative;\n  display: block;\n  width: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  cursor: pointer;\n}\n\n.ofs-gallery-media img {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n/* 悬停操作：在工作台打开 / 重绘编辑 / 查看大图 / 删除（阶段十五 A1 收敛） */\n.ofs-gallery-hover {\n  position: absolute;\n  right: 6px;\n  bottom: 6px;\n  left: 6px;\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 4px;\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 150ms ease;\n}\n\n.ofs-gallery-card:hover .ofs-gallery-hover,\n.ofs-gallery-card:focus-within .ofs-gallery-hover {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n.ofs-gallery-action {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 22px;\n  padding: 0 7px;\n  border: 1px solid rgb(255 255 255 / 26%);\n  border-radius: var(--ofs-r-pill);\n  background: rgb(20 20 22 / 62%);\n  color: #fff;\n  font-size: 10px;\n  white-space: nowrap;\n  cursor: pointer;\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n}\n\n.ofs-gallery-action:hover {\n  background: rgb(20 20 22 / 82%);\n}\n\n/*\n * 删除：破坏性动作单独一档。常态只给淡红描边，确认态实心红且其余动作已收起，\n * 让「已经上膛」这件事一眼可见；红只出现在这一颗小胶囊上，不扩散到大面积。\n */\n.ofs-gallery-action.is-danger {\n  border-color: rgb(255 138 138 / 34%);\n  color: #ffd6d6;\n}\n\n.ofs-gallery-action.is-danger:hover {\n  border-color: rgb(255 138 138 / 62%);\n  background: rgb(86 18 18 / 78%);\n  color: #fff;\n}\n\n.ofs-gallery-action.is-danger.is-confirming {\n  border-color: rgb(255 138 138 / 72%);\n  background: #9d2b2b;\n  color: #fff;\n}\n\n.ofs-gallery-action.is-danger.is-confirming:hover {\n  background: #b23434;\n}\n\n/* 触屏设备没有 hover：操作条常显，否则手机上无法打开作品或进入重绘。 */\n@media (hover: none) {\n  .ofs-gallery-hover {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n/* 批量选择：左上角圆点，选中后墨黑填充 */\n.ofs-gallery-pick {\n  position: absolute;\n  top: 9px;\n  left: 9px;\n  display: grid;\n  place-items: center;\n  width: 20px;\n  height: 20px;\n  border: 1.5px solid rgb(20 20 22 / 16%);\n  border-radius: 50%;\n  background: rgb(255 255 255 / 72%);\n  color: var(--ofs-accent-ink);\n  box-shadow: 0 1px 4px rgb(24 24 27 / 22%);\n  transition:\n    background-color 150ms ease,\n    border-color 150ms ease;\n}\n\n.ofs-gallery-pick.is-on {\n  border-color: var(--ofs-accent-ink);\n  background: var(--ofs-accent-grad);\n  box-shadow: var(--ofs-shadow-accent);\n}\n\n/* 收藏星标：右上角玻璃圆点，已收藏常显；未收藏在卡片悬停 / 键盘聚焦时出现。\n   它是图片上方的独立按钮，不嵌在图片按钮里，避免嵌套交互元素。 */\n.ofs-gallery-star {\n  appearance: none;\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 2;\n  display: grid;\n  place-items: center;\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  border: 0;\n  border-radius: 50%;\n  background: color-mix(in oklab, var(--ofs-card-solid) 84%, transparent);\n  color: var(--ofs-ink-3);\n  box-shadow: 0 1px 4px rgb(24 24 27 / 22%);\n  backdrop-filter: blur(4px);\n  -webkit-backdrop-filter: blur(4px);\n  cursor: pointer;\n  opacity: 0;\n  pointer-events: none;\n  transition:\n    opacity 150ms ease,\n    color 150ms ease,\n    background-color 150ms ease;\n}\n\n.ofs-gallery-star.is-on {\n  opacity: 1;\n  pointer-events: auto;\n  color: var(--ofs-ink);\n}\n\n.ofs-gallery-card:hover .ofs-gallery-star,\n.ofs-gallery-card:focus-within .ofs-gallery-star {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n.ofs-gallery-star:hover {\n  color: var(--ofs-accent);\n}\n\n/* 触屏没有 hover：星标常显，否则手机上无法收藏。 */\n@media (hover: none) {\n  .ofs-gallery-star {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n/* 卡身：两行提示词 + 标签行；整块可点开大图 */\n.ofs-gallery-body {\n  appearance: none;\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  width: 100%;\n  min-width: 0;\n  padding: 10px 8px 8px;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n.ofs-gallery-caption {\n  display: -webkit-box;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n  overflow: hidden;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  font-weight: 500;\n  line-height: 1.5;\n  word-break: break-word;\n}\n\n.ofs-gallery-tags {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.3;\n}\n\n.ofs-gallery-tags em {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--ofs-ink-3);\n  font-style: normal;\n  font-weight: 500;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ofs-gallery-tags span {\n  flex: 0 0 auto;\n  color: var(--ofs-ink-3);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ── 空态：一张柔光卡片，一句话 ─────────────────────────────── */\n.ofs-gallery-empty {\n  flex: 0 0 auto;\n  margin: auto;\n  width: 100%;\n  max-width: 380px;\n  padding: 40px 30px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-xl);\n  background:\n    radial-gradient(120% 150% at 50% -18%, color-mix(in oklab, var(--ofs-ink) 6%, transparent) 0%, transparent 62%),\n    var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  text-align: center;\n}\n\n.ofs-gallery-empty p {\n  color: var(--ofs-ink-2);\n  font-size: 13px;\n  line-height: 1.7;\n}\n\n.ofs-gallery-empty-actions {\n  display: flex;\n  justify-content: center;\n  margin-top: 14px;\n}\n\n/* ── 历史分页脚 ─────────────────────────────────────────────── */\n.ofs-gallery-foot {\n  flex: 0 0 auto;\n  display: flex;\n  justify-content: center;\n  padding: 8px 0 4px;\n}\n\n.ofs-gallery-more {\n  height: 32px;\n  padding: 0 18px;\n}\n\n.ofs-gallery-more[aria-busy='true'] {\n  opacity: 0.6;\n}\n\n.ofs-gallery-all-loaded {\n  font-size: 11px;\n  color: var(--ofs-ink-3);\n  text-align: center;\n}\n\n/* ── 响应式 ─────────────────────────────────────────────────── */\n/* 列数由 Gallery.jsx 的 useColumnCount 按 900 / 1180 / 1400 三个断点决定，\n   这里只调工具卡各自在不同宽度下的排布。 */\n@media (max-width: 1180px) {\n  .ofs-gallery {\n    --ofs-gallery-pad-top: 16px;\n    padding: 16px 18px 24px;\n  }\n\n  .ofs-gallery-search {\n    max-width: 260px;\n  }\n}\n\n@media (max-width: 900px) {\n  /* 窄窗里工具卡不再吸顶：它本身会折成两三行，吸顶太占高度 */\n  .ofs-gallery-tools {\n    position: static;\n  }\n}\n\n@media (max-width: 700px) {\n  .ofs-gallery {\n    --ofs-gallery-pad-top: 12px;\n    gap: 12px;\n    padding: 12px 12px 22px;\n  }\n\n  .ofs-gallery-tools {\n    gap: 8px;\n    padding: 10px 11px;\n  }\n\n  .ofs-gallery-search {\n    flex: 1 1 100%;\n    max-width: none;\n  }\n\n  .ofs-gallery-select-input {\n    max-width: 116px;\n  }\n\n  .ofs-gallery-tools .ofs-chip {\n    padding: 0 10px;\n  }\n\n  .ofs-gallery-empty {\n    padding: 32px 22px;\n  }\n}";

// src/styles/chat.css
var chat_default = "/*\n * 对话式面板：柔和消息流。\n *\n * 卡片外壳（背景 / 圆角 / 阴影 / 外边距）、头部与分段控件都由 panel.css 提供，\n * 这里只写卡片内部：消息流、空态、建议行与底部悬浮输入区。\n * 所有选择器挂在 .ofs-panel--chat 下，避免和表单式面板共用的类名互相影响；\n * 对话专属的类名统一用 ofs-chat- / ofs-msg- 前缀。\n */\n\n/* ── 消息流 ─────────────────────────────────────────────────── */\n/* 面板落在单轨布局的第一列；单独挂载预览时这句不影响其它容器。 */\n.ofs-panel--chat {\n  grid-column: 1;\n}\n\n.ofs-panel--chat .ofs-thread {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 6px 15px 10px;\n}\n\n/* 空态用 auto 外边距居中，内容超高时自然回到顶部可滚动，不会被裁掉。 */\n.ofs-panel--chat .ofs-thread.is-empty {\n  justify-content: flex-start;\n}\n\n.ofs-chat-empty {\n  display: flex;\n  flex-direction: column;\n  align-items: stretch;\n  gap: 13px;\n  margin: auto 0;\n  /* 稍微上提，避免视觉重心压在输入区上。 */\n  padding-bottom: 26px;\n  animation: ofs-fade-in 260ms ease both;\n}\n\n.ofs-chat-empty-text {\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  line-height: 1.7;\n  text-align: center;\n}\n\n/* 空态示例：五枚可换行的胶囊，读起来是「可以这样问」，而不是五行待填的表单字段。 */\n.ofs-chat-examples {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: center;\n  gap: 6px;\n}\n\n.ofs-panel--chat .ofs-chat-example {\n  display: inline-flex;\n  align-items: center;\n  height: 26px;\n  min-height: 26px;\n  padding: 0 10px;\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  color: var(--ofs-ink-2);\n  font-size: 11px;\n  line-height: 1.4;\n  white-space: nowrap;\n}\n\n.ofs-panel--chat .ofs-chat-example:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* ── 消息 ───────────────────────────────────────────────────── */\n.ofs-panel--chat .ofs-msg {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  max-width: 100%;\n  min-width: 0;\n  animation: ofs-fade-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;\n}\n\n.ofs-panel--chat .ofs-msg p {\n  font-size: 12.5px;\n  line-height: 1.62;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* 用户：右对齐的浅灰底，右下角收小圆角但不出气泡尾巴。 */\n.ofs-panel--chat .ofs-msg--user {\n  align-self: flex-end;\n  max-width: 88%;\n  padding: 8px 13px;\n  border: 1px solid var(--ofs-accent-soft-border);\n  border-radius: 16px 16px 6px 16px;\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-ink);\n}\n\n/* 助手：整宽白卡，左上角收小圆角，跟用户消息形成对角呼应。 */\n.ofs-panel--chat .ofs-msg--assistant {\n  align-self: stretch;\n}\n\n/* 表单提交同步记录：不是用户说过的话，用整宽白卡 + 参数胶囊与普通用户气泡区分。 */\n.ofs-panel--chat .ofs-form-sync {\n  align-self: stretch;\n}\n\n.ofs-form-sync-card {\n  gap: 7px;\n}\n\n.ofs-form-sync-title {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n}\n\n.ofs-form-sync-prompt {\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  line-height: 1.6;\n  word-break: break-word;\n}\n\n/* 参数摘要胶囊：比输入区标签更小一号，一行放得下模型 / 尺寸 / 张数 / 参考图 / 种子。 */\n.ofs-form-sync-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-form-sync-chip {\n  height: 22px;\n  padding: 0 9px;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n  cursor: default;\n}\n\n.ofs-form-sync-chip:hover:not(:disabled) {\n  color: var(--ofs-ink-3);\n  border-color: var(--ofs-sunken-border);\n}\n\n.ofs-chat-author {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding-left: 2px;\n}\n\n.ofs-chat-author-name {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.04em;\n}\n\n.ofs-chat-dot {\n  flex: 0 0 auto;\n}\n\n/* 排队与渲染中：状态点换成琥珀色呼吸，不用转圈。 */\n.ofs-panel--chat .ofs-chat-dot.is-live {\n  animation: ofs-chat-breathe 2.2s ease-out infinite;\n}\n\n@keyframes ofs-chat-breathe {\n  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 36%, transparent); }\n  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ofs-warn) 0%, transparent); }\n}\n\n.ofs-msg-card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 13px 11px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 6px 16px 16px 16px;\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n/* 生成中：卡片留一条柔光微光条，扫过即表示在跑。 */\n.ofs-chat-shimmer {\n  display: block;\n  width: 58%;\n  height: 3px;\n  margin-top: -2px;\n  border-radius: var(--ofs-r-pill);\n  background: linear-gradient(90deg, transparent 0%, var(--ofs-accent-2) 52%, transparent 100%);\n  background-size: 220% 100%;\n  opacity: 0.62;\n  animation: ofs-shimmer 2s linear infinite;\n}\n\n/* 意图确认卡：中文摘要优先，英文提示词可编辑，比例 / 张数 / 排除项按能力给出。 */\n.ofs-intent {\n  gap: 7px;\n}\n\n.ofs-intent-title {\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  color: var(--ofs-ink-3);\n}\n\n/* 意图卡行内微调：提示词与排除项直接可编辑，改完再点「按此生成」。 */\n.ofs-intent-field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.ofs-intent-field-label {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n}\n\n/* 文本域沿用输入区的浅底与描边，焦点态与其它输入框一致。 */\n.ofs-intent-prompt,\n.ofs-intent-negative {\n  box-sizing: border-box;\n  width: 100%;\n  min-height: 46px;\n  padding: 6px 9px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 8px;\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink);\n  font-family: inherit;\n  font-size: 12px;\n  line-height: 1.55;\n  resize: vertical;\n}\n\n.ofs-intent-prompt:focus,\n.ofs-intent-negative:focus {\n  outline: none;\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-accent) 12%, transparent);\n}\n\n.ofs-intent-prompt::placeholder,\n.ofs-intent-negative::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n.ofs-intent-edit-hint {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.5;\n}\n\n/* 中文摘要：放在英文提示词之前，先让用户确认画面对不对。 */\n.ofs-intent-summary {\n  color: var(--ofs-ink);\n  font-size: 12px;\n  line-height: 1.6;\n  word-break: break-word;\n}\n\n.ofs-intent-summary-label {\n  margin-right: 6px;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n}\n\n/* 模型建议：弱提示，不抢主按钮与提示词的注意力，也不拦着按当前模型生成。 */\n.ofs-intent-model-hint {\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n  line-height: 1.55;\n  word-break: break-word;\n}\n\n/* 中文提示词软提示：跟在提示词输入框下方，样式沿用 .ofs-hint，只补一点间距。 */\n.ofs-prompt-lang-hint {\n  margin-top: 6px;\n}\n\n.ofs-intent-question {\n  color: var(--ofs-ink-2);\n  font-size: 12px;\n}\n\n.ofs-intent-meta {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n}\n\n.ofs-intent-note {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.5;\n}\n\n/* 意图卡上的「沿用上张构图」开关：可选行为，视觉上弱于主按钮。 */\n.ofs-intent-lock {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  align-self: flex-start;\n  color: var(--ofs-ink-2);\n  font-size: 11px;\n  line-height: 1.4;\n  cursor: pointer;\n  user-select: none;\n}\n\n.ofs-intent-lock input {\n  width: 13px;\n  height: 13px;\n  margin: 0;\n  accent-color: var(--ofs-accent);\n  cursor: pointer;\n}\n\n/* 上一张图没有可复用种子时置灰，避免开了一个不生效的开关。 */\n.ofs-intent-lock.is-disabled {\n  color: var(--ofs-ink-4);\n  cursor: default;\n}\n\n/* 生成张数：四格分段，与参数面板的张数选择保持同一视觉语言。 */\n.ofs-intent-qty-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ofs-intent-qty-label {\n  flex: 0 0 auto;\n  color: var(--ofs-ink-3);\n  font-size: 11px;\n}\n\n.ofs-intent-qty {\n  display: inline-flex;\n  gap: 2px;\n  padding: 2px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-md);\n  background: var(--ofs-sunken);\n}\n\n.ofs-intent-qty-option {\n  appearance: none;\n  min-width: 30px;\n  height: 24px;\n  padding: 0 6px;\n  border: 0;\n  border-radius: calc(var(--ofs-r-md) - 3px);\n  background: transparent;\n  color: var(--ofs-ink-3);\n  font-size: 11.5px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n  cursor: pointer;\n  transition:\n    background-color 140ms ease,\n    color 140ms ease,\n    box-shadow 140ms ease;\n}\n\n.ofs-intent-qty-option:hover {\n  color: var(--ofs-ink);\n}\n\n.ofs-intent-qty-option.is-on {\n  background: var(--ofs-card-solid);\n  color: var(--ofs-accent);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n/* 主操作与次级操作同一行：生成是主按钮，带入参数面板更轻。 */\n.ofs-intent-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin-top: 2px;\n}\n\n.ofs-intent-go {\n  height: 30px;\n  padding: 0 14px;\n  border-radius: 10px;\n  font-size: 12px;\n}\n\n.ofs-intent-handoff {\n  height: 30px;\n  padding: 0 12px;\n  border-radius: 10px;\n  font-size: 12px;\n  font-weight: 500;\n}\n\n/* 通用澄清卡：问题 + 2~4 个选项 + 「先按当前设置」。 */\n.ofs-intent-clarify {\n  gap: 9px;\n}\n\n.ofs-intent-clarify .ofs-suggestions {\n  gap: 6px;\n}\n\n/* 结果缩略图网格（阶段十五 Phase A2）：一个任务 1~4 张全部展示。\n * 单张保持整宽单图的观感；多张用 2 列网格，序号与张数标签压在角落。 */\n.ofs-msg-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 6px;\n  margin-top: 1px;\n}\n\n.ofs-msg-grid.is-single {\n  grid-template-columns: minmax(0, 1fr);\n}\n\n.ofs-msg-grid-item {\n  appearance: none;\n  position: relative;\n  display: block;\n  width: 100%;\n  padding: 0;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 12px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  cursor: pointer;\n  transition:\n    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 180ms ease,\n    border-color 180ms ease;\n}\n\n.ofs-msg-grid-item img {\n  display: block;\n  width: 100%;\n  height: 88px;\n  object-fit: cover;\n}\n\n/* 只有一张时回到单图观感：整宽 + 更高的缩略图。 */\n.ofs-msg-grid.is-single .ofs-msg-grid-item img {\n  height: 132px;\n}\n\n.ofs-msg-grid-item:hover {\n  transform: translateY(-1px);\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-msg-grid-item:active {\n  transform: translateY(0) scale(0.995);\n}\n\n.ofs-msg-grid-item:focus-visible {\n  outline: none;\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ofs-accent) 14%, transparent);\n}\n\n/* 多图网格的序号角标：1~4，提示「这里还有别的结果」。 */\n.ofs-msg-grid-index {\n  position: absolute;\n  top: 6px;\n  left: 6px;\n  display: grid;\n  place-items: center;\n  min-width: 17px;\n  height: 17px;\n  padding: 0 5px;\n  border-radius: var(--ofs-r-pill);\n  background: rgb(17 17 20 / 52%);\n  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n  color: rgb(255 255 255 / 93%);\n  font-size: 10px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n/* 张数标签占满一行，紧贴在网格下方。 */\n.ofs-msg-grid-label {\n  grid-column: 1 / -1;\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  line-height: 1.4;\n}\n\n/* 舞台图片工具动作镜像卡（kind='tool'）：底图缩略图 + 动作说明 + 可选强度胶囊。 */\n.ofs-panel--chat .ofs-tool-sync {\n  align-self: stretch;\n}\n\n.ofs-tool-sync-card {\n  flex-direction: row;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 11px;\n}\n\n.ofs-tool-sync-thumb {\n  appearance: none;\n  flex: 0 0 auto;\n  width: 44px;\n  height: 44px;\n  padding: 0;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 9px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  cursor: pointer;\n  transition: border-color 160ms ease, box-shadow 160ms ease;\n}\n\n.ofs-tool-sync-thumb img {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ofs-tool-sync-thumb:hover {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-tool-sync-body {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  min-width: 0;\n}\n\n.ofs-tool-sync-title {\n  color: var(--ofs-ink);\n  font-size: 12px;\n  line-height: 1.5;\n  word-break: break-word;\n}\n\n.ofs-tool-sync-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n\n.ofs-panel--chat .ofs-tool-sync-chip {\n  height: 20px;\n  padding: 0 8px;\n  font-size: 10px;\n  color: var(--ofs-ink-3);\n  cursor: default;\n}\n\n/* ── 单图聚焦视图（阶段十五 Phase A2） ───────────────────────── */\n\n/* 消息流顶部的轻量面包屑：返回上一层（{label}）。 */\n.ofs-panel--chat .ofs-chat-breadcrumb {\n  position: sticky;\n  top: 0;\n  z-index: 1;\n  display: flex;\n  padding: 2px 0 4px;\n  background: linear-gradient(180deg, var(--ofs-card-solid) 78%, transparent);\n}\n\n.ofs-panel--chat .ofs-chat-back {\n  height: 26px;\n  max-width: 100%;\n  padding: 0 11px;\n  font-size: 11px;\n  color: var(--ofs-ink-2);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.ofs-panel--chat .ofs-chat-back:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-chat-focus {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n  animation: ofs-fade-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;\n}\n\n.ofs-chat-focus-head {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 7px;\n}\n\n.ofs-chat-focus-title {\n  color: var(--ofs-ink-3);\n  font-size: 10.5px;\n  font-weight: 600;\n  letter-spacing: 0.03em;\n}\n\n.ofs-panel--chat .ofs-chat-focus-batch {\n  height: 20px;\n  padding: 0 8px;\n  font-size: 10px;\n  color: var(--ofs-ink-3);\n  cursor: default;\n}\n\n/* 大图：圆角白卡内的整宽预览，点「查看大图」进放大层。 */\n.ofs-chat-focus-figure {\n  border: 1px solid var(--ofs-card-border);\n  border-radius: 12px;\n  background: var(--ofs-sunken);\n  overflow: hidden;\n  box-shadow: var(--ofs-shadow-card);\n}\n\n.ofs-chat-focus-figure img {\n  display: block;\n  width: 100%;\n  max-height: 320px;\n  object-fit: contain;\n  background: var(--ofs-sunken);\n}\n\n.ofs-chat-focus-meta {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-panel--chat .ofs-chat-focus-chip {\n  height: 22px;\n  padding: 0 9px;\n  font-size: 10.5px;\n  color: var(--ofs-ink-3);\n  cursor: default;\n}\n\n/* 快捷动作胶囊：对比原图 / 继续涂抹 / 重新生成 / 查看大图。 */\n.ofs-chat-focus-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-panel--chat .ofs-chat-focus-action {\n  height: 26px;\n  padding: 0 11px;\n  font-size: 11px;\n  color: var(--ofs-ink-2);\n}\n\n.ofs-panel--chat .ofs-chat-focus-action:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n/* ── 底部：建议 / 动作 / 输入 ────────────────────────────────── */\n.ofs-chat-dock {\n  flex: 0 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 15px 14px;\n  border-top: 1px solid var(--ofs-hairline);\n}\n\n.ofs-chat-tools {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ofs-panel--chat .ofs-chat-tools .ofs-chip {\n  height: 27px;\n  padding: 0 11px;\n  font-size: 11.5px;\n}\n\n/* 输入区：白/玻璃的圆角卡，靠内发光描边和柔影浮起来。 */\n.ofs-chat-composer {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  padding: 9px 9px 9px 12px;\n  border: 1px solid var(--ofs-card-border);\n  border-radius: var(--ofs-r-lg);\n  background: linear-gradient(180deg, var(--ofs-card-solid) 0%, var(--ofs-card) 100%);\n  box-shadow:\n    inset 0 1px 0 var(--ofs-window-border),\n    var(--ofs-shadow-card);\n  transition:\n    border-color 160ms ease,\n    box-shadow 160ms ease;\n}\n\n.ofs-chat-composer:focus-within {\n  border-color: var(--ofs-accent-soft-border);\n  box-shadow:\n    inset 0 1px 0 var(--ofs-window-border),\n    0 0 0 3px color-mix(in oklab, var(--ofs-accent) 12%, transparent),\n    var(--ofs-shadow-card);\n}\n\n.ofs-chat-composer textarea {\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 42px;\n  max-height: 128px;\n  padding: 2px 0;\n  border: 0;\n  background: transparent;\n  color: var(--ofs-ink);\n  font-size: 12.5px;\n  line-height: 1.6;\n  resize: none;\n  overflow-y: auto;\n  /* 支持的浏览器里让输入框随内容长到 max-height；不支持时退化成固定两行。 */\n  field-sizing: content;\n}\n\n.ofs-chat-composer textarea:focus,\n.ofs-chat-composer textarea:focus-visible {\n  outline: none;\n  box-shadow: none;\n}\n\n.ofs-chat-composer textarea::placeholder {\n  color: var(--ofs-ink-3);\n}\n\n/* 发送：墨黑实心圆钮（深色主题由 tokens 反相成浅灰），hover 轻抬升，禁用降饱和。 */\n.ofs-chat-send {\n  appearance: none;\n  flex: 0 0 auto;\n  display: grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  padding: 0;\n  border: 0;\n  border-radius: 50%;\n  background: var(--ofs-accent);\n  color: var(--ofs-accent-ink);\n  box-shadow: var(--ofs-shadow-accent);\n  cursor: pointer;\n  transition:\n    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),\n    box-shadow 160ms ease,\n    background-color 160ms ease,\n    color 160ms ease;\n}\n\n.ofs-chat-send:hover:not(:disabled) {\n  transform: translateY(-1px);\n  box-shadow: var(--ofs-shadow-lift);\n}\n\n.ofs-chat-send:active:not(:disabled) {\n  transform: translateY(0) scale(0.94);\n}\n\n.ofs-chat-send:disabled {\n  background: var(--ofs-sunken);\n  color: var(--ofs-ink-4);\n  box-shadow: none;\n  filter: saturate(0);\n  cursor: default;\n}\n\n/* 窄窗下面板被压到 46vh：收紧留白，让最后两条消息仍然可见。 */\n@media (max-width: 820px) {\n  .ofs-panel--chat .ofs-thread {\n    padding: 0 13px 8px;\n  }\n\n  .ofs-chat-dock {\n    padding: 8px 13px 12px;\n  }\n\n  .ofs-msg-grid.is-single .ofs-msg-grid-item img {\n    height: 112px;\n  }\n}\n\n/* 动效停用时，微光条改成一条静态浅色线，信息不丢。 */\n@media (prefers-reduced-motion: reduce) {\n  .ofs-chat-shimmer {\n    background: var(--ofs-accent-soft-border);\n    opacity: 0.9;\n    animation: none;\n  }\n\n  .ofs-panel--chat .ofs-chat-dot.is-live {\n    animation: none;\n  }\n}";

// src/styles/import.css
var import_default = "/*\n * 阶段十五 Phase A：本地图片导入拖放层与「对比原图」拉帘。\n *\n * 落点：ImageDropzone（舞台拖放 / 拖入提示 / 新画布选择图片）与 CompareSlider\n * （派生作品的原图对照）。类名以 .ofs-import- / .ofs-compare- 开头，避免与 stage.css 撞名。\n *\n * 尺寸口径跟随舞台：相纸与对比层都按 .ofs-figure（container-type: size）的 cqw / cqh 算，\n * 这样窗口缩放、16:9 与 9:16 都能同比例收进光桌，不会比普通预览小一圈。\n */\n\n/* ── 拖放层：包住整个舞台 ───────────────────────────────────── */\n.ofs-import-zone {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 0;\n}\n\n/* Stage 的 <section> 仍是舞台本体的 flex 子项，包裹层只负责尺寸透传。 */\n.ofs-import-zone > .ofs-stage {\n  flex: 1 1 auto;\n  min-height: 0;\n}\n\n/* 拖入时的提示层：不拦截指针，drop 仍落在包裹层上。 */\n.ofs-import-overlay {\n  position: absolute;\n  inset: 6px;\n  z-index: 40;\n  display: grid;\n  place-items: center;\n  border: 1px dashed var(--ofs-accent-soft-border);\n  border-radius: var(--ofs-r-xl);\n  background: color-mix(in oklab, var(--ofs-card-solid) 66%, transparent);\n  backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);\n  pointer-events: none;\n  animation: ofs-fade-in 140ms ease;\n}\n\n.ofs-import-hint {\n  display: inline-flex;\n  align-items: center;\n  gap: 9px;\n  padding: 11px 18px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card-solid);\n  box-shadow: var(--ofs-shadow-lift);\n  color: var(--ofs-ink-2);\n  font-size: 13px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.ofs-import-hint.is-blocked {\n  border-color: var(--ofs-error-soft);\n  color: var(--ofs-error);\n}\n\n/* 导入中：轻量状态胶囊，说明这次上传还在路上。 */\n.ofs-import-status {\n  position: absolute;\n  top: 14px;\n  left: 50%;\n  z-index: 41;\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding: 7px 13px;\n  border: 1px solid var(--ofs-window-border);\n  border-radius: var(--ofs-r-pill);\n  background: color-mix(in oklab, var(--ofs-card-solid) 78%, transparent);\n  box-shadow: var(--ofs-shadow-card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  transform: translateX(-50%);\n  color: var(--ofs-ink-2);\n  font-size: 11.5px;\n  white-space: nowrap;\n  pointer-events: none;\n}\n\n/* 新画布取景框下方的「选择图片」：轻描边胶囊，不与主生成按钮抢注意力。 */\n.ofs-import-choose {\n  position: absolute;\n  bottom: 16px;\n  left: 50%;\n  z-index: 30;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 16px;\n  border: 1px dashed var(--ofs-accent-soft-border);\n  border-radius: var(--ofs-r-pill);\n  background: var(--ofs-card);\n  box-shadow: var(--ofs-shadow-card);\n  color: var(--ofs-ink-2);\n  font-size: 12.5px;\n  font-weight: 600;\n  cursor: pointer;\n  transform: translateX(-50%);\n  transition:\n    color 150ms ease,\n    border-color 150ms ease,\n    background-color 150ms ease,\n    transform 150ms ease;\n}\n\n.ofs-import-choose:hover {\n  border-color: var(--ofs-accent-soft-border);\n  background: var(--ofs-accent-soft);\n  color: var(--ofs-accent);\n}\n\n.ofs-import-choose:active {\n  transform: translateX(-50%) scale(0.97);\n}\n\n.ofs-import-choose:focus-visible {\n  outline: none;\n  box-shadow: var(--ofs-focus-ring);\n}\n\n.ofs-import-choose:disabled {\n  opacity: 0.55;\n  cursor: default;\n}\n\n.ofs-import-input {\n  display: none;\n}\n\n/* ── 拉帘对比：原图 / 当前图 ───────────────────────────────────── */\n.ofs-compare {\n  position: relative;\n  display: block;\n  width: min(calc(100cqw - 44px), calc((100cqh - 44px) * var(--ofs-compare-r, 1)));\n  aspect-ratio: var(--ofs-compare-r, 1);\n  max-width: 100%;\n  border-radius: 3px;\n  background: var(--ofs-print-paper);\n  box-shadow:\n    0 0 0 11px var(--ofs-print-paper),\n    0 0 0 12px var(--ofs-print-edge),\n    var(--ofs-print-shadow);\n  overflow: hidden;\n  cursor: ew-resize;\n  touch-action: none;\n  user-select: none;\n  -webkit-user-select: none;\n}\n\n.ofs-compare:focus-visible {\n  outline: none;\n  box-shadow:\n    0 0 0 11px var(--ofs-print-paper),\n    0 0 0 14px var(--ofs-accent),\n    var(--ofs-print-shadow);\n}\n\n.ofs-compare-base,\n.ofs-compare-image {\n  position: absolute;\n  inset: 0;\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  background: var(--ofs-print-paper);\n  pointer-events: none;\n}\n\n/*\n * 扩图对比：底图只占画布的一块区域（outpaintContent），不能再铺满对比框。\n * 位置由内联 left/top/width/height 百分比给出；`object-fit: fill` 在内容框内\n * 与该框宽高比一致（内容框由源图等比缩放生成），不会变形；框外露出纸面背景。\n */\n.ofs-compare-base.is-region {\n  inset: auto;\n  object-fit: fill;\n}\n\n.ofs-compare-overlay {\n  position: absolute;\n  inset: 0;\n  will-change: clip-path;\n}\n\n/* 分隔线：一条细白线 + 纸面阴影，中间是抓手。 */\n.ofs-compare-divider {\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  width: 2px;\n  margin-left: -1px;\n  background: rgb(255 255 255 / 88%);\n  box-shadow: 0 0 0 1px rgb(16 16 20 / 22%), 0 0 14px rgb(16 16 20 / 34%);\n  pointer-events: none;\n}\n\n.ofs-compare-handle {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 2px;\n  width: 38px;\n  height: 38px;\n  margin: -19px 0 0 -19px;\n  border: 1px solid rgb(255 255 255 / 40%);\n  border-radius: 50%;\n  background: rgb(20 20 22 / 62%);\n  box-shadow: 0 6px 18px -6px rgb(0 0 0 / 60%);\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n  color: #fff;\n  font-size: 15px;\n  line-height: 1;\n}\n\n.ofs-compare.is-dragging .ofs-compare-handle {\n  background: rgb(20 20 22 / 78%);\n}\n\n/* 两侧标签：原图在左上、当前图在右上，跟着分隔线所在的半区走。 */\n.ofs-compare-tag {\n  position: absolute;\n  top: 10px;\n  z-index: 2;\n  padding: 4px 9px;\n  border: 1px solid rgb(255 255 255 / 22%);\n  border-radius: var(--ofs-r-pill);\n  background: rgb(20 20 22 / 56%);\n  color: #fff;\n  font-size: 11px;\n  letter-spacing: 0.02em;\n  white-space: nowrap;\n  pointer-events: none;\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n}\n\n.ofs-compare-tag--before {\n  left: 10px;\n}\n\n.ofs-compare-tag--after {\n  right: 10px;\n}\n\n/* 键盘聚焦时给一条不遮挡画面的提示线。 */\n.ofs-compare:focus-visible .ofs-compare-divider {\n  background: #fff;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ofs-import-overlay {\n    animation: none;\n  }\n\n  .ofs-import-choose {\n    transition: none;\n  }\n}\n";

// src/styles/responsive.css
var responsive_default = "/*\n * 响应式：这是桌面端的整页工作台，先保桌面；窄窗口按「面板在上、画布在下」收，\n * 不把桌面布局硬挤成不可用的三列。\n */\n\n@media (max-width: 1120px) {\n  .ofs-brand-sub {\n    display: none;\n  }\n\n  .ofs-model-eta,\n  .ofs-model-div {\n    display: none;\n  }\n\n  .ofs-dock-button {\n    padding: 0 9px;\n    font-size: 11px;\n  }\n}\n\n@media (max-width: 980px) {\n  .ofs-root {\n    padding: 10px;\n  }\n\n  .ofs-app {\n    border-radius: var(--ofs-r-lg);\n  }\n\n  .ofs-topbar {\n    gap: 10px;\n    padding: 0 12px;\n    height: 54px;\n  }\n\n  .ofs-brand-name {\n    font-size: 13px;\n  }\n\n  .ofs-tab {\n    padding: 0 9px;\n    font-size: 12px;\n  }\n\n  .ofs-panel {\n    margin: 10px 0 10px 10px;\n  }\n\n  .ofs-main {\n    margin: 10px;\n  }\n\n  .ofs-filmstrip {\n    margin: 0 10px 10px;\n    min-height: 84px;\n    padding: 8px 10px;\n    border-radius: var(--ofs-r-md);\n  }\n\n  .ofs-thumb {\n    width: 54px;\n    height: 54px;\n    border-radius: 10px;\n  }\n\n  .ofs-stage-foot {\n    flex-wrap: wrap;\n    gap: 6px;\n  }\n\n  .ofs-stage-meta {\n    font-size: 10.5px;\n  }\n\n  .ofs-dock {\n    gap: 4px;\n  }\n\n  .ofs-dock-button {\n    height: 28px;\n    padding: 0 8px;\n    font-size: 11px;\n    gap: 4px;\n  }\n\n  .ofs-figure {\n    border-radius: var(--ofs-r-lg);\n  }\n}\n\n/* 窄窗：画布在上、面板在下；面板不再用固定高度窗口装表单，整页纵向滚动。 */\n@media (max-width: 820px) {\n  .ofs-root {\n    padding: 8px;\n    font-size: 12.5px;\n  }\n\n  .ofs-topbar {\n    flex-wrap: wrap;\n    height: auto;\n    min-height: 52px;\n    padding: 8px 10px;\n    row-gap: 6px;\n  }\n\n  .ofs-tabs {\n    margin-left: 0;\n    order: 3;\n    flex: 1 1 100%;\n    justify-content: flex-start;\n  }\n\n  .ofs-compute em {\n    display: none;\n  }\n\n  .ofs-model-wrap {\n    margin-left: auto;\n  }\n\n  /* 画布在上、面板在下：两块都留在视口内，提交后进度不会被整张表单挤出视野。 */\n  .ofs-body,\n  .ofs-body.is-gallery {\n    display: flex;\n    flex-direction: column;\n  }\n\n  .ofs-body > .ofs-main {\n    order: -1;\n  }\n\n  .ofs-main {\n    flex: 0 0 auto;\n    min-height: 0;\n    height: 42vh;\n    margin: 8px;\n  }\n\n  .ofs-body.is-gallery {\n    overflow: hidden;\n  }\n\n  .ofs-body.is-gallery .ofs-main {\n    flex: 1 1 auto;\n    height: auto;\n  }\n\n  .ofs-panel {\n    flex: 1 1 auto;\n    min-height: 0;\n    margin: 0 8px 8px;\n    max-height: none;\n  }\n\n  /* 创作视图改为文档式滚动：外卡自身滚动，表单按内容展开到自然高度。\n     原先面板里只有一个 170~240px 高的内滚动窗口，表单大半不可见，切口落在行中间。 */\n  .ofs-app {\n    overflow-y: auto;\n    overflow-x: hidden;\n  }\n\n  .ofs-body:not(.is-gallery) {\n    flex: 0 0 auto;\n    overflow: visible;\n  }\n\n  .ofs-body:not(.is-gallery) > .ofs-main {\n    width: 100%;\n    max-width: 560px;\n    margin: 8px auto;\n  }\n\n  .ofs-body:not(.is-gallery) > .ofs-panel {\n    flex: 0 0 auto;\n    width: 100%;\n    max-width: 560px;\n    margin: 0 auto 8px;\n  }\n\n  .ofs-body:not(.is-gallery) .ofs-panel-scroll,\n  .ofs-body:not(.is-gallery) .ofs-thread {\n    flex: 0 0 auto;\n    overflow: visible;\n    scrollbar-gutter: auto;\n  }\n\n  /* 生图流水线：窄屏只保留当前节点的文字，其余收成圆点；排队数并入右侧。 */\n  .ofs-pipeline {\n    margin: 8px 10px 0;\n    padding: 0 10px;\n    height: 36px;\n    gap: 8px;\n  }\n\n  .ofs-pipeline.is-hidden {\n    height: 0;\n    margin-top: 0;\n  }\n\n  .ofs-pl-node {\n    padding: 4px 4px;\n    gap: 0;\n  }\n\n  .ofs-pl-node.is-active,\n  .ofs-pl-node.is-warn,\n  .ofs-pl-node.is-failed {\n    gap: 6px;\n    padding: 4px 7px;\n  }\n\n  .ofs-pl-label {\n    display: none;\n  }\n\n  .ofs-pl-node.is-active .ofs-pl-label,\n  .ofs-pl-node.is-warn .ofs-pl-label,\n  .ofs-pl-node.is-failed .ofs-pl-label {\n    display: inline;\n  }\n\n  /* 没有标签就没有计数：否则窄屏上会只剩一个孤零零的说明文字。 */\n  .ofs-pl-sub {\n    display: none;\n  }\n\n  .ofs-pl-node.is-active .ofs-pl-sub {\n    display: inline;\n  }\n\n  .ofs-pl-tag {\n    display: none;\n  }\n\n  .ofs-pl-link {\n    min-width: 8px;\n  }\n\n  .ofs-pl-meta {\n    gap: 8px;\n    padding-left: 10px;\n  }\n\n  .ofs-stage,\n  .ofs-figure {\n    min-height: 0;\n  }\n\n  /* 窄屏不再按比例约束取景框：空态文案要放得下，裁切标记随之收起。 */\n  .ofs-frame {\n    width: 100%;\n    height: 100%;\n    aspect-ratio: auto;\n  }\n\n  .ofs-frame-body {\n    padding: 12px 14px;\n  }\n\n  .ofs-marks {\n    display: none;\n  }\n\n  .ofs-filmstrip {\n    display: none;\n  }\n\n  .ofs-logs-panel {\n    width: 100%;\n    border-left: 0;\n  }\n\n  .ofs-settings-panel {\n    width: 100%;\n    border-left: 0;\n  }\n\n  .ofs-panel-head {\n    padding: 12px 13px 9px;\n  }\n\n  .ofs-panel-scroll {\n    padding: 0 13px 12px;\n  }\n\n  .ofs-panel-foot {\n    padding: 10px 13px 12px;\n  }\n\n  .ofs-toast-stack {\n    top: 58px;\n    right: 10px;\n    left: 10px;\n    max-width: none;\n    align-items: stretch;\n  }\n\n  .ofs-stage-foot {\n    padding: 0 2px;\n  }\n\n  .ofs-stage-prompt {\n    flex: 1 1 100%;\n  }\n\n  .ofs-dock {\n    flex: 0 0 auto;\n    flex-wrap: wrap;\n    gap: 4px;\n  }\n\n  .ofs-composer-input {\n    min-height: 76px;\n  }\n\n  /* 窄窗里自定义宽高仍是「宽 × 高」一行，空间不够时只压缩输入框宽度（min-width: 0） */\n  .ofs-size-custom-field > span {\n    font-size: 11px;\n  }\n}\n\n@media (max-width: 520px) {\n  .ofs-brand-name {\n    font-size: 12.5px;\n  }\n\n  .ofs-tab {\n    height: 26px;\n    padding: 0 8px;\n    font-size: 11.5px;\n  }\n\n  .ofs-model-menu {\n    width: calc(100vw - 20px);\n  }\n\n  .ofs-compute {\n    height: 30px;\n    padding: 0 9px;\n  }\n\n  .ofs-model {\n    height: 30px;\n    padding: 0 8px;\n    gap: 5px;\n  }\n\n  .ofs-model-family {\n    height: 15px;\n    font-size: 9.5px;\n  }\n\n  .ofs-panel-head h2 {\n    font-size: 14px;\n  }\n\n  .ofs-empty-title {\n    font-size: 15px;\n  }\n\n  /* 手机竖屏再收一点画布高度，给表单留出可滚动空间。 */\n  .ofs-main {\n    height: 38vh;\n  }\n}\n\n/*\n * 触屏热区 ≥44px（P2.3）：只在粗指针设备（手指 / 触控笔）生效，\n * 桌面鼠标的紧凑版式不受影响。图标按钮做正方形，文字按钮只抬最小高度。\n */\n@media (pointer: coarse) {\n  .ofs-icon-btn,\n  .ofs-glass-btn,\n  .ofs-lightbox-close {\n    width: 44px;\n    height: 44px;\n  }\n\n  .ofs-popover-row,\n  .ofs-filmstrip-link {\n    height: auto;\n    min-height: 44px;\n  }\n\n  .ofs-tab,\n  .ofs-dock-button,\n  .ofs-chip,\n  .ofs-example,\n  .ofs-suggestion,\n  .ofs-text-action,\n  .ofs-size,\n  .ofs-ghost-cancel,\n  .ofs-gallery-action {\n    height: auto;\n    min-height: 44px;\n  }\n\n  .ofs-gallery-action {\n    padding: 0 12px;\n    font-size: 11px;\n  }\n\n  .ofs-dock-button {\n    padding: 0 12px;\n  }\n}\n";

// src/styles.js
var CSS = [
  tokens_default,
  base_default,
  shell_default,
  pipeline_default,
  model_picker_default,
  guidance_default,
  drawers_default,
  panel_default,
  stage_default,
  filmstrip_default,
  gallery_default,
  chat_default,
  import_default,
  responsive_default
].join("\n");

// src/logic/guidance.js
var KAGGLE_SETTINGS_URL = "https://www.kaggle.com/settings/api";
var KAGGLE_ACCOUNT_URL = "https://www.kaggle.com/settings";
var KAGGLE_INSTALL_COMMAND = "pip install -U kaggle";
var KAGGLE_LOGIN_COMMAND = "kaggle auth login";
var KAGGLE_CREDENTIAL_PATH = "%USERPROFILE%\\.kaggle\\credentials.json";
var KAGGLE_ACCESS_TOKEN_PATH = "%USERPROFILE%\\.kaggle\\access_token";
var KAGGLE_LEGACY_CREDENTIAL_PATH = "%USERPROFILE%\\.kaggle\\kaggle.json";
var COLAB_CREDENTIAL_PATH = "%USERPROFILE%\\.imagen\\colab-credentials.json";
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
var CONNECTION_CODES = /* @__PURE__ */ new Set(["network"]);
function isConnectionCode(code) {
  return CONNECTION_CODES.has(code);
}
function guidanceKindOf(code) {
  if (!code) return "";
  if (code === "need_prompt") return "";
  if (code === "oom") return "oom";
  if (code === "session_ended") return "sleep";
  if (code === "stopped") return "closed";
  if (code === "cli_missing") return "cli";
  if (code === "auth_required") return "auth";
  if (code === "gpu_unavailable") return "gpu";
  if (CONNECTION_CODES.has(code)) return "network";
  if (SESSION_CODES.has(code)) return "session";
  if (GENERATION_CODES.has(code)) return "generate";
  return "generic";
}
var BANNER_KINDS = /* @__PURE__ */ new Set(["auth", "cli", "gpu", "network", "session"]);
function guidanceSurfaceOf(kind) {
  if (!kind) return "";
  return BANNER_KINDS.has(kind) ? "banner" : "toast";
}
var ERROR_TONE_KINDS = /* @__PURE__ */ new Set(["oom", "session", "network", "generate", "generic"]);
function guidanceToneOf(kind) {
  if (!kind) return "";
  return ERROR_TONE_KINDS.has(kind) ? "error" : "warn";
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

// src/studio/ChatPanel.jsx
var import_react3 = __toESM(require("react"), 1);

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

// src/logic/import.js
var MIB = 1024 * 1024;
var HEADER_BYTES = 256 * 1024;
var BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function importMimeOf(file) {
  const record = file && typeof file === "object" ? file : {};
  const rawType = String(record.type ?? "").trim().toLowerCase();
  const type = rawType === "image/jpg" ? "image/jpeg" : rawType;
  if (IMPORT.mimeTypes.includes(type)) return type;
  if (rawType) return "";
  const name = String(record.name ?? "").trim().toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}
function importMaxMiB() {
  return Math.round(IMPORT.maxBytes / MIB);
}
function importFileErrorOf(file) {
  if (!importMimeOf(file)) return "studio.import.invalidType";
  const size = Number(file && file.size);
  if (Number.isFinite(size) && size > IMPORT.maxBytes) return "studio.import.tooLarge";
  return "";
}
function importNameOf(file) {
  const raw = typeof (file && file.name) === "string" ? file.name : "";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, " ").trim();
  return cleaned.slice(0, IMPORT.maxNameChars);
}
function importDragOf(state) {
  const input = state && typeof state === "object" ? state : {};
  if (input.editorOpen === true || input.selecting === true) return "blocked";
  return "stage";
}
function normalizeImportDataUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const failure = { ok: false, errorKey: "studio.import.invalidType", mime: "", base64: "", dataUrl: "" };
  if (!text) return failure;
  let mime = "";
  let payload = text;
  if (/^data:/i.test(text)) {
    const comma = text.indexOf(",");
    if (comma < 0) return failure;
    const meta = text.slice(0, comma);
    const parts = meta.split(";");
    mime = parts[0].replace(/^data:/i, "").trim().toLowerCase();
    mime = mime === "image/jpg" ? "image/jpeg" : mime;
    if (!parts.slice(1).some((part) => part.trim().toLowerCase() === "base64")) return failure;
    if (mime && !IMPORT.mimeTypes.includes(mime)) return failure;
    payload = text.slice(comma + 1);
  }
  const compact = payload.replace(/\s+/g, "");
  if (!compact) return failure;
  const unpadded = compact.replace(/=+$/, "");
  if (!BASE64_RE.test(compact)) return failure;
  if (unpadded.length % 4 === 1) return failure;
  const base64 = unpadded + "=".repeat((4 - unpadded.length % 4) % 4);
  return {
    ok: true,
    errorKey: "",
    mime,
    base64,
    // 裸 base64 没有 MIME，等魔数预检出真实格式后再拼。
    dataUrl: mime ? `data:${mime};base64,${base64}` : ""
  };
}
function decodeBase64Prefix(base64, maxBytes) {
  const decoder = typeof atob === "function" ? atob : null;
  if (!decoder) return null;
  const chars = Math.ceil(maxBytes / 3) * 4;
  let head = String(base64 || "").slice(0, chars).replace(/=+$/, "");
  const rest = head.length % 4;
  if (rest === 1) head = head.slice(0, -1);
  else if (rest === 2) head += "==";
  else if (rest === 3) head += "=";
  try {
    const binary = decoder(head);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}
function readUint32(bytes, offset) {
  return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}
function jpegSizeOf(bytes) {
  let index = 2;
  while (index + 3 < bytes.length) {
    if (bytes[index] !== 255) {
      index += 1;
      continue;
    }
    let marker = bytes[index + 1];
    while (marker === 255 && index + 2 < bytes.length) {
      index += 1;
      marker = bytes[index + 1];
    }
    if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
      index += 2;
      continue;
    }
    if (marker === 217 || marker === 218) return { width: 0, height: 0 };
    if (index + 4 > bytes.length) return { width: 0, height: 0 };
    const length = bytes[index + 2] << 8 | bytes[index + 3];
    if (length < 2) return { width: 0, height: 0 };
    const isSof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
    if (isSof) {
      if (index + 9 > bytes.length) return { width: 0, height: 0 };
      const height = bytes[index + 5] << 8 | bytes[index + 6];
      const width = bytes[index + 7] << 8 | bytes[index + 8];
      return { width, height };
    }
    index += 2 + length;
  }
  return { width: 0, height: 0 };
}
function imageHeaderOf(base64) {
  const bytes = decodeBase64Prefix(base64, HEADER_BYTES);
  if (!bytes || bytes.length < 4) return null;
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    if (bytes.length < 24) return { format: "png", width: 0, height: 0 };
    return { format: "png", width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    const size = jpegSizeOf(bytes);
    return { format: "jpeg", width: size.width, height: size.height };
  }
  return null;
}
function importMetaFoundOf(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.generation && typeof entry.generation === "object") return true;
  const item = entry.item;
  return Boolean(item && typeof item === "object" && item.generation && typeof item.generation === "object");
}
function precheckFailure(errorKey, params) {
  return {
    ok: false,
    errorKey,
    params: params || null,
    mime: "",
    width: 0,
    height: 0,
    base64: "",
    dataUrl: "",
    name: ""
  };
}
function precheckParamsOf(errorKey) {
  if (errorKey === "studio.import.tooLarge") return { size: importMaxMiB() };
  if (errorKey === "studio.import.tooSmall") return { edge: IMPORT.minEdge };
  return null;
}
function importPrecheckOf(input) {
  const state = input && typeof input === "object" ? input : {};
  const file = state.file && typeof state.file === "object" ? state.file : null;
  if (file) {
    const fileError = importFileErrorOf(file);
    if (fileError) return precheckFailure(fileError, precheckParamsOf(fileError));
  }
  const parsed = normalizeImportDataUrl(state.dataUrl);
  if (!parsed.ok) return precheckFailure(parsed.errorKey, null);
  const header = imageHeaderOf(parsed.base64);
  if (!header) return precheckFailure("studio.import.invalidType", null);
  const width = Math.max(0, Number(header.width) || 0);
  const height = Math.max(0, Number(header.height) || 0);
  if (width > 0 && height > 0 && (width < IMPORT.minEdge || height < IMPORT.minEdge)) {
    return precheckFailure("studio.import.tooSmall", precheckParamsOf("studio.import.tooSmall"));
  }
  const mime = `image/${header.format}`;
  return {
    ok: true,
    errorKey: "",
    params: null,
    mime,
    width,
    height,
    base64: parsed.base64,
    dataUrl: `data:${mime};base64,${parsed.base64}`,
    name: importNameOf(file)
  };
}

// src/logic/reference.js
var MIB2 = 1024 * 1024;
var REFERENCE_PATH_ROOT = "imagen-output";
var REFERENCE_BLOCKED_KEY = "studio.reference.blockedUnsupported";
function referenceLimits() {
  const raw = LIMITS && LIMITS.referenceImages && typeof LIMITS.referenceImages === "object" ? LIMITS.referenceImages : {};
  const positive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    maxCount: Math.round(positive(raw.maxCount, 2)),
    maxBytes: positive(raw.maxBytes, 4 * MIB2),
    maxEdge: Math.round(positive(raw.maxEdge, 1024)),
    minEdge: Math.round(positive(raw.minEdge, 128))
  };
}
function referenceMaxCount() {
  return referenceLimits().maxCount;
}
function referenceMaxMiB() {
  return Math.round(referenceLimits().maxBytes / MIB2);
}
function referenceFileName(path) {
  const value = String(path ?? "").trim();
  if (!value) return "";
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}
function referenceUrlOf(path) {
  const value = String(path ?? "").trim();
  if (!value) return "";
  return `${ROUTES.file.path}?path=${encodeURIComponent(value)}`;
}
function referenceSlotPathOf(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.includes("\0")) return "";
  const segments = text.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.length < 2) return "";
  if (segments.some((segment) => segment === ".." || segment === ".")) return "";
  if (segments[0] !== REFERENCE_PATH_ROOT) return "";
  return segments.join("/");
}
function positiveEdge(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}
function referenceItemOf(value) {
  if (typeof value === "string") {
    const path2 = referenceSlotPathOf(value);
    if (!path2) return null;
    return { path: path2, url: referenceUrlOf(path2), width: null, height: null, name: referenceFileName(path2) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const holder = value;
  const image = holder.image && typeof holder.image === "object" ? holder.image : holder;
  const path = referenceSlotPathOf(image.path || holder.path);
  if (!path) return null;
  const url = typeof image.url === "string" && image.url ? image.url : typeof holder.url === "string" && holder.url ? holder.url : referenceUrlOf(path);
  const name = typeof holder.name === "string" && holder.name.trim() || typeof image.file === "string" && image.file.trim() || referenceFileName(path);
  return {
    path,
    url,
    width: positiveEdge(image.width ?? holder.width),
    height: positiveEdge(image.height ?? holder.height),
    name
  };
}
function referenceListOf(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const max = referenceMaxCount();
  for (const raw of list) {
    const item = referenceItemOf(raw);
    if (!item || seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
function referenceAdd(list, value) {
  const current = referenceListOf(list);
  const item = referenceItemOf(value);
  if (!item) return { ok: false, reason: "invalid", list: current, item: null };
  if (current.some((entry) => entry.path === item.path)) {
    return { ok: false, reason: "duplicate", list: current, item };
  }
  if (current.length >= referenceMaxCount()) {
    return { ok: false, reason: "full", list: current, item };
  }
  return { ok: true, reason: "added", list: [...current, item], item };
}
function referenceRemove(list, path) {
  const target = referenceSlotPathOf(path);
  const current = referenceListOf(list);
  if (!target) return current;
  return current.filter((item) => item.path !== target);
}
function referenceHas(list, path) {
  const target = referenceSlotPathOf(path);
  if (!target) return false;
  return referenceListOf(list).some((item) => item.path === target);
}
function referencePurgeOf(list, paths) {
  const removed = new Set((Array.isArray(paths) ? paths : []).map((path) => referenceSlotPathOf(path)).filter(Boolean));
  const current = referenceListOf(list);
  if (removed.size === 0) return current;
  return current.filter((item) => !removed.has(item.path));
}
function referenceFingerprintOf(value) {
  return referenceListOf(value).map((item) => item.path).join("\n");
}
function referencePathsOf(value) {
  return referenceListOf(value).map((item) => item.path);
}
function supportsReferenceOf(preset) {
  return Boolean(preset && typeof preset === "object" && preset.supportsReference === true);
}
function nativeReferencePresetOf(presets) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : [];
  return list.find(supportsReferenceOf) || null;
}
function referenceCapabilityOf(preset, references) {
  const paths = referencePathsOf(references);
  if (paths.length === 0) return { ok: true, paths, blockedKey: "" };
  if (supportsReferenceOf(preset)) return { ok: true, paths, blockedKey: "" };
  return { ok: false, paths, blockedKey: REFERENCE_BLOCKED_KEY };
}
function referenceFileErrorOf(file) {
  if (!importMimeOf(file)) return { key: "studio.import.invalidType", params: null };
  const size = Number(file && file.size);
  if (Number.isFinite(size) && size > referenceLimits().maxBytes) {
    return { key: "studio.reference.tooLarge", params: { size: referenceMaxMiB() } };
  }
  return null;
}

// src/logic/chat.js
var MAX_RESULT_IMAGES = LIMITS.count.max;
var MIRROR_TOOLS = Object.freeze(["inpaint", "img2img", "upscale", "outpaint"]);
function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberOrNull(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function positiveOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && number > 0 ? Math.round(number) : null;
}
function imageOf(raw) {
  const source = raw && typeof raw === "object" ? raw : null;
  if (!source) return null;
  const path = textOf(source.path);
  const url = textOf(source.url) || referenceUrlOf(path);
  if (!path && !url) return null;
  return {
    url,
    path,
    width: positiveOrNull(source.width),
    height: positiveOrNull(source.height),
    seed: numberOrNull(source.seed),
    seconds: numberOrNull(source.seconds)
  };
}
function imagesOfJob(job) {
  const output = job && typeof job === "object" && job.output && typeof job.output === "object" ? job.output : null;
  const list = output && Array.isArray(output.images) ? output.images : [];
  return list.slice(0, MAX_RESULT_IMAGES).map(imageOf).filter(Boolean);
}
function gridImagesOf(message) {
  const source = message && typeof message === "object" ? message : null;
  if (!source) return [];
  const list = Array.isArray(source.images) ? source.images : [];
  const images = list.slice(0, MAX_RESULT_IMAGES).map(imageOf).filter(Boolean);
  if (images.length > 0) return images;
  const legacy = imageOf({ url: source.image, path: source.imagePath });
  return legacy ? [legacy] : [];
}
function imagesKeyOf(images) {
  const list = Array.isArray(images) ? images : [];
  return list.map((image) => image && (image.path || image.url) || "").join("|");
}
function imageMetaOf(t, image) {
  if (!image || typeof image !== "object") return "";
  const parts = [];
  if (image.seconds !== null && image.seconds !== void 0) parts.push(formatSeconds(t, image.seconds));
  if (image.seed !== null && image.seed !== void 0) parts.push(`${t("studio.meta.seed")} ${image.seed}`);
  return parts.join(" · ");
}
function gridLabelOf(t, count) {
  return formatText(t("studio.chat.gridLabel"), { count });
}
function bubblePatch(t, job, current) {
  const base = current && typeof current === "object" ? current : {};
  if (!job || typeof job !== "object") return null;
  if (job.status === "waiting-session") return { stage: "queued", text: t("studio.chat.waitingSession") };
  if (job.status === "queued") return { stage: "queued", text: t("studio.chat.queued") };
  if (job.status === "running") return { stage: "running", text: t("studio.chat.running") };
  if (job.status === "done") {
    const produced = imagesOfJob(job);
    const kept = Array.isArray(base.images) ? base.images : [];
    const images = produced.length > 0 ? produced : kept;
    const first = images[0] || null;
    return {
      stage: "done",
      text: t("studio.chat.done"),
      images,
      image: first ? first.url : base.image,
      imagePath: first ? first.path : base.imagePath,
      meta: first ? imageMetaOf(t, first) : base.meta
    };
  }
  if (job.status === "failed") {
    return { stage: "failed", text: errorText(t, job.error || { code: "", message: "" }) };
  }
  return null;
}
function bubbleUnchanged(current, patch) {
  const before = current && typeof current === "object" ? current : {};
  return before.stage === patch.stage && before.text === patch.text && before.image === patch.image && imagesKeyOf(before.images) === imagesKeyOf(patch.images);
}
function focusEntryOf(input) {
  const source = input && typeof input === "object" ? input : {};
  const image = imageOf(source.image);
  if (!image) return null;
  const index = numberOrNull(source.index);
  const count = numberOrNull(source.count);
  return {
    messageId: source.messageId ?? null,
    index: index === null ? 0 : Math.max(0, Math.trunc(index)),
    count: count === null || count < 1 ? 1 : Math.min(MAX_RESULT_IMAGES, Math.trunc(count)),
    ...image
  };
}
function pushFocus(stack, entry) {
  const list = Array.isArray(stack) ? stack : [];
  return entry ? [...list, entry] : list;
}
function popFocus(stack) {
  return Array.isArray(stack) && stack.length > 0 ? stack.slice(0, -1) : [];
}
function currentFocusOf(stack) {
  return Array.isArray(stack) && stack.length > 0 ? stack[stack.length - 1] : null;
}
function focusNameOf(t, entry) {
  const title = t("studio.chat.focus.title");
  const seed = entry && entry.seed !== null && entry.seed !== void 0 ? entry.seed : null;
  return seed === null ? title : `${title} · ${t("studio.meta.seed")} ${seed}`;
}
function focusBackLabelOf(t, stack) {
  const current = currentFocusOf(stack);
  if (!current) return "";
  if (stack.length <= 1) return formatText(t("studio.chat.focus.batch"), { count: current.count });
  return focusNameOf(t, stack[stack.length - 2]);
}
function strengthLabelOf(t, value) {
  const number = numberOrNull(value);
  if (number === null) return "";
  return formatText(t("studio.chat.tool.strength"), { value: Math.round(number * 100) / 100 });
}
function strengthOfBody(body) {
  const reference = body && typeof body === "object" && body.reference && typeof body.reference === "object" ? body.reference : null;
  return reference ? numberOrNull(reference.strength) : null;
}
function mirrorToolEntries(t, input) {
  const source = input && typeof input === "object" ? input : {};
  const tool = MIRROR_TOOLS.includes(source.tool) ? source.tool : "";
  if (!tool) return [];
  const job = source.job && typeof source.job === "object" ? source.job : null;
  const jobId = job ? textOf(job.id) : "";
  if (!jobId) return [];
  const target = source.target && typeof source.target === "object" ? source.target : null;
  const image = target ? imageOf({ url: target.url, path: target.path }) : null;
  if (!image) return [];
  const strength = strengthOfBody(source.body);
  const record = {
    role: "user",
    kind: "tool",
    tool,
    text: t(`studio.chat.tool.${tool}`),
    image: image.url,
    imagePath: image.path,
    width: image.width,
    height: image.height
  };
  if (strength !== null) record.strength = strength;
  return [
    record,
    { role: "assistant", kind: "job", jobId, stage: "pending", text: t("studio.chat.pending") }
  ];
}

// shared/validation.js
var HF_REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function textOf2(value) {
  return typeof value === "string" ? value.trim() : "";
}
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
function isValidHfRepoId(repo) {
  return typeof repo === "string" && HF_REPO_ID_RE.test(repo);
}
function isValidContainerPath(path, maxChars = SETTINGS.maxItemChars) {
  return typeof path === "string" && path.startsWith("/") && !/[\s\0]/.test(path) && path.length <= maxChars;
}
function normalizeKaggleTransport(value) {
  return typeof value === "string" && SETTINGS.kaggleTransports.includes(value) ? value : SETTINGS.defaultKaggleTransport;
}
function historyMessages(value) {
  if (!Array.isArray(value)) return [];
  const { maxMessages, maxMessageChars } = LIMITS.intentHistory;
  const messages = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : "";
    if (!role) continue;
    const content = textOf2(entry.content);
    if (!content) continue;
    messages.push({ role, content: content.slice(0, maxMessageChars) });
  }
  return messages.slice(-maxMessages);
}
function normalizeClarify(value) {
  if (!isPlainObject(value)) return null;
  const question = textOf2(value.question).slice(0, INTENT.clarifyQuestionMaxChars);
  if (!question) return null;
  const options = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of Array.isArray(value.options) ? value.options : []) {
    const option = textOf2(item).slice(0, INTENT.clarifyOptionMaxChars);
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (options.length >= INTENT.clarifyMaxOptions) break;
  }
  if (options.length < INTENT.clarifyMinOptions) return null;
  return { question, options };
}
function normalizeModelHint(value, currentPresetOrId, options = {}) {
  if (!isPlainObject(value)) return null;
  const currentId = typeof currentPresetOrId === "string" ? currentPresetOrId.trim() : isPlainObject(currentPresetOrId) ? textOf2(currentPresetOrId.id) : "";
  const presetId = textOf2(value.presetId);
  if (!presetId || !currentId || presetId === currentId) return null;
  const presets = Array.isArray(options.presets) ? options.presets : publicPresets();
  const target = presets.find((preset) => preset && preset.id === presetId);
  if (!target) return null;
  let reason = textOf2(value.reason);
  if (!reason && options.fallbackToDescription === true) {
    const description = isPlainObject(target.description) ? target.description : {};
    const locale = options.locale === "en" ? "en" : "zh";
    reason = textOf2(locale === "en" ? description.en || description.zh : description.zh || description.en);
  }
  reason = reason.slice(0, INTENT.modelHintReasonMaxChars);
  if (!reason) return null;
  return { presetId: target.id, reason };
}
var UI_STATE_FIELDS = Object.freeze(Object.keys(UI_STATE.defaults));
function normalizeUiState(value) {
  const source = isPlainObject(value) ? value : {};
  const view = {};
  for (const field of UI_STATE_FIELDS) {
    const fallback = UI_STATE.defaults[field];
    view[field] = typeof source[field] === typeof fallback ? source[field] : fallback;
  }
  return view;
}
function buildUiStatePatch(partial) {
  const source = isPlainObject(partial) ? partial : {};
  const patch = {};
  for (const field of UI_STATE_FIELDS) {
    if (!hasOwn(source, field)) continue;
    if (typeof source[field] !== typeof UI_STATE.defaults[field]) continue;
    patch[field] = source[field];
  }
  return patch;
}

// src/logic/intent.js
var INTENT_EDITABLE_FIELDS = ["prompt", "negative", "count"];
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
function intentHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const history = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    let role = "";
    let content = "";
    if (message.role === "user") {
      if (message.kind) continue;
      role = "user";
      content = typeof message.text === "string" ? message.text.trim() : "";
    } else if (message.role === "assistant" && message.kind === "intent") {
      role = "assistant";
      const prompt = typeof message.prompt === "string" ? message.prompt.trim() : "";
      const question = message.clarify && typeof message.clarify === "object" && typeof message.clarify.question === "string" ? message.clarify.question.trim() : "";
      if (prompt && question) {
        const suffix = `
[Clarify] ${question}`;
        const headLimit = Math.max(0, LIMITS.intentHistory.maxMessageChars - suffix.length);
        content = `${prompt.slice(0, headLimit).trimEnd()}${suffix}`;
      } else {
        content = prompt || question;
      }
    }
    if (role && content) history.push({ role, content });
  }
  return historyMessages(history);
}
function intentCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(LIMITS.count.max, Math.max(LIMITS.count.min, Math.round(number)));
}
function intentClarify(value) {
  return normalizeClarify(value);
}
function intentModelHint(value, currentPresetId) {
  return normalizeModelHint(value, currentPresetId);
}
function intentRatio(value) {
  return typeof value === "string" && RATIO_IDS.includes(value) ? value : "";
}
function intentFormPatch(intent, ratios, options = {}) {
  const patch = {};
  if (!intent || typeof intent !== "object") return patch;
  const prompt = typeof intent.prompt === "string" ? intent.prompt.trim() : "";
  if (prompt) patch.prompt = prompt;
  const ratio = (Array.isArray(ratios) ? ratios : []).find((item) => item && item.id === intent.ratioId);
  if (ratio) {
    patch.width = ratio.width;
    patch.height = ratio.height;
  }
  patch.count = intentCount(intent.count);
  if (options && options.negativeActive === true) patch.negative = intentNegative(intent.negative);
  return patch;
}
function intentFieldPatch(field, value) {
  if (!INTENT_EDITABLE_FIELDS.includes(field)) return null;
  if (field === "count") return { count: intentCount(value) };
  const text = typeof value === "string" ? value : "";
  const max = field === "prompt" ? LIMITS.prompt.maxChars : LIMITS.negativePrompt.maxChars;
  return { [field]: text.slice(0, max) };
}
function intentNegative(value) {
  return (typeof value === "string" ? value.trim() : "").slice(0, LIMITS.negativePrompt.maxChars);
}
function intentOverrides(intent, options = {}) {
  const prompt = intent && typeof intent.prompt === "string" ? intent.prompt.trim() : "";
  if (!prompt) return null;
  const negativeActive = Boolean(options && options.negativeActive === true);
  return {
    prompt,
    count: intentCount(intent.count),
    negativePrompt: negativeActive ? intentNegative(intent.negative) : ""
  };
}
function lastSeedOf(lastJob) {
  const params = lastJob && lastJob.params || null;
  const seed = params ? Number(params.seed) : NaN;
  return Number.isFinite(seed) && seed >= 0 ? Math.trunc(seed) : null;
}
function intentSeedOf(intent, lastJob, formSeed) {
  if (!intent || intent.lockSeed !== true) return null;
  const explicit = typeof formSeed === "string" ? formSeed.trim() !== "" : formSeed !== null && formSeed !== void 0;
  if (explicit) return null;
  return lastSeedOf(lastJob);
}

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
  trash: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.6 7.2h14.8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.4 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.6 7.2l.8 11.1a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.8-11.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.2 11.2v5.2M13.8 11.2v5.2" })
  ] }),
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
  // 扩图画框：外层取景角 + 内层内容框，表达「原图放进更大的画布」。
  frame: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 9V5.8a1.8 1.8 0 0 1 1.8-1.8H9M15 4h3.2A1.8 1.8 0 0 1 20 5.8V9M20 15v3.2a1.8 1.8 0 0 1-1.8 1.8H15M9 20H5.8A1.8 1.8 0 0 1 4 18.2V15" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "9.2", y: "9.2", width: "5.6", height: "5.6", rx: "0.8" })
  ] }),
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

// src/studio/PanelModeTabs.jsx
var import_react2 = __toESM(require("react"), 1);
var import_jsx_runtime2 = require("react/jsx-runtime");
function PanelModeTabs({ t, mode, setMode, onNewCreation }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "ofs-panel-head", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ofs-panel-head-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: t("studio.rail.title") }),
      typeof onNewCreation === "function" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "button",
        {
          type: "button",
          className: "ofs-chip ofs-head-new",
          title: t("studio.rail.newCreation"),
          onClick: onNewCreation,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "plus", size: 13 }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("studio.rail.newCreation") })
          ]
        }
      ) : null
    ] }),
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
  ] });
}

// src/studio/ChatPanel.jsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var WORKING_STAGES = ["pending", "queued", "running"];
function isWorking(stage) {
  return WORKING_STAGES.indexOf(stage) >= 0;
}
function dotClass(stage) {
  if (stage === "failed") return "ofs-dot ofs-chat-dot is-error";
  if (isWorking(stage)) return "ofs-dot ofs-chat-dot is-warn is-live";
  return "ofs-dot ofs-chat-dot is-ok";
}
function ratioLabel(t, ratioId) {
  return ratioId || t("studio.chat.ratioAuto");
}
var PUBLIC_PRESET_LIST = publicPresets();
var MIRROR_TOOL_IDS = Object.freeze(["inpaint", "img2img", "upscale", "outpaint"]);
function modelLabelOf(presetId) {
  const preset = PUBLIC_PRESET_LIST.find((item) => item && item.id === presetId);
  return preset ? preset.label || preset.short || preset.id : "";
}
function formSyncTitle(t, source) {
  if (source === "variant") return t("studio.chat.formSync.variant");
  if (source === "retry") return t("studio.chat.formSync.retry");
  return t("studio.chat.formSync.form");
}
function formSyncChips(t, message) {
  const summary = message && message.summary && typeof message.summary === "object" ? message.summary : null;
  if (!summary) return [];
  const chips = [];
  const model = modelLabelOf(summary.presetId) || (typeof summary.presetId === "string" ? summary.presetId : "");
  if (model) chips.push({ key: "model", text: model });
  const width = Number(summary.width);
  const height = Number(summary.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    const size = `${Math.round(width)} × ${Math.round(height)}`;
    chips.push({
      key: "size",
      text: typeof summary.ratioId === "string" && summary.ratioId ? `${summary.ratioId} · ${size}` : size
    });
  }
  const count = Number(summary.count);
  if (Number.isFinite(count) && count > 0) {
    chips.push({ key: "count", text: `${Math.round(count)} ${t("unit.image")}` });
  }
  const seedValue = summary.seed;
  const seed = seedValue === null || seedValue === void 0 || seedValue === "" ? NaN : Number(seedValue);
  if (Number.isFinite(seed) && seed >= 0) {
    chips.push({ key: "seed", text: formatText(t("studio.chat.formSync.seed"), { seed: Math.trunc(seed) }) });
  } else {
    chips.push({ key: "seed", text: t("studio.chat.formSync.seedRandom") });
  }
  return chips;
}
function ChatPanel(props) {
  const { t, ui, form, chat, library, actions } = props;
  const { panelMode: mode, setPanelMode: setMode } = ui;
  const {
    messages,
    interpreting,
    interpret,
    updateIntentField,
    generateIntent,
    handoffIntent,
    toggleIntentLockSeed,
    canLockSeed,
    resolveClarify,
    newChat,
    // 阶段十五 Phase A2：单图聚焦返回栈（旧宿主 / 测试替身可以只给部分字段）。
    focus,
    focusBack,
    focusBackLabel,
    focusImage
  } = chat;
  const { openMessage: openImage } = library;
  const { sending } = actions;
  const negativeActive = Boolean(form && form.negativeActive === true);
  const [draft, setDraft] = import_react3.default.useState("");
  const threadRef = import_react3.default.useRef(null);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastStage = lastMessage && lastMessage.stage || "";
  import_react3.default.useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [messages.length, lastStage, interpreting]);
  function send() {
    const text = draft.trim();
    if (!text || sending || interpreting) return;
    setDraft("");
    interpret(text);
  }
  function startNewChat() {
    if (typeof newChat === "function") newChat();
    setDraft("");
  }
  function openPath(path) {
    const target = typeof path === "string" ? path.trim() : "";
    if (target && typeof openImage === "function") openImage(target);
  }
  function libraryEntryOf(path) {
    const target = typeof path === "string" ? path.trim() : "";
    if (!target) return null;
    const gallery = Array.isArray(library && library.gallery) ? library.gallery : [];
    const found = gallery.find((entry) => entry && entry.image && entry.image.path === target);
    if (found) return found;
    const items = Array.isArray(library && library.items) ? library.items : [];
    for (const item of items) {
      const images = item && Array.isArray(item.images) ? item.images : [];
      const image = images.find((candidate) => candidate && candidate.path === target);
      if (image) return { image, item };
    }
    return null;
  }
  function openGridImage(message, image, index) {
    const path = image && typeof image.path === "string" ? image.path : "";
    if (path) openPath(path);
    if (typeof focusImage === "function") focusImage(message, image, index);
  }
  function backFromFocus() {
    if (typeof focusBack !== "function") return;
    const next = focusBack();
    const path = next && typeof next.path === "string" ? next.path : "";
    if (path) openPath(path);
  }
  function focusEntryOfPath() {
    if (!focus) return null;
    const found = libraryEntryOf(focus.path);
    if (found) return found;
    return {
      image: { path: focus.path, url: focus.url, width: focus.width, height: focus.height },
      item: null
    };
  }
  function compareFocus(entry) {
    if (!entry || !entry.item || !entry.item.sourceImage) return;
    if (!ui || typeof ui.setCompareOpen !== "function") return;
    const targetPath = entry.image && typeof entry.image.path === "string" ? entry.image.path.trim() : "";
    const stagePath = library && library.selected && library.selected.image && typeof library.selected.image.path === "string" ? library.selected.image.path.trim() : "";
    if (targetPath && targetPath !== stagePath) {
      openPath(targetPath);
      ui.setCompareOpen(true);
      return;
    }
    ui.setCompareOpen(!ui.compareOpen);
  }
  function continueFocus(entry) {
    if (!entry || !actions || typeof actions.openImageTool !== "function") return;
    actions.openImageTool("inpaint", entry);
  }
  function regenerateFocus(entry) {
    if (!entry || !actions || typeof actions.reroll !== "function") return;
    actions.reroll(entry);
  }
  function zoomFocus() {
    if (focus && focus.path) openPath(focus.path);
    if (ui && typeof ui.setZoom === "function") ui.setZoom(true);
  }
  function handoff(message) {
    if (typeof handoffIntent !== "function") return;
    if (!handoffIntent(message)) return;
    if (typeof setMode === "function") setMode("form");
    if (ui && typeof ui.showToast === "function") ui.showToast(t("studio.chat.intent.handoffDone"));
  }
  function renderToolSync(message) {
    const tool = MIRROR_TOOL_IDS.includes(message.tool) ? message.tool : "";
    const title = tool ? t(`studio.chat.tool.${tool}`) : typeof message.text === "string" ? message.text : "";
    const strength = tool && message.strength !== void 0 && message.strength !== null ? strengthLabelOf(t, message.strength) : "";
    const path = typeof message.imagePath === "string" ? message.imagePath : "";
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-msg ofs-tool-sync", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card ofs-tool-sync-card", children: [
      message.image ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-tool-sync-thumb",
          onClick: () => openPath(path),
          title,
          "aria-label": title,
          children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { src: message.image, alt: "", loading: "lazy" })
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-tool-sync-body", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-tool-sync-title", children: title }),
        strength ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-tool-sync-chips", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chip ofs-tool-sync-chip", children: strength }) }) : null
      ] })
    ] }) }, message.id);
  }
  function renderFormSync(message) {
    const chips = formSyncChips(t, message);
    const prompt = typeof message.text === "string" ? message.text : "";
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-msg ofs-form-sync", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card ofs-form-sync-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-form-sync-title", children: formSyncTitle(t, message.source) }),
      prompt ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-form-sync-prompt", title: prompt, children: prompt }) : null,
      chips.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-form-sync-chips", children: chips.map((chip) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chip ofs-form-sync-chip", children: chip.text }, chip.key)) }) : null
    ] }) }, message.id);
  }
  function renderClarify(message) {
    const clarify = message.clarify;
    const question = clarify && typeof clarify.question === "string" ? clarify.question : "";
    const options = clarify && Array.isArray(clarify.options) ? clarify.options : [];
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card ofs-intent ofs-intent-clarify", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-title", children: t("studio.chat.clarify.title") }),
      question ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-intent-question", children: question }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-suggestions", children: [
        options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-suggestion",
            onClick: () => resolveClarify(message.id, option),
            children: option
          },
          option
        )),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-suggestion", onClick: () => resolveClarify(message.id, ""), children: t("studio.chat.clarify.auto") })
      ] })
    ] }, message.id);
  }
  function renderIntent(message) {
    if (message.clarify) return renderClarify(message);
    const editField = typeof updateIntentField === "function" ? updateIntentField : () => {
    };
    const promptValue = typeof message.prompt === "string" ? message.prompt : "";
    const negativeValue = typeof message.negative === "string" ? message.negative : "";
    const canGenerate = promptValue.trim().length > 0;
    const summary = typeof message.summary === "string" ? message.summary.trim() : "";
    const showSummary = summary.length > 0 && summary !== promptValue.trim();
    const count = intentCount(message.count);
    const hint = message.modelHint && typeof message.modelHint === "object" ? message.modelHint : null;
    const hintModel = hint ? modelLabelOf(hint.presetId) : "";
    const hintText = hint && hintModel && typeof hint.reason === "string" ? formatText(t("studio.chat.intent.modelHint"), { model: hintModel, reason: hint.reason }) : "";
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card ofs-intent", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-title", children: t("studio.chat.intent.title") }),
      showSummary ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "ofs-intent-summary", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-summary-label", children: t("studio.chat.intent.summary") }),
        summary
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-intent-edit-hint", children: t("studio.chat.intent.editHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "ofs-intent-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-field-label", children: t("studio.chat.intent.promptLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "textarea",
          {
            className: "ofs-intent-prompt",
            rows: 2,
            value: promptValue,
            maxLength: LIMITS.prompt.maxChars,
            spellCheck: false,
            "aria-label": t("studio.chat.intent.promptLabel"),
            onChange: (event) => editField(message.id, "prompt", event.target.value)
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-intent-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("studio.rail.ratio") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: ratioLabel(t, message.ratioId) })
      ] }),
      hintText ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-intent-model-hint", children: hintText }) : null,
      negativeActive ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "ofs-intent-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-field-label", children: t("studio.chat.intent.negativeLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "textarea",
          {
            className: "ofs-intent-negative",
            rows: 2,
            value: negativeValue,
            maxLength: LIMITS.negativePrompt.maxChars,
            placeholder: t("studio.chat.intent.negativePlaceholder"),
            spellCheck: false,
            "aria-label": t("studio.chat.intent.negativeLabel"),
            onChange: (event) => editField(message.id, "negative", event.target.value)
          }
        )
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-intent-qty-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-intent-qty-label", children: t("studio.countShort") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-intent-qty", role: "group", "aria-label": t("studio.count"), children: COUNT_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: option === count ? "ofs-intent-qty-option is-on" : "ofs-intent-qty-option",
            "aria-pressed": option === count,
            onClick: () => editField(message.id, "count", option),
            children: option
          },
          option
        )) })
      ] }),
      message.source === "local" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-intent-note", children: t("studio.chat.intent.local") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: canLockSeed === false ? "ofs-intent-lock is-disabled" : "ofs-intent-lock", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            type: "checkbox",
            checked: message.lockSeed === true,
            disabled: canLockSeed === false,
            onChange: () => toggleIntentLockSeed(message.id)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("studio.chat.intent.lockSeed") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-intent-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-btn is-primary ofs-intent-go",
            onClick: () => generateIntent(message),
            disabled: sending || !canGenerate,
            children: sending ? t("studio.generating") : t("studio.chat.intent.generate")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-btn is-quiet ofs-intent-handoff",
            onClick: () => handoff(message),
            disabled: sending || !canGenerate,
            children: t("studio.chat.intent.handoff")
          }
        )
      ] })
    ] }, message.id);
  }
  function renderResultGrid(message) {
    const images = gridImagesOf(message);
    if (images.length === 0) return null;
    const single = images.length === 1;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: single ? "ofs-msg-grid is-single" : "ofs-msg-grid",
        role: "group",
        "aria-label": gridLabelOf(t, images.length),
        children: [
          images.map((image, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-msg-grid-item",
              onClick: () => openGridImage(message, image, index),
              title: imageMetaOf(t, image) || void 0,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { src: image.url, alt: "", loading: "lazy" }),
                single ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-msg-grid-index", "aria-hidden": "true", children: index + 1 })
              ]
            },
            image.path || image.url || index
          )),
          single ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-msg-grid-label", children: gridLabelOf(t, images.length) })
        ]
      }
    );
  }
  function renderAssistant(message) {
    if (message.kind === "intent") return renderIntent(message);
    if (message.kind === "error") {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-msg-card", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: message.text }) }, message.id);
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: message.text }),
      isWorking(message.stage) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chat-shimmer", "aria-hidden": "true" }) : null,
      renderResultGrid(message)
    ] }, message.id);
  }
  function renderBreadcrumb() {
    if (!focus) return null;
    const label = typeof focusBackLabel === "string" ? focusBackLabel : "";
    const text = label ? formatText(t("studio.chat.focus.back"), { label }) : t("studio.chat.focus.empty");
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-chat-breadcrumb", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-back", onClick: backFromFocus, children: `← ${text}` }) });
  }
  function renderFocus() {
    if (!focus) return null;
    const entry = focusEntryOfPath();
    const image = entry && entry.image ? entry.image : focus;
    const src = image && typeof image.url === "string" && image.url ? image.url : focus.url;
    const meta = imageMetaOf(t, {
      seconds: focus.seconds,
      seed: focus.seed
    });
    const canCompare = Boolean(entry && entry.item && entry.item.sourceImage);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-focus", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-focus-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chat-focus-title", children: t("studio.chat.focus.title") }),
        focus.count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chip ofs-chat-focus-batch", children: gridLabelOf(t, focus.count) }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-chat-focus-figure", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { src, alt: "" }) }),
      meta ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-chat-focus-meta", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chip ofs-chat-focus-chip", children: meta }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-focus-actions", children: [
        canCompare ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-focus-action", onClick: () => compareFocus(entry), children: t("studio.chat.actions.compare") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-focus-action", onClick: () => continueFocus(entry), children: t("studio.chat.actions.continueInpaint") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-focus-action", onClick: () => regenerateFocus(entry), children: t("studio.chat.actions.regenerate") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-focus-action", onClick: zoomFocus, children: t("studio.chat.actions.zoom") })
      ] })
    ] });
  }
  const startNewCreation = form && typeof form.newCreation === "function" ? form.newCreation : actions && typeof actions.newDraft === "function" ? actions.newDraft : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("aside", { className: "ofs-panel ofs-panel--chat", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PanelModeTabs, { t, mode, setMode, onNewCreation: startNewCreation }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: messages.length === 0 && !interpreting ? "ofs-thread is-empty" : "ofs-thread",
        ref: threadRef,
        role: "log",
        "aria-live": "polite",
        children: [
          messages.length === 0 && !interpreting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "ofs-chat-empty-text", children: t("studio.chat.empty") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-chat-examples", children: INSPIRE_KEYS.map((key) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "ofs-chip ofs-chat-example",
                onClick: () => setDraft(t(key)),
                title: t(key),
                children: t(`${key}.label`)
              },
              key
            )) })
          ] }) : null,
          focus ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            renderBreadcrumb(),
            renderFocus()
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            messages.map((message) => {
              if (message.role === "user") {
                if (message.kind === "form") return renderFormSync(message);
                if (message.kind === "tool") return renderToolSync(message);
                return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-msg ofs-msg--user", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: message.text }) }, message.id);
              }
              return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg ofs-msg--assistant", children: [
                message.kind === "intent" || message.kind === "error" ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-author", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: dotClass(message.stage), "aria-hidden": "true" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chat-author-name", children: t("studio.chat.assistant") })
                ] }),
                renderAssistant(message)
              ] }, message.id);
            }),
            interpreting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-msg ofs-msg--assistant", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-msg-card is-working", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("studio.chat.parsing") }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ofs-chat-shimmer", "aria-hidden": "true" })
            ] }) }) : null
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-dock", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ofs-chat-tools", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ofs-chip ofs-chat-new", onClick: startNewChat, disabled: messages.length === 0, children: t("studio.chat.newChat") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ofs-chat-composer", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chat-send",
            onClick: send,
            disabled: sending || interpreting || draft.trim().length === 0,
            "aria-label": t("studio.chat.send"),
            title: t("studio.chat.send"),
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "arrowUp", size: 15 })
          }
        )
      ] })
    ] })
  ] });
}

// src/studio/Filmstrip.jsx
var import_react6 = __toESM(require("react"), 1);

// src/hooks/useNow.js
function useNow(enabled) {
  const [now, setNow] = import_react.default.useState(() => Date.now());
  import_react.default.useEffect(() => {
    if (!enabled) return void 0;
    setNow(Date.now());
    const timer2 = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer2);
  }, [enabled]);
  return now;
}

// src/logic/lineage.js
var DRAFT_LRU_LIMIT = 8;
var DRAFT_CHANGE_KEYS = Object.freeze(["mask", "prompt", "params"]);
var PENDING_STATUS = Object.freeze({
  queued: true,
  running: true,
  "waiting-session": true
});
var LINEAGE_KINDS = Object.freeze(["text", "img2img", "inpaint", "upscale", "outpaint"]);
var MAX_DEPTH = 64;
var KIND_TEXT = "text";
var KIND_IMG2IMG = "img2img";
var KIND_INPAINT = "inpaint";
var KIND_UPSCALE = "upscale";
var KIND_OUTPAINT = "outpaint";
var ALPHABET = "abcdefghijklmnopqrstuvwxyz";
function textOf3(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberOrNull2(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function timestampOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function createdAtOf(source) {
  if (!source || typeof source !== "object") return null;
  for (const key of ["finishedAt", "createdAt", "mtime", "startedAt"]) {
    const value = timestampOf(source[key]);
    if (value !== null) return value;
  }
  return null;
}
function imagePathOf(image) {
  if (!image || typeof image !== "object") return "";
  return textOf3(image.path);
}
function itemKeyOf(item, index) {
  if (!item || typeof item !== "object") return `raw:${index}`;
  return textOf3(item.jobId) || textOf3(item.dir) || `raw:${textOf3(item.prompt)}:${index}`;
}
function pendingParentOf(job) {
  if (!job || typeof job !== "object") return "";
  const direct = textOf3(job.parentPath);
  if (direct) return direct;
  const params = job.params && typeof job.params === "object" ? job.params : null;
  if (params) {
    const reference = params.reference && typeof params.reference === "object" ? params.reference : null;
    if (reference) {
      const path = textOf3(reference.path) || textOf3(reference.sourcePath);
      if (path) return path;
    }
    const source = textOf3(params.sourceImage);
    if (source) return source;
  }
  return textOf3(job.sourceImage);
}
function pendingKindOf(job) {
  if (!job || typeof job !== "object") return KIND_TEXT;
  const tool = textOf3(job.tool);
  if (tool === "upscale") return KIND_UPSCALE;
  if (tool === "outpaint") return KIND_OUTPAINT;
  const mode = textOf3(job.sourceMode);
  if (LINEAGE_KINDS.includes(mode)) return mode;
  const params = job.params && typeof job.params === "object" ? job.params : null;
  const reference = params && params.reference && typeof params.reference === "object" ? params.reference : null;
  if (!reference) return KIND_TEXT;
  const mask = reference.mask;
  if (mask === true) return KIND_INPAINT;
  if (mask && typeof mask === "object" && typeof mask.data === "string" && mask.data) return KIND_INPAINT;
  return KIND_IMG2IMG;
}
function pendingRootOf(job) {
  const params = job && job.params && typeof job.params === "object" ? job.params : null;
  return textOf3(job && job.rootImage) || textOf3(params && params.rootImage);
}
function siblingLetter(index) {
  let num = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0;
  let out = "";
  do {
    out = ALPHABET[num % ALPHABET.length] + out;
    num = Math.floor(num / ALPHABET.length) - 1;
  } while (num >= 0);
  return out;
}
function versionLabelOf(node) {
  if (!node || typeof node !== "object") return "v1";
  const depth = Number.isFinite(Number(node.depth)) ? Math.max(0, Math.floor(Number(node.depth))) : 0;
  const base = `v${Math.min(depth, MAX_DEPTH) + 1}`;
  const count = Number.isFinite(Number(node.siblingCount)) ? Math.floor(Number(node.siblingCount)) : 1;
  if (count <= 1) return base;
  const index = Number.isFinite(Number(node.siblingIndex)) ? Math.max(0, Math.floor(Number(node.siblingIndex))) : 0;
  return `${base}${siblingLetter(index)}`;
}
function draftKeyOf(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const image = value.image && typeof value.image === "object" ? value.image : value;
  return textOf3(image.path);
}
function workDraftSummary(draft) {
  const source = draft && typeof draft === "object" ? draft : null;
  const mask = source && source.mask && typeof source.mask === "object" ? source.mask : null;
  if (!source) {
    return {
      active: false,
      items: [],
      count: 0,
      hasMask: false,
      hasPrompt: false,
      hasParams: false,
      tool: "",
      lastTouchedAt: 0,
      coverage: 0
    };
  }
  const changed = source.changed && typeof source.changed === "object" ? source.changed : {};
  const hasFlag = (key) => Object.prototype.hasOwnProperty.call(changed, key);
  const flags = {
    mask: hasFlag("mask") ? changed.mask === true : Boolean(mask && textOf3(mask.data)),
    prompt: hasFlag("prompt") ? changed.prompt === true : false,
    params: hasFlag("params") ? changed.params === true : false
  };
  const items = DRAFT_CHANGE_KEYS.filter((key) => flags[key] === true);
  const coverage = mask && Number.isFinite(Number(mask.coverage)) ? Math.max(0, Math.min(1, Number(mask.coverage))) : 0;
  const lastTouchedAt = Number(source.lastTouchedAt);
  return {
    active: items.length > 0,
    items,
    count: items.length,
    hasMask: flags.mask,
    hasPrompt: flags.prompt,
    hasParams: flags.params,
    tool: textOf3(source.tool),
    lastTouchedAt: Number.isFinite(lastTouchedAt) ? lastTouchedAt : 0,
    coverage
  };
}
function lruDrafts(drafts, limit) {
  const max = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : DRAFT_LRU_LIMIT;
  const entries = drafts instanceof Map ? [...drafts.entries()] : drafts && typeof drafts === "object" ? Object.entries(drafts) : [];
  const candidates = [];
  entries.forEach(([key, draft], order) => {
    const path = draftKeyOf(key);
    if (!path || !draft || typeof draft !== "object") return;
    candidates.push({ path, draft, touched: workDraftSummary(draft).lastTouchedAt, order });
  });
  candidates.sort((left, right) => right.touched - left.touched || left.order - right.order);
  const kept = {};
  for (const entry of candidates.slice(0, max)) kept[entry.path] = entry.draft;
  return kept;
}
function compareSibling(left, right) {
  const leftIndex = Number.isFinite(Number(left.siblingIndex)) ? Number(left.siblingIndex) : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isFinite(Number(right.siblingIndex)) ? Number(right.siblingIndex) : Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftTime = createdAtOf(left) ?? 0;
  const rightTime = createdAtOf(right) ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return textOf3(left.path).localeCompare(textOf3(right.path));
}
function buildLineage(input) {
  const source = input && typeof input === "object" ? input : {};
  const items = Array.isArray(source.items) ? source.items.filter((item) => item && typeof item === "object") : [];
  const pendingJobs = Array.isArray(source.pendingJobs) ? source.pendingJobs : [];
  const nodes = [];
  const byPath = {};
  items.forEach((item, itemIndex) => {
    const images = Array.isArray(item.images) ? item.images.filter((image) => image && typeof image === "object") : [];
    if (images.length === 0) return;
    const parentPath = textOf3(item.sourceImage);
    const metaRoot = textOf3(item.rootImage);
    const createdAt = createdAtOf(item);
    const kind = item.upscale === true ? KIND_UPSCALE : item.outpaint === true ? KIND_OUTPAINT : item.inpaint === true ? KIND_INPAINT : parentPath ? KIND_IMG2IMG : KIND_TEXT;
    const itemKey = itemKeyOf(item, itemIndex);
    for (const image of images) {
      const path = imagePathOf(image);
      if (!path || byPath[path]) continue;
      const node = {
        path,
        url: textOf3(image.url),
        file: textOf3(image.file),
        width: numberOrNull2(image.width),
        height: numberOrNull2(image.height),
        seed: image.seed === void 0 ? null : image.seed,
        prompt: textOf3(item.prompt),
        presetId: textOf3(item.presetId),
        itemKey,
        item,
        createdAt,
        kind,
        ghost: false,
        parentPath,
        metaRoot,
        rootPath: "",
        depth: 0,
        siblingIndex: 0,
        siblingCount: 1,
        versionLabel: "",
        sourceDeleted: false
      };
      nodes.push(node);
      byPath[path] = node;
    }
  });
  for (const node of nodes) {
    if (!node.parentPath) {
      node.rootPath = node.path;
      node.depth = 0;
      node.siblingIndex = 0;
      node.siblingCount = 1;
      node.versionLabel = versionLabelOf(node);
      continue;
    }
    if (!byPath[node.parentPath]) {
      node.rootPath = node.path;
      node.depth = 0;
      node.sourceDeleted = true;
      continue;
    }
    const ancestry = [];
    const seen = /* @__PURE__ */ new Set();
    let current = node;
    while (current && typeof current === "object") {
      if (seen.has(current.path)) break;
      seen.add(current.path);
      ancestry.push(current.path);
      if (!current.parentPath) break;
      const parent = byPath[current.parentPath];
      if (!parent) break;
      current = parent;
    }
    const top = ancestry[ancestry.length - 1];
    node.rootPath = top || node.path;
    node.depth = Math.min(Math.max(ancestry.length - 1, 0), MAX_DEPTH);
  }
  const ghosts = [];
  for (const job of pendingJobs) {
    if (!job || typeof job !== "object" || !job.id) continue;
    if (PENDING_STATUS[job.status] !== true) continue;
    const parentPath = pendingParentOf(job);
    const rootHint = pendingRootOf(job);
    let anchor = parentPath ? byPath[parentPath] : null;
    let parentMissing = false;
    if (!anchor && rootHint) {
      anchor = byPath[rootHint] || null;
      parentMissing = Boolean(anchor);
    }
    if (!anchor || anchor.ghost) continue;
    const path = `pending:${String(job.id)}`;
    if (byPath[path]) continue;
    const ghost = {
      path,
      url: "",
      file: "",
      width: numberOrNull2(job.params && job.params.width),
      height: numberOrNull2(job.params && job.params.height),
      seed: null,
      prompt: textOf3(job.params && job.params.prompt),
      presetId: textOf3(job.presetId) || textOf3(job.params && job.params.presetId),
      itemKey: path,
      item: null,
      job,
      jobId: String(job.id),
      createdAt: createdAtOf(job),
      kind: pendingKindOf(job),
      ghost: true,
      parentPath: anchor.path,
      parentMissing,
      metaRoot: rootHint,
      rootPath: anchor.rootPath,
      depth: Math.min((anchor.depth || 0) + 1, MAX_DEPTH),
      siblingIndex: 0,
      siblingCount: 1,
      versionLabel: "",
      sourceDeleted: false,
      status: textOf3(job.status)
    };
    ghosts.push(ghost);
    nodes.push(ghost);
    byPath[path] = ghost;
  }
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!node.parentPath) continue;
    if (!childrenByParent.has(node.parentPath)) childrenByParent.set(node.parentPath, []);
    childrenByParent.get(node.parentPath).push(node);
  }
  for (const children of childrenByParent.values()) {
    const real = children.filter((node) => !node.ghost).sort((left, right) => (createdAtOf(left) ?? 0) - (createdAtOf(right) ?? 0) || textOf3(left.path).localeCompare(textOf3(right.path)));
    const pending = children.filter((node) => node.ghost).sort((left, right) => (createdAtOf(left) ?? Number.MAX_SAFE_INTEGER) - (createdAtOf(right) ?? Number.MAX_SAFE_INTEGER) || textOf3(left.path).localeCompare(textOf3(right.path)));
    const ordered = [...real, ...pending];
    ordered.forEach((node, index) => {
      node.siblingIndex = index;
      node.siblingCount = ordered.length;
      node.versionLabel = versionLabelOf(node);
    });
  }
  const orderIndex = /* @__PURE__ */ new Map();
  nodes.forEach((node, index) => orderIndex.set(node.path, index));
  const groups = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!node.rootPath) continue;
    if (!groups.has(node.rootPath)) groups.set(node.rootPath, []);
    groups.get(node.rootPath).push(node);
  }
  const roots = [];
  for (const [rootPath, group] of groups) {
    const rootNode = byPath[rootPath] && !byPath[rootPath].ghost ? byPath[rootPath] : null;
    const real = group.filter((node) => !node.ghost);
    const ghostNodes = group.filter((node) => node.ghost);
    const timeScore = (node) => createdAtOf(node) ?? 0;
    let latest = null;
    for (const node of real) {
      if (!latest) {
        latest = node;
        continue;
      }
      const nextScore = timeScore(node);
      const bestScore = timeScore(latest);
      if (nextScore > bestScore) latest = node;
      else if (nextScore === bestScore && (orderIndex.get(node.path) ?? Number.MAX_SAFE_INTEGER) < (orderIndex.get(latest.path) ?? Number.MAX_SAFE_INTEGER)) latest = node;
    }
    const derivedCount = Math.max(real.length - 1, 0);
    const activity = Math.max(
      latest ? timeScore(latest) : 0,
      ...ghostNodes.map((node) => timeScore(node)),
      0
    );
    roots.push({
      path: rootPath,
      node: rootNode,
      latest,
      latestPath: latest ? latest.path : rootPath,
      nodes: group,
      count: group.length,
      derivedCount,
      pendingCount: ghostNodes.length,
      badgeCount: derivedCount + ghostNodes.length,
      hasPending: ghostNodes.length > 0,
      sourceDeleted: Boolean(rootNode && rootNode.sourceDeleted),
      activity,
      order: orderIndex.get(rootPath) ?? Number.MAX_SAFE_INTEGER
    });
  }
  roots.sort((left, right) => right.activity - left.activity || left.order - right.order);
  return { roots, byPath, nodes, ghosts };
}
function insideTree(startPath, rootPath, byPath) {
  let current = startPath;
  const seen = /* @__PURE__ */ new Set();
  while (current && !seen.has(current)) {
    if (current === rootPath) return true;
    seen.add(current);
    const node = byPath[current];
    if (!node) return false;
    current = node.parentPath;
  }
  return false;
}
function lineagePanelRows(root, byPath, drafts, pendingJobs) {
  const pathMap = byPath && typeof byPath === "object" ? byPath : {};
  const rootEntry = root && typeof root === "object" ? root : null;
  const rootPath = rootEntry ? textOf3(rootEntry.path) : textOf3(root);
  if (!rootPath) return [];
  const rootNode = pathMap[rootPath] || rootEntry && rootEntry.node || null;
  if (!rootNode || rootNode.ghost) return [];
  const draftsOf = (key) => {
    if (!drafts || typeof drafts !== "object") return null;
    if (drafts instanceof Map) return drafts.get(key) || null;
    return drafts[key] || null;
  };
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const node of Object.values(pathMap)) {
    if (!node || typeof node !== "object" || !node.parentPath) continue;
    if (node.parentPath === node.path) continue;
    if (!childrenByParent.has(node.parentPath)) childrenByParent.set(node.parentPath, []);
    childrenByParent.get(node.parentPath).push(node);
  }
  const knownJobIds = /* @__PURE__ */ new Set();
  for (const node of Object.values(pathMap)) {
    if (node && node.ghost && node.jobId) knownJobIds.add(String(node.jobId));
  }
  const pendingList = Array.isArray(pendingJobs) ? pendingJobs : [];
  for (const job of pendingList) {
    if (!job || typeof job !== "object" || !job.id) continue;
    if (PENDING_STATUS[job.status] !== true) continue;
    const jobId = String(job.id);
    if (knownJobIds.has(jobId)) continue;
    const parentPath = pendingParentOf(job);
    if (!parentPath || !pathMap[parentPath]) continue;
    if (!insideTree(parentPath, rootPath, pathMap)) continue;
    const anchor = pathMap[parentPath];
    const ghost = {
      path: `pending:${jobId}`,
      ghost: true,
      job,
      jobId,
      parentPath,
      prompt: textOf3(job.params && job.params.prompt),
      status: textOf3(job.status),
      kind: pendingKindOf(job),
      width: numberOrNull2(job.params && job.params.width),
      height: numberOrNull2(job.params && job.params.height),
      createdAt: createdAtOf(job),
      depth: Math.min((anchor.depth || 0) + 1, MAX_DEPTH),
      siblingIndex: Number.MAX_SAFE_INTEGER,
      siblingCount: 1,
      sourceDeleted: false,
      parentMissing: false
    };
    knownJobIds.add(jobId);
    if (!childrenByParent.has(parentPath)) childrenByParent.set(parentPath, []);
    childrenByParent.get(parentPath).push(ghost);
  }
  const rows = [];
  const visited = /* @__PURE__ */ new Set();
  const rowOf = (node, depth) => {
    const key = textOf3(node.path);
    const draft = draftsOf(key);
    return {
      key,
      path: key,
      ghost: node.ghost === true,
      jobId: node.jobId ? String(node.jobId) : "",
      depth: Number.isFinite(Number(depth)) ? Number(depth) : Number(node.depth) || 0,
      versionLabel: node.versionLabel || versionLabelOf(node),
      kind: node.kind || KIND_TEXT,
      url: textOf3(node.url),
      file: textOf3(node.file),
      width: node.width === void 0 ? null : node.width,
      height: node.height === void 0 ? null : node.height,
      prompt: textOf3(node.prompt),
      presetId: textOf3(node.presetId),
      status: textOf3(node.status),
      createdAt: node.createdAt ?? null,
      sourceDeleted: node.sourceDeleted === true,
      parentMissing: node.parentMissing === true,
      isRoot: key === rootPath,
      isLatest: Boolean(rootEntry && rootEntry.latestPath === key),
      node,
      draft,
      draftSummary: workDraftSummary(draft)
    };
  };
  const walk = (path, depth) => {
    if (!path || visited.has(path)) return;
    const node = pathMap[path];
    if (!node || node.ghost) return;
    visited.add(path);
    rows.push(rowOf(node, depth));
    const children = (childrenByParent.get(path) || []).slice().sort(compareSibling);
    for (const child of children) {
      if (child.ghost) {
        if (visited.has(child.path)) continue;
        visited.add(child.path);
        rows.push(rowOf(child, depth + 1));
        continue;
      }
      walk(child.path, depth + 1);
    }
  };
  walk(rootPath, 0);
  return rows;
}

// src/studio/filmstrip/DraftCard.jsx
var import_react4 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
var FRAME_BOX = 34;
function pickText(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}
function sizeOf(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}
function DraftCard(props) {
  const labels = props.labels && typeof props.labels === "object" ? props.labels : {};
  const width = sizeOf(props.width) || 1024;
  const height = sizeOf(props.height) || 1024;
  const ratio = width / height;
  const viewfinderWidth = Math.max(12, ratio >= 1 ? FRAME_BOX : Math.round(FRAME_BOX * ratio));
  const viewfinderHeight = Math.max(12, ratio >= 1 ? Math.round(FRAME_BOX / ratio) : FRAME_BOX);
  const ratioText = (() => {
    const template = pickText(labels.ratio, "{width} × {height}");
    return template.split("{width}").join(String(width)).split("{height}").join(String(height));
  })();
  const active = Boolean(props.active);
  const pending = Boolean(props.pending);
  const draft = Boolean(props.draft);
  const draftFrom = typeof props.draftFrom === "string" ? props.draftFrom.trim() : "";
  const fromSource = props.draftFromSource === true || Boolean(draftFrom);
  const classes = ["ofs-draft-card"];
  if (active) classes.push("is-on");
  if (pending) classes.push("is-pending");
  if (draft) classes.push("has-draft");
  const stateText = pending ? pickText(labels.pending, "已提交，等待出图") : draft ? pickText(labels.unsaved, "未提交草稿") : active ? pickText(labels.active, "正在填写新画布") : pickText(labels.hint, "新建绘图");
  const fromText = draft && fromSource ? pickText(labels.from, "源自此图") : "";
  const fromTitle = draftFrom ? pickText(labels.fromPrompt, "源自：{prompt}").split("{prompt}").join(draftFrom) : "";
  const title = pending ? pickText(labels.title, "新建绘图") : fromTitle || props.prompt || pickText(labels.title, "新建绘图");
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "button",
    {
      type: "button",
      className: classes.join(" "),
      "aria-pressed": active,
      title,
      onClick: () => {
        if (typeof props.onClick === "function") props.onClick();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-draft-frame", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "span",
            {
              className: "ofs-draft-viewfinder",
              style: { width: `${viewfinderWidth}px`, height: `${viewfinderHeight}px` },
              "aria-hidden": "true",
              children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: pending ? "clock" : draft ? "focus" : "plus", size: 12 })
            }
          ),
          fromText ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-draft-from", children: fromText }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-draft-state", children: stateText })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ofs-draft-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("em", { children: ratioText }),
          props.presetLabel ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "ofs-draft-preset", children: props.presetLabel }) : null
        ] })
      ]
    }
  );
}

// src/studio/filmstrip/VersionPanel.jsx
var import_react5 = __toESM(require("react"), 1);
var import_jsx_runtime5 = require("react/jsx-runtime");
var DEFAULT_HOVER_DELAY = 250;
var DEFAULT_HIDE_DELAY = 160;
var KIND_ICONS = Object.freeze({
  text: "sparkles",
  img2img: "image",
  inpaint: "focus",
  upscale: "expand",
  outpaint: "frame"
});
function pickText2(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}
function delayOf(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}
function fillTemplate(template, params) {
  let out = typeof template === "string" ? template : "";
  for (const key of Object.keys(params || {})) {
    out = out.split(`{${key}}`).join(String(params[key]));
  }
  return out;
}
function kindLabelOf(labels, kind) {
  if (kind === "upscale") return pickText2(labels.kindUpscale, "高清放大");
  if (kind === "outpaint") return pickText2(labels.kindOutpaint, "扩图");
  if (kind === "inpaint") return pickText2(labels.kindInpaint, "局部重绘");
  if (kind === "img2img") return pickText2(labels.kindImg2img, "整图重绘");
  return pickText2(labels.kindText, "文生图");
}
function VersionRow(props) {
  const { labels, row, currentPath, onSelect, onClearDraft } = props;
  const ghost = row.ghost === true;
  const active = Boolean(currentPath) && row.path === currentPath;
  const summary = row.draftSummary || workDraftSummary(null);
  const kindLabel = kindLabelOf(labels, row.kind);
  const classes = ["ofs-version-row"];
  if (active) classes.push("is-on");
  if (ghost) classes.push("is-ghost");
  if (summary.active) classes.push("has-draft");
  if (row.sourceDeleted) classes.push("is-orphan");
  const depth = Number.isFinite(Number(row.depth)) ? Math.max(0, Math.floor(Number(row.depth))) : 0;
  const title = row.prompt || row.path;
  const draftItems = summary.items.map((key) => {
    const itemLabels = labels.draftItems && typeof labels.draftItems === "object" ? labels.draftItems : {};
    return pickText2(itemLabels[key], key);
  });
  const draftTitle = fillTemplate(
    pickText2(labels.draftTitle, "已修改：{items}"),
    { items: draftItems.join(" · ") }
  );
  const versionText = ghost ? pickText2(labels.inFlight, "生成中") : row.versionLabel || "v1";
  const body = /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-label", children: versionText }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-kind", title: kindLabel, "aria-label": kindLabel, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: KIND_ICONS[row.kind] || "sparkles", size: 12 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-thumb", children: ghost ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-thumb-ghost", "aria-hidden": "true" }) : row.url ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { src: row.url, alt: row.prompt || row.file || "", loading: "lazy" }) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-prompt", children: row.prompt || "—" }),
    summary.active ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-draft-dot", title: draftTitle, "aria-label": draftTitle }) : null
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "div",
    {
      className: classes.join(" "),
      style: { paddingLeft: `${10 + depth * 12}px` },
      "data-kind": row.kind || "text",
      "data-ghost": ghost ? "true" : "false",
      children: [
        ghost ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-row-main is-ghost", children: body }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-version-row-main",
            title,
            "aria-current": active ? "true" : void 0,
            onClick: () => {
              if (typeof onSelect === "function") onSelect(row);
            },
            children: body
          }
        ),
        summary.active && !ghost ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
          "button",
          {
            type: "button",
            className: "ofs-version-draft-clear",
            title: draftTitle,
            "aria-label": draftTitle,
            onClick: () => {
              if (typeof onClearDraft === "function") onClearDraft(row);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-draft-dot", "aria-hidden": "true" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "ofs-version-draft-label", children: pickText2(labels.draftClear, "清空") })
            ]
          }
        ) : null
      ]
    }
  );
}
function VersionPanel(props) {
  const labels = props.labels && typeof props.labels === "object" ? props.labels : {};
  const rows = Array.isArray(props.rows) ? props.rows.filter((row) => row && row.path) : [];
  const badgeCount = Number.isFinite(Number(props.badgeCount)) ? Math.max(0, Math.floor(Number(props.badgeCount))) : 0;
  const hoverDelay = delayOf(props.hoverDelay, DEFAULT_HOVER_DELAY);
  const hideDelay = delayOf(props.hideDelay, DEFAULT_HIDE_DELAY);
  const [open, setOpen] = import_react5.default.useState(false);
  const [pinned, setPinned] = import_react5.default.useState(false);
  const [panelPos, setPanelPos] = import_react5.default.useState(null);
  const anchorRef = import_react5.default.useRef(null);
  const timersRef = import_react5.default.useRef({ hover: null, hide: null });
  const openRef = import_react5.default.useRef(false);
  const pinnedRef = import_react5.default.useRef(false);
  openRef.current = open;
  pinnedRef.current = pinned;
  const computePanelPos = () => {
    const anchor = anchorRef.current;
    if (!anchor || typeof anchor.getBoundingClientRect !== "function") return null;
    if (typeof window === "undefined" || !(window.innerWidth > 0) || !(window.innerHeight > 0)) return null;
    const rect = anchor.getBoundingClientRect();
    if (!rect || rect.width <= 0 && rect.height <= 0) return null;
    const width = Math.min(272, Math.max(180, window.innerWidth - 24));
    const idealLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.round(Math.max(12, Math.min(window.innerWidth - width - 12, idealLeft)));
    const bottom = Math.round(Math.max(12, window.innerHeight - rect.top + 10));
    return { left: `${left}px`, bottom: `${bottom}px`, width: `${width}px` };
  };
  const clearTimer2 = (kind) => {
    const id = timersRef.current[kind];
    if (id !== null && id !== void 0 && typeof clearTimeout === "function") clearTimeout(id);
    timersRef.current[kind] = null;
  };
  const clearTimers = () => {
    clearTimer2("hover");
    clearTimer2("hide");
  };
  const emit = (next) => {
    if (typeof props.onOpenChange === "function") props.onOpenChange(next);
  };
  const openPanel = () => {
    clearTimers();
    const pos = computePanelPos();
    if (pos) setPanelPos(pos);
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    emit(true);
  };
  const closePanel = (options = {}) => {
    clearTimers();
    pinnedRef.current = false;
    setPinned(false);
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    if (!options.silent) emit(false);
  };
  const scheduleOpen = () => {
    clearTimer2("hide");
    if (openRef.current) return;
    clearTimer2("hover");
    timersRef.current.hover = setTimeout(() => {
      timersRef.current.hover = null;
      openPanel();
    }, hoverDelay);
  };
  const scheduleHide = () => {
    clearTimer2("hover");
    if (!openRef.current || pinnedRef.current) return;
    clearTimer2("hide");
    timersRef.current.hide = setTimeout(() => {
      timersRef.current.hide = null;
      if (!pinnedRef.current) closePanel();
    }, hideDelay);
  };
  import_react5.default.useEffect(() => () => {
    clearTimer2("hover");
    clearTimer2("hide");
  }, []);
  const closeRef = import_react5.default.useRef(closePanel);
  closeRef.current = closePanel;
  import_react5.default.useEffect(() => {
    if (!open) return void 0;
    const doc = typeof document === "undefined" ? null : document;
    if (!doc || typeof doc.addEventListener !== "function") return void 0;
    const onKeyDown = (event) => {
      if (!event || event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      closeRef.current();
    };
    doc.addEventListener("keydown", onKeyDown);
    const onPointerDown = (event) => {
      const anchor = anchorRef.current;
      if (!anchor || typeof anchor.contains !== "function") return;
      if (event && event.target && anchor.contains(event.target)) return;
      closeRef.current();
    };
    const syncPosition = () => {
      const pos = computePanelPos();
      if (pos) setPanelPos(pos);
    };
    syncPosition();
    doc.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("scroll", syncPosition, true);
    const win = typeof window === "undefined" ? null : window;
    if (win && typeof win.addEventListener === "function") win.addEventListener("resize", syncPosition);
    return () => {
      if (typeof doc.removeEventListener === "function") {
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("pointerdown", onPointerDown);
        doc.removeEventListener("scroll", syncPosition, true);
      }
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("resize", syncPosition);
    };
  }, [open]);
  import_react5.default.useEffect(() => {
    if (badgeCount === 0 && openRef.current) closeRef.current({ silent: true });
  }, [badgeCount]);
  const anchorClasses = ["ofs-version-anchor"];
  if (open) anchorClasses.push("is-open");
  if (pinned) anchorClasses.push("is-pinned");
  if (props.hasPending) anchorClasses.push("has-pending");
  const treeSummary = props.draftSummary && typeof props.draftSummary === "object" && props.draftSummary.active ? props.draftSummary : null;
  const draftItemLabels = labels.draftItems && typeof labels.draftItems === "object" ? labels.draftItems : {};
  const draftItemsText = treeSummary ? treeSummary.items.map((key) => pickText2(draftItemLabels[key], key)).join(" · ") : "";
  const draftTitle = fillTemplate(pickText2(labels.draftTitle, "已修改：{items}"), { items: draftItemsText });
  if (treeSummary) anchorClasses.push("has-draft");
  const badgeText = fillTemplate(pickText2(labels.badge, "⎇ {count}"), { count: badgeCount });
  const badgeTitle = pickText2(labels.badgeHint, "版本分支");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "div",
    {
      ref: anchorRef,
      className: anchorClasses.join(" "),
      "data-derivations": badgeCount,
      onMouseEnter: badgeCount > 0 ? scheduleOpen : void 0,
      onMouseLeave: badgeCount > 0 ? scheduleHide : void 0,
      onFocus: badgeCount > 0 ? () => clearTimer2("hide") : void 0,
      onBlur: (event) => {
        if (event && event.currentTarget && event.relatedTarget && typeof event.currentTarget.contains === "function" && event.currentTarget.contains(event.relatedTarget)) return;
        scheduleHide();
      },
      children: [
        props.children,
        treeSummary ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-thumb-dot",
            title: draftTitle,
            "aria-label": draftTitle,
            onClick: (event) => {
              if (event && typeof event.stopPropagation === "function") event.stopPropagation();
              if (event && typeof event.preventDefault === "function") event.preventDefault();
              if (typeof props.onClearTreeDrafts === "function") props.onClearTreeDrafts();
            }
          }
        ) : null,
        badgeCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            className: pinned ? "ofs-version-badge is-on" : "ofs-version-badge",
            "aria-expanded": open ? "true" : "false",
            "aria-haspopup": "dialog",
            title: badgeTitle,
            onClick: (event) => {
              if (event && typeof event.stopPropagation === "function") event.stopPropagation();
              if (event && typeof event.preventDefault === "function") event.preventDefault();
              if (pinnedRef.current) {
                closePanel();
                return;
              }
              pinnedRef.current = true;
              setPinned(true);
              openPanel();
            },
            children: badgeText
          }
        ) : null,
        open ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
          "div",
          {
            className: "ofs-version-panel",
            style: panelPos || void 0,
            role: "dialog",
            "aria-label": pickText2(labels.title, "版本"),
            onMouseEnter: clearTimers,
            onMouseLeave: scheduleHide,
            onKeyDown: (event) => {
              if (!event || event.key !== "Escape") return;
              if (typeof event.stopPropagation === "function") event.stopPropagation();
              closePanel();
            },
            children: [
              props.loading || props.unavailable ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-version-note", children: props.loading ? pickText2(labels.loading, "正在拉取版本…") : pickText2(labels.unavailable, "当前宿主不支持版本树，仅显示已加载分页") }) : null,
              props.loading ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_jsx_runtime5.Fragment, { children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-version-empty", children: pickText2(labels.empty, "暂无派生版本") }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "ofs-version-rows", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                VersionRow,
                {
                  labels,
                  row,
                  currentPath: props.currentPath,
                  onSelect: (selectedRow) => {
                    closePanel();
                    if (typeof props.onSelect === "function") props.onSelect(selectedRow);
                  },
                  onClearDraft: props.onClearDraft
                },
                row.key || row.path
              )) }) })
            ]
          }
        ) : null
      ]
    }
  );
}

// src/studio/Filmstrip.jsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var DRAFT_ITEMS = ["mask", "prompt", "params"];
var EMPTY_ROWS = [];
function treeDraftSummary(rootCard, workDrafts, workDraftSummaryFn) {
  if (!rootCard || !Array.isArray(rootCard.nodes) || !workDrafts || typeof workDrafts !== "object") return null;
  const items = [];
  let hasMask = false;
  let hasPrompt = false;
  let hasParams = false;
  for (const node of rootCard.nodes) {
    if (!node || node.ghost || !node.path) continue;
    const summary = typeof workDraftSummaryFn === "function" ? workDraftSummaryFn(node.path) : workDraftSummary(workDrafts[node.path] || null);
    if (!summary || summary.active !== true) continue;
    if (summary.hasMask) hasMask = true;
    if (summary.hasPrompt) hasPrompt = true;
    if (summary.hasParams) hasParams = true;
  }
  const flags = { mask: hasMask, prompt: hasPrompt, params: hasParams };
  for (const key of DRAFT_ITEMS) if (flags[key]) items.push(key);
  if (items.length === 0) return null;
  return {
    active: true,
    items,
    count: items.length,
    hasMask,
    hasPrompt,
    hasParams,
    tool: "",
    lastTouchedAt: 0,
    coverage: 0
  };
}
function entryOfNode(node) {
  if (!node || !node.path) return null;
  return {
    image: {
      path: node.path,
      url: node.url || "",
      file: node.file || "",
      width: node.width,
      height: node.height,
      seed: node.seed
    },
    item: node.item || null
  };
}
function Filmstrip(props) {
  const { t, ui, compute, library, actions } = props;
  const { setView } = ui;
  const { pendingJobs, sessionState, startSession: startSession2, status, cancelJob: cancelJob2, cancellingIds } = compute;
  const now = useNow(pendingJobs.length > 0);
  const stopped = Boolean(status && status.stopped);
  const { selected, selectImage } = library;
  const previewWork = actions && typeof actions.previewWork === "function" ? actions.previewWork : null;
  const openWork = previewWork || selectImage;
  const items = Array.isArray(library.items) ? library.items : [];
  const pendingSignature = pendingJobs.map((job) => `${job.id}:${job.status}`).join(",");
  const fallbackLineage = import_react6.default.useMemo(
    () => buildLineage({ items, pendingJobs }),
    [items, pendingSignature]
  );
  const lineage = library.lineage && Array.isArray(library.lineage.roots) ? library.lineage : fallbackLineage;
  const roots = Array.isArray(lineage.roots) ? lineage.roots : [];
  const byPath = lineage.byPath && typeof lineage.byPath === "object" ? lineage.byPath : {};
  const workDrafts = library.workDrafts && typeof library.workDrafts === "object" ? library.workDrafts : {};
  const newDraftCard = library.newDraftCard && typeof library.newDraftCard === "object" ? library.newDraftCard : {};
  const workspaceMode = library.workspaceMode === "new_draft" ? "new_draft" : "work";
  const clearWorkDraft = typeof library.clearWorkDraft === "function" ? library.clearWorkDraft : null;
  const workDraftSummaryFn = typeof library.workDraftSummary === "function" ? library.workDraftSummary : null;
  const selectedPath = selected && selected.image ? selected.image.path : "";
  const stripRef = import_react6.default.useRef(null);
  const rollRef = import_react6.default.useRef(null);
  const [openRoot, setOpenRoot] = import_react6.default.useState("");
  import_react6.default.useEffect(() => {
    const strip = stripRef.current;
    const roll = rollRef.current;
    if (!strip || !roll || typeof strip.addEventListener !== "function") return void 0;
    function onWheel(event) {
      if (roll.scrollWidth <= roll.clientWidth) return;
      const deltaX = Number(event.deltaX) || 0;
      const deltaY = Number(event.deltaY) || 0;
      if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return;
      const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? roll.clientWidth : 1;
      roll.scrollLeft += deltaY * unit;
      if (event.preventDefault) event.preventDefault();
    }
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (typeof strip.removeEventListener === "function") {
        strip.removeEventListener("wheel", onWheel);
      }
    };
  }, []);
  const openRootEntry = roots.find((rootCard) => rootCard && rootCard.path === openRoot) || null;
  const panelRows = import_react6.default.useMemo(
    () => openRootEntry ? lineagePanelRows(openRootEntry, byPath, workDrafts, pendingJobs) : EMPTY_ROWS,
    [openRootEntry, byPath, workDrafts, pendingSignature]
  );
  const hasMore = library.hasMore === true;
  const loadTree = typeof library.loadTree === "function" ? library.loadTree : null;
  import_react6.default.useEffect(() => {
    if (!openRootEntry || !hasMore || !loadTree) return;
    loadTree(openRootEntry.path);
  }, [openRootEntry && openRootEntry.path, hasMore]);
  function openVersion(node) {
    const entry = entryOfNode(node);
    if (!entry) return;
    if (openWork) openWork(entry);
    setOpenRoot("");
  }
  function clearTreeDrafts(rootCard) {
    if (!clearWorkDraft || !rootCard || !Array.isArray(rootCard.nodes)) return;
    for (const node of rootCard.nodes) {
      if (!node || node.ghost || !node.path) continue;
      const summary = typeof workDraftSummaryFn === "function" ? workDraftSummaryFn(node.path) : workDraftSummary(workDrafts[node.path] || null);
      if (!summary || summary.active !== true) continue;
      clearWorkDraft(node.path);
    }
  }
  const draftCardLabels = {
    title: t("studio.filmstrip.newDraft"),
    hint: t("studio.filmstrip.draftHint"),
    active: t("studio.filmstrip.draftActive"),
    pending: t("studio.filmstrip.draftPending"),
    ratio: "{width} × {height}",
    // 阶段十五 A1：未提交草稿托管态（§6.1.2）。
    unsaved: t("studio.filmstrip.draftUnsaved"),
    from: t("studio.filmstrip.draftFrom"),
    fromPrompt: t("studio.filmstrip.draftFromPrompt")
  };
  const panelLabels = {
    title: t("studio.filmstrip.versionPanelTitle"),
    empty: t("studio.filmstrip.versionPanelEmpty"),
    loading: t("studio.filmstrip.versionLoading"),
    unavailable: t("studio.filmstrip.treeUnavailable"),
    inFlight: t("studio.filmstrip.versionInFlight"),
    badge: t("studio.filmstrip.versionBadge"),
    badgeHint: t("studio.filmstrip.versionBadgeHint"),
    kindText: t("studio.filmstrip.versionKind.text"),
    kindImg2img: t("studio.filmstrip.versionKind.img2img"),
    kindInpaint: t("studio.filmstrip.versionKind.inpaint"),
    kindUpscale: t("studio.filmstrip.versionKind.upscale"),
    kindOutpaint: t("studio.filmstrip.versionKind.outpaint"),
    draftItems: {
      mask: t("studio.filmstrip.draftItems.mask"),
      prompt: t("studio.filmstrip.draftItems.prompt"),
      params: t("studio.filmstrip.draftItems.params")
    },
    draftTitle: t("studio.filmstrip.draftTitle"),
    draftClear: t("studio.filmstrip.draftClear"),
    sourceDeleted: t("studio.filmstrip.sourceDeleted")
  };
  const showDraftCard = roots.length > 0 || pendingJobs.length > 0 || newDraftCard.pending === true || newDraftCard.explicit === true || newDraftCard.draft === true;
  const hasContent = roots.length > 0 || pendingJobs.length > 0 || showDraftCard;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("footer", { className: openRoot ? "ofs-filmstrip is-version-open" : "ofs-filmstrip", ref: stripRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-roll", ref: rollRef, children: [
      showDraftCard ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        DraftCard,
        {
          labels: draftCardLabels,
          width: newDraftCard.width,
          height: newDraftCard.height,
          presetLabel: newDraftCard.presetLabel,
          prompt: newDraftCard.prompt,
          active: workspaceMode === "new_draft",
          pending: newDraftCard.pending === true,
          draft: newDraftCard.draft === true,
          draftFrom: newDraftCard.draftFrom,
          draftFromSource: newDraftCard.draftFromSource === true,
          onClick: () => {
            if (actions && typeof actions.focusNewDraft === "function") {
              actions.focusNewDraft();
            } else if (typeof library.focusDraft === "function") {
              library.focusDraft();
              if (ui && typeof ui.setPanelMode === "function") ui.setPanelMode("form");
            } else if (ui && typeof ui.setPanelMode === "function") {
              ui.setPanelMode("form");
            }
          }
        }
      ) : null,
      pendingJobs.map((job, index) => {
        const queued = job.status === "queued";
        const cancelling = isJobCancelling(job, cancellingIds);
        const cancelLabel = t(cancelling ? "studio.job.cancelling" : "studio.job.cancel");
        const elapsedMs = jobElapsed(job, now);
        const elapsed = Number.isFinite(elapsedMs) ? formatDuration(t, elapsedMs) : "";
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
          "div",
          {
            className: jobCardClass(job, cancellingIds),
            title: job.params && typeof job.params.prompt === "string" ? job.params.prompt : void 0,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-ghost-frame", "aria-hidden": "true", children: queued ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-ghost-slot", children: index + 1 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-ghost-bar" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "ofs-ghost-text", children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-ghost-label", children: jobProgressText(t, job, sessionState) }),
                elapsed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-ghost-time", children: elapsed }) : null
              ] }),
              isJobCancellable(job) && typeof cancelJob2 === "function" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-ghost-cancel",
                  "aria-label": cancelLabel,
                  title: cancelling ? cancelLabel : t("studio.job.cancelHint"),
                  disabled: cancelling,
                  onClick: () => cancelJob2(job.id),
                  children: cancelLabel
                }
              ) : null
            ]
          },
          job.id
        );
      }),
      !hasContent ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-filmstrip-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-slots", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-slot" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-slot" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "ofs-slot" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
          sessionState === "absent" ? stopped ? t("studio.filmstrip.offlineClosed") : t("studio.filmstrip.offline") : t("studio.filmstrip.empty"),
          sessionState === "absent" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "ofs-link", onClick: startSession2, children: t("studio.compute.start") }) : null
        ] })
      ] }) : null,
      roots.map((rootCard) => {
        const thumbNode = rootCard.latest || rootCard.node;
        if (!thumbNode || !thumbNode.path) return null;
        const badgeCount = Math.max(0, Number(rootCard.badgeCount) || 0);
        const versionCount = badgeCount;
        const summary = treeDraftSummary(rootCard, workDrafts, workDraftSummaryFn);
        const metaText = versionCount > 0 ? formatText(t("studio.filmstrip.versionsCount"), { count: versionCount }) : `${Math.max(1, Number(rootCard.count) || 1)} ${t("unit.image")}`;
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "ofs-batch", "data-root": rootCard.path, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ofs-batch-thumbs", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            VersionPanel,
            {
              labels: panelLabels,
              rows: openRoot === rootCard.path ? panelRows : EMPTY_ROWS,
              currentPath: selectedPath,
              badgeCount,
              hasPending: rootCard.pendingCount > 0,
              loading: library.treeLoadingRoot === rootCard.path,
              unavailable: library.treeUnavailable === true,
              draftSummary: summary,
              onClearTreeDrafts: () => clearTreeDrafts(rootCard),
              onSelect: (row) => openVersion(row.node),
              onClearDraft: (row) => {
                if (clearWorkDraft && row && row.path) clearWorkDraft(row.path);
              },
              onOpenChange: (isOpen) => {
                setOpenRoot((prev) => {
                  if (isOpen) return rootCard.path;
                  return prev === rootCard.path ? "" : prev;
                });
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                "button",
                {
                  type: "button",
                  className: thumbNode.path === selectedPath ? "ofs-thumb is-on" : "ofs-thumb",
                  onClick: () => openWork(entryOfNode(thumbNode)),
                  title: thumbNode.prompt || rootCard.path,
                  children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                    "img",
                    {
                      src: thumbNode.url,
                      alt: thumbNode.prompt || thumbNode.file || t("studio.image.alt"),
                      loading: "lazy"
                    }
                  )
                }
              )
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "ofs-batch-meta", children: [
            thumbNode.presetId ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("em", { children: thumbNode.presetId }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("em", {}),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: metaText })
          ] })
        ] }, rootCard.path);
      })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "ofs-filmstrip-side", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "ofs-filmstrip-link", onClick: () => setView("gallery"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "images", size: 15 }),
      t("studio.gallery.title"),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "chevronRight", size: 13 })
    ] }) })
  ] });
}

// src/studio/Gallery.jsx
var import_react9 = __toESM(require("react"), 1);

// src/logic/gallery.js
var COLUMN_BREAKPOINTS = [
  [900, 2],
  [1180, 3],
  [1400, 4]
];
function galleryColumnCount(width) {
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return 5;
  for (const [maxWidth, columns] of COLUMN_BREAKPOINTS) {
    if (value <= maxWidth) return columns;
  }
  return 5;
}
function galleryColumns(items, columns) {
  const list = Array.isArray(items) ? items : [];
  const count = Math.max(1, Math.floor(Number(columns)) || 1);
  const buckets = Array.from({ length: count }, () => []);
  list.forEach((item, index) => {
    buckets[index % count].push(item);
  });
  return buckets;
}

// src/studio/gallery/GalleryCard.jsx
var import_react7 = __toESM(require("react"), 1);
var import_jsx_runtime7 = require("react/jsx-runtime");
function GalleryCard({
  t,
  entry,
  cardKey,
  aspect,
  selecting,
  checked,
  favorite,
  confirming,
  onTogglePick,
  onOpenStudio,
  onRedraw,
  onZoom,
  onToggleFavorite,
  onAskDelete,
  onCancelDelete,
  onDelete
}) {
  const prompt = entry.item.prompt || "";
  const favoriteLabel = favorite ? t("studio.action.favorited") : t("studio.action.favorite");
  const openOrPick = () => selecting ? onTogglePick(cardKey) : onOpenStudio(entry);
  const deleteLabel = confirming ? t("studio.gallery.confirmDelete") : t("studio.gallery.delete");
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      className: checked ? "ofs-gallery-card is-picked" : "ofs-gallery-card",
      onMouseLeave: confirming ? () => onCancelDelete(entry) : void 0,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-gallery-stage", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-gallery-media",
              style: aspect ? { aspectRatio: aspect } : void 0,
              title: prompt || cardKey,
              "aria-pressed": selecting ? checked : void 0,
              onClick: openOrPick,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("img", { src: entry.image.url, alt: prompt || entry.image.file || t("studio.image.alt"), loading: "lazy" }),
                selecting ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: checked ? "ofs-gallery-pick is-on" : "ofs-gallery-pick", "aria-hidden": "true", children: checked ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "check", size: 11 }) : null }) : null
              ]
            }
          ),
          selecting ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "button",
            {
              type: "button",
              className: favorite ? "ofs-gallery-star is-on" : "ofs-gallery-star",
              "aria-pressed": favorite,
              "aria-label": favoriteLabel,
              title: favoriteLabel,
              onClick: (event) => {
                if (event && typeof event.stopPropagation === "function") event.stopPropagation();
                onToggleFavorite(entry);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: favorite ? "starFilled" : "star", size: 12 })
            }
          ),
          selecting ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: confirming ? "ofs-gallery-hover is-confirming" : "ofs-gallery-hover", children: [
            confirming ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onOpenStudio(entry), children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "focus", size: 12 }),
                t("studio.action.openStudio")
              ] }, "open"),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onRedraw(entry), children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "image", size: 12 }),
                t("studio.action.redraw")
              ] }, "redraw"),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onZoom(entry), children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "expand", size: 12 }),
                t("studio.gallery.open")
              ] }, "zoom")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "button",
              {
                type: "button",
                className: confirming ? "ofs-gallery-action is-danger is-confirming" : "ofs-gallery-action is-danger",
                onClick: () => confirming ? onDelete(entry) : onAskDelete(entry),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "trash", size: 12 }),
                  deleteLabel
                ]
              },
              "delete"
            ),
            confirming ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "ofs-gallery-action", onClick: () => onCancelDelete(entry), children: t("studio.gallery.cancel") }, "cancel") : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "ofs-gallery-body", onClick: openOrPick, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "ofs-gallery-caption", children: prompt || "—" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "ofs-gallery-tags", children: [
            entry.item.presetId ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("em", { children: entry.item.presetId }) : null,
            entry.image.seed != null ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
              "#",
              entry.image.seed
            ] }) : null
          ] })
        ] })
      ]
    }
  );
}

// src/studio/gallery/GalleryToolbar.jsx
var import_react8 = __toESM(require("react"), 1);
var import_jsx_runtime8 = require("react/jsx-runtime");
function GalleryToolbar({
  t,
  visibleCount,
  keyword,
  onKeywordChange,
  usedPresets,
  presets,
  presetFilter,
  onPresetFilterChange,
  presetNameOf: presetNameOf2,
  favoriteOnly,
  onToggleFavoriteOnly,
  selecting,
  onEnterSelect,
  onExitSelect,
  picked,
  confirming,
  onStartConfirmDelete,
  onConfirmDelete,
  onExport,
  hasItems
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-gallery-tools", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "ofs-gallery-headline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { className: "ofs-gallery-title", children: t("studio.gallery.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "ofs-gallery-count", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("b", { children: visibleCount }),
        " ",
        t("unit.image")
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "ofs-gallery-search", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "search", size: 15, className: "ofs-gallery-search-icon" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "input",
        {
          className: "ofs-gallery-search-input",
          type: "search",
          value: keyword,
          placeholder: t("studio.gallery.search"),
          "aria-label": t("studio.gallery.search"),
          onChange: (event) => onKeywordChange(event.target.value)
        }
      )
    ] }),
    usedPresets.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "ofs-gallery-select", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "select",
        {
          className: "ofs-gallery-select-input",
          value: presetFilter,
          "aria-label": t("studio.gallery.allPresets"),
          onChange: (event) => onPresetFilterChange(event.target.value),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "", children: t("studio.gallery.allPresets") }),
            usedPresets.map((id) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: id, children: presetNameOf2(presets, id) }, id))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "chevronDown", size: 13, className: "ofs-gallery-select-caret" })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "button",
      {
        type: "button",
        className: favoriteOnly ? "ofs-chip is-on" : "ofs-chip",
        "aria-pressed": favoriteOnly,
        onClick: onToggleFavoriteOnly,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: favoriteOnly ? "starFilled" : "star", size: 13 }),
          t("studio.gallery.favoriteOnly")
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "ofs-gallery-actions", children: selecting ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "ofs-gallery-selected", children: [
        t("studio.gallery.selectedCount"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("b", { children: picked.length })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-chip", onClick: onExitSelect, children: t("studio.gallery.cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "button",
        {
          type: "button",
          className: "ofs-chip",
          onClick: () => onExport(picked),
          disabled: picked.length === 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon, { name: "copy", size: 13 }),
            t("studio.gallery.export")
          ]
        }
      ),
      confirming ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-chip is-danger",
          onClick: onConfirmDelete,
          disabled: picked.length === 0,
          children: t("studio.gallery.confirmDelete")
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-chip is-danger",
          onClick: onStartConfirmDelete,
          disabled: picked.length === 0,
          children: t("studio.gallery.delete")
        }
      )
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "ofs-chip", onClick: onEnterSelect, disabled: !hasItems, children: t("studio.gallery.select") }) })
  ] });
}

// src/studio/Gallery.jsx
var import_jsx_runtime9 = require("react/jsx-runtime");
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
function useColumnCount() {
  const [columns, setColumns] = import_react9.default.useState(() => typeof window === "undefined" ? 5 : galleryColumnCount(window.innerWidth));
  import_react9.default.useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
    const onResize = () => setColumns(galleryColumnCount(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return columns;
}
function Gallery(props) {
  const {
    t,
    gallery,
    now: nowInput,
    presets,
    favorites,
    onOpen,
    onOpenStudio,
    onRedraw,
    onZoom,
    onDelete,
    onExport,
    onToggleFavorite,
    hasMore,
    loadingMore,
    onLoadMore,
    defaultSelecting
  } = props;
  const now = Number.isFinite(Number(nowInput)) ? Number(nowInput) : Date.now();
  const openStudio = typeof onOpenStudio === "function" ? onOpenStudio : typeof onOpen === "function" ? onOpen : () => {
  };
  const [presetFilter, setPresetFilter] = import_react9.default.useState("");
  const [favoriteOnly, setFavoriteOnly] = import_react9.default.useState(false);
  const [selecting, setSelecting] = import_react9.default.useState(Boolean(defaultSelecting));
  const [picked, setPicked] = import_react9.default.useState([]);
  const [confirming, setConfirming] = import_react9.default.useState(false);
  const [confirmKey, setConfirmKey] = import_react9.default.useState("");
  const deletingRef = import_react9.default.useRef(/* @__PURE__ */ new Set());
  const [keyword, setKeyword] = import_react9.default.useState("");
  const columns = useColumnCount();
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
  const canLoadMore = hasMore === true && typeof onLoadMore === "function";
  function renderFooter() {
    if (items.length === 0) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-gallery-foot", children: canLoadMore ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      "button",
      {
        type: "button",
        className: "ofs-chip ofs-gallery-more",
        onClick: onLoadMore,
        disabled: loadingMore === true,
        "aria-busy": loadingMore === true ? "true" : void 0,
        children: t("studio.gallery.loadMore")
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "ofs-gallery-all-loaded", children: t("studio.gallery.allLoaded") }) });
  }
  function togglePick(key) {
    setPicked((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }
  function exitSelect() {
    setSelecting(false);
    setPicked([]);
    setConfirming(false);
    setConfirmKey("");
  }
  function enterSelect() {
    setConfirmKey("");
    setSelecting(true);
  }
  function clearFilters() {
    setKeyword("");
    setPresetFilter("");
    setFavoriteOnly(false);
    setConfirmKey("");
  }
  function changeKeyword(value) {
    setConfirmKey("");
    setKeyword(value);
  }
  function changePresetFilter(value) {
    setConfirmKey("");
    setPresetFilter(value);
  }
  function toggleFavoriteOnly() {
    setConfirmKey("");
    setFavoriteOnly((value) => !value);
  }
  function toggleFavorite(entry) {
    if (typeof onToggleFavorite !== "function") return;
    onToggleFavorite(keyOf(entry));
  }
  function askDelete(entry) {
    setConfirmKey(keyOf(entry));
  }
  function cancelDelete() {
    setConfirmKey("");
  }
  async function deleteEntry(entry) {
    if (typeof onDelete !== "function") return;
    const key = keyOf(entry);
    if (!key || deletingRef.current.has(key)) return;
    deletingRef.current.add(key);
    try {
      const result = await onDelete([key]);
      if (!result) return;
      if (Array.isArray(result.failed) && result.failed.length > 0) return;
      setConfirmKey("");
      setPicked((prev) => prev.filter((item) => item !== key));
    } finally {
      deletingRef.current.delete(key);
    }
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
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: visibleCount === 0 ? "ofs-gallery is-empty" : "ofs-gallery", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      GalleryToolbar,
      {
        t,
        visibleCount,
        keyword,
        onKeywordChange: changeKeyword,
        usedPresets,
        presets,
        presetFilter,
        onPresetFilterChange: changePresetFilter,
        presetNameOf,
        favoriteOnly,
        onToggleFavoriteOnly: toggleFavoriteOnly,
        selecting,
        onEnterSelect: enterSelect,
        onExitSelect: exitSelect,
        picked,
        confirming,
        onStartConfirmDelete: () => setConfirming(true),
        onConfirmDelete: confirmDelete,
        onExport,
        hasItems: items.length > 0
      }
    ),
    visibleCount === 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-gallery-empty", children: items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("studio.gallery.noMatch") }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-gallery-empty-actions", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: "ofs-chip", onClick: clearFilters, children: t("studio.gallery.clearFilters") }) })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("studio.gallery.empty") }) }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      BUCKETS.map((bucket) => {
        const entries = groups[bucket];
        if (entries.length === 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "ofs-gallery-group", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h4", { className: "ofs-gallery-group-title", children: t(`studio.gallery.${bucket}`) }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-gallery-wall", children: galleryColumns(entries, columns).map((column, index) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "ofs-gallery-col", children: column.map((entry) => {
            const cardKey = keyOf(entry);
            return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              GalleryCard,
              {
                t,
                entry,
                cardKey,
                aspect: aspectOf(entry),
                selecting,
                checked: picked.includes(cardKey),
                favorite: favoriteSet.has(cardKey),
                confirming: confirmKey === cardKey,
                onTogglePick: togglePick,
                onOpenStudio: openStudio,
                onRedraw,
                onZoom,
                onToggleFavorite: toggleFavorite,
                onAskDelete: askDelete,
                onCancelDelete: cancelDelete,
                onDelete: deleteEntry
              },
              cardKey
            );
          }) }, index)) })
        ] }, bucket);
      }),
      renderFooter()
    ] })
  ] });
}

// src/studio/GuidanceCard.jsx
var import_react11 = __toESM(require("react"), 1);

// src/logic/probe.js
function transportOf(source) {
  const value = source && typeof source === "object" ? source.kaggleTransport : void 0;
  return value === void 0 ? "cli" : normalizeKaggleTransport(value);
}
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
var AUTH_PROVEN_SESSION_STATES = ["provisioning", "connecting", "warming", "ready", "stopping"];
function sessionProvesAuth(sessionState) {
  return AUTH_PROVEN_SESSION_STATES.includes(sessionState);
}
function accountStatusOf(probe, sessionState) {
  const status = probeStatusOf(probe);
  if (status && status.auth === "ok" || sessionProvesAuth(sessionState)) return "ok";
  return status ? status.auth : "unknown";
}
function probeFailureCode(probe, options = {}) {
  const status = probeStatusOf(probe);
  if (!status) return "";
  const transport = options && options.transport === "direct" ? "direct" : "cli";
  if (status.cli === "failed") return transport === "direct" ? "auth_required" : "cli_missing";
  if (status.auth === "failed") return "auth_required";
  return "";
}
function accessMethodKey(transport) {
  return transport === "direct" ? "studio.probe.direct" : "studio.probe.cli";
}
function accessStatusKey(transport, status) {
  if (transport !== "direct") {
    if (status === "ok") return "value.ok";
    if (status === "failed") return "value.failed";
    return "value.unknown";
  }
  if (status === "ok") return "studio.probe.directOk";
  if (status === "failed") return "studio.probe.directLoginRequired";
  return "value.unknown";
}
function accessStatusOf(status, transport) {
  if (!status || typeof status !== "object") return "unknown";
  if (transport !== "direct") return status.cli || "unknown";
  if (status.auth === "ok") return "ok";
  if (status.auth === "failed") return "failed";
  return "unknown";
}
function probeOutcomeOf(payload, options = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const probe = data.probe && typeof data.probe === "object" ? data.probe : null;
  if (data.ok === true) return { ok: true, probe, code: "", detail: "" };
  const code = probeFailureCode(probe, options) || "probe_failed";
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

// src/logic/logs.js
var LOG_LINE_LIMIT = LOGS.remoteLineLimit;
var HOST_LOG_LINE_LIMIT = LOGS.hostLineLimit;
var DIAG_LOG_TAIL = LOGS.diagRemoteTail;
var DIAG_HOST_LOG_TAIL = LOGS.diagHostTail;
var SENSITIVE_KEY = /token|secret|password|authorization|cookie/i;
function isLogLine(value) {
  return typeof value === "string";
}
function appendLogLines(previous, incoming, max = LOG_LINE_LIMIT) {
  const current = Array.isArray(previous) ? previous : [];
  const add = Array.isArray(incoming) ? incoming.filter(isLogLine) : [];
  if (add.length === 0) return current;
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : LOG_LINE_LIMIT;
  const merged = current.concat(add);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}
function reasonOf(code, message) {
  return {
    code: typeof code === "string" && code ? code : "logs_unavailable",
    message: typeof message === "string" ? message : ""
  };
}
function isEnvScalar(value) {
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}
function readDiagnosticEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env = {};
  for (const field of DIAGNOSTICS.envFields) {
    if (isEnvScalar(value[field])) env[field] = value[field];
  }
  const timings = value.timings;
  if (timings && typeof timings === "object" && !Array.isArray(timings)) {
    const summary = {};
    for (const field of DIAGNOSTICS.timingFields) {
      const item = timings[field];
      if (typeof item === "number" && Number.isFinite(item)) summary[field] = item;
    }
    if (Object.keys(summary).length > 0) env.timings = summary;
  }
  return env;
}
function readLogsPayload(result) {
  if (!result || result.ok !== true) {
    return {
      ok: false,
      lines: [],
      hostLines: [],
      next: null,
      env: {},
      reason: reasonOf(result && result.code, result && result.message)
    };
  }
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const lines = Array.isArray(data.lines) ? data.lines.filter(isLogLine) : [];
  const hostLines = Array.isArray(data.hostLines) ? data.hostLines.filter(isLogLine).slice(-HOST_LOG_LINE_LIMIT) : [];
  const next = Number.isFinite(data.next) && data.next >= 0 ? Math.floor(data.next) : null;
  const env = readDiagnosticEnv(data.env);
  if (data.ok === true) return { ok: true, lines, hostLines, next, env, reason: null };
  return { ok: false, lines, hostLines, next, env, reason: reasonOf(data.code, data.message) };
}
function formatClockTime(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function elapsedMsSince(value, now) {
  const start = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(start)) return null;
  const current = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, current - start);
}
function sanitizeSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(session)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const kind = typeof value;
    if (value === null || kind === "string" || kind === "number" || kind === "boolean") {
      clean[key] = value;
    } else if (key === "error" && value && typeof value === "object") {
      clean[key] = { code: value.code ?? "", message: value.message ?? "" };
    }
  }
  return clean;
}
function quotaText(quota) {
  if (!quota || typeof quota !== "object") return "—";
  if (quota.available !== true) return "unavailable";
  const used = Number.isFinite(quota.usedHours) ? quota.usedHours : null;
  const total = Number.isFinite(quota.totalHours) ? quota.totalHours : null;
  if (used === null || total === null) return "available";
  return `${used} / ${total} h`;
}
function sessionBlock(session) {
  if (!session) return ["session: —"];
  const rows = [
    `session.state: ${session.state ?? "—"}`,
    `session.phase: ${session.phase ?? "—"}`,
    `session.presetId: ${session.presetId ?? "—"}`,
    `session.modelId: ${session.modelId ?? "—"}`,
    `session.device: ${session.device ?? "—"}`,
    `session.tunnelProvider: ${session.tunnelProvider ?? "—"}`,
    `session.kernelStatus: ${session.kernelStatus ?? "—"}`,
    `session.startedAt: ${session.startedAt ?? "—"}`,
    `session.readyAt: ${session.readyAt ?? "—"}`
  ];
  if (session.error) {
    const code = session.error.code || "—";
    const message = session.error.message ? ` · ${shortText(session.error.message, 240)}` : "";
    rows.push(`session.error: ${code}${message}`);
  }
  return rows;
}
function probeBlock(probe) {
  const info = probeStatusOf(probe);
  if (!info) return ["probe: —"];
  const rows = [
    `probe.cli: ${info.cli}`,
    `probe.auth: ${info.auth}`,
    `probe.quota: ${info.quota}`
  ];
  if (info.notes.length > 0) rows.push(`probe.notes: ${shortText(info.notes.join(" | "), 400)}`);
  return rows;
}
function queueBlock(queue) {
  if (!queue || typeof queue !== "object") return ["queue: —"];
  return [`queue: running=${queue.running ?? "—"} pending=${Number.isFinite(queue.pending) ? queue.pending : 0}`];
}
function lastJobBlock(job) {
  if (!job || typeof job !== "object") return [];
  const parts = [job.id || "—", job.status || "—"];
  if (Number.isFinite(job.seconds)) parts.push(`${job.seconds}s`);
  const code = job.error && job.error.code ? ` · ${job.error.code}` : "";
  return [`lastJob: ${parts.join(" ")}${code}`];
}
var ENV_LABELS = {
  platform: "env.platform",
  nodeVersion: "env.node",
  hasProxyEnv: "env.proxy",
  hasFallbackTunnel: "env.fallbackTunnel",
  hasCustomDatasets: "env.customDatasets",
  hasPipConstraints: "env.pipConstraints",
  hasHfToken: "env.hfToken"
};
var TIMING_LABELS = {
  sessionStartMs: "timings.sessionStartMs",
  sessionUptimeMs: "timings.sessionUptimeMs",
  readyUptimeMs: "timings.readyUptimeMs"
};
function diagnosticValue(value) {
  if (value === null || value === void 0 || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function envBlock(value) {
  const env = readDiagnosticEnv(value);
  const rows = Object.entries(ENV_LABELS).map(
    ([field, label]) => `${label}: ${diagnosticValue(env[field])}`
  );
  const timings = env.timings && typeof env.timings === "object" ? env.timings : {};
  for (const field of DIAGNOSTICS.timingFields) {
    rows.push(`${TIMING_LABELS[field]}: ${diagnosticValue(timings[field])}`);
  }
  return rows;
}
function buildDiagnostics(t, input = {}) {
  const source = input || {};
  const session = sanitizeSession(source.session);
  const probe = source.probe && typeof source.probe === "object" ? source.probe : null;
  const lastGood = source.probeLastGood && typeof source.probeLastGood === "object" ? source.probeLastGood : null;
  const lines = Array.isArray(source.lines) ? source.lines.filter(isLogLine) : [];
  const tail = lines.slice(Math.max(0, lines.length - DIAG_LOG_TAIL));
  const hostLogs = Array.isArray(source.hostLogs) ? source.hostLogs.filter(isLogLine) : [];
  const hostTail = hostLogs.slice(Math.max(0, hostLogs.length - DIAG_HOST_LOG_TAIL));
  const now = Number.isFinite(source.now) ? source.now : Date.now();
  const rows = [
    `${t("studio.logs.diag.title")} · ${new Date(now).toISOString()}`,
    `version: ${source.version || "—"}`,
    ...envBlock(source.env),
    ...sessionBlock(session),
    ...probeBlock(probe),
    `probeLastGoodAt: ${source.probeLastGoodAt || "—"}`,
    `probeLastGood.quota: ${quotaText(lastGood && lastGood.quota)}`,
    ...queueBlock(source.queue),
    ...lastJobBlock(source.lastJob),
    "",
    `logs (last ${tail.length}/${lines.length}):`,
    ...tail,
    "",
    `host logs (last ${hostTail.length}/${hostLogs.length}):`,
    ...hostTail
  ];
  return rows.join("\n");
}

// src/studio/guidance/DirectLoginCard.jsx
var import_react10 = __toESM(require("react"), 1);
var import_jsx_runtime10 = require("react/jsx-runtime");
function statusNotesOf({ t, state, pending, manual, login, provider }) {
  if (pending) {
    return manual ? [
      t("studio.guidance.auth.waiting"),
      t(provider === "colab" ? "studio.guidance.auth.colabWaitingManual" : "studio.guidance.auth.waitingManual")
    ] : [t("studio.guidance.auth.waiting")];
  }
  if (state === "failed") {
    return [formatText(t("studio.guidance.auth.failed"), {
      reason: login.errorKey ? t(login.errorKey) : t("studio.guidance.auth.reason.unknown")
    })];
  }
  if (state === "cancelled") return [t("studio.guidance.auth.cancelled")];
  if (state === "done") {
    const username = loginUsernameOf(login.login);
    if (provider === "colab") {
      return [username ? formatText(t("studio.guidance.auth.colabDoneWithUser"), { username }) : t("studio.guidance.auth.colabDone")];
    }
    return [username ? formatText(t("studio.guidance.auth.loginDoneWithUser"), { username }) : t("studio.guidance.auth.loginDone")];
  }
  return [];
}
function OAuthManualPanel({ t, login, copyText, provider = "kaggle" }) {
  const [code, setCode] = import_react10.default.useState("");
  const view = login && login.login && typeof login.login === "object" ? login.login : {};
  const state = typeof view.state === "string" ? view.state : "idle";
  const pending = state === "pending";
  const manual = view.mode === "manual";
  const url = typeof view.url === "string" ? view.url : "";
  const notes = statusNotesOf({ t, state, pending, manual, login, provider });
  const placeholder = t(
    provider === "colab" ? "studio.guidance.auth.colabCodePlaceholder" : "studio.guidance.auth.codePlaceholder"
  );
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    pending && manual && url ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance-manual", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance-url", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("code", { className: "ofs-guidance-command", children: url }),
        typeof copyText === "function" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip",
            onClick: () => copyText(url, "studio.guidance.auth.urlCopied"),
            children: t("studio.guidance.auth.copyUrl")
          }
        ) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance-code", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "input",
          {
            className: "ofs-settings-input ofs-guidance-code-input",
            type: "text",
            autoComplete: "off",
            spellCheck: false,
            value: code,
            "aria-label": t("studio.guidance.auth.codeLabel"),
            placeholder,
            onChange: (event) => setCode(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip",
            disabled: !loginCodeCanSubmit(code) || Boolean(login.busy),
            onClick: () => login.submit(code),
            children: t("studio.guidance.auth.codeSubmit")
          }
        )
      ] }),
      login.codeErrorKey ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "ofs-guidance-code-error", role: "alert", children: t(login.codeErrorKey) }) : null
    ] }) : null,
    notes.map((text) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "ofs-guidance-note", children: text }, text))
  ] });
}
function DirectLoginCard({ t, login, runProbe: runProbe2, onRetry, copyText, openLogs, dismiss, detail, provider = "kaggle" }) {
  const view = login.login && typeof login.login === "object" ? login.login : {};
  const state = typeof view.state === "string" ? view.state : "idle";
  const pending = state === "pending";
  const isColab = provider === "colab";
  const title = t(isColab ? "studio.guidance.auth.colabTitle" : "studio.guidance.auth.directTitle");
  const note = formatText(
    t(isColab ? "studio.guidance.auth.colabHint" : "studio.guidance.auth.directHint"),
    { path: isColab ? COLAB_CREDENTIAL_PATH : KAGGLE_CREDENTIAL_PATH }
  );
  const actionLabel = t(isColab ? "studio.guidance.auth.colabAction" : "studio.guidance.auth.loginAction");
  function viewLogs(event) {
    if (typeof openLogs !== "function") return;
    openLogs(event && event.currentTarget ? event.currentTarget : null);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "ofs-guidance-icon", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "alert", size: 15 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "ofs-guidance-title", children: title }),
      detail ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "ofs-guidance-detail", title: detail, children: detail }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(OAuthManualPanel, { t, login, copyText, provider }),
      !pending ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "ofs-guidance-note", children: note }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "ofs-guidance-actions", children: [
        pending ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip is-on",
            disabled: Boolean(login.busy),
            onClick: login.cancel,
            children: t("studio.guidance.auth.cancel")
          }
        ) : state === "done" ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip is-on",
            disabled: Boolean(login.pending),
            onClick: login.start,
            children: state === "failed" ? t("studio.guidance.auth.retry") : actionLabel
          }
        ),
        isColab ? typeof onRetry === "function" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "ofs-chip", onClick: onRetry, children: t("studio.guidance.auth.colabRetryWake") }) : null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "ofs-chip", onClick: runProbe2, children: t("studio.guidance.cli.action") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "ofs-chip", onClick: viewLogs, children: t("studio.guidance.viewLogs") }),
        dismiss ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip",
            onClick: () => {
              if (pending) login.cancel();
              dismiss();
            },
            children: t("studio.guidance.close")
          }
        ) : null
      ] })
    ] })
  ] });
}

// src/studio/GuidanceCard.jsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var SECONDARY_KINDS = /* @__PURE__ */ new Set(["session", "network", "generate", "generic", "auth", "gpu"]);
async function safeCall(request2) {
  try {
    return await request2();
  } catch {
    return null;
  }
}
function snapshotOf(result) {
  return result && result.ok === true && result.data && typeof result.data === "object" ? result.data : {};
}
function GuidanceCard(props) {
  const { t, guidance, compute, actions, ui } = props;
  const { kind, code: errorCode, detail, dismiss } = guidance;
  const { resetToSafe, retryFocusedJob } = actions;
  const { startSession: startSession2, requeueSession, runProbe: runProbe2, retryHost } = compute;
  const { copyInstallCommand, copyText, openLogs } = ui;
  const directMode = compute && compute.kaggleTransport === "direct";
  const login = compute && compute.kaggleLogin ? compute.kaggleLogin : null;
  const colabProvider = compute && (compute.session && compute.session.provider === "colab" || compute.provider === "colab");
  const colabLogin = compute && compute.colabLogin ? compute.colabLogin : null;
  const isQueueTimeout = kind === "session" && errorCode === "queue_timeout";
  if (!kind) return null;
  if (colabProvider && colabLogin && kind === "auth") {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      DirectLoginCard,
      {
        t,
        provider: "colab",
        login: colabLogin,
        onRetry: startSession2,
        copyText,
        openLogs,
        dismiss,
        detail
      }
    );
  }
  if (directMode && login && (kind === "auth" || kind === "cli")) {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      DirectLoginCard,
      {
        t,
        login,
        runProbe: runProbe2,
        copyText,
        openLogs,
        dismiss,
        detail
      }
    );
  }
  const cards = {
    oom: {
      title: t("studio.guidance.oom.title"),
      actions: [{ key: "reset", label: t("studio.guidance.oom.action"), run: resetToSafe }]
    },
    sleep: {
      title: t("studio.guidance.sleep.title"),
      actions: [{ key: "wake", label: t("studio.guidance.sleep.action"), run: startSession2 }]
    },
    closed: {
      title: t("studio.guidance.closed.title"),
      actions: [{ key: "wake", label: t("studio.guidance.sleep.action"), run: startSession2 }]
    },
    // 连不上本地服务：宿主轮询会自动重试，这里给一个「重试」让用户能立刻拉一次状态。
    network: {
      title: t("studio.guidance.network.title"),
      actions: [{ key: "retry", label: t("studio.guidance.network.action"), run: retryHost }]
    },
    auth: {
      title: t("studio.guidance.auth.title"),
      // 新版 CLI 一条命令就完成 OAuth 授权，比让用户手动改文件少两步；
      // 凭据位置与网页 Token / 旧版 kaggle.json 的兼容口径都由常量提供。
      command: KAGGLE_LOGIN_COMMAND,
      note: formatText(t("studio.guidance.auth.credentialHint"), {
        path: KAGGLE_CREDENTIAL_PATH,
        token: KAGGLE_ACCESS_TOKEN_PATH,
        legacy: KAGGLE_LEGACY_CREDENTIAL_PATH
      }),
      actions: [
        { key: "settings", label: t("studio.guidance.auth.action"), href: KAGGLE_SETTINGS_URL },
        {
          key: "copyLogin",
          label: t("studio.guidance.auth.copyLogin"),
          run: typeof copyText === "function" ? () => copyText(KAGGLE_LOGIN_COMMAND, "studio.guidance.auth.copied") : void 0
        },
        { key: "recheck", label: t("studio.guidance.cli.action"), run: runProbe2 }
      ]
    },
    cli: {
      title: t("studio.guidance.cli.title"),
      command: KAGGLE_INSTALL_COMMAND,
      note: t("studio.guidance.cli.pathHint"),
      actions: [
        { key: "copy", label: t("studio.guidance.cli.copy"), run: copyInstallCommand },
        { key: "recheck", label: t("studio.guidance.cli.action"), run: runProbe2 }
      ]
    },
    // 远端容器没拿到 GPU：重试或唤醒都救不了，先让用户去 Kaggle 账户设置开启 GPU。
    gpu: {
      title: t("studio.guidance.gpu.title"),
      note: t("studio.guidance.gpu.hint"),
      actions: [
        { key: "settings", label: t("studio.guidance.gpu.action"), href: KAGGLE_ACCOUNT_URL },
        { key: "wake", label: t("studio.guidance.sleep.action"), run: startSession2 }
      ]
    },
    session: isQueueTimeout ? {
      title: t("studio.guidance.session.title"),
      note: t("studio.guidance.queueTimeout.hint"),
      // 45 分钟硬超时后排队已确定卡住：只给「换新实例重排」一个主操作。
      actions: [
        { key: "requeue", label: t("studio.guidance.queueTimeout.requeue"), run: requeueSession }
      ]
    } : {
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
  const hasSecondary = SECONDARY_KINDS.has(kind);
  const canCopyDiagnostics = hasSecondary && !isQueueTimeout;
  function viewLogs(event) {
    if (typeof openLogs !== "function") return;
    openLogs(event && event.currentTarget ? event.currentTarget : null);
  }
  async function copyDiagnostics() {
    const [stateResult, logsResult] = await Promise.all([
      safeCall(fetchState),
      safeCall(() => fetchLogs(0))
    ]);
    const context = snapshotOf(stateResult);
    const payload = readLogsPayload(logsResult);
    const fallbackSession = compute && compute.session ? compute.session : null;
    const fallbackProbe = compute && compute.probe ? compute.probe : null;
    const text = buildDiagnostics(t, {
      version: context.version || VERSION,
      session: context.session || fallbackSession,
      probe: context.probe || fallbackProbe,
      probeLastGood: context.probeLastGood,
      probeLastGoodAt: context.probeLastGoodAt,
      queue: context.queue,
      lastJob: context.lastJob,
      lines: payload.lines,
      hostLogs: payload.hostLines,
      env: payload.env,
      now: Date.now()
    });
    if (typeof copyText === "function") copyText(text, "studio.logs.copied");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: guidanceToneOf(kind) === "error" ? "ofs-guidance is-error" : "ofs-guidance", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "ofs-guidance-icon", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "alert", size: 15 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-guidance-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "ofs-guidance-title", children: card.title }),
      card.command ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("code", { className: "ofs-guidance-command", children: card.command }) : null,
      detail ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "ofs-guidance-detail", title: detail, children: detail }) : null,
      card.note ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "ofs-guidance-note", children: card.note }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "ofs-guidance-actions", children: [
        actionList.map((action, index) => action.href ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "a",
          {
            className: `ofs-chip${index === 0 ? " is-on" : ""}`,
            href: action.href,
            target: "_blank",
            rel: "noreferrer noopener",
            children: action.label
          },
          action.key
        ) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "button",
          {
            type: "button",
            className: `ofs-chip${index === 0 ? " is-on" : ""}`,
            onClick: action.run,
            children: action.label
          },
          action.key
        )),
        hasSecondary ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "ofs-chip", onClick: viewLogs, children: t("studio.guidance.viewLogs") }) : null,
        canCopyDiagnostics ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "ofs-chip", onClick: copyDiagnostics, children: t("studio.guidance.copyDiag") }) : null,
        dismiss ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "ofs-chip", onClick: dismiss, children: t("studio.guidance.close") }) : null
      ] })
    ] })
  ] });
}

// src/studio/LogsDrawer.jsx
var import_react14 = __toESM(require("react"), 1);

// src/studio/hooks/useFocusTrap.js
var import_react12 = __toESM(require("react"), 1);
var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
function useFocusTrap({ active = true, panelRef, initialFocusRef, returnFocusRef, onClose }) {
  const onCloseRef = import_react12.default.useRef(onClose);
  onCloseRef.current = onClose;
  import_react12.default.useEffect(() => {
    if (!active) return void 0;
    const initial = initialFocusRef && initialFocusRef.current;
    if (initial && typeof initial.focus === "function") initial.focus();
    function onKey(event) {
      if (event.key === "Escape") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof onCloseRef.current === "function") onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef && panelRef.current;
      if (!panel || typeof panel.querySelectorAll !== "function") return;
      const nodes = Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE)).filter((node) => !node.disabled && (!node.getAttribute || node.getAttribute("aria-hidden") !== "true"));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      const outside = !panel.contains || !panel.contains(current);
      if (event.shiftKey && (current === first || outside)) {
        if (event.preventDefault) event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        if (event.preventDefault) event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnFocusRef) {
        const opener = returnFocusRef.current;
        returnFocusRef.current = null;
        if (opener && typeof opener.focus === "function" && opener.isConnected !== false) opener.focus();
      }
    };
  }, [active, panelRef, initialFocusRef, returnFocusRef]);
}

// src/studio/hooks/useStudioLogs.js
var import_react13 = __toESM(require("react"), 1);
function sameLines(previous, next) {
  if (previous.length !== next.length) return false;
  return previous.every((line, index) => line === next[index]);
}
function sameEnv(previous, next) {
  const left = previous && typeof previous === "object" ? previous : {};
  const right = next && typeof next === "object" ? next : {};
  const keys = /* @__PURE__ */ new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (key === "timings") continue;
    if (left[key] !== right[key]) return false;
  }
  const leftTimings = left.timings && typeof left.timings === "object" ? left.timings : {};
  const rightTimings = right.timings && typeof right.timings === "object" ? right.timings : {};
  const timingKeys = /* @__PURE__ */ new Set([...Object.keys(leftTimings), ...Object.keys(rightTimings)]);
  for (const key of timingKeys) {
    if (leftTimings[key] !== rightTimings[key]) return false;
  }
  return true;
}
function useStudioLogs(open) {
  const [status, setStatus] = import_react13.default.useState("idle");
  const [lines, setLines] = import_react13.default.useState([]);
  const [hostLines, setHostLines] = import_react13.default.useState([]);
  const [reason, setReason] = import_react13.default.useState(null);
  const [env, setEnv] = import_react13.default.useState({});
  const linesRef = import_react13.default.useRef([]);
  const hostLinesRef = import_react13.default.useRef([]);
  const envRef = import_react13.default.useRef({});
  const sinceRef = import_react13.default.useRef(0);
  import_react13.default.useEffect(() => {
    if (!open) return void 0;
    let alive = true;
    let timer2 = null;
    let inFlight2 = false;
    linesRef.current = [];
    hostLinesRef.current = [];
    envRef.current = {};
    sinceRef.current = 0;
    setLines([]);
    setHostLines([]);
    setReason(null);
    setEnv({});
    setStatus("loading");
    const clear = () => {
      if (timer2 !== null) {
        clearTimeout(timer2);
        timer2 = null;
      }
    };
    const tick2 = async () => {
      timer2 = null;
      if (!alive || document.hidden || inFlight2) return;
      inFlight2 = true;
      try {
        const result = await fetchLogs(sinceRef.current);
        if (!alive) return;
        const payload = readLogsPayload(result);
        if (payload.next !== null) sinceRef.current = payload.next;
        const merged = appendLogLines(linesRef.current, payload.lines);
        if (merged !== linesRef.current) {
          linesRef.current = merged;
          setLines(merged);
        }
        if (!sameLines(hostLinesRef.current, payload.hostLines)) {
          hostLinesRef.current = payload.hostLines;
          setHostLines(payload.hostLines);
        }
        if (!sameEnv(envRef.current, payload.env)) {
          envRef.current = payload.env;
          setEnv(payload.env);
        }
        if (payload.ok) {
          setStatus(merged.length === 0 ? "empty" : "ready");
          setReason(null);
        } else {
          setStatus("unavailable");
          setReason(payload.reason);
        }
      } finally {
        inFlight2 = false;
      }
      if (alive && !document.hidden) timer2 = setTimeout(tick2, TIMEOUTS.clientLogsPollMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clear();
        return;
      }
      clear();
      tick2();
    };
    tick2();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open]);
  return { status, lines, hostLines, reason, env };
}
function useHostSnapshot(enabled) {
  const [snapshot2, setSnapshot] = import_react13.default.useState(null);
  import_react13.default.useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      return void 0;
    }
    let alive = true;
    fetchState().then((result) => {
      if (!alive) return;
      if (result && result.ok && result.data && typeof result.data === "object") setSnapshot(result.data);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return snapshot2;
}

// src/studio/LogsDrawer.jsx
var import_jsx_runtime12 = require("react/jsx-runtime");
function LogsDrawer(props) {
  const { t, ui, compute, logs, onClose } = props;
  const panelRef = import_react14.default.useRef(null);
  const closeRef = import_react14.default.useRef(null);
  const bodyRef = import_react14.default.useRef(null);
  const snapshot2 = useHostSnapshot(true);
  const remoteLines = Array.isArray(logs.lines) ? logs.lines : [];
  const hostLines = Array.isArray(logs.hostLines) ? logs.hostLines : [];
  const [manualView, setManualView] = import_react14.default.useState(null);
  const autoView = remoteLines.length === 0 && hostLines.length > 0 ? "host" : "remote";
  const view = manualView ?? autoView;
  const showingHost = view === "host";
  const autoFallback = manualView === null && autoView === "host";
  const visibleLines = showingHost ? hostLines : remoteLines;
  useFocusTrap({ panelRef, initialFocusRef: closeRef, onClose });
  import_react14.default.useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [view, remoteLines.length, hostLines.length]);
  function copyDiagnostics() {
    const context = snapshot2 || {};
    const session = context.session || compute && compute.session || null;
    const probe = context.probe || compute && compute.probe || null;
    const text = buildDiagnostics(t, {
      version: context.version || VERSION,
      session,
      probe,
      probeLastGood: context.probeLastGood,
      probeLastGoodAt: context.probeLastGoodAt,
      queue: context.queue,
      lastJob: context.lastJob,
      lines: remoteLines,
      hostLogs: hostLines,
      env: logs.env,
      now: Date.now()
    });
    ui.copyText(text, "studio.logs.copied");
  }
  const loading = logs.status === "loading" || logs.status === "idle";
  const unavailable = logs.status === "unavailable";
  const empty = logs.status === "empty";
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "ofs-logs", role: "presentation", onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "div",
    {
      className: "ofs-logs-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("studio.logs.title"),
      ref: panelRef,
      onClick: (event) => event.stopPropagation(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("header", { className: "ofs-logs-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "ofs-logs-title", children: t("studio.logs.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "ofs-logs-tabs", role: "group", "aria-label": t("studio.logs.title"), children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "button",
              {
                type: "button",
                className: `ofs-chip ofs-logs-tab${showingHost ? "" : " is-on"}`,
                "aria-pressed": !showingHost,
                onClick: () => setManualView("remote"),
                children: t("studio.logs.tab.remote")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "button",
              {
                type: "button",
                className: `ofs-chip ofs-logs-tab${showingHost ? " is-on" : ""}`,
                "aria-pressed": showingHost,
                onClick: () => setManualView("host"),
                children: t("studio.logs.tab.host")
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "ofs-grow" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", { type: "button", className: "ofs-chip ofs-logs-copy", onClick: copyDiagnostics, children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Icon, { name: "copy", size: 13 }),
            t("studio.logs.copy")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            "button",
            {
              ref: closeRef,
              type: "button",
              className: "ofs-icon-btn",
              onClick: onClose,
              title: t("studio.logs.close"),
              "aria-label": t("studio.logs.close"),
              children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Icon, { name: "close", size: 16 })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "ofs-logs-body", ref: bodyRef, role: "log", children: [
          autoFallback ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-fallback", role: "status", children: t("studio.logs.hostFallbackTitle") }) : null,
          loading && !showingHost && remoteLines.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-note", children: t("studio.logs.loading") }) : null,
          unavailable ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-note is-warn", children: errorText(t, logs.reason) || t("error.code.logs_unavailable") }) : null,
          !showingHost && empty && remoteLines.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-note", children: t("studio.logs.empty") }) : null,
          showingHost && hostLines.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-note", children: t("studio.logs.hostEmpty") }) : null,
          showingHost && hostLines.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "ofs-logs-note", children: t("studio.logs.hostNote") }) : null,
          visibleLines.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { className: "ofs-logs-lines", children: visibleLines.join("\n") }) : null
        ] })
      ]
    }
  ) });
}

// src/studio/PipelineBar.jsx
var import_react15 = __toESM(require("react"), 1);

// src/logic/pipeline.js
var PIPELINE_APPEAR_MS = 1500;
var PIPELINE_DONE_HOLD_MS = 1200;
var DONE_HOLD_SLACK_MS = TIMEOUTS.clientStateActivePollMs;
var SESSION_NODES = ["push", "queue", "tunnel", "model"];
var PHASE_NODE = { push: 0, queue: 1, tunnel: 2, warm: 3 };
var SESSION_ERROR_NODE = {
  // 环境前置（没装 CLI / 没登录）：推送都还没开始，红点落在第一段。
  auth_required: 0,
  cli_missing: 0,
  push_failed: 0,
  queue_timeout: 1,
  tunnel_timeout: 2,
  gpu_unavailable: 3,
  health_failed: 3,
  remote_error: 3,
  session_error: 3,
  session_timeout: 3
};
var NON_STAGE_ERROR_CODES = /* @__PURE__ */ new Set(["session_ended", "session_absent", "disposed"]);
var FALLBACK_ERROR_NODE = 3;
function isoMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function clockOf(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.max(0, Math.floor(value / 1e3));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function nodeLabelOf(t, key) {
  return localized(t, `studio.pipeline.node.${key}`) || key;
}
function nodeHintOf(t, key) {
  if (key === "push") return localized(t, "session.hint.push");
  if (key === "queue") return localized(t, "session.hint.queue");
  if (key === "tunnel") return localized(t, "session.hint.connecting");
  if (key === "model") return localized(t, "session.hint.warming");
  return localized(t, `studio.pipeline.hint.${key}`);
}
function sessionProgressOf(session) {
  const state = session && typeof session.state === "string" ? session.state : "absent";
  const phase = session && typeof session.phase === "string" ? session.phase : "";
  if (state === "ready") return { done: 4, active: -1, failed: -1 };
  if (state === "error") {
    const code = session && session.error && typeof session.error.code === "string" ? session.error.code : "";
    const index2 = SESSION_ERROR_NODE[code] !== void 0 ? SESSION_ERROR_NODE[code] : FALLBACK_ERROR_NODE;
    return { done: index2, active: -1, failed: index2 };
  }
  if (TRANSIENT_SESSION[state] !== true) return { done: 0, active: -1, failed: -1 };
  const index = PHASE_NODE[phase] !== void 0 ? PHASE_NODE[phase] : state === "connecting" || PHASE_STATE[phase] === "connecting" ? 2 : state === "warming" || PHASE_STATE[phase] === "warming" ? 3 : 0;
  return { done: index, active: index, failed: -1 };
}
function generationStateOf(job) {
  const status = job && typeof job.status === "string" ? job.status : "";
  if (status === "running") return { state: "active", count: jobCountOf(job) };
  if (status === "done") return { state: "done", count: null };
  if (status === "failed") return { state: "failed", count: null };
  if (status === "cancelled") return { state: "cancelled", count: null };
  if (!job) return { state: "pending", count: null };
  return {
    state: "pending",
    count: null,
    waiting: status === "queued" ? "studio.progress.queued" : null
  };
}
function waitStartOf(session, job) {
  const state = session && typeof session.state === "string" ? session.state : "absent";
  if (TRANSIENT_SESSION[state] === true) {
    return state === "provisioning" ? isoMs(session && session.startedAt) : null;
  }
  if (job) return isoMs(job.createdAt || job.startedAt);
  return null;
}
function elapsedOf(start, now) {
  if (start === null) return null;
  return Math.max(0, Number(now) - start);
}
function finishedMsOf(job) {
  const seconds = Number(job && job.seconds);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1e3);
  const start = isoMs(job && (job.startedAt || job.createdAt));
  const end = isoMs(job && job.finishedAt);
  if (start !== null && end !== null) return Math.max(0, end - start);
  return null;
}
function pipelineHoldOf(job, now) {
  if (!job || job.status !== "done") return false;
  const finished = isoMs(job.finishedAt);
  if (finished === null) return false;
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return current - finished < PIPELINE_DONE_HOLD_MS + DONE_HOLD_SLACK_MS;
}
function buildNodes(t, input) {
  const { progress, generation: generation2, folded, queueLevel } = input;
  const nodes = [];
  if (folded) {
    nodes.push({
      key: "ready",
      label: nodeLabelOf(t, "ready"),
      state: "done",
      title: nodeHintOf(t, "ready")
    });
  } else {
    SESSION_NODES.forEach((key, index) => {
      let state = "pending";
      if (progress.failed === index) state = "failed";
      else if (progress.active === index) state = "active";
      else if (index < progress.done) state = "done";
      const node = { key, label: nodeLabelOf(t, key), state, title: nodeHintOf(t, key) };
      if (key === "queue" && state === "active" && queueLevel) {
        node.warn = true;
        node.tag = localized(t, "studio.pipeline.slow") || "";
      }
      nodes.push(node);
    });
  }
  const gen = { key: "generate", label: nodeLabelOf(t, "generate"), state: generation2.state };
  if (generation2.state === "active" && generation2.count) {
    gen.sub = formatText(localized(t, "studio.pipeline.count"), generation2.count);
  }
  if (generation2.state === "done") gen.label = nodeLabelOf(t, "done");
  if (generation2.state === "failed") gen.label = nodeLabelOf(t, "failed");
  if (generation2.state === "pending" && generation2.waiting) {
    gen.sub = localized(t, generation2.waiting) || "";
  }
  if (generation2.state === "cancelled") gen.state = "pending";
  nodes.push(gen);
  return nodes;
}
function pipelineViewOf(t, input = {}) {
  const session = input.session || null;
  const activeJob = input.activeJob || null;
  const focusedJob = input.focusedJob || null;
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const pendingCount = Number.isFinite(Number(input.pendingCount)) ? Math.max(0, Math.floor(Number(input.pendingCount))) : 0;
  const label = localized(t, "studio.pipeline.label") || "";
  const hidden = { visible: false, mode: "hidden", nodes: [], queueText: "", timeLabel: "", timeText: "", label };
  const sessionState = session && typeof session.state === "string" ? session.state : "absent";
  if (sessionState === "stopping") {
    return {
      visible: true,
      mode: "closing",
      nodes: [{
        key: "closing",
        label: localized(t, "studio.pipeline.node.closing") || "",
        state: "warn",
        title: localized(t, "session.hint.stopping") || ""
      }],
      queueText: "",
      timeLabel: "",
      timeText: "",
      label
    };
  }
  const queuePolicy = queuePolicyOf({ queuePolicy: input.queuePolicy });
  const queueLevel = queueLevelOf(queueWaitMsOf(session, now), queuePolicy);
  const progress = sessionProgressOf(session);
  const generation2 = generationStateOf(activeJob);
  const sessionErrorCode = session && session.error && typeof session.error.code === "string" ? session.error.code : "";
  const sessionFailed = sessionState === "error" && !NON_STAGE_ERROR_CODES.has(sessionErrorCode);
  const jobFailed = Boolean(focusedJob && focusedJob.status === "failed");
  const failed = (sessionFailed || jobFailed) && input.failureDismissed !== true;
  const doneHold = !activeJob && pipelineHoldOf(focusedJob, now);
  const folded = sessionState === "ready" && !sessionFailed;
  if (failed) {
    const failureNodes = buildNodes(t, {
      progress,
      generation: sessionFailed && !jobFailed ? { state: "pending", count: null } : { state: "failed", count: null },
      folded,
      queueLevel
    });
    const elapsed2 = sessionFailed ? null : (() => {
      const start2 = waitStartOf(session, focusedJob);
      const finished = isoMs(focusedJob && focusedJob.finishedAt);
      if (start2 !== null) return Math.max(0, (finished ?? now) - start2);
      return finishedMsOf(focusedJob);
    })();
    return {
      visible: true,
      mode: "failed",
      nodes: failureNodes,
      queueText: "",
      timeLabel: localized(t, "studio.pipeline.elapsed") || "",
      timeText: elapsed2 === null || elapsed2 <= 0 ? "" : clockOf(elapsed2),
      label
    };
  }
  if (doneHold) {
    const doneNodes = buildNodes(t, {
      progress,
      generation: { state: "done", count: null },
      folded,
      queueLevel
    });
    const used = finishedMsOf(focusedJob);
    return {
      visible: true,
      mode: "complete",
      nodes: doneNodes,
      queueText: "",
      timeLabel: localized(t, "studio.pipeline.elapsedDone") || "",
      timeText: clockOf(used ?? 0),
      label
    };
  }
  const waiting = TRANSIENT_SESSION[sessionState] === true || Boolean(activeJob);
  if (!waiting) return hidden;
  const start = waitStartOf(session, activeJob);
  if (start !== null && now - start < PIPELINE_APPEAR_MS) return hidden;
  const nodes = buildNodes(t, { progress, generation: generation2, folded, queueLevel });
  const others = Math.max(0, pendingCount - (activeJob ? 1 : 0));
  const elapsed = elapsedOf(start, now);
  return {
    visible: true,
    mode: "waiting",
    nodes,
    queueText: others > 0 ? formatText(localized(t, "studio.pipeline.busy"), { count: others }) : "",
    timeLabel: localized(t, "studio.pipeline.elapsed") || "",
    timeText: elapsed === null ? "" : clockOf(elapsed),
    label
  };
}

// src/studio/PipelineBar.jsx
var import_jsx_runtime13 = require("react/jsx-runtime");
function nodeClassOf(node) {
  const classes = ["ofs-pl-node", `is-${node.state}`];
  if (node.warn) classes.push("is-warn");
  return classes.join(" ");
}
function linkClassOf(previous, node) {
  const filled = previous.state === "done" || previous.state === "failed";
  const classes = ["ofs-pl-link"];
  if (filled) classes.push("is-filled");
  if (filled && node.state === "active") classes.push("is-flowing");
  return classes.join(" ");
}
function PipelineBar(props) {
  const { t } = props;
  const session = props.session || null;
  const activeJob = props.activeJob || null;
  const focusedJob = props.focusedJob || null;
  const pendingCount = props.pendingCount;
  const queuePolicy = props.queuePolicy || null;
  const failureDismissed = props.failureDismissed === true;
  const ticking = props.transient === true || Boolean(activeJob) || pipelineHoldOf(focusedJob, Date.now());
  const now = useNow(ticking);
  const view = import_react15.default.useMemo(
    () => pipelineViewOf(t, {
      session,
      activeJob,
      focusedJob,
      pendingCount,
      queuePolicy,
      failureDismissed,
      now
    }),
    [t, session, activeJob, focusedJob, pendingCount, queuePolicy, failureDismissed, now]
  );
  const hidden = !view || view.visible !== true;
  const mode = hidden ? "hidden" : view.mode;
  const nodes = hidden ? [] : view.nodes || [];
  const folded = nodes.length > 0 && nodes[0].key === "ready";
  const className = [
    "ofs-pipeline",
    hidden ? "is-hidden" : "",
    mode === "complete" ? "is-complete" : "",
    mode === "closing" ? "is-closing" : ""
  ].filter(Boolean).join(" ");
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
    "div",
    {
      className,
      role: "status",
      "aria-live": "polite",
      "aria-label": hidden ? void 0 : view.label || void 0,
      "aria-hidden": hidden ? "true" : void 0,
      "data-mode": mode,
      children: hidden ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_react15.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: folded ? "ofs-pl-rail is-folded" : "ofs-pl-rail", children: nodes.map((node, index) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_react15.Fragment, { children: [
          index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: linkClassOf(nodes[index - 1], node), "aria-hidden": "true" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: nodeClassOf(node), title: node.title || void 0, children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "ofs-pl-dot", "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "ofs-pl-label", children: node.label }),
            node.sub ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "ofs-pl-sub", children: node.sub }) : null,
            node.tag ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "ofs-pl-tag", children: node.tag }) : null
          ] })
        ] }, node.key)) }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "ofs-pl-meta", "aria-hidden": "true", children: [
          view.queueText ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "ofs-pl-queue", children: view.queueText }) : null,
          view.timeText ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: "ofs-pl-time", children: [
            view.timeLabel ? `${view.timeLabel} ` : "",
            view.timeText
          ] }) : null
        ] })
      ] })
    }
  );
}

// src/studio/QueueNotice.jsx
var import_react16 = __toESM(require("react"), 1);
var import_jsx_runtime14 = require("react/jsx-runtime");
function QueueNotice(props) {
  const { t, notice } = props;
  if (!notice) return null;
  const minutes = Number.isFinite(notice.minutes) ? notice.minutes : 10;
  const title = formatText(t("studio.queue.notice.title"), { minutes });
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "ofs-guidance ofs-queue-notice", role: "status", "aria-live": "polite", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "ofs-guidance-icon", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Icon, { name: "clock", size: 15 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "ofs-guidance-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "ofs-guidance-title", children: title }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "ofs-guidance-note", children: t("studio.queue.notice.note") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "ofs-guidance-actions", children: [
        typeof notice.requeue === "function" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", className: "ofs-chip is-on", onClick: notice.requeue, children: t("studio.queue.notice.requeue") }) : null,
        typeof notice.dismiss === "function" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", className: "ofs-chip", onClick: notice.dismiss, children: t("studio.queue.notice.wait") }) : null
      ] })
    ] })
  ] });
}

// src/studio/Rail.jsx
var import_react23 = __toESM(require("react"), 1);

// src/logic/clamp.js
function clampSize(value) {
  if (value === null || value === void 0 || typeof value === "boolean") return 1024;
  if (typeof value === "string" && value.trim() === "") return 1024;
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

// src/studio/rail/FrameSection.jsx
var import_react18 = __toESM(require("react"), 1);

// src/studio/presets.js
var RATIO_SPECS = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 }
};
var DEFAULT_RATIOS = RATIO_IDS.map((id) => RATIO_SPECS[id] ? { id, ...RATIO_SPECS[id] } : null).filter(Boolean);
function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) };
}

// src/studio/rail/Fieldset.jsx
var import_react17 = __toESM(require("react"), 1);
var import_jsx_runtime15 = require("react/jsx-runtime");
function Fieldset(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "ofs-fieldset", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "ofs-fieldset-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: props.title }),
      props.action ? props.action : null
    ] }),
    props.children
  ] });
}

// src/studio/rail/FrameSection.jsx
var import_jsx_runtime16 = require("react/jsx-runtime");
function sizeDraftOf(width, height) {
  return { width: String(clampSize(width)), height: String(clampSize(height)) };
}
function FrameSection({
  t,
  width,
  height,
  frameSizeText,
  ratioId,
  applyRatio,
  applyCustomSize
}) {
  const [sizeDraft, setSizeDraft] = import_react18.default.useState(() => sizeDraftOf(width, height));
  const syncedSize = import_react18.default.useRef(void 0);
  import_react18.default.useEffect(() => {
    const previous = syncedSize.current;
    syncedSize.current = { width, height };
    if (!previous) return;
    if (previous.width === width && previous.height === height) return;
    setSizeDraft(sizeDraftOf(width, height));
  }, [width, height]);
  const [customOpen, setCustomOpen] = import_react18.default.useState(false);
  const onCustomSize = typeof applyCustomSize === "function" ? applyCustomSize : () => {
  };
  function updateSizeDraft(key, value) {
    setSizeDraft((prev) => ({ ...prev, [key]: value }));
  }
  function commitSizeDraft(key) {
    const raw = String(sizeDraft[key] ?? "").trim();
    const currentValue = key === "width" ? width : height;
    if (!raw) {
      setSizeDraft((prev) => ({ ...prev, [key]: String(clampSize(currentValue)) }));
      return;
    }
    const value = clampSize(raw);
    setSizeDraft((prev) => ({ ...prev, [key]: String(value) }));
    if (value !== clampSize(currentValue)) onCustomSize({ [key]: value });
  }
  const sizeFields = [
    { key: "width", label: t("studio.rail.width"), limits: LIMITS.width },
    { key: "height", label: t("studio.rail.height"), limits: LIMITS.height }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
    Fieldset,
    {
      title: t("studio.rail.frame"),
      action: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "ofs-frame-readout", children: frameSizeText }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "ofs-frame-group", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "ofs-frame-label", children: t("studio.rail.ratio") }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "ofs-ratio-row", role: "group", "aria-label": t("studio.rail.ratio"), children: DEFAULT_RATIOS.map((ratio) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
            "button",
            {
              type: "button",
              className: ratioId === ratio.id ? "ofs-ratio is-on" : "ofs-ratio",
              onClick: () => applyRatio(ratio.id),
              "aria-pressed": ratioId === ratio.id,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: `ofs-ratio-glyph ofs-ratio-glyph--${ratio.id.replace(":", "-")}`, "aria-hidden": "true" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "ofs-ratio-label", children: ratio.id })
              ]
            },
            ratio.id
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "ofs-frame-group", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-custom-toggle",
              "aria-expanded": customOpen,
              onClick: () => setCustomOpen((open) => !open),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: t("studio.rail.customSize") }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: customOpen ? "ofs-chevron is-open" : "ofs-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Icon, { name: "chevronDown", size: 14 }) })
              ]
            }
          ),
          customOpen ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "ofs-custom-body", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "ofs-size-custom", children: sizeFields.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_react18.default.Fragment, { children: [
            index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "ofs-size-custom-times", "aria-hidden": "true", children: "×" }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { className: "ofs-size-custom-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: item.label }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                "input",
                {
                  type: "number",
                  min: item.limits.min,
                  max: item.limits.max,
                  step: item.limits.step,
                  value: sizeDraft[item.key],
                  "aria-label": item.label,
                  onChange: (event) => updateSizeDraft(item.key, event.target.value),
                  onBlur: () => commitSizeDraft(item.key),
                  onKeyDown: (event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }
                }
              )
            ] })
          ] }, item.key)) }) }) : null
        ] })
      ]
    }
  );
}

// src/studio/rail/ParamsSection.jsx
var import_react20 = __toESM(require("react"), 1);

// shared/models-guide.js
function effectiveCfgOf(preset, cfg) {
  const value = Number(cfg);
  if (Number.isFinite(value)) return value;
  const recommended = Number(preset && preset.cfg);
  return Number.isFinite(recommended) ? recommended : 0;
}
function negativePromptActive(preset, cfg) {
  const effective = effectiveCfgOf(preset, cfg);
  if (!preset || typeof preset !== "object") return effective > 0;
  const capable = typeof preset.supportsNegative === "boolean" ? preset.supportsNegative : typeof preset.negativeHint === "string" && preset.negativeHint.trim() !== "";
  if (!capable || effective <= 0) return false;
  const hint = typeof preset.negativeHint === "string" ? preset.negativeHint.trim() : "";
  if (hint) return true;
  const recommended = Number(preset.cfg);
  return Number.isFinite(recommended) && effective > recommended;
}
function stepModeOf(preset) {
  const r = preset && typeof preset === "object" ? preset.stepRange : null;
  if (preset && preset.tier === "usable" && r && typeof r === "object" && Number.isFinite(Number(r.min)) && Number.isFinite(Number(r.max)) && Number.isFinite(Number(r.fast)) && Number.isFinite(Number(r.balanced)) && Number.isFinite(Number(r.fine)) && Number(r.min) < Number(r.max)) {
    return "range";
  }
  return "fixed";
}
function stepTierOf(preset, steps) {
  if (stepModeOf(preset) !== "range") return "fixed";
  const r = preset.stepRange;
  const val = Number(steps);
  if (!Number.isFinite(val)) return "balanced";
  const fastMid = (Number(r.fast) + Number(r.balanced)) / 2;
  const fineMid = (Number(r.balanced) + Number(r.fine)) / 2;
  if (val < fastMid) return "fast";
  if (val <= fineMid) return "balanced";
  return "fine";
}
function safeResetPatch(preset) {
  const rawSize = Number(preset?.size);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(Math.max(Math.round(rawSize / LIMITS.width.step) * LIMITS.width.step, LIMITS.width.min), LIMITS.width.max) : 1024;
  const rawSteps = Number(preset?.steps);
  const steps = Number.isFinite(rawSteps) ? Math.min(Math.max(Math.round(rawSteps), LIMITS.steps.min), LIMITS.steps.max) : 4;
  const rawCfg = Number(preset?.cfg);
  const cfg = Number.isFinite(rawCfg) ? Math.min(Math.max(rawCfg, LIMITS.cfg.min), LIMITS.cfg.max) : 1;
  return { width: size, height: size, steps, cfg };
}

// src/components/Tooltip.jsx
var import_react19 = __toESM(require("react"), 1);

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
var import_jsx_runtime17 = require("react/jsx-runtime");
var POPUP_MAX = 248;
function Tooltip(props) {
  const { text, tone = "info", side = "top" } = props;
  const [open, setOpen] = import_react19.default.useState(false);
  const [pinned, setPinned] = import_react19.default.useState(false);
  const [pos, setPos] = import_react19.default.useState(null);
  const triggerRef = import_react19.default.useRef(null);
  const close = import_react19.default.useCallback(() => {
    setPinned(false);
    setOpen(false);
  }, []);
  const measure = import_react19.default.useCallback(() => {
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
  import_react19.default.useEffect(() => {
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
  import_react19.default.useEffect(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { className: `ofs-tip ofs-tip--${tone}${open ? " is-open" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
        children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { "aria-hidden": "true", children: tone === "warn" ? "!" : "i" })
      }
    ),
    open && pos ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { role: "tooltip", className: pos.below ? "ofs-tip-pop is-below" : "ofs-tip-pop", style: popupStyle, children: text }) : null
  ] });
}

// src/studio/rail/ParamsSection.jsx
var import_jsx_runtime18 = require("react/jsx-runtime");
function AdvancedParamsGrid({
  t,
  fields,
  activePreset,
  patchForm,
  applyCfg,
  resetSeed,
  seedText
}) {
  const stepMode = stepModeOf(activePreset);
  const stepTier = stepTierOf(activePreset, fields.steps);
  const stepRange = stepMode === "range" ? activePreset.stepRange : null;
  const displayedSteps = stepMode === "fixed" && Number.isFinite(Number(activePreset?.steps)) ? Number(activePreset.steps) : Number(fields.steps) || 1;
  const onResetSeed = typeof resetSeed === "function" ? resetSeed : () => patchForm({ seed: "" });
  const onCfgChange = typeof applyCfg === "function" ? applyCfg : (value) => patchForm({ cfg: Number(value) });
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-grid2", children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-field ofs-field--wide", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-step-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { className: "ofs-field-label", children: [
          t("studio.steps"),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Tooltip, { text: t(stepMode === "fixed" ? "studio.stepsFixedTooltip" : "studio.stepsTooltip") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: stepMode === "fixed" ? "ofs-step-readout is-fixed" : "ofs-step-readout", children: formatText(t("studio.stepsReadout"), {
          steps: displayedSteps,
          tier: t(`studio.stepsTier.${stepTier}`)
        }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        "input",
        {
          type: "range",
          className: "ofs-step-slider",
          min: stepRange ? stepRange.min : displayedSteps,
          max: stepRange ? stepRange.max : displayedSteps,
          step: stepRange ? stepRange.step : 1,
          value: displayedSteps,
          disabled: stepMode === "fixed",
          "aria-label": t("studio.steps"),
          onChange: (event) => patchForm({ steps: Number(event.target.value) })
        }
      ),
      stepRange ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "ofs-step-ticks", children: ["fast", "balanced", "fine"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        "button",
        {
          type: "button",
          className: stepTier === key ? "ofs-step-tick is-on" : "ofs-step-tick",
          onClick: () => patchForm({ steps: stepRange[key] }),
          children: `${t(`studio.stepsTier.${key}`)} ${stepRange[key]}`
        },
        key
      )) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-field ofs-field--wide", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { className: "ofs-field-label", children: [
        t("studio.cfg"),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Tooltip, { text: t("studio.cfgTooltip") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        "input",
        {
          type: "number",
          min: LIMITS.cfg.min,
          max: LIMITS.cfg.max,
          step: 0.5,
          value: fields.cfg,
          "aria-label": t("studio.cfg"),
          onChange: (event) => onCfgChange(Number(event.target.value))
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-field ofs-field--wide", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("studio.seed") }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-seed-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          "input",
          {
            type: "text",
            inputMode: "numeric",
            value: fields.seed,
            placeholder: t("studio.random"),
            "aria-label": t("studio.seed"),
            onChange: (event) => patchForm({ seed: event.target.value })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-text-action ofs-seed-reset",
            onClick: onResetSeed,
            disabled: !seedText,
            children: t("studio.seed.reset")
          }
        )
      ] })
    ] })
  ] });
}
function ParamsSection({
  t,
  fields,
  activePreset,
  patchForm,
  applyCfg,
  resetSeed,
  showNegative,
  negativeOpen,
  setNegativeOpen,
  negativePlaceholder,
  advancedOpen,
  toggleAdvanced
}) {
  const stepsValue = Number.isFinite(Number(fields.steps)) ? Math.round(Number(fields.steps)) : LIMITS.steps.min;
  const cfgValue = Number.isFinite(Number(fields.cfg)) ? Number(fields.cfg) : LIMITS.cfg.min;
  const seedText = String(fields.seed ?? "").trim();
  const paramsReadout = [
    `${stepsValue} ${t("studio.preset.stepsUnit")}`,
    `CFG ${cfgValue}`,
    seedText ? `${t("studio.meta.seed")} ${seedText}` : t("studio.seed")
  ].join(" · ");
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
    Fieldset,
    {
      title: t("studio.rail.advanced"),
      action: advancedOpen ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "ofs-row-readout", children: paramsReadout }),
      children: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-rows", children: [
        showNegative ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: negativeOpen ? "ofs-row is-open" : "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "ofs-row-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
              "button",
              {
                type: "button",
                className: "ofs-row-toggle",
                onClick: () => setNegativeOpen((open) => !open),
                "aria-expanded": negativeOpen,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("studio.negative") }),
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: negativeOpen ? "ofs-chevron is-open" : "ofs-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Icon, { name: "chevronDown", size: 14 }) })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Tooltip, { text: t("studio.negativeTooltip") })
          ] }),
          negativeOpen ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "textarea",
            {
              className: "ofs-row-textarea",
              rows: 3,
              value: fields.negative,
              placeholder: negativePlaceholder,
              spellCheck: false,
              onChange: (event) => patchForm({ negative: event.target.value })
            }
          ) : null
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: advancedOpen ? "ofs-row is-open" : "ofs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "ofs-row-head", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
            "button",
            {
              type: "button",
              className: "ofs-row-toggle",
              onClick: toggleAdvanced,
              "aria-expanded": advancedOpen,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("studio.rail.params") }),
                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: advancedOpen ? "ofs-chevron is-open" : "ofs-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Icon, { name: "chevronDown", size: 14 }) })
              ]
            }
          ) }),
          advancedOpen ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            AdvancedParamsGrid,
            {
              t,
              fields,
              activePreset,
              patchForm,
              applyCfg,
              resetSeed,
              seedText
            }
          ) : null
        ] })
      ] })
    }
  );
}

// src/studio/rail/PromptSection.jsx
var import_react21 = __toESM(require("react"), 1);
var import_jsx_runtime19 = require("react/jsx-runtime");
var PROMPT_MAX = LIMITS.prompt.maxChars;
function PromptSection({
  t,
  prompt,
  patchForm,
  generate,
  translating,
  translate,
  enhancing,
  enhance,
  englishPromptHint,
  refineGroups,
  refineSource,
  toggleRefine
}) {
  const [refineOpen, setRefineOpen] = import_react21.default.useState(true);
  const promptLength = prompt.length;
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
    Fieldset,
    {
      title: t("studio.prompt"),
      action: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Tooltip, { text: t("studio.promptTooltip") }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "ofs-composer", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
            "textarea",
            {
              className: "ofs-composer-input",
              value: prompt,
              maxLength: PROMPT_MAX,
              placeholder: t("studio.promptPlaceholder"),
              spellCheck: false,
              onChange: (event) => patchForm({ prompt: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) generate();
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "ofs-composer-foot", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { className: "ofs-counter", children: [
              promptLength,
              " / ",
              PROMPT_MAX
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { className: "ofs-composer-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
                "button",
                {
                  type: "button",
                  className: englishPromptHint ? "ofs-text-action ofs-translate-action is-suggested" : "ofs-text-action ofs-translate-action",
                  title: englishPromptHint ? t("studio.prompt.englishHint") : void 0,
                  onClick: translate,
                  disabled: translating || enhancing,
                  children: translating ? t("studio.translate.thinking") : t("studio.translate.button")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("button", { type: "button", className: "ofs-text-action", onClick: enhance, disabled: enhancing || translating, children: [
                /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Icon, { name: "expandText", size: 13 }),
                enhancing ? t("studio.enhance.thinking") : t("studio.enhance.button")
              ] })
            ] })
          ] })
        ] }),
        englishPromptHint ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: "ofs-hint ofs-prompt-lang-hint", children: t("studio.prompt.englishHint") }) : null,
        refineGroups.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "ofs-refine", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "ofs-refine-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t("studio.refine.title") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { className: "ofs-refine-head-actions", children: [
              refineSource === "local" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "ofs-muted", children: t("studio.enhance.local") }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-text-action ofs-refine-toggle",
                  "aria-expanded": refineOpen,
                  onClick: () => setRefineOpen((open) => !open),
                  children: refineOpen ? t("studio.refine.collapse") : t("studio.refine.expand")
                }
              )
            ] })
          ] }),
          refineOpen ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_jsx_runtime19.Fragment, { children: refineGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "ofs-refine-group", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "ofs-refine-dim", children: t(`studio.refine.${group.dimension}`) }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "ofs-suggestions", children: group.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
              "button",
              {
                type: "button",
                className: option.applied ? "ofs-suggestion is-on" : "ofs-suggestion",
                onClick: () => toggleRefine(option.text),
                "aria-pressed": option.applied,
                title: option.text,
                children: option.label || option.text
              },
              option.id
            )) })
          ] }, group.dimension)) }) : null
        ] }) : null
      ]
    }
  );
}

// src/studio/rail/ReferenceSection.jsx
var import_react22 = __toESM(require("react"), 1);

// src/studio/drag.js
function dataTransferTypesOf(dataTransfer) {
  const types = dataTransfer && dataTransfer.types;
  if (!types) return [];
  if (typeof types === "string") return [types];
  const out = [];
  const length = Number(types.length) || 0;
  for (let index = 0; index < length; index += 1) {
    const type = types[index];
    if (typeof type === "string") out.push(type);
  }
  return out;
}
function hasFilePayload(event) {
  const dataTransfer = event && event.dataTransfer;
  if (!dataTransfer) return false;
  if (dataTransferTypesOf(dataTransfer).includes("Files")) return true;
  const files = dataTransfer.files;
  if (files && Number(files.length) > 0) return true;
  const items = dataTransfer.items;
  if (items) {
    const length = Number(items.length) || 0;
    for (let index = 0; index < length; index += 1) {
      if (items[index] && items[index].kind === "file") return true;
    }
  }
  return false;
}
function filesOf(dataTransfer) {
  const out = [];
  const files = dataTransfer && dataTransfer.files;
  if (files) {
    const length = Number(files.length) || 0;
    for (let index = 0; index < length; index += 1) {
      if (files[index]) out.push(files[index]);
    }
  }
  if (out.length > 0) return out;
  const items = dataTransfer && dataTransfer.items;
  if (items) {
    const length = Number(items.length) || 0;
    for (let index = 0; index < length; index += 1) {
      const item = items[index];
      if (!item || item.kind !== "file") continue;
      const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
      if (file) out.push(file);
    }
  }
  return out;
}

// src/studio/rail/ReferenceSection.jsx
var import_jsx_runtime20 = require("react/jsx-runtime");
var PICK_LIMIT = 8;
var ACCEPT = "image/png,image/jpeg";
function ReferenceSection(props) {
  const {
    t,
    references,
    referenceSupported,
    referenceSwitchLabel,
    referenceMax,
    works,
    busy,
    actions
  } = props;
  const items = referenceListOf(references);
  const [picking, setPicking] = import_react22.default.useState(false);
  const [dragging, setDragging] = import_react22.default.useState(false);
  const inputRef = import_react22.default.useRef(null);
  const dragDepthRef = import_react22.default.useRef(0);
  const max = Number(referenceMax) > 0 ? Number(referenceMax) : referenceMaxCount();
  const canAdd = items.length < max;
  const addedPaths = new Set(items.map((item) => item.path));
  const pickable = (Array.isArray(works) ? works : []).filter((entry) => entry && entry.image && entry.image.path && !addedPaths.has(entry.image.path)).slice(0, PICK_LIMIT);
  if (!referenceSupported && items.length === 0) return null;
  function openPicker() {
    if (!canAdd) return;
    const input = inputRef.current;
    if (input && typeof input.click === "function") input.click();
  }
  function onFileChange(event) {
    const input = event && event.target;
    const files = input && input.files ? Array.from(input.files).filter(Boolean) : [];
    if (input) input.value = "";
    if (files.length > 0 && actions && typeof actions.uploadReferenceFiles === "function") {
      actions.uploadReferenceFiles(files);
    }
  }
  function onDragEnter(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    dragDepthRef.current += 1;
    if (!dragging) setDragging(true);
  }
  function onDragOver(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(event) {
    if (!hasFilePayload(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0 && dragging) setDragging(false);
  }
  function onDrop(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    dragDepthRef.current = 0;
    if (dragging) setDragging(false);
    const files = filesOf(event.dataTransfer);
    if (files.length > 0 && actions && typeof actions.uploadReferenceFiles === "function") {
      actions.uploadReferenceFiles(files);
    }
  }
  const zoneClass = `ofs-ref-zone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`;
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
    "div",
    {
      className: zoneClass,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      children: /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
        Fieldset,
        {
          title: t("studio.reference.title"),
          action: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "ofs-ref-count", children: `${items.length} / ${max}` }),
          children: [
            items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("button", { type: "button", className: "ofs-ref-add is-empty", onClick: openPicker, disabled: busy, children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Icon, { name: "plus", size: 14 }),
              formatText(t("studio.reference.empty"), { count: max })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "ofs-ref-grid", role: "list", "aria-label": t("studio.reference.title"), children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "ofs-ref-item", role: "listitem", children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "img",
                {
                  className: "ofs-ref-thumb",
                  src: item.url,
                  alt: item.name || t("studio.reference.title"),
                  loading: "lazy"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-ref-remove",
                  title: t("studio.reference.remove"),
                  "aria-label": t("studio.reference.remove"),
                  onClick: () => actions && typeof actions.removeReference === "function" && actions.removeReference(item.path),
                  children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Icon, { name: "close", size: 11 })
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "ofs-ref-name", title: item.path, children: item.name })
            ] }, item.path)) }),
            items.length > 0 ? canAdd ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("button", { type: "button", className: "ofs-ref-more", onClick: openPicker, disabled: busy, children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Icon, { name: "plus", size: 13 }),
              formatText(t("studio.reference.addMore"), { count: items.length, max })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-hint", children: formatText(t("studio.reference.full"), { max }) }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-hint", children: t("studio.reference.emptyHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "ofs-ref-pick", children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-text-action ofs-ref-pick-toggle",
                  "aria-expanded": picking,
                  onClick: () => setPicking((open) => !open),
                  children: picking ? t("studio.reference.pickClose") : t("studio.reference.pickWork")
                }
              ),
              picking ? pickable.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "ofs-ref-works", "aria-label": t("studio.reference.pickWork"), children: pickable.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "button",
                {
                  type: "button",
                  className: "ofs-ref-work",
                  title: entry.item && entry.item.prompt ? entry.item.prompt : entry.image.path,
                  onClick: () => {
                    if (actions && typeof actions.addReference === "function") actions.addReference(entry);
                    setPicking(false);
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("img", { src: entry.image.url, alt: entry.item && entry.item.prompt ? entry.item.prompt : entry.image.path, loading: "lazy" })
                },
                entry.image.path
              )) }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-hint", children: t("studio.reference.pickEmpty") }) : null
            ] }),
            referenceSupported ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-hint ofs-ref-quality", children: t("studio.reference.qualityHint") }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "ofs-ref-warn", role: "status", children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-ref-warn-title", children: t("studio.reference.unsupported") }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "ofs-hint", children: t("studio.reference.unsupportedHint") }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "ofs-ref-warn-actions", children: [
                referenceSwitchLabel && actions && typeof actions.switchToReferencePreset === "function" ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { type: "button", className: "ofs-ref-switch", onClick: () => actions.switchToReferencePreset(), children: formatText(t("studio.reference.switchPreset"), { preset: referenceSwitchLabel }) }) : null,
                actions && typeof actions.referenceToImg2img === "function" ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { type: "button", className: "ofs-ref-fallback", onClick: () => actions.referenceToImg2img(), children: t("studio.reference.useImg2img") }) : null
              ] })
            ] }),
            busy ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("p", { className: "ofs-hint ofs-ref-busy", role: "status", children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
              t("studio.reference.uploading")
            ] }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
              "input",
              {
                ref: inputRef,
                className: "ofs-ref-input",
                type: "file",
                accept: ACCEPT,
                multiple: true,
                tabIndex: -1,
                "aria-hidden": "true",
                hidden: true,
                onChange: onFileChange
              }
            )
          ]
        }
      )
    }
  );
}

// src/studio/Rail.jsx
var import_jsx_runtime21 = require("react/jsx-runtime");
function Rail(props) {
  const { t, ui, form, actions, library } = props;
  const {
    advancedOpen,
    toggleAdvancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    panelMode: mode,
    setPanelMode: setMode
  } = ui;
  const toggleAdvanced = typeof toggleAdvancedOpen === "function" ? toggleAdvancedOpen : () => setAdvancedOpen((open) => !open);
  const {
    form: fields,
    patchForm,
    ratioId,
    activePreset,
    applyRatio,
    applyCustomSize,
    applyCfg,
    resetSeed,
    negativeActive,
    negativeHint,
    refineGroups,
    refineSource,
    enhancing,
    enhance,
    translating,
    translate,
    toggleRefine,
    englishPromptHint,
    // 微调来源（从胶卷 / 画廊回填而来）、未提交草稿状态与「新建创作」重置入口。
    tuning,
    newCreation,
    draftView,
    // 原生参考图槽（阶段十五 Phase C2）：能力位、切换目标名与契约上限。
    referenceSupported,
    referenceSwitchLabel,
    referenceMax
  } = form;
  const { sending, generate, restoreOriginal } = actions;
  const hasPrompt = fields.prompt.trim().length > 0;
  const currentWidth = clampSize(fields.width);
  const currentHeight = clampSize(fields.height);
  const frameSizeText = `${currentWidth} × ${currentHeight}`;
  const tuningPrompt = tuning && typeof tuning === "object" && typeof tuning.prompt === "string" ? tuning.prompt.trim() : "";
  const tuningText = formatText(t("studio.rail.tuning"), {
    prompt: tuningPrompt || t("studio.rail.tuningUnknown")
  });
  const draftSource = draftView && draftView.active && draftView.source ? draftView.source : null;
  const draftActive = Boolean(draftView && draftView.active && draftView.source);
  const canRestore = Boolean(draftSource) && typeof restoreOriginal === "function";
  const startNewCreation = typeof newCreation === "function" ? newCreation : () => {
  };
  const showNegative = negativeActive === true;
  const negativePlaceholder = negativeHint.length > 60 ? `${negativeHint.slice(0, 60)}…` : negativeHint || t("studio.negativePlaceholder");
  const countValue = Number.isFinite(Number(fields.count)) ? Math.round(Number(fields.count)) : 1;
  const specParts = [
    frameSizeText,
    ratioId || t("studio.rail.custom"),
    `${countValue} ${t("unit.image")}`
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("aside", { className: "ofs-panel ofs-panel--form", children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(PanelModeTabs, { t, mode, setMode, onNewCreation: startNewCreation }),
    draftActive ? /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "ofs-tuning is-draft", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "ofs-tuning-source", title: draftSource && draftSource.prompt ? draftSource.prompt : void 0, children: t("studio.rail.draftStatus") }),
      canRestore ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-tuning-restore",
          onClick: () => restoreOriginal(),
          title: t("studio.rail.restoreOriginal"),
          children: t("studio.rail.restoreOriginal")
        }
      ) : null
    ] }) : tuning ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "ofs-tuning", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "ofs-tuning-source", title: tuningPrompt || void 0, children: tuningText }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "ofs-panel-scroll", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        PromptSection,
        {
          t,
          prompt: fields.prompt,
          patchForm,
          generate,
          translating,
          translate,
          enhancing,
          enhance,
          englishPromptHint,
          refineGroups,
          refineSource,
          toggleRefine
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        ReferenceSection,
        {
          t,
          references: fields.references,
          referenceSupported: referenceSupported === true,
          referenceSwitchLabel: referenceSwitchLabel || "",
          referenceMax,
          works: library && Array.isArray(library.gallery) ? library.gallery : [],
          busy: Boolean(actions && actions.referenceUploading),
          actions
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        FrameSection,
        {
          t,
          width: fields.width,
          height: fields.height,
          frameSizeText,
          ratioId,
          applyRatio,
          applyCustomSize
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        ParamsSection,
        {
          t,
          fields,
          activePreset,
          patchForm,
          applyCfg,
          resetSeed,
          showNegative,
          negativeOpen,
          setNegativeOpen,
          negativePlaceholder,
          advancedOpen,
          toggleAdvanced
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "ofs-panel-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "ofs-qty-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "ofs-qty-label", children: t("studio.countShort") }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "ofs-qty", role: "group", "aria-label": t("studio.count"), children: COUNT_OPTIONS.map((value) => /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
          "button",
          {
            type: "button",
            className: countValue === value ? "ofs-qty-option is-on" : "ofs-qty-option",
            onClick: () => patchForm({ count: value }),
            "aria-pressed": countValue === value,
            children: value
          },
          value
        )) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
        "button",
        {
          type: "button",
          className: sending ? "ofs-btn is-primary ofs-generate is-busy" : "ofs-btn is-primary ofs-generate",
          onClick: () => generate(),
          disabled: sending || !hasPrompt,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Icon, { name: "sparkles", size: 16 }),
            sending ? t("studio.generating") : t("studio.generate")
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "ofs-hint ofs-spec-summary", children: specParts.join(" · ") })
    ] })
  ] });
}

// src/studio/SettingsDrawer.jsx
var import_react26 = __toESM(require("react"), 1);

// src/studio/settings/SettingsForm.jsx
var import_react25 = __toESM(require("react"), 1);

// src/logic/settings.js
var IDLE = SETTINGS.idleTimeoutSec;
var IDLE_MIN_MINUTES = Math.ceil(IDLE.min / 60);
var IDLE_MAX_MINUTES = Math.floor(IDLE.max / 60);
var DEFAULT_IDLE_SEC = clampInt(TIMEOUTS.idleShutdownSec, IDLE.min, IDLE.max, 1800);
function idleMinutesOf(idleTimeoutSec) {
  const fallback = Math.round(DEFAULT_IDLE_SEC / 60);
  const seconds = Number(idleTimeoutSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return clampInt(seconds / 60, IDLE_MIN_MINUTES, IDLE_MAX_MINUTES, fallback);
}
function idleTimeoutSecOf(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return null;
  const fallback = Math.round(DEFAULT_IDLE_SEC / 60);
  return clampInt(value, IDLE_MIN_MINUTES, IDLE_MAX_MINUTES, fallback) * 60;
}
function quickIdleMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) return null;
  return IDLE.quickMinutes.includes(minutes) ? minutes : null;
}
function kaggleTransportLabelKey(transport) {
  return `studio.settings.kaggleTransport.option.${normalizeKaggleTransport(transport)}`;
}
function parseLineList(text, options = {}) {
  const maxItems = options.maxItems ?? SETTINGS.maxItems;
  const maxChars = options.maxItemChars ?? SETTINGS.maxItemChars;
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const value = raw.trim();
    if (!value || value.length > maxChars || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= maxItems) break;
  }
  return values;
}
function formatLineList(values) {
  if (!Array.isArray(values)) return "";
  const lines = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of values) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    lines.push(value);
  }
  return lines.join("\n");
}
function parseLocalModels(text, options = {}) {
  const maxItems = options.maxItems ?? SETTINGS.maxItems;
  const maxChars = options.maxItemChars ?? SETTINGS.maxItemChars;
  const value = {};
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const lineNumber = index + 1;
    if (line.length > maxChars) {
      errors.push({ line: lineNumber, message: "studio.settings.localModels.errorTooLong" });
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) {
      errors.push({ line: lineNumber, message: "studio.settings.localModels.errorFormat" });
      continue;
    }
    const repo = line.slice(0, separator).trim();
    const path = line.slice(separator + 1).trim();
    if (!isValidHfRepoId(repo)) {
      errors.push({ line: lineNumber, message: "studio.settings.localModels.errorRepo" });
      continue;
    }
    if (!isValidContainerPath(path, maxChars)) {
      errors.push({ line: lineNumber, message: "studio.settings.localModels.errorPath" });
      continue;
    }
    if (!(repo in value) && Object.keys(value).length >= maxItems) {
      errors.push({
        line: lineNumber,
        message: "studio.settings.localModels.errorTooMany",
        params: { max: maxItems }
      });
      continue;
    }
    value[repo] = path;
  }
  return { value, errors };
}
function formatLocalModels(localModels) {
  if (!localModels || typeof localModels !== "object" || Array.isArray(localModels)) return "";
  const lines = [];
  for (const [repo, path] of Object.entries(localModels)) {
    if (typeof repo !== "string" || !repo.trim()) continue;
    if (typeof path !== "string" || !path.trim()) continue;
    lines.push(`${repo.trim()}=${path.trim()}`);
  }
  return lines.join("\n");
}
function formFromSettings(view) {
  const source = view && typeof view === "object" ? view : {};
  const accelerator = SETTINGS.accelerators.includes(source.accelerator) ? source.accelerator : SETTINGS.defaultAccelerator;
  const provider = SETTINGS.providers.includes(source.provider) ? source.provider : SETTINGS.defaultProvider;
  const colabGpu = SETTINGS.colabGpus.includes(source.colabGpu) ? source.colabGpu : SETTINGS.defaultColabGpu;
  return {
    idleMinutes: String(idleMinutesOf(source.idleTimeoutSec)),
    accelerator,
    provider,
    colabGpu,
    colabHighRam: source.colabHighRam === true,
    // 旧宿主缺 kaggleTransport 时按 cli 处理（不是契约默认的 direct）。
    kaggleTransport: transportOf(source),
    hfToken: "",
    clearHfToken: false,
    datasetSourcesText: formatLineList(source.datasetSources),
    localModelsText: formatLocalModels(source.localModels),
    pipConstraintsText: formatLineList(source.pipConstraints)
  };
}
function validateSettingsForm(form) {
  const source = form || {};
  const localModels = parseLocalModels(source.localModelsText);
  return {
    ok: localModels.errors.length === 0,
    errors: localModels.errors,
    localModels: localModels.value
  };
}
function sameLineList(a, b) {
  return a.join("\n") === b.join("\n");
}
function buildSettingsPayload(form, view) {
  const source = form || {};
  const base = view && typeof view === "object" ? view : {};
  const payload = {};
  const idleSeconds = idleTimeoutSecOf(source.idleMinutes);
  if (idleSeconds !== null && idleSeconds !== idleTimeoutSecOf(idleMinutesOf(base.idleTimeoutSec))) {
    payload.idleTimeoutSec = idleSeconds;
  }
  const accelerator = SETTINGS.accelerators.includes(source.accelerator) ? source.accelerator : SETTINGS.defaultAccelerator;
  const baseAccelerator = SETTINGS.accelerators.includes(base.accelerator) ? base.accelerator : SETTINGS.defaultAccelerator;
  if (accelerator !== baseAccelerator) payload.accelerator = accelerator;
  const provider = SETTINGS.providers.includes(source.provider) ? source.provider : SETTINGS.defaultProvider;
  const baseProvider = SETTINGS.providers.includes(base.provider) ? base.provider : SETTINGS.defaultProvider;
  if (provider !== baseProvider) payload.provider = provider;
  const colabGpu = SETTINGS.colabGpus.includes(source.colabGpu) ? source.colabGpu : SETTINGS.defaultColabGpu;
  const baseColabGpu = SETTINGS.colabGpus.includes(base.colabGpu) ? base.colabGpu : SETTINGS.defaultColabGpu;
  if (colabGpu !== baseColabGpu) payload.colabGpu = colabGpu;
  if (source.colabHighRam === true !== (base.colabHighRam === true)) {
    payload.colabHighRam = source.colabHighRam === true;
  }
  const transport = normalizeKaggleTransport(source.kaggleTransport);
  if (transport !== transportOf(base)) payload.kaggleTransport = transport;
  const token2 = typeof source.hfToken === "string" ? source.hfToken.trim() : "";
  if (source.clearHfToken === true) payload.clearHfToken = true;
  else if (token2) payload.hfToken = token2;
  const datasets = parseLineList(source.datasetSourcesText);
  if (!sameLineList(datasets, parseLineList(formatLineList(base.datasetSources)))) {
    payload.datasetSources = datasets;
  }
  const pip = parseLineList(source.pipConstraintsText);
  if (!sameLineList(pip, parseLineList(formatLineList(base.pipConstraints)))) {
    payload.pipConstraints = pip;
  }
  const models = parseLocalModels(source.localModelsText);
  if (models.errors.length === 0 && formatLocalModels(models.value) !== formatLocalModels(base.localModels)) {
    payload.localModels = models.value;
  }
  return payload;
}
function hasSettingsChanges(payload) {
  return Boolean(payload && typeof payload === "object" && Object.keys(payload).length > 0);
}
function settingsErrorText(t, error) {
  if (!error) return "";
  if (error.code === "network") return t("error.network");
  if (typeof error.code === "string" && error.code.startsWith("http_")) return t("error.http");
  return errorText(t, error);
}
function settingsViewOf(result) {
  if (!result || result.ok !== true || !result.data || typeof result.data !== "object") return null;
  const view = result.data.settings;
  if (!view || typeof view !== "object" || Array.isArray(view)) return null;
  return view;
}
function hfTokenSourceKey(source) {
  const value = SETTINGS.hfTokenSources.includes(source) ? source : "none";
  return `studio.settings.hfToken.sourceValue.${value}`;
}

// src/studio/settings/SettingsAdvancedSection.jsx
var import_react24 = __toESM(require("react"), 1);
var import_jsx_runtime22 = require("react/jsx-runtime");
function SettingsAdvancedSection({
  t,
  form,
  patchForm,
  advancedOpen,
  onToggleAdvanced,
  validationErrors
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "ofs-settings-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
      "button",
      {
        type: "button",
        className: "ofs-settings-advanced-toggle",
        "aria-expanded": advancedOpen,
        onClick: onToggleAdvanced,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("studio.settings.advanced.toggle") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: `ofs-chevron${advancedOpen ? " is-open" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Icon, { name: "chevronDown", size: 13 }) })
        ]
      }
    ),
    advancedOpen ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "ofs-settings-advanced", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "ofs-settings-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.kaggleTransport.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "div",
          {
            className: "ofs-settings-options",
            role: "radiogroup",
            "aria-label": t("studio.settings.kaggleTransport.label"),
            children: SETTINGS.kaggleTransports.map((transport) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
              "label",
              {
                className: `ofs-settings-option${form.kaggleTransport === transport ? " is-on" : ""}`,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
                    "input",
                    {
                      type: "radio",
                      name: "ofs-kaggle-transport",
                      value: transport,
                      checked: form.kaggleTransport === transport,
                      onChange: () => patchForm({ kaggleTransport: transport })
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t(kaggleTransportLabelKey(transport)) })
                ]
              },
              transport
            ))
          }
        ),
        form.kaggleTransport === "direct" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("small", { className: "ofs-settings-hint", children: formatText(t("studio.settings.kaggleTransport.directHint"), {
          path: KAGGLE_CREDENTIAL_PATH
        }) }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "ofs-settings-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.dataset.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "textarea",
          {
            className: "ofs-settings-textarea",
            rows: 3,
            value: form.datasetSourcesText,
            placeholder: t("studio.settings.dataset.placeholder"),
            onChange: (event) => patchForm({ datasetSourcesText: event.target.value })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("small", { className: "ofs-settings-hint", children: formatText(t("studio.settings.dataset.hint"), { max: SETTINGS.maxItems }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "ofs-settings-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.localModels.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "textarea",
          {
            className: "ofs-settings-textarea",
            rows: 3,
            value: form.localModelsText,
            placeholder: t("studio.settings.localModels.placeholder"),
            onChange: (event) => patchForm({ localModelsText: event.target.value })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("small", { className: "ofs-settings-hint", children: t("studio.settings.localModels.hint") })
      ] }),
      validationErrors.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("ul", { className: "ofs-settings-errors", children: validationErrors.map((error) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("li", { className: "ofs-settings-error-item", children: formatText(t(error.message), { line: error.line, ...error.params || {} }) }, `${error.line}-${error.message}`)) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "ofs-settings-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.pip.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "textarea",
          {
            className: "ofs-settings-textarea",
            rows: 3,
            value: form.pipConstraintsText,
            placeholder: t("studio.settings.pip.placeholder"),
            onChange: (event) => patchForm({ pipConstraintsText: event.target.value })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("small", { className: "ofs-settings-hint", children: t("studio.settings.pip.hint") })
      ] })
    ] }) : null
  ] });
}

// src/studio/settings/SettingsForm.jsx
var import_jsx_runtime23 = require("react/jsx-runtime");
function ColabAuthRow({ t, colabAuth, colabLogin, copyText }) {
  if (!colabLogin) return null;
  const loginView = colabLogin.login && typeof colabLogin.login === "object" ? colabLogin.login : {};
  const state = typeof loginView.state === "string" ? loginView.state : "idle";
  const pending = state === "pending" || Boolean(colabLogin.pending);
  const authorized = Boolean(colabAuth && colabAuth.authorized === true || state === "done");
  const email = typeof loginView.username === "string" && loginView.username || colabAuth && typeof colabAuth.email === "string" && colabAuth.email || "";
  const statusText = authorized ? email ? formatText(t("studio.settings.colabAuth.ready"), { email }) : t("studio.settings.colabAuth.readyAnon") : t("studio.settings.colabAuth.missing");
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-row ofs-settings-colab-auth", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.colabAuth.label") }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-inline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-muted", children: statusText }),
      pending ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-chip is-on",
          disabled: Boolean(colabLogin.busy),
          onClick: colabLogin.cancel,
          children: t("studio.guidance.auth.cancel")
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        "button",
        {
          type: "button",
          className: authorized ? "ofs-chip" : "ofs-chip is-on",
          disabled: Boolean(colabLogin.busy),
          onClick: colabLogin.start,
          children: t(authorized ? "studio.settings.colabAuth.relogin" : "studio.settings.colabAuth.login")
        }
      )
    ] }),
    state !== "idle" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(OAuthManualPanel, { t, login: colabLogin, copyText, provider: "colab" }) : null
  ] });
}
function SettingsForm({
  t,
  view,
  form,
  patchForm,
  validation,
  tokenSource,
  advancedOpen,
  onToggleAdvanced,
  saveError,
  saving,
  canSave,
  colabAuth,
  colabLogin,
  copyText,
  onCancel,
  onSubmit
}) {
  const activeQuick = quickIdleMinutes(form.idleMinutes);
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-form", children: [
    view && view.effectiveOnNextSession === true ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "ofs-settings-effective", role: "status", children: t("studio.settings.effectiveNext") }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "ofs-settings-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h3", { className: "ofs-settings-section-title", children: t("studio.settings.section.runtime") }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.idle.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "ofs-settings-quick", role: "group", "aria-label": t("studio.settings.idle.label"), children: SETTINGS.idleTimeoutSec.quickMinutes.map((minutes) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "button",
          {
            type: "button",
            className: `ofs-chip ofs-settings-quick-item${activeQuick === minutes ? " is-on" : ""}`,
            "aria-pressed": activeQuick === minutes,
            onClick: () => patchForm({ idleMinutes: String(minutes) }),
            children: formatText(t("studio.settings.idle.quick"), { minutes })
          },
          minutes
        )) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "ofs-settings-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: formatText(t("studio.settings.idle.custom"), { min: IDLE_MIN_MINUTES, max: IDLE_MAX_MINUTES }) }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "input",
          {
            className: "ofs-settings-input",
            type: "number",
            inputMode: "numeric",
            min: IDLE_MIN_MINUTES,
            max: IDLE_MAX_MINUTES,
            step: 1,
            value: form.idleMinutes,
            onChange: (event) => patchForm({ idleMinutes: event.target.value })
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.provider.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "ofs-settings-options", role: "radiogroup", "aria-label": t("studio.settings.provider.label"), children: SETTINGS.providers.map((id) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: `ofs-settings-option${form.provider === id ? " is-on" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
            "input",
            {
              type: "radio",
              name: "ofs-provider",
              value: id,
              checked: form.provider === id,
              onChange: () => patchForm({ provider: id })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t(`studio.settings.provider.${id}`) })
        ] }, id)) })
      ] }),
      form.provider === "colab" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(import_jsx_runtime23.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.colabGpu.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "ofs-settings-options", role: "radiogroup", "aria-label": t("studio.settings.colabGpu.label"), children: SETTINGS.colabGpus.map((id) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: `ofs-settings-option${form.colabGpu === id ? " is-on" : ""}`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
              "input",
              {
                type: "radio",
                name: "ofs-colab-gpu",
                value: id,
                checked: form.colabGpu === id,
                onChange: () => patchForm({ colabGpu: id })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t(`studio.settings.colabGpu.${id}`) })
          ] }, id)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "ofs-settings-inline", children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
            "input",
            {
              type: "checkbox",
              checked: form.colabHighRam === true,
              onChange: (event) => patchForm({ colabHighRam: event.target.checked })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.colabHighRam.label") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "ofs-settings-muted", children: t("studio.settings.colabHighRam.hint") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ColabAuthRow, { t, colabAuth, colabLogin, copyText })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.accelerator.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "ofs-settings-options", role: "radiogroup", "aria-label": t("studio.settings.accelerator.label"), children: SETTINGS.accelerators.map((id) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(
          "label",
          {
            className: `ofs-settings-option${form.accelerator === id ? " is-on" : ""}`,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
                "input",
                {
                  type: "radio",
                  name: "ofs-accelerator",
                  value: id,
                  checked: form.accelerator === id,
                  onChange: () => patchForm({ accelerator: id })
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t(`studio.settings.accelerator.${id}`) })
            ]
          },
          id
        )) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "ofs-settings-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h3", { className: "ofs-settings-section-title", children: t("studio.settings.section.download") }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "ofs-settings-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-label", children: t("studio.settings.hfToken.label") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "input",
          {
            className: "ofs-settings-input",
            type: "password",
            autoComplete: "off",
            value: form.hfToken,
            placeholder: view && view.hasHfToken === true ? t("studio.settings.hfToken.placeholderSet") : t("studio.settings.hfToken.placeholder"),
            onChange: (event) => patchForm({ hfToken: event.target.value, clearHfToken: false })
          }
        )
      ] }),
      view && view.hasHfToken === true ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "ofs-settings-inline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-muted", children: formatText(t("studio.settings.hfToken.source"), { source: tokenSource }) }),
        form.clearHfToken ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-settings-muted", children: t("studio.settings.hfToken.clearPending") }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-chip ofs-settings-clear",
            onClick: () => patchForm({ hfToken: "", clearHfToken: true }),
            children: t("studio.settings.hfToken.clear")
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
      SettingsAdvancedSection,
      {
        t,
        form,
        patchForm,
        advancedOpen,
        onToggleAdvanced,
        validationErrors: validation.errors
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("footer", { className: "ofs-settings-foot", children: [
      !validation.ok ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "ofs-settings-error", role: "alert", children: formatText(t("studio.settings.invalid"), { count: validation.errors.length }) }) : null,
      saveError ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "ofs-settings-error", role: "alert", children: settingsErrorText(t, saveError) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "ofs-grow" }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", className: "ofs-chip", onClick: onCancel, children: t("studio.settings.cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-btn is-primary ofs-settings-save",
          disabled: !canSave,
          "aria-busy": saving,
          onClick: onSubmit,
          children: saving ? t("studio.settings.saving") : t("studio.settings.save")
        }
      )
    ] })
  ] });
}

// src/studio/SettingsDrawer.jsx
var import_jsx_runtime24 = require("react/jsx-runtime");
function SettingsDrawer(props) {
  const { t, ui, colabAuth = null, colabLogin = null, copyText = null, onClose } = props;
  const { defaultAdvancedOpen, defaultDraft } = props;
  const panelRef = import_react26.default.useRef(null);
  const closeRef = import_react26.default.useRef(null);
  const onCloseRef = import_react26.default.useRef(onClose);
  onCloseRef.current = onClose;
  const [status, setStatus] = import_react26.default.useState("loading");
  const [view, setView] = import_react26.default.useState(null);
  const [form, setForm] = import_react26.default.useState(null);
  const [loadError, setLoadError] = import_react26.default.useState(null);
  const [saveError, setSaveError] = import_react26.default.useState(null);
  const [saving, setSaving] = import_react26.default.useState(false);
  const [advancedOpen, setAdvancedOpen] = import_react26.default.useState(Boolean(defaultAdvancedOpen));
  const [reloadKey, setReloadKey] = import_react26.default.useState(0);
  import_react26.default.useEffect(() => {
    let alive = true;
    setStatus("loading");
    setLoadError(null);
    fetchSettings().then((result) => {
      if (!alive) return;
      const next = settingsViewOf(result);
      if (next) {
        setView(next);
        const base = formFromSettings(next);
        setForm(defaultDraft && typeof defaultDraft === "object" ? { ...base, ...defaultDraft } : base);
        setStatus("ready");
        return;
      }
      setStatus("error");
      setLoadError({ code: result && result.code || "internal_error", message: result && result.message || "" });
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  useFocusTrap({ panelRef, initialFocusRef: closeRef, onClose });
  function patchForm(patch) {
    setForm((previous) => previous ? { ...previous, ...patch } : previous);
  }
  const validation = form ? validateSettingsForm(form) : { ok: true, errors: [], localModels: {} };
  const payload = form && view ? buildSettingsPayload(form, view) : {};
  const dirty = hasSettingsChanges(payload);
  const canSave = status === "ready" && Boolean(form) && !saving && dirty && validation.ok;
  const tokenSource = view ? t(hfTokenSourceKey(view.hfTokenSource)) : "";
  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveSettings(payload);
    const next = settingsViewOf(result);
    setSaving(false);
    if (next) {
      setView(next);
      setForm(formFromSettings(next));
      if (ui && typeof ui.showToast === "function") ui.showToast(t("studio.settings.saved"));
      return;
    }
    setSaveError({ code: result && result.code || "internal_error", message: result && result.message || "" });
  }
  function renderLoadError() {
    return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "ofs-settings-error-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "ofs-settings-error", role: "alert", children: [
        t("studio.settings.loadFailed"),
        loadError && (loadError.code || loadError.message) ? ` · ${settingsErrorText(t, loadError)}` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "ofs-chip", onClick: () => setReloadKey((value) => value + 1), children: t("studio.settings.retry") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { className: "ofs-settings", role: "presentation", onClick: () => onCloseRef.current && onCloseRef.current(), children: /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
    "div",
    {
      className: "ofs-settings-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("studio.settings.title"),
      ref: panelRef,
      onClick: (event) => event.stopPropagation(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("header", { className: "ofs-settings-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "ofs-settings-title", children: t("studio.settings.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "ofs-grow" }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
            "button",
            {
              ref: closeRef,
              type: "button",
              className: "ofs-icon-btn",
              onClick: () => onCloseRef.current && onCloseRef.current(),
              title: t("studio.settings.close"),
              "aria-label": t("studio.settings.close"),
              children: /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Icon, { name: "close", size: 16 })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "ofs-settings-body", children: [
          status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "ofs-settings-note", children: t("studio.settings.loading") }) : null,
          status === "error" ? renderLoadError() : null,
          status === "ready" && form ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
            SettingsForm,
            {
              t,
              view,
              form,
              patchForm,
              validation,
              tokenSource,
              advancedOpen,
              onToggleAdvanced: () => setAdvancedOpen((value) => !value),
              saveError,
              saving,
              canSave,
              colabAuth,
              colabLogin,
              copyText: copyText || ui && ui.copyText || null,
              onCancel: () => onCloseRef.current && onCloseRef.current(),
              onSubmit: submit
            }
          ) : null
        ] })
      ]
    }
  ) });
}

// src/studio/Stage.jsx
var import_react34 = __toESM(require("react"), 1);

// src/logic/mask.js
var MASK_BRUSH = Object.freeze({ min: 8, max: 96, step: 4, default: 40 });
var MASK_MIN_COVERAGE = 5e-4;
var MASK_DATA_URL_PREFIX = "data:image/png;base64,";
var MASK_KEY_STEP = 32;
var MASK_STRENGTH_DEFAULT = 0.8;
var MASK_STRENGTH_NATIVE = 0.9;
function strengthMaxOf(hasMask) {
  const max = Number(LIMITS.strength.max);
  if (!hasMask) return max;
  const inpaintMax = Number(LIMITS.strength.inpaintMax);
  if (!Number.isFinite(inpaintMax)) return max;
  return Math.max(max, inpaintMax);
}
function clampMaskStrength(value, hasMask) {
  const { min, step, default: fallback } = LIMITS.strength;
  const max = strengthMaxOf(hasMask);
  if (value === null || value === void 0 || value === "" || typeof value === "boolean") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  const aligned = min + Math.round((clamped - min) / step) * step;
  return Math.round(aligned * 1e3) / 1e3;
}
var MASK_CANVAS_EDGE = 1024;
function clampBrushSize(value) {
  if (value === null || value === void 0) return MASK_BRUSH.default;
  if (typeof value === "string" && value.trim() === "") return MASK_BRUSH.default;
  const number = Number(value);
  if (!Number.isFinite(number)) return MASK_BRUSH.default;
  const clamped = Math.min(MASK_BRUSH.max, Math.max(MASK_BRUSH.min, number));
  const aligned = MASK_BRUSH.min + Math.round((clamped - MASK_BRUSH.min) / MASK_BRUSH.step) * MASK_BRUSH.step;
  return Math.min(MASK_BRUSH.max, Math.max(MASK_BRUSH.min, aligned));
}
function brushStateOf(partial) {
  const input = partial && typeof partial === "object" ? partial : {};
  return { size: clampBrushSize(input.size), eraser: input.eraser === true };
}
function toggleEraser(state) {
  const current = brushStateOf(state);
  return { size: current.size, eraser: !current.eraser };
}
function coverageOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number >= 1) return 1;
  return Number(number.toFixed(6));
}
function maskStateOf(partial) {
  const input = partial && typeof partial === "object" ? partial : {};
  return { coverage: coverageOf(input.coverage) };
}
function emptyMaskState() {
  return { coverage: 0 };
}
function maskHasInk(state) {
  return maskStateOf(state).coverage >= MASK_MIN_COVERAGE;
}
function maskCoverageOf(inkPixels, totalPixels) {
  const ink = Number(inkPixels);
  const total = Number(totalPixels);
  if (!Number.isFinite(ink) || !Number.isFinite(total) || total <= 0 || ink <= 0) return 0;
  return coverageOf(ink / total);
}
function maskCanvasSizeOf(width, height, edge = MASK_CANVAS_EDGE) {
  const limit = Number.isFinite(Number(edge)) && Number(edge) >= 64 ? Math.round(Number(edge)) : MASK_CANVAS_EDGE;
  const w = Number(width);
  const h2 = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h2) || w <= 0 || h2 <= 0) {
    return { width: limit, height: limit };
  }
  const scale = limit / Math.max(w, h2);
  return {
    width: Math.max(48, Math.round(w * scale)),
    height: Math.max(48, Math.round(h2 * scale))
  };
}
function base64BytesOf(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}
function normalizeMaskData(data) {
  if (typeof data !== "string") return "";
  let text = data.trim();
  if (text.toLowerCase().startsWith(MASK_DATA_URL_PREFIX)) text = text.slice(MASK_DATA_URL_PREFIX.length);
  text = text.replace(/\s+/g, "");
  if (!text || text.length % 4 !== 0) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return "";
  return text;
}
function referenceMaskOf(reference) {
  const mask = reference && typeof reference === "object" ? reference.mask : null;
  if (!mask) return null;
  const raw = typeof mask === "string" ? { data: mask } : mask;
  const data = normalizeMaskData(raw.data);
  if (!data) return null;
  return {
    data,
    coverage: maskStateOf({ coverage: raw.coverage }).coverage,
    digest: maskDigestOf(data)
  };
}
function referenceMaskDataOf(reference) {
  const mask = referenceMaskOf(reference);
  return mask ? mask.data : "";
}
function referenceMaskForSubmit(reference) {
  const data = referenceMaskDataOf(reference);
  if (!data) return "";
  const bytes = base64BytesOf(data);
  if (bytes <= 0 || bytes > LIMITS.mask.maxBytes) return "";
  return data;
}
function maskExportVerdict(data, coverage) {
  const normalized = normalizeMaskData(data);
  if (!normalized) return { ok: false, reason: "invalid" };
  const state = maskStateOf({ coverage });
  if (!maskHasInk(state)) return { ok: false, reason: "empty" };
  const bytes = base64BytesOf(normalized);
  if (bytes <= 0) return { ok: false, reason: "invalid" };
  if (bytes > LIMITS.mask.maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, data: normalized, coverage: state.coverage, bytes };
}
function maskDigestOf(data) {
  const normalized = normalizeMaskData(data);
  if (!normalized) return "";
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16)}-${normalized.length}`;
}
var MASK_ZOOM = Object.freeze({ min: 1, max: 4, step: 0.15, default: 1 });
var MASK_UNDO_LIMIT = 15;
function clampZoom(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= MASK_ZOOM.min + 0.02) return MASK_ZOOM.min;
  if (num >= MASK_ZOOM.max) return MASK_ZOOM.max;
  return Math.round(num * 100) / 100;
}
function clampPan(pan, options = {}) {
  const zoom = clampZoom(options.zoom);
  if (zoom <= MASK_ZOOM.min) return { x: 0, y: 0 };
  const input = pan && typeof pan === "object" ? pan : {};
  const x = Number(input.x);
  const y = Number(input.y);
  const stageW = Math.max(0, Number(options.stageWidth) || 0);
  const stageH = Math.max(0, Number(options.stageHeight) || 0);
  const viewW = Math.max(0, Number(options.viewWidth) || 0);
  const viewH = Math.max(0, Number(options.viewHeight) || 0);
  const maxX = stageW > 0 && viewW > 0 ? Math.max(0, (stageW * zoom + viewW * 0.6) / 2 - viewW * 0.2) : Infinity;
  const maxY = stageH > 0 && viewH > 0 ? Math.max(0, (stageH * zoom + viewH * 0.6) / 2 - viewH * 0.2) : Infinity;
  return {
    x: Number.isFinite(x) ? Math.round(Math.min(maxX, Math.max(-maxX, x)) * 100) / 100 : 0,
    y: Number.isFinite(y) ? Math.round(Math.min(maxY, Math.max(-maxY, y)) * 100) / 100 : 0
  };
}
function zoomAtPoint({ zoom, pan, anchor, nextZoom, bounds }) {
  const currentZoom = clampZoom(zoom);
  const targetZoom = clampZoom(nextZoom);
  if (targetZoom <= MASK_ZOOM.min) {
    return { zoom: MASK_ZOOM.min, pan: { x: 0, y: 0 } };
  }
  const currentPan = pan && typeof pan === "object" ? pan : { x: 0, y: 0 };
  const ax = Number(anchor && anchor.x) || 0;
  const ay = Number(anchor && anchor.y) || 0;
  const ratio = targetZoom / currentZoom;
  const rawPan = {
    x: ax - (ax - (Number(currentPan.x) || 0)) * ratio,
    y: ay - (ay - (Number(currentPan.y) || 0)) * ratio
  };
  return {
    zoom: targetZoom,
    pan: clampPan(rawPan, { ...bounds || {}, zoom: targetZoom })
  };
}
function stepBrushSize(current, direction) {
  const size = clampBrushSize(current);
  const dir = Number(direction);
  if (!Number.isFinite(dir) || dir === 0) return size;
  const step = dir > 0 ? MASK_BRUSH.step : -MASK_BRUSH.step;
  return clampBrushSize(size + step);
}

// src/logic/prompt.js
var NEGATIVE_LAYER_ORDER = ["model", "user"];
function emptyNegativeLayers() {
  return { model: "", user: "" };
}
function layerText(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeNegativeLayers(layers) {
  const source = layers && typeof layers === "object" ? layers : {};
  const next = emptyNegativeLayers();
  for (const name of NEGATIVE_LAYER_ORDER) next[name] = layerText(source[name]);
  return next;
}
function splitNegativeTerms(text) {
  return String(text ?? "").split(/[,，、;；]/).map((term) => term.trim()).filter(Boolean);
}
function mergeNegativeLayers(layers) {
  const source = normalizeNegativeLayers(layers);
  const seen = /* @__PURE__ */ new Set();
  const terms = [];
  for (const name of NEGATIVE_LAYER_ORDER) {
    for (const term of splitNegativeTerms(source[name])) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms.join(", ");
}
function resolveNegativeLayers(form, presets) {
  const input = form && typeof form === "object" ? form : {};
  if (input.negativeLayers && typeof input.negativeLayers === "object") {
    return normalizeNegativeLayers(input.negativeLayers);
  }
  const negative = layerText(input.negative);
  if (!negative) return emptyNegativeLayers();
  const list = Array.isArray(presets) ? presets : [];
  const previous = list.find((item) => item && item.id === input.presetId);
  const hint = previous && typeof previous.negativeHint === "string" ? previous.negativeHint.trim() : "";
  if (hint && negative === hint) return { model: negative, user: "" };
  return { model: "", user: negative };
}
function negativeLayersPatch(layers) {
  const next = normalizeNegativeLayers(layers);
  return { negativeLayers: next, negative: mergeNegativeLayers(next) };
}
function negativePromptOf(form) {
  const input = form && typeof form === "object" ? form : {};
  if (input.negativeLayers && typeof input.negativeLayers === "object") {
    return mergeNegativeLayers(input.negativeLayers);
  }
  return layerText(input.negative);
}
function negativeForSubmit(form, active) {
  if (active === false) return "";
  return negativePromptOf(form);
}
function translateOutcomeOf(data) {
  const holder = data && typeof data === "object" ? data : null;
  const prompt = holder && typeof holder.prompt === "string" ? holder.prompt.trim() : "";
  if (!holder || holder.source !== "model" || !prompt) return { ok: false, prompt: "" };
  return { ok: true, prompt };
}
function applyNegativePatch(form, partial) {
  const prev = form && typeof form === "object" ? form : {};
  const patch = partial && typeof partial === "object" ? partial : {};
  if (patch.negativeLayers && typeof patch.negativeLayers === "object") {
    const layers = normalizeNegativeLayers(patch.negativeLayers);
    return {
      ...prev,
      ...patch,
      negativeLayers: layers,
      negative: typeof patch.negative === "string" ? patch.negative : mergeNegativeLayers(layers)
    };
  }
  if (typeof patch.negative === "string") {
    return {
      ...prev,
      ...patch,
      negativeLayers: { model: "", user: patch.negative }
    };
  }
  return { ...prev, ...patch };
}

// src/logic/preset.js
function detectCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text ?? ""));
}
function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}
function ratioIdOf(width, height) {
  const w = Math.round(Number(width));
  const h2 = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h2) || w <= 0 || h2 <= 0) return "";
  const divisor = gcd(w, h2);
  const id = `${w / divisor}:${h2 / divisor}`;
  return RATIO_IDS.includes(id) ? id : "";
}
function presetNeedsEnglish(preset) {
  if (!preset || typeof preset !== "object") return true;
  if (preset.supportsChinese === true || preset.promptStyle === "chinese") return false;
  return true;
}
function hintOf(preset) {
  return preset && typeof preset.negativeHint === "string" ? preset.negativeHint.trim() : "";
}
function customSizePatch(partial) {
  const input = partial && typeof partial === "object" ? partial : {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, "width")) patch.width = clampSize(input.width);
  if (Object.prototype.hasOwnProperty.call(input, "height")) patch.height = clampSize(input.height);
  return patch;
}
function supportsImg2Img(preset) {
  return Boolean(preset && preset.supportsImg2Img === true);
}
function supportsInpaint(preset) {
  return Boolean(preset && preset.supportsInpaint === true);
}
function inpaintOnlyOf(preset) {
  return Boolean(preset && preset.inpaintOnly === true);
}
function referencePresetOf(presets) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id && !inpaintOnlyOf(item)) : [];
  const preferred = list.find((item) => item.id === DEFAULT_PRESET);
  if (preferred && supportsImg2Img(preferred)) return preferred;
  return list.find(supportsImg2Img) || null;
}
function providerIdOf(provider) {
  return SETTINGS.providers.includes(provider) ? provider : SETTINGS.defaultProvider;
}
function presetProvidersOf(preset) {
  const raw = preset && Array.isArray(preset.providers) ? preset.providers : [];
  const allowed = [];
  for (const id of raw) {
    if (SETTINGS.providers.includes(id) && !allowed.includes(id)) allowed.push(id);
  }
  return allowed.length > 0 ? allowed : [...SETTINGS.providers];
}
function presetAvailableForProvider(preset, provider) {
  return presetProvidersOf(preset).includes(providerIdOf(provider));
}
function presetProviderRestrictionOf(preset) {
  const list = presetProvidersOf(preset);
  return list.length === 1 ? list[0] : "";
}
function providerNameKeyOf(provider) {
  const id = providerIdOf(provider);
  return `studio.preset.providerName.${id}`;
}
function presetSelectPatch(next, current, presets) {
  const target = next && typeof next === "object" && next.id ? next : null;
  if (!target) return {};
  const form = current && typeof current === "object" ? current : {};
  const hasActiveSize = Boolean(form.presetId) && Number(form.width) > 0 && Number(form.height) > 0;
  const patch = {
    presetId: target.id
  };
  if (!hasActiveSize) {
    patch.width = clampSize(target.size || form.width);
    patch.height = clampSize(target.size || form.height);
  } else {
    const options = Array.isArray(target.sizeOptions) ? target.sizeOptions.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    const minSafe = options.length > 0 ? Math.min(...options) : 0;
    const curW = Number(form.width);
    const curH = Number(form.height);
    const curLong = Math.max(curW, curH);
    const targetSize = clampSize(target.size || minSafe);
    if (minSafe > 0 && curLong > 0 && curLong < minSafe && targetSize > curLong) {
      const scale = targetSize / curLong;
      patch.width = clampSize(curW * scale);
      patch.height = clampSize(curH * scale);
    }
  }
  const steps = clampInt(target.steps, LIMITS.steps.min, LIMITS.steps.max, null);
  if (steps !== null) patch.steps = steps;
  const cfg = clampNumber(target.cfg, LIMITS.cfg.min, LIMITS.cfg.max, null);
  if (cfg !== null) patch.cfg = cfg;
  const list = Array.isArray(presets) ? presets : [];
  const layers = resolveNegativeLayers(form, list);
  const effectiveCfg = cfg !== null ? cfg : form.cfg;
  const nextLayers = {
    ...layers,
    model: negativePromptActive(target, effectiveCfg) ? hintOf(target) : ""
  };
  Object.assign(patch, negativeLayersPatch(nextLayers));
  return patch;
}

// src/logic/outpaint.js
var OUTPAINT_RATIO_IDS = [...OUTPAINT.ratioIds];
var OUTPAINT_EXPAND_ID = OUTPAINT.expandId;
var OUTPAINT_RATIO_ORDER = Object.freeze([OUTPAINT.expandId, ...OUTPAINT.ratioIds]);
var RATIO_LABEL_KEYS = Object.freeze({
  [OUTPAINT.expandId]: "studio.outpaint.ratio.expand",
  "16:9": "studio.outpaint.ratio.16x9",
  "9:16": "studio.outpaint.ratio.9x16",
  "4:3": "studio.outpaint.ratio.4x3"
});
var RATIO_VALUES = Object.freeze({
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3
});
var STEP = Number(LIMITS.width.step) > 0 ? Number(LIMITS.width.step) : 8;
var SAME_RATIO_EPSILON = 2e-3;
function alignDown(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return STEP;
  return Math.max(STEP, Math.floor(number / STEP) * STEP);
}
function alignNear(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(0, Math.round(number / STEP) * STEP);
}
function alignWithin(value, limit) {
  const max = Math.max(0, Math.floor(Number(limit) / STEP) * STEP);
  if (max <= 0) return 0;
  const aligned = Math.max(0, Math.round(Number(value) / STEP) * STEP);
  return Math.min(max, aligned);
}
function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, number)) * 1e4) / 1e4;
}
function coverageOf2(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number >= 1) return 1;
  return Number(number.toFixed(6));
}
function boundsOf() {
  const maxEdge = Number(OUTPAINT.maxEdge) > 0 ? Number(OUTPAINT.maxEdge) : 1536;
  const maxPixels = Number(OUTPAINT.maxPixels) > 0 ? Number(OUTPAINT.maxPixels) : 16e5;
  const minEdge = Number(OUTPAINT.minEdge) > 0 ? Number(OUTPAINT.minEdge) : 256;
  const expandRatio = Number(OUTPAINT.expandRatio) > 1 ? Number(OUTPAINT.expandRatio) : 1.2;
  return { maxEdge, maxPixels, minEdge, expandRatio };
}
function outpaintRatioOptions() {
  return OUTPAINT_RATIO_ORDER.map((id) => ({ id, labelKey: RATIO_LABEL_KEYS[id] || "" }));
}
function outpaintRatioIdOf(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (id === OUTPAINT.expandId || OUTPAINT_RATIO_IDS.includes(id)) return id;
  return OUTPAINT.expandId;
}
function outpaintAnchorOf(value) {
  const input = value && typeof value === "object" ? value : {};
  return { x: clamp01(input.x), y: clamp01(input.y) };
}
function outpaintCoverageOf(plan) {
  const source = plan && typeof plan === "object" && plan.ok === true ? plan : null;
  if (!source) return 0;
  const width = Number(source.width);
  const height = Number(source.height);
  const content = source.content && typeof source.content === "object" ? source.content : null;
  if (!content) return 0;
  const contentWidth = Number(content.width);
  const contentHeight = Number(content.height);
  if (!(width > 0) || !(height > 0) || !(contentWidth > 0) || !(contentHeight > 0)) return 0;
  return coverageOf2(1 - contentWidth * contentHeight / (width * height));
}
function outpaintAnchorShift(plan, anchor, delta) {
  const current = outpaintAnchorOf(anchor);
  const source = plan && typeof plan === "object" && plan.ok === true ? plan : null;
  if (!source) return current;
  const padding = source.padding && typeof source.padding === "object" ? source.padding : {};
  const padX = Math.max(0, Number(padding.left) || 0) + Math.max(0, Number(padding.right) || 0);
  const padY = Math.max(0, Number(padding.top) || 0) + Math.max(0, Number(padding.bottom) || 0);
  const dx = Number(delta && delta.x);
  const dy = Number(delta && delta.y);
  const next = { ...current };
  if (padX > 0 && Number.isFinite(dx) && dx !== 0) next.x = clamp01(current.x + dx / padX);
  if (padY > 0 && Number.isFinite(dy) && dy !== 0) next.y = clamp01(current.y + dy / padY);
  return outpaintAnchorOf(next);
}
function layoutOf(width, height, contentWidth, contentHeight, anchor, ratioId, scale) {
  const totalX = Math.max(0, width - contentWidth);
  const totalY = Math.max(0, height - contentHeight);
  const left = alignWithin(totalX * anchor.x, totalX);
  const top = alignWithin(totalY * anchor.y, totalY);
  const padding = { left, right: totalX - left, top, bottom: totalY - top };
  const content = { x: left, y: top, width: contentWidth, height: contentHeight };
  const plan = { ok: true, ratioId, width, height, content, padding, coverage: 0, scale };
  plan.coverage = outpaintCoverageOf(plan);
  return plan;
}
function expandPlanOf(sourceWidth, sourceHeight, anchor) {
  const { maxEdge, maxPixels, minEdge, expandRatio } = boundsOf();
  let scale = 1;
  scale = Math.min(scale, maxEdge / (sourceWidth * expandRatio));
  scale = Math.min(scale, maxEdge / (sourceHeight * expandRatio));
  scale = Math.min(scale, Math.sqrt(maxPixels / (sourceWidth * expandRatio * sourceHeight * expandRatio)));
  if (!(scale > 0)) return { ok: false, reason: "bounds" };
  let contentWidth = alignDown(sourceWidth * scale);
  let contentHeight = alignDown(sourceHeight * scale);
  if (contentWidth < STEP || contentHeight < STEP) return { ok: false, reason: "too_small" };
  let padX = alignNear(contentWidth * (expandRatio - 1) / 2);
  let padY = alignNear(contentHeight * (expandRatio - 1) / 2);
  let width = contentWidth + padX * 2;
  let height = contentHeight + padY * 2;
  for (let guard = 0; guard < 120; guard += 1) {
    if (width <= maxEdge && height <= maxEdge && width * height <= maxPixels) break;
    contentWidth = alignDown(contentWidth * 0.98);
    contentHeight = alignDown(contentHeight * 0.98);
    if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: "too_small" };
    padX = alignNear(contentWidth * (expandRatio - 1) / 2);
    padY = alignNear(contentHeight * (expandRatio - 1) / 2);
    width = contentWidth + padX * 2;
    height = contentHeight + padY * 2;
  }
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) return { ok: false, reason: "bounds" };
  if (width < minEdge || height < minEdge) return { ok: false, reason: "too_small" };
  return layoutOf(width, height, contentWidth, contentHeight, anchor, OUTPAINT.expandId, contentWidth / sourceWidth);
}
function ratioPlanOf(sourceWidth, sourceHeight, ratioId, anchor) {
  const targetRatio = RATIO_VALUES[ratioId];
  if (!targetRatio) return { ok: false, reason: "invalid_ratio" };
  const { maxEdge, maxPixels, minEdge } = boundsOf();
  const aspect = sourceWidth / sourceHeight;
  if (Math.abs(aspect - targetRatio) <= targetRatio * SAME_RATIO_EPSILON) {
    return { ok: false, reason: "no_padding" };
  }
  let contentWidth;
  let contentHeight;
  if (aspect > targetRatio) {
    const maxWidth = Math.min(maxEdge, maxEdge * targetRatio, Math.sqrt(maxPixels * targetRatio));
    contentWidth = alignDown(Math.min(sourceWidth, maxWidth));
    contentHeight = alignDown(contentWidth / aspect);
  } else {
    const maxHeight = Math.min(maxEdge, maxEdge / targetRatio, Math.sqrt(maxPixels / targetRatio));
    contentHeight = alignDown(Math.min(sourceHeight, maxHeight));
    contentWidth = alignDown(contentHeight * aspect);
  }
  if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: "too_small" };
  let width;
  let height;
  if (aspect > targetRatio) {
    height = contentHeight + alignNear(Math.max(0, alignNear(contentWidth / targetRatio) - contentHeight));
    width = contentWidth;
  } else {
    width = contentWidth + alignNear(Math.max(0, alignNear(contentHeight * targetRatio) - contentWidth));
    height = contentHeight;
  }
  for (let guard = 0; guard < 120; guard += 1) {
    if (width <= maxEdge && height <= maxEdge && width * height <= maxPixels) break;
    contentWidth = alignDown(contentWidth * 0.98);
    contentHeight = alignDown(contentHeight * 0.98);
    if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: "too_small" };
    if (aspect > targetRatio) {
      height = contentHeight + alignNear(Math.max(0, alignNear(contentWidth / targetRatio) - contentHeight));
      width = contentWidth;
    } else {
      width = contentWidth + alignNear(Math.max(0, alignNear(contentHeight * targetRatio) - contentWidth));
      height = contentHeight;
    }
  }
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) return { ok: false, reason: "bounds" };
  if (width < minEdge || height < minEdge) return { ok: false, reason: "too_small" };
  const scale = aspect > targetRatio ? contentWidth / sourceWidth : contentHeight / sourceHeight;
  return layoutOf(width, height, contentWidth, contentHeight, anchor, ratioId, scale);
}
function outpaintPlanOf(input) {
  const source = input && typeof input === "object" ? input : {};
  const sourceWidth = positiveSize(source.sourceWidth);
  const sourceHeight = positiveSize(source.sourceHeight);
  if (!sourceWidth || !sourceHeight) return { ok: false, reason: "invalid_source" };
  const requested = typeof source.ratioId === "string" ? source.ratioId.trim() : "";
  const ratioId = requested || OUTPAINT.expandId;
  if (ratioId !== OUTPAINT.expandId && !OUTPAINT_RATIO_IDS.includes(ratioId)) {
    return { ok: false, reason: "invalid_ratio" };
  }
  const anchor = outpaintAnchorOf(source.anchor);
  if (ratioId === OUTPAINT.expandId) return expandPlanOf(sourceWidth, sourceHeight, anchor);
  return ratioPlanOf(sourceWidth, sourceHeight, ratioId, anchor);
}
function outpaintEdgeStripsOf(plan) {
  const source = plan && typeof plan === "object" && plan.ok === true ? plan : null;
  if (!source) return [];
  const width = Number(source.width);
  const height = Number(source.height);
  const content = source.content && typeof source.content === "object" ? source.content : null;
  if (!content || !(width > 0) || !(height > 0)) return [];
  const contentWidth = Number(content.width);
  const contentHeight = Number(content.height);
  if (!(contentWidth > 0) || !(contentHeight > 0)) return [];
  const left = Number(content.x);
  const top = Number(content.y);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return [];
  const right = width - contentWidth - left;
  const bottom = height - contentHeight - top;
  if (!(right >= 0) || !(bottom >= 0)) return [];
  if (left <= 0 && right <= 0 && top <= 0 && bottom <= 0) return [];
  const strips = [];
  const push = (sx, sy, sw, sh, tx, ty, tw, th) => {
    if (!(tw > 0) || !(th > 0)) return;
    strips.push({
      source: { x: sx, y: sy, width: sw, height: sh },
      target: { x: tx, y: ty, width: tw, height: th }
    });
  };
  push(0, 0, 1, 1, 0, 0, left, top);
  push(contentWidth - 1, 0, 1, 1, left + contentWidth, 0, right, top);
  push(0, contentHeight - 1, 1, 1, 0, top + contentHeight, left, bottom);
  push(contentWidth - 1, contentHeight - 1, 1, 1, left + contentWidth, top + contentHeight, right, bottom);
  push(0, 0, 1, contentHeight, 0, top, left, contentHeight);
  push(contentWidth - 1, 0, 1, contentHeight, left + contentWidth, top, right, contentHeight);
  push(0, 0, contentWidth, 1, left, 0, contentWidth, top);
  push(0, contentHeight - 1, contentWidth, 1, left, top + contentHeight, contentWidth, bottom);
  return strips;
}
var CONTENT_FIELDS = Array.isArray(OUTPAINT.content && OUTPAINT.content.fields) ? OUTPAINT.content.fields : ["x", "y", "width", "height"];
var CONTENT_PRECISION = Number.isFinite(Number(OUTPAINT.content && OUTPAINT.content.precision)) ? Math.max(0, Math.min(8, Math.floor(Number(OUTPAINT.content.precision)))) : 4;
var CONTENT_TOLERANCE = 1e-3;
function nonNegativeInt(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}
function roundContent(value) {
  const factor = 10 ** CONTENT_PRECISION;
  return Math.round(Number(value) * factor) / factor;
}
function normalizeOutpaintContent(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const raw = {};
  for (const field of CONTENT_FIELDS) {
    const number = source[field];
    if (typeof number !== "number" || !Number.isFinite(number)) return null;
    raw[field] = number;
  }
  const { x, y, width, height } = raw;
  if (width <= 0 || height <= 0) return null;
  if (x < -CONTENT_TOLERANCE || y < -CONTENT_TOLERANCE) return null;
  if (width > 1 + CONTENT_TOLERANCE || height > 1 + CONTENT_TOLERANCE) return null;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  if (left + width > 1 + CONTENT_TOLERANCE) return null;
  if (top + height > 1 + CONTENT_TOLERANCE) return null;
  return {
    x: roundContent(Math.min(1, left)),
    y: roundContent(Math.min(1, top)),
    width: roundContent(Math.min(1, width)),
    height: roundContent(Math.min(1, height))
  };
}
function buildOutpaintContentBody(canvas) {
  const source = canvas && typeof canvas === "object" && !Array.isArray(canvas) ? canvas : null;
  if (!source) return null;
  const width = positiveSize(source.width);
  const height = positiveSize(source.height);
  const content = source.content && typeof source.content === "object" ? source.content : null;
  if (!width || !height || !content) return null;
  const contentWidth = positiveSize(content.width);
  const contentHeight = positiveSize(content.height);
  const x = nonNegativeInt(content.x);
  const y = nonNegativeInt(content.y);
  if (contentWidth === null || contentHeight === null || x === null || y === null) return null;
  if (x + contentWidth > width || y + contentHeight > height) return null;
  return normalizeOutpaintContent({
    x: x / width,
    y: y / height,
    width: contentWidth / width,
    height: contentHeight / height
  });
}

// src/logic/imageTool.js
var IMAGE_TOOL_FORMS = Object.freeze(["instant", "inline", "canvas"]);
var IMAGE_TOOL_GROUPS = Object.freeze(["process", "reuse"]);
var INPAINT_PRESET_ID = "sdxl-inpaint";
var IMAGE_TOOLS = Object.freeze([
  Object.freeze({
    id: "inpaint",
    form: "canvas",
    group: "process",
    icon: "focus",
    capability: "supportsInpaint",
    labelKey: "studio.imageTool.inpaint",
    ready: true
  }),
  Object.freeze({
    id: "img2img",
    form: "inline",
    group: "process",
    icon: "image",
    capability: "supportsImg2Img",
    labelKey: "studio.imageTool.img2img",
    ready: true
  }),
  Object.freeze({
    id: "upscale",
    form: "instant",
    group: "process",
    icon: "expand",
    // 高清放大走远端 Real-ESRGAN 超分，不依赖扩散模型能力，因此没有预设能力字段。
    capability: null,
    labelKey: "studio.imageTool.upscale",
    ready: true
  }),
  Object.freeze({
    id: "outpaint",
    form: "canvas",
    group: "process",
    icon: "frame",
    capability: "supportsInpaint",
    labelKey: "studio.imageTool.outpaint",
    ready: true
  })
]);
function imageToolOf(id) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return null;
  return IMAGE_TOOLS.find((tool) => tool.id === key) || null;
}
function resolveTool(value) {
  if (value && typeof value === "object") {
    return typeof value.id === "string" ? imageToolOf(value.id) || null : null;
  }
  return imageToolOf(value);
}
function toolPresetOf(presets, currentId, toolId) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : [];
  const tool = imageToolOf(toolId);
  const missing = { preset: null, switched: false, fallback: false };
  if (!tool || !tool.ready) return missing;
  if (tool.id === "upscale") return missing;
  const wanted = typeof currentId === "string" ? currentId.trim() : "";
  const current = wanted ? list.find((item) => item.id === wanted) || null : null;
  if (tool.id === "inpaint") {
    if (supportsInpaint(current)) return { preset: current, switched: false, fallback: false };
    const native = list.find((item) => item.id === INPAINT_PRESET_ID && supportsInpaint(item)) || null;
    if (native) {
      return { preset: native, switched: !current || native.id !== current.id, fallback: false };
    }
    const fallback = referencePresetOf(list);
    if (fallback) return { preset: fallback, switched: true, fallback: true };
    return { preset: null, switched: false, fallback: true };
  }
  if (tool.id === "outpaint") {
    const native = list.find((item) => item.id === INPAINT_PRESET_ID && supportsInpaint(item)) || null;
    if (native) {
      return { preset: native, switched: !current || native.id !== current.id, fallback: false };
    }
    if (supportsInpaint(current)) return { preset: current, switched: false, fallback: false };
    const fallback = referencePresetOf(list);
    if (fallback) return { preset: fallback, switched: true, fallback: true };
    return { preset: null, switched: false, fallback: true };
  }
  if (tool.id === "img2img") {
    if (supportsImg2Img(current) && !inpaintOnlyOf(current)) {
      return { preset: current, switched: false, fallback: false };
    }
    const fallback = referencePresetOf(list);
    if (fallback) return { preset: fallback, switched: true, fallback: true };
    return { preset: null, switched: false, fallback: true };
  }
  return missing;
}
function toolStrengthDefaultOf(toolId, preset) {
  const tool = imageToolOf(toolId);
  if (tool && tool.id === "inpaint") {
    return inpaintOnlyOf(preset) ? MASK_STRENGTH_NATIVE : MASK_STRENGTH_DEFAULT;
  }
  if (tool && tool.id === "outpaint") {
    const strength = Number(OUTPAINT.strength);
    return Number.isFinite(strength) ? strength : LIMITS.strength.default;
  }
  return LIMITS.strength.default;
}
function toolStrengthMaxOf(toolId, hasMask) {
  const tool = imageToolOf(toolId);
  const max = Number(LIMITS.strength.max);
  if (!tool || tool.form !== "canvas" || hasMask !== true) return max;
  const inpaintMax = Number(LIMITS.strength.inpaintMax);
  return Number.isFinite(inpaintMax) ? Math.max(max, inpaintMax) : max;
}
function toolPromptFallback(targetPrompt) {
  return String(targetPrompt ?? "").trim().slice(0, LIMITS.prompt.maxChars);
}
function finiteNumber(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function presetSteps(preset) {
  const raw = finiteNumber(preset && preset.steps);
  return raw === null ? 4 : clampInt(raw, LIMITS.steps.min, LIMITS.steps.max, 4);
}
function presetCfg(preset) {
  const raw = finiteNumber(preset && preset.cfg);
  return raw === null ? 0 : clampNumber(raw, LIMITS.cfg.min, LIMITS.cfg.max, 0);
}
function maskForSubmit(tool, mask) {
  if (!tool || tool.form !== "canvas") return "";
  const raw = mask && typeof mask === "object" ? mask.data : mask;
  const data = normalizeMaskData(raw);
  if (!data) return "";
  if (base64BytesOf(data) > Number(LIMITS.mask.maxBytes)) return "";
  return data;
}
function buildImageToolBody(input) {
  const source = input && typeof input === "object" ? input : {};
  const tool = resolveTool(source.tool);
  if (!tool || !tool.ready) return null;
  if (tool.form === "instant" || tool.id === "outpaint") return null;
  const targetPath = typeof source.targetPath === "string" ? source.targetPath.trim() : "";
  if (!targetPath) return null;
  const list = Array.isArray(source.presets) ? source.presets : [];
  const wantedId = typeof source.presetId === "string" ? source.presetId.trim() : "";
  const presetCandidate = source.preset && typeof source.preset === "object" && source.preset.id ? source.preset : list.find((item) => item && item.id === wantedId) || null;
  if (!presetCandidate) return null;
  const preset = presetCandidate;
  const typed = typeof source.prompt === "string" ? source.prompt.trim() : "";
  const prompt = (typed || toolPromptFallback(source.targetPrompt)).slice(0, LIMITS.prompt.maxChars);
  if (!prompt) return null;
  const target = source.target && typeof source.target === "object" ? source.target : null;
  const rawWidth = positiveSize(source.targetWidth) ?? positiveSize(target && target.width) ?? positiveSize(preset.size);
  const rawHeight = positiveSize(source.targetHeight) ?? positiveSize(target && target.height) ?? positiveSize(preset.size);
  const data = maskForSubmit(tool, source.mask);
  const hasMask = Boolean(data);
  const rawStrength = finiteNumber(source.strength);
  const strength = clampMaskStrength(rawStrength === null ? toolStrengthDefaultOf(tool.id, preset) : rawStrength, hasMask);
  const body = {
    presetId: preset.id,
    prompt,
    negativePrompt: source.negativeActive === true ? hintOf(preset) : "",
    width: clampSize(rawWidth),
    height: clampSize(rawHeight),
    steps: presetSteps(preset),
    cfg: presetCfg(preset),
    seed: "",
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: {
      path: targetPath,
      strength
    }
  };
  if (data) body.reference.mask = data;
  return body;
}
function buildUpscaleToolBody(input) {
  const source = input && typeof input === "object" ? input : {};
  const target = source.target && typeof source.target === "object" ? source.target : null;
  const targetPath = typeof source.targetPath === "string" && source.targetPath.trim() ? source.targetPath.trim() : workKeyOf(target);
  if (!targetPath) return null;
  const prompt = (typeof source.targetPrompt === "string" ? source.targetPrompt.trim() : "").slice(0, LIMITS.prompt.maxChars);
  const width = positiveSize(source.targetWidth) ?? positiveSize(target && target.width);
  const height = positiveSize(source.targetHeight) ?? positiveSize(target && target.height);
  const body = {
    tool: "upscale",
    prompt,
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: { path: targetPath }
  };
  if (width !== null) body.width = width;
  if (height !== null) body.height = height;
  return body;
}
function buildOutpaintToolBody(input) {
  const source = input && typeof input === "object" ? input : {};
  const target = source.target && typeof source.target === "object" ? source.target : null;
  const targetPath = typeof source.targetPath === "string" && source.targetPath.trim() ? source.targetPath.trim() : workKeyOf(target);
  if (!targetPath) return null;
  const list = Array.isArray(source.presets) ? source.presets : [];
  const wantedId = typeof source.presetId === "string" ? source.presetId.trim() : "";
  const preset = source.preset && typeof source.preset === "object" && source.preset.id ? source.preset : list.find((item) => item && item.id === wantedId) || null;
  if (!preset) return null;
  const canvas = normalizeOutpaintCanvas(source.canvas);
  if (!canvas) return null;
  const typed = typeof source.prompt === "string" ? source.prompt.trim() : "";
  const prompt = (typed || toolPromptFallback(source.targetPrompt)).slice(0, LIMITS.prompt.maxChars);
  if (!prompt) return null;
  const rawStrength = finiteNumber(source.strength);
  const strength = clampMaskStrength(rawStrength === null ? Number(OUTPAINT.strength) : rawStrength, true);
  const outpaintContent = buildOutpaintContentBody(canvas);
  return {
    tool: "outpaint",
    presetId: preset.id,
    prompt,
    negativePrompt: source.negativeActive === true ? hintOf(preset) : "",
    width: canvas.width,
    height: canvas.height,
    steps: presetSteps(preset),
    cfg: presetCfg(preset),
    seed: "",
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: {
      image: canvas.image,
      mask: canvas.mask,
      sourcePath: targetPath,
      strength,
      ...outpaintContent ? { outpaintContent } : {}
    }
  };
}
function nonNegativeInt2(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}
function normalizeOutpaintCanvas(input) {
  const source = input && typeof input === "object" ? input : {};
  const image = normalizeMaskData(source.image);
  const mask = normalizeMaskData(source.mask);
  if (!image || !mask) return null;
  if (base64BytesOf(image) > Number(LIMITS.reference.maxBytes)) return null;
  if (base64BytesOf(mask) > Number(LIMITS.mask.maxBytes)) return null;
  const step = Number(LIMITS.width.step) > 0 ? Number(LIMITS.width.step) : 8;
  const maxEdge = Number(OUTPAINT.maxEdge);
  const maxPixels = Number(OUTPAINT.maxPixels);
  const minEdge = Number(OUTPAINT.minEdge);
  const width = positiveSize(source.width);
  const height = positiveSize(source.height);
  if (width === null || height === null) return null;
  if (width % step !== 0 || height % step !== 0) return null;
  if (width > maxEdge || height > maxEdge) return null;
  if (width * height > maxPixels) return null;
  if (width < minEdge || height < minEdge) return null;
  const contentInput = source.content && typeof source.content === "object" ? source.content : null;
  if (!contentInput) return null;
  const x = nonNegativeInt2(contentInput.x);
  const y = nonNegativeInt2(contentInput.y);
  const contentWidth = positiveSize(contentInput.width);
  const contentHeight = positiveSize(contentInput.height);
  if (x === null || y === null || contentWidth === null || contentHeight === null) return null;
  if (x + contentWidth > width || y + contentHeight > height) return null;
  const content = { x, y, width: contentWidth, height: contentHeight };
  const coverage = Math.max(0, Math.min(1, 1 - contentWidth * contentHeight / (width * height)));
  return {
    image,
    mask,
    width,
    height,
    content,
    coverage: Number(coverage.toFixed(6))
  };
}
function imageToolBlockedKeyOf(input) {
  const source = input && typeof input === "object" ? input : {};
  const tool = resolveTool(source.tool);
  if (!tool) return "studio.imageTool.blockedTarget";
  if (!tool.ready) return tool.plannedKey || "studio.imageTool.planned";
  const targetPath = typeof source.targetPath === "string" && source.targetPath.trim() ? source.targetPath.trim() : workKeyOf(source.target);
  if (!targetPath) return "studio.imageTool.blockedTarget";
  if (tool.id === "upscale") {
    const target = source.target && typeof source.target === "object" ? source.target : null;
    const width = positiveSize(source.targetWidth) ?? positiveSize(target && target.width);
    const height = positiveSize(source.targetHeight) ?? positiveSize(target && target.height);
    if (width !== null && height !== null && Math.max(width, height) > Number(UPSCALE.maxInputEdge)) {
      return "studio.imageTool.upscaleTooLarge";
    }
    return "";
  }
  if (!source.preset || typeof source.preset !== "object" || !source.preset.id) {
    return "studio.imageTool.blockedNoPreset";
  }
  if (tool.id === "outpaint") {
    if (!normalizeOutpaintCanvas(source.canvas)) return "studio.outpaint.blockedCanvas";
    const typedPrompt = typeof source.prompt === "string" ? source.prompt.trim() : "";
    if (!typedPrompt && !toolPromptFallback(source.targetPrompt)) return "studio.imageTool.blockedNoPrompt";
    return "";
  }
  const typed = typeof source.prompt === "string" ? source.prompt.trim() : "";
  if (!typed && !toolPromptFallback(source.targetPrompt)) return "studio.imageTool.blockedNoPrompt";
  if (tool.form === "canvas" && inpaintOnlyOf(source.preset) && !maskForSubmit(tool, source.mask)) {
    return "studio.mask.onlyHint";
  }
  return "";
}
function workKeyOf(value) {
  if (typeof value === "string") return value.trim();
  const holder = value && typeof value === "object" ? value : null;
  if (!holder) return "";
  const image = holder.image && typeof holder.image === "object" ? holder.image : holder;
  const path = typeof image.path === "string" ? image.path.trim() : typeof image.file === "string" ? image.file.trim() : "";
  return path;
}

// src/studio/stage/CompareSlider.jsx
var import_react27 = __toESM(require("react"), 1);
var import_jsx_runtime25 = require("react/jsx-runtime");
var KEY_STEP = 0.04;
function clampPosition(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}
function ratioOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return number;
}
function regionOf(value) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return null;
  const keys = ["x", "y", "width", "height"];
  for (const key of keys) {
    if (typeof source[key] !== "number" || !Number.isFinite(source[key])) return null;
  }
  if (!(source.width > 0) || !(source.height > 0)) return null;
  return {
    x: Math.min(1, Math.max(0, source.x)),
    y: Math.min(1, Math.max(0, source.y)),
    width: Math.min(1, source.width),
    height: Math.min(1, source.height)
  };
}
function CompareSlider(props) {
  const { t, beforeUrl, afterUrl, beforeContent, beforeLabel, afterLabel, ratio, initialPosition } = props;
  const [position, setPosition] = import_react27.default.useState(() => clampPosition(initialPosition ?? 0.5));
  const [dragging, setDragging] = import_react27.default.useState(false);
  const trackRef = import_react27.default.useRef(null);
  const label = typeof t === "function" ? t : (key) => key;
  const beforeText = beforeLabel || label("studio.compare.before");
  const afterText = afterLabel || label("studio.compare.after");
  const percent = Math.round(position * 100);
  const frameRatio = ratioOf(ratio);
  const baseRegion = regionOf(beforeContent);
  const baseClass = baseRegion ? "ofs-compare-base is-region" : "ofs-compare-base";
  const baseStyle = baseRegion ? {
    left: `${baseRegion.x * 100}%`,
    top: `${baseRegion.y * 100}%`,
    width: `${baseRegion.width * 100}%`,
    height: `${baseRegion.height * 100}%`
  } : void 0;
  function positionOfPointer(event) {
    const track = trackRef.current;
    if (!track || typeof track.getBoundingClientRect !== "function") return null;
    const rect = track.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return null;
    const clientX = Number(event && event.clientX);
    if (!Number.isFinite(clientX)) return null;
    return clampPosition((clientX - rect.left) / rect.width);
  }
  function onPointerDown(event) {
    if (event && event.button !== void 0 && event.button !== 0) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    setDragging(true);
    const next = positionOfPointer(event);
    if (next !== null) setPosition(next);
    const target = event && event.currentTarget;
    if (target && typeof target.setPointerCapture === "function" && event.pointerId !== void 0) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
      }
    }
  }
  function onPointerMove(event) {
    if (!dragging) return;
    const next = positionOfPointer(event);
    if (next !== null) setPosition(next);
  }
  function onPointerUp(event) {
    setDragging(false);
    const target = event && event.currentTarget;
    if (target && typeof target.releasePointerCapture === "function" && event.pointerId !== void 0) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
      }
    }
  }
  function onKeyDown(event) {
    const key = event && event.key;
    if (key === "Home") {
      setPosition(0);
      if (event.preventDefault) event.preventDefault();
      return;
    }
    if (key === "End") {
      setPosition(1);
      if (event.preventDefault) event.preventDefault();
      return;
    }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    const delta = key === "ArrowRight" ? KEY_STEP : -KEY_STEP;
    setPosition((prev) => clampPosition(prev + delta));
    if (event.preventDefault) event.preventDefault();
  }
  function onDoubleClick() {
    setPosition(0.5);
  }
  const dividerStyle = { left: `${position * 100}%` };
  const overlayStyle = { clipPath: `inset(0 0 0 ${position * 100}%)` };
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
    "div",
    {
      ref: trackRef,
      className: `ofs-compare${dragging ? " is-dragging" : ""}`,
      style: { "--ofs-compare-r": String(frameRatio) },
      role: "slider",
      tabIndex: 0,
      "aria-label": label("studio.compare.hint"),
      "aria-orientation": "horizontal",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": percent,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("img", { className: baseClass, style: baseStyle, src: beforeUrl, alt: beforeText, draggable: false }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "ofs-compare-overlay", style: overlayStyle, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("img", { className: "ofs-compare-image", src: afterUrl, alt: afterText, draggable: false }) }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "ofs-compare-tag ofs-compare-tag--before", children: beforeText }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "ofs-compare-tag ofs-compare-tag--after", children: afterText }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "ofs-compare-divider", style: dividerStyle, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("span", { className: "ofs-compare-handle", children: [
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "ofs-compare-arrow is-back", children: "‹" }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "ofs-compare-arrow is-forward", children: "›" })
        ] }) })
      ]
    }
  );
}

// src/studio/stage/ImageDock.jsx
var import_react28 = __toESM(require("react"), 1);
var import_jsx_runtime26 = require("react/jsx-runtime");
function ImageDock(props) {
  const {
    t,
    tools,
    activeToolId,
    editing,
    resumeLabel,
    draftStatusLabel,
    onOpen,
    onResume,
    onClose,
    onReroll,
    onUseReference,
    plannedTitle
  } = props;
  const list = Array.isArray(tools) ? tools.filter((item) => item && item.id) : [];
  const active = list.find((item) => item.id === activeToolId) || null;
  const closeLabel = t("studio.imageTool.exit");
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "ofs-dock", children: [
    /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "ofs-dock-group", "data-group": "process", role: "group", "aria-label": t("studio.imageTool.groupLabel"), children: [
      list.map((tool) => {
        const enabled = tool.enabled !== false && tool.ready !== false;
        const label = tool.label || t(tool.labelKey);
        const icon = tool.icon;
        const isActive = Boolean(editing) && tool.id === activeToolId;
        return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)(
          "button",
          {
            type: "button",
            className: isActive ? "ofs-dock-button is-on" : "ofs-dock-button",
            title: enabled ? tool.hint || label : plannedTitle || label,
            "aria-disabled": enabled ? void 0 : "true",
            "aria-pressed": isActive ? "true" : void 0,
            onClick: enabled ? () => onOpen(tool.id) : void 0,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Icon, { name: icon, size: 15 }),
              label
            ]
          },
          tool.id
        );
      }),
      active && editing ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("button", { type: "button", className: "ofs-dock-button ofs-dock-close", onClick: onClose, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Icon, { name: "close", size: 15 }),
        closeLabel
      ] }) : null,
      active && !editing && resumeLabel ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("button", { type: "button", className: "ofs-dock-button ofs-dock-resume", onClick: onResume, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Icon, { name: "focus", size: 15 }),
        resumeLabel,
        draftStatusLabel ? /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", { className: "ofs-dock-draft", children: draftStatusLabel }) : null
      ] }) : null
    ] }),
    !editing ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "ofs-dock-group", "data-group": "reuse", children: [
      /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("button", { type: "button", className: "ofs-dock-button", onClick: onReroll, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Icon, { name: "reroll", size: 15 }),
        t("studio.action.reroll")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("button", { type: "button", className: "ofs-dock-button ofs-dock-reference", onClick: onUseReference, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Icon, { name: "image", size: 15 }),
        t("studio.reference.setAsReference")
      ] })
    ] }) : null
  ] });
}

// src/studio/stage/ImageDropzone.jsx
var import_react29 = __toESM(require("react"), 1);

// src/studio/imageFile.js
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== "function") {
      reject(new Error("FileReader unavailable"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// src/studio/stage/ImageDropzone.jsx
var import_jsx_runtime27 = require("react/jsx-runtime");
var ACCEPT2 = "image/png,image/jpeg";
function translateOf(t, key, params) {
  const template = typeof t === "function" ? t(key) : key;
  return formatText(template, params);
}
function pickFile(dataTransfer) {
  const files = filesOf(dataTransfer);
  if (files.length === 0) return null;
  return files.find((file) => importMimeOf(file)) || files[0];
}
function isTextEditingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable === true;
}
function ImageDropzone(props) {
  const { t, ui, editorOpen, selecting, onImported, showChoose, chooseLabel, triggerRef, children } = props;
  const [dragging, setDragging] = import_react29.default.useState(false);
  const [busy, setBusy] = import_react29.default.useState(false);
  const inputRef = import_react29.default.useRef(null);
  const dragDepthRef = import_react29.default.useRef(0);
  const busyRef = import_react29.default.useRef(false);
  const aliveRef = import_react29.default.useRef(true);
  const startImportRef = import_react29.default.useRef(null);
  import_react29.default.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const blocked = importDragOf({
    editorOpen: editorOpen === true,
    selecting: selecting === true
  }) === "blocked";
  function toast(key, params) {
    if (ui && typeof ui.showToast === "function") ui.showToast(translateOf(t, key, params));
  }
  function openPicker() {
    if (blocked) {
      toast("studio.import.blockedEditing");
      return;
    }
    const input = inputRef.current;
    if (input && typeof input.click === "function") input.click();
  }
  async function startImport(file) {
    if (!file || busyRef.current) return;
    if (blocked) {
      toast("studio.import.blockedEditing");
      return;
    }
    const fileError = importFileErrorOf(file);
    if (fileError) {
      toast(fileError, fileError === "studio.import.tooLarge" ? { size: importMaxMiB() } : null);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    toast("studio.import.importing");
    try {
      const rawDataUrl = await readFileAsDataUrl(file);
      const precheck = importPrecheckOf({ file, dataUrl: rawDataUrl });
      if (!precheck.ok) {
        toast(precheck.errorKey, precheck.params);
        return;
      }
      const result = await importImageFile({
        data: precheck.dataUrl,
        name: precheck.name || void 0
      });
      if (!aliveRef.current) return;
      const entry = result && result.ok && result.data ? result.data.entry : null;
      if (!entry) {
        toast("studio.import.failed");
        return;
      }
      if (typeof onImported === "function") {
        onImported(entry);
        return;
      }
      toast(importMetaFoundOf(entry) ? "studio.import.metaFound" : "studio.import.done");
    } catch {
      if (aliveRef.current) toast("studio.import.failed");
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }
  startImportRef.current = startImport;
  import_react29.default.useEffect(() => {
    if (!triggerRef || typeof triggerRef !== "object") return void 0;
    triggerRef.current = openPicker;
    return () => {
      if (triggerRef.current === openPicker) triggerRef.current = null;
    };
  });
  import_react29.default.useEffect(() => {
    function onPaste(event) {
      const target = event && event.target || (typeof document !== "undefined" ? document.activeElement : null);
      if (isTextEditingTarget(target)) return;
      const file = pickFile(event && event.clipboardData);
      if (!file) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (startImportRef.current) startImportRef.current(file);
    }
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("paste", onPaste);
    };
  }, []);
  function onDragEnter(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    dragDepthRef.current += 1;
    if (!dragging) setDragging(true);
  }
  function onDragOver(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    const dataTransfer = event.dataTransfer;
    if (dataTransfer) dataTransfer.dropEffect = blocked ? "none" : "copy";
  }
  function onDragLeave(event) {
    if (!hasFilePayload(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0 && dragging) setDragging(false);
  }
  function onDrop(event) {
    if (!hasFilePayload(event)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    dragDepthRef.current = 0;
    if (dragging) setDragging(false);
    const file = pickFile(event.dataTransfer);
    if (file) startImport(file);
  }
  function onFileChange(event) {
    const input = event && event.target;
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = "";
    if (file) startImport(file);
  }
  const zoneClass = `ofs-import-zone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`;
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(
    "div",
    {
      className: zoneClass,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      children: [
        children,
        dragging ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: "ofs-import-overlay", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: blocked ? "ofs-import-hint is-blocked" : "ofs-import-hint", children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(Icon, { name: blocked ? "alert" : "image", size: 18 }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: translateOf(t, blocked ? "studio.import.blockedEditing" : "studio.import.dropHint") })
        ] }) }) : null,
        busy ? /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: "ofs-import-status", role: "status", children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: translateOf(t, "studio.import.importing") })
        ] }) : null,
        showChoose && !blocked ? /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("button", { type: "button", className: "ofs-import-choose", onClick: openPicker, disabled: busy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(Icon, { name: "image", size: 15 }),
          translateOf(t, chooseLabel || "studio.import.choose")
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
          "input",
          {
            ref: inputRef,
            className: "ofs-import-input",
            type: "file",
            accept: ACCEPT2,
            tabIndex: -1,
            "aria-hidden": "true",
            hidden: true,
            onChange: onFileChange
          }
        )
      ]
    }
  );
}

// src/studio/stage/InlineTool.jsx
var import_react31 = __toESM(require("react"), 1);

// src/studio/stage/ToolSubmitBar.jsx
var import_react30 = __toESM(require("react"), 1);

// src/logic/generate.js
function referencePathOf(form) {
  const input = form && typeof form === "object" ? form : {};
  const reference = input.reference && typeof input.reference === "object" ? input.reference : null;
  return reference && typeof reference.path === "string" ? reference.path.trim() : "";
}
function buildGenerateBody(form, options = {}) {
  const input = form || {};
  const overrides = options.overrides && typeof options.overrides === "object" ? options.overrides : null;
  const negativeActive = options.negativeActive !== false;
  const explicit = overrides && typeof overrides.prompt === "string" ? overrides.prompt : null;
  const maxPromptChars = LIMITS.prompt.maxChars;
  const prompt = explicit !== null ? explicit.trim().slice(0, maxPromptChars) : String(input.prompt ?? "").trim().slice(0, maxPromptChars);
  const body = {
    prompt,
    negativePrompt: negativeForSubmit(input, negativeActive),
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
  const hasOverride = (key) => overrides !== null && Object.prototype.hasOwnProperty.call(overrides, key);
  const references = referencePathsOf(hasOverride("references") ? overrides.references : input.references);
  if (references.length > 0) body.references = references;
  const reference = hasOverride("reference") ? overrides.reference : input.reference;
  const referencePath = references.length > 0 ? "" : referencePathOf({ reference });
  if (referencePath) {
    const strength = hasOverride("strength") ? overrides.strength : input.strength;
    const mask = options.maskActive === false ? "" : referenceMaskForSubmit(reference);
    body.reference = { path: referencePath, strength: clampMaskStrength(strength, Boolean(mask)) };
    if (mask) body.reference.mask = mask;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === "prompt" || key === "reference" || key === "strength" || key === "references") continue;
      body[key] = value;
    }
  }
  if (!negativeActive) body.negativePrompt = "";
  return body;
}
function presetLabelOf(preset) {
  if (!preset || typeof preset !== "object") return "";
  if (typeof preset.label === "string" && preset.label.trim()) return preset.label.trim();
  if (typeof preset.short === "string" && preset.short.trim()) return preset.short.trim();
  return typeof preset.id === "string" ? preset.id : "";
}
function effectivePresetOf(overrides, preset, presets) {
  const list = Array.isArray(presets) ? presets : [];
  const input = overrides && typeof overrides === "object" ? overrides : null;
  const id = input && typeof input.presetId === "string" ? input.presetId.trim() : "";
  if (id) {
    const found = list.find((item) => item && item.id === id);
    if (found) return found;
  }
  return preset && typeof preset === "object" ? preset : null;
}
function generateCapabilityOf(options = {}) {
  const preset = options.preset && typeof options.preset === "object" ? options.preset : null;
  const presets = Array.isArray(options.presets) ? options.presets : [];
  const result = { ok: true, reason: "", blockedKey: "", blockedParams: null, notice: null, preset: null };
  if (presets.length === 0) return result;
  const provider = providerIdOf(options.provider);
  const needed = presetProviderRestrictionOf(preset);
  if (needed && needed !== provider) {
    result.ok = false;
    result.reason = "provider";
    result.blockedKey = "studio.form.blockedProvider";
    result.blockedParams = { preset: presetLabelOf(preset), provider, needed };
    return result;
  }
  const referenceCapability = referenceCapabilityOf(preset, options.references);
  if (!referenceCapability.ok) {
    result.ok = false;
    result.reason = "reference";
    result.blockedKey = referenceCapability.blockedKey;
    return result;
  }
  if (!inpaintOnlyOf(preset)) return result;
  const fallback = referencePresetOf(presets);
  if (!fallback) {
    result.ok = false;
    result.reason = "preset";
    result.blockedKey = "studio.form.blockedInpaintOnly";
    return result;
  }
  result.preset = fallback;
  result.notice = {
    key: "studio.form.autoText2Image",
    params: { preset: presetLabelOf(fallback) }
  };
  return result;
}
function previewRecallOf(options = {}) {
  const patch = options.patch && typeof options.patch === "object" ? options.patch : {};
  if (Object.keys(patch).length === 0) return { action: "idle", park: false, noticeKey: "" };
  if (options.dirty === true) return { action: "recall", park: true, noticeKey: "studio.toast.draftKept" };
  if (options.hasDraft === true) return { action: "recall", park: false, noticeKey: "studio.toast.draftKept" };
  return { action: "recall", park: false, noticeKey: "studio.toast.recalled" };
}
function formSummaryOf(body) {
  const input = body && typeof body === "object" ? body : {};
  const width = positiveSize(input.width);
  const height = positiveSize(input.height);
  const count = finiteNumber2(input.count);
  const seed = finiteNumber2(input.seed);
  return {
    presetId: typeof input.presetId === "string" ? input.presetId : "",
    ratioId: ratioIdOf(width, height),
    width,
    height,
    count: count === null ? 1 : Math.min(LIMITS.count.max, Math.max(LIMITS.count.min, Math.round(count))),
    seed: seed !== null && seed >= 0 ? Math.trunc(seed) : null
  };
}
function finiteNumber2(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  const steps = finiteNumber2(params && params.steps) ?? finiteNumber2(preset && preset.steps);
  const cfg = finiteNumber2(params && params.cfg) ?? finiteNumber2(preset && preset.cfg);
  const seed = finiteNumber2(image && image.seed) ?? finiteNumber2(params && params.seed);
  const negative = params && typeof params.negativePrompt === "string" ? params.negativePrompt : null;
  return { image, item, params, presetId, prompt, width, height, steps, cfg, seed, negative };
}
function isBareImportOf(entry) {
  const item = entry && entry.item ? entry.item : null;
  if (!item || item.source !== "import") return false;
  const params = item.params && typeof item.params === "object" ? item.params : null;
  if (!params) return true;
  return !(typeof params.steps === "number" || typeof params.cfg === "number" || typeof params.seed === "number");
}
var DIFFUSION_LOOKBACK = 8;
function isUpscaleItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.upscale === true) return true;
  return typeof item.presetId === "string" && item.presetId.trim() === UPSCALE.id;
}
function isNonDiffusionItem(item, presets) {
  if (!item || typeof item !== "object") return false;
  if (isUpscaleItem(item)) return true;
  const presetId = typeof item.presetId === "string" ? item.presetId.trim() : "";
  if (!presetId) return false;
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : [];
  if (list.length === 0) return false;
  const found = presetOf(list, presetId);
  return !found || found.inpaintOnly === true;
}
function isNonDiffusionRecallOf(entry, presets) {
  const item = entry && typeof entry === "object" && entry.item ? entry.item : null;
  return isNonDiffusionItem(item, presets);
}
function itemsByImagePathOf(items) {
  const map = /* @__PURE__ */ new Map();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const images = Array.isArray(item.images) ? item.images : [];
    for (const image of images) {
      const path = image && typeof image.path === "string" ? image.path.trim() : "";
      if (path && !map.has(path)) map.set(path, { item, image });
    }
  }
  return map;
}
function diffusionSourceOf(entry, items, presets) {
  const holder = entry && typeof entry === "object" ? entry : null;
  if (!holder || !holder.item) return null;
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : [];
  if (!isNonDiffusionItem(holder.item, list)) return holder;
  const byPath = itemsByImagePathOf(items);
  const seen = /* @__PURE__ */ new Set();
  let current = holder;
  for (let depth = 0; depth < DIFFUSION_LOOKBACK; depth += 1) {
    const item = current && current.item ? current.item : null;
    const sourceImage = item && typeof item.sourceImage === "string" ? item.sourceImage.trim() : "";
    if (!sourceImage || seen.has(sourceImage)) return null;
    seen.add(sourceImage);
    const parent = byPath.get(sourceImage);
    if (!parent) return null;
    const parentEntry = {
      image: parent.image && typeof parent.image === "object" ? parent.image : { path: sourceImage },
      item: parent.item
    };
    if (isBareImportOf(parentEntry)) return null;
    if (!isNonDiffusionItem(parent.item, list)) return parentEntry;
    current = parentEntry;
  }
  return null;
}
function legalDiffusionPresetOf(presets, candidate) {
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : [];
  const wanted = typeof candidate === "string" ? candidate.trim() : candidate && typeof candidate === "object" && typeof candidate.id === "string" ? candidate.id.trim() : "";
  const found = wanted ? presetOf(list, wanted) : null;
  if (found && !inpaintOnlyOf(found)) return found;
  return list.find((preset) => !inpaintOnlyOf(preset)) || null;
}
function fallbackTuningOf(preset) {
  const patch = {};
  if (!preset || typeof preset !== "object" || !preset.id) return patch;
  patch.presetId = preset.id;
  const rawSteps = finiteNumber2(preset.steps);
  if (rawSteps !== null && rawSteps > 0) {
    patch.steps = clampInt(rawSteps, LIMITS.steps.min, LIMITS.steps.max, LIMITS.steps.min);
  }
  const rawCfg = finiteNumber2(preset.cfg);
  if (rawCfg !== null && rawCfg > 0) {
    patch.cfg = clampNumber(rawCfg, LIMITS.cfg.min, LIMITS.cfg.max, rawCfg);
  }
  return patch;
}
function fallbackSizeOf(entry) {
  const item = entry && entry.item ? entry.item : null;
  const image = entry && entry.image ? entry.image : null;
  const params = item && item.params && typeof item.params === "object" ? item.params : null;
  const upscaleSource = item && item.upscaleSource && typeof item.upscaleSource === "object" ? item.upscaleSource : null;
  const width = positiveSize(upscaleSource && upscaleSource.width) ?? positiveSize(image && image.width) ?? positiveSize(params && params.width);
  const height = positiveSize(upscaleSource && upscaleSource.height) ?? positiveSize(image && image.height) ?? positiveSize(params && params.height);
  return {
    width: width === null ? null : clampSize(width),
    height: height === null ? null : clampSize(height)
  };
}
function degradedIteratePatch(entry, form, presets) {
  const item = entry && entry.item ? entry.item : null;
  if (!item) return {};
  const patch = {};
  const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, LIMITS.prompt.maxChars) : "";
  if (prompt) patch.prompt = prompt;
  const params = item.params && typeof item.params === "object" ? item.params : null;
  if (params && typeof params.negativePrompt === "string") patch.negative = params.negativePrompt;
  const size = fallbackSizeOf(entry);
  if (size.width !== null) patch.width = size.width;
  if (size.height !== null) patch.height = size.height;
  const preset = legalDiffusionPresetOf(presets, form && typeof form === "object" ? form.presetId : "");
  Object.assign(patch, fallbackTuningOf(preset));
  if (Object.keys(patch).length > 0) patch.seed = "";
  return patch;
}
function degradedRerollOverrides(entry, presets, fallbackPreset) {
  const item = entry && entry.item ? entry.item : null;
  if (!item) return null;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, LIMITS.prompt.maxChars) : "";
  if (!prompt) return null;
  const overrides = { prompt, seed: -1, count: 1, references: [] };
  const params = item.params && typeof item.params === "object" ? item.params : null;
  if (params && typeof params.negativePrompt === "string") overrides.negativePrompt = params.negativePrompt;
  const size = fallbackSizeOf(entry);
  if (size.width !== null) overrides.width = size.width;
  if (size.height !== null) overrides.height = size.height;
  Object.assign(overrides, fallbackTuningOf(legalDiffusionPresetOf(presets, fallbackPreset)));
  return overrides;
}
function iteratePatch(entry, form, presets, items) {
  if (isBareImportOf(entry)) return {};
  if (isNonDiffusionRecallOf(entry, presets)) {
    const source = diffusionSourceOf(entry, items, presets);
    if (source && source !== entry) return iteratePatch(source, form, presets, items);
    return degradedIteratePatch(entry, form, presets);
  }
  const recall = recallOf(entry, presets);
  const patch = {};
  const prompt = recall.prompt.trim();
  if (prompt) patch.prompt = prompt;
  if (recall.negative !== null) patch.negative = recall.negative;
  if (recall.width !== null) patch.width = recall.width;
  if (recall.height !== null) patch.height = recall.height;
  if (recall.steps !== null) patch.steps = recall.steps;
  if (recall.cfg !== null) patch.cfg = recall.cfg;
  if (recall.seed !== null && recall.seed >= 0) patch.seed = String(Math.trunc(recall.seed));
  if (recall.presetId) patch.presetId = recall.presetId;
  if (Object.keys(patch).length > 0) {
    if (!Object.prototype.hasOwnProperty.call(patch, "seed")) patch.seed = "";
  }
  return patch;
}
function rerollOverrides(entry, presets, items, fallbackPreset) {
  if (isBareImportOf(entry)) return null;
  if (isNonDiffusionRecallOf(entry, presets)) {
    const source = diffusionSourceOf(entry, items, presets);
    if (source && source !== entry) return rerollOverrides(source, presets, items, fallbackPreset);
    return degradedRerollOverrides(entry, presets, fallbackPreset);
  }
  const recall = recallOf(entry, presets);
  const prompt = recall.prompt.trim();
  if (!prompt) return null;
  const item = entry && typeof entry === "object" && entry.item && typeof entry.item === "object" ? entry.item : null;
  const itemParams = item && item.params && typeof item.params === "object" ? item.params : null;
  const references = referencePathsOf(item && item.referenceSources || itemParams && itemParams.referenceSources);
  const overrides = { prompt, seed: -1, count: 1, references };
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
  const count = finiteNumber2(params.count);
  if (count !== null) overrides.count = Math.min(4, Math.max(1, Math.round(count)));
  const width = positiveSize(params.width);
  const height = positiveSize(params.height);
  if (width !== null) overrides.width = width;
  if (height !== null) overrides.height = height;
  const steps = finiteNumber2(params.steps);
  const cfg = finiteNumber2(params.cfg);
  if (steps !== null) overrides.steps = steps;
  if (cfg !== null) overrides.cfg = cfg;
  if (typeof params.negativePrompt === "string") overrides.negativePrompt = params.negativePrompt;
  const references = referencePathsOf(params.referenceSources || params.references);
  if (references.length > 0) overrides.references = references;
  const presetId = holder.presetId || params.presetId || "";
  if (presetId) overrides.presetId = presetId;
  return overrides;
}

// src/studio/stage/ToolSubmitBar.jsx
var import_jsx_runtime28 = require("react/jsx-runtime");
function ToolSubmitBar(props) {
  const {
    t,
    tool,
    presets,
    presetId,
    onPresetChange,
    prompt,
    onPromptChange,
    promptPlaceholder,
    strength,
    strengthMax,
    onStrengthChange,
    maskCoverage,
    // 可选：画布类工具的覆盖率文案模板（如扩图「新增画面 {percent}%」）。
    // 不传时保持既有「已涂抹 {percent}% / 尚未涂抹蒙版」行为。
    metaLabel,
    metaPercent,
    submitting,
    canSubmit,
    blockedKey,
    onSubmit,
    onExit
  } = props;
  const list = Array.isArray(presets) ? presets : [];
  const showCoverage = maskCoverage !== null && maskCoverage !== void 0;
  const customMeta = typeof metaLabel === "string" && metaLabel !== "";
  const percent = percentOf(customMeta ? metaPercent : maskCoverage);
  const max = Number.isFinite(Number(strengthMax)) ? Number(strengthMax) : LIMITS.strength.max;
  const value = Number.isFinite(Number(strength)) ? Number(strength) : LIMITS.strength.default;
  const busy = submitting === true;
  const blocked = !canSubmit && Boolean(blockedKey);
  return /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: "ofs-tool-bar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: "ofs-tool-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: "ofs-tool-bar-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: "ofs-tool-name", children: tool ? t(tool.labelKey) : "" }),
        list.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", { className: "ofs-tool-preset", children: [
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: "ofs-tool-preset-label", children: t("studio.imageTool.presetLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
            "select",
            {
              className: "ofs-tool-select",
              value: presetId || "",
              "aria-label": t("studio.imageTool.presetLabel"),
              onChange: (event) => onPresetChange(event.target.value),
              children: list.map((item) => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("option", { value: item.id, children: presetLabelOf(item) }, item.id))
            }
          )
        ] }) : list.length === 1 ? /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: "ofs-tool-preset-name", children: presetLabelOf(list[0]) }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", { className: "ofs-tool-prompt", children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: "ofs-tool-label", children: t("studio.imageTool.promptLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          "textarea",
          {
            className: "ofs-tool-prompt-input",
            rows: 1,
            value: prompt || "",
            placeholder: promptPlaceholder || "",
            "aria-label": t("studio.imageTool.promptLabel"),
            onChange: (event) => onPromptChange(event.target.value),
            onKeyDown: (event) => {
              if (!event || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
              if (typeof event.preventDefault === "function") event.preventDefault();
              if (canSubmit === true && !busy && typeof onSubmit === "function") onSubmit();
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", { className: "ofs-tool-strength", children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: "ofs-tool-label", children: t("studio.imageTool.strengthLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          "input",
          {
            type: "range",
            className: "ofs-tool-range",
            min: LIMITS.strength.min,
            max,
            step: LIMITS.strength.step,
            value,
            "aria-label": t("studio.imageTool.strengthLabel"),
            onChange: (event) => onStrengthChange(event.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("b", { className: "ofs-tool-readout", children: value.toFixed(2) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: "ofs-tool-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          "button",
          {
            type: "button",
            className: "ofs-btn is-primary ofs-tool-submit",
            disabled: canSubmit !== true || busy,
            "aria-busy": busy ? "true" : void 0,
            onClick: onSubmit,
            children: t("studio.imageTool.submit")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("button", { type: "button", className: "ofs-btn is-danger-quiet ofs-tool-exit", disabled: busy, onClick: onExit, children: t("studio.imageTool.exit") })
      ] })
    ] }),
    showCoverage || blocked ? /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: "ofs-tool-meta", children: [
      showCoverage ? /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("p", { className: "ofs-tool-mask ofs-hint", children: customMeta ? formatText(metaLabel, { percent }) : percent > 0 ? formatText(t("studio.mask.coverage"), { percent }) : t("studio.imageTool.maskEmpty") }) : null,
      blocked ? /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("p", { className: "ofs-hint ofs-tool-blocked", role: "status", children: t(blockedKey) }) : null
    ] }) : null
  ] });
}

// src/studio/stage/InlineTool.jsx
var import_jsx_runtime29 = require("react/jsx-runtime");
function ratioOf2(width, height) {
  const w = Number(width);
  const h2 = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h2) || w <= 0 || h2 <= 0) return 1;
  return w / h2;
}
function InlineTool(props) {
  const {
    t,
    target,
    tool,
    presets,
    presetId,
    onPresetChange,
    prompt,
    onPromptChange,
    strength,
    strengthMax,
    onStrengthChange,
    submitting,
    canSubmit,
    blockedKey,
    onSubmit,
    onExit
  } = props;
  if (!target || !target.path) return null;
  const list = Array.isArray(presets) ? presets : [];
  const ratio = ratioOf2(target.width, target.height);
  const promptPlaceholder = target.prompt || t("studio.imageTool.promptPlaceholder");
  return /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: "ofs-inline-tool", children: [
    /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("div", { className: "ofs-inline-stage", style: { "--ofs-print-r": String(ratio) }, children: /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
      "img",
      {
        src: target.url,
        alt: target.prompt || referenceFileName(target.path) || t("studio.image.alt"),
        className: "ofs-print",
        style: { "--ofs-print-r": String(ratio) },
        draggable: false
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
      ToolSubmitBar,
      {
        t,
        tool,
        presets: list,
        presetId,
        onPresetChange,
        prompt,
        onPromptChange,
        promptPlaceholder,
        strength,
        strengthMax,
        onStrengthChange,
        maskCoverage: void 0,
        submitting,
        canSubmit,
        blockedKey,
        onSubmit,
        onExit
      }
    )
  ] });
}

// src/studio/stage/MaskEditor.jsx
var import_react32 = __toESM(require("react"), 1);
var import_jsx_runtime30 = require("react/jsx-runtime");
var MASK_HIT_STYLE = { minHeight: 44, minWidth: 44 };
function isTextInputTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = String(target.type || "text").toLowerCase();
    return type !== "range" && type !== "button" && type !== "checkbox" && type !== "radio";
  }
  return false;
}
function MaskEditor(props) {
  const {
    t,
    target,
    tool,
    presets,
    presetId,
    mask,
    coverage,
    onMaskApply,
    onMaskClear,
    onStash,
    onExit
  } = props;
  const handleStash = typeof onStash === "function" ? onStash : onExit;
  const list = Array.isArray(presets) ? presets : [];
  const activePreset = list.find((item) => item && item.id === presetId) || null;
  const canPaint = Boolean(target && target.path && tool && tool.form === "canvas");
  const targetWidth = Number(target && target.width);
  const targetHeight = Number(target && target.height);
  const [naturalSize, setNaturalSize] = import_react32.default.useState(() => ({
    width: Number.isFinite(targetWidth) && targetWidth > 0 ? Math.round(targetWidth) : 0,
    height: Number.isFinite(targetHeight) && targetHeight > 0 ? Math.round(targetHeight) : 0
  }));
  const canvasSize = maskCanvasSizeOf(naturalSize.width, naturalSize.height, MASK_CANVAS_EDGE);
  const [brush, setBrush] = import_react32.default.useState(() => brushStateOf());
  const [view, setView] = import_react32.default.useState(() => ({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } }));
  const [spaceHeld, setSpaceHeld] = import_react32.default.useState(false);
  const [panning, setPanning] = import_react32.default.useState(false);
  const [undoDepth, setUndoDepth] = import_react32.default.useState(0);
  const [inkCoverage, setInkCoverage] = import_react32.default.useState(() => maskStateOf({ coverage: mask ? mask.coverage : 0 }).coverage);
  const [maskNotice, setMaskNotice] = import_react32.default.useState("");
  const editorRef = import_react32.default.useRef(null);
  const viewportRef = import_react32.default.useRef(null);
  const stageRef = import_react32.default.useRef(null);
  const canvasRef = import_react32.default.useRef(null);
  const cursorRef = import_react32.default.useRef(null);
  const drawingRef = import_react32.default.useRef(null);
  const panningRef = import_react32.default.useRef(null);
  const lastCursorPointRef = import_react32.default.useRef(null);
  const keyboardCursorRef = import_react32.default.useRef(null);
  const viewRef = import_react32.default.useRef(view);
  viewRef.current = view;
  const brushRef = import_react32.default.useRef(brush);
  brushRef.current = brush;
  const spaceHeldRef = import_react32.default.useRef(spaceHeld);
  spaceHeldRef.current = spaceHeld;
  const undoStackRef = import_react32.default.useRef([]);
  const restoreRef = import_react32.default.useRef(mask);
  restoreRef.current = mask;
  const coverageProp = Number(coverage);
  import_react32.default.useEffect(() => {
    if (!Number.isFinite(coverageProp)) return;
    setInkCoverage(maskStateOf({ coverage: coverageProp }).coverage);
  }, [coverageProp]);
  function canvasContext() {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== "function") return null;
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  }
  function canvasPointOf(event) {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      x: ((Number(event && event.clientX) || 0) - rect.left) * (canvas.width / rect.width),
      y: ((Number(event && event.clientY) || 0) - rect.top) * (canvas.height / rect.height)
    };
  }
  function canvasScaleOf(canvas) {
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0) || !(canvas.width > 0) || !(canvas.height > 0)) return null;
    return {
      rect,
      scaleX: rect.width / canvas.width,
      scaleY: rect.height / canvas.height
    };
  }
  function paintDot(ctx, x, y, eraser) {
    ctx.save();
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, brush.size / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function paintLine(ctx, from, to, eraser) {
    ctx.save();
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, brush.size);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }
  function coverageOfCanvas(canvas, ctx) {
    if (typeof ctx.getImageData !== "function") return 0;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels && pixels.data ? pixels.data : [];
    let ink = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) ink += 1;
    }
    return maskCoverageOf(ink, canvas.width * canvas.height);
  }
  function restoreStoredMask(ctx, canvas, imageElement) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx || typeof scratchCtx.getImageData !== "function") return;
    scratchCtx.drawImage(imageElement, 0, 0, scratch.width, scratch.height);
    const pixels = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      const painted = data[index] + data[index + 1] + data[index + 2] > 382;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = painted ? 255 : 0;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  function commitMask(coverageOverride) {
    const geometry = canvasContext();
    if (!geometry) return;
    const { canvas, ctx } = geometry;
    const coverage2 = Number.isFinite(Number(coverageOverride)) ? maskStateOf({ coverage: coverageOverride }).coverage : coverageOfCanvas(canvas, ctx);
    setInkCoverage(coverage2);
    setMaskNotice("");
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    const exporter = document.createElement("canvas");
    exporter.width = canvas.width;
    exporter.height = canvas.height;
    const exportCtx = exporter.getContext("2d");
    if (!exportCtx) return;
    exportCtx.fillStyle = "#000000";
    exportCtx.fillRect(0, 0, exporter.width, exporter.height);
    exportCtx.drawImage(canvas, 0, 0);
    const verdict = maskExportVerdict(exporter.toDataURL("image/png"), coverage2);
    if (!verdict.ok) {
      if (verdict.reason === "empty") {
        restoreRef.current = null;
        if (typeof onMaskClear === "function") onMaskClear();
        return;
      }
      if (verdict.reason === "too_large") setMaskNotice(t("studio.mask.tooLarge"));
      return;
    }
    const result = typeof onMaskApply === "function" ? onMaskApply({ data: verdict.data, coverage: verdict.coverage }) : null;
    if (result && result.ok === false) {
      if (result.reason === "too_large" || result.reason === "invalid") setMaskNotice(t("studio.mask.tooLarge"));
    }
  }
  function placeMaskCursor(point, sizeOverride) {
    const cursor = cursorRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !cursor.style || !canvas || !(canvas.width > 0) || !(canvas.height > 0)) return;
    lastCursorPointRef.current = { x: point.x, y: point.y };
    const stageEl = stageRef.current;
    const baseWidth = stageEl && Number(stageEl.clientWidth) > 0 ? stageEl.clientWidth : (canvasScaleOf(canvas)?.rect.width || canvas.width) / (viewRef.current.zoom || 1);
    const size = Math.max(2, (sizeOverride ?? brushRef.current.size) * (baseWidth / canvas.width));
    cursor.style.display = "block";
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
    cursor.style.left = `${point.x / canvas.width * 100}%`;
    cursor.style.top = `${point.y / canvas.height * 100}%`;
  }
  function hideMaskCursor() {
    lastCursorPointRef.current = null;
    const cursor = cursorRef.current;
    if (cursor && cursor.style) cursor.style.display = "none";
  }
  function pushUndoSnapshot() {
    const geometry = canvasContext();
    if (!geometry) return;
    const { canvas, ctx } = geometry;
    if (typeof ctx.getImageData !== "function") return;
    try {
      const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const stack = undoStackRef.current;
      stack.push(snap);
      if (stack.length > MASK_UNDO_LIMIT) stack.shift();
      setUndoDepth(stack.length);
    } catch {
    }
  }
  function undoMask() {
    const geometry = canvasContext();
    if (!geometry) return false;
    const { ctx } = geometry;
    const stack = undoStackRef.current;
    if (stack.length === 0 || typeof ctx.putImageData !== "function") return false;
    const previous = stack.pop();
    setUndoDepth(stack.length);
    ctx.putImageData(previous, 0, 0);
    setMaskNotice("");
    commitMask();
    return true;
  }
  function viewBounds() {
    const stageEl = stageRef.current;
    const viewportEl = viewportRef.current;
    return {
      stageWidth: stageEl && Number(stageEl.clientWidth) > 0 ? stageEl.clientWidth : 0,
      stageHeight: stageEl && Number(stageEl.clientHeight) > 0 ? stageEl.clientHeight : 0,
      viewWidth: viewportEl && Number(viewportEl.clientWidth) > 0 ? viewportEl.clientWidth : 0,
      viewHeight: viewportEl && Number(viewportEl.clientHeight) > 0 ? viewportEl.clientHeight : 0
    };
  }
  function applyZoomAt(nextZoom, clientX, clientY) {
    const viewportEl = viewportRef.current;
    const bounds = viewBounds();
    let anchor = { x: 0, y: 0 };
    if (viewportEl && typeof viewportEl.getBoundingClientRect === "function" && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const vRect = viewportEl.getBoundingClientRect();
      anchor = {
        x: clientX - (vRect.left + vRect.width / 2),
        y: clientY - (vRect.top + vRect.height / 2)
      };
    }
    const next = zoomAtPoint({
      zoom: viewRef.current.zoom,
      pan: viewRef.current.pan,
      anchor,
      nextZoom,
      bounds
    });
    setView(next);
  }
  function resetView() {
    setView({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } });
  }
  function stepBrush(direction) {
    setBrush((prev) => {
      const nextSize = stepBrushSize(prev.size, direction);
      if (nextSize === prev.size) return prev;
      if (lastCursorPointRef.current) placeMaskCursor(lastCursorPointRef.current, nextSize);
      return { ...prev, size: nextSize };
    });
  }
  function onMaskPointerDown(event) {
    const geometry = canvasContext();
    if (!geometry) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== void 0) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
    }
    const isMiddle = event && event.button === 1;
    if (isMiddle || spaceHeldRef.current) {
      hideMaskCursor();
      panningRef.current = {
        startX: Number(event && event.clientX) || 0,
        startY: Number(event && event.clientY) || 0,
        origPan: { ...viewRef.current.pan }
      };
      setPanning(true);
      return;
    }
    const point = canvasPointOf(event);
    if (!point) return;
    pushUndoSnapshot();
    paintDot(geometry.ctx, point.x, point.y, brush.eraser);
    drawingRef.current = { x: point.x, y: point.y };
    keyboardCursorRef.current = { x: point.x, y: point.y };
    placeMaskCursor(point);
  }
  function onMaskPointerMove(event) {
    if (panningRef.current) {
      const dx = (Number(event && event.clientX) || 0) - panningRef.current.startX;
      const dy = (Number(event && event.clientY) || 0) - panningRef.current.startY;
      const nextPan = clampPan(
        { x: panningRef.current.origPan.x + dx, y: panningRef.current.origPan.y + dy },
        { ...viewBounds(), zoom: viewRef.current.zoom }
      );
      setView((prev) => ({ ...prev, pan: nextPan }));
      return;
    }
    const geometry = canvasContext();
    if (!geometry) return;
    const point = canvasPointOf(event);
    if (!point) return;
    if (spaceHeldRef.current) {
      hideMaskCursor();
      return;
    }
    placeMaskCursor(point);
    const previous = drawingRef.current;
    if (!previous) return;
    paintLine(geometry.ctx, previous, point, brush.eraser);
    drawingRef.current = { x: point.x, y: point.y };
  }
  function onMaskPointerUp(event) {
    const wasPanning = Boolean(panningRef.current);
    const wasDrawing = Boolean(drawingRef.current);
    panningRef.current = null;
    drawingRef.current = null;
    if (wasPanning) setPanning(false);
    if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === "function" && event.pointerId !== void 0) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }
    }
    if (wasDrawing) commitMask();
  }
  function onMaskKeyDown(event) {
    const key = event && event.key;
    if (key === "Escape") {
      if (typeof onExit === "function") onExit();
      return;
    }
    const geometry = canvasContext();
    if (!geometry) return;
    const canvas = geometry.canvas;
    const current = keyboardCursorRef.current || { x: canvas.width / 2, y: canvas.height / 2 };
    const point = { x: current.x, y: current.y };
    if (key === "ArrowLeft") point.x -= MASK_KEY_STEP;
    else if (key === "ArrowRight") point.x += MASK_KEY_STEP;
    else if (key === "ArrowUp") point.y -= MASK_KEY_STEP;
    else if (key === "ArrowDown") point.y += MASK_KEY_STEP;
    else if (key === "Enter") {
      pushUndoSnapshot();
      paintDot(geometry.ctx, point.x, point.y, brush.eraser);
      keyboardCursorRef.current = { x: point.x, y: point.y };
      placeMaskCursor(point);
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      commitMask();
      return;
    } else {
      return;
    }
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    point.x = Math.min(canvas.width, Math.max(0, point.x));
    point.y = Math.min(canvas.height, Math.max(0, point.y));
    keyboardCursorRef.current = { x: point.x, y: point.y };
    placeMaskCursor(point);
  }
  function clearMaskCanvas() {
    const geometry = canvasContext();
    pushUndoSnapshot();
    setInkCoverage(0);
    setMaskNotice("");
    if (geometry) geometry.ctx.clearRect(0, 0, geometry.canvas.width, geometry.canvas.height);
    restoreRef.current = null;
    if (typeof onMaskClear === "function") onMaskClear();
  }
  function invertMaskCanvas() {
    const geometry = canvasContext();
    if (!geometry) return;
    const { canvas, ctx } = geometry;
    if (typeof ctx.getImageData !== "function" || typeof ctx.putImageData !== "function") return;
    pushUndoSnapshot();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0) {
        data[index + 3] = 0;
      } else {
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    setMaskNotice("");
    commitMask(inkCoverage > 0 ? 1 - inkCoverage : 1);
  }
  function onTargetLoad(event) {
    const imageElement = event && event.target ? event.target : null;
    const width = Number(imageElement && imageElement.naturalWidth);
    const height = Number(imageElement && imageElement.naturalHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setNaturalSize((prev) => prev.width === width && prev.height === height ? prev : { width, height });
  }
  const targetKey = target ? `${target.path}|${target.width || ""}x${target.height || ""}` : "";
  const maskLayoutKey = `${targetKey}|${canvasSize.width}x${canvasSize.height}`;
  import_react32.default.useEffect(() => {
    setView({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } });
    undoStackRef.current = [];
    setUndoDepth(0);
    setInkCoverage(maskStateOf({ coverage: restoreRef.current ? restoreRef.current.coverage : 0 }).coverage);
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== "function") return void 0;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return void 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const stored = restoreRef.current;
    if (!stored || !stored.data || typeof Image !== "function" || typeof document === "undefined") return void 0;
    let cancelled = false;
    const maskImage = new Image();
    maskImage.onload = () => {
      if (cancelled) return;
      restoreStoredMask(ctx, canvas, maskImage);
      setInkCoverage(maskStateOf({ coverage: stored.coverage }).coverage);
    };
    maskImage.onerror = () => {
      if (!cancelled) setInkCoverage(emptyMaskState().coverage);
    };
    maskImage.src = `data:image/png;base64,${stored.data}`;
    return () => {
      cancelled = true;
      maskImage.onload = null;
      maskImage.onerror = null;
    };
  }, [maskLayoutKey]);
  import_react32.default.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof viewport.addEventListener !== "function") return void 0;
    const onWheel = (event) => {
      if (!event) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      const deltaY = Number(event.deltaY) || 0;
      if (deltaY === 0) return;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        stepBrush(deltaY < 0 ? 1 : -1);
        return;
      }
      const step = event.ctrlKey ? -deltaY * 0.01 : deltaY < 0 ? MASK_ZOOM.step : -MASK_ZOOM.step;
      applyZoomAt(viewRef.current.zoom + step, Number(event.clientX), Number(event.clientY));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (typeof viewport.removeEventListener === "function") viewport.removeEventListener("wheel", onWheel);
    };
  }, [canPaint]);
  import_react32.default.useEffect(() => {
    if (!canPaint) return void 0;
    const doc = typeof document === "undefined" ? null : document;
    const win = typeof window === "undefined" ? null : window;
    if (!doc || typeof doc.addEventListener !== "function") return void 0;
    const onKeyDown = (event) => {
      if (!event) return;
      const key = event.key;
      if (key === "Escape") {
        if (typeof handleStash === "function") handleStash();
        return;
      }
      if (isTextInputTarget(event.target)) return;
      const hasMod = Boolean(event.ctrlKey || event.metaKey);
      if (hasMod && String(key).toLowerCase() === "z" && !event.shiftKey) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        undoMask();
        return;
      }
      if (hasMod && (key === "=" || key === "+" || key === "-")) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        const delta = key === "-" ? -MASK_ZOOM.step : MASK_ZOOM.step;
        applyZoomAt(clampZoom(viewRef.current.zoom + delta));
        return;
      }
      if (key === "0") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        resetView();
        return;
      }
      if (hasMod || event.altKey) return;
      if (key === " " || key === "Spacebar") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setSpaceHeld(true);
          hideMaskCursor();
        }
        return;
      }
      const lower = String(key).toLowerCase();
      if (lower === "e") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        setBrush((prev) => toggleEraser(prev));
      } else if (lower === "b") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        setBrush((prev) => prev.eraser ? { ...prev, eraser: false } : prev);
      } else if (key === "[") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        stepBrush(-1);
      } else if (key === "]") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        stepBrush(1);
      }
    };
    const onKeyUp = (event) => {
      if (!event || event.key !== " " && event.key !== "Spacebar") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    const onBlur = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      panningRef.current = null;
      setPanning(false);
    };
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("keyup", onKeyUp);
    if (win && typeof win.addEventListener === "function") win.addEventListener("blur", onBlur);
    return () => {
      if (typeof doc.removeEventListener === "function") {
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("keyup", onKeyUp);
      }
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("blur", onBlur);
    };
  }, [canPaint]);
  if (!canPaint) return null;
  const editorAspect = naturalSize.width > 0 && naturalSize.height > 0 ? `${naturalSize.width} / ${naturalSize.height}` : "1";
  const maskRatio = naturalSize.width > 0 && naturalSize.height > 0 ? naturalSize.width / naturalSize.height : 1;
  const maskPercent = percentOf(inkCoverage);
  const fastModel = Number(activePreset && activePreset.steps) <= 8;
  const zoomed = view.zoom > MASK_ZOOM.min;
  const stageTransform = zoomed || view.pan.x !== 0 || view.pan.y !== 0 ? `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` : void 0;
  const stageClass = [
    "ofs-mask-stage",
    spaceHeld ? "is-panning" : "",
    panning ? "is-panning-active" : ""
  ].filter(Boolean).join(" ");
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: "ofs-mask-editor", ref: editorRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: "ofs-mask-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { className: "ofs-mask-title", children: t("studio.mask.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { className: "ofs-mask-coverage ofs-muted", children: formatText(t("studio.mask.coverage"), { percent: maskPercent }) }),
      zoomed ? /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-mask-zoom",
          title: t("studio.mask.resetView"),
          onClick: resetView,
          children: `${view.zoom.toFixed(1)}×`
        }
      ) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: fastModel ? "ofs-mask-help is-warn" : "ofs-mask-help", children: [
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-glass-btn ofs-mask-help-btn",
          "aria-label": t("studio.mask.hint"),
          title: t("studio.mask.guide"),
          children: "?"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: "ofs-mask-tips", role: "tooltip", children: [
        /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", { className: "ofs-hint ofs-mask-hint", children: t("studio.mask.hint") }),
        /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", { className: "ofs-hint ofs-mask-guide", children: t("studio.mask.guide") }),
        fastModel ? /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", { className: "ofs-hint ofs-mask-fast", children: t("studio.mask.fastModelHint") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: "ofs-mask-shortcuts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { className: "ofs-mask-shortcuts-title", children: t("studio.mask.shortcutsTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("ul", { className: "ofs-mask-shortcuts-list", children: [
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.zoom") }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.pan") }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.brush") }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.eraser") }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.undo") }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("li", { children: t("studio.mask.shortcuts.reset") })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
      "div",
      {
        className: "ofs-mask-viewport",
        ref: viewportRef,
        onDoubleClick: () => {
          if (viewRef.current.zoom > MASK_ZOOM.min) resetView();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)(
          "div",
          {
            ref: stageRef,
            className: stageClass,
            style: {
              "--ofs-mask-r": String(maskRatio),
              aspectRatio: editorAspect,
              ...stageTransform ? { transform: stageTransform } : {}
            },
            children: [
              target.url ? /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
                "img",
                {
                  src: target.url,
                  alt: target.prompt || referenceFileName(target.path) || t("studio.image.alt"),
                  draggable: false,
                  onLoad: onTargetLoad,
                  className: "ofs-mask-photo"
                }
              ) : null,
              /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
                "canvas",
                {
                  ref: canvasRef,
                  className: "ofs-mask-canvas",
                  role: "application",
                  tabIndex: 0,
                  "aria-label": t("studio.mask.canvasLabel"),
                  onPointerDown: onMaskPointerDown,
                  onPointerMove: onMaskPointerMove,
                  onPointerUp: onMaskPointerUp,
                  onPointerCancel: onMaskPointerUp,
                  onPointerLeave: hideMaskCursor,
                  onKeyDown: onMaskKeyDown,
                  onBlur: hideMaskCursor
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
                "span",
                {
                  ref: cursorRef,
                  className: "ofs-mask-cursor",
                  "aria-hidden": "true",
                  style: { left: 0, top: 0, width: 0, height: 0 }
                }
              )
            ]
          }
        )
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: "ofs-mask-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("label", { className: "ofs-mask-brush", children: [
        /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { children: t("studio.mask.brush") }),
        /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
          "input",
          {
            type: "range",
            className: "ofs-mask-range",
            min: MASK_BRUSH.min,
            max: MASK_BRUSH.max,
            step: MASK_BRUSH.step,
            value: brush.size,
            "aria-label": t("studio.mask.brush"),
            onChange: (event) => setBrush((prev) => brushStateOf({ ...prev, size: clampBrushSize(event.target.value) }))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("b", { children: brush.size })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        "button",
        {
          type: "button",
          className: "ofs-dock-button",
          style: MASK_HIT_STYLE,
          disabled: undoDepth === 0,
          title: t("studio.mask.shortcuts.undo"),
          onClick: undoMask,
          children: t("studio.mask.undo")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        "button",
        {
          type: "button",
          className: brush.eraser ? "ofs-dock-button is-on" : "ofs-dock-button",
          style: MASK_HIT_STYLE,
          "aria-pressed": brush.eraser,
          onClick: () => setBrush((prev) => toggleEraser(prev)),
          children: t("studio.mask.eraser")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("button", { type: "button", className: "ofs-dock-button", style: MASK_HIT_STYLE, onClick: clearMaskCanvas, children: t("studio.mask.clear") }),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("button", { type: "button", className: "ofs-dock-button", style: MASK_HIT_STYLE, onClick: invertMaskCanvas, children: t("studio.mask.invert") }),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("button", { type: "button", className: "ofs-dock-button ofs-mask-close", style: MASK_HIT_STYLE, onClick: handleStash, children: t("studio.mask.close") })
    ] }),
    maskNotice ? /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", { className: "ofs-hint ofs-mask-warn", role: "status", children: maskNotice }) : null
  ] });
}

// src/studio/stage/OutpaintEditor.jsx
var import_react33 = __toESM(require("react"), 1);
var import_jsx_runtime31 = require("react/jsx-runtime");
var HIT_STYLE = { minHeight: 44, minWidth: 44 };
var KEY_STEP2 = 8;
function stripDataUrl(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value.startsWith("data:")) return value;
  const comma = value.indexOf(",");
  return comma >= 0 ? value.slice(comma + 1) : "";
}
function percentOfSize(value, total) {
  if (!(Number(total) > 0)) return "0%";
  return `${Number(value) / Number(total) * 100}%`;
}
function renderOutpaintDataUrls(doc, drawable, plan, sourceWidth, sourceHeight) {
  const imageCanvas = doc.createElement("canvas");
  imageCanvas.width = plan.width;
  imageCanvas.height = plan.height;
  const maskCanvas = doc.createElement("canvas");
  maskCanvas.width = plan.width;
  maskCanvas.height = plan.height;
  const imageCtx = typeof imageCanvas.getContext === "function" ? imageCanvas.getContext("2d") : null;
  const maskCtx = typeof maskCanvas.getContext === "function" ? maskCanvas.getContext("2d") : null;
  if (!imageCtx || !maskCtx) return null;
  if (typeof imageCanvas.toDataURL !== "function" || typeof maskCanvas.toDataURL !== "function") return null;
  const scaleX = sourceWidth / plan.content.width;
  const scaleY = sourceHeight / plan.content.height;
  imageCtx.drawImage(drawable, plan.content.x, plan.content.y, plan.content.width, plan.content.height);
  for (const strip of outpaintEdgeStripsOf(plan)) {
    imageCtx.drawImage(
      drawable,
      strip.source.x * scaleX,
      strip.source.y * scaleY,
      strip.source.width * scaleX,
      strip.source.height * scaleY,
      strip.target.x,
      strip.target.y,
      strip.target.width,
      strip.target.height
    );
  }
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, plan.width, plan.height);
  maskCtx.fillStyle = "#000000";
  maskCtx.fillRect(plan.content.x, plan.content.y, plan.content.width, plan.content.height);
  return {
    image: stripDataUrl(imageCanvas.toDataURL("image/png")),
    mask: stripDataUrl(maskCanvas.toDataURL("image/png")),
    width: plan.width,
    height: plan.height,
    content: plan.content
  };
}
async function fetchCleanDrawable(urls) {
  if (typeof fetch !== "function") return null;
  for (const url of urls) {
    if (!url) continue;
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res || !res.ok) continue;
      const blob = await res.blob();
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return {
          drawable: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          dispose: () => {
            if (typeof bitmap.close === "function") bitmap.close();
          }
        };
      }
      if (typeof Image === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const objectUrl = URL.createObjectURL(blob);
        const loaded = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("image_load_failed"));
          img.src = objectUrl;
        }).finally(() => {
          URL.revokeObjectURL(objectUrl);
        });
        return {
          drawable: loaded,
          width: loaded.naturalWidth,
          height: loaded.naturalHeight,
          dispose: () => {
          }
        };
      }
    } catch {
    }
  }
  return null;
}
function OutpaintEditor(props) {
  const {
    t,
    target,
    tool,
    outpaint,
    onRatioChange,
    onAnchorChange,
    onCanvasApply
  } = props;
  const targetWidth = Number(target && target.width);
  const targetHeight = Number(target && target.height);
  const [natural, setNatural] = import_react33.default.useState(() => ({
    width: Number.isFinite(targetWidth) && targetWidth > 0 ? Math.round(targetWidth) : 0,
    height: Number.isFinite(targetHeight) && targetHeight > 0 ? Math.round(targetHeight) : 0
  }));
  const [loaded, setLoaded] = import_react33.default.useState(false);
  const [dragging, setDragging] = import_react33.default.useState(null);
  const [notice, setNotice] = import_react33.default.useState("");
  const imageRef = import_react33.default.useRef(null);
  const stageRef = import_react33.default.useRef(null);
  const dragRef = import_react33.default.useRef(null);
  const dragAnchorRef = import_react33.default.useRef(null);
  const applyRef = import_react33.default.useRef(onCanvasApply);
  applyRef.current = onCanvasApply;
  const exportSeqRef = import_react33.default.useRef(0);
  const mountedRef = import_react33.default.useRef(true);
  import_react33.default.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exportSeqRef.current += 1;
    };
  }, []);
  const canEdit = Boolean(target && target.path && tool && tool.id === "outpaint");
  const ratioId = outpaint && typeof outpaint.ratioId === "string" && outpaint.ratioId ? outpaint.ratioId : OUTPAINT_EXPAND_ID;
  const anchor = outpaintAnchorOf(outpaint && outpaint.anchor);
  const options = import_react33.default.useMemo(() => outpaintRatioOptions(), []);
  const plan = outpaintPlanOf({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    ratioId,
    anchor
  });
  const previewAnchor = dragging || anchor;
  const previewPlan = outpaintPlanOf({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    ratioId,
    anchor: previewAnchor
  });
  function commitExport(exported) {
    if (!exported) return;
    const result = typeof applyRef.current === "function" ? applyRef.current(exported) : null;
    if (result && result.ok === false) {
      if (result.reason === "too_large") setNotice(t("studio.outpaint.tooLarge"));
      else if (result.reason === "invalid") setNotice(t("studio.outpaint.invalidCanvas"));
      else setNotice("");
      return;
    }
    setNotice("");
  }
  function exportCanvas() {
    if (!plan.ok) return;
    const doc = typeof document === "undefined" ? null : document;
    if (!doc || typeof doc.createElement !== "function") return;
    const sourceImage = imageRef.current;
    if (!sourceImage || sourceImage.complete === false) return;
    const sourceWidth = natural.width > 0 ? natural.width : plan.content.width;
    const sourceHeight = natural.height > 0 ? natural.height : plan.content.height;
    const seq = ++exportSeqRef.current;
    try {
      const exported = renderOutpaintDataUrls(doc, sourceImage, plan, sourceWidth, sourceHeight);
      if (exported) commitExport(exported);
      return;
    } catch {
    }
    const sameOrigin = target && target.path && doc.baseURI ? apiUrl(referenceUrlOf(target.path)) : "";
    const candidates = [sameOrigin, target && target.url ? target.url : ""].filter(
      (value, index, list) => value && list.indexOf(value) === index
    );
    if (candidates.length === 0) return;
    void fetchCleanDrawable(candidates).then((clean) => {
      if (!mountedRef.current || seq !== exportSeqRef.current) {
        if (clean) clean.dispose();
        return;
      }
      if (!clean) {
        setNotice(t("studio.outpaint.invalidCanvas"));
        return;
      }
      try {
        const w = clean.width > 0 ? clean.width : sourceWidth;
        const h2 = clean.height > 0 ? clean.height : sourceHeight;
        const exported = renderOutpaintDataUrls(doc, clean.drawable, plan, w, h2);
        if (exported) commitExport(exported);
      } catch {
        if (mountedRef.current && seq === exportSeqRef.current) setNotice(t("studio.outpaint.invalidCanvas"));
      } finally {
        clean.dispose();
      }
    });
  }
  function syncLoadedFromNode(imageElement) {
    if (!imageElement || !imageElement.complete) return;
    const width = Number(imageElement.naturalWidth);
    const height = Number(imageElement.naturalHeight);
    if (!(width > 0) || !(height > 0)) return;
    setLoaded((prev) => prev ? prev : true);
    setNatural((prev) => prev.width === width && prev.height === height ? prev : { width, height });
  }
  function attachImageNode(node) {
    imageRef.current = node;
    syncLoadedFromNode(node);
  }
  const targetUrl = target && target.url ? target.url : "";
  import_react33.default.useEffect(() => {
    syncLoadedFromNode(imageRef.current);
  }, [targetUrl]);
  const exportKey = plan.ok ? `${plan.ratioId}|${plan.width}x${plan.height}|${plan.content.x},${plan.content.y}|${natural.width}x${natural.height}` : "";
  import_react33.default.useEffect(() => {
    if (!exportKey || !loaded) return void 0;
    let cancelled = false;
    const timer2 = setTimeout(() => {
      if (!cancelled) exportCanvas();
    }, 0);
    return () => {
      cancelled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer2);
    };
  }, [exportKey, loaded, anchor.x, anchor.y]);
  if (!canEdit) return null;
  function onTargetLoad(event) {
    const imageElement = event && event.target ? event.target : null;
    const width = Number(imageElement && imageElement.naturalWidth);
    const height = Number(imageElement && imageElement.naturalHeight);
    setLoaded(true);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setNatural((prev) => prev.width === width && prev.height === height ? prev : { width, height });
  }
  function centerAnchor() {
    if (typeof onAnchorChange === "function") onAnchorChange({ x: 0.5, y: 0.5 });
    setDragging(null);
  }
  function onRatioClick(id) {
    if (typeof onRatioChange === "function") onRatioChange(id);
  }
  function onContentPointerDown(event) {
    if (!previewPlan.ok) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== void 0) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
    }
    const stage = stageRef.current;
    const rect = stage && typeof stage.getBoundingClientRect === "function" ? stage.getBoundingClientRect() : null;
    dragRef.current = {
      startX: Number(event && event.clientX) || 0,
      startY: Number(event && event.clientY) || 0,
      startAnchor: previewAnchor,
      padX: previewPlan.padding.left + previewPlan.padding.right,
      padY: previewPlan.padding.top + previewPlan.padding.bottom,
      scaleX: rect && rect.width > 0 ? previewPlan.width / rect.width : 1,
      scaleY: rect && rect.height > 0 ? previewPlan.height / rect.height : 1,
      moved: false
    };
    dragAnchorRef.current = previewAnchor;
    setDragging(previewAnchor);
  }
  function onContentPointerMove(event) {
    const drag = dragRef.current;
    if (!drag || !previewPlan.ok) return;
    const dx = ((Number(event && event.clientX) || 0) - drag.startX) * drag.scaleX;
    const dy = ((Number(event && event.clientY) || 0) - drag.startY) * drag.scaleY;
    if (dx === 0 && dy === 0) return;
    drag.moved = true;
    const next = { x: drag.startAnchor.x, y: drag.startAnchor.y };
    if (drag.padX > 0) next.x = drag.startAnchor.x + dx / drag.padX;
    if (drag.padY > 0) next.y = drag.startAnchor.y + dy / drag.padY;
    const normalized = outpaintAnchorOf(next);
    dragAnchorRef.current = normalized;
    setDragging(normalized);
  }
  function onContentPointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === "function" && event.pointerId !== void 0) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }
    }
    const next = dragAnchorRef.current || anchor;
    dragAnchorRef.current = null;
    setDragging(null);
    if (drag && drag.moved && typeof onAnchorChange === "function") onAnchorChange(next);
  }
  function onContentKeyDown(event) {
    if (!event || !previewPlan.ok) return;
    const key = event.key;
    if (key === "Home") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      centerAnchor();
      return;
    }
    let delta = null;
    if (key === "ArrowLeft") delta = { x: -KEY_STEP2, y: 0 };
    else if (key === "ArrowRight") delta = { x: KEY_STEP2, y: 0 };
    else if (key === "ArrowUp") delta = { x: 0, y: -KEY_STEP2 };
    else if (key === "ArrowDown") delta = { x: 0, y: KEY_STEP2 };
    else return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof onAnchorChange === "function") {
      onAnchorChange(outpaintAnchorShift(previewPlan, anchor, delta));
    }
  }
  const layout = previewPlan.ok ? previewPlan : null;
  const stageRatio = layout ? layout.width / layout.height : 1;
  const percent = percentOf(plan.ok ? plan.coverage : 0);
  const coverageText = plan.ok ? formatText(t("studio.outpaint.coverage"), { percent }) : t("studio.outpaint.blockedCanvas");
  return /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: "ofs-outpaint-editor", children: [
    /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: "ofs-outpaint-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: "ofs-outpaint-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: "ofs-outpaint-title", children: t("studio.outpaint.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: "ofs-outpaint-coverage ofs-muted", children: coverageText })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: "ofs-outpaint-ratios", role: "group", "aria-label": t("studio.outpaint.ratioLabel"), children: options.map((option) => {
        const active = option.id === ratioId;
        return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
          "button",
          {
            type: "button",
            className: active ? "ofs-outpaint-ratio is-on" : "ofs-outpaint-ratio",
            style: HIT_STYLE,
            "aria-pressed": active ? "true" : "false",
            title: t(option.labelKey),
            onClick: () => onRatioClick(option.id),
            children: t(option.labelKey)
          },
          option.id
        );
      }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: "ofs-outpaint-viewport", children: layout ? /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)(
      "div",
      {
        ref: stageRef,
        className: "ofs-outpaint-stage",
        style: { "--ofs-outpaint-r": String(stageRatio) },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: "ofs-outpaint-preview", role: "img", "aria-label": t("studio.outpaint.canvasLabel"), children: [
            target.url ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
              "img",
              {
                ref: attachImageNode,
                src: target.url,
                alt: target.prompt || t("studio.image.alt"),
                className: "ofs-outpaint-photo",
                draggable: false,
                onLoad: onTargetLoad,
                style: {
                  left: percentOfSize(layout.content.x, layout.width),
                  top: percentOfSize(layout.content.y, layout.height),
                  width: percentOfSize(layout.content.width, layout.width),
                  height: percentOfSize(layout.content.height, layout.height)
                }
              }
            ) : null,
            layout.padding.top > 0 ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
              "span",
              {
                className: "ofs-outpaint-shade",
                "aria-hidden": "true",
                style: { left: 0, top: 0, width: "100%", height: percentOfSize(layout.padding.top, layout.height) }
              }
            ) : null,
            layout.padding.bottom > 0 ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
              "span",
              {
                className: "ofs-outpaint-shade",
                "aria-hidden": "true",
                style: {
                  left: 0,
                  top: percentOfSize(layout.height - layout.padding.bottom, layout.height),
                  width: "100%",
                  height: percentOfSize(layout.padding.bottom, layout.height)
                }
              }
            ) : null,
            layout.padding.left > 0 ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
              "span",
              {
                className: "ofs-outpaint-shade",
                "aria-hidden": "true",
                style: {
                  left: 0,
                  top: percentOfSize(layout.content.y, layout.height),
                  width: percentOfSize(layout.padding.left, layout.width),
                  height: percentOfSize(layout.content.height, layout.height)
                }
              }
            ) : null,
            layout.padding.right > 0 ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
              "span",
              {
                className: "ofs-outpaint-shade",
                "aria-hidden": "true",
                style: {
                  left: percentOfSize(layout.width - layout.padding.right, layout.width),
                  top: percentOfSize(layout.content.y, layout.height),
                  width: percentOfSize(layout.padding.right, layout.width),
                  height: percentOfSize(layout.content.height, layout.height)
                }
              }
            ) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
            "button",
            {
              type: "button",
              className: "ofs-outpaint-content",
              "aria-label": t("studio.outpaint.dragHint"),
              title: t("studio.outpaint.dragHint"),
              style: {
                left: percentOfSize(layout.content.x, layout.width),
                top: percentOfSize(layout.content.y, layout.height),
                width: percentOfSize(layout.content.width, layout.width),
                height: percentOfSize(layout.content.height, layout.height)
              },
              onPointerDown: onContentPointerDown,
              onPointerMove: onContentPointerMove,
              onPointerUp: onContentPointerUp,
              onPointerCancel: onContentPointerUp,
              onDoubleClick: centerAnchor,
              onKeyDown: onContentKeyDown,
              children: /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: "ofs-outpaint-grip", "aria-hidden": "true" })
            }
          )
        ]
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("p", { className: "ofs-hint ofs-outpaint-empty", children: t("studio.outpaint.blockedCanvas") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: "ofs-outpaint-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("button", { type: "button", className: "ofs-dock-button ofs-outpaint-center", style: HIT_STYLE, onClick: centerAnchor, children: t("studio.outpaint.center") }),
      /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("p", { className: "ofs-hint ofs-outpaint-hint", children: t("studio.outpaint.hint") })
    ] }),
    notice ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("p", { className: "ofs-hint ofs-outpaint-warn", role: "status", children: notice }) : null
  ] });
}

// src/studio/Stage.jsx
var import_jsx_runtime32 = require("react/jsx-runtime");
var FRESH_MS = 6e4;
function isFreshItem(item, now) {
  const finishedAt = Date.parse(String(item && item.finishedAt || ""));
  if (!Number.isFinite(finishedAt)) return false;
  const current = Number.isFinite(now) ? now : Date.now();
  const delta = current - finishedAt;
  return delta > -5e3 && delta < FRESH_MS;
}
function ratioOf3(width, height) {
  const w = Number(width);
  const h2 = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h2) || w <= 0 || h2 <= 0) return 1;
  return w / h2;
}
function Stage(props) {
  const { t, ui, compute, form, library, imageTool, actions } = props;
  const now = Date.now();
  const { zoom, setZoom, copyPath } = ui;
  const { activeJob } = compute;
  const progressText = activeJob ? jobCountText(t, activeJob) : "";
  const { useInspiration } = form;
  const { selected, isFavorite, toggleFavorite } = library;
  const image = selected && selected.image ? selected.image : null;
  const item = selected && selected.item || null;
  const params = item && item.params || null;
  const prompt = item && typeof item.prompt === "string" && item.prompt || params && typeof params.prompt === "string" && params.prompt || "";
  const closeRef = import_react34.default.useRef(null);
  const lightboxRef = import_react34.default.useRef(null);
  const zoomOpenerRef = import_react34.default.useRef(null);
  function openZoom() {
    zoomOpenerRef.current = document.activeElement || null;
    setZoom(true);
  }
  const activeTool = imageTool && imageTool.activeTool ? imageTool.activeTool : null;
  const editorOpen = Boolean(imageTool && imageTool.editorOpen && activeTool && imageTool.target);
  const dropzoneRef = import_react34.default.useRef(null);
  const compareOpen = Boolean(ui && ui.compareOpen);
  const setCompareOpen = ui && typeof ui.setCompareOpen === "function" ? ui.setCompareOpen : null;
  const imageKey = image ? image.path || image.file || image.url || "" : "";
  const sourceImage = item && typeof item.sourceImage === "string" && item.sourceImage || params && typeof params.sourceImage === "string" && params.sourceImage || "";
  const compareUrl = sourceImage ? referenceUrlOf(sourceImage) : "";
  const compareContent = item && item.outpaintContent ? normalizeOutpaintContent(item.outpaintContent) : null;
  const compareKeyRef = import_react34.default.useRef(imageKey);
  import_react34.default.useEffect(() => {
    if (compareKeyRef.current === imageKey) return;
    compareKeyRef.current = imageKey;
    if (setCompareOpen) setCompareOpen(false);
  }, [imageKey, setCompareOpen]);
  import_react34.default.useEffect(() => {
    if (editorOpen && setCompareOpen) setCompareOpen(false);
  }, [editorOpen, setCompareOpen]);
  const hasGallery = Array.isArray(library.gallery) && library.gallery.length > 0;
  const draftCard = library.newDraftCard && typeof library.newDraftCard === "object" ? library.newDraftCard : {};
  const showNewDraft = library.workspaceMode === "new_draft" && (hasGallery || draftCard.pending === true || Boolean(activeJob) || draftCard.explicit === true);
  const showChoose = !editorOpen && !activeJob && (showNewDraft || !image);
  const toolItems = IMAGE_TOOLS.map((tool) => ({
    ...tool,
    label: t(tool.labelKey),
    enabled: tool.ready === true,
    hint: tool.ready === true ? "" : t(tool.plannedKey || "studio.imageTool.planned")
  }));
  const draftHasInk = Boolean(imageTool && imageTool.mask) || Boolean(activeTool && activeTool.id === "outpaint" && imageTool && imageTool.outpaint && imageTool.outpaint.canvas);
  const draftStatusLabel = activeTool && !editorOpen && draftHasInk ? formatText(
    t(activeTool.id === "outpaint" ? "studio.outpaint.coverage" : "studio.imageTool.draftStatus"),
    { percent: percentOf(imageTool.coverage) }
  ) : "";
  const resumeLabel = activeTool ? t("studio.imageTool.resumeDraft") : "";
  const submitProps = {
    t,
    target: imageTool ? imageTool.target : null,
    tool: activeTool,
    // 只列当前工具真正可用的预设（inpaint 要 supportsInpaint、img2img 要 supportsImg2Img 且非 inpaintOnly）：
    // 列全量会让用户选到不支持能力的模型，切换请求被静默拒绝。
    presets: imageTool && Array.isArray(imageTool.toolPresets) ? imageTool.toolPresets : [],
    presetId: imageTool ? imageTool.presetId : "",
    onPresetChange: imageTool ? imageTool.selectPreset : () => {
    },
    prompt: imageTool ? imageTool.prompt : "",
    onPromptChange: imageTool ? imageTool.setPrompt : () => {
    },
    strength: imageTool ? imageTool.strength : 0,
    strengthMax: imageTool ? imageTool.strengthMax : 0,
    strengthAuto: imageTool ? imageTool.strengthAuto : false,
    onStrengthChange: imageTool ? imageTool.setStrength : () => {
    },
    submitting: Boolean(imageTool && imageTool.submitting),
    canSubmit: Boolean(imageTool && imageTool.canSubmit),
    blockedKey: imageTool ? imageTool.submitBlockedKey : "",
    onSubmit: imageTool ? imageTool.submit : () => {
    },
    // 「暂存涂抹」与 Esc 保留蒙版草稿并收起；底部红色「取消」按钮丢弃草稿并退出。
    onStash: imageTool ? imageTool.closeTool : () => {
    },
    onExit: imageTool ? imageTool.discardTool || imageTool.closeTool : () => {
    }
  };
  const target = imageTool ? imageTool.target : null;
  const promptPlaceholder = target && target.prompt || t("studio.imageTool.promptPlaceholder");
  const editorKey = target && target.path ? target.path : "none";
  const editorNode = editorOpen ? activeTool.form === "canvas" ? activeTool.id === "outpaint" ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
    OutpaintEditor,
    {
      ...submitProps,
      outpaint: imageTool.outpaint,
      coverage: imageTool.coverage,
      onRatioChange: imageTool.setOutpaintRatio,
      onAnchorChange: imageTool.setOutpaintAnchor,
      onCanvasApply: imageTool.applyOutpaintCanvas
    },
    editorKey
  ) : /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(MaskEditor, { ...submitProps, mask: imageTool.mask, coverage: imageTool.coverage, onMaskApply: imageTool.applyMask, onMaskClear: imageTool.clearMask }, editorKey) : /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(InlineTool, { ...submitProps }) : null;
  const dock = /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
    ImageDock,
    {
      t,
      tools: toolItems,
      activeToolId: activeTool ? activeTool.id : "",
      editing: editorOpen,
      resumeLabel,
      draftStatusLabel,
      onOpen: (toolId) => actions.openImageTool(toolId),
      onResume: () => {
        if (!activeTool) return;
        const target2 = imageTool.target;
        const entry = target2 ? { image: { path: target2.path, url: target2.url, width: target2.width, height: target2.height }, item: target2.item || null } : selected;
        actions.openImageTool(activeTool.id, entry);
      },
      onClose: () => imageTool.closeTool(),
      onReroll: () => actions.reroll(selected),
      onUseReference: () => actions.useAsReference(selected),
      plannedTitle: t("studio.imageTool.planned")
    }
  );
  let content = null;
  if (editorOpen) {
    content = /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("section", { className: "ofs-stage", children: [
      activeTool.form === "canvas" ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)(import_jsx_runtime32.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("figure", { className: "ofs-figure", children: editorNode }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
          ToolSubmitBar,
          {
            ...submitProps,
            promptPlaceholder,
            maskCoverage: imageTool ? imageTool.coverage : 0,
            metaLabel: activeTool.id === "outpaint" ? t("studio.outpaint.coverage") : void 0,
            metaPercent: activeTool.id === "outpaint" ? imageTool ? imageTool.coverage : 0 : void 0
          }
        )
      ] }) : editorNode,
      activeJob ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-progress", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-progress-label", children: progressText })
      ] }) : null
    ] });
  } else if (showNewDraft) {
    const stopped = Boolean(compute.status && compute.status.stopped);
    const fields = form && form.form || {};
    const frameRatio = ratioOf3(fields.width, fields.height);
    const preset = (compute.presets || []).find((option) => option && option.id === fields.presetId) || null;
    const steady = preset && Number.isFinite(Number(preset.steadySeconds)) ? Number(preset.steadySeconds) : null;
    content = /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("section", { className: "ofs-stage ofs-stage--draft", children: /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-figure ofs-figure--draft", children: [
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-draft-backdrop", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {})
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-frame ofs-frame--draft", style: { "--ofs-frame-r": String(frameRatio) }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("span", { className: "ofs-marks", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {})
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: "ofs-frame-body", children: /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-empty-card ofs-draft-blank", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-empty-title", children: t("studio.stage.newDraftTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-muted", children: draftCard.pending || activeJob ? t("studio.stage.newDraftPending") : stopped ? t("studio.stage.stoppedHint") : t("studio.stage.newDraftHint") }),
          draftCard.draft === true && draftCard.draftFrom ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-draft-source", children: formatText(t("studio.stage.draftFrom"), { prompt: draftCard.draftFrom }) }) : null,
          !draftCard.pending && !activeJob && !draftCard.prompt ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-examples", children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-examples-label", children: t("studio.stage.examples") }),
            INSPIRE_KEYS.map((key) => /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", { type: "button", className: "ofs-example", onClick: () => useInspiration(t(key)), title: t(key), children: t(`${key}.label`) }, key))
          ] }) : null,
          !draftCard.pending && !activeJob && steady !== null ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("p", { className: "ofs-exposure", children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-exposure-rule", "aria-hidden": "true" }),
            t("studio.stage.steady"),
            " ",
            formatSeconds(t, steady),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-exposure-rule", "aria-hidden": "true" })
          ] }) : null,
          activeJob ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-progress is-flow", "aria-hidden": "true", children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-progress-label", children: progressText })
          ] }) : null
        ] }) })
      ] })
    ] }) });
  } else if (!image) {
    const stopped = Boolean(compute.status && compute.status.stopped);
    const jobParams = activeJob && activeJob.params || {};
    const fields = form && form.form || {};
    const frameRatio = ratioOf3(jobParams.width || fields.width, jobParams.height || fields.height);
    const preset = (compute.presets || []).find((option) => option && option.id === fields.presetId) || null;
    const steady = preset && Number.isFinite(Number(preset.steadySeconds)) ? Number(preset.steadySeconds) : null;
    content = /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("section", { className: "ofs-stage", children: /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-figure ofs-figure--empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-frame", style: { "--ofs-frame-r": String(frameRatio) }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("span", { className: "ofs-marks", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {})
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: "ofs-frame-body", children: activeJob ? null : /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-empty-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-empty-title", children: t("studio.stage.empty") }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-muted", children: stopped ? t("studio.stage.stoppedHint") : t("studio.stage.emptyHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-examples", children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-examples-label", children: t("studio.stage.examples") }),
            INSPIRE_KEYS.map((key) => /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", { type: "button", className: "ofs-example", onClick: () => useInspiration(t(key)), title: t(key), children: t(`${key}.label`) }, key))
          ] }),
          steady !== null ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("p", { className: "ofs-exposure", children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-exposure-rule", "aria-hidden": "true" }),
            t("studio.stage.steady"),
            " ",
            formatSeconds(t, steady),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-exposure-rule", "aria-hidden": "true" })
          ] }) : null
        ] }) })
      ] }),
      activeJob ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-progress is-inside", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-progress-label", children: progressText })
      ] }) : null
    ] }) });
  }
  if (!content) {
    const favorite = isFavorite(image.path || image.file);
    const copyTarget = image.absolute || image.path || image.file;
    const printRatio = ratioOf3(image.width, image.height);
    const developing = isFreshItem(item, now);
    content = /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("section", { className: "ofs-stage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("figure", { className: "ofs-figure", children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-print-slot", children: [
          compareOpen && compareUrl ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
            CompareSlider,
            {
              t,
              beforeUrl: compareUrl,
              afterUrl: image.url,
              beforeContent: compareContent,
              beforeLabel: t("studio.compare.before"),
              afterLabel: t("studio.compare.after"),
              ratio: printRatio
            },
            imageKey
          ) : /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
            "button",
            {
              type: "button",
              className: developing ? "ofs-print is-developing" : "ofs-print",
              style: { "--ofs-print-r": String(printRatio) },
              onClick: openZoom,
              title: t("studio.stage.zoom"),
              children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("img", { src: image.url, alt: prompt || image.file || t("studio.image.alt"), className: "ofs-image" })
            },
            imageKey
          ),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-figure-tools", children: [
            compareUrl && setCompareOpen ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
              "button",
              {
                type: "button",
                className: compareOpen ? "ofs-glass-btn is-on" : "ofs-glass-btn",
                onClick: () => setCompareOpen(!compareOpen),
                title: t("studio.compare.toggle"),
                "aria-label": t("studio.compare.toggle"),
                "aria-pressed": compareOpen,
                children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: "images", size: 16 })
              }
            ) : null,
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", { type: "button", className: "ofs-glass-btn", onClick: openZoom, title: t("studio.stage.zoom"), "aria-label": t("studio.stage.zoom"), children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: "expand", size: 16 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", { type: "button", className: "ofs-glass-btn", onClick: () => copyPath(copyTarget), title: t("studio.action.copyPath"), "aria-label": t("studio.action.copyPath"), children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: "copy", size: 16 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
              "button",
              {
                type: "button",
                className: favorite ? "ofs-glass-btn is-on" : "ofs-glass-btn",
                onClick: () => toggleFavorite(image.path || image.file),
                title: favorite ? t("studio.action.favorited") : t("studio.action.favorite"),
                "aria-label": favorite ? t("studio.action.favorited") : t("studio.action.favorite"),
                "aria-pressed": favorite,
                children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: favorite ? "starFilled" : "star", size: 16 })
              }
            )
          ] })
        ] }),
        activeJob ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-progress", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-shimmer", "aria-hidden": "true" }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: "ofs-progress-label", children: progressText })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-foot", children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", { className: "ofs-stage-prompt", title: prompt || void 0, children: prompt }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: "ofs-stage-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("span", { children: [
            image.width || "—",
            " × ",
            image.height || "—"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { "aria-hidden": "true", children: "·" }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { children: formatSeconds(t, image.seconds) }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { "aria-hidden": "true", children: "·" }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("span", { children: [
            t("studio.meta.seed"),
            " ",
            image.seed ?? "—"
          ] })
        ] })
      ] }),
      dock,
      zoom ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)(
        "div",
        {
          className: "ofs-lightbox",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("studio.stage.zoom"),
          ref: lightboxRef,
          onClick: () => setZoom(false),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
              "img",
              {
                src: image.url,
                alt: prompt || image.file || t("studio.image.alt"),
                onClick: (event) => event.stopPropagation()
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
              "button",
              {
                ref: closeRef,
                type: "button",
                className: "ofs-lightbox-close",
                onClick: () => setZoom(false),
                "aria-label": t("studio.stage.close"),
                children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: "close", size: 16 })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)(
              "button",
              {
                type: "button",
                className: "ofs-lightbox-action",
                onClick: (event) => {
                  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
                  actions.openImageTool("inpaint", selected);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Icon, { name: "image", size: 15 }),
                  t("studio.action.reference")
                ]
              }
            )
          ]
        }
      ) : null
    ] });
  }
  const onImported = actions && typeof actions.activateImport === "function" ? actions.activateImport : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
    ImageDropzone,
    {
      t,
      ui,
      editorOpen,
      showChoose,
      triggerRef: dropzoneRef,
      onImported,
      children: content
    }
  );
}

// src/studio/Toast.jsx
var import_react35 = __toESM(require("react"), 1);
var import_jsx_runtime33 = require("react/jsx-runtime");
function noticeSpecOf(t, kind, compute, actions) {
  if (!kind) return null;
  const specs = {
    oom: {
      title: t("studio.guidance.oom.title"),
      action: { label: t("studio.guidance.oom.action"), run: actions && actions.resetToSafe }
    },
    sleep: {
      title: t("studio.guidance.sleep.title"),
      action: { label: t("studio.guidance.sleep.action"), run: compute && compute.startSession }
    },
    closed: {
      title: t("studio.guidance.closed.title"),
      action: { label: t("studio.guidance.sleep.action"), run: compute && compute.startSession }
    },
    generate: {
      title: t("studio.guidance.generic.title"),
      action: { label: t("studio.guidance.generic.action"), run: actions && actions.retryFocusedJob },
      logs: true
    },
    generic: {
      title: t("studio.guidance.other.title"),
      logs: true
    }
  };
  return specs[kind] || specs.generic;
}
function Toast(props) {
  const { toast, guidance, compute, actions, ui } = props;
  const t = typeof props.t === "function" ? props.t : (key) => key;
  const kind = guidance && guidance.kind ? guidance.kind : "";
  const spec = kind ? noticeSpecOf(t, kind, compute, actions) : null;
  if (!toast && !spec) return null;
  const detail = guidance && guidance.detail ? guidance.detail : "";
  const dismiss = guidance && typeof guidance.dismiss === "function" ? guidance.dismiss : null;
  const openLogs = ui && typeof ui.openLogs === "function" ? ui.openLogs : null;
  const actionRun = spec && spec.action && typeof spec.action.run === "function" ? spec.action.run : null;
  return /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: "ofs-toast-stack", "aria-live": "polite", children: [
    spec ? /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: "ofs-toast ofs-toast--notice", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: "ofs-toast-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Icon, { name: "alert", size: 14 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: "ofs-toast-body", children: [
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: "ofs-toast-title", children: spec.title }),
        detail ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: "ofs-toast-detail", title: detail, children: detail }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: "ofs-toast-actions", children: [
          actionRun ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("button", { type: "button", className: "ofs-chip is-on", onClick: actionRun, children: spec.action.label }) : null,
          spec.logs && openLogs ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("button", { type: "button", className: "ofs-chip", onClick: (event) => openLogs(event.currentTarget), children: t("studio.guidance.viewLogs") }) : null,
          dismiss ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("button", { type: "button", className: "ofs-chip", onClick: dismiss, children: t("studio.guidance.close") }) : null
        ] })
      ] })
    ] }) : null,
    toast ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: "ofs-toast", role: "status", children: toast.text }, toast.id) : null
  ] });
}

// src/studio/TopBar.jsx
var import_react38 = __toESM(require("react"), 1);

// src/studio/ModelCardPicker.jsx
var import_react36 = __toESM(require("react"), 1);

// src/studio/posters/animagine-xl-3.1.webp
var animagine_xl_3_1_default = "data:image/webp;base64,UklGRj4MAABXRUJQVlA4IDIMAABQLgCdASpwAHAAPo02kUglIyGhN3qrsKARiWIAzfSNxBe78md9X0YberzAeax6P/Oq6l70AOlw/wVqk6S+Dvjb+W5++XO0X7Po02SPx/1AsQuyL2j/Z+gX368CHVH8S9HX/F8SX796g/6Y9IrROqJn+d/fwl10dH5rN1Mwf6wcOvBCsj4oRO5xLIjXy0h7VGvOWDAMoFJoOB9tpwjnETvss2lM5HBTdm3sUM+iwYYRIM9UTmjhjcvT11mabLsn5cHP3MdHst1brWsgno5VaFn6E9JE2OxFhK/DV2WFSh7zHO5sl9x4X/WrK8T7/cTS7OGzUqHX2I2sTRTcElTCQ0u347Xz4F0j021izy4cBOvGoEiCdR+FavR2N8O8NamscwcSQ3oVdGpenpLMQLAffvPn3CHdfr6X9dOj1NExZbWO3tN0WCfEU9BubTQVjIq/DrKIx3rE4c2o7JdrKEfxeny5ca0eO1rKe9cOzWwLbNflGYICnep3foalz3gAAP7000ZnhZ4vmuuMkTKDJHFBdi/mmEDLo1llzm/qISqNVdyayyKOhpVGu62ysf21Dp/vn03XbwRv2tDxXJLm+D+ytSObZdL69zaWrC8Kdy2Qrid3p2wPImDzOHosc6Suo3YILzADT3ehxFnBGwhZ/Wm6gxlS5vIA2sMpv7MtircKiIpqwfeBcaBx5dQsWJ4brr8S6kKqnzP+9svtYgYnuQG148turJrS7IVLYNznA95z/drhdF5R9Dr/uXQiIdCegcOHDm2Fojs7fgGTlEoXh/xx/YayHnJwBp7jMrQ2W9pPq6hREBGLiIvKT1omBjtXeUJXXoFHiRp5JA4MtMxSlpP5o/mDyR5M2v6uG9CSUgsTxP58hf3P97Pt/MuqP9eo6YJoDJw7ArV4lTcOU+DC+mJ3ZQDYtd5anzX7WreLSrVwKBW1U75Q/3fnEhmkfAufqg4i+C+81AJGr+1BFyk0JiACJgCqs89/PTU+D9PKaZCc1erGbfmofGwX+GSoYn1t+jz9F68KDm7Gz+2qO+6oYRl/q5MXO+fNG5VPGAPMHt50MN4twH+i/6BQYTiniz7GMoAyiJUrHr4KErCP21zKly9jV2rGTJB6T+oRvwmA7zpVE1Sd5OYFq0hJOprb36xkuy0vAgG2oy+Mz0rH/Ht8I4shOM8mBxUhtc3XaEQpL7EHIp7+EVjqVeg97yNEttvDFtaDH1FnYcfabx7+vIB6ACLb99WlRt0kiINwsttJTsJuD/E45gKIDBbtlEUl5uket/eWlh0CtzV6pn5+3p+ZuTtc/DVZ2wcevUPpqqv3eCcK0LVNiC3JJpb5cpLBpunMfSGzZ2Ye4zXDd0I2ogyasH3H6CAX9cqzi8tK3SAWGzoXQWBCPzQ17c9QUUavVe5jMrulmV27fD2GqD9etsFHasHhv4j7tIkUpT1EbPhPhLN8MCAxrA0HXgQGKZIX6UK1YvcWywz+3BFek2Is/Y2MuO57eTTMk0J8WGYmyd4pUfP+xcixXZyuXLUOLdwJqGt1P69pg3/jKRT5NSOAqnZfO/12OZdRXhgvD+gfVIKRwdApojBMq8TdpUSqIooHuqCgDaqyn2B8rp2nG+Kmc639uGKuXCa6vTUHvuOqvCw/U5qQJqbtSAOLjdYWuMSxU5RK7B4RlBGvp3pO8fHgHqDrMGywz5nTQZRbDnuycWdpZTBvpDgz9RbiN3mfKalqbKNoUr1liODuGks4Jvwqr49vS812pP893dLZkFtis6kFA2dAwgQZDRl/DXfXMs+0PEk3E2U7ZHVTK53zsfK+aZNd0zhrqjnAUjdsMdfGq+eH7gLwbnxcydzF9Uh3oKKus1IB69tK1nJ3QmV1hZPsxFe1jaMdKP9KGGOXlXCWMx666oviGICin6sMj9KQYjPtbR1+BzULQeM79UNnn0ySuZ8yYl1n8Yvl1VR2JFxTfbAHOn3WJm5BtWdlkBVgF1xxHDfdqS2tQzhZrlnrtha242RHRVjpweOFjggi7yYDk5t5JoKqGL4opofQISwwEriwuo+bpjq12t6N2WzNna9oQI3lxbuW+Cix5k1fb6MeFST/9RFC9WeJI0S7nRLpjEMB83yFLKc13UNwj3h0cT+cQotgP7+VhGIuxRBZIlVwGwKlFWt0F1nGepdpIQ7KzVPcmfz4IShcUr70bRcOpBRnApDnv/vBqrg1/va1JXdAIlRX2LJuOT25nDD+XjKlWK+xRZxlPg45zfGTrrpLNVaSWjZCSITn/IluVsekszCZj542nNCEN7O8WB+2rH1Hgu7a8kEGrw6/UBgedAIq07DoJvMrMS5E7//4dOMD5V1y2ppH4x6lEZn+YtcHeELvivgDQqJW5JMp2/3O+3J9pgHzG5YJuqbtCZrgmy++FGNwlwLJlzazHL+1tlTTC4/zCZBkKd8hwgzIqjJfsmNilE2A1BmlNceFDm4Q8qzAm/sO86Fw1Xzs1EuVe+fk5T9KymZ9uI954QfJRxW00xxaMHt+dfw4lBThUooj8p7RdQV8bd0pFLxRG0iQ2GgxlRyuaT5iBAr/XCTMO8HAXGf7nJSyL2rLvjbP1M/QXTYTuP//ZD5S1xSUmEJXzU/1PKhc9iqW3NrQwe5lfTCMBLYlXWv0q8/hBNWtmqK01288hpmRwunEijcmd7qAaNKJb6wwv4exBn+b2/ttkbNFW8UIie65jfSJO2OVZZSBXr3sTw62arC+cpPcODCaIe7m6j3GyqCY2RxA2EmuX7bwCkQvEwAnH5mZ6wr1a5WpuQcwoBnEA43KyPpb/4zTmheI+pxo7B3jJCTjt/iMuzzd9s8kVH5AwwLENivQ27yaOxjLDH51y9v0b+IHp8MHIroYCm61DDyDghfA0d62pc16e1KsSQ1tTvMW97yG+7pDzsG5OqX0PgPJTTDr9kit13rBnjeZUeOFC4DCWrbbtQuJgcgDUfgCTuRDqXYmCOQmvLqJDz2VSlj6yG1Bjd63VQGiZY3y/6bns7/mdOa90d/Z5QmgolBHzfLEKyvRcrEG/M5wYwCz4PT7LGKafWQcIfX8uNyCeUm0k1/cQxx2NcRMIKy8ATg3Ds6njAs46wN2SmyXiQBZQYlgaes/7AvRSBDOI40W9G1ZiRTScsbWpE4QItRXM7q5LZmnWIqfCzuVF8au4QnXojHH32LxVGFHbG4DDVaGi0LZSCHppSUk2yPVObuwl01uDNpsgcBvNbOtIs2aoLYr+Kkzysu7jbqXbsiPEUr/7MH+gFvopyfOizqem1Un8VKK39KMmxBg1j4vu5p5Byp/WQkpXrM7h3bZdk9BHP52gmSEhuxhtz+EsNHrJfq3qQ+vO0N9CunS0rrIN/AhjcU81ZjNUoxLc0XT8WicXO1Ix+b1vKXj2INDPO8knrBWZwRTtYKec+edlz3wUbUB+95loU0jdgg/cwJT4FfxRA9QbTQlK/Wj+ic5XJnVa85Z8Xub50zj4Wx9U7cUow7yf6AAuMUh7MO4WRnu2xh2AnEIt5lQawkZga/cIMUk5/wkvBzBmwCfw2X1ZQC7vvNcjhSz2VXEeX3uYXfhtB7dGGo/QXgvDfoSlqHnMOd9aRJaV83cpFgLrCO6QW/IpZrsLho2swkrvun3wxdK89rzd4kwGw7OPsL6QJHaHGPRLJsbCpCmGZG7nJLdhWa9Fly74GkqkU+I4XVIV5T60KiS/9cgUL68UXz00zPz0CRUNWnBrDLcHFYReUZ4w7BGlilnkCfM3WgktXOBZTtqRuvlEs39yIPU/zjNKnA1kQDC+NQyZw4a3R5Gr5Vpb5b9wst1VwedQzu5D2loS42J3ge9bXlekU0u3UG8csq/j8sE0aVH9HhvIvVu1tYJyR3apqTPj2JglKaHzzNRdIUfD3TvI7ChQRzx46l0Cscw2BCqEhDm4PXQyUtu54tfYn9Eos6WvlJvCg2iCSWwjVnRACkS/MIBFvLuGg/qViFYpnASj7psF7t08Ph4hjQQkKROwn/VA3JyAlrI+fTAqlpTy/Ri567w9do/HYMoIH4WEoS2N2Ba6FaSByZhGAFqstIYvj9hI+v8aaSQ5AJz9pyxfgonu6S+RJ2/ut6Lcl1b+TkyP9fPKQf57kFQcvkg8ssQRBMWd+g2wVTa0gSC/jP8v8GFqH87d8AapdP5UgA/EAAAAA==";

// src/studio/posters/anima-light-lavender.webp
var anima_light_lavender_default = "data:image/webp;base64,UklGRmYGAABXRUJQVlA4IFoGAACQHgCdASpwAHAAPp1InEmlpKKiLbPZcLATiWgA0fXe3V5D/pfOGrX+Q3R48dur/K+pvbWeYnzVPRfvK/oAdK35QGC2NVNYJcd4u5BQPHUKz1vm1BVjaRVCp5OQ6RDVNvesc/NuRhQSvCXvzep77p1QSYe1Y7osxsJpqqM+xGnHF8z7KS6hwHrjKnLbnWNRPHojVuwADTQKayWzWgMMOzFQ7nI+fnnTlCgSEHO1sYeAPxF8CB4zCxTfRFyK1vxsJdeTWdJq5tGUmqGz4qdEoH8Hoj722Ny5PD09vacpeZSnQuCzq3iw0ewiH8w9o9VDwlqLC2jPRbrfFkiDtLRwAP7mQXX3Rer+7skv9p1QkrdNtOYHfLB14D/G3JrZhvkFXaqQxyVOKQCb0oXYoXQmST23dWqrO75DxQPPwIQvbcNum41xHFnlCWYk7cnczn34Zc//0I1+grChREG1eiv5EBeZ8hXFaETzZIMOOFTPb6G1xmv1rsR0KomXh+0wWv0gtePiGINkqQ5P9MHb48XIj2HDlO9W0FjCYEsf16fZDxydTbtBQbqGGEiJOCkhq6xujzU+SXR84yOsUQabWI2XKW9qbBRNvtYbv5ihdq3Q35wtnJRgmgUFjq8uncIBVRoAWfeF7+QClYpbKdFO+oBPIdb+1H05l2dZi1VOQLMW+wodj5G+MgO+O28TVJMfqTTfghG9Iy3QSWs16nxgD0XmMe0vOA+eMZRsk1goxnNwxkdIJzDgPB45SY6E9thvnTxUheHcWcJnKEbaWH8E87v/QkfALH9qfTvadCNfDcKuxIaZbKu79bOaB8Gns/z/kseTkz1Uf53wBv0UlMJEdZYlJEA/vC1joRnLL6iCOAIsqeD/TAwE14MvZXUlxIRqb+th0tL8eyfK/Vu5g2shkLIrxFRV2n2hbZkIlUpxrZqT+W0eZ309m2Raf7DidD9UbMkEvra6etyP3P6VP8X2w1wDc12orGrcMfAnPfw6lyiFCY8aiQFI87p9hlaDBlerGZYshmq17ZTPGnC0Gk0nvEOA8U7SRhpAyA/EXOyVBNT66DHvPTA5CgI0nwnCWJAvrne2O+X9el/HJmmNBsLgx6bIUWoITaiVNYYV1OrOG1SdWmpBAZ3pdcp1/2aQblzcJtfnERumLjrvac2Y+vUwQjcrjJQ7BtYGK9yUc9aMfErpGsuho444VVVMVfht20SgjndOBu+HpWjKs9A3tWXSvS27G8mvx8kqcgZ1nGq5Krvo9nmQsfSbwAKPMXzOhTU0Z3OPkMCA8JNYNrnvwAlOaoHrutYYXSrE+2FSGzCNO+KcfUDt/jWO0dtv/ALsF9Bkkii35URi6gddxdEvnPpqNGn5+AEGRH3XBh6cc4VDXayi4PRPQ59gTIpEj/vLpcDNjoWkt7YXFJ1b77R9y06TUc5dT2+hWneaWCrX60hM8Lsb1Is0WsWHyHvBX4DXpPFjQ776f3lqzi0HTZrv3Yvr0CYjNxr2A9JBX/ysKJtSKbcFPDwdpClyeYb43QNSjq1ljLPibQ1TPRorQrU2bpDHyu1dAfsRaK8niUTnlodk4SKrND0dk3mR0S9TQF9p6rS20PWF2WA8Np9I/iUc5uybkqJkkJBvnVEmJTp6b+aQl8tPeDolSnHoqXzEFkv7S9vl3evsfR2sN7XerxHC8oe7/dhRYFUO1+GPcHEYZO8CV5FGqPDZp/+POLKNiqm4NXeUCNtQl2CoXUWdzg6GYdbyfZ+YjZLlFBNCH+fpnSBub9DHgGqTuWfve6Yue9M11i6PcbkjpUgnHOOmIhBrlLmS/VIf3Za3xa+oCFhXfeG5yE/4mpX8A9NE2qWVMwTqajqKjZr0FjqK5hm3LbWX3k9DUNi3RCGNUIk+A613bvcmVBO+FntS29bJYAB8v00dwD80vZiYr8MfSbOvU61xCbOfFdwmW0z0H0T6991PPBhiybZ0ZTUe/1UEjmELjVAXH2C5BctuBgAMWHaY2KriuTojGU+ZhQqkfV9NuKPkVngpxD/oqp6i2rO1xtOpjfwXi8fX6r2N7l5ryFrEWou0J+ZRiYJAs5tNNgADCQ+svoIlS6bUj70tnLZSUa1fpm2AMqDwSk7eohJcSvMTvaFa4Rmo83aQp+BFGZ8uG5W1z2LX02Lb8P80UBY/t+zMGRyAAAA=";

// src/studio/posters/sdxl-base.webp
var sdxl_base_default = "data:image/webp;base64,UklGRjYCAABXRUJQVlA4ICoCAAAQDgCdASpwAHAAPp1OoE2lpKMjIVgJCLATiWkACBXoEutzqABn2iUx441IYtxbz0/dX4Vuxagz8yH9kvjeVKJvsID6wFffALweauXIS7cUnKWdpf4c1bXZUZNkSrlGUmmmeiF7UwQFz50NeQlLy+qq75d7pxjXP/FgAP73Ri6zhrthPGI1ww1OGvPSpm08JD8Dai240bCYkA9Ze5nKRe9NsEZKhGaOcRraKJsEITRiuHOiEqOeXPLzOuS9DRkHtdrIF4Eskc54U5+Nt+Hh0MAbN4b/X3mFzcgCpvOWe6XB0KG5ht/+6LH7WC8E7ZoYax27zY8GR2nW5Ac8tihLIw0zyFZLYHc6HkSDpFdpA2Jsi0y/E/KL/aHwPNabHpUjOkdpnh2lJWYkEQoA6k8AsPLgncWWBL3WSUxSgb6ViGNS/88cD4u0dnIQNHEVw1nYWS81l9OZopUKRhRAHQve/bWyS0+dMzRXJIFDnWssvc+HkiBdlRukurwr1mXQqazyYQ+uJK4OayuLV0pngR25JHbKdOxnpiA8fl5pcseImjUUEvst0WF41OxIs9lp2To0naQ/Xh/LOtAYZXkFA0crZx1XUcBJ6q9HZ4Lz7V5jxap9qggJpSy+LJiI3tW1vj/1L1T1MQBG+JtqM3j2pK/md7TqiEMSPYPPf/ugbNcGHHL6ThEe9m2CY0/M59U+4pu0OBri9ddBwcvcLCRqgUnLdCkYCndLAYR9gaGAAA==";

// src/studio/posters/flux2-klein-4b.webp
var flux2_klein_4b_default = "data:image/webp;base64,UklGRkIKAABXRUJQVlA4IDYKAACwKwCdASpwAHAAPo04l0glI6IhNZi9eKARiWYAvNdtUQSY+be5iQNYE+c5afyffL9EH9w6Pnpo8ynnaed3vrG9Nf4S1XeOH5/wfr3olNhJlT8ytQL2D5kEMzxvhppmGkjMHPappLupI9NKdg70/gza47NV3oW3BGd+jQl38/5WsKHwNMeVhRCYfiIPqUaS5e73UCBn3nKSpfQnQeV8mz+xNyG0c+Sjn5+MahWwmVJNQ5EYU00Klj5A+pP5Ywf092HfYYOS8zBGqq0HpRY0rBIdTbj+vvnWN1KscLJUwwAwmgBTnRI8fZ3FactENczzbBdvL619xtF5InggQybwWEfaz/hu9+YyPb6qLS6X/aZH5Maq1voU8nDPQB+2iTNbaCrDWKPIdB5XL9ytsN+d/EgHh61eTNmMhV7vzCD2Y8QzESJH7wBiTy6BEg3Dyo59BXU1MZlEYEMr2icbzZv0CQQatORogCfAAP79Bj1exkORfc4+XCRGDBTYsj8xh4yFxRHPJflLi4KhLbwGtQhaf/w6n2N/nqVD3ebXet6sumHsSuo3O86AgdUDQMAD+Z8aaQx3c+v0aHmMXiQz8MxH2R0KQGrhh8PHGObDRplbPc1UoRU90O83cf9vGRKwSVmWZi5xter4nDiCUsgThU+RRobqQ2eVt6Q02aEv+1ZugPopUqip5vT7R02eZk+qOQKfiV/UEkn+3EEXUzvNBp9GFPpoKoJAuKEsoWJeNDG6oNiOJELY4FWzT6or/QmVrjdB1kzd2xmlIfyyryvsYCbxgg7viONsEjKQ+yM7qbUVo7paLrR4wW/5kIyXCQS5Xk4Mjh8K3BEdkuz2bpXlQ6ACqjFKk+EuS5rXPOVc2TdcMCKSg0F3Bh8be3/YXhtkxi6sdJ2x5ylaTJLFhmiq7bnLpAS0pEdONJITVTRF9qGVJoJUMJ49oN9Su7CvKFaxHmH2PMPc8zoIJbMJpe4eTfMoxEzbnam1B6d7ngFpAmzI5Abl+wCdILTShlMLrT2mwr6J5cy+tHA4bZqJE8RpsH2iW3n948ULK/nn5f0kvMDJPWvVgUljxsgsAlzdbtqeQfyHipyKMyPI1Grv00qn7h7pZx0UkFigNua/+9X/UYDUGD97myr156TyTdUCgGsiaXioA/AycSea038j6yD1qpMlN4lFDbPCHvYzmQu7lPPj6n9dhyHfjoUsSKUYiXgD2MXLSSJ7GBqE2BDtp5+NGvos4WMYZT9Dgx0Z91YaJ04DlJk6bMOF73wnucoEhUmdPRdCDNjzEoc4fUE+e9Som3YHItKV+Hh3sZJMubN2Hy0Z8dUVwNnkce6pnILPPpqSFrtKb/WFXPTxqEZ8cTMOVBigaPhuLY582tDE5ZRuSfGzzQnodyQ8g9l3QL/ElWd46lkw3kplQGhcqXW7yy7lYjOcdTWhq4ba2ijRY21iIy4UOsdIF8YUJXaNn8c/A9nJUTM4bjz++MF2/e80ypZe4k2nDcUu5aSpI6sMEtFYg9VtCsWp2922XTyW2utDHBEw/rhOhEfCKN2t5BJrfC5hJQbRBKyPy31eawlvw9aKaWtjqLxLnAhfhYM6P6Vx7BB93Kck9Slwl7gWrC3BLXy3cf5QjXop+VLPRK9gGrGpk0bLCqfGliPRnpY97fYEc3eZF8r451Ua3S5uWmIRIQZpOocT/gw+uBTGLzwe+kufXibuYtrWrHPS7j3Py3971MavXt1YVRVIqw3W+Vxez3RwC9yBF0V0UlJQHO1VrO+1xIH0qZCrMgL5jwZ8I+V9YULyjdlkcTQoY+hLsz2ZNjjDn5i8zZlVxqulZlf0KUWGIk0Oqs1H+Knz+9PtuMVEbnKCus9ITP3bBC296BAlix7o7ji3loPr6XUKUN71PddH4Ka1vb7h4rf1U0ato0x28CVqe7ts6058YTVNWkRcXrMd+zFuQnaCnxKHCks9+CMSi+UF+McFPB4ZmIQxbP/zcEKP/MN0qzP6YJc5YKDjTHBG7hjieLz50Tb1jlyjrqPgXlNxcUesmRzce9sFP5UaaPrQ5tXX03ysJDSC0tX73+1ueiZzk37NwM68aYHbmmNl7pZZyRAAPAsrpCOzTrsS9EBRpmZ2YzFHhEbuclMLqACQnLGVZx8ckIIa6ue/NIlJ83HwtZNumFyh56tVBaMk2HtYPLKBP7wV8goK749mHmH5VvNugCuJeXy/xGoPBwn8XdxtTfrtdLTDjWAe18sRJAdCH/4M3rnSmxB9RnrZjnX5I2BHIXo8eOsUdWrJw/UfrtlW3evZg1uKMtQR70e7Q4MrlEJG+4vPUAfr66yqNtM4VPnqtHpBObOnYX4mniw8ys35pdzSGQ/ZbJHV1GV2ghV23pQ32RwlvepEYwRYGA64Hfnsauhk1Le2HathQST0BnK3gD2hC+61lzjPCN8evHt1sr6ZbsEMORTeMt8cadrY/xL4WnJfGEQSo9oLSlju+YHgkUyNytynqPCLHvgVPbostFmGN/7gTjj5DOaJ+nj9cJWZV6dHlryyFjoW2UN0UfcIFSKYe2hyO64QX6cn/ETXoKTMAXXWqG1NAOlM8TyCucsG3FaSr4eOohmo+XGiISKq9v9CTBG+k81jNhxkmrnyLtNGmH1XBXJ6gDwCj0SR5Kcq5EIvGCeYs4NrcTE7fjq2MEXbbP14FWlUX/5Qk4Wmm5ftwCYhLtr922+q77hkjoek5NNf0wCp/OtiaUsvHtvYBAdt1NTzdMI3Wg+3aRZd1ZJi4H9GqXBYT6L/hcFaFR+PSQwlhq9tNECtzOes73S+IBp0/SMCK/Kz+Z5h8QpEvJgCl6bGAEaYDmvY0jhoItGZypl0RLoyqJw98rRgzcvMjvXuWBZXhcDr3z2zj8cmvxdx/b4CHn88eOdDPDUNohpgXvAjVHYQRS33vTWDZhOMyF4zE+TBi+CIRrXbLWPLB7M3Kyg8Z3v6rsjEkYvbHijOVu5tE8e1byiFp959stfECTkCxM20ckvhm1buBgnvL1v/n3rc4eg0AQ24cRUgw0X86H6RkWVST3tA8X9Jl2wvfbzbjvEyDnqf8RUBn+ugl5cNKvGi8YAwE2qUBWKjJwGNECcldhfyTZCwqg8coWzYaST5lYQnYdbZ0LiGxlgd9TnINQDn0XtkK9ntnjz6bGYKRSNzcRYjf/qEhDkOxhEOWmhO3MlAxdD9NJ1w2pVr1e5DQc5B7T1KwGJYouRGZJivLPZAQmXNVw/arorNoUtdWpGi36x8ismUcQz35ONk5OLlUbBvq6tT3vRwqBDQ/smrnNrIpc4qqRSZTb0iEy5GNtPdL5EtKkq2BYjxeh5kd860n8Ivxn4GnDuu893C4OhFHTs22HFNb/LIdPsnRjhMTxvs8omEGZvz3xtMnputrqBLuPWC6usp0UnvbWDoTpnEWcBFDxm7TULGFtigHSgSQqykdr+b30XDyyHqvPKhvKBslwwMxXIOgW9GGs87A4ujuYQwX7myAAAA";

// src/studio/posters/hyper-sdxl-8step.webp
var hyper_sdxl_8step_default = "data:image/webp;base64,UklGRtoEAABXRUJQVlA4IM4EAABQHQCdASpwAHAAPo0+l0glI6KhMlts8KARiWRtM51f+3K//cAWPwh5X7MiuE8rPmPwyl/3OH12Zv+n33P9b6gOa36YvNJ+yvr9bv/vWX/l9rP/MWtP3yYf/3u9Hc4c5Mb+w2841PJ3WVDTv1nLUqc33C+PChouRqe8AXTyeA8zPY37/yXrDCBi8k9xBVA581RkyD0Ddz8wN9yZBNmzX/L4yUin0HsT4wAKf8wUNChShvBifjcY+OBnfjJAKsRtmMqzCRMQLRTaRcZwx7rNZEh/YqrsDRbfCGFlMXbTSxrFbc0ctF3YpLHhSCw9GruxNqoFV4QA/voRgB6vWKH40jB2hZ6BKZhz+Zc602IBR/rIA+IHMXfKYnapkvGb/tDUmwwicx921Kn5LxdvgOBRYbKE7j8Ms9NkcUhl2pL+lHoyTdCebUryXJg24S1sxb+Mg7zdu+vIGi3SZl539T9E3T2wuLDwUfcrysuR3BJtdN0LOHMQO23o7CXw8db2GSXnoM2vAykp24AEOPZFowhvvz1JqZ3GdtDhQ1zzb/XZ4HWlQmGNRBlj11/RktBTDR60gQH9YqUrgz0lP+BCCjiHj0+mAHp5jAj/oCRAglZtezi6YkwrU5Q06ldDWv90VtQfx/IO0bIOQbKedP8N90+587Dy9wNFfDHYjng/gafCr4G81YenCd8lei8oIXP4bNu4CurTABRis7wVGypAPw44sJWq/Qb5xkKg0FuWB4b4Bv8qGPoMWWnS57LUYWzlsb8v8ZKEgKwtsyI9m0oXDE0w5GNcTyI0ZiR0vUxOz8SeHFHat8mlhH1t8EJUeke566PX5PoiIkG6QBgbW7WJsMs2m8fBS8yWNwf2WqxgYe1dkXqKzIvDPriAj1mgRI8FmTaPfInT4yeJdMczMoMCoK7EujNxGwkV9wc7Xseo2s68NDtRb0RN45P7geqosq0QAF8zChnmr6eARfV5nqGFND6vpeSuG4k90TJNHMAl+/BYg2ac2/I0OOLKvTQktSii46IzC3l3hXQIc5s4QHDgqPMIb1ONz3QhuzSRCKTnuDMx2GGKKiQry+HZVQYMT6RZ6TeL+fPAYK8qvz+83D3vTIHWURE2kywn+FGi05scSClr5dUAhugaZ+/CDxJVCyclmcxAKqgDP5IUxCm1wUSta0X7njNAjpCulO+gMS2pzdbSObf80AcLPKew2hzAaHiZ9yoqm0HI4ceUhoYIn5dpR7KkKlSOsfwBUsgn9FvsDBNy4LEgycjO4O3t6BSxqCYtcnUfXPlBndSFZsO8sflnhSLk3bJijdVXcFJraGB4bw6wbJ6uO8YBGN98Dfnj1aAXNR/wAe4G+dTY/qibkr2qbHAEh8qCZJBwml8xUPR1TBt5zO4OJf6hZvBgpVFY4rHEFjLWTtEHyuY4BrdoY0a7GmABgQCrTGL705PXYvYM/gZ9HSfKM7H0T9TFISwNtTAqgojRQRGNY7PQmeJEERIXOhQicX9heiGw15mrG1Pxz69PXbWQ2qiC2KuWPZoMSLYDeKPYYh/unM7a3kVOWpN7nkI5Y9rZrUOPCRjoNWYRPPeu4HUBa43p3Pa8cjrdQ+k+4I0T98khXtTTmThknLVTAB2Z1RtXWEhiD+Z9/BrQeRHMQAA=";

// src/studio/posters/sdxl-lightning.webp
var sdxl_lightning_default = "data:image/webp;base64,UklGRnoDAABXRUJQVlA4IG4DAABQGACdASpwAHAAPp1Emkmlo6IhK9Y8YLATiU2nKseheXk396Kgs47HMU2+oE5bU14uTuF4DkjCaIXeEn34Rjvj7l9SHHN2tWvhlptKwabdaT54mP6Ni8riEnf1khs4prYeAtZIp9N0WQqoWxWZiBrGgY1Vt550z5N5uPx9Z6GR8CGIls49q+22oi1MrckwCRftJ7+JJNIOEnQEyDNkbkYJ+y8fzW/OHZpmhhAPl1pwHpnBW4vElajwjVroPdjpMiSD1BEA0VYJpt0WwAD+9QP0uBmJ/YDBA/7ldnKCOe2b3wel0HI9AeZBjqlMhjSCEjPObwzonlrQTXgY3tbbGkkquTv1Cadb2ewbxUxNnNdXVmHHVQWJKCCROcwv6a4eHkMTWKvS6RSOmqnE5tGzH2SNXLA/Perq6BwfrtA7Ujv3pfNjK27v41aMzQCx1k2xygizpQnyEz7IuO+g3IIZSca4qPxJwjsw34zzuzLQoHanlwzbVBFAfsU+5Hj1zyJdTO+z/kdjs5mVwdzeMNCI5jZAc46nd5tpkS7KZrJ9pNXN5tZ8UOD3gskfidGHRaWAPqhvjji8uImbPPFgM/ro9xFe4JhRwATogB0Sf0hnpPIvL+L8YDenNtVTZ/Pp7kq4Ul7e6BGVGK+wd1rTzyxul9Co4qwipONvP1dEK3qoRpryVYaVOdbuZwMilV0iUPWeL3vAEFLmlridM9SwFtViC3EozVLskFvBZjXF/VDBc8On+Mym0yHdZtCV95ItYKfQYT/UTeX6NVlr2jO9Ztmr2427quobmxwvthJs43itRujHBCj9MC5TuaAHI9iAWRn1gq9bahe/J48TXw6nhb1R6nSFkyYVG8iPRgwW+3c8cMyzS5t7HpuuptuKx8o1V7vZm6XGv1l3k9CmbN1hEUcfGeNjCCvNkkARiB5Qk0iYFboV/3gobsBJRJBMxecTJJm09a4oUJgWJpviTaMWv2DFM/VVceJSHB05TnDo5pVC1KJo9dELUGe8E/BWRMv5QfcUfLh/P+QSXuiXv//9mLanBCCAZq9m3EIx1kaMlOfUrtpaf0O9PrKbrPELjEDUWUVJ2Ix8BfIbP4kAQ7KdG7D7zXNxrLZZchTzVy6hWspI84ZGAHt/D3ERSSCSpmi2Luh9Lp61m40Png3EK+2Q/qwAAA==";

// src/studio/posters/playground-v2.5.webp
var playground_v2_5_default = "data:image/webp;base64,UklGRnwCAABXRUJQVlA4IHACAABwEwCdASpwAHAAPp1EnkqsI6Kpq9VZCYATiWUAv+SBit14+IQ8Ui2hGCa3xdjSKlw/lKiDeUpn5qTe4/Ph9tqN/z323CsS6W12L3E3mT+Vv9cL9iR4RR+2e7npAoQReM33GliGIFBgld7YYlTDxcRxjAsDkt9toeJ71XN04VJ99c9iU93NQ1SKEQL6fytFQ5xlF3KThUi9bu8/eAEmtkEgxKmSAAD+7/fxYfz91Y96Wf3UoycUq4qzF4EQxFJRXMUUvOqkCX5pyYlYrysyQfB833Vyc/FaMFE3WNaZ5NyEqUO2Y4OnzvvTVZKN2uF2xFzVfEJ9UxKDmrTZKEHgoFVjbGq3uzZC3iGpYkJzxaX+6BQDz7xwr3pP1nJb0+16fnQBouaf0krGrdAQHwYrUEAanKTAnWfVA8A50G9zqBTfXYKIbuwGZO4Txam+1xbey4i+8oxHIrTUCrS5aIGeZ6oqfZv6Ostm84meHpSpbbED4JbEsHDr2MREtomMa3brVEoQr9zrub4SiAkE1fuV7YcUPUJ7FSlAZNLc5CHOzhcWwE6k2EV//+15h67jVBP977KEjo+ozn3va3fOyNi3TnzG2p0SKL1QXMt5+kUtuhVXG0I4f5SkMz18JaAO136Aw/z9aG4tJCRfWRU11l7MD+DH/jJzTYzEI/HxxlDR6W1cmQAi7IdprQ85vwmfke2IxBlMetpiwsTTZ4CMGvwZHNfOqvonUXrEPEcnGC/T/7bywJcwiMYgwoZYcm4+IJtyHd9vupopM1x0l+SOx9s6hh0tT2ca5cd/rFeJ8DD/0egRJWLxg1khDyABTetuBwUvgAA=";

// src/studio/posters/realvis-v5.webp
var realvis_v5_default = "data:image/webp;base64,UklGRmQFAABXRUJQVlA4IFgFAAAQJACdASpwAHAAPpU6mEgloyKhMPdt4LASiWUAvJv1ykRvdPdlcn0O0SJ/Kl7KmIv8ERmL/syd2anWe94AD+tpamwrx3lyQVnf6D69i/QqZuU10Rje0n386KaEtUXovFJpju78N8FKBcF7/zeuEcZloEqXbcrsgjA5bcswBa9rR1BM33C3VH1gGnyerH8rstEyixvxB+At2WqyHqH7cXtBA1T8Do6eNBTVSdsqBVCTfHz1LJq2wsqsx3z08gvn9+UDdF+mniMJ6uZFXH1ylKeU1IFmmu3QYIv4fCO6FzI2iuH8O3cmsbooB/zvToqcGTf8M4bH46H/aChC+BZvRc/Xf+IY47Lf0cK1ZQ/GjeOfI3oP/qurk/QCtLE0L1Qt+Uw9NMyvTBBcqgAA/v2whtmK7b4yj26tPQP1L8tnmtaIUGxNFHVsay8LEj6hFWQzCfT/CwPOH+EFAoUL5hhiRYwENmwQTkvAWhE7eUVuDH/fMMjqUikT9tAIPUK530dHLtnUUJ0/uOu4dWNz92dr22yAUrv11gaB62r/1Tq4Z2yQNfVwJGheSSevQB8B140MiYf+h+z+wyqptRew2c/Xuj3PCNH5ZchcMWsloHyR0JsIrVgiGUVonfK9945yP83CEvaIZHi19wE5W+NFwJJ7AMdkkGTDa9dIIP+7BsOuIKrrbwXoFxbDUD602TVDrycOBtMAHQUcPsZMDye3mIGvHI8ZguQ3o2ghzNegRlysWVGCEP7LlxK+Vcamc9NFQkm1JRR1s/q49ougr8EHVBeW1rTvxpHRFKRw1eWA+d4DKmXt0uUIhzssLCrxlnX15OKy3RW0ZGuLKwafACJws7in8tImjYkyVpDFBjqA32iuvkno47dtcJhA7JQZgECIAYlszIA4weERhh88zRK1EQdhAYGKIcjCRb7Bn0QAhTnnJPcK2rlTF5UEf+0LpAOQkuB/g1TRqA6AXqgzmIugUsaZPavWj4wTBFxjuX4zr0ZM60Dly1fy/cROpElucrww/5Bm6pzjPLvhphK98/ONcT6mR64QYNZ6BtS21A67ANr0BYkZSNGS5AIOxgbarC57Q54JfAgSosvgPvjrzcVDzBChub+zM8tLbkH5zjqFawGIvT7gO0Aosjs3XtSfTrumRYje5C3DnVxMgIFdAfYEhwhjCaWw0vPDIwbeehJtefEiNdfqnIMn8a5GOtcGcF7gIf6XG9xQfVXxUpsoOrV4+tIVsTknmLDVP9gSJ4OIwh81xZUiJVOrFT3VUhdAIVML7lNrrPwiJtfhk4xEth1j5vE8EQhXA1EjF75H+6T4Cr2TH4zZqBVL1Xdx8qFl1BjKzcy3EHDlBzJa4/peQF2cB53faoZICr2DTTfWZbHJu3VsuUNWLgHM6gf0Bv4wPprfSkE7IrhD4uxJPqt3JMAndb1iF4YDk2gqUgBIBInz0ZVQvvODro4R9CqE1sUe/ANeP1C8QQfuWdaKjOt7LPaXR9Yiaormv8S6Ne6pPVad8adcKLbResvtnjjID7ftz0oZEL0M2YU6+HnJHa8g5+scRhHO/HW2m+ayXl5WUoJd+psO3erJDQtf2HJ0d2CniD6XEeJnV111bYmhpGspsHldQHR0OuaMEtm71bj5Nik4EuJNJW25nRbNgu6nj0kr4ipSV37LmyZvFHvYoEMOkJ6nXawEEnVCdBZ83EauwbveLxAEIG7JFryxpvs86XDI9+gBgSqLrfCF/VYncnCfcu17b9aQFmjnsz3MBWLekxyk5/c+NNRTR/Rm9gm5JKBTSyBo/jLLXhxqp4JbepqXPSeiOC+4OluYf7QhpM5GsAA=";

// src/studio/posters/sdxl-turbo.webp
var sdxl_turbo_default = "data:image/webp;base64,UklGRkwLAABXRUJQVlA4IEALAACQLACdASpwAHAAPo06lUglI6IhNZdO+KARiWwAsv8hR2fK+ZFXH8FsJldeUq+N/tvUx+ht6d+6Pq5/bT9nffV9Mf/P9HL+zdbD6AHnO+sB5XPX6ad3xnxa9KIihxfVJ39/MHUCuOd3Bs3+o5R6eF+u6NPT7wlTSGl89H4ZbwsqMPCzFFT1xA7/1Hwgdf/zx//s4HTf+YQiPvW81nqOl8A2xN6o0G9ri0cXcduyW5uMLu5dwnCzsr52TzLvamBwPDWjAI9O9MFzWNsI7EtL6HdufnA1lMBeBtgovAksGg/Klqe5uC4Qtq+c/slf/W+Zq3U4EMc5ksQDegTrlJgL3WaYoDzHM6iE/uSiaLkvVN/QLC6Z6tzsJb7ZI0MtyhlN6B1UKDRfIL7s28SqNx1BOLi9N1LlWilbXS1n8YgxNH4oQW6EiUF7s+f7CgrsKG2pu2RiMUp2nyuKKSl8kKJ9utYCsY/z938dUEnuJkdDgAD+2IvRErU87UDtgc3To785vxbvrG9Y7uxklJG5T872jf6wxr+OWDMMClFgIzdIyrrwsAv+z9MySVMXqrNTReZTBymIQyIUvK1ys3TvSWMmvzvMGVyAA/t9mau9fsZQLFnvRqyuDOJm40Ji/YWjj471EDTlD+uW51wv6pz0W4aXaXHbvgPjFe+2uCuBlsqs4ULv4TQ5J67wUauutxlUm2QZ77Xt9F1/Nvph2Sq4rmvuSXxEc4tfBb8/ODBw5OifshVtDG3MYUnAOx9mlnV3Wbh7ti5gnoT+pk9MVmlgwtnpBcTXXnzx6McGNeDNsIQb7slBx4JdJWI6kI8Bx9zS1LKYFx9CGq7k3cBQS7QUHo+rCbFa0lXPfTtUKGk/H8jiK0HuTDvxoFaeCNu/cYhfewe/PRkQayjTAd2huSq5YACqQ4IGTBqm7JJq9lTQ0GcrQ76L+Zf2NjfVD5QmbQnaokgnk0Q/EFsLl8Sp5ve25LSRI32vmCyzTMu34jwhRRERm5tvVAFAO/nV0DS+6ZnO9MFUD5ct89HzyPFqNvcktQulN4du9KtuLIR+BhVvnw+HN2IamOt/tIeaGrKbqEdVfgJRLlnzmQMZZ9g6llz1zAe4pGT4fgaqhMbkZ7vCmHK5VbKeBNEzPgDKk5BDO71cyZXPmBwXLFdHK9Icq+yUT18lpMuSkweVV8bFIU4x754zPKLbt61N8Xi1SY6ss4T8HdIdPkmIr/BKwuxO7Mgw0zzAUyR3eGtm3i8xFaPaUCf9lOemLW0MoYimfrzDHU7KIWup5fDimmZcepwqHepdxlrn5DPAMguXeZy8vkTRMUhm6kNihDW0S0o3RrBj7YPBSbnUGM5hBtmdoWxZ1fKLb+9rLQQjCw28FKZULmWOWh9FjQHiFrQHG5QIXEx0LYnIDo15d+yLDbndpV2VFznQ+knpeNYPu8/aXgKCqM/8xYH8PCF3T628j+NKAf528r7MsAd1BH0XATPVtIhu6mK3PUlvJKbqQOylSP2QzpFIPDGCTkAEVDBF2DJ3tQAU4XP96r0FF7Uan94OWr5EoFqhHm9h3NVJ26gZCiyf21syyEHA0rCsBdJYz/rcQsD9ixzGUWu0u2aXy9SOFtNLjBfOSVyMJZz8zesgNuhw1aekEfUSw1EdnuYpF7dAN5UYhAxT4m7Ms75XkxJh1c3uHYEEbjYw5l/dezaKGVt95NhoD8K4F/wd1KuZWCNJXRDC/6rR2OZ8p22P97Ka5e6MD7SNf5vq2bfzd26CDoWFPqu17a8Vohvg8VxgSNe0M5Kj/IQPtTk7IoiTbCuDsgyFgX5JiZakIFhJHRu9jWCsU0QOLOwzdZzpvOp+Ky635rqqLQM7ACcCS6quaixQ3PS7xg8DBrlAPWGBBYujdSGsmnZi2ZdxSTN0Vh1hYHDmuLOLkn24jAmfg7Q8csiKaSq76BZIj5+G3Rp5h5xy8aZsuucCcENoqwrn+HVHFhVpQn7eo5Z0TGbd9kuu04z9av2LsHzJmXKD38U3e9eWdSvq84QK5dOIVBxJ3Jz7RLH/7Zub13NKuamJsGVPIjSgq/WUFtEmDOgV0s7oWCJ5H5dmwrjTcAkX5pOddRXi0PiZQ40hV9FFTzg61v1S3al0cvM9kAjIiroaUKuw5YtYY39NSOnW3xDWwXpPaB4etcxvX2Ou+BA57CxGBgCGJm487yuGbDdHpOjVGBV7/y5NiVNSK/dfp5mSruH55XOeGdRfcqmXj3Re3ykk49u0+lpJfiW5ox/PqibhL502IoWGd0d+b7Siza+ej3Oi6EsvgKxg5jWrMd53uEdewRPg9KIDtDHIwuKZ5DSd2e7ratdU3JdbacU6N+KfT/ZrIfRHLwUk22uxJy1sIXewegO1yxXRNlEoLHLTCK+wGyT2U9okgRdYVPqmax1SPXo2O30zubcnl3fZ74ODvEGlgQr/RMnjeCBDhjvXKweT0FhpEDlkWytlSBwxB65zc285Rv9AztBXNy6XgnAr6Tqh5RR97xdXNurY2N3ZKP+1j99ybEN2ZNiYJLYaZKYV6DaSVbXgcr2b83toq3L74X5wM7yUEeHBbpEBNvLtlWENpZtBkp8WTptCwTNT4UOlU6OFQTq5fdgoE+Z+UxDCDLCl98UWVfvSCE7gsuEGcrxv04iKo/qYv/MS+MWWWyWINjnlRgiPseEycbadm6IxmJC2/QHI7EWyx3D4GMsV3HWTj7kE00GO6w09G2jBUjCbM1MqwsinPzOXgkSEz8IJVWNPmvZHvnE3HsrpW9T8vJKYXfGfW0RCWs4XvOPXNltuwEqE91PtQP45JNSn/+kwfFrHCaXkBkM2Czo1Rmumqo6S+DrH85eaee5MHNHkzGFvjPYSnzynV48lxDntaS9iSMdzGlQc3LY7j8QwLBuN/JOFFjwIpy9bL7yAAAC3IEMqdhRHA6lQfgdlYHY4IaAx4Er/zF4tcnN97wTdLX7f9Fo9Dk0i6pfiwHNiAB9oPk5w70hY4/sPBXdTdRApd/c4lZfRg67R+JMwolB8Utn7NDDe3gaPo/7r8og2gxbaML30q9Ul4okz/pj/MjvNULV0Sg6Ao5vb6Zaf8wLCnV/6GI6B/v71rTQPwqSgpFY3Wlc+d48FBJMhHU4mZj2XCZIn2liDlDPdpA+LjIELb5JJMSYoyqnjv8l47blKRtbZ9rBQ+OMn56STv4ncrOdoWCHSPLZEp2icLw70lHdtjX6Mky7eVGv9lc+M4/UqbpOFAZbfvn0HEHrGgSijozpFiPqehnMtXdLpXv1EYGEpjaQ+BZuSD2v0iKrvCtwjrNgPQ+XDtz8tRpVD8SW3aZ7A1ylo+Txm2nD4Lg+jHNXKCjiAhBgOCA7I2Ovrl2v9p1TLYjFcOV/YKF/BQ/iK7GhCZkI7UFLkvD6synmPyE4/4OxdQEnzc84EK1ogK/8wuKowKItmfaBFkzhPtPsQ9/moVQHqR/G2P6BIQsF+fxzXprCxYMB8oj6177N+GXi8P5gPAiawl1sTbjB98GWLDjtaRzJPYXwYBmkxV6yR8VAiCIdzf3NZFq10mdzJuM8z1rbmr+dw9M3yX5OS6dtRoDQnTu51O+SCaKA5TBW1nsJs/2Lpb7VMSAZyFDrCiJ4M9j31BuqgpSpqnJdgyMMFOE3Ik+pYOdWZ92BOurYEDxZBNyySNiugFHYLIlZgqsOcYvXVWJJIa3n1Z8O/WmqRnqprSpfd7bAxVTk5odM7VhCCkFSSgUl+LKwLxrAc0MZHT3LEoURP885MjEg6sJodrCRLktMa6MyNO2FkplRaYbdb1ZbP6iB5rryzgUupUXWQBobhOivudDCeOCMWDAukjbEKSLer5kCgEAA=";

// src/studio/ModelCardPicker.jsx
var import_jsx_runtime34 = require("react/jsx-runtime");
var MENU_ID = "ofs-model-menu";
var POSTERS = {
  "sdxl-lightning": sdxl_lightning_default,
  "hyper-sdxl-8step": hyper_sdxl_8step_default,
  "sdxl-turbo": sdxl_turbo_default,
  "playground-v2.5": playground_v2_5_default,
  "sdxl-base": sdxl_base_default,
  // 专用 inpaint 权重沿用 SDXL 家族海报（同一底座血统，不单独占一份图片资产）。
  "sdxl-inpaint": sdxl_base_default,
  "realvis-v5": realvis_v5_default,
  "flux2-klein-4b": flux2_klein_4b_default,
  "animagine-xl-3.1": animagine_xl_3_1_default,
  "anima-light-lavender": anima_light_lavender_default
};
var LABELS = {
  menuTitle: "studio.preset.menuTitle",
  measured: "studio.preset.measured",
  default: "studio.preset.default",
  langZhEn: "studio.preset.langZhEn",
  langEnOnly: "studio.preset.langEnOnly",
  imageToolOnly: "studio.preset.imageToolOnly",
  // 算力来源门控：当前 provider 跑不了的模型置灰 + 「仅 Colab」角标与原因提示。
  providerOnly: "studio.preset.providerOnly",
  providerBlocked: "studio.preset.providerBlocked",
  footer: "studio.preset.footer",
  steps: "studio.preset.stepsUnit",
  dualGpu: "studio.preset.dualGpu"
};
function providerText(t, provider) {
  return t(providerNameKeyOf(provider));
}
function shortOf(preset) {
  return preset.short || preset.label || preset.id;
}
function descriptionOf(preset, isEn) {
  const value = preset.description;
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[isEn ? "en" : "zh"] || value.zh || value.en || "";
}
function etaOf(t, preset) {
  const seconds = Number(preset.steadySeconds);
  return Number.isFinite(seconds) ? `~${formatSeconds(t, seconds)}` : "";
}
function specOf(t, preset) {
  const parts = [];
  if (preset.params) parts.push(preset.params);
  if (preset.size) parts.push(`${preset.size}px`);
  if (Number(preset.gpus) > 1) parts.push(t(LABELS.dualGpu));
  else if (Number.isFinite(Number(preset.steps))) parts.push(`${preset.steps} ${t(LABELS.steps)}`);
  return parts.join(" · ");
}
function ModelCardPicker(props) {
  const { t, isEn, presets, value, defaultPreset, provider = "", onChange, open, onOpenChange } = props;
  const list = Array.isArray(presets) ? presets : [];
  const active = list.find((preset) => preset.id === value) || list[0] || null;
  const rootRef = import_react36.default.useRef(null);
  const triggerRef = import_react36.default.useRef(null);
  const listRef = import_react36.default.useRef(null);
  import_react36.default.useEffect(() => {
    if (!open || !listRef.current) return;
    const options = listRef.current.querySelectorAll('[role="option"]');
    if (options.length === 0) return;
    const index = Math.max(0, list.findIndex((preset) => preset.id === value));
    const target = options[index] || options[0];
    if (typeof target.focus === "function") target.focus({ preventScroll: true });
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });
  }, [open, value, list]);
  import_react36.default.useEffect(() => {
    if (!open) return void 0;
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        if (triggerRef.current) triggerRef.current.focus({ preventScroll: true });
      } else if (event.key === "Tab") {
        onOpenChange(false);
      }
    }
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);
  function choose(preset) {
    if (!preset || preset.inpaintOnly === true) return;
    if (!presetAvailableForProvider(preset, provider)) return;
    if (onChange) onChange(preset);
    onOpenChange(false);
    if (triggerRef.current) triggerRef.current.focus({ preventScroll: true });
  }
  function onListKeyDown(event) {
    if (!listRef.current) return;
    const options = Array.prototype.slice.call(listRef.current.querySelectorAll('[role="option"]')).filter((option) => option.disabled !== true && option.getAttribute("aria-disabled") !== "true");
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = options[(current + 1) % options.length];
    else if (event.key === "ArrowUp") next = options[(current - 1 + options.length) % options.length];
    else if (event.key === "Home") next = options[0];
    else if (event.key === "End") next = options[options.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    if (typeof next.scrollIntoView === "function") next.scrollIntoView({ block: "nearest" });
  }
  if (!active) {
    return /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("span", { className: "ofs-model is-empty", "aria-hidden": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(Icon, { name: "sliders", size: 14 }),
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-now", children: "—" })
    ] });
  }
  const eta = etaOf(t, active);
  const poster = POSTERS[active.id] || "";
  return /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: "ofs-model-wrap", ref: rootRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: "ofs-model",
        "aria-haspopup": "listbox",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": MENU_ID,
        "aria-label": t("studio.preset"),
        onClick: () => onOpenChange(!open),
        onKeyDown: (event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            onOpenChange(true);
          }
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(Icon, { name: "sliders", size: 14 }),
          active.family ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-family", children: active.family }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-now", children: shortOf(active) }),
          eta ? /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)(import_jsx_runtime34.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-div", "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-eta", children: eta })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(Icon, { name: "chevronDown", size: 13, className: "ofs-model-caret" })
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: "ofs-model-menu", id: MENU_ID, children: [
      /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: "ofs-model-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { children: `${t(LABELS.menuTitle)}${list.length > 1 ? ` · ${list.length}` : ""}` }),
        /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { children: t(LABELS.measured) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: "ofs-model-list", role: "listbox", "aria-label": t(LABELS.menuTitle), ref: listRef, onKeyDown: onListKeyDown, children: list.map((preset) => {
        const selected = preset.id === active.id;
        const image = POSTERS[preset.id] || "";
        const isDefault = preset.id === defaultPreset;
        const imageToolOnly = preset.inpaintOnly === true;
        const restrictedProvider = presetProviderRestrictionOf(preset);
        const providerBlocked = !presetAvailableForProvider(preset, provider);
        const disabled = imageToolOnly || providerBlocked;
        const blockedTitle = providerBlocked ? formatText(t(LABELS.providerBlocked), {
          provider: providerText(t, provider),
          needed: providerText(t, restrictedProvider)
        }) : void 0;
        const optionEta = etaOf(t, preset);
        const description = descriptionOf(preset, isEn);
        return /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)(
          "button",
          {
            type: "button",
            role: "option",
            "aria-selected": selected ? "true" : "false",
            "aria-disabled": disabled ? "true" : void 0,
            disabled,
            className: `ofs-model-option${selected ? " is-on" : ""}${imageToolOnly ? " is-tool-only" : ""}${providerBlocked ? " is-provider-gated" : ""}`,
            "data-preset-id": preset.id,
            title: imageToolOnly ? t(LABELS.imageToolOnly) : blockedTitle,
            onClick: () => choose(preset),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-poster", "aria-hidden": "true", children: image ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("img", { src: image, alt: "", width: "56", height: "56", draggable: "false" }) : /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-poster-fallback", children: (preset.family || preset.id || "M").slice(0, 1) }) }),
              /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("span", { className: "ofs-model-copy", children: [
                /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("span", { className: "ofs-model-line", children: [
                  preset.family ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-fam", children: preset.family }) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-name", children: shortOf(preset) }),
                  imageToolOnly ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-lang is-tool-only", children: t(LABELS.imageToolOnly) }) : /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: preset.supportsChinese === true ? "ofs-model-lang is-zh" : "ofs-model-lang", children: t(preset.supportsChinese === true ? LABELS.langZhEn : LABELS.langEnOnly) }),
                  restrictedProvider ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-provider", children: formatText(t(LABELS.providerOnly), { provider: providerText(t, restrictedProvider) }) }) : null,
                  isDefault ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-default", children: t(LABELS.default) }) : null
                ] }),
                description ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-desc", children: description }) : null,
                /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-spec", children: specOf(t, preset) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("span", { className: "ofs-model-side", children: [
                optionEta ? /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-option-eta", children: optionEta }) : /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-option-eta" }),
                /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: "ofs-model-check", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(Icon, { name: "check", size: 15 }) })
              ] })
            ]
          },
          preset.id
        );
      }) }),
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: "ofs-model-foot", children: t(LABELS.footer) })
    ] }) : null
  ] });
}

// src/studio/StudioIcon.jsx
var import_react37 = __toESM(require("react"), 1);
var import_jsx_runtime35 = require("react/jsx-runtime");
function StudioIcon(props) {
  const size = props && props.size || 20;
  return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("path", { d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" }),
        /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("path", { d: "M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" }),
        /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("path", { d: "M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" }),
        /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("path", { d: "M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" }),
        /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("circle", { cx: "12", cy: "12", r: "3.2" })
      ]
    }
  );
}

// src/studio/TopBar.jsx
var import_jsx_runtime36 = require("react/jsx-runtime");
function TopBar(props) {
  const { t, isEn, ui, compute, library } = props;
  const { form: fields, patchForm, selectPreset } = props.form;
  const { view, setView, openLogs, openSettings } = ui;
  const {
    sessionState,
    session,
    quota,
    presets,
    busy,
    probing,
    probe,
    probeReport,
    update,
    startSession: startSession2,
    stopSession: stopSession2,
    runProbe: runProbe2,
    openFolder
  } = compute;
  const status = compute.status || computeStatusOf(t, { session });
  const [open, setOpen] = import_react38.default.useState(Boolean(props.defaultOpen));
  const [modelOpen, setModelOpen] = import_react38.default.useState(Boolean(props.defaultModelOpen));
  const wrapRef = import_react38.default.useRef(null);
  const pillRef = import_react38.default.useRef(null);
  const snapshot2 = useHostSnapshot(open);
  const now = useNow(open);
  import_react38.default.useEffect(() => {
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
  const idleShutdown = idleShutdownOf(session);
  const providerUsage = session && session.provider === "colab" ? session.providerUsage : null;
  const quotaUsed = quota && Number.isFinite(quota.usedHours) ? quota.usedHours : null;
  const quotaTotal = quota && Number.isFinite(quota.totalHours) ? quota.totalHours : null;
  const loadedPreset = presets.find((item) => item.id === (session && session.presetId)) || presets.find((item) => item.id === fields.presetId) || null;
  const steadyRaw = loadedPreset && loadedPreset.steadySeconds !== void 0 ? loadedPreset.steadySeconds : loadedPreset && loadedPreset.measured ? loadedPreset.measured.steadySeconds : null;
  const steadySeconds = Number.isFinite(steadyRaw) ? steadyRaw : null;
  const kaggleTransport = compute.kaggleTransport === "direct" ? "direct" : "cli";
  const probePayload = probe || snapshot2 && snapshot2.probe || probeReport && probeReport.probe || null;
  const probeInfo = probeStatusOf(probePayload);
  const accountStatus = accountStatusOf(probePayload, sessionState);
  const probeFailed = probeReport && probeReport.status && probeReport.status !== "ok" ? probeReport : null;
  const probeNote = probeInfo && probeInfo.notes.length > 0 ? probeInfo.notes[0] : "";
  const quotaUnavailable = Boolean(probeFailed || probeInfo && probeInfo.quota !== "ok");
  const lastGood = snapshot2 && snapshot2.probeLastGood || null;
  const lastCheckTime = formatClockTime(snapshot2 && snapshot2.probeLastGoodAt);
  const lastGoodQuota = quotaText(lastGood && lastGood.quota);
  const sessionRunMs = session ? elapsedMsSince(session.startedAt, now) : null;
  const tunnelProvider = session && session.tunnelProvider ? session.tunnelProvider : "";
  const tunnelLabel = tunnelProvider === "cloudflare" ? t("studio.compute.tunnel.cloudflare") : tunnelProvider === "custom" ? t("studio.compute.tunnel.custom") : "";
  const statusText = (value) => {
    if (value === "ok") return t("value.ok");
    if (value === "failed") return t("value.failed");
    if (value === "unavailable") return t("value.quotaUnavailable");
    return t("value.unknown");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("header", { className: "ofs-topbar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-brand", title: t("studio.nav.label"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-brand-mark", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(StudioIcon, { size: 18 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-brand-name", children: t("studio.brand") }),
      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-brand-sub", children: t("studio.brandSub") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("nav", { className: "ofs-tabs", "aria-label": t("studio.tabs"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("button", { type: "button", className: view === "studio" ? "ofs-tab is-on" : "ofs-tab", onClick: () => setView("studio"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "sparkles", size: 15 }),
        t("studio.tab.studio")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("button", { type: "button", className: view === "gallery" ? "ofs-tab is-on" : "ofs-tab", onClick: () => setView("gallery"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "images", size: 15 }),
        t("studio.tab.gallery")
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-grow" }),
    openFolder ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
      "button",
      {
        type: "button",
        className: "ofs-icon-btn",
        onClick: openFolder,
        title: t("studio.action.openFolder"),
        "aria-label": t("studio.action.openFolder"),
        children: /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "folder", size: 16 })
      }
    ) : null,
    library.loadHistory ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("button", { type: "button", className: "ofs-icon-btn", onClick: library.loadHistory, title: t("studio.refresh"), "aria-label": t("studio.refresh"), children: /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "refresh", size: 16 }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-pill-wrap", ref: wrapRef, children: [
      /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(
        "button",
        {
          ref: pillRef,
          type: "button",
          className: `ofs-compute is-${status.tone}`,
          onClick: () => {
            setOpen((value) => {
              const next = !value;
              if (next) setModelOpen(false);
              return next;
            });
          },
          "aria-expanded": open,
          "aria-haspopup": "menu",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("i", { className: `ofs-dot is-${status.tone}${status.tone === "ok" || status.tone === "warn" ? " is-live" : ""}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { children: status.label }),
            quotaUsed !== null && quotaTotal !== null ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("em", { children: [
              quotaUsed,
              " / ",
              quotaTotal,
              " ",
              t("unit.hour")
            ] }) : null,
            providerUsage && Number.isFinite(providerUsage.balance) ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("em", { children: formatText(t("studio.compute.ccu"), { balance: providerUsage.balance.toFixed(1) }) }) : null,
            update ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
              "span",
              {
                className: "ofs-update-dot",
                role: "img",
                "aria-label": t("studio.update.badge"),
                title: formatText(t("studio.update.available"), { latest: update.latest, current: update.current })
              }
            ) : null,
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-pill-caret", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "chevronDown", size: 13 }) })
          ]
        }
      ),
      open ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-popover", role: "menu", children: [
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-popover-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("i", { className: `ofs-dot is-${status.tone}${status.tone === "ok" || status.tone === "warn" ? " is-live" : ""}`, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("b", { children: status.label }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Tooltip, { text: status.tooltip, side: "bottom" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.quota"),
            " ",
            quotaUsed !== null && quotaTotal !== null ? `${quotaUsed} / ${quotaTotal} ${t("unit.hour")}` : "—"
          ] }),
          status.phaseLabel ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.phase"),
            " · ",
            status.phaseLabel
          ] }) : null,
          status.ready && steadySeconds !== null ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.speedLine"),
            " ",
            formatSeconds(t, steadySeconds)
          ] }) : null,
          idleShutdown ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-muted", children: formatText(t("studio.compute.idleCountdown"), {
            idle: idleShutdown.idleMinutes,
            total: idleShutdown.totalMinutes
          }) }) : idleMinutes > 0 ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.idleFor"),
            " ",
            idleMinutes,
            " ",
            t("unit.min")
          ] }) : null,
          session && session.device ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-muted", children: session.device }) : null,
          tunnelLabel ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: "ofs-muted", children: [
            t("studio.compute.tunnel"),
            " · ",
            tunnelLabel
          ] }) : null
        ] }),
        status.hint ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("p", { className: "ofs-popover-hint", children: status.hint }) : null,
        update ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-popover-fallback ofs-popover-update", children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-popover-fallback-title", children: formatText(t("studio.update.available"), { latest: update.latest, current: update.current }) }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { children: t("studio.update.hint") }),
          update.enginesDsh ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { children: formatText(t("studio.update.requiresDsh"), { range: update.enginesDsh }) }) : null,
          update.releaseUrl ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
            "a",
            {
              className: "ofs-popover-link",
              href: update.releaseUrl,
              target: "_blank",
              rel: "noreferrer",
              role: "menuitem",
              children: t("studio.update.notes")
            }
          ) : null
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-popover-note", children: [
          probing ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { children: t("action.probing") }) : null,
          probeInfo ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(import_jsx_runtime36.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
              t(accessMethodKey(kaggleTransport)),
              " · ",
              t(accessStatusKey(kaggleTransport, accessStatusOf(probeInfo, kaggleTransport)))
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
              t("studio.probe.quota"),
              " · ",
              statusText(probeInfo.quota)
            ] })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
            t("studio.probe.account"),
            " · ",
            statusText(accountStatus),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Tooltip, { text: t("studio.compute.authTooltip"), tone: "warn", side: "bottom" })
          ] }),
          probeFailed ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { title: probeFailed.message || void 0, children: [
            probeFailed.status === "timeout" ? t("studio.probe.timeout") : t("studio.probe.failed"),
            probeFailed.message ? ` · ${probeFailed.message}` : ""
          ] }) : null,
          probeNote ? /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { title: probeInfo.notes.join(" · "), children: probeNote }) : null
        ] }),
        quotaUnavailable ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: "ofs-popover-fallback", children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: "ofs-popover-fallback-title", children: t("studio.compute.quotaFallback") }),
          lastCheckTime ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
            t("studio.compute.lastGood"),
            " ",
            lastCheckTime,
            " · ",
            t("studio.compute.quota"),
            " ",
            lastGoodQuota
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { children: t("studio.compute.neverChecked") }),
          sessionRunMs !== null ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { children: [
            t("studio.compute.sessionRan"),
            " ",
            formatDuration(t, sessionRunMs)
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
            "a",
            {
              className: "ofs-popover-link",
              href: KAGGLE_ACCOUNT_URL,
              target: "_blank",
              rel: "noreferrer",
              role: "menuitem",
              children: t("studio.compute.kaggleSettings")
            }
          )
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("button", { type: "button", role: "menuitem", className: "ofs-popover-row", onClick: startSession2, disabled: !!busy || !status.canStart, children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "cloud", size: 15 }),
          t("studio.compute.start")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("button", { type: "button", role: "menuitem", className: "ofs-popover-row", onClick: stopSession2, disabled: !!busy || !status.canStop, children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "clock", size: 15 }),
          t("studio.compute.stop")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "ofs-popover-row",
            onClick: runProbe2,
            disabled: !!busy || probing,
            "aria-busy": probing,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "refresh", size: 15 }),
              probing ? t("action.probing") : t("studio.compute.check")
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "ofs-popover-row",
            onClick: () => {
              setOpen(false);
              if (openLogs) openLogs(pillRef.current);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "message", size: 15 }),
              t("studio.logs.open")
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "ofs-popover-row",
            onClick: () => {
              setOpen(false);
              if (openSettings) openSettings(pillRef.current);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Icon, { name: "sliders", size: 15 }),
              t("studio.settings.open")
            ]
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
      ModelCardPicker,
      {
        t,
        isEn,
        presets,
        value: fields.presetId,
        defaultPreset: compute.defaultPreset,
        provider: compute.provider,
        open: modelOpen,
        onOpenChange: (next) => {
          setModelOpen(next);
          if (next) setOpen(false);
        },
        onChange: (next) => {
          if (selectPreset) selectPreset(next);
          else patchForm({ presetId: next.id });
          setModelOpen(false);
        }
      }
    )
  ] });
}

// src/studio/hooks/useStudioUi.js
var import_react39 = __toESM(require("react"), 1);

// src/logic/notice.js
var NOTICE_TITLE_PREFIX = "● 生成完成 · ";
function stripNoticePrefix(title) {
  const value = typeof title === "string" ? title : "";
  return value.startsWith(NOTICE_TITLE_PREFIX) ? value.slice(NOTICE_TITLE_PREFIX.length) : value;
}
function isCompletion(previous, next) {
  if (!next || next.status !== "done") return false;
  if (!previous || typeof previous !== "object") return false;
  if (previous.id && next.id) {
    if (previous.id !== next.id) return true;
    return previous.status !== "done";
  }
  return previous.status !== "done";
}
function completionNotice(input = {}) {
  const title = typeof input.title === "string" ? input.title : "";
  const completed = isCompletion(input.previous, input.next);
  if (!completed) return { title, notify: false, completed: false };
  if (!input.hidden) return { title, notify: false, completed: true };
  return { title: `${NOTICE_TITLE_PREFIX}${stripNoticePrefix(title)}`, notify: true, completed: true };
}

// src/logic/uiState.js
function uiStateViewOf(result) {
  if (!result || result.ok !== true) return null;
  const data = result.data && typeof result.data === "object" ? result.data : null;
  if (!data || data.ok !== true) return null;
  const view = data.uiState;
  if (!view || typeof view !== "object" || Array.isArray(view)) return null;
  return normalizeUiState(view);
}

// src/studio/hooks/useStudioUi.js
var nextToastId = 0;
function useStudioUi({ t, initialView, initialPanelMode }) {
  const [view, setView] = import_react39.default.useState(initialView);
  const [advancedOpen, setAdvancedOpen] = import_react39.default.useState(UI_STATE.defaults.advancedOpen);
  const [negativeOpen, setNegativeOpen] = import_react39.default.useState(false);
  const [error, setError] = import_react39.default.useState(null);
  const [dismissed, setDismissed] = import_react39.default.useState("");
  const [toast, setToast] = import_react39.default.useState(null);
  const [panelMode, setPanelMode] = import_react39.default.useState(initialPanelMode);
  const [zoom, setZoom] = import_react39.default.useState(false);
  const [compareOpen, setCompareOpen] = import_react39.default.useState(false);
  const [logsOpen, setLogsOpen] = import_react39.default.useState(false);
  const logsReturnRef = import_react39.default.useRef(null);
  const [settingsOpen, setSettingsOpen] = import_react39.default.useState(false);
  const settingsReturnRef = import_react39.default.useRef(null);
  const advancedOpenRef = import_react39.default.useRef(advancedOpen);
  advancedOpenRef.current = advancedOpen;
  function showToast(text) {
    nextToastId += 1;
    setToast({ text, id: nextToastId });
  }
  import_react39.default.useEffect(() => {
    let alive = true;
    Promise.resolve(fetchUiState()).then((result) => {
      if (!alive) return;
      const saved = uiStateViewOf(result);
      if (saved) {
        advancedOpenRef.current = saved.advancedOpen;
        setAdvancedOpen(saved.advancedOpen);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  function toggleAdvancedOpen() {
    setAdvancedOpen((prev) => !prev);
    const next = !advancedOpenRef.current;
    advancedOpenRef.current = next;
    Promise.resolve(saveUiState(buildUiStatePatch({ advancedOpen: next }))).catch(() => {
    });
  }
  function fail(code, message) {
    setDismissed("");
    setError({ code, message: message ?? "" });
  }
  function dismissGuidance(guidanceKey) {
    if (guidanceKey) setDismissed(guidanceKey);
    setError(null);
  }
  import_react39.default.useEffect(() => {
    if (!toast) return void 0;
    const timer2 = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer2);
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
  function openLogs(trigger) {
    logsReturnRef.current = trigger || (document.activeElement || null);
    setLogsOpen(true);
  }
  function closeLogs() {
    setLogsOpen(false);
    const target = logsReturnRef.current;
    logsReturnRef.current = null;
    if (target && typeof target.focus === "function" && target.isConnected !== false) target.focus();
  }
  function openSettings(trigger) {
    settingsReturnRef.current = trigger || (document.activeElement || null);
    setSettingsOpen(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    const target = settingsReturnRef.current;
    settingsReturnRef.current = null;
    if (target && typeof target.focus === "function" && target.isConnected !== false) target.focus();
  }
  return {
    view,
    setView,
    zoom,
    setZoom,
    compareOpen,
    setCompareOpen,
    panelMode,
    setPanelMode,
    advancedOpen,
    // setAdvancedOpen 只给预览 / 测试直接注入折叠态；业务路径请用 toggleAdvancedOpen（会持久化）。
    setAdvancedOpen,
    toggleAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    toast,
    error,
    setError,
    dismissed,
    showToast,
    fail,
    dismissGuidance,
    copyText,
    copyPath,
    copyInstallCommand,
    logsOpen,
    openLogs,
    closeLogs,
    settingsOpen,
    openSettings,
    closeSettings
  };
}
function useCompletionNotice({ t, ui, job, activeJob }) {
  const previousRef = import_react39.default.useRef(void 0);
  const pendingRef = import_react39.default.useRef(false);
  const hiddenJobRef = import_react39.default.useRef(null);
  const returningRef = import_react39.default.useRef(null);
  const tRef = import_react39.default.useRef(t);
  const uiRef = import_react39.default.useRef(ui);
  tRef.current = t;
  uiRef.current = ui;
  const judge = import_react39.default.useCallback((nextJob) => {
    const previous = previousRef.current;
    previousRef.current = nextJob || null;
    if (previous === void 0) return;
    const decision = completionNotice({
      previous,
      next: nextJob,
      hidden: Boolean(document.hidden),
      title: document.title
    });
    if (decision.notify) {
      pendingRef.current = true;
      document.title = decision.title;
      return;
    }
    if (!decision.completed) return;
    if (returningRef.current && isCompletion(returningRef.current, nextJob)) {
      returningRef.current = null;
      uiRef.current.showToast(tRef.current("studio.toast.generationDone"));
    }
  }, []);
  import_react39.default.useEffect(() => {
    judge(job);
  }, [judge, job && job.id, job && job.status, job && (job.finishedAt ?? "")]);
  import_react39.default.useEffect(() => {
    let timer2 = null;
    let alive = true;
    function stop() {
      if (timer2 !== null) {
        clearTimeout(timer2);
        timer2 = null;
      }
    }
    async function tick2() {
      timer2 = null;
      const result = await fetchState();
      if (!alive) return;
      const state = result && result.ok && result.data && typeof result.data === "object" ? result.data : null;
      if (state) judge(state.lastJob || null);
      const busy = Boolean(activeJob) || Boolean(state && activeJobOf(state));
      if (alive && document.hidden && busy) timer2 = setTimeout(tick2, TIMEOUTS.clientStateActivePollMs);
    }
    function rememberHidden() {
      hiddenJobRef.current = previousRef.current ?? null;
    }
    function onVisibility() {
      if (document.hidden) {
        rememberHidden();
        if (activeJob && timer2 === null) tick2();
        return;
      }
      stop();
      const hiddenJob = hiddenJobRef.current;
      hiddenJobRef.current = null;
      if (pendingRef.current) {
        pendingRef.current = false;
        returningRef.current = null;
        document.title = stripNoticePrefix(document.title);
        uiRef.current.showToast(tRef.current("studio.toast.generationDone"));
        return;
      }
      if (hiddenJob) returningRef.current = hiddenJob;
    }
    document.addEventListener("visibilitychange", onVisibility);
    if (document.hidden && activeJob) {
      rememberHidden();
      tick2();
    }
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeJob && activeJob.id, judge]);
}

// src/studio/useStudio.js
var import_react47 = __toESM(require("react"), 1);

// src/studio/hooks/useChatThread.js
var import_react40 = __toESM(require("react"), 1);
function useChatThread({ t, isEn, alive, state, form, generate }) {
  const [messages, setMessages] = import_react40.default.useState([]);
  const [interpreting, setInterpreting] = import_react40.default.useState(false);
  const [focusStack, setFocusStack] = import_react40.default.useState([]);
  const messageSeq = import_react40.default.useRef(0);
  const interpretingRef = import_react40.default.useRef(false);
  const threadSeq = import_react40.default.useRef(0);
  const focusRef = import_react40.default.useRef(focusStack);
  focusRef.current = focusStack;
  const focus = currentFocusOf(focusStack);
  const jobs = stateJobs(state);
  const threadJobs = jobs.length > 0 ? jobs : state && state.lastJob ? [state.lastJob] : [];
  const threadKey = threadJobs.map((job) => `${job.id}:${job.status}`).join("|");
  import_react40.default.useEffect(() => {
    if (messages.length === 0 || threadJobs.length === 0) return;
    setMessages((prev) => {
      let next = prev;
      for (const job of threadJobs) {
        const index = prev.map((item) => item.jobId).lastIndexOf(job.id);
        if (index < 0) continue;
        const current = (next === prev ? prev : next)[index];
        const patch = bubblePatch(t, job, current);
        if (!patch) continue;
        if (bubbleUnchanged(current, patch)) continue;
        if (next === prev) next = prev.slice();
        next[index] = { ...current, ...patch };
      }
      return next;
    });
  }, [threadKey]);
  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: messageSeq.current += 1, ...entry }))]);
  }
  async function interpret(text) {
    const value = String(text ?? "").trim();
    if (!value || interpreting || interpretingRef.current) return;
    clearFocus();
    interpretingRef.current = true;
    const history = intentHistory(messages);
    const previousPrompt = lastIntentPrompt(messages);
    const generation2 = threadSeq.current;
    pushMessages([{ role: "user", text: value }]);
    setInterpreting(true);
    const result = await alive(parseIntentRequest({
      text: value,
      previousPrompt,
      locale: isEn ? "en" : "zh",
      // 意图解析按当前预设的提示词配方约束英文提示词，并让宿主知道 CFG 下的负向词能力。
      presetId: form.form.presetId,
      cfg: form.form.cfg,
      history
    }));
    if (generation2 !== threadSeq.current) return;
    interpretingRef.current = false;
    if (!result) return;
    setInterpreting(false);
    if (result.ok && result.data && typeof result.data.prompt === "string") {
      const data = result.data;
      pushMessages([{
        role: "assistant",
        kind: "intent",
        prompt: data.prompt,
        summary: typeof data.summary === "string" ? data.summary : "",
        ratioId: intentRatio(data.ratioId),
        negative: intentNegative(data.negative),
        count: intentCount(data.count),
        lockSeed: false,
        clarify: intentClarify(data.clarify),
        modelHint: intentModelHint(data.modelHint, form.form.presetId),
        source: data.source === "model" ? "model" : "local"
      }]);
      return;
    }
    pushMessages([{ role: "assistant", kind: "error", text: errorText(t, result) }]);
  }
  function resolveClarify(messageId, option) {
    const value = typeof option === "string" ? option.trim() : "";
    if (!value) {
      setMessages((prev) => prev.map((message) => message && message.id === messageId ? { ...message, clarify: null } : message));
      return;
    }
    setMessages((prev) => prev.filter((message) => !(message && message.id === messageId)));
    interpret(value);
  }
  function updateIntent(messageId, patch) {
    const source = patch && typeof patch === "object" ? patch : {};
    const next = {};
    for (const field of INTENT_EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
      const applied = intentFieldPatch(field, source[field]);
      if (applied) next[field] = applied[field];
    }
    if (Object.keys(next).length === 0) return;
    setMessages((prev) => prev.map((message) => message && message.id === messageId ? { ...message, ...next } : message));
  }
  function updateIntentField(messageId, field, value) {
    updateIntent(messageId, { [field]: value });
  }
  async function generateIntent(message) {
    const negativeActive = form.negativeActive === true;
    const overrides = intentOverrides(message, { negativeActive });
    if (!overrides) return;
    const ratio = DEFAULT_RATIOS.find((item) => item.id === message.ratioId);
    if (ratio) {
      overrides.width = ratio.width;
      overrides.height = ratio.height;
    }
    const seed = intentSeedOf(message, state && state.lastJob, form.form.seed);
    if (seed !== null) overrides.seed = seed;
    if ((form.dirty || form.draftEditing) && typeof form.parkDraft === "function") {
      form.parkDraft();
    }
    const patch = intentFormPatch(message, DEFAULT_RATIOS, { negativeActive });
    if (Object.keys(patch).length > 0) form.patchForm(patch);
    if (typeof form.clearOrigin === "function") form.clearOrigin();
    const ok = await generate(overrides, { pushUser: false, source: "assistant" });
    if (ok && typeof form.markClean === "function") form.markClean();
  }
  function handoffIntent(message) {
    if (!message || typeof form.applyIntent !== "function") return false;
    const hasPrompt = typeof message.prompt === "string" && message.prompt.trim().length > 0;
    if (hasPrompt && (form.dirty || form.draftEditing) && typeof form.parkDraft === "function") {
      form.parkDraft();
    }
    const applied = Boolean(form.applyIntent(message));
    if (applied && typeof form.clearOrigin === "function") form.clearOrigin();
    return applied;
  }
  function toggleIntentLockSeed(messageId) {
    setMessages((prev) => prev.map((message) => {
      if (!message || message.id !== messageId) return message;
      return { ...message, lockSeed: message.lockSeed !== true };
    }));
  }
  function focusImage(message, image, index) {
    const entry = focusEntryOf({
      messageId: message && message.id,
      image,
      index,
      count: gridImagesOf(message).length
    });
    if (!entry) return false;
    const next = pushFocus(focusRef.current, entry);
    focusRef.current = next;
    setFocusStack(next);
    return true;
  }
  function focusBack() {
    const next = popFocus(focusRef.current);
    focusRef.current = next;
    setFocusStack(next);
    return currentFocusOf(next);
  }
  function clearFocus() {
    if (focusRef.current.length === 0) return;
    focusRef.current = [];
    setFocusStack([]);
  }
  function mirrorTool(input) {
    const entries = mirrorToolEntries(t, input);
    if (entries.length === 0) return false;
    pushMessages(entries);
    return true;
  }
  function newChat() {
    threadSeq.current += 1;
    interpretingRef.current = false;
    setInterpreting(false);
    setMessages([]);
    clearFocus();
  }
  return {
    messages,
    interpreting,
    interpret,
    resolveClarify,
    updateIntent,
    updateIntentField,
    generateIntent,
    handoffIntent,
    toggleIntentLockSeed,
    // 上一张图没有可复用种子时，确认卡上的锁种开关置灰。
    canLockSeed: lastSeedOf(state && state.lastJob) !== null,
    // 阶段十五 Phase A2：结果网格钻取与单图聚焦返回栈。
    focus,
    focusDepth: focusStack.length,
    focusBackLabel: focusBackLabelOf(t, focusStack),
    focusImage,
    focusBack,
    // 舞台图片工具动作镜像：追加 kind='tool' + kind='job' 两条记录。
    mirrorTool,
    newChat,
    pushMessages
  };
}

// src/studio/hooks/useImageTool.js
var import_react41 = __toESM(require("react"), 1);
function defaultOutpaint() {
  return { ratioId: OUTPAINT_EXPAND_ID, anchor: { x: 0.5, y: 0.5 } };
}
function emptyDraft() {
  return {
    toolId: "",
    target: null,
    prompt: "",
    strength: LIMITS.strength.default,
    strengthAuto: true,
    presetId: "",
    mask: null,
    // 扩图草稿：只存小对象（比例 + 锚点）；运行时导出的画布 base64 另存 `canvas`，
    // 不进 workDrafts（避免几 MB 的快照进入 LRU 表），重开时由编辑器重新导出。
    outpaint: defaultOutpaint(),
    canvas: null
  };
}
function targetOf(entry) {
  const holder = entry && typeof entry === "object" ? entry : null;
  if (!holder) return null;
  const image = holder.image && typeof holder.image === "object" ? holder.image : holder;
  const path = typeof image.path === "string" ? image.path.trim() : "";
  if (!path) return null;
  const item = holder.item && typeof holder.item === "object" ? holder.item : null;
  const params = item && item.params && typeof item.params === "object" ? item.params : null;
  const ownPrompt = item && typeof item.prompt === "string" ? item.prompt.trim() : "";
  const paramsPrompt = params && typeof params.prompt === "string" ? params.prompt.trim() : "";
  const rawPrompt = isBareImportOf({ image, item }) ? "" : ownPrompt || paramsPrompt;
  const prompt = rawPrompt.slice(0, LIMITS.prompt.maxChars);
  return {
    path,
    url: typeof image.url === "string" && image.url ? image.url : referenceUrlOf(path),
    width: positiveSize(image.width),
    height: positiveSize(image.height),
    item,
    prompt
  };
}
function presetsForTool(list, tool) {
  if (!tool || !tool.capability) return [];
  if (tool.id === "inpaint" || tool.id === "outpaint") {
    return list.filter((item) => item.supportsInpaint === true);
  }
  if (tool.id === "img2img") {
    return list.filter((item) => item.supportsImg2Img === true && item.inpaintOnly !== true);
  }
  return [];
}
function useImageTool({ t, alive, ui, presets, defaultPreset, onSubmitted, currentPresetId }) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : [];
  const [draft, setDraft] = import_react41.default.useState(() => emptyDraft());
  const [editorOpen, setEditorOpen] = import_react41.default.useState(false);
  const [submitting, setSubmitting] = import_react41.default.useState(false);
  const [pendingTool, setPendingTool] = import_react41.default.useState(null);
  const draftRef = import_react41.default.useRef(draft);
  draftRef.current = draft;
  const inFlightRef = import_react41.default.useRef(false);
  const [workDrafts, setWorkDrafts] = import_react41.default.useState({});
  const baselinesRef = import_react41.default.useRef({});
  const removeWorkDraft = (key) => {
    const path = draftKeyOf(key);
    if (!path) return;
    delete baselinesRef.current[path];
    setWorkDrafts((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };
  import_react41.default.useEffect(() => {
    const key = draftKeyOf(draft.target);
    if (!key) return;
    const baseline = baselinesRef.current[key] || {};
    const out = draft.outpaint || defaultOutpaint();
    const baseAnchor = baseline.anchor || defaultOutpaint().anchor;
    const outpaintChanged = draft.toolId === "outpaint" && (out.ratioId !== (baseline.ratioId || OUTPAINT_EXPAND_ID) || out.anchor.x !== baseAnchor.x || out.anchor.y !== baseAnchor.y);
    const changed = {
      mask: Boolean(draft.mask),
      prompt: draft.prompt.trim() !== "",
      params: draft.presetId !== baseline.presetId || draft.strength !== baseline.strength || outpaintChanged
    };
    const active = changed.mask || changed.prompt || changed.params;
    setWorkDrafts((prev) => {
      if (!active) {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return lruDrafts({
        ...prev,
        [key]: {
          tool: draft.toolId,
          prompt: draft.prompt,
          strength: draft.strength,
          strengthAuto: draft.strengthAuto,
          presetId: draft.presetId,
          mask: draft.mask,
          outpaint: out,
          changed,
          lastTouchedAt: Date.now()
        }
      }, DRAFT_LRU_LIMIT);
    });
  }, [draft]);
  const activeTool = imageToolOf(draft.toolId);
  const preset = list.find((item) => item.id === draft.presetId) || null;
  const toolPresets = presetsForTool(list, activeTool);
  const outpaint = draft.outpaint || defaultOutpaint();
  const hasMask = Boolean(draft.mask) || Boolean(activeTool && activeTool.id === "outpaint");
  const strength = clampMaskStrength(draft.strength, hasMask);
  const strengthMax = toolStrengthMaxOf(draft.toolId, hasMask);
  const coverage = activeTool && activeTool.id === "outpaint" ? draft.canvas ? draft.canvas.coverage : 0 : draft.mask ? draft.mask.coverage : 0;
  const blockedKey = imageToolBlockedKeyOf({
    tool: draft.toolId,
    target: draft.target,
    targetPath: draft.target ? draft.target.path : "",
    preset,
    prompt: draft.prompt,
    targetPrompt: draft.target ? draft.target.prompt : "",
    mask: draft.mask,
    canvas: draft.canvas
  });
  const canSubmit = Boolean(activeTool && activeTool.ready && draft.target) && blockedKey === "" && !submitting;
  function setPrompt(value) {
    const text = String(value ?? "").slice(0, LIMITS.prompt.maxChars);
    setDraft((prev) => prev.prompt === text ? prev : { ...prev, prompt: text });
  }
  function openTool(kind, entry) {
    if (inFlightRef.current) return false;
    const tool = imageToolOf(typeof kind === "string" ? kind : kind && kind.id);
    if (!tool) return false;
    if (!tool.ready) {
      const key = tool.plannedKey || "studio.imageTool.planned";
      ui.showToast(formatText(t(key), { tool: t(tool.labelKey) }));
      return false;
    }
    const target = targetOf(entry);
    if (!target) {
      ui.showToast(t("studio.imageTool.blockedTarget"));
      return false;
    }
    if (tool.form === "instant") return sendInstant(tool, target);
    const previous = draftRef.current;
    const workKey = draftKeyOf(target);
    const saved = workKey ? workDrafts[workKey] : null;
    const restored = saved && saved.tool === tool.id ? saved : null;
    const sameWork = Boolean(previous.target && workKeyOf(previous.target) === workKeyOf(target));
    const sameTool = !restored && sameWork && previous.toolId === tool.id;
    const savedPreset = restored ? list.find((item) => item.id === restored.presetId) || null : null;
    const restoredPreset = savedPreset || (sameTool ? list.find((item) => item.id === previous.presetId) || null : null);
    const choice = restoredPreset ? { preset: restoredPreset, switched: false, fallback: false } : toolPresetOf(list, currentPresetId || defaultPreset, tool.id);
    if (!choice.preset) {
      ui.showToast(t("studio.imageTool.blockedNoPreset"));
      return false;
    }
    const nextPreset = choice.preset;
    const prompt = restored ? restored.prompt : sameTool ? previous.prompt : "";
    const restoredMask = restored ? restored.mask : null;
    const sameMask = sameTool ? previous.mask : null;
    const maskClamp = tool.id === "outpaint" ? true : Boolean(restoredMask || sameMask);
    const strength2 = restored ? clampMaskStrength(restored.strength, maskClamp) : sameTool ? clampMaskStrength(previous.strength, maskClamp) : toolStrengthDefaultOf(tool.id, nextPreset);
    const strengthAuto = restored ? restored.strengthAuto !== false : sameTool ? previous.strengthAuto : true;
    const mask = tool.id === "outpaint" ? null : restored ? restoredMask : sameMask;
    const nextOutpaint = restored && restored.outpaint && typeof restored.outpaint === "object" ? { ratioId: outpaintRatioIdOf(restored.outpaint.ratioId), anchor: outpaintAnchorOf(restored.outpaint.anchor) } : sameTool && previous.outpaint ? previous.outpaint : defaultOutpaint();
    const canvas = tool.id === "outpaint" && sameTool ? previous.canvas : null;
    setDraft({
      toolId: tool.id,
      target,
      // 同一作品同一工具：恢复未提交的提示词 / 蒙版 / 强度（修复中断后可继续编辑）。
      prompt,
      strength: strength2,
      strengthAuto,
      presetId: nextPreset.id,
      mask,
      outpaint: nextOutpaint,
      canvas
    });
    if (workKey && !baselinesRef.current[workKey]) {
      baselinesRef.current[workKey] = {
        presetId: nextPreset.id,
        strength: strength2,
        ratioId: nextOutpaint.ratioId,
        anchor: nextOutpaint.anchor
      };
    }
    setEditorOpen(true);
    if (!restored && !sameTool && (choice.switched || choice.fallback)) {
      ui.showToast(formatText(t("studio.imageTool.autoPreset"), { preset: presetLabelOf(nextPreset) }));
    }
    return true;
  }
  async function sendInstant(tool, target) {
    if (inFlightRef.current) return false;
    const blocked = imageToolBlockedKeyOf({
      tool: tool.id,
      target,
      targetPath: target.path,
      targetPrompt: target.prompt
    });
    if (blocked) {
      ui.showToast(t(blocked));
      return false;
    }
    const body = buildUpscaleToolBody({ target, targetPrompt: target.prompt });
    if (!body) {
      ui.showToast(t("studio.imageTool.blockedTarget"));
      return false;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    ui.setError(null);
    try {
      const result = await alive(submitGenerate(body));
      if (!result) return false;
      if (result.ok && result.data && result.data.id) {
        setPendingTool({
          jobId: result.data.id,
          target,
          body,
          parentPath: target.path,
          rootImage: target.item && target.item.rootImage || target.path,
          sourceMode: tool.id
        });
        ui.showToast(t("studio.imageTool.upscaleSubmitted"));
        if (typeof onSubmitted === "function") {
          onSubmitted(result.data, { tool: tool.id, target, body });
        }
        return true;
      }
      ui.fail(result.code, result.message);
      return false;
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }
  function submitInstant(kind, entry) {
    const tool = imageToolOf(typeof kind === "string" ? kind : kind && kind.id);
    if (!tool || tool.form !== "instant" || !tool.ready) return Promise.resolve(false);
    const target = targetOf(entry);
    if (!target) {
      ui.showToast(t("studio.imageTool.blockedTarget"));
      return Promise.resolve(false);
    }
    return sendInstant(tool, target);
  }
  function closeTool() {
    setEditorOpen(false);
  }
  function discardTool() {
    if (inFlightRef.current) return false;
    const current = draftRef.current;
    const key = draftKeyOf(current.target);
    if (key) removeWorkDraft(key);
    setDraft(emptyDraft());
    setEditorOpen(false);
    return true;
  }
  function selectPreset(next) {
    const tool = imageToolOf(draftRef.current.toolId);
    if (!tool) return false;
    const wanted = typeof next === "string" ? next : next && next.id;
    if (!wanted) return false;
    const found = presetsForTool(list, tool).find((item) => item.id === wanted) || null;
    if (!found) return false;
    setDraft((prev) => {
      const withMask = tool.id === "outpaint" ? true : Boolean(prev.mask);
      const value = prev.strengthAuto ? toolStrengthDefaultOf(tool.id, found) : clampMaskStrength(prev.strength, withMask);
      return { ...prev, presetId: found.id, strength: value };
    });
    return true;
  }
  function setStrength(value) {
    setDraft((prev) => {
      const tool = imageToolOf(prev.toolId);
      const withMask = Boolean(tool && tool.form === "canvas") && (tool.id === "outpaint" || Boolean(prev.mask));
      return { ...prev, strengthAuto: false, strength: clampMaskStrength(value, withMask) };
    });
  }
  function applyMask(input) {
    const tool = imageToolOf(draftRef.current.toolId);
    if (!tool || tool.form !== "canvas") return { ok: false, reason: "unsupported" };
    if (!draftRef.current.target) return { ok: false, reason: "no_target" };
    const candidate = input && typeof input === "object" ? input : { data: input };
    const verdict = maskExportVerdict(candidate.data, candidate.coverage);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    setDraft((prev) => ({
      ...prev,
      mask: {
        data: verdict.data,
        coverage: verdict.coverage,
        digest: maskDigestOf(verdict.data)
      }
    }));
    return { ok: true };
  }
  function clearMask() {
    setDraft((prev) => prev.mask ? { ...prev, mask: null } : prev);
    return true;
  }
  function setOutpaintRatio(value) {
    const tool = imageToolOf(draftRef.current.toolId);
    if (!tool || tool.id !== "outpaint") return false;
    const ratioId = outpaintRatioIdOf(value);
    setDraft((prev) => {
      const current = prev.outpaint || defaultOutpaint();
      if (current.ratioId === ratioId) return prev;
      return { ...prev, outpaint: { ...current, ratioId }, canvas: null };
    });
    return true;
  }
  function setOutpaintAnchor(value) {
    const tool = imageToolOf(draftRef.current.toolId);
    if (!tool || tool.id !== "outpaint") return false;
    const anchor = outpaintAnchorOf(value);
    setDraft((prev) => {
      const current = prev.outpaint || defaultOutpaint();
      if (current.anchor.x === anchor.x && current.anchor.y === anchor.y) return prev;
      return { ...prev, outpaint: { ...current, anchor }, canvas: null };
    });
    return true;
  }
  function applyOutpaintCanvas(input) {
    const tool = imageToolOf(draftRef.current.toolId);
    if (!tool || tool.id !== "outpaint") return { ok: false, reason: "unsupported" };
    if (!draftRef.current.target) return { ok: false, reason: "no_target" };
    const candidate = input && typeof input === "object" ? input : {};
    const canvas = normalizeOutpaintCanvas(candidate);
    if (!canvas) {
      const image = normalizeMaskData(candidate.image);
      const mask = normalizeMaskData(candidate.mask);
      if (!image || !mask) return { ok: false, reason: "invalid" };
      if (base64BytesOf(image) > Number(LIMITS.reference.maxBytes)) return { ok: false, reason: "too_large" };
      if (base64BytesOf(mask) > Number(LIMITS.mask.maxBytes)) return { ok: false, reason: "too_large" };
      return { ok: false, reason: "invalid" };
    }
    setDraft((prev) => ({ ...prev, canvas }));
    return { ok: true, canvas };
  }
  function clearWorkDraft(value) {
    const key = draftKeyOf(value);
    if (!key) return false;
    removeWorkDraft(key);
    if (draftKeyOf(draftRef.current.target) === key) {
      setDraft(emptyDraft());
      setEditorOpen(false);
    }
    return true;
  }
  function workDraftSummary2(value) {
    const key = draftKeyOf(value);
    if (!key) return workDraftSummary(null);
    return workDraftSummary(workDrafts[key] || null);
  }
  function patchDraft(patch) {
    const partial = patch && typeof patch === "object" ? patch : null;
    if (!partial) return false;
    setDraft((prev) => ({ ...prev, ...partial }));
    return true;
  }
  async function submit() {
    if (inFlightRef.current) return false;
    const current = draftRef.current;
    const tool = imageToolOf(current.toolId);
    if (!tool || !tool.ready) return false;
    if (tool.form === "instant") return sendInstant(tool, current.target);
    const currentPreset = list.find((item) => item.id === current.presetId) || null;
    const blocked = imageToolBlockedKeyOf({
      tool: tool.id,
      target: current.target,
      targetPath: current.target ? current.target.path : "",
      preset: currentPreset,
      prompt: current.prompt,
      targetPrompt: current.target ? current.target.prompt : "",
      mask: current.mask,
      canvas: current.canvas
    });
    if (blocked) {
      ui.showToast(t(blocked));
      return false;
    }
    const negativeActive = negativePromptActive(currentPreset, currentPreset && currentPreset.cfg);
    let body = null;
    if (tool.id === "outpaint") {
      body = buildOutpaintToolBody({
        target: current.target,
        targetPath: current.target.path,
        targetPrompt: current.target.prompt,
        preset: currentPreset,
        presets: list,
        prompt: current.prompt,
        strength: current.strength,
        canvas: current.canvas,
        negativeActive
      });
    } else {
      body = buildImageToolBody({
        tool: tool.id,
        targetPath: current.target.path,
        targetPrompt: current.target.prompt,
        target: current.target,
        preset: currentPreset,
        presets: list,
        prompt: current.prompt,
        strength: current.strength,
        mask: current.mask,
        negativeActive
      });
    }
    if (!body) {
      ui.showToast(t(tool.id === "outpaint" ? "studio.outpaint.blockedCanvas" : "studio.imageTool.blockedTarget"));
      return false;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    ui.setError(null);
    try {
      const result = await alive(submitGenerate(body));
      if (!result) return false;
      if (result.ok && result.data && result.data.id) {
        setPendingTool({
          jobId: result.data.id,
          target: current.target,
          body,
          // 阶段十三：幽灵节点溯源（Host /state 快照里 params.reference.sourcePath 也能推断，
          // 这里再补一份客户端已知的根，父图在更早分页时版本面板仍能挂对位置）。
          parentPath: current.target.path,
          rootImage: current.target.item && current.target.item.rootImage || current.target.path,
          sourceMode: tool.id
        });
        removeWorkDraft(current.target.path);
        setDraft(emptyDraft());
        setEditorOpen(false);
        ui.showToast(t("studio.imageTool.submitted"));
        if (typeof onSubmitted === "function") {
          onSubmitted(result.data, { tool: tool.id, target: current.target, body });
        }
        return true;
      }
      setEditorOpen(false);
      ui.fail(result.code, result.message);
      return false;
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }
  return {
    // 工具与底图：activeTool 关闭编辑态后仍保留（草稿的 owner），用 editorOpen 区分是否在编辑。
    activeTool,
    target: draft.target,
    // 工具自己的提示词输入（默认空；提交时为空回退目标作品提示词）。
    prompt: draft.prompt,
    setPrompt,
    // 强度：自动档跟随预设推荐档，用户拖动后退出自动档。
    strength,
    strengthMax,
    strengthAuto: draft.strengthAuto,
    setStrength,
    // 工具预设：不回写左栏 form.presetId。
    presetId: draft.presetId,
    preset,
    toolPresets,
    selectPreset,
    // 蒙版：{ data, coverage, digest } | null。
    mask: draft.mask,
    coverage,
    applyMask,
    clearMask,
    // 扩图草稿：小对象进 workDrafts；canvas（大 base64）只留在活动草稿内存里，
    // 关闭编辑态 / 重开时由 OutpaintEditor 按 outpaint 重新导出。
    outpaint: {
      ratioId: outpaint.ratioId,
      anchor: outpaint.anchor,
      canvas: draft.canvas
    },
    setOutpaintRatio,
    setOutpaintAnchor,
    applyOutpaintCanvas,
    // 编辑态与提交。
    editorOpen,
    openTool,
    closeTool,
    discardTool,
    canSubmit,
    submitBlockedKey: blockedKey,
    submitting,
    submit,
    // 即时工具（高清放大）的显式入口：点击动作坞已经由 openTool 直达提交，
    // 这里导出方便渲染测试与后续「大图预览里的放大按钮」复用。
    submitInstant,
    // 阶段十三：按作品路径缓存的未提交编辑草稿（LRU 8，会话内内存、不落盘）。
    workDrafts,
    clearWorkDraft,
    workDraftSummary: workDraftSummary2,
    patchDraft,
    // 成功提交的任务信息，供失败重试恢复 / 阶段十三幽灵节点使用。
    pendingTool
  };
}

// src/studio/hooks/useKaggleLogin.js
var import_react42 = __toESM(require("react"), 1);
var NETWORK_ERROR_KEY = "studio.guidance.auth.reason.network";
var REQUEST_ERROR_KEY = "studio.guidance.auth.reason.request";
var UNAVAILABLE_ERROR_KEY = "studio.guidance.auth.reason.unavailable";
var TIMEOUT_ERROR_KEY = "studio.guidance.auth.reason.timeout";
var KAGGLE_API = {
  fetch: fetchKaggleLogin,
  start: startKaggleLogin,
  cancel: cancelKaggleLogin,
  submitCode: submitKaggleLoginCode
};
var COLAB_API = {
  fetch: fetchColabLogin,
  start: startColabLogin,
  cancel: cancelColabLogin,
  submitCode: submitColabLoginCode
};
function useOAuthLogin({ t, ui, onDone, api = KAGGLE_API } = {}) {
  const translate = typeof t === "function" ? t : (key) => key;
  const [login, setLogin] = import_react42.default.useState(emptyLoginView);
  const [busy, setBusy] = import_react42.default.useState(false);
  const [errorKey, setErrorKey] = import_react42.default.useState("");
  const [codeErrorKey, setCodeErrorKey] = import_react42.default.useState("");
  const timerRef = import_react42.default.useRef(null);
  const startedAtRef = import_react42.default.useRef(0);
  const busyRef = import_react42.default.useRef(false);
  const sessionRef = import_react42.default.useRef(0);
  const aliveRef = import_react42.default.useRef(true);
  const viewRef = import_react42.default.useRef(emptyLoginView());
  const onDoneRef = import_react42.default.useRef(onDone);
  onDoneRef.current = onDone;
  const apiRef = import_react42.default.useRef(api);
  apiRef.current = api;
  function toast(key) {
    if (ui && typeof ui.showToast === "function") ui.showToast(translate(key));
  }
  function markBusy(next) {
    busyRef.current = next;
    setBusy(next);
  }
  function stopPolling() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  function schedulePoll(token2) {
    if (timerRef.current !== null || !aliveRef.current || sessionRef.current !== token2) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      tick2(token2);
    }, KAGGLE_LOGIN.pollMs);
  }
  function commitView(view, token2) {
    if (!aliveRef.current || sessionRef.current !== token2) return false;
    viewRef.current = view;
    setLogin(view);
    setErrorKey("");
    return true;
  }
  function failOnce(key, token2) {
    if (!aliveRef.current || token2 !== void 0 && sessionRef.current !== token2) return;
    stopPolling();
    const base = viewRef.current && typeof viewRef.current === "object" ? viewRef.current : emptyLoginView();
    const view = { ...base, state: "failed", message: null, finishedAt: (/* @__PURE__ */ new Date()).toISOString() };
    viewRef.current = view;
    setLogin(view);
    setErrorKey(key);
    toast(key);
  }
  function failFromResult(result, token2) {
    const code = result && typeof result.code === "string" ? result.code : "";
    const status = result && Number.isFinite(result.status) ? result.status : 0;
    if (status === 404 || code === "http_404") failOnce(UNAVAILABLE_ERROR_KEY, token2);
    else if (code === "network") failOnce(NETWORK_ERROR_KEY, token2);
    else failOnce(REQUEST_ERROR_KEY, token2);
  }
  function applyTerminalOrPending(view, token2) {
    if (!commitView(view, token2)) return;
    if (view.state === "done") {
      stopPolling();
      if (typeof onDoneRef.current === "function") onDoneRef.current(view);
      toast("studio.guidance.auth.loginDone");
      return;
    }
    if (!isLoginPending(view)) {
      stopPolling();
      return;
    }
    schedulePoll(token2);
  }
  async function tick2(token2) {
    if (!aliveRef.current || sessionRef.current !== token2) return;
    if (loginTimedOut(startedAtRef.current, Date.now())) {
      failOnce(TIMEOUT_ERROR_KEY, token2);
      return;
    }
    const result = await apiRef.current.fetch();
    if (!aliveRef.current || sessionRef.current !== token2) return;
    const view = loginViewOf(result);
    if (!view) {
      failFromResult(result, token2);
      return;
    }
    applyTerminalOrPending(view, token2);
  }
  async function start() {
    if (busyRef.current) return;
    const token2 = sessionRef.current + 1;
    sessionRef.current = token2;
    stopPolling();
    markBusy(true);
    setErrorKey("");
    setCodeErrorKey("");
    const result = await apiRef.current.start();
    if (!aliveRef.current || sessionRef.current !== token2) return;
    markBusy(false);
    const view = loginViewOf(result);
    if (!view) {
      failFromResult(result, token2);
      return;
    }
    startedAtRef.current = Date.now();
    if (!commitView(view, token2)) return;
    if (view.state === "done") {
      stopPolling();
      if (typeof onDoneRef.current === "function") onDoneRef.current(view);
      toast("studio.guidance.auth.loginDone");
      return;
    }
    if (isLoginPending(view)) schedulePoll(token2);
  }
  async function cancel() {
    const token2 = sessionRef.current + 1;
    sessionRef.current = token2;
    stopPolling();
    markBusy(true);
    const result = await apiRef.current.cancel();
    if (!aliveRef.current || sessionRef.current !== token2) return;
    markBusy(false);
    const view = loginViewOf(result);
    const base = view || viewRef.current || emptyLoginView();
    const cancelled = {
      ...base,
      state: "cancelled",
      message: null,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    viewRef.current = cancelled;
    setLogin(cancelled);
    setErrorKey("");
    setCodeErrorKey("");
    toast("studio.guidance.auth.cancelled");
  }
  async function submit(raw) {
    const check = validateLoginCode(raw);
    if (!check.ok) {
      setCodeErrorKey(check.message);
      return false;
    }
    setCodeErrorKey("");
    if (busyRef.current) return false;
    const token2 = sessionRef.current;
    markBusy(true);
    const result = await apiRef.current.submitCode(check.code);
    if (!aliveRef.current || sessionRef.current !== token2) return false;
    markBusy(false);
    const view = loginViewOf(result);
    if (!view) {
      failFromResult(result, token2);
      return false;
    }
    applyTerminalOrPending(view, token2);
    return true;
  }
  function reset() {
    sessionRef.current += 1;
    stopPolling();
    viewRef.current = emptyLoginView();
    setLogin(viewRef.current);
    markBusy(false);
    setErrorKey("");
    setCodeErrorKey("");
  }
  import_react42.default.useEffect(() => {
    aliveRef.current = true;
    function onVisibility() {
      if (document.hidden) {
        stopPolling();
        return;
      }
      if (isLoginPending(viewRef.current)) schedulePoll(sessionRef.current);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      aliveRef.current = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return {
    login,
    // pending = 登录会话仍在进行（请求在途或等待授权），用于禁用重复发起。
    pending: busy || isLoginPending(login),
    busy,
    errorKey: errorKey || loginFailureKey(login),
    codeErrorKey,
    start,
    cancel,
    submit,
    reset
  };
}
function useKaggleLogin(options = {}) {
  return useOAuthLogin({ ...options, api: KAGGLE_API });
}
function useColabLogin(options = {}) {
  return useOAuthLogin({ ...options, api: COLAB_API });
}

// src/studio/hooks/useReferenceSlot.js
var import_react43 = __toESM(require("react"), 1);
function useReferenceSlot({ t, alive, ui, form, library }) {
  const [busy, setBusy] = import_react43.default.useState(false);
  const busyRef = import_react43.default.useRef(false);
  function toast(key, params) {
    if (!ui || typeof ui.showToast !== "function") return;
    ui.showToast(formatText(t(key), params));
  }
  function remainingOf() {
    return referenceMaxCount() - referenceListOf(form.form.references).length;
  }
  async function uploadFiles(files) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (list.length === 0 || busyRef.current) return 0;
    let remaining = remainingOf();
    if (remaining <= 0) {
      toast("studio.reference.full", { max: referenceMaxCount() });
      return 0;
    }
    busyRef.current = true;
    setBusy(true);
    let added = 0;
    try {
      if (list.length > remaining) toast("studio.reference.limit", { max: referenceMaxCount() });
      for (const file of list) {
        if (remaining <= 0) break;
        const fileError = referenceFileErrorOf(file);
        if (fileError) {
          toast(fileError.key, fileError.params);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file).catch(() => "");
        if (!dataUrl) {
          toast("studio.reference.importFailed");
          continue;
        }
        const precheck = importPrecheckOf({ file, dataUrl });
        if (!precheck.ok) {
          toast(precheck.errorKey, precheck.params);
          continue;
        }
        const result = await alive(importImageFile({ data: precheck.dataUrl, name: precheck.name || void 0 }));
        if (!result) return added;
        const entry = result.ok && result.data ? result.data.entry : null;
        if (!entry) {
          toast("studio.reference.importFailed");
          continue;
        }
        const outcome = form.addReference(entry);
        if (outcome.ok) {
          added += 1;
          remaining -= 1;
          continue;
        }
        if (outcome.reason === "duplicate") toast("studio.reference.duplicate");
        else if (outcome.reason === "full") toast("studio.reference.full", { max: referenceMaxCount() });
        else toast("studio.reference.invalidPath");
      }
      if (added > 0) {
        toast("studio.reference.added", { count: added });
        if (library && typeof library.loadHistory === "function") library.loadHistory();
      }
    } catch {
      toast("studio.reference.importFailed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    return added;
  }
  return { busy, uploadFiles };
}

// src/studio/hooks/useSessionControl.js
var import_react44 = __toESM(require("react"), 1);

// src/logic/update.js
function safeUrl(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return "";
  return value;
}
function updateOf(state) {
  const input = state && typeof state === "object" ? state.update : null;
  if (!input || typeof input !== "object") return null;
  if (input.hasUpdate !== true) return null;
  const latest = typeof input.latest === "string" ? input.latest.trim() : "";
  if (!latest) return null;
  const current = typeof input.current === "string" && input.current.trim() ? input.current.trim() : typeof state.version === "string" ? state.version : "";
  const enginesDsh = typeof input.enginesDsh === "string" ? input.enginesDsh.trim() : "";
  const checkedAt = typeof input.checkedAt === "string" && input.checkedAt.trim() ? input.checkedAt.trim() : null;
  return {
    latest,
    current,
    enginesDsh,
    releaseUrl: safeUrl(input.releaseUrl),
    checkedAt
  };
}

// src/studio/hooks/useSessionControl.js
function rememberCancelling(previous, id) {
  if (!Array.isArray(previous)) return [id];
  return previous.includes(id) ? previous : [...previous, id];
}
function useSessionControl({ t, host, ui, alive }) {
  const [busy, setBusy] = import_react44.default.useState("");
  const [probing, setProbing] = import_react44.default.useState(false);
  const [probeReport, setProbeReport] = import_react44.default.useState(null);
  const [cancellingIds, setCancellingIds] = import_react44.default.useState([]);
  const cancellingRef = import_react44.default.useRef(/* @__PURE__ */ new Set());
  const startingRef = import_react44.default.useRef(false);
  const state = host.state;
  const session = state && state.session || null;
  const kaggleTransport = transportOf(state);
  const sessionState = session && session.state || "absent";
  const pendingJobs = pendingJobsOf(state);
  const activeJob = pendingJobs[0] ?? null;
  const focusedJob = activeJob || state && state.lastJob || stateJobs(state)[0] || null;
  const queuePolicy = queuePolicyOf(state);
  const status = computeStatusOf(t, { session, queuePolicy, now: Date.now() });
  const update = updateOf(state);
  const queue = {
    policy: queuePolicy,
    level: status.queueLevel,
    waitMs: status.queueWaitMs,
    key: queueRoundKeyOf(session),
    stalledMinutes: queueStalledMinutesOf(queuePolicy)
  };
  const pendingSignature = pendingJobs.map((job) => job.id).join(",");
  import_react44.default.useEffect(() => {
    const activeIds = new Set(pendingJobs.map((job) => job.id));
    for (const id of [...cancellingRef.current]) {
      if (!activeIds.has(id)) cancellingRef.current.delete(id);
    }
    setCancellingIds((prev) => {
      const next = prev.filter((id) => activeIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [pendingSignature]);
  const hostErrorKeyRef = import_react44.default.useRef("");
  const hostErrorCodeRef = import_react44.default.useRef("");
  import_react44.default.useEffect(() => {
    if (!host.error) {
      if (!hostErrorCodeRef.current) return;
      const code = hostErrorCodeRef.current;
      hostErrorKeyRef.current = "";
      hostErrorCodeRef.current = "";
      ui.setError((prev) => prev && prev.code === code ? null : prev);
      return;
    }
    const key = `${host.error.code}|${host.error.message ?? ""}`;
    if (hostErrorKeyRef.current === key) return;
    hostErrorKeyRef.current = key;
    hostErrorCodeRef.current = host.error.code;
    ui.setError((prev) => prev || { code: host.error.code, message: host.error.message ?? "" });
  }, [host.error]);
  async function requestStart(presetId, options) {
    if (busy || startingRef.current) return;
    startingRef.current = true;
    setBusy("start");
    try {
      const result = await alive(startSession(presetId, options));
      if (!result) return;
      if (!result.ok) ui.fail(result.code, result.message);
      else ui.setError(null);
      host.refresh();
    } finally {
      startingRef.current = false;
      setBusy("");
    }
  }
  function startSession2(presetId, options = {}) {
    return requestStart(presetId, options);
  }
  function requeueSession(presetId) {
    return requestStart(presetId, { forceNew: true, replace: true });
  }
  async function stopSession2() {
    if (busy) return;
    setBusy("stop");
    try {
      const result = await alive(stopSession());
      if (!result) return;
      if (!result.ok) ui.fail(result.code, result.message);
      host.refresh();
    } finally {
      setBusy("");
    }
  }
  async function cancelJob2(id) {
    const target = typeof id === "string" ? id.trim() : "";
    if (!target || cancellingRef.current.has(target)) return;
    cancellingRef.current.add(target);
    setCancellingIds((prev) => rememberCancelling(prev, target));
    const result = await alive(cancelJob(target));
    if (!result) return;
    if (!result.ok) {
      cancellingRef.current.delete(target);
      setCancellingIds((prev) => prev.filter((item) => item !== target));
      ui.fail(result.code, result.message);
      return;
    }
    const job = result.data && result.data.job ? result.data.job : null;
    const disposition = result.data && result.data.disposition;
    if (disposition === "already-finished") {
      host.refresh();
      return;
    }
    const images = Array.isArray(job && job.output && job.output.images) ? job.output.images.length : 0;
    const progressDone = Number(job && job.progress && job.progress.done);
    const kept = images > 0 ? images : Number.isFinite(progressDone) && progressDone > 0 ? Math.floor(progressDone) : 0;
    if (kept > 0) ui.showToast(formatText(t("studio.toast.cancelPartial"), { done: kept }));
    else ui.showToast(t("studio.toast.cancelled"));
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
    const timer2 = setTimeout(() => controller.abort(), TIMEOUTS.clientProbeMs);
    try {
      const result = await alive(runProbe(controller.signal));
      if (!result) return;
      if (!result.ok) {
        setProbeReport({ status: result.code === "timeout" ? "timeout" : "failed", message: result.message, probe: null });
        ui.showToast(result.code === "timeout" ? t("studio.probe.timeout") : t("studio.probe.failed"));
        return;
      }
      const outcome = probeOutcomeOf(result.data, { transport: kaggleTransport });
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
    } finally {
      clearTimeout(timer2);
      setProbing(false);
    }
  }
  return {
    session,
    sessionState,
    kaggleTransport,
    status,
    queue,
    update,
    pendingJobs,
    activeJob,
    focusedJob,
    quota: state && state.probe && state.probe.quota || null,
    probe: state && state.probe || null,
    busy,
    probing,
    probeReport,
    startSession: startSession2,
    requeueSession,
    stopSession: stopSession2,
    cancelJob: cancelJob2,
    cancellingIds,
    runProbe: runProbe2,
    openFolder
  };
}

// src/studio/hooks/useStudioForm.js
var import_react45 = __toESM(require("react"), 1);

// src/logic/form.js
var SNAPSHOT_FIELDS = ["prompt", "negative", "presetId", "seed"];
function textOf4(value) {
  return typeof value === "string" ? value : String(value ?? "");
}
function numberish(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function formSnapshotOf(form) {
  const input = form && typeof form === "object" ? form : {};
  const snapshot2 = {};
  for (const field of SNAPSHOT_FIELDS) {
    snapshot2[field] = field === "seed" ? textOf4(input.seed).trim() : textOf4(input[field]);
  }
  snapshot2.width = numberish(input.width);
  snapshot2.height = numberish(input.height);
  snapshot2.steps = numberish(input.steps);
  snapshot2.cfg = numberish(input.cfg);
  snapshot2.count = numberish(input.count);
  snapshot2.references = referenceFingerprintOf(input.references);
  return JSON.stringify(snapshot2);
}
function isFormDirty(form, baseline) {
  if (typeof baseline !== "string" || baseline === "") return false;
  return formSnapshotOf(form) !== baseline;
}
function newCreationPatch(form, preset) {
  const input = form && typeof form === "object" ? form : {};
  const active = preset && typeof preset === "object" ? preset : null;
  const cfg = Number(input.cfg);
  const negativeActive = negativePromptActive(active, Number.isFinite(cfg) ? cfg : void 0);
  const layers = normalizeNegativeLayers({
    model: negativeActive ? hintOf(active) : "",
    user: ""
  });
  return {
    prompt: "",
    seed: "",
    references: [],
    ...negativeLayersPatch(layers)
  };
}
function draftSourceOf(entry, patch) {
  const image = entry && entry.image || {};
  const item = entry && entry.item || {};
  const params = item && item.params || {};
  const path = typeof image.path === "string" && image.path ? image.path : typeof image.file === "string" ? image.file : "";
  const prompt = typeof item.prompt === "string" && item.prompt || typeof params.prompt === "string" && params.prompt || (typeof image.file === "string" ? image.file : "");
  const cleanPatch = patch && typeof patch === "object" ? { ...patch } : {};
  return { path, prompt, patch: cleanPatch };
}
function originalPatchOf(source) {
  const patch = source && source.patch && typeof source.patch === "object" ? source.patch : null;
  if (!patch || Object.keys(patch).length === 0) return null;
  return { ...patch };
}
function parkDraftOf(draft, source, form) {
  const prev = draft && typeof draft === "object" && draft.form ? draft : null;
  const shape = form && typeof form === "object" ? form : null;
  if (!shape) return prev;
  const nextSource = source && typeof source === "object" ? source : prev && prev.source || null;
  return { source: nextSource, form: shape, editing: false };
}
function draftViewOf(state = {}) {
  const draft = state.draft && typeof state.draft === "object" && state.draft.form ? state.draft : null;
  const origin = state.origin && typeof state.origin === "object" ? state.origin : null;
  const source = draft ? draft.source || null : origin;
  return {
    active: Boolean(draft) || state.dirty === true,
    parked: Boolean(draft),
    editing: Boolean(draft && draft.editing === true),
    source,
    form: draft ? draft.form : null
  };
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
  // 负向提示词的两层来源：模型推荐 / 用户手写，合并结果见 negative。
  negativeLayers: { model: "", user: "" },
  presetId: "",
  width: 1024,
  height: 1024,
  steps: 4,
  cfg: 0,
  seed: "",
  count: 1,
  // 原生参考图槽（Phase C2）：槽位项 `{ path, url, width, height, name }`，上限见契约。
  references: []
};
function useStudioForm({ t, isEn, alive, ui, preset, initialPrompt }) {
  const { presets, defaultPreset } = preset;
  const [form, setForm] = import_react45.default.useState(() => ({
    ...EMPTY_FORM,
    prompt: initialPrompt
  }));
  const [refineGroups, setRefineGroups] = import_react45.default.useState([]);
  const [refineSource, setRefineSource] = import_react45.default.useState("");
  const [enhancing, setEnhancing] = import_react45.default.useState(false);
  const [translating, setTranslating] = import_react45.default.useState(false);
  const [cleanBaseline, setCleanBaseline] = import_react45.default.useState("");
  const [origin, setOrigin] = import_react45.default.useState(null);
  const [draft, setDraft] = import_react45.default.useState(null);
  const formRef = import_react45.default.useRef(form);
  formRef.current = form;
  const originRef = import_react45.default.useRef(origin);
  originRef.current = origin;
  const draftRef = import_react45.default.useRef(draft);
  draftRef.current = draft;
  const dirty = isFormDirty(form, cleanBaseline);
  const draftView = draftViewOf({ draft, dirty, origin });
  const ratioId = ratioIdOf(form.width, form.height);
  const activePreset = presets.find((item) => item.id === form.presetId) || null;
  const negativeHint = hintOf(activePreset);
  const negativeActive = negativePromptActive(activePreset, form.cfg);
  const englishPromptHint = detectCjk(form.prompt) && presetNeedsEnglish(activePreset);
  const referenceSupported = supportsReferenceOf(activePreset);
  const referenceSwitchPreset = nativeReferencePresetOf(presets);
  const referenceSwitchLabel = referenceSwitchPreset ? presetLabelOf(referenceSwitchPreset) : "";
  const referenceMax = referenceMaxCount();
  import_react45.default.useEffect(() => {
    if (presets.length === 0) return;
    setForm((prev) => {
      if (prev.presetId && presets.some((item2) => item2.id === prev.presetId)) return prev;
      const initial = presets.some((item2) => item2.id === defaultPreset) ? defaultPreset : presets[0].id;
      const item = presets.find((option) => option.id === initial);
      if (!item) return prev;
      return applyNegativePatch(prev, presetSelectPatch(item, prev, presets));
    });
  }, [presets.length, defaultPreset]);
  import_react45.default.useEffect(() => {
    if (cleanBaseline || !form.presetId) return;
    setCleanBaseline(formSnapshotOf(form));
  }, [cleanBaseline, form.presetId]);
  function patchForm(partial) {
    const next = applyNegativePatch(formRef.current, partial);
    formRef.current = next;
    setForm(next);
  }
  function selectPreset(next) {
    if (!next || !next.id) return;
    const updated = applyNegativePatch(formRef.current, presetSelectPatch(next, formRef.current, presets));
    formRef.current = updated;
    setForm(updated);
  }
  function addReference(value) {
    const result = referenceAdd(formRef.current.references, value);
    if (result.ok) {
      const next = { ...formRef.current, references: result.list };
      formRef.current = next;
      setForm(next);
    }
    return result;
  }
  function removeReference(path) {
    const current = formRef.current.references;
    if (!referenceHas(current, path)) return current;
    const nextList = referenceRemove(current, path);
    const next = { ...formRef.current, references: nextList };
    formRef.current = next;
    setForm(next);
    return nextList;
  }
  function markClean(submitted) {
    if (submitted && formRef.current !== submitted) return false;
    setCleanBaseline(formSnapshotOf(formRef.current));
    return true;
  }
  function applyRecall(patch, entry) {
    const partial = patch && typeof patch === "object" ? { ...patch } : {};
    if (Object.keys(partial).length === 0) return false;
    partial.references = [];
    const next = applyNegativePatch(formRef.current, partial);
    setForm(next);
    setCleanBaseline(formSnapshotOf(next));
    setOrigin(draftSourceOf(entry, partial));
    return true;
  }
  function newCreation() {
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset));
    setForm(next);
    setCleanBaseline(formSnapshotOf(next));
    setOrigin(null);
    setDraft(null);
    ui.showToast(t("studio.toast.newCreation"));
  }
  function detachOrigin() {
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset));
    setForm(next);
    setCleanBaseline(formSnapshotOf(next));
    setOrigin(null);
    formRef.current = next;
    originRef.current = null;
    return true;
  }
  function clearOrigin() {
    if (!originRef.current) return false;
    originRef.current = null;
    setOrigin(null);
    return true;
  }
  function forgetRemovedPaths(paths) {
    const removed = new Set((Array.isArray(paths) ? paths : []).filter(Boolean));
    if (removed.size === 0) return false;
    let changed = false;
    const currentOrigin = originRef.current;
    if (currentOrigin && currentOrigin.path && removed.has(currentOrigin.path)) {
      setOrigin(null);
      originRef.current = null;
      changed = true;
    }
    const currentDraft = draftRef.current;
    if (currentDraft && currentDraft.source && removed.has(currentDraft.source.path)) {
      const next = { ...currentDraft, source: null };
      setDraft(next);
      draftRef.current = next;
      changed = true;
    }
    const currentRefs = formRef.current.references;
    if (Array.isArray(currentRefs) && currentRefs.length > 0) {
      const keptRefs = referencePurgeOf(currentRefs, [...removed]);
      if (keptRefs.length !== currentRefs.length) {
        const next = { ...formRef.current, references: keptRefs };
        formRef.current = next;
        setForm(next);
        changed = true;
      }
    }
    return changed;
  }
  function parkDraft() {
    const prev = draftRef.current;
    const parked = prev && prev.editing === true;
    if (!dirty && !parked) return prev;
    const next = parkDraftOf(prev, originRef.current, formRef.current);
    if (next !== prev) {
      draftRef.current = next;
      setDraft(next);
    }
    return next;
  }
  function openDraft() {
    const prev = draftRef.current;
    if (prev && prev.form) {
      setForm(prev.form);
      setCleanBaseline(formSnapshotOf(prev.form));
      const nextOrigin = prev.source || null;
      setOrigin(nextOrigin);
      originRef.current = nextOrigin;
      setDraft({ ...prev, editing: true });
      return true;
    }
    if (!dirty) return false;
    const next = parkDraftOf(null, originRef.current, formRef.current);
    setDraft({ ...next, editing: true });
    setCleanBaseline(formSnapshotOf(formRef.current));
    return true;
  }
  function clearDraft() {
    if (draftRef.current) setDraft(null);
  }
  function restoreOriginal() {
    const prev = draftRef.current;
    const source = prev && prev.source || originRef.current;
    const patch = originalPatchOf(source);
    if (!patch) return null;
    const next = applyNegativePatch(formRef.current, { ...patch, references: [] });
    setForm(next);
    setCleanBaseline(formSnapshotOf(next));
    setOrigin(source);
    setDraft(null);
    return source;
  }
  import_react45.default.useEffect(() => {
    const current = draftRef.current;
    if (!current || current.editing !== true || current.form === form) return;
    setDraft({ ...current, form });
  }, [form]);
  function buildBody(overrides, options = {}) {
    const presetOverride = options.preset && typeof options.preset === "object" ? options.preset : null;
    const effectivePreset = presetOverride || activePreset;
    const effectiveCfg = overrides && Object.prototype.hasOwnProperty.call(overrides, "cfg") ? overrides.cfg : form.cfg;
    return buildGenerateBody(
      {
        ...form,
        presetId: effectivePreset ? effectivePreset.id : form.presetId,
        negative: negativePromptOf(form)
      },
      {
        defaultPreset,
        overrides,
        negativeActive: negativePromptActive(effectivePreset, effectiveCfg)
      }
    );
  }
  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id);
    if (!ratio) return;
    const size = ratioToSize(ratio);
    patchForm({ width: size.width, height: size.height });
  }
  function applyCfg(value) {
    const next = clampNumber(value, LIMITS.cfg.min, LIMITS.cfg.max, form.cfg);
    setForm((prev) => {
      const current = presets.find((item) => item.id === prev.presetId) || null;
      const patch = { cfg: next };
      const wasActive = negativePromptActive(current, prev.cfg);
      const isActive = negativePromptActive(current, next);
      if (!wasActive && isActive) {
        const layers = resolveNegativeLayers(prev, presets);
        const hint = hintOf(current);
        if (!layers.model && hint) Object.assign(patch, negativeLayersPatch({ ...layers, model: hint }));
      }
      return applyNegativePatch(prev, patch);
    });
  }
  function resetSeed() {
    patchForm({ seed: "" });
  }
  function applyIntent(intent) {
    if (!intent || typeof intent !== "object") return false;
    const prompt = typeof intent.prompt === "string" ? intent.prompt.trim().slice(0, LIMITS.prompt.maxChars) : "";
    if (!prompt) return false;
    const patch = {
      prompt,
      count: clampInt(intent.count, LIMITS.count.min, LIMITS.count.max, 1)
    };
    const ratio = DEFAULT_RATIOS.find((item) => item.id === intent.ratioId);
    if (ratio) {
      const size = ratioToSize(ratio);
      patch.width = size.width;
      patch.height = size.height;
    }
    if (negativeActive && typeof intent.negative === "string") {
      patch.negative = intent.negative.trim().slice(0, LIMITS.negativePrompt.maxChars);
    }
    patchForm(patch);
    return true;
  }
  function applyCustomSize(partial) {
    patchForm(customSizePatch(partial));
  }
  async function enhance() {
    if (enhancing) return;
    if (!form.prompt.trim()) {
      ui.showToast(t("studio.promptHint"));
      return;
    }
    setEnhancing(true);
    try {
      const result = await alive(enhancePromptRequest({
        prompt: form.prompt,
        presetId: form.presetId,
        locale: isEn ? "en" : "zh"
      }));
      if (!result) return;
      if (result.ok && result.data && Array.isArray(result.data.groups)) {
        const groups = result.data.groups.filter((group) => group && Array.isArray(group.options)).map((group) => ({
          ...group,
          options: group.options.map((option) => {
            const text = option && typeof option.text === "string" ? option.text.trim() : "";
            if (!text) return null;
            const label = option && typeof option.label === "string" && option.label.trim() ? option.label.trim() : text;
            return { ...option, text, label };
          }).filter(Boolean)
        })).filter((group) => group.options.length > 0);
        setRefineGroups(groups);
        setRefineSource(result.data.source === "model" ? "model" : "local");
        return;
      }
      ui.fail(result.code, result.message);
    } finally {
      setEnhancing(false);
    }
  }
  async function translate() {
    if (translating) return;
    if (!form.prompt.trim()) {
      ui.showToast(t("studio.promptHint"));
      return;
    }
    setTranslating(true);
    try {
      const result = await alive(enhancePromptRequest({
        prompt: form.prompt,
        presetId: form.presetId,
        locale: isEn ? "en" : "zh",
        mode: "translate"
      }));
      if (!result) return;
      if (!result.ok) {
        ui.fail(result.code, result.message);
        return;
      }
      const outcome = translateOutcomeOf(result.data);
      if (!outcome.ok) {
        ui.showToast(t("studio.translate.local"));
        return;
      }
      patchForm({ prompt: outcome.prompt });
      ui.showToast(t("studio.translate.done"));
    } finally {
      setTranslating(false);
    }
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
    selectPreset,
    buildBody,
    ratioId,
    activePreset,
    // 原生参考图槽（Phase C2）：槽位本体在 form 上，读写动作与能力派生在这里。
    addReference,
    removeReference,
    referenceSupported,
    referenceSwitchPreset,
    referenceSwitchLabel,
    referenceMax,
    // 脏判定：现在只表示「有一次未提交修改，切作品时会被托管进草稿卡」。
    dirty,
    // 来源作品（面板顶部的轻量提示）：保留 tuning 的旧形状给 Rail / 助手面板使用。
    tuning: origin ? { prompt: origin.prompt, path: origin.path } : null,
    origin,
    markClean,
    applyRecall,
    newCreation,
    // 阶段十五 Phase C0：解除与上一张作品的绑定、删除作品后的引用清理。
    detachOrigin,
    clearOrigin,
    forgetRemovedPaths,
    // 草稿托管（阶段十五 A1）：draftView 是展示用派生状态，四个动作由组合层在切换点调用。
    draft,
    draftView,
    draftEditing: Boolean(draftView && draftView.editing),
    parkDraft,
    openDraft,
    clearDraft,
    restoreOriginal,
    // 排除项：是否可用 / 模型推荐词（供显隐、占位与配置抬升时自动补词）。
    negativeActive,
    negativeHint,
    negativeLayers: form.negativeLayers,
    englishPromptHint,
    applyRatio,
    applyCustomSize,
    applyCfg,
    resetSeed,
    applyIntent,
    refineGroups: refineGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, applied: isRefineApplied(form.prompt, option.text) }))
    })),
    refineSource,
    enhancing,
    enhance,
    translating,
    translate,
    toggleRefine,
    useInspiration
  };
}

// src/studio/hooks/useWorkLibrary.js
var import_react46 = __toESM(require("react"), 1);
var PAGE_SIZE = LIMITS.history.pageSize;
function flattenHistory(items) {
  const images = [];
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
    for (const image of list) images.push({ image, item });
  }
  return images;
}
function applyFavorite(list, target, on) {
  const base = Array.isArray(list) ? list : [];
  if (on) return base.includes(target) ? base : [...base, target];
  return base.filter((item) => item !== target);
}
function mergePendingFavorites(serverList, pendingMap) {
  let merged = Array.isArray(serverList) ? serverList : [];
  for (const [target, entry] of pendingMap.entries()) {
    merged = applyFavorite(merged, target, entry.next);
  }
  return merged;
}
function useWorkLibrary({ t, alive, ui, state, initialWorkspaceMode, onImagesRemoved }) {
  const [selectedPath, setSelectedPath] = import_react46.default.useState("");
  const selectedPathRef = import_react46.default.useRef("");
  selectedPathRef.current = selectedPath;
  const [historyItems, setHistoryItems] = import_react46.default.useState([]);
  const [historyHasMoreState, setHistoryHasMoreState] = import_react46.default.useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = import_react46.default.useState(false);
  const [favorites, setFavorites] = import_react46.default.useState([]);
  const [workspaceMode, setWorkspaceMode] = import_react46.default.useState(() => initialWorkspaceMode === "work" ? "work" : "new_draft");
  const [newDraftExplicit, setNewDraftExplicit] = import_react46.default.useState(false);
  const [newDraftPending, setNewDraftPending] = import_react46.default.useState(false);
  const [treeUnavailable, setTreeUnavailable] = import_react46.default.useState(false);
  const [treeLoadingRoot, setTreeLoadingRoot] = import_react46.default.useState("");
  const pendingNewDraftRef = import_react46.default.useRef("");
  const treeUnavailableRef = import_react46.default.useRef(false);
  const treeLoadedRef = import_react46.default.useRef(/* @__PURE__ */ new Set());
  const tRef = import_react46.default.useRef(t);
  const uiRef = import_react46.default.useRef(ui);
  tRef.current = t;
  uiRef.current = ui;
  const favoritesRef = import_react46.default.useRef(favorites);
  favoritesRef.current = favorites;
  const favSeqRef = import_react46.default.useRef(/* @__PURE__ */ new Map());
  const favPendingRef = import_react46.default.useRef(/* @__PURE__ */ new Map());
  const offsetRef = import_react46.default.useRef(0);
  const hasMoreRef = import_react46.default.useRef(false);
  const loadingMoreRef = import_react46.default.useRef(false);
  const loadHistory = import_react46.default.useCallback(async () => {
    const result = await alive(fetchHistory(PAGE_SIZE, 0));
    if (!result) return null;
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      const items = result.data.items.filter(Boolean);
      setHistoryItems(items);
      offsetRef.current = nextHistoryOffset(Number(result.data.offset) || 0, items.length);
      const more = historyHasMore(result.data, PAGE_SIZE);
      hasMoreRef.current = more;
      setHistoryHasMoreState(more);
      return items;
    }
    if (!result.ok) {
      uiRef.current.fail(result.code, result.message);
    }
    return null;
  }, [alive]);
  const loadMoreHistory = import_react46.default.useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setHistoryLoadingMore(true);
    const offset = offsetRef.current;
    try {
      const result = await alive(fetchHistory(PAGE_SIZE, offset));
      if (!result) return;
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        const page = result.data.items.filter(Boolean);
        setHistoryItems((prev) => mergeHistoryPages(prev, page));
        offsetRef.current = nextHistoryOffset(offset, page.length);
        const more = page.length > 0 && historyHasMore(result.data, PAGE_SIZE);
        hasMoreRef.current = more;
        setHistoryHasMoreState(more);
        return;
      }
      if (!result.ok) uiRef.current.fail(result.code, result.message);
    } finally {
      loadingMoreRef.current = false;
      setHistoryLoadingMore(false);
    }
  }, [alive]);
  import_react46.default.useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const loadLibrary = import_react46.default.useCallback(async () => {
    const result = await alive(fetchLibrary());
    if (!result) return;
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      const merged = mergePendingFavorites(result.data.favorites, favPendingRef.current);
      favoritesRef.current = merged;
      setFavorites(merged);
    } else if (!result.ok) {
      uiRef.current.fail(result.code, result.message);
    }
  }, [alive]);
  import_react46.default.useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);
  const hasState = Boolean(state);
  const baselineRef = import_react46.default.useRef(false);
  const seenJobRef = import_react46.default.useRef("");
  const announcedRef = import_react46.default.useRef(false);
  const lastJob = state && state.lastJob ? state.lastJob : null;
  const lastJobKey = lastJob ? `${lastJob.id}:${lastJob.status}` : "";
  const sessionState = state && state.session && state.session.state || "absent";
  import_react46.default.useEffect(() => {
    if (!hasState) return;
    if (!baselineRef.current) {
      baselineRef.current = true;
      seenJobRef.current = lastJob ? lastJob.id : "";
      return;
    }
    if (!lastJob || lastJob.id === seenJobRef.current) return;
    seenJobRef.current = lastJob.id;
    if (announcedRef.current || lastJob.status !== "done" || sessionState !== "ready") return;
    const images = Array.isArray(lastJob.output?.images) ? lastJob.output.images : [];
    if (images.length === 0) return;
    announcedRef.current = true;
    uiRef.current.showToast(tRef.current("studio.toast.firstImage"));
  }, [hasState, lastJobKey, sessionState]);
  const historyBaselineRef = import_react46.default.useRef(false);
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ""}` : "";
  const lastSeenRef = import_react46.default.useRef("");
  import_react46.default.useEffect(() => {
    if (!hasState) return;
    if (!historyBaselineRef.current) {
      historyBaselineRef.current = true;
      lastSeenRef.current = lastJobId;
      return;
    }
    if (!lastJobId || lastSeenRef.current === lastJobId) return;
    lastSeenRef.current = lastJobId;
    loadHistory();
  }, [hasState, lastJobId, loadHistory]);
  import_react46.default.useEffect(() => {
    const jobId = pendingNewDraftRef.current;
    if (!jobId || !lastJob || lastJob.id !== jobId) return;
    if (lastJob.status === "failed" || lastJob.status === "cancelled") {
      pendingNewDraftRef.current = "";
      setNewDraftPending(false);
      return;
    }
    if (lastJob.status !== "done") return;
    pendingNewDraftRef.current = "";
    setNewDraftPending(false);
    const first = Array.isArray(lastJob.output?.images) ? lastJob.output.images[0] : null;
    setWorkspaceMode("work");
    setSelectedPath(first && first.path ? first.path : "");
  }, [hasState, lastJobId]);
  const gallery = flattenHistory(historyItems);
  const batches = historyItems.map((item) => ({
    key: item.jobId || item.dir || String(item.prompt),
    prompt: item.prompt || "",
    presetId: item.presetId || "",
    entries: (Array.isArray(item.images) ? item.images.filter(Boolean) : []).map((image) => ({ image, item }))
  })).filter((batch) => batch.entries.length > 0);
  const newest = gallery[0] || null;
  const selected = workspaceMode === "new_draft" ? null : selectedPath && gallery.find((entry) => entry.image.path === selectedPath) || newest;
  const pendingJobs = pendingJobsOf(state);
  const pendingSignature = pendingJobs.map((job) => `${job.id}:${job.status}`).join(",");
  const lineage = import_react46.default.useMemo(
    () => buildLineage({ items: historyItems, pendingJobs }),
    [historyItems, pendingSignature]
  );
  function focusDraft() {
    setNewDraftExplicit(true);
    setWorkspaceMode("new_draft");
    setSelectedPath("");
  }
  function newDraft() {
    pendingNewDraftRef.current = "";
    setNewDraftPending(false);
    setNewDraftExplicit(true);
    setWorkspaceMode("new_draft");
    setSelectedPath("");
  }
  function markNewDraftSubmitted(jobId) {
    pendingNewDraftRef.current = typeof jobId === "string" ? jobId : "";
    setNewDraftExplicit(true);
    setNewDraftPending(true);
    setWorkspaceMode("new_draft");
    setSelectedPath("");
  }
  function selectImage(entry) {
    pendingNewDraftRef.current = "";
    setNewDraftPending(false);
    setNewDraftExplicit(false);
    setWorkspaceMode("work");
    const path = entry && entry.image ? entry.image.path : "";
    setSelectedPath(path);
    if (path && entry && entry.item && Array.isArray(entry.item.images) && entry.item.images.length > 0) {
      setHistoryItems((prev) => {
        const exists = prev.some((item) => Array.isArray(item.images) && item.images.some((img) => img && img.path === path));
        return exists ? prev : mergeHistoryPages([entry.item], prev);
      });
    }
  }
  function openMessage(path) {
    if (!path) return;
    pendingNewDraftRef.current = "";
    setNewDraftPending(false);
    setNewDraftExplicit(false);
    setWorkspaceMode("work");
    setSelectedPath(path);
  }
  async function loadTree(root) {
    const path = typeof root === "string" ? root.trim() : "";
    if (!path || treeLoadedRef.current.has(path) || treeUnavailableRef.current) return null;
    treeLoadedRef.current.add(path);
    setTreeLoadingRoot(path);
    try {
      const result = await alive(fetchHistoryTree(path));
      if (!result) {
        treeLoadedRef.current.delete(path);
        return null;
      }
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        const treeItems = result.data.items.filter(Boolean);
        if (treeItems.length > 0) setHistoryItems((prev) => mergeHistoryPages(prev, treeItems));
        return result.data;
      }
      if (result.status === 404 || result.code === "http_404") {
        treeUnavailableRef.current = true;
        setTreeUnavailable(true);
        return null;
      }
      treeLoadedRef.current.delete(path);
      uiRef.current.fail(result.code, result.message);
      return null;
    } finally {
      setTreeLoadingRoot("");
    }
  }
  function isFavorite(path) {
    return Boolean(path) && favorites.includes(String(path));
  }
  async function toggleFavorite(path) {
    const target = String(path ?? "");
    if (!target) return;
    const next = !favoritesRef.current.includes(target);
    const seq = (favSeqRef.current.get(target) || 0) + 1;
    favSeqRef.current.set(target, seq);
    favPendingRef.current.set(target, { seq, next });
    const optimistic = applyFavorite(favoritesRef.current, target, next);
    favoritesRef.current = optimistic;
    setFavorites(optimistic);
    const result = await alive(favoriteImage(target, next));
    if (!result) return;
    if (favSeqRef.current.get(target) !== seq) return;
    favPendingRef.current.delete(target);
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      const merged = mergePendingFavorites(result.data.favorites, favPendingRef.current);
      favoritesRef.current = merged;
      setFavorites(merged);
      uiRef.current.showToast(next ? tRef.current("studio.toast.favorited") : tRef.current("studio.toast.unfavorited"));
      return;
    }
    setFavorites((prev) => {
      const rolled = applyFavorite(prev, target, !next);
      favoritesRef.current = rolled;
      return rolled;
    });
    uiRef.current.fail(result.code, result.message);
  }
  async function deleteImages2(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (list.length === 0) return;
    const result = await alive(deleteImages(list));
    if (!result) return;
    if (!result.ok) {
      uiRef.current.fail(result.code, result.message);
      return null;
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : [];
    if (removed.length > 0) uiRef.current.showToast(tRef.current("studio.toast.deleted"));
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      uiRef.current.fail("delete_failed", tRef.current("studio.error.deleteFailed"));
    }
    const removedSet = new Set(removed);
    const selectedRemoved = removedSet.has(selectedPathRef.current);
    if (selectedRemoved) setSelectedPath("");
    const [items] = await Promise.all([loadHistory(), loadLibrary()]);
    const failed = Array.isArray(result.data.failed) ? result.data.failed : [];
    if (removed.length > 0 && typeof onImagesRemoved === "function") {
      const fallback = flattenHistory(Array.isArray(items) ? items : []).find(
        (entry) => entry.image && entry.image.path && !removedSet.has(entry.image.path)
      ) || null;
      if (selectedRemoved && fallback) setSelectedPath(fallback.image.path);
      onImagesRemoved({ removed, failed, fallback, selectedRemoved });
    }
    return { removed, failed };
  }
  function zoomImage(entry) {
    if (!entry) return;
    selectImage(entry);
    uiRef.current.setView("studio");
    uiRef.current.setZoom(true);
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
        uiRef.current.showToast(tRef.current("studio.toast.exported"));
        return;
      }
    } catch {
    }
    uiRef.current.showToast(text);
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
    loadHistory,
    // 画廊分页：hasMore 决定底部显示「加载更多」还是「已加载全部作品」。
    offset: offsetRef.current,
    hasMore: historyHasMoreState,
    loadingMore: historyLoadingMore,
    loadMore: loadMoreHistory,
    // 阶段十三：原始历史条目与版本树索引（Filmstrip 按根折叠、版本面板取数据）。
    items: historyItems,
    lineage,
    // 工作区焦点：new_draft 时 selected 为 null，作品条显示新建草稿卡。
    workspaceMode,
    newDraftExplicit,
    newDraftPending,
    focusDraft,
    newDraft,
    markNewDraftSubmitted,
    // 版本树按需拉取与旧宿主降级状态。
    loadTree,
    treeUnavailable,
    treeLoadingRoot
  };
}

// src/studio/useStudio.js
function useAlive() {
  const ref = import_react47.default.useRef(true);
  import_react47.default.useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return import_react47.default.useCallback(async (promise) => {
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
  const initialWorkspaceMode = props && props.workspaceMode === "work" ? "work" : "new_draft";
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : [];
  const defaultPreset = state && state.defaultPreset || "";
  const [sending, setSending] = import_react47.default.useState(false);
  const pendingRef = import_react47.default.useRef(null);
  const ui = useStudioUi({ t, initialView, initialPanelMode });
  const control = useSessionControl({ t, host, ui, alive });
  const [dismissedQueueKey, setDismissedQueueKey] = import_react47.default.useState("");
  const kaggleLogin = useKaggleLogin({ t, ui, onDone: () => control.runProbe() });
  const colabLogin = useColabLogin({ t, ui, onDone: () => host.refresh() });
  const form = useStudioForm({ t, isEn, alive, ui, preset: { presets, defaultPreset }, initialPrompt });
  const imageTool = useImageTool({
    t,
    alive,
    ui,
    presets,
    defaultPreset,
    // 工具优先沿用左栏当前模型（支持对应能力时），但不回写左栏。
    currentPresetId: form.form.presetId,
    // 阶段十五 A2：舞台图片工具提交成功后，把动作镜像进助手线程（kind 记录不进 intentHistory）。
    onSubmitted: (job, meta) => {
      if (meta && typeof meta === "object") {
        chat.mirrorTool({ job, tool: meta.tool, target: meta.target, body: meta.body });
      }
      host.refresh();
    }
  });
  const chat = useChatThread({ t, isEn, alive, state, form, generate });
  const library = useWorkLibrary({
    t,
    alive,
    ui,
    state,
    initialWorkspaceMode,
    // 阶段十五 Phase C0：删除作品后的级联清理（工具草稿 + 左栏来源引用 + 回退图回填）。
    onImagesRemoved: handleImagesRemoved
  });
  const referenceSlot = useReferenceSlot({ t, alive, ui, form, library });
  function focusNewDraft() {
    imageTool.closeTool();
    const opened = form.openDraft();
    if (!opened && form.origin) form.detachOrigin();
    library.focusDraft();
    ui.setView("studio");
    ui.setPanelMode("form");
  }
  function newDraft() {
    imageTool.closeTool();
    form.newCreation();
    library.newDraft();
    ui.setView("studio");
    ui.setPanelMode("form");
  }
  const formView = { ...form, newCreation: newDraft };
  const draftView = form.draftView;
  const draftSource = draftView && draftView.source ? draftView.source : null;
  const draftPrompt = draftSource && typeof draftSource.prompt === "string" ? draftSource.prompt.trim() : "";
  const libraryView = {
    ...library,
    // 阶段十五 Phase C0：助手点结果图 / 单图聚焦返回与胶片条同口径——先按需托管 dirty
    // 草稿，再回填目标图参数与 origin，消除「舞台换了图、左栏还是上一张」的图文不同步。
    openMessage: openPath,
    newDraftCard: {
      active: library.workspaceMode === "new_draft",
      explicit: library.newDraftExplicit === true,
      pending: library.newDraftPending === true,
      width: form.form.width,
      height: form.form.height,
      presetLabel: form.activePreset ? presetLabelOf(form.activePreset) : "",
      prompt: form.form.prompt,
      // 草稿托管态：dirty 时草稿卡实时出现；已托管的草稿点了就恢复。
      // 舞台保持展示来源作品（work 焦点）时不闪空，只有点草稿卡才切到 new_draft 取景框。
      draft: Boolean(draftView && draftView.active) && (Boolean(draftView.parked) || library.workspaceMode === "work"),
      draftFrom: draftPrompt,
      draftFromSource: Boolean(draftSource),
      draftEditing: Boolean(draftView && draftView.editing)
    },
    // 工具域的未提交编辑草稿：缩略图圆点 / 版本面板圆点与清空都用这一份。
    workDrafts: imageTool.workDrafts,
    clearWorkDraft: imageTool.clearWorkDraft,
    workDraftSummary: imageTool.workDraftSummary
  };
  function startSession2() {
    return control.startSession(form.form.presetId || defaultPreset);
  }
  function requeueSession() {
    return control.requeueSession(form.form.presetId || defaultPreset);
  }
  const queue = control.queue;
  const queueNotice = queue.level === "stalled" && queue.key && queue.key !== dismissedQueueKey ? {
    minutes: queue.stalledMinutes,
    dismiss: () => setDismissedQueueKey(queue.key),
    requeue: () => {
      setDismissedQueueKey(queue.key);
      return requeueSession();
    }
  } : null;
  const compute = {
    ...control,
    presets,
    defaultPreset,
    startSession: startSession2,
    requeueSession,
    queueNotice,
    retryHost,
    kaggleLogin,
    provider: state && state.provider || control.session && control.session.provider || "kaggle",
    colabAuth: state && state.colabAuth || null,
    colabLogin
  };
  async function generate(overrides, options = {}) {
    if (sending) return false;
    const effectivePreset = effectivePresetOf(overrides, form.activePreset, presets);
    const requestedReferences = referencePathsOf(
      overrides && Object.prototype.hasOwnProperty.call(overrides, "references") ? overrides.references : form.form.references
    );
    const capability = generateCapabilityOf({
      preset: effectivePreset,
      presets,
      references: requestedReferences,
      // 与顶栏模型卡同源：provider 只在组合层归一一次（compute.provider），不在这里重复推导。
      provider: compute.provider
    });
    if (!capability.ok) {
      const blocked = capability.blockedParams;
      const params = blocked ? {
        ...blocked,
        provider: t(providerNameKeyOf(blocked.provider)),
        needed: t(providerNameKeyOf(blocked.needed))
      } : void 0;
      ui.showToast(formatText(t(capability.blockedKey), params));
      return false;
    }
    const requestPreset = capability.preset || effectivePreset;
    const body = form.buildBody(overrides, { preset: requestPreset });
    if (!body.prompt) {
      ui.fail("need_prompt", "");
      return false;
    }
    const showPolicyNotice = () => {
      if (capability.notice) ui.showToast(formatText(t(capability.notice.key), capability.notice.params));
    };
    const submittedForm = form.form;
    pendingRef.current = body;
    setSending(true);
    ui.setError(null);
    try {
      const result = await alive(submitGenerate(body));
      if (!result) return false;
      if (result.ok && result.data && result.data.id) {
        const jobId = result.data.id;
        const entries = [];
        if (options.pushUser !== false) {
          entries.push({
            role: "user",
            kind: "form",
            source: options.source || "form",
            text: body.prompt,
            summary: formSummaryOf(body)
          });
        }
        entries.push({ role: "assistant", kind: "job", jobId, stage: "pending", text: t("studio.chat.pending") });
        chat.pushMessages(entries);
        if (options.pushUser !== false && form.markClean(submittedForm)) {
          form.clearDraft();
        }
        if (library.workspaceMode === "new_draft") library.markNewDraftSubmitted(jobId);
        host.refresh();
        ui.showToast(t("studio.toast.submitted"));
        showPolicyNotice();
        return true;
      }
      showPolicyNotice();
      ui.fail(result.code, result.message);
    } finally {
      setSending(false);
    }
    return false;
  }
  function reroll(entry) {
    const target = entry || library.selected;
    const overrides = rerollOverrides(target, presets, library.items, form.activePreset);
    if (!overrides) {
      ui.showToast(t("workbench.needPrompt"));
      return;
    }
    generate(overrides, { source: "variant" });
  }
  function entryByPath(path) {
    const target = typeof path === "string" ? path.trim() : "";
    if (!target) return null;
    const gallery = Array.isArray(library.gallery) ? library.gallery : [];
    const found = gallery.find((entry) => entry && entry.image && entry.image.path === target);
    if (found) return found;
    const items = Array.isArray(library.items) ? library.items : [];
    for (const item of items) {
      const images = item && Array.isArray(item.images) ? item.images : [];
      const image = images.find((candidate) => candidate && candidate.path === target);
      if (image) return { image, item };
    }
    return null;
  }
  function recallTarget(target, options = {}) {
    const notice = options.notice !== false;
    if (isBareImportOf(target)) {
      if (form.dirty || form.draftEditing) {
        form.parkDraft();
        if (notice) ui.showToast(t("studio.toast.draftKept"));
      }
      form.detachOrigin();
      return;
    }
    const patch = iteratePatch(target, form.form, presets, library.items);
    const decision = previewRecallOf({
      dirty: form.dirty,
      hasDraft: Boolean(form.draft),
      patch
    });
    if (decision.park || form.draftEditing) form.parkDraft();
    if (notice && decision.noticeKey) ui.showToast(t(decision.noticeKey));
    if (decision.action !== "recall") return;
    form.applyRecall(patch, target);
  }
  function previewWork(entry) {
    const target = entry && entry.image ? entry : null;
    if (!target) return;
    imageTool.closeTool();
    library.selectImage(target);
    recallTarget(target);
  }
  function openPath(path) {
    const target = typeof path === "string" ? path.trim() : "";
    if (!target) return;
    const entry = entryByPath(target);
    if (entry) {
      previewWork(entry);
      return;
    }
    imageTool.closeTool();
    if (form.dirty || form.draftEditing) form.parkDraft();
    library.openMessage(target);
    form.detachOrigin();
  }
  function restoreOriginal() {
    const source = form.restoreOriginal();
    if (!source) return false;
    imageTool.closeTool();
    const path = source && typeof source.path === "string" ? source.path.trim() : "";
    const entry = path ? entryByPath(path) : null;
    ui.setView("studio");
    ui.setPanelMode("form");
    ui.setZoom(false);
    if (path && !entry) {
      library.focusDraft();
      ui.showToast(t("studio.toast.restoredOriginalMissing"));
      return true;
    }
    if (entry) library.selectImage(entry);
    ui.showToast(t("studio.toast.restoredOriginal"));
    return true;
  }
  function openImageTool(kind, entry) {
    const target = entry || library.selected;
    if (!target) {
      ui.showToast(t("studio.imageTool.blockedTarget"));
      return false;
    }
    if (form.draftEditing) form.parkDraft();
    library.selectImage(target.image ? target : { image: target });
    if (!imageTool.openTool(kind, target)) return false;
    ui.setView("studio");
    ui.setPanelMode("form");
    ui.setZoom(false);
    return true;
  }
  function addReference(entry) {
    const outcome = form.addReference(entry);
    if (outcome.ok) {
      ui.showToast(t("studio.reference.addedToSlot"));
      return true;
    }
    if (outcome.reason === "duplicate") ui.showToast(t("studio.reference.duplicate"));
    else if (outcome.reason === "full") ui.showToast(formatText(t("studio.reference.full"), { max: form.referenceMax }));
    else ui.showToast(t("studio.reference.invalidPath"));
    return false;
  }
  function removeReference(path) {
    return form.removeReference(path);
  }
  function switchToReferencePreset() {
    if (form.referenceSupported) return false;
    const target = form.referenceSwitchPreset;
    if (!target) {
      ui.showToast(t("studio.reference.noPreset"));
      return false;
    }
    form.selectPreset(target);
    ui.showToast(formatText(t("studio.reference.switched"), { preset: form.referenceSwitchLabel }));
    return true;
  }
  function useAsReference(entry) {
    const target = entry || library.selected;
    if (!target || !target.image) {
      ui.showToast(t("studio.reference.noTarget"));
      return false;
    }
    const outcome = form.addReference(target);
    if (!outcome.ok) {
      if (outcome.reason === "duplicate") ui.showToast(t("studio.reference.duplicate"));
      else if (outcome.reason === "full") ui.showToast(formatText(t("studio.reference.full"), { max: form.referenceMax }));
      else ui.showToast(t("studio.reference.invalidPath"));
      return false;
    }
    if (form.referenceSupported) {
      ui.showToast(t("studio.reference.addedToSlot"));
    } else if (form.referenceSwitchPreset) {
      switchToReferencePreset();
    } else {
      ui.showToast(t("studio.reference.addedUnsupported"));
    }
    ui.setView("studio");
    ui.setPanelMode("form");
    ui.setZoom(false);
    return true;
  }
  function referenceToImg2img() {
    const first = referenceListOf(form.form.references)[0];
    if (!first) {
      ui.showToast(t("studio.reference.emptySlot"));
      return false;
    }
    const entry = entryByPath(first.path) || {
      image: { path: first.path, url: first.url, width: first.width, height: first.height },
      item: null
    };
    return openImageTool("img2img", entry);
  }
  function activateImport(entry) {
    const target = entry && entry.image ? entry : null;
    if (!target) return false;
    imageTool.closeTool();
    library.selectImage(target);
    recallTarget(target, { notice: false });
    ui.setView("studio");
    ui.setPanelMode("form");
    ui.setZoom(false);
    ui.setCompareOpen(false);
    const generation2 = entry.generation && typeof entry.generation === "object" ? entry.generation : null;
    ui.showToast(t(generation2 ? "studio.import.metaFound" : "studio.import.done"));
    if (typeof library.loadHistory === "function") library.loadHistory();
    return true;
  }
  function handleImagesRemoved({ removed, fallback, selectedRemoved }) {
    const list = Array.isArray(removed) ? removed.filter(Boolean) : [];
    if (list.length === 0) return;
    for (const path of list) imageTool.clearWorkDraft(path);
    const originRemoved = Boolean(form.origin && form.origin.path && list.includes(form.origin.path));
    form.forgetRemovedPaths(list);
    if (!(selectedRemoved === true || originRemoved)) return;
    const next = selectedRemoved === true ? fallback : library.selected;
    if (next) {
      recallTarget(next, { notice: false });
      return;
    }
    form.detachOrigin();
  }
  function retryFocusedJob() {
    const pending = pendingRef.current;
    const focused = control.focusedJob;
    const focusedParams = focused && focused.params && typeof focused.params === "object" ? focused.params : null;
    if (focusedParams && focusedParams.reference) {
      ui.showToast(t("studio.imageTool.retryMoved"));
      return;
    }
    const overrides = retryOverrides(focused) || (pending ? retryOverrides(pending) : null);
    if (!overrides) {
      ui.showToast(t("workbench.needPrompt"));
      return;
    }
    generate(overrides, { source: "retry" });
  }
  function resetToSafe() {
    const safe = safeResetPatch(form.activePreset);
    form.patchForm(safe);
    if (guidanceKey) ui.dismissGuidance(guidanceKey);
    else ui.setError(null);
    ui.showToast(formatText(t("studio.guidance.oom.reset"), { size: safe.width, steps: safe.steps }));
  }
  function retryHost() {
    if (guidanceKey) ui.dismissGuidance(guidanceKey);
    else ui.setError(null);
    host.refresh();
  }
  function dismissGuidance() {
    ui.dismissGuidance(guidanceKey);
  }
  const rawGuidanceCode = ui.error && ui.error.code || control.session && control.session.error && control.session.error.code || control.focusedJob && control.focusedJob.status === "failed" && control.focusedJob.error && control.focusedJob.error.code || "";
  const isColabActive = state && state.provider === "colab" || control.session && control.session.provider === "colab";
  const authProven = isColabActive ? Boolean(state && state.colabAuth && state.colabAuth.authorized === true || control.sessionState === "ready") : accountStatusOf(control.probe, control.sessionState) === "ok";
  const suppressAuth = authProven && (rawGuidanceCode === "auth_required" || rawGuidanceCode === "cli_missing");
  const guidanceCode = suppressAuth ? "" : rawGuidanceCode;
  const guidanceDetail = isConnectionCode(guidanceCode) ? t("error.network") : guidanceDetailOf({ error: ui.error, session: control.session, job: control.focusedJob });
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : "";
  const guidanceKind = guidanceCode && ui.dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : "";
  const guidanceSurface = guidanceSurfaceOf(guidanceKind);
  return {
    t,
    isEn,
    ui,
    compute,
    form: formView,
    chat,
    library: libraryView,
    imageTool,
    guidance: { kind: guidanceKind, code: guidanceCode, surface: guidanceSurface, detail: guidanceDetail, key: guidanceKey, dismiss: dismissGuidance },
    actions: {
      sending,
      generate,
      newDraft,
      focusNewDraft,
      previewWork,
      reroll,
      openImageTool,
      activateImport,
      restoreOriginal,
      retryFocusedJob,
      resetToSafe,
      // 左栏参考图槽（阶段十五 Phase C2）：增删 / 导入 / 换模型 / 送到舞台重绘。
      addReference,
      removeReference,
      useAsReference,
      switchToReferencePreset,
      referenceToImg2img,
      uploadReferenceFiles: referenceSlot.uploadFiles,
      referenceUploading: referenceSlot.busy
    }
  };
}

// src/studio/Studio.jsx
var import_jsx_runtime37 = require("react/jsx-runtime");
var StudioStyles = import_react48.default.memo(function StudioStyles2() {
  return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("style", { children: CSS });
});
function Studio(props) {
  const { t, isEn, ui, compute, form, chat, library, imageTool, guidance, actions } = useStudio(props);
  const status = compute.status;
  const chatMode = ui.panelMode === "chat";
  const logs = useStudioLogs(ui.logsOpen);
  useCompletionNotice({ t, ui, job: compute.focusedJob, activeJob: compute.activeJob });
  const panel = chatMode ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(ChatPanel, { t, ui, form, chat, library, actions }) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Rail, { t, ui, form, actions, library });
  const guidanceSurface = guidance && guidance.kind ? guidance.surface || guidanceSurfaceOf(guidance.kind) : "";
  const bannerGuidance = guidanceSurface === "banner" ? guidance : null;
  const noticeGuidance = guidanceSurface === "toast" ? guidance : null;
  return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: "ofs-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(StudioStyles, {}),
    /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: "ofs-app", children: [
      /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TopBar, { t, isEn, ui, compute, form, library, defaultModelOpen: props.defaultModelOpen }),
      /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: "ofs-status-area", children: [
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
          PipelineBar,
          {
            t,
            session: compute.session,
            activeJob: compute.activeJob,
            focusedJob: compute.focusedJob,
            pendingCount: compute.pendingJobs.length,
            queuePolicy: compute.queue.policy,
            failureDismissed: Boolean(guidance.key) && ui.dismissed === guidance.key,
            transient: Boolean(status && status.transient)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(QueueNotice, { t, notice: compute.queueNotice }),
        bannerGuidance ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(GuidanceCard, { t, guidance: bannerGuidance, compute, actions, ui }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Toast, { t, toast: ui.toast, guidance: noticeGuidance, compute, actions, ui })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: `ofs-body${ui.view === "gallery" ? " is-gallery" : ""}`, children: [
        ui.view === "studio" ? panel : null,
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: "ofs-main", children: ui.view === "gallery" ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
          Gallery,
          {
            t,
            gallery: library.gallery,
            presets: compute.presets,
            favorites: library.favorites,
            hasMore: library.hasMore,
            loadingMore: library.loadingMore,
            onLoadMore: library.loadMore,
            onDelete: library.deleteImages,
            onExport: library.exportPaths,
            onRedraw: (entry) => actions.openImageTool("inpaint", entry),
            onToggleFavorite: library.toggleFavorite,
            onZoom: library.zoomImage,
            onOpenStudio: (entry) => {
              actions.previewWork(entry);
              ui.setView("studio");
              ui.setZoom(false);
            }
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Stage, { t, ui, compute, form, library, imageTool, actions }) })
      ] }),
      ui.view === "studio" ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Filmstrip, { t, ui, compute, library, actions }) : null
    ] }),
    ui.logsOpen ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(LogsDrawer, { t, ui, compute, logs, onClose: ui.closeLogs }) : null,
    ui.settingsOpen ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
      SettingsDrawer,
      {
        t,
        ui,
        colabAuth: compute.colabAuth,
        colabLogin: compute.colabLogin,
        copyText: ui.copyText,
        onClose: ui.closeSettings
      }
    ) : null
  ] });
}

// src/index.js
var PANEL_ID = "our-imagen";
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
        id: "our-imagen-status",
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
