#!/usr/bin/env node
/**
 * 展示页构建：把 site/src 变成可直接部署到 GitHub Pages 的 site/dist。
 *
 * 产物：
 *   index.html   内联模型/成片/版本数据，项目文案保持服务端可读
 *   styles.css   原样复制（只做存在性校验）
 *   app.js       site/src/app.js 及其 ES 模块依赖打包为单文件（含 GSAP）
 *   assets/**    仓库既有图片资产
 *
 * 构建期顺手做两件正确性检查：
 *   1. 中英文字典键集合必须完全一致；
 *   2. index.html 里 data-t / data-t-aria 引用的键必须在两份字典里都存在。
 *
 * 用法：
 *   node site/build.mjs            压缩产物（CI 使用）
 *   node site/build.mjs --pretty   不压缩，便于本地调试
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

const DOC_ASSETS = ['studio-light.png', 'chat-tool.png', 'model-picker-dark.png', 'gallery.png'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 只保留页面渲染需要的模型字段，避免把 pipeline 等内部配置带上网页。 */
function loadModels() {
  const modelsDir = path.join(rootDir, 'models');
  const files = fs.readdirSync(modelsDir).filter((file) => file.endsWith('.json'));
  return files
    .map((file) => {
      const model = readJson(path.join(modelsDir, file));
      return {
        id: model.id,
        order: model.order ?? 999,
        label: model.label,
        family: model.family,
        short: model.short,
        description: model.description,
        repo: model.repo,
        params: model.params,
        license: model.license,
        licenseKind: model.licenseKind,
        gpus: model.gpus,
        tier: model.tier,
        size: model.size,
        steps: model.steps,
        cfg: model.cfg,
        promptStyle: model.promptStyle,
        sizeOptions: model.sizeOptions,
        supportsImg2Img: Boolean(model.supportsImg2Img),
        supportsNegative: Boolean(model.supportsNegative),
        measured: {
          steadySeconds: model.measured?.steadySeconds ?? null,
          loadSeconds: model.measured?.loadSeconds ?? null,
          peakVramMb: model.measured?.peakVramMb ?? null,
          downloadGb: model.measured?.downloadGb ?? null,
        },
      };
    })
    .sort((a, b) => a.order - b.order);
}

function loadShowcase() {
  const manifestPath = path.join(rootDir, 'docs', 'assets', 'showcase', 'manifest.json');
  const manifest = readJson(manifestPath);
  const items = (manifest.items || []).map((item) => {
    const source = path.join(rootDir, 'docs', 'assets', 'showcase', item.file);
    if (!fs.existsSync(source)) {
      throw new Error(`缺少成片文件：${source}`);
    }
    return { ...item, src: `./assets/showcase/${item.file}` };
  });
  return { generatedAt: manifest.generatedAt, items };
}

function collectKeys(value, prefix = '') {
  const keys = new Set();
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(`${prefix}${key}`);
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of collectKeys(child, `${prefix}${key}.`)) keys.add(nested);
    }
  }
  return keys;
}

/**
 * 校验字典同构与静态文案引用。
 * 这两条以前靠人工检查（见 DESIGN.md），现在让构建直接失败。
 */
async function validateI18n(html) {
  const moduleUrl = pathToFileURL(path.join(srcDir, 'js', 'i18n.js')).href;
  const { I18N } = await import(moduleUrl);
  const zhKeys = collectKeys(I18N.zh);
  const enKeys = collectKeys(I18N.en);

  const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));
  const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key));
  if (missingInEn.length || missingInZh.length) {
    throw new Error(
      `中英文字典键不一致：\n  en 缺少 ${missingInEn.join(', ') || '—'}\n  zh 缺少 ${missingInZh.join(', ') || '—'}`
    );
  }

  const refs = new Set();
  for (const match of html.matchAll(/data-t(?:-aria)?="([^"]+)"/g)) refs.add(match[1]);
  const missingRefs = [...refs].filter((key) => typeof I18N.zh[key] !== 'string' || typeof I18N.en[key] !== 'string');
  if (missingRefs.length) {
    throw new Error(`index.html 引用了字典里不存在的键：${missingRefs.join(', ')}`);
  }

  return { keys: zhKeys.size, refs: refs.size };
}

async function bundleScript({ pretty }) {
  const result = await build({
    entryPoints: [path.join(srcDir, 'app.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'safari15', 'firefox102'],
    minify: !pretty,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: rootDir,
  });
  return result.outputFiles[0].text;
}

function copyAssets(showcase) {
  copyFile(path.join(rootDir, 'icon.svg'), path.join(distDir, 'assets', 'icon.svg'));

  for (const name of DOC_ASSETS) {
    const source = path.join(rootDir, 'docs', 'assets', name);
    if (fs.existsSync(source)) copyFile(source, path.join(distDir, 'assets', name));
  }

  const douyin = path.join(rootDir, 'docs', 'assets', 'social', 'douyin-lumen.webp');
  if (fs.existsSync(douyin)) copyFile(douyin, path.join(distDir, 'assets', 'social', 'douyin-lumen.webp'));

  for (const item of showcase.items) {
    copyFile(
      path.join(rootDir, 'docs', 'assets', 'showcase', item.file),
      path.join(distDir, 'assets', 'showcase', item.file)
    );
  }
}

async function main() {
  const pretty = process.argv.includes('--pretty');
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const models = loadModels();
  const showcase = loadShowcase();
  const htmlTemplate = readText(path.join(srcDir, 'index.html'));
  const i18n = await validateI18n(htmlTemplate);

  const siteData = {
    version: pkg.version,
    repo: 'nanxfu/dsh-our-imagen',
    repoUrl: 'https://github.com/nanxfu/dsh-our-imagen',
    releasesUrl: 'https://github.com/nanxfu/dsh-our-imagen/releases',
    issuesUrl: 'https://github.com/nanxfu/dsh-our-imagen/issues',
    dshUrl: 'https://github.com/deepseek-ai/DeepSeek-Harness',
    license: pkg.license || 'MIT',
    douyin: {
      name: 'Lumen流明',
      id: '42906749348',
      qr: './assets/social/douyin-lumen.webp',
    },
    models,
    showcase,
  };

  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);

  copyAssets(showcase);

  const safeJson = JSON.stringify(siteData).replace(/</g, '\\u003c');
  const html = htmlTemplate
    .replace('__SITE_DATA_JSON__', () => safeJson)
    .replace(/__VERSION__/g, () => pkg.version);
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

  copyFile(path.join(srcDir, 'styles.css'), path.join(distDir, 'styles.css'));

  const script = await bundleScript({ pretty });
  fs.writeFileSync(path.join(distDir, 'app.js'), script, 'utf8');

  console.log(
    `[site:build] dist 已生成（${models.length} 款模型 / ${showcase.items.length} 张成片 / v${pkg.version}）`
  );
  console.log(
    `[site:build] app.js ${formatKb(script.length)}${pretty ? '（未压缩）' : '（已压缩）'} · 字典 ${i18n.keys} 键 · 静态引用 ${i18n.refs} 处`
  );
}

main().catch((error) => {
  console.error(`[site:build] ${error.message}`);
  process.exitCode = 1;
});
