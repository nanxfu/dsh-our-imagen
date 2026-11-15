/**
 * 左栏第 1 节：提示词输入、英译/润色、空白态灵感示例与可收起的润色建议芯片。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import { INSPIRE_KEYS } from '../../constants.js'
import { Tooltip } from '../../components/Tooltip.jsx'
import { Icon } from '../icons.jsx'
import { Fieldset } from './Fieldset.jsx'

const PROMPT_MAX = LIMITS.prompt.maxChars

export function PromptSection({
  t,
  prompt,
  patchForm,
  generate,
  translating,
  translate,
  enhancing,
  enhance,
  englishPromptHint,
  useInspiration,
  refineGroups,
  refineSource,
  toggleRefine,
}) {
  // 润色建议默认展开，头部可收起。
  const [refineOpen, setRefineOpen] = React.useState(true)
  const promptLength = prompt.length
  const hasPrompt = prompt.trim().length > 0

  return (
    <Fieldset
      title={t('studio.prompt')}
      action={<Tooltip text={t('studio.promptTooltip')} />}
    >
      <div className="ofs-composer">
        <textarea
          className="ofs-composer-input"
          value={prompt}
          maxLength={PROMPT_MAX}
          placeholder={t('studio.promptPlaceholder')}
          spellCheck={false}
          onChange={(event) => patchForm({ prompt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) generate()
          }}
        />
        <div className="ofs-composer-foot">
          <span className="ofs-counter">
            {promptLength} / {PROMPT_MAX}
          </span>
          <span className="ofs-composer-actions">
            {/* 英译只是把当前提示词换成英文，不改写内容；含中文时在按钮本身做轻量高亮提示，不另起一行占高度。 */}
            <button
              type="button"
              className={englishPromptHint
                ? 'ofs-text-action ofs-translate-action is-suggested'
                : 'ofs-text-action ofs-translate-action'}
              title={englishPromptHint ? t('studio.prompt.englishHint') : undefined}
              onClick={translate}
              disabled={translating || enhancing}
            >
              {translating ? t('studio.translate.thinking') : t('studio.translate.button')}
            </button>
            <button type="button" className="ofs-text-action" onClick={enhance} disabled={enhancing || translating}>
              <Icon name="expandText" size={13} />
              {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
            </button>
          </span>
        </div>
      </div>

      {englishPromptHint ? (
        <p className="ofs-hint ofs-prompt-lang-hint">{t('studio.prompt.englishHint')}</p>
      ) : null}

      {/* 灵感示例只在提示词为空时出现，不长期占据首屏高度。 */}
      {hasPrompt ? null : (
        <div className="ofs-inspire">
          <span className="ofs-inspire-label">{t('studio.inspire.title')}</span>
          <div className="ofs-suggestions">
            {INSPIRE_KEYS.map((key) => (
              <button
                type="button"
                key={key}
                className="ofs-suggestion"
                onClick={() => useInspiration(t(key))}
                title={t(key)}
              >
                {t(`${key}.label`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {refineGroups.length > 0 ? (
        <div className="ofs-refine">
          <div className="ofs-refine-head">
            <span>{t('studio.refine.title')}</span>
            <span className="ofs-refine-head-actions">
              {refineSource === 'local' ? <span className="ofs-muted">{t('studio.enhance.local')}</span> : null}
              <button
                type="button"
                className="ofs-text-action ofs-refine-toggle"
                aria-expanded={refineOpen}
                onClick={() => setRefineOpen((open) => !open)}
              >
                {refineOpen ? t('studio.refine.collapse') : t('studio.refine.expand')}
              </button>
            </span>
          </div>
          {refineOpen ? (
            <>
              {refineGroups.map((group) => (
                <div className="ofs-refine-group" key={group.dimension}>
                  <span className="ofs-refine-dim">{t(`studio.refine.${group.dimension}`)}</span>
                  <div className="ofs-suggestions">
                    {group.options.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={option.applied ? 'ofs-suggestion is-on' : 'ofs-suggestion'}
                        // 界面显示 UI 语言标签，插入提示词的始终是英文本。
                        onClick={() => toggleRefine(option.text)}
                        aria-pressed={option.applied}
                        title={option.text}
                      >
                        {option.label || option.text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Fieldset>
  )
}
