"""图生图参考图。

提交期只读头校验、执行期一次性解码与等比缩放、请求体上限推导、Pillow 集成用例。

拆分自 test/daemon-unit.py，运行：python test/remote/test_reference.py
"""

from __future__ import annotations

import unittest
import base64
import io
import sys
from unittest import mock

from support import (
    CONTRACT_DOC,
    CONTRACT,
    CONTRACT_VERSION,
    DaemonUnitTest,
    FakeDecompressionBombError,
    FakePILImage,
    FakeUnidentifiedImageError,
    HAS_PILLOW,
    _RealPILImage,
    d,
    fake_pil_for,
    fake_pil_raising,
    fake_pil_sequence,
    make_generate_handler,
    make_mask_b64,
    make_pipeline,
    make_reference,
    make_reference_b64,
)


# ─────────────────────────────────────────────────────────────────────────────
# v0.9 M3：图生图（垫图重绘）
# ─────────────────────────────────────────────────────────────────────────────


class ReferenceLimitsTest(DaemonUnitTest):
    """参考图/重绘强度边界一律来自注入契约，不写死数值。"""

    def limits(self) -> dict:
        return CONTRACT["limits"]

    def test_reference_limits_come_from_contract(self) -> None:
        self.contract_config()
        spec = d._limit_spec("reference")
        reference = self.limits()["reference"]
        for key in ("maxBytes", "maxEdge", "minEdge"):
            self.assertEqual(spec[key], reference[key])

    def test_mask_limits_come_from_contract(self) -> None:
        self.contract_config()
        spec = d._limit_spec("mask")
        mask = self.limits()["mask"]
        for key in ("maxBytes",):
            self.assertEqual(spec[key], mask[key])

    def test_strength_limits_include_default_from_contract(self) -> None:
        self.contract_config()
        spec = d._limit_spec("strength")
        strength = self.limits()["strength"]
        for key in ("min", "max", "step", "default"):
            self.assertEqual(spec[key], strength[key])

    def test_strength_normalization_is_contract_driven(self) -> None:
        self.contract_config()
        strength = self.limits()["strength"]
        default = strength["default"]
        cases = [
            (None, default),
            (True, default),
            ("bad", default),
            (float("nan"), default),
            (float("inf"), default),
            (-5, strength["min"]),
            (99, strength["max"]),
            (0.55, 0.55),
            ("0.5", 0.5),
        ]
        for value, expected in cases:
            self.assertEqual(d._coerce_strength(value), expected, f"strength={value!r}")

    def test_custom_contract_values_are_honoured(self) -> None:
        d.CONFIG.contract = {
            "version": CONTRACT_VERSION,
            "limits": {
                **self.limits(),
                "reference": {"maxBytes": 4096, "maxEdge": 512, "minEdge": 64},
                "strength": {"min": 0.1, "max": 0.8, "step": 0.05, "default": 0.5},
            },
        }
        reference = d._limit_spec("reference")
        self.assertEqual(
            (reference["maxBytes"], reference["maxEdge"], reference["minEdge"]), (4096, 512, 64)
        )
        self.assertEqual(d._coerce_strength(-1), 0.1)
        self.assertEqual(d._coerce_strength(9), 0.8)
        self.assertEqual(d._coerce_strength("bad"), 0.5)

    def test_fallback_limits_without_contract(self) -> None:
        # 契约缺失（旧 Host / 本地调试）时仍能用内置兜底，数值与当前契约同量级。
        reference = d._limit_spec("reference")
        self.assertGreater(reference["maxBytes"], 0)
        self.assertGreater(reference["maxEdge"], reference["minEdge"])
        self.assertGreater(d._limit_spec("strength")["max"], d._limit_spec("strength")["min"])

    def test_request_body_limit_follows_contract_base64_size(self) -> None:
        self.contract_config()
        limits = self.limits()
        # 局部重绘是「参考图 + 蒙版」两张图片：上限必须按两者之和推导，否则两者同时顶格的
        # 合法请求会先在 _read_json 的请求体闸门被拒掉。
        max_bytes = limits["reference"]["maxBytes"] + limits["mask"]["maxBytes"]
        base64_size = 4 * ((max_bytes + 2) // 3)
        limit = d._request_body_limit()
        # 8MiB 参考图 + 2MiB 蒙版 base64 后约 14MB：必须能通过。
        self.assertGreater(limit, base64_size)
        self.assertEqual(limit, max(8 * 1024 * 1024, base64_size + 1024 * 1024))

    def test_request_body_limit_follows_builtin_reference_without_contract(self) -> None:
        """Batch 3：注入契约没给 reference / mask 时，边界来自内置 contract.json。

        因此请求体上限也按内置 maxBytes 推导（约 14.3MB），不再固定 8MB——否则校验器
        认了 8MiB 参考图 + 2MiB 蒙版、`_read_json` 却先按 8MB 把请求拒掉。
        """
        d.CONFIG.contract = {"version": CONTRACT_VERSION, "limits": {"prompt": {"maxChars": 2000}}}
        limits = CONTRACT_DOC["limits"]
        max_bytes = limits["reference"]["maxBytes"] + limits["mask"]["maxBytes"]
        expected = max(8 * 1024 * 1024, 4 * ((max_bytes + 2) // 3) + 1024 * 1024)
        self.assertEqual(d._request_body_limit(), expected)
        self.assertGreater(d._request_body_limit(), 8 * 1024 * 1024)

    def test_read_json_rejects_body_over_limit(self) -> None:
        self.contract_config()
        handler = object.__new__(d.DaemonHandler)
        handler.headers = {"Content-Length": str(d._request_body_limit() + 1)}
        handler.rfile = io.BytesIO(b"")
        with self.assertRaises(d.RequestError) as ctx:
            handler._read_json()
        self.assertIn("请求体超过", str(ctx.exception))

    def test_read_json_parses_small_body(self) -> None:
        handler = object.__new__(d.DaemonHandler)
        handler.headers = {"Content-Length": "2"}
        handler.rfile = io.BytesIO(b"{}")
        self.assertEqual(handler._read_json(), {})


class ReferenceValidationTest(DaemonUnitTest):
    """提交期参考图校验：不需要完整解码，失败一律 RequestError（HTTP 400）。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        self.pipeline = make_pipeline()

    def parse(self, raw, pipeline=None):  # noqa: ANN001, ANN202
        return d.parse_reference_spec(raw, pipeline or self.pipeline)

    def test_missing_reference_means_text2img(self) -> None:
        self.assertIsNone(self.parse(None))

    def test_rejects_non_object(self) -> None:
        for raw in ("base64", [], 123):
            with self.assertRaises(d.RequestError):
                self.parse(raw)

    def test_rejects_unsupported_loader(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            for loader in ("flux2", "anima"):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(make_reference(), make_pipeline(loader))
                self.assertIn("该模型不支持垫图重绘", str(ctx.exception))

    def test_accepts_sdxl_and_sdxl_lora(self) -> None:
        for loader in ("sdxl", "sdxl-lora"):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((1024, 768)))):
                spec = self.parse(make_reference(), make_pipeline(loader))
            self.assertEqual((spec["width"], spec["height"]), (1024, 768))

    def test_rejects_missing_or_empty_image_b64(self) -> None:
        for raw in ({}, {"image_b64": ""}, {"image_b64": "   "}, {"image_b64": 123}):
            with self.assertRaises(d.RequestError):
                self.parse(raw)

    def test_rejects_invalid_base64(self) -> None:
        for encoded in ("not base64!!", "abc", "@@@", "a"):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse({"image_b64": encoded})
            self.assertIn("合法 base64", str(ctx.exception))

    def test_rejects_oversize_payload_using_contract_limit(self) -> None:
        # 用较小契约上限验证体积口径，同时证明边界来自契约而不是本文件常量。
        d.CONFIG.contract = {
            "limits": {
                **CONTRACT["limits"],
                "reference": {"maxBytes": 32, "maxEdge": 1024, "minEdge": 64},
            }
        }
        with self.assertRaises(d.RequestError) as ctx:
            self.parse({"image_b64": make_reference_b64(b"x" * 33)})
        self.assertIn("超过上限", str(ctx.exception))
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            spec = self.parse({"image_b64": make_reference_b64(b"x" * 32)})
        self.assertEqual(spec["width"], 512)

    def test_rejects_non_png_jpeg(self) -> None:
        for fmt in ("WEBP", "GIF", "BMP", ""):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512), fmt=fmt))):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(make_reference())
                self.assertIn("PNG 或 JPEG", str(ctx.exception))

    def test_rejects_unidentified_and_bomb_images(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_raising(FakeUnidentifiedImageError("x"))):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("PNG 或 JPEG", str(ctx.exception))
        with mock.patch.dict(sys.modules, fake_pil_raising(FakeDecompressionBombError("x"))):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("分辨率过大", str(ctx.exception))

    def test_rejects_too_small_image(self) -> None:
        min_edge = CONTRACT["limits"]["reference"]["minEdge"]
        with mock.patch.dict(
            sys.modules, fake_pil_for(FakePILImage((min_edge - 1, min_edge // 2)))
        ):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("长边至少", str(ctx.exception))

    def test_accepts_image_at_min_edge(self) -> None:
        min_edge = CONTRACT["limits"]["reference"]["minEdge"]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((min_edge // 2, min_edge)))):
            spec = self.parse(make_reference())
        self.assertEqual((spec["width"], spec["height"]), (min_edge // 2, min_edge))

    def test_large_image_is_accepted_for_later_resize(self) -> None:
        # 提交期只校验最小边；超过 maxEdge 不拒绝，留给执行期等比缩小。
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        with mock.patch.dict(
            sys.modules, fake_pil_for(FakePILImage((max_edge * 2, max_edge)))
        ):
            spec = self.parse(make_reference())
        self.assertEqual((spec["width"], spec["height"]), (max_edge * 2, max_edge))

    def test_strength_is_clamped_to_contract(self) -> None:
        limits = CONTRACT["limits"]["strength"]
        cases = [
            (None, limits["default"]),  # 缺省
            ("bad", limits["default"]),
            (True, limits["default"]),
            (-5, limits["min"]),
            (99, limits["max"]),
            (0.55, 0.55),
        ]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            for raw_strength, expected in cases:
                raw = make_reference()
                if raw_strength is not None:
                    raw["strength"] = raw_strength
                spec = self.parse(raw)
                self.assertEqual(spec["strength"], expected, f"strength={raw_strength!r}")

    def test_returns_normalized_spec(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((800, 600)))):
            spec = self.parse(make_reference(strength=0.35))
        self.assertEqual(
            set(spec), {"image_bytes", "strength", "width", "height"}
        )
        self.assertIsInstance(spec["image_bytes"], bytes)
        self.assertEqual((spec["width"], spec["height"]), (800, 600))
        self.assertEqual(spec["strength"], 0.35)


class ReferenceDecodeTest(DaemonUnitTest):
    """执行期完整解码一次：等比 LANCZOS 缩小、转 RGB、损坏图片按请求非法收敛。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def reference(self) -> dict:
        return {"image_bytes": b"fake-image-bytes", "strength": 0.6, "width": 1, "height": 1}

    def decode(self, image):  # noqa: ANN001, ANN202
        with mock.patch.dict(sys.modules, fake_pil_for(image)):
            return d.decode_reference_image(self.reference())

    def test_downscales_long_edge_with_lanczos(self) -> None:
        source = FakePILImage((2048, 1024))
        image = self.decode(source)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size, (max_edge, max_edge // 2))
        self.assertEqual(source.resized[1], "LANCZOS")
        self.assertTrue(source.loaded)
        self.assertEqual(image._imagen_source_size, (2048, 1024))

    def test_does_not_upscale_small_image(self) -> None:
        source = FakePILImage((1024, 512))
        image = self.decode(source)
        self.assertEqual(image.size, (1024, 512))
        self.assertIsNone(source.resized)
        self.assertEqual(image._imagen_source_size, (1024, 512))

    def test_uses_contract_max_edge(self) -> None:
        d.CONFIG.contract = {
            "limits": {
                **CONTRACT["limits"],
                "reference": {"maxBytes": 1024, "maxEdge": 256, "minEdge": 64},
            }
        }
        source = FakePILImage((1024, 512))
        image = self.decode(source)
        self.assertEqual(image.size, (256, 128))

    def test_keeps_aspect_ratio_on_odd_sizes(self) -> None:
        source = FakePILImage((1537, 1001))
        image = self.decode(source)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size[0], max_edge)
        self.assertEqual(image.size[1], round(1001 * max_edge / 1537))

    def test_converts_to_rgb(self) -> None:
        source = FakePILImage((800, 600), fmt="JPEG", mode="RGBA")
        image = self.decode(source)
        self.assertEqual(source.converted, "RGB")
        self.assertEqual(image.mode, "RGB")

    def test_truncated_image_is_request_error(self) -> None:
        source = FakePILImage((512, 512))
        source.load_error = OSError("truncated")
        with mock.patch.dict(sys.modules, fake_pil_for(source)):
            with self.assertRaises(d.RequestError) as ctx:
                d.decode_reference_image(self.reference())
        self.assertIn("无法解码", str(ctx.exception))

    def test_missing_bytes_is_request_error(self) -> None:
        for reference in (None, {}, {"image_bytes": b""}, {"image_bytes": "str"}):
            with self.assertRaises(d.RequestError):
                d.decode_reference_image(reference)


class MaskValidationTest(DaemonUnitTest):
    """局部重绘蒙版（reference.mask_b64）提交期校验：只读图片头，失败一律 RequestError。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        self.pipeline = make_pipeline()

    def parse(self, raw, pipeline=None):  # noqa: ANN001, ANN202
        return d.parse_reference_spec(raw, pipeline or self.pipeline)

    def masked(self, mask_b64=None, strength=None):  # noqa: ANN001, ANN202
        return make_reference(
            strength=strength, mask_b64=make_mask_b64() if mask_b64 is None else mask_b64
        )

    def test_no_mask_keeps_spec_shape(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            spec = self.parse(make_reference())
        self.assertEqual(set(spec), {"image_bytes", "strength", "width", "height"})

    def test_accepts_mask_on_sdxl_family(self) -> None:
        for loader in ("sdxl", "sdxl-lora"):
            with mock.patch.dict(
                sys.modules,
                fake_pil_sequence([FakePILImage((1024, 768)), FakePILImage((64, 32))]),
            ):
                spec = self.parse(self.masked(), make_pipeline(loader))
            self.assertIsInstance(spec["mask_bytes"], bytes)
            self.assertEqual((spec["mask_width"], spec["mask_height"]), (64, 32))
            self.assertEqual((spec["width"], spec["height"]), (1024, 768))

    def test_rejects_mask_on_non_inpaint_loader(self) -> None:
        # 服务端独立兜底：即使 Host / 前端没置灰，非白名单 loader 带蒙版也必须 400。
        for loader in ("flux2", "anima"):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(self.masked(), make_pipeline(loader))
            self.assertIn("该模型不支持局部重绘", str(ctx.exception))

    def test_mask_without_reference_image_is_rejected(self) -> None:
        # 蒙版是 reference 的可选字段：没有 image_b64 时仍按「缺参考图」拒绝。
        for raw in ({"mask_b64": make_mask_b64()}, {"mask_b64": make_mask_b64(), "image_b64": ""}):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(raw)
            self.assertIn("reference.image_b64", str(ctx.exception))

    def test_rejects_empty_or_non_string_mask(self) -> None:
        for value in ("", "   ", 123, [], {}):
            raw = make_reference()
            raw["mask_b64"] = value
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
                with self.assertRaises(d.RequestError):
                    self.parse(raw)

    def test_rejects_invalid_base64_mask(self) -> None:
        for encoded in ("not base64!!", "abc", "@@@"):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(self.masked(mask_b64=encoded))
            self.assertIn("reference.mask_b64 不是合法 base64", str(ctx.exception))

    def test_rejects_oversize_mask_using_contract_limit(self) -> None:
        d.CONFIG.contract = {
            "limits": {**CONTRACT["limits"], "mask": {"maxBytes": 16}},
        }
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(self.masked(mask_b64=make_mask_b64(b"m" * 17)))
        self.assertIn("蒙版体积", str(ctx.exception))
        self.assertIn("超过上限", str(ctx.exception))
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((512, 512)), FakePILImage((64, 64))]),
        ):
            spec = self.parse(self.masked(mask_b64=make_mask_b64(b"m" * 16)))
        self.assertEqual(spec["mask_width"], 64)

    def test_rejects_non_png_mask(self) -> None:
        for fmt in ("JPEG", "WEBP", "GIF", "BMP", ""):
            with mock.patch.dict(
                sys.modules,
                fake_pil_sequence([FakePILImage((512, 512)), FakePILImage((64, 64), fmt=fmt)]),
            ):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(self.masked())
            self.assertIn("蒙版必须是 PNG", str(ctx.exception))

    def test_rejects_unidentified_and_bomb_mask(self) -> None:
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((512, 512)), FakeUnidentifiedImageError("x")]),
        ):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(self.masked())
            self.assertIn("蒙版必须是 PNG", str(ctx.exception))
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((512, 512)), FakeDecompressionBombError("x")]),
        ):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(self.masked())
            self.assertIn("蒙版分辨率过大", str(ctx.exception))

    def test_small_mask_is_accepted(self) -> None:
        # 蒙版可以比参考图小（画布上只涂一小块），尺寸对齐在执行期做，因此不校验最小长边。
        min_edge = CONTRACT["limits"]["reference"]["minEdge"]
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((512, 512)), FakePILImage((8, 8))]),
        ):
            spec = self.parse(self.masked())
        self.assertEqual((spec["mask_width"], spec["mask_height"]), (8, 8))
        self.assertLess(max(8, 8), min_edge)


class MaskDecodeTest(DaemonUnitTest):
    """执行期蒙版解码：转灰度 'L'、最近邻对齐参考图宽高、损坏/缺失按请求非法收敛。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def mask(self) -> dict:
        return {"mask_bytes": b"fake-mask-bytes", "mask_width": 1, "mask_height": 1}

    def decode(self, image, size=(1024, 768)):  # noqa: ANN001, ANN202
        with mock.patch.dict(sys.modules, fake_pil_for(image)):
            return d.decode_mask_image(self.mask(), size)

    def test_converts_to_grayscale(self) -> None:
        source = FakePILImage((1024, 768), mode="RGB")
        image = self.decode(source)
        self.assertEqual(source.converted, "L")
        self.assertEqual(image.mode, "L")

    def test_resizes_to_reference_size_with_nearest(self) -> None:
        source = FakePILImage((64, 32), mode="L")
        image = self.decode(source, size=(1024, 768))
        self.assertEqual(image.size, (1024, 768))
        self.assertEqual(source.resized[1], "NEAREST", "二值蒙版必须最近邻缩放，插值会造出灰边")

    def test_keeps_size_when_already_aligned(self) -> None:
        source = FakePILImage((1024, 768), mode="L")
        image = self.decode(source)
        self.assertEqual(image.size, (1024, 768))
        self.assertIsNone(source.resized)

    def test_keeps_original_mask_size_for_logging(self) -> None:
        source = FakePILImage((64, 32), mode="L")
        image = self.decode(source, size=(1024, 768))
        self.assertEqual(image._imagen_source_size, (64, 32))

    def test_truncated_mask_is_request_error(self) -> None:
        source = FakePILImage((64, 64), mode="L")
        source.load_error = OSError("truncated")
        with mock.patch.dict(sys.modules, fake_pil_for(source)):
            with self.assertRaises(d.RequestError) as ctx:
                d.decode_mask_image(self.mask(), (1024, 768))
        self.assertIn("蒙版无法解码", str(ctx.exception))

    def test_missing_mask_bytes_is_request_error(self) -> None:
        for mask in (None, {}, {"mask_bytes": b""}, {"mask_bytes": "str"}):
            with self.assertRaises(d.RequestError):
                d.decode_mask_image(mask, (512, 512))


@unittest.skipUnless(HAS_PILLOW, "需要 Pillow 做真实 PNG/JPEG 解码的集成用例")
class ReferencePillowIntegrationTest(DaemonUnitTest):
    """真实 Pillow 集成用例（CI 不装 Pillow 时跳过；本地与 Kaggle 环境会执行）。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    @staticmethod
    def encode(image_bytes_io, fmt: str) -> str:  # noqa: ANN001
        return base64.b64encode(image_bytes_io.getvalue()).decode("ascii")

    def png_b64(self, size, color=(200, 60, 40)) -> str:  # noqa: ANN001
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", size, color).save(buffer, format="PNG")
        return self.encode(buffer, "PNG")

    def test_parse_real_png_and_clamp_strength(self) -> None:
        max_strength = CONTRACT["limits"]["strength"]["max"]
        spec = d.parse_reference_spec(
            {"image_b64": self.png_b64((300, 200)), "strength": 9}, make_pipeline()
        )
        self.assertEqual((spec["width"], spec["height"]), (300, 200))
        self.assertEqual(spec["strength"], max_strength)

    def test_decode_real_png_downscales_to_contract_max_edge(self) -> None:
        spec = d.parse_reference_spec({"image_b64": self.png_b64((1600, 800))}, make_pipeline())
        image = d.decode_reference_image(spec)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size, (max_edge, max_edge // 2))
        self.assertEqual(image.mode, "RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        self.assertGreater(len(buffer.getvalue()), 8)

    def test_accepts_real_jpeg(self) -> None:
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", (256, 256), (10, 10, 10)).save(buffer, format="JPEG")
        spec = d.parse_reference_spec(
            {"image_b64": base64.b64encode(buffer.getvalue()).decode("ascii")}, make_pipeline()
        )
        self.assertEqual((spec["width"], spec["height"]), (256, 256))

    def test_rejects_real_bmp(self) -> None:
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", (256, 256), (10, 10, 10)).save(buffer, format="BMP")
        with self.assertRaises(d.RequestError):
            d.parse_reference_spec(
                {"image_b64": base64.b64encode(buffer.getvalue()).decode("ascii")},
                make_pipeline(),
            )


    def mask_png_b64(self, size, fill=255, mode="L") -> str:  # noqa: ANN001
        buffer = io.BytesIO()
        color = fill if mode == "L" else (fill, fill, fill)
        _RealPILImage.new(mode, size, color).save(buffer, format="PNG")
        return self.encode(buffer, "PNG")

    def test_parse_and_decode_real_mask_alignment(self) -> None:
        spec = d.parse_reference_spec(
            {"image_b64": self.png_b64((300, 200)), "mask_b64": self.mask_png_b64((64, 32))},
            make_pipeline(),
        )
        self.assertEqual((spec["mask_width"], spec["mask_height"]), (64, 32))
        mask = d.decode_mask_image(spec, (300, 200))
        self.assertEqual(mask.size, (300, 200), "蒙版必须精确对齐到参考图宽高")
        self.assertEqual(mask.mode, "L")
        self.assertEqual(mask._imagen_source_size, (64, 32))

    def test_decode_real_rgb_mask_converts_to_grayscale(self) -> None:
        spec = d.parse_reference_spec(
            {
                "image_b64": self.png_b64((256, 256)),
                "mask_b64": self.mask_png_b64((128, 128), mode="RGB"),
            },
            make_pipeline(),
        )
        mask = d.decode_mask_image(spec, (256, 256))
        self.assertEqual(mask.mode, "L")
        self.assertEqual(mask.size, (256, 256))

    def test_rejects_real_jpeg_mask(self) -> None:
        buffer = io.BytesIO()
        _RealPILImage.new("L", (64, 64), 255).save(buffer, format="JPEG")
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_spec(
                {"image_b64": self.png_b64((256, 256)), "mask_b64": self.encode(buffer, "JPEG")},
                make_pipeline(),
            )
        self.assertIn("蒙版必须是 PNG", str(ctx.exception))


class GenerateWithReferenceTest(DaemonUnitTest):
    """POST /generate 的参考图路径：提交期 400 与入队后的规范化结果。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        d.STATE.phase = "ready"

    def generate(self, spec):  # noqa: ANN001, ANN202
        handler, sent = make_generate_handler(spec)
        d.DaemonHandler._handle_generate(handler)
        return sent

    def spec_with(self, reference=None, pipeline=None, loader=None):  # noqa: ANN001, ANN202
        pipeline = pipeline or make_pipeline(loader or "sdxl")
        spec = {"pipeline": pipeline, "tasks": [{"prompt": "p"}]}
        if reference is not None:
            spec["reference"] = reference
        return spec

    def test_unsupported_loader_returns_400(self) -> None:
        for loader in ("flux2", "anima"):
            sent = self.generate(self.spec_with(make_reference(), loader=loader))
            self.assertEqual(sent[0][0], 400)
            self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
            self.assertIn("该模型不支持垫图重绘", sent[0][1]["error"]["message"])
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_invalid_base64_returns_400(self) -> None:
        sent = self.generate(self.spec_with({"image_b64": "not base64!!"}))
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertIn("合法 base64", sent[0][1]["error"]["message"])
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_valid_reference_is_enqueued_with_normalized_strength(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((1024, 768)))):
            sent = self.generate(self.spec_with(make_reference(strength=9)))
        self.assertEqual(sent[0][0], 202)
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertIsNotNone(job.reference)
        self.assertEqual(job.reference["strength"], CONTRACT["limits"]["strength"]["max"])
        self.assertEqual((job.reference["width"], job.reference["height"]), (1024, 768))
        self.assertEqual(d.JOB_STORE.queue_depth(), 1)
        self.assertLogContains("带参考图")

    def test_text2img_spec_has_no_reference(self) -> None:
        sent = self.generate(self.spec_with(None))
        self.assertEqual(sent[0][0], 202)
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertIsNone(job.reference)
        self.assertNotIn("带参考图", self.logs())


class GenerateWithMaskTest(DaemonUnitTest):
    """POST /generate 的局部重绘路径：白名单拦截 400，合法请求入队时带蒙版字节。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        d.STATE.phase = "ready"

    def generate(self, spec):  # noqa: ANN001, ANN202
        handler, sent = make_generate_handler(spec)
        d.DaemonHandler._handle_generate(handler)
        return sent

    def spec_with(self, loader="sdxl"):  # noqa: ANN001, ANN202
        return {
            "pipeline": make_pipeline(loader),
            "tasks": [{"prompt": "局部重绘"}],
            "reference": make_reference(mask_b64=make_mask_b64()),
        }

    def test_mask_on_unsupported_loader_returns_400(self) -> None:
        for loader in ("flux2", "anima"):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
                sent = self.generate(self.spec_with(loader=loader))
            self.assertEqual(sent[0][0], 400)
            self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
            self.assertIn("该模型不支持局部重绘", sent[0][1]["error"]["message"])
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_mask_request_is_enqueued_with_mask_bytes(self) -> None:
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((1600, 800)), FakePILImage((64, 32))]),
        ):
            sent = self.generate(self.spec_with())
        self.assertEqual(sent[0][0], 202)
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertIsNotNone(job.reference)
        self.assertEqual((job.reference["width"], job.reference["height"]), (1600, 800))
        self.assertEqual((job.reference["mask_width"], job.reference["mask_height"]), (64, 32))
        self.assertIsInstance(job.reference["mask_bytes"], bytes)
        self.assertEqual(d.JOB_STORE.queue_depth(), 1)

@unittest.skipUnless(HAS_PILLOW, "需要 Pillow 才能验证蒙版羽化与像素级合成")
class MaskFeatherCompositeTest(DaemonUnitTest):
    """远端蒙版处理：外扩 + 羽化，以及出图后按蒙版把原图未涂抹区贴回。"""

    def setUp(self) -> None:
        super().setUp()

    @staticmethod
    def rect_mask(size=(256, 256), inset=64, fill=255):  # noqa: ANN001, ANN202
        image = _RealPILImage.new("L", size, 0)
        image.paste(fill, (inset, inset, size[0] - inset, size[1] - inset))
        return image

    def test_feather_keeps_core_white_and_corner_black(self) -> None:
        mask = self.rect_mask()
        feathered = d.feather_mask_image(mask)
        self.assertIsNot(feathered, mask, "应返回新图，不改调用方持有的蒙版")
        self.assertEqual(feathered.size, (256, 256))
        self.assertEqual(feathered.mode, "L")
        self.assertGreater(feathered.getpixel((128, 128)), 245, "涂抹中心仍应接近全白")
        self.assertEqual(feathered.getpixel((2, 2)), 0, "远离边界处应严格保留为黑")
        self.assertEqual(feathered.getpixel((253, 253)), 0)

    def test_feather_creates_transition_band_at_boundary(self) -> None:
        mask = self.rect_mask()
        feathered = d.feather_mask_image(mask)
        # 原始边界在 x=64；羽化带应出现在边界附近（外扩 + 高斯过渡）。
        band = [feathered.getpixel((x, 128)) for x in range(40, 70)]
        self.assertTrue(any(0 < value < 255 for value in band), f"边界应有灰度过渡：{band}")

    def test_feather_keeps_source_size_for_logging(self) -> None:
        mask = self.rect_mask(size=(128, 96))
        mask._imagen_source_size = (32, 24)
        feathered = d.feather_mask_image(mask)
        self.assertEqual(feathered._imagen_source_size, (32, 24))

    def test_feather_passes_non_pil_objects_through(self) -> None:
        marker = object()
        self.assertIs(d.feather_mask_image(marker), marker)

    def test_composite_keeps_black_region_exact(self) -> None:
        original = _RealPILImage.new("RGB", (128, 128), (10, 20, 30))
        generated = _RealPILImage.new("RGB", (128, 128), (200, 100, 50))
        mask = self.rect_mask(size=(128, 128), inset=32)
        composed = d.composite_inpaint_image(generated, original, mask)
        self.assertIsNot(composed, generated)
        self.assertEqual(composed.size, (128, 128))
        self.assertEqual(composed.getpixel((2, 2)), (10, 20, 30), "黑区必须与参考图像素完全一致")
        self.assertEqual(composed.getpixel((126, 126)), (10, 20, 30))
        self.assertEqual(composed.getpixel((64, 64)), (200, 100, 50), "白区取生成结果")

    def test_composite_resizes_generated_to_reference(self) -> None:
        original = _RealPILImage.new("RGB", (128, 96), (10, 20, 30))
        generated = _RealPILImage.new("RGB", (64, 48), (200, 100, 50))
        mask = self.rect_mask(size=(128, 96), inset=24)
        composed = d.composite_inpaint_image(generated, original, mask)
        self.assertEqual(composed.size, (128, 96))

    def test_composite_passes_non_pil_through(self) -> None:
        marker = object()
        self.assertIs(d.composite_inpaint_image(marker, marker, marker), marker)

class NativeInpaintReferenceTest(DaemonUnitTest):
    """nativeInpaint 底座的提交期拦截：文生图与「只有参考图没有蒙版」都必须 400。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def native_pipeline(self) -> dict:
        return {**make_pipeline(), "nativeInpaint": True}

    def test_text2img_request_is_rejected(self) -> None:
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_spec(None, self.native_pipeline())
        self.assertIn("只支持局部重绘", str(ctx.exception))

    def test_reference_without_mask_is_rejected(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_spec(make_reference(), self.native_pipeline())
        self.assertIn("涂抹蒙版", str(ctx.exception))

    def test_reference_with_mask_is_accepted(self) -> None:
        raw = make_reference(strength=0.8, mask_b64=make_mask_b64())
        with mock.patch.dict(
            sys.modules,
            fake_pil_sequence([FakePILImage((1024, 768)), FakePILImage((64, 32))]),
        ):
            spec = d.parse_reference_spec(raw, self.native_pipeline())
        self.assertEqual((spec["mask_width"], spec["mask_height"]), (64, 32))
        self.assertEqual(spec["strength"], 0.8)
if __name__ == "__main__":
    unittest.main()
