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
// 测试专用聚合出口：src 内部不经过任何 barrel，只有测试入口依赖 test/helpers。
import * as logic from '../test/helpers/logic.mjs'
import * as runtime from './runtime.js'
import * as api from './api.js'
import * as i18n from './i18n.js'
import { StatusChip } from './components/StatusChip.js'
import { Studio } from './studio/Studio.jsx'
import { StudioIcon } from './studio/StudioIcon.jsx'
import { Gallery } from './studio/Gallery.jsx'
import { Filmstrip } from './studio/Filmstrip.jsx'
import { GuidanceCard } from './studio/GuidanceCard.jsx'
import { PipelineBar } from './studio/PipelineBar.jsx'
import { QueueNotice } from './studio/QueueNotice.jsx'
import { Rail } from './studio/Rail.jsx'
import { ChatPanel } from './studio/ChatPanel.jsx'
import { Stage } from './studio/Stage.jsx'
import { TopBar } from './studio/TopBar.jsx'
import { LogsDrawer } from './studio/LogsDrawer.jsx'
import { SettingsDrawer } from './studio/SettingsDrawer.jsx'
import { ModelCardPicker } from './studio/ModelCardPicker.jsx'
// 阶段十二舞台图片工具：动作坞、涂抹画布与整图重绘条（Stage 只负责编排）。
import { ImageDock } from './studio/stage/ImageDock.jsx'
import { InlineTool } from './studio/stage/InlineTool.jsx'
import { MaskEditor } from './studio/stage/MaskEditor.jsx'
import { OutpaintEditor } from './studio/stage/OutpaintEditor.jsx'
import { ToolSubmitBar } from './studio/stage/ToolSubmitBar.jsx'
// 阶段十三作品条：新建绘图草稿卡与版本派生面板（Filmstrip 接线）。
import { DraftCard } from './studio/filmstrip/DraftCard.jsx'
import { VersionPanel } from './studio/filmstrip/VersionPanel.jsx'
import { useChatThread } from './studio/hooks/useChatThread.js'
import { useImageTool } from './studio/hooks/useImageTool.js'
import { useKaggleLogin } from './studio/hooks/useKaggleLogin.js'
import { useStudioUi } from './studio/hooks/useStudioUi.js'
import { useStudio } from './studio/useStudio.js'

export const __test = {
  dict,
  theme,
  constants,
  logic,
  runtime,
  api,
  i18n,
  // 域 hook 直接暴露给渲染测试：用最小 Harness 组件挂载，断言真实状态流转。
  hooks: {
    useChatThread,
    useImageTool,
    useKaggleLogin,
    useStudioUi,
    useStudio,
  },
  components: {
    StatusChip,
    Studio,
    StudioIcon,
    Gallery,
    Filmstrip,
    GuidanceCard,
    PipelineBar,
    QueueNotice,
    Rail,
    ChatPanel,
    Stage,
    TopBar,
    LogsDrawer,
    SettingsDrawer,
    ModelCardPicker,
    // 舞台图片工具子组件（阶段十二 / 阶段十五 Phase B 扩图）。
    ImageDock,
    InlineTool,
    MaskEditor,
    OutpaintEditor,
    ToolSubmitBar,
    // 作品条版本组件（阶段十三）。
    DraftCard,
    VersionPanel,
  },
}