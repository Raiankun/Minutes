import json
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from .auth import User, current_user
from .config import Settings, load_settings
from .transcriber import Transcriber, WhisperTranscriber

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
ALLOWED_SUFFIXES = {".webm", ".mp4", ".m4a", ".mp3", ".wav", ".ogg", ".oga", ".aac", ".flac", ".caf", ".3gp"}


def create_app(settings: Settings | None = None, transcriber: Transcriber | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.http = httpx.Client()
        yield
        app.state.http.close()

    app = FastAPI(title="Minutes", lifespan=lifespan)
    app.state.settings = settings
    app.state.transcriber = transcriber or WhisperTranscriber(settings)

    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.allowed_origins),
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            max_age=600,
        )

    @app.get("/config.js", include_in_schema=False)
    def config_js() -> Response:
        # SupabaseのURLとanonキーは公開前提の値（権限はRLSで制御）。
        # 画面をこのサーバー自身が配信するときは、APIも同じオリジンなので apiBaseUrl は空。
        body = "window.MINUTES_CONFIG = " + json.dumps(
            {
                "supabaseUrl": settings.supabase_url,
                "supabaseAnonKey": settings.supabase_anon_key,
                "apiBaseUrl": "",
                "transcribeEnabled": True,
            }
        ) + ";"
        return Response(body, media_type="application/javascript", headers={"Cache-Control": "no-store"})

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.post("/api/transcribe")
    def transcribe(file: UploadFile = File(...), user: User = Depends(current_user)):
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            suffix = ".webm" if not suffix else suffix
            if suffix not in ALLOWED_SUFFIXES:
                raise HTTPException(status_code=415, detail="対応していない音声形式です")

        limit = settings.max_upload_mb * 1024 * 1024
        fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="minutes_")
        try:
            size = 0
            with os.fdopen(fd, "wb") as out:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(
                            status_code=413,
                            detail=f"ファイルが大きすぎます（上限 {settings.max_upload_mb}MB）",
                        )
                    out.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="音声データが空です")

            try:
                result = app.state.transcriber.transcribe(tmp_path)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=422, detail="音声を読み取れませんでした")
        finally:
            # 音声はサーバーに残さない
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass

        return {
            "text": result.text,
            "language": result.language,
            "duration": result.duration,
            "segments": [{"start": s.start, "end": s.end, "text": s.text} for s in result.segments],
        }

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

    return app


app = create_app()
