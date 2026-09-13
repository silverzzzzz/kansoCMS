# Phase 1 タスクボード — コア機能

目的: **ブログ + 固定ページのサイトを管理画面から公開できる** 状態にする ([architecture.md §8](../architecture.md))。

運用ルール:

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T1 | 認証コア + API 認証ミドルウェア + setup/login API | done | core, server, shared |
| T2 | 管理画面シェル (ルーター, setup/login, 認証ガード, レイアウト) | done | admin |
| T3 | 本文パイプライン (ProseMirror JSON 検証 → HTML, excerpt) | done | shared, core |
| T4 | pages / post_types / posts / taxonomies の service + CRUD API | done | shared, core, server |
| T5 | メディア: R2 アップロード API + 一覧/削除 | done | shared, core, server |
| T6 | 管理画面 CRUD UI + Tiptap エディタ + メディアライブラリ + 設定 | done | admin |
| T7 | 公開 SSR: 投稿タイプルート, アーカイブ, JSON-LD, sitemap/robots/feed, プレビュー, キャッシュ purge | done | seo, server, admin |

---

## 共通の約束 (全タスク)

- **コード規約**: TypeScript strict, `verbatimModuleSyntax`, 相対 import は `.ts`/`.tsx` 拡張子付き。Biome (シングルクォート, セミコロンなし, 100 桁)。コメント・識別子は英語。
- **層の責務**: `packages/shared` = zod スキーマ/定数 (ブラウザ安全, 依存なし)。`packages/core` = Drizzle + サービス (Hono 非依存, Cloudflare 型は `@cloudflare/workers-types` から `import type`)。`apps/server` = Hono ルート。`apps/admin` = React。
- **サービスの形**: `xxxService(db)` がクロージャを返す (例: [settings.ts](../../packages/core/src/services/settings.ts))。`createKanso()` に登録して `c.var.kanso.xxx` で使う。
- **エラー**: `KansoError` ([errors.ts](../../packages/core/src/errors.ts)) を throw する。HTTP への変換は `middleware/error.ts` のみ。
- **入力検証**: API は `@hono/zod-validator` の `zValidator` を使い、失敗時は `hook` で `KansoError.validation(...)` を throw して `onError` に統一する。
- **RPC 型**: `apps/server/src/api/index.ts` の `api` はメソッドチェーンで組み、`export type ApiType = typeof api` が admin の `hc<ApiType>` に流れるようにする。
- **時刻**: DB は unix 秒 (`mode: 'timestamp'` で Date に変換)。API の JSON では ISO 8601 文字列。
- **公開判定**: `status = 'published' AND published_at <= now` ([pages.ts](../../packages/core/src/services/pages.ts) の `publishedNow`)。
- **禁止**: git 操作 (commit/stash/checkout など)、ポート 5173 の使用 (別プロセスが占有中。開発サーバは `--port 5199`)、`worker-configuration.d.ts` の手編集、既存マイグレーション SQL の編集 (変更は新しいマイグレーションを追加)。
- **完了条件 (共通)**: `pnpm typecheck` / `pnpm check` / `pnpm test` / `pnpm build` がすべて成功。

---

## T1. 認証コア + API 認証ミドルウェア + setup/login API

状態: `done`

### ゴール

- 初回起動時に管理者を作成し (setup)、ログインしてセッション Cookie を得られる。
- `/api/v1/**` は `/health`, `/setup`, `/auth/login` を除き、**セッション Cookie または API キー** が必須 (決定事項: API は常に認証必須)。
- API キーは admin が発行/失効でき、`read` / `write` スコープを持つ。

### 仕様

**packages/shared/src/auth.ts** (新規, `index.ts` から re-export)

- `passwordSchema = z.string().min(8).max(256)`
- `setupSchema = z.object({ email: z.email(), password: passwordSchema, name: z.string().trim().min(1).max(100), siteTitle: z.string().trim().min(1).max(120).optional() })`
- `loginSchema = z.object({ email: z.email(), password: z.string().min(1) })`
- `publicUserSchema = z.object({ id: z.number().int(), email: z.email(), name: z.string(), role: z.enum(USER_ROLES) })`, `type PublicUser`
- `createApiKeySchema = z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(API_KEY_SCOPES) })`
- `SESSION_COOKIE = 'kanso_session'`, `API_KEY_HEADER = 'x-api-key'`, `SESSION_TTL_SECONDS = 60 * 60 * 24 * 30`

**packages/core/src/auth/password.ts** (新規, 純粋関数, Node でもテスト可能)

- `hashPassword(password) → Promise<string>`: WebCrypto PBKDF2-SHA256, **100,000 回** (Workers の上限), salt 16 byte, 出力 32 byte。形式 `pbkdf2-sha256$100000$<salt b64url>$<hash b64url>`。
- `verifyPassword(password, stored) → Promise<boolean>`: 形式を parse し再導出。比較は **定数時間** (バイト XOR の累積。`crypto.subtle.timingSafeEqual` は Cloudflare 独自なので使わない)。不正な形式は `false`。
- `generateToken(bytes = 32) → string` (base64url, `crypto.getRandomValues`)、`sha256Hex(input: string) → Promise<string>`。
- 依存: `crypto` グローバルのみ。`node:*` を import しない。

**packages/core/src/services/auth.ts** (新規, `createKanso` に `auth` として登録)

- `countUsers()`, `createUser({ email, password, name, role })`, `findUserByEmail(email)`, `getUserById(id)`, `verifyCredentials(email, password) → PublicUser | null`。email は小文字正規化。
- セッション: `createSession(userId) → { token, expiresAt }`。**DB には `sha256Hex(token)` を `sessions.id` として保存**し、Cookie には生トークンを載せる (schema のコメントを更新)。`getSessionUser(token) → PublicUser | null` (期限切れは削除して null)、`deleteSession(token)`、`deleteUserSessions(userId)`。
- API キー: `createApiKey({ name, scope }) → { id, name, scope, key }` (key = `kanso_` + `generateToken(32)`、DB には `sha256Hex(key)`。生キーは作成時 1 回だけ返す)。`verifyApiKey(key) → { id, name, scope } | null` (`lastUsedAt` は 5 分以上古いときだけ更新)。`listApiKeys()` (hash は返さない)、`deleteApiKey(id)`。
- `SESSION_SECRET` は不要になる (DB 保存の不透明トークン)。`wrangler.jsonc` のコメントと `README.md` から `SESSION_SECRET` を削除する。

**apps/server/src/middleware/auth.ts** (新規)

- `type Principal = { kind: 'session'; user: PublicUser; token: string } | { kind: 'apiKey'; apiKey: { id: number; name: string; scope: ApiKeyScope } }`。`AppEnv['Variables']` に `principal?: Principal` を追加。
- `authenticate`: Cookie `kanso_session` → `getSessionUser`、無ければヘッダ `x-api-key` → `verifyApiKey`。見つかれば `c.set('principal', ...)`。**拒否はしない**。
- `requireAuth(scope: 'read' | 'write' = 'write')`: principal が無ければ `KansoError.unauthorized()`。API キーは `scope` 不足なら `forbidden`。セッションは常に両方を満たす。
- **CSRF** (session principal かつ method が GET/HEAD/OPTIONS 以外のとき、`requireAuth` 内で検査): `Sec-Fetch-Site` があれば `same-origin` / `none` 以外は `forbidden`。無ければ `Origin` ヘッダの host が `Host` と一致しなければ `forbidden`。どちらも無ければ許可。
- `requireRole('admin')`: session principal かつ `user.role === 'admin'` のみ通す。API キーは `forbidden`。

**apps/server/src/api/** の構成

- `index.ts`: `api = new Hono<AppEnv>().use('*', authenticate).get('/health', ...).route('/setup', setup).route('/auth', auth).route('/', protectedApi)`。`protectedApi` は先頭で `.use('*', requireAuth())`。以後の管理 API (T4, T5) は `protectedApi` にぶら下げる。GET 系は `requireAuth('read')` に緩めてよい。
- `setup.ts`: `GET /` → `{ needed: boolean }` (users が 0 件なら true)。`POST /` (`setupSchema`) → users が存在すれば `conflict`。admin ユーザー作成 → `siteTitle` があれば `settings.set(site)` → セッション作成 → Cookie 設定 → `{ user }`。
- `auth.ts`: `POST /login` (`loginSchema`) → 失敗は `unauthorized` (メッセージは "Invalid email or password" で固定)。成功で Cookie + `{ user }`。`POST /logout` (session 必須) → セッション削除 + Cookie 削除 → `{ ok: true }`。`GET /me` (`requireAuth('read')`) → `{ principal }` (apiKey の場合は `{ kind: 'apiKey', name, scope }`、token/hash は含めない)。
- `api-keys.ts` (`requireRole('admin')`): `GET /` → `{ items }`、`POST /` (`createApiKeySchema`) → 201 `{ item, key }`、`DELETE /:id` → `{ ok: true }`。
- Cookie 属性: `httpOnly`, `sameSite: 'Lax'`, `path: '/'`, `secure` は リクエスト URL が https のとき、`maxAge = SESSION_TTL_SECONDS`。`hono/cookie` を使う。

**テスト基盤**

- ルートに `vitest` を追加し、root `package.json` に `"test": "pnpm -r --if-present test"` を追加。
- `packages/core`: `vitest.config.ts` + `src/auth/password.test.ts` (round trip / 不一致 / 壊れた文字列 / 出力形式) と `packages/shared/src/slug.test.ts` (`slugify`, `isReservedSlug`)。
- vitest の設定は Node 環境 (`crypto` は Node 22 のグローバルで足りる)。

### 完了条件

- 共通条件に加え、`--port 5199` の dev サーバで: `GET /api/v1/setup` → `{ needed: true }`、`POST /api/v1/setup` → 200 + `set-cookie`、再度 `POST /setup` → 409、`GET /api/v1/auth/me` (Cookie なし) → 401、(Cookie あり) → 200、`POST /api/v1/api-keys` (Cookie, `Origin: http://evil.example`) → 403、正しい Origin → 201、そのキーで `x-api-key` を付けた `GET /auth/me` → 200。
- `docs/architecture.md` §5 の表と整合していること (差異が出たら本ファイルの「決定」に記録し、architecture.md も直す)。

### 決定

- パスワード比較は Workers 固有 API に依存せず、仕様どおりバイト XOR の累積で定数時間比較する。architecture.md §6 も同じ記述に更新した。

---

## T2. 管理画面シェル

状態: `done`

### ゴール

管理画面が「初回セットアップ → ログイン → 認証必須レイアウト → ログアウト」まで動き、T6 が各機能ページを埋めるだけの状態にする。

### 仕様

**ルーター / 依存**

- **TanStack Router** file-based。`@tanstack/react-router` + `@tanstack/router-plugin` (`tanstackRouter({ target: 'react', autoCodeSplitting: true })` を `vite.config.ts` で `react()` より前に置く)。`routeTree.gen.ts` は生成物 (Biome 除外済み。git には含める)。
- `createRouter({ routeTree, basepath: '/admin', context: { queryClient }, defaultPreload: 'intent' })`。`Register` の型登録も行う。
- TanStack Query は既存の `@tanstack/react-query` を使う。UI ライブラリ・フォームライブラリは入れない (Tailwind v4 + 素の React)。

**ルートファイル** (`apps/admin/src/routes/`)

- `__root.tsx`: `createRootRouteWithContext<{ queryClient: QueryClient }>()`。`<Outlet />` のみ (Devtools は入れない)。
- `setup.tsx`: `beforeLoad` で `GET /api/v1/setup` を取得し `needed === false` なら `/login` へ redirect。フォーム: siteTitle, name, email, password, password (confirm)。成功時は `me` を setQueryData し `/` へ。
- `login.tsx`: `validateSearch` で `redirect?: string`。`beforeLoad` で setup が必要なら `/setup` へ。フォーム: email, password。成功時 `me` を setQueryData し `redirect` (basepath 内の相対パスのみ許可) か `/` へ。
- `_auth.tsx` (pathless レイアウト): `beforeLoad` で `queryClient.ensureQueryData(meQueryOptions)`。`ApiError` 401 なら setup 状態を取得し、`needed` なら `/setup`、そうでなければ `/login?redirect=<現在の href>` へ `redirect`。principal が `apiKey` の場合はセッションと見なさず `/login` へ。レイアウト = 左サイドバー (Dashboard, Pages, Posts, Media, Settings, API Keys ※ API Keys は `role === 'admin'` のみ) + ヘッダ (ユーザー名, ログアウトボタン) + `<Outlet />`。
- `_auth/index.tsx` (ダッシュボード: サイト名 (`/api/v1/health` の `site`) とユーザー名、各機能への導線)、`_auth/pages.tsx`, `_auth/posts.tsx`, `_auth/media.tsx`, `_auth/settings.tsx`, `_auth/api-keys.tsx` はタイトルだけのプレースホルダ (中身は T6)。

**API クライアント** (`apps/admin/src/api/`)

- `client.ts`: 既存の `hc<ApiType>('/api/v1', { init: { credentials: 'same-origin' } })` を維持。
- `errors.ts`: `class ApiError extends Error { status; code; details }`。
- `request.ts`: `unwrap(promise: Promise<Response>)` — 非 2xx は body の `{ error: { code, message, details } }` を `ApiError` に変換して throw。JSON でない場合は `code: 'internal'`。
- `queries.ts`: `meQueryOptions` (`GET /auth/me` → `PublicUser | null`。401 は null に正規化せず throw のまま。apiKey principal は null)、`setupStatusQueryOptions`。`staleTime` は `me` を 5 分。
- `QueryClient` の既定: `retry` は `ApiError` かつ `status < 500` なら再試行しない。ログアウト: `POST /auth/logout` → `queryClient.clear()` → `/login` へ。

**開発体験**

- `apps/admin/vite.config.ts` のプロキシ先を環境変数 `KANSO_API_ORIGIN` (既定 `http://localhost:5173`) で切替可能にする (5173 が別プロセスに占有されている環境向け)。
- `App.tsx` は削除し `main.tsx` から `RouterProvider` を描画。`index.html` の title は `kansoCMS Admin`。
- ログイン用のローカル資格情報 (T1 のスモークテストで作成済み): `admin@example.com` / `password123`。

### 完了条件

- 共通条件に加え、`pnpm build` 後に `--port 5199` の dev サーバで `GET /admin/`, `/admin/login`, `/admin/pages` が 200 で `index.html` を返し、`/admin/assets/*.js` が配信されること。
- ブラウザでの動作 (setup → login → dashboard → logout) は人手で確認する。

### 決定

- ログイン後の戻り先は同一オリジンの `/admin` 配下だけを許可し、`/login` と `/setup` への戻りはダッシュボードへ正規化する。
- `me` が API キー principal を返した場合は管理画面のログイン状態として扱わない。
- モバイルではサイドバーを折りたたみメニューに置き換え、同じナビゲーション項目を表示する。

---

## T3. 本文パイプライン

状態: `done`

### ゴール

管理画面 (Tiptap) が送る ProseMirror JSON をサーバ側で検証・HTML 化し、`body_html` / `excerpt` を安全に生成できる。`@tiptap/html` (DOM 依存) は使わず自前レンダラにする (architecture.md §10-1 を解消)。

### 仕様

**packages/shared/src/richtext.ts** (新規。`content.ts` の `richTextDocSchema` / `RichTextDoc` はここへ移して置き換え、`index.ts` から re-export)

- マーク: `bold`, `italic`, `underline`, `strike`, `code`, `link { href: string, target?: '_blank' | null, rel?: string | null, title?: string | null }`。`markSchema` は `type` の discriminated union。`attrs` はマークごとに定義し、未知の属性は strip する (`z.object` 既定)。
- ノード (discriminated union, `richTextNodeSchema`。再帰は `z.lazy`):
  - `text { text: string (min 1), marks?: Mark[] }`
  - `hardBreak`
  - `paragraph { attrs?: { textAlign?: 'left' | 'center' | 'right' | null }, content?: Inline[] }`
  - `heading { attrs: { level: 1 | 2 | 3 | 4 }, content?: Inline[] }`
  - `bulletList { content: listItem[] }`, `orderedList { attrs?: { start?: number }, content: listItem[] }`, `listItem { content: Block[] }`
  - `blockquote { content: Block[] }`
  - `codeBlock { attrs?: { language?: string | null }, content?: text[] (marks なし) }`
  - `horizontalRule`
  - `image { attrs: { src: string, alt?: string | null, title?: string | null, width?: number | null, height?: number | null } }`
  - `rawHtml { attrs: { html: string } }`
- `richTextDocSchema = z.object({ type: z.literal('doc'), content: z.array(blockNodeSchema).default([]) })`。Inline = `text | hardBreak | image` (Tiptap の inline image も許す)。Block = 上記のブロック要素。
- 型: `RichTextDoc`, `RichTextNode`, `RichTextMark` を export。`richTextDocSchema.safeParse` が未知ノード種別を拒否すること。

**packages/core/src/content/** (新規。`packages/core/src/index.ts` から `renderRichText`, `extractExcerpt`, `RenderOptions` を export)

- `html.ts`: `escapeHtml(text)`, `escapeAttr(value)`。
- `render.ts`: `renderRichText(doc: RichTextDoc, options: { allowRawHtml: boolean }) → string`
  - 出力はセマンティック HTML。`paragraph` → `<p>` (textAlign があれば `style="text-align:center"`)、`heading` → `<h1>`〜`<h4>`、リスト → `<ul>/<ol start>/<li>`、`blockquote`、`codeBlock` → `<pre><code class="language-xxx">` (language は `[a-z0-9_+-]{1,32}` のみ)、`horizontalRule` → `<hr>`、`hardBreak` → `<br>`、`image` → `<img src alt width height loading="lazy">` (`title` があれば付ける)。
  - マークは `strong`, `em`, `u`, `s`, `code`, `a`。マークのネストは配列順で外側から。
  - `link.href` の許可: `http:`, `https:`, `mailto:`, `tel:` と相対 (`/` 始まり, `#` 始まり, `./`/`../` は不可)。それ以外 (`javascript:` など) は `href` を落とし `<a>` を出さずテキストのみ。`target="_blank"` のときは `rel="noopener noreferrer"` を必ず付ける (指定 rel があればマージ)。
  - `image.src` の許可: `/media/` 始まり, `http(s):`。それ以外は画像を出力しない。
  - `rawHtml`: `allowRawHtml === false` なら `KansoError.forbidden('Raw HTML blocks are not allowed')` を throw (呼び出し側 = service が admin 判定して渡す)。true ならそのまま出力。
  - 空段落は `<p></p>` を出す (エディタの改行を保持)。
- `excerpt.ts`: `extractExcerpt(input: RichTextDoc | string, maxLength = 160) → string`。doc の場合は `paragraph`/`heading`/`listItem`/`blockquote` のテキストをスペース連結、`codeBlock`/`rawHtml`/`image` は無視。string (HTML) の場合は既存 `@kanso/seo` の `excerptFromHtml` と同じ挙動 (core は seo に依存させず、同等ロジックを持つ)。末尾は `…`。
- `index.ts`: re-export。
- テスト `packages/core/src/content/render.test.ts`, `excerpt.test.ts`: 各ノード出力、`<script>` を含むテキストのエスケープ、`javascript:` href の除去、`_blank` の rel、`rawHtml` の許可/拒否、未知ノードが schema で拒否されること、excerpt の切り詰め。

**既存コードの追従**

- `packages/core/src/db/schema/_columns.ts` の `RichTextDoc` import 先が変わっても型が通ること。
- `docs/architecture.md` §4「本文の扱い」の 2. を「自前レンダラ (`core/content`)」に書き換え、§10-1 を解決済みとして削除。

### 完了条件

- 共通条件 (`pnpm typecheck` / `check` / `test` / `build`)。T3 はサーバのルートを増やさない (API への接続は T4)。

### 決定

- `image` は inline と文書直下の block の両方で許可し、`listItem` はリスト内だけに限定する。
- 未知属性は各 zod object で strip し、省略可能属性の `null` は出力時に属性なしへ正規化する。
- excerpt は block 間・リスト項目間を空白で連結し、連続する空白を 1 文字へ正規化する。

---

## T4. pages / post_types / posts / taxonomies の service + CRUD API

状態: `done`

### ゴール

管理画面 (T6) と外部クライアントが、固定ページ・投稿タイプ・投稿・カテゴリ・タグを `/api/v1` から CRUD できる。作成した固定ページは既存 SSR (`/about` など) に即反映される。投稿の SSR は T7。

### 仕様

**packages/shared** (すべて `index.ts` から re-export)

- zod 4 の注意: `.default()` を持つスキーマに `.partial()` を掛けると `parse({})` が既定値を埋めてしまう (検証済み)。**入力スキーマには `.default()` を使わない**。既定値は service の create 側で埋める。
- `content.ts`: `seoFieldsSchema` から `.default()` を外す (`seoTitle: z.string().trim().max(120).nullable()`, `seoDescription: ...max(320).nullable()`, `ogMediaId: z.number().int().positive().nullable()`, `noindex: z.boolean()`, `canonicalUrl: z.url().nullable()`)。`contentFieldsSchema = z.object({ title: z.string().trim().min(1).max(200), bodyJson: richTextDocSchema, excerpt: z.string().trim().max(500).nullable(), status: contentStatusSchema, publishedAt: z.iso.datetime({ offset: true }).nullable() })`。
- `query.ts` (新規): `listQuerySchema = z.object({ page: z.coerce.number().int().min(1).optional(), perPage: z.coerce.number().int().min(1).max(100).optional(), status: contentStatusSchema.optional(), q: z.string().trim().min(1).max(200).optional() })`, `type ListQuery`。`idSchema = z.coerce.number().int().positive()`。
- `pages.ts` (新規): `pageFieldsSchema = contentFieldsSchema.extend(seoFieldsSchema.shape).extend({ slug: slugSchema, parentId: idSchema.nullable(), sortOrder: z.number().int() })`。`createPageSchema = pageFieldsSchema.partial().required({ title: true, slug: true })`。`updatePageSchema = pageFieldsSchema.partial()`。型 `CreatePageInput`, `UpdatePageInput`。
- `posts.ts` (新規): `postTypeFieldsSchema = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullable(), hasCategories: z.boolean(), hasTags: z.boolean(), sortOrder: z.number().int() })`、`createPostTypeSchema = ...partial().required({ slug: true, name: true })`、`updatePostTypeSchema = ...partial()`。`postFieldsSchema = contentFieldsSchema.extend(seoFieldsSchema.shape).extend({ postTypeId: idSchema, slug: slugSchema, coverMediaId: idSchema.nullable(), categoryIds: z.array(idSchema).max(50), tagIds: z.array(idSchema).max(50) })`、`createPostSchema = ...partial().required({ postTypeId: true, title: true, slug: true })`、`updatePostSchema = ...partial().omit({ postTypeId: true })` (投稿タイプの変更は不可)。`postListQuerySchema = listQuerySchema.extend({ type: slugSchema.optional() })`。
- `taxonomies.ts` (新規): `categoryFieldsSchema = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(100), parentId: idSchema.nullable(), sortOrder: z.number().int() })`、create は `slug`,`name` 必須、update は partial。`tagFieldsSchema = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(100) })`、同様に create/update。
- テスト `packages/shared/src/pages.test.ts`: `updatePageSchema.parse({})` が `{}` になること、`createPageSchema` が `title`/`slug` 必須で他は省略可、`publishedAt` に非 ISO 文字列を拒否。

**packages/core/src/services** (`createKanso()` に `pages` (既存を拡張), `postTypes`, `posts`, `taxonomies` を登録)

共通:

- 一覧は `{ items, total }` を返す。`items` は `bodyJson`/`bodyHtml` を含めない (`columns: { bodyJson: false, bodyHtml: false }`)。`page` 既定 1, `perPage` 既定 20。`q` は `title` の `LIKE %q%` (`%` `_` `\` は `\` でエスケープし `escape '\\'`)。`total` は同じ where で `count()`。
- 単体取得 (`get(id)`) は全カラム。無ければ `KansoError.notFound('Page' | 'Post' | ...)`。
- 本文: `create`/`update` は `bodyJson` (無ければ `{ type: 'doc', content: [] }`) から `renderRichText(bodyJson, { allowRawHtml })` で `bodyHtml` を生成。`excerpt` が `null`/空なら `extractExcerpt(bodyJson)`。`allowRawHtml` は呼び出し側 (API) が `principal.kind === 'session' && user.role === 'admin'` のときだけ true を渡す。`update` で `bodyJson` が無ければ `bodyHtml` は再生成しない。
- 公開日時: 保存後の `status === 'published'` かつ `publishedAt` が null なら `publishedAt = now`。`publishedAt` が指定されていればそのまま (予約公開)。`draft` に戻しても `publishedAt` は保持。
- `updatedAt = new Date()` を update で必ず更新。
- 複数文の更新は **`db.batch([...])`** で原子的に (D1 にトランザクション API は無い)。`batch` は 1 件以上必要なので空配列を渡さない。
- 一意性違反やルール違反: 予約語・循環親・型不一致は `KansoError.validation(...)` (400)、slug/path の重複は `KansoError.conflict(...)` (409)。

`pages` (既存 `pages.ts` を拡張。`findPublishedByPath`, `listPublishedTopLevel`, `publishedNow` はそのまま):

- `list(query)`, `get(id)`, `create(input, { allowRawHtml })`, `update(id, input, { allowRawHtml })`, `delete(id)`。
- `path` の計算: `parent ? `${parent.path}/${slug}` : slug`。**子孫の path も再計算する**。ページ数は少ないので全ページ (`id, slug, parentId, path`) をメモリに読み、純粋関数 `computePaths(pages: {id, slug, parentId}[]) → Map<id, path>` で全 path を求め、変わった行だけ `db.batch` で更新する。この関数は `packages/core/src/services/page-tree.ts` に置き、`page-tree.test.ts` でテスト (3 階層の再計算、親変更、循環検出)。
- ルール: 最上位 (`parentId` null) の `slug` は `isReservedSlug` なら validation。最上位 `slug` が `post_types.slug` と一致したら conflict ("Slug is used by a post type")。`parentId` は存在するページで、自分自身・自分の子孫を指すなら validation ("Page cannot be its own ancestor")。`path` 重複は conflict。
- `delete(id)`: 子ページは削除したページの `parentId` に付け替え (孫が消えない)、path を再計算してから削除。すべて 1 回の `db.batch`。

`postTypes` (新規 `post-types.ts`):

- `list()` (`sortOrder, name` 順), `get(id)`, `findBySlug(slug)`, `create(input)`, `update(id, input)`, `delete(id)`。
- ルール: `slug` が `isReservedSlug` なら validation。`slug` が最上位ページの `path` と一致したら conflict ("Slug is used by a page")。slug 重複は conflict。`delete` は投稿が 1 件でも残っていれば conflict ("Post type still has posts") — 誤操作でカスケード削除しない。
- create の既定: `description null`, `hasCategories true`, `hasTags true`, `sortOrder 0`。

`posts` (新規 `posts.ts`):

- `list(query & { postTypeId? })`, `get(id)` → 行 + `categoryIds: number[]` + `tagIds: number[]`, `create(input, { allowRawHtml, authorId })`, `update(id, input, { allowRawHtml })`, `delete(id)`。
- 並び: `publishedAt` があればそれ、無ければ `createdAt` の降順 (`sql`coalesce(...)`` で可)、次に `id` 降順。
- ルール: `postTypeId` は存在する投稿タイプ (無ければ validation)。`slug` はタイプ内で一意 (conflict)。`categoryIds` は全て同じ `postTypeId` のカテゴリ、`tagIds` は存在するタグ (違反は validation)。`hasCategories`/`hasTags` が false のタイプに付けようとしたら validation。
- create: 投稿を insert (`returning({ id })`) → categories/tags の junction を `db.batch` で insert (空なら省略)。`authorId` は呼び出し側から (session なら user.id, API キーなら null)。
- update: `db.batch([update posts, delete post_categories, insert..., delete post_tags, insert...])`。`categoryIds`/`tagIds` が input に無ければ触らない。

`taxonomies` (新規 `taxonomies.ts`):

- categories (投稿タイプにスコープ): `listCategories(postTypeId)` (`sortOrder, name` 順), `createCategory(postTypeId, input)`, `updateCategory(postTypeId, id, input)`, `deleteCategory(postTypeId, id)`。`parentId` は同じ postTypeId のカテゴリで自分自身・子孫は不可 (`page-tree.ts` の循環検出を再利用してよい)。slug はタイプ内で一意。削除時、子カテゴリは `parentId = null` (FK の set null に任せてよい)。
- tags (グローバル): `listTags(q?)`, `createTag(input)`, `updateTag(id, input)`, `deleteTag(id)`。slug 一意。

**apps/server/src/api**

- `validate.ts` (新規): `zValidator` の hook を 1 箇所にまとめる。失敗時は `KansoError.validation('Invalid request', issues)` を throw し、`issues` は `{ path: string (dot 区切り), message: string }[]` に絞る (現状は zod の regex パターンまで漏れている)。`hc<ApiType>` の入力型推論が壊れない形にする (ジェネリックなラッパー `validate('json', schema)` または共通 hook 関数のどちらでもよい)。既存の `setup.ts`, `auth.ts`, `api-keys.ts` もこれに置き換える。`idParamSchema = z.object({ id: idSchema })` もここに置く。
- `index.ts`: `protectedApi` は `.use('*', requireAuth('read'))` の後に `.on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', requireAuth('write'))` とし、**read スコープの API キーで GET は通り、変更系は 403** のままにする。その下に `/pages`, `/post-types`, `/posts`, `/tags` を `.route()` する。`api-keys` は従来どおり。
- `principal` からの導出はヘルパにまとめる (`apps/server/src/api/principal.ts`: `canUseRawHtml(principal)`, `currentUserId(principal)`)。
- ルートとレスポンス:
  - `pages.ts`: `GET /` (`listQuerySchema` を `query` で検証) → `{ items, total, page, perPage }`。`POST /` (`createPageSchema`) → 201 `{ item }`。`GET /:id` → `{ item }`。`PATCH /:id` (`updatePageSchema`) → `{ item }`。`DELETE /:id` → `{ ok: true }`。
  - `post-types.ts`: 同じ形 (`GET /` は `{ items }` のみ、ページングなし)。カテゴリはここにネスト: `GET /:typeId/categories` → `{ items }`、`POST /:typeId/categories` → 201 `{ item }`、`PATCH /:typeId/categories/:id`、`DELETE /:typeId/categories/:id`。
  - `posts.ts`: `GET /?type=<post type slug>&page&perPage&status&q` (`postListQuerySchema`)。`type` があるのに該当タイプが無ければ `notFound('Post type')`。`POST /` → 201、`GET/PATCH/DELETE /:id`。
  - `tags.ts`: `GET /?q=`, `POST /`, `PATCH /:id`, `DELETE /:id`。
- Date 列は `c.json(row)` でそのまま返す (JSON.stringify が ISO 文字列にし、Hono の型もそれを反映する)。手でシリアライズしない。
- 参照先 `media` (`ogMediaId`, `coverMediaId`) の存在確認は T5 で追加する。今回は FK 違反が 500 になっても許容 (決定に記録)。

**SSR**

- `site/routes.tsx` は変更不要 (`findPublishedByPath` を使っているため、作成した公開ページがそのまま出る)。

### 完了条件

- 共通条件に加え、`--port 5199` の dev サーバで curl:
  1. `POST /api/v1/auth/login` (`admin@example.com` / `password123`) → Cookie。
  2. `POST /api/v1/post-types` `{ slug: 'blog', name: 'Blog' }` → 201。`{ slug: 'admin' }` → 400。`{ slug: 'blog' }` 再度 → 409。
  3. `POST /api/v1/pages` `{ title: 'About', slug: 'about', status: 'published', bodyJson: {段落 1 つ} }` → 201 で `bodyHtml` が `<p>…</p>`、`excerpt` が自動、`publishedAt` が ISO。`GET /about` (SSR) → 200 で本文を含む。
  4. `POST /api/v1/pages` `{ title: 'Team', slug: 'team', parentId: <about> }` → `path` が `about/team`。`PATCH /pages/<about>` `{ slug: 'company' }` → 子の `path` が `company/team` になり、`GET /company` → 200、`GET /about` → 404。`PATCH /pages/<about>` `{ parentId: <team> }` → 400。`POST /pages` `{ slug: 'blog' }` (最上位) → 409。
  5. `POST /post-types/<blog>/categories` `{ slug: 'news', name: 'News' }` → 201。`POST /tags` `{ slug: 'first', name: 'First' }` → 201。
  6. `POST /posts` `{ postTypeId, title: 'Hello', slug: 'hello', status: 'published', categoryIds: [..], tagIds: [..] }` → 201。`GET /posts?type=blog` → `items` 1 件, `total` 1。`GET /posts/<id>` → `categoryIds`, `tagIds` が入っている。`PATCH /posts/<id>` `{ tagIds: [] }` → `tagIds` が空。
  7. `DELETE /post-types/<blog>` → 409 (投稿あり)。`DELETE /posts/<id>` → 200 → `DELETE /post-types/<blog>` → 200。
  8. read スコープの API キー (`x-api-key`) で `GET /pages` → 200、`POST /pages` → 403。
  9. `POST /pages` `{ title: '' }` → 400 で `details` が `[{ path, message }]` 形式。

### 決定

- pages 一覧は `sortOrder`, `title`, `id` 順、tags 一覧は `name`, `id` 順とし、同値時も安定する順序にした。tags の `q` は name と slug の両方を対象にする。
- 親が存在しない場合は page/category とも validation とし、循環時は仕様の固定メッセージを返す。ページ削除で子が最上位へ昇格する場合も予約語・投稿タイプ slug との衝突を再検証する。
- validation hook は zValidator の推論を保持するため、必要な `success/error.issues` だけを持つ構造型で受け、`details` は `{ path, message }[]` に射影する。
- `categoryIds` / `tagIds` の重複は入力順を保って除去し、junction の主キー違反を避ける。
- `ogMediaId` / `coverMediaId` の存在確認は T5 で追加する。T4 では DB の FK に任せるため、存在しない値は 500 になり得る。

---

## T5. メディア

状態: `done`

### ゴール

画像/PDF を R2 にアップロードして D1 に登録し、`/media/<key>` で配信できる。T6 のメディアライブラリと Tiptap の画像挿入がこの API だけで完結する。T4 で先送りした `ogMediaId` / `coverMediaId` の存在確認もここで入れる。

### 仕様

**packages/shared/src/media.ts** (新規, `index.ts` から re-export)

- `MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'application/pdf'] as const`, `type MediaMimeType`。**SVG は不可** (スクリプト混入)。
- `MEDIA_MAX_BYTES = 20 * 1024 * 1024`。
- `MEDIA_EXTENSIONS: Record<MediaMimeType, string>` (`jpg, png, gif, webp, avif, pdf`)。
- `updateMediaSchema = z.object({ alt: z.string().trim().max(500).nullable() })`、`mediaListQuerySchema = z.object({ page, perPage (listQuerySchema と同じ), q: z.string().trim().min(1).max(200).optional() })` (`q` は `filename` の LIKE)。
- `mediaUrl(r2Key: string) → string`: `/${r2Key}` (キーは `media/...` で始まるので配信 URL はそのまま `/media/...`)。

**packages/core/src/storage/** (新規, 純粋関数, `node:` import なし)

- `sniff.ts`: `sniffMime(bytes: Uint8Array) → MediaMimeType | null`。マジックバイトで判定: JPEG `FF D8 FF`、PNG `89 50 4E 47 0D 0A 1A 0A`、GIF `GIF87a`/`GIF89a`、WebP `RIFF....WEBP`、AVIF offset 4 が `ftyp` かつ brand が `avif`/`avis`、PDF `%PDF-`。**クライアント申告の Content-Type は信用せず、sniff 結果を正とする**。
- `image-size.ts`: `readImageSize(bytes, mime) → { width, height } | null`。PNG (IHDR, BE32 ×2 @16)、GIF (LE16 ×2 @6)、JPEG (セグメントを走査し SOF0/1/2 = `C0/C1/C2` の高さ・幅 BE16)、WebP (`VP8 ` は @26 LE16 & 0x3fff、`VP8L` は @21 の 14bit ×2 (+1)、`VP8X` は @24 の 24bit LE (+1))。AVIF と PDF は `null`。壊れたヘッダは throw せず `null`。
- `keys.ts`: `mediaObjectKey(mime, now = new Date(), id = crypto.randomUUID()) → 'media/{yyyy}/{mm}/{id}.{ext}'`。
- テスト `sniff.test.ts`, `image-size.test.ts` (手組みのバイト列: PNG 2×3, GIF 4×5, JPEG SOF0 6×7, WebP VP8X 8×9, 短すぎる入力で null)。

**packages/core/src/services/media.ts** (新規)

- `createKanso()` の `media: bindings.media` (生の R2Bucket) を `bucket` に改名し、`media: mediaService(db, bindings.media)` を登録する (`apps/server/src/middleware/kanso.ts` は変更不要)。
- `list({ page, perPage, q })` → `{ items, total }` (`createdAt` 降順, `id` 降順)。各 item は DB 行 + `url: mediaUrl(r2Key)`。
- `get(id)` → item (無ければ `notFound('Media')`)。
- `upload({ bytes: ArrayBuffer, filename: string, alt: string | null })`:
  1. `bytes.byteLength > MEDIA_MAX_BYTES` → `validation('File is too large')`、0 → `validation('File is empty')`。
  2. `sniffMime` が null → `validation('Unsupported file type')`。
  3. `readImageSize` で width/height (null 可)。
  4. `filename` は basename のみ残し (`/`, `\` の後ろ)、制御文字を除き、空なら `upload.<ext>`、最大 200 文字。**保存先キーには使わない** (キーは UUID)。
  5. `bucket.put(key, bytes, { httpMetadata: { contentType: mime } })` → D1 insert (`r2Key, filename, mime, size, width, height, alt`)。insert が失敗したら `bucket.delete(key)` を試みてから再 throw。
  6. item を返す。
- `updateAlt(id, alt)` → item。
- `delete(id)`: `get` → `bucket.delete(r2Key)` → `db.delete`。参照側 (`pages.ogMediaId`, `posts.coverMediaId`) は FK の `set null` に任せる。
- `assertExists(id: number | null | undefined)`: null/undefined は何もしない。無ければ `validation('Media does not exist')`。**`pages` / `posts` の service の create/update で `ogMediaId` / `coverMediaId` が与えられたときに呼ぶ** (T4 の決定で先送りした分)。サービス間依存を避けるため `assertMediaExists(db, id)` を `media.ts` から export して pages/posts が直接使う形でよい。

**apps/server/src/api/media.ts** (新規, `protectedApi` に `/media` で mount)

- `GET /` (`mediaListQuerySchema`, `query`) → `{ items, total, page, perPage }`。
- `POST /`: `zValidator('form', z.object({ file: z.instanceof(File), alt: z.string().trim().max(500).optional() }), validationHook)` (Hono の `parseBody` は multipart の `File` をそのまま渡す。この schema は server 側に置く。shared は `File` 型に依存させない)。`file.size` を先に `MEDIA_MAX_BYTES` で弾き、`await file.arrayBuffer()` → `media.upload(...)` → 201 `{ item }`。
- `GET /:id` → `{ item }`、`PATCH /:id` (`updateMediaSchema`) → `{ item }`、`DELETE /:id` → `{ ok: true }`。
- 配信 `apps/server/src/media/index.ts` は既存のまま (`/media/*` → R2)。ただし `object.httpMetadata` に contentType が無い場合に備えて `content-type` が空なら `application/octet-stream` を設定する。

**docs**

- `README.md` の "Seeding a page" 節を、API 経由 (ログイン → `POST /api/v1/pages`) の例に置き換える (T4 で SQL 直挿入は不要になった)。`curl -F file=@...` のアップロード例も 1 行添える。

### 完了条件

- 共通条件に加え、`--port 5199` の dev サーバで curl (ローカル R2 は vite plugin がエミュレートする):
  1. ログイン後、node で生成した 2×3 PNG を `curl -F file=@tiny.png -F alt=Tiny` で `POST /api/v1/media` → 201、`item.mime = image/png`, `width 2`, `height 3`, `url` が `/media/2026/…/<uuid>.png`。
  2. `GET <url>` → 200, `content-type: image/png`, `cache-control: public, max-age=31536000, immutable`。`GET /media/nope.png` → 404。
  3. `GET /api/v1/media` → `total >= 1`、item に `url` がある。`GET /api/v1/media?q=tiny` → 1 件。
  4. SVG (`<svg>` テキスト) を `file` に → 400 `Unsupported file type`。Content-Type を `image/png` と偽ったテキストファイル → 400。21MB のファイル → 400 `File is too large`。
  5. `PATCH /api/v1/media/<id>` `{ alt: 'Changed' }` → 200 で反映。
  6. `POST /api/v1/posts` (要: 投稿タイプ) `{ coverMediaId: 999999 }` → 400 `Media does not exist`。`POST /api/v1/pages` `{ ogMediaId: <id> }` → 201。
  7. read スコープ API キーで `GET /api/v1/media` → 200、`POST` → 403。
  8. `DELETE /api/v1/media/<id>` → 200 → `GET <url>` → 404、`GET /api/v1/media/<id>` → 404、手順 6 のページの `ogMediaId` が null。
  9. 手順で作った投稿タイプ・投稿・ページ・API キーは削除して終える。

### 決定

- 表示用ファイル名は `/` / `\\` より後ろの basename に限定し、制御文字を除去して trim
  したうえで Unicode コードポイント単位で 200 文字に切る。空になった場合は sniff 済み MIME
  に対応する `upload.<ext>` を使う。R2 キーの年月は UTC とする。
- JPEG は SOF0 / SOF1 / SOF2 の最初の有効なセグメントから寸法を読むため、プログレッシブ
  JPEG (SOF2) も幅・高さを取得する。壊れたセグメントや SOS までに SOF がない場合は
  `null` とする。
- API は `File.size` で 20 MB 超を `arrayBuffer()` 前に拒否し、service でも
  `ArrayBuffer.byteLength` を再検証する。後者は Hono 以外から service を呼ぶ場合の防御とする。
- ローカル R2 は Range 未指定でも `object.range` を返すため、配信の 206 判定はリクエストに
  `Range` があり、かつ返却範囲がオブジェクト全体でない場合に限定する (R2 は満たせない Range
  を全体で返すので、その場合は 200)。206 には `Content-Range` / `Content-Length` を付け、常に
  `Accept-Ranges: bytes` を返す (PDF ビューアは Range 要求をする)。`R2Range` の判別は `in`
  ではなく値で行う (ランタイムの object は全キーを `undefined` で持つ)。
- `POST /media` は `Content-Length` が 20MB + 64KB を超える場合、multipart を読む前に 400 で
  弾く (`rejectOversizedBody`)。`File.size` と service の再検証はそのまま残す。

---

## T6. 管理画面 CRUD UI

状態: `done`

### ゴール

T1–T5 の API だけを使って、管理画面から「投稿タイプを作る → カテゴリ/タグを付けて投稿を書く → 画像を入れて公開する → 固定ページを階層で管理する → サイト設定と API キーを扱う」まで完結する。見た目は T2 のシェル (neutral パレット, 角丸なし, `login.tsx` のフォーム部品) を踏襲する。

### 仕様

**依存の追加 (apps/admin のみ)**

- `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-image` (すべて同一メジャー, 最新の v3 系)。これ以外は追加しない (フォームライブラリ, アイコン, UI キット, 日付ライブラリは不可)。
- `vitest` は root に既にある。`apps/admin` に `vitest.config.ts` (environment `node`) と `"test": "vitest run"` を追加し、`src/lib/*.test.ts` を `pnpm test` に含める。

**サーバー側の追加 (T6 の UI に必要な最小限)**

- `apps/server/src/api/settings.ts` (`protectedApi` に `/settings` で mount, 全ルート `requireRole('admin')`): `GET /` → `{ site, organization }`、`PUT /site` (`siteSettingsSchema`) → `{ site }`、`PUT /organization` (`organizationSettingsSchema`) → `{ organization }`。PUT は全置換 (schema の `.default()` で欠けを埋める)。
- `apps/server/src/api/index.ts` のチェーンに `.route('/settings', settings)` を追加。`ApiType` が admin に流れることを維持する。

**apps/admin/src/api/**

- `queries.ts` に `queryOptions` を集約: `pagesListQuery(params)`, `pageQuery(id)`, `postTypesQuery`, `postTypeQuery(id)`, `categoriesQuery(typeId)`, `postsListQuery(params)`, `postQuery(id)`, `tagsQuery(q?)`, `mediaListQuery(params)`, `settingsQuery`, `apiKeysQuery`。queryKey は `['pages', 'list', params]` / `['pages', 'detail', id]` の形で、mutation 後は `invalidateQueries({ queryKey: ['pages'] })` のように接頭辞で無効化する。
- RPC は `hc<ApiType>` を型付きで使う: `api.pages.$get({ query })`, `api.pages[':id'].$patch({ param: { id: String(id) }, json })`, `api.media.$post({ form: { file, alt } })`。`fetch` の直書きは禁止。
- `ApiError.details` (`{ path, message }[]`) をフィールド別エラーに変換する `fieldErrors(error)` を `api/errors.ts` に追加する。

**apps/admin/src/lib/** (純粋関数, テスト対象)

- `datetime.ts`: `toDateTimeLocal(iso: string | null) → string` (`datetime-local` 入力用, ローカル時刻 `YYYY-MM-DDTHH:mm`)、`fromDateTimeLocal(value: string) → string | null` (空は null、それ以外は `new Date(value).toISOString()`)。
- `page-tree.ts`: `flattenPageTree(items) → { page, depth }[]` (parentId で親子を組み、`sortOrder`, `title` 順で深さ優先に並べる。親が一覧に無い項目は最上位扱い)、`descendantIds(items, id) → Set<number>` (親セレクトで自分と子孫を除外するため)。
- `slug.ts` は `@kanso/shared` の `slugify` を使うだけなので新規ファイル不要。

**共通コンポーネント (`apps/admin/src/components/`)**

- `PageHeading` に `actions?: ReactNode` と `description?: string` を追加。
- `ui.tsx`: `Button` (`variant: 'primary' | 'secondary' | 'danger'`, `size`), `Field` (label + 子 input + `error?: string` を `role="alert"` で表示), `inputClass` 定数 (login.tsx の input クラスを共通化), `Alert` (`tone: 'error' | 'success' | 'info'`), `EmptyState`。
- `ConfirmDialog` は `<dialog>` 要素で実装 (削除確認)。外部の modal ライブラリは使わない。
- `Pagination` (`page`, `perPage`, `total`, `onChange`)。

**エディタ (`apps/admin/src/components/editor/`)**

- `Editor.tsx`: `useEditor` + `EditorContent`。拡張: `StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true } })`, `Image.extend({ addAttributes: 親 + width/height (number | null) })`, `RawHtml` (下記)。`onUpdate` で `editor.getJSON()` を `richTextDocSchema.safeParse` に通し、成功時のみ `onChange(doc)`、失敗時は「エディタの内容を保存できない形式です」を表示 (通常は起きない。防御)。`content` prop の変更 (別レコードを開いたとき) は `editor.commands.setContent` で反映するが、自分の `onChange` 由来の更新でループしないよう `key={recordId}` で再マウントする方針でよい。
- `RawHtml.ts`: Tiptap `Node.create({ name: 'rawHtml', group: 'block', atom: true, attrs: { html } })`。編集 UI は無し。`renderHTML` はグレーのボックスに「HTML ブロック」と表示、`parseHTML` は `div[data-raw-html]`。API 経由で入った rawHtml をエディタで開いても失われないための保持専用。
- `Toolbar.tsx`: 段落 / H2 / H3 / H4、太字、斜体、下線、打ち消し、インラインコード、リンク (`window.prompt` で URL。空なら unsetLink)、箇条書き、番号付き、引用、コードブロック、区切り線、画像 (MediaPicker を開き `setImage({ src: item.url, alt: item.alt ?? '', width, height })`)、元に戻す / やり直す。各ボタンは `aria-pressed` で active を示す。
- スタイル: `styles.css` に `.editor-content` 配下の見出し/リスト/引用/コード/画像/hr の最小限のスタイルを `@layer components` で書く (Tailwind の typography プラグインは使わない)。

**メディア (`components/media/`, `routes/_auth/media/index.tsx`)**

- `MediaGrid`: `GET /media` をページング (perPage 40) + `q` 検索。各カードはサムネイル (画像は `<img src={url}>`、PDF はファイル名のみ)、`filename`、`width×height`、`alt` 編集 (インライン, `PATCH`)、URL コピー、削除 (`ConfirmDialog`)。
- `UploadDropzone`: drag & drop + `<input type="file" multiple accept={MEDIA_MIME_TYPES.join(',')}>`。クライアント側でも `MEDIA_MAX_BYTES` を超えるものは弾いて表示する。複数ファイルは順次アップロードし、進行状況 (n / m) と失敗したファイルのメッセージを出す。成功で `['media']` を invalidate。
- `MediaPicker`: `<dialog>` の中に `UploadDropzone` + `MediaGrid` (選択モード)。`onSelect(item)`。エディタの画像挿入、投稿の `coverMediaId`、SEO の `ogMediaId`、設定の `logoMediaId` から使う。`MediaField` (選択済みのサムネイル + 「選択」「解除」ボタン) を用意する。

**固定ページ (`routes/_auth/pages/`)**

- 既存の `routes/_auth/pages.tsx` プレースホルダは削除し、`pages/index.tsx`, `pages/new.tsx`, `pages/$id.tsx` にする (posts, post-types, media, settings, api-keys も同様。`tags/index.tsx` は新規)。
- `index.tsx`: `GET /pages?perPage=100` を `flattenPageTree` で階層表示 (深さ分インデント)。列: タイトル、パス、状態、更新日時。検索 `q` (検索中は階層ではなくフラット表示)。「新規作成」ボタン。
- `ContentForm` (`components/content/ContentForm.tsx`, pages と posts で共用): タイトル、スラッグ (タイトルから `slugify` で自動生成。手で編集したら追従を止める)、状態 (`draft` / `published`)、公開日時 (`datetime-local`; 空で published にすると API 側が now を入れる旨をヘルプに書く)、本文 (`Editor`)、抜粋 (空なら自動生成の旨)、SEO セクション (`<details>`: seoTitle, seoDescription, ogMedia (`MediaField`), noindex, canonicalUrl)。保存ボタンは「下書き保存」「公開」ではなく **状態セレクト + 保存** の 1 ボタンにする (シンプル優先)。
- `new.tsx` / `$id.tsx`: ページ固有フィールドとして親ページ (セレクト。`descendantIds` で自分と子孫を除外)、表示順 (`sortOrder`)。保存成功で一覧へ戻り、API の validation は `fieldErrors` で該当フィールド下に表示、それ以外 (409 など) は `Alert`。編集画面に削除ボタン (`ConfirmDialog`。子がある場合は API の挙動 = 子が親に昇格する旨を確認文に書く)。公開中のページには「サイトで見る」リンク (`/${path}` を新しいタブで)。
- 更新は差分ではなくフォーム全体を `PATCH` で送ってよい (updatePageSchema は全 optional)。ただし `bodyJson` は変更が無くても送ってよい。

**投稿タイプ / カテゴリ (`routes/_auth/post-types/`)**

- `index.tsx`: 一覧 (名前, スラッグ, カテゴリ/タグの有無, 表示順) + 新規作成。
- `new.tsx` / `$id.tsx`: slug (名前から自動), name, description, hasCategories, hasTags, sortOrder。編集画面の下部に **カテゴリ管理** (`hasCategories` のときのみ): 一覧 (階層は parentId をインデント表示), 追加フォーム (slug 自動, name, 親), 名前/slug の編集, 削除。削除 (投稿があると 409) は `Alert` にメッセージを出す。

**投稿 (`routes/_auth/posts/`)**

- `index.tsx`: `validateSearch` で `type?: string`, `page?: number`, `q?: string`, `status?: 'draft' | 'published'`。投稿タイプのタブ (最初のタイプを既定。タイプが 0 件なら「先に投稿タイプを作成してください」と `/post-types/new` へのリンク)。列: タイトル、スラッグ、状態、公開日時。`Pagination`。
- `new.tsx` (`?type=<slug>` 必須。無ければ index へ) / `$id.tsx`: `ContentForm` + 投稿固有: カバー画像 (`MediaField`)、カテゴリ (タイプが `hasCategories` のときチェックボックス群。階層はインデント)、タグ (`hasTags` のとき `TagInput`: 入力で `GET /tags?q=` を検索して候補表示、Enter で選択、候補に無ければ `POST /tags` で作成 (slug は `slugify(name)`)。選択済みはチップで表示し × で外す)。
- 公開中の投稿には「サイトで見る」リンク (`/${typeSlug}/${slug}`、T7 で有効になる)。

**タグ (`routes/_auth/tags/index.tsx`)**

- 一覧 (名前, スラッグ) + 検索 + 追加 + インライン編集 + 削除。

**設定 (`routes/_auth/settings/index.tsx`, admin のみ)**

- `GET /settings` を読み、2 つのフォーム: サイト (title, description, locale, timezone, logoMedia (`MediaField`), homePostTypeSlug (投稿タイプのセレクト + 「なし」)) と 組織 (name, url, logoUrl, sameAs (1 行 1 URL の textarea → 配列))。それぞれ独立に `PUT`。保存後 `Alert` (success)。
- editor ロールでは `/settings` と `/api-keys` をナビに出さず、直接開いたら「権限がありません」を表示 (API は 403 を返す)。

**API キー (`routes/_auth/api-keys/index.tsx`, admin のみ)**

- 一覧 (名前, スコープ, 作成日時, 最終使用)。発行フォーム (name, scope)。発行成功で **生キーを 1 回だけ** `Alert` 内にコード表示 + コピーボタン。「このキーは再表示できません」を明記。失効は `ConfirmDialog`。

**ナビゲーション / ダッシュボード**

- `_auth.tsx` の `navigation` に `投稿タイプ (/post-types)` と `タグ (/tags)` を追加し、`NavLinkProps['to']` の union も更新。`設定` と `API キー` は admin のみ。
- ダッシュボードの `featureLinks` にも投稿タイプを追加。

**開発時の注意**

- `apps/admin` の dev サーバは `KANSO_API_ORIGIN=http://localhost:5199 pnpm --filter @kanso/admin dev` (port 5174) で Worker (`--port 5199`) にプロキシする。5173 は使わない。
- `pnpm build` で `apps/server/public/admin/` に出力され、Worker の `/admin/` から配信される。

### 完了条件

- 共通条件 (`typecheck` / `check` / `test` / `build`) に加え:
  1. `apps/admin/src/lib/{datetime,page-tree}.test.ts` が `pnpm test` で走る。
  2. `pnpm build` 後に Worker を `--port 5199` で起動し、`GET /admin/` → 200 (`text/html`)、`GET /admin/pages/new` → 200 (SPA フォールバック)、`GET /admin/assets/<index の js>` → 200 (`text/javascript`)。
  3. `GET /api/v1/settings` (admin セッション) → 200 `{ site, organization }`。`PUT /api/v1/settings/site` `{ title: 'Kanso Dev' }` → 200 で `site.title` が反映、`locale` は既定値 `ja`。editor ロール相当の確認は read スコープ API キーで `GET /api/v1/settings` → 403。
  4. ブラウザ操作の自動化は無いため、以下は **コードレビューで** 確認する: (a) ContentForm が `createPageSchema` / `createPostSchema` に無いキーを送らない、(b) Tiptap の `getJSON()` が `richTextDocSchema` を通る構成 (heading levels 1–4, image attrs, link attrs)、(c) 画像挿入の `src` が `/media/...` (`renderRichText` の許可条件)、(d) admin 以外のロールで settings / api-keys が隠れる。
  5. 実装後、`apps/admin/src/routeTree.gen.ts` が再生成されていること (プラグインが生成。手編集しない)。

### 決定

- Tiptap は 4 パッケージとも `3.31.3` を採用した。画像の `width` / `height` は Image
  拡張属性として保持し、メディア API が返す `/media/...` の URL だけを選択 UI から挿入する。
- リンク入力は `/`、`#`、`http(s)`、`mailto:`、`tel:` で始まる値に限定し、空入力はリンク解除とした。
- 新規作成時のスラッグはタイトルまたは名前に追従し、スラッグ欄を一度手入力した時点で追従を止める。
- raw HTML は編集機能を持たない保持専用ノードとし、エディタ上では「HTML ブロック」と表示する。
- レビュー後の修正: Tiptap の `getJSON()` は zod 正規化後の doc と一致しない (キー順・`class: null` など) ため、
  `Editor` はマウント後は非制御とし、`content` 同期の `useEffect` を外した。レコード切替は `editorKey` / ルートの
  `remountDeps` で再マウントする。画像は `insertContent` に `width` / `height` を含めて 1 回で挿入する
  (挿入後の `updateAttributes` は選択範囲が過ぎていて届かない)。
- `PostTypeForm` はルートファイルから `components/PostTypeForm.tsx` へ移動した (`autoCodeSplitting` ではルートファイルの
  `Route` 以外の export が安全でない)。
- `TagInput` は日本語名で `slugify` が空になる場合、スラッグを `window.prompt` で求めてから作成する。アップロード時に
  `alt` を空文字で送らない (省略で `null`)。`MediaPicker` の本体は開いている間だけマウントし、閉じたピッカーが
  メディア一覧を取得しないようにした。

---

## T7. 公開 SSR

状態: `done`

### ゴール

管理画面で作った投稿が公開サイトに出る。投稿タイプごとの一覧 / 詳細 / カテゴリ・タグ絞込、`/` のフォールバック、JSON-LD (`BlogPosting` / `CollectionPage` / `BreadcrumbList`)、`/sitemap.xml` / `/robots.txt` / `/:type/feed.xml`、下書きプレビュー、Workers Cache API によるキャッシュと更新時の purge まで。Phase 1 の最終タスク。

### 仕様

**URL 解決** (`apps/server/src/site/routes.tsx` を書き換え)

- 既存の `/` と `/:path{.+}` の 2 ハンドラ構成は維持し、`/:path{.+}` の中で次の順に解決する (末尾スラッシュの 301 正規化は既存のまま):
  1. `pages.findPublishedByPath(path)` に一致 → 固定ページ (既存の描画。ただし `canonical` は `page.canonicalUrl ?? 自身の URL`、`ogImage` は `ogMediaId` の絶対 URL を使うよう修正)。
  2. `segments = path.split('/')`。`postTypes.findBySlug(segments[0])` が無ければ 404。
  3. `segments.length === 1` → 投稿一覧。`=== 2` かつ `segments[1] === 'feed.xml'` → Atom feed。`=== 2` → 投稿詳細 (`posts.findPublished(type.id, slug)`、無ければ 404)。`=== 3` かつ `segments[1] === 'category'` → カテゴリ絞込 (`taxonomies.findCategoryBySlug(type.id, slug)`)。`=== 3` かつ `segments[1] === 'tag'` → タグ絞込 (`taxonomies.findTagBySlug(slug)`)。それ以外は 404。
- `/sitemap.xml`, `/robots.txt` は `/:path{.+}` より前に `site.get(...)` で登録する。`/preview/*` は `site.route('/preview', preview)` を **キャッシュミドルウェアより前** に登録する。
- `/`: `home` ページがあれば既存どおり。無ければ `site.homePostTypeSlug` が解決できる投稿タイプの一覧を `/` で描画 (`?page=n` 対応。canonical は `/`)。どちらも無ければ既存のプレースホルダ。
- 一覧のページング: `POSTS_PER_PAGE = 10` (`packages/shared/src/site.ts` に定数として置き `index.ts` から re-export)。`?page=n` は整数 `>= 2` のみ有効。`page=1` や不正値は **クエリを外した URL へ 301**、`total` を超える page は 404。`page` 以外のクエリは無視する。
- ナビゲーション (`site/context.ts`): 既存の最上位ページに続けて、投稿タイプ (`postTypes.list()`, `sortOrder` 順) を `{ label: name, href: '/' + slug }` で並べる。`loadSiteContext` は 4 クエリを `Promise.all` で取る。

**core: 公開用の読み取り API** (`packages/core/src/services/`)

- `posts.ts`:
  - `postsPublishedNow(now = new Date())` = `and(eq(posts.status, 'published'), lte(posts.publishedAt, now))` (pages.ts の `publishedNow` と同じ形。posts テーブル用)。
  - `findPublished(postTypeId, slug)` → 公開中の投稿 + 関連 (下記 `hydrate`)、無ければ `null`。
  - `getWithRelations(id)` → 状態を問わず 1 件 + 関連 (プレビューと purge 用)。無ければ `notFound('Post')`。
  - `hydrate(row)` (内部関数): `categories: { id, slug, name }[]` (`post_categories ⋈ categories`, `sortOrder, name` 順)、`tags: { id, slug, name }[]` (`post_tags ⋈ tags`, `name` 順)、`authorName: string | null` (`users.name`)、`coverMedia: { url, alt, width, height } | null`、`ogMediaUrl: string | null` (`mediaUrl(r2Key)`)。既存の `get(id)` (`categoryIds` / `tagIds`) は変えない。
  - `listPublished({ postTypeId, page, perPage, categoryId?, tagId? })` → `{ items, total }`。`items` は `bodyJson` / `bodyHtml` を除く。絞込は `exists (select 1 from post_categories where post_id = posts.id and category_id = ?)` (タグも同様)。並びは `publishedAt desc, id desc`。
  - `listPublishedForSitemap()` → 全タイプの公開投稿 `{ postTypeId, slug, updatedAt }[]` (`noindex = false` のみ、`publishedAt desc`)。
- `pages.ts`: `listPublishedForSitemap()` → `{ path, updatedAt }[]` (`noindex = false` のみ)。
- `taxonomies.ts`: `findCategoryBySlug(postTypeId, slug)`, `findTagBySlug(slug)` → 行 | `null`。
- `media.ts`: `find(id)` → item (`url` 付き) | `null` (throw しない版。固定ページの `ogMediaId` 解決に使う)。
- `createKanso()` の登録は変わらない (既存サービスへメソッド追加のみ)。

**@kanso/seo** (`packages/seo/src/`)

- `xml.ts`: `escapeXml(value: string)` (`& < > " '`)。
- `sitemap.ts`: `interface SitemapUrl { loc: string; lastmod?: Date | null }`、`buildSitemap(urls: SitemapUrl[]): string` → `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">…</urlset>`。`lastmod` は `toISOString()`。`loc` はエスケープ。
- `feed.ts`: `interface FeedEntry { url: string; title: string; summary?: string | null; publishedAt: Date; updatedAt: Date; authorName?: string | null }`、`interface FeedInput { title: string; subtitle?: string | null; siteUrl: string; feedUrl: string; updated: Date | null; entries: FeedEntry[] }`、`buildAtomFeed(input): string` (Atom 1.0: `<feed xmlns="http://www.w3.org/2005/Atom">`、`<id>` は `feedUrl`、`<link rel="self">` / `<link rel="alternate">`、`<updated>` は `updated ?? new Date()`、entry の `<id>` は `url`、`<summary type="text">`、`<author><name>`。本文は含めない)。
- `jsonld.ts`: `buildCollectionPage(site, { url, title, description?: string | null }) → WithContext<CollectionPage>` (`@id`/`url`/`name`/`isPartOf: { '@id': site.url + '/#website' }`/`description`/`inLanguage`)。
- `meta.ts`: `PageMeta` に `prev?: string | null`, `next?: string | null`, `feed?: { href: string; title: string } | null` を追加。
- `index.ts` から新規モジュールを re-export。`package.json` に `"test": "vitest run"`、`vitest.config.ts` (core と同じ) を追加し、`src/sitemap.test.ts` (エスケープ, lastmod あり/なし)、`src/feed.test.ts` (entry 0 件, `<` を含むタイトルのエスケープ, self/alternate link)、`src/jsonld.test.ts` (`buildCollectionPage` の `@type` と `isPartOf`、`buildBlogPosting` の `image`/`keywords`) を置く。

**Head / テーマ** (`apps/server/src/site/`)

- `head.tsx`: `meta.prev` / `meta.next` → `<link rel="prev|next">`、`meta.feed` → `<link rel="alternate" type="application/atom+xml" title href>`。
- `themes/default/post-list.tsx`: `PostList({ heading, description?, items, pagination: { page, totalPages, basePath } })`。各 item は `<article class="post-summary">` に `<h2><a href>`、`<time datetime>` (下記 `formatDate`)、`excerpt`。ページングは `<nav class="pagination">` に前後リンク (`basePath` と `?page=n`; page 2 → 1 は `basePath` そのもの)。
- `themes/default/post.tsx`: `PostArticle({ post, typeSlug, formatDate })`。`<h1>`、`<time>`、著者名、カバー画像 (`<img src alt width height>`; `coverMedia` があるとき)、カテゴリ / タグへのリンク (`/${type}/category/${slug}`, `/${type}/tag/${slug}`)、`raw(bodyHtml)`。
- `site/format.ts`: `formatDate(date, { locale, timeZone })` = `Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone })`。`SiteRequestContext` に `formatDate(date)` を追加 (settings の `locale` / `timezone` を束ねる)。
- `apps/server/public/theme.css` に `.post-summary`, `.post-meta`, `.post-cover`, `.post-terms`, `.pagination` の最小スタイルを追加 (既存の変数を使う)。

**メタ / JSON-LD**

- 投稿詳細: title = `seoTitle ?? title`、description = `seoDescription ?? excerpt ?? site.description`、canonical = `canonicalUrl ?? 自身`、`ogType: 'article'`、`ogImage` = `ogMediaUrl ?? coverMedia.url` を `absoluteUrl(origin, …)` で絶対化、`noindex`、`publishedAt` / `updatedAt`。JSON-LD = `Organization`, `WebSite`, `BlogPosting` (`imageUrl`, `authorName`, `tags` = タグ名), `BreadcrumbList` (サイト → 投稿タイプ → 投稿)。`feed` = そのタイプの feed。
- 一覧 / 絞込: title = `type.name` / `${category.name} – ${type.name}` / `#${tag.name} – ${type.name}`、description = `type.description ?? site.description`、`prev` / `next` (存在するときのみ。絶対 URL)、`feed`。JSON-LD = `Organization`, `WebSite`, `CollectionPage`, `BreadcrumbList` (サイト → タイプ (→ カテゴリ/タグ))。`/` フォールバック一覧は canonical `/`、`BreadcrumbList` なし。
- 固定ページ: 既存に `canonicalUrl` と `ogImage` の反映を足すだけ。

**sitemap / robots / feed** (`apps/server/src/site/feeds.ts`)

- `GET /sitemap.xml`: `/` + 公開ページ (`home` は除く。`/${path}`) + 各投稿タイプの `/${slug}` (投稿 0 件でも含める) + 公開投稿 `/${type}/${slug}`。`lastmod` は `updatedAt` (`/` とタイプ一覧は無し)。カテゴリ / タグ絞込は含めない。`content-type: application/xml; charset=utf-8`。
- `GET /robots.txt`: `User-agent: *` / `Disallow: /admin` / `Disallow: /api` / `Disallow: /preview` / 空行 / `Sitemap: ${SITE_URL}/sitemap.xml`。`text/plain; charset=utf-8`。
- `GET /:type/feed.xml`: そのタイプの最新 20 件 (`listPublished({ perPage: 20 })`)。`title` = `${type.name} | ${site.title}`、`updated` = 先頭の `updatedAt`。`content-type: application/atom+xml; charset=utf-8`。

**プレビュー** (`apps/server/src/site/preview.tsx`, `site.route('/preview', preview)`)

- `GET /preview/:kind/:id` (`kind` = `page` | `post`、`id` は `idSchema`)。`authenticate` を通し、`principal.kind !== 'session'` なら `KansoError.unauthorized()` (JSON 401 でよい)。
- `page` → `pages.get(id)`、`post` → `posts.getWithRelations(id)` + `postTypes.get(post.postTypeId)`。状態・公開日時を問わず公開時と同じテンプレートで描画。`meta.noindex = true`、canonical は本来の公開 URL。レスポンスヘッダ `cache-control: no-store`, `x-robots-tag: noindex`。
- 管理画面: `apps/admin/src/routes/_auth/pages/$id.tsx` と `posts/$id.tsx` の `PageHeading` actions に `<a href="/preview/page/${id}" target="_blank" rel="noreferrer">プレビュー</a>` を常時表示 (既存「サイトで見る」の左)。admin の変更はこれだけ。

**キャッシュ** (`apps/server/src/middleware/cache.ts`)

- `siteCacheKey(url: string): string` (純粋関数): `origin + pathname`、`page` クエリがあればその値をそのまま `?page=<value>` として付ける (301 / 404 は 200 でないのでキャッシュされず、`?page=1` の 301 とキャッシュ済み `/blog` が矛盾しない)。それ以外のクエリは落とす。
- `siteCache` (createMiddleware): `GET` 以外、`kanso_session` Cookie がある (値は検証しない。編集者は常に最新を見る)、`/preview/` 配下、のいずれかならそのまま `next()`。それ以外は `caches.default.match(key)` がヒットしたら `new Response(hit.body, hit)` に `x-kanso-cache: HIT` を付けて返す。ミスなら `next()` 後、`c.res.status === 200` のとき `cache-control: public, s-maxage=60` と `x-kanso-cache: MISS` を付け `c.executionCtx.waitUntil(caches.default.put(key, c.res.clone()))`。200 以外はヘッダ `x-kanso-cache: BYPASS` のみ。`caches` が無い環境 (`typeof caches === 'undefined'`) はそのまま `next()`。
- `purgeSiteCache(c, paths: string[])`: `paths` を重複除去し、`new Set([c.env.SITE_URL, new URL(c.req.url).origin])` の各 origin と結合した URL を `caches.default.delete(url)`。`c.executionCtx.waitUntil(Promise.allSettled(...))`。`caches` が無ければ何もしない。
- 適用: `site` ルータの先頭 (`/preview` の登録の後) に `.use('*', siteCache)`。`/media/*`, `/api`, `/admin` には掛けない。
- purge 対象 (`apps/server/src/site/paths.ts` の純粋関数。`apps/server/vitest.config.ts` を core と同じ形で追加し `src/site/paths.test.ts`, `src/middleware/cache.test.ts` (`siteCacheKey`) を置く。`apps/server/package.json` に `"test": "vitest run"`):
  - `pagePurgePaths({ path })` → `['/', '/sitemap.xml', `/${path}`]` (`path === 'home'` は `/` のみ + sitemap)。
  - `postPurgePaths({ typeSlug, slug, categorySlugs, tagSlugs })` → 詳細, `/${type}`, `/${type}/feed.xml`, `/`, `/sitemap.xml`, 各 `/${type}/category/${c}`, `/${type}/tag/${t}`。
  - `postTypePurgePaths(slug)` → `/${slug}`, `/${slug}/feed.xml`, `/`, `/sitemap.xml`。
  - API 側: `api/pages.ts` の POST/PATCH/DELETE (PATCH/DELETE は変更前の `path` も対象), `api/posts.ts` (PATCH/DELETE は変更前の `getWithRelations` の slug / カテゴリ / タグも対象), `api/post-types.ts` の PATCH/DELETE (変更前後の slug)。カテゴリ / タグ / 設定の変更は purge しない (TTL 60 秒で自然に反映。決定に記録)。

### 完了条件

- 共通条件 (`typecheck` / `check` / `test` / `build`)。`pnpm test` に seo と server のテストが加わる。
- `--port 5199` の dev サーバで curl (Cookie 無し = 匿名):
  1. 準備 (admin セッション): 投稿タイプ `blog` (name `Blog`) を作成、カテゴリ `news`、タグ `first`、公開投稿 `hello` (カテゴリ・タグ付き、本文 1 段落)、下書き投稿 `draft-post`、予約投稿 `future` (`publishedAt` を翌年)。`PUT /api/v1/settings/site` で `homePostTypeSlug: 'blog'`。
  2. `GET /blog` → 200、`hello` へのリンクあり、`draft-post` / `future` は無い。`<link rel="alternate" type="application/atom+xml" href="…/blog/feed.xml">` あり。JSON-LD に `"@type":"CollectionPage"`。
  3. `GET /blog/hello` → 200、`<h1>Hello`、本文、`"@type":"BlogPosting"`、`BreadcrumbList` が 3 要素、`og:type` が `article`、`/blog/category/news` と `/blog/tag/first` へのリンク。`GET /blog/draft-post` → 404、`GET /blog/future` → 404、`GET /blog/nope` → 404。
  4. `GET /blog/category/news` → 200 で `hello` を含む。`GET /blog/tag/first` → 200。`GET /blog/category/none` → 404。`GET /blog?page=1` → 301 `/blog`。`GET /blog?page=99` → 404。`GET /blog?page=abc` → 301 `/blog`。
  5. `GET /` → 200 で `blog` の一覧 (home ページが無い前提。あれば削除してから)。
  6. `GET /sitemap.xml` → 200 `application/xml`、`/blog/hello` と `/company` を含み `/blog/draft-post` を含まない。`GET /robots.txt` → `Sitemap:` 行あり。`GET /blog/feed.xml` → 200 `application/atom+xml`、`<entry>` 1 件。
  7. `GET /preview/post/<draft id>` (Cookie 無し) → 401。(Cookie あり) → 200、`<meta name="robots" content="noindex`、`cache-control: no-store`。`GET /preview/page/<company id>` (Cookie あり) → 200。
  8. キャッシュ: 匿名で `GET /blog/hello` を 2 回 → 1 回目 `x-kanso-cache: MISS`、2 回目 `HIT`。admin セッションで `PATCH /api/v1/posts/<hello>` `{ title: 'Hello 2' }` → 直後の匿名 `GET /blog/hello` が `MISS` かつ `Hello 2` を含む。`GET /blog?utm_source=x` → `/blog` と同じキー (2 回目 HIT)。
  9. 片付け: 作成した投稿・カテゴリ・タグ・投稿タイプを削除し、`homePostTypeSlug` を `null` に戻す。`company` / `company/team` ページは残す。

### 決定

- 公開投稿のカテゴリ・タグ絞込は相関 `exists` サブクエリで行い、一覧行は本文と関連を hydrate
  しない軽量な形にした。
- sitemap は `/`、`home` 以外の公開・index 可ページ、全投稿タイプ一覧、公開・index 可投稿だけを
  含め、投稿が 0 件の投稿タイプも残す。カテゴリ・タグ、下書き、予約投稿は含めない。
- `page` は数値化後に 2 以上の整数だけを受け付け、`page=1` と不正値は全クエリを外して 301 にする。
  キャッシュキーは生の `page` 値だけを保持し、それ以外のクエリを落とすため、正規化応答と一覧の
  キャッシュが衝突しない。
- Atom feed は本文と関連を追加取得せず、軽量な公開一覧の title / excerpt / 公開・更新日時だけを使う。
  カテゴリ・タグ・設定の変更は purge せず、仕様どおり 60 秒 TTL で反映する。
- レビュー後の修正: `SiteRequestContext` に `homePostTypeSlug` を持たせ、`/` で設定を二重に読まない。
  `renderPage` / `renderPost` は `options.ctx` で読み込み済みのコンテキストを再利用できる。
  ホームをアーカイブにした場合も 2 ページ目以降の canonical は `/?page=n` (自分自身) にする。
- 既知の制限 (T4 由来): 本文から自動生成した excerpt は保存され、本文を編集しても excerpt を空にしない限り
  更新されない。公開側の description / og:description はその excerpt を使うので、Phase 2 で
  「ユーザー指定の excerpt だけ保存し、未指定なら描画時に本文から生成」へ変更を検討する。
