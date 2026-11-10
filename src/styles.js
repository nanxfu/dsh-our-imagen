/**
 * 样式聚合：esbuild 以文本形式把每个 CSS 模块打进 bundle，
 * 组件注入的是这一整段字符串，避免宿主样式管线的依赖。
 * 新样式文件同时加进 styles/manifest.js。
 */

import tokens from './styles/tokens.css'
import base from './styles/base.css'
import shell from './styles/shell.css'
import panel from './styles/panel.css'
import stage from './styles/stage.css'
import filmstrip from './styles/filmstrip.css'
import gallery from './styles/gallery.css'
import chat from './styles/chat.css'
import responsive from './styles/responsive.css'

export const CSS = [tokens, base, shell, panel, stage, filmstrip, gallery, chat, responsive].join('\n')