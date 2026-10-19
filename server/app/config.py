import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_anon_key: str
    whisper_model: str
    whisper_device: str
    whisper_compute_type: str
    whisper_language: str
    max_upload_mb: int
    # カンマ区切りで指定したメールアドレスだけ利用を許可する（空なら全ログインユーザー）
    allowed_emails: frozenset[str]


def load_settings() -> Settings:
    allowed = os.environ.get("ALLOWED_EMAILS", "")
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        supabase_anon_key=os.environ.get("SUPABASE_ANON_KEY", ""),
        whisper_model=os.environ.get("WHISPER_MODEL", "small"),
        whisper_device=os.environ.get("WHISPER_DEVICE", "auto"),
        whisper_compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        whisper_language=os.environ.get("WHISPER_LANGUAGE", "ja"),
        max_upload_mb=_int("MAX_UPLOAD_MB", 100),
        allowed_emails=frozenset(
            e.strip().lower() for e in allowed.split(",") if e.strip()
        ),
    )
