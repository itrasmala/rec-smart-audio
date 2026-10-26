"""Watchdog + systemd notify.

- The asyncio loop calls `beat()` every second.
- A separate OS thread checks the beat. If the loop is stuck for longer than `timeout`
  the process exits with code 70 → systemd (Restart=always) / NSSM restart it.
- On systemd with WatchdogSec, `beat()` also sends WATCHDOG=1, so a frozen process is
  killed by systemd even if the thread itself were blocked.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time

log = logging.getLogger("rec.watchdog")


def sd_notify(state: str) -> bool:
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr or not hasattr(socket, "AF_UNIX"):
        return False
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
            s.connect(addr)
            s.sendall(state.encode())
        return True
    except OSError:
        return False


class Watchdog:
    def __init__(self, timeout: float = 90.0, on_timeout=None):
        self.timeout = timeout
        self._last = time.monotonic()
        self._stop = threading.Event()
        self._on_timeout = on_timeout or self._default_timeout
        self._thread = threading.Thread(target=self._run, name="watchdog", daemon=True)
        self.lag_ms = 0.0
        self._expected_next: float | None = None

    def start(self) -> None:
        sd_notify("READY=1")
        self._thread.start()

    def beat(self) -> None:
        now = time.monotonic()
        if self._expected_next is not None:
            self.lag_ms = max(0.0, (now - self._expected_next) * 1000)
        self._expected_next = now + 1.0
        self._last = now
        sd_notify("WATCHDOG=1")

    def status(self, text: str) -> None:
        sd_notify(f"STATUS={text}")

    def stop(self) -> None:
        sd_notify("STOPPING=1")
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.wait(5):
            stale = time.monotonic() - self._last
            if stale > self.timeout:
                self._on_timeout(stale)
                return

    @staticmethod
    def _default_timeout(stale: float) -> None:
        log.critical("main loop unresponsive for %.0fs — exiting so the service manager restarts the agent", stale)
        logging.shutdown()
        os._exit(70)
