# Minutes

音声を文字起こしして、ログイン後に自分だけの履歴として保存するWebアプリです（スマホ対応）。
妊活中の通院メモや、パートナーとの話し合いの記録に使うことを想定しています。

- 文字起こし: ローカル実行の Whisper（faster-whisper）。**音声は外部サービスに送信されず、サーバーにも保存されません**
- ログイン・保存: Supabase（メール/パスワード認証 + Postgres）。Row Level Security で「自分のデータだけ」読み書きできます
- 画面: `web/`（ビルド不要の静的HTML/JS）。サーバー（FastAPI）が配信します

## 構成

```
server/   FastAPI（/api/transcribe、Supabaseトークン検証、Whisper）
web/      画面（ログイン、録音/ファイル選択、編集・保存、履歴・検索）
supabase/ schema.sql（テーブルとRLS）
```

## セットアップ

### 1. Supabase

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. SQL Editor に `supabase/schema.sql` を貼り付けて実行
3. Project Settings > API から **Project URL** と **anon public キー**を控える
4. Authentication > Providers > Email で、メール確認（Confirm email）をオンにするかを決める
5. **2人とも登録し終えたら**、Authentication の設定で新規サインアップを無効にすると、第三者に登録されません

### 2. サーバー

Python 3.10 以上が必要です。

```bash
cp .env.example .env        # SUPABASE_URL / SUPABASE_ANON_KEY を記入、ALLOWED_EMAILS に2人のメールを書くのがおすすめ
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --env-file ../.env --host 0.0.0.0 --port 8000
```

ブラウザで http://localhost:8000 を開きます。初回の文字起こし時に Whisper モデルをダウンロードします（`small` で約500MB、少し待ちます）。

### 3. スマホから使う場合

ブラウザの録音機能は **HTTPS（または localhost）でしか動きません**。スマホから録音するには、Tailscale Serve や Cloudflare Tunnel などで HTTPS 化してアクセスしてください。ファイルを選んで文字起こしするだけなら HTTP でも動きます。

## 使い方

1. 新規登録（またはログイン）
2. 「録音する」で話して「停止」、または音声ファイルを選ぶ
3. 文字起こし結果を確認・修正し、タイトルとメモを付けて保存
4. 履歴から検索・編集・コピー・削除

## テスト

```bash
cd server
pytest
```

## プライバシーについて

- 通院や体調に関する内容を扱うため、Supabase プロジェクトは自分専用にし、`service_role` キーは共有しないでください
- 保存先は Supabase 上のテキストのみです。音声ファイルは文字起こし後すぐに削除されます
- 現状はアカウントごとにデータが分かれています（パートナーと同じ記録を共有する機能はありません）

## 今後の候補

- パートナーとの記録の共有
- 排卵日・通院日などの記録との紐付け
- 話者の分離
