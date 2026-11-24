# kansoCMS MCP 操作仕様（AI エージェント向け）

## 接続と権限

`https://<サイトのホスト>/api/mcp` に MCP クライアントの **Streamable HTTP** トランスポートで接続する。クライアントの認証情報から、各リクエストに `Authorization: Bearer <CMS API key>` を付ける。接続情報の設定は [利用者向けガイド](mcp.md) を参照。

接続後、`tools/list` でそのキーが利用できるツールと `inputSchema` を取得する。`read` では下表の読み取り 3 件、`write` では全 5 件が返る。ツールの実行は `tools/call` を使う。キーはリクエストごとに検証される。

| ツール | スコープ | 引数 | 成功時のデータ |
| --- | --- | --- | --- |
| `list_content` | `read` または `write` | 必須 `kind`。任意 `q`、`status`、`page`、`perPage` | `{items, total, page}`。各項目は `id, title, slug, status, publishedAt` |
| `get_content` | `read` または `write` | `kind, id` | `id, title, slug, status, excerpt, body`。固定ページには `sections` も含む |
| `list_post_types` | `read` または `write` | `{}` | `{id, name, slug}` の配列 |
| `create_page_draft` | `write` | `title, slug, body` | 新規の最上位固定ページの `{id, title, slug, status}` |
| `create_post_draft` | `write` | `postTypeId, title, slug, body` | 新規投稿の `{id, title, slug, status}` |

**結果の読み方**　成功時は MCP 結果の `content[0].text` に JSON が入る。`isError: true` の場合は本文をエラーメッセージとして扱う。クライアントが返すプロトコルエラーや HTTP エラーも処理する。

## 検索・取得の例

「料金の固定ページを要約して」という依頼では、まずタイトルを検索する。以下の JSON はそれぞれ `tools/call` の `params`。

```json
{"name":"list_content","arguments":{"kind":"page","q":"料金","page":1,"perPage":10}}
```

`kind` は `page`（固定ページ）または `post`（投稿）。`q` はタイトルの部分一致で、指定時は前後の空白を除いて 1〜200 文字。`page` は 1 始まり（既定 1）、`perPage` は 1〜100（既定 20）。続きが必要なら `page × perPage < total` の間、ページ番号を増やす。

`status` は `draft`、`published`、`scheduled` のいずれか。予約公開は「`status` が `published` かつ `publishedAt` が未来」の項目で、`scheduled` 指定時も結果内の `status` は `published` になる。公開中かを判断するときは `publishedAt` も確認する。

候補が複数あればタイトルとスラッグで照合する。検索結果が固定ページ ID `7` だった場合の取得例を示す。実際は結果から選んだ `kind` と `id` を使う。

```json
{"name":"get_content","arguments":{"kind":"page","id":7}}
```

`body` はリッチテキストの文書データ。セクションを使う固定ページでは `sections` にも表示内容があるので、要約時に読む。

## 下書き作成の例

投稿を依頼されたら、投稿タイプ名を CMS の ID に解決する。

```json
{"name":"list_post_types","arguments":{}}
```

返った配列で希望する投稿タイプの ID が `3` だった場合の例。該当するタイプがない場合やどのタイプか特定できない場合は、取得した候補を利用者に伝える。

```json
{"name":"create_post_draft","arguments":{"postTypeId":3,"title":"春のお知らせ","slug":"spring-news","body":"4 月の営業日をお知らせします。\n土曜日も通常どおり営業します。"}}
```

固定ページの場合は直接作成できる。

```json
{"name":"create_page_draft","arguments":{"title":"春の営業案内","slug":"spring-hours","body":"4 月から土曜日も営業します。"}}
```

- `id` と `postTypeId` は正の整数。`title` は前後の空白を除いて 1〜200 文字。`slug` は 1〜120 文字で、半角小文字の英字・数字・ハイフンを使い、先頭と末尾は英数字にする。
- 作成時の `body` は必須のプレーンテキストで、上限は 32,000 文字。改行ごとに段落になる。ツールには仕様表にある引数だけを渡す。MCP のリクエスト本文全体の上限は 256 KiB。
- 両作成ツールとも戻り値の `status` は `draft`。結果の `id`、`title`、`slug` を利用者に返す。既存記事の編集、公開、削除は管理画面で行う。
- 作成ツールは非冪等。タイムアウトやスラッグ重複時は、同じ `kind` とタイトルで `list_content` を呼び、スラッグと本文を照合する。確認できるまで同じ作成要求を再送しない。

## エラー時の判断

| 結果 | 取る操作 |
| --- | --- |
| HTTP `401` | キーが欠落・無効・失効している。利用者に接続設定でキーを確認してもらう。 |
| HTTP `403` | `Origin` を送る場合は接続先と同じオリジンが必要。別オリジンのブラウザーから直接呼んでいる場合は、サーバー側の MCP クライアントを使う。 |
| HTTP `405` | クライアントのトランスポートと URL を確認する。このルートが受け付けるメソッドは `POST`。 |
| ツールが見つからない | `tools/list` を取り直す。読み取りキーで作成を頼まれた場合は、必要な `write` 権限を利用者に伝える。 |
| `isError: true`、入力エラー | エラー文とツールのスキーマを確認する。別のスラッグやタイトルで再作成する前に、利用者が依頼した内容と照合する。 |
