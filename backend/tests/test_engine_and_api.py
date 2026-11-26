import struct
import time

import pytest
from fastapi.testclient import TestClient

from lockin_backend.app import Runtime, create_app
from lockin_backend.inference.registry import ModelRegistry
from lockin_backend.schemas import Activity, InferenceResult

P = "/api/v1"


class FakeReal:
    simulated = False

    def __init__(self, mid, log):
        self.id, self.log = mid, log

    def load(self, device):
        self.log.append(("load", self.id, device))

    def unload(self):
        self.log.append(("unload", self.id))

    def infer(self, img):
        return InferenceResult(activity=Activity(label="studying", confidence=0.9))


class Boom(FakeReal):
    def load(self, device):
        raise RuntimeError("weights missing")


@pytest.fixture
def client(settings):
    settings.hardware.mock = True
    log = []
    reg = ModelRegistry(settings.inference, factories={
        "A": lambda d: FakeReal("A", log), "B": lambda d: FakeReal("B", log), "C": lambda d: Boom("C", log)})
    rt = Runtime(settings, registry=reg)
    rt.log = log
    with TestClient(create_app(runtime=rt)) as c:
        c.rt = rt
        yield c


def wait(cond, t=5.0):
    end = time.time() + t
    while time.time() < end:
        r = cond()
        if r:
            return r
        time.sleep(0.02)
    return None


def test_health_and_mock_flagged_simulated(client):
    assert client.get(f"{P}/health").json()["ok"]
    res = wait(lambda: client.get(f"{P}/detections/latest").json())
    assert res and res["simulated"] is True and res["model_id"] == "mock"
    assert res["inference_ms"] > 0


def test_models_unavailable_without_adapter(settings):
    settings.inference.ml_adapter_module = "nonexistent_adapter_xyz"
    reg = ModelRegistry(settings.inference)
    ms = {m.id: m for m in reg.list(None)}
    assert ms["mock"].available and ms["mock"].simulated
    assert not ms["A"].available and "unavailable" in ms["A"].unavailable_reason


def test_select_model_switches_and_unloads_old(client):
    assert client.post(f"{P}/models/select", json={"model_id": "A"}).status_code == 202
    res = wait(lambda: (r := client.get(f"{P}/detections/latest").json()) and r["model_id"] == "A" and r)
    assert res and res["simulated"] is False and res["activity"]["label"] == "studying"
    client.post(f"{P}/models/select", json={"model_id": "B"})
    assert wait(lambda: client.get(f"{P}/models").json()["active"] == "B")
    ops = [o[:2] for o in client.rt.log]
    assert ops.index(("unload", "A")) < ops.index(("load", "B"))  # free before allocate


def test_failed_load_falls_back_to_flagged_mock(client):
    client.post(f"{P}/models/select", json={"model_id": "C"})
    st = wait(lambda: (m := client.get(f"{P}/models").json())["last_error"] and m)
    assert st and "weights missing" in st["last_error"] and st["active"] == "mock"


def test_unknown_model(client):
    assert client.post(f"{P}/models/select", json={"model_id": "Z"}).status_code == 404


def test_hardware_rest(client):
    assert wait(lambda: client.get(f"{P}/hardware").json()["connected"])
    r = client.post(f"{P}/hardware/servo", json={"id": "pan", "angle": 120})
    assert r.status_code == 200 and r.json()["status"]["servos"]["pan"] == 120
    assert client.post(f"{P}/hardware/servo", json={"id": "pan", "angle": 999}).status_code == 422
    assert client.post(f"{P}/hardware/stop").json()["ok"]
    assert client.post(f"{P}/hardware/servo", json={"id": "pan", "angle": 10}).status_code == 409
    assert client.post(f"{P}/hardware/reset-stop").json()["ok"]
    assert client.post(f"{P}/hardware/led", json={"on": True}).json()["ok"]
    assert client.post(f"{P}/hardware/buzzer", json={"on": True, "duration_ms": 20}).json()["ok"]


def test_training_progress_persists_metrics(client):
    body = {"run_id": "r1", "model_id": "B", "epoch": 3, "total_epochs": 10, "metrics": {"loss": 0.4}}
    assert client.post(f"{P}/training/progress", json=body).status_code == 200
    assert client.get(f"{P}/training/progress").json()["epoch"] == 3
    m = client.get(f"{P}/metrics", params={"run_id": "r1"}).json()
    assert m and m[0]["name"] == "loss" and m[0]["value"] == 0.4


def test_predictions_logged_and_deletable(client):
    assert wait(lambda: client.get(f"{P}/predictions").json())
    assert client.get(f"{P}/predictions").json()[0]["simulated"] is True
    client.post(f"{P}/training/progress", json={"run_id": "r", "metrics": {"x": 1}})
    out = client.delete(f"{P}/data/all").json()
    assert out["metrics"] >= 1 and out["predictions"] >= 1
    assert client.delete(f"{P}/data/bogus").status_code == 404


def test_recording_is_off_by_default_and_explicit(client):
    assert client.get(f"{P}/recording").json()["active"] is False
    assert client.get(f"{P}/recordings").json() == []
    assert wait(lambda: client.get(f"{P}/frame.jpg").status_code == 200)
    assert client.post(f"{P}/recording/start").json()["active"] is True
    time.sleep(0.5)
    assert client.delete(f"{P}/recordings").status_code == 409  # not while recording
    st = client.post(f"{P}/recording/stop").json()
    assert st["active"] is False and st["frames"] > 0
    assert len(client.get(f"{P}/recordings").json()) == 1
    assert client.delete(f"{P}/recordings", params={"name": "../../etc/passwd"}).json()["deleted"] == 0
    assert client.delete(f"{P}/recordings").json()["deleted"] == 1
    assert client.get(f"{P}/recordings").json() == []


def test_ws_telemetry_snapshot_and_stream(client):
    with client.websocket_connect(f"{P}/ws/telemetry") as ws:
        types = {ws.receive_json()["type"] for _ in range(4)}
        assert {"models", "hardware", "camera", "recording"} <= types
        ws.send_json({"subscribe": ["frame_result"]})
        got = None
        for _ in range(300):
            m = ws.receive_json()
            if m["type"] == "frame_result":
                got = m
                break
        assert got and got["v"] == 1 and got["data"]["simulated"] is True


def test_ws_video_binary_header(client):
    with client.websocket_connect(f"{P}/ws/video") as ws:
        blob = ws.receive_bytes()
        assert struct.unpack(">I", blob[:4])[0] >= 1 and blob[4:6] == b"\xff\xd8"


def test_schema_endpoint(client):
    s = client.get(f"{P}/schemas").json()
    assert "oneOf" in s or "$defs" in s


def test_system_stats(client):
    s = client.get(f"{P}/system").json()
    assert 0 <= s["cpu_percent"] <= 100 and "gpu_available" in s
