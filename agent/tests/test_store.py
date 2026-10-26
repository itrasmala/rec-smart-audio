import time

from rec_agent.store import Store


def test_executed_is_atomic_and_persistent(tmp_path):
    s = Store(tmp_path / "a.db")
    assert s.try_mark_executed("adhan:2026-10-25:DHUHR")
    assert not s.try_mark_executed("adhan:2026-10-25:DHUHR")
    s.close()
    s2 = Store(tmp_path / "a.db")
    assert s2.is_executed("adhan:2026-10-25:DHUHR")


def test_event_sync_does_not_lose_later_updates(tmp_path):
    s = Store(tmp_path / "a.db")
    s.save_event({"eventKey": "k1", "status": "STARTED"})
    sent_at = time.time()
    time.sleep(0.05)
    s.save_event({"eventKey": "k1", "status": "COMPLETED"})  # changed after being sent
    s.mark_synced(["k1"], sent_at)
    pending = s.unsynced_events()
    assert len(pending) == 1 and pending[0]["status"] == "COMPLETED"
    s.mark_synced(["k1"], time.time())
    assert s.unsynced_events() == []


def test_commands_idempotent(tmp_path):
    s = Store(tmp_path / "a.db")
    assert s.command_seen("c1") is False
    assert s.command_seen("c1") is True
