"""job 领域：协议、存储与失败分类。

异步 job 协议（202 入队、幂等、四态视图、淘汰）、JobStore 的锁与容量边界、失败分类表。

拆分自 test/daemon-unit.py，运行：python test/remote/test_jobs.py
"""

from __future__ import annotations

import re
import threading
import time
from unittest import mock

from support import (
    DAEMON_PATH,
    DaemonUnitTest,
    TASKS,
    d,
    make_generate_handler,
    make_get_handler,
    make_pipeline,
    make_spec,
    remote_job_store,
)


class JobStoreBoundaryTest(DaemonUnitTest):
    """任务表只归 JobStore：daemon 不再暴露 JOB_* 裸状态，容量/锁顺序由 store 保证。"""

    # 切片⑥f 删掉的 6 个转发包装：视图与淘汰一律直接调 JOB_STORE。
    WRAPPERS = ("submit_job", "get_job", "queue_depth", "active_job_count", "job_payload", "prune_jobs")

    def test_store_is_the_only_owner_of_the_table(self) -> None:
        self.assertIsInstance(d.JOB_STORE, remote_job_store.JobStore)
        for leaked in ("JOB_LOCK", "JOB_COND", "JOB_QUEUE", "JOB_TABLE", "JOB_FINISHED_ORDER"):
            self.assertFalse(hasattr(d, leaked), f"daemon 不应再暴露 {leaked}")

    def test_daemon_no_longer_forwards_job_views(self) -> None:
        """转发包装会让 patch d.get_job 变成空操作：视图必须从 JOB_STORE 取。"""
        for name in self.WRAPPERS:
            self.assertFalse(hasattr(d, name), f"daemon 不应再暴露 {name}（已归 JOB_STORE）")
        self.assertFalse(hasattr(d, "JOB_WAKE"), "JOB_WAKE 兼容对象应随门面一起删除")
        source = DAEMON_PATH.read_text(encoding="utf-8")
        self.assertIsNone(
            re.search(r"(?m)^\w+ = JOB_STORE\.\w+$", source), "daemon.py 不应再有 JOB_STORE 别名赋值"
        )

    def test_queue_capacity_follows_the_injected_contract(self) -> None:
        """容量必须每次读契约：store 在启动期构造，那时 contract 还是空的。"""
        d.CONFIG.contract = {"limits": {"queue": {"maxPending": 2}}}
        self.assertEqual(d.JOB_STORE.max_queue_depth(), 2)
        for index in range(2):
            d.JOB_STORE.submit(make_pipeline(), "org/base", [dict(TASKS[0])], job_id=f"cap-{index}")
        with self.assertRaises(d.QueueFullError):
            d.JOB_STORE.submit(make_pipeline(), "org/base", [dict(TASKS[0])], job_id="cap-overflow")

    def test_pop_next_without_jobs_does_not_spin(self) -> None:
        """空队列 + timeout=0 只探一次；停止信号也立即返回 None（worker 靠它退出）。"""
        started = time.time()
        self.assertIsNone(d.JOB_STORE.pop_next(timeout=0))
        self.assertLess(time.time() - started, 0.5, "timeout=0 不能空转")
        self.assertIsNone(d.JOB_STORE.pop_next(timeout=0.05, should_stop=lambda: True))

    def test_finish_releases_job_lock_before_touching_state(self) -> None:
        """§5.8：store.finish() 先放掉 JOB_LOCK，_finish_job 才去取 STATE_LOCK（反向会死锁）。"""
        job, _ = d.JOB_STORE.submit(make_pipeline(), "org/base", [dict(TASKS[0])], job_id="finish-order")
        events: list[str] = []

        class TrackingLock:
            def __enter__(self):
                events.append("state-lock")
                return self

            def __exit__(self, *exc):
                events.append("state-unlock")
                return False

        real_finish = d.JOB_STORE.finish

        def spy_finish(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
            result = real_finish(*args, **kwargs)
            events.append("store-finished")
            return result

        with mock.patch.object(d, "STATE_LOCK", TrackingLock()), mock.patch.object(
            d.JOB_STORE, "finish", side_effect=spy_finish
        ):
            d._finish_job(job, d.JOB_STATUS_DONE)

        self.assertEqual(events[:2], ["store-finished", "state-lock"], "取 STATE_LOCK 前必须已释放 JOB_LOCK")
        self.assertEqual(job.status, d.JOB_STATUS_DONE)


class ClassifyFailureTest(DaemonUnitTest):
    def test_oom_is_detected_by_message(self) -> None:
        code, message = d.classify_failure(RuntimeError("CUDA out of memory. Tried to allocate"))
        self.assertEqual(code, "oom")
        self.assertTrue(message.startswith("显存不足"))

    def test_request_error_maps_to_invalid_request(self) -> None:
        code, _ = d.classify_failure(d.RequestError("tasks 为空"))
        self.assertEqual(code, "invalid_request")

    def test_load_error_maps_to_load_failed(self) -> None:
        code, _ = d.classify_failure(d.LoadError("模型加载失败"))
        self.assertEqual(code, "load_failed")

    def test_unknown_error_uses_default(self) -> None:
        self.assertEqual(d.classify_failure(ValueError("boom"))[0], "generation_failed")
        self.assertEqual(d.classify_failure(ValueError("boom"), default="load_failed")[0], "load_failed")


class JobProtocolTest(DaemonUnitTest):
    """0.5.0 异步 job：202 入队 + GET /job 轮询 + worker 执行与保留策略。"""

    def ready(self) -> None:
        d.STATE.phase = "ready"

    def submit(self, task_count: int = 1, job_id: str | None = None):
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        return d.JOB_STORE.submit(make_pipeline(), "org/base-model", tasks, job_id)

    # ---- POST /generate：入队即返回 ----

    def test_generate_returns_202_and_enqueues(self) -> None:
        self.ready()
        handler, sent = make_generate_handler(make_spec(tasks=TASKS))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 202)
        payload = sent[0][1]
        self.assertEqual(payload["status"], "accepted")
        self.assertEqual(payload["model_id"], "org/base-model")
        self.assertTrue(payload["job_id"])
        self.assertTrue(payload["created_at"].endswith("Z"))
        self.assertEqual(d.JOB_STORE.queue_depth(), 1)

    def test_generate_honours_job_id_and_is_idempotent(self) -> None:
        self.ready()
        spec = dict(make_spec(tasks=TASKS), jobId="host-job-1")
        handler, sent = make_generate_handler(spec)
        d.DaemonHandler._handle_generate(handler)
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual([item[0] for item in sent], [202, 202])
        self.assertEqual([item[1]["job_id"] for item in sent], ["host-job-1", "host-job-1"])
        self.assertEqual(d.JOB_STORE.queue_depth(), 1)
        self.assertLogContains("幂等命中")

    def test_generate_rejects_invalid_job_id(self) -> None:
        self.ready()
        handler, sent = make_generate_handler(dict(make_spec(tasks=TASKS), jobId="bad id!"))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)

    def test_generate_warms_up_when_not_ready(self) -> None:
        handler, sent = make_generate_handler(make_spec(tasks=TASKS))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 503)
        self.assertEqual(sent[0][1]["error"]["code"], "warming")

    def test_generate_rejects_invalid_spec_synchronously(self) -> None:
        self.ready()
        bad = {"pipeline": {"loader": "nope", "base": "x"}, "tasks": [{"prompt": "x"}]}
        handler, sent = make_generate_handler(bad)
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")

    # ---- job_payload 三态 ----

    def test_queued_payload(self) -> None:
        job, created = self.submit(task_count=2)
        self.assertTrue(created)
        payload = d.JOB_STORE.payload(job)
        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["progress"], {"done": 0, "total": 2})
        self.assertIsNone(payload["results"])
        self.assertIsNone(payload["error"])
        self.assertIsNone(payload["load_seconds"])
        self.assertEqual(payload["job_id"], job.job_id)

    def test_done_payload_carries_results(self) -> None:
        job, _ = self.submit()
        job.results = [{"name": "01", "image_b64": "x"}]
        d._finish_job(job, d.JOB_STATUS_DONE)
        payload = d.JOB_STORE.payload(job)
        self.assertEqual(payload["status"], "done")
        self.assertEqual(payload["progress"], {"done": 1, "total": 1})
        self.assertEqual(payload["results"], [{"name": "01", "image_b64": "x"}])
        self.assertIsNone(payload["error"])

    def test_failed_payload_carries_error(self) -> None:
        job, _ = self.submit()
        d._finish_job(job, d.JOB_STATUS_FAILED, {"code": "oom", "message": "显存不足"})
        payload = d.JOB_STORE.payload(job)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"]["code"], "oom")
        self.assertIsNone(payload["results"])

    # ---- GET /job ----

    def test_get_job_returns_payload(self) -> None:
        job, _ = self.submit()
        handler, sent = make_get_handler(f"/job?id={job.job_id}")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 200)
        self.assertEqual(sent[0][1]["job_id"], job.job_id)
        self.assertEqual(sent[0][1]["status"], "queued")

    def test_unknown_job_returns_404(self) -> None:
        handler, sent = make_get_handler("/job?id=missing")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 404)
        self.assertEqual(sent[0][1]["error"]["code"], "unknown_job")

    def test_missing_job_id_returns_400(self) -> None:
        handler, sent = make_get_handler("/job")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")

    def test_unknown_path_stays_404(self) -> None:
        handler, sent = make_get_handler("/nope")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 404)
        self.assertEqual(sent[0][1]["error"]["code"], "not_found")

    # ---- 保留 / 淘汰 ----

    def test_prunes_oldest_finished_beyond_limit(self) -> None:
        for index in range(d.JOB_MAX_FINISHED + 3):
            job, _ = self.submit(job_id=f"job-{index}")
            d._finish_job(job, d.JOB_STATUS_DONE)
        d.JOB_STORE.prune()
        self.assertEqual(d.JOB_STORE.count(), d.JOB_MAX_FINISHED)
        self.assertIsNone(d.JOB_STORE.get("job-0"))
        self.assertIsNotNone(d.JOB_STORE.get(f"job-{d.JOB_MAX_FINISHED + 2}"))

    def test_prunes_ttl_expired_finished(self) -> None:
        job, _ = self.submit(job_id="ttl-job")
        d._finish_job(job, d.JOB_STATUS_DONE)
        job.finished_at = time.time() - d.JOB_TTL_SEC - 1
        d.JOB_STORE.prune()
        self.assertIsNone(d.JOB_STORE.get("ttl-job"))

    def test_active_jobs_are_never_pruned(self) -> None:
        self.submit(job_id="queued-job")
        running, _ = self.submit(job_id="running-job")
        d.JOB_STORE.mark_running(running)
        d.JOB_STORE.prune(time.time() + d.JOB_TTL_SEC * 10)
        self.assertEqual(d.JOB_STORE.count(), 2)
        self.assertIsNotNone(d.JOB_STORE.get("queued-job"))

    # ---- worker 执行 ----

    def test_execute_job_success_updates_progress_and_state(self) -> None:
        job, _ = self.submit(task_count=2)

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            results = []
            for task in tasks:
                results.append({"name": task["name"], "image_b64": "x"})
                if on_progress is not None:
                    on_progress(results)
            return results

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 1.25)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertEqual(job.load_seconds, 1.25)
        self.assertEqual(len(job.results), 2)
        self.assertEqual(d.STATE.jobs_done, 2)
        self.assertIsNone(job.error)
        self.assertLogContains("完成：2 张")

    def test_execute_job_failure_records_error(self) -> None:
        job, _ = self.submit()
        with mock.patch.object(d, "ensure_pipeline", side_effect=d.LoadError("pip 失败")):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "load_failed")
        self.assertEqual(d.STATE.last_error_code, "load_failed")
        self.assertLogContains("失败（load_failed）")

    def test_queue_depth_ignores_running_job(self) -> None:
        job, _ = self.submit(job_id="running-only")
        # 真实时序：worker 先出队再置 running，此时它既不在队列里也不再计入 queue_depth。
        self.assertIs(d.JOB_STORE.pop_next(timeout=0), job)
        d.JOB_STORE.mark_running(job)
        self.assertEqual(d.JOB_STORE.queue_depth(), 0)
        self.assertEqual(d.JOB_STORE.active_count(), 1)

    def test_worker_drains_queue(self) -> None:
        drained = threading.Event()

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            return []

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 0.0)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            self.submit(job_id="worker-job")
            d.BOOT.stop_event.clear()
            thread = d.start_job_worker()
            try:
                deadline = time.time() + 3
                while time.time() < deadline:
                    job = d.JOB_STORE.get("worker-job")
                    if job is not None and job.status == d.JOB_STATUS_DONE:
                        drained.set()
                        break
                    time.sleep(0.02)
            finally:
                d.BOOT.stop_event.set()
                d.JOB_STORE.notify()
                thread.join(timeout=2)
        self.assertTrue(drained.is_set(), "worker 未在 3s 内消费完 job")


if __name__ == "__main__":
    import unittest

    unittest.main()
