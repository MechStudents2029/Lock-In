"""Typed configuration loaded from YAML."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class ServerCfg(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])


class CameraCfg(BaseModel):
    source: str = "synthetic"
    width: int = 640
    height: int = 480
    fps: int = 30
    loop_file: bool = True


class InferenceCfg(BaseModel):
    device: str = "auto"
    default_model: str = "mock"
    max_fps: float = 30
    ml_src_path: str = "../ml/src"
    ml_adapter_module: str = "lockin_cv.backend_adapter"


class VideoCfg(BaseModel):
    max_fps: float = 15
    jpeg_quality: int = 70
    max_width: int = 640


class HardwareCfg(BaseModel):
    enabled: bool = True
    port: str = "auto"
    baudrate: int = 115200
    ack_timeout_s: float = 0.5
    heartbeat_interval_s: float = 0.5
    link_timeout_s: float = 2.0
    handshake_timeout_s: float = 5.0
    reconnect_interval_s: float = 2.0
    servo_min_deg: int = 0
    servo_max_deg: int = 180
    servo_ids: list[str] = Field(default_factory=lambda: ["pan", "tilt"])
    mock: bool = False


class MonitorCfg(BaseModel):
    interval_s: float = 1.0


class StorageCfg(BaseModel):
    data_dir: str = "data"
    db_file: str = "lockin.sqlite3"
    prediction_log_hz: float = 2.0
    log_predictions: bool = True
    recordings_dir: str = "recordings"

    def resolved_dir(self) -> Path:
        p = Path(self.data_dir)
        return p if p.is_absolute() else BACKEND_ROOT / p


class Settings(BaseModel):
    server: ServerCfg = Field(default_factory=ServerCfg)
    camera: CameraCfg = Field(default_factory=CameraCfg)
    inference: InferenceCfg = Field(default_factory=InferenceCfg)
    video: VideoCfg = Field(default_factory=VideoCfg)
    hardware: HardwareCfg = Field(default_factory=HardwareCfg)
    monitor: MonitorCfg = Field(default_factory=MonitorCfg)
    storage: StorageCfg = Field(default_factory=StorageCfg)


def load_settings(path: str | os.PathLike | None = None) -> Settings:
    """Load settings from `path`, $LOCKIN_BACKEND_CONFIG, or config/default.yaml."""
    p = Path(path or os.environ.get("LOCKIN_BACKEND_CONFIG") or BACKEND_ROOT / "config" / "default.yaml")
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return Settings.model_validate(raw)
