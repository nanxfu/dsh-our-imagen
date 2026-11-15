import { state } from './state.js';

const THEME_KEY = 'imagen-site-theme';
const MOTION_KEY = 'imagen-site-motion';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式或存储被禁用时静默降级为「本页有效」。
  }
}

/**
 * 读取 URL 参数与 localStorage，把主题 / 语言 / 动效三项偏好写进 state。
 * URL 参数优先，便于截图与外部链接固定表现。
 */
export function initPreferences() {
  const params = new URLSearchParams(window.location.search);

  const paramTheme = params.get('theme');
  const savedTheme = readStorage(THEME_KEY);
  state.theme =
    paramTheme === 'light' || paramTheme === 'dark'
      ? paramTheme
      : savedTheme === 'light' || savedTheme === 'dark'
        ? savedTheme
        : 'dark';

  const paramLang = params.get('lang');
  if (paramLang === 'en' || paramLang === 'zh') state.lang = paramLang;

  const paramMotion = params.get('motion');
  const savedMotion = readStorage(MOTION_KEY);
  state.motionMode =
    paramMotion === 'on' || paramMotion === '1'
      ? 'on'
      : paramMotion === 'off' || paramMotion === '0'
        ? 'off'
        : savedMotion === 'on' || savedMotion === 'off'
          ? savedMotion
          : 'on';
}

/** 主题只影响 CSS 变量与浏览器 UI 色，不触发布局重算。 */
export function applyTheme(theme, { persist = true } = {}) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0a0a0b' : '#efece5');
  if (persist) writeStorage(THEME_KEY, state.theme);
}

export function persistMotionMode() {
  writeStorage(MOTION_KEY, state.motionMode);
}

export function syncLanguageAttributes() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
}

export function syncLanguageButtons(root = document) {
  root.querySelectorAll('[data-lang]').forEach((button) => {
    const active = button.dataset.lang === state.lang;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
