import { type ContentStatus, type RichTextDoc, slugify } from '@kanso/shared'
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { Editor } from '../editor/Editor.tsx'
import { MediaField } from '../media/MediaField.tsx'
import { Button, Field, inputClass } from '../ui.tsx'

export type ContentFormValue = {
  title: string
  slug: string
  status: ContentStatus
  publishedAt: string
  bodyJson: RichTextDoc
  excerpt: string
  seoTitle: string
  seoDescription: string
  ogMediaId: number | null
  noindex: boolean
  canonicalUrl: string
}

export const emptyContent: ContentFormValue = {
  title: '',
  slug: '',
  status: 'draft',
  publishedAt: '',
  bodyJson: { type: 'doc', content: [] },
  excerpt: '',
  seoTitle: '',
  seoDescription: '',
  ogMediaId: null,
  noindex: false,
  canonicalUrl: '',
}

export function ContentForm({
  value,
  onChange,
  onSubmit,
  pending,
  errors = {},
  autoSlug = false,
  editorKey,
  children,
}: {
  value: ContentFormValue
  onChange: (value: ContentFormValue) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
  errors?: Record<string, string>
  autoSlug?: boolean
  editorKey: string
  children?: ReactNode
}) {
  const [slugEdited, setSlugEdited] = useState(!autoSlug)
  const change = <K extends keyof ContentFormValue>(key: K, next: ContentFormValue[K]) =>
    onChange({ ...value, [key]: next })

  return (
    <form className="mt-8 space-y-8" onSubmit={onSubmit}>
      <div className="grid gap-5 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
        <Field label="タイトル" error={errors.title}>
          <input
            className={inputClass}
            value={value.title}
            required
            onChange={(event) => {
              const title = event.target.value
              onChange({
                ...value,
                title,
                slug: slugEdited ? value.slug : slugify(title),
              })
            }}
          />
        </Field>
        <Field label="スラッグ" error={errors.slug}>
          <input
            className={inputClass}
            value={value.slug}
            required
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            onChange={(event) => {
              setSlugEdited(true)
              change('slug', event.target.value)
            }}
          />
        </Field>
        <Field label="状態" error={errors.status}>
          <select
            className={inputClass}
            value={value.status}
            onChange={(event) => change('status', event.target.value as ContentStatus)}
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
          </select>
        </Field>
        <Field
          label="公開日時"
          error={errors.publishedAt}
          hint="空のまま公開すると、保存時刻が公開日時になります。"
        >
          <input
            className={inputClass}
            type="datetime-local"
            value={value.publishedAt}
            onChange={(event) => change('publishedAt', event.target.value)}
          />
        </Field>
      </div>

      {children}

      <div>
        <p className="mb-2 text-sm font-medium text-neutral-800">本文</p>
        <Editor
          key={editorKey}
          content={value.bodyJson}
          onChange={(doc) => change('bodyJson', doc)}
        />
        {errors.bodyJson && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {errors.bodyJson}
          </p>
        )}
      </div>

      <Field
        label="抜粋"
        error={errors.excerpt}
        hint="空の場合は公開時に本文から自動生成されます。"
      >
        <textarea
          className={inputClass}
          rows={4}
          value={value.excerpt}
          onChange={(event) => change('excerpt', event.target.value)}
        />
      </Field>

      <details className="border border-neutral-200 bg-white p-5">
        <summary className="cursor-pointer text-sm font-semibold">SEO 設定</summary>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="SEO タイトル" error={errors.seoTitle}>
            <input
              className={inputClass}
              value={value.seoTitle}
              onChange={(event) => change('seoTitle', event.target.value)}
            />
          </Field>
          <Field label="canonical URL" error={errors.canonicalUrl}>
            <input
              className={inputClass}
              type="url"
              value={value.canonicalUrl}
              onChange={(event) => change('canonicalUrl', event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="SEO 説明" error={errors.seoDescription}>
              <textarea
                className={inputClass}
                rows={3}
                value={value.seoDescription}
                onChange={(event) => change('seoDescription', event.target.value)}
              />
            </Field>
          </div>
          <MediaField
            label="OG 画像"
            value={value.ogMediaId}
            onChange={(next) => change('ogMediaId', next)}
          />
          <label className="flex items-start gap-2 self-end py-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              checked={value.noindex}
              onChange={(event) => change('noindex', event.target.checked)}
            />
            検索エンジンに登録しない
          </label>
        </div>
      </details>

      <div className="flex justify-end border-t border-neutral-200 pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </div>
    </form>
  )
}
