import pytest

from rec_agent.singleton import AlreadyRunning, InstanceLock


def test_second_instance_is_refused(tmp_path):
    a = InstanceLock(tmp_path / "agent.lock").acquire()
    with pytest.raises(AlreadyRunning):
        InstanceLock(tmp_path / "agent.lock").acquire()
    a.release()
    InstanceLock(tmp_path / "agent.lock").acquire().release()
