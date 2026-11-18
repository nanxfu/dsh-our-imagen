"""flux2 可选 LoRA（``pipeline.lora``）。

覆盖：预挂载优先且不联网、未命中走 hf_hub_download、缺字段 / 非法 scale 归为请求错误、
挂载异常归为加载失败（不静默出图不带 LoRA）、scale 通过 set_adapters 生效、
``device_map="balanced"`` 与单卡两条路径都能挂载、无 lora 时行为与改造前一致。

全部用例使用假 diffusers / 假 torch / 假 huggingface_hub，不联网、不占 GPU。

运行：python test/remote/test_flux2_lora.py
"""

from __future__ import annotations

import sys
import types
from contextlib import contextmanager
from unittest import mock

from support import DaemonUnitTest, d

from remote.inference.loaders.diffusers import FLUX2_LORA_ADAPTER

BASE = "black-forest-labs/FLUX.2-klein-4B"
FLUX2_SPEC = {"loader": "flux2", "base": BASE, "variant": "fp16"}
LORA = {"repo": "someone/flux2-style-lora", "weight": "style.safetensors"}
HUB_PATH = "/hub/lora/style.safetensors"


class FakeFlux2Pipe:
    """最小 flux2 管线替身：记录 LoRA 挂载 / scale / 转设备调用。"""

    def __init__(self) -> None:
        self.lora_calls: list[tuple] = []
        self.adapter_calls: list[tuple] = []
        self.device = None
        self.load_lora_error: Exception | None = None

    def load_lora_weights(self, source, **kwargs):  # noqa: ANN001, ANN201
        if self.load_lora_error is not None:
            raise self.load_lora_error
        self.lora_calls.append((source, kwargs))

    def set_adapters(self, adapter_names, adapter_weights=None):  # noqa: ANN001, ANN201
        self.adapter_calls.append((adapter_names, adapter_weights))

    def to(self, device):  # noqa: ANN001, ANN201
        self.device = device
        return self


@contextmanager
def flux2_build_env(*, pipe, device_count=2, local_weight=None, hub_path=HUB_PATH):
    """注入假 torch / diffusers / huggingface_hub 与缓存替身，并记录调用。"""
    env = types.SimpleNamespace(hub_calls=[], weight_calls=[], source=None, loaded_kwargs=None)

    def fake_hf_hub_download(repo_id, filename, **kwargs):  # noqa: ANN001, ANN201
        env.hub_calls.append((repo_id, filename, kwargs))
        return hub_path

    class FakeFactory:
        @staticmethod
        def from_pretrained(source, **kwargs):  # noqa: ANN001, ANN201
            env.source = source
            env.loaded_kwargs = kwargs
            return pipe

    fake_torch = types.ModuleType("torch")
    fake_torch.float16 = "float16"
    fake_torch.cuda = types.SimpleNamespace(device_count=lambda: device_count)
    fake_diffusers = types.ModuleType("diffusers")
    fake_diffusers.AutoPipelineForText2Image = FakeFactory
    fake_hub = types.ModuleType("huggingface_hub")
    fake_hub.hf_hub_download = fake_hf_hub_download

    def resolve_weight(repo, weight):  # noqa: ANN001, ANN201
        env.weight_calls.append((repo, weight))
        return local_weight

    with (
        mock.patch.dict(
            sys.modules,
            {"torch": fake_torch, "diffusers": fake_diffusers, "huggingface_hub": fake_hub},
        ),
        mock.patch.object(d.CACHE, "resolve_local_model", return_value="/local/base"),
        mock.patch.object(d.CACHE, "ensure_disk_capacity"),
        mock.patch.object(d.CACHE, "resolve_local_weight", side_effect=resolve_weight),
    ):
        yield env


def lora_spec(**overrides) -> dict:  # noqa: ANN003
    spec = dict(FLUX2_SPEC)
    spec["lora"] = {**LORA, **overrides}
    return spec


class Flux2LoraBuildTest(DaemonUnitTest):
    """flux2 LoRA 走 build_pipeline（daemon 完整加载路径）。"""

    def test_premounted_weight_is_used_and_remote_download_skipped(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, local_weight="/mnt/lora/style.safetensors") as env:
            built, identity = d.build_pipeline(lora_spec())
        self.assertIs(built, pipe)
        self.assertEqual(identity, f"flux2:{BASE}")
        self.assertEqual(env.weight_calls, [(LORA["repo"], LORA["weight"])])
        self.assertEqual(env.hub_calls, [], "预挂载命中时不应联网下载")
        self.assertEqual(
            pipe.lora_calls,
            [("/mnt/lora", {"weight_name": "style.safetensors", "adapter_name": FLUX2_LORA_ADAPTER})],
        )
        self.assertEqual(pipe.adapter_calls, [], "scale 缺省（1.0）时不该调用 set_adapters")
        self.assertLogContains("[load] 使用预挂载 LoRA 权重：/mnt/lora/style.safetensors")
        self.assertLogContains(f"[load] flux2 LoRA 已挂载：{LORA['repo']}/{LORA['weight']}")

    def test_remote_download_when_not_premounted(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, local_weight=None) as env:
            d.build_pipeline(lora_spec())
        self.assertEqual(env.weight_calls, [(LORA["repo"], LORA["weight"])])
        self.assertEqual(env.hub_calls, [(LORA["repo"], LORA["weight"], {})])
        self.assertEqual(
            pipe.lora_calls,
            [(LORA["repo"], {"weight_name": LORA["weight"], "adapter_name": FLUX2_LORA_ADAPTER})],
        )
        self.assertLogContains(f"[load] LoRA 权重就绪：{HUB_PATH}")

    def test_absent_or_null_lora_keeps_existing_behaviour(self) -> None:
        for with_null in (False, True):
            pipe = FakeFlux2Pipe()
            spec = dict(FLUX2_SPEC)
            if with_null:
                spec["lora"] = None
            with flux2_build_env(pipe=pipe) as env:
                built, _identity = d.build_pipeline(spec)
            self.assertIs(built, pipe)
            self.assertEqual(pipe.lora_calls, [], "没有 lora 配置时不得挂载任何权重")
            self.assertEqual(env.weight_calls, [])
            self.assertNotIn("[load] flux2 LoRA", self.logs())

    def test_missing_lora_fields_is_request_error_before_loading_base(self) -> None:
        for lora in ({}, {"repo": LORA["repo"]}, {"weight": LORA["weight"]}):
            pipe = FakeFlux2Pipe()
            with flux2_build_env(pipe=pipe) as env:
                with self.assertRaises(d.RequestError) as caught:
                    d.build_pipeline({**FLUX2_SPEC, "lora": lora})
            self.assertIn("lora.repo 与 lora.weight", str(caught.exception))
            self.assertEqual(pipe.lora_calls, [])
            self.assertIsNone(env.loaded_kwargs, "缺字段必须在校验阶段拒绝，不能先加载底座")

    def test_invalid_scale_is_request_error(self) -> None:
        for scale in ("0.6", True, float("nan")):
            with flux2_build_env(pipe=FakeFlux2Pipe()):
                with self.assertRaises(d.RequestError) as caught:
                    d.build_pipeline(lora_spec(scale=scale))
            self.assertIn("lora.scale", str(caught.exception), scale)

    def test_mount_failure_is_load_error_and_frees_cache(self) -> None:
        pipe = FakeFlux2Pipe()
        pipe.load_lora_error = RuntimeError("peft 注入失败")
        freed: list[bool] = []
        with flux2_build_env(pipe=pipe), mock.patch.object(
            d, "free_cuda_cache", side_effect=lambda: freed.append(True)
        ):
            with self.assertRaises(d.LoadError) as caught:
                d.build_pipeline(lora_spec())
        self.assertIn("flux2 LoRA 挂载失败", str(caught.exception))
        self.assertIn("peft 注入失败", str(caught.exception))
        self.assertNotIsInstance(caught.exception, d.RequestError)
        self.assertEqual(pipe.lora_calls, [])
        self.assertEqual(freed, [True], "加载失败要回收显存")

    def test_pipe_without_lora_api_is_load_error_not_silent_skip(self) -> None:
        class NoLoraPipe(FakeFlux2Pipe):
            load_lora_weights = None

        with flux2_build_env(pipe=NoLoraPipe()):
            with self.assertRaises(d.LoadError) as caught:
                d.build_pipeline(lora_spec())
        self.assertIn("load_lora_weights", str(caught.exception))

    def test_scale_is_applied_with_set_adapters(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, local_weight="/mnt/lora/style.safetensors"):
            d.build_pipeline(lora_spec(scale=0.6))
        self.assertEqual(pipe.adapter_calls, [(FLUX2_LORA_ADAPTER, 0.6)])
        self.assertLogContains("scale=0.6")

    def test_null_scale_keeps_default_weight(self) -> None:
        """资产模板可选键常写 null：lora.scale=null 按缺省 1.0 处理，不当成请求错误。"""
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, local_weight="/mnt/lora/style.safetensors"):
            d.build_pipeline(lora_spec(scale=None))
        self.assertEqual(pipe.adapter_calls, [], "null scale 等价于默认 1.0，不调用 set_adapters")

    def test_missing_set_adapters_with_scale_is_load_error(self) -> None:
        class NoScalePipe(FakeFlux2Pipe):
            set_adapters = None

        with flux2_build_env(pipe=NoScalePipe(), local_weight="/mnt/lora/style.safetensors"):
            with self.assertRaises(d.LoadError) as caught:
                d.build_pipeline(lora_spec(scale=0.6))
        self.assertIn("set_adapters", str(caught.exception))

    def test_mounts_with_device_map_balanced(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, device_count=2) as env:
            d.build_pipeline(lora_spec())
        self.assertEqual(env.loaded_kwargs["device_map"], "balanced")
        self.assertEqual(len(pipe.lora_calls), 1, "device_map 分片路径必须挂上 LoRA")
        self.assertIsNone(pipe.device, "device_map 路径不应再 .to('cuda')")

    def test_mounts_on_single_gpu_path(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe, device_count=1) as env:
            d.build_pipeline(lora_spec())
        self.assertNotIn("device_map", env.loaded_kwargs)
        self.assertEqual(pipe.device, "cuda")
        self.assertEqual(len(pipe.lora_calls), 1, "单卡路径同样必须挂上 LoRA")

    def test_required_repos_includes_lora_repo_for_keep_set(self) -> None:
        """切模型 keep_set 不能漏掉 LoRA 仓库，否则缓存清理会删掉还要用的权重。"""
        self.assertEqual(d.LOADERS.required_repos(lora_spec()), [BASE, LORA["repo"]])


class Flux2LoraConstructTest(DaemonUnitTest):
    """verify payload 的兼容入口：construct 直接用调用方给的本地权重。"""

    def test_construct_reports_downloaded_path_to_callback(self) -> None:
        pipe = FakeFlux2Pipe()
        records: list[str] = []
        with flux2_build_env(pipe=pipe, local_weight=None):
            built = d.LOADERS.get("flux2").construct(
                lora_spec(),
                source="/local/base",
                on_lora_download=records.append,
                log=d.log,
                error_cls=d.LoadError,
                request_error_cls=d.RequestError,
            )
        self.assertIs(built, pipe)
        self.assertEqual(records, [HUB_PATH], "payload 需要拿到下载路径统计体积")

    def test_construct_prefers_local_weight_argument(self) -> None:
        pipe = FakeFlux2Pipe()
        with flux2_build_env(pipe=pipe) as env:
            d.LOADERS.get("flux2").construct(
                lora_spec(),
                source="/local/base",
                local_lora_weight="/premount/lora/style.safetensors",
                log=d.log,
                error_cls=d.LoadError,
                request_error_cls=d.RequestError,
            )
        self.assertEqual(env.hub_calls, [])
        self.assertEqual(
            pipe.lora_calls,
            [("/premount/lora", {"weight_name": "style.safetensors", "adapter_name": FLUX2_LORA_ADAPTER})],
        )


if __name__ == "__main__":
    import unittest

    unittest.main()
