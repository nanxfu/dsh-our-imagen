#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function loadModels() {
  const modelsDir = path.join(rootDir, 'models');
  const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.json'));
  return files
    .map((file) => {
      const m = readJson(path.join(modelsDir, file));
      return {
        id: m.id,
        order: m.order ?? 999,
        label: m.label,
        family: m.family,
        short: m.short,
        description: m.description,
        repo: m.repo,
        params: m.params,
        license: m.license,
        licenseKind: m.licenseKind,
        gpus: m.gpus,
        tier: m.tier,
        size: m.size,
        steps: m.steps,
        cfg: m.cfg,
        promptStyle: m.promptStyle,
        sizeOptions: m.sizeOptions,
        supportsImg2Img: Boolean(m.supportsImg2Img),
        supportsNegative: Boolean(m.supportsNegative),
        measured: {
          steadySeconds: m.measured?.steadySeconds ?? null,
          loadSeconds: m.measured?.loadSeconds ?? null,
          peakVramMb: m.measured?.peakVramMb ?? null,
          downloadGb: m.measured?.downloadGb ?? null,
        },
      };
    })
    .sort((a, b) => a.order - b.order);
}

function loadShowcase() {
  const manifestPath = path.join(rootDir, 'docs', 'assets', 'showcase', 'manifest.json');
  const manifest = readJson(manifestPath);
  const items = (manifest.items || []).map((item) => {
    const srcFile = path.join(rootDir, 'docs', 'assets', 'showcase', item.file);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Missing showcase file: ${srcFile}`);
    }
    return {
      ...item,
      src: `./assets/showcase/${item.file}`,
    };
  });
  return {
    generatedAt: manifest.generatedAt,
    items,
  };
}

function main() {
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const models = loadModels();
  const showcase = loadShowcase();

  // Clean and recreate dist
  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);

  // Copy static assets
  copyFile(path.join(rootDir, 'icon.svg'), path.join(distDir, 'assets', 'icon.svg'));

  const docAssets = ['studio-light.png', 'chat-tool.png', 'model-picker-dark.png', 'gallery.png'];
  for (const name of docAssets) {
    const src = path.join(rootDir, 'docs', 'assets', name);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(distDir, 'assets', name));
    }
  }

  const douyinSrc = path.join(rootDir, 'docs', 'assets', 'social', 'douyin-lumen.webp');
  if (fs.existsSync(douyinSrc)) {
    copyFile(douyinSrc, path.join(distDir, 'assets', 'social', 'douyin-lumen.webp'));
  }

  for (const item of showcase.items) {
    copyFile(
      path.join(rootDir, 'docs', 'assets', 'showcase', item.file),
      path.join(distDir, 'assets', 'showcase', item.file)
    );
  }

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

  // Build HTML with embedded JSON data
  const htmlTemplate = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
  const safeJson = JSON.stringify(siteData).replace(/</g, '\\u003c');
  const htmlOut = htmlTemplate
    .replace('__SITE_DATA_JSON__', safeJson)
    .replace(/__VERSION__/g, pkg.version);

  fs.writeFileSync(path.join(distDir, 'index.html'), htmlOut, 'utf8');
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');
  copyFile(path.join(srcDir, 'styles.css'), path.join(distDir, 'styles.css'));
  copyFile(path.join(srcDir, 'app.js'), path.join(distDir, 'app.js'));

  console.log(
    `[site:build] Built site/dist (${models.length} models, ${showcase.items.length} showcase images, v${pkg.version})`
  );
}

main();
