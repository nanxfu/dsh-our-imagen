# 模型预览海报来源与处理说明

本目录 6 张 `<model-id>.webp` 供 `ModelCardPicker` 使用，覆盖 7 款现役模型：
`sdxl-lightning`、`sana-sprint-1.6b`、`z-image-turbo`、`qwen-image-2.1`、`flux2-klein-4b`、`flux2-klein-9b`、`anima-turbo-v1.1`。
其中 `flux2-klein-9b` 复用 `flux2-klein-4b.webp`，不单独占图。构建期由 `build.mjs` 以 data URL 内联进 `client.js`。

图片全部来自 [Pexels](https://www.pexels.com/)，按 [Pexels License](https://www.pexels.com/license/) 使用：
可免费用于商业与非商业用途，无需署名；不得转售原图，也不得把原图作为主要素材再分发。本文件仍完整记录作者与来源。

## 处理方式

1. 从 Pexels CDN 取 `w=1440` 的压缩版原图（`https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?auto=compress&cs=tinysrgb&w=1440`）；
2. 中心裁成正方形，缩放为 **112×112**（LANCZOS）；
3. 保存为 WebP：**quality=70、method=6**（无透明通道、无调色、无文字叠加、无 AI 生成）。

预算实测：6 张 raw 合计 **13088 B**；base64 合计 **17460 字符**；把 6 个 `data:image/webp;base64,` 前缀（每个 23 字符）也算上为 **17598 字符**，上限 20480。
单张 898~2740 B，新增 3 张均在 1~3KB 规格内；`sdxl-lightning.webp` 沿用旧图（898 B，低于 1KB 下限，本轮未换源）。

## 对应关系

| 模型 ID | 文件 | 字节 | 页面 URL | 直接图片 URL（本次下载所用） | 作者 | 许可 |
| :--- | :--- | ---: | :--- | :--- | :--- | :--- |
| `sdxl-lightning` | `sdxl-lightning.webp` | 898 | https://www.pexels.com/photo/dramatic-sunrise-over-mountains-with-sun-rays-29068570/ | https://images.pexels.com/photos/29068570/pexels-photo-29068570.jpeg?auto=compress&cs=tinysrgb&w=1440 | Barna Morvai | Pexels License |
| `sana-sprint-1.6b` | `sana-sprint-1.6b.webp` | 2614 | https://www.pexels.com/zh-tw/photo/34480659/ | https://images.pexels.com/photos/34480659/pexels-photo-34480659.jpeg?auto=compress&cs=tinysrgb&w=1440 | Eren Arıcı | Pexels License |
| `z-image-turbo` | `z-image-turbo.webp` | 2556 | https://www.pexels.com/fr-fr/photo/panneau-neon-vibrant-sur-un-batiment-a-hong-kong-34779917/ | https://images.pexels.com/photos/34779917/pexels-photo-34779917.jpeg?auto=compress&cs=tinysrgb&w=1440 | Jenny Mavimiro | Pexels License |
| `qwen-image-2.1` | `qwen-image-2.1.webp` | 2740 | https://www.pexels.com/zh-tw/photo/14832531/ | https://images.pexels.com/photos/14832531/pexels-photo-14832531.jpeg?auto=compress&cs=tinysrgb&w=1440 | Alina Skazka | Pexels License |
| `flux2-klein-4b` / `flux2-klein-9b` | `flux2-klein-4b.webp` | 2634 | https://www.pexels.com/photo/close-up-of-purple-crystals-12602053/ | https://images.pexels.com/photos/12602053/pexels-photo-12602053.jpeg?auto=compress&cs=tinysrgb&w=1440 | Merlin Lightpainting（@Merlin） | Pexels License |
| `anima-turbo-v1.1` | `anima-turbo-v1.1.webp` | 1646 | https://www.pexels.com/photo/colorful-anime-figure-on-display-stand-38293324/ | https://images.pexels.com/photos/38293324/pexels-photo-38293324.jpeg?auto=compress&cs=tinysrgb&w=1440 | Fenn（@fenn） | Pexels License |

## 复用与重命名

- **`flux2-klein-9b` 共用 `flux2-klein-4b.webp`**：`POSTERS` 映射里两个 key 指向同一份 data URL，预算只按 6 份图计。
- **`anima-turbo-v1.1.webp` 由 `anima-light-lavender.webp` 重命名而来**：只改文件名，未换图、未重新编码，来源与作者不变。旧文件名不再存在，`ModelCardPicker` 的 import 已同步。
- `sdxl-lightning` 与 `flux2-klein-4b` 的来源记录迁移自 `design-demos/assets/SOURCES.md`。

## 选图说明（本轮新增 3 张）

- **`sana-sprint-1.6b`**：夜间高速公路的车辆光轨（Eren Arıcı）。画面由高对比度的流动光束构成，112px 与 56px 缩略下仍能读出「光轨/速度」，对应「2 步极速、轻量灵感探索」的定位。
- **`z-image-turbo`**：香港楼宇外墙的橙红霓虹店招（Jenny Mavimiro）。写实夜景加发光汉字招牌，缩略下可直接读出「摄影 + 文字」，对应「8 步写实摄影、中英双语文字」。
- **`qwen-image-2.1`**：整面由重复排印 `TERRAZA` 组成的绿色招牌（Alina Skazka）。字形重复排列构成主体，缩略下直接读出「排版」，对应「强排版/多图编辑」。
- **`anima-turbo-v1.1`**：沿用原二次元角色手办特写（Fenn）。该图是物理手办照片，只作「概念示意」，不是该模型的出图样例。

## 下线清理

阶段十七下线 6 款模型，对应海报已从本目录删除：`sdxl-turbo`、`hyper-sdxl-8step`、`playground-v2.5`、`sdxl-base`、`realvis-v5`、`animagine-xl-3.1`。
删除前已 grep 全仓（`src/`、`tools/`、`test/`、`docs/` 非 archive），这些海报文件路径除 `ModelCardPicker.jsx` 外没有其它引用。

## 来源记录补充

新增 3 张的页面 URL 与作者取自 Pexels 搜索结果的索引元数据：`www.pexels.com` 详情页对自动化访问返回 Cloudflare 403，未逐页打开核验；
直链（`images.pexels.com` CDN）可正常下载（HTTP 200），三张都下载后用 `read_image` 目检确认画面与定位相符。
