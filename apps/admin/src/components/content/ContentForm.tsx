import type { ContentStatus } from '@kanso/shared'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { docToText, suggestAi } from '../../lib/ai.ts'
import { type ContentFormValue, contentErrors, titleSlug } from '../../lib/content-values.ts'
import { SaveBar } from '../editing/SaveBar.tsx'
import type { EditorSave } from '../editing/useEditorSave.ts'
import { Editor } from '../editor/Editor.tsx'
import { SelectField, SlugField, TextareaField, TextField } from '../fields.tsx'
import { MediaField } from '../media/MediaField.tsx'
import { AiSuggestButton } from './AiSuggestButton.tsx'
import { SeoPanel } from './SeoPanel.tsx'
import { isStaleError, StaleSaveNotice } from './StaleSaveNotice.tsx'

export type { ContentFormValue } from '../../lib/content-values.ts'

export function ContentForm({
  kind,
  value,
  onChange,
  save,
  editorKey,
  onUploadingChange,
  onInvalidChange,
  publicPath,
  onReload,
  children,
  creating,
}: {
  kind: 'page' | 'post'
  value: ContentFormValue
  onChange: (patch: Partial<ContentFormValue>) => void
  save: EditorSave
  editorKey: number
  onUploadingChange: (uploading: boolean) => void
  onInvalidChange: (invalid: boolean) => void
  publicPath: string
  onReload?: () => Promise<void>
  creating: boolean
  children: ReactNode
}) {
  const [fallbackSlug] = useState(() => `${kind}-${crypto.randomUUID().slice(0, 8)}`)
  const [reloadError, setReloadError] = useState(false)
  const [reloading, setReloading] = useState(false)
  const titleInput = useRef<HTMLInputElement>(null)
  const bodyField = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (creating) titleInput.current?.focus({ preventScroll: true })
  }, [creating])
  const errors = contentErrors(save.error)
  const bodyText = docToText(value.bodyJson)
  const seoError =
    errors.seoTitle || errors.seoDescription || errors.ogMediaId || errors.canonicalUrl
  const firstError = Object.values(errors)[0]
  let summary: ReactNode
  if (isStaleError(save.error) && onReload) {
    summary = (
      <StaleSaveNotice
        what={kind === 'page' ? '固定ページ' : '投稿'}
        pending={save.pending || reloading}
        reloadError={reloadError}
        onReload={async () => {
          setReloadError(false)
          setReloading(true)
          try {
            await onReload()
            save.discard()
          } catch {
            setReloadError(true)
          } finally {
            setReloading(false)
          }
        }}
        onOverwrite={() => void save.submit(true)}
      />
    )
  } else if (firstError) summary = firstError
  else if (save.error instanceof Error) summary = save.error.message

  return (
    <form
      className="mt-4 space-y-5"
      ref={save.formRef}
      inert={reloading}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save.submit()
      }}
    >
      <SaveBar save={save} error={summary} />
      <div
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,32%)] lg:grid-cols-[minmax(0,1fr)_16rem]"
        inert={creating && save.pending}
      >
        <div className="min-w-0 space-y-5">
          <TextField
            ref={titleInput}
            label="タイトル"
            name="title"
            error={errors.title}
            value={value.title}
            required
            maxLength={200}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
                return
              event.preventDefault()
              bodyField.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
            }}
            onChange={(event) => {
              const title = event.target.value
              const fallback = new RegExp(`^${kind}-[a-f0-9]{8}$`).test(value.slug)
                ? value.slug
                : fallbackSlug
              onChange({ title, slug: value.manualSlug ? value.slug : titleSlug(title, fallback) })
            }}
          />
          <div ref={bodyField}>
            <p className="mb-2 text-sm font-medium text-neutral-800">本文</p>
            <Editor
              key={editorKey}
              content={value.bodyJson}
              onChange={(bodyJson) => onChange({ bodyJson })}
              onUploadingChange={onUploadingChange}
              onInvalidChange={onInvalidChange}
            />
            {errors.bodyJson && (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {errors.bodyJson}
              </p>
            )}
          </div>
          <div>
            <TextareaField
              label="抜粋"
              name="excerpt"
              error={errors.excerpt}
              hint="空の場合は公開時に本文から自動生成されます。"
              rows={4}
              maxLength={500}
              showCount
              value={value.excerpt}
              onChange={(event) => onChange({ excerpt: event.target.value })}
            />
            <AiSuggestButton
              request={() => suggestAi('excerpt', bodyText)}
              disabled={!bodyText}
              onResult={(excerpt) => onChange({ excerpt })}
            />
          </div>
        </div>
        <aside aria-label="公開と表示の設定" className="min-w-0 space-y-4">
          <section className="space-y-4 border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">公開設定</h2>
            <SlugField
              label="スラッグ"
              name="slug"
              error={errors.slug}
              required
              value={value.slug}
              onChange={(event) => onChange({ slug: event.target.value, manualSlug: true })}
            />
            <SelectField
              label="状態"
              name="status"
              error={errors.status}
              value={value.status}
              onChange={(event) => onChange({ status: event.target.value as ContentStatus })}
            >
              <option value="draft">下書き</option>
              <option value="published">公開</option>
            </SelectField>
            <TextField
              label="公開日時"
              name="publishedAt"
              type="datetime-local"
              error={errors.publishedAt}
              hint="空のまま公開すると保存時刻が入ります。未来の日時で予約公開できます。"
              value={value.publishedAt}
              onChange={(event) => onChange({ publishedAt: event.target.value })}
            />
          </section>
          {children}
          <details
            className="border border-neutral-200 bg-white p-4"
            open={seoError ? true : undefined}
          >
            <summary className="cursor-pointer text-sm font-semibold">SEO 設定</summary>
            <div className="mt-4 space-y-4">
              <TextField
                label="SEO タイトル"
                name="seoTitle"
                error={errors.seoTitle}
                maxLength={120}
                showCount
                value={value.seoTitle}
                onChange={(event) => onChange({ seoTitle: event.target.value })}
              />
              <TextField
                label="canonical URL"
                name="canonicalUrl"
                type="url"
                error={errors.canonicalUrl}
                value={value.canonicalUrl}
                onChange={(event) => onChange({ canonicalUrl: event.target.value })}
              />
              <div>
                <TextareaField
                  label="SEO 説明"
                  name="seoDescription"
                  error={errors.seoDescription}
                  rows={3}
                  maxLength={320}
                  showCount
                  value={value.seoDescription}
                  onChange={(event) => onChange({ seoDescription: event.target.value })}
                />
                <AiSuggestButton
                  request={() => suggestAi('description', bodyText)}
                  disabled={!bodyText}
                  onResult={(seoDescription) => onChange({ seoDescription })}
                />
              </div>
              <MediaField
                label="OG 画像"
                error={errors.ogMediaId}
                value={value.ogMediaId}
                onChange={(ogMediaId) => onChange({ ogMediaId })}
              />
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <input
                  type="checkbox"
                  checked={value.noindex}
                  onChange={(event) => onChange({ noindex: event.target.checked })}
                />
                検索エンジンに登録しない
              </label>
              <p className="text-xs text-neutral-600">
                サイトマップとサイト内検索からも除外されます。
              </p>
              <SeoPanel value={value} publicPath={publicPath} />
            </div>
          </details>
        </aside>
      </div>
    </form>
  )
}
