"""高清放大（Real-ESRGAN x2plus）：权重下载/校验、checkpoint 解包、RRDBNet 前向与推理。

为什么单独成模块：

- 超分与扩散是两条完全不同的推理路径（没有 prompt / steps / pipeline，只有一次前向），
  塞进 ``daemon.run_task`` 会让本就按 loader 分派的出图逻辑再长出一个大分支；
- **不引入 basicsr / realesrgan**：Kaggle/Colab 现成环境里这两个包要么不装、要么与当前
  torch 版本冲突（basicsr 依赖已废弃的 torchvision 接口），而这里只需要一个 67MB 的 x2
  模型。所以按 Real-ESRGAN 官方 basicsr 实现手写 RRDBNet 结构（``scale=2`` 时
  ``conv_first`` 输入 12 通道 + ``pixel_unshuffle(x, 2)``），权重只从固定 URL 下载并校验
  SHA256——架构与权重一一对应，少一层 pip 依赖。
- 依赖边界：模块顶层**只 import 标准库**；torch / PIL / numpy 一律在函数内延迟导入。
  ``ensure_weight_file`` 注入 ``urlopen`` / ``environ``，``build_rrdbnet`` /
  ``load_model`` / ``upscale_image`` 注入 ``torch_module`` 与 PIL 模块：离线单测用假替身
  就能覆盖「下载校验 / 解包 / 架构分支」，本机再做一次真实权重的数值自检（不进仓库测试）。

权重口径（INTERFACES §2.4，只允许这一份）：

- 高优先 URL 是 HF 镜像，备用是 GitHub Release；两者内容相同；
- 大小 ``67061725`` 字节、SHA256 ``49fafd45…abb`` 固定，任何不符都按 ``LoadError`` 处理；
- 落盘到工作目录下 ``sr/RealESRGAN_x2plus.pth``（``work_dir`` 为空时由调用方传 cwd）；
  进程内只下载一次，之后复用（校验通过直接读，不重复下）。
"""

from __future__ import annotations

import hashlib
import os
import time
import urllib.request

from remote.errors import LoadError
from remote.text import short

# ─────────────────────────────────────────────────────────────────────────────
# 权重来源（唯一允许的两份地址，内容相同）
# ─────────────────────────────────────────────────────────────────────────────

UPSCALE_ID = "realesrgan-x2plus"
UPSCALE_LOADER = "upscale"
# pipeline 描述是 daemon 内部合成值（Host 不会下发）：loader 名与模型 id 由这里唯一维护，
# validator 只消费注入值（不反向 import 本模块，保持协议层与推理层解耦）。
UPSCALE_PIPELINE_SPEC = {"loader": UPSCALE_LOADER, "base": UPSCALE_ID}

UPSCALE_SCALE = 2
UPSCALE_WEIGHT_FILENAME = "RealESRGAN_x2plus.pth"
UPSCALE_WEIGHT_BYTES = 67061725
UPSCALE_WEIGHT_SHA256 = "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb"

# 首选 HuggingFace 镜像（国内可达性好），备用 GitHub Release。第 2 次尝试自动换用下一条：
# "失败重试 1 次"与"备用 URL"是同一套逻辑，不必各写一份。
UPSCALE_WEIGHT_URLS = (
    "https://huggingface.co/gongting/real-esrgan/resolve/main/RealESRGAN_x2plus.pth",
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
)
UPSCALE_DOWNLOAD_ATTEMPTS = 2
UPSCALE_CHUNK_BYTES = 1024 * 1024
# 单次 socket 读超时（不是总时长）：67MB 在慢链路上也能靠分块读完成。
UPSCALE_DOWNLOAD_TIMEOUT_SEC = 60

# RRDBNet 结构参数（与官方 x2plus 权重逐键对应，改动会让 strict load 失败）。
RRDB_NUM_FEAT = 64
RRDB_NUM_BLOCK = 23
RRDB_NUM_GROW_CH = 32


def weight_path(work_dir: str = "") -> str:
    """权重落盘路径：``<work_dir>/sr/RealESRGAN_x2plus.pth``；``work_dir`` 为空用进程 cwd。

    不进 HF cache、不依赖 Dataset 挂载：Kaggle 是 ``/kaggle/working``、Colab 是 ``/content``，
    都由调用方把 ``CONFIG.work_dir`` 或 cwd 传进来。
    """
    base = str(work_dir or "").strip() or os.getcwd()
    return os.path.join(base, "sr", UPSCALE_WEIGHT_FILENAME)


def sha256_file(path: str, *, chunk_size: int = UPSCALE_CHUNK_BYTES) -> str:
    """分块计算文件 SHA256（67MB 权重不必整读进内存）。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _describe_token(environment: dict) -> str:
    """从环境变量取 HF_TOKEN；只返回令牌值，调用方负责不写日志。"""
    return str(environment.get("HF_TOKEN") or "").strip()


def _check_cached_weight(path: str, expected_bytes: int, expected_sha256: str, *, log) -> bool:  # noqa: ANN001
    """已存在的权重是否可直接复用：大小 + SHA256 双校验，不符就删掉重新下载。"""
    if not os.path.isfile(path):
        return False
    try:
        actual_bytes = os.path.getsize(path)
    except OSError:
        return False
    if actual_bytes != expected_bytes:
        log(
            f"[upscale] WARN 已有权重大小不符（期望 {expected_bytes} 字节 / 实际 {actual_bytes} 字节），"
            "重新下载"
        )
        _remove_quietly(path)
        return False
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        log(
            f"[upscale] WARN 已有权重 SHA256 不符（期望 {expected_sha256} / 实际 {actual_sha256}），"
            "重新下载"
        )
        _remove_quietly(path)
        return False
    log(f"[upscale] 复用已校验权重：{path}")
    return True


def ensure_weight_file(
    path: str,
    *,
    urlopen=None,  # noqa: ANN001 - 可注入的 urllib.request.urlopen 替身
    log=print,  # noqa: ANN001
    environ=None,  # noqa: ANN001 - 可注入的环境变量映射（默认 os.environ）
    urls=None,  # noqa: ANN001 - 可注入的候选 URL 列表
    expected_bytes: int = UPSCALE_WEIGHT_BYTES,
    expected_sha256: str = UPSCALE_WEIGHT_SHA256,
    max_bytes: int | None = None,
    max_attempts: int = UPSCALE_DOWNLOAD_ATTEMPTS,
    timeout: float = UPSCALE_DOWNLOAD_TIMEOUT_SEC,
    chunk_size: int = UPSCALE_CHUNK_BYTES,
) -> str:
    """确保权重文件就位：已存在且校验通过直接复用，否则下载到 ``.part`` 再原子替换。

    为什么边写边算 SHA256：67MB 先落盘再整读校验会多一次全量 IO，而且下载中途断开时
    ``.part`` 里是半截文件——边写边算能在读完时就判定成功/失败，``os.replace`` 保证目标
    路径永远只出现完整文件。

    失败重试 1 次（第 2 次自动换备用 URL），仍失败抛 ``LoadError``，文案带「期望 / 实际」，
    Host 侧能直接看出是下载问题还是权重被替换了。``HF_TOKEN`` 存在时只加在 Authorization
    请求头里，**值不进日志**（gated 仓库与匿名限流需要它）。
    """
    expected_bytes = int(expected_bytes)
    limit = expected_bytes if max_bytes is None else int(max_bytes)
    if _check_cached_weight(path, expected_bytes, expected_sha256, log=log):
        return path

    environment = os.environ if environ is None else environ
    token = _describe_token(environment)
    candidates = tuple(urls or UPSCALE_WEIGHT_URLS)
    opener = urlopen or urllib.request.urlopen
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    part_path = f"{path}.part"
    attempts = max(1, int(max_attempts))
    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        url = candidates[min(attempt - 1, len(candidates) - 1)]
        log(f"[upscale] 开始下载权重（第 {attempt}/{attempts} 次）：{url}")
        try:
            digest = hashlib.sha256()
            total = 0
            # 有 HF_TOKEN 时才包一层 Request；没有时直接传 URL，日志与替身都更好读。
            target = url
            if token:
                target = urllib.request.Request(
                    url, headers={"Authorization": f"Bearer {token}"}
                )
            with opener(target, timeout=timeout) as response:
                with open(part_path, "wb") as handle:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > limit:
                            raise LoadError(
                                f"权重文件超过大小上限：期望 {expected_bytes} 字节 / "
                                f"已收到 {total} 字节"
                            )
                        digest.update(chunk)
                        handle.write(chunk)
            actual_sha256 = digest.hexdigest()
            if total != expected_bytes:
                raise LoadError(
                    f"权重文件大小不符：期望 {expected_bytes} 字节 / 实际 {total} 字节"
                )
            if actual_sha256 != expected_sha256:
                raise LoadError(
                    f"权重 SHA256 不符：期望 {expected_sha256} / 实际 {actual_sha256}"
                )
            os.replace(part_path, path)
            log(f"[upscale] 权重下载完成：{total} 字节，SHA256 校验通过")
            return path
        except Exception as exc:  # noqa: BLE001 - 网络/校验失败统一收敛为 LoadError
            last_error = exc
            _remove_quietly(part_path)
            if attempt < attempts:
                log(
                    f"[upscale] WARN 权重下载失败（第 {attempt}/{attempts} 次）："
                    f"{short(exc, 200)}；重试"
                )
    raise LoadError(
        f"权重下载失败（已尝试 {attempts} 次）：{short(last_error, 400)}；"
        f"期望 SHA256 {expected_sha256} / 期望大小 {expected_bytes} 字节"
    ) from last_error


def extract_state_dict(checkpoint, *, error_cls=LoadError):  # noqa: ANN001, ANN202
    """把 checkpoint 统一成裸 state_dict：兼容 ``params_ema`` / ``params`` / 已是裸字典。

    官方 Real-ESRGAN 的发布权重顶层是 ``{"params_ema": state_dict}``（训练脚本还会写
    ``params``），而 HF 镜像 ``gongting/real-esrgan`` 直接存裸 state_dict；三种形状都要能
    加载，否则换一个下载源就要改代码。
    """
    if not isinstance(checkpoint, dict):
        raise error_cls(
            f"权重文件结构异常：期望 dict，收到 {type(checkpoint).__name__}"
        )
    for key in ("params_ema", "params"):
        value = checkpoint.get(key)
        if isinstance(value, dict):
            return value
    return checkpoint


def apply_state_dict(model, state, *, error_cls=LoadError) -> None:  # noqa: ANN001
    """按 ``strict=True`` 灌权重：缺键/多键/形状不符都直接 ``LoadError``。

    不用 ``strict=False`` 兜底：这样"换了权重文件但架构不对"会在加载期暴露，而不是
    跑出模糊的放大结果（静默降级比失败更难查）。
    """
    try:
        model.load_state_dict(state, strict=True)
    except Exception as exc:  # noqa: BLE001 - 结构不匹配统一收敛为 LoadError
        raise error_cls(
            f"权重与 RRDBNet(x{UPSCALE_SCALE}) 结构不匹配：{short(exc, 400)}"
        ) from exc


def build_rrdbnet(torch_module, *, scale: int = UPSCALE_SCALE):  # noqa: ANN001, ANN201
    """构造 Real-ESRGAN RRDBNet（basicsr 版结构与参数名，strict load 依赖它逐键一致）。

    ``scale == 2`` 时 ``conv_first`` 输入通道是 ``3 * 2 * 2 = 12``：官方做法先用
    ``pixel_unshuffle(x, 2)`` 把空间信息折到通道，再在低分辨率上做 23 层 RRDB，最后用
    **两次 nearest ×2** 上采样回目标尺寸（而不是一次转置卷积）。
    """
    nn = torch_module.nn
    functional = torch_module.nn.functional

    class ResidualDenseBlock(nn.Module):
        """RRDB 的稠密残差块：5 层 conv，每层都吃前面所有层的输出（官方 DenseNet 式连接）。"""

        def __init__(self) -> None:
            super().__init__()
            self.conv1 = nn.Conv2d(RRDB_NUM_FEAT, RRDB_NUM_GROW_CH, 3, 1, 1)
            self.conv2 = nn.Conv2d(RRDB_NUM_FEAT + RRDB_NUM_GROW_CH, RRDB_NUM_GROW_CH, 3, 1, 1)
            self.conv3 = nn.Conv2d(
                RRDB_NUM_FEAT + 2 * RRDB_NUM_GROW_CH, RRDB_NUM_GROW_CH, 3, 1, 1
            )
            self.conv4 = nn.Conv2d(
                RRDB_NUM_FEAT + 3 * RRDB_NUM_GROW_CH, RRDB_NUM_GROW_CH, 3, 1, 1
            )
            self.conv5 = nn.Conv2d(
                RRDB_NUM_FEAT + 4 * RRDB_NUM_GROW_CH, RRDB_NUM_FEAT, 3, 1, 1
            )
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

        def forward(self, x):  # noqa: ANN001, ANN201
            x1 = self.lrelu(self.conv1(x))
            x2 = self.lrelu(self.conv2(torch_module.cat((x, x1), 1)))
            x3 = self.lrelu(self.conv3(torch_module.cat((x, x1, x2), 1)))
            x4 = self.lrelu(self.conv4(torch_module.cat((x, x1, x2, x3), 1)))
            x5 = self.conv5(torch_module.cat((x, x1, x2, x3, x4), 1))
            return x5 * 0.2 + x

    class RRDB(nn.Module):
        """三层 ResidualDenseBlock + 输入残差，乘 0.2 抑制深层数值增长。"""

        def __init__(self) -> None:
            super().__init__()
            self.rdb1 = ResidualDenseBlock()
            self.rdb2 = ResidualDenseBlock()
            self.rdb3 = ResidualDenseBlock()

        def forward(self, x):  # noqa: ANN001, ANN201
            out = self.rdb3(self.rdb2(self.rdb1(x)))
            return out * 0.2 + x

    class RRDBNet(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            in_channels = 3 * scale * scale if scale == 2 else 3
            self.conv_first = nn.Conv2d(in_channels, RRDB_NUM_FEAT, 3, 1, 1)
            self.body = nn.Sequential(*[RRDB() for _ in range(RRDB_NUM_BLOCK)])
            self.conv_body = nn.Conv2d(RRDB_NUM_FEAT, RRDB_NUM_FEAT, 3, 1, 1)
            self.conv_up1 = nn.Conv2d(RRDB_NUM_FEAT, RRDB_NUM_FEAT, 3, 1, 1)
            self.conv_up2 = nn.Conv2d(RRDB_NUM_FEAT, RRDB_NUM_FEAT, 3, 1, 1)
            self.conv_hr = nn.Conv2d(RRDB_NUM_FEAT, RRDB_NUM_FEAT, 3, 1, 1)
            self.conv_last = nn.Conv2d(RRDB_NUM_FEAT, 3, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)
            self.scale = scale

        def forward(self, x):  # noqa: ANN001, ANN201
            if self.scale == 2:
                # 官方实现：先把 2x2 邻域折进通道（输入边长必须是偶数，调用方负责 pad）。
                feat = functional.pixel_unshuffle(x, 2)
            else:
                feat = x
            feat = self.conv_first(feat)
            body_feat = self.conv_body(self.body(feat))
            feat = feat + body_feat
            feat = self.lrelu(
                self.conv_up1(functional.interpolate(feat, scale_factor=2, mode="nearest"))
            )
            feat = self.lrelu(
                self.conv_up2(functional.interpolate(feat, scale_factor=2, mode="nearest"))
            )
            out = self.conv_last(self.lrelu(self.conv_hr(feat)))
            return out

    model = RRDBNet()
    try:
        model._imagen_scale = int(scale)
    except Exception:  # pragma: no cover - nn.Module 允许挂属性，仅作防御
        pass
    return model


def resolve_device(torch_module):  # noqa: ANN001, ANN202
    """选推理设备与 dtype：CUDA 可用时 fp16（T4 上省一半显存、速度翻倍），否则 CPU fp32。"""
    available = False
    try:
        available = bool(torch_module.cuda.is_available())
    except Exception:  # noqa: BLE001 - 没有 CUDA 运行时按 CPU 处理
        available = False
    if available:
        return "cuda", getattr(torch_module, "float16", "float16")
    return "cpu", getattr(torch_module, "float32", "float32")


def _import_module(name: str):  # noqa: ANN202
    """延迟导入重依赖：模块顶层只能有标准库（daemon 的既有约定）。"""
    return __import__(name)


def load_model(
    path: str,
    *,
    log=print,  # noqa: ANN001
    torch_module=None,  # noqa: ANN001
    urlopen=None,  # noqa: ANN001
    environ=None,  # noqa: ANN001
    scale: int = UPSCALE_SCALE,
):  # noqa: ANN201
    """确保权重就位 → 读取 checkpoint → 构造 RRDBNet → strict 灌权重 → 上设备，返回模型。

    加载失败一律 ``LoadError``（Host 的 ``load_failed``），推理 OOM 由调用方的
    ``classify_failure`` 判定成 ``oom``；两者不要混在一起。
    """
    torch = torch_module or _import_module("torch")
    ensure_weight_file(path, urlopen=urlopen, log=log, environ=environ)
    log(f"[upscale] 读取权重文件…（{os.path.basename(path)}）")
    try:
        checkpoint = torch.load(path, map_location="cpu")
    except Exception as exc:  # noqa: BLE001 - 损坏 / 版本不兼容统一收敛
        raise LoadError(f"权重读取失败：{short(exc, 300)}") from exc
    state = extract_state_dict(checkpoint, error_cls=LoadError)
    model = build_rrdbnet(torch, scale=scale)
    apply_state_dict(model, state, error_cls=LoadError)
    model.eval()
    device, dtype = resolve_device(torch)
    model = model.to(device=device, dtype=dtype)
    try:
        model._imagen_device = device
        model._imagen_dtype = dtype
        model._imagen_scale = int(scale)
    except Exception:  # pragma: no cover - 仅作防御
        pass
    log(f"[upscale] 权重就绪（device={device}，scale={scale}）")
    return model


def pad_to_even(value: int) -> int:
    """``pixel_unshuffle(2)`` 要求边长为偶数：奇数返回 1（补 1px），偶数返回 0。"""
    return int(value) % 2


def upscale_image(model, image, *, log=print, torch_module=None):  # noqa: ANN001, ANN201
    """对一张 PIL 图做 x2 超分，返回新的 RGB 图（尺寸 = 源图 × scale）。

    流程：RGB → float32/255 → tensor(1,3,H,W) → 奇数宽高 reflect pad 到偶数 →
    ``to(device, dtype)``（CUDA 时 fp16）→ ``no_grad`` 前向 → clamp(0,1) → uint8 → PIL，
    最后裁回 ``H×scale, W×scale``（pad 的像素只在右下，裁掉即可）。

    设备与 dtype 由 ``load_model`` 挂在模型属性上；拿不到时按 CPU fp32 处理（离线替身）。
    """
    torch = torch_module or _import_module("torch")
    np = _import_module("numpy")
    from PIL import Image

    device = getattr(model, "_imagen_device", "cpu")
    dtype = getattr(model, "_imagen_dtype", None) or getattr(torch, "float32", None)
    scale = int(getattr(model, "_imagen_scale", UPSCALE_SCALE))
    started = time.time()
    source = image if image.mode == "RGB" else image.convert("RGB")
    array = np.asarray(source, dtype=np.float32) / 255.0
    height, width = int(array.shape[0]), int(array.shape[1])
    tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0)
    tensor = tensor.to(device=device, dtype=dtype)
    pad_height = pad_to_even(height)
    pad_width = pad_to_even(width)
    if pad_height or pad_width:
        # reflect 而不是 zero pad：边缘像素按镜像复制，避免右/下边界出现黑边影响放大结果。
        tensor = torch.nn.functional.pad(
            tensor, (0, pad_width, 0, pad_height), mode="reflect"
        )
        log(f"[upscale] 源图 {width}x{height} 宽高为奇数，reflect pad {pad_width}x{pad_height} 到偶数")
    with torch.no_grad():
        output = model(tensor)
        output = output.clamp(0.0, 1.0)
    seconds = round(time.time() - started, 2)
    data = (
        output[0]
        .mul(255.0)
        .round()
        .clamp(0.0, 255.0)
        .to(torch.uint8)
        .permute(1, 2, 0)
        .contiguous()
        .cpu()
        .numpy()
    )
    result = Image.fromarray(data, mode="RGB")
    expected = (width * scale, height * scale)
    if result.size != expected:
        # 奇数边 pad 后输出比目标大 1×scale 像素；pad 只加在右下，裁回左上即可。
        result = result.crop((0, 0, min(result.size[0], expected[0]), min(result.size[1], expected[1])))
    log(
        f"[upscale] 输入 {width}x{height} → 输出 {result.size[0]}x{result.size[1]}，{seconds}s"
    )
    return result
