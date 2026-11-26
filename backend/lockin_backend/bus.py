"""Tiny asyncio pub/sub with bounded, drop-oldest subscriber queues so a slow
WebSocket client can never back-pressure producers."""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any


class Subscription:
    def __init__(self, maxsize: int, types: set[str] | None):
        self.types = types
        self._q: deque[Any] = deque(maxlen=maxsize)
        self._ev = asyncio.Event()
        self.dropped = 0

    def push(self, item: Any) -> None:
        if len(self._q) == self._q.maxlen:
            self.dropped += 1
        self._q.append(item)
        self._ev.set()

    async def get(self) -> Any:
        while not self._q:
            self._ev.clear()
            await self._ev.wait()
        return self._q.popleft()


class Bus:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, maxsize: int = 64, types: set[str] | None = None) -> Subscription:
        s = Subscription(maxsize, types)
        self._subs.add(s)
        return s

    def unsubscribe(self, s: Subscription) -> None:
        self._subs.discard(s)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    def publish(self, msg_type: str, payload: Any) -> None:
        """Must be called on the event loop thread."""
        for s in tuple(self._subs):
            if s.types is None or msg_type in s.types:
                s.push(payload)

    def publish_threadsafe(self, msg_type: str, payload: Any) -> None:
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self.publish, msg_type, payload)
