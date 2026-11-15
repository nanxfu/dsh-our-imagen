"""CacheManager：预挂载解析、磁盘预检与 HF 缓存 LRU 驱逐的唯一取数点。

为什么从 daemon.py 拆出来：这十三个函数每个都只干一件事——把 ``CONFIG.local_models`` /
``log`` / ``LoadError`` 塞给 ``cache_ops`` 的纯函数。它们构成一层没有决策的胶水，却让
"磁盘不够时到底清什么、清到什么程度"散落在入口文件里。收成对象后有两点收益：

- 配置只在一处读（``self._config.local_models``），纯函数不再重复接收三个同样的参数；
- **交叉调用走 ``self.*``**：``ensure_cache_capacity → evict_cache_for``、
  ``ensure_disk_capacity → disk_precheck``、``cache_probe_lines → mount_point_of /
  probe_free_gib``、``anima_local_assets → resolve_local_weight / local_model_dir``。
  这正是单测需要的替换点（"闸门是否真的去清理"只能这样观察），也让两个隐式调用环
  （规格 §6.2 的第一个）显式化。

**探针"进程内只打一次"的标志从模块级 global 收进实例**：``_CACHE_PROBE_DONE`` 这种
影子变量一旦被外部重绑定（测试曾经这么干），行为不会跟着变，属 §1.3.6 的假绿形态；
现在只有一个入口 :meth:`reset_probe`，语义明确。

维护约定（对应 docs/REFACTOR_ARCHITECTURE_SPEC.md §4.1 / §5.x）：

1. **只收"谁持有配置与错误类型"，不改实现**：判定逻辑仍在 ``cache_ops`` 的纯函数里
   （那 563 行是逐条实测出来的 LRU / 挂载点 / 脱敏规则，搬动只增加出错面）。
2. **纯函数模块暂时仍叫 ``cache_ops``**：``scripts/package.mjs`` 与
   ``test/kernel-package.mjs`` 按文件名把 ``remote/cache_ops.py`` 列入必需项，
   折进本文件要与 ``log_ring → observability/`` 同批改打包清单，不在本切片内。
3. **配置是活对象**：``config`` 传 ``DaemonConfig`` 实例，不传 ``local_models`` 快照——
   注入契约在启动期原地回填，测试也按 ``CONFIG.local_models = {...}`` 就地改。
4. **日志用扁平导入 ``from log_ring import log``**（理由见 ``remote/state.py`` 第 3 条）。
"""

from __future__ import annotations

from cache_ops import (
    anima_local_assets_from,
    build_cache_probe_lines,
    cache_keep_repos_from,
    disk_usage_target,
    ensure_cache_capacity_with,
    ensure_disk_capacity_with,
    evict_cache_dirs,
    hf_hub_cache_dir,
    local_model_dir_from,
    mount_point_of_path,
    pipeline_repos,
    prefetch_weights,
    probe_free_gib,
    read_mount_points,
    resolve_local_model_from,
    resolve_local_weight_from,
    run_disk_precheck,
)
from log_ring import log


class CacheManager:
    """磁盘与权重缓存的门面：构造一次，进程内各协作者共用。"""

    def __init__(self, *, config, log_fn=log, error_cls, required_repos_fn=None):  # noqa: ANN001
        self._config = config
        self._log = log_fn
        self._error_cls = error_cls
        self._probe_done = False
        # keep_set 的推导入口：daemon 注入 LoaderRegistry.required_repos，让模型家族能声明
        # 通用扫描发现不了的仓库；不注入时保持通用扫描（单测与独立使用都不受影响）。
        self._required_repos = required_repos_fn or pipeline_repos

    @property
    def config(self):  # noqa: ANN201
        """构造时注入的配置对象（诊断用：确认读的是同一份活配置，而不是快照）。"""
        return self._config

    # ---- 预挂载解析 ----

    def resolve_local_model(self, repo: str) -> str | None:
        """repo 命中 local_models 且目录含 model_index.json 时返回本地目录。"""
        return resolve_local_model_from(repo, self._config.local_models, log=self._log)

    def resolve_local_weight(self, repo: str, weight_name: str) -> str | None:
        """LoRA / 单文件权重命中预挂载且文件存在时返回本地文件路径。"""
        return resolve_local_weight_from(repo, weight_name, self._config.local_models, log=self._log)

    def local_model_dir(self, repo: str) -> str | None:
        """repo 命中 local_models 且目录存在时返回该目录（不要求 model_index.json）。"""
        return local_model_dir_from(repo, self._config.local_models)

    def anima_local_assets(self, pipeline_spec: dict) -> dict[str, str]:
        """把 anima 的四个资产解析成预挂载路径；未命中的键留给在线下载。"""
        return anima_local_assets_from(
            pipeline_spec,
            self._config.local_models,
            resolve_weight_fn=self.resolve_local_weight,
            local_dir_fn=self.local_model_dir,
            log=self._log,
        )

    # ---- 缓存探针 ----

    def read_mount_points(self) -> list[str] | None:
        """``/proc/mounts`` 解析结果；单独成方法是为了让探针的降级路径可替换。"""
        return read_mount_points()

    def mount_point_of(self, path: str) -> str:
        """path 所在挂载点：最长前缀匹配，读不到挂载表时降级到 st_dev。"""
        return mount_point_of_path(path, mount_reader=self.read_mount_points)

    def probe_free_gib(self, path: str) -> str:
        """剩余空间读数（字符串，取不到时为 ``unknown``）；单独成方法便于替换。"""
        return probe_free_gib(path)

    def cache_probe_lines(self) -> list[str]:
        """缓存 / 挂载点 / 剩余空间诊断行；任何失败都降级为 unknown，绝不抛异常。"""
        return build_cache_probe_lines(
            mount_fn=self.mount_point_of,
            free_fn=self.probe_free_gib,
            cache_dir_fn=hf_hub_cache_dir,
        )

    def log_probe_once(self) -> None:
        """模型加载前打印一次探针（进程内只打一次，避免 /logs 被诊断行刷满）。"""
        if self._probe_done:
            return
        self._probe_done = True
        try:
            for line in self.cache_probe_lines():
                self._log(line)
        except Exception:
            pass

    def reset_probe(self) -> None:
        """测试夹具用：让下一个用例重新观察"只打一次"。"""
        self._probe_done = False

    # ---- 磁盘预检与 LRU 驱逐 ----

    def disk_precheck(self, pipeline_spec: dict, root: str | None = None, usage=None) -> dict | None:  # noqa: ANN001
        """磁盘预检：返回 ``{required_gb, free_gb, path, enough}``；没有体积信息时返回 None。"""
        return run_disk_precheck(
            pipeline_spec,
            root=root,
            usage=usage,
            target_fn=disk_usage_target,
            log=self._log,
        )

    def ensure_disk_capacity(self, pipeline_spec: dict) -> None:
        """下载前磁盘预检：Flux.2 全量权重会撑爆 Kaggle 20GB 空间；预挂载时跳过。"""
        ensure_disk_capacity_with(
            pipeline_spec,
            resolve_model_fn=self.resolve_local_model,
            precheck_fn=self.disk_precheck,
            log=self._log,
            error_cls=self._error_cls,
        )

    def cache_keep_repos(self, pipeline_spec) -> set[str]:  # noqa: ANN001
        """切模型清理的不可删仓库集合：目标 pipeline 全部依赖 + 所有预挂载仓库。"""
        return cache_keep_repos_from(
            pipeline_spec, self._config.local_models, repos_fn=self._required_repos
        )

    def evict_cache_for(self, required_gb, keep_repos=None, *, root: str | None = None, usage=None) -> dict:  # noqa: ANN001
        """按需清理 HF 缓存（LRU），返回 ``{required_gb, free_gb, path, evicted, enough}``。"""
        return evict_cache_dirs(
            required_gb,
            keep_repos,
            root=root,
            usage=usage,
            local_models=self._config.local_models,
            log=self._log,
            error_cls=self._error_cls,
        )

    def ensure_cache_capacity(self, pipeline_spec: dict) -> None:
        """切模型前的缓存清理闸门：空间足够时不扫目录、不删文件，清完仍不足才报错。"""
        ensure_cache_capacity_with(
            pipeline_spec,
            resolve_model_fn=self.resolve_local_model,
            anima_assets_fn=self.anima_local_assets,
            keep_repos_fn=self.cache_keep_repos,
            evict_fn=self.evict_cache_for,
        )

    # ---- 预下载 ----

    def prefetch_weights(self, base: str, allow_patterns) -> None:  # noqa: ANN001
        """按白名单预拉取，避免整仓下载把 /kaggle/working 的 20GB 配额写爆。"""
        prefetch_weights(base, allow_patterns, log=self._log)
