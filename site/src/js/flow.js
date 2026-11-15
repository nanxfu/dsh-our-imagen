import { $, $$ } from './dom.js';
import { MEDIA, gsap, registerMotionSetup } from './motion.js';

/**
 * 「光路」粘性叙事：滚动时把流水线钉在视口中央，安全灯的光点从本机出发，
 * 依次点亮 Host、Kaggle、本地工作区；最后一步让右下角的空白相纸显影。
 *
 * 这条序列只解释「数据与算力怎么走」，是页面唯一的 focal moment。
 * 窄屏与动效关闭时不钉屏：CSS 默认就把四段说明作为静态列表完整展示。
 */
const HOLD = 0.55;
const TRAVEL = 0.8;
const REVEAL = 0.9;
const SPARK_GAP = 12;

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

      // 光点只在节点之间的「连接线空隙」里移动，不会从卡片正面穿过去。
      const line = $('.pipeline-line', pipeline);
      const gapStart = (index) =>
        nodes[index].offsetLeft + nodes[index].offsetWidth + SPARK_GAP;
      const gapEnd = (index) => nodes[index + 1].offsetLeft - SPARK_GAP;
      const sparkY = () => {
        if (!line) return 0;
        const pipelineBox = pipeline.getBoundingClientRect();
        const lineBox = line.getBoundingClientRect();
        // 元素本身有 -5px 外边距抵消半径，这里只需给到连接线中心的相对坐标。
        return lineBox.top + lineBox.height / 2 - pipelineBox.top;
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
      stage.classList.add('is-armed');
      gsap.set(spark, { y: sparkY() });

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
          onRefresh: () => {
            gsap.set(spark, { y: sparkY() });
            syncStep(timeline ? timeline.progress() : 0);
          },
        },
      });

      timeline.set(spark, { x: () => gapStart(0), opacity: 0 }, 0);
      for (let i = 1; i < nodes.length; i += 1) {
        const start = arrivals[i] - TRAVEL;
        timeline
          .set(spark, { x: () => gapStart(i - 1) }, start)
          .to(spark, { opacity: 1, duration: 0.12, ease: 'power1.out' }, start)
          .to(spark, { x: () => gapEnd(i - 1), duration: TRAVEL, ease: 'none' }, start)
          .to(fills[i - 1], { scaleX: 1, duration: TRAVEL, ease: 'none' }, start)
          .to(spark, { opacity: 0, duration: 0.18, ease: 'power1.in' }, start + TRAVEL)
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
        stage.classList.remove('is-armed');
        nodes.forEach((node) => node.classList.remove('is-lit', 'is-active'));
        captions.forEach((caption) => caption.classList.remove('is-active'));
        if (printImage) gsap.set(printImage, { clearProps: 'filter,transform,visibility,opacity' });
      };
    });
  });
}
