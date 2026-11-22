# Phase 14 タスクボード — セキュリティレビューの指摘への対応

目的: **2026-11-22 のセキュリティレビュー (公開している OSS としての点検) で見つかった問題を直す。** ユーザー判断: 「まず依存のセキュリティリスクを解消して」。残りの項目の順番はユーザーと決める。

運用ルールは [phase-11.md](phase-11.md) と同じ (各タスクで 4 ゲート + 実サーバーのスモーク)。

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T79 | 依存パッケージの既知の脆弱性をなくし、`pnpm audit` を CI で回す | done | pnpm, admin, example, create-kanso, .github, docs |
| T80 | 認証なしの API の入力の上限 (本文のサイズ、返す検証エラーの件数) | todo | server |
| T81 | `read` の API キーでフォームの送信内容と操作ログを読めないようにする | todo | server, docs |
| T82 | `.env.*` を git の管理と create-kanso のコピーから外す | todo | create-kanso, repo |

GitHub 側はユーザーの操作が要る: 手元のコミット (Phase 13 と Phase 14) の push、非公開の脆弱性報告 (Private vulnerability reporting) の有効化、`main` の保護 (強制 push と削除の禁止)。

---

## T79. 依存パッケージの既知の脆弱性

状態: `done` (2026-11-22)

### ゴール

- `pnpm audit` の指摘 (critical 1 / high 17 / moderate 31 / low 9) をなくし、新しい指摘に気づけるようにする。

### 仕様

- 直接の依存を、修正の入った版以上に上げる: hono ≥ 4.13.16、zod ≥ 4.6.6、vite ≥ 8.3.3、vitest ≥ 5.0.3、Astro の例の astro ≥ 7.4.7。
- 間接の依存は、依存元の範囲の中で lockfile だけを上げる。範囲が古い版に固定しているものに限り、理由を書いて `overrides` で置き換える。
- `.github/workflows/security.yml` に `pnpm audit` のジョブを足す。

### 完了条件

- `pnpm audit` が 0 件。4 ゲート、E2E、Astro の例のビルドが通る。

### 決定

- 上げた版 (どれも公開から 1 日以上たっていて、`minimumReleaseAge` と `trustPolicy` に掛からなかった):
  - hono 4.13.7 → 4.13.19 (server, admin)、zod 4.6.1 → 4.6.7 (server, core, shared)、vite 8.3.0 → 8.3.8 (server, admin)、vitest 5.0.0 → 5.1.1 (ルート)。
  - Astro の例: astro 5.18.2 → 7.4.13、`@astrojs/check` 0.9.10 → 0.9.12。Astro 5 が持ち込んでいた古い版 (vite 6、esbuild 0.27、sharp 0.34、zod 3、smol-toml 1.8) は lockfile から消えた。TanStack Router のプラグインの zod も 4.6.7 にまとまった。
- 間接の依存は `pnpm update -r <名前>` で、依存元の範囲の中だけ上げた: seroval 1.6.7 → 1.8.2 (seroval-plugins 1.8.0。TanStack Router の中)、source-map-js 1.2.1 → 1.2.4、undici 8.11.0 → 8.13.1 (Astro のフォント処理の中)、fast-uri 3.1.8 → 3.1.9 (`@astrojs/check` の中)。この手順での lockfile の変更はこの 4 つだけだった。ほかの lockfile の変更は版の更新と Astro の部分の入れ替えで、TanStack Router のプラグインの任意の peer (rolldown) は Astro が持ち込む新しい版に解決された。
- `overrides` は 1 つだけ: `'@esbuild-kit/core-utils>esbuild': ^0.25.4`。drizzle-kit 0.31 は `@esbuild-kit/esm-loader` を依存に書いているが、コードからは読み込んでいない (配布物を検索して確認。最新の 0.31.11 も同じ依存)。その core-utils が esbuild を ~0.18.20 に固定しているので、drizzle-kit 自身が使う 0.25 系 (0.25.12) に置き換えた。
- **Node.js の下限を 22.16 → 26 にした** (ルートと create-kanso の `engines`、CI、README、`docs/deploy.md`、Astro の例と create-kanso の README、create-kanso が作るサイトの README)。
  - 最初のコミット (468ea0b) では Astro 7 の要件どおり 22.23.4 にした。Astro の CLI は古い Node では止まり、ルートの `pnpm typecheck` は例の `astro check` を含み、create-kanso は例ごとコピーするため。報告を見たユーザーの判断で、LTS の 26 に揃えた。
  - 26 は 2026-10-28 (26.13.0) から LTS。T79 の確認はもともと手元の 26.13.0 で行っていた。CI (gates、e2e、audit) は 24 → 26。
  - lockfile の全パッケージの `engines` が 26 を満たす。例外は sharp の 32 ビット Windows 用パッケージ (`^20.9.0`) だけで、ほかの環境には入らない。
  - `engine-strict` は付けていない。古い Node では pnpm が「Unsupported engine」と警告するが、インストールは止めない (下限を 27 にして 26.13.0 で確認)。
  - create-kanso の README と、create-kanso が作るサイトの README は「Node.js 22+」のままだった (最初のコミットでの直し漏れ) ので、一緒に直した。作る README のテストに `Node.js 26+` を足した。
- **hono の型の変更への対応**: hono 4.13 の途中から、RPC クライアントの型 (`JSONParsed`) は、展開中の型が再び出てきたところを `JSONValue` にする (無限に展開しないため)。固定ページと投稿の本文 (`RichTextDoc`) はリスト項目の中身でブロックを再帰するので、管理画面の型検査が通らなくなった。`apps/admin/src/api/queries.ts` の `getPage` / `getPost` で `bodyJson` の型を `RichTextDoc | null` (保存している列の型) に戻した。実行時の動きは変わらない。
- `security.yml` に `audit` ジョブを足した: push、PR、毎週月曜 06:00 UTC。lockfile だけを読み (インストールしない)、重大度に関係なく 1 件でも指摘があれば失敗する。GitHub の依存グラフは pnpm 12 の lockfile を読めず Dependabot の脆弱性アラートが来ないので、その代わり。zizmor 1.32.0 で指摘 0 件 (pedantic で出る「ジョブに名前がない」は既存のジョブと同じ書き方)。
- 文書: AGENTS.md に「`pnpm audit` は 0 件を保つ。直し方」、README の Security 節に audit ジョブ、Astro の例の README・README の例の説明・`docs/architecture.md` の決定事項の Astro の版。
- 確かめたこと:
  - `pnpm audit`: 58 件 → 0 件。
  - 4 ゲート green (テスト 691 件、Phase 13 と同じ数)。`astro check` はエラー 0。
  - E2E 23/23 (別の作業フォルダ、新しいローカル D1)。
  - Astro の例: 同じ作業フォルダの開発サーバーにスターターコンテンツを入れて read キーを作り、`astro build` で 9 ページ (投稿 3、固定ページ 4、一覧、404) を生成。本文、ナビゲーション、CMS の絶対 URL の画像 (取得して 200)、フォームの注記への置き換えを確認し、API キーが出力に含まれないことも確かめた。`astro dev` でも一覧・投稿・固定ページが 200、存在しないパスは 404 ページ。
  - レビューで見つけた「認証なしの API で検証エラーが大量に返る」件: zod 4.6.7 は配列の上限を先に調べるので、5,000 個の null を送ったときのエラーは 5,001 件 → 1 件になった (zod 単体で確認)。本文のサイズと返すエラーの件数の上限は T80 で入れる。
  - Node 26 への変更 (手元の 26.13.0): 4 ゲート (テスト 691 件)。create-kanso で作ったサイトの `engines` (`>=26`)、README、CI の Node の版。zizmor の指摘 0 件。
- 確かめていないこと: GitHub 上での `audit` ジョブの実行と、CI を Node 26 で回すこと (どちらも push 後に動く)。Astro の例を実際の静的ホストに置くこと。
