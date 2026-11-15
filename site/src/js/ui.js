import { $$ } from './dom.js';
import { t } from './i18n.js';

let toastTimer = null;

/** 屏幕底部的轻量状态提示；文案由调用方传入（已翻译）。 */
export function showToast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2000);
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文或权限被拒时退回旧接口；两条路径都失败才算失败。
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export async function copyText(text) {
  const ok = await writeClipboard(text);
  showToast(t(ok ? 'copied' : 'copyFailed'));
}

/**
 * 单选按钮组：一个 root 内一组 [data-<attr>] 按钮。
 * 只负责 active 样式与 aria-pressed 同步，业务状态由 onChange 决定。
 */
export function bindChoiceGroup(root, { attr, onChange }) {
  if (!root) return { sync() {} };
  const buttons = $$(`[data-${attr}]`, root);
  const sync = (value) => {
    for (const button of buttons) {
      const active = button.dataset[attr] === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const value = button.dataset[attr];
      // 选中样式必须由这里同步：调用方的 onChange 只改业务状态，
      // 不保证每次点击都回头调用 sync（此前筛选/安装/Profile 组因此不跟随点击）。
      sync(value);
      onChange(value);
    });
  }
  return { sync, buttons };
}

/** 复制按钮统一走事件委托：动态改过 data-copy 的按钮也生效。 */
export function bindCopyDelegation() {
  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
    if (!trigger) return;
    const value = trigger.dataset.copy;
    if (value) copyText(value);
  });
}

/** 页面唯一一个主题/动效开关的按钮状态同步。 */
export function syncToggleState(id, pressed, label) {
  const button = document.getElementById(id);
  if (!button) return;
  button.setAttribute('aria-pressed', String(pressed));
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}
