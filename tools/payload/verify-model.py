#!/usr/bin/env python3
"""模型验证采样 payload（由 tools/verify-model.mjs 打包推到 Kaggle 一次性执行）。

设计约束：
- 单文件、只依赖标准库启动：先装依赖，再 import torch/diffusers；
- 采样逻辑继承 bench/lightning/run.py：测量加载耗时、首图耗时、3 次出图（丢弃首张取中位数）、
  峰值显存与实际下载体积；
- 无论成功失败都写 verify-report.json 并退出 0：让编排端总能下载到结构化结果，
  真正的失败原因放在 report.status / error / traceback 里，不会被 Kaggle 判成 Kernel ERROR。
"""

import base64
import json
import os
import platform
import subprocess
import sys
import time
import traceback

# 1024² 的 VAE 解码单次申请约 5 GiB 连续显存：必须在任何 torch / CUDA 初始化之前设置，
# 让分配器用可扩展段减少碎片（T4 14.56GiB 首跑正是在 VAE conv3d 处 OOM）。
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# Host 注入点：lib/kernel.js 按行首赋值做精确替换。
EMBEDDED_CONFIG_B64 = ""

OUT_DIR = "/kaggle/working" if os.path.isdir("/kaggle/working") else "."
REPORT_NAME = "verify-report.json"
SAMPLE_NAME = "verify-sample.png"
SAMPLES = 3


def log(*args) -> None:
    print(*args, flush=True)


def short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return " ".join(text.split())[:limit]


def dir_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def install_dependencies() -> None:
    """与 daemon/bench 同一条已验证路径：卸 torchao，装最新兼容组合（不钉版本）。"""
    log("[pip] 卸载 torchao")
    uninstall = subprocess.run(
        [sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"],
        capture_output=True,
        text=True,
    )
    log(f"[pip] torchao 卸载退出码 {uninstall.returncode}")

    log("[pip] 安装 diffusers / transformers / accelerate / peft")
    env = dict(os.environ)
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PIP_NO_INPUT", "1")
    install = subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "--progress-bar",
            "off",
            "diffusers",
            "transformers",
            "accelerate",
            "peft",
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=1800,
    )
    if install.returncode != 0:
        output = f"{install.stdout or ''}\n{install.stderr or ''}".strip()
        tail = "\n".join([line for line in output.splitlines() if line.strip()][-40:])
        log("[pip] 安装失败，尾部输出：")
        log(tail)
        brief = " | ".join([line for line in tail.splitlines() if line.strip()][-4:])[:800]
        raise RuntimeError(f"pip install 退出码 {install.returncode}：{brief}")
    log("[pip] 依赖安装完成")


# ─────────────────────────────────────────────────────────────────────────────
# anima：Johnny-Z/Anima-Light-Lavender 运行时（自包含实现，两处逐字同步）
#
# 目标模型是单文件 ComfyUI checkpoint：Cosmos-Predict2 MiniTrainDIT 2B（28 层、
# model_channels=2048、16 头、patch=2、in/out 16 通道、crossattn 1024、adaln 256）
# + Anima LLMAdapter（embed 32128→1024，6 层 16 头），权重 tensor 前缀 "net."；
# 文本编码器是 Qwen3-0.6B（权重前缀 "model."），VAE 是 Qwen-Image 的
# AutoencoderKLQwenImage，分词器是 demo Space 里的 Qwen2 + T5 两套。
#
# 本段是对上游 demo Space（hugging-apps/anima-light-lavender-demo）app.py 的直译，
# 对应 ComfyUI 的 comfy/ldm/cosmos/predict2.py、comfy/ldm/anima/model.py、
# comfy/model_sampling.py 与 CFGZeroStar；不需要 trust_remote_code，也不执行外部脚本。
#
# 维护约定（docs/MODEL_ASSET_SPEC.md 第 4 节）：remote/daemon.py 与
# tools/payload/verify-model.py 各有一份，必须逐字同步（Kaggle 只接受单个 code_file，
# 不能抽公共模块）。
# ─────────────────────────────────────────────────────────────────────────────


def _anima_toolkit(shift=3.0):
    """anima 的纯 PyTorch 模型定义与文本/采样工具（返回 dict，供 load_anima_runtime 使用）。

    只在函数内 import torch：daemon / verify payload 的模块顶层都必须只依赖标准库。
    ``shift`` 是 flow-matching 时间步 shift，调用方从 pipeline.shift 传入（默认 3.0）。
    """
    import json
    import math
    import re

    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    # Qwen-Image / Wan2.1 latent 统计量（comfy/latent_formats.py: Wan21）
    latents_mean = [
        -0.7571, -0.7089, -0.9113, 0.1075, -0.1745, 0.9653, -0.1517, 1.5508,
        0.4134, -0.0715, 0.5517, -0.3632, -0.1922, -0.9497, 0.2503, -0.2921,
    ]
    latents_std = [
        2.8184, 1.4541, 2.3275, 2.6558, 1.2196, 1.7708, 2.6052, 2.0743,
        3.2687, 2.1526, 2.8652, 1.5579, 1.6382, 1.1253, 2.8251, 1.9160,
    ]
    # flow-matching 时间步 shift 由参数传入（模型卡 / anima.json：simple 调度、shift=3.0）

    class _RMSNorm(nn.Module):
        """RMSNorm 等价实现：归一化在 float32 里算，乘 float32 权重后再转回输入 dtype。

        state_dict 与 nn.RMSNorm 完全一致（只有 weight，形状 [dim]）；fp16 下不会因为
        x.pow(2) 溢出/下溢把输出打成 inf/NaN。
        """

        def __init__(self, dim, eps=1e-6):
            super().__init__()
            self.eps = eps
            self.weight = nn.Parameter(torch.ones(dim))

        def forward(self, x):
            xf = x.float()
            normed = xf * torch.rsqrt(xf.pow(2).mean(dim=-1, keepdim=True) + self.eps)
            return (normed * self.weight.float()).to(x.dtype)

    class _LayerNormNoAffine(nn.Module):
        """LayerNorm(elementwise_affine=False) 等价实现：均值/方差都在 float32 里算。"""

        def __init__(self, dim, eps=1e-6):
            super().__init__()
            self.dim = dim
            self.eps = eps

        def forward(self, x):
            xf = x.float()
            mean = xf.mean(dim=-1, keepdim=True)
            var = (xf - mean).pow(2).mean(dim=-1, keepdim=True)
            return ((xf - mean) * torch.rsqrt(var + self.eps)).to(x.dtype)

    # ---- 结构化 Danbooru caption（comfyui-zako-pe DanbooruCaptionJSON）----
    literal_open = "\x00"
    literal_close = "\x01"
    paren_re = re.compile(r"\(([^()]*)\)")
    weight_re = re.compile(r"^.+:\s*[+-]?\d*\.?\d+\s*$")

    def escape_group(match):
        if weight_re.match(match.group(1)):
            return match.group(0)
        return "\\(" + match.group(1) + "\\)"

    def escape_prompt_text(text):
        """把普通括号转义成字面量，避免被下面的 ComfyUI 权重解析当成 (tag:1.1) 强调组。"""
        if "(" not in text:
            return text
        while True:
            masked = text.replace("\\(", literal_open).replace("\\)", literal_close)
            escaped = paren_re.sub(escape_group, masked)
            escaped = escaped.replace(literal_open, "\\(").replace(literal_close, "\\)")
            if escaped == text:
                return text
            text = escaped

    def build_caption(prompt):
        """自由文本 → 结构化 caption JSON（year 2025 / preference_level best）。"""
        document = {
            "year": 2025,
            "preference_level": "best",
            "image_description": str(prompt or "").strip(),
        }
        text = json.dumps(document, ensure_ascii=False, indent=2)
        text = text.replace("\\\\", "\\")
        return escape_prompt_text(text)

    # ---- ComfyUI prompt 权重解析（comfy/sd1_clip.py）----
    def parse_parentheses(string):
        result, current_item, nesting_level = [], "", 0
        for char in string:
            if char == "(":
                if nesting_level == 0:
                    if current_item:
                        result.append(current_item)
                    current_item = "("
                else:
                    current_item += char
                nesting_level += 1
            elif char == ")":
                nesting_level -= 1
                if nesting_level == 0:
                    result.append(current_item + ")")
                    current_item = ""
                else:
                    current_item += char
            else:
                current_item += char
        if current_item:
            result.append(current_item)
        return result

    def token_weights(string, current_weight):
        out = []
        for item in parse_parentheses(string):
            weight = current_weight
            if len(item) >= 2 and item[-1] == ")" and item[0] == "(":
                item = item[1:-1]
                split = item.rfind(":")
                weight *= 1.1
                if split > 0:
                    try:
                        weight = float(item[split + 1:])
                        item = item[:split]
                    except Exception:
                        pass
                out += token_weights(item, weight)
            else:
                out += [(item, current_weight)]
        return out

    def escape_important(text):
        return text.replace("\\)", "\0\1").replace("\\(", "\0\2")

    def unescape_important(text):
        return text.replace("\0\1", ")").replace("\0\2", "(")

    def tokenize(text, qwen_tokenizer, t5_tokenizer):
        """ComfyUI anima 文本编码：Qwen 词表 + T5 词表（同一段文本带权重标记）。"""
        parsed = token_weights(escape_important(str(text or "")), 1.0)
        qwen_ids, t5_ids, t5_weights = [], [], []
        for segment, weight in parsed:
            segment = unescape_important(segment)
            if segment == "":
                continue
            qwen_ids += qwen_tokenizer(segment)["input_ids"]
            tokens = t5_tokenizer(segment)["input_ids"][:-1]  # 去掉 T5 的 </s>
            t5_ids += tokens
            t5_weights += [weight] * len(tokens)
        if len(qwen_ids) == 0:
            qwen_ids = [151643]  # Qwen pad token，对齐 ComfyUI 的 min_length=1
        t5_ids.append(1)  # </s>
        t5_weights.append(1.0)
        return qwen_ids, t5_ids, t5_weights

    # ---- flow-matching 采样（comfy/model_sampling.py、comfy/samplers.py）----
    def time_snr_shift(alpha, timestep):
        return alpha * timestep / (1 + (alpha - 1) * timestep)

    all_sigmas = [
        float(value)
        for value in time_snr_shift(shift, torch.arange(1, 1001, dtype=torch.float32) / 1000)
    ]

    def simple_scheduler(steps):
        """simple 调度：在 shift 后的 sigma 网格上等距取 steps 个点，末尾补 0。"""
        counts = max(1, int(steps))
        stride = len(all_sigmas) / counts
        sigmas = [all_sigmas[-(1 + int(index * stride))] for index in range(counts)]
        return torch.tensor(sigmas + [0.0], dtype=torch.float32)

    # ---- Cosmos-Predict2 3D RoPE（comfy/ldm/cosmos/position_embedding.py）----
    def build_rope_3d(
        num_t, num_h, num_w, head_dim=128, h_ratio=4.0, w_ratio=4.0, t_ratio=1.0, device="cuda"
    ):
        dim_h = head_dim // 6 * 2
        dim_w = dim_h
        dim_t = head_dim - 2 * dim_h
        spatial_range = torch.arange(0, dim_h, 2, device=device)[: dim_h // 2].float() / dim_h
        temporal_range = torch.arange(0, dim_t, 2, device=device)[: dim_t // 2].float() / dim_t

        h_theta = 10000.0 * (h_ratio ** (dim_h / (dim_h - 2)))
        w_theta = 10000.0 * (w_ratio ** (dim_w / (dim_w - 2)))
        t_theta = 10000.0 * (t_ratio ** (dim_t / (dim_t - 2)))

        h_freqs = 1.0 / (h_theta ** spatial_range)
        w_freqs = 1.0 / (w_theta ** spatial_range)
        t_freqs = 1.0 / (t_theta ** temporal_range)

        seq = torch.arange(max(num_h, num_w, num_t), dtype=torch.float32, device=device)
        e_h = torch.outer(seq[:num_h], h_freqs)
        e_w = torch.outer(seq[:num_w], w_freqs)
        e_t = torch.outer(seq[:num_t], t_freqs)

        def pair(values):  # cos, -sin, sin, cos
            return torch.stack([values.cos(), -values.sin(), values.sin(), values.cos()], dim=-1)

        e_h, e_w, e_t = pair(e_h), pair(e_w), pair(e_t)
        embedding = torch.cat(
            [
                e_t[:, None, None].expand(num_t, num_h, num_w, e_t.shape[-2], 4),
                e_h[None, :, None].expand(num_t, num_h, num_w, e_h.shape[-2], 4),
                e_w[None, None, :].expand(num_t, num_h, num_w, e_w.shape[-2], 4),
            ],
            dim=-2,
        )
        embedding = embedding.reshape(num_t * num_h * num_w, head_dim // 2, 2, 2).float()
        return embedding.unsqueeze(1).unsqueeze(0)

    def apply_rope_split_half(x, rope):
        """x: (B, L, H, D)；rope: (1, L, 1, D/2, 2, 2)。"""
        x_dtype = x.dtype
        halves = x.reshape(*x.shape[:-1], 2, -1).movedim(-2, -1).unsqueeze(-2).to(rope.dtype)
        out = rope[..., 0] * halves[..., 0] + rope[..., 1] * halves[..., 1]
        return out.movedim(-1, -2).reshape(*x.shape[:-1], -1).to(x_dtype)

    # ---- Cosmos-Predict2 MiniTrainDIT（comfy/ldm/cosmos/predict2.py）----
    class CosmosAttention(nn.Module):
        def __init__(self, query_dim, context_dim, n_heads, head_dim):
            super().__init__()
            self.is_selfattn = context_dim is None
            context_dim = query_dim if context_dim is None else context_dim
            inner = n_heads * head_dim
            self.n_heads, self.head_dim = n_heads, head_dim
            self.q_proj = nn.Linear(query_dim, inner, bias=False)
            self.q_norm = _RMSNorm(head_dim, eps=1e-6)
            self.k_proj = nn.Linear(context_dim, inner, bias=False)
            self.k_norm = _RMSNorm(head_dim, eps=1e-6)
            self.v_proj = nn.Linear(context_dim, inner, bias=False)
            self.output_proj = nn.Linear(inner, query_dim, bias=False)

        def forward(self, x, context=None, rope=None):
            ctx = x if context is None else context
            batch, length_q, _ = x.shape
            length_k = ctx.shape[1]
            q = self.q_proj(x).view(batch, length_q, self.n_heads, self.head_dim)
            k = self.k_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            v = self.v_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            q = self.q_norm(q)
            k = self.k_norm(k)
            if self.is_selfattn and rope is not None:
                q = apply_rope_split_half(q, rope)
                k = apply_rope_split_half(k, rope)
            out = F.scaled_dot_product_attention(
                q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
            )
            out = out.transpose(1, 2).reshape(batch, length_q, -1)
            return self.output_proj(out)

    class GPT2FeedForward(nn.Module):
        def __init__(self, d_model, d_ff):
            super().__init__()
            self.activation = nn.GELU()
            self.layer1 = nn.Linear(d_model, d_ff, bias=False)
            self.layer2 = nn.Linear(d_ff, d_model, bias=False)

        def forward(self, x):
            return self.layer2(self.activation(self.layer1(x)))

    def adaln_modulation(x_dim, lora_dim, multiplier):
        return nn.Sequential(
            nn.SiLU(),
            nn.Linear(x_dim, lora_dim, bias=False),
            nn.Linear(lora_dim, multiplier * x_dim, bias=False),
        )

    class CosmosBlock(nn.Module):
        def __init__(self, x_dim, context_dim, num_heads, mlp_ratio=4.0, adaln_lora_dim=256):
            super().__init__()
            self.layer_norm_self_attn = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.self_attn = CosmosAttention(x_dim, None, num_heads, x_dim // num_heads)
            self.layer_norm_cross_attn = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.cross_attn = CosmosAttention(x_dim, context_dim, num_heads, x_dim // num_heads)
            self.layer_norm_mlp = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.mlp = GPT2FeedForward(x_dim, int(x_dim * mlp_ratio))
            self.adaln_modulation_self_attn = adaln_modulation(x_dim, adaln_lora_dim, 3)
            self.adaln_modulation_cross_attn = adaln_modulation(x_dim, adaln_lora_dim, 3)
            self.adaln_modulation_mlp = adaln_modulation(x_dim, adaln_lora_dim, 3)

        def forward(self, x, emb, crossattn_emb, rope, adaln_lora):
            shift_s, scale_s, gate_s = (
                self.adaln_modulation_self_attn(emb) + adaln_lora
            ).chunk(3, dim=-1)
            shift_c, scale_c, gate_c = (
                self.adaln_modulation_cross_attn(emb) + adaln_lora
            ).chunk(3, dim=-1)
            shift_m, scale_m, gate_m = (self.adaln_modulation_mlp(emb) + adaln_lora).chunk(3, dim=-1)

            # 残差流用 float32：这套 28 层 DiT 的残差累积后 absmax 可达 ~5e4（真机权重实测
            # block 27 为 55712），fp16 上限 65504，后段会溢出成 inf/NaN。子层输入经 fp32
            # 归一化/调制后再转回 compute_dtype 做矩阵乘，子层输出也升回 fp32 再累加。
            compute_dtype = self.self_attn.q_proj.weight.dtype
            residual = x if x.dtype == torch.float32 else x.float()
            h = (
                self.layer_norm_self_attn(residual) * (1.0 + scale_s.float()) + shift_s.float()
            ).to(compute_dtype)
            residual = torch.addcmul(
                residual, gate_s.float(), self.self_attn(h, None, rope=rope).float()
            )

            h = (
                self.layer_norm_cross_attn(residual) * (1.0 + scale_c.float()) + shift_c.float()
            ).to(compute_dtype)
            residual = torch.addcmul(
                residual, gate_c.float(), self.cross_attn(h, crossattn_emb, rope=rope).float()
            )

            h = (self.layer_norm_mlp(residual) * (1.0 + scale_m.float()) + shift_m.float()).to(
                compute_dtype
            )
            residual = torch.addcmul(residual, gate_m.float(), self.mlp(h).float())
            return residual

    class Timesteps(nn.Module):
        def __init__(self, num_channels):
            super().__init__()
            self.num_channels = num_channels

        def forward(self, timesteps_b_t):
            timesteps = timesteps_b_t.flatten().float()
            half_dim = self.num_channels // 2
            exponent = -math.log(10000) * torch.arange(
                half_dim, dtype=torch.float32, device=timesteps.device
            ) / half_dim
            emb = timesteps[:, None] * torch.exp(exponent)[None, :]
            emb = torch.cat([torch.cos(emb), torch.sin(emb)], dim=-1)
            return emb.view(timesteps_b_t.shape[0], timesteps_b_t.shape[1], -1)

    class TimestepEmbedding(nn.Module):
        def __init__(self, in_features, out_features):
            super().__init__()
            self.linear_1 = nn.Linear(in_features, out_features, bias=False)
            self.activation = nn.SiLU()
            self.linear_2 = nn.Linear(out_features, 3 * out_features, bias=False)

        def forward(self, sample):
            return sample, self.linear_2(self.activation(self.linear_1(sample)))

    class PatchEmbed(nn.Module):
        def __init__(self, patch, in_channels, out_channels):
            super().__init__()
            self.patch = patch
            self.proj = nn.Sequential(
                nn.Identity(), nn.Linear(in_channels * patch * patch, out_channels, bias=False)
            )

        def forward(self, x):  # (B, C, T, H, W) -> (B, T, H/p, W/p, D)
            batch, channels, depth, height, width = x.shape
            patch = self.patch
            x = x.view(batch, channels, depth, 1, height // patch, patch, width // patch, patch)
            x = x.permute(0, 2, 4, 6, 1, 3, 5, 7).reshape(
                batch, depth, height // patch, width // patch, channels * patch * patch
            )
            return self.proj[1](x)

    class FinalLayer(nn.Module):
        def __init__(self, hidden_size, patch, out_channels, adaln_lora_dim=256):
            super().__init__()
            self.layer_norm = _LayerNormNoAffine(hidden_size, eps=1e-6)
            self.linear = nn.Linear(hidden_size, patch * patch * out_channels, bias=False)
            self.hidden_size = hidden_size
            self.adaln_modulation = adaln_modulation(hidden_size, adaln_lora_dim, 2)

        def forward(self, x, emb, adaln_lora):
            shift, scale = (
                self.adaln_modulation(emb) + adaln_lora[..., : 2 * self.hidden_size]
            ).chunk(2, dim=-1)
            h = (self.layer_norm(x) * (1.0 + scale.float()) + shift.float()).to(
                self.linear.weight.dtype
            )
            return self.linear(h)

    # ---- Anima LLM adapter（comfy/ldm/anima/model.py）----
    def rotate_half(x):
        x1 = x[..., : x.shape[-1] // 2]
        x2 = x[..., x.shape[-1] // 2:]
        return torch.cat((-x2, x1), dim=-1)

    def apply_rotary_pos_emb(x, cos, sin, unsqueeze_dim=1):
        cos = cos.unsqueeze(unsqueeze_dim)
        sin = sin.unsqueeze(unsqueeze_dim)
        return (x * cos) + (rotate_half(x) * sin)

    class AdapterRotaryEmbedding(nn.Module):
        def __init__(self, head_dim, rope_theta=10000):
            super().__init__()
            inv_freq = 1.0 / (
                rope_theta ** (torch.arange(0, head_dim, 2, dtype=torch.int64).float() / head_dim)
            )
            self.register_buffer("inv_freq", inv_freq, persistent=False)

        @torch.no_grad()
        def forward(self, x, position_ids):
            inv = self.inv_freq[None, :, None].float().expand(position_ids.shape[0], -1, 1)
            inv = inv.to(x.device)
            pos = position_ids[:, None, :].float()
            freqs = (inv @ pos).transpose(1, 2)
            emb = torch.cat((freqs, freqs), dim=-1)
            return emb.cos().to(x.dtype), emb.sin().to(x.dtype)

    class AdapterAttention(nn.Module):
        def __init__(self, query_dim, context_dim, n_heads, head_dim):
            super().__init__()
            inner = n_heads * head_dim
            self.n_heads, self.head_dim = n_heads, head_dim
            self.q_proj = nn.Linear(query_dim, inner, bias=False)
            self.q_norm = _RMSNorm(head_dim, eps=1e-6)
            self.k_proj = nn.Linear(context_dim, inner, bias=False)
            self.k_norm = _RMSNorm(head_dim, eps=1e-6)
            self.v_proj = nn.Linear(context_dim, inner, bias=False)
            self.o_proj = nn.Linear(inner, query_dim, bias=False)

        def forward(self, x, context=None, pe=None, pe_ctx=None):
            ctx = x if context is None else context
            batch, length_q, _ = x.shape
            length_k = ctx.shape[1]
            q = self.q_norm(self.q_proj(x).view(batch, length_q, self.n_heads, self.head_dim))
            k = self.k_norm(self.k_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim))
            v = self.v_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            q = q.transpose(1, 2)
            k = k.transpose(1, 2)
            v = v.transpose(1, 2)
            if pe is not None:
                q = apply_rotary_pos_emb(q, pe[0], pe[1])
                k = apply_rotary_pos_emb(k, pe_ctx[0], pe_ctx[1])
            out = F.scaled_dot_product_attention(q, k, v)
            return self.o_proj(out.transpose(1, 2).reshape(batch, length_q, -1))

    class AdapterBlock(nn.Module):
        def __init__(self, source_dim, model_dim, num_heads=16, mlp_ratio=4.0):
            super().__init__()
            self.norm_self_attn = _RMSNorm(model_dim, eps=1e-6)
            self.self_attn = AdapterAttention(model_dim, model_dim, num_heads, model_dim // num_heads)
            self.norm_cross_attn = _RMSNorm(model_dim, eps=1e-6)
            self.cross_attn = AdapterAttention(source_dim, source_dim, num_heads, model_dim // num_heads)
            self.norm_mlp = _RMSNorm(model_dim, eps=1e-6)
            inner = int(model_dim * mlp_ratio)
            self.mlp = nn.Sequential(
                nn.Linear(model_dim, inner), nn.GELU(), nn.Linear(inner, model_dim)
            )

        def forward(self, x, context, pe, pe_ctx):
            x = x + self.self_attn(self.norm_self_attn(x), None, pe=pe, pe_ctx=pe)
            x = x + self.cross_attn(self.norm_cross_attn(x), context, pe=pe, pe_ctx=pe_ctx)
            x = x + self.mlp(self.norm_mlp(x))
            return x

    class LLMAdapter(nn.Module):
        def __init__(self, source_dim=1024, target_dim=1024, model_dim=1024, num_layers=6, num_heads=16):
            super().__init__()
            self.embed = nn.Embedding(32128, target_dim)
            self.in_proj = nn.Identity()
            self.rotary_emb = AdapterRotaryEmbedding(model_dim // num_heads)
            self.blocks = nn.ModuleList(
                [AdapterBlock(source_dim, model_dim, num_heads) for _ in range(num_layers)]
            )
            self.out_proj = nn.Linear(model_dim, target_dim)
            self.norm = _RMSNorm(target_dim, eps=1e-6)

        def forward(self, source_hidden_states, target_input_ids):
            context = source_hidden_states
            x = self.in_proj(self.embed(target_input_ids).to(context.dtype))
            pos = torch.arange(x.shape[1], device=x.device).unsqueeze(0)
            pos_ctx = torch.arange(context.shape[1], device=x.device).unsqueeze(0)
            pe = self.rotary_emb(x, pos)
            pe_ctx = self.rotary_emb(x, pos_ctx)
            for block in self.blocks:
                x = block(x, context, pe, pe_ctx)
            return self.norm(self.out_proj(x))

    class Anima(nn.Module):
        """Cosmos-Predict2 MiniTrainDIT + Anima LLM adapter（2B，28 个 block）。"""

        def __init__(
            self,
            in_channels=16,
            out_channels=16,
            patch_spatial=2,
            model_channels=2048,
            num_blocks=28,
            num_heads=16,
            mlp_ratio=4.0,
            crossattn_emb_channels=1024,
            adaln_lora_dim=256,
        ):
            super().__init__()
            self.patch_spatial = patch_spatial
            self.num_heads = num_heads
            self.model_channels = model_channels
            self.t_embedder = nn.Sequential(
                Timesteps(model_channels), TimestepEmbedding(model_channels, model_channels)
            )
            self.x_embedder = PatchEmbed(patch_spatial, in_channels + 1, model_channels)
            self.blocks = nn.ModuleList(
                [
                    CosmosBlock(
                        model_channels, crossattn_emb_channels, num_heads, mlp_ratio, adaln_lora_dim
                    )
                    for _ in range(num_blocks)
                ]
            )
            self.final_layer = FinalLayer(model_channels, patch_spatial, out_channels, adaln_lora_dim)
            self.t_embedding_norm = _RMSNorm(model_channels, eps=1e-6)
            self.llm_adapter = LLMAdapter()

        def preprocess_text_embeds(self, text_embeds, text_ids, t5xxl_weights=None):
            out = self.llm_adapter(text_embeds, text_ids)
            if t5xxl_weights is not None:
                out = out * t5xxl_weights
            if out.shape[1] < 512:
                out = F.pad(out, (0, 0, 0, 512 - out.shape[1]))
            return out

        def forward(self, x, timesteps, context, rope):
            batch, _channels, depth, height, width = x.shape
            padding_mask = torch.zeros(batch, 1, height, width, dtype=x.dtype, device=x.device)
            x = torch.cat([x, padding_mask.unsqueeze(1).repeat(1, 1, depth, 1, 1)], dim=1)
            x = self.x_embedder(x)  # (B, T, H/p, W/p, D)
            _, frames, rows, cols, dim = x.shape

            if timesteps.ndim == 1:
                timesteps = timesteps.unsqueeze(1)
            emb, adaln_lora = self.t_embedder[1](self.t_embedder[0](timesteps).to(x.dtype))
            emb = self.t_embedding_norm(emb)

            # 残差流全程 float32（原因见 CosmosBlock.forward），子层内部仍用模型 dtype。
            residual = x.reshape(batch, frames * rows * cols, dim).float()
            for block in self.blocks:
                residual = block(residual, emb, context, rope, adaln_lora)
            x = self.final_layer(residual, emb, adaln_lora)

            patch = self.patch_spatial
            x = x.view(batch, frames, rows, cols, patch, patch, 1, -1)
            x = x.permute(0, 7, 1, 6, 2, 4, 3, 5).reshape(
                batch, -1, frames, rows * patch, cols * patch
            )
            return x

    def optimized_scale(positive, negative):
        """CFGZeroStar（comfy_extras/nodes_cfg.py）。"""
        pos = positive.reshape(positive.shape[0], -1)
        neg = negative.reshape(negative.shape[0], -1)
        ratio = torch.sum(pos * neg, dim=1, keepdim=True) / (
            torch.sum(neg ** 2, dim=1, keepdim=True) + 1e-8
        )
        return ratio.reshape([positive.shape[0]] + [1] * (positive.ndim - 1))

    return {
        "torch": torch,
        "Anima": Anima,
        "_RMSNorm": _RMSNorm,
        "_LayerNormNoAffine": _LayerNormNoAffine,
        "optimized_scale": optimized_scale,
        "build_caption": build_caption,
        "tokenize": tokenize,
        "simple_scheduler": simple_scheduler,
        "build_rope_3d": build_rope_3d,
        "latents_mean": latents_mean,
        "latents_std": latents_std,
        "shift": shift,
    }


def load_anima_runtime(spec, log=print, dir_bytes=None, local_paths=None):
    """下载并构建 Anima-Light-Lavender 运行时，返回 ``(runtime, downloaded_bytes, load_seconds)``。

    - ``downloaded_bytes`` 只统计本次真实下载的文件（DiT / 文本编码器 / VAE / 分词器）；
      命中 ``local_paths`` 的条目记 0（daemon 预挂载场景）。
    - ``load_seconds`` 只算构建与加载，不含下载耗时。
    - ``local_paths`` 键：``dit``（文件）、``te``（文件）、``vae``（仓库根目录）、
      ``tokenizers``（仓库根目录）；值为 None/缺失时走在线下载。
    """
    import gc

    import numpy as np
    import torch
    from PIL import Image
    from diffusers import AutoencoderKLQwenImage
    from huggingface_hub import hf_hub_download, snapshot_download
    from safetensors.torch import load_file
    from transformers import Qwen2Tokenizer, Qwen3Config, Qwen3Model, T5TokenizerFast

    local_paths = dict(local_paths or {})
    try:
        sampler_shift = float(spec.get("shift") or 3.0)
    except (TypeError, ValueError):
        sampler_shift = 3.0
    toolkit = _anima_toolkit(sampler_shift)
    Anima = toolkit["Anima"]
    optimized_scale = toolkit["optimized_scale"]
    build_caption = toolkit["build_caption"]
    tokenize = toolkit["tokenize"]
    simple_scheduler = toolkit["simple_scheduler"]
    build_rope_3d = toolkit["build_rope_3d"]
    latents_mean = toolkit["latents_mean"]
    latents_std = toolkit["latents_std"]

    def file_bytes(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0

    if dir_bytes is None:
        def dir_bytes(path):
            total = 0
            for root, _dirs, names in os.walk(path):
                for name in names:
                    total += file_bytes(os.path.join(root, name))
            return total

    base = str(spec.get("base") or "").strip()
    weight = str(spec.get("weight") or "").strip()
    if not base or not weight:
        raise ValueError("anima 需要 pipeline.base 与 pipeline.weight")
    text_encoder_spec = spec.get("textEncoder") or {}
    text_encoder_repo = str(text_encoder_spec.get("repo") or "").strip()
    text_encoder_weight = str(text_encoder_spec.get("weight") or "").strip()
    if not text_encoder_repo or not text_encoder_weight:
        raise ValueError("anima 需要 pipeline.textEncoder.repo 与 textEncoder.weight")
    vae_spec = spec.get("vae") or {}
    vae_repo = str(vae_spec.get("repo") or "").strip()
    vae_subfolder = str(vae_spec.get("subfolder") or "").strip().strip("/")
    if not vae_repo:
        raise ValueError("anima 需要 pipeline.vae.repo")
    tokenizer_spec = spec.get("tokenizers") or {}
    tokenizer_repo = str(tokenizer_spec.get("repo") or "").strip()
    tokenizer_repo_type = str(tokenizer_spec.get("repoType") or "").strip() or None
    if not tokenizer_repo:
        raise ValueError("anima 需要 pipeline.tokenizers.repo")

    if not torch.cuda.is_available():
        raise RuntimeError("anima 运行时需要 CUDA GPU（torch.cuda.is_available() 为 False）")
    device = torch.device("cuda")

    # ---- 下载四个资产（命中预挂载则跳过）----
    download_bytes = 0
    download_started = time.time()

    dit_path = local_paths.get("dit")
    if dit_path:
        log(f"[anima] DiT 使用预挂载权重：{dit_path}")
    else:
        log(f"[anima] 下载 DiT 权重 {base}/{weight} …")
        dit_path = hf_hub_download(base, filename=weight)
        download_bytes += file_bytes(dit_path)

    text_encoder_path = local_paths.get("te")
    if text_encoder_path:
        log(f"[anima] 文本编码器使用预挂载权重：{text_encoder_path}")
    else:
        log(f"[anima] 下载文本编码器 {text_encoder_repo}/{text_encoder_weight} …")
        text_encoder_path = hf_hub_download(text_encoder_repo, filename=text_encoder_weight)
        download_bytes += file_bytes(text_encoder_path)

    vae_root = local_paths.get("vae")
    if vae_root:
        log(f"[anima] VAE 使用预挂载目录：{vae_root}")
    elif vae_subfolder:
        log(f"[anima] 下载 VAE {vae_repo}/{vae_subfolder} …")
        patterns = [f"{vae_subfolder}/*", f"{vae_subfolder}/**/*"]
        vae_root = snapshot_download(vae_repo, allow_patterns=patterns)
        download_bytes += dir_bytes(vae_root)
    else:
        # 没有子目录描述时不能按白名单剪枝（会漏文件），交给 from_pretrained 整仓加载。
        log(f"[anima] WARN pipeline.vae.subfolder 为空，VAE 整仓加载：{vae_repo}")
        vae_root = ""

    tokenizer_root = local_paths.get("tokenizers")
    if tokenizer_root:
        log(f"[anima] 分词器使用预挂载目录：{tokenizer_root}")
    else:
        log(f"[anima] 下载分词器 {tokenizer_repo} …")
        tokenizer_root = snapshot_download(
            tokenizer_repo,
            repo_type=tokenizer_repo_type,
            allow_patterns=["qwen25_tokenizer/*", "t5_tokenizer/*"],
        )
        download_bytes += dir_bytes(tokenizer_root)

    download_seconds = round(time.time() - download_started, 1)
    log(f"[anima] 资产就绪：下载 {download_seconds}s / {round(download_bytes / 2**30, 2)} GiB")

    # ---- 精度选择：只有 sm_80+ 的原生 bf16 才用 bf16 ----
    # T4 是 sm_75：torch 2.11 + CUDA 13 的 is_bf16_supported() 仍返回 True，但 bf16 走
    # 模拟执行，实测 8.7s/次 DiT 前向（fp16 有 tensor core）；所以再按 compute capability 判一次。
    try:
        capability = torch.cuda.get_device_capability(device)
    except Exception:
        capability = (0, 0)
    capability_major = int(capability[0]) if capability else 0
    capability_minor = int(capability[1]) if capability and len(capability) > 1 else 0
    capability_label = f"sm_{capability_major}{capability_minor}"
    bf16_supported = bool(torch.cuda.is_bf16_supported())
    native_bf16 = bf16_supported and capability_major >= 8
    requested_dtype = str(spec.get("dtype") or "auto").strip().lower()
    if requested_dtype in ("", "auto", "default"):
        dit_dtype = torch.bfloat16 if native_bf16 else torch.float16
    elif requested_dtype in ("bf16", "bfloat16"):
        dit_dtype = torch.bfloat16
        if not native_bf16:
            log(
                f"[anima] WARN {capability_label} 没有原生 bf16（模拟执行会明显变慢），"
                "但 pipeline.dtype 显式要求 bf16"
            )
    elif requested_dtype in ("fp16", "float16", "half"):
        dit_dtype = torch.float16
    elif requested_dtype in ("fp32", "float32", "float"):
        dit_dtype = torch.float32
    else:
        raise ValueError(f"anima 不认识的 dtype：{requested_dtype}")
    # demo 的文本编码器用 fp32；fp16 卡降到 fp16（编码后 TE 还会整体挪到 CPU，不占采样显存）。
    text_encoder_dtype = torch.float32 if dit_dtype != torch.float16 else torch.float16
    vae_dtype = dit_dtype
    log(
        f"[anima] dtype：DiT/VAE={dit_dtype}，文本编码器={text_encoder_dtype}"
        f"（{capability_label}，bf16_supported={bf16_supported}，native_bf16={native_bf16}）"
    )

    load_started = time.time()

    # ---- DiT：单文件 ComfyUI checkpoint（前缀 "net."）----
    log("[anima] 构建 DiT（Cosmos-Predict2 MiniTrainDIT 2B，28 层）…")
    previous_dtype = torch.get_default_dtype()
    try:
        torch.set_default_dtype(dit_dtype)
        transformer = Anima()
    except Exception as exc:  # noqa: BLE001 - 少数环境不允许 fp16 做默认 dtype
        log(f"[anima] WARN 以 {dit_dtype} 构造 DiT 失败，回退 float32：{exc}")
        torch.set_default_dtype(torch.float32)
        transformer = Anima()
    finally:
        torch.set_default_dtype(previous_dtype)
    state = load_file(dit_path)
    state = {key[len("net."):]: value for key, value in state.items() if key.startswith("net.")}
    if not state:
        raise RuntimeError(f"DiT 权重里没有 net. 前缀的 tensor：{dit_path}")
    missing, unexpected = transformer.load_state_dict(state, strict=False)
    del state
    if missing:
        raise RuntimeError(
            f"DiT 权重缺 {len(missing)} 个 key（如 {missing[:5]}）：模型结构与 checkpoint 不匹配"
        )
    if unexpected:
        log(f"[anima] WARN DiT 有 {len(unexpected)} 个未使用 key（如 {unexpected[:5]}）")
    transformer = transformer.to(device=device, dtype=dit_dtype).eval()
    torch.cuda.empty_cache()

    # ---- 文本编码器：Qwen3-0.6B（demo 的 config，权重前缀 "model."）----
    log("[anima] 构建 Qwen3-0.6B 文本编码器 …")
    qwen_config = Qwen3Config(
        vocab_size=151936,
        hidden_size=1024,
        intermediate_size=3072,
        num_hidden_layers=28,
        num_attention_heads=16,
        num_key_value_heads=8,
        head_dim=128,
        max_position_embeddings=32768,
        rms_norm_eps=1e-6,
        rope_theta=1000000.0,
        attention_bias=False,
        tie_word_embeddings=True,
    )
    text_encoder = Qwen3Model(qwen_config)
    text_encoder_state = load_file(text_encoder_path)
    text_encoder_state = {
        (key[len("model."):] if key.startswith("model.") else key): value
        for key, value in text_encoder_state.items()
    }
    te_missing, te_unexpected = text_encoder.load_state_dict(text_encoder_state, strict=False)
    del text_encoder_state
    if te_missing:
        if any("embed_tokens" in key for key in te_missing):
            raise RuntimeError(
                f"文本编码器缺 embed_tokens（共 {len(te_missing)} 个 key）：权重与 Qwen3 结构不匹配"
            )
        log(f"[anima] WARN 文本编码器缺 {len(te_missing)} 个 key（如 {te_missing[:5]}）")
    if te_unexpected:
        log(f"[anima] WARN 文本编码器有 {len(te_unexpected)} 个未使用 key（如 {te_unexpected[:5]}）")
    text_encoder = text_encoder.to(device=device, dtype=text_encoder_dtype).eval()
    torch.cuda.empty_cache()

    # ---- VAE：Qwen-Image 的 AutoencoderKLQwenImage ----
    log("[anima] 构建 Qwen-Image VAE …")
    vae_dir = os.path.join(vae_root, vae_subfolder) if vae_subfolder else vae_root
    if os.path.isfile(os.path.join(vae_dir, "config.json")):
        vae = AutoencoderKLQwenImage.from_pretrained(vae_dir, torch_dtype=vae_dtype)
    elif vae_subfolder:
        vae = AutoencoderKLQwenImage.from_pretrained(
            vae_repo, subfolder=vae_subfolder, torch_dtype=vae_dtype
        )
    else:
        vae = AutoencoderKLQwenImage.from_pretrained(vae_repo, torch_dtype=vae_dtype)
    vae = vae.to(device).eval()
    torch.cuda.empty_cache()

    # ---- 分词器：demo Space 里的 Qwen2Tokenizer + T5TokenizerFast ----
    qwen_tokenizer_dir = os.path.join(tokenizer_root, "qwen25_tokenizer")
    t5_tokenizer_dir = os.path.join(tokenizer_root, "t5_tokenizer")
    log("[anima] 加载分词器（qwen25_tokenizer + t5_tokenizer）…")
    qwen_tokenizer = Qwen2Tokenizer.from_pretrained(qwen_tokenizer_dir)
    t5_tokenizer = T5TokenizerFast.from_pretrained(t5_tokenizer_dir)

    class AnimaOutput:
        """最小返回对象：只提供 .images，对齐 diffusers pipeline 的调用方约定。"""

        __slots__ = ("images",)

        def __init__(self, images):
            self.images = images

    class AnimaRuntime:
        """Anima-Light-Lavender 推理运行时（daemon 与 verify payload 共用同一实现）。"""

        def __init__(self, transformer, text_encoder, vae, qwen_tokenizer, t5_tokenizer, dtypes):
            self.transformer = transformer
            self.text_encoder = text_encoder
            self.vae = vae
            self.qwen_tokenizer = qwen_tokenizer
            self.t5_tokenizer = t5_tokenizer
            self.dit_dtype, self.text_encoder_dtype, self.vae_dtype = dtypes
            self.device = device
            self._text_encoder_on_gpu = True
            self._embedding_cache = {}
            self._embedding_cache_limit = 8
            self.latent_mean = torch.tensor(
                latents_mean, dtype=torch.float32, device=device
            ).view(1, 16, 1, 1, 1)
            self.latent_std = torch.tensor(
                latents_std, dtype=torch.float32, device=device
            ).view(1, 16, 1, 1, 1)

        def release(self):
            """清掉缓存（daemon 卸载 pipeline 时调用），让下次加载不残留旧 embedding。"""
            self._embedding_cache.clear()
            torch.cuda.empty_cache()

        def _move_text_encoder(self, on_gpu):
            """TE 只在编码时上 GPU：编码完挪回 CPU，把 1024² 解码要用的显存让出来。"""
            if on_gpu and not self._text_encoder_on_gpu:
                self.text_encoder = self.text_encoder.to(self.device)
                self._text_encoder_on_gpu = True
            elif not on_gpu and self._text_encoder_on_gpu:
                self.text_encoder = self.text_encoder.to("cpu")
                self._text_encoder_on_gpu = False
                log("[anima] 文本编码器已挪到 CPU，显存留给采样与 VAE 解码")

        def _text_hidden(self, ids):
            mask = torch.ones_like(ids)
            hidden = self.text_encoder(input_ids=ids, attention_mask=mask).last_hidden_state
            return hidden.float()

        @torch.no_grad()
        def _encode(self, text):
            """编码单段文本；按文本缓存 embedding（上限 8 条），命中即跳过 TE。"""
            key = str(text or "")
            cached = self._embedding_cache.get(key)
            if cached is not None:
                # 缓存按生成时的 dtype 存；切过精度后按当前 dtype 取出，避免 bf16/fp16 混用。
                return cached.to(device=self.device, dtype=self.dit_dtype)
            self._move_text_encoder(True)
            qwen_ids, t5_ids, t5_weights = tokenize(key, self.qwen_tokenizer, self.t5_tokenizer)
            ids = torch.tensor([qwen_ids], dtype=torch.long, device=self.device)
            hidden = self._text_hidden(ids)
            if not bool(torch.isfinite(hidden).all()):
                if self.text_encoder_dtype != torch.float32:
                    log("[anima] WARN 文本编码器输出非有限值，回退 float32 重试")
                    self.text_encoder = self.text_encoder.to(dtype=torch.float32)
                    self.text_encoder_dtype = torch.float32
                    hidden = self._text_hidden(ids)
                if not bool(torch.isfinite(hidden).all()):
                    raise RuntimeError("文本编码器输出含 NaN/Inf，请检查 Qwen3 权重与配置")
            t5 = torch.tensor([t5_ids], dtype=torch.long, device=self.device)
            weights = (
                torch.tensor(t5_weights, dtype=torch.float32, device=self.device)
                .unsqueeze(0)
                .unsqueeze(-1)
            )
            embedding = self.transformer.preprocess_text_embeds(
                hidden.to(self.dit_dtype), t5, t5xxl_weights=weights.to(self.dit_dtype)
            )
            if len(self._embedding_cache) >= self._embedding_cache_limit:
                self._embedding_cache.pop(next(iter(self._embedding_cache)))
            self._embedding_cache[key] = embedding.detach().to("cpu")
            return embedding

        @staticmethod
        def _to_image(output):
            image = ((output.float() + 1.0) / 2.0).clamp(0.0, 1.0)[0, :, 0]
            array = (image.permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
            return Image.fromarray(array)

        @torch.no_grad()
        def _decode_kernel(self, latent):
            """GPU 解码；NaN/Inf 时把 VAE 退 float32 再试一次。"""
            output = self.vae.decode(latent).sample
            if not bool(torch.isfinite(output).all()):
                if self.vae_dtype != torch.float32:
                    log("[anima] WARN VAE 解码出现 NaN/Inf，回退 float32 重试")
                    self.vae = self.vae.to(dtype=torch.float32)
                    self.vae_dtype = torch.float32
                    output = self.vae.decode(latent.float()).sample
                if not bool(torch.isfinite(output).all()):
                    if self.dit_dtype == torch.float16:
                        # 大概率是 DiT fp16 数值溢出：返回纯色占位图，让 __call__ 的
                        # fp16→bf16 兜底重跑整张，而不是直接判失败。
                        log("[anima] WARN 解码仍含 NaN/Inf，交给 fp16→bf16 兜底重跑")
                        return torch.full(
                            (1, 3, 1, latent.shape[-2] * 8, latent.shape[-1] * 8), -1.0
                        )
                    raise RuntimeError("VAE 解码输出含 NaN/Inf，请检查 VAE 权重")
            return output

        @torch.no_grad()
        def _decode_on_cpu(self, latent):
            """显存不够时的兜底：VAE 临时挪到 CPU 用 float32 解码（慢但能出图）。"""
            log("[anima] WARN VAE 解码显存不足，临时改用 CPU float32 解码（会明显变慢）")
            torch.cuda.empty_cache()
            restore_dtype = self.vae_dtype
            self.vae = self.vae.to(device="cpu", dtype=torch.float32)
            try:
                output = self.vae.decode(
                    latent.detach().to(device="cpu", dtype=torch.float32)
                ).sample
                return self._to_image(output)
            finally:
                # 临时挪动：解完放回 GPU，下一张还是先试 GPU 解码。
                self.vae = self.vae.to(device=self.device, dtype=restore_dtype)
                torch.cuda.empty_cache()

        @torch.no_grad()
        def _decode(self, latent):
            try:
                output = self._decode_kernel(latent)
            except torch.OutOfMemoryError:
                return self._decode_on_cpu(latent)
            return self._to_image(output)

        @staticmethod
        def _looks_flat(image):
            """近似纯色/黑图检测：8bit 灰度标准差 < 2 视为 fp16 数值崩掉。"""
            array = np.asarray(image, dtype=np.float32)
            return float(array.std()) < 2.0

        def _switch_dtype(self, dtype):
            log(f"[anima] DiT/VAE 精度切换为 {dtype}（后续采样沿用）")
            self.transformer = self.transformer.to(dtype=dtype)
            self.vae = self.vae.to(dtype=dtype)
            self.dit_dtype = dtype
            self.vae_dtype = dtype
            torch.cuda.empty_cache()

        def _sample_latent(self, prompt, negative_prompt, steps, width, height, cfg, generator):
            """编码 → euler + simple 采样 → 返回反归一化后的 latent（未解码）。"""
            caption = build_caption(prompt)
            use_cfg = cfg > 1.0
            try:
                cond = self._encode(caption)
                # 模型卡推荐空负向：空串按 demo 的方式编码成空 caption。
                uncond = self._encode(str(negative_prompt or "").strip()) if use_cfg else None
            finally:
                self._move_text_encoder(False)
            if not bool(torch.isfinite(cond).all()):
                raise RuntimeError("文本 embedding 含 NaN/Inf（TE 或 LLM adapter 精度问题）")
            if uncond is not None and not bool(torch.isfinite(uncond).all()):
                raise RuntimeError("负向文本 embedding 含 NaN/Inf（TE 或 LLM adapter 精度问题）")
            torch.cuda.empty_cache()
            batched = uncond is not None and cond.shape[1] == uncond.shape[1]
            context = torch.cat([cond, uncond], dim=0) if batched else None

            latent_height, latent_width = height // 8, width // 8
            rope = build_rope_3d(
                1, latent_height // 2, latent_width // 2, head_dim=2048 // 16, device=self.device
            )
            shape = (1, 16, 1, latent_height, latent_width)
            if generator is None:
                generator = torch.Generator(device=self.device).manual_seed(0)
            noise_device = getattr(generator, "device", self.device)
            latent = torch.randn(shape, dtype=torch.float32, generator=generator, device=noise_device)
            if latent.device != self.device:
                latent = latent.to(self.device)
            sigmas = simple_scheduler(steps).to(self.device)
            log(
                f"[anima] 采样 {width}x{height} steps={steps} cfg={cfg} "
                f"caption_tokens={cond.shape[1]} batched={batched}"
            )

            sampling_started = time.time()
            velocity_cond = None
            velocity_uncond = None
            for index in range(steps):
                sigma = sigmas[index]
                timestep = sigma.reshape(1).expand(1)
                if batched:
                    stacked = latent.to(self.dit_dtype).repeat(2, 1, 1, 1, 1)
                    output = self.transformer(stacked, timestep.expand(2), context, rope).float()
                    velocity_cond, velocity_uncond = output[0:1], output[1:2]
                else:
                    velocity_cond = self.transformer(
                        latent.to(self.dit_dtype), timestep, cond, rope
                    ).float()
                    velocity_uncond = None
                    if uncond is not None:
                        velocity_uncond = self.transformer(
                            latent.to(self.dit_dtype), timestep, uncond, rope
                        ).float()
                # 逐 step 有限性检查：一旦污染立即停，避免把脏 latent 带去解码白跑。
                bad_velocity = int((~torch.isfinite(velocity_cond)).sum())
                if velocity_uncond is not None:
                    bad_velocity += int((~torch.isfinite(velocity_uncond)).sum())
                if bad_velocity:
                    raise RuntimeError(
                        f"采样第 {index + 1}/{steps} 步 DiT 输出出现 {bad_velocity} 个非有限值"
                    )

                cond_denoised = latent - velocity_cond * sigma
                if velocity_uncond is None:
                    denoised = cond_denoised
                else:
                    uncond_denoised = latent - velocity_uncond * sigma
                    denoised = uncond_denoised + (cond_denoised - uncond_denoised) * cfg
                    # CFGZeroStar（comfy_extras/nodes_cfg.py）
                    alpha = optimized_scale(latent - cond_denoised, latent - uncond_denoised)
                    denoised = (
                        denoised
                        + uncond_denoised * (alpha - 1.0)
                        + cfg * uncond_denoised * (1.0 - alpha)
                    )
                derivative = (latent - denoised) / sigma
                latent = latent + derivative * (sigmas[index + 1] - sigma)
                if index == 0 or index == steps - 1:
                    log(
                        f"[anima] step {index + 1}/{steps}: latent absmax="
                        f"{float(latent.abs().max()):.4g}"
                    )
                if not bool(torch.isfinite(latent).all()):
                    raise RuntimeError(
                        f"采样第 {index + 1}/{steps} 步 latent 出现非有限值，已中止（避免解码白跑）"
                    )
            sampling_seconds = round(time.time() - sampling_started, 1)
            log(
                f"[anima] 采样完成：{steps} 步 {sampling_seconds}s"
                f"（{round(sampling_seconds / steps, 2)} s/step），准备解码"
            )
            return (latent * self.latent_std + self.latent_mean).to(self.vae_dtype)

        @torch.inference_mode()
        def __call__(
            self,
            prompt,
            negative_prompt="",
            num_inference_steps=25,
            width=1024,
            height=1024,
            guidance_scale=4.0,
            generator=None,
        ):
            steps = max(1, int(num_inference_steps))
            width = max(16, int(width) - int(width) % 16)
            height = max(16, int(height) - int(height) % 16)
            cfg = float(guidance_scale)
            if cfg != cfg:  # NaN 兜底
                cfg = 4.0
            seed = None
            if generator is not None:
                try:
                    seed = int(generator.initial_seed())
                except Exception:
                    seed = None

            latent = self._sample_latent(
                prompt, negative_prompt, steps, width, height, cfg, generator
            )
            # 采样中间张量随 _sample_latent 返回已释放；再回收缓存块，给 1024² 解码腾连续显存。
            gc.collect()
            torch.cuda.empty_cache()
            decode_started = time.time()
            image = self._decode(latent)
            log(f"[anima] 解码完成：{round(time.time() - decode_started, 1)}s")

            if self.dit_dtype == torch.float16 and self._looks_flat(image):
                log("[anima] WARN fp16 出图近似纯色，切 bf16 重跑当前这张（会明显变慢）")
                self._switch_dtype(torch.bfloat16)
                if generator is not None and seed is not None:
                    generator.manual_seed(seed)
                latent = self._sample_latent(
                    prompt, negative_prompt, steps, width, height, cfg, generator
                )
                gc.collect()
                torch.cuda.empty_cache()
                image = self._decode(latent)
            return AnimaOutput([image])

    runtime = AnimaRuntime(
        transformer,
        text_encoder,
        vae,
        qwen_tokenizer,
        t5_tokenizer,
        (dit_dtype, text_encoder_dtype, vae_dtype),
    )
    load_seconds = round(time.time() - load_started, 1)
    try:
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        log(
            f"[anima] 显存：已分配 {round(torch.cuda.memory_allocated() / 2**20)} MB，"
            f"空闲 {round(free_bytes / 2**30, 1)} GiB / 总 {round(total_bytes / 2**30, 1)} GiB"
        )
    except Exception:
        pass
    log(
        f"[anima] 就绪：load={load_seconds}s，下载 {round(download_bytes / 2**30, 2)} GiB，"
        f"shift={toolkit['shift']}（TE 编码后移到 CPU；DiT 残差流 fp32；解码 OOM 时 VAE 退 CPU float32）"
    )
    return runtime, download_bytes, load_seconds


def load_pipe(spec: dict):
    """按 loader 分支加载 pipeline；返回 (pipe, load_seconds, download_gb)。"""
    import torch
    from diffusers import AutoPipelineForText2Image, EulerDiscreteScheduler, StableDiffusionXLPipeline
    from huggingface_hub import snapshot_download

    loader = str(spec.get("loader") or "")
    base = str(spec.get("base") or "")
    if not base:
        raise ValueError("pipeline.base 为空")
    if loader == "anima":
        # 单文件 ComfyUI checkpoint（DiT + Qwen3-0.6B + Qwen-Image VAE + 双分词器）：
        # 资产逐个下载并按实际文件累计体积；load_seconds 只算加载，不含下载。
        pipe, anima_bytes, load_seconds = load_anima_runtime(spec, log, dir_bytes)
        download_gb = round(anima_bytes / 2**30, 2)
        log(f"[load] anima 模型就绪：{load_seconds}s，下载 {download_gb} GiB")
        return pipe, load_seconds, download_gb
    variant = spec.get("variant")
    allow_patterns = spec.get("allowPatterns")
    device_map = spec.get("deviceMap")

    download_started = time.time()
    download_bytes = 0
    if allow_patterns:
        log(f"[load] 预下载 {base}（白名单 {len(allow_patterns)} 条）…")
        snapshot = snapshot_download(base, allow_patterns=list(allow_patterns))
        download_bytes += dir_bytes(snapshot)
        log(f"[load] 预下载完成：{round((time.time() - download_started), 1)}s / {round(download_bytes / 2**30, 2)} GiB")
    else:
        log(f"[load] 未配置 allowPatterns，完整下载 {base} …")
        snapshot = snapshot_download(base)
        download_bytes += dir_bytes(snapshot)
        log(f"[load] 下载完成：{round((time.time() - download_started), 1)}s / {round(download_bytes / 2**30, 2)} GiB")

    kwargs = {"torch_dtype": torch.float16, "use_safetensors": True}
    if variant:
        kwargs["variant"] = str(variant)

    def from_pretrained(factory):
        attempts = [dict(kwargs)]
        if kwargs.get("variant"):
            attempts.append({key: value for key, value in kwargs.items() if key != "variant"})
        last = None
        for index, attempt in enumerate(attempts, start=1):
            try:
                log(f"[load] from_pretrained({base}) 第 {index} 次：variant={attempt.get('variant')}")
                return factory.from_pretrained(base, **attempt)
            except Exception as exc:  # noqa: BLE001
                last = exc
                log(f"[load] 第 {index} 次加载失败：{short(exc)}")
        raise RuntimeError(f"加载 {base} 失败：{short(last) if last else '未知原因'}")

    load_started = time.time()
    if loader == "sdxl":
        pipe = from_pretrained(AutoPipelineForText2Image).to("cuda")
    elif loader == "sdxl-lora":
        lora = spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise ValueError("sdxl-lora 需要 lora.repo 与 lora.weight")
        pipe = from_pretrained(StableDiffusionXLPipeline)
        scheduler_spec = spec.get("scheduler") or {}
        scheduler_type = str(scheduler_spec.get("type") or "euler").lower()
        if scheduler_type == "euler":
            spacing = str(scheduler_spec.get("timestepSpacing") or "trailing")
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing=spacing)
            log(f"[load] 调度器 EulerDiscreteScheduler(timestep_spacing={spacing})")
        from huggingface_hub import hf_hub_download

        weight_path = hf_hub_download(lora_repo, lora_weight)
        download_bytes += os.path.getsize(weight_path)
        pipe.load_lora_weights(lora_repo, weight_name=lora_weight)
        log(f"[load] LoRA 已挂载：{lora_repo}/{lora_weight}")
        pipe = pipe.to("cuda")
    elif loader == "flux2":
        balanced = str(device_map or "balanced")
        kwargs["device_map"] = balanced
        log(f"[load] flux2 使用 device_map={balanced}")
        pipe = from_pretrained(AutoPipelineForText2Image)
    else:
        raise ValueError(f"未知 loader：{loader}")

    load_seconds = round(time.time() - load_started, 1)
    download_gb = round(download_bytes / 2**30, 2)
    log(f"[load] 模型就绪：{load_seconds}s，下载 {download_gb} GiB")
    return pipe, load_seconds, download_gb


def sample(pipe, config: dict, sample_path: str) -> dict:
    import inspect

    import torch

    size = int(config["size"])
    steps = int(config["steps"])
    cfg = config.get("cfg")
    prompt = str(config["prompt"])
    negative = str(config.get("negativeHint") or "")
    seed = int(config.get("seed") or 42)
    signature = set(inspect.signature(pipe.__call__).parameters)

    runs = []
    peaks = []
    for index in range(SAMPLES):
        torch.cuda.reset_peak_memory_stats()
        call_kwargs = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "width": size,
            "height": size,
            "generator": torch.Generator("cuda").manual_seed(seed + index),
        }
        if cfg is not None and "guidance_scale" in signature:
            call_kwargs["guidance_scale"] = float(cfg)
        if negative and "negative_prompt" in signature:
            call_kwargs["negative_prompt"] = negative
        started = time.time()
        image = pipe(**call_kwargs).images[0]
        torch.cuda.synchronize()
        runs.append(round(time.time() - started, 2))
        peaks.append(round(torch.cuda.max_memory_allocated() / 2**20))
        log(f"[sample] 第 {index + 1}/{SAMPLES} 张：{runs[-1]}s，峰值 {peaks[-1]} MB")
        if index == 0:
            image.save(sample_path)
            image.close()

    steady_pool = runs[1:] if len(runs) > 1 else runs
    steady_median = sorted(steady_pool)[len(steady_pool) // 2]
    return {
        "first_s": runs[0],
        "runs_s": runs,
        "steady_median_s": steady_median,
        "ms_per_step": round(steady_median * 1000 / max(1, steps)),
        "peak_vram_mb": max(peaks),
    }


def main() -> None:
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report = {
        "status": "failed",
        "id": None,
        "started_at": started_at,
        "error": None,
        "traceback": None,
    }
    try:
        if not EMBEDDED_CONFIG_B64.strip():
            raise RuntimeError("未收到注入配置：EMBEDDED_CONFIG_B64 为空")
        config = json.loads(base64.b64decode(EMBEDDED_CONFIG_B64).decode("utf-8"))
        report["id"] = config.get("id")
        report["pipeline"] = config.get("pipeline")
        report["size"] = config.get("size")
        report["steps"] = config.get("steps")
        report["cfg"] = config.get("cfg")
        report["samples"] = SAMPLES
        report["seed"] = config.get("seed")
        report["prompt"] = config.get("prompt")

        install_dependencies()

        import torch

        report["env"] = {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "device_count": torch.cuda.device_count(),
            "devices": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
        }
        if not torch.cuda.is_available():
            raise RuntimeError("未检测到可用 GPU（torch.cuda.is_available() 为 False）")

        pipe, load_seconds, download_gb = load_pipe(config["pipeline"])
        sample_path = os.path.join(OUT_DIR, SAMPLE_NAME)
        stats = sample(pipe, config, sample_path)
        if not os.path.isfile(sample_path) or os.path.getsize(sample_path) == 0:
            raise RuntimeError("样张没有落盘")

        report.update(stats)
        report["load_seconds"] = load_seconds
        report["download_gb"] = download_gb
        report["sample_bytes"] = os.path.getsize(sample_path)
        report["status"] = "ok"
        log(f"[done] 验证通过：peak={stats['peak_vram_mb']} MB steady={stats['steady_median_s']}s")
    except Exception as exc:  # noqa: BLE001
        report["error"] = short(exc, 1200)
        report["traceback"] = traceback.format_exc()[-4000:]
        log("[error] " + report["error"])
        log(report["traceback"])
    finally:
        report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        report_path = os.path.join(OUT_DIR, REPORT_NAME)
        try:
            with open(report_path, "w", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
            log(f"[report] 已写入 {report_path}")
        except Exception as exc:  # noqa: BLE001
            log(f"[report] 写入失败：{short(exc)}")
        log("VERIFY_JSON: " + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
    sys.exit(0)