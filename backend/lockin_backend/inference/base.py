"""Contract that every model implementation (mock or the ML agent's) must satisfy."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from ..schemas import InferenceResult


@runtime_checkable
class InferenceModel(Protocol):
    id: str            # "A" | "B" | "C" | "mock"
    simulated: bool    # True ONLY for mocks

    def load(self, device: str) -> None:
        """Allocate weights on `device` ("cuda" or "cpu"). Called once per activation."""

    def infer(self, frame_bgr: np.ndarray) -> InferenceResult:
        """Run on one BGR uint8 frame. Called from a single worker thread."""

    def unload(self) -> None:
        """Release all GPU/CPU memory held by this model."""
