import { slugify } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { type TagItem, tagsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState, Field, inputClass } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/tags/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(tagsQuery()),
  component: TagsPage,
})

function TagsPage() {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [editing, setEditing] = useState<TagItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [deleting, setDeleting] = useState<TagItem | null>(null)
  const tags = useQuery(tagsQuery(search || undefined))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tags'] })
  const create = useMutation({
    mutationFn: () => unwrap(api.tags.$post({ json: { name, slug } })),
    onSuccess: async () => {
      setName('')
      setSlug('')
      setSlugEdited(false)
      await invalidate()
    },
  })
  const update = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.tags[':id'].$patch({
              param: { id: String(editing.id) },
              json: { name: editName, slug: editSlug },
            }),
          )
        : Promise.reject(new Error('編集対象がありません')),
    onSuccess: async () => {
      setEditing(null)
      await invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      deleting
        ? unwrap(api.tags[':id'].$delete({ param: { id: String(deleting.id) } }))
        : Promise.reject(new Error('削除対象がありません')),
    onSuccess: async () => {
      setDeleting(null)
      await invalidate()
    },
  })
  const error = create.error ?? update.error ?? remove.error ?? tags.error

  return (
    <div>
      <PageHeading title="タグ" description="投稿に付ける横断的な分類を管理します。" />
      {error && (
        <div className="mt-6">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className="mt-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(input.trim())
        }}
      >
        <label className="sr-only" htmlFor="tag-search">
          タグを検索
        </label>
        <input
          id="tag-search"
          className={`${inputClass} mt-0 max-w-md`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="名前またはスラッグで検索"
        />
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      <form
        className="mt-6 grid gap-4 border border-neutral-200 bg-white p-5 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label="名前">
          <input
            className={inputClass}
            value={name}
            required
            onChange={(event) => {
              const next = event.target.value
              setName(next)
              if (!slugEdited) setSlug(slugify(next))
            }}
          />
        </Field>
        <Field label="スラッグ">
          <input
            className={inputClass}
            value={slug}
            required
            onChange={(event) => {
              setSlugEdited(true)
              setSlug(event.target.value)
            }}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>
            追加
          </Button>
        </div>
      </form>
      <div className="mt-6">
        {tags.data?.items.length === 0 ? (
          <EmptyState>タグはありません。</EmptyState>
        ) : (
          <div className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
            {tags.data?.items.map((tag) => (
              <div key={tag.id} className="p-4">
                {editing?.id === tag.id ? (
                  <form
                    className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                    onSubmit={(event) => {
                      event.preventDefault()
                      update.mutate()
                    }}
                  >
                    <label className="text-xs font-medium">
                      名前
                      <input
                        className={`${inputClass} mt-1`}
                        value={editName}
                        required
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </label>
                    <label className="text-xs font-medium">
                      スラッグ
                      <input
                        className={`${inputClass} mt-1`}
                        value={editSlug}
                        required
                        onChange={(event) => setEditSlug(event.target.value)}
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <Button type="submit" size="small">
                        保存
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => setEditing(null)}
                      >
                        取消
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm">
                      <span className="font-medium">{tag.name}</span>
                      <span className="ml-3 text-neutral-500">{tag.slug}</span>
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => {
                          setEditing(tag)
                          setEditName(tag.name)
                          setEditSlug(tag.slug)
                        }}
                      >
                        編集
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        onClick={() => setDeleting(tag)}
                      >
                        削除
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="タグを削除"
        description={`${deleting?.name ?? ''} を削除します。`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
