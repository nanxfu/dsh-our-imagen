"""实验性加速缓存（``pipeline.accel.cache``）与 apply_accel 的兼容边界。

cache 只用于真机 A/B 探针、不写进模型资产：不支持时 WARN 并继续（不阻断出图），
重复应用按 transformer 标记幂等跳过，from_pipe 派生管线共享 transformer 时不重复应用。
另覆盖 cache 与四个稳定 accel 开关共存、非法配置逐项降级，以及 block 登记表预检
（未注册 / 输出形状混合 → 不适用，对应 diffusers 0.43 的 flux2 双栈）。

全部用例使用假 diffusers / 假管线，不联网、不占 GPU。

运行：python test/remote/test_accel_cache.py
"""

from __future__ import annotations

import sys
import types
from contextlib import contextmanager
from unittest import mock

from support import DaemonUnitTest, d

from remote.inference.loaders.diffusers import ACCEL_FLAGS, FIRST_BLOCK_CACHE_ATTR


class FakeTransformer:
    """firstBlock cache 只要求是对象：应用标记直接挂在它身上。"""


class TensorOutputBlock:
    """单一输出形状的 block（firstBlock 支持）。"""


class TupleOutputBlock:
    """返回 (encoder, hidden) 元组的 block。"""


class UnregisteredBlock:
    """未登记进 TransformerBlockRegistry 的 block 类。"""


class FakeTransformerModule:
    """按 named_children() 暴露 block 容器的最小 transformer 替身（不继承 torch.nn.Module）。"""

    def __init__(self, containers) -> None:
        self._containers = list(containers)

    def named_children(self):  # noqa: ANN201
        return iter(self._containers)


TENSOR_META = types.SimpleNamespace(return_encoder_hidden_states_index=None)
TUPLE_META = types.SimpleNamespace(return_encoder_hidden_states_index=0)


@contextmanager
def transformer_registry_env(*, metadata=None, get_error=None):
    """注入假 diffusers.hooks 私有登记表，供 block 兼容性预检读取。"""
    registry = dict(metadata or {})

    class FakeTransformerBlockRegistry:
        @classmethod
        def get(cls, model_class):  # noqa: ANN001, ANN206
            if get_error is not None:
                raise get_error
            if model_class not in registry:
                raise ValueError(f"Model class {model_class} not registered.")
            return registry[model_class]

    common = types.ModuleType("diffusers.hooks._common")
    common._ALL_TRANSFORMER_BLOCK_IDENTIFIERS = ("transformer_blocks", "single_transformer_blocks")
    helpers = types.ModuleType("diffusers.hooks._helpers")
    helpers.TransformerBlockRegistry = FakeTransformerBlockRegistry
    with mock.patch.dict(
        sys.modules,
        {"diffusers.hooks._common": common, "diffusers.hooks._helpers": helpers},
    ):
        yield


class FakeVAE:
    def __init__(self) -> None:
        self.tiling = 0
        self.slicing = 0

    def enable_tiling(self) -> None:
        self.tiling += 1

    def enable_slicing(self) -> None:
        self.slicing += 1


class FakeCachePipe:
    """带可选 transformer / vae 的假管线；apply_accel 只按属性探测，不需要 __call__。"""

    def __init__(self, *, transformer=True, vae=False) -> None:
        self.transformer = FakeTransformer() if transformer else None
        self.vae = FakeVAE() if vae else None


@contextmanager
def cache_env(*, supported=True, apply_error=None):
    """注入假 diffusers：记录 apply_first_block_cache 调用与收到的 config。"""
    calls: list[tuple] = []

    class FakeFirstBlockCacheConfig:
        def __init__(self, threshold=0.05):
            self.threshold = threshold

    def fake_apply_first_block_cache(module, config):  # noqa: ANN001, ANN201
        calls.append((module, config))
        if apply_error is not None:
            raise apply_error

    fake_diffusers = types.ModuleType("diffusers")
    if supported:
        fake_diffusers.FirstBlockCacheConfig = FakeFirstBlockCacheConfig
        fake_diffusers.apply_first_block_cache = fake_apply_first_block_cache
    with mock.patch.dict(sys.modules, {"diffusers": fake_diffusers}):
        yield calls


def spec(accel: dict, loader: str = "flux2") -> dict:
    return {"loader": loader, "base": "black-forest-labs/FLUX.2-klein-4B", "accel": accel}


class ExperimentalCacheApplyTest(DaemonUnitTest):
    """cache 的应用 / 降级 / 幂等。"""

    def apply(self, pipe, accel: dict, *, supported=True, apply_error=None):  # noqa: ANN001, ANN201
        with cache_env(supported=supported, apply_error=apply_error) as calls:
            result = d.LOADERS.apply_accel(spec(accel), pipe, log=d.log)
        return result, calls

    def test_cache_only_is_applied_with_default_threshold(self) -> None:
        pipe = FakeCachePipe()
        result, calls = self.apply(pipe, {"cache": {"type": "firstBlock"}})
        self.assertIs(result, pipe)
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0][0], pipe.transformer)
        self.assertEqual(calls[0][1].threshold, 0.05, "threshold 缺省取 diffusers 默认值 0.05")
        self.assertIn("[accel] firstBlock cache 已应用（threshold=0.05）", self.logs())
        self.assertEqual(getattr(pipe.transformer, FIRST_BLOCK_CACHE_ATTR), 0.05)

    def test_cache_threshold_is_forwarded(self) -> None:
        _result, calls = self.apply(FakeCachePipe(), {"cache": {"type": "firstBlock", "threshold": 0.2}})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1].threshold, 0.2)

    def test_cache_coexists_with_stable_flags(self) -> None:
        pipe = FakeCachePipe(vae=True)
        accel = {"vaeTiling": True, "cache": {"type": "firstBlock", "threshold": 0.1}}
        result, calls = self.apply(pipe, accel)
        self.assertIs(result, pipe)
        self.assertEqual(pipe.vae.tiling, 1, "稳定开关照旧生效")
        self.assertEqual(len(calls), 1, "cache 在稳定开关之后单独应用")
        self.assertIn("[accel] 应用推理加速开关：vaeTiling", self.logs())

    def test_repeat_apply_is_idempotent(self) -> None:
        pipe = FakeCachePipe()
        accel = {"cache": {"type": "firstBlock"}}
        with cache_env() as calls:
            for _ in range(3):
                d.LOADERS.apply_accel(spec(accel), pipe, log=d.log)
        self.assertEqual(len(calls), 1, "重复 apply 会叠加 hook，必须按标记跳过")
        self.assertIn("已应用 firstBlock cache，跳过重复应用", self.logs())

    def test_from_pipe_derived_pipeline_does_not_reapply(self) -> None:
        """from_pipe 派生管线共享同一 transformer：只能应用一次。"""
        base = FakeCachePipe()
        accel = {"cache": {"type": "firstBlock", "threshold": 0.1}}
        d.STATE.pipeline_spec = spec(accel)
        with cache_env() as calls:
            d.LOADERS.apply_accel(spec(accel), base, log=d.log)
            derived = FakeCachePipe()
            derived.transformer = base.transformer
            result = d._apply_pipeline_accel(derived)
        self.assertIs(result, derived)
        self.assertEqual(len(calls), 1)
        self.assertIn("跳过重复应用", self.logs())

    def test_unknown_cache_type_warns_and_keeps_pipeline(self) -> None:
        pipe = FakeCachePipe()
        result, calls = self.apply(pipe, {"cache": {"type": "teaCache"}})
        self.assertIs(result, pipe)
        self.assertEqual(calls, [])
        self.assertIn("[accel] WARN cache 不适用：", self.logs())
        self.assertIn("teaCache", self.logs())

    def test_missing_cache_type_warns(self) -> None:
        _result, calls = self.apply(FakeCachePipe(), {"cache": {}})
        self.assertEqual(calls, [])
        self.assertIn("不支持的 cache.type", self.logs())

    def test_non_object_cache_config_warns(self) -> None:
        _result, calls = self.apply(FakeCachePipe(), {"cache": ["firstBlock"]})
        self.assertEqual(calls, [])
        self.assertIn("cache 配置必须是对象", self.logs())

    def test_invalid_threshold_warns(self) -> None:
        for threshold in ("0.1", True, float("inf")):
            _result, calls = self.apply(FakeCachePipe(), {"cache": {"type": "firstBlock", "threshold": threshold}})
            self.assertEqual(calls, [], threshold)
        self.assertIn("cache.threshold 必须是数字", self.logs())
        self.assertIn("cache.threshold 必须是有限数字", self.logs())

    def test_pipe_without_transformer_warns(self) -> None:
        pipe = FakeCachePipe(transformer=False)
        result, calls = self.apply(pipe, {"cache": {"type": "firstBlock"}})
        self.assertIs(result, pipe)
        self.assertEqual(calls, [])
        self.assertIn("该管线没有 transformer", self.logs())

    def test_unsupported_diffusers_api_warns_and_continues(self) -> None:
        pipe = FakeCachePipe()
        result, calls = self.apply(pipe, {"cache": {"type": "firstBlock"}}, supported=False)
        self.assertIs(result, pipe, "探针开关不支持时必须继续出图，不能抛错")
        self.assertEqual(calls, [])
        self.assertIn("未导出 apply_first_block_cache", self.logs())

    def test_apply_failure_warns_and_continues(self) -> None:
        """block 类未注册等应用期异常：WARN 后继续，且不写应用标记（下次仍可重试）。"""
        pipe = FakeCachePipe()
        result, _calls = self.apply(
            pipe,
            {"cache": {"type": "firstBlock"}},
            apply_error=ValueError("Model class <Flux2TransformerBlock> not registered."),
        )
        self.assertIs(result, pipe)
        self.assertIn("[accel] WARN cache 不适用：应用失败", self.logs())
        self.assertIn("not registered", self.logs())
        self.assertIsNone(getattr(pipe.transformer, FIRST_BLOCK_CACHE_ATTR, None))

    def test_anima_loader_ignores_cache_block(self) -> None:
        """anima 不是 diffusers 管线：apply_accel 保持无操作，不 import diffusers。"""
        pipe = object()
        with cache_env() as calls:
            result = d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}, loader="anima"), pipe, log=d.log)
        self.assertIs(result, pipe)
        self.assertEqual(calls, [])


class TransformerCachePreflightTest(DaemonUnitTest):
    """block 登记表预检：不支持时在挂 hook 之前就 WARN 跳过，避免半套 hook / 前向崩溃。"""

    def pipe_with(self, containers) -> FakeCachePipe:  # noqa: ANN001, ANN201
        pipe = FakeCachePipe()
        pipe.transformer = FakeTransformerModule(containers)
        return pipe

    def test_mixed_block_output_shapes_are_rejected(self) -> None:
        """对应 diffusers 0.43 的 flux2 双栈：double block 返回元组、single block 返回 tensor。"""
        pipe = self.pipe_with(
            [
                ("transformer_blocks", [TupleOutputBlock(), TupleOutputBlock()]),
                ("single_transformer_blocks", [TensorOutputBlock(), TensorOutputBlock()]),
            ]
        )
        with cache_env() as calls, transformer_registry_env(
            metadata={TupleOutputBlock: TUPLE_META, TensorOutputBlock: TENSOR_META}
        ):
            result = d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertIs(result, pipe)
        self.assertEqual(calls, [], "预检判定不适用时不得调用 apply_first_block_cache")
        self.assertIn("block 输出形状混合", self.logs())
        self.assertIsNone(getattr(pipe.transformer, FIRST_BLOCK_CACHE_ATTR, None))

    def test_unregistered_block_class_is_rejected(self) -> None:
        pipe = self.pipe_with([("transformer_blocks", [UnregisteredBlock(), UnregisteredBlock()])])
        with cache_env() as calls, transformer_registry_env(metadata={}):
            d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertEqual(calls, [])
        self.assertIn("block 类未注册：UnregisteredBlock", self.logs())

    def test_too_few_blocks_is_rejected(self) -> None:
        pipe = self.pipe_with([("transformer_blocks", [TensorOutputBlock()])])
        with cache_env() as calls, transformer_registry_env(metadata={TensorOutputBlock: TENSOR_META}):
            d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertEqual(calls, [])
        self.assertIn("不足 2 个", self.logs())

    def test_homogeneous_registered_blocks_are_applied(self) -> None:
        pipe = self.pipe_with(
            [
                ("transformer_blocks", [TensorOutputBlock(), TensorOutputBlock()]),
                ("single_transformer_blocks", [TensorOutputBlock(), TensorOutputBlock()]),
            ]
        )
        with cache_env() as calls, transformer_registry_env(metadata={TensorOutputBlock: TENSOR_META}):
            d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0][0], pipe.transformer)

    def test_missing_registry_table_falls_back_to_apply(self) -> None:
        """版本差异拿不到私有登记表时不预检，交给 apply 自身报错兜底。"""
        pipe = self.pipe_with([("transformer_blocks", [TensorOutputBlock(), TensorOutputBlock()])])
        with cache_env() as calls:
            d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertEqual(len(calls), 1)

    def test_registry_failure_does_not_block_pipeline(self) -> None:
        """预检自身异常（登记表损坏等）不能让加载失败：退回 apply，由它的异常处理兜底。"""
        pipe = self.pipe_with([("transformer_blocks", [TensorOutputBlock(), TensorOutputBlock()])])
        with cache_env() as calls, transformer_registry_env(get_error=RuntimeError("登记表损坏")):
            result = d.LOADERS.apply_accel(spec({"cache": {"type": "firstBlock"}}), pipe, log=d.log)
        self.assertIs(result, pipe)
        self.assertEqual(len(calls), 1)


class CacheIsProbeOnlyTest(DaemonUnitTest):
    """cache 只是请求级探针：不进稳定开关镜像，也不进模型资产契约。"""

    def test_cache_is_not_a_stable_accel_flag(self) -> None:
        self.assertNotIn("cache", ACCEL_FLAGS)
        self.assertEqual(set(ACCEL_FLAGS), {"vaeTiling", "vaeSlicing", "channelsLast", "fuseQkv"})

    def test_absent_cache_keeps_old_behaviour(self) -> None:
        pipe = FakeCachePipe()
        with cache_env() as calls:
            result = d.LOADERS.apply_accel(spec({}), pipe, log=d.log)
        self.assertIs(result, pipe)
        self.assertEqual(calls, [])
        self.assertNotIn("[accel]", self.logs())


if __name__ == "__main__":
    import unittest

    unittest.main()
