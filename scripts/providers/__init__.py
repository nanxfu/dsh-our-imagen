"""Free image generation providers."""

from .base import ImageTask, JobSpec, ProviderBase
from .kaggle import KaggleProvider

PROVIDERS = {
    "kaggle": KaggleProvider,
}

__all__ = ["ImageTask", "JobSpec", "ProviderBase", "KaggleProvider", "PROVIDERS"]
