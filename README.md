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

### 3. 自宅PCを外から使えるようにする（スマホ・外出先から）

ブラウザの録音機能は **HTTPS（または localhost）でしか動きません**。自宅PCのサーバーを、HTTPSのURLで公開します。

- **Tailscale Funnel（おすすめ・無料）**: `https://<PC名>.<tailnet名>.ts.net` という固定のURLが得られます。Tailscaleのアカウントで Funnel を有効にしたうえで `tailscale funnel 8000` を実行します
- **Cloudflare Tunnel**: 独自ドメインがあれば固定URLにできます。ドメインなしの簡易トンネル（`trycloudflare.com`）は、起動のたびにURLが変わるので常用には向きません

公開すると、URLを知っている人はサーバーに到達できます。`.env` の `ALLOWED_EMAILS` に2人のメールアドレスを必ず入れてください（ログインしていない人、許可されていない人は文字起こしを使えません）。

この公開URLを開けば、サーバーが画面も配信するので、**それだけで使えます**（次のPages配信は任意です）。

### 4. GitHub Pagesで画面を配信する（任意）

画面だけをGitHub Pagesに置き、文字起こしは自宅PCのサーバーに任せる構成です。

1. リポジトリの Settings > Pages で、Source を **GitHub Actions** にする
2. Settings > Secrets and variables > Actions > **Variables** に次の3つを登録する
   - `SUPABASE_URL`、`SUPABASE_ANON_KEY`（Supabaseの値）
   - `API_BASE_URL`（手順3で得た自宅PCの公開URL。末尾の `/` なし）
3. `.env` の `ALLOWED_ORIGINS` にPagesのオリジン（例: `https://raiankun.github.io`）を入れてサーバーを再起動する
4. Supabase の Authentication > URL Configuration の Site URL にPagesのURLを設定する（確認メールのリンク先になります）
5. `main` に `web/` の変更をpushするか、Actionsタブから「Deploy web to GitHub Pages」を手動実行する

注意:
- 無料プランのGitHubでは、Pagesを使うリポジトリは **公開（public）** になります。コードは公開されますが、鍵や記録は含まれません（anonキーは公開前提の値で、記録はRLSで守られます）
- 自宅PCが止まっていると、画面は開けても文字起こしはできません（ログインと履歴の閲覧はSupabase側なので使えます）
- 手順3のURLを変えたら、`API_BASE_URL` を更新してActionsを再実行してください

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
