/**
 * 生图流水线：顶栏下方那条单行节点条的展示层。
 *
 * 数据与规则都在 logic/pipeline.js（纯函数），这里只负责画：
 *  - 左侧固定节点 + 连接线，右侧排队数与已等待；
 *  - 外层常驻、隐藏时高度归零，出现/消失用高度过渡（等待超过 1.5 秒才出现，
 *    快速出图不闪条，工作区也不会上下跳动）；
 *  - 只用 role="status" 播报阶段切换；每秒走字的计时放进 aria-hidden 区，不重复朗读。
 *
 * 阶段十五 Phase C0：1Hz 读秒从 Studio 顶层下沉到这里。只有流水线自己需要「每秒刷新」
 * （已等待 / 完成保留期），等待期间不再让整页每秒重渲染。
 *
 * 接收与 pipelineViewOf 同名的原始输入：{ t, session, activeJob, focusedJob, pendingCount,
 * queuePolicy, failureDismissed, transient }。
 */

import React, { Fragment } from 'react'

import { useNow } from '../hooks/useNow.js'
import { pipelineHoldOf, pipelineViewOf } from '../logic/pipeline.js'

/** 节点类名：状态 + 「比平时久」的琥珀标记。 */
function nodeClassOf(node) {
  const classes = ['ofs-pl-node', `is-${node.state}`]
  if (node.warn) classes.push('is-warn')
  return classes.join(' ')
}

/** 连接线：前一个节点走完（或失败）是实线；通向当前节点的段加一道很慢的流光。 */
function linkClassOf(previous, node) {
  const filled = previous.state === 'done' || previous.state === 'failed'
  const classes = ['ofs-pl-link']
  if (filled) classes.push('is-filled')
  if (filled && node.state === 'active') classes.push('is-flowing')
  return classes.join(' ')
}

export function PipelineBar(props) {
  const { t } = props
  const session = props.session || null
  const activeJob = props.activeJob || null
  const focusedJob = props.focusedJob || null
  const pendingCount = props.pendingCount
  const queuePolicy = props.queuePolicy || null
  const failureDismissed = props.failureDismissed === true
  // 需要读秒的三种情况：会话正在推进 / 有活动任务 / 刚完成还在保留期。
  // 完成保留期结束后计时自动停止，流水线也就不会继续每秒空转。
  const ticking = props.transient === true
    || Boolean(activeJob)
    || pipelineHoldOf(focusedJob, Date.now())
  const now = useNow(ticking)
  const view = React.useMemo(
    () => pipelineViewOf(t, {
      session,
      activeJob,
      focusedJob,
      pendingCount,
      queuePolicy,
      failureDismissed,
      now,
    }),
    [t, session, activeJob, focusedJob, pendingCount, queuePolicy, failureDismissed, now],
  )
  const hidden = !view || view.visible !== true
  const mode = hidden ? 'hidden' : view.mode
  const nodes = hidden ? [] : view.nodes || []
  // 折叠态（云端已就绪 → 生成）：连接线不拉满整行，避免被读成还剩很长一段。
  const folded = nodes.length > 0 && nodes[0].key === 'ready'
  const className = [
    'ofs-pipeline',
    hidden ? 'is-hidden' : '',
    mode === 'complete' ? 'is-complete' : '',
    mode === 'closing' ? 'is-closing' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-label={hidden ? undefined : view.label || undefined}
      aria-hidden={hidden ? 'true' : undefined}
      data-mode={mode}
    >
      {hidden ? null : (
        <Fragment>
          <div className={folded ? 'ofs-pl-rail is-folded' : 'ofs-pl-rail'}>
            {nodes.map((node, index) => (
              <Fragment key={node.key}>
                {index > 0 ? <span className={linkClassOf(nodes[index - 1], node)} aria-hidden="true" /> : null}
                <span className={nodeClassOf(node)} title={node.title || undefined}>
                  <span className="ofs-pl-dot" aria-hidden="true" />
                  <span className="ofs-pl-label">{node.label}</span>
                  {node.sub ? <span className="ofs-pl-sub">{node.sub}</span> : null}
                  {node.tag ? <span className="ofs-pl-tag">{node.tag}</span> : null}
                </span>
              </Fragment>
            ))}
          </div>
          <div className="ofs-pl-meta" aria-hidden="true">
            {view.queueText ? <span className="ofs-pl-queue">{view.queueText}</span> : null}
            {view.timeText ? (
              <span className="ofs-pl-time">
                {view.timeLabel ? `${view.timeLabel} ` : ''}
                {view.timeText}
              </span>
            ) : null}
          </div>
        </Fragment>
      )}
    </div>
  )
}
