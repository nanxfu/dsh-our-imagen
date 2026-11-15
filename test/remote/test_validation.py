"""请求校验。

validate_generate_spec 的契约边界、默认值与非法输入归一。

拆分自 test/daemon-unit.py，运行：python test/remote/test_validation.py
"""

from __future__ import annotations

from support import DaemonUnitTest, d, make_pipeline, make_spec


class ValidateSpecTest(DaemonUnitTest):
    def test_accepts_minimal_request_with_defaults(self) -> None:
        pipeline, model_id, tasks = d.validate_generate_spec(make_spec())
        self.assertEqual(pipeline["loader"], "sdxl")
        self.assertEqual(model_id, "org/base-model")
        task = tasks[0]
        self.assertEqual(task["name"], "01")
        self.assertEqual(task["width"], 1024)
        self.assertEqual(task["height"], 1024)
        self.assertEqual(task["steps"], 4)
        self.assertEqual(task["cfg"], 0.0)
        self.assertGreaterEqual(task["seed"], 0)
        self.assertEqual(task["negative_prompt"], "")

    def test_rejects_structurally_bad_requests(self) -> None:
        for bad in (
            None,
            [],
            {},
            {"pipeline": {"loader": "nope", "base": "b"}, "tasks": [{"prompt": "x"}]},
            {"pipeline": {"loader": "sdxl", "base": ""}, "tasks": [{"prompt": "x"}]},
            {"pipeline": make_pipeline(), "tasks": []},
            {"pipeline": make_pipeline(), "tasks": ["not-a-dict"]},
            {"pipeline": make_pipeline(), "tasks": [{"prompt": "   "}]},
        ):
            with self.assertRaises(d.RequestError):
                d.validate_generate_spec(bad)

    def test_explicit_name_and_seed_are_kept(self) -> None:
        _, _, tasks = d.validate_generate_spec(
            make_spec([{"name": "custom", "prompt": "p", "seed": 42, "width": 640, "height": 384}])
        )
        self.assertEqual(tasks[0]["name"], "custom")
        self.assertEqual(tasks[0]["seed"], 42)
        self.assertEqual(tasks[0]["width"], 640)
        self.assertEqual(tasks[0]["height"], 384)

    def test_contract_bounds_are_enforced(self) -> None:
        self.contract_config()
        cases = [
            ("width", 255),
            ("width", 1537),
            ("height", 255),
            ("height", 1537),
            ("steps", 0),
            ("steps", 61),
            ("seed", 2147483648),
        ]
        for field, value in cases:
            task = {"prompt": "p"}
            task[field] = value
            with self.assertRaises(d.RequestError, msg=f"{field}={value} 应被拒绝"):
                d.validate_generate_spec(make_spec([task]))

    def test_contract_accepts_inclusive_bounds(self) -> None:
        self.contract_config()
        for field, value in (("width", 256), ("width", 1536), ("height", 256), ("height", 1536)):
            _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", field: value}]))
            self.assertEqual(tasks[0][field], value)
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "steps": 60, "seed": 2147483647}]))
        self.assertEqual(tasks[0]["steps"], 60)
        self.assertEqual(tasks[0]["seed"], 2147483647)

    def test_contract_cfg_bounds(self) -> None:
        self.contract_config()
        for value in (-0.1, 20.1):
            with self.assertRaises(d.RequestError):
                d.validate_generate_spec(make_spec([{"prompt": "p", "cfg": value}]))
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "cfg": 20}]))
        self.assertEqual(tasks[0]["cfg"], 20.0)

    def test_contract_limits_task_count(self) -> None:
        self.contract_config()
        four = [{"prompt": f"p{i}"} for i in range(4)]
        self.assertEqual(len(d.validate_generate_spec(make_spec(four))[2]), 4)
        five = [{"prompt": f"p{i}"} for i in range(5)]
        with self.assertRaises(d.RequestError) as ctx:
            d.validate_generate_spec(make_spec(five))
        self.assertIn("最多 4 个任务", str(ctx.exception))

    def test_contract_prompt_length_limit(self) -> None:
        self.contract_config()
        long_prompt = "字" * 2001
        with self.assertRaises(d.RequestError) as ctx:
            d.validate_generate_spec(make_spec([{"prompt": long_prompt}]))
        self.assertIn("2000", str(ctx.exception))
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "字" * 2000}]))
        self.assertEqual(len(tasks[0]["prompt"]), 2000)

    def test_dimensions_are_floored_to_step(self) -> None:
        self.contract_config()
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "width": 1535, "height": 263}]))
        self.assertEqual(tasks[0]["width"] % 8, 0)
        self.assertEqual(tasks[0]["height"] % 8, 0)
        self.assertLessEqual(tasks[0]["width"], 1536)
        self.assertGreaterEqual(tasks[0]["height"], 256)

    def test_falls_back_without_contract(self) -> None:
        # 契约缺失 = 旧 Host / 本地调试：沿用 0.3.0 之前的边界。
        self.assertEqual(d._max_tasks(), 8)
        eight = [{"prompt": f"p{i}"} for i in range(8)]
        self.assertEqual(len(d.validate_generate_spec(make_spec(eight))[2]), 8)
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p"}] * 9))
        _, _, tasks = d.validate_generate_spec(
            make_spec([{"prompt": "p", "width": 64, "height": 2048, "steps": 80, "cfg": 30}])
        )
        self.assertEqual(tasks[0]["width"], 64)
        self.assertEqual(tasks[0]["height"], 2048)
        self.assertEqual(tasks[0]["steps"], 80)
        self.assertEqual(tasks[0]["cfg"], 30.0)


if __name__ == "__main__":
    import unittest

    unittest.main()
