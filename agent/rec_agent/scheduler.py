"""Local scheduler: fires adhan and scheduled announcements from the stored config —
no server or internet needed at fire time.

Duplicate protection: each occurrence has a deterministic key that is persisted (SQLite, fsync)
*before* playback starts. Restarts, clock jitter or repeated ticks can never replay it.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Optional

from .cache import FileCache
from .controller import AudioController, PlayItem
from .prayer_fallback import compute_day
from .recurrence import event_key, occurrence_at, occurs_on
from .store import Store
from .timeutil import add_days, iso, local_date, parse_iso

log = logging.getLogger("rec.scheduler")

STARTUP_LOOKBACK_MIN = 120
PRAYER_LABELS = {"FAJR": "أذان الفجر", "DHUHR": "أذان الظهر", "ASR": "أذان العصر", "MAGHRIB": "أذان المغرب", "ISHA": "أذان العشاء"}


@dataclass
class Candidate:
    key: str
    at: datetime
    kind: str  # adhan | schedule
    title: str
    file_id: Optional[str]
    priority: str
    volume: Optional[int]
    prayer: Optional[str] = None
    schedule_id: Optional[str] = None


class Scheduler:
    def __init__(
        self,
        store: Store,
        controller: AudioController,
        cache: FileCache,
        now: Callable[[], datetime],
        is_online: Callable[[], bool] = lambda: False,
    ):
        self.store = store
        self.controller = controller
        self.cache = cache
        self._now = now
        self._is_online = is_online
        self.cfg: Optional[dict] = None
        self._plan: dict[str, list[dict]] = {}
        self._fallback_cache: dict[str, list[dict]] = {}
        self._last_tick: Optional[datetime] = None
        self._last_alive_saved: Optional[datetime] = None
        self.using_fallback = False

    # ------------------------------------------------------------------ config
    def apply_config(self, cfg: dict) -> None:
        self.cfg = cfg
        plan: dict[str, list[dict]] = {}
        for e in cfg.get("prayer", {}).get("plan", []):
            plan.setdefault(e["date"], []).append({**e, "at": parse_iso(e["at"])})
        self._plan = plan
        self._fallback_cache.clear()

    @property
    def tz(self) -> str:
        return (self.cfg or {}).get("timezone", "Asia/Riyadh")

    def prayer_entries(self, date: str) -> list[dict]:
        if not self.cfg:
            return []
        if date in self._plan:
            return self._plan[date]
        if date not in self._fallback_cache:
            p = self.cfg.get("prayer", {})
            try:
                self._fallback_cache[date] = compute_day(date, p["params"], p.get("configs", []), p.get("overrides", []))
                log.warning("prayer plan does not cover %s — using local Umm al-Qura computation", date)
            except Exception:
                log.exception("fallback prayer computation failed for %s", date)
                self._fallback_cache[date] = []
        return self._fallback_cache[date]

    def prayer_lookup(self, date: str, prayer: str) -> Optional[datetime]:
        for e in self.prayer_entries(date):
            if e["prayer"] == prayer:
                return e["at"]
        return None

    def candidates_for(self, date: str) -> list[Candidate]:
        out: list[Candidate] = []
        if not self.cfg:
            return out
        for e in self.prayer_entries(date):
            if not e.get("adhanEnabled", True):
                continue
            out.append(
                Candidate(
                    key=e["key"],
                    at=e["at"],
                    kind="adhan",
                    title=PRAYER_LABELS.get(e["prayer"], e["prayer"]),
                    file_id=e.get("fileId"),
                    priority="ADHAN",
                    volume=e.get("volume"),
                    prayer=e["prayer"],
                )
            )
        files = {f["id"]: f for f in self.cfg.get("files", [])}
        for s in self.cfg.get("schedules", []):
            if s.get("isPaused") or not occurs_on(s, date):
                continue
            at = occurrence_at(s, date, self.tz, self.prayer_lookup)
            if at is None:
                continue
            out.append(
                Candidate(
                    key=event_key(s, date, at, self.tz),
                    at=at,
                    kind="schedule",
                    title=s.get("name") or files.get(s["fileId"], {}).get("title", "إعلان مجدول"),
                    file_id=s["fileId"],
                    priority=s.get("priority", "ANNOUNCEMENT"),
                    volume=s.get("volume"),
                    schedule_id=s["id"],
                )
            )
        return out

    def upcoming(self, limit: int = 5) -> list[dict]:
        now = self._now()
        today = local_date(now, self.tz)
        cands = [c for d in (today, add_days(today, 1)) for c in self.candidates_for(d) if c.at > now]
        cands.sort(key=lambda c: c.at)
        return [{"key": c.key, "title": c.title, "at": iso(c.at), "priority": c.priority} for c in cands[:limit]]

    def plan_covers_today(self) -> bool:
        return local_date(self._now(), self.tz) in self._plan

    # ------------------------------------------------------------------ tick
    async def tick(self) -> list[str]:
        """Fire every due, not-yet-executed event. Returns keys acted upon."""
        if not self.cfg:
            return []
        now = self._now()
        policy = self.cfg.get("policy", {})
        adhan_grace = timedelta(minutes=int(policy.get("adhanCatchUpMinutes", 3)))
        sched_grace = timedelta(minutes=int(policy.get("scheduleCatchUpMinutes", 5)))
        if self._last_tick is None or now - self._last_tick > timedelta(hours=6) or now < self._last_tick - timedelta(hours=6):
            # First tick after (re)start: only look at the time the agent was actually down.
            # Events before `last_alive` were already handled (or were not known yet) while we ran.
            last_alive = self.store.get("last_alive")
            if last_alive:
                down_since = datetime.fromtimestamp(float(last_alive), tz=now.tzinfo)
                window_start = max(now - timedelta(minutes=STARTUP_LOOKBACK_MIN), down_since)
            else:  # very first start on this machine: catch-up window only
                window_start = now - max(adhan_grace, sched_grace)
        else:
            window_start = min(self._last_tick, now) - timedelta(seconds=1)
        self._last_tick = now
        if self._last_alive_saved is None or (now - self._last_alive_saved).total_seconds() >= 15 or now < self._last_alive_saved:
            self.store.put("last_alive", now.timestamp())
            self._last_alive_saved = now
        self.using_fallback = not self.plan_covers_today()

        today = local_date(now, self.tz)
        due = [
            c
            for d in (add_days(today, -1), today)
            for c in self.candidates_for(d)
            if window_start < c.at <= now
        ]
        due.sort(key=lambda c: (c.at, 0 if c.kind == "adhan" else 1))
        acted: list[str] = []
        for c in due:
            if self.store.is_executed(c.key):
                continue
            if not self.store.try_mark_executed(c.key):
                continue
            acted.append(c.key)
            late = now - c.at
            grace = adhan_grace if c.kind == "adhan" else sched_grace
            if late > grace:
                log.warning("missed %s (late by %s) — marking SKIPPED", c.key, late)
                self._emit_simple(c, "SKIPPED", f"لم يُشغَّل: الجهاز كان متوقفًا وقت الحدث (تأخر {int(late.total_seconds() // 60)} دقيقة)")
                continue
            await self._fire(c)
        return acted

    async def _fire(self, c: Candidate) -> None:
        if not c.file_id:
            self._emit_simple(c, "FAILED", "لم يُحدَّد ملف صوتي لهذا الحدث")
            return
        path = self.cache.path_for(c.file_id)
        if path is None or not path.exists():
            try:
                path = await asyncio.wait_for(self.cache.ensure(c.file_id), timeout=20)
            except Exception as exc:  # offline and not cached
                self._emit_simple(c, "FAILED", f"الملف غير متوفر محليًا: {exc}")
                return
        item = PlayItem(
            key=c.key,
            source="ADHAN" if c.kind == "adhan" else "SCHEDULE",
            priority=c.priority,
            title=c.title,
            path=path,
            file_id=c.file_id,
            volume=c.volume,
            prayer=c.prayer,
            schedule_id=c.schedule_id,
            offline=not self._is_online(),
            duration=self.cache.duration(c.file_id),
        )
        res = self.controller.submit(item)
        log.info("fired %s → %s %s", c.key, res.state, res.reason or "")

    def _emit_simple(self, c: Candidate, status: str, error: str) -> None:
        self.controller._emit(  # noqa: SLF001 — same event channel
            {
                "eventKey": c.key,
                "source": "ADHAN" if c.kind == "adhan" else "SCHEDULE",
                "priority": c.priority,
                "fileId": c.file_id,
                "title": c.title,
                "prayer": c.prayer,
                "scheduleId": c.schedule_id,
                "commandId": None,
                "status": status,
                "error": error,
                "offline": not self._is_online(),
                "startedAt": None,
                "endedAt": iso(self._now()),
            }
        )
