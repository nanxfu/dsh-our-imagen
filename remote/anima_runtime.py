# ─────────────────────────────────────────────────────────────────────────────
# anima：Johnny-Z/Anima-Light-Lavender 运行时（单份源码：本地 import + 打包内联）
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
# 维护约定：
# 1. 这是唯一一份实现。remote/daemon.py 与 tools/payload/verify-model.py 只保留一行
#    ``from anima_runtime import load_anima_runtime  # @@INLINE:anima_runtime.py@@``；
#    历史上的两份复制实现（旧注释写着「必须逐字同步」）已删除，不要再复制回来。
# 2. 本地运行走普通模块 import（daemon.py 由 test/daemon-unit.py 把 remote/ 放进
#    sys.path）；推 Kaggle 前，打包器（lib/kernel.js 的 inlineMarkedModules）会把标记行
#    整行替换为本文件全文，因此最终产物仍是自包含单文件（Kaggle 只接受单个 code_file）。
# 3. 日志由调用方注入：load_anima_runtime(spec, log=...)。daemon 传「日志环 + print」版，
#    验证 payload 传纯 print 版；本模块默认 print，不把任何一种日志实现写死在这里。
# 4. 模块顶层只 import 标准库；torch、diffusers、transformers 等重依赖都在函数内按需
#    import，这样 daemon / payload 的模块顶层也保持「只依赖标准库」。
# 5. 内部顶层符号统一以 ``_anima_`` / ``_Anima`` / ``_ANIMA_`` 为前缀，避免内联后与
#    daemon.py、pipeline_loader.py 或 verify-model.py 发生命名冲突。
# ─────────────────────────────────────────────────────────────────────────────

import gc
import json
import math
import os
import re
import time

# Qwen-Image / Wan2.1 latent 统计量（comfy/latent_formats.py: Wan21）
_ANIMA_LATENTS_MEAN = [
    -0.7571, -0.7089, -0.9113, 0.1075, -0.1745, 0.9653, -0.1517, 1.5508,
    0.4134, -0.0715, 0.5517, -0.3632, -0.1922, -0.9497, 0.2503, -0.2921,
]
_ANIMA_LATENTS_STD = [
    2.8184, 1.4541, 2.3275, 2.6558, 1.2196, 1.7708, 2.6052, 2.0743,
    3.2687, 2.1526, 2.8652, 1.5579, 1.6382, 1.1253, 2.8251, 1.9160,
]

_ANIMA_LITERAL_OPEN = "\x00"
_ANIMA_LITERAL_CLOSE = "\x01"
_ANIMA_PAREN_RE = re.compile(r"\(([^()]*)\)")
_ANIMA_WEIGHT_RE = re.compile(r"^.+:\s*[+-]?\d*\.?\d+\s*$")
_ANIMA_NN_CLASS_CACHE = {}


def _anima_torch():
    """延迟导入 torch / nn / F，保证本模块与内联宿主顶层只依赖标准库。"""
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    return torch, nn, F


def _anima_nn_class(impl_cls, nn_name=None):
    """按需把顶层实现类与 nn.Module 混入并缓存，避免模块加载时导入 torch。"""
    _, nn, _ = _anima_torch()
    class_name = nn_name or impl_cls.__name__
    cache_key = (impl_cls, nn.Module, class_name)
    built = _ANIMA_NN_CLASS_CACHE.get(cache_key)
    if built is None:
        built = type(class_name, (impl_cls, nn.Module), {"__module__": impl_cls.__module__})
        _ANIMA_NN_CLASS_CACHE[cache_key] = built
    return built


def _anima_adaln_modulation(x_dim, lora_dim, multiplier):
    _, nn, _ = _anima_torch()
    return nn.Sequential(
        nn.SiLU(),
        nn.Linear(x_dim, lora_dim, bias=False),
        nn.Linear(lora_dim, multiplier * x_dim, bias=False),
    )


# ---- 结构化 Danbooru caption（comfyui-zako-pe DanbooruCaptionJSON）----

def _anima_escape_group(match):
    if _ANIMA_WEIGHT_RE.match(match.group(1)):
        return match.group(0)
    return "\\(" + match.group(1) + "\\)"


def _anima_escape_prompt_text(text):
    """把普通括号转义成字面量，避免被下面的 ComfyUI 权重解析当成 (tag:1.1) 强调组。"""
    if "(" not in text:
        return text
    while True:
        masked = text.replace("\\(", _ANIMA_LITERAL_OPEN).replace("\\)", _ANIMA_LITERAL_CLOSE)
        escaped = _ANIMA_PAREN_RE.sub(_anima_escape_group, masked)
        escaped = escaped.replace(_ANIMA_LITERAL_OPEN, "\\(").replace(_ANIMA_LITERAL_CLOSE, "\\)")
        if escaped == text:
            return text
        text = escaped


def _anima_build_caption(prompt):
    """自由文本 → 结构化 caption JSON（year 2025 / preference_level best）。"""
    document = {
        "year": 2025,
        "preference_level": "best",
        "image_description": str(prompt or "").strip(),
    }
    text = json.dumps(document, ensure_ascii=False, indent=2)
    text = text.replace("\\\\", "\\")
    return _anima_escape_prompt_text(text)


# ---- ComfyUI prompt 权重解析（comfy/sd1_clip.py）----

def _anima_parse_parentheses(string):
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


def _anima_token_weights(string, current_weight):
    out = []
    for item in _anima_parse_parentheses(string):
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
            out += _anima_token_weights(item, weight)
        else:
            out += [(item, current_weight)]
    return out


def _anima_escape_important(text):
    return text.replace("\\)", "\0\1").replace("\\(", "\0\2")


def _anima_unescape_important(text):
    return text.replace("\0\1", ")").replace("\0\2", "(")


def _anima_tokenize(text, qwen_tokenizer, t5_tokenizer):
    """ComfyUI anima 文本编码：Qwen 词表 + T5 词表（同一段文本带权重标记）。"""
    parsed = _anima_token_weights(_anima_escape_important(str(text or "")), 1.0)
    qwen_ids, t5_ids, t5_weights = [], [], []
    for segment, weight in parsed:
        segment = _anima_unescape_important(segment)
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

def _anima_time_snr_shift(alpha, timestep):
    return alpha * timestep / (1 + (alpha - 1) * timestep)


def _anima_build_sigmas(shift):
    torch, _, _ = _anima_torch()
    return [
        float(value)
        for value in _anima_time_snr_shift(shift, torch.arange(1, 1001, dtype=torch.float32) / 1000)
    ]


def _anima_simple_scheduler(all_sigmas, steps):
    """simple 调度：在 shift 后的 sigma 网格上等距取 steps 个点，末尾补 0。"""
    torch, _, _ = _anima_torch()
    counts = max(1, int(steps))
    stride = len(all_sigmas) / counts
    sigmas = [all_sigmas[-(1 + int(index * stride))] for index in range(counts)]
    return torch.tensor(sigmas + [0.0], dtype=torch.float32)


# ---- Cosmos-Predict2 3D RoPE（comfy/ldm/cosmos/position_embedding.py）----

def _anima_build_rope_3d(
    num_t, num_h, num_w, head_dim=128, h_ratio=4.0, w_ratio=4.0, t_ratio=1.0, device="cuda"
):
    torch, _, _ = _anima_torch()
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


def _anima_apply_rope_split_half(x, rope):
    """x: (B, L, H, D)；rope: (1, L, 1, D/2, 2, 2)。"""
    x_dtype = x.dtype
    halves = x.reshape(*x.shape[:-1], 2, -1).movedim(-2, -1).unsqueeze(-2).to(rope.dtype)
    out = rope[..., 0] * halves[..., 0] + rope[..., 1] * halves[..., 1]
    return out.movedim(-1, -2).reshape(*x.shape[:-1], -1).to(x_dtype)


def _anima_rotate_half(x):
    torch, _, _ = _anima_torch()
    x1 = x[..., : x.shape[-1] // 2]
    x2 = x[..., x.shape[-1] // 2:]
    return torch.cat((-x2, x1), dim=-1)


def _anima_apply_rotary_pos_emb(x, cos, sin, unsqueeze_dim=1):
    cos = cos.unsqueeze(unsqueeze_dim)
    sin = sin.unsqueeze(unsqueeze_dim)
    return (x * cos) + (_anima_rotate_half(x) * sin)


def _anima_optimized_scale(positive, negative):
    """CFGZeroStar（comfy_extras/nodes_cfg.py）。"""
    torch, _, _ = _anima_torch()
    pos = positive.reshape(positive.shape[0], -1)
    neg = negative.reshape(negative.shape[0], -1)
    ratio = torch.sum(pos * neg, dim=1, keepdim=True) / (
        torch.sum(neg ** 2, dim=1, keepdim=True) + 1e-8
    )
    return ratio.reshape([positive.shape[0]] + [1] * (positive.ndim - 1))


# ---- 归一化与 Cosmos-Predict2 MiniTrainDIT 模块 ----

class _AnimaRMSNorm:
    """RMSNorm 等价实现：归一化在 float32 里算，乘 float32 权重后再转回输入 dtype。

    state_dict 与 nn.RMSNorm 完全一致（只有 weight，形状 [dim]）；fp16 下不会因为
    x.pow(2) 溢出/下溢把输出打成 inf/NaN。
    """

    def __init__(self, dim, eps=1e-6):
        super().__init__()
        torch, nn, _ = _anima_torch()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        torch, _, _ = _anima_torch()
        xf = x.float()
        normed = xf * torch.rsqrt(xf.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return (normed * self.weight.float()).to(x.dtype)


class _AnimaLayerNormNoAffine:
    """LayerNorm(elementwise_affine=False) 等价实现：均值/方差都在 float32 里算。"""

    def __init__(self, dim, eps=1e-6):
        super().__init__()
        self.dim = dim
        self.eps = eps

    def forward(self, x):
        torch, _, _ = _anima_torch()
        xf = x.float()
        mean = xf.mean(dim=-1, keepdim=True)
        var = (xf - mean).pow(2).mean(dim=-1, keepdim=True)
        return ((xf - mean) * torch.rsqrt(var + self.eps)).to(x.dtype)


class _AnimaCosmosAttention:
    def __init__(self, query_dim, context_dim, n_heads, head_dim):
        super().__init__()
        _, nn, _ = _anima_torch()
        rmsnorm_cls = _anima_nn_class(_AnimaRMSNorm, "_RMSNorm")
        self.is_selfattn = context_dim is None
        context_dim = query_dim if context_dim is None else context_dim
        inner = n_heads * head_dim
        self.n_heads, self.head_dim = n_heads, head_dim
        self.q_proj = nn.Linear(query_dim, inner, bias=False)
        self.q_norm = rmsnorm_cls(head_dim, eps=1e-6)
        self.k_proj = nn.Linear(context_dim, inner, bias=False)
        self.k_norm = rmsnorm_cls(head_dim, eps=1e-6)
        self.v_proj = nn.Linear(context_dim, inner, bias=False)
        self.output_proj = nn.Linear(inner, query_dim, bias=False)

    def forward(self, x, context=None, rope=None):
        _, _, F = _anima_torch()
        ctx = x if context is None else context
        batch, length_q, _ = x.shape
        length_k = ctx.shape[1]
        q = self.q_proj(x).view(batch, length_q, self.n_heads, self.head_dim)
        k = self.k_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
        v = self.v_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
        q = self.q_norm(q)
        k = self.k_norm(k)
        if self.is_selfattn and rope is not None:
            q = _anima_apply_rope_split_half(q, rope)
            k = _anima_apply_rope_split_half(k, rope)
        out = F.scaled_dot_product_attention(
            q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
        )
        out = out.transpose(1, 2).reshape(batch, length_q, -1)
        return self.output_proj(out)


class _AnimaGPT2FeedForward:
    def __init__(self, d_model, d_ff):
        super().__init__()
        _, nn, _ = _anima_torch()
        self.activation = nn.GELU()
        self.layer1 = nn.Linear(d_model, d_ff, bias=False)
        self.layer2 = nn.Linear(d_ff, d_model, bias=False)

    def forward(self, x):
        return self.layer2(self.activation(self.layer1(x)))


class _AnimaCosmosBlock:
    def __init__(self, x_dim, context_dim, num_heads, mlp_ratio=4.0, adaln_lora_dim=256):
        super().__init__()
        layernorm_cls = _anima_nn_class(_AnimaLayerNormNoAffine, "_LayerNormNoAffine")
        attn_cls = _anima_nn_class(_AnimaCosmosAttention, "CosmosAttention")
        ffn_cls = _anima_nn_class(_AnimaGPT2FeedForward, "GPT2FeedForward")
        self.layer_norm_self_attn = layernorm_cls(x_dim, eps=1e-6)
        self.self_attn = attn_cls(x_dim, None, num_heads, x_dim // num_heads)
        self.layer_norm_cross_attn = layernorm_cls(x_dim, eps=1e-6)
        self.cross_attn = attn_cls(x_dim, context_dim, num_heads, x_dim // num_heads)
        self.layer_norm_mlp = layernorm_cls(x_dim, eps=1e-6)
        self.mlp = ffn_cls(x_dim, int(x_dim * mlp_ratio))
        self.adaln_modulation_self_attn = _anima_adaln_modulation(x_dim, adaln_lora_dim, 3)
        self.adaln_modulation_cross_attn = _anima_adaln_modulation(x_dim, adaln_lora_dim, 3)
        self.adaln_modulation_mlp = _anima_adaln_modulation(x_dim, adaln_lora_dim, 3)

    def forward(self, x, emb, crossattn_emb, rope, adaln_lora):
        torch, _, _ = _anima_torch()
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


class _AnimaTimesteps:
    def __init__(self, num_channels):
        super().__init__()
        self.num_channels = num_channels

    def forward(self, timesteps_b_t):
        torch, _, _ = _anima_torch()
        timesteps = timesteps_b_t.flatten().float()
        half_dim = self.num_channels // 2
        exponent = -math.log(10000) * torch.arange(
            half_dim, dtype=torch.float32, device=timesteps.device
        ) / half_dim
        emb = timesteps[:, None] * torch.exp(exponent)[None, :]
        emb = torch.cat([torch.cos(emb), torch.sin(emb)], dim=-1)
        return emb.view(timesteps_b_t.shape[0], timesteps_b_t.shape[1], -1)


class _AnimaTimestepEmbedding:
    def __init__(self, in_features, out_features):
        super().__init__()
        _, nn, _ = _anima_torch()
        self.linear_1 = nn.Linear(in_features, out_features, bias=False)
        self.activation = nn.SiLU()
        self.linear_2 = nn.Linear(out_features, 3 * out_features, bias=False)

    def forward(self, sample):
        return sample, self.linear_2(self.activation(self.linear_1(sample)))


class _AnimaPatchEmbed:
    def __init__(self, patch, in_channels, out_channels):
        super().__init__()
        _, nn, _ = _anima_torch()
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


class _AnimaFinalLayer:
    def __init__(self, hidden_size, patch, out_channels, adaln_lora_dim=256):
        super().__init__()
        _, nn, _ = _anima_torch()
        layernorm_cls = _anima_nn_class(_AnimaLayerNormNoAffine, "_LayerNormNoAffine")
        self.layer_norm = layernorm_cls(hidden_size, eps=1e-6)
        self.linear = nn.Linear(hidden_size, patch * patch * out_channels, bias=False)
        self.hidden_size = hidden_size
        self.adaln_modulation = _anima_adaln_modulation(hidden_size, adaln_lora_dim, 2)

    def forward(self, x, emb, adaln_lora):
        shift, scale = (
            self.adaln_modulation(emb) + adaln_lora[..., : 2 * self.hidden_size]
        ).chunk(2, dim=-1)
        h = (self.layer_norm(x) * (1.0 + scale.float()) + shift.float()).to(
            self.linear.weight.dtype
        )
        return self.linear(h)


# ---- Anima LLM adapter（comfy/ldm/anima/model.py）----

class _AnimaAdapterRotaryEmbedding:
    def __init__(self, head_dim, rope_theta=10000):
        super().__init__()
        torch, _, _ = _anima_torch()
        inv_freq = 1.0 / (
            rope_theta ** (torch.arange(0, head_dim, 2, dtype=torch.int64).float() / head_dim)
        )
        self.register_buffer("inv_freq", inv_freq, persistent=False)

    def forward(self, x, position_ids):
        torch, _, _ = _anima_torch()
        with torch.no_grad():
            inv = self.inv_freq[None, :, None].float().expand(position_ids.shape[0], -1, 1)
            inv = inv.to(x.device)
            pos = position_ids[:, None, :].float()
            freqs = (inv @ pos).transpose(1, 2)
            emb = torch.cat((freqs, freqs), dim=-1)
            return emb.cos().to(x.dtype), emb.sin().to(x.dtype)


class _AnimaAdapterAttention:
    def __init__(self, query_dim, context_dim, n_heads, head_dim):
        super().__init__()
        _, nn, _ = _anima_torch()
        rmsnorm_cls = _anima_nn_class(_AnimaRMSNorm, "_RMSNorm")
        inner = n_heads * head_dim
        self.n_heads, self.head_dim = n_heads, head_dim
        self.q_proj = nn.Linear(query_dim, inner, bias=False)
        self.q_norm = rmsnorm_cls(head_dim, eps=1e-6)
        self.k_proj = nn.Linear(context_dim, inner, bias=False)
        self.k_norm = rmsnorm_cls(head_dim, eps=1e-6)
        self.v_proj = nn.Linear(context_dim, inner, bias=False)
        self.o_proj = nn.Linear(inner, query_dim, bias=False)

    def forward(self, x, context=None, pe=None, pe_ctx=None):
        _, _, F = _anima_torch()
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
            q = _anima_apply_rotary_pos_emb(q, pe[0], pe[1])
            k = _anima_apply_rotary_pos_emb(k, pe_ctx[0], pe_ctx[1])
        out = F.scaled_dot_product_attention(q, k, v)
        return self.o_proj(out.transpose(1, 2).reshape(batch, length_q, -1))


class _AnimaAdapterBlock:
    def __init__(self, source_dim, model_dim, num_heads=16, mlp_ratio=4.0):
        super().__init__()
        _, nn, _ = _anima_torch()
        rmsnorm_cls = _anima_nn_class(_AnimaRMSNorm, "_RMSNorm")
        attn_cls = _anima_nn_class(_AnimaAdapterAttention, "AdapterAttention")
        self.norm_self_attn = rmsnorm_cls(model_dim, eps=1e-6)
        self.self_attn = attn_cls(model_dim, model_dim, num_heads, model_dim // num_heads)
        self.norm_cross_attn = rmsnorm_cls(model_dim, eps=1e-6)
        self.cross_attn = attn_cls(source_dim, source_dim, num_heads, model_dim // num_heads)
        self.norm_mlp = rmsnorm_cls(model_dim, eps=1e-6)
        inner = int(model_dim * mlp_ratio)
        self.mlp = nn.Sequential(
            nn.Linear(model_dim, inner), nn.GELU(), nn.Linear(inner, model_dim)
        )

    def forward(self, x, context, pe, pe_ctx):
        x = x + self.self_attn(self.norm_self_attn(x), None, pe=pe, pe_ctx=pe)
        x = x + self.cross_attn(self.norm_cross_attn(x), context, pe=pe, pe_ctx=pe_ctx)
        x = x + self.mlp(self.norm_mlp(x))
        return x


class _AnimaLLMAdapter:
    def __init__(self, source_dim=1024, target_dim=1024, model_dim=1024, num_layers=6, num_heads=16):
        super().__init__()
        _, nn, _ = _anima_torch()
        rmsnorm_cls = _anima_nn_class(_AnimaRMSNorm, "_RMSNorm")
        rotary_cls = _anima_nn_class(_AnimaAdapterRotaryEmbedding, "AdapterRotaryEmbedding")
        block_cls = _anima_nn_class(_AnimaAdapterBlock, "AdapterBlock")
        self.embed = nn.Embedding(32128, target_dim)
        self.in_proj = nn.Identity()
        self.rotary_emb = rotary_cls(model_dim // num_heads)
        self.blocks = nn.ModuleList(
            [block_cls(source_dim, model_dim, num_heads) for _ in range(num_layers)]
        )
        self.out_proj = nn.Linear(model_dim, target_dim)
        self.norm = rmsnorm_cls(target_dim, eps=1e-6)

    def forward(self, source_hidden_states, target_input_ids):
        torch, _, _ = _anima_torch()
        context = source_hidden_states
        x = self.in_proj(self.embed(target_input_ids).to(context.dtype))
        pos = torch.arange(x.shape[1], device=x.device).unsqueeze(0)
        pos_ctx = torch.arange(context.shape[1], device=x.device).unsqueeze(0)
        pe = self.rotary_emb(x, pos)
        pe_ctx = self.rotary_emb(x, pos_ctx)
        for block in self.blocks:
            x = block(x, context, pe, pe_ctx)
        return self.norm(self.out_proj(x))


class _AnimaModel:
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
        _, nn, _ = _anima_torch()
        timesteps_cls = _anima_nn_class(_AnimaTimesteps, "Timesteps")
        temb_cls = _anima_nn_class(_AnimaTimestepEmbedding, "TimestepEmbedding")
        patch_cls = _anima_nn_class(_AnimaPatchEmbed, "PatchEmbed")
        block_cls = _anima_nn_class(_AnimaCosmosBlock, "CosmosBlock")
        final_cls = _anima_nn_class(_AnimaFinalLayer, "FinalLayer")
        rmsnorm_cls = _anima_nn_class(_AnimaRMSNorm, "_RMSNorm")
        adapter_cls = _anima_nn_class(_AnimaLLMAdapter, "LLMAdapter")

        self.patch_spatial = patch_spatial
        self.num_heads = num_heads
        self.model_channels = model_channels
        self.t_embedder = nn.Sequential(
            timesteps_cls(model_channels), temb_cls(model_channels, model_channels)
        )
        self.x_embedder = patch_cls(patch_spatial, in_channels + 1, model_channels)
        self.blocks = nn.ModuleList(
            [
                block_cls(
                    model_channels, crossattn_emb_channels, num_heads, mlp_ratio, adaln_lora_dim
                )
                for _ in range(num_blocks)
            ]
        )
        self.final_layer = final_cls(model_channels, patch_spatial, out_channels, adaln_lora_dim)
        self.t_embedding_norm = rmsnorm_cls(model_channels, eps=1e-6)
        self.llm_adapter = adapter_cls()

    def preprocess_text_embeds(self, text_embeds, text_ids, t5xxl_weights=None):
        _, _, F = _anima_torch()
        out = self.llm_adapter(text_embeds, text_ids)
        if t5xxl_weights is not None:
            out = out * t5xxl_weights
        if out.shape[1] < 512:
            out = F.pad(out, (0, 0, 0, 512 - out.shape[1]))
        return out

    def forward(self, x, timesteps, context, rope):
        torch, _, _ = _anima_torch()
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


def _anima_toolkit(shift=3.0):
    """anima 的纯 PyTorch 模型定义与文本/采样工具（返回 dict，供调用方与单测使用）。

    只在函数内 import torch：本模块、daemon 与 verify payload 的模块顶层都只依赖标准库。
    ``shift`` 是 flow-matching 时间步 shift，调用方从 pipeline.shift 传入（默认 3.0）。
    """
    torch, _, _ = _anima_torch()
    all_sigmas = _anima_build_sigmas(shift)

    def simple_scheduler(steps):
        return _anima_simple_scheduler(all_sigmas, steps)

    return {
        "torch": torch,
        "Anima": _anima_nn_class(_AnimaModel, "Anima"),
        "_RMSNorm": _anima_nn_class(_AnimaRMSNorm, "_RMSNorm"),
        "_LayerNormNoAffine": _anima_nn_class(_AnimaLayerNormNoAffine, "_LayerNormNoAffine"),
        "optimized_scale": _anima_optimized_scale,
        "build_caption": _anima_build_caption,
        "tokenize": _anima_tokenize,
        "simple_scheduler": simple_scheduler,
        "build_rope_3d": _anima_build_rope_3d,
        "latents_mean": _ANIMA_LATENTS_MEAN,
        "latents_std": _ANIMA_LATENTS_STD,
        "shift": shift,
    }


# ---- 资产解析、下载与模型构建辅助函数 ----

def _anima_file_bytes(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _anima_dir_bytes(path):
    total = 0
    for root, _dirs, names in os.walk(path):
        for name in names:
            total += _anima_file_bytes(os.path.join(root, name))
    return total


def _anima_parse_spec(spec):
    """校验并提取 anima pipeline spec 所需字段，包括 vae.subfolder 路径穿越防御。"""
    try:
        sampler_shift = float(spec.get("shift") or 3.0)
    except (TypeError, ValueError):
        sampler_shift = 3.0

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
    raw_vae_subfolder = str(vae_spec.get("subfolder") or "").strip()
    if raw_vae_subfolder and (
        os.path.isabs(raw_vae_subfolder)
        or "\\" in raw_vae_subfolder
        or any(part in ("", ".", "..") for part in raw_vae_subfolder.strip("/").split("/"))
    ):
        raise ValueError(f"anima pipeline.vae.subfolder 非法：{raw_vae_subfolder}")
    vae_subfolder = raw_vae_subfolder.strip("/")
    if not vae_repo:
        raise ValueError("anima 需要 pipeline.vae.repo")

    tokenizer_spec = spec.get("tokenizers") or {}
    tokenizer_repo = str(tokenizer_spec.get("repo") or "").strip()
    tokenizer_repo_type = str(tokenizer_spec.get("repoType") or "").strip() or None
    if not tokenizer_repo:
        raise ValueError("anima 需要 pipeline.tokenizers.repo")

    return {
        "shift": sampler_shift,
        "base": base,
        "weight": weight,
        "text_encoder_repo": text_encoder_repo,
        "text_encoder_weight": text_encoder_weight,
        "vae_repo": vae_repo,
        "vae_subfolder": vae_subfolder,
        "tokenizer_repo": tokenizer_repo,
        "tokenizer_repo_type": tokenizer_repo_type,
        "requested_dtype": str(spec.get("dtype") or "auto").strip().lower(),
    }


def _anima_acquire_assets(parsed_spec, local_paths, log, dir_bytes_fn):
    """下载或复用本地预挂载的 4 类资产（DiT / TE / VAE / 分词器），返回 (paths, bytes)。"""
    from huggingface_hub import hf_hub_download, snapshot_download

    local_paths = dict(local_paths or {})
    download_bytes = 0
    download_started = time.time()

    dit_path = local_paths.get("dit")
    if dit_path:
        log(f"[anima] DiT 使用预挂载权重：{dit_path}")
    else:
        log(f"[anima] 下载 DiT 权重 {parsed_spec['base']}/{parsed_spec['weight']} …")
        dit_path = hf_hub_download(parsed_spec["base"], filename=parsed_spec["weight"])
        download_bytes += _anima_file_bytes(dit_path)

    text_encoder_path = local_paths.get("te")
    if text_encoder_path:
        log(f"[anima] 文本编码器使用预挂载权重：{text_encoder_path}")
    else:
        log(
            "[anima] 下载文本编码器 "
            f"{parsed_spec['text_encoder_repo']}/{parsed_spec['text_encoder_weight']} …"
        )
        text_encoder_path = hf_hub_download(
            parsed_spec["text_encoder_repo"], filename=parsed_spec["text_encoder_weight"]
        )
        download_bytes += _anima_file_bytes(text_encoder_path)

    vae_root = local_paths.get("vae")
    vae_repo = parsed_spec["vae_repo"]
    vae_subfolder = parsed_spec["vae_subfolder"]
    if vae_root:
        log(f"[anima] VAE 使用预挂载目录：{vae_root}")
    elif vae_subfolder:
        log(f"[anima] 下载 VAE {vae_repo}/{vae_subfolder} …")
        patterns = [f"{vae_subfolder}/*", f"{vae_subfolder}/**/*"]
        vae_root = snapshot_download(vae_repo, allow_patterns=patterns)
        download_bytes += dir_bytes_fn(vae_root)
    else:
        # 没有子目录描述时不能按白名单剪枝（会漏文件），交给 from_pretrained 整仓加载。
        log(f"[anima] WARN pipeline.vae.subfolder 为空，VAE 整仓加载：{vae_repo}")
        vae_root = ""

    tokenizer_root = local_paths.get("tokenizers")
    if tokenizer_root:
        log(f"[anima] 分词器使用预挂载目录：{tokenizer_root}")
    else:
        log(f"[anima] 下载分词器 {parsed_spec['tokenizer_repo']} …")
        tokenizer_root = snapshot_download(
            parsed_spec["tokenizer_repo"],
            repo_type=parsed_spec["tokenizer_repo_type"],
            allow_patterns=["qwen25_tokenizer/*", "t5_tokenizer/*"],
        )
        download_bytes += dir_bytes_fn(tokenizer_root)

    download_seconds = round(time.time() - download_started, 1)
    log(f"[anima] 资产就绪：下载 {download_seconds}s / {round(download_bytes / 2**30, 2)} GiB")
    return {
        "dit_path": dit_path,
        "text_encoder_path": text_encoder_path,
        "vae_root": vae_root,
        "tokenizer_root": tokenizer_root,
    }, download_bytes


def _anima_select_dtypes(requested_dtype, device, log):
    """按 compute capability 与 pipeline.dtype 选择 DiT / TE / VAE 精度。"""
    torch, _, _ = _anima_torch()
    # 只有 sm_80+ 的原生 bf16 才用 bf16：T4 是 sm_75，is_bf16_supported() 仍可能返回 True，
    # 但 bf16 走模拟执行（实测 8.7s/次 DiT 前向），fp16 有 tensor core。
    try:
        capability = torch.cuda.get_device_capability(device)
    except Exception:
        capability = (0, 0)
    capability_major = int(capability[0]) if capability else 0
    capability_minor = int(capability[1]) if capability and len(capability) > 1 else 0
    capability_label = f"sm_{capability_major}{capability_minor}"
    bf16_supported = bool(torch.cuda.is_bf16_supported())
    native_bf16 = bf16_supported and capability_major >= 8

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
    return dit_dtype, text_encoder_dtype, vae_dtype


def _anima_load_dit(dit_path, dit_dtype, device, log):
    """构建并加载单文件 ComfyUI checkpoint DiT（权重前缀 "net."）。"""
    from safetensors.torch import load_file

    torch, _, _ = _anima_torch()
    anima_cls = _anima_nn_class(_AnimaModel, "Anima")

    log("[anima] 构建 DiT（Cosmos-Predict2 MiniTrainDIT 2B，28 层）…")
    previous_dtype = torch.get_default_dtype()
    try:
        torch.set_default_dtype(dit_dtype)
        transformer = anima_cls()
    except Exception as exc:  # noqa: BLE001 - 少数环境不允许 fp16 做默认 dtype
        log(f"[anima] WARN 以 {dit_dtype} 构造 DiT 失败，回退 float32：{exc}")
        torch.set_default_dtype(torch.float32)
        transformer = anima_cls()
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
    return transformer


def _anima_load_text_encoder(text_encoder_path, text_encoder_dtype, device, log):
    """构建并加载 Qwen3-0.6B 文本编码器（权重前缀 "model."）。"""
    from safetensors.torch import load_file
    from transformers import Qwen3Config, Qwen3Model

    torch, _, _ = _anima_torch()
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
    return text_encoder


def _anima_load_vae(vae_root, vae_repo, vae_subfolder, vae_dtype, device, log):
    """加载 Qwen-Image 的 AutoencoderKLQwenImage。"""
    from diffusers import AutoencoderKLQwenImage

    torch, _, _ = _anima_torch()
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
    return vae


def _anima_load_tokenizers(tokenizer_root, log):
    """加载 demo Space 的 Qwen2Tokenizer + T5TokenizerFast。"""
    from transformers import Qwen2Tokenizer, T5TokenizerFast

    qwen_tokenizer_dir = os.path.join(tokenizer_root, "qwen25_tokenizer")
    t5_tokenizer_dir = os.path.join(tokenizer_root, "t5_tokenizer")
    log("[anima] 加载分词器（qwen25_tokenizer + t5_tokenizer）…")
    qwen_tokenizer = Qwen2Tokenizer.from_pretrained(qwen_tokenizer_dir)
    t5_tokenizer = T5TokenizerFast.from_pretrained(t5_tokenizer_dir)
    return qwen_tokenizer, t5_tokenizer


# ---- 运行时输出与推理封装 ----

class AnimaOutput:
    """最小返回对象：只提供 .images，对齐 diffusers pipeline 的调用方约定。"""

    __slots__ = ("images",)

    def __init__(self, images):
        self.images = images


class AnimaRuntime:
    """Anima-Light-Lavender 推理运行时（daemon 与 verify payload 共用同一实现）。"""

    def __init__(
        self,
        transformer,
        text_encoder,
        vae,
        qwen_tokenizer,
        t5_tokenizer,
        dtypes,
        device=None,
        shift=3.0,
        log=print,
    ):
        torch, _, _ = _anima_torch()
        self.transformer = transformer
        self.text_encoder = text_encoder
        self.vae = vae
        self.qwen_tokenizer = qwen_tokenizer
        self.t5_tokenizer = t5_tokenizer
        self.dit_dtype, self.text_encoder_dtype, self.vae_dtype = dtypes
        self.device = device if device is not None else torch.device("cuda")
        self.shift = float(shift)
        self.log = log
        self._all_sigmas = _anima_build_sigmas(self.shift)
        self._text_encoder_on_gpu = True
        self._embedding_cache = {}
        self._embedding_cache_limit = 8
        self.latent_mean = torch.tensor(
            _ANIMA_LATENTS_MEAN, dtype=torch.float32, device=self.device
        ).view(1, 16, 1, 1, 1)
        self.latent_std = torch.tensor(
            _ANIMA_LATENTS_STD, dtype=torch.float32, device=self.device
        ).view(1, 16, 1, 1, 1)

    def release(self):
        """清掉缓存（daemon 卸载 pipeline 时调用），让下次加载不残留旧 embedding。"""
        torch, _, _ = _anima_torch()
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
            self.log("[anima] 文本编码器已挪到 CPU，显存留给采样与 VAE 解码")

    def _text_hidden(self, ids):
        torch, _, _ = _anima_torch()
        mask = torch.ones_like(ids)
        hidden = self.text_encoder(input_ids=ids, attention_mask=mask).last_hidden_state
        return hidden.float()

    def _encode(self, text):
        """编码单段文本；按文本缓存 embedding（上限 8 条），命中即跳过 TE。"""
        torch, _, _ = _anima_torch()
        with torch.no_grad():
            key = str(text or "")
            cached = self._embedding_cache.get(key)
            if cached is not None:
                # 缓存按生成时的 dtype 存；切过精度后按当前 dtype 取出，避免 bf16/fp16 混用。
                return cached.to(device=self.device, dtype=self.dit_dtype)
            self._move_text_encoder(True)
            qwen_ids, t5_ids, t5_weights = _anima_tokenize(
                key, self.qwen_tokenizer, self.t5_tokenizer
            )
            ids = torch.tensor([qwen_ids], dtype=torch.long, device=self.device)
            hidden = self._text_hidden(ids)
            if not bool(torch.isfinite(hidden).all()):
                if self.text_encoder_dtype != torch.float32:
                    self.log("[anima] WARN 文本编码器输出非有限值，回退 float32 重试")
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
        import numpy as np
        from PIL import Image

        image = ((output.float() + 1.0) / 2.0).clamp(0.0, 1.0)[0, :, 0]
        array = (image.permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
        return Image.fromarray(array)

    def _decode_kernel(self, latent):
        """GPU 解码；NaN/Inf 时把 VAE 退 float32 再试一次。"""
        torch, _, _ = _anima_torch()
        with torch.no_grad():
            output = self.vae.decode(latent).sample
            if not bool(torch.isfinite(output).all()):
                if self.vae_dtype != torch.float32:
                    self.log("[anima] WARN VAE 解码出现 NaN/Inf，回退 float32 重试")
                    self.vae = self.vae.to(dtype=torch.float32)
                    self.vae_dtype = torch.float32
                    output = self.vae.decode(latent.float()).sample
                if not bool(torch.isfinite(output).all()):
                    if self.dit_dtype == torch.float16:
                        # 大概率是 DiT fp16 数值溢出：返回纯色占位图，让 __call__ 的
                        # fp16→bf16 兜底重跑整张，而不是直接判失败。
                        self.log("[anima] WARN 解码仍含 NaN/Inf，交给 fp16→bf16 兜底重跑")
                        return torch.full(
                            (1, 3, 1, latent.shape[-2] * 8, latent.shape[-1] * 8), -1.0
                        )
                    raise RuntimeError("VAE 解码输出含 NaN/Inf，请检查 VAE 权重")
            return output

    def _decode_on_cpu(self, latent):
        """显存不够时的兜底：VAE 临时挪到 CPU 用 float32 解码（慢但能出图）。"""
        torch, _, _ = _anima_torch()
        with torch.no_grad():
            self.log("[anima] WARN VAE 解码显存不足，临时改用 CPU float32 解码（会明显变慢）")
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

    def _decode(self, latent):
        torch, _, _ = _anima_torch()
        with torch.no_grad():
            try:
                output = self._decode_kernel(latent)
            except torch.OutOfMemoryError:
                return self._decode_on_cpu(latent)
            return self._to_image(output)

    @staticmethod
    def _looks_flat(image):
        """近似纯色/黑图检测：8bit 灰度标准差 < 2 视为 fp16 数值崩掉。"""
        import numpy as np

        array = np.asarray(image, dtype=np.float32)
        return float(array.std()) < 2.0

    def _switch_dtype(self, dtype):
        torch, _, _ = _anima_torch()
        self.log(f"[anima] DiT/VAE 精度切换为 {dtype}（后续采样沿用）")
        self.transformer = self.transformer.to(dtype=dtype)
        self.vae = self.vae.to(dtype=dtype)
        self.dit_dtype = dtype
        self.vae_dtype = dtype
        torch.cuda.empty_cache()

    def _predict_velocity(self, latent, timestep, cond, uncond, context, rope, batched):
        if batched:
            stacked = latent.to(self.dit_dtype).repeat(2, 1, 1, 1, 1)
            output = self.transformer(stacked, timestep.expand(2), context, rope).float()
            return output[0:1], output[1:2]
        velocity_cond = self.transformer(
            latent.to(self.dit_dtype), timestep, cond, rope
        ).float()
        velocity_uncond = None
        if uncond is not None:
            velocity_uncond = self.transformer(
                latent.to(self.dit_dtype), timestep, uncond, rope
            ).float()
        return velocity_cond, velocity_uncond

    def _sample_latent(self, prompt, negative_prompt, steps, width, height, cfg, generator):
        """编码 → euler + simple 采样 → 返回反归一化后的 latent（未解码）。"""
        torch, _, _ = _anima_torch()
        caption = _anima_build_caption(prompt)
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
        rope = _anima_build_rope_3d(
            1, latent_height // 2, latent_width // 2, head_dim=2048 // 16, device=self.device
        )
        shape = (1, 16, 1, latent_height, latent_width)
        if generator is None:
            generator = torch.Generator(device=self.device).manual_seed(0)
        noise_device = getattr(generator, "device", self.device)
        latent = torch.randn(shape, dtype=torch.float32, generator=generator, device=noise_device)
        if latent.device != self.device:
            latent = latent.to(self.device)
        sigmas = _anima_simple_scheduler(self._all_sigmas, steps).to(self.device)
        self.log(
            f"[anima] 采样 {width}x{height} steps={steps} cfg={cfg} "
            f"caption_tokens={cond.shape[1]} batched={batched}"
        )

        sampling_started = time.time()
        for index in range(steps):
            sigma = sigmas[index]
            timestep = sigma.reshape(1).expand(1)
            velocity_cond, velocity_uncond = self._predict_velocity(
                latent, timestep, cond, uncond, context, rope, batched
            )
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
                alpha = _anima_optimized_scale(latent - cond_denoised, latent - uncond_denoised)
                denoised = (
                    denoised
                    + uncond_denoised * (alpha - 1.0)
                    + cfg * uncond_denoised * (1.0 - alpha)
                )
            derivative = (latent - denoised) / sigma
            latent = latent + derivative * (sigmas[index + 1] - sigma)
            if index == 0 or index == steps - 1:
                self.log(
                    f"[anima] step {index + 1}/{steps}: latent absmax="
                    f"{float(latent.abs().max()):.4g}"
                )
            if not bool(torch.isfinite(latent).all()):
                raise RuntimeError(
                    f"采样第 {index + 1}/{steps} 步 latent 出现非有限值，已中止（避免解码白跑）"
                )
        sampling_seconds = round(time.time() - sampling_started, 1)
        self.log(
            f"[anima] 采样完成：{steps} 步 {sampling_seconds}s"
            f"（{round(sampling_seconds / steps, 2)} s/step），准备解码"
        )
        return (latent * self.latent_std + self.latent_mean).to(self.vae_dtype)

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
        torch, _, _ = _anima_torch()
        with torch.inference_mode():
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
            self.log(f"[anima] 解码完成：{round(time.time() - decode_started, 1)}s")

            if self.dit_dtype == torch.float16 and self._looks_flat(image):
                close_fn = getattr(image, "close", None)
                if callable(close_fn):
                    try:
                        close_fn()
                    except Exception:
                        pass
                self.log("[anima] WARN fp16 出图近似纯色，切 bf16 重跑当前这张（会明显变慢）")
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


def load_anima_runtime(spec, log=print, dir_bytes=None, local_paths=None):
    """下载并构建 Anima-Light-Lavender 运行时，返回 ``(runtime, downloaded_bytes, load_seconds)``。

    - ``downloaded_bytes`` 只统计本次真实下载的文件（DiT / 文本编码器 / VAE / 分词器）；
      命中 ``local_paths`` 的条目记 0（daemon 预挂载场景）。
    - ``load_seconds`` 只算构建与加载，不含下载耗时。
    - ``log`` 由调用方注入：daemon 传「日志环 + print」版，验证 payload 传纯 print 版。
    - ``local_paths`` 键：``dit``（文件）、``te``（文件）、``vae``（仓库根目录）、
      ``tokenizers``（仓库根目录）；值为 None/缺失时走在线下载。
    """
    torch, _, _ = _anima_torch()
    parsed = _anima_parse_spec(spec)
    if not torch.cuda.is_available():
        raise RuntimeError("anima 运行时需要 CUDA GPU（torch.cuda.is_available() 为 False）")
    device = torch.device("cuda")

    dir_bytes_fn = dir_bytes if dir_bytes is not None else _anima_dir_bytes
    assets, download_bytes = _anima_acquire_assets(parsed, local_paths, log, dir_bytes_fn)
    dit_dtype, text_encoder_dtype, vae_dtype = _anima_select_dtypes(
        parsed["requested_dtype"], device, log
    )

    load_started = time.time()
    transformer = _anima_load_dit(assets["dit_path"], dit_dtype, device, log)
    text_encoder = _anima_load_text_encoder(
        assets["text_encoder_path"], text_encoder_dtype, device, log
    )
    vae = _anima_load_vae(
        assets["vae_root"], parsed["vae_repo"], parsed["vae_subfolder"], vae_dtype, device, log
    )
    qwen_tokenizer, t5_tokenizer = _anima_load_tokenizers(assets["tokenizer_root"], log)

    runtime = AnimaRuntime(
        transformer,
        text_encoder,
        vae,
        qwen_tokenizer,
        t5_tokenizer,
        (dit_dtype, text_encoder_dtype, vae_dtype),
        device=device,
        shift=parsed["shift"],
        log=log,
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
        f"shift={parsed['shift']}（TE 编码后移到 CPU；DiT 残差流 fp32；解码 OOM 时 VAE 退 CPU float32）"
    )
    return runtime, download_bytes, load_seconds
