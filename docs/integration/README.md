# Windows integration guide

This checkout supports simulated scenarios and component contract tests. See [readiness](readiness.md) before enabling devices.

Related reports include the [security audit](security.md), [dependency audit](dependencies.md), [benchmark validation](benchmark.md) and [prioritized issue tracker](issues.md).

## Setup and tests

Install 64-bit Python 3.12 and Git. Install Node.js and npm for the frontend when its manifest and lockfile land. The audit machine has Python 3.12.10, Node 24.15.0 and npm 11.12.1. Use the frontend owner's declared Node version once available. Install Arduino IDE or Arduino CLI and the board core selected by the firmware owner before flashing.

From the repository root in PowerShell, create the environment if it is absent. If the Windows `py` alias fails, invoke the full path to an installed Python 3.12 executable in the first command.

```powershell
py -3.12 -m venv backend/.venv
& .\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
& .\backend\.venv\Scripts\python.exe -m pip check
& .\integration\Test-Local.ps1
```

If PowerShell blocks script execution, run `& .\backend\.venv\Scripts\python.exe -m pytest -q tests --basetemp=.pytest_cache/integration-temp` directly. This policy blocked the script on the audit machine and the direct command ran successfully. Use `npm.cmd` when PowerShell selects a blocked npm script. Node 24 can run the actual frontend TypeScript decoder check without installing frontend packages. The suite uses synthetic inputs and fake transports. Two expected failures track the route mismatch and WebSocket origin validation.

## Start and stop the prototype

1. From the repository root, run `Push-Location backend`, then `& .\.venv\Scripts\python.exe -m lockin_backend --config ../integration/local-mock.yaml`. This override uses the synthetic camera and CPU mock, disables serial access and prediction logging, and binds to loopback. From a second terminal, check `Invoke-RestMethod http://127.0.0.1:8000/api/v1/health`.
2. From the frontend directory in the second terminal, run `npm.cmd ci` and `npm.cmd run dev`. The manifest binds the dev server to `127.0.0.1:5173`. The client targets the correct backend host but will need the telemetry path fix in INT-01 before it can connect.
3. Start in mock mode. Enable the local camera explicitly for the physical test and keep recording off. Check Windows camera permissions and competing apps if capture fails. Use the device and model status in telemetry to distinguish CPU inference from unavailable inference.
4. Load models from an ignored local cache after checking each source and hash against the owner's artifact manifest. Test missing, incompatible and corrupt artifacts before enabling hardware. See [dependencies](dependencies.md) for CUDA and package review.
5. Flash the agreed board and firmware version. Use Device Manager to identify the COM port and close the Arduino serial monitor before the backend opens it. Match the approved baud rate and firmware handshake. First test with actuators disconnected or in a safe bench configuration. The simulated STOP frame does not establish firmware compatibility.
6. Disable recording and hardware output, issue the approved stop command and confirm the safe state. Stop the frontend and backend with Ctrl+C. Confirm camera indicators turn off, the COM port can be reopened and both loopback ports are released.

A unified launcher would reduce setup steps once the startup commands, health checks and shutdown handshake are stable. The current entry point runs only the simulated suite. A future supervisor should start the backend first, wait for readiness with a timeout, start the frontend and stop both if either fails, with mock mode as the default.
