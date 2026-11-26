"""FastAPI application: wiring, REST routes and WebSocket streams (API v1)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import struct
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import API_VERSION, __version__
from . import schemas as S
from .bus import Bus
from .camera import CameraSource, Frame
from .config import Settings, load_settings
from .hardware.service import HardwareError, HardwareService
from .inference.engine import InferenceEngine
from .inference.registry import ModelRegistry
from .monitor import SystemMonitor
from .storage import Recorder, Storage

log = logging.getLogger(__name__)
P = f"/api/v{API_VERSION}"


class Runtime:
    """All long-lived services. Created in lifespan; also constructed directly by tests."""

    def __init__(self, settings: Settings, registry: ModelRegistry | None = None, hardware_factory=None,
                 start_camera: bool = True):
        self.settings = settings
        self.bus = Bus()          # JSON envelopes (telemetry)
        self.video_bus = Bus()    # binary JPEG frames
        self.camera = CameraSource(settings.camera)
        self.start_camera = start_camera
        self.storage = Storage(settings.storage)
        self.recorder = Recorder(settings.storage)
        self.monitor = SystemMonitor()
        self.registry = registry or ModelRegistry(settings.inference)
        self.engine = InferenceEngine(settings.inference, self.camera, self.registry,
                                      on_result=self._on_result, on_models=self._on_models)
        self.hardware = HardwareService(settings.hardware, on_status=self._on_hw, transport_factory=hardware_factory)
        self.training: S.TrainingProgress | None = None
        self.system: S.SystemStats | None = None
        self._tasks: list[asyncio.Task] = []

    # -- publishers (callable from any thread) --------------------------
    def _emit(self, env: S._Env, threadsafe: bool = True) -> None:
        (self.bus.publish_threadsafe if threadsafe else self.bus.publish)(env.type, env.model_dump_json())

    def _on_result(self, fr: S.FrameResult) -> None:
        self._emit(S.FrameEnvelope(data=fr))
        self.storage.log_prediction(fr)

    def _on_models(self, st: S.ModelsState) -> None:
        self._emit(S.ModelsEnvelope(data=st))

    def _on_hw(self, st: S.HardwareStatus) -> None:
        self._emit(S.HardwareEnvelope(data=st), threadsafe=False)

    # -- lifecycle -----------------------------------------------------
    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        self.bus.bind_loop(loop)
        self.video_bus.bind_loop(loop)
        self.camera.listeners.append(lambda f: self.recorder.offer(f.image))
        if self.start_camera:
            self.camera.start()
        self.engine.start()
        await self.hardware.start()
        self._tasks = [asyncio.create_task(self._system_loop()), asyncio.create_task(self._video_loop())]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.hardware.stop()
        await asyncio.to_thread(self.engine.stop)
        self.recorder.stop()
        self.camera.stop()
        self.storage.close()

    async def _system_loop(self) -> None:
        iv = self.settings.monitor.interval_s
        while True:
            self.system = await asyncio.to_thread(self.monitor.sample)
            self._emit(S.SystemEnvelope(data=self.system), threadsafe=False)
            self._emit(S.CameraEnvelope(data=self.camera.state()), threadsafe=False)
            await asyncio.sleep(iv)

    async def _video_loop(self) -> None:
        import cv2
        cfg = self.settings.video
        period, last_id = 1.0 / max(cfg.max_fps, 1), 0
        while True:
            await asyncio.sleep(period)
            if self.video_bus.subscriber_count == 0:
                continue  # encode only when somebody is watching
            f = self.camera.latest()
            if f is None or f.id == last_id:
                continue
            last_id = f.id
            blob = await asyncio.to_thread(self._encode, f, cfg, cv2)
            self.video_bus.publish("video", blob)

    @staticmethod
    def _encode(f: Frame, cfg, cv2) -> bytes:
        img = f.image
        if img.shape[1] > cfg.max_width:
            s = cfg.max_width / img.shape[1]
            img = cv2.resize(img, (cfg.max_width, int(img.shape[0] * s)))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, cfg.jpeg_quality])
        return struct.pack(">I", f.id) + buf.tobytes() if ok else b""

    def snapshot(self) -> list[S._Env]:
        out: list[S._Env] = [S.ModelsEnvelope(data=self.engine.state()),
                             S.HardwareEnvelope(data=self.hardware.status),
                             S.CameraEnvelope(data=self.camera.state()),
                             S.RecordingEnvelope(data=self.recorder.state())]
        if self.system:
            out.append(S.SystemEnvelope(data=self.system))
        if self.training:
            out.append(S.TrainingEnvelope(data=self.training))
        if self.engine.latest:
            out.append(S.FrameEnvelope(data=self.engine.latest))
        return out


def create_app(settings: Settings | None = None, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or (runtime.settings if runtime else load_settings())
    rt = runtime or Runtime(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await rt.start()
        yield
        await rt.stop()

    app = FastAPI(title="Lock-In AI Backend", version=__version__, lifespan=lifespan)
    app.state.rt = rt
    app.add_middleware(CORSMiddleware, allow_origins=settings.server.cors_origins, allow_methods=["*"],
                       allow_headers=["*"])

    # ------------------------------------------------------------ general
    @app.get(f"{P}/health")
    def health():
        return {"ok": True, "api_version": API_VERSION, "backend_version": __version__, "ts": time.time()}

    @app.get(f"{P}/status")
    def status():
        eng = rt.engine
        return {"api_version": API_VERSION, "models": eng.state(), "hardware": rt.hardware.status,
                "camera": rt.camera.state(), "system": rt.system, "training": rt.training,
                "recording": rt.recorder.state(), "latest": eng.latest, "stats": eng.stats(),
                "device": eng.device}

    @app.get(f"{P}/schemas")
    def schemas():
        """JSON Schema for every WebSocket envelope; the frontend can codegen types from this."""
        from pydantic import TypeAdapter
        return TypeAdapter(S.Envelope).json_schema()

    @app.get(f"{P}/system", response_model=S.SystemStats)
    def system():
        return rt.system or rt.monitor.sample()

    # ------------------------------------------------------------ camera / frames
    @app.get(f"{P}/camera", response_model=S.CameraState)
    def camera():
        return rt.camera.state()

    @app.get(f"{P}/frame.jpg")
    def frame_jpg():
        import cv2
        f = rt.camera.latest()
        if f is None:
            raise HTTPException(503, "no frame available yet")
        ok, buf = cv2.imencode(".jpg", f.image, [cv2.IMWRITE_JPEG_QUALITY, settings.video.jpeg_quality])
        return Response(buf.tobytes(), media_type="image/jpeg", headers={"X-Frame-Id": str(f.id)})

    @app.get(f"{P}/detections/latest", response_model=S.FrameResult | None)
    def latest():
        return rt.engine.latest

    # ------------------------------------------------------------ models
    @app.get(f"{P}/models", response_model=S.ModelsState)
    def models():
        return rt.engine.state()

    @app.post(f"{P}/models/select", status_code=202, response_model=S.ModelsState)
    def select_model(req: S.SelectModelRequest):
        info = {m.id: m for m in rt.registry.list(rt.engine.state().active)}
        if req.model_id not in info:
            raise HTTPException(404, f"unknown model {req.model_id!r}")
        if not info[req.model_id].available:
            raise HTTPException(409, info[req.model_id].unavailable_reason or "model unavailable")
        rt.engine.request_model(req.model_id)
        return rt.engine.state()

    # ------------------------------------------------------------ hardware
    def hw_call(coro_fn):
        async def run(*a, **k):
            try:
                return await coro_fn(*a, **k)
            except ValueError as e:
                raise HTTPException(422, str(e))
            except HardwareError as e:
                raise HTTPException(503 if "not connected" in str(e) or "disabled" in str(e) else 409, str(e))
        return run

    @app.get(f"{P}/hardware", response_model=S.HardwareStatus)
    def hw_status():
        return rt.hardware.status

    @app.post(f"{P}/hardware/servo", response_model=S.CommandResult)
    async def hw_servo(req: S.ServoRequest):
        return await hw_call(rt.hardware.set_servo)(req.id, req.angle, req.source)

    @app.post(f"{P}/hardware/led", response_model=S.CommandResult)
    async def hw_led(req: S.LedRequest):
        return await hw_call(rt.hardware.set_led)(req.on)

    @app.post(f"{P}/hardware/buzzer", response_model=S.CommandResult)
    async def hw_buzzer(req: S.BuzzerRequest):
        return await hw_call(rt.hardware.set_buzzer)(req.on, req.duration_ms)

    @app.post(f"{P}/hardware/stop", response_model=S.CommandResult)
    async def hw_stop():
        return await hw_call(rt.hardware.stop_hardware)()

    @app.post(f"{P}/hardware/reset-stop", response_model=S.CommandResult)
    async def hw_reset():
        return await hw_call(rt.hardware.reset_stop)()

    @app.post(f"{P}/hardware/override", response_model=S.HardwareStatus)
    def hw_override(req: S.OverrideRequest):
        return rt.hardware.set_override(req.enabled)

    @app.post(f"{P}/hardware/reconnect", status_code=202)
    def hw_reconnect():
        rt.hardware.request_reconnect()
        return {"ok": True}

    # ------------------------------------------------------------ training + metrics
    @app.get(f"{P}/training/progress", response_model=S.TrainingProgress | None)
    def training_get():
        return rt.training

    @app.post(f"{P}/training/progress", response_model=S.TrainingProgress)
    def training_post(p: S.TrainingProgress):
        """Called by the ML pipeline. Numeric metrics are persisted locally."""
        rt.training = p
        if p.metrics:
            rt.storage.add_metrics(p.run_id, p.metrics, step=p.epoch)
        rt.bus.publish("training", S.TrainingEnvelope(data=p).model_dump_json())
        return p

    @app.get(f"{P}/metrics")
    def metrics(run_id: str | None = None, name: str | None = None, limit: int = Query(1000, le=10000)):
        return rt.storage.get_metrics(run_id, name, limit)

    @app.get(f"{P}/predictions")
    def predictions(limit: int = Query(200, le=5000), include_simulated: bool = True):
        return rt.storage.get_predictions(limit, include_simulated)

    # ------------------------------------------------------------ recording + deletion
    @app.get(f"{P}/recording", response_model=S.RecordingState)
    def rec_state():
        return rt.recorder.state()

    @app.post(f"{P}/recording/start", response_model=S.RecordingState)
    def rec_start():
        """Explicit opt-in. Footage stays on local disk under data/recordings/."""
        cam = rt.camera.latest()
        if cam is None:
            raise HTTPException(503, "camera has no frames")
        h, w = cam.image.shape[:2]
        try:
            st = rt.recorder.start(float(settings.camera.fps), (w, h))
        except RuntimeError as e:
            raise HTTPException(500, str(e))
        rt.bus.publish("recording", S.RecordingEnvelope(data=st).model_dump_json())
        return st

    @app.post(f"{P}/recording/stop", response_model=S.RecordingState)
    def rec_stop():
        st = rt.recorder.stop()
        rt.bus.publish("recording", S.RecordingEnvelope(data=st).model_dump_json())
        return st

    @app.get(f"{P}/recordings")
    def rec_list():
        return rt.recorder.list()

    @app.delete(f"{P}/recordings")
    def rec_delete(name: str | None = None):
        try:
            return {"deleted": rt.recorder.delete(name)}
        except RuntimeError as e:
            raise HTTPException(409, str(e))

    @app.delete(f"{P}/data/{{what}}")
    def data_delete(what: str):
        """what = metrics | predictions | all  (all also deletes every recording)."""
        if what not in ("metrics", "predictions", "all"):
            raise HTTPException(404, "what must be metrics|predictions|all")
        out = rt.storage.delete(what)
        if what == "all":
            with contextlib.suppress(RuntimeError):
                out["recordings"] = rt.recorder.delete(None)
        return out

    # ------------------------------------------------------------ websockets
    @app.websocket(f"{P}/ws/telemetry")
    async def ws_telemetry(ws: WebSocket):
        """JSON envelopes. Optional client message: {"subscribe": ["frame_result", "hardware", ...]}."""
        await ws.accept()
        sub = rt.bus.subscribe(maxsize=64)
        try:
            for env in rt.snapshot():
                await ws.send_text(env.model_dump_json())

            async def reader():
                while True:
                    msg = await ws.receive_json()
                    if isinstance(msg, dict) and isinstance(msg.get("subscribe"), list):
                        sub.types = set(msg["subscribe"]) & set(S.MESSAGE_TYPES) or None

            rtask = asyncio.create_task(reader())
            try:
                while True:
                    getter = asyncio.create_task(sub.get())
                    done, _ = await asyncio.wait({getter, rtask}, return_when=asyncio.FIRST_COMPLETED)
                    if rtask in done:
                        getter.cancel()
                        rtask.result()  # raises WebSocketDisconnect
                    else:
                        await ws.send_text(getter.result())
            finally:
                rtask.cancel()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            rt.bus.unsubscribe(sub)

    @app.websocket(f"{P}/ws/video")
    async def ws_video(ws: WebSocket):
        """Binary messages: 4-byte big-endian frame_id followed by a JPEG."""
        await ws.accept()
        sub = rt.video_bus.subscribe(maxsize=2)  # tiny: always show the freshest frame
        try:
            while True:
                await ws.send_bytes(await sub.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            rt.video_bus.unsubscribe(sub)

    return app
