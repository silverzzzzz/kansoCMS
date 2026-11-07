# Phase 4 タスクボード — セクションエディタ (Shopify 風カスタマイズ)

目的: **運用者がコードを書かずに、管理画面からページの構成要素 (セクション) を追加・並べ替え・設定でき、プレビューを見ながら保存できる** 状態にする。Shopify のテーマエディタ (sections + settings schema + JSON テンプレート) のモデルを、kansoCMS の既存スタック (Hono SSR + hono/jsx テーマ + zod 型パイプライン) の上に再現する。Liquid などテンプレート言語の導入はしない (2026-11-07 ユーザー確認済み: 案A)。

運用ルール ([Phase 2](phase-2.md) / [Phase 3](phase-3.md) と同じ):

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T24 | データモデル: セクション設定の field DSL (`@kanso/shared`)、`pages.sections_json`、テーマ設定の settings キー | done | shared, core |
| T25 | セクションレジストリと公開側レンダリング: `Theme.sections`、初期セクション実装 (default / paper)、`renderPage` のセクション描画、draft プレビュー | done | server |
| T26 | 管理 API: セクションカタログ取得、pages API の sections 読み書き + 動的検証、テーマ設定 API | done | server |
| T27 | 管理画面「カスタマイズ」エディタ: セクション一覧 (追加/削除/並べ替え)、設定フォーム自動生成、iframe プレビュー、保存 | todo | admin |
| T28 | テーマ設定 (グローバル): ヘッダー/フッター等のテーマ単位設定を公開側に適用し、エディタから編集できる | todo | shared, server, admin |
| T29 | E2E + ドキュメント: カスタマイズの Playwright E2E、architecture.md / README 更新 | todo | tooling, docs |

## 全体設計 (このフェーズの前提)

Shopify の対応物とこのフェーズでの置き換え:

| Shopify | kansoCMS (このフェーズ) |
|---|---|
| section (Liquid + `{% schema %}`) | hono/jsx コンポーネント + `@kanso/shared` の field DSL で宣言した設定フィールド。テーマが `Theme.sections` に登録 |
| JSON テンプレート (ページのセクション構成) | `pages.sections_json` (ページ単位)。`home` ページがトップページなので、トップもこの仕組みで編集できる |
| theme editor | 管理画面の「カスタマイズ」画面 (左: セクションリスト、右: iframe プレビュー + 設定フォーム) |
| settings_schema.json (テーマ全体設定) | `settings` テーブルの新キー `theme` にテーマ名で名前空間を切った JSON (T28) |

方針:

- **既存の Tiptap 本文と共存する。** `sections_json` が null のページは従来どおり本文 (bodyHtml) を描画。非 null ならセクション列を描画し、本文は無視する。投稿 (posts) は対象外 (記事はエディタで書くもの)。
- **設定フォームは field DSL から自動生成。** フォームビルダー (`formFieldSchema`) と同じパターンで、セクションのフィールド定義 (text / textarea / select / checkbox / number / image / link など) を zod で宣言し、管理画面はカタログ API から受け取った定義でフォームを描画する。zod スキーマ自体はクライアントに送らない。
- **公開ページは引き続き「ただの HTML」。** セクションはサーバーで描画され、クライアント JS を持ち込まない。
- **テーマ作者の契約は `site/themes/` のまま。** セクションはテーマごとに実装 (共通部分は共有モジュール可)。未知のセクション type は描画スキップ (他テーマから切り替えた直後にページが 500 にならないこと)。

---

## T24. データモデル (field DSL / sections_json / テーマ設定キー)

状態: `done` (2026-11-07)

### ゴール

- セクション構成とその設定値を型安全に保存・検証できる土台が `@kanso/shared` と `@kanso/core` に入る。公開側・管理画面はまだ触らない。

### 現状 (調査済み)

- `pages` / `posts` は `_columns.ts` の共通カラム (`bodyJson` (Tiptap doc) / `bodyHtml`) を持つ。マイグレーションは `packages/core/migrations/0000`–`0004`。
- 設定は `settings` テーブルに key ごとの JSON 行 (`SETTINGS_KEYS = site / organization / forms / cache`、zod は `packages/shared/src/settings.ts`)。
- フォームビルダーの field DSL (`packages/shared/src/forms.ts` の `formFieldSchema`: discriminatedUnion + 上限 30 fields) が設定フォーム自動生成の先行事例。
- revisions は `snapshot_json` に保存前の行スナップショットを丸ごと持つ (pages の新カラムは自動的に含まれるかはサービス実装を確認して合わせる)。
- `search_index` は pages の INSERT/UPDATE/DELETE トリガで title / excerpt / body を同期している (`0004_search.sql`)。

### 仕様

**`packages/shared/src/sections.ts`** (新規)

- セクション設定の field DSL: `SECTION_FIELD_TYPES = ['text', 'textarea', 'url', 'select', 'checkbox', 'number', 'image', 'posts'] as const`。
  - 共通 shape: `name` (`FORM_FIELD_NAME_PATTERN` と同じ規則), `label`, `help?`, `default?`。
  - `text` / `textarea`: `maxLength`。`select`: `options[]`。`number`: `min` / `max` / `step`。`image`: 値は `mediaId: number | null`。`posts`: 値は `{ postTypeSlug: string | null, limit: number }` (投稿一覧セクション用)。
  - フィールド定義 (`sectionFieldSchema`) はカタログ API のレスポンス型。**値**の検証はフィールド定義から zod スキーマを組み立てる `sectionValuesSchemaFor(fields)` で行う (forms の `submissionSchemaFor` と同型)。
- ページのセクション構成: `pageSectionSchema = { id: string (ランダム、エディタでの key 用), type: string, settings: Record<string, unknown> }`、`pageSectionsSchema = array, max 30`。`settings` の中身検証は type を知る server 層で行う (shared はセクションカタログを知らない)。
- `SECTIONS_MAX = 30` などの上限定数。

**`packages/shared/src/settings.ts`**

- `SETTINGS_KEYS.theme = 'theme'` と `themeSettingsSchema` (テーマ名 → `Record<string, unknown>` の名前空間付き JSON。値の検証はテーマのフィールド定義を知る server 層)。T28 で使うが、キーとスキーマはここで定義しておく。

**`packages/core`**

- マイグレーション `0005_sections.sql`: `pages` に `sections_json TEXT` (null 可) を追加。
- drizzle スキーマ (`db/schema/pages.ts` または `_columns.ts` の pages 側) に `sectionsJson` を追加 (`mode: 'json'`、型は shared の `PageSection[]`)。
- `pages` サービス: create / update の入力 (`pageFieldsSchema`) に `sections: pageSectionsSchema.nullable()` を追加し、保存・取得で `sections_json` を読み書きする。revisions のスナップショットと復元に `sections_json` が含まれることをテストで確認する。
- `settings` サービス: `theme()` 取得 / 更新 (他キーと同じパターン)。
- 検索インデックス: `search_index` の body はトリガが `pages.search_text` を読む仕組みで、`search_text` はサービス層が組み立てている。sections 付きページでは **文字列フィールド (text / textarea) の値を描画順に連結したプレーンテキスト** を `search_text` に入れる。

### 完了条件

- 共通条件 (`pnpm typecheck && pnpm check && pnpm test && pnpm build`)。`pnpm db:migrate:local` が通る。sections 付きページの create / update / get / revisions 復元がユニットテストで通る。既存ページ (sections_json = null) の挙動が変わらない。

### 決定

- Codex が実装途中で使用上限により中断したため、途中成果 (スキーマ・サービス・マイグレーションの大半) を独立レビューのうえ Claude が引き継いで完成させた (2026-11-07)。
- field DSL ([packages/shared/src/sections.ts](../../packages/shared/src/sections.ts)): フィールド定義側でも `default` の整合を検証する (text/textarea は maxLength 以内、select は options に含まれる値か空、number は min/max/step を満たすこと)。number の「空値」は `min` があれば min、なければ 0 を step に丸めた値。
- `sectionValuesSchemaFor(fields)` は未知キーを strip (z.object の既定) し、欠損はフィールドの `default`、それも無ければ型ごとの空値 (text/textarea/url/select `''`、checkbox `false`、image `null`、posts `{ postTypeSlug: null, limit: 5 }`) に落とす。url 値は `''` または `redirectUrlSchema` (forms と共用)。
- `pageSectionSchema.id` は `[a-zA-Z0-9_-]{1,40}`、`type` は `FORM_FIELD_NAME_PATTERN`。`SECTIONS_MAX = 30`。
- `sectionsPlainText(sections)` は settings のトップレベル string 値を順に連結するだけ (カタログの型情報を使わないので url 文字列等も混ざる。全文検索用途では許容)。sections 非 null のページは `searchText = sectionsPlainText(...)`、null に戻すと本文由来に戻る。`search.reindex()` も同じ分岐。
- revisions: `pageRevisionSnapshotSchema = pageFieldsSchema.partial({ sections: true })` で旧スナップショット (sections キーなし) も parse が通る。restore は `snapshot.sections ?? null` を保存する。
- settings: `SETTINGS_KEYS.theme` + `themeSettingsSchema = record(テーマ名, record(string, unknown))`。フィールド単位の検証はテーマカタログを知る server 層の仕事 (T26/T28)。
- core に DB バックのテスト基盤が無い (サービスの DB テストは従来から無く、API テストは kanso をモック) ため、DB を使うサービステストは追加しない。shared のユニットテスト (`sections.test.ts`) と dev サーバーでのスモークで担保した。Codex が生成した存在しない `testing/database.ts` 参照のテストは削除。
- 既知の残課題 (T26 で対応): pages API のレスポンスが drizzle カラム名 `sectionsJson` のまま露出している。T26 で `sections` に整形し、カタログに対する type / settings 検証を入れる。
- スモーク (`:5199`): sections 付きページの作成 → 取得ラウンドトリップ、text 値が `/api/v1/search` と `/search` にヒット、revision 復元で旧 sections が戻る、`sections: null` で検索から消える (ナビのリンクは別物)、を確認。スモークページは削除済み。

---

## T25. セクションレジストリと公開側レンダリング + draft プレビュー

状態: `done` (2026-11-07)

### ゴール

- テーマがセクションを宣言し、`sections_json` を持つページがセクション列として SSR される。管理画面エディタ用に、保存前の draft をセッション認証付きで HTML 化するプレビューエンドポイントが生える。

### 現状 (調査済み)

- `Theme` 契約は `site/themes/types.ts` (`Layout` / `PostList` / `PostArticle`)。`renderPage` (`site/render.tsx`) は `prepareForms(c, page.bodyHtml, …)` → `<article class="page">{raw(html)}</article>`。
- `/preview/:kind/:id` (`site/preview.tsx`) はセッション認証で保存済みコンテンツを `renderPage/renderPost({ preview: true })` する。`no-store` + `noindex`。
- 公開 CSS はテーマ別の素の CSS (`apps/server/public/themes/*.css`)、テーマ作者にビルド依存を持ち込まない約束。

### 仕様

- `Theme` に `sections: Record<string, SectionDefinition>` を追加。`SectionDefinition = { label: string, description?: string, fields: SectionField[] (shared の DSL), Component: FC<{ values: <検証済み値>, ctx固有props }> }`。コンポーネントに渡すのは派生値だけの約束を維持する (formatDate など必要な slice のみ)。
- 初期セクション (default / paper 両対応。見た目はテーマ CSS に従う):
  - `hero` (見出し / サブテキスト / 画像 / リンクボタン)
  - `richtext` (textarea の内容を段落描画。**フォーム埋め込みは v1 スコープ外** とし、フォームは従来どおり Tiptap 本文ページで使う — richtext セクションは HTML を受け付けずプレーンテキスト+改行)
  - `post-list` (投稿タイプを選んで最新 N 件。既存 `PostList` の部品を流用)
  - `image-with-text` (画像 + 見出し + 本文、左右入れ替え)
  - `cta` (見出し + ボタン)
- `renderPage`: `page.sectionsJson` が非 null なら本文の代わりにセクション列を描画。各セクションの settings は `sectionValuesSchemaFor(definition.fields)` で safeParse し、失敗・未知 type は **そのセクションだけスキップ** (ログは console.warn 程度)。`post-list` セクションのデータ取得はレンダリング前にまとめて行う (コンポーネント内で await しない)。
- draft プレビュー: `POST /preview/draft/page` (セッション認証、body = `{ pageId?, title, sections }` を zod 検証) が保存せずにセクションページの完全な HTML を返す。既存 `/preview` と同じ `no-store` / `noindex` / preview メタ。CSRF は既存の管理 API と同じ扱い (セッション cookie + 既存のミドルウェア構成を踏襲)。
- CSS: 初期セクションのスタイルを `base.css` + 各テーマ CSS に追加 (クラスは `.section-hero` など接頭辞 `section-`)。

### 完了条件

- 共通条件。sections 付きページがユニットテスト (レンダリング結果の HTML アサーション) で確認でき、スモークで default / paper 両テーマのセクションページが表示される。未知 type を含むページが 500 にならない。

### 決定

- Codex が使用上限で利用不可のため T25 は Claude が直接実装した (2026-11-07)。
- `Theme.sections: Record<string, SectionDefinition>` を追加 ([themes/types.ts](../../apps/server/src/site/themes/types.ts))。`SectionDefinition = { label, description?, fields, Component }`、`SectionProps = { values, data, formatDate }`。image / posts フィールドの値はレンダリング前に `data: { images, posts }` (フィールド名キー) へ解決し、コンポーネント内では await しない。
- 初期 5 セクション ([themes/sections.tsx](../../apps/server/src/site/themes/sections.tsx)) は両テーマ共通の `standardSections`: `hero` / `richtext` / `post_list` / `image_with_text` / `cta`。type 名は field DSL と同じ `[a-z][a-z0-9_]*`。見出しレベルは hero が h1、他は h2 固定 (複数 hero を置けば h1 が複数になるのは v1 では許容)。
- `richtext` セクションはプレーンテキストのみ (空行で段落、単一改行は `<br>`)。HTML・フォーム埋め込みは不可 (フォームは従来の Tiptap 本文ページで)。
- 検証と解決は [site/sections.tsx](../../apps/server/src/site/sections.tsx) の `prepareSections(kanso, theme, sections)`: 未知 type と `sectionValuesSchemaFor` の検証失敗は console.warn してスキップ (ページは 500 にならない)。`posts` フィールドは `postTypes.findBySlug` → `posts.listPublished` (page 1, perPage = limit)、`image` は `media.find` (欠損は null)。
- `renderPage` は `page.sectionsJson` 非 null のとき `prepareForms` を通さず `<SectionsBody>` (`.page-sections`) を描画。ページ title の自動 h1 は出さない (見出しは hero 等のセクションが担う)。meta / JSON-LD / OG は従来どおり。
- draft プレビューは `POST /preview/draft/page` (セッション認証のみ、body = `{ title?, sections }`)。保存せずに完全な HTML を返し、`no-store` + `noindex`。CSRF は既存 `authenticate` の sec-fetch-site / Origin 検査に乗る。
- セクションの CSS は `base.css` に `.section-*` / `.page-sections` を追加 (テーマの CSS 変数を参照するので両テーマで配色が追従)。
- サーバーの vitest include は `*.test.ts` のみなので、テストは JSX を使わない [sections.test.ts](../../apps/server/src/site/sections.test.ts) (prepareSections 単体 + site ルーター経由の HTML アサーション 4 件)。
- スモーク (`:5199`): hero (日本語・段落分割・ボタン) / post_list (投稿作成して項目描画・アーカイブへのリンク) / cta / 未知 type スキップを公開ページで確認。paper テーマでも描画を確認。draft プレビューは認証時 200 (noindex / no-store)、未認証 401。スモークのページ・投稿・投稿タイプは削除済み。

---

## T26. 管理 API (セクションカタログ / pages の sections / テーマ設定)

状態: `done` (2026-11-07)

### ゴール

- 管理画面がセクションカタログを取得し、pages API 経由で sections を検証付きで保存できる。

### 現状 (調査済み)

- 管理 API は `apps/server/src/api/*` (zValidator + `hc` クライアントを admin が利用)。pages API は `createPageSchema` / `updatePageSchema` を使う。
- 設定 API は `api/settings.ts` (キーごとの GET/PUT)。

### 仕様

- `GET /api/v1/site/sections` (セッション/API キー認証、管理スコープ): 現在のテーマの `{ type, label, description, fields }[]` を返す。テーマ名クエリ `?theme=` で他テーマのカタログも取れる (エディタのテーマ切替プレビュー用。無効なテーマ名は 404)。
- pages API: create / update が `sections` を受けたら、現在のテーマのカタログで各セクションの `type` と `settings` を検証してから保存する (未知 type は 422)。`GET` 系のレスポンスに `sections` を含める。
- テーマ設定 (T28 の先行): `GET/PUT /api/v1/settings/theme` を他キーと同じパターンで追加 (PUT の検証はテーマのフィールド定義で行う)。
- キャッシュ世代: pages / settings の書き込みは既存の仕組みで世代が回ることを確認 (追加実装は不要のはず。テストで担保)。

### 完了条件

- 共通条件。カタログ取得・sections 付きページの作成/更新/取得・不正 settings の 400 が API テストで通る。

### 決定

- Claude が直接実装 (Codex 利用不可のため、2026-11-07)。
- バリデーションエラーの HTTP ステータスはこのリポジトリの規約どおり **400** (`KansoError.validation` → 400。仕様に書いた 422 は誤りだったので修正)。
- カタログの正本は [themes/sections-meta.ts](../../apps/server/src/site/themes/sections-meta.ts) に分離した: `SectionMeta { label, description?, fields }`、`standardSectionsMeta`、`sectionsMetaByTheme`、`invalidSectionDetails(catalog, sections)`。**API 層 (hc 経由で admin の TS プログラムに入る) から JSX を import すると admin の typecheck が react/jsx-runtime で壊れる** ため、コンポーネントを含む `Theme.sections` (themes/sections.tsx が meta を spread して構築) とデータだけの meta を分けている。今後も api/ 配下から .tsx を import しないこと。
- `GET /api/v1/site/sections` ([api/site.ts](../../apps/server/src/api/site.ts)、認証必須): `{ theme, items: [{ type, label, description, fields }] }`。`?theme=` で他テーマ、未知のテーマ名は 404。
- pages API: create / PATCH の `sections` は有効テーマのカタログで検証し、エラーは `details[].path = sections.<idx>.type | sections.<idx>.settings.<field>` の 400。レスポンスは `toPageItem` で `sectionsJson` → `sections` に整形 (create / get / patch / restore。一覧はもともと列を返さない)。settings の値は送られたまま保存 (default の正規化は描画側 / エディタ側で行う)。
- `GET/PUT /api/v1/settings/theme` を他の settings キーと同じパターンで追加 (admin ロール)。PUT は現状 `themeSettingsSchema` (record) の形だけ検証し、フィールド単位の検証は `Theme.settingsFields` が入る T28 で締める。
- キャッシュ世代は既存の `bumpSiteCacheVersion` (protectedApi の書き込み全部に適用) に乗るので追加実装なし。
- テスト: [api/site.test.ts](../../apps/server/src/api/site.test.ts) (カタログ・`?theme=`・404)、[api/pages.test.ts](../../apps/server/src/api/pages.test.ts) に sections の保存/整形と 400 詳細のケースを追加。
- スモーク (`:5199`): カタログ取得 (5 種)、未知テーマ 404、未認証 401、不正 type の create が 400 + details、正常 create のレスポンスが `sections` のみ (`sectionsJson` 非露出)、`PUT/GET /settings/theme` ラウンドトリップ。スモークデータは削除・リセット済み。

---

## T27. 管理画面「カスタマイズ」エディタ

状態: `todo`

### ゴール

- 管理画面に Shopify のテーマエディタ風の「カスタマイズ」画面が入り、運用者がページのセクションを追加・削除・並べ替え・設定変更し、プレビューを見て保存できる。

### 現状 (調査済み)

- 管理画面は React + TanStack Router (`apps/admin/src/routes/_auth/*`) + Tailwind v4。API は `hc` クライアント。ページ編集は `_auth/pages/$id.tsx`。
- プレビューは従来、保存済みコンテンツを `/preview/:kind/:id` で別タブ表示。

### 仕様

- ルート `/_auth/customize` (サイドバーに「カスタマイズ」): ページ選択 (既定は `home`、なければ作成を促す) → エディタ。
- レイアウト: 左ペインにセクションリスト (追加ボタン → カタログからの選択、ドラッグ or 上下ボタンで並べ替え、削除)、中央に iframe プレビュー、左ペインでセクションを選ぶと設定フォーム (field DSL から自動生成。image フィールドは既存メディアライブラリのピッカーを流用)。
- プレビュー: 編集状態 (draft) を debounce して `POST /preview/draft/page` に送り、返った HTML を iframe の `srcdoc` に流し込む (`<base href>` を注入して相対 URL を解決)。
- 保存: pages API の update で `sections` を保存。未保存変更がある状態での離脱はブラウザ確認ダイアログ。
- ページ編集画面 (`pages/$id`) には「このページはカスタマイズ (セクション) で管理されています」の表示と、エディタへのリンク + 「セクションをやめて本文に戻す」(sections を null に) を追加。本文⇄セクションの排他をわかりやすくする。
- 管理画面の文言は既存の流儀に合わせる (Phase 3 の管理画面 i18n は未着手なので、既存画面と同じ言語運用)。

### 完了条件

- 共通条件。ブラウザスモーク: home ページに hero + post-list + cta を並べ、プレビューで確認して保存 → 公開トップに即反映 (キャッシュ世代)。並べ替え・削除・設定変更・本文ページへの復帰が動く。

### 決定

- (実装時に追記)

---

## T28. テーマ設定 (グローバル設定の公開側適用と編集 UI)

状態: `todo`

### ゴール

- Shopify の theme settings に相当する「テーマ全体の設定」(例: アクセントカラー、フッターテキスト、SNS リンク、ヘッダーのナビに検索を出すか) を管理画面から変更でき、公開側の全ページに反映される。

### 仕様

- `Theme` に `settingsFields: SectionField[]` (DSL 再利用) と、`Layout` へ渡す検証済み `themeSettings` を追加。`loadSiteContext()` が `settings.theme()` から現在テーマの名前空間を safeParse し、失敗や未設定は各フィールドの `default` に落とす。
- default / paper それぞれに最低限の設定 (アクセントカラー (CSS 変数に注入)、フッターの追記テキスト、SNS リンク最大 5 件) を実装。色は `<style>` での CSS 変数上書き 1 箇所のみ (インライン style の乱用はしない)。
- 管理画面: 「カスタマイズ」画面に「テーマ設定」タブ (または左ペインの切替) を追加し、`PUT /api/v1/settings/theme` で保存。draft プレビューにもテーマ設定の draft を反映できるよう `POST /preview/draft/page` の body に `themeSettings?` を足す。
- テーマを切り替えても他テーマの設定値は消えない (名前空間ごと保存)。

### 完了条件

- 共通条件。スモーク: アクセントカラーとフッターテキストを変えて保存 → 公開側全ページに反映。テーマを paper に切り替え → default に戻しても設定値が残る。

### 決定

- (実装時に追記)

---

## T29. E2E + ドキュメント

状態: `todo`

### ゴール

- カスタマイズの主要フローが Playwright E2E で守られ、ドキュメントが新アーキテクチャを説明している。

### 仕様

- E2E (`e2e/`、`e2e-` 接頭辞 + 後始末の既存流儀): ログイン → カスタマイズでテストページにセクション追加・設定・並べ替え → 保存 → 公開ページで HTML を検証 → セクション解除。
- `docs/architecture.md`: §スコープ (「ビジュアルインライン編集」のスコープ外表記を見直し)、データモデル (`pages.sections_json`、settings `theme`)、§6 レンダリング (セクション描画・draft プレビュー)、ロードマップに Phase 4 を追記。
- `README.md`: 機能リストに「セクションエディタ (管理画面からページ構成を編集)」を追記、Status 更新。
- `docs/tasks/phase-4.md` の決定を清書。

### 完了条件

- 共通条件 + `pnpm e2e` ローカル green。CI も green。

### 決定

- (実装時に追記)
