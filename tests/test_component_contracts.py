"""Exercise the real backend and frontend modules with synthetic inputs."""

import shutil
import subprocess
import threading
from pathlib import Path
from unittest.mock import Mock

import cv2
import pytest
from pydantic import ValidationError

from backend.lockin_backend.camera import CameraSource
from backend.lockin_backend.config import CameraCfg, InferenceCfg
from backend.lockin_backend.hardware.protocol import Reply, encode, parse_line
from backend.lockin_backend.hardware.transport import FakeArduino
from backend.lockin_backend.inference.engine import InferenceEngine
from backend.lockin_backend.inference.registry import ModelRegistry
from backend.lockin_backend.schemas import Activity, FrameEnvelope
from backend.lockin_backend.app import create_app


ROOT = Path(__file__).resolve().parents[1]


def test_real_camera_source_reports_failed_open_without_frames(monkeypatch):
    capture = Mock()
    capture.isOpened.return_value = False
    monkeypatch.setattr(cv2, "VideoCapture", Mock(return_value=capture))
    camera = CameraSource(CameraCfg(source="webcam:0"))
    camera.start()
    camera.stop()
    assert "cannot open camera source" in camera.state().error
    assert not camera.state().running
    assert camera.latest() is None


def test_backend_serial_framing_and_stop_latch_against_fake_arduino():
    arduino = FakeArduino()
    try:
        assert parse_line(arduino.readline(0.1)) == "READY fw=sim-1.0"
        for seq, command, args, expected in [
            (1, "SERVO", ("pan", 181), Reply(1, False, {}, "RANGE")),
            (2, "UNRECOGNIZED", (), Reply(2, False, {}, "BADCMD")),
            (3, "STOP", (), Reply(3, True, {})),
            (4, "SERVO", ("pan", 100), Reply(4, False, {}, "STOPPED")),
        ]:
            arduino.write(encode(seq, command, *args))
            assert parse_line(arduino.readline(0.1)) == expected
        assert arduino.servo["pan"] == 90
        assert arduino.stopped
    finally:
        arduino.close()


@pytest.mark.parametrize("error", [FileNotFoundError("missing weights"), MemoryError("simulated GPU OOM")])
def test_model_load_failure_falls_back_to_flagged_mock(error):
    cfg = InferenceCfg(default_model="A", device="cuda")
    camera = CameraSource(CameraCfg(source="synthetic", width=160, height=120))
    model = Mock()
    model.load.side_effect = error
    registry = ModelRegistry(cfg, factories={"A": lambda _: model})
    observed = []
    ready = threading.Event()

    def collect(frame):
        observed.append(frame)
        ready.set()

    engine = InferenceEngine(cfg, camera, registry, collect, lambda _: None)
    camera.start()
    try:
        engine.start()
        assert ready.wait(5), "No fallback inference published"
        assert engine.state().active == "mock"
        assert str(error) in engine.state().last_error
        assert observed[0].simulated
        assert observed[0].model_id == "mock"
        model.load.assert_called_once_with("cuda")
    finally:
        try:
            engine.stop()
        finally:
            camera.stop()
    assert not camera.state().running


def test_frontend_decoder_accepts_backend_v1_envelope_and_rejects_wrong_version():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node with native TypeScript support is required for the frontend check")
    packet = FrameEnvelope(data={
        "frame_id": 1, "capture_ts": 123.0, "model_id": "mock", "simulated": True,
        "detections": [], "activity": None, "inference_ms": 1, "end_to_end_ms": 2,
        "fps": 10, "device": "cpu",
    })
    script = """
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';
        import { decode } from './frontend/src/api.ts';
        const raw = readFileSync(0, 'utf8');
        const packet = decode(raw);
        assert.equal(packet.type, 'frame_result');
        assert.equal(packet.data.activity, null);
        assert.equal(packet.data.simulated, true);
        assert.throws(() => decode(JSON.stringify({ ...packet, v: 2 })));
    """
    run = subprocess.run(
        [node, "--input-type=module", "--eval", script], input=packet.model_dump_json(),
        cwd=ROOT, text=True, capture_output=True, timeout=10,
    )
    assert run.returncode == 0, run.stderr


@pytest.mark.parametrize("confidence", [-0.1, 1.1, float("nan"), float("inf")])
def test_backend_prediction_rejects_out_of_range_confidence(confidence):
    with pytest.raises(ValidationError):
        Activity(label="focused", confidence=confidence)


@pytest.mark.xfail(reason="INT-01: frontend default telemetry path differs from the backend")
def test_frontend_default_websocket_route_exists():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node with native TypeScript support is required for the frontend check")
    from backend.lockin_backend.config import Settings

    run = subprocess.run(
        [node, "--input-type=module", "--eval",
         "import { routes } from './frontend/src/api.ts'; console.log(routes.telemetry);"],
        cwd=ROOT, text=True, capture_output=True, timeout=10, check=True,
    )
    registered = {route.path for route in create_app(Settings()).routes}
    assert run.stdout.strip() in registered
