"""Audio Priority Queue — guarantees one sound at a time and the adhan always wins.

Priorities (lower = more important):
  1 ADHAN        interrupts everything; only a privileged (Super Admin) stop can end it early.
  2 EMERGENCY    interrupts 3/4. During adhan it waits at the head of the queue — unless the system
                 policy allows it AND the command explicitly asks to interrupt (Super Admin only).
  3 ANNOUNCEMENT interrupts GENERAL (which is resumed afterwards).
  4 GENERAL

Equal/lower priority requests wait in an ordered queue (priority, then arrival) with a TTL.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Optional

from .player import Backend, BackendError
from .timeutil import iso

log = logging.getLogger("rec.controller")

RANK = {"ADHAN": 1, "EMERGENCY": 2, "ANNOUNCEMENT": 3, "GENERAL": 4}


@dataclass
class PlayItem:
    key: str
    source: str  # ADHAN | SCHEDULE | MANUAL | TEST
    priority: str  # ADHAN | EMERGENCY | ANNOUNCEMENT | GENERAL
    title: str
    path: Path
    file_id: Optional[str] = None
    volume: Optional[int] = None  # 0..100; None → device volume
    prayer: Optional[str] = None
    schedule_id: Optional[str] = None
    command_id: Optional[str] = None
    interrupt_adhan: bool = False
    offline: bool = False
    duration: float = 0.0
    resume_from: float = 0.0
    enqueued_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    seq: int = 0

    @property
    def rank(self) -> int:
        return RANK[self.priority]


@dataclass
class Policy:
    default_adhan_volume: int = 85
    post_adhan_behavior: str = "DISCARD"  # RESUME | RESTART | DISCARD
    post_adhan_quiet_minutes: int = 0
    emergency_may_interrupt_adhan: bool = False
    queued_item_ttl_minutes: int = 15

    @classmethod
    def from_config(cls, p: dict) -> "Policy":
        return cls(
            default_adhan_volume=int(p.get("defaultAdhanVolume", 85)),
            post_adhan_behavior=p.get("postAdhanBehavior", "DISCARD"),
            post_adhan_quiet_minutes=int(p.get("postAdhanQuietMinutes", 0)),
            emergency_may_interrupt_adhan=bool(p.get("emergencyMayInterruptAdhan", False)),
            queued_item_ttl_minutes=int(p.get("queuedItemTtlMinutes", 15)),
        )


@dataclass
class SubmitResult:
    state: str  # playing | queued | ignored | failed
    reason: Optional[str] = None
    position: Optional[int] = None


class AudioController:
    def __init__(
        self,
        backend: Backend,
        now: Callable[[], datetime],
        mono: Callable[[], float],
        emit: Callable[[dict], None],
        on_change: Callable[[], None] = lambda: None,
    ):
        self.backend = backend
        self._now = now
        self._mono = mono
        self._emit = emit
        self._on_change = on_change
        self.policy = Policy()
        self.device_volume = 60
        self.max_volume = 100
        self.current: Optional[PlayItem] = None
        self.queue: list[PlayItem] = []
        self.paused = False
        self._play_mono: float = 0.0  # mono time when (re)started, adjusted for pauses
        self._pause_mono: Optional[float] = None
        self._seq = 0
        self.quiet_until: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.last_played: Optional[dict] = None

    # ------------------------------------------------------------------ helpers
    def _effective_volume(self, item: PlayItem) -> int:
        if item.volume is not None:
            v = item.volume
        elif item.priority == "ADHAN":
            v = self.policy.default_adhan_volume
        else:
            v = self.device_volume
        return max(0, min(self.max_volume, int(v)))

    def position(self) -> float:
        if not self.current:
            return 0.0
        end = self._pause_mono if self._pause_mono is not None else self._mono()
        return max(0.0, end - self._play_mono) + self.current.resume_from

    def _event(self, item: PlayItem, status: str, error: Optional[str] = None, ended: bool = False) -> None:
        ev = {
            "eventKey": item.key,
            "source": item.source,
            "priority": item.priority,
            "fileId": item.file_id,
            "title": item.title,
            "prayer": item.prayer,
            "scheduleId": item.schedule_id,
            "commandId": item.command_id,
            "status": status,
            "error": error,
            "offline": item.offline,
            "startedAt": iso(item.started_at) if item.started_at else None,
            "endedAt": iso(self._now()) if ended else None,
        }
        try:
            self._emit(ev)
        except Exception:  # never let logging break playback
            log.exception("emit failed")

    def _active_keys(self) -> set[str]:
        keys = {i.key for i in self.queue}
        if self.current:
            keys.add(self.current.key)
        return keys

    def _enqueue(self, item: PlayItem, front: bool = False) -> int:
        self._seq += 1
        item.seq = -self._seq if front else self._seq
        if item.enqueued_at is None:
            item.enqueued_at = self._now()
        if item.expires_at is None and item.priority != "ADHAN":
            item.expires_at = item.enqueued_at + timedelta(minutes=self.policy.queued_item_ttl_minutes)
        self.queue.append(item)
        self.queue.sort(key=lambda i: (i.rank, i.seq))
        return self.queue.index(item)

    def _in_quiet(self, item: PlayItem) -> bool:
        return bool(self.quiet_until and item.rank >= RANK["ANNOUNCEMENT"] and self._now() < self.quiet_until)

    def _start(self, item: PlayItem) -> bool:
        vol = self._effective_volume(item)
        try:
            self.backend.start(item.path, vol / 100.0, item.resume_from)
        except (BackendError, Exception) as exc:  # noqa: BLE001
            msg = str(exc)
            self.last_error = msg
            log.error("playback failed for %s: %s", item.key, msg)
            if item.started_at is None:
                item.started_at = self._now()
            self._event(item, "FAILED", msg, ended=True)
            return False
        self.current = item
        self.paused = False
        self._pause_mono = None
        self._play_mono = self._mono()
        if item.started_at is None:
            item.started_at = self._now()
        self.last_error = None
        log.info("▶ %s [%s] %s vol=%s from=%.1fs", item.priority, item.source, item.title, vol, item.resume_from)
        self._event(item, "STARTED")
        return True

    def _interrupt_current(self, by: PlayItem) -> None:
        cur = self.current
        if not cur:
            return
        pos = self.position()
        self.backend.stop()
        self.current = None
        self.paused = False
        self._pause_mono = None
        if cur.priority == "ADHAN":
            self._event(cur, "INTERRUPTED", f"interrupted by {by.priority}", ended=True)
            return
        behavior = self.policy.post_adhan_behavior if by.priority == "ADHAN" else "RESUME"
        if behavior == "DISCARD":
            self._event(cur, "INTERRUPTED", f"interrupted by {by.priority}", ended=True)
            return
        cur.resume_from = pos if behavior == "RESUME" else 0.0
        cur.expires_at = None  # will be re-evaluated
        cur.enqueued_at = None
        self._enqueue(cur, front=True)
        log.info("⏸ %s requeued (%s at %.1fs)", cur.key, behavior, cur.resume_from)

    # ------------------------------------------------------------------ public API
    def submit(self, item: PlayItem) -> SubmitResult:
        if item.key in self._active_keys():
            return SubmitResult("ignored", "duplicate")
        cur = self.current
        if cur is None and not self.queue and not self._in_quiet(item):
            ok = self._start(item)
            self._on_change()
            return SubmitResult("playing" if ok else "failed", None if ok else self.last_error)

        if cur is not None:
            preempt = item.rank < cur.rank
            if cur.priority == "ADHAN" and item.priority == "EMERGENCY":
                preempt = item.interrupt_adhan and self.policy.emergency_may_interrupt_adhan
            if preempt:
                self._interrupt_current(item)
                ok = self._start(item)
                if not ok:
                    self._advance()
                self._on_change()
                return SubmitResult("playing" if ok else "failed", None if ok else self.last_error)

        # wait in the queue (emergency during adhan goes to the very front)
        front = item.priority == "EMERGENCY"
        pos = self._enqueue(item, front=front)
        reason = "quiet_period" if self._in_quiet(item) else ("adhan_in_progress" if cur and cur.priority == "ADHAN" else "busy")
        self._event(item, "QUEUED", reason)
        if cur is None:
            self._advance()
        self._on_change()
        return SubmitResult("queued" if self.current is not item else "playing", reason, pos)

    def stop(self, include_adhan: bool = False, clear_queue: bool = True) -> dict:
        stopped = None
        cur = self.current
        if cur and (cur.priority != "ADHAN" or include_adhan):
            self.backend.stop()
            self.current = None
            self.paused = False
            self._pause_mono = None
            self._event(cur, "INTERRUPTED", "stopped by user", ended=True)
            stopped = cur.key
        cleared = 0
        if clear_queue:
            keep = []
            for it in self.queue:
                if it.priority == "ADHAN" and not include_adhan:
                    keep.append(it)
                else:
                    self._event(it, "SKIPPED", "queue cleared by user", ended=True)
                    cleared += 1
            self.queue = keep
        if self.current is None:
            self._advance()
        self._on_change()
        return {"stopped": stopped, "cleared": cleared, "adhanProtected": bool(cur and cur.priority == "ADHAN" and not include_adhan)}

    def pause(self, privileged: bool = False) -> bool:
        if not self.current or self.paused:
            return False
        if self.current.priority == "ADHAN" and not privileged:
            return False
        self.backend.pause()
        self.paused = True
        self._pause_mono = self._mono()
        self._on_change()
        return True

    def resume(self) -> bool:
        if not self.current or not self.paused:
            return False
        self.backend.resume()
        assert self._pause_mono is not None
        self._play_mono += self._mono() - self._pause_mono
        self._pause_mono = None
        self.paused = False
        self._on_change()
        return True

    def set_volume(self, level: int) -> int:
        level = max(0, min(self.max_volume, int(level)))
        self.device_volume = level
        if self.current is not None:
            self.current.volume = level  # live change applies to what is playing now
            self.backend.set_volume(level / 100.0)
        self._on_change()
        return level

    def current_volume(self) -> int:
        return self._effective_volume(self.current) if self.current else self.device_volume

    def tick(self) -> None:
        """Call frequently (≈ every 250–500 ms): detects end of playback, expiries, quiet period end."""
        now = self._now()
        if self.current and not self.paused and not self.backend.is_busy():
            done = self.current
            self.current = None
            self.last_played = {"title": done.title, "priority": done.priority, "endedAt": iso(now)}
            self._event(done, "COMPLETED", ended=True)
            log.info("■ completed %s", done.key)
            if done.priority == "ADHAN" and self.policy.post_adhan_quiet_minutes > 0:
                self.quiet_until = now + timedelta(minutes=self.policy.post_adhan_quiet_minutes)
            self._advance()
            self._on_change()
        # expire stale queued items
        alive = []
        for it in self.queue:
            if it.expires_at and now > it.expires_at:
                self._event(it, "SKIPPED", "expired while waiting in queue", ended=True)
                self._on_change()
            else:
                alive.append(it)
        self.queue = alive
        if self.quiet_until and now >= self.quiet_until:
            self.quiet_until = None
        if self.current is None and self.queue:
            self._advance()

    def _advance(self) -> None:
        while self.current is None and self.queue:
            nxt = next((i for i in self.queue if not self._in_quiet(i)), None)
            if nxt is None:
                return
            self.queue.remove(nxt)
            if self._start(nxt):
                return

    def snapshot(self) -> dict:
        cur = self.current
        return {
            "state": "paused" if self.paused else ("playing" if cur else "idle"),
            "current": None
            if not cur
            else {
                "key": cur.key,
                "title": cur.title,
                "fileId": cur.file_id,
                "priority": cur.priority,
                "source": cur.source,
                "prayer": cur.prayer,
                "positionSec": round(self.position(), 1),
                "durationSec": round(cur.duration, 1),
                "startedAt": iso(cur.started_at) if cur.started_at else None,
            },
            "queue": [
                {"key": i.key, "title": i.title, "priority": i.priority, "source": i.source} for i in self.queue[:10]
            ],
            "volume": self.current_volume(),
            "deviceVolume": self.device_volume,
            "quietUntil": iso(self.quiet_until) if self.quiet_until else None,
            "lastPlayed": self.last_played,
        }
