"""Base abstractions for image generation providers."""

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ImageTask:
    name: str
    prompt: str
    seed: int = 42
    negative_prompt: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None


@dataclass
class JobSpec:
    model_id: str
    width: int
    height: int
    steps: int
    cfg: float
    negative_prompt: str = ""
    tasks: List[ImageTask] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> Dict[str, Any]:
        """Serialize into a clean JSON-compatible dict for remote workers."""
        resolved_tasks = []
        for task in self.tasks:
            resolved_tasks.append(
                {
                    "name": task.name,
                    "prompt": task.prompt,
                    "negative_prompt": task.negative_prompt or self.negative_prompt,
                    "seed": int(task.seed),
                    "width": int(task.width or self.width),
                    "height": int(task.height or self.height),
                    "steps": int(task.steps or self.steps),
                    "cfg": float(task.cfg if task.cfg is not None else self.cfg),
                }
            )
        return {
            "model_id": self.model_id,
            "defaults": {
                "width": self.width,
                "height": self.height,
                "steps": self.steps,
                "cfg": self.cfg,
                "negative_prompt": self.negative_prompt,
            },
            "tasks": resolved_tasks,
            "extra": self.extra,
        }


class ProviderBase(ABC):
    """Abstract base class for free image generation backends."""

    name: str = "base"

    @abstractmethod
    def check_status(self) -> int:
        """Check authentication and quota status. Returns exit code (0 = ready)."""

    @abstractmethod
    def run_job(
        self,
        spec: JobSpec,
        out_dir: Path,
        workdir: Optional[Path] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """Execute a batch image generation job and download outputs to out_dir."""
