"""加载器注册表与调度器。

LoaderRegistry 的白名单/keep_set/构建路径、家族分支（flux2 / anima）、调度器配方表。

拆分自 test/daemon-unit.py，运行：python test/remote/test_loaders.py
"""

from __future__ import annotations

import re
import sys
import types
from unittest import mock

from support import (
    DAEMON_PATH,
    DaemonUnitTest,
    d,
    make_spec,
    remote_anima_loader,
    remote_loader_base,
    remote_pipeline_loader,
    remote_registry,
)


class LoaderRegistryBoundaryTest(DaemonUnitTest):
    """切片⑥e：loader 分支收进 LOADERS，白名单 / 垫图 / keep_set / 构建共用同一个入口。"""

    def test_registry_is_the_single_owner_of_the_loader_surface(self) -> None:
        self.assertIsInstance(d.LOADERS, remote_registry.LoaderRegistry)
        self.assertIs(
            d.LOADERS,
            remote_registry.default_registry(),
            "daemon 与 pipeline_loader 必须是同一份注册表，否则白名单会出现两个版本",
        )
        # 白名单与垫图 / 局部重绘能力是注册表的只读投影，不是第二份常量。
        self.assertEqual(d.SUPPORTED_LOADERS, d.LOADERS.names())
        self.assertEqual(d.SUPPORTED_IMG2IMG_LOADERS, d.LOADERS.img2img_names())
        self.assertEqual(d.SUPPORTED_INPAINT_LOADERS, d.LOADERS.inpaint_names())
        self.assertEqual(d.SUPPORTED_LOADERS, ("sdxl", "sdxl-lora", "flux2", "anima"))
        self.assertEqual(d.SUPPORTED_IMG2IMG_LOADERS, ("sdxl", "sdxl-lora"))
        # 首期局部重绘只对 SDXL 家族开放：与垫图名单独立登记，互不连坐。
        self.assertEqual(d.SUPPORTED_INPAINT_LOADERS, ("sdxl", "sdxl-lora"))

    def test_daemon_no_longer_branches_on_loader_names(self) -> None:
        source = DAEMON_PATH.read_text(encoding="utf-8")
        for pattern in ('== "anima"', '== "sdxl"', '== "sdxl-lora"', '== "flux2"'):
            self.assertNotIn(pattern, source, f"daemon.py 不应再按 loader 名分支：{pattern}")
        self.assertIsNone(
            re.search(r"(?m)^from pipeline_loader import .*load_diffusers_pipeline", source),
            "构建入口已归注册表，daemon 不再直接引用",
        )
        self.assertIsNone(re.search(r"(?m)^def _from_pretrained\(", source), "死包装已删")

    def test_build_pipeline_delegates_with_the_live_collaborators(self) -> None:
        seen: list[tuple] = []

        def fake_build(spec, ctx):  # noqa: ANN001, ANN202
            seen.append((spec, ctx))
            return object(), f"{spec['loader']}:{spec['base']}"

        with mock.patch.object(d.LOADERS, "build", side_effect=fake_build):
            _pipe, identity = d.build_pipeline({"loader": "sdxl", "base": "org/base"})
        self.assertEqual(identity, "sdxl:org/base")
        spec, ctx = seen[0]
        self.assertEqual(spec["loader"], "sdxl")
        self.assertIsInstance(ctx, remote_loader_base.LoadContext)
        # 上下文必须握同一份活对象：否则单测替换 CACHE / free_cuda_cache 会打在影子对象上。
        self.assertIs(ctx.cache, d.CACHE)
        self.assertIs(ctx.error_cls, d.LoadError)
        self.assertIs(ctx.request_error_cls, d.RequestError)
        self.assertIs(ctx.release_gpu, d.free_cuda_cache)

    def test_unknown_loader_wording_is_shared_by_submit_and_load(self) -> None:
        """行为变更：加载期不再只说"未知 loader：x"，与提交期用同一句（带 repr 与白名单）。"""
        spec = {"loader": "nope", "base": "org/base"}
        with self.assertRaises(d.RequestError) as load_ctx:
            d.build_pipeline(spec)
        with self.assertRaises(d.RequestError) as submit_ctx:
            d.validate_generate_spec(make_spec(pipeline=spec))
        expected = "未知 loader：'nope'（支持 sdxl, sdxl-lora, flux2, anima）"
        self.assertEqual(str(load_ctx.exception), expected)
        self.assertEqual(str(submit_ctx.exception), expected)

    def test_diffusers_entry_rejects_anima_with_a_readable_reason(self) -> None:
        """verify payload 的构建入口只处理 diffusers 家族；anima 要指出正确路径。"""
        with self.assertRaises(ValueError) as ctx:
            remote_pipeline_loader.load_diffusers_pipeline({"loader": "anima", "base": "org/anima"})
        self.assertIn("不是 diffusers 加载器", str(ctx.exception))
        self.assertIn("sdxl, sdxl-lora, flux2", str(ctx.exception))
        with self.assertRaises(ValueError) as unknown:
            remote_pipeline_loader.load_diffusers_pipeline({"loader": "nope", "base": "org/x"})
        self.assertIn("未知 loader：'nope'", str(unknown.exception))

    def test_registry_rejects_duplicate_and_nameless_loaders(self) -> None:
        class Dummy(remote_loader_base.ModelLoader):
            name = "dummy"

        registry = remote_registry.LoaderRegistry([Dummy()])
        with self.assertRaises(ValueError):
            registry.register(Dummy())
        # ModelLoader 基类的 name 是空串：注册表必须当场拒绝，而不是塞进白名单里。
        with self.assertRaises(ValueError):
            remote_registry.LoaderRegistry([remote_loader_base.ModelLoader()])
        self.assertEqual(registry.names(), ("dummy",))

    def test_every_registered_loader_keeps_the_generic_scan_as_its_floor(self) -> None:
        """keep_set 只许多不许少：任何 loader 的 required_repos 都不能窄于通用扫描。"""
        spec = {
            "loader": "sdxl",
            "base": "org/base",
            "vae": {"repo": "Qwen/Qwen-Image"},
            "lora": {"repo": "ByteDance/SDXL-Lightning", "weight": "w.safetensors"},
        }
        generic = d.pipeline_repos(spec)
        for name in d.SUPPORTED_LOADERS:
            spec["loader"] = name
            self.assertEqual(d.LOADERS.required_repos(spec), generic, name)

    def test_keep_set_reads_the_registry_not_the_daemon_alias(self) -> None:
        """缓存闸门必须消费注册表的推导结果，否则新 loader 声明的额外仓库会被删掉。"""

        class ExtraRepoLoader(remote_loader_base.ModelLoader):
            name = "extra"
            supports_img2img = False

            def required_repos(self, spec):  # noqa: ANN001, ANN201
                return ["org/base", "org/extra"]

        with mock.patch.dict(d.LOADERS._loaders, {"extra": ExtraRepoLoader()}):
            keep = d.CACHE.cache_keep_repos({"loader": "extra", "base": "org/base"})
        self.assertEqual(keep, {"org/base", "org/extra"})

    def test_failed_load_releases_gpu_except_for_request_errors(self) -> None:
        released: list[bool] = []
        ctx = remote_loader_base.LoadContext(
            cache=d.CACHE,
            log=d.log,
            error_cls=d.LoadError,
            request_error_cls=d.RequestError,
            release_gpu=lambda: released.append(True),
        )
        loader = d.LOADERS.get("sdxl")
        with mock.patch.object(loader, "prepare_base", return_value="/local/base"), mock.patch.object(
            loader, "construct", side_effect=d.LoadError("boom")
        ):
            with self.assertRaises(d.LoadError):
                loader.load({"loader": "sdxl", "base": "org/base"}, ctx)
        self.assertEqual(released, [True])
        # 请求非法发生在加载之前：不清显存，免得掩盖真正的 400 原因。
        with mock.patch.object(loader, "prepare_base", return_value="/local/base"), mock.patch.object(
            loader, "construct", side_effect=d.RequestError("缺 lora")
        ):
            with self.assertRaises(d.RequestError):
                loader.load({"loader": "sdxl", "base": "org/base"}, ctx)
        self.assertEqual(released, [True])

    def test_anima_oom_passes_through_unchanged(self) -> None:
        released: list[bool] = []
        ctx = remote_loader_base.LoadContext(
            cache=d.CACHE,
            log=d.log,
            error_cls=d.LoadError,
            request_error_cls=d.RequestError,
            release_gpu=lambda: released.append(True),
        )
        with mock.patch.object(
            remote_anima_loader, "load_anima_runtime", side_effect=RuntimeError("CUDA out of memory")
        ):
            with self.assertRaises(RuntimeError) as caught:
                d.LOADERS.get("anima").load({"loader": "anima", "base": "org/anima"}, ctx)
        self.assertNotIsInstance(caught.exception, d.LoadError)
        self.assertEqual(released, [True])


class SchedulerSpecTest(DaemonUnitTest):
    """sdxl 与 sdxl-lora 对 pipeline.scheduler 的识别与替换。"""

    def _run_build(self, pipeline_spec: dict):
        scheduler_calls = []

        class FakeScheduler:
            def __init__(self, name: str, config: dict, kwargs: dict) -> None:
                self.name = name
                self.config = config
                self.kwargs = kwargs

        def make_scheduler_cls(name: str):
            class _Cls:
                @staticmethod
                def from_config(config, **kwargs):
                    scheduler_calls.append((name, kwargs))
                    return FakeScheduler(name, config, kwargs)

            return _Cls

        class FakePipe:
            def __init__(self) -> None:
                self.scheduler = types.SimpleNamespace(config={"num_train_timesteps": 1000})
                self.lora_loaded = []
                self.device = None

            def to(self, device: str):
                self.device = device
                return self

            def load_lora_weights(self, folder: str, weight_name: str = "") -> None:
                self.lora_loaded.append((folder, weight_name))

        class FakeFactory:
            @staticmethod
            def from_pretrained(source, **_kwargs):
                return FakePipe()

        fake_torch = types.ModuleType("torch")
        fake_torch.float16 = "float16"

        fake_diffusers = types.ModuleType("diffusers")
        fake_diffusers.AutoPipelineForText2Image = FakeFactory
        fake_diffusers.StableDiffusionXLPipeline = FakeFactory
        fake_diffusers.EulerDiscreteScheduler = make_scheduler_cls("euler")
        fake_diffusers.EulerAncestralDiscreteScheduler = make_scheduler_cls("euler-a")
        fake_diffusers.DPMSolverSinglestepScheduler = make_scheduler_cls("dpmpp-sde")
        fake_diffusers.DPMSolverMultistepScheduler = make_scheduler_cls("dpmpp-2m")

        with (
            mock.patch.dict(sys.modules, {"torch": fake_torch, "diffusers": fake_diffusers}),
            mock.patch.object(d.CACHE, "resolve_local_model", return_value="/local/base"),
            mock.patch.object(d.CACHE, "resolve_local_weight", return_value="/local/lora/w.safetensors"),
            mock.patch.object(d.CACHE, "ensure_disk_capacity"),
        ):
            pipe, loaded = d.build_pipeline(pipeline_spec)
        return pipe, loaded, scheduler_calls

    def test_sdxl_applies_dpmpp_sde_karras(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "SG161222/RealVisXL_V5.0",
                "scheduler": {"type": "dpmpp-sde-karras"},
            }
        )
        self.assertEqual(loaded, "sdxl:SG161222/RealVisXL_V5.0")
        self.assertEqual(
            calls,
            [("dpmpp-sde", {"use_karras_sigmas": True, "algorithm_type": "sde-dpmsolver++"})],
        )
        self.assertEqual(pipe.scheduler.name, "dpmpp-sde")

    def test_sdxl_applies_dpmpp_2m_sde_karras(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "SG161222/RealVisXL_V5.0",
                "scheduler": {"type": "dpmpp-2m-sde-karras"},
            }
        )
        self.assertEqual(loaded, "sdxl:SG161222/RealVisXL_V5.0")
        self.assertEqual(
            calls,
            [("dpmpp-2m", {"use_karras_sigmas": True, "algorithm_type": "sde-dpmsolver++"})],
        )
        self.assertEqual(pipe.scheduler.name, "dpmpp-2m")

    def test_sdxl_without_scheduler_keeps_base_default(self) -> None:
        pipe, _loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "stabilityai/sdxl-turbo",
                "scheduler": None,
            }
        )
        self.assertEqual(calls, [])
        self.assertFalse(hasattr(pipe.scheduler, "name"))

    def test_sdxl_lora_defaults_to_euler_trailing(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl-lora",
                "base": "stabilityai/stable-diffusion-xl-base-1.0",
                "lora": {"repo": "ByteDance/SDXL-Lightning", "weight": "sdxl_lightning_4step_lora.safetensors"},
            }
        )
        self.assertEqual(loaded, "sdxl-lora:stabilityai/stable-diffusion-xl-base-1.0")
        self.assertEqual(calls, [("euler", {"timestep_spacing": "trailing"})])
        self.assertEqual(pipe.scheduler.name, "euler")


class LoaderFamilyBuildTest(DaemonUnitTest):
    """切片⑥e 搬迁前的空档：flux2 与 anima 的两条分支此前没有走 build_pipeline 的用例。"""

    def test_flux2_uses_device_map_and_does_not_move_to_cuda(self) -> None:
        seen: dict = {}

        class FakePipe:
            def __init__(self) -> None:
                self.device = None

            def to(self, device: str):
                self.device = device
                return self

        class FakeFactory:
            @staticmethod
            def from_pretrained(source, **kwargs):  # noqa: ANN001
                seen["source"] = source
                seen["kwargs"] = kwargs
                return FakePipe()

        fake_torch = types.ModuleType("torch")
        fake_torch.float16 = "float16"
        fake_diffusers = types.ModuleType("diffusers")
        fake_diffusers.AutoPipelineForText2Image = FakeFactory

        with (
            mock.patch.dict(sys.modules, {"torch": fake_torch, "diffusers": fake_diffusers}),
            mock.patch.object(d.CACHE, "resolve_local_model", return_value=None),
            mock.patch.object(d.CACHE, "ensure_disk_capacity"),
            mock.patch.object(d.CACHE, "prefetch_weights") as prefetch,
        ):
            pipe, loaded = d.build_pipeline(
                {
                    "loader": "flux2",
                    "base": "black-forest-labs/FLUX.2-dev",
                    "deviceMap": "balanced",
                    "variant": "fp16",
                }
            )

        self.assertEqual(loaded, "flux2:black-forest-labs/FLUX.2-dev")
        self.assertEqual(seen["kwargs"]["device_map"], "balanced")
        self.assertEqual(seen["kwargs"]["variant"], "fp16")
        self.assertTrue(prefetch.called, "未命中预挂载时要按 allowPatterns 预下载")
        self.assertIsNone(pipe.device, "flux2 由 device_map 分层装载，不该再 .to('cuda')")

    def test_anima_dit_mount_skips_disk_capacity(self) -> None:
        with (
            mock.patch.object(d.CACHE, "anima_local_assets", return_value={"dit": "/mnt/anima.safetensors"}),
            mock.patch.object(
                d.CACHE, "ensure_disk_capacity", side_effect=AssertionError("DiT 命中时不应做磁盘预检")
            ),
            mock.patch.object(remote_anima_loader, "load_anima_runtime", return_value=(object(), 0, 0.1)),
        ):
            _pipe, identity = d.build_pipeline({"loader": "anima", "base": "org/anima"})
        self.assertEqual(identity, "anima:org/anima")
        self.assertLogContains("使用预挂载 anima DiT 权重")

    def test_anima_without_dit_runs_capacity_and_prefetch(self) -> None:
        calls: list[str] = []
        with (
            mock.patch.object(d.CACHE, "anima_local_assets", return_value={}),
            mock.patch.object(d.CACHE, "resolve_local_model", return_value=None),
            mock.patch.object(d.CACHE, "ensure_disk_capacity", side_effect=lambda spec: calls.append("capacity")),
            mock.patch.object(d.CACHE, "prefetch_weights", side_effect=lambda base, patterns: calls.append("prefetch")),
            mock.patch.object(remote_anima_loader, "load_anima_runtime", return_value=(object(), 0, 0.1)),
        ):
            d.build_pipeline({"loader": "anima", "base": "org/anima", "allowPatterns": ["*.safetensors"]})
        self.assertEqual(calls, ["capacity", "prefetch"])

class NativeInpaintLoaderTest(DaemonUnitTest):
    """sdxl loader 的 nativeInpaint 分支：用 AutoPipelineForInpainting 加载专用权重。"""

    def _build(self, pipeline_spec: dict):  # noqa: ANN202
        used_factories: list[str] = []

        class FakePipe:
            def __init__(self) -> None:
                self.scheduler = types.SimpleNamespace(config={"num_train_timesteps": 1000})
                self.device = None

            def to(self, device: str):
                self.device = device
                return self

        def factory(name: str):
            class FakeFactory:
                @staticmethod
                def from_pretrained(source, **_kwargs):
                    used_factories.append(name)
                    return FakePipe()

            return FakeFactory

        fake_torch = types.ModuleType("torch")
        fake_torch.float16 = "float16"
        fake_diffusers = types.ModuleType("diffusers")
        fake_diffusers.AutoPipelineForText2Image = factory("text2img")
        fake_diffusers.AutoPipelineForInpainting = factory("inpaint")

        with (
            mock.patch.dict(sys.modules, {"torch": fake_torch, "diffusers": fake_diffusers}),
            mock.patch.object(d.CACHE, "resolve_local_model", return_value=None),
            mock.patch.object(d.CACHE, "ensure_disk_capacity"),
            mock.patch.object(d.CACHE, "prefetch_weights"),
        ):
            pipe, loaded = d.build_pipeline(pipeline_spec)
        return pipe, loaded, used_factories

    def test_native_inpaint_uses_inpainting_factory(self) -> None:
        pipe, loaded, factories = self._build(
            {
                "loader": "sdxl",
                "base": "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
                "nativeInpaint": True,
            }
        )
        self.assertEqual(factories, ["inpaint"], "nativeInpaint 必须用 AutoPipelineForInpainting")
        self.assertEqual(loaded, "sdxl:diffusers/stable-diffusion-xl-1.0-inpainting-0.1")
        self.assertEqual(pipe.device, "cuda")

    def test_regular_sdxl_still_uses_text2img_factory(self) -> None:
        _pipe, _loaded, factories = self._build(
            {"loader": "sdxl", "base": "stabilityai/stable-diffusion-xl-base-1.0"}
        )
        self.assertEqual(factories, ["text2img"], "普通 sdxl 底座仍走文生图工厂")

if __name__ == "__main__":
    import unittest

    unittest.main()
