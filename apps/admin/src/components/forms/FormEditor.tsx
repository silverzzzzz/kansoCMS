import {
  type CreateFormInput,
  FORM_FIELD_NAME_PATTERN,
  FORM_FIELD_TYPES,
  FORM_FIELDS_MAX,
  type FormField,
  SLUG_PATTERN,
  slugify,
} from '@kanso/shared'
import { useState } from 'react'
import { ApiError, fieldErrors } from '../../api/errors.ts'
import type { FormItem } from '../../api/queries.ts'
import {
  changeFieldType,
  draftFromForm,
  emptyDraft,
  type FormDraft,
  moveField,
  newField,
  validateFormDraft,
} from '../../lib/form-builder.ts'
import { Alert, Button, Field, inputClass } from '../ui.tsx'

type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

const fieldTypeLabels: Record<FormFieldType, string> = {
  text: 'テキスト',
  email: 'メールアドレス',
  tel: '電話番号',
  textarea: '複数行テキスト',
  select: '選択肢',
  checkbox: 'チェックボックス',
}

function nextOptionValue(field: Extract<FormField, { type: 'select' }>): string {
  const values = new Set(field.options.map((option) => option.value))
  let index = 1
  while (values.has(`option_${index}`)) index += 1
  return `option_${index}`
}

export function FormEditor({
  initial,
  turnstileAvailable,
  pending,
  error,
  onSubmit,
}: {
  initial?: FormItem
  turnstileAvailable: boolean
  pending: boolean
  error: unknown
  onSubmit: (input: CreateFormInput) => void
}) {
  const [draft, setDraft] = useState<FormDraft>(() => {
    const value = initial ? draftFromForm(initial) : emptyDraft()
    return turnstileAvailable ? value : { ...value, turnstile: false }
  })
  const [slugEdited, setSlugEdited] = useState(Boolean(initial))
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null)
  const serverErrors = fieldErrors(error)
  const errors = clientErrors ?? serverErrors

  const change = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const updateField = (index: number, transform: (field: FormField) => FormField) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? transform(field) : field,
      ),
    }))

  return (
    <form
      className="mt-8 space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        const result = validateFormDraft(draft)
        if (!result.ok) {
          setClientErrors(result.errors)
          return
        }
        setClientErrors(null)
        onSubmit(result.data)
      }}
    >
      {Boolean(error) && clientErrors === null && Object.keys(serverErrors).length === 0 && (
        <Alert tone="error">
          {error instanceof ApiError ? error.message : '保存できませんでした'}
        </Alert>
      )}

      <section>
        <h2 className="text-lg font-semibold">基本設定</h2>
        <div className="mt-4 grid gap-5 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Field label="名前" error={errors.name}>
            <input
              className={inputClass}
              value={draft.name}
              required
              onChange={(event) => {
                const name = event.target.value
                setDraft((current) => ({
                  ...current,
                  name,
                  slug: slugEdited ? current.slug : slugify(name),
                }))
              }}
            />
          </Field>
          <Field
            label="スラッグ"
            error={errors.slug}
            hint="半角英小文字・数字・ハイフンを使います。日本語の名前は手動で入力してください。"
          >
            <input
              className={inputClass}
              value={draft.slug}
              required
              pattern={SLUG_PATTERN.source}
              onChange={(event) => {
                setSlugEdited(true)
                change('slug', event.target.value)
              }}
            />
          </Field>
          <Field label="完了メッセージ" error={errors.successMessage}>
            <textarea
              className={inputClass}
              rows={4}
              value={draft.successMessage}
              onChange={(event) => change('successMessage', event.target.value)}
            />
          </Field>
          <Field
            label="リダイレクト URL"
            error={errors.redirectUrl}
            hint="空なら同じページに完了メッセージを表示します。"
          >
            <input
              className={inputClass}
              value={draft.redirectUrl}
              placeholder="/thanks または https://…"
              onChange={(event) => change('redirectUrl', event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="通知先"
              error={errors.notifyTo}
              hint="カンマまたは改行区切り、最大 10 件。空なら設定の既定宛先を使います。"
            >
              <textarea
                className={inputClass}
                rows={3}
                value={draft.notifyTo}
                onChange={(event) => change('notifyTo', event.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm font-medium text-neutral-800 sm:col-span-2">
            <input
              type="checkbox"
              checked={turnstileAvailable && draft.turnstile}
              disabled={!turnstileAvailable}
              onChange={(event) => change('turnstile', event.target.checked)}
            />
            <span>
              Turnstile を有効にする
              {!turnstileAvailable && (
                <span className="mt-1 block text-xs font-normal leading-5 text-neutral-500">
                  設定 → フォーム でサイトキーを登録し、Worker に TURNSTILE_SECRET_KEY
                  を設定すると有効化できます
                </span>
              )}
            </span>
          </label>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">フィールド</h2>
            <p className="mt-1 text-sm text-neutral-600">表示する順番に並べます。</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={draft.fields.length >= FORM_FIELDS_MAX}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                fields: [...current.fields, newField('text', current.fields)],
              }))
            }
          >
            フィールドを追加
          </Button>
        </div>
        {errors.fields && (
          <div className="mt-4">
            <Alert tone="error">{errors.fields}</Alert>
          </div>
        )}
        <div className="mt-4 space-y-4">
          {draft.fields.map((field, index) => {
            const prefix = `fields.${index}`
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled; keying by name would remount (and blur) the row on every keystroke.
                key={index}
                className="border border-neutral-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
                  <p className="text-sm font-semibold">フィールド {index + 1}</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      aria-label={`フィールド ${index + 1} を上へ移動`}
                      disabled={index === 0}
                      onClick={() => change('fields', moveField(draft.fields, index, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      aria-label={`フィールド ${index + 1} を下へ移動`}
                      disabled={index === draft.fields.length - 1}
                      onClick={() => change('fields', moveField(draft.fields, index, 1))}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="danger"
                      onClick={() =>
                        change(
                          'fields',
                          draft.fields.filter((_, fieldIndex) => fieldIndex !== index),
                        )
                      }
                    >
                      削除
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <Field label="種類" error={errors[`${prefix}.type`]}>
                    <select
                      className={inputClass}
                      value={field.type}
                      onChange={(event) =>
                        updateField(index, (current) =>
                          changeFieldType(current, event.target.value as FormFieldType),
                        )
                      }
                    >
                      {FORM_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {fieldTypeLabels[type]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ラベル" error={errors[`${prefix}.label`]}>
                    <input
                      className={inputClass}
                      value={field.label}
                      required
                      onChange={(event) =>
                        updateField(index, (current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="名前"
                    error={errors[`${prefix}.name`]}
                    hint="半角英小文字・数字・_ を使います。送信データのキーになります。"
                  >
                    <input
                      className={inputClass}
                      value={field.name}
                      required
                      pattern={FORM_FIELD_NAME_PATTERN.source}
                      onChange={(event) =>
                        updateField(index, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <label className="flex items-center gap-2 self-end py-2 text-sm font-medium text-neutral-800">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        updateField(index, (current) => ({
                          ...current,
                          required: event.target.checked,
                        }))
                      }
                    />
                    必須
                  </label>
                  <Field label="プレースホルダー" error={errors[`${prefix}.placeholder`]}>
                    <input
                      className={inputClass}
                      value={field.placeholder ?? ''}
                      onChange={(event) =>
                        updateField(index, (current) => ({
                          ...current,
                          placeholder: event.target.value || null,
                        }))
                      }
                    />
                  </Field>
                  <Field label="ヘルプ" error={errors[`${prefix}.help`]}>
                    <input
                      className={inputClass}
                      value={field.help ?? ''}
                      onChange={(event) =>
                        updateField(index, (current) => ({
                          ...current,
                          help: event.target.value || null,
                        }))
                      }
                    />
                  </Field>
                  {'maxLength' in field && (
                    <Field label="最大文字数" error={errors[`${prefix}.maxLength`]}>
                      <input
                        className={inputClass}
                        type="number"
                        min={1}
                        max={field.type === 'textarea' ? 10_000 : 500}
                        value={field.maxLength}
                        onChange={(event) =>
                          updateField(index, (current) =>
                            'maxLength' in current
                              ? { ...current, maxLength: Number(event.target.value) }
                              : current,
                          )
                        }
                      />
                    </Field>
                  )}
                  {field.type === 'textarea' && (
                    <Field label="行数" error={errors[`${prefix}.rows`]}>
                      <input
                        className={inputClass}
                        type="number"
                        min={2}
                        max={20}
                        value={field.rows}
                        onChange={(event) =>
                          updateField(index, (current) =>
                            current.type === 'textarea'
                              ? { ...current, rows: Number(event.target.value) }
                              : current,
                          )
                        }
                      />
                    </Field>
                  )}
                </div>

                {field.type === 'select' && (
                  <div className="mt-5 border-t border-neutral-200 pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">選択肢</h3>
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={field.options.length >= 50}
                        onClick={() =>
                          updateField(index, (current) =>
                            current.type === 'select'
                              ? {
                                  ...current,
                                  options: [
                                    ...current.options,
                                    { value: nextOptionValue(current), label: '' },
                                  ],
                                }
                              : current,
                          )
                        }
                      >
                        追加
                      </Button>
                    </div>
                    {errors[`${prefix}.options`] && (
                      <p role="alert" className="mt-2 text-xs text-red-700">
                        {errors[`${prefix}.options`]}
                      </p>
                    )}
                    <div className="mt-3 space-y-3">
                      {field.options.map((option, optionIndex) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: same as the field rows above.
                          key={optionIndex}
                          className="grid gap-3 border border-neutral-200 p-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <Field
                            label="値"
                            error={errors[`${prefix}.options.${optionIndex}.value`]}
                          >
                            <input
                              className={inputClass}
                              value={option.value}
                              required
                              onChange={(event) =>
                                updateField(index, (current) =>
                                  current.type === 'select'
                                    ? {
                                        ...current,
                                        options: current.options.map(
                                          (currentOption, currentIndex) =>
                                            currentIndex === optionIndex
                                              ? { ...currentOption, value: event.target.value }
                                              : currentOption,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
                          </Field>
                          <Field
                            label="表示名"
                            error={errors[`${prefix}.options.${optionIndex}.label`]}
                          >
                            <input
                              className={inputClass}
                              value={option.label}
                              required
                              onChange={(event) =>
                                updateField(index, (current) =>
                                  current.type === 'select'
                                    ? {
                                        ...current,
                                        options: current.options.map(
                                          (currentOption, currentIndex) =>
                                            currentIndex === optionIndex
                                              ? { ...currentOption, label: event.target.value }
                                              : currentOption,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
                          </Field>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              size="small"
                              variant="secondary"
                              onClick={() =>
                                updateField(index, (current) =>
                                  current.type === 'select'
                                    ? {
                                        ...current,
                                        options: current.options.filter(
                                          (_, currentIndex) => currentIndex !== optionIndex,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            >
                              削除
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <div className="flex justify-end border-t border-neutral-200 pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </div>
    </form>
  )
}
