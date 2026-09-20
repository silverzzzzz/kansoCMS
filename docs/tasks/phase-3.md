# Phase 3 タスクボード — 仕上げ (i18n / キャッシュ / E2E / CI / リビジョン / リダイレクト)

目的: Phase 1–2 で先送りにした運用面の課題を順に解消する。**公開サイトの文言をサイトのロケールに追従させ、更新が即時に公開に反映され、管理画面の主要操作がブラウザ E2E と CI で守られ、誤った保存や URL 変更から運用者が復帰できる** 状態にする。

運用ルール ([Phase 2](phase-2.md) と同じ):

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T14 | テーマ i18n: 公開側の固定文言と送信検証メッセージをサイトの `locale` に追従させる (ja / en) | done | shared, core, server, admin |
| T15 | 公開キャッシュの即時無効化: 管理 API の書き込みで公開 HTML/フィードのキャッシュを purge する | done | core, server |
| T16 | 管理画面のブラウザ E2E テスト (Playwright): ログイン → ページ作成 (フォーム埋め込み) → 公開 → 送信 → 送信一覧 | done | admin, server, tooling |
| T17 | CI (GitHub Actions): push / PR で 4 ゲートと Playwright E2E を実行する | done | tooling |
| T18 | リビジョン: 固定ページ・投稿の保存前の状態を最大 20 件保持し、管理画面から復元できる | done | shared, core, server, admin |
| T19 | リダイレクト: 管理画面で 301/302 を登録でき、ページのパス変更・投稿のスラッグ変更で自動作成される | done | shared, core, server, admin |

Phase 3 の決定事項 (ユーザー確認済み):

1. 上記 3 件を **T14 → T15 → T16 の順** に進める (2026-09-16)。
2. 続けて **T17 → T18 → T19 の順** に進める (2026-09-16、「進めて」)。残りの Phase 3 項目 (FTS5 検索、テーマ切替、`examples/astro-blog`、`create-kanso`、管理画面 i18n) は T19 完了後に再提案する。

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

状態: `done` (2026-09-16)

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

- 配置: ルートに [playwright.config.ts](../../playwright.config.ts) と `e2e/` ([helpers.ts](../../e2e/helpers.ts) / [forms.spec.ts](../../e2e/forms.spec.ts))。`@playwright/test` はルートの devDependency のみ (`@types/node` は入れない。`process.env` を読まなければ Playwright 同梱の型で足りる)。ルートに `tsconfig.json` を新設し (`extends tsconfig.base.json`、`lib: ES2022 + DOM`、`types: []`、`include: e2e, playwright.config.ts`)、ルートの `typecheck` を `tsc -p tsconfig.json && pnpm -r typecheck` にした。各パッケージの tsconfig は影響を受けない。
- スクリプト: `pnpm e2e` (`playwright test`) と `pnpm e2e:install` (`playwright install chromium`)。`pnpm test` には含めない。`.gitignore` に `test-results/` と `playwright-report/`。CI は未導入のまま (Phase 3 の別項目)。
- 設定: Chromium のみ、`workers: 1`、`retries: 0`、テスト 60 秒 / expect 10 秒、`trace: retain-on-failure`、`use.baseURL = http://localhost:5199`、`extraHTTPHeaders.origin` を baseURL に (CSRF の Origin 検査をブラウザと同条件で通す)。`webServer` は `pnpm --filter @kanso/admin build && pnpm --filter @kanso/server exec vite dev --port 5199` を `/api/v1/health` で待ち (180 秒)、`reuseExistingServer: true` 固定 (開発中に立ち上げた server を使い回す。Worker が `/admin/` を配信するので管理画面の事前ビルドが必須)。
- 前提データ: `beforeAll` で `GET /api/v1/setup` → `needed` なら `POST /api/v1/setup` で `admin@example.com` / `password123` を作成、既に管理者がいればその資格情報でログインする (seed には依存しない)。API 用に `playwright.request.newContext()` を 1 つ作って `beforeAll` / テスト / `afterAll` で共有する (組み込み `request` フィクスチャはフック間で Cookie を保持しない)。
- 後片付け: `e2e-` プレフィックスのページ (ページネーションを辿って全件) とフォームを **前後両方** で API 削除 (前回の異常終了の残骸にも耐える。送信はフォーム削除で cascade)。それ以外の DB 内容には触れない。
- テストは 1 本 (`test.step` で 5 段): ログイン (`/admin/login`、ダッシュボード見出し「おかえりなさい、…」で確認) → フォーム作成 (`/admin/forms/new`: 名前・スラッグ・完了メッセージ `E2E thanks`、既定の 1 フィールドに「フィールドを追加」で 2 つ目。`Field` のヒントがアクセシブル名に混ざるので、フィールド行の `div.border.border-neutral-200.bg-white.p-5` にスコープして `getByLabel(/^名前/)` 等で選ぶ。`data-testid` は追加しなかった) → ページ作成 (`/admin/pages/new`: 状態 `published`、`.editor-content .ProseMirror` に本文、ツールバー「フォーム」→ `role=dialog` の見出し「フォームを選択」→ slug を含むボタン → `.editor-form-block` のテキスト確認 → 保存) → 公開ページ (`browser.newContext({ javaScriptEnabled: false })` で Cookie なし・スクリプトなし: `form.kanso-form` を確認、`form.noValidate = true` にしてブラウザの必須検証だけ外し、空送信の POST が **422** で `.kanso-form__field` 内に `.kanso-form__error`、入力後の POST が 200 で `.kanso-form--success` に `E2E thanks`) → `GET /api/v1/forms` で id を引いて `/admin/forms/:id/submissions` の行に値と「未読」。送信ボタンは `/^(送信|Send)$/` でロケール非依存。
- ドキュメント: README のローカル開発に「End-to-end tests」節とスクリプト表、architecture.md §7 に `e2e/` の一行、§8 の「Phase 1 で先送りにした改善候補」文を削除。
- 検証: `pnpm typecheck` / `check` / `test` / `build` 通過。`pnpm e2e` を server 未起動の状態から実行し、webServer の admin ビルド + `vite dev` 起動を含めて 1 passed (14.8 秒、テスト本体 2.9 秒)。終了後にポート 5199 のリスナーなし、ローカル D1 に `e2e-` のページ・フォーム・送信が残っていないことを `wrangler d1 execute --local` で確認。

---

## T17. CI (GitHub Actions)

状態: `done` (2026-09-16)

### ゴール

- `main` への push と pull request で、4 ゲート (`typecheck` / `check` / `test` / `build`) と Playwright E2E が自動実行される。

### 現状 (調査済み)

- `.github/` は無い。remote は `github.com/silverzzzzz/kansoCMS`。`packageManager: pnpm@10.32.1`、`engines.node >= 22`。
- T16 の `pnpm e2e` は `webServer` で admin ビルド + `vite dev --port 5199` を起動し、`pnpm db:migrate:local` (= `wrangler d1 migrations apply kanso --local`) 済みのローカル D1 を前提にする。管理者がいなければ setup API で作るので seed は不要。

### 仕様 (実装前に再確認)

- `.github/workflows/ci.yml` 1 本。トリガーは `push` (branches: main) と `pull_request`。`concurrency` で同一 ref の古い実行をキャンセル。
- ジョブ 2 つを並列に: `gates` = checkout → `pnpm/action-setup` (`packageManager` を読む) → `setup-node` (Node 24、`cache: pnpm`) → `pnpm install --frozen-lockfile` → `typecheck` → `check` → `test` → `build`。`e2e` = 同じセットアップ → `pnpm exec playwright install --with-deps chromium` → `pnpm db:migrate:local` → `pnpm e2e` → 失敗時に `playwright-report/` と `test-results/` を artifact 化。各ジョブに `timeout-minutes`。
- Wrangler はログインなしのローカルモードだけを使う (`WRANGLER_SEND_METRICS=false`)。Cloudflare の secret は CI に置かない (デプロイは対象外)。
- GitHub Actions は手元で実行できないので、fresh clone (`git clone` → `pnpm install --frozen-lockfile` → `pnpm db:migrate:local` → `pnpm e2e`) を非対話シェルで通して同等性を確認する。管理者のいない DB で setup 経路も通る。
- README に CI の一文、architecture.md のロードマップから「CI」を済へ。

### 完了条件

- 共通条件。fresh clone の非対話実行が通り、ワークフロー YAML の構文が検証済み。

### 決定

- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) 1 本。トリガーは `push` (branches: `main`) と `pull_request` (ブランチ制限なし)。`concurrency.group = ci-${{ github.workflow }}-${{ github.ref }}`、`cancel-in-progress: true`。ワークフロー全体に `WRANGLER_SEND_METRICS: 'false'`。Cloudflare の secret / token は置かない (デプロイは対象外、Wrangler はローカルモードのみ)。
- ジョブは `gates` (timeout 15 分) と `e2e` (timeout 20 分) の 2 つで `needs` なしの並列。共通セットアップは `actions/checkout@v4` → `pnpm/action-setup@v4` (version 指定なし = `package.json` の `packageManager` を読む) → `actions/setup-node@v4` (`node-version: 24`, `cache: pnpm`) → `pnpm install --frozen-lockfile`。action はメジャータグ (`@v4`) で固定し SHA ピンはしない。
- `gates`: `pnpm typecheck` → `pnpm check` → `pnpm test` → `pnpm build`。`e2e`: `pnpm exec playwright install --with-deps chromium` → `pnpm db:migrate:local` → `pnpm e2e` → 失敗時のみ `actions/upload-artifact@v4` で `playwright-report` + `test-results` (`if-no-files-found: ignore`)。E2E の管理者は spec 側の setup 経路で作られるので seed ステップは無い。
- ドキュメント: README のスクリプト表の下に CI の一文、architecture.md §3 ツリーに `e2e/` と `.github/workflows/ci.yml` を追加し「まだ無いもの」を `examples/astro-blog` のみに更新 (`core/mail` / `api/forms` は Phase 2 で作成済みだった)、§7 に CI の一行、§8 ロードマップの CI を済へ。
- 検証: GitHub Actions は手元で走らせられないので、fresh clone (`git clone` → `CI=true pnpm install --frozen-lockfile` → `pnpm db:migrate:local` → `pnpm e2e`、stdin なし) を通した。migrations は `Using fallback value in non-interactive context: yes` で確認なしに適用、`pnpm e2e` は server 未起動から webServer で admin ビルド + `vite dev` を立ち上げて 1 passed (28 秒)、終了コード 0、ポート 5199 解放。YAML は `js-yaml` でパース確認。4 ゲートも本リポジトリで通過 (161 tests)。
- 注意 (Windows のみ): ローカル D1 (workerd) は長いパスで `internal error` になる (`AppData\Local\Temp\claude\...` 配下の clone では `select 1` すら失敗)。検証用 clone は短いパス (`%TEMP%\kcs`) に置いた。CI の ubuntu には無関係。
- 未実施: 実際の Actions 実行はユーザーの push 後に初回が走る。失敗したら `playwright-report` artifact を見る。

---

## T18. リビジョン (固定ページ・投稿の更新履歴と復元)

状態: `done` (2026-09-16)

### ゴール

- 固定ページ・投稿を保存するたびに **保存前の状態** が履歴として残り (対象ごとに最新 20 件)、管理画面の編集画面から任意の履歴に復元できる。

### 現状 (調査済み)

- architecture.md §5 に `revisions` (id, target, target_id, snapshot_json, user_id, created_at、最新 N 件のみ保持) が「未作成」として計画されている。
- `pages.update` / `posts.update` ([pages.ts](../../packages/core/src/services/pages.ts) / [posts.ts](../../packages/core/src/services/posts.ts)) は `current = await get(id)` の後、`db.batch` で本体 (+ 子孫パス / 分類・タグ) を書く。`context` は `{ allowRawHtml }`。投稿の分類・タグは `post_categories` / `post_tags`。
- API の `principal` は `{ kind: 'session', user }` か `{ kind: 'apiKey' }`。管理画面の編集画面 ([pages/$id.tsx](../../apps/admin/src/routes/_auth/pages/$id.tsx) / posts) は loader の item を `useState` 初期値にシードし、Editor は `editorKey` で再マウントする。

### 仕様 (実装前に再確認)

- テーブル `revisions`: `id`, `target_type` (`'page' | 'post'`), `target_id`, `snapshot_json` (text/json), `user_id` (users FK, `set null`), `created_at`。index `(target_type, target_id, created_at)`。マイグレーション `0002_revisions.sql` は `drizzle-kit generate` の出力。ポリモーフィックなので pages/posts への FK は張らず、ページ・投稿の削除時に同じ `batch` で履歴も削除する。
- スナップショットは「復元に必要な入力」: page = title, slug, parentId, sortOrder, bodyJson, excerpt, status, publishedAt, seoTitle, seoDescription, ogMediaId, noindex, canonicalUrl。post = title, slug, bodyJson, excerpt, status, publishedAt, coverMediaId, categoryIds, tagIds, seoTitle, seoDescription, ogMediaId, noindex, canonicalUrl (`postTypeId` は変えない)。`packages/shared` に `pageRevisionSnapshotSchema` / `postRevisionSnapshotSchema` を置き、読み出し時に検証する。
- 記録タイミング: `update` の **直前状態** を同じ `batch` で保存し、`REVISIONS_PER_TARGET = 20` を超える古い行を削除する。作成時は記録しない (最新の状態は本体行そのもの)。復元も `update` 経由なので、復元前の状態が自動で残る。
- `user_id` は API 層で `principal.kind === 'session'` のとき `user.id`、API キーなら `null`。core の update コンテキストに `userId: number | null` を追加する。
- API (write 権限): `GET /api/v1/pages/:id/revisions` → `{ items: [{ id, createdAt, user: { id, name } | null, title, status }] }` (snapshot 抜き、新しい順)。`GET /api/v1/pages/:id/revisions/:rid` → `{ item }` (snapshot 込み)。`POST /api/v1/pages/:id/revisions/:rid/restore` → `update` を呼び `{ item }`。posts も同じ形。
- 管理画面: 編集画面のフォーム下に「履歴」セクション (日時・ユーザー名・タイトル・状態・「復元」ボタン)。復元は `ConfirmDialog` → restore API → クエリ無効化 → フォームを復元後の内容で再シード (route component を `item.updatedAt` を key にした内部コンポーネントに分ける等)。差分表示はしない。
- ドキュメント: architecture.md §3 ツリー・§5 テーブル (未作成 → 作成済み)・§9、README の Status (「Revisions … not built yet」)。

### 完了条件

- 共通条件。スモーク: ページを 2 回保存 → 履歴 2 件 → 古い方を復元 → 本文が戻り履歴が 3 件になる。投稿でも分類・タグが復元される。

### 決定

- テーブル [revisions.ts](../../packages/core/src/db/schema/revisions.ts) / マイグレーション `0002_revisions.sql` (drizzle-kit 生成): `target_type` は text enum (`page` | `post`)、`user_id` は users FK (`set null`)、index `(target_type, target_id, created_at)`。pages / posts への FK は張らず、`deletePage` / `deletePost` の `batch` に `revisions.deleteStatement` を足して履歴も消す。
- スナップショットは [shared/revisions.ts](../../packages/shared/src/revisions.ts) の `pageRevisionSnapshotSchema = pageFieldsSchema`、`postRevisionSnapshotSchema = postFieldsSchema.omit({ postTypeId })` (= 更新 API の入力そのもの)。`snapshot_json` は drizzle の `mode: 'json'` で保存し、読み出し (`list` / `get`) 時に zod で検証、壊れていれば validation エラー。`list` は検証済みスナップショットから title / status だけ返す。
- 記録は [revisionsService](../../packages/core/src/services/revisions.ts) の `recordStatements(target, id, snapshot, userId)` = insert + 「新しい 20 件以外を delete」(`notInArray` サブクエリ) を `pages.update` / `posts.update` の既存 `batch` に連結する。内容が同じでも更新ごとに記録し、作成時は記録しない。`publishedAt` は ISO 文字列で保存。
- `user_id` は API 層の `currentUserId(principal)` (`session` → `user.id`、API キー → `null`) で決め、core の `UpdateContext = RenderContext & { userId: number | null }` として渡す。
- API: `GET …/revisions` (一覧、snapshot 抜き) と `GET …/revisions/:revisionId` (snapshot 込み) は **read** スコープ (仕様では write としていたが読み取り専用なので `protectedApi` の既定に従う)、`POST …/revisions/:revisionId/restore` は write。一覧は先に `pages.get` / `posts.get` を呼んで対象が無ければ 404。param は `revisionParamSchema` (`id`, `revisionId`)。
- 復元 (`restoreRevision`) はスナップショットを `update` に流す前に **消えた参照を除外** する: 親ページ (存在しない・自分自身)、OG 画像・カバー画像 (media に無い)、カテゴリ (同じ投稿タイプに存在するもののみ)、タグ (存在するもののみ)。復元も `update` なので復元前の状態が履歴に残り、公開キャッシュの purge も通常更新と同じ。
- 管理画面: 編集ルートを外側 (`EditPage` / `EditPostPage`: 履歴クエリ・復元 mutation・`ConfirmDialog`) と内側フォーム (`EditPageForm` / `EditPostForm`、`key={formKey}`) に分割。復元成功時は `invalidateQueries(['pages' | 'posts'])` を await してから `formKey` を進め、再取得した item でフォーム (投稿はカテゴリ・タグ選択も) を再シードする。一覧は共通の [RevisionList](../../apps/admin/src/components/content/RevisionList.tsx) (日時・ユーザー・タイトル・状態・復元)。loader で revisions も prefetch。差分表示は無し。
- テスト: [pages.test.ts](../../apps/server/src/api/pages.test.ts) (一覧の 404 経路と restore の `{ allowRawHtml, userId }` 転送)、[revisions.test.ts](../../packages/shared/src/revisions.test.ts)。4 ゲート通過 (165 tests)。
- スモーク (Playwright でブラウザ操作、port 5199): ページを 2 回保存 → 履歴 2 件 (新しい順、ユーザー "Admin") → 古い方を復元 → タイトル・本文が v1 に戻り履歴 3 件。投稿は API でカテゴリ・タグを外した後に復元 → `categoryIds` / `tagIds` が戻り、チェックボックスとタグチップも再シードされる。ページ削除後は `GET …/revisions` が 404。
- 既知 (T18 と無関係、既存): スラッグ入力の `pattern` 属性 `[a-z0-9-]` が最近の Chromium (`v` フラグ) で無効な正規表現と判定されコンソールにエラーが出る (ブラウザ側検証がスキップされるだけで保存は zod で検証済み)。別コミットで `\-` にエスケープして修正。
- ドキュメント: architecture.md §3 (services / shared の一覧)・§4 `revisions` 行 (未作成 → 作成済み)・§5 の 3 エンドポイント・§9 に決定を追記。README の機能一覧に 1 行、Status を「Redirects and search … not built yet」へ。

---

## T19. リダイレクト

状態: `done` (2026-09-21)

### ゴール

- 旧 URL から新 URL への 301/302 を管理画面で登録でき、固定ページのパス変更・投稿のスラッグ変更時には自動で 301 が作られる。

### 現状 (調査済み)

- 公開側 [routes.tsx](../../apps/server/src/site/routes.tsx) の `site.get('/:path{.+}')` は `resolveContent` が `null` なら `notFound`。404 は Cache API に入らない (200 のみ格納)。
- `packages/shared` の `redirectUrlSchema` (フォーム用: http(s) URL か `/` 始まりのパス) が再利用できる。予約スラッグは `isReservedSlug`。

### 仕様 (実装前に再確認)

- テーブル `redirects`: `id`, `from_path` (unique、先頭・末尾スラッシュなしで正規化)、`to` (`/path` か絶対 URL)、`status` (301 | 302、既定 301)、`created_at`, `updated_at`。マイグレーション `0003_redirects.sql`。
- shared: `createRedirectSchema` / `updateRedirectSchema` (`fromPath` は前後の `/` を除去して正規化、空や予約スラッグは不可、`to` は `redirectUrlSchema`、from と to が同じなら validation エラー)。
- core `redirectsService`: `list` / `get` / `create` / `update` / `delete` / `findByPath(path)` / `recordPathChange(oldPath, newPath)` = `old → /new` (301) を upsert、`to === '/old'` の既存行を `/new` に書き換え (チェーン防止)、`from === new` の行を削除 (新パスには実体がある)。
- 自動作成: `pages.update` でパスが変わった全ページ (子孫含む) と、`posts.update` でスラッグが変わった投稿 (`/{type}/{old}` → `/{type}/{new}`)。投稿タイプのスラッグ変更は対象外 (決定に明記)。
- 公開側: `resolveContent` が `null` のときだけ `redirects.findByPath(path)` を引き、あれば `c.redirect(to, status)`。実体のあるパスではリダイレクトは効かない (実体優先) ことをドキュメントに書く。
- API `/api/v1/redirects` (list + `q`、create、patch、delete)。管理画面 `/admin/redirects` (一覧・追加フォーム・削除、ナビに「リダイレクト」)。
- ドキュメント: architecture.md §3・§5・§6 (ルーティング)・§9、README の Status。

### 完了条件

- 共通条件。スモーク: ページのスラッグを変更 → 旧 URL が 301 で新 URL へ。手動登録 `/old` → `https://example.com/` が 302。

### 決定

- テーブル [redirects.ts](../../packages/core/src/db/schema/redirects.ts) / マイグレーション `0003_redirects.sql` (drizzle-kit 生成): `from_path` は unique、`to` は text、`status` は integer (既定 301、`$type<RedirectStatus>`)、`created_at` / `updated_at`。pages / posts への FK は張らない (実体が消えてもリダイレクトは残す)。
- 正規化は [shared/redirects.ts](../../packages/shared/src/redirects.ts) の `normalizeRedirectPath` (前後の空白と `/` を除去、連続する `/` を 1 つに畳む) に集約。`redirectFromPathSchema` は正規化後に「空でない」「500 文字以内」「空白・`?`・`#` を含まない」「先頭セグメントが予約スラッグでない」を検査。`to` は既存の `redirectUrlSchema` (絶対 URL か `/` 始まり) を再利用し、`fromPath` と同じ宛先はオブジェクト単位の refine で `to` 側の validation エラーにする (`Redirect target equals its source`)。`update` でも マージ後の値で同じ検査をする。
- core [redirectsService](../../packages/core/src/services/redirects.ts): `list(q?)` (`from_path` / `to` の部分一致、`from_path` 昇順)、`get` / `create` / `update` / `delete` / `findByPath`。`from_path` の unique 違反は `KansoError.conflict('Redirect path already exists')`。
- 自動作成は `pathChangeStatements(oldPath, newPath)` (statement の配列を返すだけ) を `pages.update` / `posts.update` の既存 `batch` に連結する。順序は ① 新パス宛の行を削除 (新 URL には実体がある) → ② `to` が旧パスだった行を新パスへ付け替え (チェーン防止) → ③ 旧パス → 新パスの 301 を upsert。
- 対象は**公開済み**のみ: ページは自分と子孫 (`status === 'published'` の行だけ)、投稿は `status === 'published'` かつ slug 変更時に `{type}/{old}` → `{type}/{new}`。下書きの変更と投稿タイプのスラッグ変更は対象外 (仕様どおり)。
- 公開側 [routes.tsx](../../apps/server/src/site/routes.tsx) は `notFound(c)` を `missing(c, path)` に置き換え、**実体が無いときだけ** `redirects.findByPath` を引く (実体優先)。ヒットすれば `c.redirect(to, status)`、無ければ従来どおりテーマの 404。リダイレクト応答は 301/302 なので siteCache には入らない (200 のみ格納)。クエリ文字列は転送先に引き継がない。
- API `/api/v1/redirects` は `protectedApi` の既定どおり GET が read、POST/PATCH/DELETE が write (書き込みでキャッシュ世代も更新)。管理画面 [/admin/redirects](../../apps/admin/src/routes/_auth/redirects/index.tsx) は検索・追加フォーム・インライン編集 (`form` 属性で行外のフォームに紐付け)・`ConfirmDialog` 削除。ナビに「リダイレクト」を追加。
- テスト: [shared/redirects.test.ts](../../packages/shared/src/redirects.test.ts)、[api/redirects.test.ts](../../apps/server/src/api/redirects.test.ts)、[site/routes.test.ts](../../apps/server/src/site/routes.test.ts) に 4 ケース (内部 301 / 外部 302 / 実体優先で `findByPath` を呼ばない / 未登録は 404)。4 ゲート通過 (178 tests)。
- スモーク (port 5199、API + Playwright): `/manual-x/` 登録 → 正規化されて `manual-x`、`GET /manual-x` が 302 で `https://example.com/`。重複登録は 409、自己参照は 400 (`details[0].path = 'to'`)。公開ページの slug 変更で旧 URL が 301 → 新 URL、戻すと旧 URL は 200 に戻り残るのは `new → /old` の 1 行だけ (チェーンなし)。未登録パスは 404。管理画面から追加 → `GET /ui-x` が 301、削除で行が消える。コンソールエラーなし。
- 注意: ブリーフに「validation は 422」と誤記したため Codex が `middleware/error.ts` を 422 に変えていた。`validation → 400` が既存の契約なので revert し、テストの期待値も 400 に戻した。
- ドキュメント: architecture.md §3 (ツリー)・§4 `redirects` 行・§5 (`/:path+` の解決順とエンドポイント表)・§6 (リダイレクトはキャッシュしない)・§8 ロードマップ (revisions / redirects を済へ)・§9 に決定を追記。README は機能一覧に 1 行、Status を「Search (Phase 3) is not built yet.」、URL 表にリダイレクト行。
