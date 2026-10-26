"""Bluetooth speaker reconnection (best effort, depends on OS support).

Important: a web page can never talk to Bluetooth speakers directly. Pairing is done once in the
operating system of the Audio Agent machine; this module only *re-connects* an already-paired
speaker when the link drops (speaker power cycle, range, interference).

Linux   — BlueZ via `bluetoothctl` (works for user services with PipeWire/PulseAudio).
Windows — there is no supported public API to force an A2DP reconnect. We toggle the paired
          device's PnP nodes (Disable/Enable-PnpDevice), which requires the service to run with
          administrative rights. Detection relies on the audio endpoint disappearing.
"""
from __future__ import annotations

import asyncio
import logging
import platform
import re
import time
from typing import Optional

log = logging.getLogger("rec.bluetooth")
MAC_RE = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")


async def _run(*args: str, timeout: float = 25) -> tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
    except FileNotFoundError:
        return 127, f"{args[0]} not found"
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "timeout"
    return proc.returncode or 0, out.decode(errors="replace")


class BluetoothManager:
    def __init__(self, mac: Optional[str] = None, auto_reconnect: bool = True, min_interval: float = 30.0):
        self.mac: Optional[str] = None
        self.set_mac(mac)
        self.auto_reconnect = auto_reconnect
        self.min_interval = min_interval
        self.connected: Optional[bool] = None
        self.last_attempt: float = 0.0
        self.last_error: Optional[str] = None
        self.reconnects = 0
        self.system = platform.system()

    def set_mac(self, mac: Optional[str]) -> None:
        mac = (mac or "").strip().upper() or None
        if mac and not MAC_RE.match(mac):
            log.warning("ignoring invalid bluetooth MAC %r", mac)
            mac = None
        self.mac = mac

    @property
    def enabled(self) -> bool:
        return self.mac is not None

    async def is_connected(self) -> Optional[bool]:
        if not self.mac:
            return None
        if self.system == "Linux":
            code, out = await _run("bluetoothctl", "info", self.mac, timeout=10)
            if code != 0:
                self.last_error = "bluetoothctl غير متاح أو الجهاز غير مقترن" if code in (1, 127) else out.strip()[:200]
                self.connected = False
                return False
            self.connected = bool(re.search(r"Connected:\s*yes", out))
            return self.connected
        if self.system == "Windows":
            mac = self.mac.replace(":", "")
            ps = (
                "$d = Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | "
                f"Where-Object {{ $_.InstanceId -match '{mac}' -or $_.HardwareID -match '{mac}' }}; "
                "if ($d | Where-Object { $_.Status -eq 'OK' }) { 'CONNECTED' } else { 'DISCONNECTED' }"
            )
            code, out = await _run("powershell", "-NoProfile", "-NonInteractive", "-Command", ps, timeout=20)
            self.connected = "CONNECTED" in out and "DISCONNECTED" not in out
            return self.connected
        return None

    async def reconnect(self, force: bool = False) -> bool:
        if not self.mac:
            self.last_error = "لم يُحدَّد عنوان MAC لسماعة البلوتوث"
            return False
        now = time.monotonic()
        if not force and now - self.last_attempt < self.min_interval:
            return False
        self.last_attempt = now
        self.reconnects += 1
        log.info("attempting bluetooth reconnect to %s", self.mac)
        if self.system == "Linux":
            await _run("bluetoothctl", "power", "on", timeout=10)
            code, out = await _run("bluetoothctl", "connect", self.mac, timeout=30)
            ok = code == 0 and ("Connection successful" in out or "already connected" in out.lower())
        elif self.system == "Windows":
            mac = self.mac.replace(":", "")
            ps = (
                f"$d = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {{ $_.InstanceId -match '{mac}' }}; "
                "foreach ($x in $d) { Disable-PnpDevice -InstanceId $x.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }; "
                "Start-Sleep -Seconds 2; "
                "foreach ($x in $d) { Enable-PnpDevice -InstanceId $x.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }; "
                "'DONE'"
            )
            code, out = await _run("powershell", "-NoProfile", "-NonInteractive", "-Command", ps, timeout=45)
            await asyncio.sleep(4)
            ok = bool(await self.is_connected())
        else:
            out, ok = "unsupported OS", False
        self.connected = ok
        self.last_error = None if ok else f"فشل إعادة الاتصال بالبلوتوث: {out.strip()[:200]}"
        (log.info if ok else log.warning)("bluetooth reconnect %s", "succeeded" if ok else f"failed: {out.strip()[:200]}")
        return ok

    def snapshot(self) -> dict:
        return {
            "mac": self.mac,
            "connected": self.connected,
            "autoReconnect": self.auto_reconnect,
            "reconnects": self.reconnects,
            "error": self.last_error,
        }
