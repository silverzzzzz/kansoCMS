import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import {
  categoriesQuery,
  postQuery,
  postTypesQuery,
  type TagItem,
  tagsQuery,
} from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { ContentForm, type ContentFormValue } from '../../../components/content/ContentForm.tsx'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { TagInput } from '../../../components/TagInput.tsx'
import { Alert, Button } from '../../../components/ui.tsx'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../lib/datetime.ts'
import { flattenPageTree } from '../../../lib/page-tree.ts'

export const Route = createFileRoute('/_auth/posts/$id')({
  remountDeps: ({ params }) => params.id,
  loader: async ({ context, params }) => {
    const post = await context.queryClient.ensureQueryData(postQuery(Number(params.id)))
    await Promise.all([
      context.queryClient.ensureQueryData(postTypesQuery),
      context.queryClient.ensureQueryData(categoriesQuery(post.item.postTypeId)),
      context.queryClient.ensureQueryData(tagsQuery()),
    ])
  },
  component: EditPostPage,
})

function EditPostPage() {
  const id = Number(Route.useParams().id)
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/posts/$id' })
  const post = useQuery(postQuery(id))
  const types = useQuery(postTypesQuery)
  const allTags = useQuery(tagsQuery())
  const item = post.data?.item
  const type = types.data?.items.find((candidate) => candidate.id === item?.postTypeId)
  const categories = useQuery({ ...categoriesQuery(item?.postTypeId ?? 0), enabled: Boolean(item) })
  const [content, setContent] = useState<ContentFormValue>(() => ({
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    status: item?.status ?? 'draft',
    publishedAt: toDateTimeLocal(item?.publishedAt ?? null),
    bodyJson: item?.bodyJson ?? { type: 'doc', content: [] },
    excerpt: item?.excerpt ?? '',
    seoTitle: item?.seoTitle ?? '',
    seoDescription: item?.seoDescription ?? '',
    ogMediaId: item?.ogMediaId ?? null,
    noindex: item?.noindex ?? false,
    canonicalUrl: item?.canonicalUrl ?? '',
  }))
  const [coverMediaId, setCoverMediaId] = useState<number | null>(item?.coverMediaId ?? null)
  const [categoryIds, setCategoryIds] = useState<number[]>(item?.categoryIds ?? [])
  const [selectedTags, setSelectedTags] = useState<TagItem[]>(() =>
    (allTags.data?.items ?? []).filter((tag) => item?.tagIds.includes(tag.id)),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.posts[':id'].$patch({
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
            coverMediaId,
            categoryIds,
            tagIds: selectedTags.map((tag) => tag.id),
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['posts'] })
      await navigate({ to: '/posts', search: { type: type?.slug } })
    },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.posts[':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['posts'] })
      await navigate({ to: '/posts', search: { type: type?.slug } })
    },
  })
  const errors = fieldErrors(save.error)
  if (!item || !type) return <p>読み込み中…</p>
  const categoryRows = flattenPageTree(
    (categories.data?.items ?? []).map((category) => ({ ...category, title: category.name })),
  )
  return (
    <div>
      <PageHeading
        title="投稿を編集"
        actions={
          <>
            <a
              href={`/preview/post/${id}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              プレビュー
            </a>
            {item.status === 'published' && (
              <a
                href={`/${type.slug}/${item.slug}`}
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
        editorKey={`post-${id}`}
      >
        <section className="grid gap-6 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <MediaField label="カバー画像" value={coverMediaId} onChange={setCoverMediaId} />
          {type.hasCategories && (
            <fieldset>
              <legend className="text-sm font-medium">カテゴリ</legend>
              <div className="mt-2 space-y-2">
                {categoryRows.map(({ page, depth }) => (
                  <label
                    key={page.id}
                    className="flex items-center gap-2 text-sm"
                    style={{ marginLeft: `${depth * 1.25}rem` }}
                  >
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(page.id)}
                      onChange={(event) =>
                        setCategoryIds(
                          event.target.checked
                            ? [...categoryIds, page.id]
                            : categoryIds.filter((categoryId) => categoryId !== page.id),
                        )
                      }
                    />
                    {page.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {type.hasTags && (
            <div className="sm:col-span-2">
              <TagInput value={selectedTags} onChange={setSelectedTags} />
            </div>
          )}
        </section>
      </ContentForm>
      <ConfirmDialog
        open={confirmOpen}
        title="投稿を削除"
        description="この投稿を削除します。"
        pending={remove.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
