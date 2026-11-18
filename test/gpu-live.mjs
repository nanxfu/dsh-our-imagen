/**
 * GPU 链路验证：用真实 Kaggle GPU 跑 remote/daemon.py，端到端出图。
 *
 * 与 kaggle-live.mjs 的区别：那个用 CPU 探针验证调度链路，这个验证真实推理，
 * 会消耗 GPU 配额，且需要等 Kaggle 排队（可能十几分钟）。
 *
 * 运行：
 *   node test/gpu-live.mjs [--preset sdxl-lightning] [--prompt "…"] [--keep]
 *   node test/gpu-live.mjs --presets sdxl-lightning,flux2-klein-4b,anima-light-lavender
 *
 * 两种模式：
 *   - 单预设（默认）：出图一张，report.json 保留原有字段，向后兼容；
 *   - `--presets a,b,c`：在同一个 Kaggle 会话内按顺序连续切换模型出图，用于验证
 *     M4.1 的切换模型 LRU 缓存清理（旧权重不删会撑爆 20GB 磁盘）。report.json
 *     额外记录每个模型的加载/出图耗时、/health 依赖版本快照与远端 [cache] 日志摘要；
 *   - `--img2img`：M3 图生图验收。先文生图一张，再用这张图做垫图重绘，report.json
 *     记录重绘的加载/出图耗时、参考图尺寸与重绘前后 /health.gpu_memory（验证 from_pipe
 *     复用底座不额外占显存）。只能配单个 SDXL 家族预设使用。
 *   - `--inpaint`：M3 局部重绘验收。先文生图一张，再生成一张「中心白色矩形」的程序化蒙版
 *     做 Inpaint，report.json 记录蒙版字节数、对齐后的参考图尺寸与显存对比（验证
 *     `AutoPipelineForInpainting.from_pipe` 复用底座）。`--inpaint-prompt` 可给重绘单独
 *     的提示词，用于确认蒙版区真的按新内容重写。只能配单个支持 Inpaint 的预设使用。
 *     §六 真机验收的扩展参数：
 *       - `--reference-size WxH`：源文生图按给定宽高出图（非正方形验收，如 1024x768），
 *         程序化蒙版与参考图同比例生成；
 *       - `--mask-scale <0~1>`：中心蒙版面积占比（如 0.05 = 5%），默认沿用 `--mask-size` 旧口径；
 *       - `--strength-compare 0.9,1.0`：同一蒙版按多档强度各重绘一次，记录蒙版内平均差异；
 *       - `--inpaint-rounds <n>`：连续局部重绘轮数（第 2 轮起把上一轮出图当参考图继续重绘）。
 *     report.json 的 `inpaint.rounds[]` 记录每轮 strength / 耗时 / result 宽高 / 参考图与
 *     蒙版尺寸 / 蒙版覆盖率 / 蒙版内平均差异，便于验收文档直接引用。
 *   - `--upscale`：Phase B1 高清放大验收。先文生图（默认 sdxl-lightning 1024x1024，可用
 *     `--reference-size WxH` 指定源图，长边不能超过 UPSCALE.maxInputEdge），再以该图为源发
 *     `tool=upscale`，report.json 记录源图/输出宽高、加载与推理秒数、PNG 字节数、前后
 *     /health.gpu_memory，并断言输出 = 源图 × 2。
 *   - `--outpaint`：Phase B2 扩图验收。先文生图（源图固定 864x864），再用 Node 侧 PNG 工具
 *     构造「画布 1536x864 + 原图 864x864 居中 + 白边蒙版」，以 strength 1.0 提交到
 *     `sdxl-inpaint`（`--preset sdxl-inpaint` 时必须同时给 `--source-preset sdxl-lightning`，
 *     专用 inpaint 模型不能文生图），report.json 记录耗时 / 输出尺寸 / 前后显存，
 *     并用像素差统计验证内容区保留（内容区平均差应 ≈0、无硬接缝）。
 *     report.json 的新字段 `upscale` / `outpaint`（非该模式为 null）。
 *   - `--reference`：Phase C1 模型原生参考生图验收（首期仅 `flux2-klein-4b`）。先按同预设
 *     文生图 1~2 张源图做参考图，再以同一 seed 提交 1 张 / 2 张参考图（job 级
 *     `referenceImages: [{image_b64}]`），并补一次「1 张参考图 + 1280x720」验证画幅保持；
 *     连续多轮后再跑一次文生图核对 /health.gpu_memory 无增长。report.json 的 `reference`
 *     段记录每例参考图数量/尺寸/耗时/前后显存/输出尺寸断言、同 seed 确定性与参考影响度 MAE。
 *     参数：`--reference-count 1,2`、`--reference-rounds <n>`、`--reference-size WxH`
 *     （参考生图的目标画幅；缺省用预设 size）。
 *   - `--accel <on|off|ab>`：推理加速 A/B 验收（同一 Kernel 会话内同 seed/同尺寸/同 prompt
 *     对照）。默认 `ab` = 先 off 再 on；`sdxl-lightning` 1024² 用
 *     `channelsLast + fuseQkv + vaeTiling`，`sdxl-inpaint --outpaint` 用 `vaeTiling`。
 *     report.json 的 `accel` 段记录每档每轮耗时、中位耗时、提速比、前后峰值显存、
 *     两档输出 MAE（画质差异）与扩图接缝指标。`--accel-rounds <n>` 控制每档轮数（默认 2）。
 *   - `--outpaint-lora`：Phase C2「现代扩图引擎」真机验收（`flux2-klein-4b` + 扩图 LoRA，
 *     单个 Kernel 会话内一次提交）：先用 `--source-preset`（默认 sdxl-lightning）出 864x864
 *     内容源图，构造 1536x864 纯绿 #00FF00 画布（内容居中），把整张画布等比缩到 1024x576
 *     （保持绿边比例、满足 referenceImages 长边 ≤1024）作为 job 级参考图，再提交 flux2
 *     输出 1536x864。report.json 的 `outpaintLora` 段记录提交/执行秒数、输出尺寸与字节数、
 *     前后显存、内容区平均差、绿边残留比例、接缝指标、内容区颜色漂移，并与历史
 *     sdxl-inpaint 扩图基线（bench-results 报告）对比。
 *   - `--accel-cache`：Phase C2 推理缓存探针（flux2-klein-4b 同 seed 文生图 A/B）：
 *     on 档在 pipeline 上覆盖 `accel.cache = {type:'firstBlock', threshold:0.05}`，
 *     report.json 的 `accelCache` 段记录每档耗时/显存/两档 MAE，并从 /logs 的
 *     `[accel] ... cache ...` 行判定缓存「已应用」还是「不适用（WARN 跳过）」。
 *     该开关是实验性探针，本轮不写入任何模型资产。
 *
 * 前置条件：默认走直连，本机有可用的 Kaggle 凭据（`~/.kaggle/credentials.json` 等）即可；
加 `--cli` 时才要求本机安装并登录 kaggle CLI。账号需启用 GPU 加速器且当天配额充足。
 * 默认不跑真机：只有显式执行本脚本（且不带 --help）才会推送 Kernel。
 * 产物：bench-results/gpu-live/<时间戳>/report.json 与样张 PNG。
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

import { SessionManager } from '../lib/session.js'
import {
  deleteKernel as directDeleteKernel,
  kaggleUsername as directKaggleUsername,
  kernelLogs as directKernelLogs,
  kernelStatus as directKernelStatus,
  pushKernel as directPushKernel,
} from '../lib/kaggle-direct.js'
import { PRESETS, presetById } from '../lib/presets.js'
import { LIMITS, OUTPAINT, UPSCALE } from '../shared/contract.js'
import { fetchHealth, requestGenerate, requestLogs, submitGenerate, waitForJob } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(PLUGIN_ROOT, 'bench-results', 'gpu-live')
// 扩图真机验收的固定画布（INTERFACES §2.6）：1536x864（16:9）+ 原图 864x864 居中，
// 新增区域就是左右两条 336px 的白边（覆盖率 43.75%）。画布长边贴着远端 width 上限 1536，
// 用来验证 9 通道 inpaint 在大画布上的显存与边缘融合。
const OUTPAINT_CANVAS = { width: 1536, height: 864 }
const OUTPAINT_CONTENT = { x: 336, y: 0, width: 864, height: 864 }
// Phase C2 现代扩图引擎（flux2 + 官方扩图 LoRA）的固定口径：
//  - 内容区仍是 864x864 居中，新增区域改用纯绿 #00FF00 填底（LoRA 训练约定：绿边 = 待填充）；
//  - 参考图 = 整张画布等比缩到 1024x576（长边 1024 满足 referenceImages.maxEdge，绿边比例不变）；
//  - prompt 固化为 LoRA 训练时的指令句，scale 1.1 是官方卡片推荐值。
const OUTPAINT_LORA = {
  targetPreset: 'flux2-klein-4b',
  sourcePreset: 'sdxl-lightning',
  lora: {
    repo: 'fal/flux-2-klein-4B-outpaint-lora',
    weight: 'flux-outpaint-lora.safetensors',
    scale: 1.1,
  },
  prompt: 'Fill the green spaces according to the image',
  seed: 42,
  green: { r: 0, g: 255, b: 0 },
  reference: { width: 1024, height: 576 },
}
// 历史基线兜底（sdxl-inpaint 9 通道 inpaint，1536x864）：运行时会重新扫描
// bench-results/gpu-live/*/report.json 取最近样本，扫不到时用这三个常量值。
const OUTPAINT_LORA_BASELINE = {
  preset: 'sdxl-inpaint',
  width: OUTPAINT_CANVAS.width,
  height: OUTPAINT_CANVAS.height,
  samples: [35.42, 35.2, 35.91],
}
// Phase C2 缓存加速探针的固定配置：firstBlock 缓存（实验性，仅真机 A/B 用）。
const ACCEL_CACHE = { type: 'firstBlock', threshold: 0.05 }
const KEEP = process.argv.includes('--keep')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
// 默认走直连（0.8.2 起的默认访问方式，不需要本机 kaggle CLI）；
// 排障或想复现 CLI 路径时加 `--cli`。
const USE_CLI = process.argv.includes('--cli')
const TRANSPORT_DEPS = USE_CLI
  ? {}
  : {
      kaggleUsername: directKaggleUsername,
      pushKernel: directPushKernel,
      kernelStatus: directKernelStatus,
      kernelLogs: directKernelLogs,
      deleteKernel: directDeleteKernel,
    }
const VALID_PRESET_IDS = new Set(PRESETS.map((preset) => preset.id))
const DEFAULT_PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'

function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}

function printHelp() {
  console.log(`GPU 链路验证（真实 Kaggle GPU，会消耗 GPU 配额，默认不自动运行）

用法：
  node test/gpu-live.mjs [--preset <id>] [--prompt <text>] [--keep]
  node test/gpu-live.mjs --presets <id1,id2,...> [--prompt <text>] [--keep]
  node test/gpu-live.mjs --preset sdxl-lightning --img2img [--strength 0.6]
  node test/gpu-live.mjs --preset sdxl-lightning --inpaint [--strength 0.6]
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --reference-size 1024x768 --mask-scale 0.05
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --strength-compare 0.9,1.0
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --inpaint-rounds 2
  node test/gpu-live.mjs --preset sdxl-lightning --upscale [--reference-size 768x768]
  node test/gpu-live.mjs --preset sdxl-inpaint --source-preset sdxl-lightning --outpaint
  node test/gpu-live.mjs --preset flux2-klein-4b --reference [--reference-count 1,2]
  node test/gpu-live.mjs --preset sdxl-lightning --accel ab
  node test/gpu-live.mjs --preset sdxl-inpaint --source-preset sdxl-lightning --outpaint --accel ab
  node test/gpu-live.mjs --preset flux2-klein-4b --outpaint-lora [--source-preset sdxl-lightning]
  node test/gpu-live.mjs --preset flux2-klein-4b --accel-cache [--accel-rounds 2]
  node test/gpu-live.mjs --c1-acceptance [--accel-rounds 2]
    ↑ Phase C1 一次性正式验收：1 个 Kernel 内跑完「参考生图 + sdxl-lightning A/B + sdxl-inpaint 扩图 A/B」

选项：
  --preset <id>     单预设模式（默认 sdxl-lightning），出图一张
  --presets a,b,c   单会话内按顺序连续切换模型出图，验证切换模型时的 LRU 缓存清理
  --prompt <text>   提示词（两种模式共用）
  --c1-acceptance   Phase C1 一次性正式验收：同一 Kernel 会话内依次跑参考生图（flux2-klein-4b）、
                    sdxl-lightning 1024² 4 步加速 A/B、sdxl-inpaint 1536x864 30 步扩图加速 A/B；
                    不能与其它验收模式组合，参考生图张数仍可用 --reference-count 调整
  --img2img         M3 图生图验收：文生图后用该图垫图重绘，记录显存对比（仅单预设）
  --inpaint         M3 局部重绘验收：文生图后用程序化蒙版做 Inpaint，记录显存对比（仅单预设）
  --upscale         Phase B1 高清放大验收：文生图后以该图为源发 tool=upscale，断言输出 = 源×2
  --outpaint        Phase B2 扩图验收：构造 1536x864 画布 + 白边蒙版做局部重绘，
                    并用像素差验证内容区保留（仅单预设；配合 --preset sdxl-inpaint 使用）
  --reference       Phase C1 原生参考生图验收（仅 supportsReference=true 的预设，如 flux2-klein-4b）：
                    先文生图出源图，再按 1/2 张参考图跑参考生图 + 1280x720 画幅保持，
                    最后复测文生图核对显存无增长
  --reference-count <1,2>
                    仅 --reference：要验收的参考图张数列表（默认 1,2；受 LIMITS.referenceImages.maxCount 约束）
  --reference-rounds <n>
                    仅 --reference：每个张数档的出图轮数（默认 1 张跑 2 轮、2 张跑 1 轮）
  --accel <on|off|ab>
                    推理加速 A/B 验收（默认 ab = 先 off 再 on）：sdxl-lightning 1024² 用
                    channelsLast + fuseQkv + vaeTiling；--outpaint 模式 sdxl-inpaint 用 vaeTiling
  --accel-cache     推理缓存探针（仅 flux2 家族）：flux2-klein-4b 同 seed 文生图 A/B，
                    on 档在 pipeline 上覆盖 accel.cache = {type:'firstBlock', threshold:0.05}；
                    report 记录 [accel] ... cache ... 应用/跳过日志、两档 MAE 与显存。
                    缓存是实验性探针，本轮不写入模型资产
  --outpaint-lora   现代扩图引擎验收（仅 flux2 家族）：flux2-klein-4b + 官方扩图 LoRA，
                    纯绿 #00FF00 画布 1536x864、内容 864x864 居中、参考图 1024x576，
                    输出 1536x864；只做单次提交，默认预设就是 flux2-klein-4b
  --accel-rounds <n>
                    仅 --accel / --accel-cache：每档轮数（默认 2，取中位耗时）
  --inpaint-prompt <text>
                    局部重绘使用单独的提示词（默认与 --prompt 相同）。给一段与文生图不同的描述，
                    才能肉眼确认白色蒙版区真的按新内容重写
  --reference-size WxH
                    仅 --inpaint / --upscale / --reference：--inpaint/--upscale 是源文生图的宽高
                    （默认跟随 --source-preset 的 size）；--reference 是参考生图的目标画幅
                    （默认跟随预设 size）。--upscale 时源图长边不能超过 UPSCALE.maxInputEdge（1280）
  --mask-scale <0~1>
                    仅 --inpaint：中心蒙版面积占画布的比例（如 0.05 = 5%）。
                    默认沿用 --mask-size 的旧口径（rect 为边长比例 0.4）
  --strength-compare <a,b,...>
                    仅 --inpaint：同一参考图与蒙版按多档强度各重绘一次（如 0.9,1.0），
                    report 记录每档的蒙版内平均差异；不能与 --inpaint-rounds 同时使用
  --inpaint-rounds <n>
                    仅 --inpaint：连续局部重绘轮数（1~3，默认 1）。第 2 轮起把上一轮出图
                    当作参考图继续重绘，用于验证「以结果继续重绘」；模型不重新加载
  --max-queue-minutes <n>
                    排队超过 n 分钟仍是 QUEUED 时自动换新实例重排（默认 5，0 表示一直等）
  --max-replace <n> 最多换新实例几次（默认 3）；每次会用 DeleteKernel 清理旧 Kernel
  --source-preset <id>
                    局部重绘的源图预设（默认 sdxl-lightning）。专用 inpaint 模型不能文生图，
                    所以先用普通模型出源图，再用 --preset 指定的模型做局部重绘
  --mask-shape <s>  局部重绘蒙版形状：rect（默认）或 circle
  --mask-size <n>   蒙版尺寸占画布边长的比例（0.02~1，默认 0.4）；调小可模拟真实小笔刷
  --mask-center <x,y>
                    蒙版中心位置（0~1 相对坐标，默认 0.5,0.5 画面中心）
  --strength <n>    垫图 / 局部重绘强度（img2img 0.2~0.9；--inpaint 时上限放宽到 1.0，默认 0.6）
  --cli             用本机 kaggle CLI 推 Kernel（默认走直连，不需要 CLI）
  --keep            结束后不关机，保留 Kernel 便于手动观察
  --self-test       只跑扩图画布/参考图/绿边统计等纯函数自检，不推 Kernel、不消耗配额
  --help, -h        显示本帮助；不会推送 Kernel，也不会消耗配额

前置条件：
  - 默认直连：本机有可用的 Kaggle 凭据（%USERPROFILE%\\.kaggle\\credentials.json
    或 access_token / kaggle.json），可在工作台用内置 OAuth 登录生成；
  - 加 --cli 时改为要求本机安装并登录 kaggle CLI：pip install -U kaggle；
  - Kaggle 账号已绑定手机号并启用 GPU 加速器，当天 GPU 配额充足

报告：bench-results/gpu-live/<时间戳>/report.json
  - models[]：每个预设的 modelId / pipelineKind / 加载秒数 / 出图秒数 / 出图宽高 / PNG 字节数
  - inpaint：局部重绘每轮/每档的 result 宽高、参考图与蒙版尺寸、蒙版覆盖率与蒙版内平均差异
  - upscale：--upscale 模式的源图/输出尺寸、加载与推理秒数、PNG 字节与前后显存
  - outpaint：--outpaint 模式的画布/内容区尺寸、新增区覆盖率、内容区像素差与前后显存
  - reference：--reference 模式每例参考图数量/尺寸/耗时/前后显存/输出尺寸断言、确定性与参考影响度 MAE
  - accel：--accel 模式每档每轮耗时、中位耗时、提速比、峰值显存差、两档输出 MAE 与扩图接缝指标
  - outpaintLora：--outpaint-lora 模式的 LoRA 配置、提交/执行秒数、输出尺寸与字节数、前后显存、
    内容区平均差、绿边残留比例、接缝指标、内容区颜色漂移与 sdxl-inpaint 历史基线对比
  - accelCache：--accel-cache 模式每档耗时/显存、两档 MAE 与 [accel] cache 应用/跳过日志判定
  - versions：远端 /health 上报的依赖版本快照（用于维护 LKGR 基线）
  - cacheLogs：远端 [cache] 日志摘要，拉取失败时为 null（不影响验证结论）

可用预设：${PRESETS.map((preset) => preset.id).join(', ')}`)
}

/** 按契约钳制并对齐一个出图尺寸（非正方形验收用）。 */
function normalizeDimensionValue(value, limits = LIMITS.width) {
  const number = Number(value)
  const { min, max, step } = limits
  const base = Number.isFinite(number) ? Math.round(number) : min
  const clamped = Math.min(max, Math.max(min, base))
  return Math.round(clamped / step) * step
}

/**
 * 按契约钳制重绘强度（两位小数，与 Host validator 同口径）。
 * ``ceiling`` 是场景上限：局部重绘传 ``LIMITS.strength.inpaintMax``，img2img 保持 ``max``。
 */
function normalizeStrengthValue(value, ceiling = LIMITS.strength.max) {
  const { min, max, step } = LIMITS.strength
  const hardMax = Math.max(max, Number(LIMITS.strength.inpaintMax) || max)
  const upper = Math.min(hardMax, Math.max(max, Number(ceiling) || max))
  const raw = Number.isFinite(Number(value)) ? Number(value) : LIMITS.strength.default
  const clamped = Math.min(upper, Math.max(min, raw))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(Math.min(upper, Math.max(min, aligned)) * 100) / 100
}

/** 解析并校验命令行参数；--help / --self-test 由调用方提前处理，不会走到这里。 */
function parseOptions() {
  // Phase C2 的两个独立验收模式：现代扩图引擎（flux2 + 扩图 LoRA）与推理缓存探针。
  const outpaintLora = process.argv.includes('--outpaint-lora')
  const accelCache = process.argv.includes('--accel-cache')
  // --outpaint-lora 的目标预设固定是 flux2-klein-4b；其它模式保持历史的 sdxl-lightning 默认。
  const presetArg = String(
    argOf('preset', outpaintLora ? OUTPAINT_LORA.targetPreset : 'sdxl-lightning'),
  ).trim()
  const presetsArg = String(argOf('presets', '')).trim()
  const rawList = presetsArg ? presetsArg.split(',') : [presetArg]
  const presets = []
  for (const item of rawList) {
    const id = item.trim()
    if (!id) continue
    if (!VALID_PRESET_IDS.has(id)) {
      throw new Error(`未知预设：${id}（可选：${[...VALID_PRESET_IDS].join(', ')}）`)
    }
    presets.push(id)
  }
  if (!presets.length) throw new Error('至少需要一个预设（--preset 或 --presets）')
  const img2img = process.argv.includes('--img2img')
  if (img2img && presets.length !== 1) throw new Error('--img2img 只能配合单个预设使用')
  const inpaint = process.argv.includes('--inpaint')
  if (inpaint && presets.length !== 1) throw new Error('--inpaint 只能配合单个预设使用')
  // Phase B 的两个验收模式：--upscale（远端 tool=upscale）与 --outpaint（构造画布后走 inpaint）。
  const upscale = process.argv.includes('--upscale')
  if (upscale && presets.length !== 1) throw new Error('--upscale 只能配合单个预设使用')
  const outpaint = process.argv.includes('--outpaint')
  if (outpaint && presets.length !== 1) throw new Error('--outpaint 只能配合单个预设使用')
  // Phase C1：--reference 原生参考生图验收（只有 supportsReference=true 的预设能用）。
  const reference = process.argv.includes('--reference')
  if (reference && presets.length !== 1) throw new Error('--reference 只能配合单个预设使用')
  if (reference) {
    const target = presetById(presets[0])
    if (target?.supportsReference !== true) {
      throw new Error(
        `--reference 需要支持原生参考生图的预设（当前 ${presets[0]}），首期只有 flux2-klein-4b`,
      )
    }
  }
  // Phase C1：--accel 推理加速 A/B（默认 ab：先 off 再 on；本轮只对 SDXL 家族做验收）。
  let accel = null
  if (process.argv.includes('--accel')) {
    const raw = String(argOf('accel', 'ab')).trim().toLowerCase()
    if (!['ab', 'both', 'on', 'off'].includes(raw)) {
      throw new Error(`--accel 取值应为 on / off / ab，收到 ${raw || '(空)'}`)
    }
    if (!['sdxl', 'sdxl-lora'].includes(presetById(presets[0])?.pipeline?.loader)) {
      throw new Error(`--accel 目前只对 sdxl / sdxl-lora 家族预设做真机 A/B（当前 ${presets[0]}）`)
    }
    accel = raw === 'both' ? 'ab' : raw
  }
  // Phase C2：--outpaint-lora 用 flux2 基础管线 + 扩图 LoRA，必须是支持原生参考生图的预设。
  if (outpaintLora) {
    if (presets.length !== 1) throw new Error('--outpaint-lora 只能配合单个预设使用')
    const target = presetById(presets[0])
    if (target?.pipeline?.loader !== 'flux2' || target?.supportsReference !== true) {
      throw new Error(
        `--outpaint-lora 需要 flux2 家族的参考生图预设（默认 ${OUTPAINT_LORA.targetPreset}），` +
          `当前 ${presets[0]}`,
      )
    }
  }
  // Phase C2：--accel-cache 只对 flux2 的 transformer 做 firstBlock 缓存探针。
  if (accelCache) {
    if (presets.length !== 1) throw new Error('--accel-cache 只能配合单个预设使用')
    if (presetById(presets[0])?.pipeline?.loader !== 'flux2') {
      throw new Error(`--accel-cache 只对 flux2 家族的预设做缓存探针（当前 ${presets[0]}）`)
    }
  }
  // Phase C1 一次性正式验收：一个 Kernel 会话内连续跑「参考生图 + 文生图 A/B + 扩图 A/B」。
  const c1Acceptance = process.argv.includes('--c1-acceptance')
  if (
    c1Acceptance &&
    (img2img || inpaint || upscale || outpaint || reference || accel || outpaintLora || accelCache)
  ) {
    throw new Error('--c1-acceptance 是独立的一次性验收模式，不能与其它验收模式组合')
  }
  const modeCount = [
    img2img,
    inpaint,
    upscale,
    outpaint,
    outpaintLora,
    reference,
    accelCache,
    c1Acceptance,
  ].filter(Boolean).length
  if (modeCount > 1) {
    throw new Error(
      '--img2img / --inpaint / --upscale / --outpaint / --outpaint-lora / --reference / ' +
        '--accel-cache / --c1-acceptance 是互相独立的验收模式，请分开运行',
    )
  }
  if (accel && (img2img || inpaint || upscale || outpaintLora || accelCache)) {
    throw new Error('--accel 只能与默认文生图或 --outpaint 组合（本轮验收范围）')
  }
  // 局部重绘 / 扩图的源图预设：专用 inpaint 模型不能文生图，验收时先用普通模型出源图。
  const sourcePresetArg = String(argOf('source-preset', 'sdxl-lightning')).trim()
  if (!VALID_PRESET_IDS.has(sourcePresetArg)) {
    throw new Error(`未知源图预设：${sourcePresetArg}（可选：${[...VALID_PRESET_IDS].join(', ')}）`)
  }
  if (sourcePresetArg === presets[0] && (inpaint || outpaint)) {
    // 允许，但源图与重绘用同一预设时提示一次（专用模型会在生成阶段被拦）。
    console.log(`  · 提示：源图与重绘使用同一预设 ${sourcePresetArg}`)
  }
  if (outpaint) {
    const targetPreset = presetById(presets[0])
    if (targetPreset?.supportsInpaint !== true) {
      throw new Error(`--outpaint 需要支持局部重绘的预设（当前 ${presets[0]}），例如 sdxl-inpaint`)
    }
    if (targetPreset?.inpaintOnly === true && sourcePresetArg === presets[0]) {
      throw new Error(
        '专用 inpaint 模型不能文生图：--outpaint 请用 --source-preset 指定普通预设（例如 sdxl-lightning）',
      )
    }
  }
  if (upscale) {
    const sourcePreset = presetById(presets[0])
    if (Number(sourcePreset?.size) > UPSCALE.maxInputEdge) {
      throw new Error(
        `--upscale 的源图长边不能超过 ${UPSCALE.maxInputEdge}（预设 ${presets[0]} 是 ${sourcePreset.size}），请用 --reference-size 指定更小的源图`,
      )
    }
  }
  // 强度上限按场景：局部重绘允许契约 inpaintMax（1.0），img2img 仍用 max（0.9）。
  const rawStrength = Number(argOf('strength', String(LIMITS.strength.default)))
  const strength = normalizeStrengthValue(
    Number.isFinite(rawStrength) ? rawStrength : LIMITS.strength.default,
    inpaint ? LIMITS.strength.inpaintMax : LIMITS.strength.max,
  )
  // 非正方形验收：--reference-size WxH 同时决定源文生图宽高（蒙版按参考图同比例生成）。
  let referenceSize = null
  if (process.argv.includes('--reference-size')) {
    if (!inpaint && !upscale && !reference) {
      throw new Error('--reference-size 只能配合 --inpaint / --upscale / --reference 使用')
    }
    const raw = String(argOf('reference-size', '')).trim()
    const match = raw.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
    if (!match) throw new Error(`--reference-size 格式应为 WxH（例如 1024x768），收到 ${raw || '(空)'}`)
    referenceSize = {
      width: normalizeDimensionValue(Number(match[1]), LIMITS.width),
      height: normalizeDimensionValue(Number(match[2]), LIMITS.height),
    }
    if (upscale && Math.max(referenceSize.width, referenceSize.height) > UPSCALE.maxInputEdge) {
      throw new Error(
        `--reference-size 长边不能超过高清放大上限 ${UPSCALE.maxInputEdge}（收到 ${referenceSize.width}x${referenceSize.height}）`,
      )
    }
  }
  // --mask-scale 是中心蒙版的面积占比（rect 用 sqrt 换算边长比例），优先于旧的 --mask-size 口径。
  let maskScale = null
  if (process.argv.includes('--mask-scale')) {
    if (!inpaint) throw new Error('--mask-scale 只能配合 --inpaint 使用')
    const value = Number(argOf('mask-scale', ''))
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`--mask-scale 取值应在 (0, 1]，收到 ${argOf('mask-scale', '') || '(空)'}`)
    }
    maskScale = value
  }
  // 同一蒙版多档强度对比：各出一张，记录蒙版内平均差异（验收 §六 第 3 项）。
  let strengthCompare = null
  if (process.argv.includes('--strength-compare')) {
    if (!inpaint) throw new Error('--strength-compare 只能配合 --inpaint 使用')
    const parts = String(argOf('strength-compare', ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length < 2) {
      throw new Error('--strength-compare 至少给两档，例如 --strength-compare 0.9,1.0')
    }
    const values = []
    for (const part of parts) {
      const value = Number(part)
      if (!Number.isFinite(value)) throw new Error(`--strength-compare 含非法数值：${part}`)
      const normalized = normalizeStrengthValue(value, LIMITS.strength.inpaintMax)
      if (!values.includes(normalized)) values.push(normalized)
    }
    if (values.length < 2) throw new Error('--strength-compare 去重后不足两档')
    strengthCompare = values
  }
  // 连续局部重绘轮数：第 2 轮起把上一轮出图当参考图（验证「以结果继续重绘」）。
  const rawRounds = Number(argOf('inpaint-rounds', '1'))
  const inpaintRounds = Number.isFinite(rawRounds) ? Math.min(3, Math.max(1, Math.round(rawRounds))) : 1
  if (process.argv.includes('--inpaint-rounds') && !inpaint) {
    throw new Error('--inpaint-rounds 只能配合 --inpaint 使用')
  }
  if (strengthCompare && inpaintRounds > 1) {
    throw new Error('--strength-compare 与 --inpaint-rounds 是两种验收方式，请分开运行')
  }
  // 局部重绘的提示词可以单独给：用与文生图不同的描述，才能肉眼确认「白色蒙版区真的按新内容重写」。
  const prompt = String(argOf('prompt', DEFAULT_PROMPT))
  const inpaintPrompt = String(argOf('inpaint-prompt', '')).trim() || prompt
  // 排队超过阈值仍不运行就换新实例重排：Kaggle 免费 GPU 偶发条目卡在 QUEUED，
  // 重推一个 Kernel 往往几十秒就能拿到卡（与工作台的「换新实例重排」同一机制）。
  const rawQueueMinutes = Number(argOf('max-queue-minutes', '5'))
  const maxQueueMinutes =
    Number.isFinite(rawQueueMinutes) && rawQueueMinutes >= 0 ? rawQueueMinutes : 5
  const rawReplace = Number(argOf('max-replace', '3'))
  const maxReplace = Number.isFinite(rawReplace) && rawReplace >= 0 ? Math.min(10, Math.round(rawReplace)) : 3
  // 局部重绘的蒙版形状/大小/位置：默认是验收用的「中心 40% 矩形」，调小并挪到具体物体上
  // 就能模拟真实笔刷的小面积涂抹。
  const maskShape = String(argOf('mask-shape', 'rect')).trim().toLowerCase() === 'circle' ? 'circle' : 'rect'
  const rawMaskSize = Number(argOf('mask-size', '0.4'))
  const maskSize = Number.isFinite(rawMaskSize) ? Math.min(1, Math.max(0.02, rawMaskSize)) : 0.4
  const centerParts = String(argOf('mask-center', '0.5,0.5')).split(',').map((part) => Number(part.trim()))
  const maskCenterX = Number.isFinite(centerParts[0]) ? Math.min(1, Math.max(0, centerParts[0])) : 0.5
  const maskCenterY = Number.isFinite(centerParts[1]) ? Math.min(1, Math.max(0, centerParts[1])) : 0.5
  // Phase C1 参考生图：验收张数（受契约上限约束）与每档轮数。
  const maxReferenceCount = Math.max(1, Number(LIMITS.referenceImages?.maxCount) || 1)
  let referenceCounts = [1, Math.min(2, maxReferenceCount)].filter((value, index, list) => list.indexOf(value) === index)
  if (process.argv.includes('--reference-count')) {
    if (!reference && !process.argv.includes('--c1-acceptance')) {
      throw new Error('--reference-count 只能配合 --reference / --c1-acceptance 使用')
    }
    const parts = String(argOf('reference-count', ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const counts = []
    for (const part of parts) {
      const value = Number(part)
      if (!Number.isInteger(value) || value < 1 || value > maxReferenceCount) {
        throw new Error(`--reference-count 取值应为 1~${maxReferenceCount} 的整数，收到 ${part}`)
      }
      if (!counts.includes(value)) counts.push(value)
    }
    if (!counts.length) throw new Error('--reference-count 至少给一个张数')
    referenceCounts = counts.sort((left, right) => left - right)
  }
  const rawReferenceRounds = Number(argOf('reference-rounds', '0'))
  const referenceRounds =
    Number.isFinite(rawReferenceRounds) && rawReferenceRounds > 0
      ? Math.min(3, Math.round(rawReferenceRounds))
      : null
  if (process.argv.includes('--reference-rounds') && !reference && !process.argv.includes('--c1-acceptance')) {
    throw new Error('--reference-rounds 只能配合 --reference / --c1-acceptance 使用')
  }
  const rawAccelRounds = Number(argOf('accel-rounds', '2'))
  const accelRounds =
    Number.isFinite(rawAccelRounds) && rawAccelRounds > 0 ? Math.min(5, Math.round(rawAccelRounds)) : 2
  if (
    process.argv.includes('--accel-rounds') &&
    !accel &&
    !accelCache &&
    !process.argv.includes('--c1-acceptance')
  ) {
    throw new Error('--accel-rounds 只能配合 --accel / --accel-cache / --c1-acceptance 使用')
  }
  return {
    presets,
    prompt,
    inpaintPrompt,
    img2img,
    inpaint,
    upscale,
    outpaint,
    outpaintLora,
    accelCache,
    reference,
    c1Acceptance,
    referenceCounts,
    referenceRounds,
    accel,
    accelRounds,
    strength,
    referenceSize,
    maskScale,
    strengthCompare,
    inpaintRounds,
    maxQueueMinutes,
    maxReplace,
    sourcePreset: sourcePresetArg,
    maskShape,
    maskSize,
    maskCenterX,
    maskCenterY,
  }
}

function createSubprocess() {
  return {
    async resolveExecutable(name) {
      return name
    },
    spawn({ argv, cwd, signal }) {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: cwd ?? process.cwd(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const out = []
      const err = []
      child.stdout.on('data', (chunk) => out.push(chunk))
      child.stderr.on('data', (chunk) => err.push(chunk))
      const done = new Promise((resolve) => {
        child.on('error', (error) => resolve({ exitCode: -1, error: String(error?.message ?? error) }))
        child.on('close', (code, sig) => resolve({ exitCode: code ?? -1, signal: sig }))
      })
      signal?.addEventListener?.('abort', () => child.kill())
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: Buffer.concat(out).toString('utf8') }) },
          stderr: { readFrom: () => ({ text: Buffer.concat(err).toString('utf8') }) },
        },
        terminate: async () => {
          child.kill()
        },
        waitForExit: () => done,
      }
    },
  }
}

function createContext() {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: PLUGIN_ROOT }
      return undefined
    },
    subprocess: createSubprocess(),
    webServer: { getOrigin: () => '' },
  }
}

function fmt(value) {
  return JSON.stringify(value, null, 2)
}

/**
 * 在已就绪的会话里加载一个预设并出图一张，返回 PNG 与报告条目。
 *
 * 连续调用即完成「同一会话内连续切换模型」：daemon 在切换时先释放旧 pipeline，
 * 再按目标模型依赖构建 keep_set 清理 HF 缓存，最后下载/加载新模型。
 *
 * `width` / `height` 可选（默认跟随预设 size）：`--inpaint --reference-size` 用它生成
 * 非正方形源图，后续局部重绘按参考图同比例生成蒙版。
 */
async function generateOne({ endpoint, token, presetId, prompt, index, total, width, height, pipelineSpec = null, seed = 42 }) {
  const preset = presetById(presetId)
  const pipelineKind = preset?.pipeline?.loader ?? null
  const taskWidth = width ?? preset.size
  const taskHeight = height ?? preset.size
  console.log(
    `  · [${index + 1}/${total}] ${presetId}（${pipelineKind ?? '-'}）加载并出图 ${taskWidth}x${taskHeight} …`,
  )
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: pipelineSpec ?? preset.pipeline,
      modelId: preset.repo,
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed,
          width: taskWidth,
          height: taskHeight,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error(`预设 ${presetId}：远端没有返回图片`)
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error(`预设 ${presetId}：返回内容不是合法 PNG`)
  return {
    png,
    entry: {
      preset: presetId,
      modelId: preset.repo,
      pipelineKind,
      seed,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      // 实际出图尺寸（anima 会把宽高向下取整到 16 的倍数，与请求值可能不同）。
      width: result.width ?? null,
      height: result.height ?? null,
      requestedWidth: taskWidth,
      requestedHeight: taskHeight,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

/**
 * Phase C1 原生参考生图单次执行：1~N 张已解码 PNG 以 job 级 `referenceImages` 提交。
 *
 * 关键断言（不满足直接抛错，验收失败可见）：
 *  - 输出尺寸严格等于请求的 width/height（原生参考生图不跟随参考图尺寸）；
 *  - 远端返回合法 PNG，输出尺寸可由 PNG 头读取。
 * 关键观察：`load_seconds` 首轮是模型加载时间，后续轮应为 0（同一 pipeline spec 复用）。
 */
async function runReference({
  endpoint,
  token,
  presetId,
  referencePngs,
  prompt,
  width,
  height,
  seed = 42,
  pipelineSpec = null,
}) {
  const preset = presetById(presetId)
  const referenceSizes = referencePngs.map((png) => pngSize(png) ?? { width: null, height: null })
  console.log(
    `  · [reference] ${presetId} 参考图 ${referencePngs.length} 张（尺寸 ` +
      `${referenceSizes.map((size) => `${size.width}x${size.height}`).join(' + ')}）→ 目标 ${width}x${height} …`,
  )
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: pipelineSpec ?? preset.pipeline,
      modelId: preset.repo,
      referenceImages: referencePngs.map((png) => ({ image_b64: png.toString('base64') })),
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed,
          width,
          height,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('reference：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('reference：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  if (!outputSize) throw new Error('reference：无法从 PNG 头读取输出尺寸')
  if (outputSize.width !== width || outputSize.height !== height) {
    throw new Error(
      `reference：输出尺寸不符，期望 ${width}x${height}，收到 ${outputSize.width}x${outputSize.height}`,
    )
  }
  console.log(
    `  · 参考生图完成：${outputSize.width}x${outputSize.height}，参考图 ${referencePngs.length} 张，加载 ` +
      `${response.load_seconds ?? '-'}s / 推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节`,
  )
  return {
    png,
    entry: {
      preset: presetId,
      referenceCount: referencePngs.length,
      referenceSizes,
      referenceBytes: referencePngs.reduce((sum, pngItem) => sum + pngItem.length, 0),
      seed,
      requestedWidth: width,
      requestedHeight: height,
      width: outputSize.width,
      height: outputSize.height,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

/**
 * 拉远端日志并挑出 [cache] 相关行（探针 / 清理 / evicted）。
 * 日志接口失败只告警、返回 null，不影响 GPU 验证结论。
 */
/** 拉取远端日志里与推理相关的行（[load]/[gen]/[job]），排障与验收报告用。 */
async function collectGenLogs(endpoint, token) {
  try {
    const payload = await requestLogs(endpoint, token, 0, 8000)
    const lines = Array.isArray(payload?.lines) ? payload.lines : []
    return lines.filter(
      (line) => typeof line === 'string' && /\[(load|gen|job|upscale)\]/.test(line),
    )
  } catch (error) {
    return [`（远端日志拉取失败：${String(error?.message ?? error).slice(0, 120)}）`]
  }
}

async function collectCacheLogs(endpoint, token) {
  try {
    const payload = await requestLogs(endpoint, token, 0, 8000)
    const lines = Array.isArray(payload?.lines)
      ? payload.lines.filter((line) => typeof line === 'string' && line.includes('[cache]'))
      : []
    const evicted = lines.filter((line) => line.includes('[cache] evicted'))
    return {
      evictedCount: evicted.length,
      evicted,
      lines: lines.slice(-80),
    }
  } catch (error) {
    console.warn(`  · 拉取远端 /logs 失败（忽略，不影响验证结论）：${error?.message ?? error}`)
    return null
  }
}

/**
 * 拉远端 /logs 并按正则挑行（Phase C2 的 LoRA / 缓存标记日志取证用）。
 *
 * 与 collectGenLogs / collectCacheLogs 的区别：调用方给匹配器，用于单次提交后立刻
 * 取证（例如 `[load] flux2 LoRA 已挂载`、`[accel] WARN cache 不适用`）。
 * 拉取失败只返回一条说明，不影响验证结论。
 */
async function collectLogLines(endpoint, token, matcher) {
  try {
    const payload = await requestLogs(endpoint, token, 0, 8000)
    const lines = Array.isArray(payload?.lines) ? payload.lines : []
    return lines.filter((line) => typeof line === 'string' && matcher.test(line)).slice(-80)
  } catch (error) {
    return [`（远端日志拉取失败：${String(error?.message ?? error).slice(0, 120)}）`]
  }
}

function artifactName(index, presetId, total) {
  return total === 1 ? '01.png' : `${String(index + 1).padStart(2, '0')}-${presetId}.png`
}

/** 读取远端只读显存诊断（/health.gpu_memory）；不可用时返回 null，不影响验证结论。 */
async function readGpuMemory(endpoint, token) {
  try {
    const health = await fetchHealth(endpoint, token, 8000)
    return health?.gpu_memory ?? null
  } catch {
    return null
  }
}

/** 取中位数（偶数个取中间两个的平均）；空数组返回 null。用于 A/B 的稳态耗时。 */
function medianOf(values) {
  const numbers = (values ?? []).filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (!numbers.length) return null
  const middle = Math.floor(numbers.length / 2)
  const value = numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
  return Math.round(value * 100) / 100
}

/** A/B 提速比：off 中位秒数 / on 中位秒数（>1 表示 on 更快）；缺一档返回 null。 */
function speedupOf(offConfig, onConfig) {
  const off = offConfig?.medianSeconds
  const on = onConfig?.medianSeconds
  if (!Number.isFinite(off) || !Number.isFinite(on) || on <= 0) return null
  return Math.round((off / on) * 100) / 100
}

/** A/B 峰值显存差（on - off，MiB）：负数表示 on 更省显存。 */
function peakDeltaOf(offConfig, onConfig) {
  const off = offConfig?.gpuMemoryAfter?.max_allocated_mb
  const on = onConfig?.gpuMemoryAfter?.max_allocated_mb
  if (!Number.isFinite(off) || !Number.isFinite(on)) return null
  return on - off
}

/**
 * 两张同尺寸 PNG 的平均绝对差（0~255，逐通道平均）；无法解码或尺寸不一致时返回 null。
 *
 * 用途：比较「无参考 vs 有参考」「accel off vs on」的输出差异，作为条件生效/画质变化的定量证据。
 */
function meanAbsDiffPng(basePng, otherPng) {
  const base = decodePng(basePng)
  const other = decodePng(otherPng)
  if (!base || !other) return null
  if (base.width !== other.width || base.height !== other.height) return null
  const channels = Math.min(base.channels ?? 3, other.channels ?? 3)
  if (channels < 3) return null
  let sum = 0
  for (let index = 0; index < base.width * base.height; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      sum += Math.abs(base.pixels[index * base.channels + channel] - other.pixels[index * other.channels + channel])
    }
  }
  return Math.round((sum / (base.width * base.height * 3)) * 100) / 100
}

/**
 * Phase C1 推理加速开关：按预设家族返回「开启」档的 accel 配置。
 *
 * 真机 A/B 只对 SDXL 家族做：UNet 上 channels_last + fuse_qkv 有可测收益，VAE tiling 主要降峰值显存；
 * 专用 inpaint（nativeInpaint）只切 vaeTiling。
 */
function accelOnConfigOf(preset) {
  const nativeInpaint = preset?.pipeline?.nativeInpaint === true
  if (nativeInpaint) return { vaeTiling: true }
  return { channelsLast: true, fuseQkv: true, vaeTiling: true }
}

/** 关闭态：显式写全 false（与缺省行为等价，但让报告里的两档配置可直接对比）。 */
function accelOffConfigOf() {
  return { vaeSlicing: false, vaeTiling: false, channelsLast: false, fuseQkv: false }
}

/** 在预设 pipeline spec 上覆盖 accel（其它字段逐字保留）。 */
function withAccelSpec(pipelineSpec, accelConfig) {
  return { ...(pipelineSpec ?? {}), accel: { ...accelConfig } }
}

/**
 * Phase C2：在 flux2 pipeline spec 上覆盖扩图 LoRA（其它字段逐字保留）。
 *
 * 远端 Flux2Loader 按 `{repo, weight, scale}` 挂载 LoRA：优先命中预挂载权重，
 * 未命中时 hf_hub_download；scale ≠1 时按适配器权重缩放。spec 里不带 `accel`，
 * 避免把缓存探针和 LoRA 混在同一次提交里。
 */
function withFlux2LoraSpec(pipelineSpec, lora = OUTPAINT_LORA.lora) {
  return {
    ...(pipelineSpec ?? {}),
    lora: { repo: lora.repo, weight: lora.weight, scale: lora.scale },
  }
}

/** Phase C2：缓存探针 on 档的 pipeline spec（只覆盖 `accel.cache`，其余字段逐字保留）。 */
function withAccelCacheSpec(pipelineSpec, cache = ACCEL_CACHE) {
  return {
    ...(pipelineSpec ?? {}),
    accel: { ...(pipelineSpec?.accel ?? {}), cache: { type: cache.type, threshold: cache.threshold } },
  }
}

/** Phase C2：缓存探针 off 档的 pipeline spec（原资产，显式不带 accel）。 */
function accelCacheOffSpec(preset) {
  const spec = { ...(preset?.pipeline ?? {}) }
  delete spec.accel
  return spec
}

/**
 * 出图尺寸与请求画布不一致时，把内容区坐标按比例映射到实际输出尺寸。
 *
 * flux2 内部可能按约 1 MP 面积上限静默缩放画布（1536x864 → 1360x768），
 * 此时内容区在输出里的相对位置不变，按同一比例换算后再算像素差/接缝才有意义。
 */
function scaledContentOf(outputSize, canvas = OUTPAINT_CANVAS, content = OUTPAINT_CONTENT) {
  if (!outputSize || !canvas.width || !canvas.height) return { ...content }
  const sx = outputSize.width / canvas.width
  const sy = outputSize.height / canvas.height
  return {
    x: Math.round(content.x * sx),
    y: Math.round(content.y * sy),
    width: Math.round(content.width * sx),
    height: Math.round(content.height * sy),
  }
}

/**
 * 扫描 bench-results/gpu-live/<ts>/report.json 汇总历史 sdxl-inpaint 扩图耗时基线。
 *
 * 只读历史报告（不存在或解析失败时回退常量 OUTPAINT_LORA_BASELINE），给 `--outpaint-lora`
 * 的现代扩图引擎一个同画布（1536x864）、同任务（扩图）的可比耗时基准。
 * 取三种来源：outpaint.imageSeconds、accel(configs[].rounds[].imageSeconds)、
 * c1-acceptance 的 outpaint 段；每份报告只贡献一次，避免 c1 报告把权重放大。
 */
async function loadOutpaintBaseline() {
  const samples = []
  const sources = []
  try {
    const entries = await readdir(OUT_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let report
      try {
        report = JSON.parse(await readFile(join(OUT_DIR, entry.name, 'report.json'), 'utf8'))
      } catch {
        continue
      }
      const found = []
      const single = report?.outpaint
      if (single?.preset === OUTPAINT_LORA_BASELINE.preset && Number.isFinite(single.imageSeconds)) {
        found.push(single.imageSeconds)
      }
      const accelSections = [report?.accel, report?.accel?.outpaint]
      for (const section of accelSections) {
        if (section?.preset !== OUTPAINT_LORA_BASELINE.preset) continue
        // 加速 A/B 只取 off 档（与历史单次扩图同配置），避免把 vaeTiling 档的耗时混进基线。
        const offConfigs = (section.configs ?? []).filter((config) => config.label === 'off')
        const configs = offConfigs.length ? offConfigs : (section.configs ?? [])
        for (const config of configs) {
          for (const round of config.rounds ?? []) {
            if (Number.isFinite(round.imageSeconds)) found.push(round.imageSeconds)
          }
        }
      }
      if (!found.length) continue
      samples.push(...found)
      sources.push(`bench-results/gpu-live/${entry.name}/report.json`)
    }
  } catch {
    // bench-results 不存在（干净检出）时静默回退常量基线。
  }
  const values = samples.length ? samples : [...OUTPAINT_LORA_BASELINE.samples]
  return {
    preset: OUTPAINT_LORA_BASELINE.preset,
    canvas: `${OUTPAINT_LORA_BASELINE.width}x${OUTPAINT_LORA_BASELINE.height}`,
    samples: values.map((value) => Math.round(value * 100) / 100),
    sampleCount: values.length,
    medianSeconds: medianOf(values),
    minSeconds: Math.round(Math.min(...values) * 100) / 100,
    sources: sources.slice(-8),
    note: 'sdxl-inpaint 在 1536x864 画布上的历史扩图推理秒数（bench-results 历史报告汇总）',
  }
}

/**
 * 扩图接缝指标：内容区左右边界处的横向梯度 vs 内容区内部平均梯度。
 *
 * 比值越接近 1 说明新增区与内容区过渡越自然；>2 通常肉眼可见竖直接缝。
 * PNG 解码失败时返回 null（不影响其它验收项）。
 */
function outpaintSeamMetrics(outPng, content = OUTPAINT_CONTENT) {
  const image = decodePng(outPng)
  if (!image) return null
  const channels = image.channels ?? 3
  if (channels < 3 || image.width < 8 || image.height < 2) return null
  const { width, height } = image
  const x0 = Math.max(1, Math.min(width - 2, Math.round(content.x)))
  const x1 = Math.max(x0 + 1, Math.min(width - 2, Math.round(content.x + content.width)))
  const gradientAt = (column) => {
    let sum = 0
    for (let y = 0; y < height; y += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const left = image.pixels[(y * width + column) * channels + channel]
        const right = image.pixels[(y * width + column + 1) * channels + channel]
        sum += Math.abs(left - right)
      }
    }
    return sum / (height * 3)
  }
  const interiorMean = (from, to) => {
    const start = Math.max(1, Math.min(width - 2, from))
    const end = Math.max(start + 1, Math.min(width - 1, to))
    let total = 0
    let count = 0
    for (let column = start; column < end; column += 1) {
      total += gradientAt(column)
      count += 1
    }
    return count > 0 ? total / count : null
  }
  const ratio = (jump, interior) =>
    Number.isFinite(jump) && Number.isFinite(interior) && interior > 0
      ? Math.round((jump / interior) * 100) / 100
      : null
  const leftJump = gradientAt(x0 - 1)
  const rightJump = gradientAt(x1 - 1)
  const leftInterior = interiorMean(x0 + 8, x0 + 64)
  const rightInterior = interiorMean(Math.max(x0 + 8, x1 - 64), x1 - 8)
  return {
    leftJump: Math.round(leftJump * 100) / 100,
    leftInterior: Number.isFinite(leftInterior) ? Math.round(leftInterior * 100) / 100 : null,
    leftRatio: ratio(leftJump, leftInterior),
    rightJump: Math.round(rightJump * 100) / 100,
    rightInterior: Number.isFinite(rightInterior) ? Math.round(rightInterior * 100) / 100 : null,
    rightRatio: ratio(rightJump, rightInterior),
  }
}

/**
 * M3 真机验收：在同一会话里用刚生成的图片做一次垫图重绘。
 *
 * 关键观察点：`load_seconds` 应为 0（`AutoPipelineForImage2Image.from_pipe` 复用已加载底座，
 * 不重新加载权重），且 `gpu_memory.reserved_mb` / `max_allocated_mb` 相比文生图结束时应基本持平。
 * 直接按远端 job 协议提交（与 Host lib/jobs.js 的下发形状一致：job 级 `reference`）。
 */
async function runImg2Img({ endpoint, token, presetId, sourcePng, prompt, strength }) {
  const preset = presetById(presetId)
  console.log(`  · [img2img] ${presetId} 以刚生成的图做垫图重绘（strength=${strength}）…`)
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      reference: { image_b64: sourcePng.toString('base64'), strength },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 43,
          width: preset.size,
          height: preset.size,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('img2img：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('img2img：返回内容不是合法 PNG')
  return {
    png,
    entry: {
      preset: presetId,
      strength,
      referenceBytes: sourcePng.length,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      referenceWidth: result.referenceWidth ?? null,
      referenceHeight: result.referenceHeight ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

// CRC32 查表：PNG 每个 chunk 都要带，生成测试蒙版不引入额外依赖。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 组装一个 PNG chunk：长度 + 类型 + 数据 + CRC。 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/**
 * 生成程序化黑白蒙版 PNG（8 位灰度），供 --inpaint 真机验收使用。
 *
 * 语义与客户端 canvas 导出完全一致：白 = 重绘区域、黑 = 保留区域。
 * 返回 `{ png, width, height, coverage, shape }`：`coverage` 是白色像素占全图比例
 * （与远端 decode_mask_image 的统计口径一致），报告里直接引用便于排障与验收记录。
 *
 * 尺寸口径（二者取其一）：
 *  - `scale`（面积占比 0~1）优先：rect 用边长 √scale、circle 用面积 = scale × 画布面积的
 *    圆/椭圆，白色区域面积 ≈ scale；
 *  - 否则沿用旧 `size` 口径：rect 的宽高 = 画布边长 × size，circle 直径 = 短边 × size。
 * `centerX` / `centerY` 是 0~1 的相对位置，默认画面中心；调小面积、移到具体物体上即可
 * 模拟真实笔刷的小面积涂抹。
 */
function buildMaskPng(width, height, options = {}) {
  const w = Math.max(16, Math.round(Number(width) || 0))
  const h = Math.max(16, Math.round(Number(height) || 0))
  const shape = options.shape === 'circle' ? 'circle' : 'rect'
  let radiusX
  let radiusY
  const rawScale = Number(options.scale)
  if (Number.isFinite(rawScale) && rawScale > 0) {
    const target = Math.min(1, rawScale)
    if (shape === 'circle') {
      const radius = Math.sqrt((target * w * h) / Math.PI)
      radiusX = radius
      radiusY = radius
    } else {
      const side = Math.sqrt(target)
      radiusX = (w * side) / 2
      radiusY = (h * side) / 2
    }
  } else {
    const rawSize = Number(options.size)
    const sizeRatio = Number.isFinite(rawSize) ? Math.min(1, Math.max(0.02, rawSize)) : 0.4
    radiusX = ((shape === 'circle' ? Math.min(w, h) : w) * sizeRatio) / 2
    radiusY = ((shape === 'circle' ? Math.min(w, h) : h) * sizeRatio) / 2
  }
  const rawCenterX = Number(options.centerX)
  const rawCenterY = Number(options.centerY)
  const centerX = Math.round(w * (Number.isFinite(rawCenterX) ? Math.min(1, Math.max(0, rawCenterX)) : 0.5))
  const centerY = Math.round(h * (Number.isFinite(rawCenterY) ? Math.min(1, Math.max(0, rawCenterY)) : 0.5))
  const left = Math.round(centerX - radiusX)
  const right = Math.round(centerX + radiusX)
  const top = Math.round(centerY - radiusY)
  const bottom = Math.round(centerY + radiusY)
  const raw = Buffer.alloc((w + 1) * h)
  let whitePixels = 0
  for (let y = 0; y < h; y += 1) {
    const row = y * (w + 1)
    raw[row] = 0 // filter type: none
    for (let x = 0; x < w; x += 1) {
      let inside
      if (shape === 'circle') {
        const dx = (x - centerX) / Math.max(1, radiusX)
        const dy = (y - centerY) / Math.max(1, radiusY)
        inside = dx * dx + dy * dy <= 1
      } else {
        inside = x >= left && x < right && y >= top && y < bottom
      }
      raw[row + 1 + x] = inside ? 255 : 0
      if (inside) whitePixels += 1
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return { png, width: w, height: h, coverage: whitePixels / (w * h), shape }
}

/** 读取 PNG 的 IHDR 宽高；非 PNG / 头部不完整返回 null。 */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * 最小 PNG 解码器（位深 8、非隔行、灰度/RGB/RGBA）：只用于计算「蒙版内平均差异」。
 *
 * 远端的样张是 PIL 默认保存的 8 位 RGB PNG；调色板 / 16 位 / 隔行图不在验收范围内，
 * 遇到不支持的格式返回 null（报告里的差异记 null，不影响出图验收本身）。
 */
function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (data.length !== length) return null
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!header || header.bitDepth !== 8 || header.interlace !== 0) return null
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) return null
  let raw
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const stride = header.width * channels
  const pixels = Buffer.alloc(stride * header.height)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    if (line.length !== stride) return null
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let value
      switch (filter) {
        case 0:
          value = line[x]
          break
        case 1:
          value = line[x] + a
          break
        case 2:
          value = line[x] + b
          break
        case 3:
          value = line[x] + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          value = line[x] + predictor
          break
        }
        default:
          return null
      }
      out[x] = value & 0xff
    }
    prev = out
  }
  return { width: header.width, height: header.height, channels, pixels }
}

/** 像素亮度：灰度取单通道、RGB/A 取 RGB 均值（与 decodePng 的通道布局对应）。 */
function pixelBrightness(image, index) {
  const offset = index * image.channels
  if (image.channels <= 2) return image.pixels[offset]
  return (image.pixels[offset] + image.pixels[offset + 1] + image.pixels[offset + 2]) / 3
}

/**
 * 两张同尺寸 PNG 在蒙版白色区域内的平均亮度绝对差异（0~255，保留两位小数）。
 * 尺寸不一致或任一张图无法解码时返回 null；蒙版按「任一通道 >=128 视为重绘区」
 * 判定（与远端「白 = 重绘」语义一致）。
 */
function maskedMeanDiff(basePng, otherPng, maskPng) {
  const base = decodePng(basePng)
  const other = decodePng(otherPng)
  const mask = decodePng(maskPng)
  if (!base || !other || !mask) return null
  if (
    base.width !== other.width ||
    base.height !== other.height ||
    base.width !== mask.width ||
    base.height !== mask.height
  ) {
    return null
  }
  let sum = 0
  let count = 0
  const total = mask.width * mask.height
  for (let index = 0; index < total; index += 1) {
    const maskOffset = index * mask.channels
    let white = false
    for (let channel = 0; channel < mask.channels; channel += 1) {
      if (mask.pixels[maskOffset + channel] >= 128) {
        white = true
        break
      }
    }
    if (!white) continue
    sum += Math.abs(pixelBrightness(base, index) - pixelBrightness(other, index))
    count += 1
  }
  if (!count) return null
  return Math.round((sum / count) * 100) / 100
}

/**
 * 把解码后的 RGB(A) 像素按 8 位 RGB 编码成 PNG（filter 0，无隔行）。
 * 扩图验收需要在 Node 侧合成画布：复用脚本里的 CRC/chunk/deflate 工具，不引第三方图像库。
 */
function encodePngRgb(width, height, pixels) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1)
    raw[row] = 0 // filter type: none
    pixels.copy(raw, row + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 构造扩图画布：内容区贴原图，新增区域用「四边 1px 边缘像素延拓」填充（edge clamp）。
 *
 * 为什么不再用纯白/纯黑填底（FIXES-INTERFACES §B）：纯色底在 VAE latent 边界与内容区之间
 * 制造亮度跳变，模型会把这段跳变当成真实画面去重画，成片在边界留下明显分界。边缘延拓让
 * 新增区从原图边缘「拉出去」，模型只需要延续已有纹理。
 *
 * 实现与前端 `outpaintEdgeStripsOf` 的 8 条拉伸条带像素结果完全一致：
 * 画布任意像素取内容框内最近边缘像素 `sx = clamp(x - content.x, 0, sw-1)`、
 * `sy = clamp(y - content.y, 0, sh-1)`；内容框内部这个映射就是恒等映射，所以一次遍历
 * 即可同时完成「延拓 + 贴内容区」，不需要另画条带再覆盖。
 */
function buildOutpaintCanvas(sourcePng, canvas = OUTPAINT_CANVAS, content = OUTPAINT_CONTENT) {
  const source = decodePng(sourcePng)
  if (!source) throw new Error('outpaint：无法解码源图 PNG')
  if (source.width !== content.width || source.height !== content.height) {
    throw new Error(
      `outpaint：源图应为 ${content.width}x${content.height}，收到 ${source.width}x${source.height}`,
    )
  }
  const pixels = Buffer.alloc(canvas.width * canvas.height * 3)
  const maxSourceX = source.width - 1
  const maxSourceY = source.height - 1
  for (let y = 0; y < canvas.height; y += 1) {
    // 内容框外按最近边缘像素延拓（等价于 top/bottom 条带把首/末行拉伸出去）。
    const sy = Math.min(Math.max(y - content.y, 0), maxSourceY)
    const sourceRow = sy * source.width * source.channels
    const targetRow = y * canvas.width * 3
    for (let x = 0; x < canvas.width; x += 1) {
      const sx = Math.min(Math.max(x - content.x, 0), maxSourceX)
      const sourceOffset = sourceRow + sx * source.channels
      const targetOffset = targetRow + x * 3
      pixels[targetOffset] = source.pixels[sourceOffset]
      pixels[targetOffset + 1] =
        source.channels >= 3 ? source.pixels[sourceOffset + 1] : source.pixels[sourceOffset]
      pixels[targetOffset + 2] =
        source.channels >= 3 ? source.pixels[sourceOffset + 2] : source.pixels[sourceOffset]
    }
  }
  return {
    png: encodePngRgb(canvas.width, canvas.height, pixels),
    width: canvas.width,
    height: canvas.height,
    content: { ...content },
    sourceSize: { width: source.width, height: source.height },
    // 可断言标记：report.outpaint.canvasFill 直接引用（FIXES-INTERFACES §B3）。
    fill: 'edge-extend',
  }
}

/** 构造扩图蒙版：白 = 新增区域（内容区之外），黑 = 保留区域（原图内容区）。 */
function buildOutpaintMaskPng(canvas = OUTPAINT_CANVAS, content = OUTPAINT_CONTENT) {
  const raw = Buffer.alloc((canvas.width + 1) * canvas.height)
  let whitePixels = 0
  for (let y = 0; y < canvas.height; y += 1) {
    const row = y * (canvas.width + 1)
    raw[row] = 0
    for (let x = 0; x < canvas.width; x += 1) {
      const inContent =
        x >= content.x &&
        x < content.x + content.width &&
        y >= content.y &&
        y < content.y + content.height
      raw[row + 1 + x] = inContent ? 0 : 255
      if (!inContent) whitePixels += 1
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(canvas.width, 0)
  ihdr.writeUInt32BE(canvas.height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return { png, coverage: whitePixels / (canvas.width * canvas.height) }
}

/**
 * 内容区保留度统计：把源图内容逐像素与「出图对应内容区」比较，返回平均亮度绝对差。
 *
 * `margin` 用来避开羽化过渡带（远端按蒙版覆盖率把白色区域外扩 6~8px 再高斯羽化，
 * 内容区边界附近会被生成结果替换）；`margin` 越大越接近「纯保留区」的差异。
 * 尺寸不一致 / 无法解码返回 null。
 */
function contentRegionDiff(sourcePng, outPng, content = OUTPAINT_CONTENT, margin = 0) {
  const source = decodePng(sourcePng)
  const out = decodePng(outPng)
  if (!source || !out) return null
  if (source.width !== content.width || source.height !== content.height) return null
  if (out.width < content.x + content.width || out.height < content.y + content.height) return null
  const x0 = Math.max(0, margin)
  const y0 = Math.max(0, margin)
  const x1 = content.width - Math.max(0, margin)
  const y1 = content.height - Math.max(0, margin)
  if (x1 <= x0 || y1 <= y0) return null
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const sourceIndex = y * content.width + x
      const outIndex = (content.y + y) * out.width + (content.x + x)
      sum += Math.abs(pixelBrightness(source, sourceIndex) - pixelBrightness(out, outIndex))
      count += 1
    }
  }
  if (!count) return null
  return Math.round((sum / count) * 100) / 100
}

/**
 * Phase C2：构造纯绿扩图画布（LoRA 训练约定：绿边 = 待填充区域）。
 *
 * 与 `buildOutpaintCanvas` 的区别只在新区域填充：这里用 #00FF00 纯色，而不是边缘延拓；
 * 内容区仍按 `content` 原样贴入（逐像素复制，不缩放），画布与内容区几何保持与 B2 一致，
 * 这样历史 sdxl-inpaint 基线与新引擎的耗时/内容区像素差可以直接对比。
 */
function buildGreenOutpaintCanvas(
  sourcePng,
  canvas = OUTPAINT_CANVAS,
  content = OUTPAINT_CONTENT,
  fill = OUTPAINT_LORA.green,
) {
  const source = decodePng(sourcePng)
  if (!source) throw new Error('outpaint-lora：无法解码源图 PNG')
  if (source.width !== content.width || source.height !== content.height) {
    throw new Error(
      `outpaint-lora：源图应为 ${content.width}x${content.height}，收到 ${source.width}x${source.height}`,
    )
  }
  const pixels = Buffer.alloc(canvas.width * canvas.height * 3)
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = fill.r
    pixels[offset + 1] = fill.g
    pixels[offset + 2] = fill.b
  }
  for (let y = 0; y < content.height; y += 1) {
    const sourceRow = y * source.width * source.channels
    const targetRow = (content.y + y) * canvas.width * 3
    for (let x = 0; x < content.width; x += 1) {
      const sourceOffset = sourceRow + x * source.channels
      const targetOffset = targetRow + (content.x + x) * 3
      pixels[targetOffset] = source.pixels[sourceOffset]
      pixels[targetOffset + 1] =
        source.channels >= 3 ? source.pixels[sourceOffset + 1] : source.pixels[sourceOffset]
      pixels[targetOffset + 2] =
        source.channels >= 3 ? source.pixels[sourceOffset + 2] : source.pixels[sourceOffset]
    }
  }
  const greenPixels = canvas.width * canvas.height - content.width * content.height
  return {
    png: encodePngRgb(canvas.width, canvas.height, pixels),
    width: canvas.width,
    height: canvas.height,
    content: { ...content },
    sourceSize: { width: source.width, height: source.height },
    fill: 'green',
    fillColor: '#00FF00',
    greenCoverage: greenPixels / (canvas.width * canvas.height),
  }
}

/**
 * Phase C2：把 PNG 双线性缩放到指定尺寸（用于生成 1024x576 的绿边参考图）。
 *
 * 只处理 8 位灰度/RGB/RGBA（decodePng 的既有范围）：目标按最近映射取源坐标，
 * 四个邻点按小数权重插值。双线性而不是最近邻：参考图的绿边/内容边界若出现锯齿，
 * 模型可能把锯齿当成画面纹理继续放大。解码失败返回 null。
 */
function resizePngTo(png, targetWidth, targetHeight) {
  const image = decodePng(png)
  if (!image) return null
  const channels = image.channels ?? 3
  if (channels < 3) return null
  const width = Math.max(1, Math.round(Number(targetWidth) || 0))
  const height = Math.max(1, Math.round(Number(targetHeight) || 0))
  const pixels = Buffer.alloc(width * height * 3)
  const scaleX = image.width / width
  const scaleY = image.height / height
  const sourceAt = (x, y, channel) => {
    const sx = Math.min(image.width - 1, Math.max(0, x))
    const sy = Math.min(image.height - 1, Math.max(0, y))
    return image.pixels[(sy * image.width + sx) * channels + channel]
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(image.height - 1, (y + 0.5) * scaleY - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(image.height - 1, y0 + 1)
    const fy = sourceY - y0
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(image.width - 1, (x + 0.5) * scaleX - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(image.width - 1, x0 + 1)
      const fx = sourceX - x0
      const targetOffset = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        const top = sourceAt(x0, y0, channel) * (1 - fx) + sourceAt(x1, y0, channel) * fx
        const bottom = sourceAt(x0, y1, channel) * (1 - fx) + sourceAt(x1, y1, channel) * fx
        pixels[targetOffset + channel] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return {
    png: encodePngRgb(width, height, pixels),
    width,
    height,
    sourceSize: { width: image.width, height: image.height },
  }
}

/**
 * Phase C2：绿边残留统计——出图里仍是纯绿（容差内）的像素占比。
 *
 * `exactGreenRatio` 只认严格 #00FF00；`nearGreenRatio` 允许每个通道 ±tolerance
 * （默认 24），用来覆盖 VAE 编解码造成的轻微色偏。残留比例越低说明 LoRA 把绿边
 * 填得越充分；>5% 通常意味着有明显没被填充的区域。
 */
function greenAreaStats(png, options = {}) {
  const image = decodePng(png)
  if (!image) return null
  const channels = image.channels ?? 3
  if (channels < 3) return null
  const tolerance = Number.isFinite(Number(options.tolerance))
    ? Math.max(0, Math.round(Number(options.tolerance)))
    : 24
  let exact = 0
  let near = 0
  const total = image.width * image.height
  for (let index = 0; index < total; index += 1) {
    const offset = index * channels
    const red = image.pixels[offset]
    const green = image.pixels[offset + 1]
    const blue = image.pixels[offset + 2]
    if (red === 0 && green === 255 && blue === 0) {
      exact += 1
      near += 1
      continue
    }
    if (
      Math.abs(red) <= tolerance &&
      Math.abs(green - 255) <= tolerance &&
      Math.abs(blue) <= tolerance
    ) {
      near += 1
    }
  }
  return {
    width: image.width,
    height: image.height,
    totalPixels: total,
    tolerance,
    exactGreenPixels: exact,
    nearGreenPixels: near,
    exactGreenRatio: Math.round((exact / total) * 10000) / 10000,
    nearGreenRatio: Math.round((near / total) * 10000) / 10000,
  }
}

/**
 * Phase C2：内容区颜色漂移——源图内容区与出图同一区域的逐通道均值差。
 *
 * 新引擎如果整体重画内容（而不是保留原像素），亮度差可能不大但色调会漂移；
 * 这里补一组成分 RGB 的均值对比，`maxAbsDelta` > 8 通常肉眼可辨。
 */
function contentColorDrift(sourcePng, outPng, content = OUTPAINT_CONTENT, margin = 16) {
  const source = decodePng(sourcePng)
  const out = decodePng(outPng)
  if (!source || !out) return null
  if (source.width !== content.width || source.height !== content.height) return null
  if (out.width < content.x + content.width || out.height < content.y + content.height) return null
  const x0 = Math.max(0, margin)
  const y0 = Math.max(0, margin)
  const x1 = content.width - Math.max(0, margin)
  const y1 = content.height - Math.max(0, margin)
  if (x1 <= x0 || y1 <= y0) return null
  let sourceR = 0
  let sourceG = 0
  let sourceB = 0
  let outR = 0
  let outG = 0
  let outB = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const sourceOffset = (y * content.width + x) * source.channels
      const outOffset = ((content.y + y) * out.width + (content.x + x)) * out.channels
      sourceR += source.pixels[sourceOffset]
      sourceG += source.pixels[sourceOffset + 1]
      sourceB += source.pixels[sourceOffset + 2]
      outR += out.pixels[outOffset]
      outG += out.pixels[outOffset + 1]
      outB += out.pixels[outOffset + 2]
      count += 1
    }
  }
  if (!count) return null
  const round2 = (value) => Math.round(value * 100) / 100
  const sourceMean = { r: round2(sourceR / count), g: round2(sourceG / count), b: round2(sourceB / count) }
  const outputMean = { r: round2(outR / count), g: round2(outG / count), b: round2(outB / count) }
  const delta = {
    r: round2(outputMean.r - sourceMean.r),
    g: round2(outputMean.g - sourceMean.g),
    b: round2(outputMean.b - sourceMean.b),
  }
  const maxAbsDelta = round2(Math.max(Math.abs(delta.r), Math.abs(delta.g), Math.abs(delta.b)))
  return {
    margin,
    sourceMean,
    outputMean,
    delta,
    maxAbsDelta,
    meanAbsDelta: round2((Math.abs(delta.r) + Math.abs(delta.g) + Math.abs(delta.b)) / 3),
  }
}

/**
 * Phase C2：现代扩图提交的尺寸计划（画布 → 参考图），并校验参考图满足契约。
 *
 * 参考图 = 整张画布等比缩放（绿边比例不变），长边必须 ≤ `LIMITS.referenceImages.maxEdge`
 * （1024），否则远端提交期会 400。返回计划里带 `contentInReference` 便于报告核对。
 */
function outpaintLoraPlan(
  canvas = OUTPAINT_CANVAS,
  content = OUTPAINT_CONTENT,
  reference = OUTPAINT_LORA.reference,
) {
  const scale = reference.width / canvas.width
  const plan = {
    canvas: { width: canvas.width, height: canvas.height },
    content: { ...content },
    reference: { width: reference.width, height: reference.height },
    scale: Math.round(scale * 10000) / 10000,
    sameAspect:
      Math.abs(canvas.width / canvas.height - reference.width / reference.height) <= 0.01,
    contentInReference: {
      x: Math.round(content.x * scale),
      y: Math.round(content.y * scale),
      width: Math.round(content.width * scale),
      height: Math.round(content.height * scale),
    },
  }
  const maxEdge = Number(LIMITS.referenceImages?.maxEdge) || 1024
  if (Math.max(plan.reference.width, plan.reference.height) > maxEdge) {
    throw new Error(
      `outpaint-lora：参考图长边 ${Math.max(plan.reference.width, plan.reference.height)} 超过契约上限 ${maxEdge}`,
    )
  }
  if (!plan.sameAspect) {
    throw new Error('outpaint-lora：参考图与画布宽高比不一致，绿边比例会失真')
  }
  return plan
}

/**
 * Phase B1 真机验收：把刚生成的图作为源图发 `tool=upscale`。
 *
 * 远端不读 pipeline / tasks，只收 `{tool, reference:{image_b64}}`；结果里的
 * `sourceWidth` / `sourceHeight` / `scale` 是 daemon 合成的协议字段，这里再断言一次
 * 输出尺寸 = 源图 × factor（PNG 头与 results 字段两边都要对）。
 */
async function runUpscale({ endpoint, token, sourcePng }) {
  const sourceSize = pngSize(sourcePng)
  if (!sourceSize) throw new Error('upscale：无法读取源图尺寸')
  console.log(
    `  · [upscale] 源图 ${sourceSize.width}x${sourceSize.height}（${sourcePng.length} 字节），提交 tool=upscale …`,
  )
  const begin = Date.now()
  // 单独走 submitGenerate + waitForJob（requestGenerate 就是这两步）是为了记录轮询间隔：
  // 2560x1440 的输出 base64 有 ~8MB，/job 单次请求超时是 8s（TIMEOUTS.remoteJobRequestMs），
  // 需要看下载响应体是否逼近超时、有没有触发重试（wallSeconds 会明显大于耗时之和）。
  const submitted = await submitGenerate(endpoint, token, {
    tool: 'upscale',
    reference: { image_b64: sourcePng.toString('base64') },
  })
  const submitMs = Date.now() - begin
  const pollTimes = []
  const response = await waitForJob(endpoint, token, submitted.job_id, {
    timeoutMs: 600000,
    onProgress: () => pollTimes.push(Date.now()),
  })
  const pollGaps = pollTimes.slice(1).map((time, index) => time - pollTimes[index])
  const maxPollGapMs = pollGaps.length ? Math.max(...pollGaps) : null
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('upscale：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('upscale：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  const factor = Number(result.scale) || UPSCALE.factor
  const expected = { width: sourceSize.width * factor, height: sourceSize.height * factor }
  const actual = {
    width: Number(result.width ?? 0),
    height: Number(result.height ?? 0),
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `upscale：results 尺寸不符，期望 ${expected.width}x${expected.height}，收到 ${actual.width}x${actual.height}`,
    )
  }
  if (outputSize && (outputSize.width !== expected.width || outputSize.height !== expected.height)) {
    throw new Error(
      `upscale：输出 PNG 尺寸不符，期望 ${expected.width}x${expected.height}，收到 ${outputSize.width}x${outputSize.height}`,
    )
  }
  console.log(
    `  · 高清放大完成：${sourceSize.width}x${sourceSize.height} → ${expected.width}x${expected.height}，` +
      `加载 ${response.load_seconds ?? '-'}s / 推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节`,
  )
  return {
    png,
    entry: {
      sourcePreset: null,
      factor,
      sourceWidth: Number(result.sourceWidth ?? sourceSize.width),
      sourceHeight: Number(result.sourceHeight ?? sourceSize.height),
      width: expected.width,
      height: expected.height,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
      upscale: result.upscale === true,
      // 轮询观测：submitMs / pollCount / maxPollGapMs 用于判断大响应体是否逼近 8s 单次超时。
      submitMs,
      pollCount: pollTimes.length,
      maxPollGapMs,
      imageBase64Bytes: Math.ceil(png.length / 3) * 4,
    },
  }
}

/**
 * Phase B2 / C1：提交一次扩图（给定已构造好的画布与蒙版）。
 *
 * 远端把画布当参考图、把蒙版当重绘区域（白 = 新增区域），strength 固定 1.0（新区域
 * 完全重画）。`pipelineSpec` 用于 C1 的 accel A/B：不传时逐字沿用预设 spec。
 */
async function submitOutpaintOnce({
  endpoint,
  token,
  presetId,
  sourcePng,
  composed,
  maskPng,
  prompt,
  pipelineSpec = null,
  seed = 45,
}) {
  const preset = presetById(presetId)
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: pipelineSpec ?? preset.pipeline,
      modelId: preset.repo,
      reference: {
        image_b64: composed.png.toString('base64'),
        mask_b64: maskPng.toString('base64'),
        strength: OUTPAINT.strength,
      },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed,
          width: composed.width,
          height: composed.height,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('outpaint：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('outpaint：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  if (outputSize && (outputSize.width !== composed.width || outputSize.height !== composed.height)) {
    throw new Error(
      `outpaint：输出尺寸不符，期望 ${composed.width}x${composed.height}，收到 ${outputSize.width}x${outputSize.height}`,
    )
  }
  const contentMeanDiff = contentRegionDiff(sourcePng, png, composed.content, 0)
  const contentCoreMeanDiff = contentRegionDiff(sourcePng, png, composed.content, 16)
  const contentPreserved = contentCoreMeanDiff !== null && contentCoreMeanDiff <= 1.0
  console.log(
    `  · 扩图完成：${composed.width}x${composed.height}，加载 ${response.load_seconds ?? '-'}s / ` +
      `推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节；内容区平均差 ${contentMeanDiff ?? '-'}` +
      `（核心区 ${contentCoreMeanDiff ?? '-'}，${contentPreserved ? '内容保留正常' : '内容被改动'}）`,
  )
  return {
    png,
    entry: {
      preset: presetId,
      strength: OUTPAINT.strength,
      sourceWidth: composed.sourceSize.width,
      sourceHeight: composed.sourceSize.height,
      width: outputSize?.width ?? composed.width,
      height: outputSize?.height ?? composed.height,
      canvasWidth: composed.width,
      canvasHeight: composed.height,
      content: composed.content,
      // 画布新增区的填充方式：edge-extend = 四边 1px 边缘像素延拓（FIXES-INTERFACES §B3）。
      canvasFill: composed.fill,
      coveragePercent: Number((maskPng.coverage * 100).toFixed(4)),
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
      contentMeanDiff,
      contentCoreMeanDiff,
      contentPreserved,
    },
  }
}

async function runOutpaint({ endpoint, token, presetId, sourcePng, prompt }) {
  const composed = buildOutpaintCanvas(sourcePng)
  const mask = buildOutpaintMaskPng()
  console.log(
    `  · [outpaint] 画布 ${composed.width}x${composed.height}（内容区 ${composed.content.width}x` +
      `${composed.content.height} @ ${composed.content.x},${composed.content.y}，新增区域 ` +
      `${(mask.coverage * 100).toFixed(2)}%，画布 ${composed.png.length} 字节，蒙版 ${mask.png.length} 字节）…`,
  )
  const submitted = await submitOutpaintOnce({
    endpoint,
    token,
    presetId,
    sourcePng,
    composed,
    maskPng: mask.png,
    prompt,
  })
  return { png: submitted.png, canvasPng: composed.png, maskPng: mask.png, entry: submitted.entry }
}

/**
 * Phase C2：提交一次「绿边画布 + 参考图」的 flux2 扩图（不重绘蒙版，走原生参考条件）。
 *
 * 与 B2 的 `submitOutpaintOnce` 的区别：这里没有蒙版/strength，参考图是整张画布缩放后的
 * job 级 `referenceImages`；输出尺寸取请求画布（flux2 若按内部 1 MP 上限缩放会在结果里
 * 体现，调用方记录并换算内容区坐标）。
 *
 * 采用 submitGenerate + waitForJob 而不是 requestGenerate，是为了把提交耗时与执行耗时
 * 分开计（`submitSeconds` / `wallSeconds`）——LoRA 首次挂载和权重下载都发生在执行阶段，
 * 分开后能看出是不是卡在提交/排队。
 */
async function submitOutpaintLoraOnce({
  endpoint,
  token,
  presetId,
  referencePng,
  prompt,
  pipelineSpec = null,
  seed = OUTPAINT_LORA.seed,
}) {
  const preset = presetById(presetId)
  const spec = pipelineSpec ?? withFlux2LoraSpec(preset.pipeline)
  console.log(
    `  · [outpaint-lora] ${presetId} 参考图 ${pngSize(referencePng)?.width ?? '?'}x` +
      `${pngSize(referencePng)?.height ?? '?'}（${referencePng.length} 字节）→ 请求 ` +
      `${OUTPAINT_CANVAS.width}x${OUTPAINT_CANVAS.height}，LoRA scale=${OUTPAINT_LORA.lora.scale} …`,
  )
  const begin = Date.now()
  const submitted = await submitGenerate(endpoint, token, {
    pipeline: spec,
    modelId: preset.repo,
    referenceImages: [{ image_b64: referencePng.toString('base64') }],
    tasks: [
      {
        name: '01',
        prompt,
        negative_prompt: preset.negativeHint ?? '',
        seed,
        width: OUTPAINT_CANVAS.width,
        height: OUTPAINT_CANVAS.height,
        steps: preset.steps,
        cfg: preset.cfg,
      },
    ],
  })
  const submitMs = Date.now() - begin
  const pollTimes = []
  const response = await waitForJob(endpoint, token, submitted.job_id, {
    timeoutMs: 600000,
    onProgress: () => pollTimes.push(Date.now()),
  })
  const pollGaps = pollTimes.slice(1).map((time, index) => time - pollTimes[index])
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('outpaint-lora：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('outpaint-lora：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  const outputSizeMatchesRequested =
    Boolean(outputSize) &&
    outputSize.width === OUTPAINT_CANVAS.width &&
    outputSize.height === OUTPAINT_CANVAS.height
  console.log(
    `  · 扩图完成：${outputSize?.width ?? '?'}x${outputSize?.height ?? '?'}` +
      `${outputSizeMatchesRequested ? '' : '（与请求尺寸不一致，flux2 可能按 1MP 面积上限缩放）'}，` +
      `提交 ${Math.round(submitMs / 10) / 100}s / 加载 ${response.load_seconds ?? '-'}s / ` +
      `推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节`,
  )
  return {
    png,
    entry: {
      preset: presetId,
      modelId: preset.repo,
      pipelineKind: preset.pipeline?.loader ?? null,
      engine: 'flux2+outpaint-lora',
      lora: { ...OUTPAINT_LORA.lora },
      prompt,
      seed,
      requestedWidth: OUTPAINT_CANVAS.width,
      requestedHeight: OUTPAINT_CANVAS.height,
      width: outputSize?.width ?? null,
      height: outputSize?.height ?? null,
      outputSizeMatchesRequested,
      referenceWidth: pngSize(referencePng)?.width ?? null,
      referenceHeight: pngSize(referencePng)?.height ?? null,
      referenceBytes: referencePng.length,
      submitSeconds: Math.round(submitMs / 10) / 100,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pollCount: pollTimes.length,
      maxPollGapMs: pollGaps.length ? Math.max(...pollGaps) : null,
      jobId: submitted.job_id,
      pngBytes: png.length,
      isPng,
    },
  }
}

/**
 * 局部重绘单次执行（一次远端 /generate）：给定参考图 + 程序化蒙版，返回 PNG、蒙版与报告条目。
 *
 * 关键观察点：`load_seconds` 应为 0（`AutoPipelineForInpainting.from_pipe` 复用已加载底座）；
 * 出图尺寸跟随参考图；提交形状与 Host 下发一致：job 级 `reference = { image_b64, strength, mask_b64 }`。
 * 蒙版尺寸按参考图实际尺寸生成（非正方形验收时与源图同比例）。
 */
async function runInpaintOnce({ endpoint, token, presetId, sourcePng, prompt, strength, maskOptions = {} }) {
  const preset = presetById(presetId)
  const sourceSize = pngSize(sourcePng) ?? { width: preset.size, height: preset.size }
  const mask = buildMaskPng(sourceSize.width, sourceSize.height, maskOptions)
  const maskLabel = mask.shape === 'circle' ? '圆形' : '矩形'
  console.log(
    `  · [inpaint] ${presetId} 参考图 ${sourceSize.width}x${sourceSize.height} + ${maskLabel}蒙版 ` +
      `（strength=${strength}，覆盖率 ${(mask.coverage * 100).toFixed(2)}%，${mask.png.length} 字节）…`,
  )
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      reference: {
        image_b64: sourcePng.toString('base64'),
        strength,
        mask_b64: mask.png.toString('base64'),
      },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 44,
          width: sourceSize.width,
          height: sourceSize.height,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('inpaint：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('inpaint：返回内容不是合法 PNG')
  return {
    png,
    maskPng: mask.png,
    entry: {
      preset: presetId,
      strength,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      referenceBytes: sourcePng.length,
      maskBytes: mask.png.length,
      maskCoveragePercent: Number((mask.coverage * 100).toFixed(4)),
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      referenceWidth: result.referenceWidth ?? null,
      referenceHeight: result.referenceHeight ?? null,
      maskWidth: result.maskWidth ?? null,
      maskHeight: result.maskHeight ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

/**
 * 局部重绘验收编排：连续多轮（--inpaint-rounds）或同一参考图多档强度（--strength-compare）。
 *
 * - 连续多轮：第 2 轮起把上一轮出图当参考图继续重绘，模型不重新加载（load_seconds 应为 0）；
 * - 强度对比：同一参考图与同一蒙版重复出图，只换 strength；
 * - 每轮差异 `maskedMeanDiffFromPrevious` 是「本轮出图 vs 本轮参考图」在蒙版内的平均亮度差，
 *   `maskedMeanDiffFromSource` 统一对比最初的源图（尺寸不一致时为 null）。
 *
 * 返回 `{ runs, report }`：runs 供落盘样张，report 是 report.json 里的 inpaint 段。
 */
async function runInpaint({ endpoint, token, presetId, sourcePng, prompt, options, maskOptions = {} }) {
  const compare = Array.isArray(options.strengthCompare) && options.strengthCompare.length > 0
  const strengths = compare ? options.strengthCompare : [options.strength]
  const rounds = compare ? 1 : Math.max(1, options.inpaintRounds ?? 1)
  const totalRuns = compare ? strengths.length : rounds
  const runs = []
  let referencePng = sourcePng
  let previousPng = sourcePng
  for (let index = 0; index < totalRuns; index += 1) {
    const round = index + 1
    const strength = compare ? strengths[index] : options.strength
    const referenceRole = compare || round === 1 ? 'source' : 'previous-round'
    if (compare) {
      console.log(`  · [inpaint] 强度对比 ${round}/${totalRuns}：strength=${strength}`)
    } else if (round > 1) {
      console.log(`  · [inpaint] 连续重绘第 ${round}/${totalRuns} 轮：以上一轮出图为参考图`)
    }
    const run = await runInpaintOnce({
      endpoint,
      token,
      presetId,
      sourcePng: referencePng,
      prompt,
      strength,
      maskOptions,
    })
    const diffFromPrevious = maskedMeanDiff(previousPng, run.png, run.maskPng)
    const diffFromSource =
      referenceRole === 'source' ? diffFromPrevious : maskedMeanDiff(sourcePng, run.png, run.maskPng)
    runs.push({ ...run, round, strength, referenceRole, diffFromPrevious, diffFromSource })
    previousPng = run.png
    if (!compare) referencePng = run.png
    console.log(
      `  · 出图 ${run.entry.width ?? '?'}x${run.entry.height ?? '?'}，蒙版内平均差异 ` +
        `${diffFromPrevious ?? '-'}（对源图 ${diffFromSource ?? '-'}）`,
    )
  }
  const sourceSize = pngSize(sourcePng) ?? { width: null, height: null }
  const perRun = runs.map((run) => ({
    round: run.round,
    strength: run.strength,
    referenceRole: run.referenceRole,
    loadSeconds: run.entry.loadSeconds,
    imageSeconds: run.entry.imageSeconds,
    wallSeconds: run.entry.wallSeconds,
    width: run.entry.width,
    height: run.entry.height,
    sourceWidth: run.entry.sourceWidth,
    sourceHeight: run.entry.sourceHeight,
    referenceWidth: run.entry.referenceWidth,
    referenceHeight: run.entry.referenceHeight,
    maskWidth: run.entry.maskWidth,
    maskHeight: run.entry.maskHeight,
    maskCoveragePercent: run.entry.maskCoveragePercent,
    referenceBytes: run.entry.referenceBytes,
    maskBytes: run.entry.maskBytes,
    pngBytes: run.entry.pngBytes,
    maskedMeanDiffFromPrevious: run.diffFromPrevious,
    maskedMeanDiffFromSource: run.diffFromSource,
  }))
  const first = perRun[0]
  const report = {
    preset: presetId,
    prompt,
    mode: compare ? 'strength-compare' : rounds > 1 ? 'rounds' : 'single',
    sourcePreset: options.sourcePreset,
    requestedReferenceSize: options.referenceSize
      ? [options.referenceSize.width, options.referenceSize.height]
      : null,
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    maskShape: options.maskShape,
    maskSize: options.maskSize,
    maskScale: options.maskScale,
    maskCenter: [options.maskCenterX, options.maskCenterY],
    rounds: perRun,
    // 兼容字段（第一次出图）：旧报告消费方按这些键读单次局部重绘结果。
    strength: first.strength,
    referenceBytes: first.referenceBytes,
    maskBytes: first.maskBytes,
    loadSeconds: first.loadSeconds,
    imageSeconds: first.imageSeconds,
    width: first.width,
    height: first.height,
    referenceWidth: first.referenceWidth,
    referenceHeight: first.referenceHeight,
    maskWidth: first.maskWidth,
    maskHeight: first.maskHeight,
    maskCoveragePercent: first.maskCoveragePercent,
    pngBytes: first.pngBytes,
  }
  return { runs, report }
}

/**
 * Phase C1 参考生图验收（单个 supportsReference 预设）：返回 report / images / models 供 main 汇总。
 *
 * 流程：先文生图出 1~N 张源图当参考图 → 按张数跑参考生图（同 seed，1 张跑 2 轮验证确定性）
 * → 补「1 张参考 + 1280x720」画幅保持 → 连续参考推理后再跑一次文生图核对显存无增长。
 */
async function runReferencePhase({ endpoint, token, presetId, prompt, mainSize, referenceCounts, referenceRounds }) {
  const preset = presetById(presetId)
  if (preset?.supportsReference !== true) {
    throw new Error(
      `预设 ${presetId} 不支持原生参考生图（supportsReference=false），首期只有 flux2-klein-4b`,
    )
  }
  const models = []
  const images = []
  const maxSourceCount = Math.max(...referenceCounts)
  const sources = []
  for (let index = 0; index < maxSourceCount; index += 1) {
    const source = await generateOne({
      endpoint,
      token,
      presetId,
      prompt,
      index,
      total: maxSourceCount,
      seed: 42 + index,
    })
    models.push(source.entry)
    const sourceSize = pngSize(source.png)
    if (!sourceSize) throw new Error('reference：无法读取参考图源尺寸')
    images.push({
      index: `reference-source-${index + 1}`,
      presetId,
      png: source.png,
      name: `01-source-${index + 1}.png`,
    })
    console.log(
      `  · 参考图源 ${index + 1}/${maxSourceCount} 生成：${sourceSize.width}x${sourceSize.height}，` +
        `出图 ${source.entry.imageSeconds ?? '-'}s（加载 ${source.entry.loadSeconds ?? '-'}s）`,
    )
    sources.push(source.png)
  }
  const baselinePng = sources[0]
  const baselineSize = pngSize(baselinePng)
  const beforeRefs = await readGpuMemory(endpoint, token)
  const cases = []
  for (const count of referenceCounts) {
    const rounds = referenceRounds ?? (count === 1 ? 2 : 1)
    for (let round = 0; round < rounds; round += 1) {
      cases.push({
        label: `${count}ref-${mainSize.width}x${mainSize.height}`,
        count,
        round,
        width: mainSize.width,
        height: mainSize.height,
        frame: false,
      })
    }
  }
  if (!(mainSize.width === 1280 && mainSize.height === 720)) {
    cases.push({ label: '1ref-1280x720-frame', count: 1, round: 0, width: 1280, height: 720, frame: true })
  }
  const referenceRuns = []
  const referencePngs = new Map()
  for (const item of cases) {
    const run = await runReference({
      endpoint,
      token,
      presetId,
      referencePngs: sources.slice(0, item.count),
      prompt,
      width: item.width,
      height: item.height,
      seed: 42,
    })
    const gpuMemoryAfter = await readGpuMemory(endpoint, token)
    const suffix = `${item.label}${item.round > 0 ? `-round${item.round + 1}` : ''}`
    images.push({
      index: 'reference',
      presetId: `${presetId}-reference`,
      png: run.png,
      name: `02-reference-${suffix}.png`,
    })
    const pngKey = item.frame
      ? 'frame'
      : item.count === 1
        ? item.round === 0
          ? '1'
          : '2'
        : `${item.count}refs`
    if (!referencePngs.has(pngKey)) referencePngs.set(pngKey, run.png)
    referenceRuns.push({
      ...run.entry,
      round: item.round + 1,
      framePreserved: item.frame ? run.entry.width === 1280 && run.entry.height === 720 : null,
      gpuMemoryAfter,
    })
    console.log(
      `  · 参考生图 [${item.count} 张 / ${item.width}x${item.height}${item.frame ? ' / 画幅保持' : ''}]：` +
        `加载 ${run.entry.loadSeconds ?? '-'}s / 推理 ${run.entry.imageSeconds ?? '-'}s / ` +
        `输出 ${run.entry.width}x${run.entry.height}`,
    )
  }
  const afterRefs = await readGpuMemory(endpoint, token)
  // 稳定性：连续参考推理后再跑一次纯文生图（同 seed），峰值显存不应增长。
  const stableMemBefore = await readGpuMemory(endpoint, token)
  const stable = await generateOne({ endpoint, token, presetId, prompt, index: 0, total: 1, seed: 42 })
  const stableMemAfter = await readGpuMemory(endpoint, token)
  models.push(stable.entry)
  images.push({ index: 'reference-stable', presetId, png: stable.png, name: '03-txt2img-after-refs.png' })

  const singleRefRuns = referenceRuns.filter(
    (run) => run.referenceCount === 1 && !run.framePreserved && run.width === mainSize.width,
  )
  const determinismMae =
    singleRefRuns.length >= 2 ? meanAbsDiffPng(referencePngs.get('1'), referencePngs.get('2')) : null
  const referenceEffectMae =
    baselineSize &&
    baselineSize.width === mainSize.width &&
    baselineSize.height === mainSize.height &&
    referencePngs.has('1')
      ? meanAbsDiffPng(baselinePng, referencePngs.get('1'))
      : null
  const oneVsTwoRefsMae =
    referencePngs.has('1') && referencePngs.has('2refs')
      ? meanAbsDiffPng(referencePngs.get('1'), referencePngs.get('2refs'))
      : null
  const maxAllocatedDeltaMb =
    Number.isFinite(beforeRefs?.max_allocated_mb) && Number.isFinite(afterRefs?.max_allocated_mb)
      ? afterRefs.max_allocated_mb - beforeRefs.max_allocated_mb
      : null
  const stableDeltaMb =
    Number.isFinite(beforeRefs?.max_allocated_mb) && Number.isFinite(stableMemAfter?.max_allocated_mb)
      ? stableMemAfter.max_allocated_mb - beforeRefs.max_allocated_mb
      : null
  const frameRun = referenceRuns.find((run) => run.framePreserved !== null)
  const report = {
    preset: presetId,
    supportsReference: true,
    mainSize,
    counts: referenceCounts,
    sourceCount: maxSourceCount,
    sources: sources.map((png) => pngSize(png)),
    roundsPerCount: Object.fromEntries(
      referenceCounts.map((count) => [count, referenceRounds ?? (count === 1 ? 2 : 1)]),
    ),
    cases: referenceRuns.map((run) => ({
      count: run.referenceCount,
      referenceSizes: run.referenceSizes,
      width: run.width,
      height: run.height,
      framePreserved: run.framePreserved,
      loadSeconds: run.loadSeconds,
      imageSeconds: run.imageSeconds,
      wallSeconds: run.wallSeconds,
      referenceBytes: run.referenceBytes,
      pngBytes: run.pngBytes,
      gpuMemoryAfter: run.gpuMemoryAfter,
    })),
    // 同 seed 同参考图两轮应逐像素一致（0 表示确定性成立），作为「同 seed 可复现」证据。
    determinismMae,
    // 同 seed 下「有 1 张参考图 vs 无参考图」的平均绝对差：>0 说明参考图确实参与了条件。
    referenceEffectMae,
    // 1 张 vs 2 张参考图的差异：验证多参考图也生效。
    oneVsTwoRefsMae,
    // 1280x720 画幅保持：参考生图输出不跟随参考图尺寸。
    framePreservation: frameRun
      ? {
          passed: frameRun.framePreserved === true,
          requested: { width: 1280, height: 720 },
          output: { width: frameRun.width, height: frameRun.height },
        }
      : null,
    // 同一 pipeline spec 复用：除首轮加载外，后续参考生图 load_seconds 应为 0。
    reusedPipeline: referenceRuns.every((run) => (run.loadSeconds ?? 0) === 0),
    gpuMemoryBefore: beforeRefs,
    gpuMemoryAfter: afterRefs,
    maxAllocatedDeltaMb,
    stability: {
      before: stableMemBefore,
      after: stableMemAfter,
      deltaMb: stableDeltaMb,
      // 容差 64 MiB：/health 是只读快照，分配器保留块的小幅波动不算增长。
      noGrowth: stableDeltaMb === null ? null : stableDeltaMb <= 64,
    },
  }
  if (frameRun && frameRun.framePreserved !== true) {
    throw new Error('reference：1280x720 画幅保持失败，输出没有严格等于请求尺寸')
  }
  console.log(
    `  · [reference] 确定性 MAE ${determinismMae ?? '-'}，参考影响 MAE ${referenceEffectMae ?? '-'}，` +
      `显存增量 ${maxAllocatedDeltaMb ?? '-'} MB，复测无增长 ${report.stability.noGrowth}`,
  )
  return { report, images, models }
}

/** Phase C1 文生图加速 A/B 验收（off/on 同一会话、同 seed/尺寸/prompt，每档多轮取中位）。 */
async function runAccelTxt2ImgPhase({ endpoint, token, presetId, prompt, order, rounds }) {
  const preset = presetById(presetId)
  const models = []
  const images = []
  const configs = []
  const configPngs = new Map()
  for (const label of order) {
    const accelConfig = label === 'off' ? accelOffConfigOf() : accelOnConfigOf(preset)
    const spec = withAccelSpec(preset.pipeline, accelConfig)
    const gpuMemoryBefore = await readGpuMemory(endpoint, token)
    const roundEntries = []
    const pngs = []
    for (let round = 0; round < rounds; round += 1) {
      const run = await generateOne({
        endpoint,
        token,
        presetId,
        prompt,
        index: 0,
        total: 1,
        pipelineSpec: spec,
        seed: 42,
      })
      roundEntries.push({ round: round + 1, ...run.entry })
      pngs.push(run.png)
    }
    const gpuMemoryAfter = await readGpuMemory(endpoint, token)
    const reservedDeltaMb =
      Number.isFinite(gpuMemoryBefore?.reserved_mb) && Number.isFinite(gpuMemoryAfter?.reserved_mb)
        ? gpuMemoryAfter.reserved_mb - gpuMemoryBefore.reserved_mb
        : null
    pngs.forEach((png, roundIndex) => {
      images.push({
        index: 'accel',
        presetId: `${presetId}-accel`,
        png,
        name: `02-accel-${label}-round${roundIndex + 1}.png`,
      })
    })
    configPngs.set(label, pngs[pngs.length - 1])
    configs.push({
      label,
      accel: accelConfig,
      rounds: roundEntries,
      medianSeconds: medianOf(roundEntries.map((round) => round.imageSeconds)),
      gpuMemoryBefore,
      gpuMemoryAfter,
      reservedDeltaMb,
    })
    models.push({ ...roundEntries[0] })
    console.log(
      `  · [accel:${label}] 中位出图 ${medianOf(roundEntries.map((round) => round.imageSeconds))}s，峰值显存 ` +
        `${gpuMemoryAfter?.max_allocated_mb ?? '-'} MB（首轮加载 ${roundEntries[0].loadSeconds ?? '-'}s）`,
    )
  }
  const offConfig = configs.find((config) => config.label === 'off') ?? null
  const onConfig = configs.find((config) => config.label === 'on') ?? null
  const maeOffOn = offConfig && onConfig ? meanAbsDiffPng(configPngs.get('off'), configPngs.get('on')) : null
  const report = {
    preset: presetId,
    mode: 'txt2img',
    family: preset.pipeline?.loader ?? null,
    width: preset.size,
    height: preset.size,
    steps: preset.steps,
    roundsPerConfig: rounds,
    order,
    configs,
    speedup: speedupOf(offConfig, onConfig),
    peakMaxAllocatedDeltaMb: peakDeltaOf(offConfig, onConfig),
    maeOffOn,
    speedupNote: 'speedup = off 中位推理秒数 / on 中位推理秒数（>1 表示 on 更快）；maeOffOn 越小画质差异越小',
  }
  console.log(
    `  · [accel] 提速比 ${report.speedup ?? '-'}（off ${offConfig?.medianSeconds ?? '-'}s → ` +
      `on ${onConfig?.medianSeconds ?? '-'}s），峰值显存差 ${report.peakMaxAllocatedDeltaMb ?? '-'} MB，` +
      `两档输出 MAE ${maeOffOn ?? '-'}`,
  )
  return { report, images, models }
}

/** Phase C1 扩图加速 A/B 验收：源图 864² 固定，画布/蒙版固定，只换 accel 配置。 */
async function runAccelOutpaintPhase({ endpoint, token, presetId, sourcePresetId, prompt, order, rounds }) {
  const preset = presetById(presetId)
  const models = []
  const images = []
  const source = await generateOne({
    endpoint,
    token,
    presetId: sourcePresetId,
    prompt,
    index: 0,
    total: 1,
    width: OUTPAINT_CONTENT.width,
    height: OUTPAINT_CONTENT.height,
  })
  models.push(source.entry)
  images.push({ index: 0, presetId: sourcePresetId, png: source.png })
  const sourceSize = pngSize(source.png)
  if (
    sourceSize &&
    (sourceSize.width !== OUTPAINT_CONTENT.width || sourceSize.height !== OUTPAINT_CONTENT.height)
  ) {
    throw new Error(
      `outpaint：源图应为 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height}，` +
        `收到 ${sourceSize.width}x${sourceSize.height}`,
    )
  }
  console.log(
    `  · ${sourcePresetId} 文生图完成：加载 ${source.entry.loadSeconds ?? '-'}s / 出图 ` +
      `${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
  )
  const composed = buildOutpaintCanvas(source.png)
  const mask = buildOutpaintMaskPng()
  console.log(
    `  · [outpaint] 画布 ${composed.width}x${composed.height}（内容区 ${composed.content.width}x` +
      `${composed.content.height} @ ${composed.content.x},${composed.content.y}，新增区域 ` +
      `${(mask.coverage * 100).toFixed(2)}%，画布 ${composed.png.length} 字节，蒙版 ${mask.png.length} 字节）…`,
  )
  images.push(
    { index: 'outpaint-canvas', presetId: `${presetId}-outpaint`, png: composed.png, name: '02-outpaint-canvas.png' },
    { index: 'outpaint-mask', presetId: `${presetId}-outpaint`, png: mask.png, name: '02-outpaint-mask.png' },
  )
  const configs = []
  const configPngs = new Map()
  for (const label of order) {
    const accelConfig = label === 'off' ? accelOffConfigOf() : accelOnConfigOf(preset)
    const spec = withAccelSpec(preset.pipeline, accelConfig)
    const gpuMemoryBefore = await readGpuMemory(endpoint, token)
    const roundEntries = []
    const pngs = []
    for (let round = 0; round < rounds; round += 1) {
      const submitted = await submitOutpaintOnce({
        endpoint,
        token,
        presetId,
        sourcePng: source.png,
        composed,
        maskPng: mask.png,
        prompt,
        pipelineSpec: spec,
        seed: 45,
      })
      roundEntries.push({
        round: round + 1,
        ...submitted.entry,
        seam: outpaintSeamMetrics(submitted.png, composed.content),
      })
      pngs.push(submitted.png)
    }
    const gpuMemoryAfter = await readGpuMemory(endpoint, token)
    const reservedDeltaMb =
      Number.isFinite(gpuMemoryBefore?.reserved_mb) && Number.isFinite(gpuMemoryAfter?.reserved_mb)
        ? gpuMemoryAfter.reserved_mb - gpuMemoryBefore.reserved_mb
        : null
    pngs.forEach((png, roundIndex) => {
      images.push({
        index: 'outpaint-accel',
        presetId: `${presetId}-outpaint`,
        png,
        name: `02-outpaint-${label}-round${roundIndex + 1}.png`,
      })
    })
    configPngs.set(label, pngs[pngs.length - 1])
    configs.push({
      label,
      accel: accelConfig,
      rounds: roundEntries,
      medianSeconds: medianOf(roundEntries.map((round) => round.imageSeconds)),
      gpuMemoryBefore,
      gpuMemoryAfter,
      reservedDeltaMb,
    })
    models.push({ preset: presetId, modelId: preset.repo, pipelineKind: preset.pipeline?.loader ?? null, ...roundEntries[0] })
    console.log(
      `  · [accel:outpaint:${label}] 中位推理 ${medianOf(roundEntries.map((round) => round.imageSeconds))}s，` +
        `峰值显存 ${gpuMemoryAfter?.max_allocated_mb ?? '-'} MB，内容区核心差 ` +
        `${roundEntries[roundEntries.length - 1].contentCoreMeanDiff ?? '-'}`,
    )
  }
  const offConfig = configs.find((config) => config.label === 'off') ?? null
  const onConfig = configs.find((config) => config.label === 'on') ?? null
  const maeOffOn = offConfig && onConfig ? meanAbsDiffPng(configPngs.get('off'), configPngs.get('on')) : null
  const report = {
    preset: presetId,
    mode: 'outpaint',
    family: preset.pipeline?.loader ?? null,
    sourcePreset: sourcePresetId,
    canvas: { width: composed.width, height: composed.height },
    content: composed.content,
    coveragePercent: Number((mask.coverage * 100).toFixed(4)),
    roundsPerConfig: rounds,
    order,
    configs,
    speedup: speedupOf(offConfig, onConfig),
    peakMaxAllocatedDeltaMb: peakDeltaOf(offConfig, onConfig),
    maeOffOn,
    seam: {
      off: offConfig?.rounds[offConfig.rounds.length - 1]?.seam ?? null,
      on: onConfig?.rounds[onConfig.rounds.length - 1]?.seam ?? null,
    },
    speedupNote: 'speedup = off 中位推理秒数 / on 中位推理秒数（>1 表示 on 更快）',
  }
  console.log(
    `  · [accel:outpaint] 提速比 ${report.speedup ?? '-'}（off ${offConfig?.medianSeconds ?? '-'}s → ` +
      `on ${onConfig?.medianSeconds ?? '-'}s），两档输出 MAE ${maeOffOn ?? '-'}`,
  )
  return { report, images, models }
}

/**
 * Phase C2 现代扩图引擎验收（flux2-klein-4b + 扩图 LoRA，单次提交）。
 *
 * 流程：源图（864x864）→ 纯绿 #00FF00 画布（1536x864，内容居中）→ 等比缩到 1024x576
 * 作为原生参考图 → 带 LoRA 提交一次，输出 1536x864。
 *
 * 关键观察点（全部写入 report.outpaintLora，失败不抛，保留证据）：
 *  - 输出尺寸是否严格等于 1536x864（flux2 可能按内部 1 MP 面积上限缩放，不一致时按比例
 *    换算内容区坐标再算差值）；
 *  - 内容区平均差 / 核心区平均差：参考生图会整体重画，差值大是预期，这里只做定量记录；
 *  - 绿边残留比例：仍是纯绿的像素占比，越低说明 LoRA 填充越充分；
 *  - 接缝指标：内容区左右边界的横向梯度 vs 内容区内部梯度（复用 B2 口径）；
 *  - 内容区颜色漂移：源图与出图内容区的逐通道均值差（补亮度差看不到的色调偏移）；
 *  - 耗时：submitSeconds / wallSeconds / load_seconds / imageSeconds，并与 bench-results
 *    里 sdxl-inpaint 的 1536x864 历史基线对比；
 *  - [load] 日志里的 LoRA 挂载证据（`flux2 LoRA 已挂载 …`）。
 */
async function runOutpaintLoraPhase({ endpoint, token, presetId, sourcePresetId, prompt }) {
  const target = presetById(presetId)
  if (target?.pipeline?.loader !== 'flux2' || target?.supportsReference !== true) {
    throw new Error(`outpaint-lora：需要 flux2 家族的参考生图预设，当前 ${presetId}`)
  }
  const plan = outpaintLoraPlan()
  const models = []
  const images = []
  const notes = []

  // 1) 内容源图：默认 sdxl-lightning 出 864x864，几何与 Phase B2 的历史基线完全一致。
  const source = await generateOne({
    endpoint,
    token,
    presetId: sourcePresetId,
    prompt,
    index: 0,
    total: 1,
    width: OUTPAINT_CONTENT.width,
    height: OUTPAINT_CONTENT.height,
  })
  models.push(source.entry)
  images.push({
    index: 'outpaint-lora-source',
    presetId: sourcePresetId,
    png: source.png,
    name: '01-source-content.png',
  })
  const sourceSize = pngSize(source.png)
  if (
    !sourceSize ||
    sourceSize.width !== OUTPAINT_CONTENT.width ||
    sourceSize.height !== OUTPAINT_CONTENT.height
  ) {
    throw new Error(
      `outpaint-lora：源图应为 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height}，` +
        `收到 ${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
    )
  }
  console.log(
    `  · ${sourcePresetId} 文生图完成：${sourceSize.width}x${sourceSize.height}，加载 ` +
      `${source.entry.loadSeconds ?? '-'}s / 出图 ${source.entry.imageSeconds ?? '-'}s`,
  )

  // 2) 纯绿画布 + 1024x576 参考图（等比缩小，绿边比例不变；满足 referenceImages 契约）。
  const composed = buildGreenOutpaintCanvas(source.png)
  const reference = resizePngTo(composed.png, plan.reference.width, plan.reference.height)
  if (!reference) throw new Error('outpaint-lora：无法生成参考图（画布 PNG 解码失败）')
  console.log(
    `  · [outpaint-lora] 绿边画布 ${composed.width}x${composed.height}（内容区 ` +
      `${composed.content.width}x${composed.content.height} @ ${composed.content.x},` +
      `${composed.content.y}，绿边 ${(composed.greenCoverage * 100).toFixed(2)}%，` +
      `画布 ${composed.png.length} 字节）→ 参考图 ${reference.width}x${reference.height}` +
      `（${reference.png.length} 字节）`,
  )
  images.push(
    {
      index: 'outpaint-lora-canvas',
      presetId: `${presetId}-outpaint-lora`,
      png: composed.png,
      name: '02-outpaint-lora-canvas.png',
    },
    {
      index: 'outpaint-lora-reference',
      presetId: `${presetId}-outpaint-lora`,
      png: reference.png,
      name: '02-outpaint-lora-reference.png',
    },
  )

  // 3) 带 LoRA 提交一次（参考图走 job 级 referenceImages，没有蒙版/strength 语义）。
  const pipelineSpec = withFlux2LoraSpec(target.pipeline)
  const gpuMemoryBefore = await readGpuMemory(endpoint, token)
  const run = await submitOutpaintLoraOnce({
    endpoint,
    token,
    presetId,
    referencePng: reference.png,
    prompt: OUTPAINT_LORA.prompt,
    pipelineSpec,
  })
  const gpuMemoryAfter = await readGpuMemory(endpoint, token)
  const loraLogs = await collectLogLines(endpoint, token, /\[load\].*(lora|LoRA)|LoRA/i)
  if (!loraLogs.some((line) => /LoRA 已挂载|LoRA 权重|使用预挂载 LoRA/i.test(line))) {
    notes.push('远端 [load] 日志里没有 LoRA 挂载成功行，需确认远端 Flux2Loader 已支持 pipeline.lora')
  }

  // 4) 像素指标：输出尺寸与请求不一致时按同一比例换算内容区坐标后再比较。
  const metricsContent = run.entry.outputSizeMatchesRequested
    ? { ...OUTPAINT_CONTENT }
    : scaledContentOf(run.entry, plan.canvas, OUTPAINT_CONTENT)
  if (!run.entry.outputSizeMatchesRequested) {
    notes.push(
      `输出尺寸 ${run.entry.width}x${run.entry.height} 与请求 ` +
        `${OUTPAINT_CANVAS.width}x${OUTPAINT_CANVAS.height} 不一致；像素差/接缝按缩放后的内容区 ` +
        `(${metricsContent.x},${metricsContent.y},${metricsContent.width}x${metricsContent.height}) 计算`,
    )
  }
  // 出图被缩放时源图内容也要缩到同一尺寸才能逐像素比较（contentRegionDiff 要求宽高一致）；
  // 双线性缩放会引入轻微模糊，差值只能作为量级参考，报告里用 metricsNote 标注。
  let diffSource = source.png
  let metricsNote = '源图内容区与出图内容区同尺寸逐像素比较'
  if (
    !run.entry.outputSizeMatchesRequested &&
    metricsContent.width !== sourceSize.width
  ) {
    const scaledSource = resizePngTo(source.png, metricsContent.width, metricsContent.height)
    if (scaledSource) {
      diffSource = scaledSource.png
      metricsNote = '出图被缩放，源图内容区先双线性缩放到同尺寸再比较（差值只作量级参考）'
    } else {
      metricsNote = '出图被缩放且源图无法缩放，像素差不可比'
    }
  }
  const contentMeanDiff = contentRegionDiff(diffSource, run.png, metricsContent, 0)
  const contentCoreMeanDiff = contentRegionDiff(diffSource, run.png, metricsContent, 16)
  const green = greenAreaStats(run.png)
  const seam = outpaintSeamMetrics(run.png, metricsContent)
  const colorDrift = contentColorDrift(diffSource, run.png, metricsContent, 16)
  const baseline = await loadOutpaintBaseline()
  const speedupVsBaseline =
    Number.isFinite(run.entry.imageSeconds) &&
    run.entry.imageSeconds > 0 &&
    Number.isFinite(baseline.medianSeconds)
      ? Math.round((baseline.medianSeconds / run.entry.imageSeconds) * 100) / 100
      : null
  if (Number.isFinite(green?.nearGreenRatio) && green.nearGreenRatio > 0.05) {
    notes.push(`绿边残留 ${(green.nearGreenRatio * 100).toFixed(2)}%（>5%），可能有未填充的新增区域`)
  }

  const reservedDeltaMb =
    Number.isFinite(gpuMemoryBefore?.reserved_mb) && Number.isFinite(gpuMemoryAfter?.reserved_mb)
      ? gpuMemoryAfter.reserved_mb - gpuMemoryBefore.reserved_mb
      : null
  images.push({
    index: 'outpaint-lora',
    presetId: `${presetId}-outpaint-lora`,
    png: run.png,
    name: '03-outpaint-lora.png',
  })
  models.push({
    preset: presetId,
    modelId: target.repo,
    pipelineKind: target.pipeline?.loader ?? null,
    ...run.entry,
  })
  const report = {
    ...run.entry,
    sourcePreset: sourcePresetId,
    source: {
      width: sourceSize.width,
      height: sourceSize.height,
      loadSeconds: source.entry.loadSeconds,
      imageSeconds: source.entry.imageSeconds,
      wallSeconds: source.entry.wallSeconds,
      pngBytes: source.entry.pngBytes,
    },
    plan,
    canvas: {
      width: composed.width,
      height: composed.height,
      content: composed.content,
      fill: composed.fill,
      fillColor: composed.fillColor,
      greenCoverage: Number((composed.greenCoverage * 100).toFixed(4)),
      pngBytes: composed.png.length,
      referenceBytes: reference.png.length,
    },
    metricsContent,
    metricsNote,
    contentMeanDiff,
    contentCoreMeanDiff,
    green,
    seam,
    colorDrift,
    gpuMemoryBefore,
    gpuMemoryAfter,
    reservedDeltaMb,
    loraLogs,
    baseline,
    speedupVsBaseline,
    baselineNote:
      'speedupVsBaseline = sdxl-inpaint 历史中位推理秒数 / 本次 flux2+LoRA 推理秒数（>1 表示新引擎更快）',
    notes,
  }
  console.log(
    `  · [outpaint-lora] 输出 ${run.entry.width ?? '?'}x${run.entry.height ?? '?'}，` +
      `内容区平均差 ${contentMeanDiff ?? '-'}（核心区 ${contentCoreMeanDiff ?? '-'}），` +
      `绿边残留 ${green ? `${(green.nearGreenRatio * 100).toFixed(2)}%` : '-'}，` +
      `接缝比 ${seam?.leftRatio ?? '-'}/${seam?.rightRatio ?? '-'}，` +
      `颜色漂移 ${colorDrift?.maxAbsDelta ?? '-'}，对 sdxl-inpaint 基线提速 ` +
      `${speedupVsBaseline ?? '-'}（基线 ${baseline.medianSeconds ?? '-'}s）`,
  )
  return { report, images, models }
}

/**
 * Phase C2 推理缓存探针：flux2-klein-4b 同 seed / 同尺寸 / 同 prompt 的 off/on A/B。
 *
 * on 档在 pipeline 上覆盖 `accel.cache = {type:'firstBlock', threshold:0.05}`；远端若
 * 特性检测不支持（diffusers 版本没有 Flux2 block 注册接口）会打印
 * `[accel] WARN cache 不适用：<原因>` 并继续出图——这本身就是结论证据，所以这里不抛错，
 * 而是把日志判定写进 report.accelCache.cacheStatus。
 */
async function runAccelCachePhase({ endpoint, token, presetId, prompt, rounds }) {
  const preset = presetById(presetId)
  if (preset?.pipeline?.loader !== 'flux2') {
    throw new Error(`accel-cache：只对 flux2 家族的预设做缓存探针，当前 ${presetId}`)
  }
  const models = []
  const images = []
  const configs = []
  const configPngs = new Map()
  for (const label of ['off', 'on']) {
    const spec = label === 'off' ? accelCacheOffSpec(preset) : withAccelCacheSpec(preset.pipeline, ACCEL_CACHE)
    const gpuMemoryBefore = await readGpuMemory(endpoint, token)
    const roundEntries = []
    const pngs = []
    for (let round = 0; round < rounds; round += 1) {
      const run = await generateOne({
        endpoint,
        token,
        presetId,
        prompt,
        index: 0,
        total: 1,
        pipelineSpec: spec,
        seed: 42,
      })
      roundEntries.push({ round: round + 1, ...run.entry })
      pngs.push(run.png)
    }
    const gpuMemoryAfter = await readGpuMemory(endpoint, token)
    const cacheLogs = label === 'on' ? await collectLogLines(endpoint, token, /\[accel\].*cache/i) : []
    const reservedDeltaMb =
      Number.isFinite(gpuMemoryBefore?.reserved_mb) && Number.isFinite(gpuMemoryAfter?.reserved_mb)
        ? gpuMemoryAfter.reserved_mb - gpuMemoryBefore.reserved_mb
        : null
    pngs.forEach((png, roundIndex) => {
      images.push({
        index: 'accel-cache',
        presetId: `${presetId}-accel-cache`,
        png,
        name: `0${label === 'off' ? 1 : 2}-cache-${label}-round${roundIndex + 1}.png`,
      })
    })
    configPngs.set(label, pngs[pngs.length - 1])
    configs.push({
      label,
      // 只记录覆盖项，不重复整份 pipeline（loader/base 在报告顶层）。
      pipelineOverrides:
        label === 'on' ? { accel: { cache: { type: ACCEL_CACHE.type, threshold: ACCEL_CACHE.threshold } } } : { accel: null },
      rounds: roundEntries,
      medianSeconds: medianOf(roundEntries.map((round) => round.imageSeconds)),
      gpuMemoryBefore,
      gpuMemoryAfter,
      reservedDeltaMb,
      cacheLogs,
    })
    models.push({ ...roundEntries[0] })
    console.log(
      `  · [accel-cache:${label}] 中位出图 ${medianOf(roundEntries.map((round) => round.imageSeconds))}s，` +
        `峰值显存 ${gpuMemoryAfter?.max_allocated_mb ?? '-'} MB（首轮加载 ${roundEntries[0].loadSeconds ?? '-'}s）` +
        `${label === 'on' && cacheLogs.length ? `，cache 日志 ${cacheLogs.length} 行` : ''}`,
    )
  }
  const offConfig = configs.find((config) => config.label === 'off') ?? null
  const onConfig = configs.find((config) => config.label === 'on') ?? null
  const maeOffOn = offConfig && onConfig ? meanAbsDiffPng(configPngs.get('off'), configPngs.get('on')) : null
  const cacheLogs = onConfig?.cacheLogs ?? []
  const skipped = cacheLogs.some((line) => /WARN|不适用|跳过|不支持/i.test(line))
  const applied = cacheLogs.some(
    (line) => !/WARN/i.test(line) && /(已启用|已应用|启用|应用|apply|enabled|firstBlock)/i.test(line),
  )
  const cacheStatus = skipped
    ? applied
      ? 'applied-with-warn'
      : 'not-applicable'
    : applied
      ? 'applied'
      : 'unknown'
  const report = {
    preset: presetId,
    mode: 'txt2img',
    family: preset.pipeline?.loader ?? null,
    modelId: preset.repo,
    width: preset.size,
    height: preset.size,
    steps: preset.steps,
    seed: 42,
    roundsPerConfig: rounds,
    order: ['off', 'on'],
    cache: { ...ACCEL_CACHE },
    configs,
    speedup: speedupOf(offConfig, onConfig),
    peakMaxAllocatedDeltaMb: peakDeltaOf(offConfig, onConfig),
    maeOffOn,
    cacheLogs,
    cacheStatus,
    // true = 日志确认缓存已应用；false = 远端明确报「不适用」；null = 没有可判定的日志。
    cacheSupported: cacheStatus === 'applied' || cacheStatus === 'applied-with-warn' ? true : cacheStatus === 'not-applicable' ? false : null,
    note:
      'cache 是实验性探针（本轮不写入模型资产）；speedup = off 中位推理秒数 / on 中位推理秒数' +
      '（>1 表示 on 更快）；cacheStatus=not-applicable 表示远端 diffusers 不支持 Flux2 block 缓存注册',
  }
  console.log(
    `  · [accel-cache] 提速比 ${report.speedup ?? '-'}（off ${offConfig?.medianSeconds ?? '-'}s → ` +
      `on ${onConfig?.medianSeconds ?? '-'}s），两档输出 MAE ${maeOffOn ?? '-'}，` +
      `cache 状态 ${cacheStatus}`,
  )
  return { report, images, models }
}

async function main() {
  const options = parseOptions()
  const single = options.presets.length === 1
  const session = new SessionManager({
    ctx: createContext(),
    defaultPreset: options.presets[0],
    options: {
      enableGpu: true,
      accelerator: 'NvidiaTeslaT4',
      idleTimeoutSec: 900,
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
      kernelTimeoutSec: 10800,
    },
    // 默认直连 Kaggle JSON API（凭证在 ~/.kaggle/credentials.json）；`--cli` 时用本机 kaggle CLI。
    deps: TRANSPORT_DEPS,
  })

  console.log(`[1/5] 推送 GPU Kernel（首个预设 ${options.presets[0]}，共 ${options.presets.length} 个模型）…`)
  let started = null
  try {
    started = await session.start(options.presets[0])
    console.log(fmt({ state: started.state, kernelId: started.kernelId, kernelUrl: started.kernelUrl }))
    if (started.state === 'error') {
      const failure = started.error ?? {}
      throw Object.assign(new Error(failure.message ?? 'Kernel 推送失败'), { code: failure.code })
    }

    console.log('[2/5] 等待排队与模型加载（最多 60 分钟）…')
    let lastLabel = ''
    let replaceCount = 0
    let queueSince = Date.now()
    for (;;) {
      let stalled = false
      try {
        await session.ensureReady({
          timeoutMs: 60 * 60 * 1000,
          onTick(state) {
            const label = `${state.state}/${state.phase ?? '-'} ${state.kernelStatus ?? ''}`.trim()
            if (label !== lastLabel) {
              lastLabel = label
              console.log(`  · ${label} ${state.detail ?? ''}`)
            }
            // 只在「已推送、还在排队」阶段计数：连接与加载模型阶段不该被重排打断。
            if (state.state !== 'provisioning' || state.phase !== 'queue') return
            if (options.maxQueueMinutes <= 0) return
            if (replaceCount >= options.maxReplace) return
            if (Date.now() - queueSince < options.maxQueueMinutes * 60 * 1000) return
            stalled = true
            throw Object.assign(new Error('排队超时'), { code: 'queue_stalled' })
          },
        })
        break
      } catch (error) {
        if (!stalled) {
          console.error(fmt(session.snapshot()))
          throw error
        }
        replaceCount += 1
        console.log(
          `  · 排队超过 ${options.maxQueueMinutes} 分钟仍未拿到 GPU，换新实例重排（第 ${replaceCount}/${options.maxReplace} 次）…`,
        )
        started = await session.start(options.presets[0], { replace: true })
        console.log(fmt({ state: started.state, kernelId: started.kernelId, kernelUrl: started.kernelUrl }))
        if (started.state === 'error') {
          const failure = started.error ?? {}
          throw Object.assign(new Error(failure.message ?? '重排后 Kernel 推送失败'), { code: failure.code })
        }
        lastLabel = ''
        queueSince = Date.now()
      }
    }

    const { endpoint, token } = session.connection()
    const health = await fetchHealth(endpoint, token, 8000)
    console.log(
      '[3/5] /health',
      fmt({
        phase: health.phase,
        device: health.device,
        count: health.device_count,
        loaded: health.loaded,
        gpuMemory: health.gpu_memory ?? null,
        versions: health.versions ?? null,
      }),
    )

    console.log(
      options.img2img
        ? '[4/5] 文生图 + 垫图重绘 …'
        : options.inpaint
          ? '[4/5] 文生图 + 程序化蒙版局部重绘' +
            `（${options.strengthCompare ? `强度对比 ${options.strengthCompare.join('/')}` : `${options.inpaintRounds ?? 1} 轮`}` +
            `${options.referenceSize ? `，参考尺寸 ${options.referenceSize.width}x${options.referenceSize.height}` : ''}` +
            `${options.maskScale ? `，蒙版面积 ${(options.maskScale * 100).toFixed(1)}%` : ''}）…`
          : options.upscale
            ? '[4/5] 文生图 + tool=upscale 高清放大' +
              `（源图 ${options.referenceSize ? `${options.referenceSize.width}x${options.referenceSize.height}` : '跟随预设 size'}）…`
            : options.outpaint
              ? `[4/5] 文生图 + 扩图（画布 ${OUTPAINT_CANVAS.width}x${OUTPAINT_CANVAS.height}，` +
                `内容区 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height} 居中，strength ${OUTPAINT.strength}）…`
              : options.outpaintLora
                ? `[4/5] flux2 + 扩图 LoRA（绿边画布 ${OUTPAINT_CANVAS.width}x${OUTPAINT_CANVAS.height}，` +
                  `参考图 ${OUTPAINT_LORA.reference.width}x${OUTPAINT_LORA.reference.height}，单次提交）…`
                : options.accelCache
                  ? `[4/5] flux2 文生图缓存 A/B（off/on，firstBlock threshold ${ACCEL_CACHE.threshold}）…`
                  : single
                    ? '[4/5] 生成一张 …'
                    : `[4/5] 在同一会话内连续生成 ${options.presets.length} 个模型（验证 LRU 缓存清理）…`,
    )
    const models = []
    const images = []
    let img2imgReport = null
    let inpaintReport = null
    let upscaleReport = null
    let outpaintReport = null
    let outpaintLoraReport = null
    let referenceReport = null
    let accelReport = null
    let accelCacheReport = null
    if (options.img2img) {
      // M3 真机验收：先文生图，再用刚生成的图做垫图重绘；对比 /health.gpu_memory。
      if (!single) throw new Error('--img2img 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsImg2Img !== true) {
        throw new Error(`预设 ${presetId} 不支持图生图（supportsImg2Img=false），请换 SDXL 家族预设`)
      }
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId, png: txt2img.png })
      console.log(
        `  · ${presetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ${txt2img.entry.imageSeconds ?? '-'}s`,
      )
      const before = await readGpuMemory(endpoint, token)
      const redraw = await runImg2Img({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.prompt,
        strength: options.strength,
      })
      const after = await readGpuMemory(endpoint, token)
      images.push({ index: 'img2img', presetId: `${presetId}-img2img`, png: redraw.png })
      console.log(
        `  · 垫图重绘完成：加载 ${redraw.entry.loadSeconds ?? '-'}s / 出图 ${redraw.entry.imageSeconds ?? '-'}s` +
          `（参考图 ${redraw.entry.referenceWidth ?? '?'}x${redraw.entry.referenceHeight ?? '?'}）`,
      )
      console.log(
        `  · 显存对比（MiB）：文生图后 ${fmt(before)} → 重绘后 ${fmt(after)}`,
      )
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      img2imgReport = {
        preset: presetId,
        strength: redraw.entry.strength,
        referenceBytes: redraw.entry.referenceBytes,
        loadSeconds: redraw.entry.loadSeconds,
        imageSeconds: redraw.entry.imageSeconds,
        width: redraw.entry.width,
        height: redraw.entry.height,
        referenceWidth: redraw.entry.referenceWidth,
        referenceHeight: redraw.entry.referenceHeight,
        pngBytes: redraw.entry.pngBytes,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // from_pipe 复用底座不应重新加载权重：load_seconds 期望为 0 或接近 0。
        reusedBasePipeline: (redraw.entry.loadSeconds ?? 0) === 0,
      }
    } else if (options.inpaint) {
      // 真机验收：先文生图，再用程序化蒙版做局部重绘；支持非正方形源图 / 连续多轮 / 强度对比。
      if (!single) throw new Error('--inpaint 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsInpaint !== true) {
        throw new Error(`预设 ${presetId} 不支持局部重绘（supportsInpaint=false），请换 SDXL 家族预设`)
      }
      // 专用 inpaint 模型不能文生图：源图用 --source-preset（默认 sdxl-lightning）先出。
      // --reference-size 同时决定源文生图宽高，局部重绘蒙版按源图实际尺寸（同比例）生成。
      const sourcePresetId = options.sourcePreset
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: options.referenceSize?.width,
        height: options.referenceSize?.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${txt2img.entry.width ?? '?'}x${txt2img.entry.height ?? '?'}`,
      )
      const before = await readGpuMemory(endpoint, token)
      const { runs: inpaintRuns, report } = await runInpaint({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.inpaintPrompt,
        options,
        maskOptions: {
          shape: options.maskShape,
          size: options.maskSize,
          scale: options.maskScale,
          centerX: options.maskCenterX,
          centerY: options.maskCenterY,
        },
      })
      const after = await readGpuMemory(endpoint, token)
      const multiRun = inpaintRuns.length > 1
      inpaintRuns.forEach((run) => {
        const label = options.strengthCompare
          ? `strength-${run.strength}`
          : multiRun
            ? `round${run.round}`
            : ''
        images.push({
          index: 'inpaint',
          presetId: `${presetId}-inpaint`,
          png: run.png,
          name: label ? `02-inpaint-${label}.png` : '02-inpaint.png',
        })
        console.log(
          `  · 局部重绘${multiRun ? `第 ${run.round}/${inpaintRuns.length} 轮` : ''}完成：加载 ` +
            `${run.entry.loadSeconds ?? '-'}s / 出图 ${run.entry.imageSeconds ?? '-'}s` +
            `（${run.entry.width ?? '?'}x${run.entry.height ?? '?'}，参考图 ` +
            `${run.entry.referenceWidth ?? '?'}x${run.entry.referenceHeight ?? '?'}，蒙版 ` +
            `${run.entry.maskWidth ?? '?'}x${run.entry.maskHeight ?? '?'}，覆盖率 ` +
            `${run.entry.maskCoveragePercent ?? '?'}%，蒙版内平均差异 ${run.diffFromPrevious ?? '-'}）`,
        )
      })
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 局部重绘后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      inpaintReport = {
        ...report,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // from_pipe 复用底座不应重新加载权重：每轮 load_seconds 期望为 0 或接近 0。
        reusedBasePipeline: inpaintRuns.every((run) => (run.entry.loadSeconds ?? 0) === 0),
      }
    } else if (options.upscale) {
      // Phase B1 真机验收：先文生图（默认 preset size，或 --reference-size），再发 tool=upscale。
      if (!single) throw new Error('--upscale 只能配合单个 --preset 使用')
      const sourcePresetId = options.presets[0]
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: options.referenceSize?.width,
        height: options.referenceSize?.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      const sourceSize = pngSize(txt2img.png)
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
      )
      const before = await readGpuMemory(endpoint, token)
      const upscale = await runUpscale({ endpoint, token, sourcePng: txt2img.png })
      const after = await readGpuMemory(endpoint, token)
      images.push({
        index: 'upscale',
        presetId: `${sourcePresetId}-upscale`,
        png: upscale.png,
        name: '02-upscale.png',
      })
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 放大后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      upscaleReport = {
        ...upscale.entry,
        sourcePreset: sourcePresetId,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // 输出应是源图的整数倍（INTERFACES §2.6 的硬断言）：
        // 宽高比与 factor 在 runUpscale 里已校验，这里补一个可读布尔值供报告消费。
        outputMatchesSource: upscale.entry.width === txt2img.entry.width * upscale.entry.factor,
      }
      if (!upscaleReport.outputMatchesSource) {
        throw new Error(
          `upscale：输出 ${upscale.entry.width}x${upscale.entry.height} 不是源图 ` +
            `${txt2img.entry.width}x${txt2img.entry.height} 的 ${upscale.entry.factor} 倍`,
        )
      }
    } else if (options.outpaint) {
      // Phase B2 真机验收：源图 864x864（专用 inpaint 预设不能文生图，源图先由普通预设出），
      // 然后构造「1536x864 画布 + 白边蒙版」提交局部重绘，并用像素差验证内容区保留。
      if (!single) throw new Error('--outpaint 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsInpaint !== true) {
        throw new Error(`预设 ${presetId} 不支持局部重绘（supportsInpaint=false），请换 SDXL 家族预设`)
      }
      const sourcePresetId = options.sourcePreset
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: OUTPAINT_CONTENT.width,
        height: OUTPAINT_CONTENT.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      const sourceSize = pngSize(txt2img.png)
      if (
        sourceSize &&
        (sourceSize.width !== OUTPAINT_CONTENT.width || sourceSize.height !== OUTPAINT_CONTENT.height)
      ) {
        throw new Error(
          `outpaint：源图应为 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height}，` +
            `收到 ${sourceSize.width}x${sourceSize.height}`,
        )
      }
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
      )
      const composed = buildOutpaintCanvas(txt2img.png)
      const mask = buildOutpaintMaskPng()
      console.log(
        `  · [outpaint] 画布 ${composed.width}x${composed.height}（内容区 ${composed.content.width}x` +
          `${composed.content.height} @ ${composed.content.x},${composed.content.y}，新增区域 ` +
          `${(mask.coverage * 100).toFixed(2)}%，画布 ${composed.png.length} 字节，蒙版 ${mask.png.length} 字节）…`,
      )
      images.push(
        { index: 'outpaint-canvas', presetId: `${presetId}-outpaint`, png: composed.png, name: '02-outpaint-canvas.png' },
        { index: 'outpaint-mask', presetId: `${presetId}-outpaint`, png: mask.png, name: '02-outpaint-mask.png' },
      )

      if (!options.accel) {
        // 原有 Phase B2 单次扩图路径：报告形状保持不变。
        const before = await readGpuMemory(endpoint, token)
        const outpaint = await runOutpaint({
          endpoint,
          token,
          presetId,
          sourcePng: txt2img.png,
          prompt: options.prompt,
        })
        const after = await readGpuMemory(endpoint, token)
        images.push({ index: 'outpaint', presetId: `${presetId}-outpaint`, png: outpaint.png, name: '02-outpaint.png' })
        console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 扩图后 ${fmt(after)}`)
        const reservedDeltaMb =
          Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
            ? after.reserved_mb - before.reserved_mb
            : null
        outpaintReport = {
          ...outpaint.entry,
          sourcePreset: sourcePresetId,
          gpuMemoryBefore: before,
          gpuMemoryAfter: after,
          reservedDeltaMb,
          // 内容区核心像素与源图应几乎一致（composite 保留原图像素）；
          // 差异过大说明扩图改写了保留区（硬接缝/整图重绘），验收不通过。
          contentPreserved: outpaint.entry.contentPreserved,
        }
        if (!outpaintReport.contentPreserved) {
          throw new Error(
            `outpaint：内容区被改动（核心区平均差 ${outpaint.entry.contentCoreMeanDiff}），` +
              '预期 composite 保留原图像素（≈0）',
          )
        }
      } else {
        // Phase C1：扩图路径的推理加速 A/B（同源图 / 画布 / 蒙版 / seed，只换 accel 配置）。
        const accelPhase = await runAccelOutpaintPhase({
          endpoint,
          token,
          presetId,
          sourcePresetId,
          prompt: options.prompt,
          order: options.accel === 'ab' ? ['off', 'on'] : [options.accel],
          rounds: options.accelRounds,
        })
        accelReport = accelPhase.report
        models.push(...accelPhase.models)
        images.push(...accelPhase.images)
      }
    } else if (options.outpaintLora) {
      // Phase C2：现代扩图引擎（flux2-klein-4b + 扩图 LoRA），源图仍由 --source-preset 出。
      if (!single) throw new Error('--outpaint-lora 只能配合单个 --preset 使用')
      const loraPhase = await runOutpaintLoraPhase({
        endpoint,
        token,
        presetId: options.presets[0],
        sourcePresetId: options.sourcePreset,
        prompt: options.prompt,
      })
      outpaintLoraReport = loraPhase.report
      models.push(...loraPhase.models)
      images.push(...loraPhase.images)
    } else if (options.accelCache) {
      // Phase C2：flux2 文生图的 firstBlock 缓存探针（off/on 同 seed，多轮取中位）。
      if (!single) throw new Error('--accel-cache 只能配合单个 --preset 使用')
      const cachePhase = await runAccelCachePhase({
        endpoint,
        token,
        presetId: options.presets[0],
        prompt: options.prompt,
        rounds: options.accelRounds,
      })
      accelCacheReport = cachePhase.report
      models.push(...cachePhase.models)
      images.push(...cachePhase.images)
    } else if (options.reference) {
      // Phase C1：模型原生参考生图验收（源图 → 1/2 张参考图 → 1280x720 画幅保持 → 显存复测）。
      if (!single) throw new Error('--reference 只能配合单个 --preset 使用')
      const preset = presetById(options.presets[0])
      const referencePhase = await runReferencePhase({
        endpoint,
        token,
        presetId: options.presets[0],
        prompt: options.prompt,
        mainSize: options.referenceSize ?? { width: preset.size, height: preset.size },
        referenceCounts: options.referenceCounts,
        referenceRounds: options.referenceRounds,
      })
      referenceReport = referencePhase.report
      models.push(...referencePhase.models)
      images.push(...referencePhase.images)
    } else if (options.accel) {
      // Phase C1：文生图路径的推理加速 A/B（同 seed / 尺寸 / prompt，每档多轮取中位）。
      if (!single) throw new Error('--accel 只能配合单个 --preset 使用')
      const accelPhase = await runAccelTxt2ImgPhase({
        endpoint,
        token,
        presetId: options.presets[0],
        prompt: options.prompt,
        order: options.accel === 'ab' ? ['off', 'on'] : [options.accel],
        rounds: options.accelRounds,
      })
      accelReport = accelPhase.report
      models.push(...accelPhase.models)
      images.push(...accelPhase.images)
    } else if (options.c1Acceptance) {
      // Phase C1 一次性正式验收：同一个 Kernel 会话内连续跑三段（模型切换由 daemon 缓存管理负责）：
      //   1) flux2-klein-4b 原生参考生图（1/2 张参考 + 1280x720 画幅保持 + 显存复测）；
      //   2) sdxl-lightning 1024² 4 步 channelsLast+fuseQkv+vaeTiling 开/关 A/B；
      //   3) sdxl-inpaint 1536x864 30 步扩图 vaeTiling 开/关 A/B。
      const referencePreset = PRESETS.find((item) => item.supportsReference === true) ?? null
      if (!referencePreset) throw new Error('--c1-acceptance：没有 supportsReference=true 的预设')
      const accelOrder = options.accel === 'on' || options.accel === 'off' ? [options.accel] : ['off', 'on']

      console.log(`[c1] 1/3 参考生图验收（${referencePreset.id}）…`)
      const referencePhase = await runReferencePhase({
        endpoint,
        token,
        presetId: referencePreset.id,
        prompt: options.prompt,
        mainSize: options.referenceSize ?? { width: referencePreset.size, height: referencePreset.size },
        referenceCounts: options.referenceCounts,
        referenceRounds: options.referenceRounds,
      })
      referenceReport = referencePhase.report
      models.push(...referencePhase.models)
      images.push(...referencePhase.images)

      console.log('[c1] 2/3 sdxl-lightning 推理加速 A/B（1024²，4 步）…')
      const txt2imgPhase = await runAccelTxt2ImgPhase({
        endpoint,
        token,
        presetId: 'sdxl-lightning',
        prompt: options.prompt,
        order: accelOrder,
        rounds: options.accelRounds,
      })
      models.push(...txt2imgPhase.models)
      images.push(...txt2imgPhase.images)

      console.log('[c1] 3/3 sdxl-inpaint 扩图加速 A/B（1536x864，30 步）…')
      const outpaintPhase = await runAccelOutpaintPhase({
        endpoint,
        token,
        presetId: 'sdxl-inpaint',
        sourcePresetId: 'sdxl-lightning',
        prompt: options.prompt,
        order: accelOrder,
        rounds: options.accelRounds,
      })
      models.push(...outpaintPhase.models)
      images.push(...outpaintPhase.images)

      accelReport = {
        mode: 'c1-acceptance',
        order: accelOrder,
        roundsPerConfig: options.accelRounds,
        txt2img: txt2imgPhase.report,
        outpaint: outpaintPhase.report,
      }
    } else {
      for (const [index, presetId] of options.presets.entries()) {
        const { png, entry } = await generateOne({
          endpoint,
          token,
          presetId,
          prompt: options.prompt,
          index,
          total: options.presets.length,
        })
        models.push(entry)
        images.push({ index, presetId, png })
        console.log(
          `  · ${presetId} 完成：加载 ${entry.loadSeconds ?? '-'}s / 出图 ${entry.imageSeconds ?? '-'}s / ${entry.pngBytes} 字节`,
        )
      }
    }

    console.log('[5/5] 汇总 [cache] 日志并写报告 …')
    const cacheLogs = await collectCacheLogs(endpoint, token)
    const genLogs = await collectGenLogs(endpoint, token)
    const finalHealth = await fetchHealth(endpoint, token, 8000).catch(() => health)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(OUT_DIR, stamp)
    await mkdir(dir, { recursive: true })
    for (const image of images) {
      const name =
        image.name ??
        (image.index === 'img2img'
          ? '01-img2img.png'
          : image.index === 'inpaint'
            ? '02-inpaint.png'
            : image.index === 'upscale'
              ? '02-upscale.png'
              : image.index === 'outpaint'
                ? '02-outpaint.png'
                : artifactName(image.index, image.presetId, options.presets.length))
      await writeFile(join(dir, name), image.png)
    }
    const first = models[0] ?? {}
    const report = {
      // 单预设兼容字段：与 0.7.0 的报告结构保持一致（多模型模式下取第一个模型）。
      preset: options.presets[0],
      presets: options.presets,
      prompt: options.prompt,
      kernelId: started.kernelId,
      device: health.device,
      deviceCount: health.device_count,
      loadSeconds: first.loadSeconds,
      imageSeconds: first.imageSeconds,
      wallSeconds: first.wallSeconds,
      pngBytes: first.pngBytes,
      isPng: first.isPng,
      // M4.2：逐模型耗时与依赖版本快照，用于固化 LKGR 与核对缓存清理是否生效。
      models,
      // M3：--img2img 模式下的垫图重绘结果与显存对比（非该模式为 null）。
      img2img: img2imgReport,
      // M3：--inpaint 模式下的局部重绘结果、蒙版尺寸与显存对比（非该模式为 null）。
      inpaint: inpaintReport,
      // Phase B1：--upscale 模式下的源图/输出尺寸、加载与推理秒数、显存对比（非该模式为 null）。
      upscale: upscaleReport,
      // Phase B2：--outpaint 模式的画布/内容区、内容区像素差与显存对比（非该模式为 null）。
      outpaint: outpaintReport,
      // Phase C2：--outpaint-lora 模式的 LoRA 配置、提交/执行耗时、输出尺寸、绿边残留、
      // 内容区像素差/颜色漂移、接缝指标与 sdxl-inpaint 历史基线对比（非该模式为 null）。
      outpaintLora: outpaintLoraReport,
      // Phase C1：--reference 模式的参考图数量/尺寸/耗时/显存/输出尺寸断言（非该模式为 null）。
      reference: referenceReport,
      // Phase C1：--accel 模式的 A/B 数据（单模式为 {mode:'txt2img'|'outpaint',...}，
      // --c1-acceptance 一次性验收为 {mode:'c1-acceptance', txt2img, outpaint}；非该模式为 null）。
      accel: accelReport,
      // Phase C2：--accel-cache 模式的缓存探针 A/B 数据与 [accel] cache 日志判定（非该模式为 null）。
      accelCache: accelCacheReport,
      versions: health.versions ?? null,
      finalVersions: finalHealth.versions ?? null,
      cacheLogs,
      genLogs,
      generatedAt: new Date().toISOString(),
    }
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log('[5/5] 结果', fmt(report))
    console.log(`\nGPU 链路验证通过，产物：${dir}`)
  } finally {
    if (KEEP) {
      console.log('--keep：保留 Kernel 便于观察（需手动关机）')
    } else if (started?.kernelId) {
      console.log('关机 …')
      const stopped = await session
        .stop()
        .catch((error) => ({ state: 'error', detail: error?.message ?? String(error) }))
      console.log(fmt({ state: stopped.state, detail: stopped.detail }))
    }
  }
}

/**
 * 零配额自检：只跑 Phase C2 新增的纯函数（画布 / 参考图缩放 / 绿边统计 / 颜色漂移 /
 * spec 覆盖 / 尺寸计划），不连远端、不推 Kernel、不消耗 GPU 配额。
 *
 * 运行：`node test/gpu-live.mjs --self-test`（退出码 0 全通过）。
 */
function runSelfTest() {
  const { width: canvasWidth, height: canvasHeight } = OUTPAINT_CANVAS
  const { x, y, width: contentWidth, height: contentHeight } = OUTPAINT_CONTENT
  const failures = []
  const check = (name, fn) => {
    try {
      fn()
      console.log(`PASS  ${name}`)
    } catch (error) {
      failures.push(name)
      console.log(`FAIL  ${name} — ${error?.message ?? error}`)
    }
  }
  const expect = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const closeTo = (actual, expected, tolerance, label) => {
    expect(Math.abs(actual - expected) <= tolerance, `${label} 期望 ≈${expected}，实际 ${actual}`)
  }

  // 程序化 864x864 源图：横向渐变 + 中心方块，保证不是纯绿（避免绿边统计被误判）。
  const sourcePixels = Buffer.alloc(contentWidth * contentHeight * 3)
  for (let row = 0; row < contentHeight; row += 1) {
    for (let column = 0; column < contentWidth; column += 1) {
      const offset = (row * contentWidth + column) * 3
      const inBox =
        column >= contentWidth / 4 &&
        column < (contentWidth * 3) / 4 &&
        row >= contentHeight / 4 &&
        row < (contentHeight * 3) / 4
      sourcePixels[offset] = Math.round((column / contentWidth) * 255)
      sourcePixels[offset + 1] = inBox ? 200 : Math.round((row / contentHeight) * 160)
      sourcePixels[offset + 2] = inBox ? 60 : 120
    }
  }
  const sourcePng = encodePngRgb(contentWidth, contentHeight, sourcePixels)
  const composed = buildGreenOutpaintCanvas(sourcePng)
  const reference = resizePngTo(composed.png, OUTPAINT_LORA.reference.width, OUTPAINT_LORA.reference.height)

  check('绿边画布：尺寸 = 1536x864，内容区居中贴入，剩余区域为 #00FF00', () => {
    expect(composed.width === canvasWidth && composed.height === canvasHeight, '画布尺寸不符')
    const image = decodePng(composed.png)
    expect(image, '画布 PNG 无法解码')
    const offsetOf = (px, py) => (py * image.width + px) * image.channels
    const left = offsetOf(0, 0)
    expect(
      image.pixels[left] === 0 && image.pixels[left + 1] === 255 && image.pixels[left + 2] === 0,
      '新增区域不是纯绿',
    )
    const center = offsetOf(x + Math.floor(contentWidth / 2), y + Math.floor(contentHeight / 2))
    const sourceCenter = (Math.floor(contentHeight / 2) * contentWidth + Math.floor(contentWidth / 2)) * 3
    expect(
      image.pixels[center] === sourcePixels[sourceCenter] &&
        image.pixels[center + 1] === sourcePixels[sourceCenter + 1] &&
        image.pixels[center + 2] === sourcePixels[sourceCenter + 2],
      '内容区像素没有逐像素贴入',
    )
    closeTo(composed.greenCoverage, 0.4375, 0.0001, '绿边覆盖率')
  })

  check('绿边统计：纯绿画布残留比例 ≈ 43.75%，源图内容区不误判为绿', () => {
    const stats = greenAreaStats(composed.png)
    expect(stats, '画布统计失败')
    closeTo(stats.nearGreenRatio, 0.4375, 0.002, 'nearGreenRatio')
    closeTo(stats.exactGreenRatio, 0.4375, 0.002, 'exactGreenRatio')
    const sourceStats = greenAreaStats(sourcePng)
    expect(sourceStats.nearGreenRatio === 0, `源图绿边比例应为 0，实际 ${sourceStats.nearGreenRatio}`)
  })

  check('参考图缩放：1024x576，绿边比例保持（误差 <1%），双线性输出可解码', () => {
    expect(reference, '参考图缩放失败')
    expect(reference.width === 1024 && reference.height === 576, '参考图尺寸不符')
    const stats = greenAreaStats(reference.png)
    expect(stats, '参考图统计失败')
    closeTo(stats.nearGreenRatio, 0.4375, 0.01, '参考图绿边比例')
  })

  check('尺寸计划：画布/参考图同宽高比，内容区按比例映射，长边不超契约上限', () => {
    const plan = outpaintLoraPlan()
    expect(plan.sameAspect === true, '画布与参考图宽高比不一致')
    expect(plan.contentInReference.x === 224 && plan.contentInReference.y === 0, '内容区推算位置不符')
    expect(plan.contentInReference.width === 576 && plan.contentInReference.height === 576, '内容区推算尺寸不符')
    const maxEdge = Number(LIMITS.referenceImages?.maxEdge) || 1024
    expect(Math.max(plan.reference.width, plan.reference.height) <= maxEdge, '参考图长边超过契约上限')
  })

  check('LoRA / 缓存 spec 覆盖：其它字段逐字保留，不修改原 pipeline', () => {
    const pipeline = { loader: 'flux2', base: 'black-forest-labs/FLUX.2-klein-4B', lora: null }
    const loraSpec = withFlux2LoraSpec(pipeline)
    expect(loraSpec.loader === 'flux2' && loraSpec.base === pipeline.base, 'loader/base 被改动')
    expect(
      loraSpec.lora.repo === OUTPAINT_LORA.lora.repo &&
        loraSpec.lora.weight === OUTPAINT_LORA.lora.weight &&
        loraSpec.lora.scale === OUTPAINT_LORA.lora.scale,
      'LoRA 覆盖值不符',
    )
    expect(pipeline.lora === null, 'withFlux2LoraSpec 修改了原 spec')
    const cacheSpec = withAccelCacheSpec(pipeline)
    expect(cacheSpec.accel.cache.type === 'firstBlock', 'cache type 不符')
    expect(cacheSpec.accel.cache.threshold === ACCEL_CACHE.threshold, 'cache threshold 不符')
    expect(cacheSpec.loader === 'flux2', '缓存覆盖丢了 loader')
    const offSpec = accelCacheOffSpec({ pipeline: { ...pipeline, accel: { vaeTiling: true } } })
    expect(offSpec.accel === undefined, 'off 档仍带 accel')
    expect(offSpec.loader === 'flux2', 'off 档丢了 loader')
  })

  check('内容区坐标换算：flux2 按 1MP 上限缩到 1360x768 时按比例映射', () => {
    const scaled = scaledContentOf({ width: 1360, height: 768 })
    expect(scaled.x === 298 && scaled.y === 0, `x/y 映射不符：${scaled.x},${scaled.y}`)
    expect(scaled.width === 765 && scaled.height === 768, `宽高映射不符：${scaled.width}x${scaled.height}`)
  })

  check('内容区颜色漂移：同图差值为 0，整体提亮后 maxAbsDelta 可检出', () => {
    const contentOnly = { x: 0, y: 0, width: contentWidth, height: contentHeight }
    const identical = contentColorDrift(sourcePng, composed.png, { ...OUTPAINT_CONTENT }, 16)
    expect(identical, '颜色漂移计算失败')
    expect(identical.maxAbsDelta === 0, `同图 maxAbsDelta 应为 0，实际 ${identical.maxAbsDelta}`)
    const brighter = Buffer.from(sourcePixels)
    for (let offset = 0; offset < brighter.length; offset += 1) {
      brighter[offset] = Math.min(255, brighter[offset] + 10)
    }
    const drift = contentColorDrift(sourcePng, encodePngRgb(contentWidth, contentHeight, brighter), contentOnly, 16)
    expect(drift, '提亮图颜色漂移计算失败')
    closeTo(drift.maxAbsDelta, 10, 1, '提亮后 maxAbsDelta')
  })

  const failed = failures.length
  console.log(
    `\n自检${failed ? `失败 ${failed} 项：${failures.join('、')}` : '全部通过'}（不推 Kernel、不消耗 GPU 配额）`,
  )
  return failed === 0
}

if (HELP) {
  printHelp()
  process.exit(0)
}

if (process.argv.includes('--self-test')) {
  process.exit(runSelfTest() ? 0 : 1)
}

// 离线校验 PNG 辅助函数（画布/蒙版/像素差）时置 GPU_LIVE_SKIP_MAIN=1：只加载函数，
// 不推送 Kernel、不消耗配额；真机运行不带该变量，行为与改造前完全一致。
if (process.env.GPU_LIVE_SKIP_MAIN !== '1') {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n验证失败：', error?.message ?? error)
      if (['auth_required', 'cli_missing', 'cli_timeout'].includes(error?.code)) {
        console.error(
          '请先确认 Kaggle 凭据可用：默认直连读 %USERPROFILE%\\.kaggle\\credentials.json，' +
            '也可在工作台用内置 OAuth 登录；加 --cli 时才需要本机 kaggle CLI（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
        )
      } else if (error?.code === 'gpu_unavailable') {
        console.error(
          '远端容器没有拿到 GPU：请检查 Kaggle 账号是否已完成手机号验证、是否启用 GPU 加速器' +
            '（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
        )
      }
      process.exit(1)
    })
}

// 真机验收脚本不对外提供 API；这里只把 PNG 辅助函数与参数解析导出给离线自检
// （`GPU_LIVE_SKIP_MAIN=1`，不推送 Kernel、不消耗配额）。
export {
  ACCEL_CACHE,
  OUTPAINT_CANVAS,
  OUTPAINT_CONTENT,
  OUTPAINT_LORA,
  accelCacheOffSpec,
  accelOffConfigOf,
  accelOnConfigOf,
  buildGreenOutpaintCanvas,
  buildOutpaintCanvas,
  buildOutpaintMaskPng,
  contentColorDrift,
  contentRegionDiff,
  decodePng,
  encodePngRgb,
  generateOne,
  greenAreaStats,
  loadOutpaintBaseline,
  meanAbsDiffPng,
  medianOf,
  outpaintLoraPlan,
  outpaintSeamMetrics,
  parseOptions,
  peakDeltaOf,
  resizePngTo,
  runSelfTest,
  scaledContentOf,
  speedupOf,
  submitOutpaintLoraOnce,
  withAccelCacheSpec,
  withAccelSpec,
  withFlux2LoraSpec,
}
