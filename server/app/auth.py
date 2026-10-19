"""Supabaseのアクセストークンを検証する。

署名方式（HS256/ES256）に依存しないよう、Supabase Auth の /auth/v1/user に
トークンを渡して本人確認する。
"""
import httpx
from fastapi import Depends, Header, HTTPException, Request

from .config import Settings


class User(dict):
    @property
    def id(self) -> str:
        return self["id"]

    @property
    def email(self) -> str:
        return (self.get("email") or "").lower()


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_http_client(request: Request) -> httpx.Client:
    return request.app.state.http


def current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    http: httpx.Client = Depends(get_http_client),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="ログインが必要です")
    token = authorization[7:].strip()

    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=500, detail="サーバーのSupabase設定が未完了です")

    try:
        resp = http.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": settings.supabase_anon_key},
            timeout=10,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="認証サーバーに接続できません")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="ログインの有効期限が切れています")

    user = User(resp.json())
    if settings.allowed_emails and user.email not in settings.allowed_emails:
        raise HTTPException(status_code=403, detail="このアカウントは利用が許可されていません")
    return user
