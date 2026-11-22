# 本番環境へのデプロイ

ローカルで動かした kansoCMS を Cloudflare Workers に公開し、本番の管理者を作るまでの手順です。
このリポジトリでも、`create-kanso` で作ったサイトでも同じです。AI エージェント向けの同じ手順は
[AGENTS.md](../AGENTS.md) にあります。どちらかを直したら、もう一方も合わせてください。

## 先に知っておくこと

- **ローカルと本番は別物です。** `pnpm dev` が使うデータベース (D1) と画像置き場 (R2) は
  `apps/server/.wrangler/` の中の模擬環境です。本番の空の D1 と R2 は、最初のデプロイで作られます。ローカルの記事・
  ユーザー・パスキーは自動では移りません (移し方は「[ローカルの内容を移す](#ローカルの内容を移す)」)。
- **パスキーはドメインごとです。** パスキーは、作ったときに開いていたドメインでしか使えません。
  `localhost` で作ったものは本番で使えず、`*.workers.dev` で作ったものは独自ドメインで使えません。
  本番の管理者は、最終的に使うドメインで作ります。
- **本番の `/admin/setup` にはセットアップトークンが要ります。** デプロイしてから管理者を作るまでの間に、
  他人に管理者を作られないためです。トークンを設定するまで、公開したサイトはセットアップを受け付けません。
  `pnpm setup:token` がトークンを設定し、入力済みのリンクを表示します (手順 6)。`localhost` では要りません。

## 必要なもの

- Node.js 26 以上と pnpm 12 以上
- Cloudflare のアカウント (Workers の無料プランで動きます)
- 独自ドメインを使う場合は、そのドメインを同じ Cloudflare アカウントで管理していること

コマンドはすべてリポジトリのルートで実行します。

## 1. Cloudflare にログインする

```sh
pnpm --filter @kanso/server exec wrangler login    # ブラウザが開く
pnpm --filter @kanso/server exec wrangler whoami   # ログインしたアカウントを確認
```

## 2. 名前を確認する

`apps/server/wrangler.jsonc` にある 3 つの名前を使います。

| 項目 | 場所 | このリポジトリの初期値 |
| --- | --- | --- |
| Worker 名 (workers.dev の URL の一部) | `name` | `kanso` |
| D1 の名前 | `d1_databases` の `database_name` | `kanso` |
| R2 の名前 | `r2_buckets` の `bucket_name` | `kanso-media` |

`create-kanso` で作ったサイトには、作成時に付けた名前が入っています。以下では `<D1名>` `<R2名>` と書きます。
名前を変えるときは、`apps/server/package.json` の `db:migrate` と `db:migrate:local` に書かれた D1 名も
合わせて変えてください。

> kansoCMS 本体のリポジトリ (`silverzzzzz/kansoCMS`) では、本番の値 (`database_id`、`SITE_URL`、`routes`)
> をコミットしないでください。`create-kanso` はこのファイルを新しいサイトにそのままコピーします。本番で
> 運用するサイトは、別のプロジェクトとして作るのがおすすめです:
>
> ```sh
> node packages/create-kanso/bin/create-kanso.mjs ../my-site --from . --site-url https://cms.example.com
> ```

## 3. 名前がほかのサイトと重ならないか確かめる

D1 と R2 は手で作りません。最初の `pnpm run deploy` (手順 5) が、手順 2 の名前で作ります。ただし、同じ
アカウントに同じ名前の D1 や R2 がすでにあると、新しく作らずに**何も言わずにそれにつなぎます**。ほかの
サイトとデータベースや画像を共有してしまわないよう、一覧で確かめてください。

```sh
pnpm --filter @kanso/server exec wrangler d1 list
pnpm --filter @kanso/server exec wrangler r2 bucket list
```

重なっていたら、手順 2 の名前を変えます (`db:migrate` と `db:migrate:local` の D1 名も)。`wrangler.jsonc` の
`preview_database_id` はローカル開発用なので、そのままにします。

## 4. 公開 URL を決めて SITE_URL を書く

`apps/server/wrangler.jsonc` の `vars.SITE_URL` を本番の URL (例: `https://cms.example.com`) にします。
canonical・サイトマップ・フィード・招待リンクなどに使われます。

- **独自ドメイン**: 同じファイルに次の 1 行を足すと、デプロイ時にドメインがつながります。ダッシュボード
  (Workers & Pages → Worker → Settings → Domains & Routes) で追加しても同じです。

  ```jsonc
  "routes": [{ "pattern": "cms.example.com", "custom_domain": true }],
  ```

- **workers.dev だけ**: URL は `https://<Worker名>.<アカウントのサブドメイン>.workers.dev` です。分からなければ、
  手順 5 のデプロイで表示された URL を書き、もう一度 `pnpm run deploy` します。

## 5. デプロイしてテーブルを作る

```sh
pnpm run deploy        # 管理画面と Worker をビルドしてデプロイする。初回は D1 と R2 もここで作られる
pnpm db:migrate        # 本番の D1 にテーブルを作る。確認されたら y
```

初回だけこの順番です (テーブルを作る先の D1 がデプロイで作られるため)。`pnpm db:migrate` が終わるまで、
公開サイトと API はエラー (500) を返します。セットアップはロックされているので、その間に管理者を作られる
ことはありません。

`pnpm deploy` (`run` なし) は pnpm 自身のコマンドで、このスクリプトは動きません。デプロイが終わると URL が
表示されます。毎日の掃除とバックアップ (Cron Trigger) もこのとき登録されます。無料プランの Cron Trigger は
アカウントあたり 5 個までです。

端末から `pnpm run deploy` すると、wrangler が本番の `database_id` を `apps/server/wrangler.jsonc` に書き足し、
ファイル全体の書式も変えます。サイトのリポジトリなら `pnpm format` で整えてコミットします。kansoCMS 本体の
リポジトリでは、この変更は捨ててください。どちらでも `preview_database_id` (ローカル開発用) は消しません。
CI など対話のない実行では書き足されず、2 回目以降のデプロイは前回の D1 と R2 をそのまま使います。

この時点で `/admin/setup` を開くと「セットアップはロックされています」と出ます。次の手順でトークンを設定します。

## 6. 最初の管理者とパスキーを作る

1. セットアップトークンを設定します。ランダムな値を Worker のシークレット `SETUP_TOKEN` に入れ、
   トークン入りのリンクを表示します。

   ```sh
   pnpm setup:token --url https://<ドメイン>
   ```

   リンクを知っている人は管理者を作れるので、人に見せたり、ファイルやチャットに貼ったりしないでください。
2. 表示されたリンクを開きます。最終的に使うドメインで開いてください。「セットアップトークン」は入力済みです。
3. サイト名・名前・メールアドレスを入れます。ローカルの内容を移すつもりなら、「サンプルサイトを入れる」の
   チェックは外します。
4. ブラウザがパスキーの作成を求めるので、Windows Hello・Touch ID・スマホ・セキュリティキーなどで作ります。
   作るとそのままサインインした状態になります。パスワードはありません。
5. `https://<ドメイン>/api/v1/setup` を開いて `"needed":false` と出れば、`/admin/setup` は閉じています。
   トークンもこの時点で使い道がなくなります。
6. 端末をなくしたときのために、**アカウント**で別の端末のパスキーも追加しておきます。ほかの人は
   **ユーザー**から招待します (登録リンクを渡す方式で、メールは送られません)。

- 自分で決めた値を使いたいときは、`pnpm --filter @kanso/server exec wrangler secret put SETUP_TOKEN` で
  16 文字以上の値を入れ、`/admin/setup` の「セットアップトークン」に同じ値を入力します。
- 管理者を作る前にトークンを他人に知られたら、もう一度 `pnpm setup:token` を実行します。新しいトークンに
  置き換わり、前のものは使えなくなります。

## 7. 動作を確認する

- `https://<ドメイン>/api/v1/health` が `{"ok":true,...}` を返す
- `https://<ドメイン>/` (公開サイト)、`/admin/` (管理画面)、`/sitemap.xml` が開く

## 8. 必要なら追加の設定

| 機能 | やること | 詳しく |
| --- | --- | --- |
| フォームのスパム対策 (Turnstile) | **設定 → フォーム**にサイトキーを保存し、`pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY` で秘密鍵を入れる | [README](../README.md#form-notifications-email) |
| フォームの通知メール | `pnpm --filter @kanso/server exec wrangler email sending enable <ドメイン>` のあと、**設定 → フォーム**で送信元と宛先を設定する | [README](../README.md#form-notifications-email) |
| AI で生成 | `wrangler.jsonc` の `ai` のコメントを外して `pnpm types`、もう一度デプロイ。使った分は課金される | [README](../README.md#workers-ai-optional) |

秘密鍵は `wrangler secret put` が聞いてきたところに入力します。ファイルやチャットには書かないでください。

## ローカルの内容を移す

本番の管理者を作ったあとに行います。

1. ローカルの管理画面で**ツール → エクスポート**を開き、JSON ファイルを書き出します。サイト設定も含められます
   (管理者のみ)。
2. 本番の管理画面で**ツール → インポート**にそのファイルを読み込みます。ページや投稿などのコンテンツ、
   メニュー、リダイレクト、フォームの定義が、スラッグやパスで照合して入ります。同じファイルを 2 回
   読み込んでも重複しません。

移らないものもあります。

- **画像ファイル**: JSON には入りません。本番に同じ画像がなければ参照は外れ、インポート結果に警告として
  一覧で出ます。本番でアップロードし直して、付け直してください。
- **ユーザー、API キー、フォームの送信データ**: 本番で作り直します。

画像が多いサイトなら、最初から本番で作るほうが手間は少ないです。

## 更新するとき

```sh
pnpm install
pnpm typecheck && pnpm check && pnpm test && pnpm build
pnpm db:migrate        # 新しいマイグレーションがあれば適用する
pnpm run deploy
```

2 回目以降は、マイグレーションをデプロイより先に適用します (初回だけ逆です)。

## パスキーをなくしたとき・ドメインを変えたとき

- ほかに管理者がいれば、**ユーザー → リンクを再発行**で登録リンクを出してもらいます。
- いなければ、Cloudflare にログインできる人が次を実行します。1 時間有効で 1 回だけ使えるリンクが表示され、
  開いた端末でパスキーを登録してサインインできます。リンクはパスワードと同じように扱ってください。

  ```sh
  pnpm passkey:link you@example.com --remote --url https://<ドメイン>
  ```

- ドメインを変えたとき (workers.dev から独自ドメインへ、など) も、同じコマンドで新しいドメインのパスキーを
  登録します。

## うまくいかないとき

- **`pnpm deploy` で「Deploy a package from a workspace」と出る**: `pnpm run deploy` を使います。
- **`/admin/setup` に「セットアップはロックされています」と出る**: トークンがまだ設定されていません
  (または 16 文字未満です)。`pnpm setup:token --url https://<ドメイン>` を実行します。
- **「セットアップトークンが正しくありません」と出る**: 最後に実行した `pnpm setup:token` のリンクを開き直します。
  分からなくなったら、もう一度実行します。
- **`pnpm setup:token` が失敗する**: `wrangler whoami` でログインを確認し、先に `pnpm run deploy` を済ませます。
- **パスキーを作れない**: `http://127.0.0.1` のような IP アドレスでは使えません。本番は HTTPS のドメインで
  開いてください。
- **初回の `pnpm db:migrate` が「Couldn't find a D1 DB named …」で失敗する**: まだデプロイしていません。
  先に `pnpm run deploy` を実行します (デプロイが D1 を作ります)。デプロイ済みなら、`wrangler whoami` で
  正しいアカウントにログインしているかを確認します。
- **`pnpm check` が `apps/server/wrangler.jsonc` の書式で失敗する**: デプロイが `database_id` を書き足したためです。
  `pnpm format` で整えます。
- **デプロイで D1 や R2 の作成が「権限がない」と出る**: API トークンで動かしているなら、D1 と R2 の編集権限が
  必要です。`wrangler login` なら足ります。

バックアップと復元は README の「[Backups and recovery](../README.md#backups-and-recovery)」にあります。
