# Phase 2 タスクボード — 問い合わせフォーム

目的: **問い合わせフォームを管理画面で作り、固定ページ/投稿の本文に埋め込み、送信を保存・メール通知できる** 状態にする ([architecture.md §8](../architecture.md))。

運用ルール (Phase 1 と同じ):

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T8 | フォーム定義スキーマ + forms service + 管理 API + 設定 `forms` | done | shared, core, server |
| T9 | 公開送信 API (`POST /api/v1/public/forms/:slug/submissions`): 検証, honeypot, Turnstile, meta | done | shared, server |
| T10 | メール通知 (Cloudflare Email Service `send_email` バインディング) | done | core, server |
| T11 | 管理画面: フォーム一覧/編集 (フィールドビルダー), 送信一覧/詳細/CSV, 設定 | done | server, admin |
| T12 | 本文への埋め込み: `form` ブロックノード (Tiptap + レンダラ) と公開側の `<form>` 描画 + 非 JS 送信 | done | shared, core, server, admin |
| T13 | (小) excerpt を保存せず描画時に生成する (Phase 1 の既知の制限) | todo | core, server |

Phase 2 の決定事項 (ユーザー確認済み):

1. **Turnstile は既定オフ**。フォームごとに ON/OFF でき、サイトキーは設定画面、シークレットは Worker secret (`TURNSTILE_SECRET_KEY`) で「設定しやすく」する。
2. 本文への埋め込みは **Tiptap のブロックノード** (`form { attrs: { slug } }`)。ショートコード文字列は使わない。
3. 通知メールの **差出人 (`fromEmail` / `fromName`) と既定の宛先 (`notifyTo`) を設定 (`settings.forms`) に持つ**。フォーム側の `notifyTo` が空なら設定の既定宛先を使い、両方空なら保存のみ。

---

## 共通の約束 (全タスク)

- **コード規約**: TypeScript strict, `verbatimModuleSyntax`, 相対 import は `.ts`/`.tsx` 拡張子付き。Biome (シングルクォート, セミコロンなし, 100 桁)。コメント・識別子は英語。
- **層の責務**: `packages/shared` = zod スキーマ/定数 (ブラウザ安全, 依存なし)。`packages/core` = Drizzle + サービス (Hono 非依存, Cloudflare 型は `@cloudflare/workers-types` から `import type`)。`apps/server` = Hono ルート。`apps/admin` = React。
- **サービスの形**: `xxxService(db)` がクロージャを返す (例: [post-types.ts](../../packages/core/src/services/post-types.ts))。`createKanso()` に登録して `c.var.kanso.xxx` で使う。
- **エラー**: `KansoError` ([errors.ts](../../packages/core/src/errors.ts)) を throw する。HTTP への変換は `middleware/error.ts` のみ。検証エラーの `details` は `{ path, message }[]` ([validate.ts](../../apps/server/src/api/validate.ts) と同じ形)。
- **入力検証**: API は `@hono/zod-validator` の `zValidator` + `validationHook`。
- **RPC 型**: `apps/server/src/api/index.ts` の `api` はメソッドチェーンで組み、`ApiType` が admin の `hc<ApiType>` に流れるようにする。
- **時刻**: DB は unix 秒 (`mode: 'timestamp'`)。API の JSON では ISO 8601 文字列。
- **キャッシュ**: 公開 HTML は 60 秒キャッシュ ([cache.ts](../../apps/server/src/middleware/cache.ts))。POST は通らない。フォーム定義の変更は purge しない (60 秒で反映)。
- **secret の扱い**: `Bindings` ([env.ts](../../apps/server/src/env.ts)) は生成された `Env` と一致していなければならず、`wrangler types` は `.dev.vars` の有無で出力が変わる。secret は `Bindings` に足さず、`apps/server/src/secrets.ts` の `secret(env, name)` 経由で読む (T8 で追加)。
- **禁止**: git 操作 (commit/stash/checkout など)、ポート 5173 の使用 (別プロセスが占有中。開発サーバは `--port 5199`)、`worker-configuration.d.ts` の手編集 (`pnpm types` で再生成はよい)、既存マイグレーション SQL の編集 (変更は新しいマイグレーションを追加)。
- **D1 マイグレーション**: `pnpm db:generate` の出力は必ず読んでから採用する。D1 はマイグレーション全体を暗黙のトランザクションで実行するため `PRAGMA foreign_keys=OFF` が効かず、drizzle-kit の「テーブル再作成」パターンで親テーブルを `DROP` すると `ON DELETE CASCADE` の子行がリモートで消える。親を作り直すときは「`__new_親` を作成 → コピー → 子も `__new_親` を参照する `__new_子` として作り直し → コピー → 旧子 `DROP` → 旧親 `DROP` → `RENAME` (SQLite が FK 参照先を書き換える) → index 再作成」の順で手書きし、行のある DB に適用して確認する (例: [0001_forms_turnstile_default.sql](../../packages/core/migrations/0001_forms_turnstile_default.sql))。ファイル名は `NNNN_意味のある名前.sql` とし、`meta/_journal.json` の `tag` を合わせる。
- **UNIQUE 違反の判定**: drizzle は driver エラーを `DrizzleQueryError` で包み `message` にはクエリしか入らない。`errors.ts` の `isUniqueViolation(error)` (cause を辿る) を使い、`error.message` を直接見ない。
- **zod の `.partial()` と `.default()`**: zod 4 では `.partial()` 後も `.default()` が適用され、PATCH で省略したフィールドが既定値に戻る。update 用スキーマには `.default()` を付けない (create 用にだけ `extend` で付ける。例: [forms.ts](../../packages/shared/src/forms.ts))。
- **完了条件 (共通)**: `pnpm typecheck` / `pnpm check` / `pnpm test` / `pnpm build` がすべて成功。

---

## T8. フォーム定義スキーマ + forms service + 管理 API + 設定 `forms`

状態: `done`

### ゴール

- フォーム (フィールド定義つき) を API で CRUD でき、送信データをフォーム定義で検証できる (公開送信エンドポイント自体は T9)。
- 送信の一覧/詳細/既読/削除が API でできる。
- 通知メールの差出人・既定宛先・Turnstile サイトキーを設定 API で読み書きできる。

### 仕様

**packages/shared/src/forms.ts** (新規。`index.ts` から re-export)

- 定数: `FORM_FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'] as const`, `FORM_FIELDS_MAX = 30`, `FORM_FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/`。
  - `name` は `_` 始まりとハイフンを含む文字列を許さないので、`_hp` / `_form` / `_return` / `cf-turnstile-response` (T9/T12 で使う予約キー) と衝突しない。
- フィールド共通: `name: z.string().regex(FORM_FIELD_NAME_PATTERN)`, `label: z.string().trim().min(1).max(100)`, `required: z.boolean().default(false)`, `placeholder: z.string().trim().max(200).nullable().default(null)`, `help: z.string().trim().max(300).nullable().default(null)`。
- `formFieldSchema` = `type` の discriminated union:
  - `text` / `email` / `tel`: `maxLength: z.number().int().min(1).max(500).default(200)`
  - `textarea`: `maxLength: z.number().int().min(1).max(10000).default(2000)`, `rows: z.number().int().min(2).max(20).default(5)`
  - `select`: `options: z.array(z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(100) })).min(1).max(50)`。`value` の重複は拒否。
  - `checkbox`: 追加属性なし (`label` が同意文。`required` は「チェック必須」)。
- `formFieldListSchema = z.array(formFieldSchema).min(1).max(FORM_FIELDS_MAX)` + `name` 重複を拒否する `refine`。
- `notifyToSchema`: `z.string().max(1000)` を `transform` で「カンマ/空白区切り → trim → 空要素除去」し、各要素を `z.email()` で検証 (最大 10 件)、`,` 連結の正規化文字列に戻す (型は `string`)。
- `redirectUrlSchema`: `http(s):` の絶対 URL か `/` 始まりの相対パス (`//` 始まりは不可)。`z.string().trim().max(2000)` + `refine`。
- `formFieldsSchema = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(120), fields: formFieldListSchema, notifyTo: notifyToSchema.default(''), successMessage: z.string().trim().max(1000).default(''), redirectUrl: redirectUrlSchema.nullable().default(null), turnstile: z.boolean().default(false) })`
- `createFormSchema = formFieldsSchema.partial().required({ slug: true, name: true, fields: true })`, `updateFormSchema = formFieldsSchema.partial()`。型 `FormField`, `CreateFormInput`, `UpdateFormInput` を export。
- 送信データ:
  - `type SubmissionValues = Record<string, string | boolean>`
  - `type SubmissionMeta = { ip: string | null; userAgent: string | null; referrer: string | null; country: string | null }`
  - `submissionSchemaFor(fields: FormField[]): z.ZodType<SubmissionValues, Record<string, unknown>>`。入力は HTML フォーム由来 (`Record<string, unknown>`; 値は string 想定、string 以外は `''` 扱い、checkbox は `true` / `'on'` / `'true'` / `'1'` / `'yes'` を true)。未知キーは捨てる。
    - `text`/`textarea`: trim。`required` なら `min(1)`。`max(maxLength)`。
    - `email`: 空でなければ `z.email()`。`tel`: 空でなければ `/^[0-9+()\-\s]{3,40}$/`。
    - `select`: `options[].value` のいずれか。`required` でなければ `''` も可。
    - `checkbox`: boolean。`required` なら `true` のみ。
    - エラーの `path` はフィールド `name`。
- `submissionListQuerySchema = z.object({ page, perPage (listQuerySchema と同じ), unread: z.enum(['true', 'false']).optional() })`。

**packages/shared/src/settings.ts**

- `formsSettingsSchema = z.object({ fromEmail: z.union([z.email(), z.literal('')]).default(''), fromName: z.string().trim().max(100).default(''), notifyTo: notifyToSchema.default(''), turnstileSiteKey: z.string().trim().max(200).default('') })`, 型 `FormsSettings`。`SETTINGS_KEYS.forms = 'forms'`。
- `fromEmail` が空 = 通知メール無効 (T10)。`notifyTo` はフォーム側が空のときの既定宛先。

**packages/core**

- `db/schema/forms.ts`: `fieldsJson` を `$type<FormField[]>()` に、`turnstile` の既定を `false` に変更。`pnpm db:generate` で `migrations/0001_*.sql` を生成する (drizzle-kit は SQLite の default 変更をテーブル再作成で出す。`form_submissions` の FK / index が残ることを SQL で確認)。既存の `0000_init.sql` は触らない。
- `services/forms.ts` (新規): `formsService(db)`
  - `list()` → `{ id, slug, name, notifyTo, turnstile, createdAt, updatedAt, submissionCount, unreadCount }[]` (name 順。件数は `form_submissions` を `group by form_id` で 1 クエリ)
  - `get(id)` (なければ `KansoError.notFound('Form')`), `findBySlug(slug)` (公開側用, null 可)
  - `create(input: CreateFormInput, context: FormContext)`, `update(id, input, context)`, `delete(id)` (submissions は cascade)。slug 重複は `KansoError.conflict('Form slug already exists')`。
  - `FormContext = { turnstileAvailable: boolean }`。保存後の `turnstile` が `true` で `!turnstileAvailable` なら `KansoError.validation('Turnstile is not configured')`。
  - `validateSubmission(form, raw: Record<string, unknown>): SubmissionValues` — `submissionSchemaFor(form.fieldsJson)` で検証し、失敗は `KansoError.validation('Invalid submission', issues)`。
  - `submissions.list({ formId, page = 1, perPage = 20, unread?: boolean })` → `{ items, total }` (新しい順)
  - `submissions.get(formId, id)` (フォーム不一致は notFound), `submissions.create(formId, values, meta)`, `submissions.markRead(formId, id, read: boolean)` (`readAt` を now / null), `submissions.delete(formId, id)`
- `services/settings.ts`: `forms: () => get(SETTINGS_KEYS.forms, formsSettingsSchema)` を追加。
- `index.ts`: `createKanso()` に `forms: formsService(db)` を登録。
- テスト: `packages/shared/src/forms.test.ts` (未知 type 拒否, name 重複拒否, notifyTo 正規化と不正メール拒否, redirectUrl の可否, `submissionSchemaFor` の required/optional・email・select・checkbox 変換・未知キー除去・maxLength)。

**apps/server**

- `src/secrets.ts` (新規): `interface Secrets { TURNSTILE_SECRET_KEY?: string }`, `secret(env: Bindings, name: keyof Secrets): string | undefined` (空文字は undefined 扱い)。
- `src/forms/turnstile.ts` (新規): `turnstileConfig(c): Promise<{ siteKey: string; secretKey: string } | null>` (設定の `turnstileSiteKey` と secret の両方があるときだけ非 null)。T9 で検証関数を足す。
- `src/api/settings.ts`: `GET /` の応答に `forms` と `turnstileSecretConfigured: boolean` を追加。`PUT /forms` (body `formsSettingsSchema`) を追加。
- `src/api/forms.ts` (新規。`protectedApi` に `/forms` で route):
  - `GET /` → `{ items }`
  - `POST /` → 201 `{ item }` (`createFormSchema`)
  - `GET /:id` → `{ item }`, `PATCH /:id` → `{ item }` (`updateFormSchema`), `DELETE /:id` → `{ ok: true }`
  - `GET /:id/submissions` (`submissionListQuerySchema`) → `{ items, total, page, perPage }`
  - `GET /:id/submissions/:submissionId` → `{ item }`
  - `PATCH /:id/submissions/:submissionId` body `{ read: boolean }` → `{ item }`
  - `DELETE /:id/submissions/:submissionId` → `{ ok: true }`
  - 認可は `protectedApi` の既定 (GET は read, 変更は write)。
- `wrangler.jsonc` のコメントに `.dev.vars` の例 (`TURNSTILE_SECRET_KEY=...`) を追記。`.dev.vars.example` を新規作成 (中身はキー名とコメントのみ)。

### 完了条件

- 共通条件。`pnpm db:migrate:local` で新マイグレーションが適用できる。
- スモーク (レビュー側で実施): forms CRUD、`turnstile: true` が未設定時に 400、`validateSubmission` 相当の検証 (T9 まではサービス単体)、settings `forms` の往復。

### 決定

- フォーム一覧の送信数・未読数は `form_submissions` の `form_id` 集計を 1 クエリで取得し、名前順のフォーム一覧へ結合する。
- Turnstile はサイトキーと `TURNSTILE_SECRET_KEY` の両方がある場合だけ利用可能とし、secret は生成 `Env` と一致させる `Bindings` には追加しない。
- マイグレーションは drizzle-kit 生成 (`0001_right_wilson_fisk.sql`) を採用せず、[0001_forms_turnstile_default.sql](../../packages/core/migrations/0001_forms_turnstile_default.sql) として手書きした (共通の約束「D1 マイグレーション」参照)。生成版は `PRAGMA foreign_keys=OFF` 前提で `DROP TABLE forms` するため、リモート D1 では送信が全件 cascade 削除される。行のある空 DB (`--persist-to` で scratch) に適用し、行数維持・FK 参照先が `forms` に書き換わること・cascade が引き続き動くことを確認した。
- `.dev.vars.example` を ignore 対象外にし、実値を含まない `TURNSTILE_SECRET_KEY` の雛形だけを管理する。
- レビュー修正 (2026-09-15): (1) `updateFormSchema` が `.default()` を引き継ぎ、`PATCH {name}` だけで `turnstile`/`notifyTo`/`successMessage`/`redirectUrl` が既定値に戻っていた → 既定値を `createFormSchema` 側に移した。(2) slug 重複が 409 でなく 500 になっていた (drizzle の `DrizzleQueryError` は `message` にクエリしか持たない) → `isUniqueViolation()` を `errors.ts` に追加し、pages/posts/post-types/taxonomies も同じヘルパに置き換えた (これらは事前チェックで救われていたが、競合時は同じく 500 だった)。(3) `submissions.list` が存在しないフォームでも空配列を返していた → 先に `get(formId)` で 404。
- スモーク (`:5199`): settings `forms` の往復と `notifyTo` 検証、forms CRUD、重複 slug 409、`turnstile: true` が未設定時 400、site key + `.dev.vars` の secret がそろうと 201、site key を消した後の名前だけの PATCH は 400、submissions の list/get/markRead/unread フィルタ/delete と一覧の件数集計、未知フォームの 404 を確認。

---

## T9. 公開送信 API

状態: `done`

### ゴール

認証なしで `POST /api/v1/public/forms/:slug/submissions` に送信でき、スパム対策 (honeypot, 任意で Turnstile) を通った送信だけが保存される。

### 仕様

- `apps/server/src/api/public-forms.ts` (新規): `api` 直下 (`protectedApi` の外) に `/public/forms` で mount。`requireAuth` を通さない。
- 受け付ける Content-Type: `application/x-www-form-urlencoded`, `multipart/form-data` (ファイルは無視), `application/json`。本文サイズ上限 64 KB (`content-length` と読み取り後の両方で確認、超過は `KansoError.validation('Request body too large')`)。
- 予約キー: `_hp` (honeypot。空でなければ **成功と同じ応答を返して保存しない**), `cf-turnstile-response` (Turnstile トークン), `_return` / `_form` (T12 のサイト側 POST 用。API では無視)。
- 処理: `forms.findBySlug` (なければ 404) → honeypot → `form.turnstile` なら `verifyTurnstile(secretKey, token, remoteIp)` (`https://challenges.cloudflare.com/turnstile/v0/siteverify`, 失敗は `KansoError.validation('Turnstile verification failed')`; `turnstileConfig` が null なら `KansoError.validation('Turnstile is not configured')`) → `validateSubmission` → `submissions.create(formId, values, meta)`。
- `meta`: `ip = cf-connecting-ip`, `userAgent`, `referrer = referer`, `country = c.req.raw.cf?.country` (いずれも無ければ null)。
- 応答 (201): `{ ok: true, message: form.successMessage, redirectUrl: form.redirectUrl }`。検証失敗は `onError` の JSON (`details` にフィールド別 `{ path, message }`)。
- T10 のフック: 保存後に `c.executionCtx.waitUntil(notify(...))` を呼べる位置を用意する (T9 では何もしない)。
- `apps/server/src/forms/submit.ts` に「本文 → 保存」までを `submitForm(c, form, raw: Record<string, unknown>)` として切り出し、T12 のサイト側 POST から再利用する。
- CORS: ヘッドレス利用 (別オリジンの JS から JSON 送信) のため、この router だけ `hono/cors` を `origin: '*'`, `allowMethods: ['POST', 'OPTIONS']`, `allowHeaders: ['Content-Type']` で付ける (認証なし・cookie 不要なので `*` でよい)。他の API には付けない。
- テスト: `apps/server/src/forms/turnstile.test.ts` (`fetch` を差し替えて成功/失敗)、honeypot / サイズ上限 / 検証エラーのテストは `apps/server/src/api/public-forms.test.ts` で、`c.set('kanso', stub)` する小さな Hono アプリに `publicForms` と `onError` を載せて `app.request()` で行う (vitest は node 環境。D1 は使わない)。

### 完了条件

- 共通条件。curl で `application/x-www-form-urlencoded` と JSON の両方から送信でき、`required` 未入力が 400 で返る。

### 決定

- 公開ルーターだけに `origin: '*'` の CORS を付け、`protectedApi` の外へ mount する。本文は `Content-Length` と読み取り後の実バイト長の両方で 64 KB 以下を確認する。
- 3 種の本文を一度だけ読み、JSON はトップレベル object のみ、URL encoded は文字列値、multipart は文字列 part だけを採用してファイルを無視する。
- honeypot と Turnstile を含む予約キーの除去は再利用可能な `submitForm` 内で行い、検証・保存には渡さない。honeypot 検出時は通常と同じ 201 応答を返し、保存しない。
- `submitForm` は保存行 (honeypot 時は `null`) と成功表示情報を返し、保存直後に T10 の `waitUntil` 通知を追加できる位置を明示する。
- レビュー修正 (2026-09-15): 本文を `arrayBuffer()` で丸ごと読んでから長さを見ていたため、`Content-Length` なし (chunked) の巨大本文を Worker がメモリに溜め込めた → `request.body` を `getReader()` で読みつつ累計が 64 KB を超えた時点で `cancel()` して 400 にする `readBody()` に変更し、ストリーム本文のテストを追加。
- 開発サーバ (Vite) は OPTIONS preflight を自前の CORS 設定で先に応答するため、`:5199` では Worker 側の `hono/cors` の値が見えない (本番では Worker が応答する。ユニットテストで確認済み)。
- スモーク (`:5199`): urlencoded / JSON / multipart (ファイル無視) の 3 形式で 201 と保存内容・meta (`userAgent`, `referer`, `cf.country`) を確認。required 未入力 400 (`details` にフィールド別)、honeypot 201 で未保存、未知 slug 404、`text/plain` 400、70 KB 本文 (Content-Length あり / chunked) とも 400。
- 既知の課題 (T12 で対応): required 未入力時の zod 既定メッセージ (`Too small: expected string to have >=1 characters`) は利用者向けではない。サイト側の `<form>` 再描画ではフィールドラベルを使った文言に置き換える。

---

## T10. メール通知

状態: `done`

### ゴール

送信が保存されたら、宛先 (フォームの `notifyTo`、空なら設定の既定宛先) に Cloudflare Email Service で通知メールを送る。送信失敗はログに残し、フォーム送信自体は失敗させない。

### 仕様

- `apps/server/wrangler.jsonc` に `"send_email": [{ "name": "EMAIL" }]` を追加し、`pnpm types` で `worker-configuration.d.ts` を再生成。`Bindings` に `EMAIL: SendEmail` (`import type { SendEmail } from '@cloudflare/workers-types'`) を追加。
  - 実装前に Cloudflare Docs (`https://developers.cloudflare.com/email-service/`) で `send_email` バインディングの `send()` シグネチャとローカル開発時の挙動を確認して「決定」に記録する。
- `packages/core/src/mail/notification.ts` (新規, 純粋関数): `buildSubmissionNotification({ form, values, submissionId, siteTitle, adminUrl }) → { subject, text, html }`。件名 `[siteTitle] ${form.name}` 、本文はフィールドの `label: value` を順に並べ、末尾に管理画面の送信詳細 URL。HTML はエスケープ必須。テスト `notification.test.ts`。
- `apps/server/src/forms/notify.ts` (新規): `notifySubmission(c, form, submission)`:
  - `settings.forms()` を読み、`fromEmail` が空、または宛先 (form.notifyTo → settings.notifyTo) が空なら何もしない (`{ skipped: reason }` を返す)。
  - `c.env.EMAIL.send({ to, from: { email: fromEmail, name: fromName || siteTitle }, replyTo?: 送信データに `email` 型フィールドがあればその値, subject, text, html })`。宛先が複数なら 1 通ずつ。
  - 例外は `console.error(JSON.stringify({ level: 'error', event: 'form_notify_failed', formId, submissionId, message }))` で握りつぶす。
- T9 の `submitForm` 保存後に `c.executionCtx.waitUntil(notifySubmission(...))` を呼ぶ。
- ローカル開発で `EMAIL` バインディングが無い/失敗する場合の挙動を README に書く。

### 完了条件

- 共通条件。ローカルで送信し、ログまたは wrangler のローカルメール出力に通知内容が出る (実際の配信はドメインのオンボーディング後)。

### 決定

- `@cloudflare/workers-types@5.20260910.1` の `SendEmail.send()` は `EmailMessage` と
  `EmailMessageBuilder` の両方を受け取る。後者の
  `{ to, from: { email, name }, replyTo?, subject, text, html }` を使い、旧
  `EmailMessage` + `mimetext` 経路は使わない。成功値は `{ messageId }`。
- `send_email` は `{ "name": "EMAIL" }` のローカルバインディングとする。
  `"remote": true` は実サービスへプロキシして実メールを送るため設定せず、README
  に一時利用時の注意を記載する。本番の差出人ドメインは
  `wrangler email sending enable <domain>` でオンボーディングする。
- ローカルの Miniflare は送信せず、`send_email binding called with MessageBuilder:` と
  From/To/Reply-To/Subject を開発サーバへ出力し、text/html 本文を
  `.wrangler/` 配下のファイルへ保存して `{ messageId }` を返す。
- 今回の Vite スモークではエミュレーションと本文ファイル生成は確認できたが、端末表示は
  From/To/Subject のみで Reply-To 行は表示されなかった。`send()` に Reply-To が渡ることは
  server テストで確認した。
- 宛先分解は shared の `notifyToAddresses()` に統一する。フォーム宛先を優先し、空なら
  設定宛先へフォールバックする。宛先ごとに順次 `send()` し、1件の失敗後も残りを送る。
- `fromEmail` が空なら `no_from`、宛先が空なら `no_recipients` としてスキップする。
  差出人名は `fromName || site.title`、Reply-To は定義順で最初の非空 email
  フィールド値とする。
- 通知本文は core の純粋関数で、定義順・boolean の `Yes` / `No`・空の欠損値を扱う。
  HTML のフォーム名、サイト名、ラベル、値、URL はすべてエスケープし、textarea の
  改行は `<br>` にする。
- 管理詳細 URL は
  `${SITE_URL}/admin/forms/${form.id}/submissions/${submission.id}` とする。T11 の詳細
  ルートもこの規約に合わせる。
- 保存後のみ `executionCtx.waitUntil()` へ通知 Promise を渡す。通知処理は設定読込を含む
  全例外を握り、`form_notify_failed` に form/submission ID、message、任意の code
  だけを記録する。宛先、送信値、件名、本文はログへ出さない。
- 本番エラーの `E_SENDER_NOT_VERIFIED`、`E_RECIPIENT_NOT_ALLOWED`、
  `E_RATE_LIMIT_EXCEEDED` などは Error の `code` として同ログへ含める。
- レビュー修正: Codex が `apps/server` 内で再生成した `worker-configuration.d.ts` は
  `Cloudflare.GlobalProps { mainModule }` が欠けていたため、リポジトリルートで
  `pnpm types` を再実行して復元した (差分は `EMAIL: SendEmail` の追加のみ)。
  `pnpm types` は必ずルートから実行する。
- スモーク (`:5199`): 宛先 2 件で `send_email binding called with MessageBuilder:` が
  2 ブロック出力され、`From` は `fromName` 空時にサイト名へフォールバック、
  `.wrangler/tmp/email/…/email-text|email-html` にエスケープ済み本文
  (`&lt;b&gt;`、textarea 改行 → `<br>`、checkbox → `Yes`、管理 URL) が保存された。
  フォーム側 `notifyTo` が設定宛先を上書きすること、`fromEmail` 空で送信なし、
  honeypot で送信なしを確認。`@cloudflare/vite-plugin` の開発サーバでも `EMAIL` は
  エミュレートされる。通知は `waitUntil` で走るため送信レスポンスは約 46 ms。

---

## T11. 管理画面: フォームと送信

状態: `done`

### ゴール

管理画面でフォームを作成・編集 (フィールドビルダー) し、送信を一覧・閲覧・既読・削除・CSV ダウンロードできる。設定画面で通知の差出人/既定宛先/Turnstile サイトキーを編集できる。

### 仕様

- API 追加 (`apps/server/src/api/forms.ts`): `GET /:id/submissions/export.csv` → `text/csv; charset=utf-8`、BOM 付き、ヘッダ行は `id, createdAt, readAt, <field label>...`、`ip`/`userAgent` は含めない。全件 (上限 10,000 行)。
- admin ルート: `/forms` (一覧: 名前, slug, 送信数/未読数, Turnstile), `/forms/new`, `/forms/$id` (編集), `/forms/$id/submissions` (一覧: ページング, 未読フィルタ, 行クリックで詳細ダイアログ or `/forms/$id/submissions/$sid`), 既読/削除, CSV リンク。
- `FormEditor` コンポーネント: 基本項目 (名前, slug (slugify 補助), 完了メッセージ, リダイレクト URL, 通知先, Turnstile トグル (設定未完了なら disabled + 説明)) とフィールドビルダー (追加/削除/並べ替え (上下ボタンで可), type ごとの属性, select の options 編集)。保存は `createFormSchema` / `updateFormSchema` でクライアント側も検証。
- 設定画面 (`/settings`) に「フォーム」セクション: `fromEmail`, `fromName`, `notifyTo`, `turnstileSiteKey`、および `TURNSTILE_SECRET_KEY` が設定済みかの表示 (API の `turnstileSecretConfigured`)。
- サイドバーに「フォーム」を追加 (editor も可)。`_auth.tsx` の `NavLinkProps['to']` を更新。
- `api/queries.ts` に `formsListQuery`, `formQuery`, `submissionsListQuery`, `submissionQuery` を追加。

### 完了条件

- 共通条件。ブラウザでフォーム作成 → curl で送信 → 管理画面で閲覧・既読・CSV の流れが通る。

### 決定

- `GET /forms` は `turnstileAvailable` を返す。設定 API を使えない editor も Turnstile を有効化できるか判断するため。
- CSV は UTF-8 BOM 付き・CRLF 区切りで、定義順のフィールドを古い送信から最大 10,000 行出力する。数式インジェクションを防ぎ、メタ情報は含めない。
- 管理画面は `forms/index.tsx`、`forms/new.tsx`、`forms/$id/index.tsx`、`forms/$id/submissions/index.tsx`、`forms/$id/submissions/$sid.tsx` のファイルルートで構成する。
- 未読の送信詳細を開いたときは一度だけ自動で既読にする。
- フォーム編集は `validateFormDraft` でクライアント検証し、zod の issue path を dotted path のフィールドエラーへ変換する。
- 作成・更新とも完全な検証済み body を送り、PATCH も全フィールドを送信する。
- `forms.submissions.get()` は `metaJson` を `SubmissionMeta` 型に正規化して返す (管理画面の
  メタ情報表示のため)。`formSubmissions.dataJson` の型は `SubmissionValues` にした。
- レビュー修正: `FormEditor` の行 `key` に `field.name` / `option.value` を含めていたため、
  名前や値を 1 文字入力するたびに行が再マウントされてフォーカスが外れていた。行は完全に
  制御されたコンポーネントなので index キーに変更した (biome-ignore で理由を明記)。
- スモーク (`:5199`, API 経由): 5 種のフィールドを持つフォームを作成 → 公開送信 3 件
  (`"`・カンマ・改行を含む値、`=HYPERLINK(...)`、`-cmd|calc`、`+81 …` の電話番号) →
  一覧で `submissionCount=3` / `unreadCount=3` / `turnstileAvailable=false` → CSV は BOM
  + CRLF、古い順、引用符エスケープ、`'=` / `'-` ガード、電話番号は無加工、boolean は
  `true`/`false` → PATCH 既読で `unreadCount=2` → `/admin/forms/12/submissions/18` など
  SPA のコールド URL が 200 → `PUT /settings/forms` の改行区切り宛先がカンマ結合で保存。
  サイトキーだけでは `turnstileAvailable` は false のまま (secret も必要)。ブラウザ操作は
  未確認 (ビルド済みバンドルに新画面が含まれることは確認)。

---

## T12. 本文への埋め込みと公開側の `<form>`

状態: `done`

### ゴール

エディタで「フォーム」ブロックを挿入すると、公開ページ/投稿にプレーンな `<form>` が描画され、JavaScript なしでも送信・結果表示ができる。Turnstile 有効時だけウィジェットのスクリプトを読み込む。

### 仕様

**ブロックノード**

- `packages/shared/src/richtext.ts`: block ノード `form { attrs: { slug: string (slugSchema) } }` を追加 (`richTextNodeSchema` / `blockNodeSchema` の両方)。
- `packages/core/src/content/render.ts`: `form` → `<div data-kanso-form="<slug>"></div>` (プレースホルダ。フォーム定義は保存時ではなく描画時に解決する)。`excerpt.ts` は `form` を無視。テスト追加。
- `apps/admin/src/components/editor/FormBlock.ts` (新規): atom block ノード `form`、`renderHTML` は `div[data-kanso-form]` に「フォーム: <slug>」を表示。Toolbar に「フォーム挿入」ボタン (forms 一覧からの選択 = `formsListQuery`)。

**公開側**

- `apps/server/src/site/forms.tsx` (新規):
  - `expandForms(html: string, forms: Map<slug, Form>, state?: FormState): string` — プレースホルダを `<KansoForm>` の HTML に置換。フォームが見つからなければプレースホルダを空にする。
  - `<KansoForm form state>` (hono/jsx): `<form method="post" action="<現在のパス>" class="kanso-form">` + hidden `_form=<slug>` + honeypot (`<input name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true">` を CSS で非表示) + 各フィールド (`label`/`input`/`textarea`/`select`/`checkbox`, `required`, `maxlength`, `placeholder`, `aria-describedby` で help/エラー) + Turnstile ON なら `<div class="cf-turnstile" data-sitekey>` + 送信ボタン。
  - `FormState = { slug, values?: SubmissionValues, errors?: { path, message }[], success?: boolean }`。成功時はフォームの代わりに `successMessage` (空なら既定文) を表示。
  - `renderPage` / `renderPost` は `bodyHtml` に `data-kanso-form` が含まれるときだけフォームを読み込んで `expandForms` する。Turnstile ON のフォームがあるときだけ `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer>` を `<head>` に入れる (`Layout` に `scripts?: string[]` prop)。
- `apps/server/src/site/routes.tsx`: `site.post('/')` と `site.post('/:path{.+}')` を追加。ページ/投稿を解決し (無ければ 404)、本文を `parseBody` (form-urlencoded / multipart) で読み、`_form` の slug でフォームを取得 → `submitForm(c, form, raw)` (T9)。
  - 成功: `redirectUrl` があれば 303 でそこへ。無ければ同じページを `state.success = true` で再描画 (200)。
  - 検証失敗 (`KansoError.validation`): 同じページを `values` と `errors` つきで再描画 (422)。それ以外のエラーは `onError` へ。
  - POST はキャッシュされない (既存の `siteCache` は GET のみ)。
- `apps/server/public/theme.css`: `.kanso-form` の最小スタイル (フィールド縦並び, エラー文の色, honeypot 非表示)。
- `docs/architecture.md` §5 に POST ルートと §6 に Turnstile スクリプトの読み込み条件を追記。

### 完了条件

- 共通条件。ブラウザ (JS 無効でも) で固定ページ内のフォームから送信 → 成功文表示 / 必須未入力でエラー表示 → 管理画面に送信が届く。Turnstile ON のフォームでウィジェットが出る (ローカルは Cloudflare のテスト用キーで確認)。

### 決定

- `form` ノードの `attrs.slug` は `slugSchema` で検証する。エディタ側 (`FormBlock.ts`) の既定値は
  `''` だが、挿入は `FormPicker` (フォーム一覧ダイアログ) 経由で必ず slug 付きで行う。
- 必須未入力/文字数超過の zod 既定メッセージは shared の `submissionSchemaFor` で
  `This field is required` / `Use at most N characters` に置き換えた (公開 API の `details` にも同じ文言が出る)。
- 公開側の文言は既存の 404 と同じく英語 (`Send`、`— Select —`、既定の成功文
  `Thank you. Your message has been sent.`)。テーマ側 i18n は Phase 3 の課題。
- `apps/server/src/site/forms.tsx`: `formSlugsIn(html)` / `expandForms(html, forms, { action,
  turnstileSiteKey, state })` / `prepareForms(c, html, action, state)` / `draftValues(form, raw)` と
  `<KansoForm form action turnstileSiteKey state>`。`action` はプレビューでも公開パス。
  Turnstile のスクリプトは「Turnstile ON のフォームが本文にあり、かつサイトキー + secret が揃っている」
  ときだけ `Layout` の `scripts` prop 経由で `<head>` に入る。
- `renderPage` / `renderPost` の `RenderOptions` に `form?: FormState` と `status?` を追加。
  `PostArticle` は展開済み `bodyHtml` を prop で受け取る。
- `routes.tsx` は `resolveContent(c, path)` でページ/投稿/その他ルートを判別し、GET と POST で共有する。
  POST は `_form` の slug が本文のプレースホルダに含まれない場合と未知パスで 404、`parseBody` の
  エラー (64 KB 超・未対応 Content-Type) は `onError` の plain text 400 のまま。応答は常に
  `cache-control: no-store`。
- `parseBody` は `apps/server/src/forms/body.ts` に移し、公開 API と site の両方から使う。
- `docs/architecture.md` の CSP 記述を実態 (未出力) に合わせ、Turnstile 利用時は
  `https://challenges.cloudflare.com` を許可する必要があることを明記した。
- レビュー修正: `site.get('/')` が `resolveContent(c, 'home')` を呼んでいたため、`home` ページが無い
  サイトで毎回 `postTypes.findBySlug('home')` が余分に走っていた → GET は従来の
  `findPublishedByPath('home')` に戻し、POST だけ `resolveContent` を使う。未使用の `ownPath` を削除。
- 既知の制限: 公開ページの Cache API (60 秒) はフォーム定義の変更で purge されないため、フォームを
  編集 (Turnstile の切替など) してから最大 60 秒は古い `<form>` が配信される。
- スモーク (`:5199`, curl, `.dev.vars` に Turnstile テスト用 secret を一時設定): 5 種のフィールドと
  存在しない slug のプレースホルダを含む公開ページで、GET はフォーム描画・未知 slug の除去・
  `<`/`"` のエスケープを確認 → 必須未入力 + 不正メールで 422 (`no-store`、入力値保持、`selected`、
  `aria-invalid` とフィールド別メッセージ) → 正常送信 200 で成功文 (HTML エスケープ済み) →
  honeypot 200 で未保存 → 本文にない `_form` / 未知パスで 404 → multipart 200 (ファイル無視) →
  `text/plain` 400 → Turnstile ON でスクリプトとウィジェット、トークン無しは 422
  `Turnstile verification failed`、ダミートークンで 200 → `redirectUrl` で 303 `location`。
  送信一覧 `total=4`。ブラウザ操作と実際の Turnstile ウィジェット表示は未確認 (ビルド済み
  バンドルに `FormPicker` が含まれることは確認)。

---

## T13. excerpt を描画時に生成する (小)

状態: `todo`

### ゴール

Phase 1 の既知の制限 (本文を編集しても自動生成 excerpt が古いまま) を解消する。

### 仕様

- `pages` / `posts` の `excerpt` 列にはユーザーが明示した値だけを保存する (`create` / `update` で `extractExcerpt` を呼ばない。空文字は null)。
- 公開側と一覧 API で「excerpt が null なら `extractExcerpt(bodyJson)`」で補う共通ヘルパー `effectiveExcerpt(row)` を `packages/core` に置き、`listPublished` / feed / SSR / sitemap 由来の description で使う。
- 既存データ: 保存済みの自動生成 excerpt はそのまま残す (マイグレーション不要)。
- `docs/architecture.md` §4 / §8 の該当記述を更新。

### 完了条件

- 共通条件。本文を PATCH した投稿の公開 description が新しい本文を反映する。

### 決定

- (実装中に追記)
