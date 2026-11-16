"""参考图（垫图重绘）与蒙版（局部重绘）编解码：提交期只读图片头，执行期完整解码一次。

为什么从 daemon.py 拆出来：这一组逻辑只依赖 Pillow 与「参考图/蒙版边界」，不碰 HTTP、队列与
模型状态，拆成模块后可以单独导入与测试（daemon 只保留同名薄包装）。

依赖注入：边界 ``limits_for(name) -> dict`` 与 loader 白名单 ``img2img_loaders`` /
``inpaint_loaders`` 由调用方传入，本模块不读 daemon 的全局 ``CONFIG``，避免子模块反向依赖
入口文件。Pillow 仍然是函数内延迟导入：模块加载期不能把 PIL 拉起来（daemon 顶层只允许标准库）。

蒙版语义（跨端契约）：客户端导出的黑白 PNG，**白色 = 重绘区域，黑色 = 保留区域**，随参考图
一起提交（job 级 ``reference.mask_b64``）。提交期只校验 base64 / PNG / 体积 / loader 白名单；
执行期完整解码恰好一次，转灰度 ``'L'`` 并精确对齐到参考图宽高（尺寸不一致时最近邻缩放）。
"""

from __future__ import annotations

import base64
import binascii
import io
import math

from remote.errors import RequestError

# 参考图允许的容器格式（PIL ``img.format``）：只接受无损 PNG 与常见照片 JPEG。
REFERENCE_IMAGE_FORMATS = ("PNG", "JPEG")

# 局部重绘蒙版的边界处理：二进制硬边会让 4 通道 inpaint 路径留下可见矩形接缝。
# 做法是「先按短边比例外扩白色区域，再做高斯羽化」，让边界有一段过渡带；
# 出图后再用同一张羽化蒙版把原图未涂抹区域贴回（见 ``composite_inpaint_image``）。
MASK_FEATHER_RATIO = 0.008
MASK_FEATHER_MIN_RADIUS = 2
MASK_FEATHER_MAX_RADIUS = 24
# 蒙版允许的容器格式：客户端导出的黑白二值图，只接受无损 PNG（有损格式会在边界造灰边）。
MASK_IMAGE_FORMATS = ("PNG",)


def _coerce_strength(value, *, limits_for) -> float:  # noqa: ANN001
    """重绘强度归一到 ``contract.limits.strength``：非法/缺失回退默认值，越界钳制。"""
    limits = limits_for("strength")
    low = float(limits.get("min", 0.0))
    high = float(limits.get("max", 1.0))
    default = float(limits.get("default", 0.6))
    if value is None or isinstance(value, bool):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    # 契约 step 目前是 0.05：保留 4 位小数，避免 0.6000000000000001 这类浮点噪声。
    return round(min(max(number, low), high), 4)


def _open_image_header(image_bytes: bytes, *, formats, label: str, min_edge: int = 0):  # noqa: ANN202
    """只读图片头部：校验容器格式与可选的最小长边，返回未 load 的 PIL Image。

    调用方负责 ``close()``。这里不解码像素，因此提交期就能把「看头部即可发现」的问题
    全部收敛成 400；真正的完整解码只在执行期的 ``decode_*`` 做一次。文案里的 ``label``
    是「参考图」或「蒙版」——两种载荷的检查口径相同，只有叫法与允许的格式不同。
    """
    from PIL import Image, UnidentifiedImageError

    expected = " 或 ".join(formats)
    bomb_error = getattr(Image, "DecompressionBombError", None)
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError:
        raise RequestError(f"{label}必须是 {expected} 图片") from None
    except Exception as exc:  # noqa: BLE001 - 任意解码库异常都收敛为请求非法
        if bomb_error is not None and isinstance(exc, bomb_error):
            raise RequestError(f"{label}分辨率过大，无法处理") from None
        raise RequestError(f"{label}无法解析：{type(exc).__name__}") from None
    image_format = str(getattr(image, "format", "") or "").upper()
    if image_format not in formats:
        image.close()
        raise RequestError(f"{label}必须是 {expected}（收到 {image_format or '未知格式'}）")
    width, height = image.size
    if min_edge > 0 and max(width, height) < min_edge:
        image.close()
        raise RequestError(f"{label}长边至少 {min_edge}px（收到 {width}x{height}）")
    return image


def _open_reference_image(image_bytes: bytes, *, limits_for):  # noqa: ANN001, ANN202
    """只读参考图头部：校验 PNG/JPEG 与最小长边，返回未 load 的 PIL Image。"""
    min_edge = int(limits_for("reference").get("minEdge") or 0)
    return _open_image_header(
        image_bytes, formats=REFERENCE_IMAGE_FORMATS, label="参考图", min_edge=min_edge
    )


def _open_mask_image(image_bytes: bytes):  # noqa: ANN202
    """只读蒙版头部：只接受 PNG，不校验最小长边（蒙版可以比参考图小，执行期再缩放对齐）。"""
    return _open_image_header(image_bytes, formats=MASK_IMAGE_FORMATS, label="蒙版")


def _decode_base64_field(encoded, field: str, max_bytes: int, *, label: str) -> bytes:  # noqa: ANN001
    """校验 base64 文本与原始字节上限，返回解码后的 bytes（错误文案带字段名）。"""
    if not isinstance(encoded, str) or not encoded.strip():
        raise RequestError(f"{field} 必须是非空字符串")
    try:
        data = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError):
        raise RequestError(f"{field} 不是合法 base64") from None
    if not data:
        raise RequestError(f"{field} 解码后为空")
    if max_bytes > 0 and len(data) > max_bytes:
        raise RequestError(f"{label}体积 {len(data)} 字节，超过上限 {max_bytes} 字节")
    return data


def _close_quietly(image) -> None:  # noqa: ANN001
    """关闭 PIL Image；close 失败不影响请求结果，也不该盖掉原异常。"""
    try:
        image.close()
    except Exception:  # pragma: no cover - close 失败不影响请求结果
        pass


def parse_reference_spec(  # noqa: ANN001
    raw, pipeline_spec: dict, *, limits_for, img2img_loaders, inpaint_loaders
):
    """提交期校验 job 级参考图（含可选蒙版），归一成 ``{image_bytes, strength, width, height}``。

    只做「不需要完整解码」的检查：loader 白名单、base64 合法性、原始字节上限、PNG/JPEG、
    最小长边与 strength 钳制。``raw.mask_b64`` 存在时再按局部重绘校验一遍：loader 必须同时
    在 ``inpaint_loaders`` 白名单里（服务端独立兜底，不依赖前端置灰）、蒙版只接受 PNG、
    体积按 ``contract.limits.mask.maxBytes``，此时额外返回 ``mask_bytes`` / ``mask_width`` /
    ``mask_height``。返回 None 表示文生图请求（行为与改造前一致）。
    """
    native_inpaint = pipeline_spec.get("nativeInpaint") is True
    if raw is None:
        if native_inpaint:
            raise RequestError("该模型只支持局部重绘（需要参考图与蒙版），不能文生图")
        return None
    if not isinstance(raw, dict):
        raise RequestError("reference 必须是对象")
    loader = str(pipeline_spec.get("loader") or "").strip()
    has_mask = raw.get("mask_b64") is not None
    if native_inpaint:
        # 专用 inpaint 模型没有蒙版就没有重绘区域，必须直接拦下（不落到 GPU 阶段才报错）。
        if not has_mask:
            raise RequestError("该模型只支持局部重绘：请先以此图重绘并涂抹蒙版")
    else:
        # 带蒙版时用户意图是局部重绘，先给「不支持局部重绘」的精确文案（它同时说明 loader
        # 不在需要的能力名单里）；不带蒙版时才退回垫图文案，保持改造前的话术不变。
        if has_mask and loader not in inpaint_loaders:
            raise RequestError(
                f"该模型不支持局部重绘（首期仅开放 SDXL 家族，当前 loader={loader or '未知'}）"
            )
        if loader not in img2img_loaders:
            raise RequestError(
                f"该模型不支持垫图重绘（首期仅开放 SDXL 家族，当前 loader={loader or '未知'}）"
            )
    data = _decode_base64_field(
        raw.get("image_b64"),
        "reference.image_b64",
        int(limits_for("reference").get("maxBytes") or 0),
        label="参考图",
    )
    image = _open_reference_image(data, limits_for=limits_for)
    try:
        width, height = image.size
    finally:
        _close_quietly(image)
    spec = {
        "image_bytes": data,
        "strength": _coerce_strength(raw.get("strength"), limits_for=limits_for),
        "width": int(width),
        "height": int(height),
    }

    mask_encoded = raw.get("mask_b64")
    if mask_encoded is not None:
        # 白名单已在入口按「带蒙版」判定过；这里只做蒙版载荷本身（base64 / PNG / 体积）。
        mask_bytes = _decode_base64_field(
            mask_encoded,
            "reference.mask_b64",
            int(limits_for("mask").get("maxBytes") or 0),
            label="蒙版",
        )
        mask = _open_mask_image(mask_bytes)
        try:
            mask_width, mask_height = mask.size
        finally:
            _close_quietly(mask)
        spec["mask_bytes"] = mask_bytes
        spec["mask_width"] = int(mask_width)
        spec["mask_height"] = int(mask_height)
    return spec


def decode_reference_image(reference: dict, *, limits_for) -> object:  # noqa: ANN001
    """执行期完整解码参考图一次：转 RGB，长边超过 ``maxEdge`` 时等比 LANCZOS 缩小。

    返回可直接喂给图生图 / 局部重绘管线的 PIL Image；解码失败抛 ``RequestError``（job 收敛为
    invalid_request）。原始尺寸挂在 ``_imagen_source_size`` 上，供 run_task 打日志。
    """
    if not isinstance(reference, dict):
        raise RequestError("reference 必须是对象")
    data = reference.get("image_bytes")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise RequestError("参考图数据缺失，无法解码")
    max_edge = int(limits_for("reference").get("maxEdge") or 0)
    image = _open_reference_image(bytes(data), limits_for=limits_for)
    source_size = image.size
    try:
        try:
            image.load()
        except Exception as exc:  # noqa: BLE001 - 截断/损坏图片按请求非法收敛
            raise RequestError(f"参考图无法解码：{type(exc).__name__}") from None
        if image.mode != "RGB":
            converted = image.convert("RGB")
            _close_quietly(image)
            image = converted
        width, height = image.size
        long_edge = max(width, height)
        if max_edge > 0 and long_edge > max_edge:
            from PIL import Image

            scale = max_edge / float(long_edge)
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            resampling = getattr(Image, "Resampling", None)
            resample = getattr(resampling, "LANCZOS", None)
            if resample is None:  # pragma: no cover - Pillow < 9.1 的旧常量
                resample = getattr(Image, "LANCZOS")
            resized = image.resize(target, resample)
            _close_quietly(image)
            image = resized
    except Exception:
        close_fn = getattr(image, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:  # pragma: no cover
                pass
        raise
    # 「参考图 WxH → 缩放后 WxH」的日志放在 run_task：原尺寸挂在图像对象上，
    # 这样 run_tasks / run_task 只需要多收一个 reference_image，不必再加元参数。
    try:
        image._imagen_source_size = source_size
    except Exception:  # pragma: no cover - PIL Image 允许挂属性，仅作防御
        pass
    return image


def decode_mask_image(mask: dict, *, size) -> object:  # noqa: ANN001
    """执行期完整解码蒙版一次：转灰度 ``'L'``，并精确对齐到参考图宽高。

    ``size`` 是参考图实际送入模型的 ``(width, height)``。蒙版尺寸与之不一致时按**最近邻**
    缩放：蒙版是黑白二值图，双线性 / 三次插值会造出灰边，让边界像素变成「半重绘」，
    表现为重绘区域被削弱或溢出。返回的 PIL Image 可直接作为 ``mask_image`` 传给 inpaint
    管线；原始尺寸挂在 ``_imagen_source_size`` 上，供 run_task 打日志与回传结果字段。
    """
    if not isinstance(mask, dict):
        raise RequestError("reference.mask_b64 缺失，无法解码蒙版")
    data = mask.get("mask_bytes")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise RequestError("蒙版数据缺失，无法解码")
    target = (max(1, int(size[0])), max(1, int(size[1])))
    image = _open_mask_image(bytes(data))
    source_size = image.size
    try:
        try:
            image.load()
        except Exception as exc:  # noqa: BLE001 - 截断/损坏蒙版按请求非法收敛
            raise RequestError(f"蒙版无法解码：{type(exc).__name__}") from None
        if image.mode != "L":
            converted = image.convert("L")
            _close_quietly(image)
            image = converted
        if image.size != target:
            from PIL import Image

            resampling = getattr(Image, "Resampling", None)
            resample = getattr(resampling, "NEAREST", None)
            if resample is None:  # pragma: no cover - Pillow < 9.1 的旧常量
                resample = getattr(Image, "NEAREST")
            resized = image.resize(target, resample)
            _close_quietly(image)
            image = resized
    except Exception:
        close_fn = getattr(image, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:  # pragma: no cover
                pass
        raise
    try:
        image._imagen_source_size = source_size
    except Exception:  # pragma: no cover - PIL Image 允许挂属性，仅作防御
        pass
    return image

def feather_mask_image(mask, *, ratio=None):  # noqa: ANN001
    """把二值蒙版做「外扩 + 羽化」，返回新的灰度 ``'L'`` 图（原地调用方负责关闭入参）。

    为什么需要：蒙版是硬边黑白图，而 SDXL 底座走的是 4 通道「每步把未涂抹区域混回」
    路径，边界没有专门融合能力，硬边会留下可见的矩形接缝。先按短边比例把白色区域
    向外扩一圈（盖住涂抹边缘的抗锯齿像素），再用高斯羽化造一段过渡带；出图后再用
    同一张羽化蒙版把原图未涂抹区域贴回（``composite_inpaint_image``）。

    非 PIL 图像（离线测试替身）原样返回，不做像素处理。
    """
    try:
        from PIL import Image, ImageFilter
    except Exception:  # pragma: no cover - 无 Pillow 的离线环境
        return mask
    if not isinstance(mask, Image.Image):
        return mask
    width, height = mask.size
    short_edge = min(int(width), int(height))
    scale = MASK_FEATHER_RATIO if ratio is None else float(ratio)
    radius = int(round(short_edge * scale))
    radius = max(MASK_FEATHER_MIN_RADIUS, min(MASK_FEATHER_MAX_RADIUS, radius))
    try:
        work = mask.convert("L")
        if work is mask:
            # convert() 对 'L' 图返回自身：复制一份，避免修改调用方持有的对象。
            work = mask.copy()
        # 外扩半径 = 羽化半径，保证「用户涂白的区域」在过渡带里仍接近全白。
        work = work.filter(ImageFilter.MaxFilter(radius * 2 + 1))
        # 高斯半径取外扩的一半：过渡带中心落在原始边界外侧，不侵占涂抹区域内部。
        work = work.filter(ImageFilter.GaussianBlur(radius / 2))
    except Exception:
        return mask
    try:
        work._imagen_source_size = getattr(mask, "_imagen_source_size", mask.size)
    except Exception:  # pragma: no cover - 属性写入失败不影响结果
        pass
    return work


def composite_inpaint_image(generated, original, mask):  # noqa: ANN001
    """把重绘结果按羽化蒙版与原图合成：白区取生成结果，黑区保留原图像素。

    4 通道 inpaint 路径会把整张图过一遍 VAE，未涂抹区域也有 1~2/255 的往返噪声；
    这里按蒙版做一次像素级合成，保证「保留区」真的一个像素都不变，羽化带内自然过渡。

    参数不是 PIL 图像时原样返回生成结果（离线测试替身），不做合成。
    """
    try:
        from PIL import Image
    except Exception:  # pragma: no cover - 无 Pillow 的离线环境
        return generated
    if not (
        isinstance(generated, Image.Image)
        and isinstance(original, Image.Image)
        and isinstance(mask, Image.Image)
    ):
        return generated
    base = original.convert("RGB")
    if base is original:
        base = original.copy()
    sample = generated.convert("RGB")
    if sample is generated:
        sample = generated.copy()
    if sample.size != base.size:
        resampling = getattr(Image, "Resampling", None)
        resample = getattr(resampling, "LANCZOS", None)
        if resample is None:  # pragma: no cover - Pillow < 9.1 的旧常量
            resample = getattr(Image, "LANCZOS")
        sample = sample.resize(base.size, resample)
    cover = mask.convert("L")
    if cover is mask:
        cover = mask.copy()
    if cover.size != base.size:
        resampling = getattr(Image, "Resampling", None)
        resample = getattr(resampling, "NEAREST", None)
        if resample is None:  # pragma: no cover
            resample = getattr(Image, "NEAREST")
        cover = cover.resize(base.size, resample)
    return Image.composite(sample, base, cover)
