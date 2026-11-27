import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { pageRevisionsQuery, postRevisionsQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import type { EditorSave } from '../editing/useEditorSave.ts'
import { MoreActions } from '../MoreActions.tsx'
import { PageHeading } from '../PageHeading.tsx'
import { Alert, Button } from '../ui.tsx'
import { RevisionList } from './RevisionList.tsx'
import { ShareLinks } from './ShareLinks.tsx'

export function ContentRecordFrame({
  kind,
  item,
  heading,
  publicPath,
  typeSlug,
  save,
  reload,
  children,
}: {
  kind: 'page' | 'post'
  item?: { id: number; status: string }
  heading: string
  publicPath?: string
  typeSlug?: string
  save: EditorSave
  reload?: () => Promise<void>
  children: ReactNode
}) {
  const query = useQueryClient()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const id = item?.id ?? 0
  const name = kind === 'page' ? '固定ページ' : '投稿'
  const collection = kind === 'page' ? 'pages' : 'posts'
  const resource = api[collection][':id']
  const param = { id: String(id) }
  const revisions = useQuery({
    queryKey: (kind === 'page' ? pageRevisionsQuery(id) : postRevisionsQuery(id)).queryKey,
    queryFn: () => unwrap(resource.revisions.$get({ param })),
    enabled: Boolean(item),
  })
  const restore = useMutation({
    mutationFn: (revisionId: number) => {
      const request = resource.revisions[':revisionId'].restore.$post({
        param: { ...param, revisionId: String(revisionId) },
      })
      return unwrap<Awaited<typeof request>>(request)
    },
    onSuccess: async () => {
      save.discard()
      setRestoreId(null)
      await reload?.()
    },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(resource.$delete({ param, query: {} })),
    onSuccess: async () => {
      save.discard()
      // A deleted detail can no longer be refetched. Invalidate lists for the next view.
      await query.invalidateQueries({ queryKey: [collection, 'list'] })
      if (kind === 'page') await navigate({ to: '/pages', ignoreBlocker: true })
      else await navigate({ to: '/posts', search: { type: typeSlug }, ignoreBlocker: true })
    },
  })
  const duplicate = useMutation({
    mutationFn: () => {
      const request = resource.duplicate.$post({ param })
      return unwrap<Awaited<typeof request>>(request)
    },
    onSuccess: async ({ item: copy }) => {
      await query.invalidateQueries({ queryKey: [collection, 'list'] })
      await navigate({
        to: kind === 'page' ? '/pages/$id' : '/posts/$id',
        params: { id: String(copy.id) },
        ignoreBlocker: true,
      })
    },
  })
  const busy = remove.isPending || restore.isPending || duplicate.isPending
  const error = remove.error ?? restore.error ?? duplicate.error
  return (
    <>
      <PageHeading
        title={heading}
        actions={
          item && (
            <>
              <a
                href={`/preview/${kind}/${id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                プレビュー
              </a>
              {item.status === 'published' && publicPath && (
                <a href={publicPath} target="_blank" rel="noreferrer" className="text-sm underline">
                  サイトで見る
                </a>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy || save.pending}
                onClick={() => {
                  if (
                    !save.dirty ||
                    window.confirm(
                      '未保存の変更があります。最後に保存した内容を複製して移動しますか？',
                    )
                  )
                    duplicate.mutate()
                }}
              >
                複製
              </Button>
              <MoreActions
                label={`${name}のその他の操作`}
                disabled={busy || save.pending}
                actions={[{ label: 'ゴミ箱へ移動', run: () => setDeleting(true) }]}
              />
            </>
          )
        }
      />
      {error && (
        <Alert tone="error">
          {error instanceof ApiError ? error.message : '処理できませんでした。'}
        </Alert>
      )}
      <div inert={busy}>{children}</div>
      {item && (
        <>
          <ShareLinks kind={kind} id={id} />
          <RevisionList
            items={revisions.data?.items ?? []}
            pending={busy || save.pending}
            onRestore={setRestoreId}
          />
          <ConfirmDialog
            open={restoreId !== null}
            title="この履歴を復元"
            description={
              save.dirty
                ? '編集中の変更は破棄されます。最後に保存した内容は履歴に残ります。'
                : '現在の内容は履歴に保存されます。'
            }
            confirmLabel="復元"
            pending={restore.isPending}
            onClose={() => setRestoreId(null)}
            onConfirm={() => {
              if (restoreId !== null) restore.mutate(restoreId)
            }}
          />
          <ConfirmDialog
            open={deleting}
            title={`${name}をゴミ箱へ移動`}
            confirmLabel="ゴミ箱へ移動"
            description={
              kind === 'page'
                ? 'このページと子ページをゴミ箱へ移動します。ゴミ箱から復元できます。'
                : 'この投稿をゴミ箱へ移動します。ゴミ箱から復元できます。'
            }
            pending={remove.isPending}
            onClose={() => setDeleting(false)}
            onConfirm={() => remove.mutate()}
          />
        </>
      )}
    </>
  )
}
