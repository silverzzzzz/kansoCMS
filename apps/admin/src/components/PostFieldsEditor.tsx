import { SECTION_FIELD_TYPES, type SectionField } from '@kanso/shared'
import { useRef } from 'react'
import { SelectField, TextField } from './fields.tsx'
import { Button, Field, inputClass } from './ui.tsx'

const smallButtonClass =
  'border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-950'

type FieldType = SectionField['type']

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'テキスト',
  textarea: '複数行テキスト',
  url: 'URL',
  select: '選択肢',
  checkbox: 'チェックボックス',
  number: '数値',
  color: '色',
  image: '画像',
  posts: '投稿リスト',
}

function fieldForType(
  type: FieldType,
  base: { name: string; label: string; help?: string },
): SectionField {
  switch (type) {
    case 'text':
      return { type, ...base, maxLength: 200 }
    case 'textarea':
      return { type, ...base, maxLength: 2000 }
    case 'select':
      return { type, ...base, options: [{ value: 'option1', label: '選択肢1' }] }
    case 'checkbox':
      return { type, ...base, default: false }
    default:
      return { type, ...base }
  }
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return list
  next.splice(to, 0, item)
  return next
}

/** Editor for a post type's custom field definitions (the section field DSL). */
export function PostFieldsEditor({
  fields,
  errors,
  onChange,
}: {
  fields: SectionField[]
  errors: Record<string, string>
  onChange: (fields: SectionField[]) => void
}) {
  const counter = useRef(0)
  const keysRef = useRef<string[]>([])
  const keys = keysRef.current
  const newKey = () => `field-${counter.current++}`
  while (keys.length < fields.length) keys.push(newKey())
  keys.length = fields.length

  const updateAt = (index: number, field: SectionField) =>
    onChange(fields.map((item, i) => (i === index ? field : item)))
  const move = (from: number, to: number) => {
    onChange(moveItem(fields, from, to))
    const [key] = keys.splice(from, 1)
    if (key !== undefined) keys.splice(to, 0, key)
  }
  const removeAt = (index: number) => {
    onChange(fields.filter((_, i) => i !== index))
    keys.splice(index, 1)
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">カスタムフィールド</legend>
      <p className="text-xs text-neutral-500">
        この投稿タイプの投稿が持つ追加項目です。公開ページでは本文の下に一覧表示されます。
      </p>
      {errors.fields && (
        <p role="alert" className="text-xs text-red-700">
          {errors.fields}
        </p>
      )}
      {fields.length === 0 ? (
        <p className="border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
          フィールドがありません。「フィールドを追加」で項目を登録します。
        </p>
      ) : (
        <ul className="space-y-3">
          {fields.map((field, index) => (
            <li key={keys[index]} className="space-y-2 border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <TextField
                  label="表示名"
                  error={errors[`fields.${index}.label`]}
                  className={`${inputClass} w-44`}
                  value={field.label}
                  required
                  placeholder="表示名"
                  onChange={(event) => updateAt(index, { ...field, label: event.target.value })}
                />
                <TextField
                  label="フィールド名"
                  error={errors[`fields.${index}.name`]}
                  className={`${inputClass} w-36 font-mono text-xs`}
                  value={field.name}
                  required
                  pattern="[a-z][a-z0-9_]*"
                  placeholder="name"
                  onChange={(event) => updateAt(index, { ...field, name: event.target.value })}
                />
                <SelectField
                  label="種類"
                  error={errors[`fields.${index}.type`]}
                  className={`${inputClass} w-36`}
                  value={field.type}
                  onChange={(event) =>
                    updateAt(
                      index,
                      fieldForType(event.target.value as FieldType, {
                        name: field.name,
                        label: field.label,
                        help: field.help,
                      }),
                    )
                  }
                >
                  {SECTION_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </SelectField>
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`${smallButtonClass} text-red-700`}
                  onClick={() => removeAt(index)}
                >
                  削除
                </button>
              </div>
              <TextField
                label="説明（省略可）"
                error={errors[`fields.${index}.help`]}
                value={field.help ?? ''}
                onChange={(event) =>
                  updateAt(index, {
                    ...field,
                    help: event.target.value || undefined,
                  })
                }
              />
              <FieldExtras
                field={field}
                prefix={`fields.${index}`}
                errors={errors}
                onChange={(next) => updateAt(index, next)}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...fields, { type: 'text', name: '', label: '', maxLength: 200 }])}
      >
        フィールドを追加
      </Button>
    </fieldset>
  )
}

function FieldExtras({
  prefix,
  errors,
  field,
  onChange,
}: {
  prefix: string
  errors: Record<string, string>
  field: SectionField
  onChange: (field: SectionField) => void
}) {
  if (field.type === 'text' || field.type === 'textarea') {
    return (
      <Field label="最大文字数" error={errors[`${prefix}.maxLength`]}>
        <input
          className={`${inputClass} mt-0 w-32`}
          type="number"
          min={1}
          value={field.maxLength}
          onChange={(event) => onChange({ ...field, maxLength: Number(event.target.value) })}
        />
      </Field>
    )
  }
  if (field.type === 'number') {
    return (
      <div className="flex flex-wrap gap-4">
        <Field label="最小値" error={errors[`${prefix}.min`]}>
          <input
            className={`${inputClass} mt-0 w-28`}
            type="number"
            value={field.min ?? ''}
            onChange={(event) =>
              onChange({
                ...field,
                min: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label="最大値" error={errors[`${prefix}.max`]}>
          <input
            className={`${inputClass} mt-0 w-28`}
            type="number"
            value={field.max ?? ''}
            onChange={(event) =>
              onChange({
                ...field,
                max: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label="ステップ" error={errors[`${prefix}.step`]}>
          <input
            className={`${inputClass} mt-0 w-28`}
            type="number"
            value={field.step ?? ''}
            onChange={(event) =>
              onChange({
                ...field,
                step: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
        </Field>
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <OptionsEditor
        field={field}
        prefix={`${prefix}.options`}
        errors={errors}
        onChange={onChange}
      />
    )
  }
  return null
}

function OptionsEditor({
  prefix,
  errors,
  field,
  onChange,
}: {
  prefix: string
  errors: Record<string, string>
  field: Extract<SectionField, { type: 'select' }>
  onChange: (field: SectionField) => void
}) {
  const counter = useRef(0)
  const keysRef = useRef<string[]>([])
  const keys = keysRef.current
  const newKey = () => `option-${counter.current++}`
  const options = field.options
  while (keys.length < options.length) keys.push(newKey())
  keys.length = options.length

  const updateAt = (index: number, option: { value: string; label: string }) =>
    onChange({ ...field, options: options.map((item, i) => (i === index ? option : item)) })
  const removeAt = (index: number) => {
    onChange({ ...field, options: options.filter((_, i) => i !== index) })
    keys.splice(index, 1)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-neutral-600">選択肢</p>
      {options.map((option, index) => (
        <div key={keys[index]} className="flex flex-wrap items-center gap-2">
          <TextField
            label="選択肢の表示名"
            error={errors[`${prefix}.${index}.label`]}
            className={`${inputClass} w-40`}
            value={option.label}
            required
            placeholder="表示名"
            onChange={(event) => updateAt(index, { ...option, label: event.target.value })}
          />
          <TextField
            label="選択肢の値"
            error={errors[`${prefix}.${index}.value`]}
            className={`${inputClass} w-40 font-mono text-xs`}
            value={option.value}
            required
            placeholder="値"
            onChange={(event) => updateAt(index, { ...option, value: event.target.value })}
          />
          <button
            type="button"
            className={`${smallButtonClass} text-red-700`}
            disabled={options.length <= 1}
            onClick={() => removeAt(index)}
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        className={smallButtonClass}
        onClick={() =>
          onChange({
            ...field,
            options: [...options, { value: `option${options.length + 1}`, label: '' }],
          })
        }
      >
        + 選択肢を追加
      </button>
    </div>
  )
}
