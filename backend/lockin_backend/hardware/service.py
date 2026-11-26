"""Arduino link supervisor: discovery, handshake, heartbeat, acknowledged commands,
reconnect, and fail-safe state handling. Runs on the asyncio loop; the blocking
serial read happens on one dedicated thread per connection."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Callable

from ..config import HardwareCfg
from ..schemas import CommandResult, HardwareStatus
from . import protocol
from .transport import FakeArduino, SerialTransport, Transport, TransportClosed, discover_ports

log = logging.getLogger(__name__)

TransportFactory = Callable[[], "Transport | None"]


class HardwareError(Exception):
    """Command could not be performed (maps to HTTP 409/503)."""


class HardwareService:
    def __init__(self, cfg: HardwareCfg, on_status: Callable[[HardwareStatus], None] | None = None,
                 transport_factory: TransportFactory | None = None):
        self.cfg = cfg
        self._on_status = on_status or (lambda s: None)
        self._factory = transport_factory
        self._t: Transport | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._reader: threading.Thread | None = None
        self._reader_stop = threading.Event()
        self._wlock = threading.Lock()
        self._pending: dict[int, asyncio.Future] = {}
        self._seq = 0
        self._task: asyncio.Task | None = None
        self._hb_task: asyncio.Task | None = None
        self._last_rx = 0.0
        self._reconnect: asyncio.Event | None = None  # created in start()
        self._stopping = False
        self.status = HardwareStatus(enabled=cfg.enabled, connected=False,
                                     state="searching" if cfg.enabled else "disabled",
                                     servos={i: None for i in cfg.servo_ids})

    # ------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._reconnect = asyncio.Event()
        if not self.cfg.enabled:
            return
        self._task = asyncio.create_task(self._supervise(), name="hw-supervisor")

    async def stop(self) -> None:
        self._stopping = True
        if self._t is not None and self.status.connected:
            try:  # best effort; the firmware watchdog is the real safety net
                await self._send("BUZZ", 0, timeout=0.3)
                await self._send("LED", 0, timeout=0.3)
            except Exception:  # noqa: BLE001
                pass
        for t in (self._task, self._hb_task):
            if t:
                t.cancel()
        await asyncio.gather(*(t for t in (self._task, self._hb_task) if t), return_exceptions=True)
        self._drop_link("shutdown", state="disabled" if not self.cfg.enabled else "searching")

    def _publish(self) -> None:
        self._on_status(self.status.model_copy(deep=True))

    def _set(self, **kw) -> None:
        for k, v in kw.items():
            setattr(self.status, k, v)
        self._publish()

    # ------------------------------------------------------------ connection
    def _open_candidates(self) -> list[Transport]:
        if self._factory is not None:
            t = self._factory()
            return [t] if t else []
        if self.cfg.mock:
            return [FakeArduino(ids=tuple(self.cfg.servo_ids))]
        out: list[Transport] = []
        for port in discover_ports(self.cfg.port):
            try:
                out.append(SerialTransport(port, self.cfg.baudrate))
            except Exception as e:  # noqa: BLE001  (busy / permission / vanished)
                self._set(last_error=f"{port}: {e}")
        return out

    async def _supervise(self) -> None:
        loop = asyncio.get_running_loop()
        while not self._stopping:
            if not self.status.connected:
                self._set(state="searching")
                try:
                    cands = await loop.run_in_executor(None, self._open_candidates)
                except Exception as e:  # noqa: BLE001
                    cands = []
                    self._set(last_error=f"discovery failed: {e}")
                for t in cands:
                    self._set(state="connecting", port=t.name)
                    if await self._handshake(t):
                        break
                    t.close()
                else:
                    self._set(state="searching", port=None)
                    try:
                        await asyncio.wait_for(self._reconnect.wait(), self.cfg.reconnect_interval_s)
                    except asyncio.TimeoutError:
                        pass
                    self._reconnect.clear()
                    continue
            # connected: monitor link health
            await asyncio.sleep(self.cfg.heartbeat_interval_s)

    def _start_reader(self, t: Transport) -> None:
        self._reader_stop = threading.Event()
        stop = self._reader_stop

        def run() -> None:
            while not stop.is_set():
                try:
                    line = t.readline(0.1)
                except TransportClosed:
                    if self._loop and not stop.is_set():
                        self._loop.call_soon_threadsafe(self._drop_link, "device disconnected")
                    return
                if line:
                    self._loop.call_soon_threadsafe(self._on_line, t, line)

        self._reader = threading.Thread(target=run, name="hw-reader", daemon=True)
        self._reader.start()

    def _on_line(self, t: Transport, line: bytes) -> None:
        if t is not self._t:
            return
        msg = protocol.parse_line(line)
        if msg is None:
            return
        self._last_rx = time.monotonic()
        if isinstance(msg, str):
            if msg.startswith("READY") and "fw=" in msg:
                self.status.firmware = msg.split("fw=", 1)[1].split()[0]
            return
        fut = self._pending.pop(msg.seq, None)
        if fut and not fut.done():
            fut.set_result(msg)

    async def _handshake(self, t: Transport) -> bool:
        self._t = t
        self._last_rx = 0.0
        self._start_reader(t)
        deadline = time.monotonic() + self.cfg.handshake_timeout_s
        while time.monotonic() < deadline:
            try:
                r = await self._send("PING", timeout=self.cfg.ack_timeout_s, raw=True)
            except HardwareError:
                r = None
            if r is not None and r.ok:
                fw = r.fields.get("fw")
                self._last_rx = time.monotonic()
                self.status.simulated = bool(t.simulated)
                self._set(connected=True, state="connected", port=t.name, firmware=fw or self.status.firmware,
                          last_error=None, last_ack_ts=time.time())
                await self._sync_after_connect()
                self._hb_task = asyncio.create_task(self._heartbeat(t), name="hw-heartbeat")
                return True
            await asyncio.sleep(0.2)
        self._reader_stop.set()
        self._t = None
        self._set(last_error=f"{t.name}: no handshake reply")
        return False

    async def _sync_after_connect(self) -> None:
        """If an e-stop is latched on our side, make the device match; never auto-move servos."""
        if self.status.estop:
            await self._send("STOP", timeout=self.cfg.ack_timeout_s, raw=True)

    async def _heartbeat(self, t: Transport) -> None:
        try:
            while self._t is t and self.status.connected:
                await asyncio.sleep(self.cfg.heartbeat_interval_s)
                try:
                    await self._send("PING", timeout=self.cfg.ack_timeout_s, raw=True)
                except HardwareError:
                    pass
                if time.monotonic() - self._last_rx > self.cfg.link_timeout_s:
                    self._drop_link("link timeout (no reply from device)")
                    return
        except asyncio.CancelledError:
            pass

    def _drop_link(self, reason: str, state: str = "lost") -> None:
        """Tear down the link and enter the safe state: no commands accepted, outputs unknown."""
        t, self._t = self._t, None
        self._reader_stop.set()
        if t is not None:
            t.close()
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(HardwareError("link lost"))
        self._pending.clear()
        if not self.status.connected and state == "lost":
            return
        log.warning("hardware link down: %s", reason)
        self._set(connected=False, state=state, last_error=reason, simulated=False,
                  servos={k: None for k in self.status.servos}, led=None, buzzer=None)

    # ------------------------------------------------------------ commands
    async def _send(self, cmd: str, *args: object, timeout: float | None = None, raw: bool = False):
        """Low-level acknowledged send. Returns protocol.Reply; raises HardwareError on timeout/link loss."""
        t = self._t
        if t is None:
            raise HardwareError("not connected")
        self._seq = self._seq % 65535 + 1
        seq = self._seq
        fut = asyncio.get_running_loop().create_future()
        self._pending[seq] = fut
        try:
            with self._wlock:
                t.write(protocol.encode(seq, cmd, *args))
        except TransportClosed as e:
            self._pending.pop(seq, None)
            self._drop_link(f"write failed: {e}")
            raise HardwareError("link lost") from e
        try:
            return await asyncio.wait_for(fut, timeout or self.cfg.ack_timeout_s)
        except asyncio.TimeoutError:
            self._pending.pop(seq, None)
            raise HardwareError(f"{cmd}: no acknowledgement within {timeout or self.cfg.ack_timeout_s}s") from None

    async def _command(self, name: str, cmd: str, *args: object, allow_when_stopped: bool = False,
                       source: str = "manual") -> CommandResult:
        st = self.status
        if not self.cfg.enabled:
            raise HardwareError("hardware disabled")
        if not st.connected:
            raise HardwareError("Arduino not connected")
        if st.estop and not allow_when_stopped:
            raise HardwareError("hardware stop is latched; call reset-stop first")
        if source == "auto" and st.manual_override:
            raise HardwareError("manual override active; automatic commands suppressed")
        try:
            r = await self._send(cmd, *args)
        except HardwareError as e:
            self._set(last_error=str(e))
            return CommandResult(ok=False, command=name, detail=str(e), status=self.status.model_copy(deep=True))
        if r.ok:
            self.status.last_ack_ts = time.time()
            return CommandResult(ok=True, command=name, status=self.status.model_copy(deep=True))
        self._set(last_error=f"{name}: device error {r.error}")
        return CommandResult(ok=False, command=name, detail=f"device error {r.error}",
                             status=self.status.model_copy(deep=True))

    async def set_servo(self, servo_id: str, angle: int, source: str = "manual") -> CommandResult:
        if servo_id not in self.cfg.servo_ids:
            raise ValueError(f"unknown servo id {servo_id!r}; valid: {self.cfg.servo_ids}")
        if not self.cfg.servo_min_deg <= angle <= self.cfg.servo_max_deg:
            raise ValueError(f"angle {angle} outside [{self.cfg.servo_min_deg}, {self.cfg.servo_max_deg}]")
        res = await self._command(f"servo:{servo_id}", "SERVO", servo_id, angle, source=source)
        if res.ok:
            self.status.servos[servo_id] = angle
            self._publish()
            res.status = self.status.model_copy(deep=True)
        return res

    async def set_led(self, on: bool) -> CommandResult:
        res = await self._command("led", "LED", int(on))
        if res.ok:
            self._set(led=on)
            res.status = self.status.model_copy(deep=True)
        return res

    async def set_buzzer(self, on: bool, duration_ms: int | None = None) -> CommandResult:
        ms = (duration_ms or 200) if on else 0
        res = await self._command("buzzer", "BUZZ", ms)
        if res.ok:
            self._set(buzzer=on)
            res.status = self.status.model_copy(deep=True)
            if on and self._loop:
                self._loop.call_later(ms / 1000, self._clear_buzzer)
        return res

    def _clear_buzzer(self) -> None:
        if self.status.buzzer:
            self._set(buzzer=False)

    async def stop_hardware(self) -> CommandResult:
        """Hardware stop. Latches locally FIRST (fail-safe), then tells the device."""
        self._set(estop=True, led=None if not self.status.connected else False, buzzer=False)
        if not self.status.connected:
            return CommandResult(ok=False, command="stop", detail="latched locally; device not connected",
                                 status=self.status.model_copy(deep=True))
        return await self._command("stop", "STOP", allow_when_stopped=True)

    async def reset_stop(self) -> CommandResult:
        if not self.status.connected:
            raise HardwareError("Arduino not connected")
        res = await self._command("reset-stop", "RESUME", allow_when_stopped=True)
        if res.ok:
            self._set(estop=False)
            res.status = self.status.model_copy(deep=True)
        return res

    def set_override(self, enabled: bool) -> HardwareStatus:
        self._set(manual_override=enabled)
        return self.status

    def request_reconnect(self) -> None:
        if self._reconnect is not None:
            self._reconnect.set()
