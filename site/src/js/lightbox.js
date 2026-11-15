import { $, $$ } from './dom.js';
import { showcaseItems } from './data.js';
import { itemTitle } from './i18n.js';
import { Flip, fxTween, gsap } from './motion.js';
import { isMotionEnabled, state } from './state.js';

const PAGE_REGIONS = ['header.chrome', 'main', 'footer.footer'];

function setPageInert(inert) {
  for (const selector of PAGE_REGIONS) {
    const region = document.querySelector(selector);
    if (!region) continue;
    if (inert) region.setAttribute('inert', '');
    else region.removeAttribute('inert');
  }
}

function focusablesInside(root) {
  return $$('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])', root).filter(
    (node) => node.offsetParent !== null || node === document.activeElement
  );
}

/**
 * 灯箱：把成片墙/主相纸里的那张图 FLIP 放大到屏幕中央，关闭时再放回去。
 * 用 data-print-file 找到「同一张图」的源元素，翻页后同样能回到正确的相纸。
 */
export function initLightbox({ onToggle }) {
  const el = {
    root: $('#lightbox'),
    backdrop: $('#lightbox-backdrop'),
    dialog: $('.lightbox-dialog'),
    paper: $('.lightbox-paper'),
    image: $('#lightbox-img'),
    title: $('#lightbox-title'),
    info: $('#lightbox-info'),
    close: $('#lightbox-close'),
    prev: $('#lightbox-prev'),
    next: $('#lightbox-next'),
  };

  let isOpen = false;
  let isOpening = false;
  let isClosing = false;
  let openTween = null;
  let sourceEl = null;
  let returnFocus = null;

  function currentItem() {
    return showcaseItems[state.lightboxIdx] || null;
  }

  function resolveSource(file) {
    if (!file) return null;
    const selector = `[data-print-file="${CSS.escape(file)}"]`;
    return document.querySelector(selector);
  }

  function preloadNeighbors() {
    const total = showcaseItems.length;
    if (total < 2) return;
    for (const offset of [1, -1]) {
      const candidate = showcaseItems[(state.lightboxIdx + offset + total) % total];
      if (candidate) new Image().src = candidate.src;
    }
  }

  function paintContent({ resolve = false } = {}) {
    const item = currentItem();
    if (!item) return;
    if (el.image) {
      if (el.image.getAttribute('src') !== item.src) el.image.src = item.src;
      el.image.alt = `${item.modelLabel} · ${itemTitle(item)}`;
    }
    if (el.title) el.title.textContent = `${item.modelLabel} · ${itemTitle(item)}`;
    if (el.info) {
      el.info.textContent = `${item.width}×${item.height} · ${item.seconds}s · seed ${item.seed} (${
        state.lightboxIdx + 1
      }/${showcaseItems.length})`;
    }
    if (resolve) sourceEl = resolveSource(item.file);
    preloadNeighbors();
  }

  function updateContent({ animate = false } = {}) {
    if (!animate || !isMotionEnabled() || !el.image) {
      paintContent({ resolve: true });
      return;
    }
    fxTween(() => {
      const timeline = gsap.timeline();
      timeline
        .to(el.image, { opacity: 0, duration: 0.14, ease: 'power1.in' })
        .call(() => paintContent())
        .fromTo(
          el.image,
          { opacity: 0, scale: 0.985 },
          { opacity: 1, scale: 1, duration: 0.32, ease: 'power2.out', clearProps: 'opacity,transform' }
        );
      return timeline;
    });
  }

  function animateOpen() {
    if (!isMotionEnabled()) return;
    const target = sourceEl;
    isOpening = true;
    openTween = fxTween(() => {
      const timeline = gsap.timeline({
        onComplete: () => {
          isOpening = false;
          openTween = null;
        },
      });
      if (el.backdrop) {
        timeline.fromTo(el.backdrop, { opacity: 0 }, { opacity: 1, duration: 0.42, ease: 'power1.out' }, 0);
      }
      if (el.dialog) {
        timeline.fromTo(el.dialog, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0);
      }
      // Flip.fit 的 destination 可以是元素；先立刻把相纸放到源图上，再回到自然位置。
      if (target && el.paper && el.paper.getBoundingClientRect().width > 0) {
        const natural = Flip.getState(el.paper);
        Flip.fit(el.paper, target, { duration: 0, scale: true });
        timeline.add(
          Flip.fit(el.paper, natural, {
            duration: 0.62,
            scale: true,
            ease: 'power3.out',
            onComplete: () => gsap.set(el.paper, { clearProps: 'transform,width,height' }),
          }),
          0.06
        );
      }
      return timeline;
    });
  }

  /** 关闭动画开始前，把还在播的打开动画收尾到自然状态，避免两条时间线争抢同一张相纸。 */
  function settleOpen() {
    if (!isOpening) return;
    openTween?.kill();
    openTween = null;
    isOpening = false;
    if (el.paper) gsap.set(el.paper, { clearProps: 'transform,width,height' });
    if (el.backdrop) gsap.set(el.backdrop, { clearProps: 'opacity' });
    if (el.dialog) gsap.set(el.dialog, { clearProps: 'opacity' });
  }

  function finalizeClose() {
    isClosing = false;
    isOpening = false;
    openTween = null;
    isOpen = false;
    state.lightboxIdx = -1;
    if (el.root) el.root.hidden = true;
    document.documentElement.classList.remove('lightbox-open');
    setPageInert(false);
    onToggle?.(false);
    if (el.paper) gsap.set(el.paper, { clearProps: 'transform,width,height' });
    if (el.backdrop) gsap.set(el.backdrop, { clearProps: 'opacity' });
    if (el.dialog) gsap.set(el.dialog, { clearProps: 'opacity' });
    if (el.root) gsap.set(el.root, { clearProps: 'opacity' });
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    sourceEl = null;
  }

  function open(file, trigger) {
    if (isOpen || isClosing) return;
    const index = showcaseItems.findIndex((item) => item.file === file);
    if (index < 0) return;

    state.lightboxIdx = index;
    returnFocus = document.activeElement;
    sourceEl = trigger || resolveSource(file);
    paintContent();

    isOpen = true;
    if (el.root) el.root.hidden = false;
    document.documentElement.classList.add('lightbox-open');
    setPageInert(true);
    onToggle?.(true);
    animateOpen();
    el.close?.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen || isClosing) return;
    isClosing = true;
    settleOpen();
    const target = sourceEl && sourceEl.isConnected ? sourceEl : null;

    if (!isMotionEnabled()) {
      finalizeClose();
      return;
    }

    if (!target || !el.paper) {
      // 翻过页或源相纸已不在 DOM：不强行飞回去，用一段短淡出收尾。
      fxTween(() =>
        gsap
          .timeline({ onComplete: finalizeClose })
          .to([el.dialog, el.backdrop].filter(Boolean), {
            opacity: 0,
            duration: 0.28,
            ease: 'power1.in',
          })
          .to(el.root, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0.1)
      );
      return;
    }

    fxTween(() => {
      const timeline = gsap.timeline({ onComplete: finalizeClose });
      if (el.backdrop) {
        timeline.to(el.backdrop, { opacity: 0, duration: 0.32, ease: 'power1.in' }, 0);
      }
      if (el.dialog) {
        timeline.to(el.dialog, { opacity: 0, duration: 0.24, ease: 'power1.in' }, 0);
      }
      timeline.add(Flip.fit(el.paper, target, { duration: 0.52, scale: true, ease: 'power2.inOut' }), 0);
      return timeline;
    });
  }

  function step(direction) {
    if (!isOpen || isClosing || showcaseItems.length === 0) return;
    const total = showcaseItems.length;
    state.lightboxIdx = (state.lightboxIdx + direction + total) % total;
    // 翻页后不再把「另一张图」FLIP 回原相纸的位置，关闭时改用淡出收尾。
    sourceEl = null;
    updateContent({ animate: true });
  }

  function trapTab(event) {
    if (!el.dialog) return;
    const nodes = focusablesInside(el.dialog);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindEvents() {
    el.backdrop?.addEventListener('click', close);
    el.close?.addEventListener('click', close);
    el.prev?.addEventListener('click', () => step(-1));
    el.next?.addEventListener('click', () => step(1));

    document.addEventListener('keydown', (event) => {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === 'Tab') trapTab(event);
    });
  }

  bindEvents();

  return {
    open,
    close,
    /** 语言切换后重画标题与题注（图片不变）。 */
    refresh() {
      if (isOpen) paintContent();
    },
    get isOpen() {
      return isOpen;
    },
  };
}
