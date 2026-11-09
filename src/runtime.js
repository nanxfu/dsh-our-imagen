/**
 * React 运行时入口。
 *
 * 平台把 react 冻结在共享模块表里，bundle 只能同步 require 它；
 * 这里收敛成单一出口，组件模块统一从这里取 h / React。
 */

import React from 'react'

export { React }

export const h = React.createElement