# Phase 8 タスクボード — サイトマップ拡充と noindex 体系

目的: **クローラーへの出口と入口を揃える。** `/sitemap.xml` の収録範囲をアーカイブまで広げて `lastmod` を付け、noindex を「コンテンツ → 投稿タイプ → サイト」の 3 階層で制御できるようにする。すでにページ・投稿個別の noindex と sitemap の土台はあるので、網羅性と一貫性を作り込むフェーズ。

運用ルール ([Phase 7](phase-7.md) と同じ):

- 1 タスク = 1 回の実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test` を通す。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T42 | サイトマップ拡充 (アーカイブ収録、`lastmod`、除外規則) | done | core, seo, server |
| T43 | noindex 体系 (投稿タイプ・サイト全体、`nofollow` 分離、サイト内検索からの除外) | done | shared, core, seo, server, admin |

Phase 8 の決定事項 (レビューで確定済み):

1. **アーカイブはサイトマップに載せる**。投稿タイプ単位で noindex にでき、noindex のタイプのアーカイブはサイトマップからも外れる。
2. **`post_types.noindex` はアーカイブだけに効く** (`/{type}`、`/{type}/category/{slug}`、`/{type}/tag/{slug}`)。投稿自体は `posts.noindex` で個別に制御する (タイプの noindex で投稿まで外れない)。
3. **サイト全体 noindex を作る** (`site.noindex`、既定 OFF)。ON なら全公開ページが `noindex, follow` を出し、サイトマップは空の `urlset` を返す。`robots.txt` は変えない (`Disallow: /` でクロールを止めると noindex を読めず URL だけ残るため)。
4. **noindex のコンテンツはサイト内検索からも除外する** (推奨案は「出す」だったが、利用者判断で除外)。
5. **ユーザー指定 noindex は `noindex, follow`**、ドラフト系システムページ (`/preview`) は従来どおり `noindex, nofollow`。ユーザーが noindex にしたページからのリンクまで辿らない必要はない。

---

## T42. サイトマップ拡充

状態: `done`

### 決定

- `taxonomies.listCategoryArchivesForSitemap()` / `listTagArchivesForSitemap()` は `{ postTypeId, slug, updatedAt }` を返し、`posts.published` (公開・公開日現在) `AND posts.noindex = false` でグルーピング、`updatedAt` は `max(posts.updatedAt)`。
- `/` の `lastmod` は `home` ページの `updatedAt`。`home` ページが無い (アーカイブやプレースホルダーの `/`) 場合は収録物の最新 `updatedAt` をフォールバックにする。
- アーカイブの `lastmod` は該当タイプ / タクソノミ内の最新 index 可能投稿 `updatedAt` を使う。`posts.listPublishedForSitemap()` の戻りからタイプ別に `max` を取る追加クエリは出さず、タイプ行は投稿行の集約から計算する。
- マイグレーション `0007_wise_namorita.sql` で `post_types.noindex` 追加。

### ゴール

- `/sitemap.xml` が index 可能な全公開 URL (固定ページ・投稿・アーカイブ) を漏れなく返す。
- 収録 URL に `lastmod` が付き、クローラーの再訪判断材料になる。
- noindex / 非公開 / ページネーション続きなど、出すべきでない URL が混ざらない。

### 仕様

- 収録ルール:

  | URL | 条件 | `lastmod` |
  |---|---|---|
  | `/` | `home` ページが noindex でない (ページ無しなら常に収録) | home ページの `updatedAt`、無ければ全収録物の最新値 |
  | `/{page.path}` | 公開済み・`noindex = false`・`path ≠ 'home'` | `pages.updated_at` |
  | `/{type.slug}` | `post_types.noindex = false` | そのタイプの最新 index 可能投稿 `updated_at` |
  | `/{type}/category/{slug}` | タイプが index 可能 + 公開・index 可能な投稿を 1 件以上持つカテゴリ | 該当投稿の最新 `updated_at` |
  | `/{type}/tag/{slug}` | 同上 (タグ) | 同上 |
  | `/{type}/{post.slug}` | 公開済み・`noindex = false` (タイプの noindex では外れない) | `posts.updated_at` |

- 収録しないもの: `?page=2` 以降、`/search`、`/preview/*`、リダイレクト元パス、`changefreq`/`priority` (Google が無視するため要素自体を出さない)。
- `taxonomies` サービスに `listCategoryArchivesForSitemap()` / `listTagArchivesForSitemap()` を追加。`posts` と内部結合し `postsPublishedNow() AND posts.noindex = false` でグルーピング、`{ postTypeId, slug, updatedAt }` を返す。
- `site.noindex = true` なら空の `urlset` を返す (200 のまま)。
- `feed.xml` に `x-robots-tag: noindex` を付ける (フィード自体をインデックスさせない)。
- 規模の上限: sitemap プロトコルは 1 ファイル 50,000 URL / 50MB。当面は単一 `urlset` のまま、超過時は sitemap index + タイプ別分割を後続候補とする。

### 完了条件

- 共通の完了条件 + `pnpm typecheck && pnpm check && pnpm test` green。
- カテゴリ・タグのアーカイブ URL が sitemap に出る。noindex のタイプ・ページ・投稿は出ない。

## T43. noindex 体系

状態: `done`

### 決定

- `site.noindex` の強制は `ctx.meta()` で `noindex: settings.noindex || (overrides.noindex ?? false)` とし、個別の呼び出しがサイト設定を打ち消せないようにした。
- `renderArchive` は `noindex: !isHome && type.noindex` を渡す (`/` のホームアーカイブは対象外)。既存の不整合として、`home` ページの `page.noindex` が meta に乗っていなかった点を `renderPage` で修正。
- `PageMeta.nofollow` を追加し `noindex` から分離。`<Head>` は `noindex` 時に `nofollow` なら `noindex, nofollow`、それ以外は `noindex, follow`。`nofollow` を立てるのは `/preview` と下書きプレビューのみ。
- サイト内検索は FTS テーブルではなく JOIN 側の公開条件に `p.noindex = 0` / `o.noindex = 0` を追加 (インデックス自体は保持し、公開クエリで落とす)。

### ゴール

- noindex を 3 階層 (コンテンツ / 投稿タイプのアーカイブ / サイト全体) で切り替えられる。
- どのレベルで noindex でも、meta robots・sitemap・サイト内検索の挙動が一貫する。

### 仕様

- **DB**: `post_types` に `noindex` boolean (NOT NULL DEFAULT false) を追加 (drizzle マイグレーション)。`siteSettingsSchema` に `noindex: z.boolean().default(false)` (JSON 行なのでマイグレーション不要)。
- **意味論**:
  - `pages.noindex` / `posts.noindex` (既存): そのコンテンツのみ。
  - `post_types.noindex`: `/{type}`、`/{type}/category/*`、`/{type}/tag/*` のアーカイブのみ。`renderArchive` が `isHome` でないとき `noindex` を meta に乗せる。`/` に表示されるホームアーカイブはサイトの玄関なので対象外。
  - `site.noindex`: `loadSiteContext` の `ctx.meta()` が全ページで `noindex` を強制する。
- **出力**: `PageMeta` に `nofollow?: boolean` を追加。`<Head>` は `meta.nofollow` なら `noindex, nofollow`、そうでなければ `noindex, follow` を出す。`/preview` 系のみ `nofollow: true` を渡す (下書きからのリンクを辿らせない)。`/search`・404 は `noindex, follow`。
- **サイト内検索**: `searchService` の公開フィルタに `p.noindex = 0` / `o.noindex = 0` を足し、noindex のページ・投稿を結果から外す。
- **管理画面**:
  - 投稿タイプフォームに「アーカイブを検索エンジンに登録しない」チェック (hint: 投稿自体は個別設定)。
  - 設定 → サイトに「サイト全体を検索エンジンに登録しない」チェック (hint: 準備中・ステージング向け。robots.txt は変わらない)。
  - グローバル設定ページは既存 `/_auth/settings` を使う (新設しない)。
- **既存値の互換性**: `post_types.noindex` は DEFAULT false、`site.noindex` も既定 false。既存サイトの挙動は変わらない。

### 完了条件

- 共通の完了条件 + `pnpm typecheck && pnpm check && pnpm test` green。
- タイプのアーカイブに `noindex, follow` が出て sitemap から外れる。`site.noindex` ON で全ページ noindex + sitemap が空になる。noindex コンテンツが `/search` 結果に出ない。

---

## 後続候補 (このフェーズの範囲外)

- sitemap index + 分割 (50,000 URL 超)。
- sitemap の `<image:image>` 拡張 (OG 画像・カバー画像)。
- カテゴリ・タグ単位の個別 noindex。
- `X-Robots-Tag` を HTML にも並行して出すかの検討。
