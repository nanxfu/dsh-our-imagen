/**
 * 折叠区展开时的「抽屉」容器。
 *
 * 收起时子节点必须真的卸载（界面态持久化与测试都按「收起后不再渲染」判定），
 * 所以这里不做双向高度过渡，只在展开挂载的那一刻播一次 0fr → 1fr：内容按真实
 * 高度长出来，而不是整块跳出来；内层再落定 3px。动画结束停在 1fr，等于内容
 * 高度，之后内容长高（比如多一行建议）照常撑开。
 *
 * 只负责动效包装，不改变任何收起/展开的业务判定。
 */

import React from 'react'

export function Drawer(props) {
  const className = props.className ? `ofs-drawer ${props.className}` : 'ofs-drawer'
  return (
    <div className={className}>
      <div className="ofs-drawer-inner">{props.children}</div>
    </div>
  )
}
