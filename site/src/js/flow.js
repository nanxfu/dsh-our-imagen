import { $, $$ } from './dom.js';
import { MEDIA, gsap, registerMotionSetup } from './motion.js';

/**
 * 「光路」粘性叙事：滚动时把流水线钉在视口里，安全灯的光点从本机出发，
 * 依次点亮 Host、Kaggle、本地工作区；最后一步让右下角的空白相纸显影。
 *
 * 这条序列只解释「数据与算力怎么走」，是页面唯一的 focal moment。
 * 窄屏与动效关闭时不钉屏，四段说明改为静态列表（CSS 负责兜底）。
 */
const HOLD = 0.55;
const TRAVEL = 0.8;
const REVEAL = 0.9;

export function initFlow() {
  const flow = $('#flow');
  const stage = $('#flow-stage');
  const pipeline = $('#flow .pipeline');
  if (!flow || !stage || !pipeline) return;

  registerMotionSetup((mm) => {
    mm.add(MEDIA.desktop, () => {
      const spark = $('.flow-spark', pipeline);
      const nodes = $$('.pipeline-node', pipeline);
      const fills = $$('.pipeline-fill', pipeline);
      const captions = $$('.flow-caption', stage);
      const printImage = $('.flow-print img', stage);
      if (!spark || nodes.length < 4) return undefined;

      const arrivals = [0];
      let clock = HOLD;
      for (let i = 1; i < nodes.length; i += 1) {
        clock += TRAVEL;
        arrivals.push(clock);
        clock += HOLD;
      }

      const centerOf = (index) => {
        const node = nodes[index];
        return node.offsetLeft + node.offsetWidth / 2 - spark.offsetWidth / 2;
      };

      const setStep = (index) => {
        nodes.forEach((node, order) => {
          node.classList.toggle('is-lit', order <= index);
          node.classList.toggle('is-active', order === index);
        });
        captions.forEach((caption, order) => {
          caption.classList.toggle('is-active', order === index);
        });
      };

      let timeline = null;
      const syncStep = (progress) => {
        if (!timeline) return;
        const time = progress * timeline.duration();
        let step = 0;
        for (let i = 0; i < arrivals.length; i += 1) {
          if (time >= arrivals[i]) step = i;
        }
        setStep(step);
      };

      gsap.set(printImage, { autoAlpha: 0 });

      timeline = gsap.timeline({
        scrollTrigger: {
          trigger: flow,
          start: 'top 72px',
          end: () => `+=${Math.round(window.innerHeight * 1.9)}`,
          pin: stage,
          pinSpacing: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => syncStep(self.progress),
          onRefresh: () => syncStep(timeline ? timeline.progress() : 0),
        },
      });

      timeline.set(spark, { x: () => centerOf(0) }, 0);
      for (let i = 1; i < nodes.length; i += 1) {
        const start = arrivals[i] - TRAVEL;
        timeline
          .to(spark, { x: () => centerOf(i), duration: TRAVEL, ease: 'none' }, start)
          .to(fills[i - 1], { scaleX: 1, duration: TRAVEL, ease: 'none' }, start)
          .to({}, { duration: HOLD }, start + TRAVEL);
      }
      timeline.fromTo(
        printImage,
        {
          autoAlpha: 0,
          filter: 'blur(18px) grayscale(1) brightness(1.35) contrast(0.7)',
          scale: 1.02,
        },
        {
          autoAlpha: 1,
          filter: 'blur(0px) grayscale(0) brightness(1) contrast(1)',
          scale: 1,
          duration: REVEAL,
          ease: 'power2.out',
          clearProps: 'filter,transform,visibility,opacity',
        },
        arrivals[nodes.length - 1]
      );

      setStep(0);

      // 动效关闭或回到窄屏时，交还一个干净的无 pin 状态。
      return () => {
        nodes.forEach((node) => node.classList.remove('is-lit', 'is-active'));
        captions.forEach((caption) => caption.classList.remove('is-active'));
        if (printImage) gsap.set(printImage, { clearProps: 'filter,transform,visibility,opacity' });
      };
    });
  });
}
