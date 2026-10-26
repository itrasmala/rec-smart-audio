"""REC Audio Agent — ties together connection, scheduler, controller, cache, bluetooth, watchdog."""
from __future__ import annotations

import asyncio
import json
import logging
import platform
import random
import socket
import ssl
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from . import __version__
from .bluetooth import BluetoothManager
from .cache import FileCache
from .controller import AudioController, PlayItem, Policy
from .player import Backend, NullBackend, PygameBackend
from .scheduler import PRAYER_LABELS, Scheduler
from .settings import AgentSettings
from .store import Store
from .timeutil import Clock, iso, parse_iso
from .tone import make_test_tone, wav_duration
from .watchdog import Watchdog

log = logging.getLogger("rec.agent")


class Agent:
    def __init__(self, settings: AgentSettings, clock: Optional[Clock] = None, backend: Optional[Backend] = None):
        self.s = settings
        self.clock = clock or Clock()
        self.started = time.monotonic()
        self.data_dir = settings.data_dir
        self.store = Store(self.data_dir / "agent.db")
        self.cache = FileCache(self.data_dir / "cache", settings.server_url, settings.token, settings.tls_verify)
        self.tone_path = make_test_tone(self.data_dir / "cache" / "_test_tone.wav")

        if backend is None:
            if settings.backend == "null":
                backend = NullBackend(self._duration_of)
            else:
                backend = PygameBackend(settings.output_device or None, settings.fallback_to_default_output)
        self.backend = backend

        self.controller = AudioController(
            backend, now=self.clock.now, mono=time.monotonic, emit=self._on_event, on_change=self._on_change
        )
        self.controller.device_volume = int(self.store.get("device_volume", 60))
        self.scheduler = Scheduler(self.store, self.controller, self.cache, self.clock.now, is_online=lambda: self.online)
        self.bt = BluetoothManager(settings.bluetooth_mac or None, settings.bluetooth_auto_reconnect)
        self.watchdog = Watchdog(settings.watchdog_timeout)

        self.ws: Any = None
        self.online = False
        self.internet_ok: Optional[bool] = None
        self.server_skew_sec: float = 0.0
        self.config_revision: int = 0
        self.last_connect_error: Optional[str] = None
        self._outputs: list[str] = []
        self._status_dirty = asyncio.Event()
        self._events_dirty = asyncio.Event()
        self._stop = asyncio.Event()
        self._send_lock = asyncio.Lock()
        self._bg: set[asyncio.Task] = set()

        cfg = self.store.get("config")
        if cfg:
            self._apply_config(cfg, from_disk=True)

    # ------------------------------------------------------------------ helpers
    def _duration_of(self, path: Path) -> float:
        if path == self.tone_path or path.suffix == ".wav":
            try:
                return wav_duration(path)
            except Exception:
                pass
        for fid, m in self.cache.meta.items():
            if self.cache.path_for(fid) == path:
                return float(m.get("durationSec") or 1.0)
        return 1.0

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._bg.add(t)
        t.add_done_callback(self._bg.discard)
        return t

    def _on_event(self, ev: dict) -> None:
        self.store.save_event(ev)
        try:
            self._events_dirty.set()
        except RuntimeError:
            pass

    def _on_change(self) -> None:
        try:
            self._status_dirty.set()
        except RuntimeError:
            pass

    # ------------------------------------------------------------------ config
    def _apply_config(self, cfg: dict, from_disk: bool = False) -> None:
        self.config_revision = int(cfg.get("revision", 0))
        self.cache.set_files(cfg.get("files", []))
        self.scheduler.apply_config(cfg)
        self.controller.policy = Policy.from_config(cfg.get("policy", {}))
        dev = cfg.get("device", {})
        self.controller.max_volume = int(dev.get("maxVolume", 100))
        if not from_disk and dev.get("volume") is not None:
            self.controller.device_volume = min(int(dev["volume"]), self.controller.max_volume)
            self.store.put("device_volume", self.controller.device_volume)
        if not self.s.bluetooth_mac:
            self.bt.set_mac(dev.get("bluetoothMac"))
        wanted = self.s.output_device or dev.get("outputDeviceName") or None
        if isinstance(self.backend, PygameBackend) and wanted != getattr(self.backend, "_preferred", None):
            self._switch_output(wanted)
        log.info("config revision %s applied (%d schedules, %d files)%s", self.config_revision,
                 len(cfg.get("schedules", [])), len(cfg.get("files", [])), " [from disk]" if from_disk else "")

    def _switch_output(self, name: Optional[str]) -> Optional[str]:
        """Change output device; if something is playing, restart it at the same position."""
        cur = self.controller.current
        pos = self.controller.position() if cur else 0.0
        if cur:
            self.backend.stop()
        actual = self.backend.set_output(name)
        if cur:
            cur.resume_from = pos
            self.controller.current = None
            self.controller._start(cur)  # noqa: SLF001
        self._on_change()
        return actual

    async def _handle_config(self, cfg: dict) -> None:
        self.store.put("config", cfg)
        self._apply_config(cfg)
        ok, failed = await self.cache.sync(only_essential=not self.s.cache_all_files)
        removed = self.cache.gc()
        log.info("cache sync: %d downloaded, %d failed, %d removed", ok, failed, removed)
        await self._send({"type": "config_applied", "revision": self.config_revision, "cache": self.cache.stats()})
        self._on_change()

    # ------------------------------------------------------------------ status
    def output_state(self) -> dict:
        ok, err = self.backend.health()
        return {
            "name": self.backend.current_output(),
            "preferred": getattr(self.backend, "_preferred", None),
            "ok": ok,
            "error": err,
            "backend": self.backend.name,
        }

    def status(self) -> dict:
        out = self.output_state()
        errors = [out["error"], self.controller.last_error, self.bt.last_error if self.bt.enabled else None, self.cache.last_error]
        if abs(self.server_skew_sec) > 30:
            errors.append(f"ساعة الجهاز تختلف عن الخادم بـ {int(self.server_skew_sec)} ثانية — فعّل مزامنة الوقت (NTP)")
        cfg = self.scheduler.cfg or {}
        return {
            "type": "status",
            **self.controller.snapshot(),
            "output": out,
            "bluetooth": self.bt.snapshot(),
            "internet": self.internet_ok,
            "serverConnected": self.online,
            "serverClockSkewSec": round(self.server_skew_sec, 1),
            "configRevision": self.config_revision,
            "planUntil": cfg.get("prayer", {}).get("planUntil"),
            "usingFallbackPrayerTimes": self.scheduler.using_fallback,
            "cache": self.cache.stats(),
            "nextEvents": self.scheduler.upcoming(5),
            "unsyncedEvents": self.store.unsynced_count(),
            "uptimeSec": int(time.monotonic() - self.started),
            "agentTime": iso(self.clock.now()),
            "loopLagMs": round(self.watchdog.lag_ms, 1),
            "lastError": next((e for e in errors if e), None),
            "version": __version__,
            "outputs": self._outputs,
        }

    # ------------------------------------------------------------------ commands
    async def handle_command(self, msg: dict) -> dict:
        cid = str(msg.get("id"))
        ctype = msg.get("command")
        p = msg.get("payload") or {}
        if self.store.command_seen(cid):
            return {"ok": True, "result": {"duplicate": True}}
        try:
            exp = parse_iso(msg["expiresAt"]) if msg.get("expiresAt") else None
        except Exception:
            exp = None
        # compare in server time: local_now + skew
        if exp and self.clock.now() + timedelta(seconds=self.server_skew_sec) > exp:
            return {"ok": False, "error": "انتهت صلاحية الأمر قبل وصوله"}

        privileged = bool(p.get("privileged"))
        c = self.controller

        if ctype == "play":
            fid = p["fileId"]
            try:
                path = await asyncio.wait_for(self.cache.ensure(fid, p.get("sha256"), p.get("format")), timeout=30)
            except Exception as exc:
                return {"ok": False, "error": f"الملف غير متوفر على الجهاز: {exc}"}
            vol = p.get("volume")
            if vol is not None:
                vol = min(int(vol), int(p.get("maxVolume", 100)))
            item = PlayItem(
                key=f"cmd:{cid}", source="MANUAL", priority=p.get("priority", "ANNOUNCEMENT"), title=p.get("title") or "تشغيل يدوي",
                path=path, file_id=fid, volume=vol, command_id=cid, interrupt_adhan=bool(p.get("interruptAdhan")) and privileged,
                duration=self.cache.duration(fid),
            )
            r = c.submit(item)
            return {"ok": r.state in ("playing", "queued"), "error": None if r.state != "failed" else r.reason,
                    "result": {"state": r.state, "reason": r.reason, "position": r.position}}
        if ctype == "stop":
            r = c.stop(include_adhan=bool(p.get("includeAdhan")) and privileged, clear_queue=bool(p.get("clearQueue", True)))
            return {"ok": True, "result": r}
        if ctype == "pause":
            ok = c.pause(privileged=privileged)
            return {"ok": ok, "error": None if ok else ("لا يوجد تشغيل حالي" if not c.current else "لا يمكن إيقاف الأذان مؤقتًا")}
        if ctype == "resume":
            ok = c.resume()
            return {"ok": ok, "error": None if ok else "لا يوجد تشغيل متوقف مؤقتًا"}
        if ctype in ("volume", "volume_step"):
            limit = int(p.get("maxVolume", c.max_volume))
            level = c.set_volume(min(int(p["level"]), limit))
            self.store.put("device_volume", level)
            return {"ok": True, "result": {"volume": level}}
        if ctype == "test_speakers":
            item = PlayItem(key=f"test:{cid}", source="TEST", priority="ANNOUNCEMENT", title="اختبار السماعات",
                            path=self.tone_path, volume=None, command_id=cid, duration=wav_duration(self.tone_path))
            r = c.submit(item)
            return {"ok": r.state in ("playing", "queued"), "result": {"state": r.state, "reason": r.reason}, "error": r.reason if r.state == "failed" else None}
        if ctype == "adhan_test":
            prayer = p.get("prayer", "DHUHR")
            cfgs = {x["prayer"]: x for x in (self.scheduler.cfg or {}).get("prayer", {}).get("configs", [])}
            pc = cfgs.get(prayer) or {}
            if not pc.get("fileId"):
                return {"ok": False, "error": "لم يُحدَّد ملف أذان لهذه الصلاة"}
            try:
                path = await asyncio.wait_for(self.cache.ensure(pc["fileId"]), timeout=30)
            except Exception as exc:
                return {"ok": False, "error": f"ملف الأذان غير متوفر: {exc}"}
            item = PlayItem(key=f"test:{cid}", source="TEST", priority="ADHAN", title=f"اختبار {PRAYER_LABELS.get(prayer, prayer)}",
                            path=path, file_id=pc["fileId"], volume=pc.get("volume"), prayer=prayer, command_id=cid,
                            duration=self.cache.duration(pc["fileId"]))
            r = c.submit(item)
            return {"ok": r.state in ("playing", "queued"), "result": {"state": r.state, "reason": r.reason}}
        if ctype == "bt_reconnect":
            ok = await self.bt.reconnect(force=True)
            if ok and isinstance(self.backend, PygameBackend):
                self._switch_output(getattr(self.backend, "_preferred", None))
            return {"ok": ok, "error": None if ok else self.bt.last_error}
        if ctype == "set_output":
            actual = self._switch_output(p.get("deviceName"))
            ok, err = self.backend.health()
            return {"ok": ok, "error": err, "result": {"output": actual}}
        if ctype == "sync":
            await self._send({"type": "request_config"})
            self._events_dirty.set()
            return {"ok": True}
        return {"ok": False, "error": f"أمر غير مدعوم: {ctype}"}

    # ------------------------------------------------------------------ connection
    async def _send(self, msg: dict) -> bool:
        ws = self.ws
        if ws is None:
            return False
        try:
            async with self._send_lock:
                await ws.send(json.dumps(msg, ensure_ascii=False, default=str))
            return True
        except Exception as exc:
            log.debug("send failed: %s", exc)
            return False

    def _ssl_context(self):
        if not self.s.server_url.startswith("https://"):
            return None
        if isinstance(self.s.tls_verify, str):
            return ssl.create_default_context(cafile=self.s.tls_verify)
        if self.s.tls_verify is False:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        return ssl.create_default_context()

    async def connection_loop(self) -> None:
        from websockets.asyncio.client import connect
        from websockets.exceptions import InvalidStatus

        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with connect(
                    self.s.ws_url,
                    additional_headers={"Authorization": f"Bearer {self.s.token}"},
                    ssl=self._ssl_context(),
                    open_timeout=15,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=5,
                    max_size=16 * 1024 * 1024,
                    user_agent_header=f"REC-Audio-Agent/{__version__}",
                ) as ws:
                    self.ws = ws
                    self.online = True
                    self.last_connect_error = None
                    backoff = 1.0
                    log.info("connected to server %s", self.s.server_url)
                    outputs = self._outputs = self.backend.list_outputs()
                    await self._send({
                        "type": "hello", "version": __version__, "os": f"{platform.system()} {platform.release()}",
                        "hostname": socket.gethostname(), "outputs": outputs, "configRevision": self.config_revision,
                    })
                    self._events_dirty.set()
                    self._status_dirty.set()
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except ValueError:
                            continue
                        await self._dispatch(msg)
            except InvalidStatus as exc:
                code = getattr(exc.response, "status_code", 0)
                self.last_connect_error = f"رفض الخادم الاتصال (HTTP {code}) — تحقق من رمز الجهاز" if code in (401, 403) else f"HTTP {code}"
                log.error(self.last_connect_error)
                backoff = 60.0 if code in (401, 403) else backoff
            except (OSError, asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
                self.last_connect_error = f"{type(exc).__name__}: {exc}"
                log.warning("connection lost/failed: %s", self.last_connect_error)
            finally:
                if self.online:
                    log.warning("disconnected from server — continuing offline with local schedule")
                self.ws = None
                self.online = False
                self._on_change()
            if self._stop.is_set():
                break
            delay = min(60.0, backoff) * (0.8 + random.random() * 0.4)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
            backoff = min(60.0, backoff * 2)

    async def _dispatch(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "welcome":
            try:
                self.server_skew_sec = (parse_iso(msg["serverTime"]) - self.clock.now()).total_seconds()
                if abs(self.server_skew_sec) > 30:
                    log.warning("clock skew vs server: %.0fs — enable NTP time sync!", self.server_skew_sec)
            except Exception:
                pass
        elif t == "config":
            self._spawn(self._handle_config(msg))
        elif t == "command":
            self._spawn(self._run_command(msg))
        elif t == "events_ack":
            self.store.mark_synced(list(msg.get("keys") or []), self._last_events_sent_at)
        else:
            log.debug("ignoring message type %s", t)

    _last_events_sent_at: Optional[float] = None

    async def _run_command(self, msg: dict) -> None:
        try:
            res = await self.handle_command(msg)
        except Exception as exc:  # noqa: BLE001
            log.exception("command failed")
            res = {"ok": False, "error": str(exc)}
        log.info("command %s %s → %s", msg.get("command"), msg.get("id"), "ok" if res.get("ok") else res.get("error"))
        await self._send({"type": "ack", "commandId": msg.get("id"), **res})
        self._on_change()

    async def events_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._events_dirty.wait(), timeout=15)
            except asyncio.TimeoutError:
                pass
            self._events_dirty.clear()
            if not self.online:
                continue
            batch = self.store.unsynced_events(200)
            if batch:
                self._last_events_sent_at = time.time()
                await self._send({"type": "events", "events": batch})

    async def status_loop(self) -> None:
        last_sent = 0.0
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._status_dirty.wait(), timeout=self.s.status_interval)
            except asyncio.TimeoutError:
                pass
            self._status_dirty.clear()
            # coalesce bursts
            wait = 0.3 - (time.monotonic() - last_sent)
            if wait > 0:
                await asyncio.sleep(wait)
            if self.online:
                await self._send(self.status())
                last_sent = time.monotonic()

    # ------------------------------------------------------------------ periodic
    async def tick_loop(self) -> None:
        """Heart of the agent: 4 Hz controller tick, 1 Hz scheduler tick + watchdog beat."""
        n = 0
        while not self._stop.is_set():
            try:
                self.controller.tick()
                if n % 4 == 0:
                    await self.scheduler.tick()
                    self.watchdog.beat()
            except Exception:
                log.exception("tick failed")
            n += 1
            await asyncio.sleep(0.25)

    async def health_loop(self) -> None:
        n = 0
        while not self._stop.is_set():
            try:
                self.internet_ok = self.online or await self._tcp_check(self.s.internet_check)
                # output / bluetooth supervision
                if isinstance(self.backend, PygameBackend):
                    ok, _ = self.backend.health()
                    if not ok:
                        if self.bt.enabled and self.bt.auto_reconnect:
                            await self.bt.reconnect()
                        if self.backend.preferred_available() and self.controller.current is None:
                            self._switch_output(getattr(self.backend, "_preferred", None))
                if self.bt.enabled and n % max(1, int(self.s.bluetooth_check_interval // 10)) == 0:
                    connected = await self.bt.is_connected()
                    if connected is False and self.bt.auto_reconnect:
                        if await self.bt.reconnect() and isinstance(self.backend, PygameBackend):
                            self._switch_output(getattr(self.backend, "_preferred", None))
                if n % 6 == 0 and self.controller.current is None:
                    self._outputs = self.backend.list_outputs()
                if n % 360 == 0:
                    self.store.prune()
                if n % 30 == 0 and self.online and self.cache.missing(only_essential=not self.s.cache_all_files):
                    await self.cache.sync(only_essential=not self.s.cache_all_files)
                self.watchdog.status(
                    f"{'online' if self.online else 'OFFLINE'} | {self.controller.snapshot()['state']} | rev {self.config_revision}"
                )
            except Exception:
                log.exception("health check failed")
            n += 1
            self._on_change()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=10)
            except asyncio.TimeoutError:
                pass

    @staticmethod
    async def _tcp_check(hostport: str, timeout: float = 4.0) -> bool:
        try:
            host, port = hostport.rsplit(":", 1)
            _, w = await asyncio.wait_for(asyncio.open_connection(host, int(port)), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def health_server(self) -> None:
        """Local-only HTTP endpoint (127.0.0.1) for monitoring tools: GET /health → JSON status."""
        if not self.s.health_port:
            return

        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            try:
                await asyncio.wait_for(reader.readline(), 5)
                st = self.status()
                healthy = st["output"]["ok"] and self.scheduler.cfg is not None
                body = json.dumps({"healthy": healthy, **st}, ensure_ascii=False, default=str).encode()
                code = "200 OK" if healthy else "503 Service Unavailable"
                writer.write(f"HTTP/1.1 {code}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
                await writer.drain()
            except Exception:
                pass
            finally:
                writer.close()

        try:
            server = await asyncio.start_server(handle, "127.0.0.1", self.s.health_port)
        except OSError as exc:
            log.warning("health endpoint disabled: %s", exc)
            return
        async with server:
            await self._stop.wait()

    # ------------------------------------------------------------------ lifecycle
    async def run(self) -> None:
        self._status_dirty = asyncio.Event()
        self._events_dirty = asyncio.Event()
        self._stop = asyncio.Event()
        self.watchdog.start()
        if not self.scheduler.cfg:
            log.warning("no stored config yet — waiting for first connection to the server")
        else:
            log.info("running from stored config (revision %s) — adhan works even without network", self.config_revision)
        tasks = [
            asyncio.create_task(self.tick_loop(), name="tick"),
            asyncio.create_task(self.connection_loop(), name="connection"),
            asyncio.create_task(self.events_loop(), name="events"),
            asyncio.create_task(self.status_loop(), name="status"),
            asyncio.create_task(self.health_loop(), name="health"),
            asyncio.create_task(self.health_server(), name="health-http"),
        ]
        await self._stop.wait()
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def request_stop(self) -> None:
        self._stop.set()

    def close(self) -> None:
        self.watchdog.stop()
        try:
            self.backend.stop()
            self.backend.close()
        finally:
            self.store.close()
