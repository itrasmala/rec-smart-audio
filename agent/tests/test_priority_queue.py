"""Audio Priority Queue: adhan > emergency > announcement > general, never overlapping."""
from rec_agent.controller import PlayItem, Policy


def item(h, key, priority, seconds=10.0, source="MANUAL", **kw):
    return PlayItem(key=key, source=source, priority=priority, title=key, path=h.file(key, seconds), duration=seconds, **kw)


def test_single_play_completes(harness):
    h = harness()
    r = h.controller.submit(item(h, "g1", "GENERAL", 5))
    assert r.state == "playing"
    h.advance(6)
    assert h.statuses("g1") == ["STARTED", "COMPLETED"]
    assert h.controller.current is None


def test_adhan_interrupts_general_and_discards_by_default(harness):
    h = harness()
    h.controller.submit(item(h, "music", "GENERAL", 60))
    h.advance(10)
    r = h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    assert r.state == "playing"
    assert h.controller.current.key == "adhan"
    assert h.statuses("music")[-1] == "INTERRUPTED"
    h.advance(31)
    assert h.statuses("adhan")[-1] == "COMPLETED"
    assert h.controller.current is None  # DISCARD → nothing resumes


def test_adhan_then_resume_from_same_position(harness):
    h = harness()
    h.controller.policy = Policy(post_adhan_behavior="RESUME")
    h.controller.submit(item(h, "music", "GENERAL", 60))
    h.advance(20)
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    h.advance(31)
    cur = h.controller.current
    assert cur is not None and cur.key == "music"
    assert 19.0 <= cur.resume_from <= 21.0
    assert h.backend.started[-1][2] == cur.resume_from  # backend asked to seek


def test_adhan_then_restart_from_beginning(harness):
    h = harness()
    h.controller.policy = Policy(post_adhan_behavior="RESTART")
    h.controller.submit(item(h, "ann", "ANNOUNCEMENT", 60))
    h.advance(20)
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    h.advance(31)
    assert h.controller.current.key == "ann"
    assert h.controller.current.resume_from == 0.0


def test_no_overlap_equal_priority_waits(harness):
    h = harness()
    h.controller.submit(item(h, "a1", "ANNOUNCEMENT", 10))
    r = h.controller.submit(item(h, "a2", "ANNOUNCEMENT", 10))
    assert r.state == "queued"
    assert h.controller.current.key == "a1"
    h.advance(11)
    assert h.controller.current.key == "a2"
    h.advance(11)
    assert h.statuses("a1")[-1] == "COMPLETED" and h.statuses("a2")[-1] == "COMPLETED"
    # never more than one STARTED without an end in between
    open_ = 0
    for e in h.events:
        if e["status"] == "STARTED":
            open_ += 1
            assert open_ == 1
        elif e["status"] in ("COMPLETED", "INTERRUPTED", "FAILED"):
            open_ = max(0, open_ - 1)


def test_announcement_interrupts_general_and_general_resumes(harness):
    h = harness()
    h.controller.submit(item(h, "music", "GENERAL", 100))
    h.advance(30)
    h.controller.submit(item(h, "ann", "ANNOUNCEMENT", 10))
    assert h.controller.current.key == "ann"
    h.advance(11)
    assert h.controller.current.key == "music"
    assert h.controller.current.resume_from >= 29


def test_emergency_waits_for_adhan_by_default(harness):
    h = harness()
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    r = h.controller.submit(item(h, "fire", "EMERGENCY", 10, interrupt_adhan=True))
    assert r.state == "queued" and r.reason == "adhan_in_progress"
    assert h.controller.current.key == "adhan"
    h.advance(31)
    assert h.controller.current.key == "fire"  # plays right after adhan


def test_emergency_jumps_ahead_of_announcements_in_queue(harness):
    h = harness()
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    h.controller.submit(item(h, "ann", "ANNOUNCEMENT", 10))
    h.controller.submit(item(h, "fire", "EMERGENCY", 10))
    assert [i.key for i in h.controller.queue] == ["fire", "ann"]


def test_emergency_may_interrupt_adhan_only_when_policy_and_flag(harness):
    h = harness()
    h.controller.policy = Policy(emergency_may_interrupt_adhan=True)
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    r = h.controller.submit(item(h, "fire-noflag", "EMERGENCY", 10))
    assert r.state == "queued"
    r = h.controller.submit(item(h, "fire", "EMERGENCY", 10, interrupt_adhan=True))
    assert r.state == "playing" and h.controller.current.key == "fire"
    assert h.statuses("adhan")[-1] == "INTERRUPTED"


def test_stop_protects_adhan_unless_privileged(harness):
    h = harness()
    h.controller.submit(item(h, "adhan", "ADHAN", 30, source="ADHAN"))
    res = h.controller.stop(include_adhan=False)
    assert res["adhanProtected"] and h.controller.current.key == "adhan"
    assert not h.controller.pause(privileged=False)
    res = h.controller.stop(include_adhan=True)
    assert res["stopped"] == "adhan" and h.controller.current is None


def test_pause_resume_keeps_position(harness):
    h = harness()
    h.controller.submit(item(h, "ann", "ANNOUNCEMENT", 20))
    h.advance(5)
    assert h.controller.pause()
    h.advance(60)  # long pause must not finish the item
    assert h.controller.current.key == "ann"
    assert 4.5 <= h.controller.position() <= 5.5
    assert h.controller.resume()
    h.advance(16)
    assert h.statuses("ann")[-1] == "COMPLETED"


def test_queued_item_expires(harness):
    h = harness()
    h.controller.policy = Policy(queued_item_ttl_minutes=1)
    h.controller.submit(item(h, "long", "ANNOUNCEMENT", 300))
    h.controller.submit(item(h, "late", "GENERAL", 10))
    h.advance(70)
    assert h.statuses("late")[-1] == "SKIPPED"


def test_quiet_period_after_adhan_holds_announcements(harness):
    h = harness()
    h.controller.policy = Policy(post_adhan_quiet_minutes=2)
    h.controller.submit(item(h, "adhan", "ADHAN", 10, source="ADHAN"))
    h.advance(11)
    r = h.controller.submit(item(h, "ann", "ANNOUNCEMENT", 5))
    assert r.state == "queued" and r.reason == "quiet_period"
    h.advance(60)
    assert h.controller.current is None
    h.advance(65)
    assert h.statuses("ann")[-1] in ("STARTED", "COMPLETED")


def test_duplicate_key_ignored(harness):
    h = harness()
    h.controller.submit(item(h, "x", "ANNOUNCEMENT", 10))
    assert h.controller.submit(item(h, "x", "ANNOUNCEMENT", 10)).state == "ignored"


def test_backend_failure_reports_and_moves_on(harness):
    h = harness()
    h.backend.fail_next = True
    r = h.controller.submit(item(h, "bad", "ANNOUNCEMENT", 10))
    assert r.state == "failed"
    assert h.statuses("bad") == ["FAILED"]
    assert h.controller.submit(item(h, "good", "ANNOUNCEMENT", 10)).state == "playing"


def test_volume_limits(harness):
    h = harness()
    h.controller.max_volume = 70
    assert h.controller.set_volume(95) == 70
    h.controller.policy = Policy(default_adhan_volume=90)
    h.controller.submit(item(h, "adhan", "ADHAN", 10, source="ADHAN"))
    assert h.backend.volume == 0.70  # adhan volume is also capped by device max
