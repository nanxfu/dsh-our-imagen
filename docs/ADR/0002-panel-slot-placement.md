# ADR-0002：工作台主落点为右侧面板 slot，并支持退化

- 状态：已采纳
- 日期：2026-11-08
- 相关：[WORKBENCH-UI.md](../WORKBENCH-UI.md)

## 背景

Harness 插件没有"页面"或"路由"概念，只能在既有 slot 中渲染。可选位置：`settings.section`（唯一接近整页的位置，语义是设置页）、`sidebar.right.pane.tab`（右侧面板）、`shell.overlay`（浮层）、会话头与输入区的小部件位。

## 决策

主界面注册到 `sidebar.right.pane.tab`；会话头 `conversation.session.header.utilities` 放状态徽章；首次引导做成面板内的分步空态，不弹浮层。右侧面板不可用时，退化到 `settings.section` 整页，并在徽章里提示入口位置。

## 后果

- 用户在对话旁边就能出图，不打断上下文。
- 右侧面板由第三方插件（`dsh-better-sidebar`）提供，存在依赖风险；退化路径把风险降到"入口换位置"而不是"功能消失"。
- 需要一次运行时探测来判定面板是否真的挂载，并保证只判定一次。

## 备选与否决理由

- **只放 `settings.section`**：可用性最稳，但"在设置里生图"违反直觉。
- **只做浮层**：零依赖，但每次都要开关，且遮挡对话。

## 实施记录（2026-11-09）

M1 落地时确认：`sidebar.right.pane.tab` 是以 tab **类型**为 key 的槽位（key 由 `rightbar.session` 的 tab kind 决定），插件要新增一个 tab 需要同时注册 tab 类型与标题，M1 范围内成本偏高。因此 M1 采用本文档已声明的退化路径：主界面放 `settings.section` 整页，状态徽章放 `conversation.session.header.utilities`；右侧面板在 M2 重新评估。退化的用户体验代价是"要点两次才能打开"，但不需要依赖其他插件。
