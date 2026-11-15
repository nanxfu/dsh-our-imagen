import { $, $$ } from './dom.js';
import { MEDIA, ScrollTrigger, gsap, refreshMotion, registerMotionSetup } from './motion.js';
import { state } from './state.js';
import { bindChoiceGroup } from './ui.js';

const REPO_SPEC = 'github:nanxfu/dsh-our-imagen';
const PANES = ['gui', 'cli', 'offline'];

/**
 * 三步上手：安装方式分段、Profile 切换与命令文本同步；
 * 外加一条纵向光路——阅读进度往下走，当前一步的序号与标题跟着亮起来，
 * 桌面端标题还会粘在视口里，长内容也始终知道自己在第几步。
 */
export function initInstall() {
  const panes = PANES.map((key) => document.getElementById(`inst-pane-${key}`));
  const track = {
    wrap: $('#steps-wrap'),
    fill: $('#install-track-fill'),
    spark: $('#install-track-spark'),
  };
  const steps = track.wrap ? $$('.step', track.wrap) : [];

  function syncPanes() {
    panes.forEach((pane, order) => {
      if (pane) pane.classList.toggle('is-hidden', PANES[order] !== state.instTab);
    });
    refreshMotion();
  }

  function syncCommand() {
    const command = `dsh plugin --profile ${state.cliProfile} add ${REPO_SPEC}`;
    const code = document.getElementById('cli-install-cmd');
    const copy = document.getElementById('cli-copy-btn');
    if (code) code.textContent = command;
    if (copy) copy.dataset.copy = command;
  }

  function setCurrent(index) {
    steps.forEach((step, order) => step.classList.toggle('is-current', order === index));
  }

  function setupProgress() {
    registerMotionSetup((mm) => {
      mm.add('(min-width: 0px)', () => {
        const triggers = steps.map((step, index) =>
          ScrollTrigger.create({
            trigger: step,
            start: 'top 60%',
            end: 'bottom 60%',
            onToggle: (self) => {
              if (self.isActive) setCurrent(index);
            },
          })
        );
        return () => {
          for (const trigger of triggers) trigger.kill();
          steps.forEach((step) => step.classList.remove('is-current'));
        };
      });

      mm.add(MEDIA.desktop, () => {
        if (!track.wrap) return undefined;
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: track.wrap,
            start: 'top 72%',
            end: 'bottom 62%',
            scrub: 0.4,
            invalidateOnRefresh: true,
            onToggle: (self) => track.wrap.classList.toggle('is-armed', self.isActive),
          },
        });
        if (track.fill) timeline.to(track.fill, { scaleY: 1, ease: 'none' }, 0);
        if (track.spark) timeline.to(track.spark, { y: () => track.wrap.offsetHeight, ease: 'none' }, 0);

        return () => {
          track.wrap?.classList.remove('is-armed');
          gsap.set([track.fill, track.spark].filter(Boolean), { clearProps: 'transform' });
        };
      });
    });
  }

  const tabGroup = bindChoiceGroup($('#install-tabs'), {
    attr: 'inst',
    onChange: (value) => {
      state.instTab = value;
      syncPanes();
    },
  });

  const profileGroup = bindChoiceGroup($('.profile-row'), {
    attr: 'profile',
    onChange: (value) => {
      state.cliProfile = value;
      syncCommand();
    },
  });

  syncPanes();
  tabGroup.sync(state.instTab);
  profileGroup.sync(state.cliProfile);
  syncCommand();
  setupProgress();
}
