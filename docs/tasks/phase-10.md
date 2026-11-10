# Phase 10 タスクボード — 構造化と分析 (競合機能の取り込み B 群)

目的: **競合調査 B 群の「中規模・独自性が出る」機能を入れる。** STUDIO の組み込みアナリティクス、Shopify の metafields、WP のブロックパターン/著者ページ、そして Cloudflare ネイティブな AI アシストまでを見据える。Phase 9 (編集体験) 完了を前提にする。

運用ルールは [phase-9.md](phase-9.md) と同じ。

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T52 | 軽量アクセス解析 | done | core, server, admin |
| T53 | カスタムフィールド (投稿タイプ別) | done | shared, core, server, admin |
| T54 | ページテンプレート | done | server, admin |
| T55 | AI アシスト (Workers AI) | done | server, admin |
| T56 | 著者アーカイブ・プロフィール・関連記事・目次 | done | shared, core, server, admin |
| T57 | エクスポート/インポート | done | shared, core, server, admin |
| T58 | アクティビティログ | done | shared, core, server, admin |

Phase 10 の決定事項 (レビューで確定済み):

1. **解析は外部サービスを使わず D1 集計**にする。Analytics Engine は読み出しに Cloudflare API 呼び出しが要りセルフホスト運用と相性が悪いため。Cookie・クライアント JS 不使用 (STUDIO Analytics と同じ思想)。
2. **カスタムフィールドは `sectionFieldSchema` を再利用**する。field DSL を新設しない。

---

## T52. 軽量アクセス解析

状態: `done`

### 決定

- `pageview_daily` (PK `(day, path)`、migration `0012`)。計測は `site` ルータ内ミドルウェア (siteCache 直後): **ハンドラ実行後**に `status===200 && content-type: text/html && GET` のみ記録するため、404/503/フィード/プレビューは自然に除外。パス側の除外は `/search`・`/preview`・`*.xml`・`robots.txt`、UA 側は `BOT_UA_PATTERN` (core export)。
- 書き込みは `executionCtx.waitUntil` で遅延。`c.executionCtx` getter は非 Workers 環境で throw するため try/catch で包み、テスト/非 CF 環境では detached で実行 (書き込み失敗は `.catch(() => {})` で握り、レスポンスを壊さない)。タイムゾーンは waitUntil 内で `settings.site()` を読んで `analyticsDayKey()` (Intl `en-CA`) に渡す。
- API `GET /api/v1/analytics/summary?days=` (1–365、既定 30、read スコープ)。管理画面 `/analytics`: SVG 棒グラフ (`<title>` でツールチップ) + 上位 20 パスの表、サイドバー先頭近くに配置。

### ゴール

- 外部解析なしで PV と人気ページが管理画面で見える。

### 仕様

- **DB**: `pageview_daily` (day TEXT `YYYY-MM-DD`, path TEXT, count INTEGER, PK(day, path))。
- **計測**: 公開サイトの GET で 200 の HTML 応答を `ctx.executionCtx.waitUntil` で `INSERT ... ON CONFLICT DO UPDATE count = count + 1`。除外: `/admin`, `/api`, `/media`, `/preview`, `/search`, `*.xml`, `robots.txt`, フォーム POST、ステータス非 200、UA が bot っぽい (簡易リスト)。
- **管理画面**: `/analytics` ページ。直近 30 日の日別 PV バーチャート (SVG 手書き、ライブラリなし) + 期間内のページ別 PV 上位 20 件。
- **API**: `GET /api/v1/analytics/summary?days=30` → `{ daily: [{day,count}], top: [{path,count}] }` (read スコープ)。
- 日は `settings.timezone` で区切る。

### 完了条件

- ページ閲覧で日別集計が増える。管理画面にチャートとランキングが出る。

## T53. カスタムフィールド

状態: `done`

### 決定

- `post_types.fields_json` (= `sectionFieldListSchema` 検証済み定義) / `posts.fields_json` (= `sectionValuesSchemaFor` 検証済み値)、migration `0013`。定義は投稿タイプ API の `fields`、値は投稿 API の `fields` で受け付ける。
- 値の検証は core の `parsePostFields()`: **定義済みキーだけ** `sectionValuesSchemaFor` に掛けて defaults 適用・失敗は 400 (`Invalid custom fields`)、**定義に無いキーは素通し** (定義削除/改名で値を壊さない)。公開側 `preparePostFields` でも safeParse し、失敗時は保存値をそのまま描画に使う (テーマ変更でページが死なない設計と同じ)。
- `image` 型は `media.find` で `{url, alt}`、`posts` 型は `postTypes.findBySlug` + `posts.listPublished` で公開投稿リンクに解決 — セクションの `resolveData` をフィールド配列受け取りに一般化して共用。テーマには `PostArticleProps.fields: PostFieldItem[]` で渡し、default/paper 共通の `PostArticle` が本文下に `<dl class="post-fields">` を出す (空値・checkbox=false は非表示)。
- 管理画面: 投稿タイプフォームに `PostFieldsEditor` (追加・上下並び替え・型 select・name/label/説明・型別オプション編集)。投稿フォームは `SectionSettingsForm` をそのまま再利用 (`fields` state は `defaultSettings(defs) + 保存値` で初期化)。値は revision スナップショットにも含まれ、複製でも引き継がれる。

### ゴール

- 投稿タイプごとに任意項目 (価格・開催日・リンク…) を定義し、投稿が持てる (Shopify metafields / STUDIO CMS プロパティ相当)。

### 仕様

- **DB**: `post_types.fields_json` (フィールド定義 = `sectionFieldListSchema`)、`posts.fields_json` (値 = `sectionValuesSchemaFor(定義)`)。
- **検証**: 投稿の create/update で `fieldsJson` をタイプの定義で `safeParse`、失敗は 400。
- **管理画面**: 投稿タイプフォームにフィールド定義エディタ (追加・並び替え・型選択・必須/説明)。ContentForm (投稿) は定義に従って項目を描画 — セクション用 `FieldInput` コンポーネントを再利用。
- **公開側**: 投稿レンダリングで `fields` をテーマに渡す。default / paper テーマは「定義に応じた `<dl>` 一覧」を本文下に出す (image 型は `<img>`、url 型はリンク)。テーマ側で自前描画したい場合のため `post.fields` はそのまま公開 API にも出る。
- 定義の削除/改名は既存の値を壊さない (値側は定義に無いキーを保持、表示は定義駆動)。

### 完了条件

- フィールド定義→投稿フォームに項目が出て保存され、公開ページに値が出る。定義なし投稿タイプは従来どおり。

## T54. ページテンプレート

状態: `done`

### 決定

- レジストリは `sections-meta.ts` の `pageTemplatesByTheme` (`PageTemplate[]`: `{id, name, description, sections: {type, settings}[]}` — `id` はクライアント側で `crypto.randomUUID()` を割るので設定に含めない)。4 種: ランディング・サービス一覧・会社概要・問い合わせ誘導。カタログ `items` からは外し、`GET /api/v1/site/sections` の `templates` として同梱 (theme 切替にも追従)。
- `/pages/new` は先頭に「テンプレート」select。「リッチテキスト（セクションなし）」が従来動作 (sections=null)。選択時に `sections` state を生成し create POST に載せる。セクション内容の編集は従来どおりカスタマイズ画面 (新規フォームでは構成のラベル一覧だけをヒント表示)。

### ゴール

- 新規ページ作成時にセクション構成済みの雛形を選べる (WP ブロックパターン / STUDIO テンプレート相当)。

### 仕様

- テンプレートは **コード内レジストリ** (`packages/shared` または admin 側定数): `{ id, name, description, sectionsJson }[]` で 3〜5 種 (ヒーロー+本文、料金/サービス一覧、お問い合わせ誘導、会社概要、空)。テーマのセクション ID に依存するため、登録はテーマごとの提供とし `theme.pageTemplates` に載せる。
- `/pages/new` はテンプレート選択を先に表示し、選択内容で `sectionsJson` プリセット状態の ContentForm を開く (create POST にそのまま載る)。
- sections を持たない投稿は対象外。

### 完了条件

- 新規ページでテンプレートを選ぶとセクション入りの下書きが作れる。

## T55. AI アシスト

状態: `done`

### ゴール

- 抜粋・SEO 説明文・メディア alt を Workers AI で下書き生成できる (Wix AI SEO 相当)。

### 仕様

- **binding**: `wrangler.jsonc` に `ai` binding (名称 `AI`) を追加。**未設定環境でも起動できるよう、コードは `env.AI` の有無をチェック**し、無ければ 503 `AI is not configured`。
- **API**: `POST /api/v1/ai/suggest` (write スコープ) `{ kind: 'excerpt'|'description'|'alt', text, locale? }` → `{ text }`。モデルは `@cf/meta/llama-3.1-8b-instruct` 系。プロンプトはサーバ側固定 (日本語/英語を locale から)。
- **管理画面**: ContentForm の抜粋・説明文欄、MediaField の alt 欄に「AI で生成」ボタン。本文 text → excerpt/description、ファイル名+コンテキスト → alt。
- 生成失敗時はフォーム値を壊さない。

### 完了条件

- binding ありで候補テキストが返る。binding なしで 503。モック binding でテスト。

## T56. 著者アーカイブ・プロフィール・関連記事・目次

状態: `done`

### 決定

- `users.slug`/`bio`/`avatar_media_id` は migration `0014` — バックフィルは SQLite の `REPLACE`/`LOWER` ベースの簡易 slugify (重複は `ROW_NUMBER()` で `-2` 連番) + unique index。`PublicUser` に `slug` を追加したため既存テストの principal フィクスチャも全て更新。
- プロフィール API は session 限定 `GET|PATCH /api/v1/auth/profile` (API キーは 403)。slug 重複は 409、bio は trim→空 null、avatar は `assertMediaExists`。
- 著者アーカイブは `/{type}/author/{slug}` で `renderAuthorArchive` — `auth.findAuthorBySlug` + `listPublished(authorId)`、noindex は投稿タイプ継承、見出しは i18n `authorHeading(name, typeName)`。byline は `post.authorSlug` があればリンク化。
- 関連記事は `posts.listRelated` — カテゴリ一致を優先、カテゴリ無しならタグ一致、`postsPublishedNow`・自分除外・公開日降順・上限 4。
- 目次は shared `extractToc`/`injectHeadingIds` — 本文 HTML の h2/h3 に `h-N` (出現順) を付与し `bodyJson` 側と番号を揃える。空見出しは TOC からは外すが番号は消費して整合。2 件未満は `<nav class="toc">` を出さない。

### ゴール

- WP の著者ページ相当 + 記事下の回遊導線。

### 仕様

- **users**: `slug` (uniq)、`bio` (nullable)、`avatar_media_id` (nullable) を追加。既存ユーザーは `slug` を name から slugify + 重複時 `-2` 連番でマイグレーション。アカウント画面で bio / avatar / slug を編集可 (slug は自分のみ)。
- **公開**: `/{type}/author/{slug}` アーカイブ (著者名+ bio + 公開投稿一覧、ページネーションあり)。記事 byline の著者名をリンク化。sitemap に著者アーカイブを収録 (公開・index 可能投稿を持つ著者のみ)。
- **関連記事**: 同一タイプ・同一カテゴリの公開済み投稿を最大 4 件 (自分を除く、公開日降順)。default テーマの投稿テンプレで「関連記事」として出す (カテゴリ無しタイプはタグ、それも無ければ非表示)。
- **目次**: `bodyJson` から h2/h3 を抽出して投稿テンプレ上部に `<nav class="toc">` (見出しに `id` 自動付与 — レンダリング側で slug を振る。既に renderer が見出し id を付けていなければ renderer 側も合わせて実装)。見出し 2 件未満なら非表示。

### 完了条件

- 著者アーカイブが公開・sitemap 収録される。記事下に関連記事、上部に目次が出る。

## T57. エクスポート/インポート

状態: `done`

### 決定

- バンドル形式は shared `exportBundleSchema` (`version: 1` 固定)。参照は id を持たず `postType`/`parent`/`author` は slug、`coverMedia`/`ogMedia`/`media[].key` は R2 キー、ページは `path` (slug と親は path から導出、`sortByPathDepth` で親→子順)。
- メディア行は **インポート時に作らない** (実体が無い行は壊れた画像になる)。参照は転送先の既存行を r2Key で引き、無ければ null + warning。
- settings は `?settings=1` のみ。site/organization の `*MediaId` と `notFoundPageId` は `{$ref: media|page, …}` に変換して持ち運び、インポート時に再解決。キーごとに既知スキーマで検証してから upsert (不明キーは警告+スキップ)。theme 設定内のメディア参照は対象外。
- インポートは各サービスの create/update を再利用 (fields 検証・リビジョン・パス再計算をそのまま踏む)。更新前に `stableStringify` 比較で無変更なら `skipped` (2 回目実行は created/updated が 0 になる)。カテゴリは 2 パス (行→親)、エラーは項目ごと `skipped`+warning で継続。
- `GET /export` は GET だが write スコープ必須 (全件流出のため)。`Content-Disposition: attachment` で `kanso-export-YYYY-MM-DD.json`。`POST /import` は `{created, updated, skipped, warnings[]}` を返す。管理画面は `/tools` (サイドバー末尾)。

### ゴール

- コンテンツ一式を JSON で出し入れできる (WP WXR 相当、データ所有の担保)。

### 仕様

- `GET /api/v1/export` (write スコープ): `{ version: 1, exportedAt, postTypes[], categories[], tags[], pages[], posts[], media[](メタのみ、R2 実体は対象外), redirects[], menus[] }`。settings は既定で含めない (`?settings=1` で追加)。
- `POST /api/v1/import` (write): 上記 JSON を受け、**slug ベースで upsert** (存在すれば更新、無ければ作成)。ID 参照は「エクスポート内の slug」で解決して再マップ (post_type_id, category/tag, parent page path, cover_media_id/og_media_id → slug/key 参照、メディア実体が無ければ null + warnings)。
- レポート応答: `{ created, updated, skipped, warnings[] }`。
- 管理画面: `/tools` にエクスポート (JSON ダウンロード) とインポート (ファイル選択→結果表示)。
- インポートは冪等 (2 回実行で差分なし)。

### 完了条件

- エクスポート→別環境へインポートでコンテンツが復元される。2 回目実行で差分が出ない。

## T58. アクティビティログ

状態: `done`

### 決定

- `activity_log` (migration `0015`): `actor` (表示用文字列: ユーザー名・`api-key:<name>`・`system`・`anonymous`)、`user_id` (session のみ、ユーザー削除で set null)、`action`、`target_type`、`target_id` (id/slug をテキスト化、一括操作は null)、`summary` (日本語の人間向け文)、`created_at`。
- 記録は `apps/server/src/api/activity.ts` の `logActivity()` で API ハンドラから呼ぶ。コアのサービス層には入れない (principal を知るのは API 層のため)。失敗しても本処理は壊さない (catch して握り潰す)。actor は principal から導出、認証イベントだけ明示指定 (ログイン成功=ユーザー、失敗=anonymous)。
- 保持: 挿入のたびに「新しい順 2,000 件目の id」(`ACTIVITY_LOG_MAX_ROWS`) より古い行を削除 (1 クエリ + delete)。
- `GET /api/v1/activity?limit=N` (read スコープ、上限 200・既定 100)。管理画面 `/activity` は最新 100 件テーブル、ナビゲーション先頭付近に配置 (editor も read 可)。

### ゴール

- 誰がいつ何を変更したか遡れる (STUDIO アクティビティログ相当)。

### 仕様

- **DB**: `activity_log` (id, actor (表示用文字列), user_id nullable, action, target_type, target_id, summary, created_at)。
- **記録**: API の変更系ハンドラで `logActivity()` 呼び出し — pages/posts/post_types/taxonomies/media/forms/menus/settings/redirects の create/update/delete/restore、starter 投入・削除、ユーザー・API キー・メニュー。読み取り系は記録しない。認証 (ログイン成功/失敗、パスキー追加/削除) も記録する。
- **保持**: 挿入時に 2,000 件を超える最古を削除 (上限を定数化)。
- **管理画面**: `/activity` に最新 100 件を表形式 (日時・操作者・対象・内容)。`GET /api/v1/activity?limit=100` (read スコープ)。

### 完了条件

- 管理操作が記録・一覧できる。2,000 件を超えると古い順に切られる。

---

## 後続候補 (このフェーズの範囲外)

- 多言語コンテンツ + hreflang。
- コンテンツのパスワード保護 / メンバー限定領域。
- コメント (外部 Giscus/Disqus 埋込を推奨)。
- 同時編集 (Durable Objects + CRDT) と編集中ロック。
- カスタムフィールドの `posts` 型を使った参照コンテンツ。
- WP WXR インポータ。
