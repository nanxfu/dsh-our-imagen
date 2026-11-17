"""高清放大（``tool=upscale``）：协议归一、源图校验、权重下载、checkpoint 解包、执行分支。

覆盖 INTERFACES §2.5 的六类：tool 归一、upscale 参考图校验、权重下载（分块/SHA/重试/大小
上限）、checkpoint 三种形状解包、``execute_job`` 的 upscale 分支（假 PIL / torch，不加载模型）、
幂等键；另外用假 torch 验证 RRDBNet 架构与前向顺序（12 通道 conv_first / 23×RRDB / 两次
nearest 上采样），真实权重的数值自检走本机离线脚本，不进仓库测试（保持 CI 零重依赖）。

运行：python test/remote/test_upscale.py
"""

from __future__ import annotations

import base64
import hashlib
import os
import sys
import tempfile
import types
from unittest import mock

from support import (  # noqa: E402
    CONTRACT,
    CONTRACT_DOC,
    DaemonUnitTest,
    FakePILImage,
    FakeResponse,
    d,
    fake_pil_for,
    make_generate_handler,
    make_reference,
    make_reference_b64,
    ROOT,
    make_spec,
    make_urlopen,
)

import remote.inference.upscale as remote_upscale  # noqa: E402  # support 导入后 sys.path 已就绪

UPSCALE_LIMITS = CONTRACT["limits"]["upscale"]
UPSCALE_PIPELINE = {"loader": "upscale", "base": "realesrgan-x2plus"}
UPSCALE_MODEL_ID = "realesrgan-x2plus"


class UpscaleImportSurfaceTest(DaemonUnitTest):
    """模块顶层只依赖标准库：torch / PIL / numpy 必须留到函数内延迟导入。

    守护方式用**独立子进程**而不是进程内 `sys.modules`：同一进程里 daemon / 其他用例可能
    已经导入过 PIL，进程内断言会是假绿；新解释器才能证明「只 import 本模块不会拉起重依赖」。
    """

    def test_import_does_not_pull_torch_or_pillow(self) -> None:
        import subprocess

        code = (
            "import sys\n"
            f"sys.path.insert(0, {str(ROOT / 'remote')!r})\n"
            f"sys.path.insert(0, {str(ROOT)!r})\n"
            "import remote.inference.upscale as module\n"
            "print('torch' in sys.modules, 'PIL' in sys.modules, 'numpy' in sys.modules,"
            " hasattr(module, 'build_rrdbnet'), hasattr(module, 'ensure_weight_file'))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ROOT)
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "False False False True True")


class UpscaleToolSpecTest(DaemonUnitTest):
    """tool 归一：缺省 generate、非法值 400、upscale 不要求 pipeline。"""

    def test_tool_defaults_to_generate(self) -> None:
        pipeline, model_id, tasks, tool = d.validate_generate_spec(make_spec())
        self.assertEqual(tool, "generate")
        self.assertEqual(pipeline["loader"], "sdxl")
        self.assertEqual(model_id, "org/base-model")
        self.assertEqual(len(tasks), 1)

    def test_explicit_generate_is_accepted(self) -> None:
        _pipeline, _model_id, tasks, tool = d.validate_generate_spec(
            dict(make_spec(), tool="generate")
        )
        self.assertEqual(tool, "generate")
        self.assertEqual(tasks[0]["prompt"], "雾中荷塘，工笔")

    def test_blank_tool_falls_back_to_generate(self) -> None:
        # 缺省与空串都按 generate：旧客户端可能整个字段传空，没必要因此 400。
        self.assertEqual(d.validate_generate_spec(dict(make_spec(), tool="  "))[3], "generate")

    def test_invalid_tool_is_rejected(self) -> None:
        for bad in ("outpaint", "img2img", "inpaint", 123, ["generate"]):
            with self.assertRaises(d.RequestError, msg=f"tool={bad!r} 应被拒绝"):
                d.validate_generate_spec(dict(make_spec(), tool=bad))

    def test_upscale_does_not_require_pipeline(self) -> None:
        pipeline, model_id, tasks, tool = d.validate_generate_spec(
            {"tool": "upscale", "reference": make_reference()}
        )
        self.assertEqual(tool, "upscale")
        self.assertEqual(pipeline, UPSCALE_PIPELINE)
        self.assertEqual(model_id, UPSCALE_MODEL_ID)
        self.assertEqual(tasks, [], "任务要等源图头校验拿到宽高后由 HTTP 层合成")

    def test_upscale_ignores_pipeline_and_tasks(self) -> None:
        # Host 不会下发这两个字段；客户端硬塞也不应改变 daemon 内部合成值。
        _pipeline, model_id, tasks, tool = d.validate_generate_spec(
            {
                "tool": "upscale",
                "pipeline": {"loader": "nope", "base": ""},
                "tasks": [{"prompt": "x"}],
                "reference": make_reference(),
            }
        )
        self.assertEqual((tool, model_id, tasks), ("upscale", UPSCALE_MODEL_ID, []))

    def test_upscale_factor_must_match_contract(self) -> None:
        spec = {"tool": "upscale", "reference": make_reference()}
        self.contract_config()
        d.validate_generate_spec(dict(spec, upscale={"factor": UPSCALE_LIMITS["factor"]}))
        self.assertEqual(d.validate_generate_spec(dict(spec, upscale={}))[3], "upscale")
        for bad in (
            {"factor": UPSCALE_LIMITS["factor"] + 1},
            {"factor": "2"},
            {"factor": True},
        ):
            with self.assertRaises(d.RequestError, msg=f"upscale={bad!r} 应被拒绝"):
                d.validate_generate_spec(dict(spec, upscale=bad))
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(dict(spec, upscale="2"))

    def test_build_upscale_task_shape(self) -> None:
        self.contract_config()
        task = d.build_upscale_task(512, 384)
        self.assertEqual(task["name"], "01")
        self.assertEqual((task["width"], task["height"]), (512, 384))
        self.assertEqual((task["steps"], task["cfg"]), (0, 0.0))
        self.assertEqual(task["prompt"], "")
        seed_max = CONTRACT_DOC["limits"]["seed"]["max"]
        self.assertGreaterEqual(task["seed"], 0)
        self.assertLessEqual(task["seed"], seed_max)


class UpscaleReferenceTest(DaemonUnitTest):
    """upscale 的源图提交期校验（parse_upscale_reference，假 PIL）。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def parse(self, image_size=(512, 384), reference=None, payload=b"fake-image-bytes"):  # noqa: ANN001, ANN201
        image = FakePILImage(image_size)
        ref = make_reference(image_b64=make_reference_b64(payload)) if reference is None else reference
        with mock.patch.dict(sys.modules, fake_pil_for(image)):
            return d.parse_upscale_reference(ref), image, ref

    def test_valid_reference_returns_bytes_and_size(self) -> None:
        spec, image, _ref = self.parse(image_size=(1024, 768))
        self.assertEqual((spec["width"], spec["height"]), (1024, 768))
        self.assertEqual(spec["image_bytes"], b"fake-image-bytes")
        self.assertNotIn("strength", spec, "upscale 没有重绘强度语义，不应返回 strength")

    def test_missing_reference_is_rejected(self) -> None:
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_upscale_reference(None)
        self.assertIn("reference.image_b64", str(ctx.exception))

    def test_reference_must_be_object(self) -> None:
        with self.assertRaises(d.RequestError):
            d.parse_upscale_reference("image-b64")

    def test_mask_is_rejected(self) -> None:
        ref = make_reference(mask_b64=make_reference_b64(b"mask"))
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_upscale_reference(ref)
        self.assertIn("不支持蒙版", str(ctx.exception))

    def test_source_long_edge_over_limit_is_rejected(self) -> None:
        max_edge = UPSCALE_LIMITS["maxInputEdge"]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((max_edge + 8, 512)))):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_upscale_reference(make_reference())
        self.assertIn(str(max_edge), str(ctx.exception))
        # 恰好等于上限必须放行（契约边界是闭区间）。
        spec, _image, _ref = self.parse(image_size=(max_edge, 512))
        self.assertEqual(spec["width"], max_edge)

    def test_source_min_edge_is_enforced(self) -> None:
        min_edge = CONTRACT_DOC["limits"]["reference"]["minEdge"]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((min_edge - 8, 64)))):
            with self.assertRaises(d.RequestError) as ctx:
                d.parse_upscale_reference(make_reference())
        self.assertIn("长边至少", str(ctx.exception))

    def test_source_bytes_limit_is_enforced(self) -> None:
        d.CONFIG.contract["limits"]["reference"]["maxBytes"] = 16
        payload = b"x" * 17
        with self.assertRaises(d.RequestError) as ctx:
            d.parse_upscale_reference(make_reference(image_b64=make_reference_b64(payload)))
        self.assertIn("上限", str(ctx.exception))

    def test_empty_base64_is_rejected(self) -> None:
        with self.assertRaises(d.RequestError):
            d.parse_upscale_reference(make_reference(image_b64=""))


class UpscaleWeightsTest(DaemonUnitTest):
    """权重下载：分块写盘、SHA256 校验、重试一次、大小上限、缓存复用与 HF_TOKEN 头。"""

    PAYLOAD = b"real-esrgan-fake-weights-payload"
    SHA256 = hashlib.sha256(PAYLOAD).hexdigest()

    def make_path(self, tmp: str) -> str:
        return os.path.join(tmp, "sr", remote_upscale.UPSCALE_WEIGHT_FILENAME)

    def ensure(self, path, responses, **kwargs):  # noqa: ANN001, ANN201
        calls: list = []
        logs: list[str] = []
        options = {
            "urlopen": make_urlopen(responses, calls),
            "urls": ("https://primary", "https://fallback"),
            "expected_bytes": len(self.PAYLOAD),
            "expected_sha256": self.SHA256,
            "chunk_size": 8,
            "log": logs.append,
        }
        options.update(kwargs)
        result = remote_upscale.ensure_weight_file(path, **options)
        return result, calls, logs

    def test_downloads_in_chunks_and_writes_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            # 分三块返回（chunk_size=8），模拟边下边写。
            result, calls, logs = self.ensure(
                path, [[self.PAYLOAD[:8], self.PAYLOAD[8:16], self.PAYLOAD[16:]]]
            )
            self.assertEqual(result, path)
            self.assertEqual(calls, ["https://primary"])
            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), self.PAYLOAD)
            self.assertFalse(os.path.exists(path + ".part"), "成功落盘后不应留下 .part")
            self.assertTrue(any("SHA256 校验通过" in line for line in logs))

    def test_sha_mismatch_retries_once_then_reports_expected_and_actual(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            wrong = b"x" * len(self.PAYLOAD)  # 大小对、内容错：必须按 SHA256 判失败
            with self.assertRaises(d.LoadError) as ctx:
                self.ensure(path, [[wrong], [wrong]])
            message = str(ctx.exception)
            self.assertIn("期望", message)
            self.assertIn("实际", message)
            self.assertIn("已尝试 2 次", message)
            self.assertIn("SHA256", message)
            self.assertFalse(os.path.exists(path), "校验失败不应落盘目标文件")
            self.assertFalse(os.path.exists(path + ".part"))

    def test_second_attempt_uses_fallback_url_and_can_succeed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            calls = []
            result = remote_upscale.ensure_weight_file(
                path,
                urlopen=make_urlopen([RuntimeError("socket 断了"), [self.PAYLOAD]], calls),
                urls=("https://primary", "https://fallback"),
                expected_bytes=len(self.PAYLOAD),
                expected_sha256=self.SHA256,
                chunk_size=8,
                log=lambda _line: None,
            )
            self.assertEqual(result, path)
            self.assertEqual(calls, ["https://primary", "https://fallback"], "重试必须换备用 URL")
            self.assertFalse(os.path.exists(path + ".part"))

    def test_size_cap_aborts_download(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            with self.assertRaises(d.LoadError) as ctx:
                self.ensure(path, [[b"0123456789"], [b"0123456789"]], max_bytes=4)
            self.assertIn("大小上限", str(ctx.exception))

    def test_size_mismatch_reports_expected_and_actual(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            with self.assertRaises(d.LoadError) as ctx:
                self.ensure(path, [[self.PAYLOAD], [self.PAYLOAD]], expected_bytes=len(self.PAYLOAD) + 1)
            self.assertIn("大小不符", str(ctx.exception))
            self.assertIn("实际", str(ctx.exception))

    def test_cached_weight_is_reused_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(self.PAYLOAD)

            def fail_urlopen(*_args, **_kwargs):  # noqa: ANN002, ANN003, ANN202
                raise AssertionError("校验通过的缓存权重不应再下载")

            logs: list[str] = []
            result = remote_upscale.ensure_weight_file(
                path,
                urlopen=fail_urlopen,
                expected_bytes=len(self.PAYLOAD),
                expected_sha256=self.SHA256,
                log=logs.append,
            )
            self.assertEqual(result, path)
            self.assertTrue(any("复用已校验权重" in line for line in logs))

    def test_cached_corruption_is_redownloaded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # 大小相同但内容不同：必须按 SHA 判成坏文件并重新下载。
            with open(path, "wb") as handle:
                handle.write(b"x" * len(self.PAYLOAD))
            result, calls, _logs = self.ensure(path, [[self.PAYLOAD]])
            self.assertEqual(result, path)
            self.assertEqual(len(calls), 1)
            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), self.PAYLOAD)

    def test_hf_token_is_sent_as_bearer_header_and_never_logged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            seen: list = []

            def opener(target, timeout=None):  # noqa: ANN001, ANN202
                seen.append((target, timeout))
                return FakeResponse([self.PAYLOAD])

            logs: list[str] = []
            remote_upscale.ensure_weight_file(
                path,
                urlopen=opener,
                environ={"HF_TOKEN": "hf-secret-token"},
                expected_bytes=len(self.PAYLOAD),
                expected_sha256=self.SHA256,
                chunk_size=8,
                log=logs.append,
            )
            target, _timeout = seen[0]
            self.assertIsInstance(target, type(remote_upscale.urllib.request.Request("https://x")))
            self.assertEqual(
                target.get_header("Authorization"), "Bearer hf-secret-token"
            )
            self.assertNotIn("hf-secret-token", "\n".join(logs), "HF_TOKEN 值不能进日志")

    def test_without_token_url_is_passed_through(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make_path(tmp)
            seen: list = []

            def opener(target, timeout=None):  # noqa: ANN001, ANN202
                seen.append(target)
                return FakeResponse([self.PAYLOAD])

            remote_upscale.ensure_weight_file(
                path,
                urlopen=opener,
                environ={},
                expected_bytes=len(self.PAYLOAD),
                expected_sha256=self.SHA256,
                chunk_size=8,
                log=lambda _line: None,
            )
            self.assertEqual(seen[0], "https://huggingface.co/gongting/real-esrgan/resolve/main/RealESRGAN_x2plus.pth")

    def test_weight_path_follows_work_dir(self) -> None:
        expected = os.path.join("D:\\work", "sr", remote_upscale.UPSCALE_WEIGHT_FILENAME)
        self.assertEqual(remote_upscale.weight_path("D:\\work"), expected)
        # 空 work_dir 用进程 cwd（daemon 在 Kaggle 上就是 /kaggle/working）。
        self.assertEqual(
            remote_upscale.weight_path(""), os.path.join(os.getcwd(), "sr", remote_upscale.UPSCALE_WEIGHT_FILENAME)
        )


class UpscaleCheckpointTest(DaemonUnitTest):
    """checkpoint 三种形状解包 + strict 灌权重（缺键报错）。"""

    def test_extracts_params_ema(self) -> None:
        state = {"conv_first.weight": object()}
        self.assertIs(remote_upscale.extract_state_dict({"params_ema": state}), state)

    def test_extracts_params(self) -> None:
        state = {"conv_first.weight": object()}
        self.assertIs(remote_upscale.extract_state_dict({"params": state}), state)

    def test_bare_state_dict_is_kept(self) -> None:
        state = {"conv_first.weight": object(), "conv_last.weight": object()}
        self.assertIs(remote_upscale.extract_state_dict(state), state)

    def test_params_ema_wins_when_both_present(self) -> None:
        ema = {"a": 1}
        raw = {"params_ema": ema, "params": {"b": 2}}
        self.assertIs(remote_upscale.extract_state_dict(raw), ema)

    def test_non_dict_checkpoint_is_load_error(self) -> None:
        with self.assertRaises(d.LoadError) as ctx:
            remote_upscale.extract_state_dict([1, 2, 3])
        self.assertIn("结构异常", str(ctx.exception))

    def test_apply_state_dict_is_strict(self) -> None:
        calls: list = []

        class FakeModel:
            def load_state_dict(self, state, strict=False):  # noqa: ANN001
                calls.append((state, strict))
                return types.SimpleNamespace(missing_keys=[])

        state = {"conv_first.weight": 1}
        remote_upscale.apply_state_dict(FakeModel(), state)
        self.assertEqual(calls[0], (state, True), "必须 strict=True：结构不匹配要当场失败")

    def test_apply_state_dict_missing_key_is_load_error(self) -> None:
        class FakeModel:
            def load_state_dict(self, state, strict=False):  # noqa: ANN001
                raise RuntimeError(
                    "Error(s) in loading state_dict: Missing key(s) in state_dict: conv_first.weight"
                )

        with self.assertRaises(d.LoadError) as ctx:
            remote_upscale.apply_state_dict(FakeModel(), {})
        message = str(ctx.exception)
        self.assertIn("结构不匹配", message)
        self.assertIn("Missing key", message)


class UpscaleArchitectureTest(DaemonUnitTest):
    """RRDBNet 架构与前向：假 torch 记录调用，验证 12 通道 / 23 块 / 两次 nearest 上采样。"""

    def make_fake_torch(self):  # noqa: ANN201
        events: list[tuple] = []

        class FakeTensor:
            def __init__(self, name: str = "t") -> None:
                self.name = name

            def __add__(self, other):  # noqa: ANN001
                return FakeTensor("add")

            def __mul__(self, other):  # noqa: ANN001
                return FakeTensor("mul")

        class FakeModule:
            def __init__(self) -> None:
                pass

            def __call__(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
                # nn.Module 的调用入口：子类只实现 forward，测试替身也要把 __call__ 转过去。
                return self.forward(*args, **kwargs)

        class FakeConv2d(FakeModule):
            def __init__(self, in_channels, out_channels, kernel, stride, padding):  # noqa: ANN001
                super().__init__()
                self.in_channels = in_channels
                self.out_channels = out_channels
                self.kernel = kernel

            def __call__(self, x):  # noqa: ANN001, ANN201
                events.append(("conv", self.in_channels, self.out_channels))
                return FakeTensor("conv")

        class FakeSequential(FakeModule):
            def __init__(self, *modules):  # noqa: ANN002
                super().__init__()
                self.modules = list(modules)

            def __call__(self, x):  # noqa: ANN001, ANN201
                for module in self.modules:
                    x = module(x)
                return x

            def __len__(self) -> int:
                return len(self.modules)

        class FakeLeakyReLU(FakeModule):
            def __init__(self, negative_slope=0.2, inplace=True):  # noqa: ANN001
                super().__init__()
                self.negative_slope = negative_slope

            def __call__(self, x):  # noqa: ANN001, ANN201
                events.append(("lrelu",))
                return x

        def pixel_unshuffle(x, scale):  # noqa: ANN001, ANN202
            events.append(("pixel_unshuffle", scale))
            return FakeTensor("pixel_unshuffle")

        def interpolate(x, scale_factor=None, mode=None):  # noqa: ANN001, ANN202
            events.append(("interpolate", scale_factor, mode))
            return x

        def cat(tensors, dim):  # noqa: ANN001, ANN202
            events.append(("cat", dim, len(tensors)))
            return FakeTensor("cat")

        nn = types.SimpleNamespace(
            Module=FakeModule,
            Conv2d=FakeConv2d,
            Sequential=FakeSequential,
            LeakyReLU=FakeLeakyReLU,
            functional=types.SimpleNamespace(pixel_unshuffle=pixel_unshuffle, interpolate=interpolate),
        )
        torch_module = types.SimpleNamespace(nn=nn, cat=cat)
        return torch_module, events

    def test_architecture_matches_realesrgan_x2plus(self) -> None:
        torch_module, _events = self.make_fake_torch()
        model = remote_upscale.build_rrdbnet(torch_module)
        self.assertEqual(model.conv_first.in_channels, 12, "scale=2 时 conv_first 输入是 3*2*2")
        self.assertEqual(model.conv_first.out_channels, 64)
        self.assertEqual(len(model.body), 23, "官方 x2plus 是 23 个 RRDB")
        self.assertEqual(model.conv_last.out_channels, 3)
        self.assertEqual(model.scale, 2)

    def test_forward_pixel_unshuffle_then_two_nearest_upsamples(self) -> None:
        torch_module, events = self.make_fake_torch()
        model = remote_upscale.build_rrdbnet(torch_module)
        result = model(object())
        self.assertIsInstance(result, object)
        labels = [event[0] for event in events]
        self.assertEqual(labels[0], "pixel_unshuffle", "forward 第一步必须是 pixel_unshuffle(x, 2)")
        self.assertEqual(events[0][1], 2)
        upsamples = [event for event in events if event[0] == "interpolate"]
        self.assertEqual(len(upsamples), 2, "scale=2 需要两次 nearest ×2 上采样")
        self.assertEqual([event[1] for event in upsamples], [2, 2])
        self.assertTrue(all(event[2] == "nearest" for event in upsamples))
        # 两次上采样的顺序必须在 conv_body 之后、conv_last 之前。
        first_conv_body = labels.index("conv")
        self.assertLess(labels.index("pixel_unshuffle"), first_conv_body)
        self.assertGreater(labels.index("interpolate"), labels.index("pixel_unshuffle"))
        # 23 个 RRDB × 3 个 RDB × 5 次 conv + conv_first/body/up1/up2/hr/last 共 351 次卷积。
        self.assertEqual(labels.count("conv"), 23 * 3 * 5 + 6)
        # 每个 RDB 4 次 cat + 3 个 RDB × 23 块 = 276 次拼接（特征逐层叠加）。
        self.assertEqual(labels.count("cat"), 23 * 3 * 4)


class ExecuteJobUpscaleTest(DaemonUnitTest):
    """execute_job 的 upscale 分支：不加载扩散 pipeline、结果字段、模型释放与失败分类。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def submit_upscale_job(self, job_id: str | None = None):
        task = d.build_upscale_task(512, 384)
        reference = {"image_bytes": b"source-bytes", "width": 512, "height": 384}
        return d.JOB_STORE.submit(
            dict(UPSCALE_PIPELINE),
            UPSCALE_MODEL_ID,
            [task],
            job_id,
            reference=reference,
            tool="upscale",
        )

    def fake_result_image(self, size=(1024, 768)):  # noqa: ANN001, ANN202
        class FakeResultImage:
            def __init__(self, image_size):  # noqa: ANN001
                self.size = tuple(image_size)
                self.closed = False

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-upscale-png")

            def close(self) -> None:
                self.closed = True

        return FakeResultImage(size)

    def run_job(self, job, result_image=None, ensure_error=None):  # noqa: ANN001, ANN202
        """执行 job：解码 / 加载 / 推理全部替换成替身，只留 execute_job 的分支编排。"""
        captured: dict = {}
        fake_model = object()

        def fake_decode(reference):  # noqa: ANN001, ANN202
            captured["reference"] = reference
            return FakePILImage((512, 384))

        def fake_ensure():  # noqa: ANN202
            if ensure_error is not None:
                raise ensure_error
            with d.STATE_LOCK:
                d.STATE.upscale_model = fake_model
                d.STATE.upscale_key = "sr/weights.pth"
            captured["model"] = fake_model
            return fake_model, 1.5

        def fake_upscale_task(model, task, source_image):  # noqa: ANN001, ANN202
            captured.update(model=model, task=task, source_image=source_image)
            if isinstance(result_image, Exception):
                raise result_image
            return {
                "name": task["name"],
                "seed": task["seed"],
                "seconds": 0.2,
                "width": 1024,
                "height": 768,
                "steps": 0,
                "cfg": 0.0,
                "png_bytes": 16,
                "image_b64": "ZmFrZQ==",
                "upscale": True,
                "scale": 2,
                "sourceWidth": 512,
                "sourceHeight": 384,
            }

        with mock.patch.object(d, "decode_reference_image", side_effect=fake_decode), mock.patch.object(
            d, "ensure_upscale_model", side_effect=fake_ensure
        ) as ensure_model, mock.patch.object(
            d, "run_upscale_task", side_effect=fake_upscale_task
        ) as run_task, mock.patch.object(
            d, "ensure_pipeline", side_effect=AssertionError("upscale 不得加载扩散 pipeline")
        ), mock.patch.object(
            d, "free_cuda_cache"
        ) as free_cache:
            d.execute_job(job)
        return captured, ensure_model, run_task, free_cache

    def test_upscale_job_skips_diffusion_pipeline_and_releases_model(self) -> None:
        job, _created = self.submit_upscale_job("sr-1")
        captured, ensure_model, run_task, _free = self.run_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertEqual(ensure_model.call_count, 1)
        self.assertEqual(run_task.call_count, 1)
        self.assertEqual(captured["task"]["width"], 512)
        self.assertIsNone(job.reference, "解码后应释放队列里保留的原始字节")
        self.assertIsNone(d.STATE.upscale_model, "执行结束必须卸载超分模型")
        self.assertIsNone(d.STATE.upscale_key)
        self.assertEqual(d.STATE.jobs_done, 1)
        self.assertIn("完成：1 张", self.logs())

    def test_result_fields_follow_protocol(self) -> None:
        job, _created = self.submit_upscale_job("sr-fields")
        self.run_job(job)
        self.assertEqual(len(job.results), 1)
        result = job.results[0]
        self.assertEqual((result["width"], result["height"]), (1024, 768))
        self.assertEqual((result["sourceWidth"], result["sourceHeight"]), (512, 384))
        self.assertIs(result["upscale"], True)
        self.assertEqual(result["scale"], 2)
        self.assertEqual((result["steps"], result["cfg"]), (0, 0.0))

    def test_run_upscale_task_encodes_png_and_uses_actual_size(self) -> None:
        job, _created = self.submit_upscale_job("sr-png")
        image = self.fake_result_image((1024, 768))
        with mock.patch.object(d, "upscale_image", return_value=image), mock.patch.object(
            d, "release_upscale_model"
        ), mock.patch.object(d, "ensure_upscale_model", return_value=(object(), 0.0)), mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((512, 384))
        ):
            d.execute_job(job)
        result = job.results[0]
        self.assertEqual(result["png_bytes"], len(b"fake-upscale-png"))
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-upscale-png")
        self.assertTrue(image.closed, "结果图编码后必须关闭")

    def test_upscale_failure_releases_model_and_finishes_failed(self) -> None:
        job, _created = self.submit_upscale_job("sr-fail")
        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((512, 384))
        ), mock.patch.object(
            d, "ensure_upscale_model", side_effect=d.LoadError("权重下载失败")
        ), mock.patch.object(
            d, "free_cuda_cache"
        ), mock.patch.object(
            d, "release_upscale_model"
        ) as release:
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "load_failed")
        self.assertEqual(release.call_count, 1, "异常路径也要卸载模型")
        self.assertIn("失败（load_failed）", self.logs())

    def test_oom_is_classified_and_cache_is_freed(self) -> None:
        job, _created = self.submit_upscale_job("sr-oom")
        with mock.patch.object(
            d, "decode_reference_image", return_value=FakePILImage((512, 384))
        ), mock.patch.object(
            d, "ensure_upscale_model", return_value=(object(), 0.0)
        ), mock.patch.object(
            d, "run_upscale_task", side_effect=RuntimeError("CUDA out of memory. Tried to allocate")
        ), mock.patch.object(
            d, "release_upscale_model"
        ), mock.patch.object(
            d, "free_cuda_cache"
        ) as free_cache:
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "oom")
        self.assertTrue(free_cache.called, "OOM 收尾必须主动清显存缓存")

    def test_job_payload_and_logs_carry_tool(self) -> None:
        job, _created = self.submit_upscale_job("sr-payload")
        self.assertEqual(job.tool, "upscale")
        payload = d.JOB_STORE.payload(job)
        self.assertEqual(payload["tool"], "upscale")
        self.assertEqual(payload["model_id"], UPSCALE_MODEL_ID)


class UpscaleHttpProtocolTest(DaemonUnitTest):
    """POST /generate 的 tool 分派：upscale 合成 1 条任务、幂等键生效、非法请求 400。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        d.STATE.phase = "ready"

    def submit(self, spec):  # noqa: ANN001, ANN202
        handler, sent = make_generate_handler(spec)
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 384)))):
            d.DaemonHandler._handle_generate(handler)
        return handler, sent

    def test_upscale_request_enqueues_single_task(self) -> None:
        _handler, sent = self.submit({"tool": "upscale", "reference": make_reference()})
        self.assertEqual(sent[0][0], 202)
        payload = sent[0][1]
        self.assertEqual(payload["tool"], "upscale")
        self.assertEqual(payload["model_id"], UPSCALE_MODEL_ID)
        job = d.JOB_STORE.get(payload["job_id"])
        self.assertEqual(job.tool, "upscale")
        self.assertEqual(job.pipeline, UPSCALE_PIPELINE)
        self.assertEqual(len(job.tasks), 1)
        self.assertEqual((job.tasks[0]["width"], job.tasks[0]["height"]), (512, 384))
        self.assertEqual(job.tasks[0]["steps"], 0)
        self.assertEqual(job.reference["width"], 512)

    def test_upscale_idempotency_key_hits_existing_job(self) -> None:
        spec = {"tool": "upscale", "reference": make_reference(), "jobId": "host-sr-1"}
        _handler, first = self.submit(spec)
        _handler, second = self.submit(spec)
        self.assertEqual(first[0][1]["job_id"], "host-sr-1")
        self.assertEqual(second[0][1]["tool"], "upscale")
        self.assertEqual(d.JOB_STORE.queue_depth(), 1, "同一 jobId 不得重复入队")
        self.assertLogContains("幂等命中")

    def test_upscale_with_mask_returns_400(self) -> None:
        ref = make_reference(mask_b64=make_reference_b64(b"mask"))
        _handler, sent = self.submit({"tool": "upscale", "reference": ref})
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_upscale_without_reference_returns_400(self) -> None:
        _handler, sent = self.submit({"tool": "upscale"})
        self.assertEqual(sent[0][0], 400)
        self.assertIn("reference", sent[0][1]["error"]["message"])

    def test_upscale_source_too_large_returns_400(self) -> None:
        handler, sent = make_generate_handler({"tool": "upscale", "reference": make_reference()})
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((2560, 1024)))):
            d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertIn(str(UPSCALE_LIMITS["maxInputEdge"]), sent[0][1]["error"]["message"])

    def test_invalid_tool_returns_400(self) -> None:
        _handler, sent = self.submit(dict(make_spec(), tool="outpaint"))
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")

    def test_generate_tool_is_reported_for_backward_compatibility(self) -> None:
        _handler, sent = self.submit(make_spec())
        self.assertEqual(sent[0][0], 202)
        self.assertEqual(sent[0][1]["tool"], "generate")
        job = d.JOB_STORE.get(sent[0][1]["job_id"])
        self.assertEqual(job.tool, "generate")
        self.assertEqual(d.JOB_STORE.payload(job)["tool"], "generate")


if __name__ == "__main__":
    import unittest

    unittest.main()
