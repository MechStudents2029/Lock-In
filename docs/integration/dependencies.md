# Dependency and environment audit

| Area | Observed | Integration requirement |
|---|---|---|
| Backend | Python 3.12.10 venv. FastAPI 0.115.6, Uvicorn 0.34.0, Pydantic 2.10.4, NumPy 2.2.1, OpenCV 4.10.0.84 and pyserial 3.5 are directly pinned. `pip check` passed. | Lock transitive runtime and test dependencies and rerun compatibility and advisory checks in a clean Windows environment. |
| Test stack | pytest 8.3.4, pytest-asyncio 0.25.0, HTTPX 0.28.1. The in-process ASGI tests run with installed Starlette 0.41.3. | A real WebSocket listener still needs verification with the resolved Uvicorn and websockets combination. Current test run emits asyncio and AnyIO deprecation notices. |
| Optional ML | The ML requirements pin Ultralytics 8.4.219, MediaPipe 1.2.3 and nvidia-ml-py 12.560.30. joblib is open-ended. PyTorch is installed separately per the manifest. None was present in the backend venv at audit. | Resolve an approved torch/torchvision pair and CPU and CUDA environments. Confirm Windows wheels, imports and a model inference smoke test. Resolve OpenCV variants together to avoid conflicting providers of `cv2`. |
| GPU | RTX 2070 SUPER, 8 GiB, NVIDIA driver 610.88 detected. | CUDA 12.x driver compatibility is plausible. Verify the selected wheel's GPU architecture support, run a CUDA tensor operation and one inference, and verify CPU recovery. Driver detection alone does not exercise CUDA. |
| Node | Node 24.15.0 and npm 11.12.1 available. Frontend manifest includes React 19, Vite 7 and TypeScript 5 ranges, dev and build scripts, and a lockfile. | Declare the Node runtime range. Run clean `npm ci`, build and advisory checks. |
| Firmware | Board metadata, source, toolchain manifest and protocol absent. | Document board ID, core and library versions, and flash and serial settings. |

### Verified advisory findings

- Installed Starlette 0.41.3 is in affected ranges for multipart parsing and FileResponse denial-of-service issues. Applicability depends on which handlers the eventual service enables. Update FastAPI and Starlette together and run tests against the resolved versions. [Multipart advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-2c2j-9gv5-cj73) · [FileResponse advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-7f5h-v6xp-fcq8)
- The CV plan specifies PyTorch 2.5.1 with CUDA 12.1. PyTorch lists that historical combination, and its security advisories cover checkpoint loading in 2.5.1 and later versions. Replace the proposed pin with a Windows/GPU-compatible release reviewed against current advisories before loading weights. [PyTorch wheels](https://pytorch.org/get-started/previous-versions/) · [PyTorch advisories](https://github.com/pytorch/pytorch/security/advisories) · [NVIDIA compatibility](https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html)

Model and dataset assets were absent. The CV plan expects YOLO11n and MediaPipe pose/hand artifacts and synthetic fixtures. It supplies no artifact hashes, acquisition manifest, trained activity classifiers or evaluation dataset. Verify resolved packages and artifact licenses before distributing. This was a targeted advisory review. A full resolved-dependency vulnerability scan remains open.
