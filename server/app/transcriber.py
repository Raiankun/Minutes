"""ローカル実行の Whisper (faster-whisper) による文字起こし。音声は外部に送信されない。"""
import threading
from dataclasses import dataclass
from typing import Protocol

from .config import Settings


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Result:
    text: str
    language: str
    duration: float
    segments: list[Segment]


class Transcriber(Protocol):
    def transcribe(self, path: str) -> Result: ...


class WhisperTranscriber:
    """モデルは初回利用時に読み込み、同時実行は1件ずつに絞る（少人数利用のため）。"""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()

    def _get_model(self):
        with self._load_lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                self._model = WhisperModel(
                    self._settings.whisper_model,
                    device=self._settings.whisper_device,
                    compute_type=self._settings.whisper_compute_type,
                )
            return self._model

    def transcribe(self, path: str) -> Result:
        model = self._get_model()
        with self._run_lock:
            segments_iter, info = model.transcribe(
                path,
                language=self._settings.whisper_language or None,
                vad_filter=True,
                beam_size=5,
            )
            segments = [Segment(s.start, s.end, s.text.strip()) for s in segments_iter]
        text = "\n".join(s.text for s in segments if s.text)
        return Result(
            text=text,
            language=info.language,
            duration=info.duration,
            segments=segments,
        )
