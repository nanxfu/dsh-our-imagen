"""缓存与磁盘闸门。

磁盘预检、缓存探针脱敏、pipeline 依赖仓库推导、LRU 逐出与 keep_set、预挂载权重、CacheManager 边界。

拆分自 test/daemon-unit.py，运行：python test/remote/test_cache.py
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import types
from unittest import mock
from pathlib import Path

from support import (
    DAEMON_PATH,
    DaemonUnitTest,
    d,
    dir_count_usage,
    fake_usage,
    make_cache_dir,
    remote_cache,
)


class CacheManagerBoundaryTest(DaemonUnitTest):
    """切片⑥c/⑥f：缓存域只有 CACHE 一个入口，daemon 连别名也不再保留。"""

    # 切片⑥f 从 daemon 删掉的 11 个别名（曾用于旧调用面）。
    ALIASES = (
        "resolve_local_model",
        "resolve_local_weight",
        "local_model_dir",
        "anima_local_assets",
        "mount_point_of",
        "cache_probe_lines",
        "disk_precheck",
        "ensure_disk_capacity",
        "cache_keep_repos",
        "evict_cache_for",
        "ensure_cache_capacity",
    )

    def test_cache_is_the_single_owner_of_the_domain(self) -> None:
        self.assertIsInstance(d.CACHE, remote_cache.CacheManager)
        self.assertIs(d.CACHE.config, d.CONFIG, "CacheManager 必须读同一份活配置，不能吃快照")
        # 别名已删：要观测或打桩就打实例方法，打 daemon 上的影子属性不会改变内部行为。
        for name in self.ALIASES:
            self.assertFalse(hasattr(d, name), f"daemon 不应再暴露缓存别名 {name}（已归 CACHE）")

    def test_daemon_no_longer_defines_the_wrappers(self) -> None:
        source = DAEMON_PATH.read_text(encoding="utf-8")
        for name in ("evict_cache_for", "ensure_cache_capacity", "disk_precheck", "resolve_local_model"):
            self.assertIsNone(
                re.search(rf"(?m)^def {name}\(", source),
                f"daemon.py 不应再定义 {name}（实现已归 CacheManager）",
            )
        # 也不许以"别名赋值"的形式回来：`X = CACHE.Y` 与 `def X()` 一样，patch d.X 会变成空操作。
        self.assertIsNone(
            re.search(r"(?m)^\w+ = CACHE\.\w+$", source), "daemon.py 不应再有 CACHE 别名赋值"
        )
        # 探针"只打一次"的标志也收进实例：留影子全局的话，重绑定它不会改变行为。
        self.assertNotIn("_CACHE_PROBE_DONE", source)

    def test_gate_and_probe_replacements_hit_the_instance(self) -> None:
        """闸门内部必须走 self.*：替换 CACHE 上的方法要真的改变行为。"""
        d.CONFIG.local_models = {}
        calls: list[tuple] = []
        with mock.patch.object(
            d.CACHE, "evict_cache_for", side_effect=lambda required, keep: calls.append((required, keep)) or {}
        ):
            d.CACHE.ensure_cache_capacity({"loader": "sdxl", "base": "org/base", "downloadGb": 2.0})
        self.assertEqual(calls[0][0], 2.0)

    def test_probe_only_logs_once_until_reset(self) -> None:
        d.CACHE.reset_probe()
        try:
            with mock.patch.object(d.CACHE, "cache_probe_lines", return_value=["[cache] stub-once"]):
                d.CACHE.log_probe_once()
                d.CACHE.log_probe_once()
            self.assertEqual(self.logs().count("[cache] stub-once"), 1)
            d.CACHE.reset_probe()
            with mock.patch.object(d.CACHE, "cache_probe_lines", return_value=["[cache] stub-again"]):
                d.CACHE.log_probe_once()
            self.assertIn("[cache] stub-again", self.logs())
        finally:
            d.CACHE.reset_probe()


class DiskPrecheckTest(DaemonUnitTest):
    """P1.2 Flux.2 磁盘预检：×1.15 估算、充足/不足判定、预挂载跳过。"""

    def test_required_download_adds_headroom(self) -> None:
        self.assertEqual(d.required_download_gb({"downloadGb": 15.2}), 17.48)
        self.assertEqual(d.required_download_gb({"downloadGb": 6.78}), 7.8)
        for bad in ({}, {"downloadGb": None}, {"downloadGb": "6.5"}, {"downloadGb": True}, {"downloadGb": -1}):
            self.assertIsNone(d.required_download_gb(bad))

    def test_precheck_reports_gap(self) -> None:
        spec = {"base": "black-forest-labs/FLUX.2-klein-4B", "downloadGb": 15.2}
        result = d.CACHE.disk_precheck(spec, root="/kaggle/working", usage=fake_usage(10.0))
        self.assertEqual(result["required_gb"], 17.48)
        self.assertEqual(result["free_gb"], 10.0)
        self.assertFalse(result["enough"])
        self.assertEqual(result["path"], "/kaggle/working")

    def test_default_target_is_hf_cache_dir(self) -> None:
        # M4.1：默认按 HF 实际缓存目录量盘，而不是只看 /kaggle/working。
        with tempfile.TemporaryDirectory() as directory:
            expected = os.path.abspath(directory)
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                result = d.CACHE.disk_precheck({"base": "org/model", "downloadGb": 1.0}, usage=fake_usage(10.0))
        self.assertEqual(result["path"], expected)
        self.assertEqual(result["free_gb"], 10.0)
        self.assertTrue(result["enough"])

    def test_insufficient_space_raises_readable_error(self) -> None:
        spec = {"base": "black-forest-labs/FLUX.2-klein-4B", "downloadGb": 15.2}
        result = d.CACHE.disk_precheck(spec, root="/kaggle/working", usage=fake_usage(10.0))
        with mock.patch.object(d.CACHE, "disk_precheck", return_value=result):
            with self.assertRaises(d.LoadError) as ctx:
                d.CACHE.ensure_disk_capacity(spec)
        message = str(ctx.exception)
        self.assertIn("磁盘空间不足", message)
        self.assertIn("需 17.5 GiB", message)
        self.assertIn("可用 10.0 GiB", message)

    def test_sufficient_space_logs_and_passes(self) -> None:
        result = {"required_gb": 17.48, "free_gb": 19.0, "path": "/kaggle/working", "enough": True}
        with mock.patch.object(d.CACHE, "disk_precheck", return_value=result):
            d.CACHE.ensure_disk_capacity({"base": "org/model", "downloadGb": 15.2})
        self.assertLogContains("磁盘预检通过")

    def test_usage_error_skips_check(self) -> None:
        def broken(_path):
            raise OSError("denied")

        self.assertIsNone(d.CACHE.disk_precheck({"base": "x", "downloadGb": 1}, root="R", usage=broken))
        self.assertLogContains("跳过预检")

    def test_mounted_weights_skip_check(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            d.CONFIG.local_models = {"org/base": directory}
            with mock.patch.object(d.CACHE, "disk_precheck", side_effect=AssertionError("预挂载时不应做磁盘预检")):
                d.CACHE.ensure_disk_capacity({"base": "org/base", "downloadGb": 15.2})
        self.assertLogContains("跳过磁盘预检")

    def test_usage_root_falls_back_to_cwd(self) -> None:
        with mock.patch.object(d.os.path, "isdir", return_value=False):
            self.assertEqual(d.disk_usage_root(), os.getcwd())


class CacheProbeTest(DaemonUnitTest):
    """远端 HF 缓存探针：目录/挂载点/剩余空间摘要、token 脱敏、异常降级、只打一次。

    探针标志的复位在基类 setUp 里统一做（`d.CACHE.reset_probe()`），这里不再重复。
    """

    def test_cache_dir_env_priority(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            env = {"HF_HUB_CACHE": first, "HUGGINGFACE_HUB_CACHE": second}
            with mock.patch.dict(os.environ, env, clear=False):
                self.assertEqual(d.hf_hub_cache_dir(), os.path.abspath(first))
                os.environ.pop("HF_HUB_CACHE")
                self.assertEqual(d.hf_hub_cache_dir(), os.path.abspath(second))

    def test_cache_dir_falls_back_to_default(self) -> None:
        empty = {name: "" for name in (*d.HF_CACHE_ENV_NAMES, "HF_HOME")}
        with mock.patch.dict(sys.modules, {"huggingface_hub.constants": None, "huggingface_hub": None}):
            with mock.patch.dict(os.environ, empty, clear=False):
                path = d.hf_hub_cache_dir()
        self.assertTrue(path.endswith(os.path.join(".cache", "huggingface", "hub")), path)

    def test_line_contains_cache_dir_mount_and_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            expected = os.path.abspath(directory)
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                lines = d.CACHE.cache_probe_lines()
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertTrue(line.startswith("[cache] "), line)
        self.assertIn(f"HF_HUB_CACHE={expected}", line)
        self.assertIn("mount=", line)
        self.assertIn("free=", line)
        self.assertIn("GiB", line)

    def test_working_dir_section_reports_mount_and_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                with mock.patch.object(d.os.path, "isdir", return_value=True):
                    with mock.patch.object(d.CACHE, "mount_point_of", return_value="/kaggle/working"):
                        with mock.patch.object(d.CACHE, "probe_free_gib", return_value="12.3"):
                            line = d.CACHE.cache_probe_lines()[0]
        self.assertIn("/kaggle/working mount=/kaggle/working free=12.3GiB", line)

    def test_mount_point_uses_longest_prefix(self) -> None:
        points = ["/", "/kaggle", "/kaggle/working"]
        self.assertEqual(d.longest_mount_prefix("/kaggle/working/hf/hub", points), "/kaggle/working")
        self.assertEqual(d.longest_mount_prefix("/kaggle/other", points), "/kaggle")
        self.assertEqual(d.longest_mount_prefix("/tmp/x", points), "/")
        self.assertEqual(d.longest_mount_prefix("/elsewhere", ["/kaggle"]), "")

    def test_read_mount_points_parses_and_decodes(self) -> None:
        # /proc/mounts 的路径字段会把空格转义成 \040，需要还原后才能做前缀匹配。
        table = (
            "/dev/sda1 / ext4 rw,relatime 0 0\n"
            "tmpfs /kaggle/\\040working tmpfs rw 0 0\n"
            "proc /proc proc rw 0 0\n"
            "garbage-line\n"
        )
        with mock.patch("builtins.open", mock.mock_open(read_data=table)):
            points = d.read_mount_points()
        self.assertEqual(points, ["/", "/kaggle/ working", "/proc"])

    def test_token_values_never_logged(self) -> None:
        secret = "hf_TOKEN_VALUE_never_logged"
        env = {"HF_TOKEN": secret, "HUGGING_FACE_HUB_TOKEN": secret}
        with tempfile.TemporaryDirectory() as directory:
            env["HF_HUB_CACHE"] = directory
            with mock.patch.dict(os.environ, env, clear=False):
                d.CACHE.log_probe_once()
        logs = self.logs()
        self.assertIn("[cache]", logs)
        self.assertIn("HF_HUB_CACHE=", logs)
        self.assertNotIn(secret, logs)

    def test_token_inside_cache_path_is_redacted(self) -> None:
        secret = "hf_SECRET_TOKEN_in_path"
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = os.path.join(directory, secret, "hub")
            env = {"HF_HUB_CACHE": cache_dir, "HF_TOKEN": secret}
            with mock.patch.dict(os.environ, env, clear=False):
                line = d.CACHE.cache_probe_lines()[0]
        self.assertNotIn(secret, line)
        self.assertIn("***", line)

    def test_probe_degrades_on_usage_error(self) -> None:
        with mock.patch.object(d.shutil, "disk_usage", side_effect=OSError("denied")):
            with mock.patch.object(d.CACHE, "read_mount_points", return_value=None):
                with mock.patch.object(d.os, "stat", side_effect=OSError("denied")):
                    lines = d.CACHE.cache_probe_lines()
        self.assertEqual(len(lines), 1)
        self.assertIn("mount=unknown", lines[0])
        self.assertIn("free=unknown", lines[0])

    def test_mount_point_never_raises(self) -> None:
        with mock.patch.object(d.CACHE, "read_mount_points", return_value=None):
            with mock.patch.object(d.os, "stat", side_effect=OSError("denied")):
                self.assertEqual(d.CACHE.mount_point_of("no/such/dir"), "unknown")

    def test_first_load_logs_probe_only_once(self) -> None:
        with mock.patch.object(d, "build_pipeline", return_value=(object(), "sdxl:org/base")):
            d.ensure_pipeline({"loader": "sdxl", "base": "org/base"})
            d.ensure_pipeline({"loader": "sdxl", "base": "org/other"})
        cache_lines = [line for line in self.logs().splitlines() if "[cache]" in line]
        self.assertEqual(len(cache_lines), 1, self.logs())


class PipelineReposTest(DaemonUnitTest):
    """M4.1：pipeline 依赖仓库收集与 keep_set（含 local_models 只读挂载）。"""

    def test_collects_nested_pipeline_repos(self) -> None:
        spec = {
            "loader": "sdxl-lora",
            "base": "stabilityai/stable-diffusion-xl-base-1.0",
            "lora": {"repo": "ByteDance/SDXL-Lightning", "weight": "sdxl_lightning_4step_lora.safetensors"},
            "scheduler": {"type": "euler", "timestepSpacing": "trailing"},
            "variant": "fp16",
            "downloadGb": 6.78,
            "allowPatterns": ["model_index.json", "**/config.json", "**/*.fp16.safetensors"],
        }
        self.assertEqual(
            d.pipeline_repos(spec),
            ["stabilityai/stable-diffusion-xl-base-1.0", "ByteDance/SDXL-Lightning"],
        )

    def test_collects_anima_assets_and_dedupes(self) -> None:
        spec = {
            "loader": "anima",
            "base": "Johnny-Z/Anima-Light-Lavender",
            "weight": "anima-light-lavender.safetensors",
            "textEncoder": {"repo": "circlestone-labs/Anima", "weight": "split_files/text_encoders/te.safetensors"},
            "vae": {"repo": "Qwen/Qwen-Image", "subfolder": "vae"},
            "tokenizers": {"repo": "hugging-apps/anima-light-lavender-demo", "repoType": "space"},
            "unused": {"repo": "Qwen/Qwen-Image"},
        }
        repos = d.pipeline_repos(spec)
        self.assertEqual(
            repos,
            [
                "Johnny-Z/Anima-Light-Lavender",
                "circlestone-labs/Anima",
                "Qwen/Qwen-Image",
                "hugging-apps/anima-light-lavender-demo",
            ],
        )
        # 大小写不同的同一仓库只保留首次出现。
        self.assertEqual(d.pipeline_repos({"a": "Org/Name", "b": "org/name"}), ["Org/Name"])

    def test_ignores_non_repo_strings(self) -> None:
        spec = {
            "base": "org/model",
            "weights": ["split_files/x/y.safetensors", "/kaggle/input/hub/x", "weight.safetensors"],
            "url": "https://huggingface.co/org/model",
            "numbers": [1, 2.5, None, True],
            "dicts": [{"nested": ["org/another-model", ""]}],
        }
        self.assertEqual(d.pipeline_repos(spec), ["org/model", "org/another-model"])

    def test_keep_set_adds_mounted_repos(self) -> None:
        d.CONFIG.local_models = {"Qwen/Qwen-Image": "/kaggle/input/qwen-image", "org/extra": "/kaggle/input/x"}
        keep = d.CACHE.cache_keep_repos({"loader": "anima", "base": "org/base", "vae": {"repo": "Qwen/Qwen-Image"}})
        self.assertIn("org/base", keep)
        self.assertIn("Qwen/Qwen-Image", keep)
        self.assertIn("org/extra", keep)
        self.assertNotIn("", keep)

    def test_cache_dir_name_round_trip(self) -> None:
        self.assertEqual(d.repo_from_cache_dir_name("models--org--name"), "org/name")
        self.assertEqual(d.repo_from_cache_dir_name("models--stabilityai--stable-diffusion-xl-base-1.0"), "stabilityai/stable-diffusion-xl-base-1.0")
        # 仓库名自带 `--` 时不能被还原成多级路径。
        self.assertEqual(d.repo_from_cache_dir_name("models--org--name--v2"), "org/name--v2")
        self.assertIsNone(d.repo_from_cache_dir_name("models--garbage"))
        self.assertIsNone(d.repo_from_cache_dir_name("datasets--org--name"))
        self.assertEqual(d.cache_repo_candidates("models--org--name"), {"org/name"})


def make_cache_dir(root: str, name: str, mtime: float, size_bytes: int = 1024) -> str:
    """在缓存根下伪造一个 ``models--*`` 目录，并固定 mtime 供 LRU 排序断言。"""
    path = Path(root, name)
    path.mkdir(parents=True, exist_ok=True)
    Path(path, "blob.bin").write_bytes(b"x" * size_bytes)
    os.utime(path, (mtime, mtime))
    return str(path)


def dir_count_usage(root: str, base_free_gb: float, per_dir_gb: float = 1.0):  # noqa: ANN201
    """disk_usage 替身：每删掉一个 models--* 目录，可用空间 +per_dir_gb。"""
    initial = len([name for name in os.listdir(root) if name.startswith("models--")])

    def usage(_path):  # noqa: ANN001
        remaining = len([name for name in os.listdir(root) if name.startswith("models--")])
        free_gb = base_free_gb + (initial - remaining) * per_dir_gb
        return types.SimpleNamespace(free=int(free_gb * 2**30), total=int(20 * 2**30))

    return usage


class CacheEvictTest(DaemonUnitTest):
    """M4.1：LRU 缓存清理顺序、keep_set、预挂载保护、空间不足报错。"""

    def setUp(self) -> None:
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()
        super().tearDown()

    def evict(self, required_gb, keep_repos=None, usage=None, root=None):  # noqa: ANN001, ANN201
        return d.CACHE.evict_cache_for(
            required_gb,
            keep_repos or (),
            root=self.root if root is None else root,
            usage=usage or dir_count_usage(self.root, 0.5),
        )

    def test_evicts_oldest_first_and_stops_when_enough(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        make_cache_dir(self.root, "models--org--mid", mtime=2000)
        make_cache_dir(self.root, "models--org--new", mtime=3000)
        # 需 2.0 × 1.15 = 2.30 GiB；基础可用 0.5，每删一个 +1.0 → 删两个后 2.5 达标。
        result = self.evict(2.0)
        self.assertTrue(result["enough"])
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/old", "org/mid"])
        self.assertEqual(result["free_gb"], 2.5)
        self.assertFalse(Path(self.root, "models--org--old").exists())
        self.assertFalse(Path(self.root, "models--org--mid").exists())
        self.assertTrue(Path(self.root, "models--org--new").exists(), "达标后不应继续删")
        logs = self.logs()
        self.assertIn("[cache] evicted org/old freed=", logs)
        self.assertIn("[cache] evicted org/mid freed=", logs)
        self.assertNotIn("evicted org/new", logs)

    def test_keep_set_is_never_evicted(self) -> None:
        # 当前模型的 base + vae + lora 全部在 keep_set 内。
        spec = {
            "loader": "sdxl-lora",
            "base": "org/base",
            "lora": {"repo": "org/lora"},
            "vae": {"repo": "org/vae"},
        }
        make_cache_dir(self.root, "models--org--base", mtime=1000)
        make_cache_dir(self.root, "models--org--lora", mtime=1001)
        make_cache_dir(self.root, "models--org--vae", mtime=1002)
        make_cache_dir(self.root, "models--org--stale", mtime=1003)
        result = self.evict(1.0, keep_repos=d.CACHE.cache_keep_repos(spec), usage=dir_count_usage(self.root, 0.2))
        # 需 1.15 GiB：删掉 stale 后 1.2 GiB 即达标。
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/stale"])
        for name in ("models--org--base", "models--org--lora", "models--org--vae"):
            self.assertTrue(Path(self.root, name).exists(), name)
        self.assertLogContains("保留当前模型/预挂载缓存")

    def test_mounted_local_models_are_untouched(self) -> None:
        mount_dir = Path(self.root, "kaggle-input", "anima")
        mount_dir.mkdir(parents=True)
        Path(mount_dir, "model_index.json").write_text("{}", encoding="utf-8")
        d.CONFIG.local_models = {"org/mounted": str(mount_dir)}
        make_cache_dir(self.root, "models--org--mounted", mtime=1000)
        make_cache_dir(self.root, "models--org--stale", mtime=1001)
        result = self.evict(1.0, usage=dir_count_usage(self.root, 0.2))
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/stale"])
        self.assertTrue(Path(self.root, "models--org--mounted").exists(), "预挂载仓库的缓存目录不能删")
        self.assertTrue(Path(mount_dir, "model_index.json").exists(), "只读挂载目录不能删")

    def test_insufficient_space_raises_readable_load_error(self) -> None:
        make_cache_dir(self.root, "models--org--a", mtime=1000)
        make_cache_dir(self.root, "models--org--b", mtime=2000)
        with self.assertRaises(d.LoadError) as ctx:
            self.evict(10.0, usage=dir_count_usage(self.root, 0.5))
        message = str(ctx.exception)
        self.assertIn("磁盘空间不足", message)
        self.assertIn("需 11.50 GiB", message)
        self.assertIn("可用 2.50 GiB", message)
        # 可删项应全部清完，再判定失败。
        self.assertFalse(Path(self.root, "models--org--a").exists())
        self.assertFalse(Path(self.root, "models--org--b").exists())
        self.assertEqual(self.logs().count("[cache] evicted "), 2)

    def test_enough_space_does_not_scan_or_delete(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        result = self.evict(1.0, usage=dir_count_usage(self.root, 10.0))
        self.assertTrue(result["enough"])
        self.assertEqual(result["evicted"], [])
        self.assertTrue(Path(self.root, "models--org--old").exists())
        self.assertNotIn("[cache] evicted", self.logs())

    def test_default_root_follows_hf_hub_cache_dir(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        make_cache_dir(self.root, "models--org--new", mtime=2000)
        with mock.patch.dict(os.environ, {"HF_HUB_CACHE": self.root}, clear=False):
            result = d.CACHE.evict_cache_for(0.5, (), usage=dir_count_usage(self.root, 0.0))
        self.assertEqual(result["path"], os.path.abspath(self.root))
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/old"])

    def test_usage_failure_degrades_without_deleting(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)

        def broken(_path):  # noqa: ANN001
            raise OSError("denied")

        result = self.evict(100.0, usage=broken)
        self.assertTrue(result["enough"])
        self.assertEqual(result["evicted"], [])
        self.assertTrue(Path(self.root, "models--org--old").exists())
        self.assertLogContains("无法读取磁盘剩余空间")

    def test_unrecognized_cache_dirs_are_skipped(self) -> None:
        Path(self.root, "models--garbage").mkdir()
        Path(self.root, "not-a-cache-dir").mkdir()
        self.assertEqual([entry["name"] for entry in d.cache_model_dirs(self.root)], [])
        with self.assertRaises(d.LoadError):
            self.evict(100.0, usage=dir_count_usage(self.root, 0.0))
        self.assertTrue(Path(self.root, "models--garbage").exists())


class CacheCapacityTest(DaemonUnitTest):
    """M4.1：ensure_pipeline 加载路径上的缓存清理闸门与跳过条件。"""

    def test_local_mounted_pipeline_skips_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            d.CONFIG.local_models = {"org/base": directory}
            with mock.patch.object(d.CACHE, "evict_cache_for", side_effect=AssertionError("预挂载时不应清理缓存")):
                d.CACHE.ensure_cache_capacity({"loader": "sdxl", "base": "org/base", "downloadGb": 15.2})

    def test_missing_download_gb_skips_eviction(self) -> None:
        with mock.patch.object(d.CACHE, "evict_cache_for", side_effect=AssertionError("没有体积信息时不应清理")):
            d.CACHE.ensure_cache_capacity({"loader": "sdxl", "base": "org/base"})

    def test_anima_local_dit_skips_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "anima.safetensors").write_bytes(b"stub")
            d.CONFIG.local_models = {"Johnny-Z/Anima": directory}
            spec = {
                "loader": "anima",
                "base": "Johnny-Z/Anima",
                "weight": "anima.safetensors",
                "downloadGb": 5.6,
            }
            with mock.patch.object(d.CACHE, "evict_cache_for", side_effect=AssertionError("预挂载 DiT 时不应清理")):
                d.CACHE.ensure_cache_capacity(spec)

    def test_calls_evict_with_pipeline_keep_set(self) -> None:
        calls: list[tuple] = []
        with mock.patch.object(d.CACHE, "evict_cache_for", side_effect=lambda required, keep: calls.append((required, keep)) or {}):
            d.CACHE.ensure_cache_capacity(
                {
                    "loader": "sdxl-lora",
                    "base": "org/base",
                    "lora": {"repo": "org/lora"},
                    "downloadGb": 6.78,
                }
            )
        self.assertEqual(calls[0][0], 6.78)
        self.assertIn("org/base", calls[0][1])
        self.assertIn("org/lora", calls[0][1])

    def test_ensure_pipeline_evicts_before_build(self) -> None:
        order: list[str] = []
        with tempfile.TemporaryDirectory() as root:
            make_cache_dir(root, "models--org--old", mtime=1000)
            make_cache_dir(root, "models--org--base", mtime=2000)
            spec = {"loader": "sdxl", "base": "org/base", "downloadGb": 0.5}

            def fake_build(_spec):  # noqa: ANN001
                order.append("build")
                return object(), "sdxl:org/base"

            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": root}, clear=False):
                with mock.patch.object(d.CACHE, "log_probe_once"), mock.patch.object(
                    d, "build_pipeline", side_effect=fake_build
                ), mock.patch.object(d.shutil, "disk_usage", dir_count_usage(root, 0.0)):
                    d.ensure_pipeline(spec)
            self.assertFalse(Path(root, "models--org--old").exists())
            self.assertTrue(Path(root, "models--org--base").exists())
            self.assertEqual(order, ["build"])
        self.assertLogContains("[cache] evicted org/old")


class LocalModelTest(DaemonUnitTest):
    """P2.1 权重预挂载：命中判定与路径安全。"""

    def test_resolve_local_model_requires_model_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            d.CONFIG.local_models = {"org/base": directory}
            self.assertIsNone(d.CACHE.resolve_local_model("org/base"))
            self.assertLogContains("缺少 model_index.json")
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            self.assertEqual(d.CACHE.resolve_local_model("org/base"), directory)
            self.assertIsNone(d.CACHE.resolve_local_model("org/other"))
            self.assertIsNone(d.CACHE.resolve_local_model(""))

    def test_resolve_local_weight_prefers_mounted_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            weight = Path(directory, "lora.safetensors")
            weight.write_bytes(b"stub")
            d.CONFIG.local_models = {"org/lora": directory}
            self.assertEqual(d.CACHE.resolve_local_weight("org/lora", "lora.safetensors"), str(weight))
            self.assertIsNone(d.CACHE.resolve_local_weight("org/lora", "missing.safetensors"))
            self.assertLogContains("回退在线下载")
            self.assertIsNone(d.CACHE.resolve_local_weight("org/other", "lora.safetensors"))
            self.assertIsNone(d.CACHE.resolve_local_weight("org/lora", ""))

    def test_resolve_local_weight_rejects_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            d.CONFIG.local_models = {"org/lora": directory}
            self.assertIsNone(d.CACHE.resolve_local_weight("org/lora", os.path.join("..", "evil.safetensors")))
        self.assertLogContains("越出预挂载目录")


if __name__ == "__main__":
    import unittest

    unittest.main()
