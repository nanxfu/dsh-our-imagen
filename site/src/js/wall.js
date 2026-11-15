import { MEDIA, ScrollTrigger, gsap, isLiteDevice, refreshMotion, registerMotionSetup } from './motion.js';
import { $, $$, h, rafThrottle } from './dom.js';
import { models, finePointer, showcaseItems } from './data.js';
import { fill, itemTitle, t } from './i18n.js';
import { isMotionEnabled } from './state.js';

const COLUMN_MAX = { 4: 1180, 3: 860 };

function columnCount(width) {
  if (width <= COLUMN_MAX[3]) return 2;
  if (width <= COLUMN_MAX[4]) return 3;
  return 4;
}

/**
 * 成片墙：绝对定位瀑布流 + 进入视口显影 + 安全灯局部显色。
 *
 * 行高按每张图的原生画幅预先分配，不依赖浏览器多列分栏，
 * 避免分栏抖动与跨列断裂；列数变化时整体重排一次。
 */
export function initWall({ api }) {
  const el = {
    wall: $('#wall'),
    items: $('#wall-items'),
    count: $('#wall-count'),
    barFill: $('#wall-bar-fill'),
    developed: $('#wall-developed'),
    total: $('#wall-total'),
  };

  let lastWidth = 0;
  let layoutQueued = false;

  const pad2 = (value) => String(value).padStart(2, '0');

  /** 显影计数条：只统计已经过 ScrollTrigger 的成片，是墙面进度的真实读数。 */
  function syncDeveloped() {
    if (!el.developed || !el.items) return;
    el.developed.textContent = pad2(el.items.querySelectorAll('.print.is-developed').length);
  }

  function buildItem(item, index) {
    const color = h('img', {
      class: 'print-color',
      dataset: { printFile: item.file },
      props: {
        src: item.src,
        alt: `${item.modelLabel} · ${itemTitle(item)}`,
        width: item.width,
        height: item.height,
        loading: index < 4 ? 'eager' : 'lazy',
        decoding: 'async',
      },
    });
    // 银盐副本与颜色层同源（共享解码缓存），只在细指针设备上参与渲染。
    const mono = h('img', {
      class: 'print-mono',
      attrs: { 'aria-hidden': 'true' },
      props: {
        src: item.src,
        alt: '',
        loading: index < 4 ? 'eager' : 'lazy',
        decoding: 'async',
      },
    });
    const frame = h('span', { class: 'print-img' }, color, mono);
    const meta = h(
      'span',
      { class: 'print-meta' },
      h('strong', { text: item.modelLabel }),
      h('span', { class: 'print-nums tabular', text: `${item.seconds}s` })
    );

    return h(
      'button',
      {
        class: 'print',
        props: { type: 'button' },
        dataset: {
          file: item.file,
          index: String(index),
          w: String(item.width),
          h: String(item.height),
        },
        attrs: { 'aria-label': fill(t('wallPrintAria'), { title: itemTitle(item) }) },
        on: { click: () => api.openLightbox(item.file, color) },
      },
      frame,
      meta
    );
  }

  function updateCount() {
    if (el.total) el.total.textContent = pad2(showcaseItems.length);
    if (!el.count) return;
    el.count.textContent = fill(t('wallCountTpl'), {
      frames: showcaseItems.length,
      models: models.length,
    });
  }

  /**
   * 瀑布流重排：先读一次列宽与题注高度，再批量写入位置，避免逐项强制回流。
   */
  function layout() {
    const wrap = el.items;
    if (!wrap) return;
    const items = $$('.print', wrap);
    const width = wrap.clientWidth;
    if (!items.length || !width) return;

    const gap = parseFloat(getComputedStyle(wrap).columnGap) || 20;
    const columns = columnCount(width);
    const columnWidth = (width - gap * (columns - 1)) / columns;
    const metaHeight = items[0].querySelector('.print-meta')?.offsetHeight ?? 16;
    const heights = new Array(columns).fill(0);
    const placements = [];

    for (const node of items) {
      const ratio = (Number(node.dataset.h) || 1) / (Number(node.dataset.w) || 1);
      const height = columnWidth * ratio + metaHeight + 10;
      let column = 0;
      for (let i = 1; i < columns; i += 1) {
        if (heights[i] < heights[column]) column = i;
      }
      placements.push({ node, left: column * (columnWidth + gap), top: heights[column] });
      heights[column] += height + gap;
    }

    for (const { node, left, top } of placements) {
      node.style.width = `${columnWidth}px`;
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
    }
    wrap.style.height = `${Math.max(0, Math.max(...heights) - gap)}px`;
    lastWidth = width;
  }

  const queueLayout = rafThrottle(() => {
    layout();
    refreshMotion();
  });

  function render() {
    const wrap = el.items;
    if (!wrap) return;
    wrap.innerHTML = '';
    const fragment = document.createDocumentFragment();
    showcaseItems.forEach((item, index) => fragment.append(buildItem(item, index)));
    wrap.append(fragment);
    updateCount();
    syncDeveloped();
    layout();
  }

  /** 语言切换只改文案，不重建 DOM：显影触发器与 FLIP 源元素都挂在原节点上。 */
  function refreshLabels() {
    const wrap = el.items;
    if (!wrap) return;
    $$('.print', wrap).forEach((button) => {
      const item = showcaseItems[Number(button.dataset.index)];
      if (!item) return;
      button.setAttribute('aria-label', fill(t('wallPrintAria'), { title: itemTitle(item) }));
      const color = button.querySelector('.print-color');
      if (color) color.alt = `${item.modelLabel} · ${itemTitle(item)}`;
    });
    updateCount();
    layout();
    refreshMotion();
  }

  function setupDevelop() {
    registerMotionSetup((mm) => {
      mm.add('(min-width: 0px)', () => {
        const triggers = ScrollTrigger.batch('.print', {
          start: 'top 93%',
          interval: 0.08,
          onEnter: (batch) => {
            batch.forEach((node, order) => {
              if (node.classList.contains('is-developed')) return;
              if (isLiteDevice() || !isMotionEnabled()) {
                node.classList.add('is-developed');
                syncDeveloped();
                return;
              }
              // 错峰显影上限 320ms，和 DESIGN.md 的节奏声明保持一致。
              window.setTimeout(() => {
                node.classList.add('is-developed');
                syncDeveloped();
              }, Math.min(order * 70, 320));
            });
          },
        });
        return () => triggers.forEach((trigger) => trigger.kill());
      });
    });
  }

  /** 计数条上的细进度线与墙面滚动同步：读到哪里，线画到哪里。 */
  function setupProgress() {
    registerMotionSetup((mm) => {
      mm.add('(min-width: 0px)', () => {
        if (!el.barFill) return undefined;
        const tween = gsap.fromTo(
          el.barFill,
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: '.wall',
              start: 'top bottom',
              end: 'bottom bottom',
              scrub: 0.5,
              invalidateOnRefresh: true,
            },
          }
        );
        return () => {
          tween.scrollTrigger?.kill();
          tween.kill();
        };
      });
    });
  }

  /** 墙面光扫：跟随墙面穿过视口的进度，从顶部移到成片墙末尾。 */
  function setupSweep() {
    registerMotionSetup((mm) => {
      mm.add({ lite: MEDIA.lite }, (context) => {
        if (context.conditions.lite) return undefined;
        const sweep = $('.wall-sweep');
        if (!sweep) return undefined;
        const tween = gsap.fromTo(
          sweep,
          { yPercent: 0 },
          {
            yPercent: 115,
            ease: 'none',
            scrollTrigger: {
              trigger: '.wall',
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
          }
        );
        return () => {
          tween.scrollTrigger?.kill();
          tween.kill();
        };
      });
    });
  }

  function setupSafelight() {
    if (!finePointer || !el.items) return;
    el.items.addEventListener(
      'pointermove',
      (event) => {
        if (!isMotionEnabled()) return;
        const target = event.target instanceof Element ? event.target.closest('.print') : null;
        if (!target || !el.items.contains(target)) return;
        const frame = target.querySelector('.print-img');
        const mono = target.querySelector('.print-mono');
        if (!frame || !mono) return;
        const rect = frame.getBoundingClientRect();
        mono.style.setProperty('--lx', `${Math.round(event.clientX - rect.left)}px`);
        mono.style.setProperty('--ly', `${Math.round(event.clientY - rect.top)}px`);
      },
      { passive: true }
    );
  }

  function bindResize() {
    const wrap = el.items;
    if (!wrap) return;
    window.addEventListener('resize', queueLayout, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        if (wrap.clientWidth === lastWidth) return;
        queueLayout();
      }).observe(wrap);
    }
  }

  render();
  setupDevelop();
  setupProgress();
  setupSweep();
  setupSafelight();
  bindResize();

  return { refreshLabels };
}
