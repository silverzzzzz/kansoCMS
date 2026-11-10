# Phase 7 タスクボード — SEO 強化

目的: **検索結果と SNS シェアでの見え方を整える。** Phase 6 完了後の SEO レビューで挙がった改善点 (サイト既定 OG 画像なし、`og:locale` が `ja` のまま、子ページのパンくずに親ページが入らない、組織ロゴが URL 手入力、`twitter:site` 欄なし) を片付ける。

運用ルール ([Phase 2](phase-2.md) 以降と同じ):

- 1 タスク = 1 回の実装ラン。順番に進め、各タスク完了時に `pnpm typecheck && pnpm check && pnpm test && pnpm build` を通し、スモークテストしてから次へ。
- 仕様の正本はこのファイル。実装中に決めたことは各タスクの「決定」に追記する。
- 共通の約束 (コード規約・層の責務・エラー・secret・禁止事項・マイグレーション) は [phase-2.md の「共通の約束」](phase-2.md#共通の約束-全タスク) をそのまま適用する。
- 状態: `todo` / `in-progress` / `review` / `done`

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T40 | 既定 OG 画像、`og:locale` 正規化、パンくずの祖先ページ | done | shared, core, seo, server, admin |
| T41 | 組織ロゴのメディア選択、`twitter:site` | done | shared, core, seo, server, admin |

Phase 7 の決定事項:

1. **既定 OG 画像は `site.ogImageMediaId` に持ち、`ctx.meta()` でフォールバックする** (T40)。設定画面の「サイト」フォームからメディアを選ぶ。詳しくは T40 の決定。
2. **`og:locale` は `Intl.Locale.maximize()` で `language_TERRITORY` に正規化する** (T40)。`@kanso/seo` の `toOgLocale()` に集約し、テーマは気にしない。
3. **組織ロゴは `organization.logoMediaId`、X アカウントは `organization.twitterHandle`** (T41)。`logoUrl` は廃止。ロゴ未選択ならサイトロゴを使う。
4. Phase 7 の実装は Devin が直接行った。

---

## T40. 既定 OG 画像、`og:locale` 正規化、パンくずの祖先ページ

状態: `done` (2026-11-11)

### ゴール

- OG 画像を設定していないページ・一覧でも `og:image` が出る。
- `og:locale` が `ja_JP` など OGP の `language_TERRITORY` 形式になる (素の `ja` は Facebook 等に無視される)。
- 子ページの `BreadcrumbList` に公開済みの祖先ページが入る。

### 仕様

- `siteSettingsSchema` に `ogImageMediaId` (nullable int, 既定 null)。`PUT /api/v1/settings/site` は既存どおりスキーマ検証のみ。管理画面「設定 → サイト」にロゴと同じ `MediaField` を追加する。
- `loadSiteContext()` が `ogImageMediaId` を `kanso.media.find` で解決し、`ctx.meta()` は呼び出し側の `ogImage` が `null` / `undefined` のときだけ既定画像を使う。ページ (`ogMediaId`) と投稿 (`ogMediaUrl ?? カバー画像`) が常に優先。
- `@kanso/seo` に `toOgLocale(locale)` を追加し、`<Head>` の `og:locale` に使う。
- `pages.listPublishedAncestors(page)` (公開済み・ルート順) を追加し、`renderPage` の `BreadcrumbList` がサイト名と自ページの間に祖先を挟む。

### 完了条件

- 共通の完了条件 + `pnpm typecheck && pnpm check && pnpm test` green。
- `/company/team` のような子ページで `BreadcrumbList` が「サイト → 祖先… → ページ」になる。

### 決定

- **既定 OG 画像**: フォールバックは `ctx.meta()` に置いた。`renderPage` / `renderPost` は `ogImage: null` を明示するが `null ?? default` で既定に落ちるため、結果としてホーム・一覧・検索・404・プレビューにも既定画像が出る。`noindex` ページへの出力は許容した。
- **`og:locale`**: `Intl.Locale.maximize()` が言語からありそうな地域を補う (`ja` → `ja-Jpan-JP` → `ja_JP`、`en` → `en_US`)。OGP は `language_TERRITORY` の 2 要素なのでスクリプト subtag は捨てる (`zh-TW` → `zh_TW`)。`es-419` のような数値リージョンはそのまま出す。パース不能な入力は従来どおり `-` → `_` 置換だけで通す。
- **祖先パンくず**: 公開済みページの `{id, parentId, path, title}` を 1 クエリで取り、`parentId` をルート方向にたどる。非公開・存在しない祖先で連鎖を打ち切り (その先の祖先も含めない)、循環していても `visited` で止まる。祖先が `home` パスなら URL は `/` を指す。
- スターター削除のメディア保持判定に `site.ogImageMediaId` を参照として追加 (設定値は残るので、その画像を消さない)。
- テスト: `packages/seo` に `meta.test.ts` (`toOgLocale` の変換表 + 不正入力)、`routes.test.ts` に `og:locale`、既定 OG 画像のフォールバックと優先順位、祖先入り `BreadcrumbList` の JSON-LD を追加。実行: 全 workspace 414 件 green、typecheck / biome clean。

## T41. 組織ロゴのメディア選択、`twitter:site`

状態: `done` (2026-11-11)

### ゴール

- 組織ロゴを URL 手入力ではなくメディアから選べる。
- 設定で X (Twitter) アカウントを入れると `twitter:site` が出る。

### 仕様

- `organizationSettingsSchema`: `logoUrl` (URL 文字列) を `logoMediaId` (nullable int) に置き換え、`twitterHandle` を追加。管理画面「設定 → 組織」にロゴの `MediaField` と「X アカウント」入力。
- `loadSiteContext()` が `organization.logoMediaId ?? site.logoMediaId` をメディアから解決し、`SiteContext.organization.logoUrl` (絶対 URL) に入れる。`twitterSite` は `ctx.meta()` が `@handle` 形式で全ページの `PageMeta` に入れ、`<Head>` が `twitter:site` を出す。
- スターター削除のメディア保持判定に `organization.logoMediaId` を参照として追加。

### 完了条件

- 共通の完了条件 + `pnpm typecheck && pnpm check && pnpm test` green。
- 管理画面からロゴをメディア選択でき、X アカウントを入れたサイトで `twitter:site` が出る。

### 決定

- **ロゴは `organization.logoMediaId` に置き換え、既存の `logoUrl` 値は破棄する。** 設定は zod で検証する JSON 行で、移行機構を持たないため。値は管理画面で選び直せる。組織ロゴが未選択なら **サイトロゴ (`site.logoMediaId`) にフォールバック** する (小さなサイトはロゴを 1 箇所に置くだけで済む)。`SiteContext.organization.logoUrl` は解決済みの絶対 URL を保持し、`@kanso/seo` の `buildOrganization` は変更不要。
- **`twitterHandle` は `organization` に持たせ、`@` なしで保存する。** スキーマが `/^@?[A-Za-z0-9_]{0,15}$/` を検証してから `transform` で先頭 `@` を除く (入力は `@` 付きでも可)。発行側は常に `@handle` で出す。`sameAs` の URL から推測する方式は取らなかった (暗黙の挙動より明示的な設定欄が分かりやすいため)。
- `twitter:site` は組織名の有無に関わらず出る (Organization JSON-LD の発行条件とは切り離した)。
- テスト: `shared/settings.test.ts` に `twitterHandle` の正規化と不正値、`routes.test.ts` に `twitter:site`、Organization `logo` (直接選択とサイトロゴへのフォールバック) を追加。

---

## 後続候補 (このフェーズの範囲外)

- `og:image:width` / `og:image:height` (media テーブルに寸法列はある)、`og:image:alt`。
- 画面上のパンくず表示 (今回足したのは JSON-LD のみ。テーマ側の表示要素として出すかは別途検討)。
