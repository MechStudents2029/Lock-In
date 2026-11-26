# Lock-In AI Backend

FastAPI service that connects camera, inference (Models A/B/C), Arduino and the React dashboard.
Everything runs locally and free; nothing is uploaded anywhere. Camera footage is never recorded unless
you explicitly start a recording.

## Start

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m lockin_backend            # http://127.0.0.1:8000  (docs at /docs)
```

Out of the box it runs on a **synthetic camera + mock model + (no Arduino)**. Everything produced by
mock parts is flagged `simulated: true` in the API; mock output is never real model output.

Switch things on in `config/default.yaml` (or point `LOCKIN_BACKEND_CONFIG` at your own copy):

| Goal | Setting |
|---|---|
| Real webcam | `camera.source: "webcam:0"` (or `"file:C:/clip.mp4"`) |
| Arduino | plug in via USB; `hardware.port: auto` discovers it (or set `COM5`) |
| Develop without Arduino | `hardware.mock: true` (in-process simulated device, flagged `simulated`) |
| Real models | install ML deps (below); the ML agent's adapter provides A/B/C |

### Real inference (optional)

```powershell
.venv\Scripts\python -m pip install torch==2.5.1 torchvision --index-url https://download.pytorch.org/whl/cu121
.venv\Scripts\python -m pip install -r requirements-ml.txt
```

Models are only imported/loaded when selected, and the previous model is unloaded (and the CUDA cache
emptied) *before* the next one is allocated, so only one model ever occupies the 8 GB of VRAM.
If a model fails to load, the backend reports `last_error` and falls back to the flagged mock.

## Tests

```powershell
.venv\Scripts\python -m pytest -q
```

Hardware tests run against an in-process simulated Arduino; no hardware or GPU needed.

## Architecture

```
camera thread ──latest frame only──► inference thread ──FrameResult──► Bus ──► /ws/telemetry (bounded, drop-oldest)
      │                                   (model switch here)             └──► SQLite (rate-limited)
      ├──► Recorder queue (opt-in, bounded)
      └──► video loop ──JPEG (only if a client is connected)──► /ws/video
hardware supervisor (asyncio) + reader thread ◄──► Arduino over USB serial
system monitor (psutil + NVML/nvidia-smi) ──► Bus
```

Slow stages never block fast ones: the camera keeps only the newest frame (older frames are dropped and
counted), WebSocket subscribers have tiny bounded queues, recording drops frames if the disk is slow,
and a hung serial device only affects hardware commands.

## Layout

`lockin_backend/` — `app.py` (routes/WS), `schemas.py` (contract), `camera.py`, `inference/`
(`base.py` interface, `registry.py`, `engine.py`, `mock.py`), `hardware/` (`protocol.py`, `transport.py`,
`service.py`), `monitor.py`, `storage.py`, `bus.py`, `config.py`. See `docs/API.md` for the contracts.
