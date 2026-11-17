#!/usr/bin/env node
/**
 * 本地图片导入（阶段十五 Phase A3）Host 侧离线回归。
 *
 * 覆盖：
 *  - `POST /imagen-api/import` 的落盘、meta.json 形状与响应形状；
 *  - 校验顺序与错误码：坏 JSON / 缺字段 → invalid_body，超体积 / 非 PNG·JPEG / 尺寸过小 → invalid_request；
 *  - dataURL / 裸 base64 归一、name 控制字符清洗与截断；
 *  - PNG tEXt 生成元数据读写往返（含中文）、边界校验、非 PNG 原样返回；
 *  - 导入带生成元数据的 PNG：generation 回填并覆盖 params；
 *  - `lib/output.js`：出图落盘写入 tEXt，/history 条目 source=ai / import，导入图独立根 v1 收录进 /history/tree。
 *
 * 不依赖 Kaggle、不联网：用假 cordis Context 加载真实插件入口 index.js，
 * 把路由挂到本机 HTTP 服务上；工作区用 fs.mkdtemp 建在 `.tmp/phase-a/` 下。
 *
 * 运行：node test/import-host.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import { apply as applyPlugin } from '../index.js'
import { saveJobOutput } from '../lib/output.js'
import {
  META_APP,
  META_KEYWORD,
  parseImageHeader,
  readGenerationMeta,
  readPngTexts,
  writeGenerationMeta,
  writePngText,
} from '../lib/image-meta.js'
import { IMPORT } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { closeServer, createFakeContext, json, startHost } from './helpers/fake-context.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const { check, summary } = createCheckRunner()

// ── 图片 fixture（测试内独立实现，不借用被测模块的 CRC / chunk 逻辑）──────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 构造一个结构合法（IHDR/IDAT/IEND + 正确 CRC）的 PNG；像素全透明节省体积。 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

function makePng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 构造一个只有头部（SOI + APP0 + SOF0 + EOI）的 JPEG，足够 Host 解析宽高。 */
function makeJpeg(width, height) {
  const soi = Buffer.from([0xff, 0xd8])
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ])
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ])
  return Buffer.concat([soi, app0, sof, Buffer.from([0xff, 0xd9])])
}

/** 读某个产物目录的 meta.json。 */
function readMeta(workspace, dir) {
  return readFile(join(workspace, ...dir.split('/'), 'meta.json'), 'utf8').then((text) => JSON.parse(text))
}

function postImport(origin, body) {
  return json(origin, '/imagen-api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const baseDir = join(ROOT, '.tmp', 'phase-a')
  await mkdir(baseDir, { recursive: true })
  const workspace = await mkdtemp(join(baseDir, 'import-host-'))
  const fake = createFakeContext(workspace)
  const host = await startHost(fake.routes)
  fake.setOrigin(host.origin)

  // 版本检查默认会联网，离线测试显式关闭；dev 模式不启动真实会话。
  applyPlugin(fake.ctx, { updateCheck: false })
  await new Promise((resolve) => setTimeout(resolve, 50))

  let firstPngEntry = null
  let jpegEntry = null
  let metaEntry = null
  let generatedOutput = null

  try {
    await check('导入路由已注册（POST /imagen-api/import）', () => {
      const routes = fake.routes.filter((route) => route.path === '/imagen-api/import')
      assert.equal(routes.length, 1, '导入路由只能注册一条')
      // route-kit 注册时只把 path/handler 交给宿主，方法校验在 handler 闭包里；
      // 真实方法语义由下面「非 POST → 405」与各 200 用例覆盖。
      assert.equal(routes[0].kind, 'exact')
    })

    await check('parseImageHeader：PNG / JPEG 宽高与坏图', () => {
      assert.deepEqual(parseImageHeader(makePng(200, 150)), { format: 'png', width: 200, height: 150 })
      assert.deepEqual(parseImageHeader(makeJpeg(320, 240)), { format: 'jpeg', width: 320, height: 240 })
      assert.equal(parseImageHeader(Buffer.from('not an image at all')), null)
      assert.equal(parseImageHeader(makePng(200, 150).subarray(0, 20)), null, '截断的 PNG 应解析失败')
      assert.equal(parseImageHeader(Buffer.alloc(0)), null)
      assert.equal(parseImageHeader(makeJpeg(320, 240).subarray(0, 10)), null, '截断的 JPEG 应解析失败')
    })

    await check('PNG tEXt 往返；非 PNG 原样返回；非法参数不写入', () => {
      const png = makePng(16, 16)
      assert.deepEqual(readPngTexts(png), {}, '原始 PNG 没有 tEXt')
      const withText = writePngText(png, 'Comment', 'hello world')
      assert.notEqual(withText.length, png.length)
      assert.equal(withText.subarray(0, 8).toString('hex'), PNG_SIGNATURE.toString('hex'))
      assert.deepEqual(readPngTexts(withText), { Comment: 'hello world' })
      assert.deepEqual(parseImageHeader(withText), { format: 'png', width: 16, height: 16 }, 'tEXt 不得破坏头部')

      const jpeg = makeJpeg(64, 64)
      assert.equal(writePngText(jpeg, 'Comment', 'x'), jpeg, '非 PNG 原样返回同一 buffer')
      assert.deepEqual(readPngTexts(jpeg), {})
      assert.equal(readGenerationMeta(jpeg), null)
      assert.equal(writePngText(png, '', 'x'), png, '空 keyword 不写入')
      assert.equal(writePngText(png, 'k', 'a\u0000b'), png, '含 NUL 的文本不写入')
      assert.equal(writePngText(png, 'k', '中文'), png, '非 Latin-1 文本不写入')
    })

    await check('生成元数据 tEXt 往返（含中文）与边界校验', () => {
      const png = makePng(64, 48)
      const withMeta = writeGenerationMeta(png, {
        prompt: '水墨风格，湖面倒影',
        negativePrompt: 'blurry, 低质量',
        presetId: 'sdxl-lightning',
        width: 1024,
        height: 768,
        steps: 4,
        cfg: 0,
        seed: 123456,
        jobId: 'j_meta_1',
        createdAt: '2026-01-02T03:04:05.000Z',
      })
      const meta = readGenerationMeta(withMeta)
      assert.ok(meta, '本插件写入的元数据应可读回')
      assert.equal(meta.app, META_APP)
      assert.equal(meta.version, 1)
      assert.equal(meta.prompt, '水墨风格，湖面倒影')
      assert.equal(meta.negativePrompt, 'blurry, 低质量')
      assert.equal(meta.presetId, 'sdxl-lightning')
      assert.equal(meta.width, 1024)
      assert.equal(meta.height, 768)
      assert.equal(meta.steps, 4)
      assert.equal(meta.cfg, 0)
      assert.equal(meta.seed, 123456)
      assert.equal(meta.jobId, 'j_meta_1')
      assert.equal(meta.createdAt, '2026-01-02T03:04:05.000Z')
      // tEXt 原文按 Latin-1 存放 UTF-8 字节，不能直接当 UTF-8 JSON 解析。
      assert.ok(!readPngTexts(withMeta)[META_KEYWORD].includes('水墨'))

      const foreign = writePngText(
        png,
        META_KEYWORD,
        JSON.stringify({ app: 'other-plugin', version: 1, width: 10, height: 10 }),
      )
      assert.equal(readGenerationMeta(foreign), null, 'app 不符应判非法')
      const outOfRange = writePngText(
        png,
        META_KEYWORD,
        JSON.stringify({ app: META_APP, version: 1, width: 0, height: 10 }),
      )
      assert.equal(readGenerationMeta(outOfRange), null, '宽高越界应判非法')
      const badVersion = writePngText(
        png,
        META_KEYWORD,
        JSON.stringify({ app: META_APP, version: 2, width: 10, height: 10 }),
      )
      assert.equal(readGenerationMeta(badVersion), null, '不兼容版本应判非法')
      const looseNumbers = writePngText(
        png,
        META_KEYWORD,
        JSON.stringify({ app: META_APP, version: 1, width: 10, height: 10, steps: 99999, cfg: -5, seed: -1 }),
      )
      const loose = readGenerationMeta(looseNumbers)
      assert.ok(loose)
      assert.equal(loose.steps, null, '越界 steps 收敛为 null')
      assert.equal(loose.cfg, null, '越界 cfg 收敛为 null')
      assert.equal(loose.seed, null, '越界 seed 收敛为 null')

      // 只截掉 IEND 的尾部：tEXt 仍可读，读取端容错不抛错。
      const truncated = withMeta.subarray(0, withMeta.length - 8)
      assert.equal(typeof readPngTexts(truncated)[META_KEYWORD], 'string')
      assert.equal(readGenerationMeta(truncated)?.prompt, '水墨风格，湖面倒影')
    })

    await check('导入合法 PNG：落盘、meta.json 形状与响应形状', async () => {
      const png = makePng(200, 150)
      const res = await postImport(host.origin, { data: png.toString('base64'), name: 'photo.png' })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.ok, true)
      const { image, item } = res.body.entry
      for (const key of ['file', 'path', 'url', 'width', 'height', 'absolute']) {
        assert.ok(key in image, `entry.image 缺字段 ${key}`)
      }
      assert.equal(image.file, '01.png')
      assert.equal(image.width, 200)
      assert.equal(image.height, 150)
      assert.match(image.path, /^imagen-output\/\d{8}-\d{6}-import-[0-9a-f]{6}\/01\.png$/)
      assert.match(image.url, /\/imagen-api\/file\?path=/)
      assert.equal(image.absolute, join(workspace, ...image.path.split('/')))
      assert.ok((await readFile(image.absolute)).equals(png), '导入图应原样落盘（不重编码、不追加 tEXt）')
      assert.ok(!('generation' in image) || image.generation === undefined)

      assert.equal(item.source, 'import')
      assert.match(item.dir, /^imagen-output\/\d{8}-\d{6}-import-[0-9a-f]{6}$/)
      assert.equal(item.jobId, `import-${item.dir.split('/')[1]}`)
      assert.equal(item.rootImage, null, '导入图是独立根 v1')
      assert.equal(item.sourceImage, null)
      assert.equal(item.inpaint, false)

      const meta = await readMeta(workspace, item.dir)
      assert.equal(meta.version, 1)
      assert.equal(meta.jobId, item.jobId)
      assert.equal(meta.presetId, null)
      assert.equal(meta.source, 'import')
      assert.equal(meta.imported, true)
      assert.equal(meta.generation, null)
      assert.ok(!Number.isNaN(Date.parse(meta.createdAt)))
      assert.ok(!Number.isNaN(Date.parse(meta.finishedAt)))
      assert.deepEqual(meta.params, {
        prompt: 'photo.png',
        width: 200,
        height: 150,
        count: 1,
        source: 'import',
      })
      assert.deepEqual(meta.images, [
        { file: '01.png', seed: null, seconds: null, width: 200, height: 150, prompt: 'photo.png' },
      ])
      firstPngEntry = res.body.entry
    })

    await check('导入合法 JPEG（dataURL）：01.jpg、文件类型与原始字节', async () => {
      const jpeg = makeJpeg(320, 240)
      const res = await postImport(host.origin, {
        data: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        name: '相机 照片.jpg',
      })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const { image, item } = res.body.entry
      assert.equal(image.file, '01.jpg')
      assert.equal(image.width, 320)
      assert.equal(image.height, 240)
      const served = await fetch(new URL(image.url, host.origin))
      assert.equal(served.status, 200)
      assert.equal(served.headers.get('content-type'), 'image/jpeg')
      assert.ok(Buffer.from(await served.arrayBuffer()).equals(jpeg))

      const meta = await readMeta(workspace, item.dir)
      assert.equal(meta.generation, null, 'JPEG 没有 tEXt 容器')
      assert.equal(meta.params.prompt, '相机 照片.jpg', '非 ASCII 展示名应保留')
      jpegEntry = res.body.entry
    })

    await check('dataURL 前缀 / base64 内空白与裸 base64 等价', async () => {
      const png = makePng(160, 160)
      for (const data of [
        png.toString('base64'),
        `data:image/png;base64,${png.toString('base64')}`,
        png.toString('base64').replace(/(.{76})/g, '$1\n'),
      ]) {
        const res = await postImport(host.origin, { data })
        assert.equal(res.status, 200, JSON.stringify(res.body))
        assert.equal(res.body.entry.image.file, '01.png')
      }
    })

    await check('name 清洗控制字符并截断到契约上限', async () => {
      const png = makePng(150, 150)
      const raw = `a\u0000b\n\tc\u007f${'x'.repeat(300)}`
      const res = await postImport(host.origin, { data: png.toString('base64'), name: raw })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const prompt = res.body.entry.item.params.prompt
      assert.equal(prompt, `abc${'x'.repeat(117)}`)
      assert.equal(Array.from(prompt).length, IMPORT.maxNameChars)
      assert.ok(!/[\u0000-\u001f\u007f]/.test(prompt))

      // 缺省 name：prompt 留空，由客户端兜底展示文案。
      const blank = await postImport(host.origin, { data: png.toString('base64') })
      assert.equal(blank.status, 200)
      assert.equal(blank.body.entry.item.params.prompt, '')
    })

    await check('错误分支：坏 JSON / 非对象 body / 缺字段 → invalid_body', async () => {
      const cases = ['{"data":', '[1,2]', 'null', '"abc"', '42', '{}', JSON.stringify({ data: '' }), JSON.stringify({ data: 42 })]
      for (const body of cases) {
        const res = await postImport(host.origin, body)
        assert.equal(res.status, 400, `body=${body} 应返回 400，实际 ${res.status}`)
        assert.equal(res.body.error.code, 'invalid_body', `body=${body}`)
        assert.equal(typeof res.body.error.message, 'string')
      }
    })

    await check('错误分支：非法 base64 / 不是 PNG·JPEG → invalid_request', async () => {
      const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)])
      const cases = [
        'not-base64!!',
        'data:image/png,abc',
        'data:image/png;base64;abc',
        gif.toString('base64'),
        Buffer.from('PK\u0003\u0004, not an image').toString('base64'),
      ]
      for (const data of cases) {
        const res = await postImport(host.origin, { data })
        assert.equal(res.status, 400, `data=${data.slice(0, 24)} 应返回 400，实际 ${res.status}`)
        assert.equal(res.body.error.code, 'invalid_request', `data=${data.slice(0, 24)}`)
      }
    })

    await check('错误分支：解码后超过 maxBytes → invalid_request', async () => {
      const oversized = Buffer.alloc(IMPORT.maxBytes + 1)
      PNG_SIGNATURE.copy(oversized, 0)
      const res = await postImport(host.origin, { data: oversized.toString('base64') })
      assert.equal(res.status, 400, res.text.slice(0, 200))
      assert.equal(res.body.error.code, 'invalid_request')
      assert.match(res.body.error.message, /MB/)
    })

    await check('错误分支：宽高小于 minEdge → invalid_request；刚好等于 minEdge 放行', async () => {
      for (const [width, height] of [
        [100, 200],
        [200, 100],
      ]) {
        const res = await postImport(host.origin, { data: makePng(width, height).toString('base64') })
        assert.equal(res.status, 400, `${width}×${height} 应拒绝`)
        assert.equal(res.body.error.code, 'invalid_request')
        assert.match(res.body.error.message, new RegExp(String(IMPORT.minEdge)))
      }
      // JPEG 同样按最小边拒绝（魔数不同但尺寸校验共用）。
      const smallJpeg = await postImport(host.origin, { data: makeJpeg(300, 100).toString('base64') })
      assert.equal(smallJpeg.status, 400)
      assert.equal(smallJpeg.body.error.code, 'invalid_request')

      const edge = await postImport(host.origin, { data: makePng(IMPORT.minEdge, IMPORT.minEdge).toString('base64') })
      assert.equal(edge.status, 200, JSON.stringify(edge.body))
      assert.equal(edge.body.entry.image.width, IMPORT.minEdge)
    })

    await check('导入带生成元数据的 PNG：generation 回填并覆盖 params', async () => {
      const png = makePng(200, 150)
      const withMeta = writeGenerationMeta(png, {
        prompt: '湖面上的荷花',
        negativePrompt: 'blurry',
        presetId: 'sdxl-lightning',
        width: 512,
        height: 384,
        steps: 4,
        cfg: 0,
        seed: 123,
        jobId: 'j_original',
        createdAt: '2026-01-02T03:04:05.000Z',
      })
      const res = await postImport(host.origin, { data: withMeta.toString('base64'), name: '改名后.png' })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const { item } = res.body.entry
      const meta = await readMeta(workspace, item.dir)

      assert.ok(meta.generation, 'generation 必须回填')
      assert.equal(meta.generation.app, META_APP)
      assert.equal(meta.generation.prompt, '湖面上的荷花')
      assert.equal(meta.generation.jobId, 'j_original')
      assert.equal(meta.generation.seed, 123)
      assert.equal(meta.presetId, 'sdxl-lightning', '预设从生成元数据恢复')
      assert.deepEqual(meta.params, {
        prompt: '湖面上的荷花',
        width: 512,
        height: 384,
        count: 1,
        source: 'import',
        negativePrompt: 'blurry',
        steps: 4,
        cfg: 0,
        seed: 123,
      })
      assert.equal(meta.images[0].width, 200, 'images 记录图片真实像素尺寸')
      assert.equal(meta.images[0].prompt, '湖面上的荷花')
      assert.equal(item.presetId, 'sdxl-lightning')
      assert.equal(item.params.prompt, '湖面上的荷花')
      assert.equal(item.params.seed, 123)
      assert.equal(item.source, 'import')

      // 落盘保持原图字节：tEXt 不被剥离，后续拖出再导入仍能回填。
      const stored = await readFile(join(workspace, ...item.images[0].path.split('/')))
      assert.equal(readGenerationMeta(stored)?.prompt, '湖面上的荷花')
      metaEntry = res.body.entry
    })

    await check('saveJobOutput：生成图写入 tEXt，交付副本同样带元数据', async () => {
      const png = makePng(64, 64)
      const job = {
        id: 'j_out_meta',
        presetId: 'sdxl-turbo',
        createdAt: '2026-01-02T03:04:05.000Z',
        finishedAt: '2026-01-02T03:04:06.000Z',
        params: {
          prompt: '生成图元数据',
          negativePrompt: 'ugly',
          width: 64,
          height: 64,
          steps: 3,
          cfg: 1.5,
          seed: 77,
          count: 1,
        },
      }
      const results = [{ image_b64: png.toString('base64'), width: 64, height: 64, seed: 77, seconds: 0.5 }]
      generatedOutput = await saveJobOutput(fake.ctx, job, results)
      const bytes = await readFile(join(workspace, ...generatedOutput.images[0].path.split('/')))
      assert.deepEqual(parseImageHeader(bytes), { format: 'png', width: 64, height: 64 }, 'tEXt 不得破坏 PNG')
      const meta = readGenerationMeta(bytes)
      assert.ok(meta, '生成图应带 tEXt 生成元数据')
      assert.equal(meta.prompt, '生成图元数据')
      assert.equal(meta.negativePrompt, 'ugly')
      assert.equal(meta.presetId, 'sdxl-turbo')
      assert.equal(meta.width, 64)
      assert.equal(meta.height, 64)
      assert.equal(meta.steps, 3)
      assert.equal(meta.cfg, 1.5)
      assert.equal(meta.seed, 77)
      assert.equal(meta.jobId, 'j_out_meta')
      assert.equal(meta.createdAt, job.createdAt)

      // 工作区交付副本走同一份 storable 字节，也应带元数据。
      await saveJobOutput(fake.ctx, { ...job, id: 'j_out_deliver', saveTo: 'exports/meta.png' }, results)
      const delivered = await readFile(join(workspace, 'exports', 'meta.png'))
      assert.equal(readGenerationMeta(delivered)?.jobId, 'j_out_deliver')
    })

    await check('/history 收录导入作品，source 区分 import / ai，响应 item 与历史同形', async () => {
      const { status, body } = await json(host.origin, '/imagen-api/history?limit=100')
      assert.equal(status, 200)
      const imported = body.items.filter((item) => item.source === 'import')
      assert.ok(imported.length >= 6, `导入作品应被历史收录，实际 ${imported.length}`)
      for (const item of imported) {
        assert.match(item.dir, /-import-[0-9a-f]{6}$/)
        // 只有内嵌生成元数据的那张能恢复出预设，其余导入图没有生成模型。
        const hasGeneration = item.jobId === metaEntry.item.jobId
        assert.equal(item.presetId, hasGeneration ? 'sdxl-lightning' : null)
      }
      const ai = body.items.filter((item) => item.source === 'ai')
      assert.ok(ai.some((item) => item.jobId === 'j_out_meta'), '生成作品 source 应为 ai')

      const fromHistory = body.items.find((item) => item.jobId === firstPngEntry.item.jobId)
      assert.ok(fromHistory)
      assert.deepEqual(fromHistory, firstPngEntry.item, '导入响应 item 必须与 /history 条目同形')
      const metaFromHistory = body.items.find((item) => item.jobId === metaEntry.item.jobId)
      assert.equal(metaFromHistory.presetId, 'sdxl-lightning')
      assert.equal(metaFromHistory.params.seed, 123)
      assert.equal(jpegEntry.item.presetId, null)
    })

    await check('/history/tree：导入图作为独立根 v1，生成图同样可作根', async () => {
      const importedRoot = firstPngEntry.image.path
      const importedTree = await json(
        host.origin,
        `/imagen-api/history/tree?root=${encodeURIComponent(importedRoot)}&limit=10`,
      )
      assert.equal(importedTree.status, 200, JSON.stringify(importedTree.body))
      assert.equal(importedTree.body.root, importedRoot)
      assert.equal(importedTree.body.items.length, 1)
      assert.equal(importedTree.body.items[0].jobId, firstPngEntry.item.jobId)
      assert.equal(importedTree.body.items[0].source, 'import')
      assert.equal(importedTree.body.items[0].rootImage, null)

      const generatedRoot = generatedOutput.images[0].path
      const generatedTree = await json(
        host.origin,
        `/imagen-api/history/tree?root=${encodeURIComponent(generatedRoot)}&limit=10`,
      )
      assert.equal(generatedTree.status, 200, JSON.stringify(generatedTree.body))
      assert.equal(generatedTree.body.items[0].jobId, 'j_out_meta')
      assert.equal(generatedTree.body.items[0].source, 'ai')
    })

    await check('/imagen-api/file 提供导入图，非 POST 方法返回 405', async () => {
      const served = await fetch(new URL(firstPngEntry.image.url, host.origin))
      assert.equal(served.status, 200)
      assert.equal(served.headers.get('content-type'), 'image/png')
      assert.ok((await stat(firstPngEntry.image.absolute)).size > 0)

      const wrongMethod = await fetch(new URL('/imagen-api/import', host.origin))
      assert.equal(wrongMethod.status, 405)
    })
  } finally {
    await closeServer(host.server)
    fake.dispose()
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }

  summary()
}

try {
  await main()
} catch (error) {
  console.error(error?.stack ?? error)
  process.exitCode = 1
}
