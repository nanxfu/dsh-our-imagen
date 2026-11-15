import { $, $$, h } from './dom.js';
import { WORKFLOW_SHOTS } from './data.js';
import { I18N } from './i18n.js';
import { fxTween, MEDIA, gsap, registerMotionSetup } from './motion.js';
import { isMotionEnabled, state } from './state.js';
import { bindChoiceGroup } from './ui.js';

/**
 * 每一幕的取景：换哪张界面截图、安全灯放大镜停在哪（截图百分比坐标）、放大倍率。
 * 工作台三幕与对话三幕共用同一套时间线；模式切换只换取景，不重建滚动结构。
 */
const ACTS = {
  studio: [
    { shot: 'studio-light', spot: [14.5, 36], zoom: 1.45 },
    { shot: 'model-picker-dark', spot: [84, 30], zoom: 1.5 },
    { shot: 'gallery', spot: [48, 34], zoom: 1.45 },
  ],
  chat: [
    { shot: 'chat', spot: [17.5, 28], zoom: 1.45 },
    { shot: 'chat', spot: [15, 43], zoom: 1.45 },
    { shot: 'chat', spot: [42, 85], zoom: 1.45 },
  ],
};

const PIN_VH = 2.2;
const ACTS_TOTAL = 3;
const ACT_JUMP_PROGRESS = [0.12, 0.5, 0.88];
const pad2 = (value) => String(value).padStart(2, '0');

/**
 * 两种用法：桌面端把「光桌 + 说明」钉住约 2.2 屏，安全灯放大镜依次停在
 * 参数面板、模型选择、历史画廊（对话模式则是提示词、确认卡、缩略图栏）上；
 * 放大镜外的截图退回银盐。窄屏或关动效时退回普通图文块，截图仍然可切换。
 */
export function initWorkflow() {
  const el = {
    body: $('#workflow-body'),
    shot: $('#wf-shot'),
    plate: $('#wf-plate'),
    image: $('#wf-shot-img'),
    loupe: $('#wf-loupe'),
    loupeImg: $('#wf-loupe-img'),
    progress: $('#wf-progress'),
    windowTitle: $('#wf-window-title'),
    tabs: $('#workflow-tabs'),
    subSwitch: $('#wf-sub-switch'),
    sideTitle: $('#wf-side-title'),
    points: $('#wf-points'),
    note: $('#wf-note'),
    copy: $('.wf-copy'),
  };

  let tabs = null;
  let shots = null;
  let timeline = null;
  let actIndex = 0;
  let pinned = false;
  let preloaded = false;

  const mode = () => (state.wfMode === 'chat' ? 'chat' : 'studio');
  const acts = () => ACTS[mode()];

  function windowTitleAt(index) {
    const data = I18N[state.lang].wfData[mode()];
    if (Array.isArray(data.windowTitles)) return data.windowTitles[index] || data.windowTitles[0];
    return data.windowTitle || '—';
  }

  function measurePlate() {
    if (!el.plate) return;
    const box = el.plate.getBoundingClientRect();
    if (box.width < 1) return;
    el.plate.style.setProperty('--plate-w', `${box.width}px`);
    el.plate.style.setProperty('--plate-h', `${box.height}px`);
  }

  function setSpot(act, { immediate = false } = {}) {
    if (!el.plate) return;
    const vars = { '--sx': act.spot[0], '--sy': act.spot[1], '--loupe-zoom': act.zoom };
    if (immediate || !isMotionEnabled()) gsap.set(el.plate, vars);
    else gsap.to(el.plate, { ...vars, duration: 0.5, ease: 'power2.inOut', overwrite: 'auto' });
  }

  /**
   * 换截图。钉住时整块光桌会被压暗，这里只做一次短促的「快门」过渡，
   * 避免硬切；动效关闭时直接换源。
   */
  function switchShot(shotKey, { immediate = false } = {}) {
    if (!el.image || el.image.dataset.shot === shotKey) return;
    const src = WORKFLOW_SHOTS[shotKey];
    if (!src) return;
    el.image.dataset.shot = shotKey;
    const apply = () => {
      el.image.src = src;
      if (el.loupeImg) el.loupeImg.src = src;
    };
    if (immediate || !isMotionEnabled()) {
      apply();
      return;
    }
    fxTween(() =>
      gsap
        .timeline()
        .to(el.plate, { opacity: 0.55, duration: 0.15, ease: 'power1.in' })
        .call(apply)
        .to(el.plate, { opacity: 1, duration: 0.32, ease: 'power2.out', clearProps: 'opacity' })
    );
  }

  function syncPoints(index) {
    $$('li', el.points).forEach((node, order) => node.classList.toggle('is-active', order === index));
  }

  function syncChips(index) {
    const labels = I18N[state.lang].wfData[mode()].chips || [];
    shots?.buttons?.forEach((button, order) => {
      if (labels[order]) button.textContent = labels[order];
    });
    shots?.sync(String(index));
  }

  function applyAct(index, { immediate = false, updateSpot = true } = {}) {
    const list = acts();
    const next = Math.max(0, Math.min(list.length - 1, index));
    actIndex = next;
    const act = list[next];
    switchShot(act.shot, { immediate });
    // 钉屏期间由时间线 scrub 独占控制放大镜坐标，避免换幕瞬间被 gsap.set 覆盖打断。
    if (updateSpot && !pinned) setSpot(act, { immediate });
    if (el.windowTitle) el.windowTitle.textContent = windowTitleAt(next);
    if (el.progress) el.progress.textContent = `${pad2(next + 1)} / ${pad2(list.length)}`;
    syncPoints(next);
    shots?.sync(String(next));
  }

  /** 滚动到某一幕：只要桌面端时间线已就绪就滑到对应进度，避免未钉屏时假切换又回弹。 */
  function jumpToAct(index) {
    const next = Math.max(0, Math.min(ACTS_TOTAL - 1, Number(index) || 0));
    const trigger = timeline?.scrollTrigger;
    if (trigger && isMotionEnabled()) {
      const target = trigger.start + ACT_JUMP_PROGRESS[next] * (trigger.end - trigger.start);
      window.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }
    applyAct(next);
  }

  function render() {
    const data = I18N[state.lang].wfData[mode()];
    tabs?.sync(mode());
    const studioMode = mode() === 'studio';
    if (el.sideTitle) el.sideTitle.textContent = data.title;
    if (el.points) {
      el.points.innerHTML = '';
      const fragment = document.createDocumentFragment();
      for (const point of data.points) fragment.append(h('li', { text: point }));
      el.points.append(fragment);
    }
    if (el.note) el.note.textContent = data.note;
    if (el.image) {
      const label = windowTitleAt(actIndex);
      el.image.alt = `${label}${studioMode ? ' · 生图工作台界面截图' : ' · 对话工具确认卡片截图'}`;
    }
    syncChips(actIndex);
    applyAct(actIndex, { immediate: true });
    if (timeline) {
      const p = timeline.progress();
      timeline.invalidate();
      if (pinned) timeline.progress(p === 0 ? 1 : 0).progress(p);
    }
  }

  /* ── 桌面粘性叙事 ──────────────────────────────────────── */

  function setupPin() {
    registerMotionSetup((mm) => {
      mm.add(MEDIA.desktop, () => {
        if (!el.body || !el.plate) return undefined;

        measurePlate();
        timeline = gsap.timeline({
          scrollTrigger: {
            trigger: el.body,
            start: 'top 84px',
            end: () => `+=${Math.round(window.innerHeight * PIN_VH)}`,
            pin: el.body,
            pinSpacing: true,
            scrub: 0.55,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onToggle: (self) => {
              pinned = self.isActive;
              el.shot?.classList.toggle('is-armed', pinned);
              el.copy?.classList.toggle('is-armed', pinned);
              if (pinned) {
                preloadShots();
                measurePlate();
                if (timeline) syncFromProgress(timeline.progress());
              }
            },
            onRefresh: () => {
              measurePlate();
              if (timeline) syncFromProgress(timeline.progress());
            },
          },
          onUpdate: () => syncFromProgress(timeline.progress()),
        });

        // 三幕：每幕停留 0.68，然后用 0.32 把放大镜移到下一幕的落点。
        const moveTo = (index) => ({
          '--sx': () => acts()[index].spot[0],
          '--sy': () => acts()[index].spot[1],
          '--loupe-zoom': () => acts()[index].zoom,
        });
        timeline.set(el.plate, moveTo(0), 0);
        timeline.to({}, { duration: 0.68 }, 0);
        timeline.to(el.plate, { ...moveTo(1), duration: 0.32, ease: 'power2.inOut' }, 0.68);
        timeline.to({}, { duration: 0.68 }, 1);
        timeline.to(el.plate, { ...moveTo(2), duration: 0.32, ease: 'power2.inOut' }, 1.68);
        timeline.to({}, { duration: 0.32 }, 2);

        return () => {
          pinned = false;
          timeline = null;
          el.shot?.classList.remove('is-armed');
          el.copy?.classList.remove('is-armed');
          el.plate?.style.removeProperty('--plate-w');
          el.plate?.style.removeProperty('--plate-h');
        };
      });
    });
  }

  function syncFromProgress(progress) {
    const time = Math.max(0, Math.min(ACTS_TOTAL, progress * ACTS_TOTAL));
    // 落点在每一幕的整点；提前 0.04 幕切换，让换图与放大镜到站同时发生。
    const index = Math.max(0, Math.min(ACTS_TOTAL - 1, Math.floor(time + 0.04)));
    if (index !== actIndex) applyAct(index, { immediate: true, updateSpot: false });
  }

  /* ── 初始化 ────────────────────────────────────────────── */

  /** 四张界面截图在整页体积里不算小，进入附近视口再预载，首屏不替它们付费。 */
  function preloadShots() {
    if (preloaded) return;
    preloaded = true;
    for (const src of Object.values(WORKFLOW_SHOTS)) {
      if (!src) continue;
      new Image().src = src;
    }
  }

  function watchPreload() {
    if (!el.body) return;
    if (!('IntersectionObserver' in window)) {
      preloadShots();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        preloadShots();
        observer.disconnect();
      },
      { rootMargin: '900px' }
    );
    observer.observe(el.body);
  }

  if ('ResizeObserver' in window && el.plate) {
    new ResizeObserver(() => measurePlate()).observe(el.plate);
  }

  tabs = bindChoiceGroup(el.tabs, {
    attr: 'wf',
    onChange: (value) => {
      state.wfMode = value;
      if (!pinned) actIndex = 0;
      preloadShots();
      render();
    },
  });
  shots = bindChoiceGroup(el.subSwitch, {
    attr: 'act',
    onChange: (value) => jumpToAct(value),
  });

  watchPreload();
  render();
  setupPin();

  return { render, applyLanguage: render };
}
