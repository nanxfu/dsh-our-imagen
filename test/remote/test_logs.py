"""日志环。

绝对序号、增量分页、环形裁剪与噪声抑制。

拆分自 test/daemon-unit.py，运行：python test/remote/test_logs.py
"""

from __future__ import annotations

from support import DaemonUnitTest, d


class LogRingTest(DaemonUnitTest):
    def test_incremental_pagination(self) -> None:
        d._ring_append("line-1")
        self.assertEqual(d.log_since(0), (["line-1"], 1))
        self.assertEqual(d.log_since(1), ([], 1))
        d._ring_append("line-2")
        d._ring_append("line-3")
        self.assertEqual(d.log_since(1), (["line-2", "line-3"], 3))
        self.assertEqual(d.log_since(3), ([], 3))

    def test_ring_trimming_keeps_latest(self) -> None:
        total_lines = d.LOG_MAX_LINES + 10
        for index in range(total_lines):
            d._ring_append(f"line-{index}")
        lines, nxt = d.log_since(0)
        self.assertEqual(len(lines), d.LOG_MAX_LINES)
        self.assertEqual(nxt, total_lines)
        self.assertEqual(lines[-1], f"line-{total_lines - 1}")
        # since 大于总数时不应回绕
        self.assertEqual(d.log_since(total_lines + 5), ([], total_lines))

    def test_log_adds_timestamp_prefix(self) -> None:
        d.log("普通进度行")
        lines, _ = d.log_since(0)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("["))
        self.assertIn("普通进度行", lines[0])


class LogNoiseTest(DaemonUnitTest):
    def test_tqdm_style_noise_is_filtered(self) -> None:
        d.log("  50%|█████     | 5/10")
        lines, _ = d.log_since(0)
        self.assertEqual(lines, [])


if __name__ == "__main__":
    import unittest

    unittest.main()
