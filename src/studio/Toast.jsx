/** 轻量 Toast：右下角浮出，几秒后自行消失。 */

import React from 'react'

export function Toast(props) {
  const { toast } = props
  if (!toast) return null
  return (
    <div className="ofs-toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  )
}