import { useQuery } from '@tanstack/react-query'
import { postTypesQuery, type SectionFieldDef } from '../../api/queries.ts'
import { MediaField } from '../media/MediaField.tsx'
import { Field, inputClass } from '../ui.tsx'

export type SectionSettings = Record<string, unknown>

/** Settings values a brand-new section starts from, derived from the catalog. */
export function defaultSettings(fields: SectionFieldDef[]): SectionSettings {
  const settings: SectionSettings = {}
  for (const field of fields) {
    switch (field.type) {
      case 'checkbox':
        settings[field.name] = field.default ?? false
        break
      case 'number':
        if (field.default !== undefined) settings[field.name] = field.default
        break
      case 'image':
        settings[field.name] = field.default ?? null
        break
      case 'posts':
        settings[field.name] = field.default ?? { postTypeSlug: null, limit: 5 }
        break
      default:
        settings[field.name] = field.default ?? ''
    }
  }
  return settings
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asPostsValue(value: unknown): { postTypeSlug: string | null; limit: number } {
  if (value && typeof value === 'object' && 'limit' in value) {
    const v = value as { postTypeSlug?: unknown; limit?: unknown }
    return {
      postTypeSlug: typeof v.postTypeSlug === 'string' ? v.postTypeSlug : null,
      limit: typeof v.limit === 'number' ? v.limit : 5,
    }
  }
  return { postTypeSlug: null, limit: 5 }
}

/** Settings form generated from a section's field definitions. */
export function SectionSettingsForm({
  fields,
  values,
  onChange,
}: {
  fields: SectionFieldDef[]
  values: SectionSettings
  onChange: (name: string, value: unknown) => void
}) {
  const postTypes = useQuery(postTypesQuery)
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        switch (field.type) {
          case 'text':
          case 'url':
            return (
              <Field key={field.name} label={field.label} hint={field.help ?? undefined}>
                <input
                  className={inputClass}
                  type="text"
                  value={asString(values[field.name])}
                  maxLength={field.type === 'text' ? field.maxLength : undefined}
                  onChange={(event) => onChange(field.name, event.target.value)}
                />
              </Field>
            )
          case 'textarea':
            return (
              <Field key={field.name} label={field.label} hint={field.help ?? undefined}>
                <textarea
                  className={inputClass}
                  rows={5}
                  value={asString(values[field.name])}
                  maxLength={field.maxLength}
                  onChange={(event) => onChange(field.name, event.target.value)}
                />
              </Field>
            )
          case 'select':
            return (
              <Field key={field.name} label={field.label} hint={field.help ?? undefined}>
                <select
                  className={inputClass}
                  value={asString(values[field.name])}
                  onChange={(event) => onChange(field.name, event.target.value)}
                >
                  <option value="">— 選択 —</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            )
          case 'checkbox':
            return (
              <label
                key={field.name}
                className="flex items-center gap-2 text-sm font-medium text-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={values[field.name] === true}
                  onChange={(event) => onChange(field.name, event.target.checked)}
                />
                {field.label}
              </label>
            )
          case 'number':
            return (
              <Field key={field.name} label={field.label} hint={field.help ?? undefined}>
                <input
                  className={inputClass}
                  type="number"
                  value={typeof values[field.name] === 'number' ? String(values[field.name]) : ''}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(event) => {
                    const parsed =
                      event.target.value === '' ? undefined : Number(event.target.value)
                    onChange(field.name, Number.isNaN(parsed) ? undefined : parsed)
                  }}
                />
              </Field>
            )
          case 'image': {
            const value = values[field.name]
            return (
              <MediaField
                key={field.name}
                label={field.label}
                value={typeof value === 'number' ? value : null}
                onChange={(id) => onChange(field.name, id)}
              />
            )
          }
          case 'posts': {
            const value = asPostsValue(values[field.name])
            return (
              <div key={field.name} className="space-y-2">
                <Field label={field.label} hint={field.help ?? undefined}>
                  <select
                    className={inputClass}
                    value={value.postTypeSlug ?? ''}
                    onChange={(event) =>
                      onChange(field.name, {
                        ...value,
                        postTypeSlug: event.target.value || null,
                      })
                    }
                  >
                    <option value="">— 投稿タイプを選択 —</option>
                    {(postTypes.data?.items ?? []).map((type) => (
                      <option key={type.id} value={type.slug}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="表示件数">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={20}
                    value={String(value.limit)}
                    onChange={(event) => {
                      const limit = Number(event.target.value)
                      if (Number.isInteger(limit)) onChange(field.name, { ...value, limit })
                    }}
                  />
                </Field>
              </div>
            )
          }
          default:
            return null
        }
      })}
    </div>
  )
}
