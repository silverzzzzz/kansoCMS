import { slugify } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { type CategoryItem, categoriesQuery } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { flattenPageTree } from '../lib/page-tree.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Alert, Button, Field, inputClass } from './ui.tsx'

export function CategoryManager({ typeId }: { typeId: number }) {
  const queryClient = useQueryClient()
  const categories = useQuery(categoriesQuery(typeId))
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [parentId, setParentId] = useState<number | null>(null)
  const [editing, setEditing] = useState<CategoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [deleting, setDeleting] = useState<CategoryItem | null>(null)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['post-types', 'categories', typeId] })
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api['post-types'][':typeId'].categories.$post({
          param: { typeId: String(typeId) },
          json: { name, slug, parentId, sortOrder: 0 },
        }),
      ),
    onSuccess: async () => {
      setName('')
      setSlug('')
      setSlugEdited(false)
      setParentId(null)
      await invalidate()
    },
  })
  const update = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api['post-types'][':typeId'].categories[':id'].$patch({
              param: { typeId: String(typeId), id: String(editing.id) },
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
        ? unwrap(
            api['post-types'][':typeId'].categories[':id'].$delete({
              param: { typeId: String(typeId), id: String(deleting.id) },
            }),
          )
        : Promise.reject(new Error('削除対象がありません')),
    onSuccess: async () => {
      setDeleting(null)
      await invalidate()
    },
  })
  const error = create.error ?? update.error ?? remove.error
  const rows = flattenPageTree(
    (categories.data?.items ?? []).map((item) => ({ ...item, title: item.name })),
  )

  return (
    <section className="mt-10 border-t border-neutral-300 pt-8">
      <h2 className="text-lg font-semibold">カテゴリ管理</h2>
      {error && (
        <div className="mt-4">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : 'カテゴリを処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className="mt-5 grid gap-4 border border-neutral-200 bg-white p-5 sm:grid-cols-3"
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
        <Field label="親カテゴリ">
          <select
            className={inputClass}
            value={parentId ?? ''}
            onChange={(event) =>
              setParentId(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">なし</option>
            {rows.map(({ page, depth }) => (
              <option key={page.id} value={page.id}>
                {'—'.repeat(depth)} {page.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={create.isPending}>
            カテゴリを追加
          </Button>
        </div>
      </form>
      <div className="mt-5 divide-y divide-neutral-200 border border-neutral-200 bg-white">
        {rows.map(({ page, depth }) => (
          <div key={page.id} className="p-4" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
            {editing?.id === page.id ? (
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
                  <Button type="submit" size="small" disabled={update.isPending}>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-medium">{page.name}</span>{' '}
                  <span className="ml-2 text-neutral-500">{page.slug}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setEditing(page)
                      setEditName(page.name)
                      setEditSlug(page.slug)
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="danger"
                    onClick={() => setDeleting(page)}
                  >
                    削除
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="カテゴリを削除"
        description={`${deleting?.name ?? ''} を削除します。投稿で使用中の場合は削除できません。`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
      />
    </section>
  )
}
