"""Local-only persistence: numeric metrics + model predictions in SQLite.
No images are stored here; camera recording is a separate, explicit, opt-in feature."""
from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
from pathlib import Path

from .config import StorageCfg
from .schemas import FrameResult, RecordingState

SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics(
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, run_id TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL, step INTEGER);
CREATE INDEX IF NOT EXISTS metrics_run ON metrics(run_id, name, ts);
CREATE TABLE IF NOT EXISTS predictions(
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, model_id TEXT NOT NULL, simulated INTEGER NOT NULL,
  activity TEXT, activity_conf REAL, detections TEXT, inference_ms REAL, end_to_end_ms REAL, fps REAL);
CREATE INDEX IF NOT EXISTS predictions_ts ON predictions(ts);
"""


class Storage:
    def __init__(self, cfg: StorageCfg):
        self.cfg = cfg
        self.dir = cfg.resolved_dir()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / cfg.db_file
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(SCHEMA)
        self._last_pred = 0.0

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # metrics ------------------------------------------------------------
    def add_metrics(self, run_id: str, metrics: dict[str, float], step: int | None = None) -> int:
        now = time.time()
        with self._lock, self._db:
            self._db.executemany("INSERT INTO metrics(ts,run_id,name,value,step) VALUES(?,?,?,?,?)",
                                 [(now, run_id, k, float(v), step) for k, v in metrics.items()])
        return len(metrics)

    def get_metrics(self, run_id: str | None = None, name: str | None = None, limit: int = 1000) -> list[dict]:
        q, a = "SELECT ts,run_id,name,value,step FROM metrics WHERE 1=1", []
        if run_id:
            q += " AND run_id=?"; a.append(run_id)
        if name:
            q += " AND name=?"; a.append(name)
        q += " ORDER BY ts DESC LIMIT ?"; a.append(limit)
        with self._lock:
            return [dict(r) for r in self._db.execute(q, a)]

    # predictions --------------------------------------------------------
    def log_prediction(self, fr: FrameResult) -> bool:
        """Rate-limited (cfg.prediction_log_hz). Returns True if a row was written."""
        if not self.cfg.log_predictions or self.cfg.prediction_log_hz <= 0:
            return False
        now = time.time()
        if now - self._last_pred < 1.0 / self.cfg.prediction_log_hz:
            return False
        self._last_pred = now
        dets = json.dumps([d.model_dump() for d in fr.detections])
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO predictions(ts,model_id,simulated,activity,activity_conf,detections,inference_ms,end_to_end_ms,fps)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (now, fr.model_id, int(fr.simulated), fr.activity.label if fr.activity else None,
                 fr.activity.confidence if fr.activity else None, dets, fr.inference_ms, fr.end_to_end_ms, fr.fps))
        return True

    def get_predictions(self, limit: int = 200, include_simulated: bool = True) -> list[dict]:
        q = "SELECT * FROM predictions" + ("" if include_simulated else " WHERE simulated=0") + " ORDER BY ts DESC LIMIT ?"
        with self._lock:
            rows = [dict(r) for r in self._db.execute(q, (limit,))]
        for r in rows:
            r["detections"] = json.loads(r["detections"] or "[]")
            r["simulated"] = bool(r["simulated"])
        return rows

    # deletion -----------------------------------------------------------
    def delete(self, what: str) -> dict[str, int]:
        """what: metrics | predictions | all (DB rows only; recordings have their own delete)."""
        out: dict[str, int] = {}
        with self._lock, self._db:
            if what in ("metrics", "all"):
                out["metrics"] = self._db.execute("DELETE FROM metrics").rowcount
            if what in ("predictions", "all"):
                out["predictions"] = self._db.execute("DELETE FROM predictions").rowcount
        if what == "all":
            with self._lock:
                self._db.execute("VACUUM")
        return out


class Recorder:
    """Explicit, opt-in video recording to local disk. OFF by default; never uploaded."""

    def __init__(self, cfg: StorageCfg):
        self.dir = cfg.resolved_dir() / cfg.recordings_dir
        self._lock = threading.Lock()
        self._writer = None
        self._path: Path | None = None
        self._started = 0.0
        self._frames = 0
        self._dropped = 0
        self._q = None
        self._thread: threading.Thread | None = None

    def state(self) -> RecordingState:
        return RecordingState(active=self._writer is not None, path=str(self._path) if self._path else None,
                              started_ts=self._started or None, frames=self._frames, dropped=self._dropped)

    def start(self, fps: float, size: tuple[int, int]) -> RecordingState:
        import queue
        import cv2
        with self._lock:
            if self._writer is not None:
                return self.state()
            self.dir.mkdir(parents=True, exist_ok=True)
            self._path = self.dir / time.strftime("rec_%Y%m%d_%H%M%S.mp4")
            w = cv2.VideoWriter(str(self._path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
            if not w.isOpened():
                self._path = None
                raise RuntimeError("could not open video writer")
            self._writer, self._started, self._frames, self._dropped = w, time.time(), 0, 0
            self._size = size
            self._q = queue.Queue(maxsize=64)
            self._thread = threading.Thread(target=self._drain, args=(self._q, w), name="recorder", daemon=True)
            self._thread.start()
        return self.state()

    def _drain(self, q, writer) -> None:
        while True:
            img = q.get()
            if img is None:
                break
            writer.write(img)
            self._frames += 1
        writer.release()

    def offer(self, img) -> None:
        """Called from the camera thread; never blocks (drops if the disk is slow)."""
        q = self._q
        if self._writer is None or q is None:
            return
        import cv2
        import queue
        if (img.shape[1], img.shape[0]) != self._size:
            img = cv2.resize(img, self._size)
        try:
            q.put_nowait(img)
        except queue.Full:
            self._dropped += 1

    def stop(self) -> RecordingState:
        with self._lock:
            q, t = self._q, self._thread
            if self._writer is None or q is None:
                return self.state()
            q.put(None)
            self._writer = None
        if t:
            t.join(timeout=10)
        return self.state()

    def list(self) -> list[dict]:
        if not self.dir.exists():
            return []
        return [{"name": p.name, "bytes": p.stat().st_size, "modified": p.stat().st_mtime}
                for p in sorted(self.dir.glob("*.mp4"))]

    def delete(self, name: str | None = None) -> int:
        """Delete one recording by file name, or all when name is None. Refuses while recording."""
        if self._writer is not None:
            raise RuntimeError("stop recording before deleting")
        if not self.dir.exists():
            return 0
        if name is None:
            n = len(list(self.dir.glob("*.mp4")))
            shutil.rmtree(self.dir, ignore_errors=True)
            return n
        target = (self.dir / Path(name).name)  # strip any path components
        if target.suffix == ".mp4" and target.is_file():
            target.unlink()
            return 1
        return 0
