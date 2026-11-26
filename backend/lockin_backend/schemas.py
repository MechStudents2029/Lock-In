"""Versioned wire schemas (API v1). This module is the interface contract with the
frontend, ML and firmware agents. Additive changes only within v1; breaking changes
bump API_VERSION and the URL prefix."""
from __future__ import annotations

import time
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from . import API_VERSION

# ---------------------------------------------------------------- inference ---


class Detection(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    # Normalised corner coords in [0,1] relative to the frame: x1,y1,x2,y2
    bbox: tuple[float, float, float, float]


class Activity(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class InferenceResult(BaseModel):
    """What an InferenceModel returns for one frame."""
    detections: list[Detection] = Field(default_factory=list)
    activity: Activity | None = None
    features: dict[str, float | None] | None = None  # optional numeric features for debugging


class FrameResult(BaseModel):
    frame_id: int
    capture_ts: float
    model_id: str
    simulated: bool          # True => NOT a real model prediction (mock)
    detections: list[Detection]
    activity: Activity | None
    inference_ms: float
    end_to_end_ms: float     # capture -> result ready
    fps: float
    device: str
    features: dict[str, float | None] | None = None


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    simulated: bool
    available: bool
    unavailable_reason: str | None = None
    loaded: bool = False


class ModelsState(BaseModel):
    active: str | None
    loading: str | None = None
    last_error: str | None = None
    models: list[ModelInfo]


class SelectModelRequest(BaseModel):
    model_id: str


# ---------------------------------------------------------------- hardware ---


class HardwareStatus(BaseModel):
    enabled: bool
    connected: bool
    simulated: bool = False
    port: str | None = None
    state: Literal["disabled", "searching", "connecting", "connected", "lost"] = "searching"
    estop: bool = False              # hardware stop latched
    manual_override: bool = False    # auto commands suppressed
    servos: dict[str, int | None] = Field(default_factory=dict)  # last acknowledged angles
    led: bool | None = None
    buzzer: bool | None = None
    last_ack_ts: float | None = None
    last_error: str | None = None
    firmware: str | None = None


class ServoRequest(BaseModel):
    id: str = "pan"
    angle: int
    source: Literal["manual", "auto"] = "manual"


class LedRequest(BaseModel):
    on: bool


class BuzzerRequest(BaseModel):
    on: bool = True
    duration_ms: int | None = Field(default=None, ge=1, le=5000)


class OverrideRequest(BaseModel):
    enabled: bool


class CommandResult(BaseModel):
    ok: bool
    command: str
    detail: str | None = None
    status: HardwareStatus


# ---------------------------------------------------------------- training ---


class TrainingProgress(BaseModel):
    """Posted by the ML pipeline via POST /api/v1/training/progress."""
    run_id: str
    model_id: str | None = None
    state: Literal["idle", "running", "completed", "failed", "cancelled"] = "running"
    epoch: int = 0
    total_epochs: int | None = None
    metrics: dict[str, float] = Field(default_factory=dict)  # e.g. {"loss":0.3,"val_acc":0.9}
    message: str | None = None
    updated_ts: float = Field(default_factory=time.time)


# ------------------------------------------------------------------ system ---


class SystemStats(BaseModel):
    cpu_percent: float
    ram_percent: float
    gpu_available: bool
    gpu_name: str | None = None
    gpu_util_percent: float | None = None
    gpu_mem_used_mb: float | None = None
    gpu_mem_total_mb: float | None = None
    gpu_temp_c: float | None = None


class RecordingState(BaseModel):
    active: bool
    path: str | None = None
    started_ts: float | None = None
    frames: int = 0
    dropped: int = 0


class CameraState(BaseModel):
    source: str
    simulated: bool
    running: bool
    width: int
    height: int
    capture_fps: float
    error: str | None = None


# ---------------------------------------------------------- WS envelopes ---


class _Env(BaseModel):
    v: int = API_VERSION
    ts: float = Field(default_factory=time.time)


class FrameEnvelope(_Env):
    type: Literal["frame_result"] = "frame_result"
    data: FrameResult


class SystemEnvelope(_Env):
    type: Literal["system"] = "system"
    data: SystemStats


class HardwareEnvelope(_Env):
    type: Literal["hardware"] = "hardware"
    data: HardwareStatus


class TrainingEnvelope(_Env):
    type: Literal["training"] = "training"
    data: TrainingProgress


class ModelsEnvelope(_Env):
    type: Literal["models"] = "models"
    data: ModelsState


class RecordingEnvelope(_Env):
    type: Literal["recording"] = "recording"
    data: RecordingState


class CameraEnvelope(_Env):
    type: Literal["camera"] = "camera"
    data: CameraState


class EventEnvelope(_Env):
    type: Literal["event"] = "event"
    data: dict[str, Any]   # {"level": "info|warning|error", "message": str}


Envelope = Annotated[
    FrameEnvelope | SystemEnvelope | HardwareEnvelope | TrainingEnvelope | ModelsEnvelope
    | RecordingEnvelope | CameraEnvelope | EventEnvelope,
    Field(discriminator="type"),
]

MESSAGE_TYPES = ["frame_result", "system", "hardware", "training", "models", "recording", "camera", "event"]


def envelope_json(env: _Env) -> str:
    return env.model_dump_json()
