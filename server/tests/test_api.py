import os
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.transcriber import Result, Segment  # noqa: E402


class FakeTranscriber:
    def __init__(self):
        self.seen_paths = []

    def transcribe(self, path: str) -> Result:
        self.seen_paths.append(path)
        assert os.path.exists(path)
        return Result("こんにちは\nテストです", "ja", 3.5, [Segment(0, 1.5, "こんにちは"), Segment(1.5, 3.5, "テストです")])


def make_settings(**kw) -> Settings:
    base = dict(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon",
        whisper_model="small",
        whisper_device="cpu",
        whisper_compute_type="int8",
        whisper_language="ja",
        max_upload_mb=1,
        allowed_emails=frozenset(),
    )
    base.update(kw)
    return Settings(**base)


def supabase_mock(valid_token="good", email="me@example.com"):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/auth/v1/user"
        if request.headers.get("authorization") == f"Bearer {valid_token}":
            return httpx.Response(200, json={"id": "u1", "email": email})
        return httpx.Response(401, json={"msg": "invalid"})

    return httpx.MockTransport(handler)


@pytest.fixture
def make_client():
    clients = []

    def _make(settings=None, email="me@example.com"):
        tr = FakeTranscriber()
        app = create_app(settings or make_settings(), tr)
        c = TestClient(app)
        c.__enter__()
        app.state.http = httpx.Client(transport=supabase_mock(email=email))
        clients.append(c)
        return c, tr

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


AUDIO = {"file": ("rec.webm", b"fake-audio-bytes", "audio/webm")}
AUTH = {"Authorization": "Bearer good"}


def test_health(make_client):
    c, _ = make_client()
    assert c.get("/api/health").json() == {"ok": True}


def test_config_js_exposes_only_public_values(make_client):
    c, _ = make_client()
    body = c.get("/config.js").text
    assert "supabaseUrl" in body and "anon" in body
    # このサーバーが配信する画面では、議事録（文字起こし）タブを表示する
    assert '"transcribeEnabled": true' in body


def test_cors_preflight_allowed_origin(make_client):
    c, _ = make_client(make_settings(allowed_origins=("https://raiankun.github.io",)))
    r = c.options(
        "/api/transcribe",
        headers={
            "Origin": "https://raiankun.github.io",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://raiankun.github.io"


def test_cors_preflight_other_origin_rejected(make_client):
    c, _ = make_client(make_settings(allowed_origins=("https://raiankun.github.io",)))
    r = c.options(
        "/api/transcribe",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in r.headers


def test_no_cors_headers_when_not_configured(make_client):
    c, _ = make_client()
    r = c.get("/api/health", headers={"Origin": "https://raiankun.github.io"})
    assert "access-control-allow-origin" not in r.headers


def test_transcribe_requires_login(make_client):
    c, _ = make_client()
    assert c.post("/api/transcribe", files=AUDIO).status_code == 401


def test_transcribe_rejects_bad_token(make_client):
    c, _ = make_client()
    r = c.post("/api/transcribe", files=AUDIO, headers={"Authorization": "Bearer bad"})
    assert r.status_code == 401


def test_transcribe_ok_and_temp_file_removed(make_client):
    c, tr = make_client()
    r = c.post("/api/transcribe", files=AUDIO, headers=AUTH)
    assert r.status_code == 200
    data = r.json()
    assert data["text"] == "こんにちは\nテストです"
    assert data["duration"] == 3.5
    assert len(data["segments"]) == 2
    assert not os.path.exists(tr.seen_paths[0])


def test_allowed_emails_blocks_others(make_client):
    c, _ = make_client(make_settings(allowed_emails=frozenset({"partner@example.com"})))
    assert c.post("/api/transcribe", files=AUDIO, headers=AUTH).status_code == 403


def test_allowed_emails_permits_listed(make_client):
    c, _ = make_client(make_settings(allowed_emails=frozenset({"me@example.com"})))
    assert c.post("/api/transcribe", files=AUDIO, headers=AUTH).status_code == 200


def test_too_large(make_client):
    c, tr = make_client()
    big = {"file": ("big.mp3", b"x" * (2 * 1024 * 1024), "audio/mpeg")}
    r = c.post("/api/transcribe", files=big, headers=AUTH)
    assert r.status_code == 413
    assert tr.seen_paths == []


def test_empty_file(make_client):
    c, _ = make_client()
    r = c.post("/api/transcribe", files={"file": ("a.wav", b"", "audio/wav")}, headers=AUTH)
    assert r.status_code == 400


def test_bad_extension(make_client):
    c, _ = make_client()
    r = c.post("/api/transcribe", files={"file": ("evil.exe", b"abc", "application/octet-stream")}, headers=AUTH)
    assert r.status_code == 415
