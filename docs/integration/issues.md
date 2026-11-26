# Prioritized integration issue tracker

| ID | Priority | Owner | Issue and acceptance evidence |
|---|---|---|---|
| INT-01 | P0 | Backend, frontend, ML, firmware | Align frontend `/ws/v1/telemetry` with backend `/api/v1/ws/telemetry`. Agree on clock, feature units, serial parameters and missing-data values. Show a browser receiving frames via the agreed path. |
| INT-02 | P0 | Backend, firmware | Agree on and implement bounded serial commands, explicit arming and failsafe. Show invalid inputs produce no movement and confirm a physical STOP acknowledgement and safe disconnect. |
| INT-03 | P0 | Backend, ML, frontend | Verify loopback listeners, local-only camera processing, recording opt-in and origin protections. Show no media created or transmitted during a default capture session. |
| INT-04 | P0 | Backend, ML | Resolve reviewed FastAPI/Starlette and PyTorch versions before real service/model enablement. Lock dependencies and run advisory checks, clean installs and CPU/CUDA smoke tests. |
| INT-05 | P1 | ML | Provide verified inference artifacts, explicit no-evidence output and recovery for missing/corrupt weights, camera disconnection and GPU OOM. Show cooldown and freshness gates using actual decision logic. |
| INT-06 | P1 | Integration and component owners | Reuse simulated scenarios against real adapters and exercise loopback HTTP/WS, browser parser, camera, USB serial and graceful shutdown. Attach results with simulated and physical evidence distinguished. |
| INT-07 | P1 | ML, integration | Produce grouped held-out experiment evidence for all three models using the [benchmark protocol](benchmark.md). |
| INT-08 | P1 | Repository maintainer | Review root ignore rules with component owners, check staged paths and configure public repository secret protection. Scope any exceptions to reviewed public assets. |
| INT-09 | P2 | Integration | Measure stage latency and dropped frames. Add a supervised Windows launcher after component entry points and cleanup hooks stabilize. |

P0 blocks hardware-enabled or public-facing operation. P1 blocks a verified prototype or benchmark claim. P2 improves repeatability and troubleshooting.
