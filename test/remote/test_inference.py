"""推理执行。

run_task 的实际出图尺寸与 kwargs 过滤、img2img 惰性管线与结果字段、execute_job 的参考图路径。

拆分自 test/daemon-unit.py，运行：python test/remote/test_inference.py
"""

from __future__ import annotations

import base64
import sys
import types
from unittest import mock

from support import (
    CONTRACT,
    DaemonUnitTest,
    FakePILImage,
    TASKS,
    d,
    fake_torch_module,
    make_pipeline,
    make_reference,
)


class InpaintPipelineTest(DaemonUnitTest):
    """局部重绘管线：惰性 from_pipe 复用底座、只创建一次、随 release_pipeline 清空。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_fake_diffusers(self, fail=None):  # noqa: ANN001, ANN201
        calls = []

        class FakeInpaintPipe:
            def __call__(
                self,
                prompt=None,  # noqa: ANN001
                negative_prompt=None,  # noqa: ANN001
                image=None,  # noqa: ANN001
                mask_image=None,  # noqa: ANN001
                strength=None,  # noqa: ANN001
                num_inference_steps=None,  # noqa: ANN001
                guidance_scale=None,  # noqa: ANN001
                generator=None,  # noqa: ANN001
            ):
                return types.SimpleNamespace(images=[])

        class FakeAutoPipelineForInpainting:
            @staticmethod
            def from_pipe(pipe):  # noqa: ANN001, ANN205
                calls.append(pipe)
                if fail is not None:
                    raise fail
                return FakeInpaintPipe()

        module = types.ModuleType("diffusers")
        module.AutoPipelineForInpainting = FakeAutoPipelineForInpainting
        return module, calls

    def test_lazy_creation_is_cached(self) -> None:
        module, calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            first = d.ensure_inpaint_pipeline()
            second = d.ensure_inpaint_pipeline()
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1, "from_pipe 只应在首次创建时调用一次")
        self.assertIs(d.STATE.inpaint_pipe, first)
        self.assertIn("mask_image", d.STATE.inpaint_sig_params)
        self.assertIn("strength", d.STATE.inpaint_sig_params)
        self.assertIn("首次局部重绘", self.logs())
        self.assertIn("局部重绘管线就绪", self.logs())

    def test_requires_loaded_base_pipeline(self) -> None:
        with self.assertRaises(d.RequestError):
            d.ensure_inpaint_pipeline()

    def test_from_pipe_failure_is_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("组件不兼容"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(d.LoadError) as ctx:
                d.ensure_inpaint_pipeline()
        self.assertIn("局部重绘管线创建失败", str(ctx.exception))
        self.assertIsNone(d.STATE.inpaint_pipe)

    def test_oom_is_not_wrapped_as_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("CUDA out of memory"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(RuntimeError) as ctx:
                d.ensure_inpaint_pipeline()
        self.assertNotIsInstance(ctx.exception, d.LoadError)

    def test_release_pipeline_clears_inpaint_cache(self) -> None:
        module, _calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        d.STATE.pipeline_key = "pipeline-key"
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            d.ensure_inpaint_pipeline()
        self.assertIsNotNone(d.STATE.inpaint_pipe)
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            d.release_pipeline()
        self.assertIsNone(d.STATE.inpaint_pipe)
        self.assertEqual(d.STATE.inpaint_sig_params, set())
        self.assertIsNone(d.STATE.pipe)
        # 换底座后重新按需创建：缓存确实失效，会再次 from_pipe。
        module2, calls2 = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module2}):
            d.ensure_inpaint_pipeline()
        self.assertEqual(len(calls2), 1)


class RunTaskTest(DaemonUnitTest):
    """run_task：回传实际出图尺寸（PIL image.size），协议字段名保持不变。"""

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

    def make_pipe(self, image_size):  # noqa: ANN001, ANN202
        """假 pipe：记录本次调用参数，返回给定 PIL 尺寸的假图。"""

        class FakeImage:
            def __init__(self, size):
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-png")

        class FakePipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakePipe()

    @staticmethod
    def fake_torch():
        """run_task 只用到 torch.Generator 与 torch.cuda，注入替身避免依赖真 torch。"""
        torch_module = types.ModuleType("torch")
        torch_module.cuda = types.SimpleNamespace(
            is_available=lambda: False, synchronize=lambda: None
        )
        torch_module.Generator = lambda device: types.SimpleNamespace(manual_seed=lambda seed: device)
        return torch_module

    def run_with(self, image_size, task):  # noqa: ANN001, ANN202
        pipe = self.make_pipe(image_size)
        with mock.patch.dict(sys.modules, {"torch": self.fake_torch()}):
            result = d.run_task(pipe, task)
        return pipe, result

    def test_reports_actual_image_size(self) -> None:
        # anima 会把 648 向下取整到 640：回传必须是 PIL 的实际尺寸，而不是请求值。
        pipe, result = self.run_with((640, 640), dict(TASKS[0], width=648, height=648))
        self.assertEqual(pipe.calls[0]["width"], 648)
        self.assertEqual(pipe.calls[0]["height"], 648)
        self.assertEqual((result["width"], result["height"]), (640, 640))
        self.assertIn("实际出图 640x640（请求 648x648）", self.logs())

    def test_size_tuple_is_width_height_order(self) -> None:
        # PIL Image.size 的顺序是 (width, height)，不能写反。
        _pipe, result = self.run_with((768, 512), dict(TASKS[0], width=768, height=512))
        self.assertEqual((result["width"], result["height"]), (768, 512))
        self.assertNotIn("实际出图", self.logs())

    def test_protocol_fields_unchanged(self) -> None:
        _pipe, result = self.run_with((256, 256), TASKS[0])
        self.assertEqual(set(result), self.RESULT_KEYS)
        self.assertEqual(result["name"], TASKS[0]["name"])
        self.assertEqual(result["png_bytes"], len(b"fake-png"))
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-png")


class Img2ImgPipelineTest(DaemonUnitTest):
    """图生图管线：惰性 from_pipe 复用、只创建一次、随 release_pipeline 清空。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_fake_diffusers(self, fail=None):  # noqa: ANN001, ANN201
        calls = []

        class FakeImg2ImgPipe:
            def __call__(
                self,
                prompt=None,  # noqa: ANN001
                negative_prompt=None,  # noqa: ANN001
                image=None,  # noqa: ANN001
                strength=None,  # noqa: ANN001
                num_inference_steps=None,  # noqa: ANN001
                guidance_scale=None,  # noqa: ANN001
                generator=None,  # noqa: ANN001
            ):
                return types.SimpleNamespace(images=[])

        class FakeAutoPipelineForImage2Image:
            @staticmethod
            def from_pipe(pipe):  # noqa: ANN001, ANN205
                calls.append(pipe)
                if fail is not None:
                    raise fail
                return FakeImg2ImgPipe()

        module = types.ModuleType("diffusers")
        module.AutoPipelineForImage2Image = FakeAutoPipelineForImage2Image
        return module, calls

    def test_lazy_creation_is_cached(self) -> None:
        module, calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            first = d.ensure_img2img_pipeline()
            second = d.ensure_img2img_pipeline()
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1, "from_pipe 只应在首次创建时调用一次")
        self.assertIs(d.STATE.img2img_pipe, first)
        self.assertIn("image", d.STATE.img2img_sig_params)
        self.assertIn("strength", d.STATE.img2img_sig_params)
        self.assertIn("首次图生图", self.logs())
        self.assertIn("图生图管线就绪", self.logs())

    def test_requires_loaded_base_pipeline(self) -> None:
        with self.assertRaises(d.RequestError):
            d.ensure_img2img_pipeline()

    def test_from_pipe_failure_is_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("组件不兼容"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(d.LoadError) as ctx:
                d.ensure_img2img_pipeline()
        self.assertIn("图生图管线创建失败", str(ctx.exception))
        self.assertIsNone(d.STATE.img2img_pipe)

    def test_oom_is_not_wrapped_as_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("CUDA out of memory"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(RuntimeError) as ctx:
                d.ensure_img2img_pipeline()
        self.assertNotIsInstance(ctx.exception, d.LoadError)

    def test_release_pipeline_clears_img2img_cache(self) -> None:
        module, _calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        d.STATE.pipeline_key = "pipeline-key"
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            d.ensure_img2img_pipeline()
        self.assertIsNotNone(d.STATE.img2img_pipe)
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            d.release_pipeline()
        self.assertIsNone(d.STATE.img2img_pipe)
        self.assertEqual(d.STATE.img2img_sig_params, set())
        self.assertIsNone(d.STATE.pipe)
        # 换底座后重新按需创建：缓存确实失效，会再次 from_pipe。
        module2, calls2 = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module2}):
            d.ensure_img2img_pipeline()
        self.assertEqual(len(calls2), 1)


class RunTaskImg2ImgTest(DaemonUnitTest):
    """run_task 的图生图分支：kwargs / 日志 / 结果字段正确，txt2img 分支不回归。"""

    IMG2IMG_SIG = {
        "prompt",
        "negative_prompt",
        "image",
        "strength",
        "num_inference_steps",
        "guidance_scale",
        "generator",
    }

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_img2img_pipe(self, image_size=(1536, 768)):  # noqa: ANN001, ANN202
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-img2img-png")

        class FakeImg2ImgPipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakeImg2ImgPipe()

    def make_reference(self, size=(1536, 768), source=(2048, 1024)):  # noqa: ANN001, ANN202
        image = FakePILImage(size)
        image._imagen_source_size = source
        return image

    def run_img2img(  # noqa: ANN001, ANN202
        self,
        task=None,
        strength=0.55,
        sig=None,
        image_size=(1536, 768),
    ):
        task = dict(TASKS[0] if task is None else task)
        pipe = self.make_img2img_pipe(image_size)
        d.STATE.pipe = object()
        d.STATE.img2img_pipe = pipe
        d.STATE.img2img_sig_params = set(self.IMG2IMG_SIG if sig is None else sig)
        reference = self.make_reference()
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(
                object(), task, reference_image=reference, reference_strength=strength
            )
        return pipe, result, reference

    def test_call_kwargs_use_img2img_contract(self) -> None:
        pipe, _result, reference = self.run_img2img(strength=0.55)
        self.assertEqual(len(pipe.calls), 1)
        kwargs = pipe.calls[0]
        self.assertEqual(kwargs["prompt"], TASKS[0]["prompt"])
        self.assertIs(kwargs["image"], reference)
        self.assertEqual(kwargs["strength"], 0.55)
        self.assertEqual(kwargs["num_inference_steps"], TASKS[0]["steps"])
        self.assertEqual(kwargs["guidance_scale"], TASKS[0]["cfg"])
        # img2img 不传 width / height：输出尺寸跟随参考图。
        self.assertNotIn("width", kwargs)
        self.assertNotIn("height", kwargs)
        # cfg=0 时 negative_prompt 无意义，不传。
        self.assertNotIn("negative_prompt", kwargs)
        self.assertEqual(kwargs["generator"].seed, TASKS[0]["seed"])

    def test_negative_prompt_is_kept_when_cfg_positive(self) -> None:
        task = dict(TASKS[0], cfg=5.0, negative_prompt="blurry")
        pipe, _result, _reference = self.run_img2img(task=task)
        self.assertEqual(pipe.calls[0]["negative_prompt"], "blurry")

    def test_signature_filtering_drops_unknown_kwargs(self) -> None:
        pipe, _result, _reference = self.run_img2img(sig={"prompt", "image", "generator"})
        self.assertEqual(set(pipe.calls[0]), {"prompt", "image", "generator"})

    def test_default_strength_comes_from_contract(self) -> None:
        _pipe, result, _reference = self.run_img2img(strength=None)
        self.assertEqual(result["strength"], CONTRACT["limits"]["strength"]["default"])

    def test_logs_strength_and_resize(self) -> None:
        self.run_img2img(strength=0.55)
        self.assertIn("[gen] img2img 01 strength=0.55", self.logs())
        self.assertIn("参考图 2048x1024 → 1536x768", self.logs())

    def test_result_fields(self) -> None:
        _pipe, result, _reference = self.run_img2img(strength=0.55)
        self.assertEqual(
            set(result), RunTaskTest.RESULT_KEYS | {"strength", "referenceWidth", "referenceHeight"}
        )
        self.assertEqual(result["strength"], 0.55)
        self.assertEqual((result["referenceWidth"], result["referenceHeight"]), (1536, 768))
        self.assertEqual((result["width"], result["height"]), (1536, 768))
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-img2img-png")

    def test_reports_actual_size_when_it_differs_from_reference(self) -> None:
        self.run_img2img(image_size=(1536, 760))
        self.assertIn("实际出图 1536x760（参考图 1536x768）", self.logs())

    def test_txt2img_path_is_unaffected(self) -> None:
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-txt2img-png")

        class FakeTxt2ImgPipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage((256, 256))])

        pipe = FakeTxt2ImgPipe()
        d.STATE.sig_params = {
            "prompt",
            "negative_prompt",
            "num_inference_steps",
            "guidance_scale",
            "width",
            "height",
            "generator",
        }
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(pipe, dict(TASKS[0]))
        self.assertEqual(set(result), RunTaskTest.RESULT_KEYS)
        # negative_prompt 在 cfg=0 / 空提示时按既有逻辑不传，其余签名内的参数都应下传。
        expected_kwargs = set(d.STATE.sig_params) - {"negative_prompt"}
        self.assertEqual(set(pipe.calls[0]), expected_kwargs)
        self.assertEqual((pipe.calls[0]["width"], pipe.calls[0]["height"]), (256, 256))
        self.assertIn("[gen] 01 seed=42 256x256 steps=4 cfg=0.0", self.logs())


class RunTaskInpaintTest(DaemonUnitTest):
    """run_task 的局部重绘分支：kwargs / 日志 / 结果字段正确，img2img 分支不回归。"""

    INPAINT_SIG = {
        "prompt",
        "negative_prompt",
        "image",
        "mask_image",
        "strength",
        "width",
        "height",
        "num_inference_steps",
        "guidance_scale",
        "generator",
    }

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_inpaint_pipe(self, image_size=(1536, 768)):  # noqa: ANN001, ANN202
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-inpaint-png")

        class FakeInpaintPipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakeInpaintPipe()

    def make_reference(self, size=(1536, 768), source=(2048, 1024)):  # noqa: ANN001, ANN202
        image = FakePILImage(size)
        image._imagen_source_size = source
        return image

    def make_mask(self, size=(64, 32), aligned=(1536, 768)):  # noqa: ANN001, ANN202
        """假蒙版：``size`` 是客户端原始尺寸，``aligned`` 是执行期对齐参考图后的尺寸。"""
        image = FakePILImage(aligned, mode="L")
        image._imagen_source_size = size
        return image

    def run_inpaint(  # noqa: ANN001, ANN202
        self,
        task=None,
        strength=0.75,
        sig=None,
        image_size=(1536, 768),
        reference_size=None,
    ):
        task = dict(TASKS[0] if task is None else task)
        pipe = self.make_inpaint_pipe(image_size)
        d.STATE.pipe = object()
        d.STATE.inpaint_pipe = pipe
        d.STATE.inpaint_sig_params = set(self.INPAINT_SIG if sig is None else sig)
        reference = self.make_reference(reference_size or (1536, 768))
        mask = self.make_mask(aligned=tuple(reference.size))
        # 真实运行时会把生成图按羽化蒙版与原图合成；这里记录调用，断言「确实做了合成」。
        self.composite_calls = []

        def fake_composite(generated, original, mask_image):  # noqa: ANN001, ANN202
            self.composite_calls.append((generated, original, mask_image))
            return generated

        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}), mock.patch.object(
            d, "composite_inpaint_image", side_effect=fake_composite
        ):
            result = d.run_task(
                object(),
                task,
                reference_image=reference,
                reference_strength=strength,
                mask_image=mask,
            )
        return pipe, result, reference, mask

    def test_call_kwargs_use_inpaint_contract(self) -> None:
        pipe, _result, reference, mask = self.run_inpaint(strength=0.75)
        self.assertEqual(len(pipe.calls), 1)
        kwargs = pipe.calls[0]
        self.assertEqual(kwargs["prompt"], TASKS[0]["prompt"])
        self.assertIs(kwargs["image"], reference)
        self.assertIs(kwargs["mask_image"], mask)
        self.assertEqual(kwargs["strength"], 0.75)
        self.assertEqual(kwargs["num_inference_steps"], TASKS[0]["steps"])
        self.assertEqual(kwargs["guidance_scale"], TASKS[0]["cfg"])
        # inpaint 显式传参考图实际送入模型的宽高（按 8 对齐）：专用 9 通道模型在非正方形
        # 参考图下不再按缺省 1024² 推理再被 composite 拉回。
        self.assertEqual((kwargs["width"], kwargs["height"]), (1536, 768))
        # cfg=0 时 negative_prompt 无意义，不传。
        self.assertNotIn("negative_prompt", kwargs)
        self.assertEqual(kwargs["generator"].seed, TASKS[0]["seed"])

    def test_non_square_reference_size_is_aligned_for_inpaint_kwargs(self) -> None:
        # 1500×700 不是 8 的倍数：显式宽高按 8 向下对齐（1500→1496、700→696）。
        pipe, _result, _reference, _mask = self.run_inpaint(
            image_size=(1500, 700), reference_size=(1500, 700)
        )
        self.assertEqual(pipe.calls[0]["width"], 1496)
        self.assertEqual(pipe.calls[0]["height"], 696)

    def test_inpaint_strength_uses_inpaint_max_with_mask(self) -> None:
        # 带蒙版时提交期已按 inpaintMax 放行 1.0；执行期重归一不能把它钳回 img2img 的 0.9。
        _pipe, result, _reference, _mask = self.run_inpaint(strength=1.0)
        self.assertEqual(result["strength"], 1.0)
        self.assertIn("[gen] inpaint 01 strength=1.0", self.logs())

    def test_negative_prompt_is_kept_when_cfg_positive(self) -> None:
        task = dict(TASKS[0], cfg=5.0, negative_prompt="blurry")
        pipe, _result, _reference, _mask = self.run_inpaint(task=task)
        self.assertEqual(pipe.calls[0]["negative_prompt"], "blurry")

    def test_signature_filtering_drops_unknown_kwargs(self) -> None:
        pipe, _result, _reference, _mask = self.run_inpaint(
            sig={"prompt", "image", "mask_image", "generator"}
        )
        self.assertEqual(set(pipe.calls[0]), {"prompt", "image", "mask_image", "generator"})

    def test_default_strength_comes_from_contract(self) -> None:
        _pipe, result, _reference, _mask = self.run_inpaint(strength=None)
        self.assertEqual(result["strength"], CONTRACT["limits"]["strength"]["default"])

    def test_logs_inpaint_strength_and_mask_alignment(self) -> None:
        self.run_inpaint(strength=0.75)
        self.assertIn("[gen] inpaint 01 strength=0.75", self.logs())
        self.assertIn("inpaint 参考图 2048x1024 → 1536x768", self.logs())
        self.assertIn("inpaint 蒙版 64x32 → 1536x768（最近邻对齐参考图）", self.logs())

    def test_result_fields(self) -> None:
        _pipe, result, _reference, _mask = self.run_inpaint(strength=0.75)
        self.assertEqual(
            set(result),
            RunTaskTest.RESULT_KEYS
            | {
                "strength",
                "referenceWidth",
                "referenceHeight",
                "inpaint",
                "maskWidth",
                "maskHeight",
            },
        )
        self.assertIs(result["inpaint"], True)
        # 结果里的 maskWidth/maskHeight 是客户端导出的蒙版原始尺寸（执行期已对齐参考图）。
        self.assertEqual((result["maskWidth"], result["maskHeight"]), (64, 32))
        self.assertEqual((result["referenceWidth"], result["referenceHeight"]), (1536, 768))
        self.assertEqual((result["width"], result["height"]), (1536, 768))
        self.assertEqual(result["strength"], 0.75)
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-inpaint-png")

    def test_composes_generated_image_with_mask_after_generation(self) -> None:
        # 生成后必须用「生成图 + 原图 + 羽化蒙版」做一次像素级合成（保留区不变）。
        _pipe, _result, reference, mask = self.run_inpaint()
        self.assertEqual(len(self.composite_calls), 1, "每张图都要合成一次")
        generated, original, mask_image = self.composite_calls[0]
        self.assertIs(original, reference, "合成必须用参考图作为保留区来源")
        self.assertIs(mask_image, mask, "合成必须用羽化后的蒙版")
        self.assertEqual(getattr(generated, "size", None), (1536, 768))

    def test_composite_failure_falls_back_to_generated_image(self) -> None:
        # 合成失败不能把任务判死：退回生成结果并留日志。
        pipe = self.make_inpaint_pipe()
        d.STATE.pipe = object()
        d.STATE.inpaint_pipe = pipe
        d.STATE.inpaint_sig_params = set(self.INPAINT_SIG)
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}), mock.patch.object(
            d, "composite_inpaint_image", side_effect=RuntimeError("合成炸了")
        ):
            result = d.run_task(
                object(),
                dict(TASKS[0]),
                reference_image=self.make_reference(),
                reference_strength=0.75,
                mask_image=self.make_mask(),
            )
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-inpaint-png")
        self.assertIn("合成失败", self.logs())

    def test_reports_actual_size_when_it_differs_from_reference(self) -> None:
        self.run_inpaint(image_size=(1536, 760))
        self.assertIn("实际出图 1536x760（参考图 1536x768）", self.logs())

    def test_reference_without_mask_uses_img2img_kwargs(self) -> None:
        # 同一入口传 reference_image 而不传 mask_image 时，必须仍是 img2img 分支。
        pipe = self.make_inpaint_pipe()
        img2img_pipe = self.make_inpaint_pipe()
        d.STATE.img2img_pipe = img2img_pipe
        d.STATE.img2img_sig_params = {"prompt", "image", "strength", "generator"}
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            d.run_task(
                object(), dict(TASKS[0]), reference_image=self.make_reference(), reference_strength=0.5
            )
        self.assertEqual(pipe.calls, [], "没有蒙版时不得创建/调用 inpaint 管线")
        self.assertEqual(img2img_pipe.calls[0]["strength"], 0.5)
        self.assertIn("[gen] img2img 01", self.logs())

    def test_mask_without_reference_image_is_rejected(self) -> None:
        # 防御性约束：调用方漏传参考图时给出明确 400，而不是静默退回文生图。
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            with self.assertRaises(d.RequestError) as ctx:
                d.run_task(object(), dict(TASKS[0]), mask_image=self.make_mask())
        self.assertIn("局部重绘必须同时提供参考图", str(ctx.exception))


class ExecuteJobReferenceTest(DaemonUnitTest):
    """execute_job：参考图整批只解码一次，并透传给 run_tasks；失败不白加载模型。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def submit_job_with(self, reference=None, task_count=1):  # noqa: ANN001, ANN202
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        return d.JOB_STORE.submit(
            make_pipeline(), "org/base-model", tasks, None, reference=reference
        )

    def test_decodes_reference_once_and_passes_to_run_tasks(self) -> None:
        reference = {"image_bytes": b"data", "strength": 0.55, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference, task_count=2)
        decoded = FakePILImage((1536, 768))
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured.update(
                reference_image=reference_image,
                reference_strength=reference_strength,
                mask_image=mask_image,
                task_count=len(tasks),
            )
            return []

        with mock.patch.object(d, "decode_reference_image", return_value=decoded) as decode, mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(d, "run_tasks", side_effect=fake_run_tasks):
            d.execute_job(job)
        self.assertEqual(decode.call_count, 1, "一张参考图跑整批，只应解码一次")
        self.assertIs(captured["reference_image"], decoded)
        self.assertIsNone(captured["mask_image"], "没有蒙版时不得传 mask_image")
        self.assertEqual(captured["reference_strength"], 0.55)
        self.assertEqual(captured["task_count"], 2)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertIsNone(job.reference, "解码后应释放队列里保留的原始字节")

    def test_unmasked_strength_still_clamped_to_img2img_max(self) -> None:
        # 纯图生图（无蒙版）：执行期重归一仍按契约 max，不带蒙版不会被放宽到 inpaintMax。
        reference = {"image_bytes": b"data", "strength": 1.0, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference)
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured["reference_strength"] = reference_strength
            return []

        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((1536, 768))
        ), mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(captured["reference_strength"], CONTRACT["limits"]["strength"]["max"])

    def test_text2img_still_calls_run_tasks_without_reference_kwargs(self) -> None:
        job, _created = self.submit_job_with(None)
        captured: dict = {}

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            captured["pipe"] = pipe
            return []

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 0.0)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(captured["pipe"], "pipe")
        self.assertEqual(job.status, d.JOB_STATUS_DONE)

    def test_decode_failure_fails_job_without_loading_model(self) -> None:
        job, _created = self.submit_job_with(
            {"image_bytes": b"bad", "strength": 0.6, "width": 1, "height": 1}
        )
        with mock.patch.object(
            d, "decode_reference_image", side_effect=d.RequestError("参考图无法解码")
        ), mock.patch.object(d, "ensure_pipeline", side_effect=AssertionError("不应加载模型")):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "invalid_request")
        self.assertIn("参考图无法解码", job.error["message"])

    def test_submit_job_keeps_reference_copy(self) -> None:
        reference = {"image_bytes": b"data", "strength": 0.6, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference)
        self.assertIsNotNone(job.reference)
        self.assertEqual(job.reference["strength"], 0.6)
        self.assertIsNot(job.reference, reference)


class ExecuteJobMaskTest(DaemonUnitTest):
    """execute_job 的局部重绘路径：参考图与蒙版各解码一次，蒙版对齐参考图宽高。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def submit_job_with(self, reference=None, task_count=1):  # noqa: ANN001, ANN202
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        return d.JOB_STORE.submit(
            make_pipeline(), "org/base-model", tasks, None, reference=reference
        )

    def test_decodes_mask_after_reference_and_passes_to_run_tasks(self) -> None:
        reference = {
            "image_bytes": b"data",
            "strength": 0.7,
            "width": 10,
            "height": 10,
            "mask_bytes": b"mask",
            "mask_width": 5,
            "mask_height": 5,
        }
        job, _created = self.submit_job_with(reference, task_count=2)
        decoded_reference = FakePILImage((1536, 768))
        decoded_mask = FakePILImage((1536, 768), mode="L")
        captured: dict = {}

        def fake_decode_mask(mask, size):  # noqa: ANN001, ANN202
            captured["mask"] = mask
            captured["mask_size"] = size
            return decoded_mask

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured.update(
                reference_image=reference_image,
                reference_strength=reference_strength,
                mask_image=mask_image,
                task_count=len(tasks),
            )
            return []

        with mock.patch.object(
            d, "decode_reference_image", return_value=decoded_reference
        ) as decode_reference, mock.patch.object(
            d, "decode_mask_image", side_effect=fake_decode_mask
        ) as decode_mask, mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(decode_reference.call_count, 1, "参考图整批只解码一次")
        self.assertEqual(decode_mask.call_count, 1, "蒙版整批只解码一次")
        self.assertEqual(
            captured["mask_size"], (1536, 768), "蒙版必须对齐到参考图解码后的实际宽高"
        )
        self.assertIs(captured["mask_image"], decoded_mask)
        self.assertIs(captured["reference_image"], decoded_reference)
        self.assertEqual(captured["reference_strength"], 0.7)
        self.assertEqual(captured["task_count"], 2)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertIsNone(job.reference, "解码后应释放队列里保留的原始字节")

    def test_decoded_mask_is_feathered_before_run_tasks(self) -> None:
        # 解码后的二值蒙版要先外扩 + 羽化，再传给 run_tasks；原始蒙版随之释放。
        # 覆盖率由 decode_mask_image 统计（挂在 `_imagen_coverage` 上），execute_job 直接
        # 传给羽化（不重复扫像素）并写进日志。
        reference = {
            "image_bytes": b"data",
            "strength": 0.7,
            "width": 10,
            "height": 10,
            "mask_bytes": b"mask",
            "mask_width": 5,
            "mask_height": 5,
        }
        job, _created = self.submit_job_with(reference)
        decoded_mask = FakePILImage((1536, 768), mode="L")
        decoded_mask._imagen_coverage = 0.0123
        feathered_mask = FakePILImage((1536, 768), mode="L")
        feathered_mask._imagen_feather_radius = 4
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured["mask_image"] = mask_image
            return []

        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((1536, 768))
        ), mock.patch.object(
            d, "decode_mask_image", return_value=decoded_mask
        ), mock.patch.object(
            d, "feather_mask_image", return_value=feathered_mask
        ) as feather, mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(feather.call_count, 1, "解码后的蒙版必须羽化一次")
        self.assertIs(feather.call_args.args[0], decoded_mask)
        self.assertEqual(
            feather.call_args.kwargs.get("coverage"),
            0.0123,
            "羽化应复用 decode_mask_image 算好的覆盖率，不重复扫像素",
        )
        self.assertIs(captured["mask_image"], feathered_mask, "run_tasks 应收到羽化后的蒙版")
        self.assertTrue(decoded_mask.closed, "羽化后应释放解码出的原始蒙版")
        self.assertTrue(feathered_mask.closed, "任务收尾应关闭羽化后的蒙版")
        self.assertIn("蒙版覆盖率 1.23% 羽化半径 4px", self.logs())
        self.assertEqual(job.status, d.JOB_STATUS_DONE)

    def test_masked_strength_keeps_inpaint_max(self) -> None:
        # 带蒙版时执行期重归一的强度上限是 inpaintMax：1.0 不能被钳回 0.9。
        reference = {
            "image_bytes": b"data",
            "strength": 1.0,
            "width": 10,
            "height": 10,
            "mask_bytes": b"mask",
            "mask_width": 5,
            "mask_height": 5,
        }
        job, _created = self.submit_job_with(reference)
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured["reference_strength"] = reference_strength
            return []

        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((1536, 768))
        ), mock.patch.object(
            d, "decode_mask_image", return_value=FakePILImage((1536, 768), mode="L")
        ), mock.patch.object(
            d, "feather_mask_image", side_effect=lambda mask, **_kwargs: mask
        ), mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(captured["reference_strength"], 1.0)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)

    def test_reference_without_mask_skips_mask_decode(self) -> None:
        reference = {"image_bytes": b"data", "strength": 0.6, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference)
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe,
            tasks,
            on_progress=None,
            reference_image=None,
            reference_strength=None,
            mask_image=None,
        ):
            captured["mask_image"] = mask_image
            return []

        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((1536, 768))
        ), mock.patch.object(
            d, "decode_mask_image", side_effect=AssertionError("没有蒙版不应解码")
        ), mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertIsNone(captured["mask_image"])
        self.assertEqual(job.status, d.JOB_STATUS_DONE)

    def test_mask_decode_failure_fails_job_without_loading_model(self) -> None:
        reference = {
            "image_bytes": b"data",
            "strength": 0.6,
            "width": 10,
            "height": 10,
            "mask_bytes": b"bad-mask",
            "mask_width": 5,
            "mask_height": 5,
        }
        job, _created = self.submit_job_with(reference)
        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((1536, 768))
        ), mock.patch.object(
            d, "decode_mask_image", side_effect=d.RequestError("蒙版无法解码")
        ), mock.patch.object(
            d, "ensure_pipeline", side_effect=AssertionError("不应加载模型")
        ):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "invalid_request")
        self.assertIn("蒙版无法解码", job.error["message"])

class NativeInpaintPipelineTest(DaemonUnitTest):
    """nativeInpaint 底座：直接复用专用管线，且拒绝文生图 / 纯图生图。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def test_ensure_inpaint_returns_native_base_pipe_directly(self) -> None:
        base = object()
        with mock.patch.object(d.STATE, "pipe", base), mock.patch.object(
            d.STATE, "native_inpaint", True
        ), mock.patch.object(d.STATE, "inpaint_pipe", None):
            self.assertIs(d.ensure_inpaint_pipeline(), base, "专用底座不需要 from_pipe 派生")

    def test_native_requires_mask_on_run_task(self) -> None:
        pipe = object()
        with mock.patch.object(d.STATE, "native_inpaint", True), mock.patch.object(
            d.STATE, "pipe", pipe
        ), mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            with self.assertRaises(d.RequestError) as ctx:
                d.run_task(pipe, dict(TASKS[0]))
        self.assertIn("只支持局部重绘", str(ctx.exception))

    def test_native_inpaint_runs_with_mask_through_base_pipe(self) -> None:
        calls: list[dict] = []

        class FakeImage:
            size = (1536, 768)

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-native-inpaint-png")

        class FakeInpaintPipe:
            def __call__(self, **kwargs):
                calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage()])

        pipe = FakeInpaintPipe()
        reference = FakePILImage((1536, 768))
        reference._imagen_source_size = (1536, 768)
        mask = FakePILImage((1536, 768), mode="L")
        mask._imagen_source_size = (512, 512)
        with mock.patch.object(d.STATE, "native_inpaint", True), mock.patch.object(
            d.STATE, "pipe", pipe
        ), mock.patch.object(d.STATE, "inpaint_pipe", None), mock.patch.object(
            d.STATE, "inpaint_sig_params", set()
        ), mock.patch.object(
            d.STATE, "sig_params", {"prompt", "image", "mask_image", "strength", "num_inference_steps", "guidance_scale", "generator"}
        ), mock.patch.object(
            d, "composite_inpaint_image", side_effect=lambda generated, *_args: generated
        ), mock.patch.dict(
            sys.modules, {"torch": fake_torch_module()}
        ):
            result = d.run_task(
                pipe,
                dict(TASKS[0]),
                reference_image=reference,
                reference_strength=0.8,
                mask_image=mask,
            )
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0]["image"], reference)
        self.assertIs(calls[0]["mask_image"], mask)
        self.assertNotIn("width", calls[0])
        self.assertIs(result["inpaint"], True)
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-native-inpaint-png")

if __name__ == "__main__":
    import unittest

    unittest.main()
