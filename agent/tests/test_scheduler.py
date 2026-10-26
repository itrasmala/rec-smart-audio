"""Local scheduling: adhan at prayer time, announcements, duplicates, restarts, offline fallback."""
from datetime import datetime, timedelta, timezone

import pytest

from rec_agent.controller import AudioController
from rec_agent.scheduler import Scheduler
from rec_agent.store import Store
from rec_agent.timeutil import iso

UTC = timezone.utc
TZ = "Asia/Riyadh"
PARAMS = {"latitude": 24.7136, "longitude": 46.6753, "timezone": TZ, "method": "UMM_AL_QURA", "madhab": "SHAFI", "ramadanIshaExtra": True}


def plan_entry(date, prayer, at, file_id="adhan-file", enabled=True, volume=None):
    return {"key": f"adhan:{date}:{prayer}", "date": date, "prayer": prayer, "at": iso(at), "adhanEnabled": enabled, "fileId": file_id, "volume": volume}


def make_config(h, plan, schedules=(), policy=None, files=None):
    files = files or []
    # register files in cache so the scheduler finds them locally
    cfg = {
        "revision": 1,
        "timezone": TZ,
        "device": {"volume": 60, "maxVolume": 100},
        "policy": {"adhanCatchUpMinutes": 3, "scheduleCatchUpMinutes": 5, **(policy or {})},
        "prayer": {"params": PARAMS, "configs": [{"prayer": p, "adhanEnabled": True, "fileId": "adhan-file", "volume": None, "offsetMinutes": 0, "fixedTime": None} for p in ("FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA")], "overrides": [], "plan": plan, "planUntil": max((e["date"] for e in plan), default=None)},
        "schedules": list(schedules),
        "files": files,
    }
    h.cache.set_files(files)
    for f in files:
        p = h.cache.path_for(f["id"])
        p.write_bytes(b"ID3x")
        h.durations[p.stem.split("_")[0]] = f["durationSec"]
    h.scheduler.apply_config(cfg)
    return cfg


FILES = [
    {"id": "adhan-file", "sha256": "aaaa", "format": "mp3", "title": "أذان", "durationSec": 180, "essential": True},
    {"id": "welcome", "sha256": "bbbb", "format": "mp3", "title": "ترحيب", "durationSec": 20, "essential": True},
    {"id": "admin", "sha256": "cccc", "format": "mp3", "title": "إعلان إداري", "durationSec": 1200, "essential": True},
    {"id": "endday", "sha256": "dddd", "format": "mp3", "title": "نهاية الدوام", "durationSec": 15, "essential": True},
]


def sched(id_, file_id, time=None, recurrence="DAILY", priority="ANNOUNCEMENT", **kw):
    base = {"id": id_, "name": id_, "fileId": file_id, "priority": priority, "recurrence": recurrence, "daysOfWeek": [], "anchor": "FIXED_TIME", "time": time, "anchorPrayer": None, "anchorOffsetMinutes": 0, "startDate": "2026-01-01", "endDate": None, "volume": None, "isPaused": False}
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_adhan_fires_exactly_once_at_prayer_time(harness):
    # 2026-10-25 Dhuhr Riyadh 11:37 = 08:37Z
    h = harness(start=datetime(2026, 10, 25, 8, 35, tzinfo=UTC))
    dhuhr = datetime(2026, 10, 25, 8, 37, tzinfo=UTC)
    make_config(h, [plan_entry("2026-10-25", "DHUHR", dhuhr)], files=FILES)
    await h.scheduler.tick()
    await h.run(110)  # 08:36:50
    assert h.statuses("adhan:2026-10-25:DHUHR") == []
    await h.run(15)  # crosses 08:37
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["STARTED"]
    started = next(e for e in h.events if e["status"] == "STARTED")
    assert abs((datetime.fromisoformat(started["startedAt"].replace("Z", "+00:00")) - dhuhr).total_seconds()) <= 1.0
    await h.run(200)
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["STARTED", "COMPLETED"]


@pytest.mark.asyncio
async def test_user_example_day(harness):
    """07:00 welcome, 12:00 admin announcement, Dhuhr adhan interrupts, 16:00 end-of-day."""
    h = harness(start=datetime(2026, 10, 25, 3, 59, tzinfo=UTC))  # 06:59 local
    # make Dhuhr fall during the admin announcement: 12:05 local = 09:05Z
    dhuhr = datetime(2026, 10, 25, 9, 5, tzinfo=UTC)
    make_config(
        h,
        [plan_entry("2026-10-25", "DHUHR", dhuhr)],
        schedules=[sched("s-welcome", "welcome", "07:00"), sched("s-admin", "admin", "12:00"), sched("s-end", "endday", "16:00")],
        files=FILES,
    )
    await h.scheduler.tick()
    await h.run(90, step=1)
    assert h.statuses("sched:s-welcome:2026-10-25T07:00")[0] == "STARTED"
    h.clock.set(datetime(2026, 10, 25, 8, 59, 50, tzinfo=UTC))
    await h.run(20, step=1)
    assert h.statuses("sched:s-admin:2026-10-25T12:00") == ["STARTED"]
    h.clock.set(datetime(2026, 10, 25, 9, 4, 55, tzinfo=UTC))
    await h.run(10, step=1)
    assert h.controller.current.key == "adhan:2026-10-25:DHUHR"
    assert h.statuses("sched:s-admin:2026-10-25T12:00")[-1] == "INTERRUPTED"
    h.clock.set(datetime(2026, 10, 25, 12, 59, 55, tzinfo=UTC))
    await h.run(10, step=1)
    assert h.statuses("sched:s-end:2026-10-25T16:00")[0] == "STARTED"


@pytest.mark.asyncio
async def test_no_duplicate_after_restart_same_store(harness, tmp_path):
    h = harness(start=datetime(2026, 10, 25, 8, 36, 50, tzinfo=UTC))
    dhuhr = datetime(2026, 10, 25, 8, 37, tzinfo=UTC)
    cfg = make_config(h, [plan_entry("2026-10-25", "DHUHR", dhuhr)], files=FILES)
    await h.scheduler.tick()
    await h.run(20)
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["STARTED"]
    # simulate crash/restart 30 s later: brand-new controller & scheduler, same SQLite store
    h.clock.advance(30)
    h.events.clear()
    store2 = Store(tmp_path / "agent.db")
    ctrl2 = AudioController(h.backend, now=h.clock.now, mono=lambda: h.clock.now().timestamp(), emit=h.events.append)
    sch2 = Scheduler(store2, ctrl2, h.cache, h.clock.now)
    sch2.apply_config(cfg)
    await sch2.tick()
    assert h.events == []  # adhan was NOT replayed


@pytest.mark.asyncio
async def test_catch_up_after_short_outage(harness):
    # device boots 2 minutes after Dhuhr → within 3 min grace → plays
    h = harness(start=datetime(2026, 10, 25, 8, 39, tzinfo=UTC))
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC))], files=FILES)
    await h.scheduler.tick()
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["STARTED"]


@pytest.mark.asyncio
async def test_missed_beyond_grace_is_skipped_not_played(harness):
    h = harness(start=datetime(2026, 10, 25, 8, 50, tzinfo=UTC))
    # the agent was last alive at 08:30 (powered off before Dhuhr, back at 08:50)
    h.store.put("last_alive", datetime(2026, 10, 25, 8, 30, tzinfo=UTC).timestamp())
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC))], files=FILES)
    await h.scheduler.tick()
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["SKIPPED"]
    assert h.controller.current is None


@pytest.mark.asyncio
async def test_disabled_prayer_does_not_play(harness):
    h = harness(start=datetime(2026, 10, 25, 8, 36, 50, tzinfo=UTC))
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC), enabled=False)], files=FILES)
    await h.scheduler.tick()
    await h.run(30)
    assert h.events == []


@pytest.mark.asyncio
async def test_missing_adhan_file_reports_failed(harness):
    h = harness(start=datetime(2026, 10, 25, 8, 36, 50, tzinfo=UTC))
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC), file_id=None)], files=FILES)
    await h.scheduler.tick()
    await h.run(20)
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["FAILED"]


@pytest.mark.asyncio
async def test_weekly_paused_and_date_range(harness):
    # 2026-10-25 is a Sunday (0)
    h = harness(start=datetime(2026, 10, 25, 3, 59, 50, tzinfo=UTC))
    make_config(
        h,
        [],
        schedules=[
            sched("weekly-sun", "welcome", "07:00", recurrence="WEEKLY", daysOfWeek=[0]),
            sched("weekly-mon", "welcome", "07:00", recurrence="WEEKLY", daysOfWeek=[1]),
            sched("paused", "welcome", "07:00", isPaused=True),
            sched("ended", "welcome", "07:00", endDate="2026-10-24"),
            sched("future", "welcome", "07:00", startDate="2026-10-26"),
            sched("once", "welcome", "07:00", recurrence="ONCE", startDate="2026-10-25"),
        ],
        files=FILES,
    )
    h.scheduler.prayer_entries = lambda d: []  # no prayers in this test
    await h.scheduler.tick()
    await h.run(20)
    fired = {e["scheduleId"] for e in h.events}
    assert fired == {"weekly-sun", "once"}


@pytest.mark.asyncio
async def test_prayer_anchored_schedule(harness):
    h = harness(start=datetime(2026, 10, 25, 8, 26, 50, tzinfo=UTC))
    dhuhr = datetime(2026, 10, 25, 8, 37, tzinfo=UTC)
    make_config(
        h,
        [plan_entry("2026-10-25", "DHUHR", dhuhr)],
        schedules=[sched("pre-dhuhr", "welcome", None, anchor="PRAYER", anchorPrayer="DHUHR", anchorOffsetMinutes=-10)],
        files=FILES,
    )
    await h.scheduler.tick()
    await h.run(20)
    assert h.statuses("sched:pre-dhuhr:2026-10-25T11:27") == ["STARTED"]


@pytest.mark.asyncio
async def test_fallback_when_plan_missing(harness):
    """Device offline longer than the plan horizon: computes Umm al-Qura locally."""
    h = harness(start=datetime(2027, 3, 1, 8, 0, tzinfo=UTC))
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC))], files=FILES)
    entries = h.scheduler.prayer_entries("2027-03-01")
    assert [e["prayer"] for e in entries] == ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"]
    dhuhr = next(e for e in entries if e["prayer"] == "DHUHR")["at"]
    h.clock.set(dhuhr - timedelta(seconds=5))
    await h.scheduler.tick()
    await h.run(10)
    assert h.statuses("adhan:2027-03-01:DHUHR") == ["STARTED"]
    assert h.scheduler.using_fallback


@pytest.mark.asyncio
async def test_two_prayers_events_same_second_play_in_order(harness):
    """Adhan and a schedule at the same instant: adhan first, schedule waits (no overlap)."""
    h = harness(start=datetime(2026, 10, 25, 8, 36, 55, tzinfo=UTC))
    dhuhr = datetime(2026, 10, 25, 8, 37, tzinfo=UTC)
    make_config(h, [plan_entry("2026-10-25", "DHUHR", dhuhr)], schedules=[sched("same", "welcome", "11:37")], files=FILES)
    await h.scheduler.tick()
    await h.run(10)
    assert h.controller.current.key == "adhan:2026-10-25:DHUHR"
    assert h.statuses("sched:same:2026-10-25T11:37") == ["QUEUED"]


@pytest.mark.asyncio
async def test_events_before_last_alive_are_not_reported_as_missed(harness):
    """A schedule added after its time today must not be logged as 'missed' after a restart."""
    h = harness(start=datetime(2026, 10, 25, 8, 50, tzinfo=UTC))
    h.store.put("last_alive", datetime(2026, 10, 25, 8, 49, 50, tzinfo=UTC).timestamp())  # quick restart
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC))], files=FILES)
    await h.scheduler.tick()
    assert h.events == []


@pytest.mark.asyncio
async def test_power_cut_during_adhan_window_resumes_within_grace(harness):
    """Power cut at 08:36, back at 08:38:30 → Dhuhr (08:37) still within the 3-min grace → plays once."""
    h = harness(start=datetime(2026, 10, 25, 8, 38, 30, tzinfo=UTC))
    h.store.put("last_alive", datetime(2026, 10, 25, 8, 36, tzinfo=UTC).timestamp())
    make_config(h, [plan_entry("2026-10-25", "DHUHR", datetime(2026, 10, 25, 8, 37, tzinfo=UTC))], files=FILES)
    await h.scheduler.tick()
    await h.run(5)
    assert h.statuses("adhan:2026-10-25:DHUHR") == ["STARTED"]
