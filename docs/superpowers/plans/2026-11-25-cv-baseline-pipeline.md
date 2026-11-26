# CV Baseline Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the smallest working real-time computer vision baseline for Lock-In AI — pretrained YOLO11n phone detection + MediaPipe pose/hand landmarks, feeding a deterministic numeric feature extractor — running on a fixed (non-servo) local camera or video file, with no training and no dataset dependency.

**Architecture:** Three independent, synchronously-composed stages per frame: (1) `PhoneDetector` (Ultralytics YOLO11n, GPU if available) produces object detections; (2) `PoseEstimator` (MediaPipe Tasks API) produces hand/pose landmarks; (3) `FeatureExtractor` + `TemporalTracker` turn both into the spec'd numeric feature vector, normalized for camera distance/resolution. `CVPipeline` orchestrates all three per frame; a thin CLI drives it over a video file or webcam for manual verification. All model-free logic (feature math, temporal tracking, config) is pure Python and unit-tested without GPU/camera; the two model wrappers get structural integration tests using small pretrained weights that Ultralytics/MediaPipe download automatically.

**Tech Stack:** Python 3.12 (isolated venv — the system default of 3.14 has no PyTorch wheels), PyTorch 2.5.1+cu121, Ultralytics 8.4.219 (YOLO11n), MediaPipe 1.2.3, OpenCV-Python, PyYAML, pytest.

**Spec:** User-provided Phase 1–3 and Engineering Requirements sections of the Lock-In AI project brief (2026-11-25 conversation). No separate spec file exists; this plan is the spec's sole translation into tasks.

## Global Constraints

- Project venv must use Python 3.12, not the system default 3.14 (no PyTorch wheels for 3.14 as of this plan).
- GPU-accelerated inference is preferred (CUDA via `torch==2.5.1+cu121`) but must never hard-fail on a CPU-only machine — device selection falls back to CPU with a logged warning.
- Baseline detector is pretrained YOLO11n (Ultralytics) — no training in this plan.
- Pose/hand landmarks come from MediaPipe — no alternative library in this plan.
- All spatial features (distance, movement) must be normalized so they are comparable across different camera resolutions/distances (divide by frame diagonal, not raw pixels).
- Only fixed-camera operation is in scope; no servo/actuator code.
- No hardcoded credentials anywhere in this subsystem.
- All public functions/classes carry type annotations and a one-line docstring where the name doesn't already say it.
- Any locally captured footage directory must be `.gitignore`d; test fixtures are synthetically generated, never real recordings.
- Config is YAML, loaded into typed dataclasses — no bare dicts passed between modules.
- Every task ships with passing unit tests (`pytest`); no task is "done" without a green test run.
- Dependency versions are pinned exactly in `requirements.txt` for reproducibility.

## Review Focus

- **No GPU present on a given machine** → inference must run on CPU without crashing, and the pipeline must report which device it actually used, not just which was requested.
- **No phone and no hand visible in a frame** → the feature extractor must return explicit "no evidence" values (e.g. `None`/`0.0` with a presence flag), never a plausible-looking fabricated number that could be mistaken for "confidently absent."
- **A camera/video source fails to open** (bad index, missing file path) → the capture utility must raise one specific, catchable error immediately, not hang or silently yield black frames.
- **Multiple phones or multiple hands detected in one frame** → the extractor must deterministically pick one (highest-confidence phone; nearest hand to that phone) rather than crashing or silently using whichever came first in an unordered list.
- **Same physical scene at two different resolutions/camera distances** → normalized distance and movement features must come out numerically equal for geometrically equivalent synthetic inputs, proving the normalization actually removes resolution/distance dependence.

---

## File Structure

```
Lock-In/
  .gitignore                          # extend: .venv/, ml/data/local_captures/, *.pt download cache paths
  ml/
    requirements.txt
    config/
      default.yaml
    src/
      lockin_cv/
        __init__.py
        config.py                     # PipelineConfig dataclass + YAML loader
        detection/
          __init__.py
          yolo_detector.py            # PhoneDetector, Detection dataclass
        pose/
          __init__.py
          pose_estimator.py           # PoseEstimator, PoseResult dataclass
        features/
          __init__.py
          feature_extractor.py        # FeatureExtractor, FrameFeatures dataclass
          temporal.py                 # TemporalTracker, TemporalFeatures dataclass
        capture.py                    # VideoFileSource, WebcamSource, FrameSource protocol
        pipeline.py                   # CVPipeline, PipelineOutput dataclass
        cli.py                        # python -m lockin_cv.cli entry point
    tests/
      conftest.py                     # shared synthetic-frame/video fixtures
      test_config.py
      test_feature_extractor.py
      test_temporal.py
      test_capture.py
      test_yolo_detector.py
      test_pose_estimator.py
      test_pipeline_integration.py
    README.md
```

---

### Task 1: Project scaffolding, venv, and config loader

**Files:**
- Create: `ml/requirements.txt`
- Create: `ml/config/default.yaml`
- Create: `ml/src/lockin_cv/__init__.py`
- Create: `ml/src/lockin_cv/config.py`
- Test: `ml/tests/test_config.py`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: `PipelineConfig` dataclass with fields `device: str` ("auto"|"cuda"|"cpu"), `phone_class_names: list[str]`, `detection_conf_threshold: float`, `temporal_window_frames: int`, `source: str`; function `load_config(path: str | None) -> PipelineConfig` (returns defaults merged with YAML overrides when `path` given).

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_config.py
from lockin_cv.config import load_config, PipelineConfig

def test_load_config_defaults_when_no_path():
    cfg = load_config(None)
    assert isinstance(cfg, PipelineConfig)
    assert cfg.device == "auto"
    assert cfg.detection_conf_threshold == 0.4

def test_load_config_overrides_from_yaml(tmp_path):
    p = tmp_path / "custom.yaml"
    p.write_text("detection_conf_threshold: 0.6\ndevice: cpu\n")
    cfg = load_config(str(p))
    assert cfg.detection_conf_threshold == 0.6
    assert cfg.device == "cpu"
    assert cfg.phone_class_names == ["cell phone"]  # unspecified fields keep defaults

def test_load_config_rejects_invalid_device(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("device: tpu\n")
    try:
        load_config(str(p))
        assert False, "expected ValueError"
    except ValueError:
        pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv'`

- [ ] **Step 3: Create venv and install pinned dependencies**

Create `ml/requirements.txt` pinning: `torch==2.5.1+cu121` (install via `--extra-index-url https://download.pytorch.org/whl/cu121`), `ultralytics==8.4.219`, `mediapipe==1.2.3`, `opencv-python`, `pyyaml`, `numpy`, `pytest`. Create the venv with `py -3.12 -m venv ml/.venv` and install `ml/requirements.txt` plus `pip install -e ml` (add a minimal `ml/pyproject.toml` or `setup.cfg` so `lockin_cv` is importable as a package from `ml/src`). Add `ml/.venv/` and `ml/data/local_captures/` to `.gitignore`.

- [ ] **Step 4: Implement `PipelineConfig` and `load_config` in `ml/src/lockin_cv/config.py`**

`PipelineConfig` is a frozen dataclass with the fields above plus sane defaults matching `test_load_config_defaults_when_no_path`. `load_config` reads YAML via `yaml.safe_load`, merges onto the defaults (field by field, not a blind dict merge), and raises `ValueError` if `device` is not one of `{"auto", "cuda", "cpu"}`. Write matching defaults into `ml/config/default.yaml` for human reference (the code must not require this file to exist — defaults live in code).

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest ml/tests/test_config.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add ml/requirements.txt ml/config/default.yaml ml/src/lockin_cv/__init__.py ml/src/lockin_cv/config.py ml/tests/test_config.py ml/pyproject.toml .gitignore
git commit -m "feat: scaffold ml package with venv and typed config loader"
```

---

### Task 2: GPU-aware YOLO11n phone detector

**Files:**
- Create: `ml/src/lockin_cv/detection/__init__.py`
- Create: `ml/src/lockin_cv/detection/yolo_detector.py`
- Test: `ml/tests/test_yolo_detector.py`

**Interfaces:**
- Consumes: `PipelineConfig.device`, `PipelineConfig.phone_class_names`, `PipelineConfig.detection_conf_threshold` (Task 1).
- Produces: `Detection` dataclass (`class_name: str`, `confidence: float`, `bbox_xyxy_px: tuple[float, float, float, float]`, `bbox_xyxy_norm: tuple[float, float, float, float]`); `PhoneDetector` class with `__init__(config: PipelineConfig)` and `detect(frame: np.ndarray) -> list[Detection]`; `PhoneDetector.resolved_device: str` attribute set after first load, reporting the actual device used.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_yolo_detector.py
import numpy as np
from lockin_cv.config import load_config
from lockin_cv.detection.yolo_detector import PhoneDetector, Detection

def test_detector_resolves_cpu_when_cuda_unavailable(monkeypatch):
    import torch
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    cfg = load_config(None)
    detector = PhoneDetector(cfg)
    assert detector.resolved_device == "cpu"

def test_detector_returns_no_detections_on_blank_frame():
    cfg = load_config(None)
    detector = PhoneDetector(cfg)
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    results = detector.detect(blank)
    assert isinstance(results, list)
    assert all(isinstance(r, Detection) for r in results)
    assert all(r.confidence >= cfg.detection_conf_threshold for r in results)

def test_detection_bbox_norm_is_in_unit_range():
    cfg = load_config(None)
    detector = PhoneDetector(cfg)
    frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    for r in detector.detect(frame):
        x1, y1, x2, y2 = r.bbox_xyxy_norm
        assert 0.0 <= x1 <= 1.0 and 0.0 <= y1 <= 1.0
        assert 0.0 <= x2 <= 1.0 and 0.0 <= y2 <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_yolo_detector.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.detection.yolo_detector'`

- [ ] **Step 3: Implement `Detection` and `PhoneDetector` in `ml/src/lockin_cv/detection/yolo_detector.py`**

Device resolution: if `config.device == "auto"`, use `"cuda"` when `torch.cuda.is_available()` else `"cpu"`; otherwise use `config.device` verbatim. Load `ultralytics.YOLO("yolo11n.pt")` once in `__init__` and move it to the resolved device. `detect()` runs `self.model(frame, conf=config.detection_conf_threshold, device=self.resolved_device, verbose=False)`, filters results to boxes whose class name is in `config.phone_class_names` (COCO's `yolo11n.pt` already includes `cell phone`), and builds `Detection` instances with both pixel and frame-size-normalized bbox coordinates (divide x by frame width, y by frame height).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest ml/tests/test_yolo_detector.py -v`
Expected: PASS (3 tests) — first run downloads `yolo11n.pt` (~5-6MB) automatically via Ultralytics.

- [ ] **Step 5: Commit**

```bash
git add ml/src/lockin_cv/detection ml/tests/test_yolo_detector.py
git commit -m "feat: add GPU-aware YOLO11n phone detector wrapper"
```

---

### Task 3: MediaPipe pose/hand landmark estimator

**Files:**
- Create: `ml/src/lockin_cv/pose/__init__.py`
- Create: `ml/src/lockin_cv/pose/pose_estimator.py`
- Test: `ml/tests/test_pose_estimator.py`

**Interfaces:**
- Produces: `Landmark` dataclass (`x: float`, `y: float`, `z: float`, `visibility: float`, all in `[0,1]` for x/y); `PoseResult` dataclass (`hands: list[list[Landmark]]`, `pose: list[Landmark] | None`, `pose_confidence: float` — mean visibility of pose landmarks, `0.0` if `pose is None`); `PoseEstimator` class with `__init__(config: PipelineConfig)` and `estimate(frame: np.ndarray) -> PoseResult`.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_pose_estimator.py
import numpy as np
from lockin_cv.config import load_config
from lockin_cv.pose.pose_estimator import PoseEstimator, PoseResult

def test_pose_estimator_returns_empty_result_on_blank_frame():
    cfg = load_config(None)
    estimator = PoseEstimator(cfg)
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    result = estimator.estimate(blank)
    assert isinstance(result, PoseResult)
    assert result.hands == []
    assert result.pose is None
    assert result.pose_confidence == 0.0

def test_pose_result_landmarks_are_normalized():
    cfg = load_config(None)
    estimator = PoseEstimator(cfg)
    frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    result = estimator.estimate(frame)
    for hand in result.hands:
        for lm in hand:
            assert 0.0 <= lm.x <= 1.0 and 0.0 <= lm.y <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_pose_estimator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.pose.pose_estimator'`

- [ ] **Step 3: Implement `Landmark`, `PoseResult`, and `PoseEstimator` in `ml/src/lockin_cv/pose/pose_estimator.py`**

Use MediaPipe's Tasks API (`mediapipe.tasks.python.vision.HandLandmarker` and `PoseLandmarker`), letting MediaPipe auto-download its bundled model assets on first use. `estimate()` runs both detectors on the frame, converts each result's landmarks into `Landmark` instances, and computes `pose_confidence` as the mean of pose landmark `visibility` values (or `0.0` when no pose landmarks were found).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest ml/tests/test_pose_estimator.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add ml/src/lockin_cv/pose ml/tests/test_pose_estimator.py
git commit -m "feat: add MediaPipe hand/pose landmark estimator wrapper"
```

---

### Task 4: Per-frame feature extractor (pure math)

**Files:**
- Create: `ml/src/lockin_cv/features/__init__.py`
- Create: `ml/src/lockin_cv/features/feature_extractor.py`
- Test: `ml/tests/test_feature_extractor.py`

**Interfaces:**
- Consumes: `Detection` (Task 2), `PoseResult`/`Landmark` (Task 3).
- Produces: `FrameFeatures` dataclass (`phone_present: bool`, `phone_confidence: float`, `phone_bbox_norm: tuple[float,float,float,float] | None`, `hand_to_phone_distance_norm: float | None`, `bbox_overlap_iou: float`, `pose_confidence: float`); `FeatureExtractor` class with `extract(detections: list[Detection], pose: PoseResult, frame_shape: tuple[int,int]) -> FrameFeatures`.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_feature_extractor.py
from lockin_cv.detection.yolo_detector import Detection
from lockin_cv.pose.pose_estimator import PoseResult, Landmark
from lockin_cv.features.feature_extractor import FeatureExtractor, FrameFeatures

def test_no_phone_no_hand_yields_no_evidence():
    fx = FeatureExtractor()
    result = fx.extract([], PoseResult(hands=[], pose=None, pose_confidence=0.0), (480, 640))
    assert result.phone_present is False
    assert result.phone_confidence == 0.0
    assert result.phone_bbox_norm is None
    assert result.hand_to_phone_distance_norm is None
    assert result.bbox_overlap_iou == 0.0

def test_picks_highest_confidence_phone_when_multiple():
    low = Detection("cell phone", 0.5, (0,0,10,10), (0.0,0.0,0.1,0.1))
    high = Detection("cell phone", 0.9, (100,100,110,110), (0.2,0.2,0.3,0.3))
    fx = FeatureExtractor()
    result = fx.extract([low, high], PoseResult(hands=[], pose=None, pose_confidence=0.0), (480, 640))
    assert result.phone_confidence == 0.9
    assert result.phone_bbox_norm == (0.2,0.2,0.3,0.3)

def test_hand_to_phone_distance_is_normalized_by_frame_diagonal():
    # Phone bbox center at normalized (0.5, 0.5); one hand wrist landmark at normalized (0.5, 0.0)
    phone = Detection("cell phone", 0.8, (0,0,0,0), (0.4, 0.4, 0.6, 0.6))
    wrist = Landmark(x=0.5, y=0.0, z=0.0, visibility=1.0)
    hand = [wrist] + [Landmark(0.5, 0.0, 0.0, 1.0)] * 20  # pad to realistic landmark count
    pose = PoseResult(hands=[hand], pose=None, pose_confidence=0.0)
    fx = FeatureExtractor()
    r1 = fx.extract([phone], pose, (480, 640))
    r2 = fx.extract([phone], pose, (960, 1280))  # same scene, double resolution
    assert r1.hand_to_phone_distance_norm is not None
    assert abs(r1.hand_to_phone_distance_norm - r2.hand_to_phone_distance_norm) < 1e-6

def test_bbox_overlap_iou_zero_when_no_hand_bbox():
    phone = Detection("cell phone", 0.8, (0,0,0,0), (0.4,0.4,0.6,0.6))
    fx = FeatureExtractor()
    result = fx.extract([phone], PoseResult(hands=[], pose=None, pose_confidence=0.0), (480, 640))
    assert result.bbox_overlap_iou == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_feature_extractor.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.features.feature_extractor'`

- [ ] **Step 3: Implement `FrameFeatures` and `FeatureExtractor` in `ml/src/lockin_cv/features/feature_extractor.py`**

Select the phone detection with max `confidence` (empty list → no-evidence defaults). Derive a hand bounding box from a hand's landmark min/max x/y (normalized coords) when at least one hand is present, else no hand bbox. `hand_to_phone_distance_norm` = Euclidean distance between the phone bbox center and the nearest hand's wrist landmark (landmark index 0), divided by `sqrt(2)` (the normalized-frame diagonal in a 0–1 coordinate space is resolution-independent by construction since all inputs are already normalized — this is why both detector and pose outputs use normalized coordinates). `bbox_overlap_iou` = standard IoU between phone bbox and derived hand bbox, `0.0` when no hand bbox exists. Pick the nearest hand (by wrist-to-phone-center distance) when multiple hands are present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest ml/tests/test_feature_extractor.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add ml/src/lockin_cv/features/feature_extractor.py ml/src/lockin_cv/features/__init__.py ml/tests/test_feature_extractor.py
git commit -m "feat: add deterministic per-frame feature extractor"
```

---

### Task 5: Temporal tracker (movement, duration, stability)

**Files:**
- Create: `ml/src/lockin_cv/features/temporal.py`
- Test: `ml/tests/test_temporal.py`

**Interfaces:**
- Consumes: `FrameFeatures` (Task 4), `PipelineConfig.temporal_window_frames` (Task 1).
- Produces: `TemporalFeatures` dataclass (`phone_movement_norm: float | None`, `phone_usage_duration_s: float`, `detection_stability_ratio: float`); `TemporalTracker` class with `__init__(window_frames: int)`, `update(features: FrameFeatures, timestamp_s: float) -> TemporalFeatures`, `reset() -> None`.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_temporal.py
from lockin_cv.features.feature_extractor import FrameFeatures
from lockin_cv.features.temporal import TemporalTracker

def _ff(present, bbox):
    return FrameFeatures(phone_present=present, phone_confidence=0.9 if present else 0.0,
                          phone_bbox_norm=bbox, hand_to_phone_distance_norm=None,
                          bbox_overlap_iou=0.0, pose_confidence=0.0)

def test_stability_is_one_when_phone_present_every_frame():
    tracker = TemporalTracker(window_frames=5)
    result = None
    for i in range(5):
        result = tracker.update(_ff(True, (0.4,0.4,0.6,0.6)), timestamp_s=float(i))
    assert result.detection_stability_ratio == 1.0

def test_duration_resets_after_absence():
    tracker = TemporalTracker(window_frames=5)
    tracker.update(_ff(True, (0.4,0.4,0.6,0.6)), timestamp_s=0.0)
    tracker.update(_ff(True, (0.4,0.4,0.6,0.6)), timestamp_s=1.0)
    r = tracker.update(_ff(False, None), timestamp_s=2.0)
    assert r.phone_usage_duration_s == 0.0
    r2 = tracker.update(_ff(True, (0.4,0.4,0.6,0.6)), timestamp_s=3.0)
    assert r2.phone_usage_duration_s == 0.0  # just reappeared, duration measured from this frame

def test_movement_is_displacement_of_bbox_center_between_frames():
    tracker = TemporalTracker(window_frames=5)
    tracker.update(_ff(True, (0.0,0.0,0.2,0.2)), timestamp_s=0.0)  # center (0.1, 0.1)
    r = tracker.update(_ff(True, (0.3,0.0,0.5,0.2)), timestamp_s=1.0)  # center (0.4, 0.1)
    assert r.phone_movement_norm is not None
    assert abs(r.phone_movement_norm - 0.3) < 1e-6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_temporal.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.features.temporal'`

- [ ] **Step 3: Implement `TemporalFeatures` and `TemporalTracker` in `ml/src/lockin_cv/features/temporal.py`**

Keep a `collections.deque(maxlen=window_frames)` of recent `phone_present` booleans for `detection_stability_ratio` (fraction `True`), a `deque` of recent bbox centers for movement (Euclidean distance between the two most recent centers; `None` when fewer than 2 present-frame samples exist), and a `usage_start_timestamp: float | None` that is set to the current timestamp on the first `True` after a `False`/initial state and cleared to `None` on any `False`; `phone_usage_duration_s = timestamp - usage_start_timestamp` while present, else `0.0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest ml/tests/test_temporal.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add ml/src/lockin_cv/features/temporal.py ml/tests/test_temporal.py
git commit -m "feat: add temporal tracker for phone movement, duration, and stability"
```

---

### Task 6: Fixed-camera frame capture utility

**Files:**
- Create: `ml/src/lockin_cv/capture.py`
- Test: `ml/tests/test_capture.py`

**Interfaces:**
- Produces: `FrameSource` protocol (`__iter__(self) -> Iterator[tuple[np.ndarray, float]]` yielding `(frame, timestamp_s)`); `VideoFileSource(path: str)` implementing it, raising `FileNotFoundError` immediately in `__init__` if the path doesn't open; `WebcamSource(index: int)` implementing it, raising `RuntimeError` immediately in `__init__` if the camera index doesn't open.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_capture.py
import cv2
import numpy as np
import pytest
from lockin_cv.capture import VideoFileSource, WebcamSource

def _write_test_video(path, num_frames=5, size=(64, 48)):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, size)
    for i in range(num_frames):
        frame = np.full((size[1], size[0], 3), i * 10, dtype=np.uint8)
        writer.write(frame)
    writer.release()

def test_video_file_source_yields_expected_frame_count(tmp_path):
    video_path = tmp_path / "test.mp4"
    _write_test_video(video_path, num_frames=5)
    source = VideoFileSource(str(video_path))
    frames = list(source)
    assert len(frames) == 5
    for frame, ts in frames:
        assert frame.shape == (48, 64, 3)
        assert isinstance(ts, float)

def test_video_file_source_missing_file_raises_immediately(tmp_path):
    with pytest.raises(FileNotFoundError):
        VideoFileSource(str(tmp_path / "does_not_exist.mp4"))

def test_webcam_source_bad_index_raises_immediately(monkeypatch):
    class FakeCap:
        def isOpened(self): return False
        def release(self): pass
    monkeypatch.setattr(cv2, "VideoCapture", lambda index: FakeCap())
    with pytest.raises(RuntimeError):
        WebcamSource(99)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_capture.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.capture'`

- [ ] **Step 3: Implement `VideoFileSource` and `WebcamSource` in `ml/src/lockin_cv/capture.py`**

Both open a `cv2.VideoCapture` in `__init__` and check `isOpened()` immediately, raising the specified exception with the path/index in the message on failure. `__iter__` reads frames with `cap.read()` until it returns `False`, yielding `(frame, frame_index / fps)` as the timestamp (fall back to a monotonic counter if `fps` reports `0`), and releases the capture when exhausted.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest ml/tests/test_capture.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add ml/src/lockin_cv/capture.py ml/tests/test_capture.py
git commit -m "feat: add video file and webcam frame capture utilities"
```

---

### Task 7: Pipeline orchestration, CLI entry point, and README

**Files:**
- Create: `ml/src/lockin_cv/pipeline.py`
- Create: `ml/src/lockin_cv/cli.py`
- Create: `ml/README.md`
- Test: `ml/tests/test_pipeline_integration.py`

**Interfaces:**
- Consumes: `PipelineConfig` (Task 1), `PhoneDetector` (Task 2), `PoseEstimator` (Task 3), `FeatureExtractor`+`FrameFeatures` (Task 4), `TemporalTracker`+`TemporalFeatures` (Task 5), `FrameSource` (Task 6).
- Produces: `PipelineOutput` dataclass (`timestamp_s: float`, `frame_features: FrameFeatures`, `temporal_features: TemporalFeatures`, `resolved_device: str`, `inference_latency_ms: float`); `CVPipeline` class with `__init__(config: PipelineConfig)` and `run(source: FrameSource) -> Iterator[PipelineOutput]`.

- [ ] **Step 1: Write the failing test**

```python
# ml/tests/test_pipeline_integration.py
from pathlib import Path
import cv2
import numpy as np
from lockin_cv.config import load_config
from lockin_cv.capture import VideoFileSource
from lockin_cv.pipeline import CVPipeline, PipelineOutput

def test_pipeline_runs_end_to_end_on_synthetic_video(tmp_path):
    video_path = tmp_path / "synthetic.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (640, 480))
    for i in range(3):
        writer.write(np.zeros((480, 640, 3), dtype=np.uint8))
    writer.release()

    cfg = load_config(None)
    pipeline = CVPipeline(cfg)
    outputs = list(pipeline.run(VideoFileSource(str(video_path))))

    assert len(outputs) == 3
    for out in outputs:
        assert isinstance(out, PipelineOutput)
        assert out.resolved_device in {"cpu", "cuda"}
        assert out.inference_latency_ms >= 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest ml/tests/test_pipeline_integration.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lockin_cv.pipeline'`

- [ ] **Step 3: Implement `PipelineOutput` and `CVPipeline` in `ml/src/lockin_cv/pipeline.py`**

`__init__` constructs one `PhoneDetector`, one `PoseEstimator`, one `FeatureExtractor`, and one `TemporalTracker(config.temporal_window_frames)`. `run()` iterates the given `FrameSource`, timing each frame's detector+pose calls (`time.perf_counter()`) for `inference_latency_ms`, feeding results through `FeatureExtractor.extract` then `TemporalTracker.update`, and yielding a `PipelineOutput` per frame.

- [ ] **Step 4: Implement the CLI in `ml/src/lockin_cv/cli.py`**

`argparse` entry point: `--source webcam:<index>|<path to video file>`, `--config <path>` (optional), `--max-frames <int>` (optional cap, default unbounded), `--print-json` flag. Parses `--source` into the right `FrameSource`, builds `CVPipeline`, runs it, and for each `PipelineOutput` either prints a human-readable one-line summary or (`--print-json`) `json.dumps(dataclasses.asdict(output))`. Add a `if __name__ == "__main__":` guard calling `main()` so it runs via `python -m lockin_cv.cli ...`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest ml/tests/test_pipeline_integration.py -v`
Expected: PASS (1 test)

- [ ] **Step 6: Manually verify the CLI against a real local video or webcam**

Run: `python -m lockin_cv.cli --source webcam:0 --max-frames 30 --print-json` (or `--source path/to/any/test_clip.mp4` if no webcam is available in the execution environment) and confirm it prints 30 well-formed JSON lines with sane values (no exceptions, `resolved_device` matches the actual hardware, latency numbers are plausible for CPU or GPU). Record the actual observed device and FPS in `ml/README.md` — do not fabricate numbers if this step runs in an environment without camera/GPU access; state plainly which parts were and were not manually verified.

- [ ] **Step 7: Write `ml/README.md`**

Document: venv setup (`py -3.12 -m venv ml/.venv`, activation, `pip install -r ml/requirements.txt --extra-index-url https://download.pytorch.org/whl/cu121`, `pip install -e ml`), how to run the CLI on a video file or webcam, the full list of fields in `FrameFeatures`/`TemporalFeatures`/`PipelineOutput` with one-line definitions, and an explicit "Not yet implemented" list (training, dataset pipeline, servo/dashboard integration) so nobody mistakes this baseline for the full system.

- [ ] **Step 8: Commit**

```bash
git add ml/src/lockin_cv/pipeline.py ml/src/lockin_cv/cli.py ml/README.md ml/tests/test_pipeline_integration.py
git commit -m "feat: orchestrate detector+pose+features into a runnable CV baseline pipeline"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 1 (audit) already completed outside this plan. Phase 3 requirements — YOLO11n baseline (Task 2), MediaPipe pose/hands (Task 3), all 8 listed numeric features except explicit "detection stability" and "duration" which land in Task 5, spatial normalization (Task 4's frame-diagonal-independent distance, proven in `test_hand_to_phone_distance_is_normalized_by_frame_diagonal`), fixed-camera support (Task 6) — are each covered by exactly one task. Phases 2 and 4–8 are explicitly deferred to future plans, not silently dropped.
- **Review Focus coverage:** all five items have a named test in the task that owns the relevant code (Task 2 for GPU fallback, Task 4 for no-evidence/multiple-detections/resolution-independence, Task 6 for capture-open failure).
- **Type/name consistency checked:** `FrameFeatures` (Task 4) is consumed by both `TemporalTracker.update` (Task 5) and `CVPipeline` (Task 7) with the same field names throughout; `Detection`/`PoseResult`/`Landmark` field names used in Task 4's tests match the dataclasses defined in Tasks 2–3.
