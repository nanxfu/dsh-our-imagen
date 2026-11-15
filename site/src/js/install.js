import { $ } from './dom.js';
import { state } from './state.js';
import { bindChoiceGroup } from './ui.js';

const REPO_SPEC = 'github:nanxfu/dsh-our-imagen';
const PANES = ['gui', 'cli', 'offline'];

/** 三步上手：安装方式分段、Profile 切换与命令文本同步。 */
export function initInstall() {
  const panes = PANES.map((key) => document.getElementById(`inst-pane-${key}`));

  function syncPanes() {
    panes.forEach((pane, order) => {
      if (pane) pane.classList.toggle('is-hidden', PANES[order] !== state.instTab);
    });
  }

  function syncCommand() {
    const command = `dsh plugin --profile ${state.cliProfile} add ${REPO_SPEC}`;
    const code = document.getElementById('cli-install-cmd');
    const copy = document.getElementById('cli-copy-btn');
    if (code) code.textContent = command;
    if (copy) copy.dataset.copy = command;
  }

  bindChoiceGroup($('#install-tabs'), {
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
  profileGroup.sync(state.cliProfile);
  syncCommand();
}
