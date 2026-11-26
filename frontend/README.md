# Lock-In AI frontend

Run from the repository root in Windows PowerShell with Node.js 22.12+ or Node.js 24 installed.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The site opens in **Simulation mode**, which needs no webcam, model weights, Python, or Arduino. Use Ctrl+K to jump between workspaces. Run `npm.cmd run build` for the TypeScript check and production build.

## Integration contract

**Live mode** reads the loopback backend at `127.0.0.1:8000`. The WebSocket client uses the v1 envelopes in `backend/docs/API.md` and reconnects automatically. The video socket carries a four-byte big-endian frame ID and a JPEG. Overlays are drawn only for the matching inference frame. Backend mock predictions, synthetic video, and simulated Arduino states are excluded from live display. The backend's default mock configuration can verify connectivity, but real live inference requires a real camera or local input file and an available model.

The frontend uses the documented backend endpoints for health, model selection, telemetry, video, and explicit emergency stop. The live pan, LED, buzzer, and latch reset controls are disabled. Servo angles reported by the existing API are command acknowledgments. Measured velocity, requested angles, and target positions are optional telemetry fields.

The backend currently exposes training progress and numeric metric storage. The frontend does not infer dataset catalogs, evaluation metrics, run configuration, or model internals from arbitrary numbers. The backend and ML integration can supply these via optional v1 WebSocket messages or via loopback paths configured in a gitignored `.env.local`:

| Setting | Response or request |
| --- | --- |
| `VITE_DATASETS_PATH` | GET → `Dataset[]` |
| `VITE_EXPERIMENTS_PATH` | GET → `Experiment[]` |
| `VITE_INTERNALS_PATH` | GET → `Internals` for the current model |
| `VITE_TRAINING_START_PATH` | POST `{ model_id, dataset_id, epochs, batch_size, learning_rate }` |
| `VITE_TRAINING_STOP_PATH` | POST `{ run_id }` |

The optional response types, metric keys, and telemetry extensions are in `src/api.ts` and `src/Research.tsx`. Start and stop requests expect a successful JSON response, with run status arriving from the `training` WebSocket envelope. Pose and hand coordinates use normalized top-left-origin image coordinates. Include actual per-class probabilities when available. The UI treats activity confidence alone as a single reported confidence value. Missing values and unsupported features have explicit empty states.

## Camera and recording

Webcam preview and recording are opt-in, local to the browser, and use video only. Training Studio clips live in page memory. Save a clip to retain it locally. Leaving the page discards its in-memory clips and closes its camera. The privacy pause closes browser capture and the frontend video connection and suppresses incoming frame display and session observations. Python's own camera and storage lifecycle are controlled by the backend process.
