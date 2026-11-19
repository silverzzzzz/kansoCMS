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

マルチサイト、コンテンツ多言語化、プラグインサンドボックス、任意コンテンツタイプ (カスタムフィールド全般)、DB ポータビリティ (D1 以外)、WordPress インポート、ビジュアルインライン編集 (Phase 4 のセクションエディタはページ構成の編集であり、公開ページ上での直接編集ではない)。

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
| 認証 | パスキー (WebAuthn。CBOR / COSE の解析は自前、署名検証は WebCrypto)、D1 セッション、Cookie | パスワードなし (Phase 6)。外部 IdP・メール送信は不要。復旧は wrangler で発行する登録リンク。`/admin` に Cloudflare Access を被せる運用も可 |
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
│   │   │   ├── index.ts            # export default { fetch, scheduled }
│   │   │   ├── app.ts              # secureHeaders → kanso → /api/v1 → /media → /admin → /* (site)
│   │   │   ├── env.ts              # AppEnv (Bindings = worker-configuration.d.ts の Env, Variables = kanso/principal)
│   │   │   ├── bindings.ts         # 任意の binding (Workers AI)。既定の Env には無い
│   │   │   ├── scheduled.ts        # Cron Trigger: ゴミ箱の自動削除と期限切れデータの掃除
│   │   │   ├── i18n.ts / secrets.ts / rate-limit.ts (公開エンドポイントのレート制限)
│   │   │   ├── testing.ts          # テスト用: Worker 全体をメモリ上の D1 / R2 で動かす (createTestApp)
│   │   │   ├── middleware/         # kanso (services 注入) / auth (session・API key・CSRF・role) / cache / pageviews / error
│   │   │   ├── api/                # /api/v1 (JSON): setup, auth, users, api-keys, pages, post-types(+categories), posts, tags,
│   │   │   │                       #   media(+variants), menus, forms, public-forms, redirects, search, settings, site, starter,
│   │   │   │                       #   share-links, activity, analytics, ai, transfer (export/import)
│   │   │   ├── site/               # 公開サイト SSR (hono/jsx)
│   │   │   │   ├── routes.tsx      # /, /search, /:path+ (page → type → post → category/tag/author → 404)、メンテナンス
│   │   │   │   ├── context.ts      # loadSiteContext: settings / nav (メニュー) / meta() / formatDate を 1 回で用意
│   │   │   │   ├── render.tsx      # renderPage / renderPost (meta + JSON-LD + Layout)
│   │   │   │   ├── images.tsx      # ResponsiveImg (srcset)、保存済み本文の <img> を表示時に書き換え
│   │   │   │   ├── sections.tsx    # セクションとカスタムフィールドの値の検証・データ解決
│   │   │   │   ├── forms.tsx / search.tsx / head.tsx / feeds.ts
│   │   │   │   ├── preview.tsx     # /preview/:kind/:id (セッション必須)、/preview/share/:token (共有リンク)
│   │   │   │   └── themes/         # types.ts / index.ts (契約・レジストリ)、sections-meta.ts (JSX なしのカタログ)、
│   │   │   │                       #   chrome.tsx、sections.tsx、default/・paper/
│   │   │   ├── forms/              # 公開フォームの送信・Turnstile・通知メール
│   │   │   ├── starter/            # サンプルサイトの内容と投入
│   │   │   ├── media/              # /media/:key+ → R2 (immutable Cache-Control)
│   │   │   └── admin.ts            # /admin/* → ASSETS の /admin/index.html を返す (SPA fallback)
│   │   ├── public/                 # themes/*.css、starter/ (サンプル画像)。public/admin/ は admin ビルド出力 (gitignore)
│   │   ├── scripts/passkey-link.mjs   # `pnpm passkey:link` (パスキーの復旧リンクを D1 に発行)
│   │   ├── scripts/setup-token.mjs    # `pnpm setup:token` (本番のセットアップ用トークンを secret に設定)
│   │   ├── worker-configuration.d.ts  # `pnpm types` (wrangler types) 生成。手書き禁止
│   │   ├── wrangler.jsonc          # DB (D1) / MEDIA (R2) / ASSETS / EMAIL / triggers.crons / vars.SITE_URL (AI はコメント)
│   │   ├── vite.config.ts          # @cloudflare/vite-plugin
│   │   └── tsconfig.json           # jsxImportSource: "hono/jsx"
│   │
│   └── admin/                      # 管理画面 SPA (React 19 + Vite + Tailwind v4)
│       ├── src/
│       │   ├── main.tsx / router.tsx   # TanStack Router (basepath /admin), QueryClient
│       │   ├── routes/             # file-based: setup, login, passkey-link, _auth/(index, activity, analytics, pages, customize,
│       │   │                       #   menus, posts, post-types, tags, media, forms, redirects, tools, settings, users,
│       │   │                       #   api-keys, account)。routeTree.gen.ts は生成物
│       │   ├── api/                # hc<ApiType>() クライアント, queries (TanStack Query), errors
│       │   ├── components/         # ui, content/ (ContentForm, SeoPanel, ShareLinks, AI ボタン), editor/ (Tiptap),
│       │   │                       #   customize/, forms/, media/ (picker, upload), starter/, MenuForm, PostFieldsEditor
│       │   └── lib/                # datetime, page-tree, passkey, seo-check, schedule, ai, image-variants (縮小版をブラウザで生成)
│       ├── vite.config.ts          # base: /admin/, outDir: ../server/public/admin, dev proxy /api,/media → :5173
│       └── tsconfig.json           # jsxImportSource: "react"
│
├── packages/
│   ├── create-kanso/               # create-kanso — GitHub からサイトを生成する Node.js CLI (ESM + JSDoc、runtime 依存なし)
│   │
│   ├── core/                       # @kanso/core — ドメイン + 永続化。Hono 非依存
│   │   ├── src/
│   │   │   ├── db/schema/          # drizzle テーブル定義 (§4)。db/client.ts = drizzle(d1)、db/search.ts (contains / startsWith)
│   │   │   ├── services/           # auth, passkeys, users, pages (+page-tree), post-types, posts, taxonomies, revisions,
│   │   │   │                       #   redirects, search, media, menus, forms, settings, starter, share-links, analytics,
│   │   │   │                       #   activity, transfer, housekeeping, cache-version, rate-limits
│   │   │   ├── content/            # ProseMirror JSON 検証 → HTML (render), sanitize (html), excerpt / plainText
│   │   │   ├── auth/               # webauthn (登録・認証の検証), cbor, encoding, soft-authenticator (テスト用)
│   │   │   ├── storage/            # R2 key 命名, MIME sniff, 画像サイズ取得 (EXIF の向きを考慮)
│   │   │   ├── forms/ / mail/      # 送信データの CSV、通知メールの本文
│   │   │   ├── testing/            # テスト用: node:sqlite を D1 の API の裏に置く (createTestD1 / createTestKanso)
│   │   │   ├── errors.ts           # KansoError (notFound / validation / forbidden / unauthorized / conflict)
│   │   │   └── index.ts            # createKanso({ db, media }) → services
│   │   ├── migrations/             # drizzle-kit 出力 SQL。wrangler の migrations_dir がここを指す
│   │   └── drizzle.config.ts
│   │
│   ├── shared/                     # @kanso/shared — zod スキーマ / 型 / 定数。ブラウザ安全
│   │   └── src/                    # auth, pages, posts, revisions, redirects, search, taxonomies, media, menus, forms, settings,
│   │                               #   sections, richtext, toc, transfer (バンドル形式と splitBundle), activity, ai, starter,
│   │                               #   themes, content, query, slug (RESERVED_SLUGS), site (POSTS_PER_PAGE)
│   │
│   └── seo/                        # @kanso/seo — JSON-LD, meta/OG, sitemap, Atom。pure 関数 + テスト
│
├── examples/astro-blog/            # Astro SSG: read API キーで公開投稿・固定ページを静的生成
├── e2e/                            # Playwright E2E (§7)。playwright.config.ts はルート
├── .github/workflows/ci.yml        # GitHub Actions: gates (4 ゲート) + e2e (§7)
├── docs/
│   ├── architecture.md             # 本書
│   └── tasks/phase-N.md            # フェーズごとのタスクボード (仕様の正本 + 各タスクの決定)
├── package.json                    # scripts: dev / build / deploy / typecheck / test / check / db:* / passkey:link / setup:token
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
| `users` | id, email (uniq), name, role (`admin`/`editor`), webauthn_user_id (uniq), slug (uniq), bio, avatar_media_id, timestamps | 1 人目は `/admin/setup`、2 人目以降は管理者の招待 (Phase 12)。パスワードは持たない。`slug`・`bio`・アバターは著者ページ用 |
| `passkeys` | id, user_id, credential_id (uniq), public_key (SPKI), algorithm (ES256/RS256), sign_count, transports_json, backed_up, name, created_at, last_used_at | 1 ユーザー 10 個まで。最後の 1 つは削除不可 |
| `auth_challenges` | id (= チャレンジ), purpose (`setup`/`login`/`register`/`link`), user_id, data_json, expires_at | 5 分、1 回限り (`delete … returning`) |
| `passkey_links` | id (= トークンの SHA-256), user_id, expires_at, created_at | パスキーの登録リンク。1 回限り。CLI (`pnpm passkey:link`) は 1 時間、管理画面の招待・再発行は 7 日。再発行すると同じユーザーの古いリンクは消える |
| `sessions` | id, user_id, expires_at, created_at | Cookie は `HttpOnly; Secure; SameSite=Lax` |
| `api_keys` | id, name, key_hash, scope (`read`/`write`), last_used_at | headless 用。`X-API-KEY` |
| `pages` | id, slug, **path** (親を含む完全パス, uniq), parent_id, sort_order, title, body_json, body_html, sections_json, search_text, excerpt, status, published_at, seo_*, timestamps | 階層は `path` 列で解決 (`/company/about`)。`sections_json` 非 null のページは本文の代わりにセクション列を描画 (Phase 4) |
| `post_types` | id, slug (uniq), name, description, has_categories, has_tags, noindex, sort_order | "ブログの種類" (`blog`, `news`, `works` …)。`noindex` はアーカイブ URL のみに効く |
| `posts` | id, post_type_id, slug, title, body_json, body_html, search_text, excerpt, cover_media_id, author_id, status, published_at, seo_*, timestamps | uniq (`post_type_id`, `slug`) |
| `categories` | id, post_type_id, slug, name, parent_id, sort_order | 投稿タイプごとに独立。uniq (`post_type_id`, `slug`) |
| `tags` | id, slug (uniq), name | 全タイプ共通 |
| `post_categories` / `post_tags` | post_id, category_id / tag_id | 中間テーブル |
| `media` | id, r2_key, filename, mime, size, width, height, alt, variants_json, created_at | 実体は R2。`variants_json` は縮小版 (幅 480 / 960 / 1600 の WebP。キーは `<元のキー>.w<幅>.webp`) の一覧 (Phase 12)。`r2_key = media/{yyyy}/{mm}/{uuid}.{ext}` |
| `forms` | id, slug (uniq), name, fields_json, notify_to, success_message, redirect_url, turnstile (bool) | フィールド定義は zod で検証した JSON |
| `form_submissions` | id, form_id, data_json, meta_json (ip, ua, referrer), created_at, read_at | 管理画面で閲覧・CSV 出力 |
| `settings` | key (pk), value_json | `site` (title / description / locale / timezone / logoMediaId / ogImageMediaId / homePostTypeSlug / noindex / theme: default / paper)、`organization` (name / url / logoMediaId / twitterHandle / sameAs)、`theme` (テーマ名で名前空間を切ったテーマ設定、Phase 4)、`starter` (サンプルサイトのマニフェスト: 作成した ID と書き込んだ設定値、Phase 5。未投入なら行なし)。zod スキーマは `packages/shared/settings.ts` / `starter.ts` |
| `menus` | id, slug (uniq), name, items_json, timestamps | slug `header` のメニューがヘッダーナビを差し替える。子は 1 階層 |
| `share_links` | id (= トークンの SHA-256), target_type (`page`/`post`), target_id, created_by, expires_at, created_at | 下書きの共有リンク。7 日、無効化可 |
| `pageview_daily` | day (`YYYY-MM-DD`), path, count — PK (day, path) | Cookie を使わないアクセス解析の日次集計。400 日で削除 |
| `activity_log` | id, actor, user_id, action, target_type, target_id, summary, count, created_at | 操作ログ。最新 2,000 件。ログイン失敗は 1 時間ごとに 1 行へまとめ `count` を増やす |
| `revisions` | id, target_type (`page`/`post`), target_id, snapshot_json, user_id, created_at | 更新前の状態を対象ごとに最新 20 件。復元は update 経由 |
| `redirects` | id, from_path (uniq), to, status (`301`/`302`), created_at, updated_at | 転送元は先頭・末尾 `/` なし。手動登録と公開コンテンツのパス変更で作成 |
| `search_index` | kind (`page`/`post`, UNINDEXED), ref_id (UNINDEXED), title, excerpt, body | FTS5 (`trigram`) 仮想テーブル。pages / posts の INSERT・UPDATE・DELETE トリガで同期 |
| `rate_limits` | key (pk、`種類:IP の SHA-256`), window_start (unix 秒), count | レート制限の固定窓カウンタ (Phase 13)。窓が変わると同じ行を 1 から数え直す。1 日たった行は定期処理で消す |

`forms` / `form_submissions` はテーブルだけ初期マイグレーションに含まれ、Phase 2 でサービスと API を載せる。

Phase 8〜10 で既存テーブルに足した列: `pages.deleted_at` / `posts.deleted_at` (ゴミ箱。`path` と (`post_type_id`, `slug`) の一意制約は `WHERE deleted_at IS NULL` の部分インデックス)、`posts.pinned`、`post_types.fields_json` / `posts.fields_json` (カスタムフィールドの定義と値)、`post_types.noindex`。

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
| `GET /:type/author/:slug` | `site` — 著者ページ。その投稿タイプに公開済みの投稿がない著者は 404 | 公開 |
| `GET /sitemap.xml`, `/robots.txt`, `/:type/feed.xml` | `site/feeds` — sitemap は index 可の公開コンテンツ全般 (下記 §6)。feed は Atom 最新 20 件 + `X-Robots-Tag: noindex` | 公開 |
| `GET /preview/:kind/:id` | `site/preview` — 下書きを描画。`noindex` + `cache-control: no-store` | セッションのみ (API キーは 401) |
| `GET /preview/share/:token` | `site/preview` — 共有リンクで下書きを描画。`noindex, nofollow` + `no-store` | 公開 (有効なリンクのみ) |
| `GET /media/:key+` | `media` — R2 → `Cache-Control: public, max-age=31536000, immutable`、sandbox の CSP、`Cross-Origin-Resource-Policy: cross-origin`。縮小版も同じ経路 | 公開 |
| `GET /api/v1/health`, `GET /api/v1/setup`, `POST /api/v1/setup/options`, `POST /api/v1/setup` | 初期化。`/options` が入力 (サイト名・管理者・`starter`) を受けてパスキー作成オプションを返し、`POST /setup` がパスキーを検証して管理者を作る。`starter: true` でサンプルサイトも作る (失敗してもセットアップは成功し `starter.error` で返す)。`localhost` 以外では Worker のシークレット `SETUP_TOKEN` (16 文字以上) を `x-setup-token` ヘッダーで送らないと 403。未設定なら拒否 (`GET` の `token` が `off` / `required` / `unset` を返す) | 公開 (ユーザー 0 人のときだけ) |
| `POST /api/v1/auth/passkey/options`, `POST /api/v1/auth/passkey` | パスキーでログイン (ユーザー名なし) → セッション Cookie | 公開 |
| `POST /api/v1/auth/passkey-link/options`, `POST /api/v1/auth/passkey-link` | 登録リンク (`token`) でパスキーを追加してログイン | 公開 (有効なリンクのみ) |
| `GET/POST /api/v1/auth/passkeys`, `POST /api/v1/auth/passkeys/options`, `PATCH/DELETE /api/v1/auth/passkeys/:id` | 自分のパスキーの一覧・追加・名前変更・削除 | セッションのみ (API キーは 403) |
| `/api/v1/**` (それ以外) | 管理 API (CRUD)。`GET` は `read`、変更系は `write` | セッション or `x-api-key` |
| `GET /api/v1/pages/:id/revisions`, `GET /api/v1/posts/:id/revisions` | 固定ページ / 投稿の更新前スナップショット一覧 (最新 20 件) | セッション or `x-api-key` (`read`) |
| `GET /api/v1/pages/:id/revisions/:revisionId`, `GET /api/v1/posts/:id/revisions/:revisionId` | 固定ページ / 投稿のリビジョン詳細 (snapshot 込み) | セッション or `x-api-key` (`read`) |
| `POST /api/v1/pages/:id/revisions/:revisionId/restore`, `POST /api/v1/posts/:id/revisions/:revisionId/restore` | リビジョンを `update` 経由で復元 | セッション or `x-api-key` (`write`) |
| `GET/POST/PATCH/DELETE /api/v1/redirects` | 301/302 リダイレクトの検索・登録・更新・削除 | セッション or `x-api-key` (`read`/`write`) |
| `GET /api/v1/search` | 公開ページ・投稿の全文検索 (`q`: 1〜100 文字、`page` ≥ 1、`perPage`: 1〜50、既定 10) | セッション or `x-api-key` (`read`) |
| `POST /api/v1/search/reindex` | 全ページ・投稿の検索本文を再計算 → `{ ok: true, pages, posts }` | セッション or `x-api-key` (`write`) |
| `DELETE /api/v1/pages/:id`, `DELETE /api/v1/posts/:id` | ゴミ箱へ移動。`?force=true` のときだけ完全削除 (ゴミ箱の行への `force` なしは何もしない)。`POST …/:id/restore` で復元、`POST …/:id/duplicate` で複製 | セッション or `x-api-key` (`write`) |
| `GET/POST /api/v1/pages/:id/share-links` (posts も同じ), `DELETE /api/v1/share-links/:id` | 下書き共有リンクの一覧・発行・無効化 | セッション or `x-api-key` |
| `PUT /api/v1/media/:id/variants` | 縮小版 (multipart、`w480` / `w960` / `w1600`) を R2 に保存。形式・幅・縦横比を検証 | セッション or `x-api-key` (`write`) |
| `GET/POST/PATCH/DELETE /api/v1/menus` | メニュー | セッション or `x-api-key` |
| `GET /api/v1/activity`, `GET /api/v1/analytics/summary` | 操作ログ、アクセス解析 (期間内の全日 + 上位 20 パス) | セッション or `x-api-key` (`read`) |
| `GET /api/v1/ai`, `POST /api/v1/ai/suggest`, `POST /api/v1/ai/alt` | Workers AI (任意)。binding がなければ `available: false` / 503 | セッション or `x-api-key` |
| `GET /api/v1/export`, `POST /api/v1/import` | サイトの JSON エクスポート / インポート (§6)。エクスポートは `write` が必要。設定を含められるのは管理者セッションだけ | セッション or `x-api-key` (`write`) |
| `GET/POST /api/v1/users`, `PATCH/DELETE /api/v1/users/:id`, `POST /api/v1/users/:id/link` | ユーザーの一覧・招待・権限変更・削除・登録リンクの再発行 | セッションの `admin` のみ |
| `GET/PATCH /api/v1/auth/profile` | 自分の著者プロフィール (slug・紹介文・アバター) | セッションのみ |
| `GET/POST/DELETE /api/v1/starter` | サンプルサイトの状態取得・投入 (201、投入済みは 409)・削除 (`{ removed, kept }`、未投入は 404) | セッションの `admin` のみ |
| `POST /api/v1/public/forms/:slug/submissions` | Phase 2: Turnstile 検証 → D1 保存 → `ctx.waitUntil(email.send)` | 公開 (Turnstile) |
| `GET /admin/*` | Static Assets が先に解決。未ヒットは Worker が `/admin/index.html` を返す | SPA 自体は公開、API で守る |

URL 解決順序は **ページ → 投稿タイプ → リダイレクト** (同じ最上位 slug は作れないので一意)。実体のある公開コンテンツをリダイレクトより優先する。

解決順序 (Static Assets は Worker より先に評価される):
`assets (/admin/*.js, /themes/*.css …)` → `Hono: /api/v1` → `/media` → `/admin/*` (SPA fallback) → `/*` (site) → 404 (テーマの 404 ページ)。

`wrangler.jsonc` の `assets.not_found_handling` は `"none"` にし、SPA fallback は Hono 側で行う（`single-page-application` にすると公開サイトの 404 まで admin の HTML になるため）。

### 認証 (実装済み)

- ログイン: パスキーのみ (Phase 6、[tasks/phase-6.md](tasks/phase-6.md))。オプション発行 → ブラウザの `navigator.credentials` → 検証の 2 往復。ユーザー確認 (UV) 必須、discoverable credential でメールアドレスを聞かない。RP ID はリクエストのホスト名、origin はリクエストの origin (localhost だけは管理画面の開発サーバー経由を許すため、localhost の `Origin` を受け入れる)。
- パスキーを失ったとき: `pnpm passkey:link <email> [--remote] [--url <サイト>]` が D1 (`DB` バインディング) に 1 時間有効・1 回限りの登録リンクを書き込み、`/admin/passkey-link?token=…` で新しいパスキーを登録してログインする。D1 に書ける = Cloudflare アカウントの管理者であることを本人確認とする。
- 本番の初回セットアップ: デプロイしてから管理者を作るまでの間に他人が `/admin/setup` を開けないよう、`localhost` 以外ではシークレット `SETUP_TOKEN` がない限りセットアップを拒否する。`pnpm setup:token [--url <サイト>]` がランダムな値を `wrangler secret put` で設定し、`/admin/setup#token=…` のリンクを表示する (フラグメントなのでサーバーのログに残らない。管理画面が読み取ってアドレスバーから消す)。シークレットを書ける = Cloudflare アカウントの管理者であることを本人確認とする点は `passkey:link` と同じ。
- セッション: Cookie `kanso_session` (`HttpOnly; SameSite=Lax`, 本番は `Secure`)。パスキーの検証後に発行。
- API キー: `kanso_<base64url>` を `x-api-key` ヘッダで送る。D1 には SHA-256 ハッシュのみ保存。`scope` は `read` / `write`。
- ロール: `admin` / `editor`。設定・ユーザー管理・API キー・サンプルサイトは `admin` のみ (`requireRole('admin')`)。生 HTML ブロックと、設定のエクスポート / インポートも `admin` のセッションだけ。
- ユーザーの追加 (Phase 12): 管理者が名前・メール・権限を入れると、パスキーを持たないユーザーと 7 日間有効の登録リンクができる。相手がリンクでパスキーを作るとログインできる。メールは送らない (リンクを画面からコピーして渡す)。ログインできる管理者 (パスキーを持つ管理者) が必ず 1 人残る: その最後の 1 人は降格も削除もできず、招待しただけでまだパスキーを登録していない管理者は数に入れない (判定は UPDATE / DELETE の WHERE 句に入れて 1 文で行う)。
- CSRF: 変更系リクエストは `Sec-Fetch-Site` / `Origin` を `Host` と照合する (`middleware/auth.ts`)。

## 6. 横断的関心事

### SEO / SSR

- `site/head.tsx` が 1 ヶ所で `title` / `description` / `canonical` / `rel=prev,next` / feed の `rel=alternate` / OG / `<script type="application/ld+json">` を出力する。`loadSiteContext()` が設定から `ctx.theme` を解決し、各描画処理はその `Layout` / `PostList` / `PostArticle` を使う (未設定・未知のテーマは default)。各テーマの `<Layout meta jsonLd nav search>` は共通の `<Head>` を使う。`search` は `loadSiteContext()` が検索フォームの文言を用意する。
- `site/context.ts` の `loadSiteContext()` がリクエストごとに settings / organization / ナビ (最上位ページ + 投稿タイプ) を 1 回読み、`meta()` でサイト既定値を適用した `PageMeta` を作る。`og:image` は `site.ogImageMediaId` を解決したサイト既定を `meta()` が入れ、ページ・投稿の個別画像 (`ogMediaId` / カバー画像) があればそれを優先する。
- `og:locale` は `@kanso/seo` の `toOgLocale()` が BCP 47 タグを `language_TERRITORY` に正規化する (`Intl.Locale.maximize()`。`ja` → `ja_JP`)。
- JSON-LD は `@kanso/seo` の pure 関数 (`buildBlogPosting(site, post)`, `buildBreadcrumb(...)` …) で生成。ユニットテスト済みで headless 利用者も使える。
- `WebSite` をコンテンツページ、`Organization` は `settings.organization.name` がある場合に出力。`Organization` の `logo` は `organization.logoMediaId` (未選択ならサイトロゴ) をメディアから解決する。固定ページは `WebPage`、一覧は `CollectionPage`、投稿は `BlogPosting`、ホーム以外は `BreadcrumbList` (固定ページでは公開済みの祖先ページを `pages.listPublishedAncestors()` が挟む。非公開の祖先で連鎖を打ち切る)。検索ページは JSON-LD なし。
- `organization.twitterHandle` があると全ページに `<meta name="twitter:site" content="@…">` を出す (`@` は保存時に除く)。`twitter:card` は `og:image` 有無で `summary_large_image` / `summary`。
- `canonical` は `canonical_url` が設定されていればそれ、なければ自 URL (`SITE_URL` 基準)。プレビューでは常に自 URL + `noindex`。
- robots meta は `<Head>` が `PageMeta.noindex` を見て出す。値は `noindex, follow` (ユーザー指定・システム全般) か `noindex, nofollow` (ドラフトプレビュー `meta.nofollow`) で、noindex は 3 階層で制御する (Phase 8): コンテンツ (`pages.noindex` / `posts.noindex`)、投稿タイプのアーカイブ (`post_types.noindex` — `/type`・`/type/category/*`・`/type/tag/*` のみ。`/` に表示されるホーム一覧と投稿自体は対象外)、サイト全体 (`site.noindex` — `ctx.meta()` が全ページに強制)。noindex のコンテンツは sitemap とサイト内 `/search` 結果からも外れる。
- `sitemap.xml` は index 可能な公開 URL を網羅する: `/` (`home` ページが noindex なら除外)、公開・index 可の固定ページ、index 可タイプのアーカイブ (`/{type}`、`/{type}/category/{slug}`、`/{type}/tag/{slug}`。公開・index 可投稿を持つもののみ、taxonomies の `list*ArchivesForSitemap()`)、公開・index 可の投稿。`lastmod` はコンテンツの `updated_at` (一覧系は最新投稿の値)。`site.noindex` なら空の `urlset` を返す。`?page=2` 以降と `changefreq`/`priority` は出さない (Google が無視するため)。
- ページネーションは `rel=prev/next` を出し、2 ページ目以降も自分自身を canonical にする。
- `bodyHtml` の `data-kanso-form` プレースホルダは `site/forms.tsx` の `prepareForms()` が描画時に解決し、Turnstile ON のフォームがあるページだけ `<head>` に `challenges.cloudflare.com/turnstile/v0/api.js` を `async defer` で入れる。
- `apps/server/src/i18n.ts` は `SiteMessages` と `en` / `ja` カタログを定義し、`resolveMessages(locale)` が BCP 47 の primary subtag を見て `ja`、それ以外や不正値を `en` に解決する。`loadSiteContext()` は `messages` を付加し、テーマコンポーネントには必要な slice だけを渡す (`PostList` は pagination、`KansoForm` は form)。検証文言は `submissionSchemaFor(fields, messages)` へ流れ、HTML フォームと公開 JSON API の `details[].message` が同じローカライズ文言を共有する一方、`KansoError.message` は英語のまま維持する。

### セクション (Phase 4)

- テーマが `Theme.sections` (hero / richtext / post_list / image_with_text / cta。両同梱テーマ共通) と `Theme.settingsFields` を宣言する。設定フィールドは `packages/shared/src/sections.ts` の field DSL (text / textarea / url / select / checkbox / number / color / image / posts) で表現し、値の検証スキーマは `sectionValuesSchemaFor(fields)` が動的に組み立てる (フォームビルダーの `submissionSchemaFor` と同型)。
- カタログの正本 (label / description / fields) は JSX を含まない `site/themes/sections-meta.ts`。管理 API (`GET /api/v1/site/sections`) と pages API の入力検証はここだけを import する。**`api/` 配下から `.tsx` を import しない** こと (hc の型経由で admin の TS プログラムに JSX が混入し typecheck が壊れる)。
- `pages.sections_json` 非 null のページは、`site/sections.tsx` の `prepareSections()` が検証と image / posts データ解決を済ませてから `<SectionsBody>` で描画する。未知 type・不正 settings のセクションは warn してスキップし、ページは 500 にしない (テーマ切替直後も安全)。`search_text` は文字列設定値の連結 (`sectionsPlainText`)。
- テーマ設定は `settings` の `theme` 行にテーマ名で名前空間を切って保存し、`loadSiteContext()` が有効テーマ分だけ検証して `ctx.themeSettings` として各 `Layout` に渡す。適用は `themes/chrome.tsx` (`AccentStyle` が `--color-accent` を 1 箇所上書き、`FooterExtras` がフッター文とSNSリンク)。
- セクション表示のページでは本文 (`bodyHtml`) を描画しないので、本文に埋め込まれたフォームへの POST も受け付けない (404)。headless API は `sections` を生データで返すだけで、`examples/astro-blog` はセクションを描画しない。
- 管理画面の「カスタマイズ」(`/_auth/customize`) がエディタ: カタログからの追加・並べ替え・設定フォーム自動生成 (image は メディアピッカー、posts は投稿タイプ選択)、`POST /preview/draft/page` (セッション認証、`no-store` + `noindex`) による未保存ドラフトの iframe プレビュー、pages API / `PUT /api/v1/settings/theme` での保存。

### サンプルサイト (Phase 5)

- 「小さな会社・店舗」向けのテンプレート (セクション構成のホームとサービス、会社概要、お問い合わせ + フォーム、お知らせ 3 件、画像 7 枚、テーマ設定、サイト説明)。内容は `apps/server/src/starter/content.ts`、画像は自作の抽象 WebP で `apps/server/public/starter/` に同梱し、`ASSETS` binding から読んでメディアに登録する。文言は日本語のみ。
- 投入はセットアップ画面のチェックボックス (既定オン) か、設定画面の「サンプルサイト」。固定ページと投稿タイプは同じ URL 空間として、パス/スラッグが既にあるもの (フォームはスラッグ) は作らずに `skipped` で返す。投稿とカテゴリは今回作った投稿タイプにだけ入れる。テーマ設定とサイト説明は未設定のときだけ書く。
- **D1 のクエリ数**: Workers Free は 1 呼び出しあたり 50 クエリ (`batch()` は 1)。サービスを 1 件ずつ呼ぶと約 80 になるため、core の `services/starter.ts` が集合読み出しと `db.batch()` で書く (実測: 投入 12 / 削除 21、リクエスト全体)。行の値は各サービスと共通の insert ビルダー (`pageInsertValues` など) で作る。投入はメディア行の batch の後、残り全部とマニフェストを 1 つの batch (トランザクション) で書き、batch 内の参照はスラッグのサブクエリで解く (`AUTOINCREMENT` なので ID を先に決めない)。失敗時はメディア行と R2 を消す。
- 削除はマニフェストに載っているものだけが対象: リビジョンのある (編集した) ページ・投稿、マニフェスト外の子ページを持つページ、残る投稿がある投稿タイプとそれが使うカテゴリ、送信のあるか更新したフォーム、残るコンテンツ (サンプル以外を含む) やサイトロゴから参照される画像は残し、`kept` に理由つきで返す。テーマ設定・サイト説明は投入時の値のままなら戻す。最後にマニフェストを消す。
- D1 は LIKE / GLOB のパターンを 50 バイトに制限するので、本文中のメディア URL 照合は `instr()` を使う。

### ゴミ箱と定期処理 (Phase 9, 11, 12)

- 削除は `deleted_at` を入れるだけ。公開側のクエリ (`publishedNow()` / `postsPublishedNow()`) が `deleted_at IS NULL` を含むので、SSR・サイトマップ・フィード・検索は個別対応なしでゴミ箱を無視する。完全削除は `?force=true` のときだけ。
- 1 日 1 回の Cron Trigger (`triggers.crons`、UTC 18:00 = 日本時間 3:00) が `scheduled` ハンドラを呼ぶ。1 つの `db.batch()` で、30 日を過ぎたゴミ箱の行 (リビジョンと共有リンクごと)、期限切れの共有リンク・セッション・登録リンク・認証チャレンジ、400 日より古いアクセス解析の行、1 日たったレート制限の行を消す。ゴミ箱から消したときだけ操作ログに 1 行残す。

### エクスポート / インポート (Phase 10, 11)

- バンドルは ID を持たない。投稿タイプ・カテゴリ・タグ・著者は slug、固定ページは path、メディアは R2 のキーで参照する。セクションとカスタムフィールドの中の画像も `{ $ref: 'media', key }` で運ぶ。
- インポートは「必要な行をまとめて読む → メモリ上で差分を取る → `db.batch()` でまとめて書く」。同じインポートで作った行への参照は、文の中の slug / path サブクエリで解決する。固定ページ 100 + 投稿 100 の 1 リクエストが 19 クエリ。
- 1 リクエストは固定ページ・投稿それぞれ 100 件まで。`splitBundle()` (shared) が大きなファイルを順序を保って分割し、管理画面が順に送る。
- 設定は管理者セッションだけが出し入れできる。`starter` (サンプルの行 ID 一覧) と `cache` (キャッシュの世代) は、そのサイトだけで意味を持つ値なので運ばない。

### アクセス解析と操作ログ (Phase 10, 11)

- アクセス解析は `middleware/pageviews.ts`。`siteCache` の手前に置く (キャッシュから返したアクセスも数えるため)。GET・200・HTML だけを数え、セッション Cookie 付き・ボット・`/search`・`/preview` は数えない。書き込みは `waitUntil` で行う。
- 操作ログは API ハンドラから `logActivity()` で書く (principal を知っているのが API 層のため)。未ログインでも叩けるログイン失敗は、1 時間ごとに 1 行へまとめる。

### 画像の最適化 (Phase 12)

- 画像は R2 だけに置く。縮小版 (幅 480 / 960 / 1600) は、アップロードするブラウザが canvas で作り、元画像の隣に保存する。Cloudflare Images や画像変換は使わないので、変換の課金がなく、`workers.dev` やローカル開発でも同じように動く。
- サーバは画素をデコードしない。縮小版が WebP (WebP を作れないブラウザでは JPEG) であること、幅が宣言どおりであること、縦横比が元画像と合うことだけをヘッダから確かめる。
- 公開側は `site/images.tsx`。カバー画像・セクション・カスタムフィールドは `ResponsiveImg` (`srcset`・`sizes`・`width`・`height`)、本文は保存済みの HTML の `<img>` を表示時に書き換える (画像のある本文で 1 クエリ増える)。縮小版のない画像は元画像だけを出す。

### テスト (Phase 11)

- `@kanso/core/testing`: Node 組み込みの `node:sqlite` を、drizzle が使う D1 の API の裏に置き、全マイグレーションを適用したメモリ DB を作る。ローカル開発で効かない D1 の制限 (バインド変数 100 個、LIKE パターン 50 バイト) を再現し、D1 への往復回数を数える。
- `apps/server/src/testing.ts`: Worker 全体 (`app`) をその DB で動かす。サービスをモックした単体テストだけでは、実際の SQL と D1 の制限を一度も通らない (Phase 7〜10 の不具合の原因)。複数行を書く経路は、クエリ数の上限をテストで固定する。

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
- CSP (Phase 13、`apps/server/src/security-headers.ts`):
  - 管理画面 (`/admin/*`) は `ADMIN_CSP`。スクリプトは管理画面のバンドルだけ (`script-src 'self'`。inline も eval もなし)、他サイトへの埋め込み禁止 (`frame-ancestors 'none'`)、`object-src 'none'`、`base-uri 'self'` (カスタマイズのプレビューが `<base href>` を入れる)、`form-action 'self'`、`connect-src 'self'`。カスタマイズのプレビュー (`srcdoc`。スクリプトは動かない) はこの方針を引き継ぐので、公開ページの見た目を保つためにスタイル・画像・フォント・メディア・フレームは `https:` も許す。
  - Static Assets が Worker より先に返す `/admin/` と `/admin/index.html` には `apps/server/public/_headers` で同じ値を付け、テストで一致を確かめる。`vite preview` と本番は `_headers` を適用するが、`vite dev` は適用しない (クライアント側のルートを直接開いたときは Worker の SPA fallback が付ける)。
  - zod は `new Function` が使えるかを試し、CSP 下ではその試行が違反として報告される。管理画面は最初に `@kanso/shared/zod-config` の `disableZodJit()` (`jitless`) を呼んで試行させない。
  - 公開サイトには CSP を付けない (テーマ・head HTML・生 HTML ブロックの自由度のため)。付けるなら Turnstile 用に `script-src` で `https://challenges.cloudflare.com` を許可する。
- メディア (`/media/*`): `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox` で、ファイルを直接開いてもスクリプトは動かない (Chrome 157・Edge 157・Firefox 155 で画像も PDF も表示されることを確認)。`Cross-Origin-Resource-Policy` は `/media` だけ `cross-origin` (別オリジンの headless フロントエンドが `<img>` で埋め込めるように。Phase 12 までは Hono の `secureHeaders` の既定 `same-origin` が付いていて、ブラウザが別オリジンからの読み込みを拒んでいた)、それ以外の応答は `same-origin`。
- パスキー: 公開鍵 (SPKI) だけを保存し、署名は WebCrypto (ECDSA P-256 / RSASSA-PKCS1-v1_5) で検証する。チャレンジは 1 回限りで 5 分、署名カウンタが戻ったら拒否 (0 固定の同期パスキーは許可)。attestation は検証しない (`none` を要求)。API キーと登録リンクのトークンは SHA-256 ハッシュ保存。
- フォーム: Turnstile + honeypot + サイズ上限 + IP ごとのレート制限。
- レート制限 (Phase 13、`apps/server/src/rate-limit.ts`): 誰でも呼べて D1 に書く・メールを送るエンドポイントだけが対象。認証まわり (パスキーのログイン・登録リンク・セットアップの POST) は IP ごとに 10 分で 30 回、フォームの送信 (JSON API と HTML フォーム。honeypot に掛かった送信は数えない) は 10 分で 10 回。D1 の `rate_limits` に「種類:IP の SHA-256」をキーとした固定窓で数え、1 回の判定は 1 文の upsert。超えると 429 と `Retry-After` (HTML フォームはメッセージ付きで再描画)。IP は `CF-Connecting-IP` で、ない (Cloudflare を通っていない) 要求は数えない。KV・Durable Objects・Rate Limiting binding は使わない (§1 と決定 1)。
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
pnpm run deploy                                             # admin build → server build → wrangler deploy
```

- `pnpm dev`: 2 プロセス並列。admin の Vite dev server が `/api` `/media` を server にプロキシ。5173 が使えない場合は `pnpm --filter @kanso/server exec vite dev --port 5199` で server 単体を起動できる。
- `pnpm build`: admin → `apps/server/public/admin/` → server の `vite build` が `public/` ごと client 出力へ同梱。
- `pnpm test`: Vitest。モックだけでなく実 DB でも動かす。`@kanso/core/testing` が Node 組み込みの SQLite を D1 の API の裏に置き (全マイグレーション適用、バインド変数 100 個・LIKE 50 バイトの制限とクエリ数カウンタ付き)、`apps/server/src/testing.ts` が Worker 全体をその上で動かす。Cloudflare のアカウントも起動中のサーバーも要らない。
- `e2e/`: Playwright の Chromium E2E。`pnpm e2e` で実行し、通常の `pnpm test` には含めない。
- `.github/workflows/ci.yml`: 2 ジョブ (`gates`: typecheck/check/test/build、`e2e`: Chromium + ローカル D1 で Playwright)。デプロイは CI に含めない。
- `SITE_URL` (`wrangler.jsonc` の `vars`) は canonical / JSON-LD / sitemap / feed の絶対 URL に使う。本番では実ドメインに書き換える。
- Workers AI は任意 (`wrangler.jsonc` の `ai` binding はコメント)。AI binding は必ずリモートに接続するので、有効にすると `pnpm dev` に Cloudflare のログインが要る。既定のままならログインなしで開発サーバーと CI が動く。
- Cron Trigger はローカルでは自動で動かない。`curl "http://localhost:5173/cdn-cgi/handler/scheduled"` で `scheduled` を呼べる。
- Email (Phase 2): `wrangler email sending enable <domain>` で送信ドメインを有効化。未設定でもフォームは D1 保存のみで動く（メールは opt-in）。
- 秘密情報は `wrangler secret put` (Phase 2 で `TURNSTILE_SECRET_KEY`)。セッションは D1 に乱数 ID で保存するため署名用シークレットは不要。

## 8. 実装フェーズ

| Phase | 状態 | 内容 | 完了条件 |
|---|---|---|---|
| 0. 足場 | done | monorepo、wrangler/vite 設定、drizzle 初期マイグレーション、`wrangler types` | `pnpm dev` で Hello World が SSR される |
| 1. コア | **done (2026-09-13)** | auth/setup、API キー、pages、post_types、posts、taxonomies、media (R2)、管理画面 CRUD、Tiptap、SSR + default テーマ、`@kanso/seo` (JSON-LD/sitemap/feed)、プレビュー、キャッシュ purge | ブログ + 固定ページのサイトが公開できる ([tasks/phase-1.md](tasks/phase-1.md)) |
| 2. フォーム | **done (2026-09-15)** | フォームビルダー、公開送信 API (honeypot + 任意 Turnstile)、submissions 閲覧/CSV、Email Service 通知、本文の `form` ブロックノード + 公開側 `<form>` (非 JS 送信) | お問い合わせが管理画面設定のみで動く ([tasks/phase-2.md](tasks/phase-2.md)) |
| 3. 仕上げ | **done (2026-11-08)** | テーマ i18n、キャッシュ世代キーによる全拠点即時無効化、管理画面 E2E (Playwright)、CI (`.github/workflows`)、revisions、redirects、FTS5 検索、テーマ切替、`examples/astro-blog`、`create-kanso` スキャフォールド ([tasks/phase-3.md](tasks/phase-3.md))。管理画面 i18n は見送り (当面日本語のみ、2026-11-08) | v1.0 |
| 4. セクションエディタ | **done (2026-11-07)** | Shopify 風カスタマイズ: field DSL、`pages.sections_json`、テーマのセクションレジストリと SSR、draft プレビュー、管理画面「カスタマイズ」エディタ、テーマ設定 (accent / footer / SNS) ([tasks/phase-4.md](tasks/phase-4.md)) | 管理画面からページ構成とテーマ設定を編集でき、公開に即反映される |
| 5. サンプルサイト | **done (2026-11-08)** | 会社・店舗向けのサンプル一式をセットアップ時 (既定オン) / 設定画面から投入、編集していない部分を一括削除。D1 クエリ上限に収まる一括書き込み ([tasks/phase-5.md](tasks/phase-5.md)) | セットアップ直後から編集できるサイトが公開され、不要なら片付けられる |
| 6. パスキー認証 | **done (2026-11-08)** | パスワードを廃止し、パスキー (WebAuthn) だけでセットアップ・ログイン。アカウント画面でのパスキー管理、`pnpm passkey:link` による復旧 ([tasks/phase-6.md](tasks/phase-6.md)) | パスワードなしで管理画面を運用でき、パスキーを失っても復旧できる |
| 7. SEO 強化 | **done (2026-11-11)** | サイト既定 OG 画像 (`site.ogImageMediaId` + `ctx.meta` フォールバック)、`og:locale` の `language_TERRITORY` 正規化 (`toOgLocale`)、パンくずの祖先ページ、組織ロゴのメディア選択 + サイトロゴへのフォールバック、`twitter:site` ([tasks/phase-7.md](tasks/phase-7.md)) | SNS シェアと検索結果の見え方が揃う |
| 8. サイトマップ・noindex | **done (2026-11-11)** | sitemap をアーカイブ (タイプ・カテゴリ・タグ) と `lastmod` まで拡充、`post_types.noindex` (アーカイブのみ) / `site.noindex` の 3 階層 noindex、`noindex, follow` vs `noindex, nofollow` の区別、サイト内検索からの除外、feed の `X-Robots-Tag` ([tasks/phase-8.md](tasks/phase-8.md)) | index 可能な URL が漏れなく sitemap に載り、どのレベルでも noindex が一貫して効く |
| 9. 編集体験と運用 | **done (2026-11-11)** | 予約公開 UI (`status=scheduled` 仮想フィルタ)、メニュービルダー (`menus` 表 + `header` slug でナビ差替)、ゴミ箱 (`deleted_at` + partial unique index + 復元)、favicon/検証タグ/カスタム head・body、`robotsExtra`、リダイレクト CSV インポート (RFC4180、部分成功)、SEO チェックリスト + SERP プレビュー、複製 (`-copy` slug) + 下書き共有リンク (SHA-256・7日)、ピン留め (`posts.pinned`)、カスタム 404 (`site.notFoundPageId`)、メンテナンスモード (公開 GET 503・セッション/robots/sitemap/preview バイパス) ([tasks/phase-9.md](tasks/phase-9.md)) | 競合 CMS の運用導線を揃える |
| 10. 構造化と分析 | **done (2026-11-11)** | 軽量アクセス解析 (`pageview_daily` 日次集計・Cookie/JS 不使用・`executionCtx` で非同期記録)、投稿タイプ別カスタムフィールド (field DSL・`<dl>` 描画)、ページテンプレート (section プリセット)、AI アシスト (Workers AI・抜粋/説明文/alt 生成)、著者アーカイブ (`/{type}/author/{slug}`) + プロフィール編集 + 関連記事 + 目次 (h2/h3 自動 ID)、JSON エクスポート/インポート (slug upsert・冪等・メディアはメタのみ)、アクティビティログ (`activity_log`・2,000 件上限・全変更系ハンドラ計測) ([tasks/phase-10.md](tasks/phase-10.md)) | 構造化コンテンツとサイト内分析を持つ CMS になる |
| 11. 安定化 | **done (2026-11-12)** | Phase 7〜10 を実サーバーで動かして見つかった不具合の修正: Workers AI を任意設定に (既定では Cloudflare のログインなしで `pnpm dev` と CI が動く)、インポートの一括処理化 (Workers Free の 50 クエリに収まる) と設定の管理者限定、アクセス解析の計測位置、ログイン失敗ログの集約、ゴミ箱の完全削除条件、LIKE 50 バイト制限。実 DB を使うテストの土台 (`@kanso/core/testing`) ([tasks/phase-11.md](tasks/phase-11.md)) | 実サーバーと E2E で全機能が動き、複数行を書く経路がクエリ上限に収まる |
| 12. 運用機能 | **done (2026-11-12)** | ユーザーの招待と権限管理 (登録リンク方式)、Cron Trigger による定期処理 (ゴミ箱 30 日・期限切れデータ)、画像の最適化 (縮小版をブラウザで作って R2 に保存、`srcset`)、Phase 7〜12 の E2E、バックアップ手順 ([tasks/phase-12.md](tasks/phase-12.md)) | 複数人で運用でき、放置しても溜まり続けるものがない |

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
- **無料プランで動くことを優先する** (2026-11-12、ユーザー判断)。複数行を書く経路は Workers Free の 50 クエリ / リクエストに収め、実 DB のテストで上限を固定する。
- **Workers AI は既定で無効** (2026-11-12)。設定があるだけで開発サーバーが Cloudflare に接続するため、使う人だけが有効にする。
- **画像は R2 だけに置き、縮小版はブラウザで作る** (2026-11-12、ユーザー判断)。Cloudflare Images / 画像変換には依存しない。
- **ユーザーの招待はリンクで渡す** (2026-11-12)。メールサービスを前提にしない。パスキーの登録リンク (Phase 6) をそのまま使う。

タスク単位の細かい決定 (エディタの非制御化、スラッグ規則、purge 対象の詳細など) は [tasks/phase-1.md](tasks/phase-1.md) / [tasks/phase-2.md](tasks/phase-2.md) の各「決定」を参照。

## 10. 未決事項

1. パッケージ名の scope (`@kanso/*` が npm で取れるか)。workspace 内では `@kanso/*` のまま。
2. **T12 で決定済み**: テーマ側の `<KansoForm>` の props は `form`, `action`, `turnstileSiteKey`, `state`。
