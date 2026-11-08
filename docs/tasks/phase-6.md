# Phase 6 タスクボード — パスキー認証 (パスワード廃止)

目的: **管理画面のログインをパスキー (WebAuthn) だけにし、パスワードをなくす。** 初回セットアップでパスキーを作り、以後はパスキーでログインする。端末を増やすときはログイン中に追加し、パスキーをすべて失ったときは Cloudflare の管理権限 (wrangler) で発行する一回限りの登録リンクで復旧する。

運用ルール ([Phase 5](phase-5.md) と同じ):

- 1 タスク = 1 回の実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T35 | データモデルと WebAuthn 検証 (パスキー・チャレンジ・登録リンク、パスワード列の削除) | done | shared, core |
| T36 | 認証 API: セットアップ・ログイン・自分のパスキー管理・登録リンク (パスワードログイン廃止) | done | shared, server |
| T37 | 復旧用の登録リンクを発行する CLI (`pnpm passkey:link`) | done | server, tooling |
| T38 | 管理画面: セットアップ・ログイン・アカウント (パスキー一覧)・登録リンク画面 | done | admin |
| T39 | E2E (ソフトウェア認証器 / 仮想認証器) + ドキュメント + 既存 DB の移行手順 | done | tooling, docs |

Phase 6 の決定事項:

1. **パスキーだけにする。パスワードは残さない** (2026-11-08 ユーザー決定:「パスワードは脆弱だからパスキー 1 本化でいい」)。`users.password_hash` は削除する。
2. **復旧はメールを使わず、wrangler で発行する登録リンクにする** (提案どおり)。メール送信の設定がなくても動くという方針 (外部サービス不要) を保つため。D1 に書き込める人 = Cloudflare アカウントの管理者なので、本人確認として十分。メールのログインリンクと GitHub / Google ログインはこのフェーズの範囲外。
3. 実装の参考は Cloudflare の EmDash (`emdash-cms/emdash`, MIT) の `packages/auth/src/passkey`。EmDash は Astro / Kysely 前提なのでパッケージは使わず、検証手順を Hono / Drizzle / D1 に合わせて書き直す。~~同じ `@oslojs/webauthn` で応答を解析する。~~ **(T35 で変更)** `@oslojs/*` は 2026-07-29 に npm 側で「Package no longer supported」の非推奨にされていたため依存せず、CBOR / COSE の解析を自前で書き、署名検証は WebCrypto に任せる。
4. Phase 6 の実装は Claude が直接行った (Phase 5 で Codex への委任が 2 回とも環境エラーで止まったため)。

---

## 全体設計 (このフェーズの前提)

- **RP ID と origin はリクエストの URL から決める。** `rpId = new URL(c.req.url).hostname`、許可する origin は `new URL(c.req.url).origin` の 1 つだけ。**(T36 で追記)** ただし Worker が `localhost` のときは、ブラウザの `Origin` が `localhost` (ポート問わず) ならそれを許す。管理画面の開発サーバー (:5174) が `/api` を Worker にプロキシすると、Worker からは自分のポートの URL・Host に見えるため。開発の `localhost` (ポートは問わない) と本番の独自ドメインで同じコードが動く。パスキーはドメインに結び付くので、ドメインを変えたら登録リンクで作り直す (ドキュメントに書く)。`127.0.0.1` など IP アドレスでは WebAuthn が使えない。
- **ユーザー確認 (UV) を必須にする。** パスキーが唯一の要素なので、端末のロック解除 (生体認証・PIN) を要求する (`userVerification: 'required'` と UV フラグの検証)。EmDash の既定は `preferred` だが、パスワードを置き換える以上ここは厳しくする。
- **ログインはユーザー名なし (discoverable credential)。** ログイン画面はメールアドレスを聞かず、「パスキーでログイン」だけにする。登録時は `residentKey: 'required'`。
- **署名の検証は WebCrypto で行う。** 応答の解析 (CBOR / COSE / clientDataJSON) は自前 (決定 3)、公開鍵は SPKI (DER) で保存し、検証は `crypto.subtle.verify` (ES256 / RS256)。純 JS の楕円曲線計算は Workers Free の CPU 時間 (10ms) を食うため使わない。
- **チャレンジは D1 に保存し、1 回だけ使える。** `auth_challenges` に目的 (setup / login / register / link) とユーザー・付帯データ・期限 (5 分) を持たせ、検証時に `delete … returning` で取り出す。発行時に期限切れの行を同じバッチで掃除する。
- **セットアップは 2 段階で、最初の管理者は 1 人だけ。** 入力 (サイト名・名前・メール・サンプル有無) はチャレンジの付帯データに入れ、パスキー作成後の検証で「ユーザーが 0 人のときだけ」ユーザーとパスキーを 1 バッチで作る。パスキーはこのセットアップで生成した WebAuthn ユーザー ID でユーザーに結び付け、競合したセットアップのユーザーに付くことはない。
- **セッション・CSRF・API キーは今のまま。** パスキーで認証したあとは既存の `kanso_session` Cookie を発行する。

データモデル (T35):

| テーブル / 列 | 内容 |
|---|---|
| `users.webauthn_user_id` | WebAuthn のユーザーハンドル (ランダム 16 バイトの hex、unique)。既存ユーザーにはマイグレーションで生成する |
| `users.password_hash` | 削除 |
| `passkeys` | id, user_id (cascade), credential_id (base64url, unique), public_key (SPKI base64url), algorithm, sign_count, transports_json, name, created_at, last_used_at |
| `auth_challenges` | id (= チャレンジの base64url), purpose, user_id (cascade, null 可), data_json, expires_at |
| `passkey_links` | id (= トークンの SHA-256 hex), user_id (cascade), expires_at, created_at。登録リンク (復旧・将来の招待) |

---

## T35. データモデルと WebAuthn 検証

状態: `done` (2026-11-08)

### ゴール

- core にパスキーの登録・認証の検証と、そのための保存処理がそろう。パスワード関連のコードはなくなる。

### 仕様

- `packages/core/src/auth/webauthn.ts` (純粋関数、DB に触れない):
  - `registrationOptions({ rp, user, challenge, exclude })` / `authenticationOptions({ rpId, challenge })`: ブラウザに渡す JSON (`PublicKeyCredentialCreationOptionsJSON` / `RequestOptionsJSON` 相当)。アルゴリズムは ES256 (-7) と RS256 (-257)、`attestation: 'none'`、`residentKey: 'required'`、`userVerification: 'required'`、timeout 5 分。
  - `verifyRegistration(response, { challenge, rpId, origin })` → `{ credentialId, publicKey (SPKI), algorithm, signCount, transports }`。type = create、challenge・origin・RP ID ハッシュ・UP・UV・アルゴリズム/鍵種別を検証。attestation 文は検証しない (`none` を要求しているため)。
  - `verifyAuthentication(response, { challenge, rpId, origin, credential })` → `{ signCount }`。type = get、challenge・origin・RP ID ハッシュ・UP・UV・署名・カウンタ (どちらかが 0 でなければ増えていること) を検証。
  - 失敗は `KansoError.unauthorized` (内部の理由はメッセージに残すが、API の利用者には詳細を出しすぎない)。
- `packages/core/src/auth/tokens.ts`: `generateToken` / `sha256Hex` / base64url を `password.ts` から移す。`password.ts` とテストは削除。
- テスト用のソフトウェア認証器 (`packages/core/src/auth/soft-authenticator.ts`): P-256 鍵で attestationObject (fmt none) とアサーションを作る。core のテストと E2E で使う。
- auth サービスに追加: チャレンジの発行・取り出し、セットアップ (ユーザー + パスキーの原子的作成)、パスキーの検索・一覧・追加・名前変更・削除 (最後の 1 つは削除不可)・使用記録、登録リンクの発行・確認・消費。`createUser` / `verifyCredentials` は削除。
- マイグレーション `0006`: 上表のとおり。既存ユーザーの `webauthn_user_id` は `lower(hex(randomblob(16)))` で埋める。

### 完了条件

- webauthn のテスト: ソフトウェア認証器で登録→認証が通る。challenge / origin / RP ID / UV / 署名 / カウンタの改ざんがそれぞれ失敗する。RS256 も検証できる。
- 4 ゲートが通る (server / admin はこの時点で T36 / T38 の変更を一緒に入れないと型が通らない場合、T35〜T36 をまとめて 1 コミットにしてよい)。

### 決定

- **依存なしで実装した** (決定 3)。`auth/cbor.ts` は WebAuthn に必要な範囲だけの CBOR デコーダ: 確定長のみ (不定長・タグ・浮動小数は拒否)、マップのキーは整数か文字列で重複は拒否、入れ子は 16 段まで、UTF-8 は fatal。`auth/webauthn.ts` の検証手順は EmDash と同じ (type・challenge・origin・RP ID ハッシュ・UP・UV・アルゴリズムと鍵種別・カウンタ) に、`crossOrigin` の拒否、`id`・`rawId`・attested credential id の一致、authenticatorData を末尾まで読み切ること、`userHandle` (あれば) とユーザーの一致を足した。
- COSE 鍵は JWK として `crypto.subtle.importKey` し、`exportKey('spki')` の結果を保存する (取り込み時に WebCrypto が鍵自体を検証する)。ES256 の署名は DER から r‖s (P1363) に変換して検証。RS256 は 2048 bit 未満を拒否。EdDSA は要求しない。
- `users.webauthn_user_id` は DB 上は NULL 可 (SQLite は値の入ったテーブルに NOT NULL 列を足せない)。マイグレーションで既存ユーザーを `lower(hex(randomblob(16)))` で埋め、新規は `$defaultFn`、念のため参照時に空なら採番する (`handleOf`)。WebAuthn のユーザーハンドルはこの文字列の UTF-8 バイト列。
- マイグレーション `0006_passkeys.sql` は、drizzle-kit が「password_hash から webauthn_user_id への名前変更か」を対話で聞いてくる (TTY なしで失敗) ため、追加と削除を 2 回に分けて生成し、1 ファイルと 1 スナップショットにまとめた。まとめたあとの `drizzle-kit generate` は「変更なし」。
- セットアップの競合: ユーザーは `insert … select … where not exists (select 1 from users)`、パスキーはこのセットアップで生成したハンドルで引く `insert … select` で挿入し、同じバッチで読み戻す。読み戻せなければ 409。drizzle の SQL 版 `insert().select()` は全列を表の定義順に並べる必要がある (Phase 5 と同じ)。
- 最後のパスキーの削除禁止は 1 文で判定する (`delete … where … and (select count(*) …) > 1 returning`)。同時に 2 つ消されても 0 個にならない。
- 登録リンクの消費は「期限内のリンクからの `insert … select` + リンク削除」の 1 バッチ。先に使われていたら挿入 0 行で 404。リンク経由は 10 個の上限を適用しない (復旧のため)。
- `soft-authenticator.ts` はクラスの parameter properties を使わない。スモークのスクリプトが Node の型除去 (strip-only) で読み込み、そこでは構文エラーになるため。
- テスト: core 94 件 (cbor・webauthn を追加、password を削除)。

---

## T36. 認証 API

状態: `done` (2026-11-08)

### 仕様

- `GET /api/v1/setup` → `{ needed }` (変更なし)。
- `POST /api/v1/setup/options` (公開、ユーザーがいれば 409): `{ email, name, siteTitle?, starter? }` → `{ options }`。入力はチャレンジに保存。
- `POST /api/v1/setup` (公開): `{ credential }` → 検証してユーザー + パスキー作成、サイト名・サンプル投入 (Phase 5 と同じく失敗しても成功扱い)、セッション発行 → `{ user, starter }`。すでにユーザーがいれば 409。
- `POST /api/v1/auth/passkey/options` (公開) → `{ options }`。
- `POST /api/v1/auth/passkey` (公開): `{ credential }` → セッション発行 → `{ user }`。未登録のパスキー・検証失敗は 401。
- `GET /api/v1/auth/passkeys` (セッション): 自分のパスキー一覧 `{ items: [{ id, name, createdAt, lastUsedAt }] }`。
- `POST /api/v1/auth/passkeys/options` (セッション) → 自分用の登録オプション (登録済みを除外)。
- `POST /api/v1/auth/passkeys` (セッション): `{ credential, name? }` → 201。1 ユーザー 10 個まで。
- `PATCH /api/v1/auth/passkeys/:id` (セッション): `{ name }`。`DELETE /api/v1/auth/passkeys/:id` (セッション): 最後の 1 つは 409。
- `POST /api/v1/auth/passkey-link/options` (公開): `{ token }` → `{ options, user: { email, name } }`。無効・期限切れは 404。
- `POST /api/v1/auth/passkey-link` (公開): `{ token, credential }` → パスキー追加、リンク消費、セッション発行 → `{ user }`。
- `POST /api/v1/auth/login` (パスワード) は削除。
- パスキー管理はセッション専用 (API キーでは操作できない)。

### 完了条件

- server のテスト: 各エンドポイントの正常系・認可・409/404 (サービスはモック)。
- 実サーバーでソフトウェア認証器を使い、セットアップ → ログアウト → パスキーでログイン → パスキー追加・削除が通る。D1 クエリ数を記録する。

### 決定

- `requireSession` (セッション必須、API キーは 403、変更系は CSRF 照合) と `sessionUser(c)` を middleware に追加した。RP 名は設定のサイト名 (セットアップでは入力されたサイト名)。
- **開発サーバー経由の origin 不一致を実サーバーで見つけて直した。** `pnpm dev` の管理画面 (:5174) は `/api` を Worker にプロキシし、Worker が受け取る URL も Host も Worker 自身のポートになっていた (ブラウザの CSRF 照合は `Sec-Fetch-Site: same-origin` で通るため、これまで表に出なかった)。localhost に限り `Origin` を受け入れる (全体設計への追記)。本番ドメインではヘッダーを一切使わない (`relying-party.test.ts`)。
- 実サーバーのスモーク (新しい DB、ソフトウェア認証器): セットアップ → 2 回目のセットアップは 409 → 同じ応答の再送は 401 → ログアウトとログイン → 同じアサーションの再送は 401 → 別 origin は 401 → RS256 のパスキー追加とログイン → 名前変更 → 削除 → 最後の 1 つは 409 → 削除済みのパスキーは 401 → `passkey:link` で復旧 → リンクの再利用は 404。
- D1 クエリ数 (セッション Cookie の確認 1 回を含む): セットアップのオプション 2、セットアップ完了 16 (サンプル投入込み)、ログインのオプション 1、ログイン 4、パスキー追加のオプション 5、追加 4、名前変更 2、削除 2、リンクのオプション 4、リンク完了 4。すべて Workers Free の 50 に収まる。
- テスト: server 151 件 (auth・setup・relying-party を追加し、starter のテストからセットアップの分を移した)。

---

## T37. 復旧用の登録リンク CLI

状態: `done` (2026-11-08)

### 仕様

- `pnpm passkey:link <email> [--remote] [--url <サイトの URL>]` (ルートから `@kanso/server` のスクリプトを呼ぶ)。
- 32 バイトのランダムトークンを作り、SHA-256 を `passkey_links` に `wrangler d1 execute DB --local|--remote` で書き込む (バインディング名で指定するので create-kanso で D1 の名前を変えても動く)。有効期限 1 時間。
- 該当メールのユーザーがいなければエラー終了。成功したら `<url>/admin/passkey-link?token=…` を表示する (`--url` 省略時は `http://localhost:5173`)。

### 完了条件

- ローカル D1 で発行したリンクから登録・ログインできる (T38 の画面で確認)。存在しないメールで非 0 終了。

### 決定

- `apps/server/scripts/passkey-link.mjs` (依存なし)。wrangler は `wrangler/package.json` の `bin` から解決して `node` で直接起動する (Windows の `.cmd` とシェルの引用の問題を避ける)。`--json` の結果で挿入された行を確かめ、該当ユーザーがいなければ非 0 で終了する。
- メールアドレスは引用符・セミコロン・バックスラッシュを含まない形だけ受け付け、さらに `'` をエスケープして SQL に埋め込む。トークンは 32 バイトで、DB には SHA-256 だけを書く。
- create-kanso はリポジトリをそのままコピーするので、生成したサイトにもスクリプトが入る。生成 README の手順にも復旧コマンドを書いた。

---

## T38. 管理画面

状態: `done` (2026-11-08)

### 仕様

- セットアップ: パスワード欄をなくし、ボタンを「パスキーを作成してセットアップ」にする。パスキーの説明を短く添える。
- ログイン: 「パスキーでログイン」ボタンだけ。パスキーをなくしたときの案内 (`pnpm passkey:link`) を小さく出す。
- アカウント (`/admin/account`、全ユーザー): 名前・メール、パスキー一覧 (名前・作成日・最終使用)、追加・名前変更・削除 (最後の 1 つは削除不可)。ナビに「アカウント」。
- 登録リンク (`/admin/passkey-link?token=…`): 対象のメールを表示し、パスキーを作るとログインしてダッシュボードへ。
- ブラウザ API のエラーを日本語にする (キャンセル・時間切れ、この端末に登録済み、非対応ブラウザ)。

### 完了条件

- 実ブラウザ (Windows Hello など) でセットアップ・ログイン・追加・削除ができる。admin のテストを追加する (WebAuthn の JSON 変換)。

### 決定

- `lib/passkey.ts`: options JSON と `ArrayBuffer` の変換を自前で行う (`PublicKeyCredential.parseCreationOptionsFromJSON` はまだ全ブラウザに揃っていないため使わない)。ブラウザと API のエラーを日本語に変換する。新しいパスキーの名前は User-Agent から「Windows の Chrome」のように付け、アカウント画面で変更できる。
- セットアップはパスキーを作ってからアカウントを作るので、ダイアログを閉じてもやり直せる。409 は「セットアップはすでに完了しています」と案内する。
- アカウント画面: 種類は BS フラグから「同期されるパスキー / この端末だけ」。パスキーが 1 つだけのときは別の端末での追加を勧める案内を出し、削除ボタンを無効にする。
- 登録リンクの画面は表示時にオプションを取得し (チャレンジを発行)、失敗したら取り直す (チャレンジは 1 回で消えるため)。成功したらアカウント画面へ移る。
- 画面の確認は Chromium の仮想認証器で行った (セットアップ → アカウント → ログアウト → UV なしでの失敗表示 → ログイン)。Windows Hello での確認はユーザーに依頼する。
- テスト: admin 28 件 (passkey を追加)。

---

## T39. E2E + ドキュメント

状態: `done` (2026-11-08)

### 仕様

- E2E の API ログインはソフトウェア認証器 (固定のテスト用鍵、カウンタ 0) で行う。開発 DB の E2E 管理者にテスト用パスキーがなければ、`passkey:link` で発行したリンクで登録してから続ける。
- 画面のテストは API セッションの Cookie をブラウザに渡してログイン済みにする。パスキーの画面操作は専用のテストで、Chromium の仮想認証器 (CDP `WebAuthn`) を使い「アカウントでパスキー追加 → ログアウト → パスキーでログイン → 削除」を通す。
- ドキュメント: architecture (認証・データモデル・ルーティング・フェーズ表)、README (ログイン・復旧・既存 DB の移行)、create-kanso の生成 README。

### 完了条件

- 新しい DB と開発 DB の両方で E2E が通る。

### 決定

- E2E の管理者は、固定のテスト用鍵を持つソフトウェア認証器 (カウンタ 0) でログインする。その鍵が未登録 (`not registered`) なら、`passkey:link` をローカル D1 に実行して登録する。
- 既存の 3 つのテストは、API のセッション Cookie をブラウザに渡してログイン済みにする (`shareSession`)。仮想認証器のカウンタは実行ごとに 0 から増えるため、固定の鍵をブラウザで使い回すと、カウンタの巻き戻りとして拒否される。ブラウザでのパスキー操作は `passkeys.spec.ts` が毎回新しい資格情報を作って行う。
- ブラウザでログアウトすると共有していた API のセッションも消えるので、`passkeys.spec.ts` の後片付けは再ログインしてから行う (1 回目の実行で見つけた)。
- E2E の型検査は `@types/node` を使わない方針なので、`node:child_process` の必要な宣言だけを `e2e/node.d.ts` に置いた。
- 結果: 新しい DB で画面からセットアップしたあと 4 件成功・1 件スキップ (サンプル投入済みのため)、空の DB (E2E がセットアップ) で 5/5、開発 DB (0006 を適用。パスワード時代のユーザー 1 人とセッション 80 件はそのまま残った) で 5/5。
- ドキュメント: architecture (認証・データモデル・ルーティング・セキュリティ・フェーズ表)、README (セットアップ、パスキーをなくしたとき、パスワード版からの移行、E2E、API の例を API キーに)、create-kanso の生成 README。

---

## 後続候補 (このフェーズの範囲外)

- 復旧リンクを使ったときに、ほかのパスキーやセッションをまとめて無効にする選択肢 (端末を盗まれた場合)。今はアカウント画面で個別に削除する。
- ユーザー管理画面 (編集者の招待は登録リンクで行える土台がある)。
- メールのログインリンク、GitHub / Google ログイン。
- ログイン画面のパスキー自動入力 (conditional mediation)。
