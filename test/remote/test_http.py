"""HTTP 传输层。

DaemonHandler 与 HttpApi 的装配身份、延迟解析（patch 后必须命中）、队列满 429、未装配即报错。

拆分自 test/daemon-unit.py，运行：python test/remote/test_http.py
"""

from __future__ import annotations

import types
from unittest import mock

from support import DaemonUnitTest, TASKS, d, make_generate_handler, make_spec, remote_http


class HttpTransportBoundaryTest(DaemonUnitTest):
    """切片⑥：handler 搬进 transport/http_server.py，协作者经 HttpApi 延迟解析。"""

    def test_handler_and_api_are_the_single_assembled_objects(self) -> None:
        self.assertIs(d.DaemonHandler, remote_http.DaemonHandler)
        self.assertIs(remote_http.DaemonHandler.api, d.HTTP_API)
        # config / state 必须是活对象：单测就地改字段，handler 要读到最新值。
        self.assertIs(d.HTTP_API.config, d.CONFIG)
        self.assertIs(d.HTTP_API.state, d.STATE)

    def test_api_callables_resolve_daemon_attributes_at_call_time(self) -> None:
        """装配用 lambda 而不是函数对象：patch.object(d, "submit_job") 必须穿过 api 生效。"""
        job = types.SimpleNamespace(
            job_id="j-1", model_id="org/base", created_at=0.0, status="queued", tool="generate"
        )
        d.STATE.phase = "ready"
        with mock.patch.object(d.JOB_STORE, "submit", return_value=(job, True)) as submit:
            handler, sent = make_generate_handler(make_spec(tasks=TASKS))
            d.DaemonHandler._handle_generate(handler)
        self.assertTrue(submit.called, "api 把函数对象绑死了，替换点会静默失效")
        self.assertEqual(sent[0][0], 202)
        self.assertEqual(sent[0][1]["job_id"], "j-1")

    def test_queue_full_maps_to_429(self) -> None:
        d.STATE.phase = "ready"
        with mock.patch.object(d.JOB_STORE, "submit", side_effect=d.QueueFullError("远端任务队列已满")):
            handler, sent = make_generate_handler(make_spec(tasks=TASKS))
            d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 429)
        self.assertEqual(sent[0][1]["error"]["code"], "queue_full")

    def test_unconfigured_handler_fails_loudly(self) -> None:
        """忘了装配要当场报错，而不是让每个请求 500。"""
        with mock.patch.object(remote_http.DaemonHandler, "api", None):
            with self.assertRaises(RuntimeError):
                remote_http.DaemonHandler._api()

    def test_server_header_version_matches_the_entry_constant(self) -> None:
        """`Server:` 头与改造前一致（默认 version_string 会补一个尾随空格，故 strip 后比）。"""
        handler = object.__new__(d.DaemonHandler)
        self.assertEqual(handler.version_string().strip(), f"imagen-daemon/{d.VERSION}")


if __name__ == "__main__":
    import unittest

    unittest.main()
