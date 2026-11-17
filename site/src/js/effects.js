import { fxTween, gsap } from './motion.js';
import { isMotionEnabled } from './state.js';

/**
 * 显影：暗房里的一张相纸从灰雾里浮出清晰影像。
 * 所有「换一张成片」的地方复用同一个时间线，避免每处各写一套关键帧。
 */
export function developFrame(frame, { duration = 1.15 } = {}) {
  const image = frame?.querySelector('img');
  if (!image || !isMotionEnabled()) return null;

  return fxTween(() =>
    gsap.fromTo(
      image,
      {
        filter: 'blur(22px) grayscale(1) brightness(1.65) contrast(0.62)',
        opacity: 0.22,
        scale: 1.012,
      },
      {
        filter: 'blur(0px) grayscale(0) brightness(1) contrast(1)',
        opacity: 1,
        scale: 1,
        duration,
        ease: 'power2.out',
        clearProps: 'filter,transform,opacity',
      }
    )
  );
}
