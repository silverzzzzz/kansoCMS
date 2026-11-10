# Phase 9 タスクボード — 編集体験と運用 (競合機能の取り込み A 群)

目的: **Wix / Shopify / STUDIO / WordPress の調査で挙がった「小コスト・効果大」の機能を一通り揃える。**
対象は編集・公開・運用の導線で、kansoCMS の既存基盤 (ページ/投稿、リダイレクト、設定、セクション) の延長で実現できるもの。大型の構造拡張は [Phase 10](phase-10.md) に分離する。

運用ルール ([Phase 7](phase-7.md) と同じ):

- 1 タスク = 1 回の実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test` を通す。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T44 | 予約公開の UI 化 | done | admin, shared |
| T45 | メニュービルダー | done | shared, core, server, admin |
| T46 | ゴミ箱 (soft delete) | done | core, server, admin |
| T47 | favicon・サイト検証・カスタムコード注入 | done | shared, server, admin |
| T48 | robots.txt 追加ルール + リダイレクト CSV インポート | done | shared, core, server, admin |
| T49 | SEO チェックリスト + 検索結果プレビュー | done | admin |
| T50 | コンテンツ複製 + 下書き共有リンク | done | shared, core, server, admin |
| T51 | ピン留め投稿 + カスタム 404 + メンテナンスモード | done | shared, core, server, admin |

Phase 9 の決定事項 (レビューで確定済み):

1. **全部で 8 タスク**。競合調査 A 群の 9 項目は T50 (複製 + 共有リンク) と T51 (ピン留め + 404 + メンテナンス) に束ねてある。
2. **管理画面は既存ルート構成に乗せる**。メニューは `/menus`、ゴミ箱は各一覧のタブ切替で新規ルート乱立を避ける。

---

## T44. 予約公開の UI 化

状態: `done`

### 決定

- `datetime-local` 入力は既存だったため、追加は「予約」バッジ (pages/posts 一覧、`lib/schedule.ts` の `isScheduled`) とヒント文言のみ。
- **一覧フィルタは `listQuerySchema.status` に仮想値 `scheduled` を追加** (`status=published AND published_at > now` に展開)。DB の status 列には増えない。pages/posts 両方の一覧で「予約」を選べる。
- 公開側の非表示契約は `publishedNow()` / `postsPublishedNow()` の SQL を `SQLiteAsyncDialect` で検証するテスト (`publish-schedule.test.ts`) で固定。

### ゴール

- 未来日時で公開する「予約投稿」を管理画面から作れる・見分けられる。

### 仕様

- バックエンドは実装済み (`status = 'published'` かつ `published_at > now` は公開側で非表示)。**変更は管理画面のみ**。
- ContentForm: ステータス `published` のとき公開日時を `datetime-local` で編集可能にする (現在も `publishedAt` は送信されるが UI が無い)。
- 一覧 (pages / posts): `published && publishedAt > now` の行に「予約」バッジ + 公開予定日時を表示。
- バッジ判定はクライアント側で `new Date(row.publishedAt) > new Date()`。サーバ側の状態値は増やさない。

### 完了条件

- 未来日時を設定して保存できる。一覧で「予約」と見分けられる。公開側には出ない (既存挙動の確認テストを追加)。

## T45. メニュービルダー

状態: `done`

### 決定

- `menus` テーブル + `menuItemsSchema` (子は 1 階層・最大 20/項目 50 上限) を shared に。`href` は `/`、`#`、`http(s)` のみ許可。
- `HEADER_MENU_SLUG = 'header'`。`loadSiteContext` が `kanso.menus.findBySlug('header')` を読み、あれば `ctx.nav` を差し替え。無ければ自動生成ナビにフォールバック (テストで両経路を固定)。
- テーマ差し替えは共通 `SiteNav` コンポーネント (`themes/chrome.tsx`) を default/paper 両レイアウトが使う形に集約。子項目は `ul.site-nav-children`、CSS `:hover`/`:focus-within` ドロップダウン (JS なし)。
- 管理画面は `/menus` (一覧/新規/編集)。MenuForm の React key は項目オブジェクトの参照ではなく、位置合わせした `useRef` キー配列 (並べ替えで DOM/入力状態を維持)。
- メニュー項目の API 表現は `itemsJson` (取得時) / `items` (入力時)。

### ゴール

- WP の「メニュー」/ Shopify の「ナビゲーション」と同様に、ヘッダーナビを管理画面で自由に組める。

### 仕様

- **DB**: `menus` (id, slug uniq, name, items_json, timestamps)。`items_json` は配列 `[{ label, href, children: [{ label, href }] }]`、子は 1 階層まで。zod スキーマ `menuItemSchema` / `menuFieldsSchema` を shared に。
- **slug の意味**: `header` スラッグのメニューがサイトナビに使われる。他 slug (例 `footer`) は作成できるがテーマが参照するのは当面 `header` のみ (将来テーマ側拡張用)。
- **公開側**: `loadSiteContext` が slug `header` のメニューを読み、あれば `ctx.nav` に採用。無ければ従来の自動生成 (トップレベルページ + 投稿タイプ) にフォールバック。`NavItem` に `children?: { label, href }[]` を追加し、テーマは子があればネスト `<ul>` で出す (JS なし、CSS `:hover`/`:focus-within` でドロップダウン)。
- **API**: `/api/v1/menus` CRUD (read/write スコープ)。
- **管理画面**: `/menus` 一覧 + `/menus/$id` 編集 + `/menus/new`。項目の追加・削除・並べ替え (上下ボタン)・子項目ネスト。
- メニュー削除は `header` でも可 (フォールバックに戻る)。

### 完了条件

- `header` メニューを作ると公開ナビが差し替わる。削除すると自動生成に戻る。外部 URL と子項目が出る。

## T46. ゴミ箱

状態: `done`

### 決定

- `pages.deleted_at` / `posts.deleted_at` 追加 (migration `0009_pretty_supernaut`)。一意制約は partial unique index (`WHERE deleted_at IS NULL`) に変更し、ゴミ箱行は slug 再利用を妨げない。
- `listQuerySchema.trashed` (`'true'|'false'`)。`publishedNow()` / `postsPublishedNow()` に `isNull(deletedAt)` を内包させ、公開経路 (SSR・サイトマップ・フィード・カテゴリ/タグ集計・ナビ) は個別対応不要に。
- ページのゴミ箱入りは**子孫へカスケード** (path プレフィックスで一括更新)。完全削除時は子を親へ昇格させ live 行の path を再計算、trashed 孫は復元時にパスを引き直す。復元は親が trashed なら拒否、トップレベルは slug/postType 衝突を再検査。
- `create` の親ページ参照は live 行のみ許可 (trashed 親を選ぶとパスが失われるため)。
- 検索は `search_index` JOIN 側で `deleted_at IS NULL` (FTS 自体は全行保持のまま)。
- 投稿タイプ削除は live 投稿のみブロック。trashed 投稿は `post_types` FK cascade で一緒に消える。
- 管理画面: pages/posts 一覧に「一覧/ゴミ箱」切替、ゴミ箱行は復元 + 完全削除 (ConfirmDialog)。編集画面の削除ボタンは「ゴミ箱へ移動」動作。

### ゴール

- ページ・投稿の誤削除を取り消せる (WP のゴミ箱相当)。

### 仕様

- **DB**: `pages.deleted_at`, `posts.deleted_at` (nullable timestamp)。公開クエリ・管理一覧・検索・サイトマップ・リビジョン参照は `isNull(deletedAt)` で除外。
- **削除の意味変更**: `DELETE /pages/:id` / `posts/:id` は `deleted_at = now` に。2 回目以降や `?force=1` 付きは行削除 (従来動作)。`POST /:id/restore` で `deleted_at = null`。
- **管理画面**: pages / posts 一覧に「ゴミ箱」タブ (削除済みのみ表示、復元・完全削除ボタン)。一覧の API クエリに `trashed=1` を追加。
- **公開側**: ゴミ箱行は 404。スラッグの一意制約: 同名スラッグの新規作成はゴミ箱行と衝突するため、ゴミ箱行があっても新規作成は許可し、一意制約は `(path, deleted_at)` ではなく**復元時に衝突チェック**で対処 (実装時に SQLite の partial unique index で検証: `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`)。
- 完全削除時は関連 (post_categories/post_tags/revisions) も従来どおり掃除。

### 完了条件

- 削除→ゴミ箱表示→復元で元に戻る。完全削除で従来どおり消える。同スラッグ再作成→復元時衝突がエラーになる。

## T47. favicon・サイト検証・カスタムコード

状態: `done`

### 決定

- `siteSettingsSchema` に `faviconMediaId` / `googleSiteVerification` / `headHtml` / `bodyEndHtml` (後2者は 16KB 上限の nullable)。設定 API は `requireRole('admin')` 済みなので生 HTML は管理者専用。
- `loadSiteContext` が favicon メディアを解決し `ctx.siteExtras` に集約。`LayoutProps.extras` 経由で全描画経路 (ページ/投稿/アーカイブ/検索/404/preview/draft) に伝搬。
- 共有 `SiteHeadExtras` / `BodyEndExtras` (`themes/chrome.tsx`) を default/paper 両レイアウトが `<head>` 末尾・`</body>` 直前にレンダリング。
- 管理画面: 設定→サイトにファビコン (MediaField)・Google サイト検証・カスタム head/body 末尾を追加。

### ゴール

- サイト設定で favicon / Google サイト検証 / GA・GTM 等の埋め込みコードを管理できる (STUDIO の GA・GTM 連携、Wix のカスタムコード相当)。

### 仕様

- `siteSettingsSchema` に `faviconMediaId`, `googleSiteVerification` (文字列=検証メタの content 値), `headHtml`, `bodyEndHtml` (いずれも nullable/既定 null)。
- `<Head>`: favicon があれば `<link rel="icon">` を出す (無ければ静的 `/favicon.ico` 前提で何も出さない=現状)。検証文字列があれば `<meta name="google-site-verification">`。
- `headHtml` は `<head>` 末尾、`bodyEndHtml` は `</body>` 直前に `dangerouslySetInnerHTML` で注入。**管理者のみが編集できる設定**で、生 HTML ブロックと同等の扱い。
- 管理画面: 設定 → サイトに「ファビコン」「Google サイト検証」「カスタム head」「カスタム body 末尾」のフィールド。
- preview / maintenance / notFound にも同じ `<Head>` 経路で出る (サイト全体の設定なので)。

### 完了条件

- favicon と検証メタが head に出る。`headHtml`/`bodyEndHtml` が挿入位置どおりに出る。

## T48. robots.txt 追加ルール + リダイレクト CSV

状態: `done`

### 決定

- `siteSettingsSchema.robotsExtra` (nullable、4KB)。`robotsResponse` は設定を読み、`normalizeRobotsExtra` で CRLF/CR→LF・行末空白除去・先頭空行除去・連続空行の 1 行化をして、**既定ルールと `Sitemap:` 行の間**に挿入 (Sitemap は常に最終行)。
- CSV: shared `parseRedirectCsv` (最小 RFC4180 パーサ: クォート内カンマ/エスケープ対応)。`from,to[,status]`、`from_path|from|source` ヘッダ行を任意で解釈、空行と `#` 始まりをスキップ、行番号は 1 始まりの物理行。
- `redirectImportSchema { csv }` (1–200,000 文字)、`REDIRECT_IMPORT_MAX_ROWS = 500`、超過分は `truncated: true` で無視。
- 各行を `createRedirectSchema` で検証し、不正行は `{ line, message }` を `errors` に積んで飛ばす (部分成功)。**同一 CSV 内・既存レコードとも「最後勝ち」**: `Map` で dedupe して `onConflictDoUpdate` で upsert、結果は `{ created, updated, errors, truncated }`。100 件ずつ `db.batch`。
- API は `POST /api/v1/redirects/import` (`/:id` より前に登録)。管理画面は `<details>` のインポート欄 (テキストエリア + 作成/更新/エラー行表示)。

### ゴール

- robots.txt に運用独自のルールを書き足せる (Shopify `robots.txt.liquid` 相当)。
- 移行時の大量 301 を CSV で一括登録できる (Wix 一括リダイレクト相当)。

### 仕様

- `siteSettingsSchema` に `robotsExtra` (nullable 文字列、最大 4KB)。`robotsResponse` が出力末尾に `robotsExtra` を追記 (改行正規化、空行圧縮)。`Sitemap:` 行は常に最後。
- リダイレクト一括登録: `POST /api/v1/redirects/import`、body `{ csv: string }`。1 行 `from_path,to,status`、ヘッダ行任意、最大 500 行。各行を既存の `redirectSchema` で検証。`from_path` 重複は上書き (既存 update と同じ「最後勝ち」) かスキップか — **実装時に決定** (推奨: 既存行は上書き、結果に `updated` カウント)。
- 応答: `{ created, updated, errors: [{ line, message }] }`。エラー行は飛ばして他は登録 (部分成功)。
- 管理画面: リダイレクト一覧に「CSV インポート」UI (テキストエリア貼り付け + 結果表示)。

### 完了条件

- robotsExtra が robots.txt に出る。CSV で複数行登録でき、エラー行が行番号付きで返る。

## T49. SEO チェックリスト + 検索結果プレビュー

状態: `done`

### 決定

- 純粋ロジックは `lib/seo-check.ts` (`seoChecks` / `serpModel` / `docHasText` / `truncateMiddle`)、UI は `components/content/SeoPanel.tsx` に分離。ContentForm の「SEO 設定」`<details>` 末尾に `SeoPanel` を配置。
- サイト名・サイト既定 OG は ContentForm 内で `useQuery({ ...settingsQuery, retry: false })` で取得 (admin 以外の編集者は 403 で data=undefined → OG チェックだけ degrade)。**呼び出し側は新規 prop `publicPath` のみ**渡す (pages は `/${item.path}` または親 path + slug、posts は `/${type.slug}/${slug}`)。API 変更なし。
- チェックは 5 項目 (タイトル 10–60 / 説明 50–160 / スラッグ / OG 画像 (自身 or サイト既定) / 本文)。目安なので ✓/△ の緑・黄ドット + 基準値併記のみ。SERP プレビューはサイト名 → `host › seg › seg` パンくず → 青タイトル (60 字で省略) → `line-clamp-2` 説明。

### ゴール

- 編集画面で SEO の抜け漏れに気づける (Wix SEO チェックリスト / Yoast 式)。

### 仕様

- ContentForm に「SEO」セクション: 現在値からチェック項目を計算して ✓/△ で出す。
  - title 10–60 文字、説明 (seoDescription ?? excerpt) 50–160 文字、slug 設定済み、OG 画像 (ogMediaId またはサイト既定が解決できるか — サイト既定は props で注入)、本文あり。
  - 各項目に基準値を併記 (「説明は 50–160 文字が目安」など)。
- 同じセクションに SERP プレビュー (サイト名 + パンくず風 URL + 青タイトル + 2 行説明) を CSS のみで再現。
- すべてクライアント側計算。API 変更なし。判定は目安なのでエラーにはしない。

### 完了条件

- 編集画面でチェックとプレビューがリアルタイムに更新される。

## T50. コンテンツ複製 + 下書き共有リンク

状態: `done`

### 決定

- **複製**: `pages.duplicate` / `posts.duplicate` は既存 `create` をループ再利用 (slug `-copy`→`-copy10` まで、conflict で次候補)。タイトルは ` (コピー)` 付きで 200 字に丸める (`copyTitle`/`copySlug` を shared ではなく core の `pages.ts` に置き posts からも再利用)。status=draft、`publishedAt=null`、投稿は複製者が author・タクソノミ/カバー/SEO 全部引き継ぎ。ページは同じ親・sections もコピー。
- **共有リンク**: `share_links` (id=token の SHA-256 hex, target_type `page|post`, target_id, created_by → users set null, expires_at, created_at)。migration `0010`。平文トークンは発行レスポンスの URL にのみ存在 (passkey_links と同方式)。有効期限は発行から 7 日固定 (`SHARE_LINK_TTL_MS`)。
- **API**: `POST /pages|posts/:id/duplicate` (201)、`GET/POST /:id/share-links`、`DELETE /share-links/:id` (id は 64 文字 hex)。発行 URL は `SITE_URL || リクエスト origin` + `/preview/share/<token>`。
- **公開側**: `GET /preview/share/:token` を `/:kind/:id` より先に登録 (セッション不要)。`preview: true` 描画で noindex+nofollow+自 canonical、`x-robots-tag: noindex, nofollow` + `cache-control: no-store`。期限切れ・不明・対象がゴミ箱は 404。
- **purge 掃除**: ページ完全削除・投稿完全削除の batch に `shareLinks.deleteForTargetStatement` を追加 (ポリモーフィックなので FK cascade なし)。
- **管理画面**: 編集画面の `ContentForm` 下に `ShareLinks` セクション (発行→URL コピー・発行済み一覧・無効化)。ヘッダーに「複製」ボタン → 新規 id の編集画面へ遷移。

### ゴール

- ページ/投稿をワンクリックで複製できる。
- ログイン不要な下書きプレビュー URL を発行できる (WP 公開プレビュー相当)。

### 仕様

- **複製**: `POST /api/v1/pages/:id/duplicate`, `posts/:id/duplicate`。タイトル末尾「 (コピー)」、スラッグ `-copy` (衝突時 `-copy2`…)、status=draft、本文・sections・SEO・タクソノミを引き継ぐ。`published_at` は null。
- **共有リンク**: `share_links` テーブル (id=token の SHA-256, target_type `page|post`, target_id, created_by, expires_at, created_at)。`passkey_links` と同じ「平文は URL にのみ、DB はハッシュ」方式。
  - `POST /api/v1/pages|posts/:id/share-links` → `{ url }`。有効期限 7 日固定。
  - `GET /preview/share/:token` → 有効なリンクなら対象の下書きを `noindex, nofollow` + `no-store` で描画 (セッション不要)。対象が削除済みなら 404、期限切れも 404。
  - 管理: ContentForm に「共有リンクを発行」ボタン (発行→URL コピー)。一覧・失効 UI は最小限: 編集画面に発行済みリンクの一覧と「無効化」。
- 複製は `write`、共有リンク発行は `write`、公開閲覧は無認証。

### 完了条件

- 複製で下書きコピーが作られる。共有リンクでセッションなしに下書きが見え、無効化/期限切れで 404。

## T51. ピン留め + カスタム 404 + メンテナンスモード

状態: `done`

### 決定

- `posts.pinned` (migration `0011`)。公開一覧の並びは `postsListOrder()` = `pinned DESC, published_at DESC, id DESC` に集約し `publish-schedule.test.ts` で SQL を固定。管理一覧・サイトマップ・検索は従来どおり。
- リビジョンスナップショットに `pinned` を含める (`postFieldsSchema` 経由なので snapshot・復元も対象)。複製した投稿は pinned を引き継がない (下書き複製なので `false` 既定)。
- カスタム 404: `pages.findPublishedById` を追加し `notFound` で `settings.site().notFoundPageId` を解決。セクション構成ページは `prepareSections`+`SectionsBody`、リッチ本文は `prepareForms` 経由で描画 (フォーム/セクションを使った 404 も作れる)。見つからない・非公開・ゴミ箱は定型 404 にフォールバック。noindex/レイアウトは従来どおり。
- メンテナンス: `site` ルータ内のミドルウェアとして robots/sitemap GET 登録**後**・コンテンツ GET **前**に配置 (Hono は登録順にハンドラを並べ、レスポンス返却後のミドルウェアは実行されないため robots/sitemap/preview は自然にバイパス)。`/admin` `/api` `/media` は app レベルの先着ルートで site に届かない。GET/HEAD のみ対象 (フォーム POST は通す)、`getSessionUser` がユーザーを返せばバイパス。503 ページはアクティブテーマの Layout + noindex、`Retry-After` なし。
- 管理画面: 設定→サイトに「カスタム 404 ページ」セレクト (ページ一覧) と「メンテナンスモード」+ メッセージ欄。投稿フォームに「一覧の先頭に固定」チェック (new/$id 両方)。

### ゴール

- 一覧先頭固定 (WP sticky)、任意ページを 404 本文に使う、サイト全体を工事中表示にする (Shopify パスワードページ相当)。

### 仕様

- **ピン留め**: `posts.pinned` boolean。アーカイブ/ホーム一覧のソートを `pinned DESC, publishedAt DESC` に。管理の投稿フォームに「一覧で先頭に固定」チェック。サイトマップ・検索には影響しない。
- **カスタム 404**: `site.notFoundPageId` (nullable)。notFound ハンドラがそのページを取得し、公開中ならその body を使って 404 で描画 (レイアウト・noindex は従来どおり)。無ければ現行の定型 404。
- **メンテナンス**: `site.maintenance` boolean + `site.maintenanceMessage`。公開サイトの GET を全部 503 + 定型ページ (タイトル + メッセージ) に。**バイパス**: `/admin`、`/api`、`/media`、`/preview`、`/preview/share`、管理セッション Cookie を持つ GET (編集中の確認ができるよう)。`Retry-After` は出さない (復帰時期不明のため)。`robots.txt`・`sitemap.xml` は通常どおり返す。
- 管理画面: 設定 → サイトに「メンテナンスモード」+ メッセージ、「404 ページ」のページ選択。

### 完了条件

- ピン留め投稿が一覧先頭に来る。404 に選んだページ本文が出る。メンテナンス中は管理以外 503、管理者は見える。

---

## 後続候補 (このフェーズの範囲外)

- メニューの footer スロットをテーマ設定から差し替える UI。
- ゴミ箱の自動パージ (30 日)。
- 共有リンクの複数件管理・期限変更。
- ピン留めの複数件の手動順序。
