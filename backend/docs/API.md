# Lock-In AI Backend — API contracts (v1)

Base URL `http://127.0.0.1:8000/api/v1`. Interactive docs: `/docs`. Machine-readable WebSocket
envelope schema: `GET /api/v1/schemas`. Source of truth for all shapes: `lockin_backend/schemas.py`.
Within v1 only additive changes are made; breaking changes move to `/api/v2`.

## REST

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /status` | everything at once (models, hardware, camera, system, training, latest result, stats) |
| `GET /frame.jpg` | latest camera frame (`X-Frame-Id` header) |
| `GET /detections/latest` | latest `FrameResult` (boxes, confidence, activity, latency, fps) |
| `GET /models` · `POST /models/select {"model_id":"A"}` | list / switch. `mock`, `A`, `B`, `C`. 202 = switching asynchronously (watch `models` WS message); 404 unknown, 409 unavailable |
| `GET /system` | CPU, RAM, GPU util/memory/temp |
| `GET /hardware` | Arduino status |
| `POST /hardware/servo {"id":"pan","angle":90,"source":"manual\|auto"}` | acknowledged servo move (422 out of range, 409 e-stop/override, 503 not connected) |
| `POST /hardware/led {"on":true}` · `POST /hardware/buzzer {"on":true,"duration_ms":200}` | optional outputs |
| `POST /hardware/stop` | hardware stop: latched locally first, then sent to device; blocks all output commands |
| `POST /hardware/reset-stop` | clear the latch |
| `POST /hardware/override {"enabled":true}` | manual override: `source:"auto"` commands are rejected |
| `POST /hardware/reconnect` | skip the reconnect wait |
| `GET/POST /training/progress` | the ML pipeline POSTs `TrainingProgress`; numeric `metrics` are stored in SQLite and broadcast |
| `GET /metrics?run_id=&name=` · `GET /predictions?limit=` | stored numbers (never images) |
| `POST /recording/start` · `POST /recording/stop` · `GET /recording` | explicit, opt-in local video recording (off by default) |
| `GET /recordings` · `DELETE /recordings[?name=]` | list / delete recordings |
| `DELETE /data/{metrics\|predictions\|all}` | erase stored data (`all` also deletes recordings) |

## WebSockets

### `/ws/telemetry` — JSON text frames
Every message is an envelope `{"v":1,"type":<t>,"ts":<unix>,"data":{...}}`. On connect the server sends a
snapshot (models, hardware, camera, recording, plus system/training/frame_result if known), then live updates.
Types: `frame_result`, `system`, `hardware`, `training`, `models`, `recording`, `camera`, `event`.
Client may send `{"subscribe":["frame_result","hardware"]}` to filter (empty/invalid = everything).
Slow clients lose the oldest messages, never stall the backend.

`frame_result.data`: `frame_id, capture_ts, model_id, simulated, detections[{label,confidence,bbox[x1,y1,x2,y2] normalised 0..1}],
activity{label,confidence}|null, inference_ms, end_to_end_ms, fps, device, features?`.
**`simulated: true` means the output came from the mock, not a real model — the UI must show that.**

### `/ws/video` — binary frames
Each message = 4-byte big-endian `frame_id` + JPEG bytes (match `frame_id` against `frame_result.frame_id`
to align overlays). Frames are encoded only while a client is connected; max rate `video.max_fps`.

## ML adapter contract (for the ML agent)

The backend imports `inference.ml_adapter_module` (default `lockin_cv.backend_adapter`, found via
`inference.ml_src_path` = `../ml/src`) lazily, only when models are listed/selected. It must expose:

```python
def available_models() -> set[str]            # optional; subset of {"A","B","C"} that are ready
def create_model(model_id: str, device: str) -> InferenceModel
```

`InferenceModel` (see `inference/base.py`): attributes `id: str`, `simulated: bool` (must be `False` for real
models); `load(device)` allocates weights (`"cuda"`/`"cpu"`); `infer(frame_bgr: np.ndarray) -> InferenceResult`
(`detections`, optional `activity`, optional numeric `features`); `unload()` frees everything. `infer` is called
from one worker thread; the backend never calls it concurrently. Until the adapter exists those models appear
as `available:false` with a reason — they are never faked.

Training: POST `TrainingProgress` to `/training/progress` (`run_id`, `epoch`, `total_epochs`, `metrics`, `state`).

## Arduino serial protocol v1 (for the firmware agent)

ASCII, newline-terminated, 115200 8N1. Full text in `lockin_backend/hardware/protocol.py`.

```
host → dev   #<seq> <CMD> [args]            seq 1..65535
dev  → host  @<seq> OK [k=v ...]  |  @<seq> ERR <code>
dev  → host  ! <text>                       unsolicited, e.g. "! READY fw=1.0.0"
```

| CMD | Reply | Notes |
|---|---|---|
| `PING` | `OK fw=<ver>` | heartbeat every 500 ms; also the connect handshake |
| `SERVO <id> <deg>` | `OK` / `ERR RANGE\|BADARG\|STOPPED` | ids `pan`,`tilt`; 0..180 |
| `LED <0\|1>` | `OK` | |
| `BUZZ <ms>` | `OK` | 0 = off; firmware should cap duration |
| `STOP` | `OK` | buzzer+LED off, motion halted, outputs latched off until `RESUME` |
| `RESUME` | `OK` | clear latch |
| `STATUS` | `OK servo.pan=90 servo.tilt=90 led=0 buzz=0 stop=0` | |

**Firmware watchdog (required):** if no valid request arrives for 2000 ms, act as if `STOP` was received.
The Arduino resets when the port opens, so the backend retries `PING` for up to `handshake_timeout_s` (5 s).

Host behaviour: no reply within `ack_timeout_s` ⇒ the command is reported as failed (never assumed to have
worked); no valid line for `link_timeout_s` ⇒ link declared lost, servo/LED/buzzer state becomes `null`
(unknown), commands are refused with 503, and discovery/reconnect starts. A latched hardware stop survives
reconnects and is re-sent to the new connection. The backend never moves servos automatically on connect.

## Status codes
422 invalid value · 409 conflicting state (e-stop latched, override, model unavailable) · 503 dependency
unavailable (Arduino/camera).
