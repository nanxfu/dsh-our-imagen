"""参考图（垫图重绘）编解码：提交期只读图片头，执行期完整解码一次。

为什么从 daemon.py 拆出来：这一组逻辑只依赖 Pillow 与「参考图边界」，不碰 HTTP、队列与
模型状态，拆成模块后可以单独导入与测试（daemon 只保留同名薄包装）。

依赖注入：边界 ``limits_for(name) -> dict`` 与 loader 白名单 ``img2img_loaders`` 由调用方
传入，本模块不读 daemon 的全局 ``CONFIG``，避免子模块反向依赖入口文件。Pillow 仍然是
函数内延迟导入：模块加载期不能把 PIL 拉起来（daemon 顶层只允许标准库）。
"""

from __future__ import annotations

import base64
import binascii
import io
import math

from remote.errors import RequestError

# 参考图允许的容器格式（PIL ``img.format``）：只接受无损 PNG 与常见照片 JPEG。
REFERENCE_IMAGE_FORMATS = ("PNG", "JPEG")


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


def _open_reference_image(image_bytes: bytes, *, limits_for):  # noqa: ANN001, ANN202
    """只读参考图头部：校验 PNG/JPEG 与最小长边，返回未 load 的 PIL Image。

    调用方负责 ``close()``。这里不解码像素，因此提交期就能把「看头部即可发现」的问题
    全部收敛成 400；真正的完整解码只在 execute_job 的 ``decode_reference_image`` 做一次。
    """
    from PIL import Image, UnidentifiedImageError

    min_edge = int(limits_for("reference").get("minEdge") or 0)
    bomb_error = getattr(Image, "DecompressionBombError", None)
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError:
        raise RequestError("参考图必须是 PNG 或 JPEG 图片") from None
    except Exception as exc:  # noqa: BLE001 - 任意解码库异常都收敛为请求非法
        if bomb_error is not None and isinstance(exc, bomb_error):
            raise RequestError("参考图分辨率过大，无法处理") from None
        raise RequestError(f"参考图无法解析：{type(exc).__name__}") from None
    image_format = str(getattr(image, "format", "") or "").upper()
    if image_format not in REFERENCE_IMAGE_FORMATS:
        image.close()
        raise RequestError(f"参考图必须是 PNG 或 JPEG（收到 {image_format or '未知格式'}）")
    width, height = image.size
    if min_edge > 0 and max(width, height) < min_edge:
        image.close()
        raise RequestError(f"参考图长边至少 {min_edge}px（收到 {width}x{height}）")
    return image


def parse_reference_spec(raw, pipeline_spec: dict, *, limits_for, img2img_loaders):  # noqa: ANN001
    """提交期校验 job 级参考图，归一成 ``{image_bytes, strength, width, height}``。

    只做「不需要完整解码」的检查：loader 白名单、base64 合法性、原始字节上限、
    PNG/JPEG、最小长边与 strength 钳制。返回 None 表示文生图请求（行为与改造前一致）。
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise RequestError("reference 必须是对象")
    loader = str(pipeline_spec.get("loader") or "").strip()
    if loader not in img2img_loaders:
        raise RequestError(
            f"该模型不支持垫图重绘（首期仅开放 SDXL 家族，当前 loader={loader or '未知'}）"
        )
    encoded = raw.get("image_b64")
    if not isinstance(encoded, str) or not encoded.strip():
        raise RequestError("reference.image_b64 必须是非空字符串")
    max_bytes = int(limits_for("reference").get("maxBytes") or 0)
    try:
        data = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError):
        raise RequestError("reference.image_b64 不是合法 base64") from None
    if not data:
        raise RequestError("reference.image_b64 解码后为空")
    if max_bytes > 0 and len(data) > max_bytes:
        raise RequestError(f"参考图体积 {len(data)} 字节，超过上限 {max_bytes} 字节")
    image = _open_reference_image(data, limits_for=limits_for)
    try:
        width, height = image.size
    finally:
        try:
            image.close()
        except Exception:  # pragma: no cover - close 失败不影响请求结果
            pass
    return {
        "image_bytes": data,
        "strength": _coerce_strength(raw.get("strength"), limits_for=limits_for),
        "width": int(width),
        "height": int(height),
    }


def decode_reference_image(reference: dict, *, limits_for) -> object:  # noqa: ANN001
    """执行期完整解码参考图一次：转 RGB，长边超过 ``maxEdge`` 时等比 LANCZOS 缩小。

    返回可直接喂给图生图管线的 PIL Image；解码失败抛 ``RequestError``（job 收敛为
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
            try:
                image.close()
            except Exception:  # pragma: no cover
                pass
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
            try:
                image.close()
            except Exception:  # pragma: no cover
                pass
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
