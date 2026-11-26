"""Arduino serial wire protocol v1 (ASCII, newline-terminated, 115200 8N1 by default).

Host -> device request:     #<seq> <CMD> [args...]\n        seq: 1..65535, echoed in the reply
Device -> host reply:       @<seq> OK [key=value ...]\n   |   @<seq> ERR <code>\n
Device -> host unsolicited: ! <text>\n                      (e.g. "! READY fw=1.0.0")

Commands
  PING                 -> OK fw=<version>            (also the heartbeat)
  SERVO <id> <deg>     -> OK                         id is a name like pan/tilt, deg 0..180
  LED <0|1>            -> OK
  BUZZ <ms>            -> OK                         0 = off; otherwise sound for <ms> (firmware caps it)
  STOP                 -> OK                         safe stop: buzzer+LED off, servos held/detached, outputs
                                                     LATCHED OFF until RESUME
  RESUME               -> OK                         clear the STOP latch
  STATUS               -> OK servo.pan=90 servo.tilt=90 led=0 buzz=0 stop=0

Error codes: BADCMD, BADARG, RANGE, STOPPED (output command while latched), BUSY.

Firmware watchdog requirement (safe behaviour when the link dies): if no valid request
arrives for 2000 ms the firmware must behave as if STOP was received (buzzer/LED off,
servo motion halted). The host sends PING every 500 ms.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Reply:
    seq: int
    ok: bool
    fields: dict[str, str]
    error: str | None = None


def encode(seq: int, cmd: str, *args: object) -> bytes:
    parts = [f"#{seq}", cmd, *[str(a) for a in args]]
    return (" ".join(parts) + "\n").encode("ascii")


def parse_line(raw: bytes) -> Reply | str | None:
    """Return Reply for '@..' lines, the text for '! ..' lines, None for garbage."""
    try:
        line = raw.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError:
        return None
    if line.startswith("!"):
        return line[1:].strip()
    if not line.startswith("@"):
        return None
    toks = line[1:].split()
    if len(toks) < 2 or not toks[0].isdigit():
        return None
    seq = int(toks[0])
    if toks[1] == "OK":
        fields = {}
        for t in toks[2:]:
            k, _, v = t.partition("=")
            fields[k] = v
        return Reply(seq, True, fields)
    if toks[1] == "ERR":
        return Reply(seq, False, {}, toks[2] if len(toks) > 2 else "UNKNOWN")
    return None
