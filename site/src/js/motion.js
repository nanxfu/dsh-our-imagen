import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';

import { t } from './i18n.js';
import { persistMotionMode } from './prefs.js';
import { isMotionEnabled } from './state.js';
import { syncToggleState } from './ui.js';

gsap.registerPlugin(ScrollTrigger, Flip);
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger, Flip };

/** 站点用到的断点；和 CSS 媒体查询保持同一套阈值。 */
export const MEDIA = {
  desktop: '(min-width: 981px)',
  lite: '(max-width: 780px), (pointer: coarse)',
};

/**
 * 动效总开关的单一实现：
 * - 开启时创建一个 gsap.matchMedia()，各模块把自己的滚动/粘性时间线注册进来；
 * - 关闭时整体 revert（撤销 inline 样式并移除 ScrollTrigger），CSS 侧兜底显示完整内容。
 */
const setups = [];
const listeners = new Set();
let media = null;
let fxContext = null;
let refreshFrame = 0;

export function isLiteDevice() {
  return window.matchMedia(MEDIA.lite).matches;
}

/** 模块在初始化时登记自己的动效构建函数；开关打开时逐个执行。 */
export function registerMotionSetup(setup) {
  setups.push(setup);
}

/** 订阅开关变化（轮播启停等非 ScrollTrigger 副作用）。 */
export function onMotionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyMotionMode({ persist = false } = {}) {
  const enabled = isMotionEnabled();
  document.documentElement.setAttribute('data-motion', enabled ? 'on' : 'off');
  if (persist) persistMotionMode();

  syncToggleState('motion-toggle', enabled, t(enabled ? 'motionOn' : 'motionOff'));
  const notice = document.getElementById('motion-notice');
  if (notice) notice.hidden = enabled;

  if (enabled) activate();
  else deactivate();

  for (const listener of listeners) listener(enabled);
}

function activate() {
  if (media) return;
  media = gsap.matchMedia();
  for (const setup of setups) setup(media);
  refreshMotion();
}

function deactivate() {
  // 先撤掉一次性动画，再撤滚动时间线：两套都由 context 记录 inline 样式。
  if (fxContext) {
    fxContext.revert();
    fxContext = null;
  }
  if (media) {
    media.revert();
    media = null;
  }
}

/**
 * 运行一段受动效开关管理的临时动画（显影、灯箱 FLIP、截图切换…）。
 * 开关关闭时整体 revert，不会残留半截 inline 样式。
 */
export function fxTween(builder) {
  if (!isMotionEnabled()) return null;
  if (!fxContext) fxContext = gsap.context(() => {});
  let result = null;
  fxContext.add(() => {
    result = builder();
  });
  return result;
}

/** 布局或语言变化后重算 ScrollTrigger 位置，同一帧只刷一次。 */
export function refreshMotion() {
  if (!media || refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    ScrollTrigger.refresh();
  });
}

/** 页面加载时的一次性入场时间线：同样挂在动效开关下。 */
export function playIntroTween(builder, delay = 0) {
  return fxTween(() => {
    const timeline = gsap.timeline({ delay, defaults: { ease: 'power3.out' } });
    builder(timeline);
    return timeline;
  });
}
