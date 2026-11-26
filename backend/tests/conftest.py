import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from lockin_backend.config import Settings


@pytest.fixture
def settings(tmp_path):
    s = Settings()
    s.storage.data_dir = str(tmp_path / "data")
    s.camera.fps = 60
    s.hardware.heartbeat_interval_s = 0.05
    s.hardware.ack_timeout_s = 0.1
    s.hardware.link_timeout_s = 0.4
    s.hardware.reconnect_interval_s = 0.1
    s.hardware.handshake_timeout_s = 1.0
    s.storage.prediction_log_hz = 1000
    return s
