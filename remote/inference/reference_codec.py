"""参考图（垫图重绘）与蒙版（局部重绘）编解码：提交期只读图片头，执行期完整解码一次。

阶段十五 Phase C1 起本模块还负责**模型原生参考图**（``referenceImages``）的编解码：
提交期 ``parse_reference_images`` 只读图片头（loader 白名单、张数、逐项 ``image_b64``、
体积 / PNG-JPEG / 最小长边），执行期 ``decode_reference_images`` 逐张完整解码、转 RGB、
长边超限等比缩小——与 ``reference``（单图垫图，吃 strength、尺寸跟随参考图）是两条互斥
路径，共用同一套图片解码口径（``_decode_image_payload``）。

为什么从 daemon.py 拆出来：这一组逻辑只依赖 Pillow 与「参考图/蒙版边界」，不碰 HTTP、队列与
模型状态，拆成模块后可以单独导入与测试（daemon 只保留同名薄包装）。

依赖注入：边界 ``limits_for(name) -> dict`` 与 loader 白名单 ``img2img_loaders`` /
``inpaint_loaders`` / ``reference_loaders`` 由调用方传入，本模块不读 daemon 的全局 ``CONFIG``，
避免子模块反向依赖入口文件。Pillow 仍然是函数内延迟导入：模块加载期不能把 PIL 拉起来
（daemon 顶层只允许标准库）。

蒙版语义（跨端契约）：客户端导出的黑白 PNG，**白色 = 重绘区域，黑色 = 保留区域**，随参考图
一起提交（job 级 ``reference.mask_b64``）。提交期只校验 base64 / PNG / 体积 / loader 白名单；
执行期完整解码恰好一次，转灰度 ``'L'`` 并精确对齐到参考图宽高（尺寸不一致时最近邻缩放）。
对齐后统计白色覆盖率：低于 ``contract.limits.mask.minCoverage`` 的空蒙版在加载模型前抛
``RequestError``（job 收敛为 invalid_request），全白（整图重绘）允许；羽化半径按覆盖率
自适应（见模块顶部常量）。带蒙版时 ``strength`` 上限取 ``contract.limits.strength.inpaintMax``，
普通垫图仍用 ``max``。

高清放大（``tool=upscale``）的源图也走本模块：``parse_upscale_reference`` 复用参考图的
头部校验（PNG/JPEG、体积、``minEdge``），但不查 loader 白名单、不读 strength、不允许蒙版，
并额外要求长边 ≤ ``contract.limits.upscale.maxInputEdge``。
"""

from __future__ import annotations

import base64
import binascii
import io
import math

from remote.errors import RequestError

# 参考图允许的容器格式（PIL ``img.format``）：只接受无损 PNG 与常见照片 JPEG。
REFERENCE_IMAGE_FORMATS = ("PNG", "JPEG")

# 原生参考生图（``referenceImages``，阶段十五 Phase C1）逐项允许的字段：只有图片本体。
# 与 ``reference``（单图垫图）刻意隔离——原生参考没有 strength / mask 语义，多传即拒绝，
# 避免把「重绘强度」这个只对 img2img 有意义的参数误当成模型条件的一部分。
REFERENCE_IMAGE_ITEM_FIELDS = ("image_b64",)

# 局部重绘蒙版的边界处理：二进制硬边会让 4 通道 inpaint 路径留下可见矩形接缝。
# 做法是「先按蒙版规模外扩白色区域，再做高斯羽化」，让边界有一段过渡带；
# 出图后再用同一张羽化蒙版把原图未涂抹区域贴回（见 ``composite_inpaint_image``）。
#
# 外扩/羽化半径按蒙版覆盖率自适应（覆盖率 = 白色重绘像素 / 全图像素）：
#  - < 0.5%：精细小蒙版（眼睛、嘴唇、花瓣这类局部涂抹），2px 即可，不波及周围像素；
#  - < 5%：中等蒙版，4px 兼顾盖住抗锯齿边缘与笔画精细度；
#  - 更大：按短边 0.8% 计算并钳在 6~8px，大蒙版需要更宽的过渡带才不露接缝。
# 阈值与半径是首版估计（真机复验后可调），改动时同步 ``test/remote/test_reference.py``。
MASK_FEATHER_TINY_COVERAGE = 0.005
MASK_FEATHER_SMALL_COVERAGE = 0.05
MASK_FEATHER_TINY_RADIUS = 2
MASK_FEATHER_SMALL_RADIUS = 4
MASK_FEATHER_LARGE_RATIO = 0.008
MASK_FEATHER_LARGE_MIN_RADIUS = 6
MASK_FEATHER_LARGE_MAX_RADIUS = 8
# 旧调用方显式传 ``ratio`` 时的钳制范围（正常路径按覆盖率分档，不再使用该参数）。
MASK_FEATHER_RATIO_MIN_RADIUS = 2
MASK_FEATHER_RATIO_MAX_RADIUS = 8
# 蒙版「白色」判定阈值：客户端导出的是 0/255 二值图，抗锯齿边缘按半亮以上算重绘区域。
MASK_COVERAGE_WHITE_THRESHOLD = 128
# 空蒙版拦截阈值的兜底值（契约 ``contract.limits.mask.minCoverage`` 缺失时使用）。
MASK_MIN_COVERAGE_DEFAULT = 0.0005
# 蒙版允许的容器格式：客户端导出的黑白二值图，只接受无损 PNG（有损格式会在边界造灰边）。
MASK_IMAGE_FORMATS = ("PNG",)


def _coerce_strength(value, *, limits_for, has_mask: bool = False) -> float:  # noqa: ANN001
    """重绘强度归一到 ``contract.limits.strength``：非法/缺失回退默认值，越界钳制。

    上限按场景区分：``has_mask`` 为真时取 ``inpaintMax``（缺省回落 ``max``），
    普通垫图仍用 ``max``——契约只放宽局部重绘，img2img 的保守上限不变。
    """
    limits = limits_for("strength")
    low = float(limits.get("min", 0.0))
    high = float(limits.get("max", 1.0))
    if has_mask:
        high = float(limits.get("inpaintMax", high))
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
    最小长边与 strength 钳制（带蒙版时上限为 ``inpaintMax``，否则为 ``max``）。``raw.mask_b64``
    存在时再按局部重绘校验一遍：loader 必须同时在 ``inpaint_loaders`` 白名单里（服务端独立
    兜底，不依赖前端置灰）、蒙版只接受 PNG、体积按 ``contract.limits.mask.maxBytes``，此时
    额外返回 ``mask_bytes`` / ``mask_width`` / ``mask_height``。返回 None 表示文生图请求
    （行为与改造前一致）。
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
        # 带蒙版时按 inpaintMax 归一（提交期已判断过 has_mask），否则仍用 max。
        "strength": _coerce_strength(
            raw.get("strength"), limits_for=limits_for, has_mask=has_mask
        ),
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


def parse_reference_images(raw, pipeline_spec: dict, *, limits_for, reference_loaders):  # noqa: ANN001
    """提交期校验 job 级原生参考图列表（``referenceImages``），归一成 ``{items: [...]}``。

    口径（阶段十五 Phase C1，与单图垫图的 ``reference`` 完全隔离）：

    - 只允许 ``supports_reference`` 的 loader（当前只有 ``flux2``）——非支持模型收到参考图
      必须显式 400，不能静默丢弃（否则用户以为用上了参考图，成片却与参考图无关）；
    - 数组长度 1..``limits.referenceImages.maxCount``；
    - 逐项只认 ``image_b64``：原生参考走基础管线的 ``image=[PIL...]`` 条件，没有 strength /
      蒙版语义，多传字段直接拒绝，避免把只对 img2img 有效的参数误当模型条件；
    - base64 合法、原始字节 <= ``maxBytes``、PNG/JPEG、长边 >= ``minEdge``；
    - **只读图片头**；完整解码、转 RGB 与长边缩放留到执行期 ``decode_reference_images`` 做一次。

    ``raw`` 为 None 表示文生图（行为与改造前一致）。与 ``reference`` 的互斥在
    ``remote/transport/validator.py`` 的 ``validate_generate_spec`` 里统一拦截。
    """
    if raw is None:
        return None
    limits = limits_for("referenceImages")
    loader = str(pipeline_spec.get("loader") or "").strip()
    if loader not in reference_loaders:
        raise RequestError(
            f"该模型不支持参考生图（首期仅开放原生参考模型，当前 loader={loader or '未知'}）"
        )
    if not isinstance(raw, list):
        raise RequestError("referenceImages 必须是数组")
    if not raw:
        raise RequestError("referenceImages 不能为空数组")
    max_count = int(limits.get("maxCount") or 0)
    if max_count > 0 and len(raw) > max_count:
        raise RequestError(f"参考图最多 {max_count} 张（收到 {len(raw)} 张）")
    max_bytes = int(limits.get("maxBytes") or 0)
    min_edge = int(limits.get("minEdge") or 0)
    items = []
    for index, entry in enumerate(raw):
        label = f"第 {index + 1} 张参考图"
        if not isinstance(entry, dict):
            raise RequestError(f"{label}必须是对象")
        unknown = sorted(set(entry) - set(REFERENCE_IMAGE_ITEM_FIELDS))
        if unknown:
            raise RequestError(
                f"{label}只支持 image_b64 字段（收到 {', '.join(unknown)}）；"
                "原生参考生图没有 strength 与蒙版语义"
            )
        data = _decode_base64_field(
            entry.get("image_b64"), f"referenceImages[{index}].image_b64", max_bytes, label=label
        )
        image = _open_image_header(
            bytes(data), formats=REFERENCE_IMAGE_FORMATS, label=label, min_edge=min_edge
        )
        try:
            width, height = image.size
        finally:
            _close_quietly(image)
        items.append({"image_bytes": data, "width": int(width), "height": int(height)})
    return {"items": items}


def parse_upscale_reference(raw, *, limits_for) -> dict:  # noqa: ANN001
    """``tool=upscale`` 的源图提交期校验：只读图片头，归一成 ``{image_bytes, width, height}``。

    与 :func:`parse_reference_spec` 的差别（INTERFACES §2.1）：

    - 不查 loader 白名单、不读 strength：超分固定用 Real-ESRGAN，与扩散模型无关；
    - 不允许 ``mask_b64``：超分没有「重绘区域」概念，带蒙版说明客户端拼错了请求；
    - 源图长边必须 ≤ ``limits.upscale.maxInputEdge``：超分是像素级任务，「先缩小再放大」
      等于主动丢细节，宁可 400 让客户端换源图，也不静默缩图后当成高清放大（无意义放大）。

    其余口径与参考图一致（PNG/JPEG、``limits.reference.maxBytes``、``minEdge``）；
    返回的 ``image_bytes`` 供执行期 ``decode_reference_image`` 再完整解码一次。
    """
    if raw is None:
        raise RequestError("tool=upscale 需要 reference.image_b64")
    if not isinstance(raw, dict):
        raise RequestError("reference 必须是对象")
    if raw.get("mask_b64") is not None:
        raise RequestError("高清放大不支持蒙版（reference.mask_b64 必须省略）")
    data = _decode_base64_field(
        raw.get("image_b64"),
        "reference.image_b64",
        int(limits_for("reference").get("maxBytes") or 0),
        label="源图",
    )
    image = _open_reference_image(data, limits_for=limits_for)
    try:
        width, height = image.size
    finally:
        _close_quietly(image)
    width, height = int(width), int(height)
    max_input_edge = int(limits_for("upscale").get("maxInputEdge") or 0)
    long_edge = max(width, height)
    if max_input_edge > 0 and long_edge > max_input_edge:
        raise RequestError(
            f"源图长边 {long_edge}px 超过高清放大的上限 {max_input_edge}px，"
            "请先缩小源图再放大"
        )
    return {"image_bytes": data, "width": width, "height": height}


def _decode_image_payload(data: bytes, *, label: str, max_edge: int, min_edge: int = 0):  # noqa: ANN202
    """执行期完整解码一张图片一次：转 RGB，长边超过 ``max_edge`` 时等比 LANCZOS 缩小。

    参考图（单图垫图）与原生参考图列表共用同一套解码口径：提交期只读过图片头，这里才真正
    解压像素；截断/损坏图片收敛成 ``RequestError``（job → invalid_request）。不写盘、不缓存。
    原始尺寸挂在 ``_imagen_source_size`` 上，供 run_task 打「原尺寸 → 送入尺寸」日志。
    """
    image = _open_image_header(
        bytes(data), formats=REFERENCE_IMAGE_FORMATS, label=label, min_edge=min_edge
    )
    source_size = image.size
    try:
        try:
            image.load()
        except Exception as exc:  # noqa: BLE001 - 截断/损坏图片按请求非法收敛
            raise RequestError(f"{label}无法解码：{type(exc).__name__}") from None
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
    # 这样 run_tasks / run_task 只需要多收参考图，不必再加元参数。
    try:
        image._imagen_source_size = source_size
    except Exception:  # pragma: no cover - PIL Image 允许挂属性，仅作防御
        pass
    return image


def decode_reference_image(reference: dict, *, limits_for) -> object:  # noqa: ANN001
    """执行期完整解码参考图一次：转 RGB，长边超过 ``maxEdge`` 时等比 LANCZOS 缩小。

    返回可直接喂给图生图 / 局部重绘 / 超分管线的 PIL Image；解码失败抛 ``RequestError``
    （job 收敛为 invalid_request）。原始尺寸挂在 ``_imagen_source_size`` 上，供 run_task 打日志。
    """
    if not isinstance(reference, dict):
        raise RequestError("reference 必须是对象")
    data = reference.get("image_bytes")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise RequestError("参考图数据缺失，无法解码")
    limits = limits_for("reference")
    return _decode_image_payload(
        bytes(data),
        label="参考图",
        max_edge=int(limits.get("maxEdge") or 0),
        min_edge=int(limits.get("minEdge") or 0),
    )


def decode_reference_images(reference_images, *, limits_for) -> list:  # noqa: ANN001
    """执行期把原生参考图列表完整解码一次（整批共用，不写盘）。

    与 :func:`decode_reference_image` 口径一致（PNG/JPEG、``minEdge``、转 RGB、长边超
    ``referenceImages.maxEdge`` 等比缩小），区别只是逐个解码成一个列表，供 ``run_task``
    以 ``image=[PIL...]`` 传给基础管线。任一张失败都会先关闭已解码的图片再抛
    ``RequestError``，不泄漏文件句柄。
    """
    if not isinstance(reference_images, dict):
        raise RequestError("referenceImages 必须是对象")
    items = reference_images.get("items")
    if not isinstance(items, list) or not items:
        raise RequestError("参考图数据缺失，无法解码")
    limits = limits_for("referenceImages")
    max_edge = int(limits.get("maxEdge") or 0)
    min_edge = int(limits.get("minEdge") or 0)
    images = []
    try:
        for index, item in enumerate(items):
            label = f"第 {index + 1} 张参考图"
            data = item.get("image_bytes") if isinstance(item, dict) else None
            if not isinstance(data, (bytes, bytearray)) or not data:
                raise RequestError(f"{label}数据缺失，无法解码")
            images.append(
                _decode_image_payload(
                    bytes(data), label=label, max_edge=max_edge, min_edge=min_edge
                )
            )
    except Exception:
        for image in images:
            _close_quietly(image)
        raise
    return images


def decode_mask_image(mask: dict, *, size, limits_for) -> object:  # noqa: ANN001
    """执行期完整解码蒙版一次：转灰度 ``'L'``，并精确对齐到参考图宽高。

    ``size`` 是参考图实际送入模型的 ``(width, height)``。蒙版尺寸与之不一致时按**最近邻**
    缩放：蒙版是黑白二值图，双线性 / 三次插值会造出灰边，让边界像素变成「半重绘」，
    表现为重绘区域被削弱或溢出。返回的 PIL Image 可直接作为 ``mask_image`` 传给 inpaint
    管线；原始尺寸挂在 ``_imagen_source_size``、白色覆盖率挂在 ``_imagen_coverage`` 上，
    供 run_task 打日志、execute_job 挑羽化档位与回传结果字段。

    对齐后统计白色（重绘）区域覆盖率：低于 ``contract.limits.mask.minCoverage`` 视为空蒙版
    （典型场景是外部直接传全黑 PNG），抛 ``RequestError`` 让 job 在加载模型前收敛为
    invalid_request；全白（整图重绘）是合法请求，必须放行。
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
    coverage = mask_coverage(image)
    min_coverage = float(limits_for("mask").get("minCoverage", MASK_MIN_COVERAGE_DEFAULT))
    if coverage is not None and coverage < min_coverage:
        _close_quietly(image)
        raise RequestError(
            f"蒙版是空的：没有涂抹任何区域（白色覆盖率 {coverage:.4%}，"
            f"低于 {min_coverage:.4%}）；请在参考图上涂抹需要重绘的区域后重试"
        )
    try:
        image._imagen_source_size = source_size
        image._imagen_coverage = coverage
    except Exception:  # pragma: no cover - PIL Image 允许挂属性，仅作防御
        pass
    return image


def mask_coverage(image) -> float | None:  # noqa: ANN001
    """统计蒙版白色（重绘区域）像素占比，返回 0.0~1.0；非 PIL 对象返回 None。

    兼容离线单测的假图替身：无法做像素统计时返回 None，调用方据此跳过空蒙版拦截
    （真实运行环境由 Pillow 保证可统计）。``convert('L')`` 对已是灰度的图返回自身，不复制。
    """
    try:
        from PIL import Image
    except Exception:  # pragma: no cover - 无 Pillow 的离线环境
        return None
    try:
        if not isinstance(image, Image.Image):
            return None
        histogram = image.convert("L").histogram()
    except Exception:  # pragma: no cover - 异常图不应被误判成空蒙版
        return None
    total = sum(histogram)
    if total <= 0:
        return 0.0
    return sum(histogram[MASK_COVERAGE_WHITE_THRESHOLD:]) / float(total)


def feather_radius_for(size, coverage=None) -> int:  # noqa: ANN001
    """按蒙版尺寸与覆盖率挑羽化半径（像素）：小蒙版精细、大蒙版过渡宽。

    覆盖率未知（旧调用 / 非 PIL 替身）时按大蒙版档处理，保持改造前的保守过渡带。
    """
    short_edge = min(max(1, int(size[0])), max(1, int(size[1])))
    if coverage is not None and coverage < MASK_FEATHER_TINY_COVERAGE:
        return MASK_FEATHER_TINY_RADIUS
    if coverage is not None and coverage < MASK_FEATHER_SMALL_COVERAGE:
        return MASK_FEATHER_SMALL_RADIUS
    radius = int(round(short_edge * MASK_FEATHER_LARGE_RATIO))
    return max(MASK_FEATHER_LARGE_MIN_RADIUS, min(MASK_FEATHER_LARGE_MAX_RADIUS, radius))


def feather_mask_image(mask, *, ratio=None, coverage=None):  # noqa: ANN001
    """把二值蒙版做「外扩 + 羽化」，返回新的灰度 ``'L'`` 图（调用方负责关闭入参）。

    为什么需要：蒙版是硬边黑白图，而 SDXL 底座走的是 4 通道「每步把未涂抹区域混回」
    路径，边界没有专门融合能力，硬边会留下可见的矩形接缝。先把白色区域向外扩一圈
    （盖住涂抹边缘的抗锯齿像素），再用高斯羽化造一段过渡带；出图后再用同一张羽化蒙版
    把原图未涂抹区域贴回（``composite_inpaint_image``）。

    半径按蒙版覆盖率自适应（见模块顶部常量）：``coverage`` 由 execute_job 传入
    （decode_mask_image 已统计过），缺省时这里现算一次；``ratio`` 是旧调用方的显式
    短边比例，仅排障用。

    非 PIL 图像（离线测试替身）原样返回，不做像素处理；返回值上挂
    ``_imagen_source_size`` / ``_imagen_coverage`` / ``_imagen_feather_radius`` 供日志使用。
    """
    try:
        from PIL import Image, ImageFilter
    except Exception:  # pragma: no cover - 无 Pillow 的离线环境
        return mask
    if not isinstance(mask, Image.Image):
        return mask
    width, height = mask.size
    if coverage is None:
        coverage = mask_coverage(mask)
    if ratio is None:
        radius = feather_radius_for(mask.size, coverage)
    else:
        short_edge = min(int(width), int(height))
        radius = int(round(short_edge * float(ratio)))
        radius = max(MASK_FEATHER_RATIO_MIN_RADIUS, min(MASK_FEATHER_RATIO_MAX_RADIUS, radius))
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
        work._imagen_coverage = coverage
        work._imagen_feather_radius = radius
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
