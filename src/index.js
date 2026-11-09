/**
 * 浏览器侧插件入口。
 *
 * 三个挂载点：
 *   main                                   —— 独立整页工作台（宿主主区域）
 *   sidebar.panellist                      —— 侧栏图标入口，点击切到工作台
 *   conversation.session.header.utilities  —— 对话页顶部的小状态徽章
 *
 * 旧版「设置页工作台」已移除：整页工作台覆盖了它的全部能力。
 */

import { NS } from './constants.js'
import { DICT } from './dict/index.js'
import { StatusChip } from './components/StatusChip.js'
import { Studio } from './studio/Studio.jsx'
import { StudioIcon } from './studio/StudioIcon.jsx'

// main.key 与 sidebar.panellist.id 必须是同一个值，宿主靠它把侧栏入口关联到整页面板。
const PANEL_ID = 'our-free-imagen'

export const inject = ['slots', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh), 'imagen:locale-zh')
  ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en), 'imagen:locale-en')

  const studioLabel = () => {
    try {
      return ctx.locale.bind(NS)('studio.nav.label')
    } catch {
      return DICT.zh['studio.nav.label']
    }
  }

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      },
      Studio,
    ),
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 40,
        label: studioLabel,
        locale: NS,
      },
      StudioIcon,
    ),
  )

  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'our-free-imagen-status',
        order: 30,
        label: studioLabel,
        locale: NS,
      },
      StatusChip,
    ),
  )
}