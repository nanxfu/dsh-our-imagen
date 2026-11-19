#!/usr/bin/env python3
"""阶段十七真机验收的本地图像分析工具（Pillow + numpy）。

只被 `tools/colab/acceptance-17.mjs` 调用，不参与产品运行时。之所以做成独立脚本：
PNG 解码 / 蒙版覆盖率 / 像素差这些事用 Pillow 最快，而 Node 侧只需要读一份 JSON。

**为什么结果写文件而不是 stdout**：本机 DSH 沙箱下 Node 的 `spawnSync` 用管道
捕获子进程输出会 EPERM（Windows 命名管道被拦），因此统一用 `--out <json>` 落盘，
Node 侧以 `stdio: 'ignore'` 启动后读文件。

子命令（统一要求 `--out`）：

  inspect <png>
      颜色模式 / 尺寸 / 是否含 alpha / alpha 取值分布 / PNG IHDR 颜色类型。
  mask <src.png> <out.png> <coverage>
      以源图尺寸画居中白色实心圆蒙版（白=重绘区域），覆盖率约等于 coverage。
  resize <src.png> <out.png> <maxEdge>
      等比缩小到长边不超过 maxEdge（不放大），转 RGB 后存 PNG（供多图参考）。
  diff <a.png> <b.png>
      两张同尺寸图的平均绝对差 / 变化像素比例 / 分通道均值。
  masked-diff <gen.png> <ref.png> <mask.png> <pad>
      局部重绘保真评估：按 pad 像素膨胀/腐蚀蒙版，分别统计
      保留区（蒙版外，含核心区）、羽化过渡带、重绘区（蒙版内核心）的像素差。
"""

import argparse
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# PNG IHDR 里的颜色类型（第 25 字节）：0=灰度 2=RGB 3=调色板 4=灰度+alpha 6=RGBA
PNG_COLOR_TYPE_LABELS = {
    0: "grayscale",
    2: "rgb",
    3: "palette",
    4: "grayscale+alpha",
    6: "rgba",
}
# 像素差阈值：任一通道差 > 8/255 记为「变化像素」（与既有真机验收口径一致）。
CHANGED_THRESHOLD = 8


def _write_json(path, payload):
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text + "\n")


def _png_header_info(path):
    with open(path, "rb") as handle:
        head = handle.read(33)
    if len(head) < 33 or head[:8] != PNG_MAGIC or head[12:16] != b"IHDR":
        return {"isPng": False, "colorType": None, "colorTypeLabel": None}
    color_type = head[25]
    return {
        "isPng": True,
        "bitDepth": head[24],
        "colorType": color_type,
        "colorTypeLabel": PNG_COLOR_TYPE_LABELS.get(color_type, f"unknown({color_type})"),
    }


def _rgb_array(path):
    """读成 uint8 RGB 数组（RGB / RGBA / 调色板都统一到 RGB）。"""
    import numpy as np

    with Image.open(path) as image:
        rgb = image.convert("RGB")
        return np.asarray(rgb, dtype=np.int16)


def _stats(diff, region):
    """统计某区域（布尔掩码）内的像素差指标。"""
    import numpy as np

    pixels = int(region.sum())
    if pixels == 0:
        return {"pixels": 0, "meanAbsDiff": None, "changedRatio": None, "maxAbsDiff": None}
    values = diff[region]
    return {
        "pixels": pixels,
        "meanAbsDiff": round(float(values.mean()), 4),
        "changedRatio": round(float((values.max(axis=1) > CHANGED_THRESHOLD).mean()), 4),
        "maxAbsDiff": int(values.max()),
    }


def cmd_inspect(args):
    path = os.path.abspath(args.png)
    info = {
        "ok": True,
        "path": path,
        "bytes": os.path.getsize(path),
        "width": None,
        "height": None,
        "format": None,
        "mode": None,
        "hasAlphaChannel": None,
        "alpha": None,
    }
    info.update(_png_header_info(path))
    with Image.open(path) as image:
        info["format"] = image.format
        info["mode"] = image.mode
        info["width"], info["height"] = image.size
        has_alpha = "A" in image.getbands() or "transparency" in image.info
        info["hasAlphaChannel"] = bool(has_alpha)
        info["hasTransparencyChunk"] = "transparency" in image.info
        if has_alpha:
            import numpy as np

            alpha = np.asarray(image.convert("RGBA"), dtype=np.uint8)[:, :, 3]
            unique, counts = np.unique(alpha, return_counts=True)
            top = sorted(zip(unique.tolist(), counts.tolist()), key=lambda item: -item[1])[:8]
            info["alpha"] = {
                "uniqueCount": int(unique.size),
                "min": int(unique.min()),
                "max": int(unique.max()),
                "transparentRatio": round(float((alpha == 0).mean()), 4),
                "opaqueRatio": round(float((alpha == 255).mean()), 4),
                "topValues": [{"value": int(v), "count": int(c)} for v, c in top],
            }
    return info


def cmd_mask(args):
    with Image.open(args.src) as source:
        width, height = source.size
    coverage = float(args.coverage)
    if not 0.0 < coverage < 1.0:
        raise ValueError(f"覆盖率必须在 (0,1) 之间：{coverage}")
    radius = math.sqrt(coverage * width * height / math.pi)
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = width / 2.0, height / 2.0
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)
    out = os.path.abspath(args.outPng)
    mask.save(out, format="PNG")
    import numpy as np

    white = int((np.asarray(mask, dtype=np.uint8) > 127).sum())
    return {
        "ok": True,
        "path": out,
        "width": width,
        "height": height,
        "radius": round(radius, 2),
        "whitePixels": white,
        "coverage": round(white / (width * height), 4),
        "bytes": os.path.getsize(out),
    }


def cmd_resize(args):
    max_edge = int(args.maxEdge)
    out = os.path.abspath(args.outPng)
    with Image.open(args.src) as source:
        source = source.convert("RGB")
        src_width, src_height = source.size
        scale = min(1.0, max_edge / float(max(src_width, src_height)))
        target = (max(1, int(round(src_width * scale))), max(1, int(round(src_height * scale))))
        if target != source.size:
            source = source.resize(target, Image.LANCZOS)
        source.save(out, format="PNG")
    return {
        "ok": True,
        "path": out,
        "sourceWidth": src_width,
        "sourceHeight": src_height,
        "width": target[0],
        "height": target[1],
        "bytes": os.path.getsize(out),
    }


def cmd_diff(args):
    import numpy as np

    left = _rgb_array(args.a)
    right = _rgb_array(args.b)
    if left.shape != right.shape:
        raise ValueError(f"尺寸不一致：{args.a}={left.shape[:2]}，{args.b}={right.shape[:2]}")
    diff = np.abs(left - right)
    per_pixel = diff.max(axis=2)
    return {
        "ok": True,
        "a": os.path.abspath(args.a),
        "b": os.path.abspath(args.b),
        "width": int(left.shape[1]),
        "height": int(left.shape[0]),
        "meanAbsDiff": round(float(diff.mean()), 4),
        "changedRatio": round(float((per_pixel > CHANGED_THRESHOLD).mean()), 4),
        "maxAbsDiff": int(diff.max()),
        "perChannelMean": [round(float(diff[:, :, index].mean()), 4) for index in range(3)],
    }


def cmd_masked_diff(args):
    import numpy as np

    generated = _rgb_array(args.gen)
    reference = _rgb_array(args.ref)
    if generated.shape != reference.shape:
        raise ValueError("生成图与参考图尺寸不一致")
    with Image.open(args.mask) as mask_image:
        mask_gray = mask_image.convert("L")
        if mask_gray.size != (generated.shape[1], generated.shape[0]):
            mask_gray = mask_gray.resize((generated.shape[1], generated.shape[0]), Image.NEAREST)
        # 二进制硬边的内外两侧各让出 pad 像素再做统计：外扩区含羽化过渡带，腐蚀区才是
        # 「确定被重绘」的核心。size 必须是奇数。
        size = 2 * int(args.pad) + 1
        dilated = np.asarray(mask_gray.filter(ImageFilter.MaxFilter(size))) > 127
        eroded = np.asarray(mask_gray.filter(ImageFilter.MinFilter(size))) > 127

    white = np.asarray(mask_gray, dtype=np.uint8) > 127
    diff = np.abs(generated - reference)
    return {
        "ok": True,
        "gen": os.path.abspath(args.gen),
        "ref": os.path.abspath(args.ref),
        "mask": os.path.abspath(args.mask),
        "pad": int(args.pad),
        "coverage": round(float(white.mean()), 4),
        "keepAll": _stats(diff, ~white),
        "keepCore": _stats(diff, ~dilated),
        "featherBand": _stats(diff, dilated & ~eroded),
        "repaintCore": _stats(diff, eroded),
        "repaintAll": _stats(diff, white),
    }


def build_parser():
    # --out 挂在每个子命令上（而不是顶层）：调用方习惯把参数按「子命令 + 位置参数 + 选项」
    # 顺序拼起来，顶层 required 选项排在子命令之后会解析失败。
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out", required=True, help="结果 JSON 落盘路径")
    parser = argparse.ArgumentParser(description="阶段十七真机验收的图像分析工具")
    sub = parser.add_subparsers(dest="command", required=True)

    inspect_parser = sub.add_parser("inspect", parents=[common], help="检查 PNG 的颜色模式与 alpha")
    inspect_parser.add_argument("png")
    inspect_parser.set_defaults(handler=cmd_inspect)

    mask_parser = sub.add_parser("mask", parents=[common], help="生成居中圆蒙版")
    mask_parser.add_argument("src")
    mask_parser.add_argument("outPng")
    mask_parser.add_argument("coverage", type=float)
    mask_parser.set_defaults(handler=cmd_mask)

    resize_parser = sub.add_parser("resize", parents=[common], help="等比缩到指定长边")
    resize_parser.add_argument("src")
    resize_parser.add_argument("outPng")
    resize_parser.add_argument("maxEdge", type=int)
    resize_parser.set_defaults(handler=cmd_resize)

    diff_parser = sub.add_parser("diff", parents=[common], help="两张同尺寸图逐像素差")
    diff_parser.add_argument("a")
    diff_parser.add_argument("b")
    diff_parser.set_defaults(handler=cmd_diff)

    masked_parser = sub.add_parser("masked-diff", parents=[common], help="按蒙版分区统计像素差")
    masked_parser.add_argument("gen")
    masked_parser.add_argument("ref")
    masked_parser.add_argument("mask")
    masked_parser.add_argument("pad", type=int)
    masked_parser.set_defaults(handler=cmd_masked_diff)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    out_path = os.path.abspath(args.out)
    try:
        payload = args.handler(args)
    except Exception as exc:  # noqa: BLE001 - 任何异常都收敛成 JSON，方便 Node 侧报错
        payload = {"ok": False, "command": args.command, "error": f"{type(exc).__name__}: {exc}"}
        _write_json(out_path, payload)
        print(f"image-analysis {args.command} 失败：{payload['error']}", file=sys.stderr)
        return 1
    _write_json(out_path, payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
