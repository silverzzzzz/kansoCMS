import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import {
  type PageItem,
  type PageListItem,
  pageQuery,
  pageRevisionsQuery,
  pagesListQuery,
} from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { ContentForm, type ContentFormValue } from '../../../components/content/ContentForm.tsx'
import { RevisionList } from '../../../components/content/RevisionList.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, Field, inputClass } from '../../../components/ui.tsx'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../lib/datetime.ts'
import { descendantIds, flattenPageTree } from '../../../lib/page-tree.ts'

export const Route = createFileRoute('/_auth/pages/$id')({
  // Form state is seeded from the loader, so a new id must mount a fresh component.
  remountDeps: ({ params }) => params.id,
  loader: async ({ context, params }) => {
    const id = Number(params.id)
    await Promise.all([
      context.queryClient.ensureQueryData(pageQuery(id)),
      context.queryClient.ensureQueryData(pageRevisionsQuery(id)),
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
    ])
  },
  component: EditPage,
})

function EditPage() {
  const { id: idParam } = Route.useParams()
  const id = Number(idParam)
  const queryClient = useQueryClient()
  const page = useQuery(pageQuery(id))
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const revisions = useQuery(pageRevisionsQuery(id))
  const item = page.data?.item
  const [formKey, setFormKey] = useState(0)
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const restore = useMutation({
    mutationFn: (revisionId: number) =>
      unwrap(
        api.pages[':id'].revisions[':revisionId'].restore.$post({
          param: { id: String(id), revisionId: String(revisionId) },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      setRestoreId(null)
      setFormKey((key) => key + 1)
    },
  })

  if (!item) return <p>読み込み中…</p>
  return (
    <div>
      {restore.error && (
        <div className="mb-6">
          <Alert tone="error">
            {restore.error instanceof ApiError
              ? restore.error.message
              : '履歴を復元できませんでした'}
          </Alert>
        </div>
      )}
      <EditPageForm key={formKey} id={id} item={item} pages={pages.data?.items ?? []} />
      <RevisionList
        items={revisions.data?.items ?? []}
        pending={restore.isPending}
        onRestore={setRestoreId}
      />
      <ConfirmDialog
        open={restoreId !== null}
        title="この履歴を復元"
        description="現在の内容は履歴に保存されます。"
        confirmLabel="復元"
        pending={restore.isPending}
        onClose={() => setRestoreId(null)}
        onConfirm={() => {
          if (restoreId !== null) restore.mutate(restoreId)
        }}
      />
    </div>
  )
}

function EditPageForm({ id, item, pages }: { id: number; item: PageItem; pages: PageListItem[] }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/pages/$id' })
  const [content, setContent] = useState<ContentFormValue>(() => ({
    title: item.title,
    slug: item.slug,
    status: item.status,
    publishedAt: toDateTimeLocal(item.publishedAt),
    bodyJson: item.bodyJson ?? { type: 'doc', content: [] },
    excerpt: item.excerpt ?? '',
    seoTitle: item.seoTitle ?? '',
    seoDescription: item.seoDescription ?? '',
    ogMediaId: item.ogMediaId,
    noindex: item.noindex,
    canonicalUrl: item.canonicalUrl ?? '',
  }))
  const [parentId, setParentId] = useState<number | null>(item.parentId)
  const [sortOrder, setSortOrder] = useState(item.sortOrder)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.pages[':id'].$patch({
          param: { id: String(id) },
          json: {
            title: content.title,
            slug: content.slug,
            status: content.status,
            publishedAt: fromDateTimeLocal(content.publishedAt),
            bodyJson: content.bodyJson,
            excerpt: content.excerpt.trim() || null,
            seoTitle: content.seoTitle.trim() || null,
            seoDescription: content.seoDescription.trim() || null,
            ogMediaId: content.ogMediaId,
            noindex: content.noindex,
            canonicalUrl: content.canonicalUrl.trim() || null,
            parentId,
            sortOrder,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages' })
    },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.pages[':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages' })
    },
  })
  const errors = fieldErrors(save.error)
  const excluded = descendantIds(pages, id)

  return (
    <div>
      <PageHeading
        title="固定ページを編集"
        actions={
          <>
            <a
              href={`/preview/page/${id}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              プレビュー
            </a>
            {item.status === 'published' && (
              <a
                href={`/${item.path}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                サイトで見る
              </a>
            )}
            <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
              削除
            </Button>
          </>
        }
      />
      {(remove.error || (save.error && Object.keys(errors).length === 0)) && (
        <div className="mt-6">
          <Alert tone="error">
            {(remove.error ?? save.error) instanceof ApiError
              ? (remove.error ?? save.error)?.message
              : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <ContentForm
        value={content}
        onChange={setContent}
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        pending={save.isPending}
        errors={errors}
        editorKey={`page-${id}`}
      >
        <div className="grid gap-5 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Field label="親ページ" error={errors.parentId}>
            <select
              className={inputClass}
              value={parentId ?? ''}
              onChange={(event) =>
                setParentId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">なし</option>
              {flattenPageTree(pages)
                .filter(({ page: option }) => !excluded.has(option.id))
                .map(({ page: option, depth }) => (
                  <option key={option.id} value={option.id}>
                    {'—'.repeat(depth)} {option.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="表示順" error={errors.sortOrder}>
            <input
              className={inputClass}
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value))}
            />
          </Field>
        </div>
      </ContentForm>
      <ConfirmDialog
        open={confirmOpen}
        title="固定ページを削除"
        description="このページを削除します。子ページがある場合は親ページへ昇格します。"
        pending={remove.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
