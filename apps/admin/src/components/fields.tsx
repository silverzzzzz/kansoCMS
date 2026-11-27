import { SLUG_PATTERN } from '@kanso/shared'
import type { ComponentProps } from 'react'
import { Field, inputClass } from './ui.tsx'

type FieldText = { label: string; hint?: string; error?: string }
type Count = { showCount?: boolean }

function counter(value: unknown, limit?: number) {
  return limit === undefined ? undefined : `${String(value ?? '').length} / ${limit} 文字`
}

export function TextField({
  label,
  hint,
  error,
  showCount,
  className = inputClass,
  ...input
}: FieldText & Count & ComponentProps<'input'>) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      counter={showCount ? counter(input.value, input.maxLength) : undefined}
    >
      <input className={className} {...input} />
    </Field>
  )
}

export function TextareaField({
  label,
  hint,
  error,
  showCount,
  className = inputClass,
  ...input
}: FieldText & Count & ComponentProps<'textarea'>) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      counter={showCount ? counter(input.value, input.maxLength) : undefined}
    >
      <textarea className={className} {...input} />
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  className = inputClass,
  ...select
}: FieldText & ComponentProps<'select'>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select className={className} {...select} />
    </Field>
  )
}

export function SlugField(props: Omit<ComponentProps<typeof TextField>, 'ref'>) {
  return (
    <TextField
      hint="半角の英小文字・数字・ハイフンを使えます。"
      pattern={SLUG_PATTERN.source}
      autoCapitalize="none"
      spellCheck={false}
      ref={(input) => {
        if (!input) return
        if (input.validity.valueMissing) input.setCustomValidity('スラッグを入力してください。')
        else if (input.validity.patternMismatch)
          input.setCustomValidity('半角の英小文字・数字をハイフンで区切って入力してください。')
        else input.setCustomValidity('')
      }}
      {...props}
    />
  )
}
