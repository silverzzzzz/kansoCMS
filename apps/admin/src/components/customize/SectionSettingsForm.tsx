import { useQuery } from '@tanstack/react-query'
import { postTypesQuery, type SectionFieldDef } from '../../api/queries.ts'
import { SelectField, TextareaField, TextField } from '../fields.tsx'
import { MediaField } from '../media/MediaField.tsx'
import { Button } from '../ui.tsx'

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
  errors = {},
  onChange,
}: {
  fields: SectionFieldDef[]
  values: SectionSettings
  errors?: Record<string, string>
  onChange: (name: string, value: unknown) => void
}) {
  const postTypes = useQuery(postTypesQuery)
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const error =
          errors[field.name] ??
          Object.entries(errors).find(([path]) => path.startsWith(`${field.name}.`))?.[1]
        const props = { label: field.label, name: field.name, hint: field.help ?? undefined, error }
        switch (field.type) {
          case 'text':
          case 'url':
            return (
              <TextField
                key={field.name}
                {...props}
                type="text"
                showCount={field.type === 'text'}
                value={asString(values[field.name])}
                maxLength={field.type === 'text' ? field.maxLength : undefined}
                onChange={(event) => onChange(field.name, event.target.value)}
              />
            )
          case 'textarea':
            return (
              <TextareaField
                key={field.name}
                {...props}
                showCount
                rows={5}
                value={asString(values[field.name])}
                maxLength={field.maxLength}
                onChange={(event) => onChange(field.name, event.target.value)}
              />
            )
          case 'select':
            return (
              <SelectField
                key={field.name}
                {...props}
                value={asString(values[field.name])}
                onChange={(event) => onChange(field.name, event.target.value)}
              >
                <option value="">— 選択 —</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            )
          case 'checkbox':
            return (
              <TextField
                key={field.name}
                {...props}
                type="checkbox"
                className="ml-2 align-middle"
                checked={values[field.name] === true}
                onChange={(event) => onChange(field.name, event.target.checked)}
              />
            )
          case 'number':
            return (
              <TextField
                key={field.name}
                {...props}
                type="number"
                value={typeof values[field.name] === 'number' ? String(values[field.name]) : ''}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(event) => {
                  const parsed = event.target.value === '' ? undefined : Number(event.target.value)
                  onChange(field.name, Number.isNaN(parsed) ? undefined : parsed)
                }}
              />
            )
          case 'color': {
            const value = asString(values[field.name])
            return (
              <div key={field.name} className="flex flex-wrap items-end gap-2">
                <TextField
                  {...props}
                  type="color"
                  className="mt-2 block h-9 w-12"
                  value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888'}
                  onChange={(event) => onChange(field.name, event.target.value)}
                />
                <span className="text-xs text-neutral-600">{value || 'テーマ既定'}</span>
                {value !== '' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={() => onChange(field.name, '')}
                  >
                    クリア
                  </Button>
                )}
              </div>
            )
          }
          case 'image': {
            const value = values[field.name]
            return (
              <MediaField
                key={field.name}
                {...props}
                value={typeof value === 'number' ? value : null}
                onChange={(id) => onChange(field.name, id)}
              />
            )
          }
          case 'posts': {
            const value = asPostsValue(values[field.name])
            return (
              <div key={field.name} className="space-y-2">
                <SelectField
                  {...props}
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
                </SelectField>
                <TextField
                  label="表示件数"
                  type="number"
                  min={1}
                  max={20}
                  value={String(value.limit)}
                  onChange={(event) => {
                    const limit = Number(event.target.value)
                    if (Number.isInteger(limit)) onChange(field.name, { ...value, limit })
                  }}
                />
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
