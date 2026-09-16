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
| CSS | 管理画面: Tailwind v4 / 公開テーマ: 素の CSS (CSS 変数) | テーマ作者にビルド依存を持ち込まない |
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

pnpm workspace の**小さなモノレポ** (1 app + 1 admin + 3 packages)。分割理由は「ビルドターゲットと JSX ランタイムが違う」「headless 利用者に型とスキーマだけ配りたい」の 2 点のみ。

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
│   │   │   │                       #   posts, tags, media, settings。validate.ts (zValidator hook), principal.ts
│   │   │   ├── site/               # 公開サイト SSR (hono/jsx)
│   │   │   │   ├── routes.tsx      # /, /:path+ (page → type → post → category/tag → 404)、siteCache
│   │   │   │   ├── context.ts      # loadSiteContext: settings / nav / meta() / formatDate を 1 回で用意
│   │   │   │   ├── render.tsx      # renderPage / renderPost (meta + JSON-LD + Layout)
│   │   │   │   ├── head.tsx        # <Head>: title/meta/OG/canonical/prev/next/feed/JSON-LD を一括出力
│   │   │   │   ├── feeds.ts        # sitemap.xml / robots.txt / :type/feed.xml
│   │   │   │   ├── preview.tsx     # /preview/:kind/:id (セッション必須, noindex, no-store)
│   │   │   │   └── themes/default/ # layout.tsx, post-list.tsx, post.tsx (CSS は public/theme.css)
│   │   │   ├── media/              # /media/:key+ → R2 (immutable Cache-Control)
│   │   │   └── admin.ts            # /admin/* → ASSETS の /admin/index.html を返す (SPA fallback)
│   │   ├── public/                 # 静的ファイル (theme.css)。public/admin/ は admin ビルド出力 (gitignore)
│   │   ├── worker-configuration.d.ts  # `pnpm types` (wrangler types) 生成。手書き禁止
│   │   ├── wrangler.jsonc          # DB (D1) / MEDIA (R2) / ASSETS / vars.SITE_URL
│   │   ├── vite.config.ts          # @cloudflare/vite-plugin
│   │   └── tsconfig.json           # jsxImportSource: "hono/jsx"
│   │
│   └── admin/                      # 管理画面 SPA (React 19 + Vite + Tailwind v4)
│       ├── src/
│       │   ├── main.tsx / router.tsx   # TanStack Router (basepath /admin), QueryClient
│       │   ├── routes/             # file-based: setup, login, _auth/(index, pages, posts, post-types,
│       │   │                       #   tags, media, settings, api-keys)。routeTree.gen.ts は生成物
│       │   ├── api/                # hc<ApiType>() クライアント, queries (TanStack Query), errors
│       │   ├── components/         # ui, content/ContentForm, editor/ (Tiptap), media/ (picker, upload)
│       │   └── lib/                # datetime, page-tree
│       ├── vite.config.ts          # base: /admin/, outDir: ../server/public/admin, dev proxy /api,/media → :5173
│       └── tsconfig.json           # jsxImportSource: "react"
│
├── packages/
│   ├── core/                       # @kanso/core — ドメイン + 永続化。Hono 非依存
│   │   ├── src/
│   │   │   ├── db/schema/          # drizzle テーブル定義 (§4)。db/client.ts = drizzle(d1)
│   │   │   ├── services/           # auth, cache-version, pages (+page-tree), post-types, posts, taxonomies, media, settings
│   │   │   ├── content/            # ProseMirror JSON 検証 → HTML (render), sanitize (html), excerpt
│   │   │   ├── auth/               # PBKDF2 パスワードハッシュ
│   │   │   ├── storage/            # R2 key 命名, MIME sniff, 画像サイズ取得
│   │   │   ├── errors.ts           # KansoError (notFound / validation / forbidden / unauthorized / conflict)
│   │   │   └── index.ts            # createKanso({ db, media }) → services
│   │   ├── migrations/             # drizzle-kit 出力 SQL。wrangler の migrations_dir がここを指す
│   │   └── drizzle.config.ts
│   │
│   ├── shared/                     # @kanso/shared — zod スキーマ / 型 / 定数。ブラウザ安全
│   │   └── src/                    # auth, pages, posts, taxonomies, media, settings, richtext, content,
│   │                               #   query, slug (RESERVED_SLUGS), site (POSTS_PER_PAGE)
│   │
│   └── seo/                        # @kanso/seo — JSON-LD, meta/OG, sitemap, Atom。pure 関数 + テスト
│       └── src/                    # jsonld.ts, meta.ts, sitemap.ts, feed.ts, xml.ts
│
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

まだ無いもの (計画のみ): `examples/astro-blog`。

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
| `pages` | id, slug, **path** (親を含む完全パス, uniq), parent_id, sort_order, title, body_json, body_html, excerpt, status, published_at, seo_*, timestamps | 階層は `path` 列で解決 (`/company/about`) |
| `post_types` | id, slug (uniq), name, description, has_categories, has_tags, sort_order | "ブログの種類" (`blog`, `news`, `works` …) |
| `posts` | id, post_type_id, slug, title, body_json, body_html, excerpt, cover_media_id, author_id, status, published_at, seo_*, timestamps | uniq (`post_type_id`, `slug`) |
| `categories` | id, post_type_id, slug, name, parent_id, sort_order | 投稿タイプごとに独立。uniq (`post_type_id`, `slug`) |
| `tags` | id, slug (uniq), name | 全タイプ共通 |
| `post_categories` / `post_tags` | post_id, category_id / tag_id | 中間テーブル |
| `media` | id, r2_key, filename, mime, size, width, height, alt, created_at | 実体は R2。`r2_key = media/{yyyy}/{mm}/{uuid}.{ext}` |
| `forms` | id, slug (uniq), name, fields_json, notify_to, success_message, redirect_url, turnstile (bool) | フィールド定義は zod で検証した JSON |
| `form_submissions` | id, form_id, data_json, meta_json (ip, ua, referrer), created_at, read_at | 管理画面で閲覧・CSV 出力 |
| `settings` | key (pk), value_json | `site` (title / description / locale / timezone / logoMediaId / homePostTypeSlug) と `organization` (name / url / logoUrl / sameAs)。zod スキーマは `packages/shared/settings.ts` |
| `revisions` | id, target (`page`/`post`), target_id, snapshot_json, user_id, created_at | Phase 3。最新 N 件のみ保持 (未作成) |

`forms` / `form_submissions` はテーブルだけ初期マイグレーションに含まれ、Phase 2 でサービスと API を載せる。

- `status`: `draft` / `published`。**予約公開** = `published` かつ `published_at` が未来。公開クエリは常に `status='published' AND published_at <= now` (`pages.publishedNow()` / `posts.postsPublishedNow()`)。
- `seo_*`: `seo_title`, `seo_description`, `og_media_id`, `noindex`, `canonical_url`。
- **slug 名前空間**: 最上位 URL は `pages.path` と `post_types.slug` が共有する。`core/services` で衝突を拒否する (`/blog` が投稿タイプなら同名ページは作れない)。予約語は `packages/shared/slug.ts` の `RESERVED_SLUGS` (`admin`, `api`, `media`, `preview`, `sitemap.xml`, `robots.txt`, `feed.xml` …)。
- `excerpt` は明示値のみ保存する。未指定・空白の場合、公開側とフィードは本文から `effectiveExcerpt()` で描画時に生成する。管理 API は編集用に保存値 (`null` を含む) をそのまま返す。

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
| `GET /:path+` | `site` — `pages.path` 完全一致 (末尾 `/` は 301) | 公開 |
| `POST /:path+` | `site` — 本文中の `_form` slug のフォームへ送信 → 成功は 303/200 再描画、検証失敗は 422 再描画 | 公開 |
| `GET /:type` | `site` — 投稿一覧 (`POSTS_PER_PAGE`=10、`?page=n` は 2 以上の整数のみ。`page=1`/不正値は 301、範囲外は 404) | 公開 |
| `GET /:type/:slug` | `site` — 投稿詳細 | 公開 |
| `GET /:type/category/:slug`, `GET /:type/tag/:slug` | `site` — 絞込一覧 | 公開 |
| `GET /sitemap.xml`, `/robots.txt`, `/:type/feed.xml` | `site/feeds` — sitemap は `/` + index 可の公開ページ + 全投稿タイプ + index 可の公開投稿。feed は Atom 最新 20 件 | 公開 |
| `GET /preview/:kind/:id` | `site/preview` — 下書きを描画。`noindex` + `cache-control: no-store` | セッションのみ (API キーは 401) |
| `GET /media/:key+` | `media` — R2 → `Cache-Control: public, max-age=31536000, immutable` | 公開 |
| `GET /api/v1/health`, `/setup`, `POST /api/v1/setup`, `/auth/login` | 初期化・ログイン | 公開 |
| `/api/v1/**` (それ以外) | 管理 API (CRUD)。`GET` は `read`、変更系は `write` | セッション or `x-api-key` |
| `POST /api/v1/public/forms/:slug/submissions` | Phase 2: Turnstile 検証 → D1 保存 → `ctx.waitUntil(email.send)` | 公開 (Turnstile) |
| `GET /admin/*` | Static Assets が先に解決。未ヒットは Worker が `/admin/index.html` を返す | SPA 自体は公開、API で守る |

URL 解決順序は **ページ → 投稿タイプ** (同じ最上位 slug は作れないので一意)。

解決順序 (Static Assets は Worker より先に評価される):
`assets (/admin/*.js, /theme.css …)` → `Hono: /api/v1` → `/media` → `/admin/*` (SPA fallback) → `/*` (site) → 404 (テーマの 404 ページ)。

`wrangler.jsonc` の `assets.not_found_handling` は `"none"` にし、SPA fallback は Hono 側で行う（`single-page-application` にすると公開サイトの 404 まで admin の HTML になるため）。

### 認証 (実装済み)

- セッション: Cookie `kanso_session` (`HttpOnly; SameSite=Lax`, 本番は `Secure`)。`POST /api/v1/auth/login` で発行。
- API キー: `kanso_<base64url>` を `x-api-key` ヘッダで送る。D1 には SHA-256 ハッシュのみ保存。`scope` は `read` / `write`。
- ロール: `admin` / `editor`。設定と API キー管理は `admin` のみ (`requireRole('admin')`)。生 HTML ブロックも `admin` のみ。
- CSRF: 変更系リクエストは `Sec-Fetch-Site` / `Origin` を `Host` と照合する (`middleware/auth.ts`)。

## 6. 横断的関心事

### SEO / SSR

- `site/head.tsx` が 1 ヶ所で `title` / `description` / `canonical` / `rel=prev,next` / feed の `rel=alternate` / OG / `<script type="application/ld+json">` を出力する。テーマは `<Layout meta jsonLd nav>` を使うだけ。
- `site/context.ts` の `loadSiteContext()` がリクエストごとに settings / organization / ナビ (最上位ページ + 投稿タイプ) を 1 回読み、`meta()` でサイト既定値を適用した `PageMeta` を作る。
- JSON-LD は `@kanso/seo` の pure 関数 (`buildBlogPosting(site, post)`, `buildBreadcrumb(...)` …) で生成。ユニットテスト済みで headless 利用者も使える。
- `WebSite` を毎ページ、`Organization` は `settings.organization.name` がある場合に出力。固定ページは `WebPage`、一覧は `CollectionPage`、投稿は `BlogPosting`、ホーム以外は `BreadcrumbList`。
- `canonical` は `canonical_url` が設定されていればそれ、なければ自 URL (`SITE_URL` 基準)。プレビューでは常に自 URL + `noindex`。
- ページネーションは `rel=prev/next` を出し、2 ページ目以降も自分自身を canonical にする。
- `bodyHtml` の `data-kanso-form` プレースホルダは `site/forms.tsx` の `prepareForms()` が描画時に解決し、Turnstile ON のフォームがあるページだけ `<head>` に `challenges.cloudflare.com/turnstile/v0/api.js` を `async defer` で入れる。
- `apps/server/src/i18n.ts` は `SiteMessages` と `en` / `ja` カタログを定義し、`resolveMessages(locale)` が BCP 47 の primary subtag を見て `ja`、それ以外や不正値を `en` に解決する。`loadSiteContext()` は `messages` を付加し、テーマコンポーネントには必要な slice だけを渡す (`PostList` は pagination、`KansoForm` は form)。検証文言は `submissionSchemaFor(fields, messages)` へ流れ、HTML フォームと公開 JSON API の `details[].message` が同じローカライズ文言を共有する一方、`KansoError.message` は英語のまま維持する。

### キャッシュ

- 公開 HTML は `middleware/cache.ts` の `siteCache` が Workers Cache API (`caches.default`) に `cache-control: public, s-maxage=60` で保存する。応答には `x-kanso-cache: HIT | MISS | BYPASS` を付ける。Cache API は `stale-while-revalidate` を解釈しないので使わない。
- キャッシュキーは `origin + pathname` (+ `page` クエリのみ) + `__v=<cache generation>`。それ以外のクエリ (`utm_*` など) は同一エントリに畳む。世代は `settings` の `cache` 行にランダムトークンとして保存する。
- 対象外: `GET` 以外、`kanso_session` Cookie を持つリクエスト (管理者は常に最新を見る)、`/preview/*`、200 以外の応答。`caches` が無い環境 (workers.dev や単体テスト) では素通し。
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

```bash
pnpm i
pnpm --filter @kanso/server exec wrangler d1 create kanso   # database_id を wrangler.jsonc へ
pnpm --filter @kanso/server exec wrangler r2 bucket create kanso-media
pnpm db:migrate:local                                       # wrangler d1 migrations apply --local
pnpm dev                                                    # server :5173 (workerd) + admin :5174 (proxy)
# → http://localhost:5174/admin/setup で初期ユーザー作成
pnpm typecheck && pnpm check && pnpm test && pnpm build     # タスク完了時のゲート
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
| 3. 仕上げ | in-progress | 済: テーマ i18n、キャッシュ世代キーによる全拠点即時無効化、管理画面 E2E (Playwright)、CI (`.github/workflows`) ([tasks/phase-3.md](tasks/phase-3.md))。残: revisions、redirects、FTS5 検索、テーマ切替、`examples/astro-blog`、`create-kanso` スキャフォールド、管理画面 i18n | v1.0 |

フォーム送信の CSV は `GET /api/v1/forms/:id/submissions/export.csv` から取得する。UTF-8
BOM 付き・CRLF 区切りで、古い順に最大 10,000 行を出力し、数式として解釈される値を
保護する。IP、User-Agent、リファラー、国などのメタ情報は含めない。

## 9. 決定事項

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

タスク単位の細かい決定 (エディタの非制御化、スラッグ規則、purge 対象の詳細など) は [tasks/phase-1.md](tasks/phase-1.md) / [tasks/phase-2.md](tasks/phase-2.md) の各「決定」を参照。

## 10. 未決事項

1. パッケージ名の scope (`@kanso/*` が npm で取れるか)。workspace 内では `@kanso/*` のまま。
2. **T12 で決定済み**: テーマ側の `<KansoForm>` の props は `form`, `action`, `turnstileSiteKey`, `state`。
