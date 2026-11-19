/**
 * 构建期内联进 index.html 的站点数据。
 * 资源清单（模型、成片、版本号）由 site/build.mjs 生成，运行时零请求。
 */
const dataEl = document.getElementById('site-data');

const SITE_DATA = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};

export const models = Array.isArray(SITE_DATA.models) ? SITE_DATA.models : [];

export const showcaseItems = Array.isArray(SITE_DATA.showcase?.items) ? SITE_DATA.showcase.items : [];

/** Hero 轮播优先使用的四张成片；缺失时退回成片墙前四张。取四种不同气质：海报、街景、写实对照、二次元。 */
const HERO_PICKS = [
  'flux2-klein-4b-kyoto-poster.webp',
  'sdxl-lightning-cyberpunk-street.webp',
  'qwen-image-2.1-crane-pond.webp',
  'anima-turbo-v1.1-crane-pond.webp',
];

export const heroItems = HERO_PICKS.map((file) => showcaseItems.find((item) => item.file === file)).filter(
  Boolean
);

if (heroItems.length === 0 && showcaseItems.length > 0) {
  heroItems.push(...showcaseItems.slice(0, 4));
}

export const WORKFLOW_SHOTS = {
  'studio-light': './assets/studio-light.png',
  'model-picker-dark': './assets/model-picker-dark.png',
  gallery: './assets/gallery.png',
  chat: './assets/chat-tool.png',
};

/** 模型暗房速度刻度按对数映射，上限随实测最慢模型浮动。 */
export const maxSteady = Math.max(...models.map((model) => model.measured?.steadySeconds || 1), 1);

export const finePointer = window.matchMedia('(pointer: fine)').matches;
