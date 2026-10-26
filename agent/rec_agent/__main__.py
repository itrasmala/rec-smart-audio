"""Entry point:  python -m rec_agent --config config.toml

Extra tools:
  --list-outputs     print the audio output devices visible to the agent and exit
  --test-tone        play the test chime on the configured output and exit
  --check            validate configuration and server connectivity, then exit
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import logging.handlers
import signal
import sys
from pathlib import Path

from . import __version__
from .settings import AgentSettings


def setup_logging(settings: AgentSettings) -> None:
    log_dir = settings.data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(getattr(logging, str(settings.log_level).upper(), logging.INFO))
    fh = logging.handlers.RotatingFileHandler(log_dir / "agent.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    root.handlers[:] = [fh, sh]
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="rec_agent", description="REC Smart Audio — Local Audio Agent")
    ap.add_argument("--config", type=Path, default=Path("config.toml"))
    ap.add_argument("--list-outputs", action="store_true")
    ap.add_argument("--test-tone", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--version", action="version", version=__version__)
    args = ap.parse_args(argv)

    settings = AgentSettings.load(args.config)
    setup_logging(settings)
    log = logging.getLogger("rec")

    if args.list_outputs:
        from .player import PygameBackend

        b = PygameBackend(None)
        outs = b.list_outputs()
        print("مخارج الصوت المتاحة:" if outs else "لا توجد مخارج صوت ظاهرة")
        for o in outs:
            print(f"  - {o}")
        b.close()
        return 0

    if args.test_tone:
        import time

        from .player import PygameBackend
        from .tone import make_test_tone, wav_duration

        b = PygameBackend(settings.output_device or None, settings.fallback_to_default_output)
        p = make_test_tone(settings.data_dir / "cache" / "_test_tone.wav")
        print(f"تشغيل نغمة الاختبار على: {b.current_output()}")
        b.start(p, 0.8)
        time.sleep(wav_duration(p) + 0.3)
        b.close()
        return 0

    if not settings.server_url or not settings.token:
        log.error("server_url و token مطلوبان في ملف الإعدادات %s", args.config)
        return 2

    if args.check:
        import httpx

        try:
            r = httpx.get(settings.server_url.rstrip("/") + "/api/health", timeout=10, verify=settings.tls_verify)
            print(f"الخادم: HTTP {r.status_code} {r.text[:200]}")
        except Exception as exc:
            print(f"تعذّر الوصول للخادم: {exc}")
            return 1
        print(f"WebSocket: {settings.ws_url}")
        print(f"مجلد البيانات: {settings.data_dir}")
        return 0

    from .agent import Agent
    from .singleton import AlreadyRunning, InstanceLock

    try:
        lock = InstanceLock(settings.data_dir / "agent.lock").acquire()
    except AlreadyRunning as exc:
        log.error("%s — exiting", exc)
        return 3

    log.info("REC Audio Agent %s starting (data dir: %s)", __version__, settings.data_dir)
    agent = Agent(settings)

    async def runner() -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, agent.request_stop)
            except (NotImplementedError, RuntimeError):  # Windows
                signal.signal(sig, lambda *_: loop.call_soon_threadsafe(agent.request_stop))
        await agent.run()

    try:
        asyncio.run(runner())
    finally:
        agent.close()
        lock.release()
        log.info("agent stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
