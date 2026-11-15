import { $ } from './dom.js';
import { applyDocumentTitle, applyTranslations, t } from './i18n.js';
import { applyMotionMode, refreshMotion } from './motion.js';
import {
  applyTheme,
  initPreferences,
  syncLanguageAttributes,
  syncLanguageButtons,
} from './prefs.js';
import { isMotionEnabled, state } from './state.js';
import { bindChoiceGroup, bindCopyDelegation, copyText, syncToggleState } from './ui.js';
import { initFlow } from './flow.js';
import { initHero } from './hero.js';
import { initInstall } from './install.js';
import { initLab } from './lab.js';
import { initLightbox } from './lightbox.js';
import { initScrollEffects } from './scrollfx.js';
import { initWall } from './wall.js';
import { initWorkflow } from './workflow.js';

/**
 * 启动顺序：偏好 → 静态文案 → 各区块渲染 → 动效层。
 * 动效必须最后挂：ScrollTrigger 需要真实布局高度，成片墙的高度由 JS 先算好。
 */
export function boot() {
  if (!document.getElementById('site-data')) return;

  initPreferences();
  applyTheme(state.theme, { persist: false });
  syncLanguageAttributes();
  applyTranslations();
  applyDocumentTitle();
  syncLanguageButtons();

  const api = { copyText };
  const hero = initHero({ api });
  const wall = initWall({ api });
  const lab = initLab({ api });
  const workflow = initWorkflow();
  const lightbox = initLightbox({
    onToggle: (open) => hero.setPaused('lightbox', open),
  });
  api.openLightbox = (file, source) => lightbox.open(file, source);

  // 动效装置按文档顺序注册：ScrollTrigger 的钉屏留白会改变其后元素的位置，
  // 先注册的装置必须先于文档里更靠后的装置，否则后者的锚点会算在留白之前。
  initFlow();
  initInstall();
  initScrollEffects();

  bindGlobalEvents({ hero, wall, lab, workflow, lightbox });
  applyMotionMode();

  // 字体与图片落定后重新量一次滚动位置；失败也不影响首屏。
  document.fonts?.ready.then(() => refreshMotion()).catch(() => {});
  window.addEventListener('load', () => refreshMotion(), { once: true });
}

function changeLanguage(lang, { hero, wall, lab, workflow, lightbox }) {
  const next = lang === 'en' ? 'en' : 'zh';
  if (next === state.lang) return;
  state.lang = next;

  syncLanguageAttributes();
  syncLanguageButtons();
  applyDocumentTitle();
  applyTranslations();
  hero.render(false);
  wall.refreshLabels();
  lab.applyLanguage();
  workflow.applyLanguage();
  lightbox.refresh();
  syncToggleState('motion-toggle', isMotionEnabled(), t(isMotionEnabled() ? 'motionOn' : 'motionOff'));
  refreshMotion();
}

function bindGlobalEvents({ hero, wall, lab, workflow, lightbox }) {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('motion-toggle')?.addEventListener('click', () => {
    state.motionMode = isMotionEnabled() ? 'off' : 'on';
    applyMotionMode({ persist: true });
  });

  document.getElementById('motion-enable')?.addEventListener('click', () => {
    state.motionMode = 'on';
    applyMotionMode({ persist: true });
  });

  bindChoiceGroup($('.seg-lang'), {
    attr: 'lang',
    onChange: (value) => changeLanguage(value, { hero, wall, lab, workflow, lightbox }),
  });

  const filterGroup = bindChoiceGroup($('#model-filter'), {
    attr: 'filter',
    onChange: (value) => lab.setFilter(value),
  });
  filterGroup.sync(state.filter);

  bindCopyDelegation();
}
