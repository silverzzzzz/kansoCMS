import type { StarterCounts, StarterKeptReason } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { starterQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { Alert, Button } from '../ui.tsx'

const countLabels: Record<keyof StarterCounts, string> = {
  pages: '固定ページ',
  posts: '投稿',
  postTypes: '投稿タイプ',
  categories: 'カテゴリ',
  tags: 'タグ',
  forms: 'フォーム',
  media: '画像',
}

const kindLabels: Record<string, string> = {
  page: '固定ページ',
  post: '投稿',
  postType: '投稿タイプ',
  category: 'カテゴリ',
  form: 'フォーム',
  media: '画像',
}

const keptReasonLabels: Record<StarterKeptReason, string> = {
  edited: '編集済み',
  in_use: '使用中',
  has_children: '子ページあり',
  has_submissions: '送信あり',
}

export function formatStarterCounts(counts: StarterCounts): string {
  const parts = (Object.keys(countLabels) as (keyof StarterCounts)[])
    .filter((key) => counts[key] > 0)
    .map((key) => `${countLabels[key]} ${counts[key]}`)
  return parts.length > 0 ? parts.join('・') : 'なし'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/**
 * Install or remove the starter site. `onChanged` runs after either, once the
 * caches are invalidated, so the page can re-seed forms that show settings
 * the starter site writes (the site description).
 */
export function StarterSection({ onChanged }: { onChanged: () => void }) {
  const queryClient = useQueryClient()
  const status = useQuery(starterQuery)
  const [confirming, setConfirming] = useState(false)
  // Only the latest outcome is shown.
  const [last, setLast] = useState<'install' | 'remove' | null>(null)

  async function refresh() {
    // Pages, posts, media, forms, settings and the section catalog all change.
    await queryClient.invalidateQueries()
    onChanged()
  }

  const install = useMutation({
    mutationFn: () => unwrap(api.starter.$post()),
    onMutate: () => setLast('install'),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.starter.$delete()),
    onMutate: () => setLast('remove'),
    onSuccess: async () => {
      setConfirming(false)
      await refresh()
    },
  })

  const data = status.data
  const busy = install.isPending || remove.isPending

  return (
    <section className="mt-8 space-y-5 border border-neutral-200 bg-white p-5">
      <h2 className="text-lg font-semibold">サンプルサイト</h2>
      {status.error && <Alert tone="error">状態を取得できませんでした。</Alert>}

      {last === 'install' && install.data && (
        <Alert tone="success">
          サンプルサイトを作成しました ({formatStarterCounts(install.data.created)})。
          {install.data.skipped.length > 0 && (
            <>
              {' '}
              次の項目は同じ URL やスラッグのものが既にあるため作成しませんでした:
              <ul className="mt-2 list-disc pl-5">
                {install.data.skipped.map((item) => (
                  <li key={`${item.kind}:${item.slug}`}>
                    {kindLabels[item.kind]} <code>{item.slug}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Alert>
      )}
      {last === 'remove' && remove.data && (
        <Alert tone="success">
          サンプルを削除しました ({formatStarterCounts(remove.data.removed)})。
          {remove.data.kept.length > 0 && (
            <>
              {' '}
              次の項目は残しました:
              <ul className="mt-2 list-disc pl-5">
                {remove.data.kept.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    {kindLabels[item.kind]}「{item.title}」({keptReasonLabels[item.reason]})
                  </li>
                ))}
              </ul>
            </>
          )}
        </Alert>
      )}
      {last === 'install' && install.error && (
        <Alert tone="error">
          {errorMessage(install.error, 'サンプルサイトを作成できませんでした。')}
        </Alert>
      )}
      {last === 'remove' && remove.error && (
        <Alert tone="error">{errorMessage(remove.error, 'サンプルを削除できませんでした。')}</Alert>
      )}

      {data?.installed ? (
        <>
          <p className="text-sm leading-6 text-neutral-700">
            {new Date(data.installedAt).toLocaleString('ja-JP')} に作成したサンプルが入っています (
            {formatStarterCounts(data.counts)})。
          </p>
          <p className="text-sm leading-6 text-neutral-600">
            不要になったら削除できます。編集したページや記事、使用中の画像、送信のあるフォーム、記事を追加した投稿タイプは残ります。
          </p>
          <div className="flex justify-end border-t border-neutral-200 pt-5">
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              サンプルを削除
            </Button>
          </div>
        </>
      ) : data ? (
        <>
          <p className="text-sm leading-6 text-neutral-700">
            会社・店舗向けのトップページ、会社概要、サービス、お問い合わせフォーム、お知らせ 3
            件と画像を作成します。同じ URL やスラッグのものが既にある項目は作成しません。
          </p>
          <div className="flex justify-end border-t border-neutral-200 pt-5">
            <Button disabled={busy} onClick={() => install.mutate()}>
              {install.isPending ? '作成中…' : 'サンプルサイトを入れる'}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-neutral-500">読み込み中…</p>
      )}

      <ConfirmDialog
        open={confirming}
        title="サンプルを削除しますか?"
        description="まだ編集していないサンプルのページ・記事・フォーム・画像を削除します。編集したもの、使用中の画像、送信のあるフォームは残ります。この操作は元に戻せません。"
        confirmLabel="削除"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      />
    </section>
  )
}
