"""模型原生参考生图（supportsReference，阶段十五 Phase C1）与推理加速开关脚手架。

覆盖三块离线能力（均不联网、不占显存）：

1. ``referenceImages`` 提交期校验：loader 白名单、数量、体积、PNG/JPEG、最小长边、
   逐项只认 ``image_b64``（没有 strength / 蒙版语义）、与 ``reference`` 互斥；
2. 执行期解码与推理分支：整批只解码一次、转 RGB、长边缩放，``run_task`` 以
   ``image=[PIL...]`` 传给基础管线且 ``width``/``height`` 严格取请求值，
   结果结构与旧字段完全一致；
3. ``pipeline.accel`` 开关：缺省零行为变化、VAE tiling/slicing、UNet channels_last、
   fuse 幂等（含 from_pipe 派生管线共享 UNet 的场景）。

拆分自 test/daemon-unit.py 的按域组织约定，运行：python test/remote/test_reference_images.py
"""

from __future__ import annotations

import base64
import sys
import types
from unittest import mock

from support import (
    CONTRACT,
    CONTRACT_DOC,
    DaemonUnitTest,
    FakePILImage,
    TASKS,
    d,
    fake_pil_for,
    fake_pil_sequence,
    fake_torch_module,
    make_generate_handler,
    make_pipeline,
    make_reference,
    make_reference_b64,
)

REFERENCE_LIMITS = CONTRACT_DOC["limits"]["referenceImages"]


def make_reference_images(count: int = 1) -> list[dict]:
    """构造合法的 ``referenceImages`` 数组（假 PIL 不解析内容，只看 base64 与头部字段）。"""
    return [{"image_b64": make_reference_b64(f"fake-ref-{index}".encode())} for index in range(count)]


# ── 契约边界与 registry 能力位 ───────────────────────────────────────────────


class ReferenceImagesContractTest(DaemonUnitTest):
    """契约口径：独立边界、已下发远端、loader 白名单与能力位。"""

    def test_limits_are_independent_from_img2img_reference(self) -> None:
        limits = d._limit_spec("referenceImages")
        self.assertEqual(limits["maxCount"], 2)
        self.assertEqual(limits["maxBytes"], 4 * 1024 * 1024)
        self.assertEqual(limits["maxEdge"], 1024)
        self.assertEqual(limits["minEdge"], 128)
        # 与单图垫图（reference）是两份独立口径，不能被混成一份。
        reference = d._limit_spec("reference")
        self.assertNotEqual(limits["maxBytes"], reference["maxBytes"])
        self.assertNotEqual(limits["maxEdge"], reference["maxEdge"])
        self.assertEqual(d._limit_spec("referenceImages"), CONTRACT["limits"]["referenceImages"])

    def test_registry_exposes_reference_whitelist(self) -> None:
        self.assertEqual(d.SUPPORTED_REFERENCE_LOADERS, ("flux2", "qwen-image-2.1"))
        self.assertEqual(d.LOADERS.reference_names(), ("flux2", "qwen-image-2.1"))
        self.assertTrue(d.LOADERS.get("flux2").supports_reference)
        self.assertTrue(d.LOADERS.get("qwen-image-2.1").supports_reference)
        for name in ("sdxl", "sdxl-lora", "anima"):
            self.assertFalse(d.LOADERS.get(name).supports_reference, name)
        # 三条能力各自独立：flux2 只支持原生参考，不支持垫图 / 局部重绘。
        self.assertNotIn("flux2", d.SUPPORTED_IMG2IMG_LOADERS)
        self.assertNotIn("flux2", d.SUPPORTED_INPAINT_LOADERS)

    def test_request_body_limit_covers_four_images(self) -> None:
        d.CONFIG.contract = {}
        shape = REFERENCE_LIMITS["maxCount"] * REFERENCE_LIMITS["maxBytes"]
        self.assertGreater(d._request_body_limit(), 4 * ((shape + 2) // 3))


# ── 提交期校验 ───────────────────────────────────────────────────────────────


class ParseReferenceImagesTest(DaemonUnitTest):
    """``parse_reference_images``：只读图片头，失败路径全部收敛成 RequestError。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def test_none_means_text2img(self) -> None:
        self.assertIsNone(d.parse_reference_images(None, make_pipeline("flux2")))

    def test_rejects_non_list_and_empty_list(self) -> None:
        for raw in ({"image_b64": make_reference_b64()}, "x", 1):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_images(raw, make_pipeline("flux2"))
            self.assertIn("必须是数组", str(ctx.exception))
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images([], make_pipeline("flux2"))
        self.assertIn("不能为空数组", str(ctx.exception))

    def test_rejects_unsupported_loader(self) -> None:
        for loader in ("sdxl", "sdxl-lora", "anima"):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_images(make_reference_images(), make_pipeline(loader))
            self.assertIn("该模型不支持参考生图", str(ctx.exception))
        # 不静默丢弃：非支持模型收到参考图必须显式 400。
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_rejects_too_many_images(self) -> None:
        raw = make_reference_images(REFERENCE_LIMITS["maxCount"] + 1)
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images(raw, make_pipeline("flux2"))
        self.assertIn(f"最多 {REFERENCE_LIMITS['maxCount']} 张", str(ctx.exception))

    def test_rejects_non_object_item_and_unknown_fields(self) -> None:
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images(["not-an-object"], make_pipeline("flux2"))
        self.assertIn("必须是对象", str(ctx.exception))
        for extra in ({"strength": 0.6}, {"mask_b64": make_reference_b64()}, {"path": "x.png"}):
            item = {"image_b64": make_reference_b64(), **extra}
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_images([item], make_pipeline("flux2"))
            self.assertIn("只支持 image_b64", str(ctx.exception))
            self.assertIn("没有 strength 与蒙版语义", str(ctx.exception))

    def test_rejects_bad_base64_and_oversize(self) -> None:
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images([{"image_b64": "not base64!!"}], make_pipeline("flux2"))
        self.assertIn("合法 base64", str(ctx.exception))
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images([{"image_b64": ""}], make_pipeline("flux2"))
        self.assertIn("必须是非空字符串", str(ctx.exception))
        oversize = b"x" * (REFERENCE_LIMITS["maxBytes"] + 1)
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_reference_images(
                [{"image_b64": base64.b64encode(oversize).decode("ascii")}], make_pipeline("flux2")
            )
        self.assertIn("超过上限", str(ctx.exception))

    def test_rejects_wrong_format_and_too_small(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512), fmt="BMP"))):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_images(make_reference_images(), make_pipeline("flux2"))
        self.assertIn("PNG 或 JPEG", str(ctx.exception))
        with mock.patch.dict(
            sys.modules,
            fake_pil_for(FakePILImage((100, 120))),
        ):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_reference_images(make_reference_images(), make_pipeline("flux2"))
        self.assertIn("长边至少", str(ctx.exception))

    def test_valid_list_is_normalized_without_decoding(self) -> None:
        first = FakePILImage((1024, 768))
        second = FakePILImage((512, 512))
        with mock.patch.dict(sys.modules, fake_pil_sequence([first, second])):
            spec = d.parse_reference_images(make_reference_images(2), make_pipeline("flux2"))
        self.assertEqual(len(spec["items"]), 2)
        self.assertEqual((spec["items"][0]["width"], spec["items"][0]["height"]), (1024, 768))
        self.assertEqual((spec["items"][1]["width"], spec["items"][1]["height"]), (512, 512))
        # 提交期只读图片头：不解码像素（load 不会被调用）。
        self.assertFalse(first.loaded)
        self.assertFalse(second.loaded)


# ── 执行期解码 ───────────────────────────────────────────────────────────────


class DecodeReferenceImagesTest(DaemonUnitTest):
    """``decode_reference_images``：完整解码一次、转 RGB、长边缩放、失败关闭句柄。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def decode(self, items, images):  # noqa: ANN001, ANN202
        with mock.patch.dict(sys.modules, fake_pil_sequence(list(images))):
            return d.decode_reference_images(
                {"items": [{"image_bytes": b"data-%d" % index} for index in range(items)]}
            )

    def test_decodes_each_image_once_and_converts_to_rgb(self) -> None:
        first = FakePILImage((1600, 900), mode="RGBA")
        second = FakePILImage((400, 300))
        decoded = self.decode(2, [first, second])
        self.assertEqual(len(decoded), 2)
        # 长边 1600 > maxEdge 1024：按比例缩到 1024×576；小图不放大。
        self.assertEqual(decoded[0].size, (1024, 576))
        self.assertEqual(first.converted, "RGB", "非 RGB 图必须先转 RGB 再缩放")
        self.assertEqual(decoded[1].size, (400, 300))
        self.assertTrue(first.loaded, "执行期必须完整解码一次")
        self.assertTrue(second.loaded)
        self.assertEqual(getattr(decoded[0], "_imagen_source_size"), (1600, 900))

    def test_rejects_missing_or_non_dict_payload(self) -> None:
        with self.assertRaises(d.RequestError) as ctx:
            d.decode_reference_images(None)
        self.assertIn("referenceImages 必须是对象", str(ctx.exception))
        with self.assertRaises(d.RequestError) as ctx:
            d.decode_reference_images({"items": []})
        self.assertIn("参考图数据缺失", str(ctx.exception))
        with self.assertRaises(d.RequestError) as ctx:
            d.decode_reference_images({"items": [{"width": 1}]})
        self.assertIn("数据缺失，无法解码", str(ctx.exception))

    def test_truncated_image_is_request_error_and_closes_previous(self) -> None:
        first = FakePILImage((512, 512))
        broken = FakePILImage((512, 512))
        broken.load_error = OSError("truncated")
        with self.assertRaises(d.RequestError) as ctx:
            with mock.patch.dict(sys.modules, fake_pil_sequence([first, broken])):
                d.decode_reference_images(
                    {"items": [{"image_bytes": b"a"}, {"image_bytes": b"b"}]}
                )
        self.assertIn("无法解码", str(ctx.exception))
        self.assertTrue(first.closed, "第二张失败时必须关闭已解码的第一张")


# ── run_task 的参考分支与 execute_job 接线 ──────────────────────────────────


class RunTaskReferenceImagesTest(DaemonUnitTest):
    """``run_task`` 原生参考分支：基础管线 + image 列表 + 宽高取请求值。"""

    RESULT_KEYS = {
        "name",
        "seed",
        "seconds",
        "width",
        "height",
        "steps",
        "cfg",
        "png_bytes",
        "image_b64",
    }
    REFERENCE_SIG = {
        "prompt",
        "image",
        "num_inference_steps",
        "guidance_scale",
        "width",
        "height",
        "generator",
    }

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_pipe(self, image_size=(768, 512)):  # noqa: ANN001, ANN202
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-reference-png")

        class FakePipe:
            def __init__(self) -> None:
                self.calls = []
                self._execution_device = "cpu"

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakePipe()

    def references(self):  # noqa: ANN202
        first = FakePILImage((1600, 900))
        first._imagen_source_size = (1600, 900)
        second = FakePILImage((800, 800))
        second._imagen_source_size = (800, 800)
        return [first, second]

    def run_task_with(self, pipe=None, task=None, references=None):  # noqa: ANN001, ANN202
        pipe = pipe or self.make_pipe()
        references = self.references() if references is None else references
        d.STATE.sig_params = set(self.REFERENCE_SIG)
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(pipe, dict(TASKS[0] if task is None else task), reference_images=references)
        return pipe, result, references

    def test_uses_base_pipe_with_image_list_and_request_size(self) -> None:
        task = dict(TASKS[0], width=1024, height=768)
        pipe, _result, references = self.run_task_with(task=task)
        self.assertEqual(len(pipe.calls), 1)
        kwargs = pipe.calls[0]
        self.assertEqual(kwargs["prompt"], task["prompt"])
        self.assertEqual(kwargs["image"], references, "整批参考图以列表传给基础管线的 image=")
        self.assertEqual((kwargs["width"], kwargs["height"]), (1024, 768), "宽高必须取请求值")
        self.assertEqual(kwargs["num_inference_steps"], task["steps"])
        self.assertEqual(kwargs["guidance_scale"], task["cfg"])
        # 原生参考没有重绘强度 / 蒙版语义。
        self.assertNotIn("strength", kwargs)
        self.assertNotIn("mask_image", kwargs)
        self.assertEqual(kwargs["generator"].seed, task["seed"])

    def test_result_fields_unchanged(self) -> None:
        _pipe, result, references = self.run_task_with()
        self.assertEqual(set(result), self.RESULT_KEYS)
        self.assertEqual(len(result), len(self.RESULT_KEYS))
        self.assertNotIn("strength", result)
        self.assertTrue(all(isinstance(reference, FakePILImage) for reference in references))
        self.assertIn("[gen] reference 01 images=2", self.logs())
        self.assertIn("参考图 1 1600x900 → 1600x900", self.logs())

    def test_rejects_mixed_reference_shapes(self) -> None:
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            with self.assertRaises(d.RequestError) as ctx:
                d.run_task(
                    object(),
                    dict(TASKS[0]),
                    reference_image=FakePILImage((512, 512)),
                    reference_images=self.references(),
                )
        self.assertIn("不能同时使用", str(ctx.exception))

    def test_txt2img_still_passes_width_height(self) -> None:
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-txt2img")

        class FakePipe:
            def __init__(self) -> None:
                self.calls = []
                self._execution_device = "cpu"

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage((256, 256))])

        pipe = FakePipe()
        d.STATE.sig_params = set(self.REFERENCE_SIG)
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(pipe, dict(TASKS[0]))
        self.assertEqual(set(result), self.RESULT_KEYS)
        self.assertNotIn("image", pipe.calls[0])


class ExecuteJobReferenceImagesTest(DaemonUnitTest):
    """``execute_job``：整批参考图只解码一次、先解码后加载模型、解码后释放原始字节。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def submit_job_with(self, reference_images, task_count=2):  # noqa: ANN001, ANN202
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        pipeline = make_pipeline("flux2", "black-forest-labs/FLUX.2-klein-4B")
        return d.JOB_STORE.submit(
            pipeline,
            "black-forest-labs/FLUX.2-klein-4B",
            tasks,
            None,
            reference_images=reference_images,
        )

    def test_decodes_once_and_passes_to_run_tasks(self) -> None:
        reference_images = {"items": [{"image_bytes": b"a"}, {"image_bytes": b"b"}]}
        job, _created = self.submit_job_with(reference_images)
        decoded = [FakePILImage((1024, 1024)), FakePILImage((768, 512))]
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
            reference_images=None,
        ):
            captured.update(
                reference_images=reference_images,
                reference_image=reference_image,
                mask_image=mask_image,
                task_count=len(tasks),
            )
            return []

        with mock.patch.object(
            d, "decode_reference_images", return_value=decoded
        ) as decode, mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ) as ensure, mock.patch.object(d, "run_tasks", side_effect=fake_run_tasks):
            d.execute_job(job)
        self.assertEqual(decode.call_count, 1, "整批参考图只解码一次")
        ensure.assert_called_once()
        self.assertIs(captured["reference_images"], decoded)
        self.assertIsNone(captured["reference_image"])
        self.assertIsNone(captured["mask_image"])
        self.assertEqual(captured["task_count"], 2)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertIsNone(job.reference_images, "解码后应释放队列里保留的原始字节")
        for image in decoded:
            self.assertTrue(image.closed, "执行结束后必须关闭参考图句柄")

    def test_decode_failure_fails_job_without_loading_model(self) -> None:
        job, _created = self.submit_job_with({"items": [{"image_bytes": b"bad"}]})
        with mock.patch.object(
            d, "decode_reference_images", side_effect=d.RequestError("第 1 张参考图无法解码")
        ), mock.patch.object(d, "ensure_pipeline", side_effect=AssertionError("不应加载模型")):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "invalid_request")
        self.assertIn("无法解码", job.error["message"])

    def test_job_payload_does_not_expose_reference_binary(self) -> None:
        job, _created = self.submit_job_with({"items": [{"image_bytes": b"a"}]})
        payload = d.JOB_STORE.payload(job)
        self.assertNotIn("reference_images", payload)
        self.assertNotIn("referenceImages", payload)


# ── HTTP 提交期分派 ─────────────────────────────────────────────────────────


class GenerateWithReferenceImagesTest(DaemonUnitTest):
    """``POST /generate``：referenceImages 入队、互斥与白名单 400。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        d.STATE.phase = "ready"

    def generate(self, spec, images=None):  # noqa: ANN001, ANN202
        handler, sent = make_generate_handler(spec)
        with mock.patch.dict(sys.modules, fake_pil_sequence(list(images or [FakePILImage((512, 512))]))):
            d.DaemonHandler._handle_generate(handler)
        return sent

    def spec_with(self, loader="flux2", reference_images=None, tool=None):  # noqa: ANN001, ANN202
        spec = {"pipeline": make_pipeline(loader), "tasks": [{"prompt": "参考生图"}]}
        if reference_images is not None:
            spec["referenceImages"] = reference_images
        if tool is not None:
            spec["tool"] = tool
        return spec

    def test_valid_request_is_enqueued(self) -> None:
        sent = self.generate(self.spec_with(reference_images=make_reference_images(2)), images=[FakePILImage((800, 600)), FakePILImage((640, 480))])
        self.assertEqual(sent[0][0], 202, sent)
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertIsNotNone(job.reference_images)
        self.assertEqual(len(job.reference_images["items"]), 2)
        self.assertIsNone(job.reference, "两条参考路径不得同时出现")
        self.assertEqual(d.JOB_STORE.queue_depth(), 1)
        self.assertLogContains("带原生参考图 2 张")

    def test_mutually_exclusive_with_reference(self) -> None:
        spec = self.spec_with(reference_images=make_reference_images(), loader="sdxl")
        spec["reference"] = make_reference()
        sent = self.generate(spec)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertIn("不能同时使用", sent[0][1]["error"]["message"])

    def test_unsupported_loader_returns_400(self) -> None:
        for loader in ("sdxl", "sdxl-lora", "anima"):
            sent = self.generate(self.spec_with(loader=loader, reference_images=make_reference_images()))
            self.assertEqual(sent[0][0], 400, loader)
            self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
            self.assertIn("该模型不支持参考生图", sent[0][1]["error"]["message"])
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_reference_images_only_for_generate_tool(self) -> None:
        sent = self.generate(
            self.spec_with(reference_images=make_reference_images(), tool="upscale"),
            images=[FakePILImage((512, 512))],
        )
        self.assertEqual(sent[0][0], 400)
        self.assertIn("只对 tool=generate 生效", sent[0][1]["error"]["message"])

    def test_unknown_item_field_returns_400(self) -> None:
        item = {"image_b64": make_reference_b64(), "strength": 0.6}
        sent = self.generate(self.spec_with(reference_images=[item]))
        self.assertEqual(sent[0][0], 400)
        self.assertIn("只支持 image_b64", sent[0][1]["error"]["message"])

    def test_text2img_without_reference_images_is_unchanged(self) -> None:
        sent = self.generate(self.spec_with(loader="sdxl", reference_images=None))
        self.assertEqual(sent[0][0], 202)
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertIsNone(job.reference_images)
        self.assertNotIn("原生参考图", self.logs())


# ── 推理加速开关脚手架（pipeline.accel） ────────────────────────────────────


def fake_accel_torch():
    """apply_accel 只用到 torch.channels_last 作为 memory_format 标记。"""
    module = types.ModuleType("torch")
    module.channels_last = "channels_last"
    return module


class FakeAccelVAE:
    def __init__(self) -> None:
        self.tiling = 0
        self.slicing = 0

    def enable_tiling(self) -> None:
        self.tiling += 1

    def enable_slicing(self) -> None:
        self.slicing += 1


class FakeAccelUNet:
    """最小 UNet 替身：记录 channels_last 与 fuse 次数；已 fuse 时二次调用会报错（真实现也会）。"""

    def __init__(self) -> None:
        self.original_attn_processors = None
        self.memory_formats: list = []
        self.fuse_calls = 0

    def to(self, memory_format=None, **kwargs):  # noqa: ANN001, ANN201
        self.memory_formats.append(memory_format)
        return self

    def fuse_qkv_projections(self) -> None:
        if self.original_attn_processors is not None:
            raise RuntimeError("`fuse_qkv_projections()` 只能调用一次")
        self.original_attn_processors = {"attn": "fused"}
        self.fuse_calls += 1


class FakeAccelPipe:
    """带 __call__ 的假管线：pipe_signature_params 需要能内省签名。"""

    def __init__(self, *, with_unet: bool = True) -> None:
        self.vae = FakeAccelVAE()
        self.unet = FakeAccelUNet() if with_unet else None

    def __call__(self, prompt=None, image=None, width=None, height=None):  # noqa: ANN001, ANN202
        return types.SimpleNamespace(images=[])


class AccelScaffoldTest(DaemonUnitTest):
    """``pipeline.accel``：缺省零行为变化、全开生效、二次调用不重复 fuse。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def spec(self, accel=None, loader="sdxl"):  # noqa: ANN001, ANN202
        spec = make_pipeline(loader)
        if accel is not None:
            spec["accel"] = accel
        return spec

    def apply(self, pipe, spec):  # noqa: ANN001, ANN202
        with mock.patch.dict(sys.modules, {"torch": fake_accel_torch()}):
            return d.LOADERS.apply_accel(spec, pipe, log=d.log)

    def test_absent_accel_is_a_noop(self) -> None:
        pipe = FakeAccelPipe()
        self.assertIs(self.apply(pipe, self.spec()), pipe)
        self.assertEqual(pipe.vae.tiling, 0)
        self.assertEqual(pipe.vae.slicing, 0)
        self.assertEqual(pipe.unet.memory_formats, [])
        self.assertEqual(pipe.unet.fuse_calls, 0)
        self.assertNotIn("[accel]", self.logs())

    def test_empty_accel_and_all_false_are_noops(self) -> None:
        for accel in ({}, {"vaeTiling": False, "channelsLast": False}):
            pipe = FakeAccelPipe()
            self.apply(pipe, self.spec(accel))
            self.assertEqual(pipe.vae.tiling, 0)
            self.assertEqual(pipe.unet.memory_formats, [])
            self.assertEqual(pipe.unet.fuse_calls, 0)

    def test_all_flags_are_applied(self) -> None:
        pipe = FakeAccelPipe()
        accel = {"vaeTiling": True, "vaeSlicing": True, "channelsLast": True, "fuseQkv": True}
        self.assertIs(self.apply(pipe, self.spec(accel)), pipe)
        self.assertEqual(pipe.vae.tiling, 1)
        self.assertEqual(pipe.vae.slicing, 1)
        self.assertEqual(pipe.unet.memory_formats, ["channels_last"])
        self.assertEqual(pipe.unet.fuse_calls, 1)
        self.assertIn("应用推理加速开关：vaeTiling, vaeSlicing, channelsLast, fuseQkv", self.logs())

    def test_fuse_is_idempotent_across_calls(self) -> None:
        """from_pipe 派生管线共享同一 UNet：第二次应用必须跳过 fuse 而不是报错。"""
        pipe = FakeAccelPipe()
        accel = {"channelsLast": True, "fuseQkv": True}
        self.apply(pipe, self.spec(accel))
        self.apply(pipe, self.spec(accel))
        self.assertEqual(pipe.unet.fuse_calls, 1, "重复 fuse 会覆盖 original_attn_processors")
        self.assertEqual(pipe.unet.memory_formats, ["channels_last", "channels_last"])
        self.assertIn("已融合 Q/K/V 投影，跳过重复 fuse", self.logs())

    def test_pipe_without_unet_only_applies_vae_flags(self) -> None:
        pipe = FakeAccelPipe(with_unet=False)
        self.apply(pipe, self.spec({"vaeTiling": True, "channelsLast": True}))
        self.assertEqual(pipe.vae.tiling, 1)
        self.assertIn("没有 unet", self.logs())

    def test_ensure_img2img_pipeline_carries_accel_without_refusing(self) -> None:
        """from_pipe 派生管线：同一份 accel 重新应用，共享 UNet 已 fuse 时不得重复。"""
        base = FakeAccelPipe()
        # 模拟底座构建阶段已 fuse（base load 时应用过 accel）。
        base.unet.fuse_qkv_projections()
        d.STATE.pipe = base
        d.STATE.pipeline_spec = self.spec({"vaeTiling": True, "fuseQkv": True})
        derived = FakeAccelPipe()
        derived.vae = base.vae
        derived.unet = base.unet

        class FakeAutoPipelineForImage2Image:
            @staticmethod
            def from_pipe(pipe):  # noqa: ANN001, ANN205
                return derived

        module = types.ModuleType("diffusers")
        module.AutoPipelineForImage2Image = FakeAutoPipelineForImage2Image
        with mock.patch.dict(sys.modules, {"diffusers": module, "torch": fake_accel_torch()}):
            result = d.ensure_img2img_pipeline()
        self.assertIs(result, derived)
        self.assertEqual(base.unet.fuse_calls, 1, "派生管线不得重复 fuse")
        self.assertEqual(base.vae.tiling, 1, "派生管线要重新 set VAE tiling")

    def test_ensure_inpaint_pipeline_carries_accel(self) -> None:
        base = FakeAccelPipe()
        d.STATE.pipe = base
        d.STATE.pipeline_spec = self.spec({"vaeSlicing": True})
        derived = FakeAccelPipe()
        derived.vae = base.vae
        derived.unet = base.unet

        class FakeAutoPipelineForInpainting:
            @staticmethod
            def from_pipe(pipe):  # noqa: ANN001, ANN205
                return derived

        module = types.ModuleType("diffusers")
        module.AutoPipelineForInpainting = FakeAutoPipelineForInpainting
        with mock.patch.dict(sys.modules, {"diffusers": module, "torch": fake_accel_torch()}):
            result = d.ensure_inpaint_pipeline()
        self.assertIs(result, derived)
        self.assertEqual(base.vae.slicing, 1)

    def test_release_pipeline_clears_accel_spec(self) -> None:
        d.STATE.pipeline_spec = self.spec({"vaeTiling": True})
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            d.release_pipeline()
        self.assertIsNone(d.STATE.pipeline_spec)


class AccelSpecValidationTest(DaemonUnitTest):
    """build-assets 的模型资产校验口径（与 tools/build-assets.mjs 保持一致）。"""

    def test_pipeline_accel_keys_match_contract(self) -> None:
        from remote.inference.loaders.diffusers import ACCEL_FLAGS

        contract_doc = CONTRACT_DOC
        self.assertEqual(set(ACCEL_FLAGS), {"vaeTiling", "vaeSlicing", "channelsLast", "fuseQkv"})
        # 开关名不进入 daemonContract（只在模型资产的 pipeline 里下发），这里只锁远端镜像名。
        self.assertNotIn("accel", contract_doc.get("limits", {}))


if __name__ == "__main__":
    import unittest

    unittest.main()
