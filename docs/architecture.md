# kansoCMS アーキテクチャ方針

> 「簡素」— WordPress の最小構成を、Cloudflare (Workers / D1 / R2) の上に、単一デプロイで。

Phase 1 (2026-09-13 完了) 時点の実装に合わせて更新済み。タスク単位の仕様と決定は [tasks/phase-1.md](tasks/phase-1.md)。
フォーム / メール / Turnstile など Phase 2 以降の項目は方針のまま残している。

## 0. 一言で

- **Hono 1 本の Worker** に「公開サイト SSR」「REST API」「管理画面 SPA 配信」「R2 メディア配信」を同居させる。デプロイ単位は 1 つ。
- 公開サイトは **hono/jsx** で SSR（クライアント JS ゼロが既定、JSON-LD / OG / sitemap / feed を標準装備）。
- 管理画面は **React + Vite の SPA**（Tiptap エディタ、フォームビルダー）。ビルド成果物は Worker の Static Assets として `/admin/` 配下に載せる。
- データは **D1 + Drizzle ORM**、メディアは **R2**、通知メールは **Cloudflare Email Service (`send_email` binding)**、スパム対策は **Turnstile**。
- 「microCMS 的な headless 利用」は同じ REST API を API キーで叩くだけ。公開サイトを自前 (Astro 等) で作りたい人はそちらを使う。

## 1. 設計原則

| 原則 | 具体的には |
|---|---|
| 1 Worker / 1 D1 / 1 R2 で完結 | KV・Queues・DO・Cron を**使わない**。予約公開は `published_at <= now` のクエリで実現 |
| コンテンツモデルは固定 | 固定ページ / 投稿 (投稿タイプ付き) / カテゴリ / タグ / メディア / フォーム。ビジュアルスキーマビルダーは作らない |
| プラグイン機構を持たない | 拡張はフォークして `site/themes/` と `core/services` を編集する前提。emdash のサンドボックス実行等はスコープ外 |
| ドメインロジックは HTTP から独立 | `packages/core` は Hono を import しない。SSR も API も同じ service 関数を in-process で呼ぶ |
| 型は一箇所から流す | zod スキーマ (`packages/shared`) → API バリデーション → `hc` クライアント → 管理画面フォーム |
| 公開ページは "ただの HTML" | JS フレームワーク非依存。テーマ作者は JSX と CSS だけ書けばよい |

### 明示的なスコープ外 (v1)

マルチサイト、コンテンツ多言語化、プラグインサンドボックス、任意コンテンツタイプ (カスタムフィールド全般)、DB ポータビリティ (D1 以外)、WordPress インポート、ビジュアルインライン編集。

## 2. 技術選定

### 採用

| レイヤ | 選定 | 理由 |
|---|---|---|
| ランタイム | Cloudflare Workers + Static Assets | 単一デプロイ。Assets で SPA/静的ファイルを無料配信、未ヒット時のみ Worker 実行 |
| サーバ FW | **Hono** | 軽量、Workers ネイティブ、`hono/jsx` で SSR、`hc` で型付き RPC クライアント、`@hono/zod-validator` |
| 公開サイト描画 | **hono/jsx** (SSR / streaming) | React 互換の書き味で依存ゼロ。`<script>` を出さないので Core Web Vitals が構造的に良い |
| 管理画面 | **React 19 + Vite** (SPA) | Tiptap / TanStack Query / TanStack Router (file-based) のエコシステムが必要。公開側とは jsxImportSource が違うため別パッケージ |
| ビルド / 開発 | **Vite + `@cloudflare/vite-plugin`** | dev で workerd 上に実行、D1/R2 をローカルエミュレーション。`vite build` が `wrangler.json` を生成 |
| DB | **D1 + Drizzle ORM** | drizzle-kit で SQL マイグレーション生成 → `wrangler d1 migrations apply` |
| ストレージ | **R2** | Worker 経由 `/media/*` で配信 (Cache-Control 付与)。将来 R2 カスタムドメイン直配信に切替可能 |
| バリデーション | zod | server / admin / 外部クライアントで共有 |
| 認証 | メール + パスワード (WebCrypto PBKDF2)、D1 セッション、Cookie | 外部 IdP 不要。`/admin` に Cloudflare Access を被せる運用も可 |
| メール | Cloudflare Email Service (`send_email` binding) | API キー不要。ドメイン onboarding だけ |
| Bot 対策 | honeypot + Turnstile (任意) | honeypot は常時。Turnstile はフォームごとに ON/OFF (既定 OFF)、サイトキーは設定画面・シークレットは Worker secret |
| エディタ | Tiptap (ProseMirror JSON を正) | サーバで JSON → HTML 生成し `body_html` にキャッシュ。クライアント HTML を信用しない |
| SEO | 自前 `packages/seo` (+ `schema-dts` 型) | JSON-LD (`WebSite` / `WebPage` / `CollectionPage` / `BlogPosting` / `BreadcrumbList` / `Organization`)、OG、sitemap、Atom feed |
| CSS | 管理画面: Tailwind v4 / 公開テーマ: 素の CSS (共通 base.css + テーマ別 CSS 変数) | テーマ作者にビルド依存を持ち込まない |
| テスト / Lint | Vitest (各パッケージ `vitest run`、環境 `node`) / Biome | `pnpm test` は `pnpm -r --if-present test`。1 ツールで lint + format |

### 検討して見送ったもの

| 候補 | 見送り理由 |
|---|---|
| **Astro** (公開サイト) | コンテンツサイトとしては最良だが、Astro がエントリとビルドを支配するため Hono API + admin SPA との同居が二重構造になる。→ **headless 利用の推奨フロントエンド**として `examples/astro-blog` に置く |
| React Router v7 / TanStack Start | フルスタック FW に admin・公開・API を同居させると CMS としての境界が溶ける。バンドルも増える |
| HonoX | 思想は最も近いが安定度と情報量。同じ hono/jsx なので必要になれば移行は容易 |
| Next.js (OpenNext) | Workers 上では重く、D1/R2 前提の「簡素」に合わない |
| hono/jsx/dom で管理画面 | Tiptap 等の React 依存ライブラリが使えない/不安定。管理画面だけは React に寄せる |
| Portable Text (emdash) | 表現力は高いが変換層が増える。ProseMirror JSON + サーバ HTML 生成で十分 |
| KV セッション / Queues | D1 だけで足りる規模を対象にする。依存を増やさない |

## 3. リポジトリ構成

pnpm workspace の**小さなモノレポ** (1 app + 1 admin + 4 packages + 1 example)。分割理由は「ビルドターゲットと JSX ランタイムが違う」「headless 利用者に型とスキーマだけ配りたい」「サイト生成 CLI を独立して配布する」の 3 点。

```
kansoCMS/
├── apps/
│   ├── server/                     # ★唯一のデプロイ単位 (Cloudflare Worker)
│   │   ├── src/
│   │   │   ├── index.ts            # export default { fetch: app.fetch }
│   │   │   ├── app.ts              # secureHeaders → kanso → /api/v1 → /media → /admin → /* (site)
│   │   │   ├── env.ts              # AppEnv (Bindings = worker-configuration.d.ts の Env, Variables = kanso/principal)
│   │   │   ├── middleware/         # kanso (services 注入) / auth (session・API key・CSRF) / cache / error
│   │   │   ├── api/                # /api/v1 (JSON): setup, auth, api-keys, pages, post-types(+categories),
│   │   │   │                       #   posts, tags, media, redirects, search, settings。validate.ts (zValidator hook), principal.ts
│   │   │   ├── site/               # 公開サイト SSR (hono/jsx)
│   │   │   │   ├── routes.tsx      # /, /search, /:path+ (page → type → post → category/tag → 404)、siteCache
│   │   │   │   ├── search.tsx      # 検索フォーム・結果・スニペット・q を保持するページ送り
│   │   │   │   ├── context.ts      # loadSiteContext: settings / nav / meta() / formatDate を 1 回で用意
│   │   │   │   ├── render.tsx      # renderPage / renderPost (meta + JSON-LD + Layout)
│   │   │   │   ├── head.tsx        # <Head>: title/meta/OG/canonical/prev/next/feed/JSON-LD を一括出力
│   │   │   │   ├── feeds.ts        # sitemap.xml / robots.txt / :type/feed.xml
│   │   │   │   ├── preview.tsx     # /preview/:kind/:id (セッション必須, noindex, no-store)
│   │   │   │   └── themes/         # types.ts / index.ts (契約・レジストリ)、default/・paper/ (Layout / PostList / PostArticle)
│   │   │   ├── media/              # /media/:key+ → R2 (immutable Cache-Control)
│   │   │   └── admin.ts            # /admin/* → ASSETS の /admin/index.html を返す (SPA fallback)
│   │   ├── public/                 # 静的ファイル (themes/base.css, default.css, paper.css)。public/admin/ は admin ビルド出力 (gitignore)
│   │   ├── worker-configuration.d.ts  # `pnpm types` (wrangler types) 生成。手書き禁止
│   │   ├── wrangler.jsonc          # DB (D1) / MEDIA (R2) / ASSETS / vars.SITE_URL
│   │   ├── vite.config.ts          # @cloudflare/vite-plugin
│   │   └── tsconfig.json           # jsxImportSource: "hono/jsx"
│   │
│   └── admin/                      # 管理画面 SPA (React 19 + Vite + Tailwind v4)
│       ├── src/
│       │   ├── main.tsx / router.tsx   # TanStack Router (basepath /admin), QueryClient
│       │   ├── routes/             # file-based: setup, login, _auth/(index, pages, posts, post-types,
│       │   │                       #   tags, media, forms, redirects, settings, api-keys)。routeTree.gen.ts は生成物
│       │   ├── api/                # hc<ApiType>() クライアント, queries (TanStack Query), errors
│       │   ├── components/         # ui, content/ContentForm, editor/ (Tiptap), media/ (picker, upload)
│       │   └── lib/                # datetime, page-tree
│       ├── vite.config.ts          # base: /admin/, outDir: ../server/public/admin, dev proxy /api,/media → :5173
│       └── tsconfig.json           # jsxImportSource: "react"
│
├── packages/
│   ├── create-kanso/               # create-kanso — GitHub からサイトを生成する Node.js CLI (ESM + JSDoc、runtime 依存なし)
│   │   ├── bin/create-kanso.mjs    # npm create kanso のエントリポイント
│   │   └── src/                   # 引数、ustar 展開、コピー、設定の書き換え、単体テスト
│   │
│   ├── core/                       # @kanso/core — ドメイン + 永続化。Hono 非依存
│   │   ├── src/
│   │   │   ├── db/schema/          # drizzle テーブル定義 (§4)。db/client.ts = drizzle(d1)
│   │   │   ├── services/           # auth, cache-version, pages (+page-tree), post-types, posts, revisions, redirects, search, taxonomies, media, settings
│   │   │   ├── content/            # ProseMirror JSON 検証 → HTML (render), sanitize (html), excerpt / plainText
│   │   │   ├── auth/               # PBKDF2 パスワードハッシュ
│   │   │   ├── storage/            # R2 key 命名, MIME sniff, 画像サイズ取得
│   │   │   ├── errors.ts           # KansoError (notFound / validation / forbidden / unauthorized / conflict)
│   │   │   └── index.ts            # createKanso({ db, media }) → services
│   │   ├── migrations/             # drizzle-kit 出力 SQL。wrangler の migrations_dir がここを指す
│   │   └── drizzle.config.ts
│   │
│   ├── shared/                     # @kanso/shared — zod スキーマ / 型 / 定数。ブラウザ安全
│   │   └── src/                    # auth, pages, posts, revisions, redirects, search, taxonomies, media, settings, richtext,
│   │                               #   content, query, slug (RESERVED_SLUGS), site (POSTS_PER_PAGE)
│   │
│   └── seo/                        # @kanso/seo — JSON-LD, meta/OG, sitemap, Atom。pure 関数 + テスト
│       └── src/                    # jsonld.ts, meta.ts, sitemap.ts, feed.ts, xml.ts
│
├── examples/astro-blog/            # Astro SSG: read API キーで公開投稿・固定ページを静的生成
├── e2e/                            # Playwright E2E (§7)。playwright.config.ts はルート
├── .github/workflows/ci.yml        # GitHub Actions: gates (4 ゲート) + e2e (§7)
├── docs/
│   ├── architecture.md             # 本書
│   └── tasks/phase-N.md            # フェーズごとのタスクボード (仕様の正本 + 各タスクの決定)
├── package.json                    # scripts: dev / build / deploy / typecheck / test / check / db:*
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json                      # lint + format (ESLint+Prettier の代替)
├── LICENSE (MIT)
└── README.md
```

上記の構成に計画のみのものは無い。

### 依存の向き

```
apps/admin  ──hc<AppType>──▶  apps/server  ──▶  packages/core  ──▶ D1 / R2 / Email
     │                              │                  │
     └────────▶ packages/shared ◀───┘                  │
                                    └──▶ packages/seo ◀┘ (型のみ)
```

- `admin` は `server` から **型だけ** (`ApiType`) を import する。実行時依存はない。
- `core` は Cloudflare の型 (`D1Database`, `R2Bucket`、将来 `SendEmail`) に `import type` で依存するが Hono には依存しない。

## 4. データモデル (D1)

WordPress の `wp_posts` のような単一テーブル化はせず、**固定ページと投稿を分ける**（階層 vs 時系列で振る舞いが違い、クエリが素直になる）。共通列 (SEO, status, timestamps) は drizzle のカラムヘルパで共有する。

| テーブル | 主な列 | 備考 |
|---|---|---|
| `users` | id, email (uniq), password_hash, name, role (`admin`/`editor`), created_at | 初回起動時 `/admin/setup` で作成 |
| `sessions` | id, user_id, expires_at, created_at | Cookie は `HttpOnly; Secure; SameSite=Lax` |
| `api_keys` | id, name, key_hash, scope (`read`/`write`), last_used_at | headless 用。`X-API-KEY` |
| `pages` | id, slug, **path** (親を含む完全パス, uniq), parent_id, sort_order, title, body_json, body_html, search_text, excerpt, status, published_at, seo_*, timestamps | 階層は `path` 列で解決 (`/company/about`) |
| `post_types` | id, slug (uniq), name, description, has_categories, has_tags, sort_order | "ブログの種類" (`blog`, `news`, `works` …) |
| `posts` | id, post_type_id, slug, title, body_json, body_html, search_text, excerpt, cover_media_id, author_id, status, published_at, seo_*, timestamps | uniq (`post_type_id`, `slug`) |
| `categories` | id, post_type_id, slug, name, parent_id, sort_order | 投稿タイプごとに独立。uniq (`post_type_id`, `slug`) |
| `tags` | id, slug (uniq), name | 全タイプ共通 |
| `post_categories` / `post_tags` | post_id, category_id / tag_id | 中間テーブル |
| `media` | id, r2_key, filename, mime, size, width, height, alt, created_at | 実体は R2。`r2_key = media/{yyyy}/{mm}/{uuid}.{ext}` |
| `forms` | id, slug (uniq), name, fields_json, notify_to, success_message, redirect_url, turnstile (bool) | フィールド定義は zod で検証した JSON |
| `form_submissions` | id, form_id, data_json, meta_json (ip, ua, referrer), created_at, read_at | 管理画面で閲覧・CSV 出力 |
| `settings` | key (pk), value_json | `site` (title / description / locale / timezone / logoMediaId / homePostTypeSlug / theme: default / paper) と `organization` (name / url / logoUrl / sameAs)。zod スキーマは `packages/shared/settings.ts` |
| `revisions` | id, target_type (`page`/`post`), target_id, snapshot_json, user_id, created_at | 更新前の状態を対象ごとに最新 20 件。復元は update 経由 |
| `redirects` | id, from_path (uniq), to, status (`301`/`302`), created_at, updated_at | 転送元は先頭・末尾 `/` なし。手動登録と公開コンテンツのパス変更で作成 |
| `search_index` | kind (`page`/`post`, UNINDEXED), ref_id (UNINDEXED), title, excerpt, body | FTS5 (`trigram`) 仮想テーブル。pages / posts の INSERT・UPDATE・DELETE トリガで同期 |

`forms` / `form_submissions` はテーブルだけ初期マイグレーションに含まれ、Phase 2 でサービスと API を載せる。

- `status`: `draft` / `published`。**予約公開** = `published` かつ `published_at` が未来。公開クエリは常に `status='published' AND published_at <= now` (`pages.publishedNow()` / `posts.postsPublishedNow()`)。
- `seo_*`: `seo_title`, `seo_description`, `og_media_id`, `noindex`, `canonical_url`。
- **slug 名前空間**: 最上位 URL は `pages.path` と `post_types.slug` が共有する。`core/services` で衝突を拒否する (`/blog` が投稿タイプなら同名ページは作れない)。予約語は `packages/shared/slug.ts` の `RESERVED_SLUGS` (`admin`, `api`, `media`, `preview`, `search`, `sitemap.xml`, `robots.txt`, `feed.xml` …)。
- `excerpt` は明示値のみ保存する。未指定・空白の場合、公開側とフィードは本文から `effectiveExcerpt()` で描画時に生成する。管理 API は編集用に保存値 (`null` を含む) をそのまま返す。
- `search_text` は本文保存時に `plainText(bodyJson)` で生成する (抜粋と同じ抽出、切り詰めなし)。`0004_search.sql` の既存行バックフィルはタイトル・抜粋のみで本文は空。適用後に `POST /api/v1/search/reindex` で全本文を再計算する (50 件ずつ D1 batch)。

### 本文の扱い

1. 管理画面 (Tiptap) は **ProseMirror JSON** を送る。
2. サーバは JSON を zod でノード種別ごとに検証し、自前レンダラ (`core/content`) で HTML を生成して `body_html` に保存。
3. SSR と API はいずれも `body_html` を返す。API 利用者は `body_json` も取れる（自前レンダリング用）。
4. 生 HTML ブロックは `admin` ロールのみ許可し、それ以外は許可リスト外ノードを拒否する。

## 5. ルーティング

| パス | ハンドラ | 認証 |
|---|---|---|
| `GET /` | `site` — `home` ページ → `settings.site.homePostTypeSlug` の一覧 → プレースホルダ | 公開 |
| `POST /` | `site` — 本文中の `_form` slug のフォームへ送信 → 成功は 303/200 再描画、検証失敗は 422 再描画 | 公開 |
| `GET /search` | `site` — 公開ページ・投稿の全文検索 (`q`、10 件ごと、`page` は不正なら 1)。`noindex`、JSON-LD なし | 公開 |
| `GET /:path+` | `site` — `pages.path` 完全一致 (末尾 `/` は 301)。実体がなければ `redirects.from_path` を解決 | 公開 |
| `POST /:path+` | `site` — 本文中の `_form` slug のフォームへ送信 → 成功は 303/200 再描画、検証失敗は 422 再描画 | 公開 |
| `GET /:type` | `site` — 投稿一覧 (`POSTS_PER_PAGE`=10、`?page=n` は 2 以上の整数のみ。`page=1`/不正値は 301、範囲外は 404) | 公開 |
| `GET /:type/:slug` | `site` — 投稿詳細 | 公開 |
| `GET /:type/category/:slug`, `GET /:type/tag/:slug` | `site` — 絞込一覧 | 公開 |
| `GET /sitemap.xml`, `/robots.txt`, `/:type/feed.xml` | `site/feeds` — sitemap は `/` + index 可の公開ページ + 全投稿タイプ + index 可の公開投稿。feed は Atom 最新 20 件 | 公開 |
| `GET /preview/:kind/:id` | `site/preview` — 下書きを描画。`noindex` + `cache-control: no-store` | セッションのみ (API キーは 401) |
| `GET /media/:key+` | `media` — R2 → `Cache-Control: public, max-age=31536000, immutable` | 公開 |
| `GET /api/v1/health`, `/setup`, `POST /api/v1/setup`, `/auth/login` | 初期化・ログイン | 公開 |
| `/api/v1/**` (それ以外) | 管理 API (CRUD)。`GET` は `read`、変更系は `write` | セッション or `x-api-key` |
| `GET /api/v1/pages/:id/revisions`, `GET /api/v1/posts/:id/revisions` | 固定ページ / 投稿の更新前スナップショット一覧 (最新 20 件) | セッション or `x-api-key` (`read`) |
| `GET /api/v1/pages/:id/revisions/:revisionId`, `GET /api/v1/posts/:id/revisions/:revisionId` | 固定ページ / 投稿のリビジョン詳細 (snapshot 込み) | セッション or `x-api-key` (`read`) |
| `POST /api/v1/pages/:id/revisions/:revisionId/restore`, `POST /api/v1/posts/:id/revisions/:revisionId/restore` | リビジョンを `update` 経由で復元 | セッション or `x-api-key` (`write`) |
| `GET/POST/PATCH/DELETE /api/v1/redirects` | 301/302 リダイレクトの検索・登録・更新・削除 | セッション or `x-api-key` (`read`/`write`) |
| `GET /api/v1/search` | 公開ページ・投稿の全文検索 (`q`: 1〜100 文字、`page` ≥ 1、`perPage`: 1〜50、既定 10) | セッション or `x-api-key` (`read`) |
| `POST /api/v1/search/reindex` | 全ページ・投稿の検索本文を再計算 → `{ ok: true, pages, posts }` | セッション or `x-api-key` (`write`) |
| `POST /api/v1/public/forms/:slug/submissions` | Phase 2: Turnstile 検証 → D1 保存 → `ctx.waitUntil(email.send)` | 公開 (Turnstile) |
| `GET /admin/*` | Static Assets が先に解決。未ヒットは Worker が `/admin/index.html` を返す | SPA 自体は公開、API で守る |

URL 解決順序は **ページ → 投稿タイプ → リダイレクト** (同じ最上位 slug は作れないので一意)。実体のある公開コンテンツをリダイレクトより優先する。

解決順序 (Static Assets は Worker より先に評価される):
`assets (/admin/*.js, /themes/*.css …)` → `Hono: /api/v1` → `/media` → `/admin/*` (SPA fallback) → `/*` (site) → 404 (テーマの 404 ページ)。

`wrangler.jsonc` の `assets.not_found_handling` は `"none"` にし、SPA fallback は Hono 側で行う（`single-page-application` にすると公開サイトの 404 まで admin の HTML になるため）。

### 認証 (実装済み)

- セッション: Cookie `kanso_session` (`HttpOnly; SameSite=Lax`, 本番は `Secure`)。`POST /api/v1/auth/login` で発行。
- API キー: `kanso_<base64url>` を `x-api-key` ヘッダで送る。D1 には SHA-256 ハッシュのみ保存。`scope` は `read` / `write`。
- ロール: `admin` / `editor`。設定と API キー管理は `admin` のみ (`requireRole('admin')`)。生 HTML ブロックも `admin` のみ。
- CSRF: 変更系リクエストは `Sec-Fetch-Site` / `Origin` を `Host` と照合する (`middleware/auth.ts`)。

## 6. 横断的関心事

### SEO / SSR

- `site/head.tsx` が 1 ヶ所で `title` / `description` / `canonical` / `rel=prev,next` / feed の `rel=alternate` / OG / `<script type="application/ld+json">` を出力する。`loadSiteContext()` が設定から `ctx.theme` を解決し、各描画処理はその `Layout` / `PostList` / `PostArticle` を使う (未設定・未知のテーマは default)。各テーマの `<Layout meta jsonLd nav search>` は共通の `<Head>` を使う。`search` は `loadSiteContext()` が検索フォームの文言を用意する。
- `site/context.ts` の `loadSiteContext()` がリクエストごとに settings / organization / ナビ (最上位ページ + 投稿タイプ) を 1 回読み、`meta()` でサイト既定値を適用した `PageMeta` を作る。
- JSON-LD は `@kanso/seo` の pure 関数 (`buildBlogPosting(site, post)`, `buildBreadcrumb(...)` …) で生成。ユニットテスト済みで headless 利用者も使える。
- `WebSite` をコンテンツページ、`Organization` は `settings.organization.name` がある場合に出力。固定ページは `WebPage`、一覧は `CollectionPage`、投稿は `BlogPosting`、ホーム以外は `BreadcrumbList`。検索ページは JSON-LD なし。
- `canonical` は `canonical_url` が設定されていればそれ、なければ自 URL (`SITE_URL` 基準)。プレビューでは常に自 URL + `noindex`。
- ページネーションは `rel=prev/next` を出し、2 ページ目以降も自分自身を canonical にする。
- `bodyHtml` の `data-kanso-form` プレースホルダは `site/forms.tsx` の `prepareForms()` が描画時に解決し、Turnstile ON のフォームがあるページだけ `<head>` に `challenges.cloudflare.com/turnstile/v0/api.js` を `async defer` で入れる。
- `apps/server/src/i18n.ts` は `SiteMessages` と `en` / `ja` カタログを定義し、`resolveMessages(locale)` が BCP 47 の primary subtag を見て `ja`、それ以外や不正値を `en` に解決する。`loadSiteContext()` は `messages` を付加し、テーマコンポーネントには必要な slice だけを渡す (`PostList` は pagination、`KansoForm` は form)。検証文言は `submissionSchemaFor(fields, messages)` へ流れ、HTML フォームと公開 JSON API の `details[].message` が同じローカライズ文言を共有する一方、`KansoError.message` は英語のまま維持する。

### キャッシュ

- 公開 HTML は `middleware/cache.ts` の `siteCache` が Workers Cache API (`caches.default`) に `cache-control: public, s-maxage=60` で保存する。応答には `x-kanso-cache: HIT | MISS | BYPASS` を付ける。Cache API は `stale-while-revalidate` を解釈しないので使わない。
- キャッシュキーは `origin + pathname` (+ `page` クエリ、`/search` では `q` も保持) + `__v=<cache generation>`。それ以外のクエリ (`utm_*` など) は同一エントリに畳む。世代は `settings` の `cache` 行にランダムトークンとして保存する。
- 対象外: `GET` 以外、`kanso_session` Cookie を持つリクエスト (管理者は常に最新を見る)、`/preview/*`、200 以外の応答。`caches` が無い環境 (workers.dev や単体テスト) では素通し。
- リダイレクト応答は 301/302 なので Cache API には保存しない。変更は管理 API 書き込み時のキャッシュ世代更新とは独立して、次のリクエストから D1 の最新行を参照する。
- `/api/v1` の管理ルートで書き込みが成功するたびに `bumpSiteCacheVersion` が世代を更新する。ページ・投稿・投稿タイプ・カテゴリ・タグ・フォーム・メディア・設定に加え、API キーや送信削除でも更新される (余分な 1 回の miss は許容)。キー自体が変わるため `cache.delete()` は使わず、全データセンターで次の GET が自然に miss する。
- 公開 GET は cache hit を含めて `settings` 1 行を D1 から読む。小規模サイト向けの単純さを優先したトレードオフで、将来は KV への移行余地を残す。予約公開は世代更新では検出できないため、従来どおり 60 秒 TTL で反映する。
- `/media/*` は immutable。差し替えは新キー発行で対応。

### セキュリティ

- CSRF: Cookie は `SameSite=Lax` + 変更系 API で `Origin` ヘッダ検証。
- CSP: 現在は CSP ヘッダーを出力していない。追加する場合、公開サイトで Turnstile を使うときは `script-src` で `https://challenges.cloudflare.com` を許可する。管理画面は Vite の hash を許可する。
- パスワード: PBKDF2-SHA256 (WebCrypto)、比較はバイト XOR の累積で定数時間にする。API キーは SHA-256 ハッシュ保存。
- フォーム: Turnstile + honeypot + サイズ上限 + (任意) Workers Rate Limiting binding。
- アップロード: MIME 許可リスト、拡張子正規化、`Content-Disposition` 制御。SVG は既定で不可。

### 可観測性

- `wrangler.jsonc` の `observability.enabled = true`。
- 構造化ログ (JSON)。`KansoError` → HTTP ステータスへの変換は `middleware/error.ts` に集約。

## 7. 開発・デプロイ体験

新規サイトは `npm create kanso@latest my-site` (= `pnpm create kanso my-site`) → `cd my-site`。
`create-kanso` の npm 公開後に利用可能 (公開作業は T23 の範囲外)。未公開時は
`node packages/create-kanso/bin/create-kanso.mjs ../my-site --yes --from .` で試せる。
GitHub の `main` (`--ref` で変更可能) からリポジトリ全体を取得し、`docs/tasks/` だけを除外する。
Worker / D1 / R2 名と `SITE_URL`、migration コマンド、root 名と README を自分のサイト用に変更する。
`--from <dir|.tar.gz>` はオフライン用。CLI は Git の初期化だけを行い、Cloudflare のリソース作成や
依存インストールは実行しない。以下は元の checkout の名前での手順で、生成後は CLI に表示された名前を使う。

```bash
pnpm i
pnpm --filter @kanso/server exec wrangler d1 create kanso   # database_id を wrangler.jsonc へ
pnpm --filter @kanso/server exec wrangler r2 bucket create kanso-media
pnpm db:migrate:local                                       # wrangler d1 migrations apply --local
pnpm dev                                                    # server :5173 (workerd) + admin :5174 (proxy)
# → http://localhost:5174/admin/setup で初期ユーザー作成
pnpm typecheck && pnpm check && pnpm test && pnpm build     # タスク完了時のゲート
pnpm db:migrate                                             # 本番 D1 へ適用 (SITE_URL を実ドメインに変更後)
pnpm deploy                                                 # admin build → server build → wrangler deploy
```

- `pnpm dev`: 2 プロセス並列。admin の Vite dev server が `/api` `/media` を server にプロキシ。5173 が使えない場合は `pnpm --filter @kanso/server exec vite dev --port 5199` で server 単体を起動できる。
- `pnpm build`: admin → `apps/server/public/admin/` → server の `vite build` が `public/` ごと client 出力へ同梱。
- `e2e/`: Playwright の Chromium E2E。`pnpm e2e` で実行し、通常の `pnpm test` には含めない。
- `.github/workflows/ci.yml`: 2 ジョブ (`gates`: typecheck/check/test/build、`e2e`: Chromium + ローカル D1 で Playwright)。デプロイは CI に含めない。
- `SITE_URL` (`wrangler.jsonc` の `vars`) は canonical / JSON-LD / sitemap / feed の絶対 URL に使う。本番では実ドメインに書き換える。
- Email (Phase 2): `wrangler email sending enable <domain>` で送信ドメインを有効化。未設定でもフォームは D1 保存のみで動く（メールは opt-in）。
- 秘密情報は `wrangler secret put` (Phase 2 で `TURNSTILE_SECRET_KEY`)。セッションは D1 に乱数 ID で保存するため署名用シークレットは不要。

## 8. 実装フェーズ

| Phase | 状態 | 内容 | 完了条件 |
|---|---|---|---|
| 0. 足場 | done | monorepo、wrangler/vite 設定、drizzle 初期マイグレーション、`wrangler types` | `pnpm dev` で Hello World が SSR される |
| 1. コア | **done (2026-09-13)** | auth/setup、API キー、pages、post_types、posts、taxonomies、media (R2)、管理画面 CRUD、Tiptap、SSR + default テーマ、`@kanso/seo` (JSON-LD/sitemap/feed)、プレビュー、キャッシュ purge | ブログ + 固定ページのサイトが公開できる ([tasks/phase-1.md](tasks/phase-1.md)) |
| 2. フォーム | **done (2026-09-15)** | フォームビルダー、公開送信 API (honeypot + 任意 Turnstile)、submissions 閲覧/CSV、Email Service 通知、本文の `form` ブロックノード + 公開側 `<form>` (非 JS 送信) | お問い合わせが管理画面設定のみで動く ([tasks/phase-2.md](tasks/phase-2.md)) |
| 3. 仕上げ | in-progress | 済: テーマ i18n、キャッシュ世代キーによる全拠点即時無効化、管理画面 E2E (Playwright)、CI (`.github/workflows`)、revisions、redirects、FTS5 検索、テーマ切替、`examples/astro-blog`、`create-kanso` スキャフォールド ([tasks/phase-3.md](tasks/phase-3.md))。残: 管理画面 i18n | v1.0 |

フォーム送信の CSV は `GET /api/v1/forms/:id/submissions/export.csv` から取得する。UTF-8
BOM 付き・CRLF 区切りで、古い順に最大 10,000 行を出力し、数式として解釈される値を
保護する。IP、User-Agent、リファラー、国などのメタ情報は含めない。

## 9. 決定事項

- **サイト生成は GitHub リポジトリのコピーにする** (2026-09-24)。`create-kanso` は ESM + JSDoc の Node.js CLI、runtime 依存なし。`@kanso/*` の npm 公開は前提にせず、ustar を直接展開して `docs/tasks/` 以外の workspace・CI・例を保つ。ローカル checkout / tarball も指定可能。JSONC のコメントと `database_id` を保持してデプロイ識別子だけを書き換え、Cloudflare / Wrangler は実行せず次の手順を表示する。
- **固定ページと投稿は別テーブル** (2026-09-10)。WP 式の単一テーブルは採らない。
- **API は常に認証必須** (2026-09-10)。公開コンテンツは SSR で見せ、headless 利用は `read` スコープの API キーを発行する。唯一の例外はフォーム送信エンドポイント (Phase 2, Turnstile で保護)。
- **管理画面ルーターは TanStack Router** (file-based, `autoCodeSplitting`)。ルートファイルは `Route` 以外を export しない。
- **`/media` は Worker 経由で配信** (v1)。R2 カスタムドメイン直配信は将来の切替候補。
- **本文は ProseMirror JSON を正とし、HTML はサーバで生成** (T3)。クライアント HTML は受け取らない。生 HTML ブロックは `admin` ロールのみ。
- **公開 HTML は Cache API に 60 秒**、管理 API の書き込み成功時にサイト全体のキャッシュ世代を更新し、全データセンターで次の GET を miss にする (§6)。`stale-while-revalidate` は使わない。
- **プレビューはセッション認証のみ** (API キー不可)、`noindex` + `no-store`。
- **Turnstile は既定オフ** (2026-09-15)。フォームごとに有効化し、サイトキーは `settings.forms.turnstileSiteKey`、シークレットは `TURNSTILE_SECRET_KEY` (Worker secret)。両方が揃わないと有効化できない。honeypot は常時。
- **フォームの埋め込みは Tiptap の `form` ブロックノード** (2026-09-15)。レンダラは `<div data-kanso-form="slug">` のプレースホルダを出し、公開側が描画時にフォーム定義を解決する (ショートコード文字列は使わない)。
- **通知メールの差出人と既定宛先は設定に持つ** (2026-09-15)。`settings.forms = { fromEmail, fromName, notifyTo, turnstileSiteKey }`。フォームの `notifyTo` が空なら設定の既定宛先、両方空なら保存のみ。`fromEmail` が空ならメール無効。
- **リビジョンは更新前スナップショットを対象ごとに最新 20 件保持する** (2026-09-16)。内容が同じでも更新ごとに記録し、復元も `update` を通すため復元前の状態が履歴に残る。削除済みのメディア・カテゴリ・タグ・親ページへの参照は復元時に除外する。
- **リダイレクトは手動 301/302 と公開済みコンテンツのパス変更で管理する** (2026-09-21)。公開済みページ (子孫を含む) と投稿の URL 変更では 301 を自動作成し、既存の転送先も新 URL に付け替えてチェーンを作らない。実体をリダイレクトより優先し、下書きの変更と投稿タイプのスラッグ変更は自動作成の対象外とする。
- **全文検索は D1 FTS5 の trigram を使う** (2026-09-22)。空白区切り最大 8 語を AND 検索し、全語 3 文字以上なら MATCH + bm25 順、短い語を含む場合はエスケープした LIKE + 公開日降順。検索時に公開状態と公開日時を照合し、スニペットは HTML ではなくテキストと hit フラグで返す。公開 `/search` は `q` をキャッシュキー・ページ送りに保持する。
- **公開テーマは同梱して設定で切り替える** (2026-09-22)。`site.theme` は default / paper (既定 default)。テーマの契約とレジストリは `site/themes/`、CSS は `public/themes/` に置き、Paper は独自レイアウトと CSS に default の記事部品を再利用する。設定保存時のキャッシュ世代更新で全ページへ即時反映し、追加方法は README の Themes を参照する。
- **headless 利用例は Astro 5 の静的生成にする** (2026-09-22)。`examples/astro-blog` は `astro:env` のサーバ専用 API キーと素の fetch で公開投稿・固定ページを取得し、予約公開を除外する。画像は CMS の絶対 URL、フォームは注記に置換。`@kanso/*` に依存せずコピー可能とし、root dev は apps のみ、root typecheck は例も含め、例の build は API が必要なため明示実行にする。

タスク単位の細かい決定 (エディタの非制御化、スラッグ規則、purge 対象の詳細など) は [tasks/phase-1.md](tasks/phase-1.md) / [tasks/phase-2.md](tasks/phase-2.md) の各「決定」を参照。

## 10. 未決事項

1. パッケージ名の scope (`@kanso/*` が npm で取れるか)。workspace 内では `@kanso/*` のまま。
2. **T12 で決定済み**: テーマ側の `<KansoForm>` の props は `form`, `action`, `turnstileSiteKey`, `state`。
