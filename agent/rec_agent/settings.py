"""Agent configuration (TOML file + environment overrides)."""
from __future__ import annotations

import os
import platform
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


def default_data_dir() -> Path:
    if platform.system() == "Windows":
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "REC-Audio-Agent"
    xdg = os.environ.get("XDG_STATE_HOME")
    return Path(xdg) / "rec-agent" if xdg else Path.home() / ".local" / "state" / "rec-agent"


@dataclass
class AgentSettings:
    server_url: str = ""
    token: str = ""
    data_dir: Path = field(default_factory=default_data_dir)
    backend: str = "pygame"  # pygame | null
    output_device: str = ""  # empty → use the device chosen in the dashboard
    fallback_to_default_output: bool = True
    log_level: str = "INFO"
    internet_check: str = "1.1.1.1:53"
    health_port: int = 8765  # 0 disables; binds 127.0.0.1 only
    watchdog_timeout: float = 90.0
    cache_all_files: bool = True
    tls_verify: bool | str = True
    status_interval: float = 10.0
    bluetooth_mac: str = ""  # empty → use dashboard value
    bluetooth_auto_reconnect: bool = True
    bluetooth_check_interval: float = 15.0

    @property
    def ws_url(self) -> str:
        u = self.server_url.rstrip("/")
        if u.startswith("https://"):
            return "wss://" + u[len("https://") :] + "/ws/agent"
        if u.startswith("http://"):
            return "ws://" + u[len("http://") :] + "/ws/agent"
        raise ValueError("server_url must start with https:// (or http:// for local testing)")

    @classmethod
    def load(cls, path: Optional[Path]) -> "AgentSettings":
        data: dict = {}
        if path and path.exists():
            with open(path, "rb") as f:
                data = tomllib.load(f)
        bt = data.pop("bluetooth", {}) or {}
        s = cls()
        for k, v in data.items():
            if hasattr(s, k):
                setattr(s, k, v)
        if bt:
            s.bluetooth_mac = bt.get("mac", s.bluetooth_mac) or ""
            s.bluetooth_auto_reconnect = bool(bt.get("auto_reconnect", s.bluetooth_auto_reconnect))
            s.bluetooth_check_interval = float(bt.get("check_interval", s.bluetooth_check_interval))
        # environment overrides
        env = os.environ
        s.server_url = env.get("REC_SERVER_URL", s.server_url)
        s.token = env.get("REC_TOKEN", s.token)
        if env.get("REC_DATA_DIR"):
            s.data_dir = Path(env["REC_DATA_DIR"])
        s.backend = env.get("REC_BACKEND", s.backend)
        if env.get("REC_HEALTH_PORT"):
            s.health_port = int(env["REC_HEALTH_PORT"])
        token_file = data.get("token_file") or env.get("REC_TOKEN_FILE")
        if not s.token and token_file and Path(token_file).exists():
            s.token = Path(token_file).read_text(encoding="utf-8").strip()
        s.data_dir = Path(s.data_dir)
        return s
