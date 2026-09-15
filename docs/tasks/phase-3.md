# Phase 3 タスクボード — 仕上げ (i18n / キャッシュ / E2E)

目的: Phase 1–2 で先送りにした運用面の課題を順に解消する。**公開サイトの文言をサイトのロケールに追従させ、更新が即時に公開に反映され、管理画面の主要操作がブラウザ E2E で守られている** 状態にする。

運用ルール ([Phase 2](phase-2.md) と同じ):

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T14 | テーマ i18n: 公開側の固定文言と送信検証メッセージをサイトの `locale` に追従させる (ja / en) | done | shared, core, server, admin |
| T15 | 公開キャッシュの即時無効化: 管理 API の書き込みで公開 HTML/フィードのキャッシュを purge する | done | core, server |
| T16 | 管理画面のブラウザ E2E テスト (Playwright): ログイン → ページ作成 (フォーム埋め込み) → 公開 → 送信 → 送信一覧 | todo | admin, server, tooling |

Phase 3 の決定事項 (ユーザー確認済み):

1. 上記 3 件を **T14 → T15 → T16 の順** に進める (2026-09-16)。

---

## T14. テーマ i18n (公開側文言のロケール追従)

状態: `done` (2026-09-16)

### ゴール

- 公開サイト (テーマ・404・プレースホルダのホーム・埋め込みフォーム) と送信検証のメッセージが、サイト設定 `locale` に応じて **日本語 / 英語** で表示される。対応外のロケールは英語にフォールバックする。
- コンテンツ自体の多言語化 (記事の翻訳) はスコープ外 ([architecture.md §1](../architecture.md))。

### 現状 (調査済み)

- ロケールは `siteSettingsSchema.locale` (自由文字列, 既定 `ja`) で、`<html lang>` / `og:locale` / JSON-LD `inLanguage` / `formatDate` にはすでに使われている。文言のカタログや `t()` はどこにも無い。
- 固定の英語文言: `routes.tsx` (404 の `Not Found` / `Page not found.`、ホームのプレースホルダ `kansoCMS is running. Create a page with the path <code>home</code> to replace this.`)、`site/forms.tsx` (`Send`、`— Select —`、`Leave this field empty`、既定成功文 `Thank you. Your message has been sent.`、フォーム全体エラーの既定 `Invalid submission`)、`post-list.tsx` のページ送り `←` / `→` (アクセシブル名なし)。
- 送信検証メッセージは `packages/shared/src/forms.ts` の `submissionSchemaFor(fields)` (`This field is required` / `Use at most N characters` / `Invalid email address` / `Invalid telephone number` / `Select a valid option`) と `apps/server/src/forms/submit.ts` / `turnstile.ts` (`Turnstile is not configured` / `Turnstile verification failed`)。公開 JSON API (`POST /api/v1/public/forms/:slug/submissions`) も同じ `submitForm()` を通る。
- テーマ部品 (`Layout` / `PostList` / `PostArticle`) には `ctx` を渡さず、`meta` / `nav` / `formatDate` など派生値だけを渡す約束 (architecture.md §6)。

### 仕様

**`apps/server/src/i18n.ts`** (新規)

- `SiteMessages` 型と `en` / `ja` の 2 カタログ、`resolveMessages(locale: string): SiteMessages`。ロケールは `Intl.getCanonicalLocales` で正規化した主言語サブタグで判定し (`ja`, `ja-JP` → ja)、それ以外と不正値は `en`。
- 文言は関数ではなくプロパティ (TypeScript でキー漏れを検出)。補間が要るものだけ関数 (`validation.maxLength(n)`, `archive.categoryHeading(term, type)`, `archive.tagHeading(term, type)`)。
- キー (最低限): `notFound.title` / `notFound.body`、`home.running` / `home.hintBefore` / `home.hintAfter` (間に `<code>home</code>` が入る)、`archive.categoryHeading` / `archive.tagHeading`、`pagination.newer` / `pagination.older` (ページ送りリンクの `aria-label`。矢印の表示はそのまま)、`form.submit` / `form.selectPlaceholder` / `form.honeypotLabel` / `form.successDefault` / `form.genericError` / `form.turnstileFailed` / `form.turnstileUnconfigured`、`validation.required` / `validation.maxLength(n)` / `validation.email` / `validation.tel` / `validation.select`。
- `SiteRequestContext` に `messages: SiteMessages` を追加し (`loadSiteContext` で `settings.locale` から解決)、テーマ部品には `formatDate` と同様に **必要な部分だけ prop で渡す** (`PostList` に `messages.pagination`、`KansoForm` に `messages.form`)。`Layout` には現状渡す文言が無い (フッターの `©` は共通)。

**送信検証** (`packages/shared` / `packages/core` / `apps/server/src/forms`)

- `packages/shared/src/forms.ts`: `SubmissionMessages` 型 (`required`, `maxLength(n)`, `email`, `tel`, `select`) と英語既定 `DEFAULT_SUBMISSION_MESSAGES` を export し、`submissionSchemaFor(fields, messages = DEFAULT_SUBMISSION_MESSAGES)` にする (shared は依存なしのまま)。
- `packages/core` の `forms.validateSubmission(form, raw, messages?)` に渡す。`KansoError` の `message` (`Invalid submission`) は API のコード側メッセージとしてそのまま英語、`details[].message` がローカライズされる。
- `submitForm(c, form, raw, messages: SiteMessages)` に変更し、`validation` と `form.turnstileFailed` / `form.turnstileUnconfigured` を使う。呼び出し側: 公開 JSON API は `settings.site().locale` から `resolveMessages`、サイトの `handleFormPost` も同様 (`renderPage` 側の `loadSiteContext` と合わせて設定を 2 回読むことは許容)。
- `prepareForms(c, html, action, state, messages)` → `expandForms(html, forms, { action, turnstileSiteKey, state, messages })` → `<KansoForm messages>`。

**管理画面**: 設定画面の「言語」欄にヒント `公開サイトの文言は ja / en に対応しています (それ以外は英語)。` を追加するだけ。

**ドキュメント**: `docs/architecture.md` §6 に i18n の仕組み (カタログの場所、解決規則、テーマ部品への渡し方、検証メッセージの流れ) を追記。README にロケールで公開側の文言が切り替わる旨を 1 文追加。

### 完了条件

- 共通条件。`locale: ja` のサイトで 404 / フォーム (送信ボタン・必須エラー) が日本語、`en` / `fr` で英語になることがテストとスモークで確認できる。公開 JSON API の `details[].message` もサイトのロケールに従う。

### 決定

- カタログは [apps/server/src/i18n.ts](../../apps/server/src/i18n.ts) の `en` / `ja` (`SiteMessages`)。`resolveMessages(locale)` は `Intl.getCanonicalLocales` で正規化した主言語サブタグが `ja` なら `ja`、それ以外・空文字・不正なタグ (例外) は `en`。`JA` / `ja-JP` も ja。テストで両カタログのキー集合が一致することを検査する (キー漏れは型に加えて構造比較でも検出)。
- 補間が要る `archive.categoryHeading(term, type)` / `archive.tagHeading` / `validation.maxLength(n)` だけ関数。アーカイブ見出しの書式は両言語とも `{term} – {type}` / `#{term} – {type}` で据え置き。
- 送信検証: `packages/shared` に `SubmissionMessages` と英語既定 `DEFAULT_SUBMISSION_MESSAGES` を追加し、`submissionSchemaFor(fields, messages = DEFAULT_SUBMISSION_MESSAGES)` / core `validateSubmission(form, raw, messages?)` に流す。shared は依存なしのまま。`KansoError.message` (`Invalid submission`) は英語固定で、`details[].message` のみローカライズ (HTML フォームと公開 JSON API `POST /api/v1/public/forms/:slug/submissions` で共通)。
- `submitForm(c, form, raw, messages: SiteMessages)` / `verifyTurnstile(secretKey, token, remoteIp, failureMessage)` に変更。フォームの `successMessage` が空なら `messages.form.successDefault` を使う (旧: `KansoForm` 側だけの `||` フォールバック → `submitForm` の戻り値に統一)。Turnstile の失敗・未設定メッセージもカタログから。
- 呼び出し側: 公開 JSON API と `handleFormPost` は `settings.site().locale` → `resolveMessages`。`renderPage` / `renderPost` は `ctx.messages.form` を `prepareForms(c, html, action, state, messages)` に渡す (フォーム送信時は設定を 2 回読む。許容)。
- テーマ部品への受け渡しは派生値だけの約束どおり: `PostList` に `messages: { newer, older }` (ページ送りの `aria-label`。矢印表示は据え置き)、`KansoForm` / `expandForms` に `SiteMessages['form']`。`Layout` は変更なし。
- プレースホルダのホームは `running` と `hintBefore + <code>home</code> + hintAfter` を別々の `<p>` にした (JSX の区切り空白が日本語の `。` の後に残るのを避けるため。レビューで修正)。
- 管理画面は設定の「言語」欄にヒント文を追加しただけ。ロケールは引き続き自由入力 (`<html lang>` / `og:locale` / `formatDate` はそのまま入力値を使う)。
- ドキュメント: architecture.md §6 に i18n の節、ロードマップ Phase 2 → done (2026-09-15) / Phase 3 → in-progress (このボードへのリンク)、README の Status とロケール説明を更新。
- スモーク (`:5199`, `locale` を `ja` → `en` → `fr` → `ja` に PUT): 404 のタイトル/本文、埋め込みフォームの送信ボタン・select プレースホルダ・honeypot ラベル、非 JS 送信 422 の各フィールドエラー、JSON API の `details[].message`、既定成功文、プレースホルダのホーム、アーカイブのページ送り `aria-label` (投稿 11 件で 2 ページ) がすべてロケールに追従し、`fr` は英語にフォールバックすることを確認。`<html lang>` は `fr` のまま (文言のみ英語)。スモーク用のフォーム・ページ・投稿タイプ・投稿は削除済み。

---

## T15. 公開キャッシュの即時無効化

状態: `done` (2026-09-16)

### ゴール

- 投稿・固定ページ・投稿タイプ・分類・フォーム・設定の書き込み後、公開 HTML / フィード / サイトマップの 60 秒キャッシュを待たずに **全データセンターで** 反映される。

### 現状 (調査済み)

- Phase 1 T7 で URL 単位の purge がある: `purgeSiteCache(c, paths)` ([cache.ts](../../apps/server/src/middleware/cache.ts)) が [paths.ts](../../apps/server/src/site/paths.ts) の `pagePurgePaths` / `postPurgePaths` / `postTypePurgePaths` を `caches.default.delete()` する。対象はページ・投稿・投稿タイプの API 書き込みのみ。
- 残る穴: (1) カテゴリ・タグ・設定・フォーム定義の変更は purge されず 60 秒待つ。(2) 投稿タイプやページの追加はナビ (全ページ共通) を変えるが、対象 URL 以外のページは purge されない。(3) Cloudflare の Cache API は **データセンター単位** なので、`cache.delete()` は管理操作を処理したデータセンター以外には効かない (本番ではほぼ確実に別拠点に古いキャッシュが残る)。

### 仕様 (実装前に再確認)

- URL 単位 purge の代わりに (または併用で) **サイト全体のキャッシュ世代** をキャッシュキーに含める: `settings` に `cacheVersion` (単調増加の整数または短い乱数) を持ち、`siteCache` ミドルウェアはキャッシュ照合前にそれを読み、キャッシュキー URL に `?__v=<version>` を付与する。世代が変わればどの拠点でも自然にミスになる。
- 書き込み系サービス (`pages` / `posts` / `postTypes` / `taxonomies` / `forms` / `settings`) の成功後に世代を進める共通ヘルパーを `packages/core` に置き、API 層の `purgeSiteCache` 呼び出しは削除するか世代更新に置き換える (`paths.ts` が不要になれば削除)。
- 世代の読み取りは 1 リクエスト 1 回の小さな D1 読み (`settings` 1 行)。ヒット時にもこの読みが発生することを許容する (kansoCMS は小規模サイト向け。将来 KV に移す余地を決定に残す)。
- 予約公開 (`published_at` が未来) は世代で扱えないので、従来どおり `s-maxage=60` の TTL は残す。
- `x-kanso-cache: HIT/MISS` はそのまま。テストは世代の付与とヒット/ミスの切り替わりを `caches` のモックで確認する。
- `docs/architecture.md` §6 / §9 のキャッシュ記述、README、phase-2 の「フォーム定義の変更は purge しない」を更新。

### 完了条件

- 共通条件。ページ本文を PATCH した直後の GET (セッション cookie なし) が新しい内容を返す。

### 決定

- URL 単位の purge は **廃止** し、サイト全体のキャッシュ世代キーに一本化した。`purgeSiteCache` / `site/paths.ts` / `paths.test.ts` と、API 層で purge のためだけに行っていた `previous` の再読込 (pages / post-types の PATCH・DELETE、posts の作成後・PATCH 前後・DELETE 前の `getWithRelations`) を削除。世代が変われば旧キーは二度と照合されないので `cache.delete()` は不要 (旧エントリは 60 秒 TTL で消える)。
- 世代の保存先は `settings` テーブルの `cache` 行 (`SETTINGS_KEYS.cache`、`cacheSettingsSchema = { version: string }`、既定 `'0'`)。マイグレーション不要。単調増加ではなく **16 桁 hex の乱数トークン** (`crypto.getRandomValues`) にした: 読まずに 1 回の upsert で回せ、同時書き込みでも順序を気にしなくてよい。
- core に [cache-version.ts](../../packages/core/src/services/cache-version.ts) (`kanso.cacheVersion.get()` / `bump()`、内部は `settingsService` の get/set を再利用)。
- server の `siteCacheKey(url, version)` はキーに `__v=<version>` を付ける。`siteCache` は照合前に `cacheVersion.get()` を呼び (既存の `try` 内。失敗時は従来どおり素通し)、hit でも D1 を 1 行読む (小規模サイト前提のトレードオフ。将来 KV に移す余地あり)。
- 世代の更新は API ルート個別ではなく **ミドルウェア** `bumpSiteCacheVersion` (`await next()` 後、`c.res.ok` のときだけ `bump()` を **await**) を `protectedApi` の `POST/PUT/PATCH/DELETE '*'` に 1 行で掛けた。ページ・投稿・投稿タイプ・カテゴリ・タグ・フォーム・メディア (alt はカバー画像に描画される)・設定を網羅し、API キーや送信削除でも回る (余分な miss 1 回は許容)。4xx や例外では回らない。await するので「PATCH 直後の GET が新しい内容」が決定的に成り立つ。
- `s-maxage=60` は据え置き (予約公開は世代で検出できない)。`x-kanso-cache` の値は変更なし。
- テスト: core は `settingsService` をモックして既定値・16 桁 hex・永続化を確認。server は `caches.default` を `Map` で差し替えて MISS → HIT → 世代変更 → MISS、セッション Cookie で `match` 不呼出、`bumpSiteCacheVersion` が 2xx でのみ `bump` を呼ぶ (4xx / `KansoError` では呼ばない) ことを確認。
- ドキュメント: architecture.md §3 ツリー (paths.ts 削除・cache-version 追加)・§6 キャッシュ・§9・Phase 1 先送り項目、phase-2.md のキャッシュ記述 2 箇所に「T15 で解消」を追記、README のキャッシュ説明。
- スモーク (`:5199`, Vite の Cloudflare プラグインが Cache API を提供): ページ作成 → Cookie なし GET が `MISS` → 2 回目 `HIT` → 本文 PATCH → 直後の GET が `MISS` で新本文 → `HIT`。無関係な書き込み (タグ作成) でも `/` が `MISS` に戻り、失敗した書き込み (400) では `HIT` のまま。スモークデータは削除済み。

---

## T16. 管理画面のブラウザ E2E テスト (Playwright)

状態: `todo`

### ゴール

- 管理画面の主要フローがヘッドレス Chromium で自動検証される: ログイン → フォーム作成 (フィールドビルダー) → 固定ページ作成でエディタの「フォーム」ボタンからフォームを埋め込み → 公開 → 公開ページで送信 (検証エラー → 成功) → 送信一覧に表示 → 後片付け。

### 仕様 (実装前に再確認)

- `@playwright/test` をルートの devDependency に追加し、`e2e/` (ルート直下) に置く。`playwright.config.ts` の `webServer` で `apps/server` の `vite dev --port 5199` を起動 (ポート 5173 は使わない)。ローカル D1 は `pnpm db:migrate:local` + seed 済み管理者 (`admin@example.com` / `password123`) を前提にし、README に手順を書く。
- テストデータは slug に `e2e-` プレフィックスを付け、テスト末尾で API 経由で削除する。
- `pnpm e2e` スクリプトを追加。通常の `pnpm test` には含めない (CI では別ジョブ)。Chromium だけインストール (`pnpm exec playwright install chromium`)。
- T12 で未確認だった「フォーム選択ダイアログからの挿入」と「公開ページの非 JS 送信」をこのテストでカバーする。Turnstile は既定オフのまま (テストキーは使わない)。

### 完了条件

- 共通条件に加え、`pnpm e2e` がローカルで成功する。

### 決定

- (実装中に追記)
