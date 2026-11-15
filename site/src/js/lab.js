import { $, $$, h } from './dom.js';
import { maxSteady, models, showcaseItems } from './data.js';
import { I18N, fill, itemTitle, t } from './i18n.js';
import { developFrame } from './effects.js';
import { state } from './state.js';

const SPEED_FLOOR = 1.6;
const SPEED_CEIL = 90;

function speedPosition(seconds) {
  const lo = Math.log(SPEED_FLOOR);
  const hi = Math.log(Math.max(SPEED_CEIL, maxSteady));
  const value = Math.log(Math.max(SPEED_FLOOR, seconds || SPEED_FLOOR));
  return Math.max(0.015, Math.min(0.985, (value - lo) / (hi - lo)));
}

function filteredModels() {
  if (state.filter === 'fast') {
    return models.filter((model) => (model.measured?.steadySeconds ?? Infinity) <= 11);
  }
  if (state.filter === 'usable') {
    return models.filter((model) => (model.measured?.steadySeconds ?? 0) > 11);
  }
  return models;
}

/**
 * 模型暗房：左侧速度清单、右侧成片与曝光单。
 * 清单只在筛选或语言变化时重建；选中态变化只同步 class，
 * 避免每次点选都销毁按钮、丢失键盘焦点。
 */
export function initLab({ api }) {
  const el = {
    list: $('#model-list'),
    filter: $('#model-filter'),
    printBtn: $('#lab-print-btn'),
    printImg: $('#lab-print-img'),
    filmstrip: $('#lab-filmstrip'),
    sampleTitle: $('#lab-sample-title'),
    family: $('#lab-family-badge'),
    license: $('#lab-license-badge'),
    modelDesc: $('#lab-model-desc'),
    ledger: $('#lab-spec-ledger'),
    promptMeta: $('#lab-prompt-meta'),
    promptText: $('#lab-prompt-text'),
    copyPrompt: $('#copy-prompt-btn'),
    replay: $('#replay-develop-btn'),
  };

  let filmstripKey = '';

  function visibleModels() {
    return filteredModels();
  }

  function ensureSelection(visible) {
    if (visible.length === 0) return;
    if (!visible.some((model) => model.id === state.selectedModelId)) {
      state.selectedModelId = visible[0].id;
      state.selectedSampleFile = null;
    }
  }

  function buildModelButton(model) {
    const active = model.id === state.selectedModelId;
    const seconds = model.measured?.steadySeconds;

    const name = h(
      'span',
      { class: 'model-item-name' },
      h('strong', { text: model.label }),
      h('span', { class: 'model-family-tag', text: model.family })
    );
    const top = h(
      'div',
      { class: 'model-item-top' },
      name,
      h('span', {
        class: 'model-sec tabular',
        text: seconds != null ? `~${seconds}s` : '—',
      })
    );
    const desc = h('div', {
      class: 'model-item-desc',
      text: model.description?.[state.lang] || model.description?.zh || '',
    });
    const speed = h('div', { class: 'model-speed' });
    speed.style.setProperty('--t', speedPosition(seconds || maxSteady).toFixed(3));
    speed.append(document.createElement('i'));

    return h(
      'button',
      {
        class: `model-item${active ? ' is-active' : ''}`,
        props: { type: 'button' },
        dataset: { modelId: model.id },
        attrs: {
          'aria-pressed': String(active),
          'aria-label': fill(t('modelItemAria'), { model: model.label }),
        },
        on: { click: () => selectModel(model.id) },
      },
      top,
      desc,
      speed
    );
  }

  function renderModelList() {
    if (!el.list) return;
    const visible = visibleModels();
    ensureSelection(visible);
    el.list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const model of visible) fragment.append(buildModelButton(model));
    el.list.append(fragment);
  }

  function syncModelSelection() {
    if (!el.list) return;
    $$('.model-item', el.list).forEach((button) => {
      const active = button.dataset.modelId === state.selectedModelId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function selectModel(id) {
    if (state.selectedModelId === id) return;
    state.selectedModelId = id;
    state.selectedSampleFile = null;
    syncModelSelection();
    renderStage(true);
  }

  function setFilter(filter) {
    state.filter = filter;
    renderModelList();
    renderStage(true);
  }

  function sampleFor(model) {
    const samples = showcaseItems.filter((item) => item.presetId === model.id);
    const sample =
      samples.find((item) => item.file === state.selectedSampleFile) || samples[0] || null;
    if (sample) state.selectedSampleFile = sample.file;
    return { samples, sample };
  }

  function renderFilmstrip(model, samples, sample) {
    if (!el.filmstrip) return;
    const key = `${model.id}:${samples.length}:${state.lang}`;
    if (key !== filmstripKey) {
      filmstripKey = key;
      el.filmstrip.innerHTML = '';
      if (samples.length > 1) {
        const fragment = document.createDocumentFragment();
        for (const candidate of samples) {
          const image = h('img', {
            props: { src: candidate.src, alt: '', loading: 'lazy', decoding: 'async' },
          });
          fragment.append(
            h(
              'button',
              {
                class: 'film-thumb',
                props: { type: 'button' },
                dataset: { file: candidate.file },
                attrs: { title: itemTitle(candidate), 'aria-label': itemTitle(candidate) },
                on: {
                  click: () => {
                    state.selectedSampleFile = candidate.file;
                    renderStage(true);
                  },
                },
              },
              image
            )
          );
        }
        el.filmstrip.append(fragment);
      }
    }
    $$('.film-thumb', el.filmstrip).forEach((button) => {
      button.classList.toggle('is-active', button.dataset.file === sample?.file);
    });
  }

  function renderLedger(model, sample, labels) {
    if (!el.ledger) return;
    const cells = [
      [labels.steady, model.measured?.steadySeconds != null ? `~${model.measured.steadySeconds}s` : '—'],
      [labels.sampleSec, sample ? `${sample.seconds}s` : '—'],
      [labels.stepsCfg, `${model.steps} steps · CFG ${model.cfg}`],
      [
        labels.vram,
        model.measured?.peakVramMb ? `${(model.measured.peakVramMb / 1024).toFixed(1)} GB` : '—',
      ],
      [labels.size, sample ? `${sample.width}×${sample.height}` : `${model.size}px`],
      [labels.seed, sample ? String(sample.seed) : '—'],
      [labels.img2img, model.supportsImg2Img ? labels.yes : labels.no],
      [labels.repo, model.repo.split(' + ')[0]],
    ];

    el.ledger.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const [label, value] of cells) {
      fragment.append(
        h(
          'div',
          { class: 'spec-cell' },
          h('dt', { text: label }),
          h('dd', { text: value })
        )
      );
    }
    el.ledger.append(fragment);
  }

  function renderStage(replay = false) {
    const model = models.find((candidate) => candidate.id === state.selectedModelId) || models[0];
    if (!model) return;

    const { samples, sample } = sampleFor(model);
    if (sample && el.printImg) {
      el.printImg.alt = `${model.label} · ${itemTitle(sample)}`;
      el.printImg.dataset.printFile = sample.file;
      if (el.printImg.getAttribute('src') !== sample.src) el.printImg.src = sample.src;
      if (replay) developFrame(el.printBtn);
    }

    renderFilmstrip(model, samples, sample);

    const labels = I18N[state.lang].specLabels;
    if (el.sampleTitle) el.sampleTitle.textContent = sample ? itemTitle(sample) : model.label;
    if (el.family) el.family.textContent = `${model.family} · ${model.params}`;
    if (el.license) el.license.textContent = model.license;
    if (el.modelDesc) el.modelDesc.textContent = `${model.label} — ${model.description?.[state.lang] || ''}`;
    renderLedger(model, sample, labels);
    if (el.promptMeta) el.promptMeta.textContent = `${model.label} · ${model.promptStyle}`;
    if (el.promptText) el.promptText.textContent = sample ? sample.prompt : '';
  }

  function currentPrompt() {
    return el.promptText?.textContent || '';
  }

  function bindEvents() {
    el.replay?.addEventListener('click', () => developFrame(el.printBtn));
    el.copyPrompt?.addEventListener('click', () => {
      const prompt = currentPrompt();
      if (prompt) api.copyText(prompt);
    });
    el.printBtn?.addEventListener('click', () => {
      if (state.selectedSampleFile) api.openLightbox(state.selectedSampleFile, el.printImg);
    });
  }

  renderModelList();
  renderStage(false);
  bindEvents();

  return {
    setFilter,
    selectModel,
    renderStage,
    applyLanguage() {
      renderModelList();
      renderStage(false);
    },
  };
}
