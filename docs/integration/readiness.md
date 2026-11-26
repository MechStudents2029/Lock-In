# System readiness checklist

**Status** Simulated scenarios and component contracts run locally. Product integration and physical acceptance remain open.

| Owner | Available in audited worktree | Handoff needed |
|---|---|---|
| ML | CV baseline implementation plan | Camera/feature/classifier interfaces, missingness semantics, model manifest and experiment artifacts |
| Backend | CLI and FastAPI app, v1 schemas, camera, inference engine and serial transport | Live socket smoke, privacy and hardware defaults |
| Frontend | Vite manifest, loopback client, v1 decoder and state module | Lockfile, completed UI and state handling for stale and uncertain predictions |
| Firmware | No sketch or board configuration found | Board/core, serial settings, command grammar, acknowledgements and fail-safe |
| Integration | Simulated tests, ignore rules, Windows test runner, audit documents | Run component-backed acceptance once interfaces land |

## Acceptance

- [x] Exercise synthetic camera → mock inference → real backend HTTP and in-process ASGI WebSocket JSON, with fake serial STOP and no automatic servo command during the run.
- [x] Inject missing weights, allocation failure and camera failure. Reject invalid confidence and serial inputs. Check startup and normal shutdown.
- [x] Feed a real backend-generated v1 frame into the actual frontend decoder. Exercise the real camera-open failure path, fake serial protocol and inference load failure with injected faults.
- [ ] Compare actual API with OpenAPI and a shared telemetry fixture consumed by the real frontend decoder. Test reconnects, stale frames and origin/authentication behavior.
- [ ] Confirm real camera capture and feature shapes, units and time base, plus model load and CPU fallback. Confirm an explicit unavailable state on repeated failure.
- [ ] Agree on a serial protocol covering baud, framing, maximum length, version, acknowledgement, duplicate handling, bounded command values and firmware timeout. Verify with mock transport, then test the board on the bench.
- [ ] Measure capture, vision, features, classifier, backend queue, serial acknowledgement and browser receipt separately. Record p50/p95 latency and dropped frames. The plan's synchronous YOLO and MediaPipe stages are likely latency contributors. Test bounded queues so stale frames cannot accumulate.
- [ ] Confirm no reminders or hardware actions on startup, stale or uncertain data, camera loss, invalid commands, disconnect or GPU fallback. Verify STOP acknowledgement and a safe state during Ctrl+C, cable removal and firmware reset.
- [ ] Confirm opt-in recording, retention controls and local-only processing on the running system.

The frontend expects `/ws/v1/telemetry` and the backend serves `/api/v1/ws/telemetry`. Its decoder accepts the backend frame fixture and advertises experimental fields and message types beyond the backend schema. Backend serial v1 specifies newline-terminated ASCII at 115200 8N1, sequenced replies, a 500 ms heartbeat and a 2 s watchdog. Firmware conformance is pending.

The tests drive the backend routes with HTTPX's in-process transport and Starlette's WebSocket test session. They do not exercise browser networking, USB hardware, actual model artifacts or reminders and automatic motion. Those policy paths need tests for evidence quality, sustained confidence, freshness and cooldown.
