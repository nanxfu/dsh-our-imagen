/**
 * 左栏（表单面板）通用的小节容器：统一标题行、右侧动作位与内容区布局。
 */

import React from 'react'

export function Fieldset(props) {
  return (
    <section className="ofs-fieldset">
      <div className="ofs-fieldset-head">
        <h3>{props.title}</h3>
        {props.action ? props.action : null}
      </div>
      {props.children}
    </section>
  )
}
