"""MOCK model. Outputs are synthetic and flagged simulated=True end-to-end.
They are NOT predictions of any real model."""
from __future__ import annotations

import math
import time

import numpy as np

from ..schemas import Activity, Detection, InferenceResult


class MockModel:
    id = "mock"
    simulated = True

    def __init__(self, work_ms: float = 5.0):
        self.work_ms = work_ms

    def load(self, device: str) -> None:
        pass

    def unload(self) -> None:
        pass

    def infer(self, frame_bgr: np.ndarray) -> InferenceResult:
        time.sleep(self.work_ms / 1000)
        cx = 0.5 + 0.3 * math.sin(time.time())
        det = Detection(label="mock_object", confidence=0.5, bbox=(cx - 0.05, 0.4, cx + 0.05, 0.6))
        return InferenceResult(detections=[det], activity=Activity(label="mock_activity", confidence=0.5))
