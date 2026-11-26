"""Inference worker. Pulls the *latest* camera frame (older ones are dropped), runs the
active model, and publishes FrameResult. Model switching happens on the same worker
thread between frames, so a slow load never blocks the camera or the API."""
from __future__ import annotations

import gc
import logging
import threading
import time
from collections import deque
from typing import Callable

from ..camera import CameraSource, Frame
from ..config import InferenceCfg
from ..schemas import FrameResult, ModelsState
from .base import InferenceModel
from .registry import ModelRegistry

log = logging.getLogger(__name__)


def resolve_device(pref: str) -> str:
    """'auto' -> cuda if torch+CUDA are importable, else cpu. Never imports torch unless needed."""
    if pref in ("cpu", "cuda"):
        return pref
    try:
        import torch  # type: ignore
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


def release_gpu_memory() -> None:
    gc.collect()
    import sys
    torch = sys.modules.get("torch")  # only if some model already imported it
    if torch is not None:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass


class InferenceEngine:
    def __init__(self, cfg: InferenceCfg, camera: CameraSource, registry: ModelRegistry,
                 on_result: Callable[[FrameResult], None], on_models: Callable[[ModelsState], None]):
        self.cfg, self.camera, self.registry = cfg, camera, registry
        self._on_result, self._on_models = on_result, on_models
        self.device = resolve_device(cfg.device)
        self._model: InferenceModel | None = None
        self._active: str | None = None
        self._loading: str | None = None
        self._last_error: str | None = None
        self._pending: str | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._times: deque[float] = deque(maxlen=60)
        self._lat: deque[float] = deque(maxlen=120)
        self.latest: FrameResult | None = None
        self.dropped_frames = 0
        self._last_id = 0
        self._wake = threading.Event()

    # -- control ---------------------------------------------------------
    def start(self) -> None:
        self.request_model(self.cfg.default_model)
        self._thread = threading.Thread(target=self._run, name="inference", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=10)
        self._unload()

    def request_model(self, model_id: str) -> None:
        """Asynchronous: validated and loaded by the worker. Raises KeyError for unknown ids."""
        if model_id not in {m.id for m in self.registry.list(self._active)}:
            raise KeyError(f"unknown model {model_id!r}")
        with self._lock:
            self._pending = model_id
        self._wake.set()

    def state(self) -> ModelsState:
        return ModelsState(active=self._active, loading=self._loading or self._pending, last_error=self._last_error,
                           models=self.registry.list(self._active))

    def stats(self) -> dict[str, float]:
        lat = sorted(self._lat)
        p95 = lat[int(0.95 * (len(lat) - 1))] if lat else 0.0
        return {"fps": self._fps(), "inference_ms_p95": p95, "dropped_frames": self.dropped_frames}

    def _fps(self) -> float:
        t = self._times
        return round((len(t) - 1) / (t[-1] - t[0]), 1) if len(t) > 1 and t[-1] > t[0] else 0.0

    # -- internals -------------------------------------------------------
    def _unload(self) -> None:
        m, self._model = self._model, None
        if m is not None:
            try:
                m.unload()
            except Exception:  # noqa: BLE001
                log.exception("model unload failed")
        del m
        release_gpu_memory()

    def _switch(self, mid: str) -> None:
        if mid == self._active and self._model is not None:
            return
        self._loading, self._last_error = mid, None
        self._on_models(self.state())
        self._unload()  # free the old model BEFORE allocating the new one (8 GB VRAM budget)
        self._active = None
        try:
            model = self.registry.create(mid, self.device)
            model.load(self.device)
            self._model, self._active = model, mid
            log.info("model %s active on %s", mid, self.device)
        except Exception as e:  # noqa: BLE001
            self._last_error = f"{type(e).__name__}: {e}"
            log.error("failed to load model %s: %s", mid, self._last_error)
            release_gpu_memory()
            # fall back to the mock so the pipeline keeps running; it is flagged simulated
            try:
                mock = self.registry.create("mock", "cpu")
                mock.load("cpu")
                self._model, self._active = mock, "mock"
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._loading = None
            self._on_models(self.state())

    def _run(self) -> None:
        min_period = 1.0 / max(self.cfg.max_fps, 1)
        while not self._stop.is_set():
            with self._lock:
                pending, self._pending = self._pending, None
            if pending:
                self._switch(pending)
            frame = self.camera.latest()
            if frame is None or frame.id == self._last_id or self._model is None:
                self._wake.wait(0.005)
                self._wake.clear()
                continue
            self.dropped_frames += max(frame.id - self._last_id - 1, 0) if self._last_id else 0
            self._last_id = frame.id
            t0 = time.perf_counter()
            try:
                res = self._model.infer(frame.image)
            except Exception as e:  # noqa: BLE001
                self._last_error = f"inference error: {type(e).__name__}: {e}"
                log.exception("inference failed")
                self._wake.wait(0.1)
                continue
            inf_ms = (time.perf_counter() - t0) * 1000
            now = time.time()
            self._times.append(now)
            self._lat.append(inf_ms)
            fr = FrameResult(frame_id=frame.id, capture_ts=frame.ts, model_id=self._model.id,
                             simulated=bool(self._model.simulated), detections=res.detections,
                             activity=res.activity, inference_ms=round(inf_ms, 2),
                             end_to_end_ms=round((now - frame.ts) * 1000, 2), fps=self._fps(),
                             device=self.device, features=res.features)
            self.latest = fr
            self._on_result(fr)
            spare = min_period - (time.perf_counter() - t0)
            if spare > 0:
                self._stop.wait(spare)
