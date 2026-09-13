import { Button, Field, inputClass } from './ui.tsx'

export function PostTypeForm(props: {
  name: string
  slug: string
  description: string
  hasCategories: boolean
  hasTags: boolean
  sortOrder: number
  errors: Record<string, string>
  pending: boolean
  onName: (value: string) => void
  onSlug: (value: string) => void
  onDescription: (value: string) => void
  onCategories: (value: boolean) => void
  onTags: (value: boolean) => void
  onSortOrder: (value: number) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="名前" error={props.errors.name}>
          <input
            className={inputClass}
            value={props.name}
            required
            onChange={(event) => props.onName(event.target.value)}
          />
        </Field>
        <Field label="スラッグ" error={props.errors.slug}>
          <input
            className={inputClass}
            value={props.slug}
            required
            onChange={(event) => props.onSlug(event.target.value)}
          />
        </Field>
      </div>
      <Field label="説明" error={props.errors.description}>
        <textarea
          className={inputClass}
          rows={4}
          value={props.description}
          onChange={(event) => props.onDescription(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={props.hasCategories}
            onChange={(event) => props.onCategories(event.target.checked)}
          />
          カテゴリを使う
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={props.hasTags}
            onChange={(event) => props.onTags(event.target.checked)}
          />
          タグを使う
        </label>
      </div>
      <Field label="表示順" error={props.errors.sortOrder}>
        <input
          className={`${inputClass} max-w-xs`}
          type="number"
          value={props.sortOrder}
          onChange={(event) => props.onSortOrder(Number(event.target.value))}
        />
      </Field>
      <div className="flex justify-end border-t border-neutral-200 pt-5">
        <Button type="submit" disabled={props.pending}>
          {props.pending ? '保存中…' : '保存'}
        </Button>
      </div>
    </form>
  )
}
