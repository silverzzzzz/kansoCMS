# Phase 13 タスクボード — 守りと運用の強化 (EmDash との比較から)

目的: **公開したサイトを、荒らされにくく、壊れにくく、戻しやすくする。** EmDash (`emdash-cms/emdash`、2026-11-19 時点の `a689fd1`) と比べて「入れるべき」「入れる価値がある」とした項目を全部入れる (ユーザー判断: 「1-4 と入れる価値があるものを全部入れて」)。

運用ルールは [phase-11.md](phase-11.md) と同じ (各タスクで 4 ゲート + 実サーバーのスモーク、複数行を書く経路はクエリ数を記録、実 DB のテストを書く)。

| # | タスク | 状態 | 範囲 |
|---|---|---|---|
| T70 | レート制限 (ログイン・セットアップ・登録リンク・公開フォーム) | done | core, server, admin |
| T71 | セキュリティヘッダー (メディア配信の sandbox、管理画面の CSP) | done | shared, server, admin, e2e |
| T72 | 上書き事故の防止 (古い版からの保存を拒否) | done | shared, core, server, admin |
| T73 | 見つからなかった URL の記録と 410 | done | shared, core, server, admin |
| T74 | robots.txt の AI 学習拒否スイッチ | done | shared, server, admin |
| T75 | 毎日のバックアップを R2 に保存 | done | core, server, admin |
| T76 | 依存とCIの強化、SECURITY.md | todo | .github, pnpm, docs |
| T77 | デプロイ時の D1 / R2 の自動作成 | todo | server, docs, create-kanso |
| T78 | アクセシビリティ検査 (axe) を E2E に入れる | done | e2e, admin, server |

Phase 13 の決定事項:

1. **無料プランで動く範囲に収める** (Phase 11・12 と同じ)。追加のリソース (KV・Durable Objects・Queues) は使わない。レート制限も D1 の表で数える。
2. **方針外のものは入れない**: スキーマビルダー、コンテンツの多言語化、プラグイン、同時編集、公開ページ上での直接編集、外部 IdP・メールのログインリンク、5 段階の権限。
3. Phase 13 の実装は Claude が行う。T76 の実装と T77 の調査は Claude のサブエージェントに任せ、差分は Claude が確かめてから入れる。

---

## T70. レート制限

状態: `done` (2026-11-20)

### ゴール

- 誰でも呼べる書き込み系のエンドポイントを、1 つの IP から短時間に大量に呼べないようにする。いまはログイン開始 (`POST /api/v1/auth/passkey/options`) が呼ぶたびに D1 に 1 行書き、公開フォームは Turnstile が既定でオフなので、連投されると送信と通知メールが増え続ける。
- `docs/architecture.md` の「(任意) Workers Rate Limiting binding」という記述は実装がないので、実装に合わせて直す。

### 仕様

- D1 の表 `rate_limits` (キー・窓の開始時刻・回数) で、固定窓で数える。1 回の判定は 1 文の upsert (`INSERT … ON CONFLICT DO UPDATE … RETURNING`)。
- キーは「種類 + IP の SHA-256」。IP は `CF-Connecting-IP`。ヘッダーがない (Cloudflare の外) ときは数えない。
- 上限: 認証まわり (パスキーのログイン・登録リンク・セットアップの POST) は 10 分に 30 回、公開フォームの送信 (JSON API と HTML フォーム) は 10 分に 10 回。honeypot に引っかかった送信は数えない。
- 超えたら 429 と `Retry-After`。API は `{ error: { code: 'rate_limited' } }`、HTML フォームはフォームの上にメッセージを出して 429。管理画面のログイン・セットアップ・登録リンク画面は日本語で案内する。
- 古い行は毎日の定期処理で消す。

### 完了条件

- 4 ゲート green。実 DB のテストで、上限の手前まで通り、超えると 429、窓が変わると戻る、IP ごとに別に数える、を確かめる。実サーバーで 429 を確かめる。

### 決定

- **D1 の表で数える** (`rate_limits`、マイグレーション `0018_rate_limits.sql`)。Workers の Rate Limiting binding は使わない (決定 1 のとおり D1 だけで済ませる。binding は Cloudflare の拠点ごとに数えるので、拠点をまたぐ要求は合算されない)。1 回の判定は `INSERT … ON CONFLICT(key) DO UPDATE SET count = CASE WHEN 同じ窓 THEN count + 1 ELSE 1 END … RETURNING count` の 1 文 (テストで 1 往復を固定)。窓が変わっても同じ行を使うので、行の数は「種類 × IP」で頭打ちになる。
- キーは `種類:SHA-256(IP) の先頭 16 バイト`。IP そのものは保存しない (行は定期処理で 1 日以内に消える)。
- 上限は `apps/server/src/rate-limit.ts` の `RATE_LIMITS`: 認証まわり 10 分 30 回 (ログイン・登録リンク・セットアップの options と検証の 6 つの POST で共有。1 回の試行は 2 リクエスト)、フォーム 10 分 10 回。セットアップはトークンの照合より前に数えるので、トークンの総当たりにも効く。
- **`CF-Connecting-IP` がない要求は数えない**。Cloudflare は転送するすべての要求にこのヘッダーを付ける (クライアントが送った値は上書きされる)。ローカルの開発サーバーは付けないことを実サーバーで確かめた (ヘッダーなしの 35 回がすべて 200、行も増えない)。おかげで E2E と開発中のログインは制限に掛からない。
- フォームは honeypot の判定の後、Turnstile の検証 (外部への要求) の前に数える。honeypot に掛かった送信は何も書かないので数えない。
- `KansoError` に `rate_limited` (429) を足した。`details.retryAfter` (秒) をエラー処理が `Retry-After` に移す。HTML フォームは 429 で再描画し、メッセージ (`messages.form.rateLimited`、日本語と英語) と入力値を残す。管理画面のログイン・登録リンク・セットアップは 429 を日本語で案内する (`passkeyErrorMessage`)。
- 定期処理は `window_start` が 1 日より古い行を消す (`rateLimitRows`)。
- テスト: core `rate-limits.test.ts` (4 件)、`housekeeping.test.ts` (+1)、server `rate-limit.test.ts` (7 件。実 DB と実ルートで、ログイン 31 回目の 429 と `Retry-After`、別 IP、ヘッダーなし、登録リンクとセットアップの共有、フォームの JSON と HTML、honeypot)。
- 実サーバー (ローカル D1、`:5201`): ログイン開始 30 回は 200、31 回目は 429 (`Retry-After: 475`)、別 IP は 200、同じ IP のセットアップも 429。フォームは JSON・HTML とも 11 回目で 429、HTML はメッセージと入力値を表示。

---

## T71. セキュリティヘッダー

状態: `done` (2026-11-20)

### ゴール

- アップロードされたファイルを直接開いても、そのページでスクリプトが動かないようにする (多層防御)。
- 管理画面に CSP を付け、読み込めるものを自サイトに限り、他サイトへの埋め込みを禁じる。

### 仕様

- `/media/*`: 画像には `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox` を付ける。PDF は Chrome が sandbox の文書では表示しないので付けない (許可リストに SVG・HTML がないので、PDF はブラウザの PDF ビューアで開くだけ)。
- 管理画面 (`/admin/*`): `default-src 'self'`、`script-src 'self'`、`style-src 'self' 'unsafe-inline'`、`img-src 'self' data: blob:`、`connect-src 'self'`、`frame-src 'self'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'self'`、`frame-ancestors 'none'` を基本に、実際の画面で違反が出ないことを確かめて決める。Static Assets が返す `/admin/index.html` には Worker のヘッダーが付かないので、`public/_headers` でも同じ値を付ける (値は 1 か所で定義し、テストで一致を確かめる)。

### 完了条件

- 4 ゲート green。E2E と実サーバーで、管理画面の主要な画面に CSP 違反が出ないことを確かめる。

### 決定

- **PDF も sandbox にした** (仕様から変更)。仕様では「Chrome は sandbox の文書で PDF を表示しない」としていたが、確かめると誤りだった。同じ PDF を sandbox の CSP あり・なしで開くと、Chrome 157 (通常モード)・Edge 157・Firefox 155 (pdf.js) のどれも同じように表示した。headless の Chrome は PDF ビューアを持たないので、通常モードの Chrome を画面外で起動して確かめた。メディアの CSP は `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox` を全ファイルに付ける。
- **既存の不具合を直した: 別オリジンから画像を埋め込めなかった**。Hono の `secureHeaders` は既定ですべての応答に `Cross-Origin-Resource-Policy: same-origin` を付けるので、headless のフロントエンド (例: `examples/astro-blog` のように CMS の画像 URL をそのまま使うサイト) の `<img>` をブラウザが拒んでいた。実ブラウザで別オリジンのページから読み込み、変更前は `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` (幅 0)、変更後は表示 (幅 40) を確かめた。`secureHeaders` はハンドラーの後で値を上書きするため、CORP だけは `secureHeaders` から外し、応答に値がなければ `same-origin` を補うミドルウェアに替えた。`/media` は `cross-origin`。
- **管理画面の CSP** (`ADMIN_CSP`): `script-src 'self'` (inline も eval もなし)、`frame-ancestors 'none'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`connect-src 'self'`。カスタマイズのプレビューは `srcdoc` の iframe (スクリプトなし) で、親の CSP を引き継ぐため、公開ページの見た目を保つようにスタイル・画像・フォント・メディア・フレームは `https:` も許した (サイトの head HTML の Web フォントや、生 HTML ブロックの埋め込み)。`base-uri` は最初 `'none'` にしたが、プレビューが `<base href="(サイトの origin)/">` を入れていて違反になったので `'self'` にした。
- **zod の eval の検査**: 管理画面のカスタマイズ画面で `script-src eval` の違反が 1 件出た。出どころはバンドルの `Function('')` で、zod 4 が高速化のために `new Function` を使えるかを試す処理 (失敗は握りつぶすが、ブラウザは違反として報告する)。zod の `jitless` を有効にすると試さない。最初は `@kanso/shared` の index から設定したが、index を読み込む途中で検査が走るため効かなかった。`@kanso/shared/zod-config` (zod だけを読み込む) を `main.tsx` の最初で読み込んで解決した。
- **静的ファイルにも付ける**: Static Assets は `/admin/` と `/admin/index.html` を Worker より先に返すので、`apps/server/public/_headers` に同じ CSP を書いた (テストで `ADMIN_CSP` との一致を確認)。`vite build` の出力 (`dist/client/_headers`) と `vite preview` で付くことを確かめた。`vite dev` は `_headers` を適用しない (開発中に `/admin/` を開いたときだけ CSP なし。直接開いたクライアント側のルートは Worker が付ける)。
- 実ブラウザ (`vite preview`、新しい D1、仮想パスキーでセットアップ): 管理画面 19 画面すべてに CSP が付き、違反は 0 件、ページのエラーも 0 件。固定ページの編集画面とカスタマイズのプレビュー (テーマの CSS が効いた状態で表示) も違反なし。
- テスト: server `security-headers.test.ts` (5 件。`_headers` と `ADMIN_CSP` の一致、SPA fallback、画像と PDF の CSP と CORP、ほかの応答の `same-origin`)。E2E `security-headers.spec.ts` (主な 6 画面を直接開き、握りつぶされた違反も `securitypolicyviolation` で拾って 0 件を確かめる)。E2E 全体 20 件が通過。

---

## T72. 上書き事故の防止

状態: `done` (2026-11-20)

### ゴール

- 2 人 (または 2 つのタブ) が同じ固定ページ・投稿を開いて保存したとき、後から保存した人が、先に保存された内容を気づかずに消さないようにする。

### 仕様

- 固定ページ・投稿の更新 API (`PATCH`) に任意の `baseUpdatedAt` (開いたときの `updatedAt`) を足す。現在の `updatedAt` と違えば 409 (`code: 'stale'`)。送らなければ今までどおり (API 利用者に影響しない)。
- 管理画面の編集画面は、開いたとき・保存に成功したときの `updatedAt` を送る。409 のときは「開いたあとに別の画面で更新されました」と出し、「最新を読み込む (自分の変更は捨てる)」と「このまま上書きする」を選べるようにする。

### 完了条件

- 4 ゲート green。実 DB のテストと、実サーバーで 2 つのタブを使って確かめる。

### 決定

- **比較は書き込み前の読み出しで行う** (`assertUnchangedSince`、`packages/core/src/errors.ts`)。`update` が最初に行を読むので、追加のクエリはない。1 文で比べる (UPDATE の WHERE に入れる) 方式は、リビジョンの追加・リダイレクトの作成など同じ batch のほかの文も止める必要があり複雑になるので採らなかった。2 つの保存が同じ瞬間 (読み出しと書き込みの間) に届いた場合までは防がないが、人の操作では起きにくい。
- **秒単位で比べる**。`updated_at` は unix 秒で保存しているので、クライアントがミリ秒付きで送っても秒に切り捨てて比べる。同じ秒の中で「開く → 別の保存 → 保存」が起きた場合は検出できない。
- 違反は新しいエラーコード `stale` (409)。既存の `conflict` (スラッグの重複など) と区別して、管理画面が専用の案内を出せるようにした。
- **管理画面は、編集を始めたときの版を固定して送る**。最初は保存時の `item.updatedAt` を送っていたが、TanStack Query は既定でウィンドウにフォーカスが戻ると読み直す (`refetchOnWindowFocus`、`staleTime` 0) ので、別のタブで保存された後に戻ってくると基準も新しくなり、保護が効かなくなる。フォームを初期化した時点の値を `useState` に固定した。
- 対象: 固定ページと投稿の編集画面、カスタマイズ (セクションの保存。保存に成功するたびに基準を更新する)。409 のときは「最新の内容を読み込む (この画面の変更は破棄)」と「このまま上書き保存」(`baseUpdatedAt` なしで送り直す) を出す (`StaleSaveNotice`)。ページ一覧の並べ替えなど、`baseUpdatedAt` を送らない更新は今までどおり。
- テスト: core `stale-save.test.ts` (4 件。古い版からの更新の拒否と書き込みなし (リビジョンも増えない)、ミリ秒付きの基準、基準なし、投稿)、server `stale-save.test.ts` (2 件。HTTP 409 `stale`、上書き、不正な値は 400)。
- 実ブラウザ (`vite preview`、新しい D1): 同じ固定ページを 2 つのタブで開き、A が保存した後の B の保存は止まって案内が出る (公開中のタイトルは A のまま)。「このまま上書き保存」で B の内容になる。もう一度、A の保存後に B が「最新の内容を読み込む」を押すと A の内容が表示され、そこからの保存は通る。E2E 20 件 (カスタマイズの保存を含む) が通過。

---

## T73. 見つからなかった URL の記録と 410

状態: `done` (2026-11-20)

### ゴール

- サイト移行やスラッグ変更で切れたリンクを、管理画面で見つけてリダイレクトできるようにする。
- 消したページを「削除済み (410)」として検索エンジンに伝えられるようにする。

### 仕様

- 公開サイトの GET が 404 になったパスを、表 `not_found_paths` (パス・回数・初回・最終) に数える (`waitUntil`)。クエリ文字列は外し、長すぎるパスは数えない。30 日見かけないパスと、最終日時が古い順に 1,000 件を超えた分は毎日の定期処理で消す。
- リダイレクトの種類に 410 を足す (転送先なし)。410 のパスはテーマの 404 と同じ見た目で「削除されました」と 410 を返す。CSV インポートとエクスポート / インポートも 410 を扱う。
- 管理画面「リダイレクト」に「見つからなかった URL」を足す: 回数・最終日時の一覧、「リダイレクトを作る」「410 にする」「一覧から消す」。リダイレクトを作ったパスは一覧から消える。

### 完了条件

- 4 ゲート green。実 DB のテストと、実サーバーで 404 → 記録 → リダイレクト作成、410 の応答を確かめる。

### 決定

- **数えるのは「何も答えないパス」だけ**。公開サイトの `missing()` (固定ページ・投稿タイプ・カテゴリ・タグ・著者のどれでもなく、リダイレクトもない) で数える。ページ送りの範囲外 (`/news?page=9`) のように、パスは存在するが 404 になるものは数えない (一覧に「news」が出ると誤解を招く)。GET だけ (フォームの POST は数えない)。ログイン中のスタッフやボットも数える (検索エンジンが拾った切れたリンクも直したいので)。
- パスは `redirects.from_path` と同じ正規化 (先頭・末尾の `/` なし、クエリ文字列なし) で保存し、一覧からそのままリダイレクトを作れる。300 文字を超えるパスは数えない (ほぼ機械的な探索)。
- 1 回の 404 で upsert 1 文を `waitUntil` で書く。行が増え続けないよう、定期処理で 30 日見かけないものと、最終アクセスが古い順に 1,000 件を超えた分を消す (同じ batch)。アクセス解析と同じく、行数ではなく書き込み回数は攻撃者が増やせる (公開ページの閲覧と同じ扱い)。
- 記録の失敗はリクエストを壊さない。最初はサービスを直接呼んでから `.catch` していたため、同期的な例外 (テストのモックにサービスがない) で 404 の応答ごと失敗した。呼び出しを `Promise.resolve().then(...)` の中に入れた。
- **410 は「リダイレクト」の種類の 1 つ** (表を増やさない)。`to` は空文字。共有スキーマが「410 は転送先なし、301/302 は URL かパスが必須」を検証する。部分更新で 410 にすると転送先は空になり、410 から戻すときは転送先が必要 (サービスで判定)。CSV は `/old,,410`。エクスポート / インポートの形式も 410 と空の転送先を受け付ける (往復のテストに 410 のルールを足した)。
- 410 の応答はテーマの外枠に組み込みの「削除されました」(`messages.gone`、日本語と英語) と `noindex`。カスタム 404 ページは使わない (「見つかりません」の文面になるため)。
- リダイレクトを作る (手動・CSV・更新) と、そのパスは一覧から消える (同じ batch)。CSV は 100 行ずつの batch に `IN` (100 個以内のバインド変数) の削除を足した。
- 管理画面「リダイレクト」: 種類に「410 削除済み」(転送先の欄は無効)、「見つからなかった URL」の一覧 (回数の多い順、50 件ずつ)。「リダイレクトを作る」は上のフォームに転送元を入れて転送先にフォーカスを移す。「410 にする」「一覧から消す」「すべて消す」(確認あり)。
- テスト: shared `redirects.test.ts` (+3)、core `not-found.test.ts` (6 件。正規化と upsert 1 往復、長いパス、並び順と削除、リダイレクト・410・CSV で消えること、410 への切り替えと戻し、30 日と 1,000 件の掃除)、`transfer.import.test.ts` (410 の往復)、server `not-found.integration.test.ts` (4 件。クエリ文字列を除いた集計、ページ送り範囲外とフォームの POST は数えない、410 の応答、API の削除)。
- 実ブラウザ (`vite preview`、新しい D1): 未ログインで `/old-campaign` (クエリ付きを含めて 2 回) と `/discontinued-item` を開くと一覧に 2 件。`/old-campaign/` (末尾 `/`) は 301 で数えない。「リダイレクトを作る」→ 転送先 `/` → 追加で `/old-campaign` は 301、「410 にする」で `/discontinued-item` は 410 と削除のメッセージ。一覧は空になった。E2E 20 件が通過。

---

## T74. robots.txt の AI 学習拒否スイッチ

状態: `done` (2026-11-20)

### ゴール

- サイトの文章を AI の学習に使わないでほしい、という意思を robots.txt で示せるようにする (検索には載せたまま)。

### 仕様

- サイト設定に `disallowAiTraining` (既定オフ) を足す。オンのとき、`User-agent: *` のグループに `Content-Signal: search=yes, ai-train=no` を入れ、主な学習用クローラー (Cloudflare の管理 robots.txt と同じ一覧) を `Disallow: /` にする。
- 管理画面の設定 (検索エンジン向けの欄) にチェックボックスを足す。

### 完了条件

- 4 ゲート green。オン・オフそれぞれの robots.txt をテストと実サーバーで確かめる。

### 決定

- 一覧は EmDash と同じく Cloudflare の管理 robots.txt に載っている学習用クローラー 8 種 (`AI_TRAINING_CRAWLERS`: Amazonbot、Applebot-Extended、Bytespider、CCBot、ClaudeBot、Google-Extended、GPTBot、meta-externalagent)。検索用のクローラー (Googlebot、Bingbot など) は入れない。
- `Content-Signal` は既存の `User-agent: *` のグループの中に置く。EmDash は `*` のグループをもう 1 つ作り、空の `Disallow:` で閉じているが、kansoCMS の `*` グループには元から `Disallow` 行があるので 1 つにまとめた (グループが 2 つあると、解釈の違うクローラーで結合のされ方が変わる)。追加ルール (`robotsExtra`) と `Sitemap:` はその後ろ。
- 既定はオフ。設定画面には「従うかどうかはクローラー次第」と書いた (robots.txt は強制力を持たない)。
- テスト: server `robots.integration.test.ts` (2 件。既定では何も出ない、オンのときの全文)。実ブラウザ (`vite preview`、新しい D1): 設定でチェックして保存すると、次の robots.txt から反映された (キャッシュの世代が更新されるため)。再読み込みしてもチェックは残る。

---

## T75. 毎日のバックアップを R2 に保存

状態: `done` (2026-11-20)

### ゴール

- 誤って消した内容を、30 日のゴミ箱や D1 の Time Travel とは別に、手元に持ち出せる形で戻せるようにする。

### 仕様

- 毎日の定期処理で、エクスポートと同じ JSON (設定を含む) を R2 の `backups/` に保存し、新しい 7 世代を残す。`/media/*` からは見えない場所に置く。
- 管理者だけが使える API でバックアップの一覧とダウンロードを用意し、管理画面の「ツール」に一覧とダウンロードを出す。戻すときは既存のインポートを使う。
- 含まないもの (エクスポートと同じ): 画像ファイル、ユーザー、API キー、フォームの送信。README とバックアップの節に書く。

### 完了条件

- 4 ゲート green。定期処理のテストで保存と世代の削除を確かめ、実サーバーで定期処理を起動してダウンロードしたファイルをインポートできることを確かめる。

### 決定

- **置き場所はサーバー側** (`apps/server/src/backups.ts`)。エクスポートはテーマのセクション定義 (`sectionFieldsOf`、サーバー側) を受け取るので、core ではなくサーバーで組み立てる。
- 名前は `backups/kanso-YYYYMMDD-HHMMSS.json` (UTC)。名前の順が時刻の順になり、URL とファイル名にそのまま使える。保存のたびに一覧を取り、新しい 7 件より古いものを消す。`/media/*` は `media/` のキーしか返さないので、同じバケットに置いても公開されない (テストと実サーバーで確認)。
- **定期処理は掃除 → バックアップの順に、別々に `try`** (`runDaily`)。片方が失敗してもログ (`{"level":"error","job":…}`) を出してもう片方を続ける。成功は操作ログに書かない (毎日 1 行増えるだけなので)。手動の「今すぐバックアップ」は操作ログに残す。
- API は管理者のセッションだけ (`requireRole('admin')`): 設定を含むため、エクスポートで設定を出せるのが管理者だけなのと合わせた。ダウンロードは `GET /api/v1/backups/:name` (名前を正規表現で確かめてから R2 を読む。`attachment`、`no-store`)。
- 戻し方は新しい仕組みを作らず、既存の「インポート」(大きいファイルは自動で分割) を使う。
- 1 回のバックアップの D1 往復は 13 (テストで実測。上限 20 で固定)。定期処理全体でも Workers Free の 50 に十分収まる。CPU 時間 (無料プランの上限) は本番で確かめていない。
- テスト用の R2 (`createTestBucket`) に `list` とアップロード日時を足した。
- テスト: server `backups.test.ts` (7 件。名前、`backups/` だけに保存され `/media` から読めない、7 件を残す、掃除が失敗してもバックアップは書く、API の一覧・作成・ダウンロード・不正な名前、編集者は 403)。
- 実サーバー (`vite preview`、新しい D1、サンプルサイトあり): `/cdn-cgi/handler/scheduled` で定期処理を起動するとバックアップが 1 件 (14.8 KB) でき、「今すぐバックアップ」で 2 件。ダウンロードしたファイルは固定ページ 4・投稿 3・設定入りで、未ログインは 401、`/media` 経由は 404。同じサイトにインポートすると新規 0・更新 0 (変化なし)。E2E 20 件が通過。

---

## T76. 依存と CI の強化、SECURITY.md

状態: `todo`

### ゴール

- 公開リポジトリとして、依存パッケージの乗っ取りや CI 経由の攻撃に備える。脆弱性の報告窓口を用意する。

### 仕様

- `pnpm-workspace.yaml`: 公開から 1 日たっていない版を入れない (`minimumReleaseAge`)、信頼度が下がった版を入れない (`trustPolicy`)、怪しい取得元の間接依存を拒む (`blockExoticSubdeps`)。
- GitHub Actions: アクションをコミットの SHA で固定、権限を最小に、checkout の認証情報を残さない。
- Dependabot (週 1 回、まとめて提案、公開から数日待つ)、CodeQL と zizmor (ワークフローの検査)。
- `SECURITY.md`: GitHub の非公開の脆弱性報告で受け付ける。

### 完了条件

- `pnpm install --frozen-lockfile` が通る。zizmor の指摘がない。ワークフローは push 後に GitHub で動くことを確かめる。

### 決定

---

## T77. デプロイ時の D1 / R2 の自動作成

状態: `todo`

### ゴール

- 本番デプロイの「D1 を作って ID を貼る」「R2 を作る」手順をなくし、本家リポジトリに本物の ID をコミットしてしまう心配も減らす。

### 仕様

- wrangler の自動作成 (ID のない binding をデプロイ時に作る) が kansoCMS の構成 (Vite プラグイン、マイグレーション、`passkey:link`、ローカル開発) で使えるか調べてから決める。使えるなら `wrangler.jsonc`・`docs/deploy.md`・`AGENTS.md`・README・create-kanso を合わせて直す。

### 完了条件

- ローカルと `--dry-run` で確かめられる範囲を確かめ、実アカウントでしか確かめられないことを明記する。

### 決定

---

## T78. アクセシビリティ検査 (axe)

状態: `done` (2026-11-20)

### ゴール

- 管理画面と公開サイトの主な画面に、機械的に見つかるアクセシビリティの問題がない状態を保つ。

### 仕様

- `@axe-core/playwright` を E2E に入れ、公開サイト (ホーム・固定ページ・投稿・404) と管理画面 (ログイン・ダッシュボード・一覧・編集・設定) を検査する。重大度 serious / critical をなくす。見つかった問題は直す。

### 完了条件

- 4 ゲート green。E2E が通る。

### 決定

- `@axe-core/playwright` 4.14.0 (axe-core 4.14.1) をルートの devDependencies に入れた。T76 の `minimumReleaseAge` と `trustPolicy` のもとで入った。依存を 1 つ足すとルートの依存の peer がまとめて解決し直され、lockfile では任意の peer (`@types/node`、`supports-color`) の付いたキーに書き換わった (約 200 行)。lockfile を戻して入れ直しても同じになる。`@types/node` はルートの `node_modules` に現れず (以前 shared / seo の型検査に混ざった問題は起きない)、型検査も通るので、そのまま受け入れた。
- 検査対象: 公開サイト (固定ページ・投稿・検索・404)、ログイン画面、管理画面の 20 画面 (ダッシュボード、操作ログ、アクセス解析、固定ページの一覧・編集、カスタマイズ、メニュー、投稿の一覧・ゴミ箱・新規、投稿タイプ、タグ、メディア、フォーム、リダイレクト、ツール、設定、ユーザー、API キー、アカウント)。WCAG 2.1 A/AA のルールで、重大度 serious / critical があれば失敗する。全画面を見てから失敗するので、1 回の実行ですべての指摘が出る。
- カスタマイズのプレビュー (スクリプトの動かない sandbox の `srcdoc` iframe) は検査から外した (`exclude`)。axe はこの iframe の中にもスクリプトを入れようとして応答を待ち続け、テストが時間切れになった。中身は公開ページなので、公開ページの検査で別に確かめている。`disableFrame` は `@axe-core/playwright` 4.14 にはなく、`exclude` した iframe には入らないことをソースで確かめた。
- 直したもの (見つかった 7 件):
  - コントラスト: ページ背景 (neutral-100) の上の `text-neutral-500` は 4.5:1 に届かない (白の上なら届く)。ダッシュボードのサイト名、固定ページ・投稿の一覧の「一覧 / ゴミ箱」の切り替えとゴミ箱の説明、ユーザー画面の説明、カスタマイズの「テーマ: …」を `text-neutral-600` にした。フォームの補足文 (`Field` の `hint`) はページ背景にも白い枠にも置かれるので、共通部品の色を `text-neutral-600` にした。
  - 本文エディター (Tiptap) の編集領域に名前がなかった: `aria-label="本文"`。`aria-multiline` は付けると「その role では使えない属性」になったので外した。
  - カスタマイズのページ切り替えのセレクトに名前がなかった: `aria-label="編集するページ"`。
- 自動検査で見つかるのは問題の一部で、これは退行を防ぐためのもの。画面読み上げやキーボード操作の実地確認はしていない。
- E2E 23 件 (検査 3 件を含む) が通過。
