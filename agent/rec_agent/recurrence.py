"""Schedule occurrence logic — mirrors server/src/services/recurrence.ts."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable, Optional

from .timeutil import local_time, weekday_of, zoned_to_utc

PrayerLookup = Callable[[str, str], Optional[datetime]]


def occurs_on(s: dict, date: str) -> bool:
    if date < s["startDate"]:
        return False
    if s.get("endDate") and date > s["endDate"]:
        return False
    rec = s["recurrence"]
    if rec == "ONCE":
        return date == s["startDate"]
    if rec == "DAILY":
        return True
    if rec == "WEEKLY":
        return weekday_of(date) in (s.get("daysOfWeek") or [])
    return False


def occurrence_at(s: dict, date: str, tzname: str, prayers: PrayerLookup) -> Optional[datetime]:
    if s.get("anchor", "FIXED_TIME") == "FIXED_TIME":
        if not s.get("time"):
            return None
        return zoned_to_utc(date, s["time"], tzname)
    prayer = s.get("anchorPrayer")
    if not prayer:
        return None
    base = prayers(date, prayer)
    if base is None:
        return None
    return base + timedelta(minutes=int(s.get("anchorOffsetMinutes") or 0))


def event_key(s: dict, date: str, at: datetime, tzname: str) -> str:
    return f"sched:{s['id']}:{date}T{local_time(at, tzname)}"
