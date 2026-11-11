# 模型预览海报来源与处理说明

本目录的 9 张 `<model-id>.webp` 供 `ModelCardPicker` 使用，构建期以 data URL 内联。
图片全部来自 [Pexels](https://www.pexels.com/)，按 [Pexels License](https://www.pexels.com/license/) 使用：
可免费用于商业与非商业用途，无需署名；不得转售原图，也不得把原图作为主要素材再分发。本文件仍完整记录作者与来源。

## 处理方式

1. 从 Pexels CDN 取 `w=1440` 的压缩版原图（已有 4 张沿用 `design-demos/assets/poster-*-256.jpg`，本轮新增的 `anima-light-lavender` 同样从 `w=1440` 取图）；
2. 中心裁成正方形，缩放为 **112×112**（LANCZOS）；
3. 保存为 WebP：**quality=70、method=6**（无透明通道、无调色、无文字叠加、无 AI 生成）。

预算实测：9 张 raw 合计 **15076 B**，base64 合计 **20116 字符**（上限 20480；若把 9 个 `data:image/webp;base64,` 前缀也算上为 **20323**）。其中本轮新增的 `anima-light-lavender.webp` 为 1646 B，符合单张 1~3KB 规格。

## 对应关系

| 模型 ID | 文件 | 页面 URL | 直接图片 URL（本次下载所用） | 作者 | 许可 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sdxl-lightning`（琥珀破晓光） | `sdxl-lightning.webp` | https://www.pexels.com/photo/dramatic-sunrise-over-mountains-with-sun-rays-29068570/ | https://images.pexels.com/photos/29068570/pexels-photo-29068570.jpeg?auto=compress&cs=tinysrgb&w=1440 | Barna Morvai | Pexels License |
| `sdxl-turbo`（青色光轨） | `sdxl-turbo.webp` | https://www.pexels.com/photo/abstract-blue-light-streaks-in-motion-33065353/ | https://images.pexels.com/photos/33065353/pexels-photo-33065353.jpeg?auto=compress&cs=tinysrgb&w=1440 | Landiva Weber（@Diva） | Pexels License |
| `sdxl-base`（银灰雾桥） | `sdxl-base.webp` | https://www.pexels.com/photo/minimalist-black-and-white-bridge-structure-in-fog-36650581/ | https://images.pexels.com/photos/36650581/pexels-photo-36650581.jpeg?auto=compress&cs=tinysrgb&w=1440 | Peter Dyllong | Pexels License |
| `flux2-klein-4b`（深紫棱镜） | `flux2-klein-4b.webp` | https://www.pexels.com/photo/close-up-of-purple-crystals-12602053/ | https://images.pexels.com/photos/12602053/pexels-photo-12602053.jpeg?auto=compress&cs=tinysrgb&w=1440 | Merlin Lightpainting（@Merlin） | Pexels License |
| `hyper-sdxl-8step`（暖红/橙高速流光） | `hyper-sdxl-8step.webp` | https://www.pexels.com/photo/orange-flame-in-motion-16577538/ | https://images.pexels.com/photos/16577538/pexels-photo-16577538.jpeg?auto=compress&cs=tinysrgb&w=1440 | Luis Quintero（@jibarofoto） | Pexels License |
| `playground-v2.5`（柔和梦幻 pastel 云层） | `playground-v2.5.webp` | https://www.pexels.com/photo/pink-clouds-in-the-evening-15113217/ | https://images.pexels.com/photos/15113217/pexels-photo-15113217.jpeg?auto=compress&cs=tinysrgb&w=1440 | CECILE HOURNAU | Pexels License |
| `realvis-v5`（写实人像、自然光） | `realvis-v5.webp` | https://www.pexels.com/photo/portrait-of-young-woman-4588666/ | https://images.pexels.com/photos/4588666/pexels-photo-4588666.jpeg?auto=compress&cs=tinysrgb&w=1440 | ArtHouse Studio（@ArtHouseStudio） | Pexels License |
| `animagine-xl-3.1`（二次元） | `animagine-xl-3.1.webp` | https://www.pexels.com/photo/anime-street-scene-in-tokyo-with-cyclist-36942551/ | https://images.pexels.com/photos/36942551/pexels-photo-36942551.jpeg?auto=compress&cs=tinysrgb&w=1440 | Iban Lopez Luna | Pexels License |
| `anima-light-lavender`（二次元角色手办特写） | `anima-light-lavender.webp` | https://www.pexels.com/photo/colorful-anime-figure-on-display-stand-38293324/ | https://images.pexels.com/photos/38293324/pexels-photo-38293324.jpeg?auto=compress&cs=tinysrgb&w=1440 | Fenn（@fenn） | Pexels License |

前 4 张的来源记录迁移自 `design-demos/assets/SOURCES.md`；`playground-v2.5` 等 4 张为 2026-11-11 扩容时新增；`anima-light-lavender` 为 2026-11-11 本轮新增，页面 URL 已实测 HTTP 200，原图下载日期同为 2026-11-11。

## 关于 `animagine-xl-3.1` 的选图说明

Pexels 上没有真正意义上的二次元插画：`anime illustration`、`anime girl`、`manga`、`anime artwork`、`ai generated` 等搜索结果均为 cosplay 照片、街景或 AI 概念示意图。
最终选的是东京动漫广告牌街景——画面主体是一整面二次元角色插画，56×56 缩略下仍能读出「二次元」，但不是单纯的插画。
若必须换成纯插画，可从 Pixabay 取图（其 Content License 同样允许商用、免署名），需要产品侧确认后再替换。

## 关于 `anima-light-lavender` 的选图说明

`anima-light-lavender` 是二次元插画模型，海报需要「二次元 / 插画感」。Pexels 仍没有真正意义上的二次元插画：`anime illustration`、`anime art` 等搜索结果为 cosplay 照片、街景或数字壁纸。
本轮选 Fenn 的二次元角色手办特写：画面主体是动漫角色的脸部（大眼睛、橙发、王冠、红发饰），112×112 与 56×56 缩略下都能直接读出「二次元」，与 `animagine-xl-3.1` 的街景海报形成区分；不做调色、不加文字。

该图是物理手办的照片，只作「概念示意」，不是 `anima-light-lavender` 模型的出图样例。