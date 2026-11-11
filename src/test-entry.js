/**
 * 测试专用入口：在发布产物之外额外暴露内部实现，供渲染测试挂载组件。
 *
 * 这个文件只在 `node build.mjs --test` 时打包成 test/.build/client.test.js，
 * 发布产物 client.js 由 src/index.js 打包，不含任何测试出口。
 */

export { inject, apply } from './index.js'

import * as dict from './dict/index.js'
import * as theme from './theme.js'
import * as constants from './constants.js'
import * as logic from './logic/index.js'
import * as runtime from './runtime.js'
import * as api from './api.js'
import * as i18n from './i18n.js'
import { StatusChip } from './components/StatusChip.js'
import { Studio } from './studio/Studio.jsx'
import { StudioIcon } from './studio/StudioIcon.jsx'
import { Gallery } from './studio/Gallery.jsx'
import { Filmstrip } from './studio/Filmstrip.jsx'
import { Rail } from './studio/Rail.jsx'
import { ChatPanel } from './studio/ChatPanel.jsx'
import { Stage } from './studio/Stage.jsx'
import { TopBar } from './studio/TopBar.jsx'
import { LogsDrawer } from './studio/LogsDrawer.jsx'
import { ModelCardPicker } from './studio/ModelCardPicker.jsx'

export const __test = {
  dict,
  theme,
  constants,
  logic,
  runtime,
  api,
  i18n,
  components: {
    StatusChip,
    Studio,
    StudioIcon,
    Gallery,
    Filmstrip,
    Rail,
    ChatPanel,
    Stage,
    TopBar,
    LogsDrawer,
    ModelCardPicker,
  },
}