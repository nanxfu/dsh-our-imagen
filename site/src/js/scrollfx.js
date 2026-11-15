import { $, $$, rafThrottle } from './dom.js';
import { ScrollTrigger, gsap, registerMotionSetup } from './motion.js';

/**
 * 全页滚动反馈：顶栏进度条、顶栏吸附阴影、区块顶部发丝线生长。
 * 这些是「结构性反馈」，不承担叙事，所以保持单条 timeline、无错峰。
 */
export function initScrollEffects() {
  const chrome = $('#chrome');
  const syncChrome = rafThrottle(() => {
    if (chrome) chrome.classList.toggle('is-stuck', window.scrollY > 18);
  });
  window.addEventListener('scroll', syncChrome, { passive: true });
  syncChrome();

  registerMotionSetup((mm) => {
    mm.add('(min-width: 0px)', () => {
      const bar = $('.chrome-progress span');
      const progressTrigger = ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: (self) => {
          if (bar) gsap.set(bar, { scaleX: self.progress });
        },
      });

      const rules = $$('main > section').map((section) =>
        gsap.fromTo(
          section,
          { '--rule-p': 0 },
          {
            '--rule-p': 1,
            ease: 'none',
            scrollTrigger: { trigger: section, start: 'top 92%', end: 'top 55%', scrub: true },
          }
        )
      );

      return () => {
        progressTrigger.kill();
        for (const rule of rules) rule.scrollTrigger?.kill();
      };
    });
  });
}
