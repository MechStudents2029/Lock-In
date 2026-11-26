import asyncio

import pytest

from lockin_backend.hardware.protocol import encode, parse_line
from lockin_backend.hardware.service import HardwareError, HardwareService
from lockin_backend.hardware.transport import FakeArduino


async def wait_for(cond, t=3.0):
    end = asyncio.get_event_loop().time() + t
    while asyncio.get_event_loop().time() < end:
        if cond():
            return True
        await asyncio.sleep(0.02)
    return False


def test_protocol_roundtrip():
    assert encode(7, "SERVO", "pan", 90) == b"#7 SERVO pan 90\n"
    r = parse_line(b"@7 OK fw=1.2\n")
    assert r.seq == 7 and r.ok and r.fields["fw"] == "1.2"
    e = parse_line(b"@8 ERR RANGE\n")
    assert not e.ok and e.error == "RANGE"
    assert parse_line(b"! READY") == "READY"
    assert parse_line(b"junk") is None and parse_line(b"\xff\xfe") is None


@pytest.fixture
async def hw(settings):
    devices = []

    def factory():
        d = FakeArduino()
        devices.append(d)
        return d

    svc = HardwareService(settings.hardware, transport_factory=factory)
    svc.devices = devices
    await svc.start()
    assert await wait_for(lambda: svc.status.connected)
    yield svc
    await svc.stop()


async def test_connect_and_servo_ack(hw):
    assert hw.status.simulated and hw.status.firmware == "sim-1.0"
    r = await hw.set_servo("pan", 45)
    assert r.ok and hw.status.servos["pan"] == 45 and hw.devices[-1].servo["pan"] == 45


async def test_led_buzzer(hw):
    assert (await hw.set_led(True)).ok and hw.status.led is True
    assert (await hw.set_buzzer(True, 50)).ok and hw.status.buzzer is True
    assert await wait_for(lambda: hw.status.buzzer is False)


async def test_validation(hw):
    with pytest.raises(ValueError):
        await hw.set_servo("pan", 181)
    with pytest.raises(ValueError):
        await hw.set_servo("nope", 10)


async def test_estop_latches_and_blocks(hw):
    assert (await hw.stop_hardware()).ok
    assert hw.status.estop and hw.devices[-1].stopped
    with pytest.raises(HardwareError, match="latched"):
        await hw.set_servo("pan", 10)
    assert (await hw.reset_stop()).ok and not hw.status.estop
    assert (await hw.set_servo("pan", 10)).ok


async def test_manual_override_blocks_auto_only(hw):
    hw.set_override(True)
    with pytest.raises(HardwareError, match="override"):
        await hw.set_servo("pan", 20, source="auto")
    assert (await hw.set_servo("pan", 20, source="manual")).ok


async def test_ack_timeout_reports_failure_not_success(hw):
    hw.devices[-1].drop_acks = True
    r = await hw.set_servo("pan", 33)
    assert not r.ok and "no acknowledgement" in r.detail
    assert hw.status.servos["pan"] != 33


async def test_unplug_enters_safe_state_and_reconnects(hw):
    await hw.set_servo("pan", 60)
    hw.devices[-1].kill()
    assert await wait_for(lambda: not hw.status.connected)
    assert hw.status.servos["pan"] is None
    with pytest.raises(HardwareError, match="not connected"):
        await hw.set_servo("pan", 70)
    assert await wait_for(lambda: hw.status.connected, 5)  # factory yields a fresh device
    assert len(hw.devices) >= 2


async def test_silent_link_times_out(settings):
    dev = {}

    def factory():
        d = FakeArduino()
        dev["d"] = d
        return d

    svc = HardwareService(settings.hardware, transport_factory=factory)
    await svc.start()
    assert await wait_for(lambda: svc.status.connected)
    dev["d"].drop_acks = True  # device stays plugged in but stops answering
    assert await wait_for(lambda: not svc.status.connected, 3)
    await svc.stop()


async def test_estop_while_disconnected_is_latched_locally(settings):
    svc = HardwareService(settings.hardware, transport_factory=lambda: None)
    await svc.start()
    r = await svc.stop_hardware()
    assert not r.ok and svc.status.estop
    await svc.stop()


async def test_estop_resent_after_reconnect(settings):
    devs = []

    def factory():
        d = FakeArduino()
        devs.append(d)
        return d

    svc = HardwareService(settings.hardware, transport_factory=factory)
    await svc.start()
    assert await wait_for(lambda: svc.status.connected)
    await svc.stop_hardware()
    devs[0].kill()
    assert await wait_for(lambda: len(devs) >= 2 and svc.status.connected, 5)
    assert devs[1].stopped  # latch re-applied to the new device
    await svc.stop()
