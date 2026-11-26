"""Camera acquisition on its own thread. Only the *latest* frame is kept (no queue),
so slow consumers drop frames instead of accumulating latency."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable

import numpy as np

from .config import CameraCfg
from .schemas import CameraState

log = logging.getLogger(__name__)


@dataclass
class Frame:
    id: int
    ts: float
    image: np.ndarray  # BGR uint8


class CameraSource:
    def __init__(self, cfg: CameraCfg):
        self.cfg = cfg
        self._lock = threading.Lock()
        self._latest: Frame | None = None
        self._next_id = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._error: str | None = None
        self._running = False
        self._fps = 0.0
        self.listeners: list[Callable[[Frame], None]] = []

    @property
    def simulated(self) -> bool:
        return self.cfg.source == "synthetic"

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def latest(self) -> Frame | None:
        with self._lock:
            return self._latest

    def state(self) -> CameraState:
        return CameraState(source=self.cfg.source, simulated=self.simulated, running=self._running,
                           width=self.cfg.width, height=self.cfg.height,
                           capture_fps=round(self._fps, 1), error=self._error)

    def _publish(self, img: np.ndarray) -> None:
        with self._lock:
            self._next_id += 1
            f = Frame(self._next_id, time.time(), img)
            self._latest = f
        for cb in self.listeners:
            try:
                cb(f)
            except Exception:  # listener faults must not kill capture
                log.exception("camera listener failed")

    def _tick_fps(self, last: float) -> float:
        now = time.time()
        inst = 1 / max(now - last, 1e-6)
        self._fps = 0.9 * self._fps + 0.1 * inst if self._fps else inst
        return now

    def _run(self) -> None:
        src = self.cfg.source
        try:
            if src == "synthetic":
                self._run_synthetic()
            else:
                self._run_cv(src)
        except Exception as e:  # noqa: BLE001
            self._error = f"{type(e).__name__}: {e}"
            log.error("camera stopped: %s", self._error)
        finally:
            self._running = False

    def _pace(self, t0: float, n: int) -> None:
        period = 1.0 / max(self.cfg.fps, 1)
        delay = t0 + n * period - time.time()
        if delay > 0:
            self._stop.wait(delay)

    def _run_synthetic(self) -> None:
        import cv2
        w, h = self.cfg.width, self.cfg.height
        self._running, self._error = True, None
        t0, n, last = time.time(), 0, time.time()
        while not self._stop.is_set():
            img = np.full((h, w, 3), 32, np.uint8)
            x = int((0.5 + 0.35 * np.sin(n / 40)) * w)
            cv2.circle(img, (x, h // 2), 30, (0, 200, 255), -1)
            cv2.putText(img, "SYNTHETIC CAMERA (mock)", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            cv2.putText(img, f"frame {n}", (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
            self._publish(img)
            n += 1
            last = self._tick_fps(last)
            self._pace(t0, n)

    def _run_cv(self, src: str) -> None:
        import cv2
        kind, _, arg = src.partition(":")
        if kind == "webcam":
            backend = cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else cv2.CAP_ANY
            cap = cv2.VideoCapture(int(arg or 0), backend)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.cfg.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.cfg.height)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        elif kind == "file":
            cap = cv2.VideoCapture(arg)
        else:
            raise ValueError(f"unknown camera source {src!r}")
        if not cap.isOpened():
            raise RuntimeError(f"cannot open camera source {src!r}")
        self._running, self._error = True, None
        paced = kind == "file"
        t0, n, last = time.time(), 0, time.time()
        try:
            while not self._stop.is_set():
                ok, img = cap.read()
                if not ok:
                    if kind == "file" and self.cfg.loop_file:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    raise RuntimeError("camera read failed / end of file")
                self._publish(img)
                n += 1
                last = self._tick_fps(last)
                if paced:
                    self._pace(t0, n)
        finally:
            cap.release()
