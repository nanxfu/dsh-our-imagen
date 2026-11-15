import {
  MEDIA,
  gsap,
  onMotionChange,
  playIntroTween,
  registerMotionSetup,
} from './motion.js';
import { $, h } from './dom.js';
import { heroItems, showcaseItems } from './data.js';
import { fill, itemTitle, t } from './i18n.js';
import { developFrame } from './effects.js';
import { isMotionEnabled } from './state.js';

const HERO_CYCLE_MS = 7000;

/**
 * Hero：主相纸轮播、背景光晕、开场时间线与滚动视差。
 *
 * 轮播暂停不是一个布尔值，而是若干独立原因（悬停、焦点、离开视口、
 * 页面隐藏、打开灯箱）；原因集合空了才继续，避免多个监听器互相覆盖。
 */
export function initHero({ api }) {
  const el = {
    hero: $('.hero'),
    print: $('.hero-print'),
    printBtn: $('#hero-print-btn'),
    printImg: $('#hero-print-img'),
    stage: $('.hero-stage'),
    exposure: $('.exposure'),
    model: $('#hero-exp-model'),
    title: $('#hero-exp-title'),
    nums: $('#hero-exp-nums'),
    thumbs: $('#hero-thumbs'),
    cycleBar: $('#hero-cycle-bar'),
    auraA: $('#hero-aura-a'),
    auraB: $('#hero-aura-b'),
    copy: $('.hero-copy'),
  };

  const pauseReasons = new Set();
  const thumbButtons = [];
  let index = 0;
  let auraIndex = -1;
  let visible = true;
  let cycle = null;
  let introPlayed = false;

  function activeItem() {
    return heroItems[index] || showcaseItems[0] || null;
  }

  function setAura(src) {
    const layers = [el.auraA, el.auraB];
    if (!layers[0] || !layers[1]) return;
    auraIndex = (auraIndex + 1) % 2;
    const incoming = layers[auraIndex];
    const outgoing = layers[1 - auraIndex];
    if (incoming.dataset.src !== src) {
      incoming.dataset.src = src;
      incoming.style.backgroundImage = `url("${src}")`;
    }
    incoming.classList.add('is-active');
    outgoing.classList.remove('is-active');
  }

  function syncThumbState() {
    thumbButtons.forEach((button, idx) => {
      const active = idx === index;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      const item = heroItems[idx];
      if (item) {
        button.setAttribute('aria-label', fill(t('heroThumbAria'), { title: itemTitle(item) }));
      }
    });
  }

  function select(nextIndex, { replay = true, restart = true } = {}) {
    index = nextIndex;
    render(replay);
    if (restart) restartCycle();
  }

  function render(replay = false) {
    const item = activeItem();
    if (!item) return;

    setAura(item.src);
    if (el.printImg) {
      el.printImg.alt = `${item.modelLabel} · ${itemTitle(item)}`;
      el.printImg.dataset.printFile = item.file;
      if (el.printImg.getAttribute('src') !== item.src) el.printImg.src = item.src;
      if (replay) developFrame(el.printBtn);
    }
    if (el.model) el.model.textContent = item.modelLabel;
    if (el.title) el.title.textContent = itemTitle(item);
    if (el.nums) {
      el.nums.textContent = `${item.width}×${item.height} · ${item.seconds}s · seed ${item.seed}`;
    }
    syncThumbState();
  }

  function buildThumbs() {
    if (!el.thumbs) return;
    el.thumbs.innerHTML = '';
    heroItems.forEach((item, idx) => {
      const image = h('img', {
        props: { src: item.src, alt: '', loading: 'lazy', decoding: 'async' },
      });
      const meta = h(
        'span',
        { class: 'hero-thumb-meta' },
        h('strong', { text: item.modelLabel }),
        h('span', { class: 'tabular', text: `${item.seconds}s` })
      );
      const button = h(
        'button',
        {
          class: 'hero-thumb',
          props: { type: 'button' },
          attrs: { 'aria-pressed': 'false' },
          on: { click: () => select(idx) },
        },
        image,
        meta
      );
      thumbButtons.push(button);
      el.thumbs.append(button);
    });
  }

  /* ── 轮播计时 ─────────────────────────────────────────────── */

  function blocked() {
    return !isMotionEnabled() || document.hidden || !visible || pauseReasons.size > 0;
  }

  function stopCycle({ resetBar = true } = {}) {
    if (cycle) {
      cycle.kill();
      cycle = null;
    }
    if (resetBar && el.cycleBar) gsap.set(el.cycleBar, { scaleX: 0 });
  }

  function startCycle() {
    stopCycle({ resetBar: false });
    if (blocked() || heroItems.length < 2) return;

    const bar = el.cycleBar;
    cycle = gsap.timeline({
      onComplete: () => {
        cycle = null;
        index = (index + 1) % heroItems.length;
        render(true);
        startCycle();
      },
    });
    if (bar) {
      cycle.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: HERO_CYCLE_MS / 1000, ease: 'none' });
    } else {
      // 没有进度条元素时也用等长空档保持轮播节奏。
      cycle.to({}, { duration: HERO_CYCLE_MS / 1000 });
    }
  }

  function syncCycle() {
    if (blocked()) {
      if (cycle) cycle.pause();
      return;
    }
    if (cycle) cycle.play();
    else startCycle();
  }

  function restartCycle() {
    stopCycle();
    syncCycle();
  }

  function setPaused(reason, paused) {
    if (paused) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    syncCycle();
  }

  /* ── 开场与滚动时间线 ─────────────────────────────────────── */

  function playIntro() {
    if (introPlayed || !isMotionEnabled()) return;
    // 带锚点打开页面时用户已经在别处，别在屏幕外放开场。
    if (window.scrollY > 8) return;
    introPlayed = true;

    playIntroTween(
      (timeline) => {
        timeline
          .from('.hero-title', { y: 30, autoAlpha: 0, duration: 0.9 }, 0.12)
          .from('.hero-lead', { y: 22, autoAlpha: 0, duration: 0.8 }, 0.28)
          .from('.hero-actions .btn', { y: 16, autoAlpha: 0, duration: 0.65, stagger: 0.07 }, 0.42)
          .from('.hero-facts > *', { y: 10, autoAlpha: 0, duration: 0.5, stagger: 0.05 }, 0.58)
          .from('.hero-stage', { y: 30, scale: 0.975, autoAlpha: 0, duration: 1.05 }, 0.32)
          .from('.exposure', { y: 10, autoAlpha: 0, duration: 0.7 }, 0.86)
          .from('.hero-thumb', { y: 10, autoAlpha: 0, duration: 0.55, stagger: 0.06 }, 0.96)
          .from('.hero-scroll', { autoAlpha: 0, duration: 0.6 }, 1.15)
          .call(() => developFrame(el.printBtn), null, 0.46);
      },
      0.08
    );
  }

  function setupScroll() {
    registerMotionSetup((mm) => {
      mm.add({ lite: MEDIA.lite }, (context) => {
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });
        timeline
          .to('.hero-print', { y: '-4vh', scale: 0.955, opacity: 0.55, ease: 'none' }, 0)
          .to('.hero-copy', { y: '3vh', opacity: 0.62, ease: 'none' }, 0)
          // 主相纸后退的同时，背后的那团光跟着收远；曝光单与缩略图比文案退得更快。
          .to('.hero-aura', { yPercent: 4, scale: 1.06, opacity: 0.55, ease: 'none' }, 0)
          .to('.exposure, .hero-thumbs', { y: '-1.8vh', opacity: 0.44, ease: 'none' }, 0)
          .to('.hero-scroll', { autoAlpha: 0, ease: 'none' }, 0);

        // 背景大幅模糊层只在精细指针对的小屏以上做视差。
        if (!context.conditions.lite) {
          gsap.to('.room-photo', {
            yPercent: -7,
            xPercent: -2.5,
            scale: 1.12,
            ease: 'none',
            scrollTrigger: { start: 0, end: '+=2200', scrub: 0.6 },
          });
        }
      });
    });
  }

  function bindEvents() {
    el.printBtn?.addEventListener('click', () => {
      const item = activeItem();
      if (item) api.openLightbox(item.file, el.printImg);
    });

    el.print?.addEventListener('pointerenter', () => setPaused('hover', true));
    el.print?.addEventListener('pointerleave', () => setPaused('hover', false));

    el.hero?.addEventListener('focusin', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && !target.matches(':focus-visible')) return;
      setPaused('focus', true);
    });
    el.hero?.addEventListener('focusout', (event) => {
      if (event.relatedTarget && el.hero.contains(event.relatedTarget)) {
        const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (next && next.matches(':focus-visible')) return;
      }
      setPaused('focus', false);
    });

    if ('IntersectionObserver' in window && el.hero) {
      new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          syncCycle();
        },
        { threshold: 0.12 }
      ).observe(el.hero);
    }

    document.addEventListener('visibilitychange', syncCycle);
  }

  buildThumbs();
  render(false);
  bindEvents();
  setupScroll();

  onMotionChange((enabled) => {
    if (enabled) {
      playIntro();
      syncCycle();
    } else {
      stopCycle();
    }
  });

  return {
    render,
    setPaused,
  };
}
