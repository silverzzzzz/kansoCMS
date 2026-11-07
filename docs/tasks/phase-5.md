# Phase 5 タスクボード — サンプルサイト (スターターコンテンツ)

目的: **初回セットアップ直後から「小さな会社・店舗」向けのサンプルサイトが公開側に表示され、運用者はそれを編集して自分のサイトに作り替えられる** 状態にする。サンプルは後から管理画面で投入でき、不要になったら編集していない部分を一括で削除できる。Shopify の新規ストアに既定テーマとデモ構成が入っているのと同じ体験を、Phase 4 のセクションエディタの上に用意する。

運用ルール ([Phase 2](phase-2.md) / [Phase 3](phase-3.md) / [Phase 4](phase-4.md) と同じ):

- 1 タスク = 1 回の Codex 実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T30 | サンプル定義と同梱画像、インストーラ (マニフェスト記録・衝突時スキップ) | done | shared, core, server |
| T31 | 管理 API (`/api/v1/starter` の状態取得・投入) とセットアップ時の投入、ASSETS からの画像読み込み | done | shared, server |
| T32 | サンプルの削除 (編集済み・参照中・利用者が追加したものは残す) + 投入・削除の一括化 (D1 クエリ上限対策) | done | shared, core, server |
| T33 | 管理画面: セットアップのチェックボックス、設定画面の「サンプルサイト」、ダッシュボードの案内 | todo | admin |
| T34 | E2E + ドキュメント | todo | tooling, docs |

Phase 5 の決定事項 (2026-11-08 ユーザー確認済み):

1. **管理画面 i18n は見送る** (「管理画面はとりあえず日本語でいい」)。Phase 3 はこれで完了扱いにする。
2. サンプルは **初回セットアップ画面のチェックボックス (既定オン)** と **後から管理画面 (設定) で投入** の両方に対応する。
3. 内容は **小さな会社・店舗** 向け: セクション構成のホーム、会社概要、サービス、お問い合わせ (フォーム埋め込み)、お知らせ (投稿タイプ) 3 件。
4. 画像は **自作の抽象プレースホルダ画像をリポジトリに同梱** し、投入時にメディアへ登録する (外部の写真素材は使わない)。

---

## 全体設計 (このフェーズの前提)

- **サンプルは「テンプレート」として書く。** 架空の実在風企業ではなく、運用者が自分の内容に差し替える前提の中立的な文言にし、各所に「どこで編集できるか」の案内を混ぜる (Shopify Dawn の既定文言と同じ考え方)。会社名にあたる箇所はセットアップ時のサイト名 (`site.title`) を差し込む。文言は日本語のみ (サイトの `locale` に関わらない)。
- ~~既存のサービス経由で作る。~~ **(T32 で変更)** サービスを 1 件ずつ呼ぶと D1 クエリがサイト全体で約 80 回になり、Workers Free の上限 (1 呼び出し 50 クエリ) を超える。投入と削除は core の `starter` サービスが少数の集合読み出しと `db.batch()` (トランザクション) で行い、行の値は各サービスと共通の insert ビルダー (`pageInsertValues` など) で作る。入力の検証は引き続き API と同じ create スキーマ。
- **既存のコンテンツを壊さない。** 固定ページ (パス)・投稿タイプ・フォーム・タグはスラッグが空いているときだけ作成し、使われていればスキップして結果に報告する。投稿とカテゴリは、このインストールで作った投稿タイプにだけ作る。テーマ設定とサイト説明は未設定のときだけ書く。
- **何を作ったかをマニフェストに残す。** settings の新キー `starter` に作成した ID と書き込んだ設定値を記録する。削除 (T32) はマニフェストに載っているものだけを対象にし、運用者の作業 (編集済み・参照中・追加分) は残す。
- **配置**: サンプル定義と投入・削除のロジックは `apps/server/src/starter/` (画像の読み込みに Worker の `ASSETS` が要るため server 側)。画像ファイルは `apps/server/public/starter/` (静的アセットとして同梱)。マニフェストの zod スキーマは `packages/shared`。

サンプルの構成 (T30 で実装、文言の細部は実装時に整えて決定に記録):

| 種類 | スラッグ / パス | 内容 |
|---|---|---|
| 固定ページ | `home` (セクション) | hero (見出し = サイト名、紹介文、hero 画像、ボタン「お問い合わせ」→ `/contact`) → image_with_text「私たちについて」(→ 会社概要への誘導) → image_with_text「サービス」(reverse) → post_list「お知らせ」(`news`, 3 件) → cta「お気軽にご相談ください」→ `/contact` |
| 固定ページ | `about` 会社概要 (本文) | 見出し「ごあいさつ」+ 段落、見出し「会社情報」+ 箇条書き (会社名 = サイト名 / 所在地・営業時間・定休日・連絡先はサンプル値と明記)。本文に同梱画像 1 枚 |
| 固定ページ | `services` サービス (セクション) | richtext の導入 → image_with_text ×2 (サービス A / B) → cta。ホーム以外でもセクションが使える例 |
| 固定ページ | `contact` お問い合わせ (本文) | 案内の段落 → フォームブロック (`contact`) → 返信目安の段落 |
| 投稿タイプ | `news` お知らせ | カテゴリ「お知らせ」「イベント」、タグなし |
| 投稿 | `news` に 3 件 | 「ウェブサイトを公開しました」「サイトの編集方法」(管理画面の各機能への案内) 「ワークショップを開催します」(イベント)。カバー画像つき、公開日時は投入時刻から 1 日ずつずらす |
| フォーム | `contact` お問い合わせ | お名前 (text, 必須)、メールアドレス (email, 必須)、ご用件 (select: ご相談 / お見積もり / その他)、お問い合わせ内容 (textarea, 必須)。完了メッセージあり、通知先は空 (設定の既定宛先) |
| テーマ設定 | 現在のテーマの名前空間 | accent に落ち着いた色、footer_text に「サンプルである旨とテーマ設定の場所」の案内。SNS は空 |
| サイト設定 | `site.description` | 空のときだけサンプルの説明文 |
| 固定ページの並び | `sortOrder` | about → services → contact (ナビの順。その後に投稿タイプ「お知らせ」が続く) |

---

## T30. サンプル定義と同梱画像、インストーラ

状態: `done` (2026-11-08)

### ゴール

- `installStarter(kanso, options)` を呼ぶと、上表のサンプルサイト一式が既存サービス経由で作られ、作ったものがマニフェスト (`settings.starter`) に記録される。既存コンテンツと衝突するものはスキップされ、結果に報告される。

### 現状 (調査済み)

- サービスの作成 API: `pages.create(input, { allowRawHtml })`、`posts.create(input, { allowRawHtml, authorId })`、`postTypes.create(input)`、`taxonomies.createCategory` / `createTag`、`forms.create(input, { turnstileAvailable })`、`media.upload({ bytes, filename, ... })` (MIME はバイト列から判定、jpeg/png/gif/webp/avif のみ)、`settings.set(key, schema, value)` / `settings.theme()` / `settings.updateTheme()`。
- 本文は ProseMirror JSON (`@kanso/shared` の `richtext.ts`)。フォームの埋め込みは `{ type: 'form', attrs: { slug } }`、画像は `{ type: 'image', attrs: { src, alt } }` (src は `mediaUrl(r2Key)`)。
- セクションの検証は `sections-meta.ts` の `invalidSectionDetails(catalog, sections)`、テーマ設定は `themeSettingsFieldsByTheme[theme]` + `sectionValuesSchemaFor`。
- ナビは公開済みトップレベル固定ページ (`home` 以外、`sortOrder` 順) + 全投稿タイプ。

### 仕様

**画像** (`apps/server/public/starter/`): 自作の抽象画像 (グラデーション・幾何学形状) の WebP。`hero.webp` (1600×900)、`about.webp` / `service-a.webp` / `service-b.webp` (1200×900)、`news-1.webp` / `news-2.webp` / `news-3.webp` (1200×630)。1 枚 80 KB 以下、合計 500 KB 以下。生成スクリプトはコミットしない (画像だけ置く)。

**マニフェスト** (`packages/shared/src/starter.ts`、`SETTINGS_KEYS.starter`):

```ts
starterManifestSchema = z.object({
  installedAt: z.iso.datetime(),
  pages: z.array(id), posts: z.array(id), postTypes: z.array(id),
  categories: z.array(id), tags: z.array(id), forms: z.array(id), media: z.array(id),
  // What install wrote into settings, so removal can revert only untouched values.
  themeSettings: z.object({ theme: themeNameSchema, values: z.record(...) }).nullable(),
  siteDescription: z.string().nullable(),
})
```

- 未投入は settings 行なし。既存の `settings.get` は行が無いと `{}` を schema に通すので区別できない。core の settings に `starter()` (行が無ければ `null`、あれば `starterManifestSchema.parse`) と `delete(key)` を追加し、書き込みは `settings.set(SETTINGS_KEYS.starter, starterManifestSchema, value)`。

**サンプル定義** (`apps/server/src/starter/content.ts`): 上表の内容をデータとして持つ純粋関数 `starterContent({ siteTitle, mediaUrls, mediaIds, now })`。画像 ID や URL、公開日時は引数で受け取り、ページ・投稿・フォーム・テーマ設定の入力値を返す。

**インストーラ** (`apps/server/src/starter/install.ts`):

```ts
installStarter(kanso, {
  userId: number,
  loadImage: (name: string) => Promise<ArrayBuffer>,   // T31 で ASSETS から読む
  now?: Date,
}): Promise<StarterInstallResult>
// StarterInstallResult = { created: { pages, posts, postTypes, categories, tags, forms, media: number }, skipped: { kind, slug }[] }
```

- マニフェストが既にあれば `KansoError.conflict('Starter content is already installed')`。
- 順序: 画像アップロード → フォーム → 投稿タイプ + カテゴリ → 投稿 → 固定ページ (contact / about / services / home) → テーマ設定 → サイト説明 → マニフェスト。
- 衝突: 固定ページはパス、投稿タイプ・フォームはスラッグが既存ならスキップして `skipped` に積む。投稿タイプがスキップされたら、その投稿とカテゴリも作らず、ホームの post_list は既存の `news` を指したまま (表示は既存の投稿になる)。
- テーマ設定: 現在のテーマの名前空間が空 (未保存または `{}`) のときだけ書く。サイト説明: 空文字のときだけ書く。書いた値はマニフェストに残す。
- **途中で失敗しても** それまでに作ったものはマニフェストに記録してから例外を再送出する (`try/finally`)。T32 の削除で片付けられるようにするため。
- 固定ページ・投稿はすべて `published`。`allowRawHtml: false`。

### 完了条件

- 共通の完了条件。
- テスト (`apps/server/src/starter/*.test.ts`):
  - `starterContent` の出力が実スキーマを通る: ページ/投稿の入力 (`pageFieldsSchema` 等)、セクションが default / paper 両テーマのカタログで `invalidSectionDetails` 空、フォームが `formFieldListSchema`、テーマ設定が `sectionValuesSchemaFor(standardThemeSettingsFields)`、本文 JSON が `renderRichText` で空でない HTML。サイト名がホームの hero と会社概要に入る。
  - `installStarter` (kanso をモック): 空のサイトで全種類が作られマニフェストが書かれる / 既存の `about` ページ・`news` 投稿タイプ・`contact` フォームがあるとそれぞれスキップされ、`news` の投稿とカテゴリも作られない / テーマ設定・サイト説明が設定済みなら上書きしない / マニフェストがあると conflict / 途中 (例: pages.create) で失敗してもそこまでの ID がマニフェストに残る。
- 画像サイズ (各 80 KB 以下・合計 500 KB 以下) をボードの決定に記録。

### 決定

- **注: インストーラはこの後 T32 で core の一括書き込みに作り直した (D1 クエリ上限)。以下の「サービスの conflict を捕まえてスキップ」「`finally` でマニフェスト」は T30 時点の実装の記録。**
- 実装分担: Codex の 1 回目はプロバイダのストリーム切断で変更なし、2 回目は `starterManifestSchema` / `SETTINGS_KEYS.starter` / core の `settings.starter()`・`settings.delete(key)` まで実装したところで、Codex 側の環境で `npx.cmd` が起動できず停止。残り (サンプル定義・インストーラ・テスト) は Claude が実装した。
- 画像: Pillow で生成した抽象画像 7 枚 (緑・砂色・テラコッタ系のグラデーションに同心円・点・波線・角丸を重ねたもの)、WebP、合計 54 KB (最大 `hero.webp` 13 KB)。生成スクリプトはコミットしていない。alt は日本語で [content.ts](../../apps/server/src/starter/content.ts) の `STARTER_IMAGES` に持ち、アップロード時にメディアの alt に入る (セクションの画像は media の alt で描画される)。
- **衝突判定は事前の存在確認ではなく、各サービスの `create` が投げる `KansoError` (`conflict`) を捕まえてスキップする。** 固定ページのパス重複、トップレベル固定ページと投稿タイプのスラッグ衝突 (双方向)、フォームのスラッグ UNIQUE を既存の規則どおりに判定でき、下書きも含む。core に読み出しヘルパーは追加していない。conflict 以外の例外はそのまま失敗させる。
- 入力は API と同じく各 create スキーマ (`createFormSchema` / `createPostTypeSchema` / `createCategorySchema` / `createPostSchema` / `createPageSchema`) で parse してからサービスに渡す (既定値と検証が API 経由と一致する)。`allowRawHtml: false`、フォームは `turnstileAvailable: false` (Turnstile は使わない)。
- マニフェストは `finally` で書く。ただし **何も作っていない段階の失敗 (例: 1 枚目の画像読み込み失敗) では書かない** (空のマニフェストが再投入をブロックしないように)。同時に 2 回投入されるケースの排他はしていない (管理者だけの操作で、事前のマニフェスト確認で通常は防げる)。
- テーマ設定は、現在のテーマの名前空間が未保存または `{}` のときだけ、`sectionValuesSchemaFor` で既定値を補った全フィールド (accent `#2f6f5e`、footer_text、空の SNS ×5) を書く。他テーマの名前空間は保持。サイト説明は `description.trim()` が空のときだけ書く。どちらも書いた値をマニフェストに残す。
- サイト名は投入時点の `settings.site().title` を使う (セットアップでサイト名を省略すると既定の `kansoCMS`)。
- サービスページの先頭は `hero` (見出し「サービス」、画像なし) にした。セクション表示のページはページタイトルを描画しないので、h1 を持たせるため。ホームの固定ページタイトルは「ホーム」(ナビには出ない)。
- 文言の構成: ホーム = hero (見出し = サイト名、紹介文 +「カスタマイズ」の案内、ボタン「お問い合わせ」) → 私たちについて → サービス (画像右) → お知らせ 3 件 → 「お気軽にご相談ください」。会社概要 = ごあいさつ / 画像 / 会社情報 (名称 = サイト名、所在地・営業時間・定休日・電話番号は「（サンプル）」付き) / 書き換えの注意。サービス = hero → サービス A → サービス B (画像右) → 相談 CTA。お問い合わせ = 案内 → フォーム → 返信目安 (サンプル) とフォーム・通知先の編集場所。お知らせ = 「ウェブサイトを公開しました」(2 日前、お知らせ)「ワークショップを開催します」(1 日前、イベント、`/contact` へのリンク)「サイトの編集方法」(投入時刻、お知らせ。カスタマイズ・テーマ設定・固定ページ・お知らせ・フォーム・サンプル削除の場所を案内)。フォーム = お名前 / メールアドレス / ご用件 (ご相談・お見積もり・その他) / お問い合わせ内容。
- テスト: shared `starter.test.ts` 3 件、server `starter/content.test.ts` 6 件 (実スキーマ・default/paper 両テーマのカタログ・`renderRichText` で検証) と `starter/install.test.ts` 6 件 (全作成・衝突スキップ・既存設定の保持・二重投入・途中失敗の記録・何も作る前の失敗で記録しない)。4 ゲート通過 (server 118 / shared 76 / core 62 / admin 10 / seo 5 / create-kanso 47)。実 D1 での投入確認は T31 の API と合わせて行う。

---

## T31. 管理 API とセットアップ時の投入

状態: `done` (2026-11-08)

### ゴール

- 管理者が `POST /api/v1/starter` でサンプルを投入でき、`GET /api/v1/starter` で投入状態を確認できる。初回セットアップ (`POST /api/v1/setup`) で `starter: true` を送るとセットアップと同時に投入される。

### 仕様

- `apps/server/src/api/starter.ts` (admin のみ、`requireRole('admin')`):
  - `GET /` → `{ installed: false }` または `{ installed: true, installedAt, counts: {...}, homePageId: number | null }` (`homePageId` はマニフェスト内のパス `home` のページ。T33 のダッシュボード案内用)。
  - `POST /` → `installStarter` を実行して `201 { created, skipped }`。投入済みなら 409。
- 画像の読み込み: `c.env.ASSETS.fetch(new Request(new URL('/starter/<name>', c.req.url)))`。非 200 は `KansoError` (500 相当) で失敗させる。**実装前に** `@cloudflare/vite-plugin` の dev サーバーで `ASSETS.fetch` が `public/` を返すことを確認し、不可なら代替 (例: Vite のアセット import) を決定に記録する。
- セットアップ: `setupSchema` に `starter: z.boolean().optional()` (API の既定は false。後方互換)。ユーザー作成とサイト名の保存の後に投入する。**投入の失敗でセットアップを失敗させない**: 例外は `console.error` に出し、レスポンス `{ user, starter: { installed: boolean, error?: string } }` で知らせる (セッション Cookie は通常どおり発行)。
- キャッシュ: API の書き込みは既存の `bumpSiteCacheVersion` を通る (setup / starter とも `/api/v1` 配下の POST)。
- `api/index.ts` に `.route('/starter', starter)`。hc の型が admin に流れることを確認 (`.tsx` を import しない)。

### 完了条件

- 共通の完了条件。
- サーバーテスト: GET 未投入/投入済み、POST 201・409・editor ロールは 403、setup `starter: true` で投入が呼ばれる・失敗してもセットアップは 200 で `starter.installed=false`、`starter` 省略時は投入しない。
- **新しいローカル D1** (リポジトリを短いパスに clone、`.wrangler` なし) で `pnpm dev` → `POST /api/v1/setup { starter: true }` → `/`、`/about`、`/services`、`/contact` (フォームが出る)、`/news`、`/news/<slug>` が 200 で中身が出る、画像 (`/media/...`) が 200、ナビ順、フッター文言を確認。

### 決定

- Codex は T30 で 2 回続けて環境要因 (ストリーム切断、`npx.cmd` 起動失敗) で止まったため、T31 は Claude が直接実装した。
- API は [api/starter.ts](../../apps/server/src/api/starter.ts) (`requireRole('admin')`、セッションの admin のみ。API キーは 403)。`GET` の `homePageId` はマニフェストのページを `pages.get` で引いてパス `home` のものを返す (削除済みは無視)。`POST` は `installStarter` の結果を 201 で返し、投入済みは `KansoError.conflict` → 409。
- 画像は [starter/assets.ts](../../apps/server/src/starter/assets.ts) で `env.ASSETS.fetch('<origin>/starter/<name>')` から読む。`@cloudflare/vite-plugin` の dev サーバーでも `public/` を返すことを実地で確認した (代替手段は不要)。**`Request` ではなく URL 文字列を渡す**: このファイルは `api/` 経由で admin の型検査に入り、DOM の `Request` 型が Workers の `Fetcher.fetch` の引数型と合わず admin の typecheck が落ちたため。
- セットアップ: `setupSchema.starter` (任意、API の既定は投入しない)。ユーザー作成 → サイト名保存 → 投入の順 (サイト名が文中に入る)。投入の例外は `console.error` に出してセットアップは 200 で完了し、レスポンスは `{ user, starter: { installed, error } | null }` (`null` は投入を求めなかったとき)。セッション Cookie は失敗時も発行。`createUser` には `starter` / `siteTitle` を渡さないよう、必要なフィールドだけを渡す形に変えた。
- **セットアップにキャッシュ世代の更新を追加した。** `/api/v1/setup` は `protectedApi` の外にあり `bumpSiteCacheVersion` を通っていなかったため、セットアップ前に `/` を開いていると、サンプル投入後も最大 60 秒「kansoCMS is running」のキャッシュが返り得た (サイト名の変更も同様)。setup の POST にだけミドルウェアを付けた。
- テスト: `api/starter.test.ts` 8 件 (未投入/投入済みの GET と homePageId、POST 201・409・editor は 403、setup で投入・サイト名保存が先・キャッシュ世代更新、投入失敗でもセットアップ成功、省略時は投入しない。`installStarter` は `vi.mock` で差し替え)、`starter/assets.test.ts` 2 件。4 ゲート通過 (server 128)。
- 実地確認 (開発用 D1 を退避して空の D1 にマイグレーション、`vite dev --port 5199`): セットアップ前に `/` (「kansoCMS」見出し) を開いてキャッシュさせた後、`POST /api/v1/setup { siteTitle: 'ことのは工房', starter: true }` → `starter.installed=true`、直後の `/` がサンプルのホームに切り替わる (キャッシュ世代更新の確認)。`/`、`/about`、`/services`、`/contact`、`/news`、`/news/{website-launch,workshop,how-to-edit}`、`/news/category/event` が 200。`<title>` はサイト名のみ、meta description はサンプル説明、ナビは 会社概要 → サービス → お問い合わせ → お知らせ、`--color-accent:#2f6f5e`、フッターに案内文 + `© 2026 ことのは工房`。ホームは hero → image-with-text ×2 → post-list (新しい順に 3 件) → cta、画像 3 枚とも `/media/...` が 200 `image/webp`、alt は日本語。会社概要に画像と「（サンプル）」付きの会社情報、サービスは hero → ×2 → cta。お問い合わせのフォームに 4 項目 (ご用件の選択肢 3 つ) が出て、送信すると完了メッセージ、フォーム一覧の送信数 1。`/search?q=ワークショップ` がワークショップの記事にヒット。2 回目の `POST /api/v1/starter` は 409。終了後に開発用 D1 を元に戻した。
- 注意 (検証手順): Git Bash の curl に日本語をコマンドライン引数で渡すと cp932 で送られ、サイト名が化けた。UTF-8 のファイルを `--data-binary @file` で送る。

---

## T32. サンプルの削除

状態: `done` (2026-11-08)

### ゴール

- 管理者が `DELETE /api/v1/starter` でサンプルを片付けられる。運用者が編集したもの・参照しているもの・自分で追加したものは残り、何を残したかが結果でわかる。

### 仕様

- `apps/server/src/starter/remove.ts` の `removeStarter(kanso)`。マニフェストが無ければ 404。
- 削除順と残す条件 (マニフェストにあり、まだ存在するものだけが対象):
  1. 投稿: 編集済み (リビジョンが 1 件以上) なら残す。
  2. カテゴリ: 残った投稿が使っていれば残す。
  3. 投稿タイプ: 投稿が 1 件でも残っていれば残す (運用者が追加した投稿を含む)。
  4. 固定ページ: 編集済み (リビジョンあり) なら残す。マニフェスト外の子ページがあるページも残す。
  5. フォーム: 送信が 1 件以上ある、または作成後に更新されている (`updatedAt > createdAt`) なら残す。
  6. メディア: 残ったページ/投稿/設定から参照されていれば残す。参照 = ページの `sectionsJson` の image フィールド値、`ogMediaId`、投稿の `coverMediaId` / `ogMediaId`、本文 JSON 中の `mediaUrl(r2Key)`、`site.logoMediaId`。マニフェスト外のページ・投稿も含めて全件を見る。
  7. テーマ設定: マニフェストのテーマの名前空間が投入時の値と一致していれば `{}` に戻す。サイト説明も同様に一致していれば空に戻す。
- 結果: `{ removed: { pages, posts, ... }, kept: { kind, id, title, reason: 'edited' | 'in_use' | 'has_submissions' | 'has_children' }[] }`。最後にマニフェストを削除する (残したものは通常のコンテンツとして扱い、再投入はスラッグ衝突でスキップされる)。
- API: `DELETE /api/v1/starter` (admin のみ) → 200 + 結果。

### 完了条件

- 共通の完了条件。
- テスト: 未編集なら全部消えてマニフェストも消える / 編集したページ・投稿が残る / 運用者が `news` に追加した投稿があると投稿タイプが残る / 送信のあるフォームが残る / 残ったページの hero が参照する画像が残る / テーマ設定を変えていたら戻さない / マニフェストなしは 404。
- 実 D1 で: 投入 → ホームの hero 見出しだけ編集 → 削除 → ホームと hero 画像が残り、他は消え、公開 `/about` が 404。

### 決定

- **D1 のクエリ上限への対応 (T30 のインストーラを作り直し)。** 一時的に D1 binding を数えるプロキシを挟んで実測したところ、サービス経由の投入はセットアップ込みで **87 クエリ** だった。Workers Free は 1 呼び出しあたり 50 クエリ (`batch()` は 1 と数える、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)) なので、本番の Free プランではセットアップ時の投入が途中で失敗する。サービス経由の削除も同程度になる見込みだったため、投入・削除とも core の [services/starter.ts](../../packages/core/src/services/starter.ts) に移した。作り直し後の実測は **投入 12 / 削除 21 クエリ** (認証・キャッシュ世代更新を含む 1 リクエスト全体)。計測用のプロキシはコミットしていない。
- 行の値は各サービスの create から切り出した `pageInsertValues` / `postInsertValues` / `formInsertValues` / `postTypeInsertValues` / `categoryInsertValues` / `prepareMediaObject` を共有する (create 自身もこれを使うので、描画 HTML・検索テキスト・既定値がずれない)。ついでに `media.upload` は insert の `returning()` で行を返し、1 件あたり 1 クエリ減った。
- 投入の流れ: マニフェスト確認 → 画像を R2 に put → media 行を 1 batch → `build(media)` で内容を作る → 衝突の読み出し (固定ページのパス / 投稿タイプ / フォーム、サイト・テーマ設定) → **残り全部 (フォーム・投稿タイプ・カテゴリ・投稿・カテゴリ紐付け・固定ページ・テーマ設定・サイト説明・マニフェスト) を 1 つの `db.batch()`** で書く。batch はトランザクションなので内容は全部入るか何も入らないかで、失敗時は media 行と R2 を消して例外を返す (T30 の「途中までをマニフェストに記録」は不要になった)。
- ID は事前に決められない (`AUTOINCREMENT` のため `max(id)+1` は削除済み ID の再利用になり、残っている参照が別のものを指し得る)。batch 内の参照はスラッグのサブクエリで解決する: カテゴリ・投稿の `post_type_id = (select id from post_types where slug = 'news')`、カテゴリ紐付けは `insert … select`、マニフェストは `json_object(…, 'pages', json((select json_group_array(id) …)), …)` を値に入れた **素の insert** (upsert ではない) なので、同時に 2 回投入されても主キー衝突で片方がロールバックする。
- drizzle 0.45 の D1 `batch()` は `db.run(sql)` の項目をパラメータ付きで実行できない (`preparedQuery.stmt` が無く `bind` で落ちる)。生 SQL はクエリビルダー経由 (`insert().select(sql)`、`values({ valueJson: sql\`…\` })`) にした。
- **D1 は LIKE / GLOB のパターンを 50 バイトに制限する。** 本文中のメディア URL (`/media/2026/11/<uuid>.webp`、約 50 バイト) を `like '%…%'` で探すと失敗したので `instr(body_json, url) > 0` にした。
- 衝突判定は純関数 `planStarterInstall` (固定ページと投稿タイプは同じ URL 空間として扱う。予約スラッグは検証エラー)。削除の参照判定も純関数 `referencedMediaIds` で、core にテストを追加 (`services/starter.test.ts` 6 件)。DB を通す部分は実 D1 で確認した (core のテストは DB を持たない)。
- 削除の規則 (実装どおり): 投稿・固定ページは **リビジョンが 1 件でもあれば編集済み** として残す。マニフェスト外の子ページがあるページも残す。投稿タイプは削除しない投稿 (利用者の投稿や編集済みサンプル) が 1 件でもあれば残し、カテゴリは残る投稿タイプの中で残る投稿が使っていれば残す (投稿タイプごと消す場合はカテゴリも消す)。フォームは送信があるか `updatedAt > createdAt` なら残す。メディアは残るページ/投稿 (サンプル以外も含む) の OG・カバー・セクション値・本文 URL とサイトロゴから参照されていれば残す (セクションは値が候補 ID と一致する数値なら参照とみなす保守的な判定)。テーマ設定はその名前空間全体が投入時の値と同じときだけ名前空間ごと消し、サイト説明も投入時と同じときだけ空に戻す。最後にマニフェストを消すので、残したものは通常のコンテンツになり、再投入はスラッグ衝突でスキップされる。削除も 1 つの `db.batch()` で、R2 は batch 成功後に消す。
- API: `DELETE /api/v1/starter` (admin のみ) → `{ removed: counts, kept: { kind, id, title, reason }[] }`。マニフェストなしは 404。件数の型 `StarterCounts` と `starterCounts()` は shared に移した。
- 実地確認 (空の D1): セットアップ時の投入が最初は `db.run` の問題で失敗したが、そのとき作った media 7 件は後片付けされて 0 件だった (失敗時のロールバック確認)。修正後 `POST /api/v1/starter` 201・表示は T31 と同一。続けて、ホーム hero の見出しを編集、`news` に利用者の投稿 (カテゴリ「イベント」) を追加、お問い合わせを 1 件送信、テーマのアクセント色を変更してから `DELETE` → removed = 固定ページ 3・投稿 3・カテゴリ 1 (お知らせ)・メディア 4、kept = ホーム (edited)・お知らせ投稿タイプ (in_use)・イベント (in_use)・フォーム (has_submissions)・hero/about/service-a 画像 (in_use)。`/about` `/services` `/contact` `/news/workshop` は 404、`/` は編集した見出しと画像 3 枚のまま、`/news/my-post` は 200、アクセント色はそのまま、サイト説明は空に戻った。最初の `DELETE` は LIKE の制限で 500 になったが、batch 前の読み出しで落ちたので何も変わっていなかった。その状態 (ホーム・`news`・`contact` フォームあり) で再投入すると form / postType / page `home` がスキップされ固定ページ 3 件と画像 7 件だけが作られ、もう一度の削除で全部消えた。終了後に開発用 D1 を戻した。
- テスト: core 68 (+6)、server 126 (install 3 件に組み替え、API に DELETE と editor 403 を追加)。4 ゲート通過。

---

## T33. 管理画面

状態: `todo`

### ゴール

- 初回セットアップでサンプルを入れるか選べ (既定オン)、後から設定画面で投入・削除でき、投入済みのあいだはダッシュボードに編集の入口が出る。

### 仕様

- `setup.tsx`: チェックボックス「サンプルサイトを入れる」(既定オン)。説明「会社・店舗向けのトップページ、会社概要、お問い合わせフォーム、お知らせを作成します。あとから設定画面で削除できます。」。レスポンスの `starter.installed === false && error` ならダッシュボードへ遷移したうえで設定画面から再投入できる旨を表示 (方法は実装時に決める)。
- 設定画面 (`settings/index.tsx`) に「サンプルサイト」セクション: 未投入なら説明 + 「サンプルサイトを入れる」、投入済みなら投入日時・件数 + 「サンプルを削除」(`ConfirmDialog`: 編集したものや使用中の画像は残る旨)。投入結果の `skipped`、削除結果の `kept` を一覧表示 (理由は日本語)。成功時は `['starter']` と公開表示に関わるクエリ (`['pages']`, `['posts']`, `['post-types']`, `['forms']`, `['media']`, `['settings']`, `['site']`) を invalidate。
- ダッシュボード (`_auth/index.tsx`): 投入済みなら「サンプルサイトが入っています」カード: 「サイトを見る」(`/` を新しいタブ)、「トップページをカスタマイズ」(`/customize?page=<homePageId>`、homePageId が null なら非表示)、「不要になったら設定から削除できます」。
- `queries.ts` に `starterQuery` (key `['starter']`)。

### 完了条件

- 共通の完了条件。
- 実ブラウザ (dev サーバー) で: 設定から投入 → ダッシュボードのカード → カスタマイズでホームが開く → 設定から削除 → カードが消える。新しい D1 でセットアップ画面のチェックボックス既定オン → 投入されたサイトに遷移できる。

### 決定

(実装後に記入)

---

## T34. E2E + ドキュメント

状態: `todo`

### 仕様

- `e2e/starter.spec.ts`: 開始時に `GET /api/v1/starter` が投入済みなら `test.skip` (開発者のサンプルを消さない)。未投入なら 設定画面から投入 → 結果の `created` に応じて公開 `/` のセクション・`/contact` のフォーム・`/news` を検証 → 設定画面から削除 → `created` に含まれていたページが 404 に戻ることを検証。CI は毎回新しい D1 なので常に全ステップが走る。
- `docs/architecture.md`: §4 settings に `starter`、§5 ルートに `/api/v1/starter`、§6 にサンプルサイトの小節 (衝突時スキップ・マニフェスト・削除で残す条件)、§8 に Phase 5 行 (Phase 3 は done、管理画面 i18n は見送り)。
- `README.md`: Getting started に「セットアップ時にサンプルサイトを入れられる / 設定から削除できる」、Status。`packages/create-kanso` が生成する README の手順にも一言 (テンプレートがあれば)。

### 完了条件

- 共通の完了条件 + `pnpm e2e` 全件 green (customize / forms / starter)。

### 決定

(実装後に記入)

---

## 後続候補 (このフェーズの範囲外)

- **既存の不具合 (T32 で発見)**: 管理画面の一覧検索 (`pages` / `posts` / `media` の `q`、`like '%q%'`) は D1 の LIKE パターン上限 50 バイトを超えると 500 になる (日本語でおよそ 17 文字以上。開発サーバーで 20 文字の検索が 500 を返すことを確認)。`instr()` などへの置き換えが必要。公開 `/search` は長い語でも 200 だった。

- セクションカタログとテーマ設定のラベル日本語化 (管理画面が日本語固定になったため、`Hero` / `Heading` などの英語ラベルが浮いている)。
- サンプルの種類を増やす (個人ブログ、飲食店) — 投入時にテンプレートを選ぶ UI。
- headless / Astro 例でのセクション描画。
