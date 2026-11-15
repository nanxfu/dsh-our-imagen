import { $, h } from './dom.js';
import { WORKFLOW_SHOTS } from './data.js';
import { I18N } from './i18n.js';
import { swapImage } from './effects.js';
import { state } from './state.js';
import { bindChoiceGroup } from './ui.js';

/**
 * 两种用法：模式切换（工作台 / 对话）与工作台截图切换。
 * 截图用短交叉淡化，不做「显影」——界面截图不是成片，材质不该混用。
 */
export function initWorkflow() {
  const el = {
    tabs: $('#workflow-tabs'),
    subSwitch: $('#wf-sub-switch'),
    image: $('#wf-shot-img'),
    windowTitle: $('#wf-window-title'),
    sideTitle: $('#wf-side-title'),
    points: $('#wf-points'),
    note: $('#wf-note'),
  };

  let tabs = null;
  let shots = null;

  function render() {
    const content = I18N[state.lang].wfData[state.wfMode];

    tabs?.sync(state.wfMode);
    el.subSwitch?.classList.toggle('is-hidden', state.wfMode !== 'studio');
    shots?.sync(state.wfStudioShot);

    const shotKey = state.wfMode === 'studio' ? state.wfStudioShot : 'chat';
    swapImage(el.image, WORKFLOW_SHOTS[shotKey], content.title);

    if (el.windowTitle) el.windowTitle.textContent = content.windowTitle;
    if (el.sideTitle) el.sideTitle.textContent = content.title;

    if (el.points) {
      el.points.innerHTML = '';
      const fragment = document.createDocumentFragment();
      for (const point of content.points) fragment.append(h('li', { text: point }));
      el.points.append(fragment);
    }
    if (el.note) el.note.textContent = content.note;
  }

  tabs = bindChoiceGroup(el.tabs, {
    attr: 'wf',
    onChange: (value) => {
      state.wfMode = value;
      render();
    },
  });
  shots = bindChoiceGroup(el.subSwitch, {
    attr: 'shot',
    onChange: (value) => {
      state.wfStudioShot = value;
      render();
    },
  });

  render();

  return { render, applyLanguage: render };
}
