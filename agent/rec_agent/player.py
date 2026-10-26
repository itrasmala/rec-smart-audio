"""Audio output backends.

PygameBackend  — real playback through SDL2 (WASAPI on Windows, PulseAudio/PipeWire/ALSA on Linux).
                 Lets us pick the output device by name (Bluetooth / AUX / USB / HDMI).
NullBackend    — simulates playback timing; used by tests and `--dry-run`.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger("rec.player")


class BackendError(Exception):
    pass


class Backend:
    name = "base"

    def start(self, path: Path, volume: float, start_sec: float = 0.0) -> None: ...
    def stop(self) -> None: ...
    def pause(self) -> None: ...
    def resume(self) -> None: ...
    def set_volume(self, volume: float) -> None: ...
    def is_busy(self) -> bool: return False
    def list_outputs(self) -> list[str]: return []
    def set_output(self, name: Optional[str]) -> Optional[str]: return name
    def current_output(self) -> Optional[str]: return None
    def health(self) -> tuple[bool, Optional[str]]: return True, None
    def close(self) -> None: ...


class NullBackend(Backend):
    """Plays nothing; 'finishes' after the item's duration according to the injected time source."""

    name = "null"

    def __init__(self, duration_of: Callable[[Path], float], monotonic: Callable[[], float] = time.monotonic):
        self._duration_of = duration_of
        self._mono = monotonic
        self._end: Optional[float] = None
        self._paused_left: Optional[float] = None
        self.volume = 1.0
        self.output: Optional[str] = "Null Output"
        self.started: list[tuple[str, float, float]] = []  # (path, volume, start_sec) for tests
        self.fail_next = False

    def start(self, path: Path, volume: float, start_sec: float = 0.0) -> None:
        if self.fail_next:
            self.fail_next = False
            raise BackendError("simulated output failure")
        if not Path(path).exists():
            raise BackendError(f"file not found: {path}")
        dur = max(0.0, self._duration_of(path) - start_sec)
        self._end = self._mono() + dur
        self._paused_left = None
        self.volume = volume
        self.started.append((str(path), volume, start_sec))

    def stop(self) -> None:
        self._end = None
        self._paused_left = None

    def pause(self) -> None:
        if self._end is not None and self._paused_left is None:
            self._paused_left = max(0.0, self._end - self._mono())

    def resume(self) -> None:
        if self._paused_left is not None:
            self._end = self._mono() + self._paused_left
            self._paused_left = None

    def set_volume(self, volume: float) -> None:
        self.volume = volume

    def is_busy(self) -> bool:
        if self._end is None:
            return False
        if self._paused_left is not None:
            return False
        return self._mono() < self._end

    def list_outputs(self) -> list[str]:
        return ["Null Output"]

    def set_output(self, name: Optional[str]) -> Optional[str]:
        self.output = name or "Null Output"
        return self.output

    def current_output(self) -> Optional[str]:
        return self.output


class PygameBackend(Backend):
    """pygame.mixer.music streams MP3/WAV from disk with low memory use."""

    name = "pygame"

    def __init__(self, preferred_output: Optional[str] = None, fallback_to_default: bool = True):
        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        import pygame  # noqa: WPS433 (import inside to keep NullBackend dependency-free)

        self._pg = pygame
        self._lock = threading.RLock()
        self._preferred = preferred_output
        self._fallback = fallback_to_default
        self._output: Optional[str] = None
        self._inited = False
        self._last_error: Optional[str] = None
        self._volume = 1.0
        self._paused = False
        self._init_mixer(preferred_output)

    # ---- device handling ----
    def _init_mixer(self, name: Optional[str]) -> None:
        pg = self._pg
        with self._lock:
            if pg.mixer.get_init():
                pg.mixer.quit()
            self._inited = False
            tried: list[Optional[str]] = [name] if name else []
            if self._fallback or not name:
                tried.append(None)
            for dev in tried:
                try:
                    if dev:
                        pg.mixer.init(frequency=44100, size=-16, channels=2, buffer=4096, devicename=dev)
                    else:
                        pg.mixer.init(frequency=44100, size=-16, channels=2, buffer=4096)
                    self._inited = True
                    self._output = dev or self._default_name()
                    self._last_error = None if (dev == name or not name) else f"المخرج '{name}' غير متاح — تم استخدام المخرج الافتراضي"
                    log.info("audio output ready: %s", self._output)
                    return
                except Exception as exc:  # pygame.error
                    self._last_error = f"تعذّر فتح مخرج الصوت '{dev or 'الافتراضي'}': {exc}"
                    log.warning(self._last_error)
            self._output = None

    def _default_name(self) -> str:
        outs = self.list_outputs()
        return outs[0] if outs else "default"

    def list_outputs(self) -> list[str]:
        try:
            from pygame._sdl2 import audio as sdl2_audio

            if not self._pg.mixer.get_init():
                self._pg.mixer.init()
                names = list(sdl2_audio.get_audio_device_names(False))
                self._pg.mixer.quit()
                return names
            return list(sdl2_audio.get_audio_device_names(False))
        except Exception as exc:
            log.debug("cannot list outputs: %s", exc)
            return []

    def set_output(self, name: Optional[str]) -> Optional[str]:
        self._preferred = name
        self._init_mixer(name)
        return self._output

    def current_output(self) -> Optional[str]:
        return self._output

    def ensure_ready(self) -> bool:
        if not self._inited:
            self._init_mixer(self._preferred)
        return self._inited

    def preferred_available(self) -> bool:
        return not self._preferred or self._preferred in self.list_outputs()

    def health(self) -> tuple[bool, Optional[str]]:
        if not self._inited:
            return False, self._last_error or "مخرج الصوت غير مهيأ"
        if self._preferred and self._output != self._preferred:
            return False, self._last_error or f"المخرج المطلوب '{self._preferred}' غير متصل"
        return True, None

    # ---- playback ----
    def start(self, path: Path, volume: float, start_sec: float = 0.0) -> None:
        with self._lock:
            if not self.ensure_ready():
                raise BackendError(self._last_error or "audio output unavailable")
            music = self._pg.mixer.music
            try:
                music.load(str(path))
                music.set_volume(max(0.0, min(1.0, volume)))
                self._volume = volume
                self._paused = False
                if start_sec > 0.5:
                    try:
                        music.play(start=start_sec)
                    except Exception:  # WAV does not support seeking → restart from 0
                        music.play()
                else:
                    music.play()
            except Exception as exc:
                raise BackendError(f"تعذّر تشغيل الملف: {exc}") from exc

    def stop(self) -> None:
        with self._lock:
            if self._pg.mixer.get_init():
                self._pg.mixer.music.stop()
                try:
                    self._pg.mixer.music.unload()
                except Exception:
                    pass
            self._paused = False

    def pause(self) -> None:
        with self._lock:
            if self._pg.mixer.get_init():
                self._pg.mixer.music.pause()
                self._paused = True

    def resume(self) -> None:
        with self._lock:
            if self._pg.mixer.get_init():
                self._pg.mixer.music.unpause()
                self._paused = False

    def set_volume(self, volume: float) -> None:
        with self._lock:
            self._volume = volume
            if self._pg.mixer.get_init():
                self._pg.mixer.music.set_volume(max(0.0, min(1.0, volume)))

    def is_busy(self) -> bool:
        with self._lock:
            if not self._pg.mixer.get_init():
                return False
            return bool(self._pg.mixer.music.get_busy())

    def close(self) -> None:
        with self._lock:
            if self._pg.mixer.get_init():
                self._pg.mixer.quit()
