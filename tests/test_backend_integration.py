"""Actual FastAPI entry point with synthetic camera, mock model and fake serial."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from starlette.websockets import WebSocketDisconnect

from backend.lockin_backend.app import Runtime, create_app
from backend.lockin_backend.config import load_settings
from backend.lockin_backend.hardware.transport import FakeArduino
from backend.lockin_backend.schemas import Envelope


ROOT = Path(__file__).resolve().parents[1]
API = "/api/v1"


def test_backend_startup_telemetry_commands_and_shutdown(tmp_path):
    settings = load_settings(ROOT / "integration" / "local-mock.yaml")
    assert settings.server.host == "127.0.0.1"
    assert not settings.hardware.enabled
    assert not settings.storage.log_predictions
    settings.storage.data_dir = str(tmp_path)
    settings.hardware.enabled = True
    arduino = FakeArduino()
    runtime = Runtime(settings, hardware_factory=lambda: arduino)
    with TestClient(create_app(settings, runtime)) as client:
        assert client.get(f"{API}/health").json()["api_version"] == 1
        assert client.get(f"{API}/recording").json()["active"] is False
        assert client.post(f"{API}/models/select", json={"model_id": "invalid"}).status_code == 404
        assert client.post(f"{API}/hardware/servo", json={"angle": 181}).status_code == 422
        assert client.post(
            f"{API}/hardware/servo", json={"id": "pan\nSTOP", "angle": 30}
        ).status_code == 422

        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = client.get(f"{API}/status").json()
            if status["latest"] and status["hardware"]["connected"]:
                break
            time.sleep(0.02)
        else:
            raise AssertionError("Synthetic camera, mock inference or fake Arduino failed to start")

        assert status["latest"]["simulated"]
        assert status["camera"]["simulated"]
        assert status["hardware"]["simulated"]
        assert not any(" SERVO " in line for line in arduino.log)
        with client.websocket_connect(
            f"{API}/ws/telemetry", headers={"Origin": "http://127.0.0.1:5173"}
        ) as socket:
            adapter = TypeAdapter(Envelope)
            types = set()
            for _ in range(7):
                envelope = adapter.validate_python(socket.receive_json())
                types.add(envelope.type)
                if envelope.type == "frame_result":
                    assert envelope.data.simulated
                    break
        assert {"models", "hardware", "camera", "recording", "frame_result"} <= types
        response = client.post(f"{API}/hardware/stop")
        assert response.status_code == 200, response.text
        assert response.json()["status"]["estop"]
        assert arduino.stopped
        assert client.get(f"{API}/recordings").json() == []

    assert arduino.closed
    assert not runtime.camera.state().running


@pytest.mark.xfail(reason="INT-03: backend WebSocket routes need an explicit origin allowlist")
def test_telemetry_rejects_unlisted_browser_origin(tmp_path):
    settings = load_settings(ROOT / "integration" / "local-mock.yaml")
    settings.storage.data_dir = str(tmp_path)
    with TestClient(create_app(settings)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"{API}/ws/telemetry", headers={"Origin": "https://example.invalid"}
            ):
                pass
