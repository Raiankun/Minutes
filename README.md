# Minutes

薬・予定・資料を、ログイン後に自分だけが見られる形で管理するWebアプリです（スマホ対応）。
妊活（体外受精）での通院・投薬・助成金の手続きの管理に使うことを想定しています。

- **予定**: 通院・採卵や移植・助成金の手続きを日付つきで管理。期限が近いと知らせ、カレンダー(.ics)に書き出せます
- **薬**: 薬ごとに、保管方法・注意点・受け取った日と数のメモを残し、投薬の予定をまとめて登録できます
- **資料**: 領収書・申請書類・証明書などの写真やPDFを保存して、種類・日付・検索で探せます。領収書の合計も出ます
- **議事録（任意）**: 音声のローカル文字起こし。文字起こしサーバーを設定したときだけ表示されます
- ログイン・保存は Supabase（メール/パスワード認証 + Postgres + Storage）。Row Level Security で「自分のデータだけ」読み書きできます

画面は静的なHTML/JSなので、**GitHub Pages と Supabase だけで動かせます**（自宅PCのサーバーは不要）。

## 構成

```
web/        画面（予定・薬・資料・議事録）。ビルド不要の静的HTML/JS
supabase/   schema.sql（テーブル・Storage・RLS。更新したら SQL Editor で全体を再実行できます）
server/     文字起こしサーバー（任意。FastAPI + faster-whisper）
tests/web/  予定・薬・資料ロジックのテスト（Node）
```

## セットアップ

### 1. Supabase

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. SQL Editor に `supabase/schema.sql` を貼り付けて実行（テーブル、非公開の保存バケット `documents`、アクセス権の設定が入ります）
3. Project Settings > API から **Project URL** と **anon public キー**を控える
4. Authentication > Providers > Email で、メール確認（Confirm email）をオンにするかを決める
5. **2人とも登録し終えたら**、Authentication の設定で新規サインアップを無効にすると、第三者に登録されません

### 2. GitHub Pages で公開する

1. リポジトリの Settings > Pages で、Source を **GitHub Actions** にする
2. Settings > Secrets and variables > Actions > **Variables** に次の2つを登録する
   - `SUPABASE_URL`（Project URL）
   - `SUPABASE_ANON_KEY`（anon public キー。公開前提の値で、`service_role` キーは入れないこと）
3. `main` に `web/` の変更をpushするか、Actionsタブから「Deploy web to GitHub Pages」を手動実行する
4. Supabase の Authentication > URL Configuration の Site URL に、PagesのURLを設定する（確認メールのリンク先になります）

注意:
- 無料プランのGitHubでは、Pagesを使うリポジトリは **公開（public）** になります。コードは公開されますが、鍵や記録は含まれません（anonキーは公開前提の値で、記録はRLSで守られます）。リポジトリを非公開のままにしたいときは、非公開リポジトリから配信できる別のサービスを使います
- 変数が未設定のあいだ、この自動配信はスキップされます

### 手元で試す

`web/config.example.js` を `web/config.js` にコピーして値を入れ、`web/` を静的サーバーで開きます（例: `cd web && python -m http.server 8000`）。Supabaseのログインを使うため、`localhost` で開いてください。`config.js` はGitに入りません。

## 使い方

- **予定タブ**: 予定を追加して、終わったらチェックします。おすすめ（助成金のチェックリスト、次回の通院日の登録、期限が近い手続きの警告など）が出ます。「カレンダーに書き出す」でiPhoneやGoogleカレンダーに取り込めます
- **薬タブ**: 薬を登録し、保管方法・注意点・受け取った日・数のメモを残します。残りの回数は手で増減します。「予定をまとめて登録」で、病院に指示された期間と時刻のとおりに予定を作ります
- **資料タブ**: 写真やPDF（1つ20MBまで）を保存し、種類・日付・金額・メモを付けます。「開く」で短時間だけ有効なリンクから表示します

**量・時刻・保管方法など、薬の使い方は病院・薬局の指示を書き写してください。アプリは内容を判断しません。** 助成金の条件・期限・書類は自治体ごとに違うため、アプリには金額や期限を固定で入れていません。お住まいの都道府県・市区町村の最新の案内を確認してください。

## 議事録（文字起こし）を使う場合（任意）

自宅PCなどで文字起こしサーバーを動かすと、「議事録」タブが現れます。音声は外部に送られず、サーバーにも保存されません。

```bash
cp .env.example .env        # SUPABASE_URL / SUPABASE_ANON_KEY を記入。ALLOWED_EMAILS に2人のメールを書くのがおすすめ
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --env-file ../.env --host 0.0.0.0 --port 8000
```

初回の文字起こし時に Whisper モデルをダウンロードします（`small` で約500MB）。

スマホから使うには、サーバーをHTTPSのURLで公開します（ブラウザの録音は HTTPS か localhost でしか動きません）。

- **Tailscale Funnel（おすすめ・無料）**: `https://<PC名>.<tailnet名>.ts.net` という固定のURLが得られます。Funnel を有効にしたうえで `tailscale funnel 8000` を実行します
- **Cloudflare Tunnel**: 独自ドメインがあれば固定URLにできます。ドメインなしの簡易トンネルはURLが毎回変わります

公開すると、URLを知っている人は到達できます。`.env` の `ALLOWED_EMAILS` に2人のメールアドレスを必ず入れてください。このURLを開けば、サーバーが画面も配信するので、そのまま使えます。

**Pagesの画面から使う場合**: Actions の Variables に `API_BASE_URL`（上のURL。末尾の `/` なし）を追加し、`.env` の `ALLOWED_ORIGINS` にPagesのオリジン（例: `https://raiankun.github.io`）を入れてサーバーを再起動します。`API_BASE_URL` が空のあいだは「議事録」タブは出ません。

## テスト

```bash
node --test tests/web/*.test.js   # 画面のロジック（Node 22 以降）
cd server && pytest               # 文字起こしサーバー
```

GitHub にpushすると、同じテストが自動で実行されます（Actions の「Test」）。

## プライバシーについて

- 通院・薬・領収書など、体調やお金に関わる内容を扱います。Supabase プロジェクトは自分専用にし、`service_role` キーは誰にも渡さないでください
- 予定・薬・資料のデータは Supabase に保存されます。自分のアカウントからだけ読み書きでき、ファイルは非公開バケットに入ります
- 現状はアカウントごとにデータが分かれています（パートナーと記録を共有する機能はありません）
- Supabase の無料プランには保存容量などの上限があります。使い方に合うか、現在のプランの内容を確認してください

## 今後の候補

- パートナーとの記録の共有
- 資料の写真の自動回転・圧縮
- 薬の予定の通知（現在はカレンダーに書き出して通知します）
