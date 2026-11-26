"""Byte transports: real pyserial, and a clearly-labelled in-process simulated Arduino."""
from __future__ import annotations

import queue
import threading
import time
from typing import Protocol

from . import protocol

KNOWN_USB_VIDS = {0x2341, 0x2A03, 0x1A86, 0x0403, 0x10C4}  # Arduino, CH340, FTDI, CP210x


class TransportClosed(Exception):
    pass


class Transport(Protocol):
    name: str
    simulated: bool

    def write(self, data: bytes) -> None: ...
    def readline(self, timeout: float) -> bytes | None:
        """Return one line, None on timeout; raise TransportClosed when the device is gone."""
    def close(self) -> None: ...


def discover_ports(preferred: str = "auto") -> list[str]:
    """Candidate serial ports, best first. A configured port is used verbatim."""
    if preferred and preferred != "auto":
        return [preferred]
    from serial.tools import list_ports
    scored: list[tuple[int, str]] = []
    for p in list_ports.comports():
        desc = f"{p.description} {p.manufacturer or ''}".lower()
        score = 0
        if p.vid in KNOWN_USB_VIDS:
            score += 2
        if any(k in desc for k in ("arduino", "ch340", "ch341", "usb serial", "usb-serial")):
            score += 1
        if score:
            scored.append((score, p.device))
    return [d for _, d in sorted(scored, key=lambda x: (-x[0], x[1]))]


class SerialTransport:
    simulated = False

    def __init__(self, port: str, baudrate: int):
        import serial
        self._serial_mod = serial
        self.name = port
        self._ser = serial.Serial(port, baudrate, timeout=0.05, write_timeout=0.5)
        self._buf = bytearray()
        try:
            self._ser.reset_input_buffer()
        except Exception:  # noqa: BLE001
            pass

    def write(self, data: bytes) -> None:
        try:
            self._ser.write(data)
        except (self._serial_mod.SerialException, OSError) as e:
            raise TransportClosed(str(e)) from e

    def readline(self, timeout: float) -> bytes | None:
        deadline = time.monotonic() + timeout
        while True:
            i = self._buf.find(b"\n")
            if i >= 0:
                line = bytes(self._buf[: i + 1])
                del self._buf[: i + 1]
                return line
            if time.monotonic() >= deadline:
                return None
            try:
                chunk = self._ser.read(self._ser.in_waiting or 1)
            except (self._serial_mod.SerialException, OSError) as e:
                raise TransportClosed(str(e)) from e
            if chunk:
                self._buf += chunk
                if len(self._buf) > 4096:  # garbage flood guard
                    self._buf.clear()

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:  # noqa: BLE001
            pass


class FakeArduino:
    """SIMULATED device speaking protocol v1. Used by tests and `hardware.mock: true`."""
    simulated = True
    name = "SIMULATED"

    def __init__(self, drop_acks: bool = False, boot_delay_s: float = 0.0, ids=("pan", "tilt")):
        self._rx: "queue.Queue[bytes | None]" = queue.Queue()
        self.drop_acks = drop_acks
        self.closed = False
        self.dead = False
        self.log: list[str] = []
        self.servo = {i: 90 for i in ids}
        self.led = 0
        self.buzz = 0
        self.stopped = False
        self._boot_until = time.monotonic() + boot_delay_s
        self._last_cmd = time.monotonic()
        self._rx.put(b"! READY fw=sim-1.0\n")

    def kill(self) -> None:
        """Simulate cable unplug."""
        self.dead = True
        self._rx.put(None)

    def write(self, data: bytes) -> None:
        if self.dead or self.closed:
            raise TransportClosed("device gone")
        if time.monotonic() < self._boot_until:
            return  # still booting: bytes are lost, like a real DTR reset
        for line in data.decode().splitlines():
            self.log.append(line)
            self._handle(line)

    def _reply(self, seq: str, body: str) -> None:
        if not self.drop_acks:
            self._rx.put(f"@{seq} {body}\n".encode())

    def _handle(self, line: str) -> None:
        toks = line.lstrip("#").split()
        if len(toks) < 2:
            return
        seq, cmd, args = toks[0], toks[1], toks[2:]
        self._last_cmd = time.monotonic()
        if cmd == "PING":
            self._reply(seq, "OK fw=sim-1.0")
        elif cmd == "STOP":
            self.stopped, self.led, self.buzz = True, 0, 0
            self._reply(seq, "OK")
        elif cmd == "RESUME":
            self.stopped = False
            self._reply(seq, "OK")
        elif cmd == "STATUS":
            s = " ".join(f"servo.{k}={v}" for k, v in self.servo.items())
            self._reply(seq, f"OK {s} led={self.led} buzz={int(self.buzz > 0)} stop={int(self.stopped)}")
        elif cmd in ("SERVO", "LED", "BUZZ"):
            if self.stopped:
                return self._reply(seq, "ERR STOPPED")
            try:
                if cmd == "SERVO":
                    sid, deg = args[0], int(args[1])
                    if sid not in self.servo:
                        return self._reply(seq, "ERR BADARG")
                    if not 0 <= deg <= 180:
                        return self._reply(seq, "ERR RANGE")
                    self.servo[sid] = deg
                elif cmd == "LED":
                    self.led = int(args[0])
                else:
                    self.buzz = int(args[0])
            except (IndexError, ValueError):
                return self._reply(seq, "ERR BADARG")
            self._reply(seq, "OK")
        else:
            self._reply(seq, "ERR BADCMD")

    def readline(self, timeout: float) -> bytes | None:
        if self.dead:
            raise TransportClosed("device gone")
        try:
            item = self._rx.get(timeout=timeout)
        except queue.Empty:
            return None
        if item is None:
            raise TransportClosed("device gone")
        return item

    def close(self) -> None:
        self.closed = True


_ = protocol  # re-export convenience
