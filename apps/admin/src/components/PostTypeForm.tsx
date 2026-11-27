import { type SectionField, slugify } from '@kanso/shared'
import { type ReactNode, useState } from 'react'
import { fieldErrors } from '../api/errors.ts'
import { SaveBar } from './editing/SaveBar.tsx'
import { useEditorSave } from './editing/useEditorSave.ts'
import { SlugField, TextareaField, TextField } from './fields.tsx'
import { PostFieldsEditor } from './PostFieldsEditor.tsx'
import { inputClass } from './ui.tsx'

type PostTypeDraft = {
  name: string
  slug: string
  description: string
  hasCategories: boolean
  hasTags: boolean
  noindex: boolean
  fields: SectionField[]
  sortOrder: number
}
const empty: PostTypeDraft = {
  name: '',
  slug: '',
  description: '',
  hasCategories: true,
  hasTags: true,
  noindex: false,
  fields: [],
  sortOrder: 0,
}

export function PostTypeForm({
  categoryManager,
  initial,
  initialSaved = false,
  onSave,
}: {
  categoryManager?: ReactNode
  initial?: PostTypeDraft
  initialSaved?: boolean
  onSave: (input: PostTypeDraft) => Promise<void | (() => Promise<void>)>
}) {
  const [draft, setDraft] = useState(initial ?? empty)
  const [manualSlug, setManualSlug] = useState(Boolean(initial))
  const change = <K extends keyof PostTypeDraft>(key: K, value: PostTypeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = useEditorSave({ value: draft, onSave, initialSaved, isNew: !initial })
  const errors = fieldErrors(save.error)
  return (
    <>
      <form
        ref={save.formRef}
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save.submit()
        }}
      >
        <SaveBar save={save} error={Object.values(errors)[0]} />
        <fieldset
          disabled={!initial && save.pending}
          className="min-w-0 space-y-5 border border-neutral-200 bg-white p-5"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="名前"
              error={errors.name}
              value={draft.name}
              required
              maxLength={100}
              onChange={(event) => {
                const name = event.target.value
                setDraft((current) => ({
                  ...current,
                  name,
                  slug: manualSlug ? current.slug : slugify(name),
                }))
              }}
            />
            <SlugField
              label="スラッグ"
              error={errors.slug}
              value={draft.slug}
              required
              onChange={(event) => {
                setManualSlug(true)
                change('slug', event.target.value)
              }}
            />
          </div>
          <TextareaField
            label="説明"
            error={errors.description}
            value={draft.description}
            rows={4}
            maxLength={500}
            showCount
            onChange={(event) => change('description', event.target.value)}
          />
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.hasCategories}
                onChange={(event) => change('hasCategories', event.target.checked)}
              />
              カテゴリを使う
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.hasTags}
                onChange={(event) => change('hasTags', event.target.checked)}
              />
              タグを使う
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.noindex}
                onChange={(event) => change('noindex', event.target.checked)}
              />
              アーカイブを検索エンジンに登録しない
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            一覧ページ (/{draft.slug || 'スラッグ'} とカテゴリ・タグの一覧)
            に適用します。投稿自体は投稿ごとの SEO 設定で制御します。
          </p>
          <PostFieldsEditor
            errors={errors}
            fields={draft.fields}
            onChange={(fields) => change('fields', fields)}
          />
          <TextField
            label="表示順"
            error={errors.sortOrder}
            className={`${inputClass} max-w-xs`}
            type="number"
            value={draft.sortOrder}
            onChange={(event) => change('sortOrder', Number(event.target.value))}
          />
        </fieldset>
      </form>
      {draft.hasCategories && categoryManager}
    </>
  )
}
