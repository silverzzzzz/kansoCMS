import {
  type CreateFormInput,
  createFormSchema,
  type FORM_FIELD_TYPES,
  type FormField,
} from '@kanso/shared'
import type { FormItem } from '../api/queries.ts'

export type FormDraft = {
  slug: string
  name: string
  successMessage: string
  redirectUrl: string
  notifyTo: string
  turnstile: boolean
  fields: FormField[]
}

type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

function nextFieldName(existing: FormField[]): string {
  const names = new Set(existing.map((field) => field.name))
  let index = 1
  while (names.has(`field_${index}`)) index += 1
  return `field_${index}`
}

function baseField(field: FormField, type: FormFieldType) {
  return {
    type,
    name: field.name,
    label: field.label,
    required: field.required,
    placeholder: field.placeholder,
    help: field.help,
  }
}

export function newField(type: FormFieldType, existing: FormField[]): FormField {
  const base = {
    type,
    name: nextFieldName(existing),
    label: '',
    required: false,
    placeholder: null,
    help: null,
  }
  switch (type) {
    case 'text':
    case 'email':
    case 'tel':
      return { ...base, type, maxLength: 200 }
    case 'textarea':
      return { ...base, type, maxLength: 2000, rows: 5 }
    case 'select':
      return { ...base, type, options: [{ value: 'option_1', label: '' }] }
    case 'checkbox':
      return { ...base, type }
  }
}

export function emptyDraft(): FormDraft {
  return {
    slug: '',
    name: '',
    successMessage: '',
    redirectUrl: '',
    notifyTo: '',
    turnstile: false,
    fields: [newField('text', [])],
  }
}

export function draftFromForm(form: FormItem): FormDraft {
  return {
    slug: form.slug,
    name: form.name,
    successMessage: form.successMessage,
    redirectUrl: form.redirectUrl ?? '',
    notifyTo: form.notifyTo,
    turnstile: form.turnstile,
    fields: form.fieldsJson,
  }
}

export function changeFieldType(field: FormField, type: FormFieldType): FormField {
  const base = baseField(field, type)
  switch (type) {
    case 'text':
    case 'email':
    case 'tel':
      return { ...base, type, maxLength: 200 }
    case 'textarea':
      return { ...base, type, maxLength: 2000, rows: 5 }
    case 'select':
      return { ...base, type, options: [{ value: 'option_1', label: '' }] }
    case 'checkbox':
      return { ...base, type }
  }
}

export function moveField(fields: FormField[], index: number, delta: number): FormField[] {
  const destination = index + delta
  if (index < 0 || index >= fields.length || destination < 0 || destination >= fields.length) {
    return fields
  }
  const next = [...fields]
  const [field] = next.splice(index, 1)
  if (!field) return fields
  next.splice(destination, 0, field)
  return next
}

export function validateFormDraft(
  draft: FormDraft,
): { ok: true; data: CreateFormInput } | { ok: false; errors: Record<string, string> } {
  const result = createFormSchema.safeParse({
    ...draft,
    redirectUrl: draft.redirectUrl.trim() === '' ? null : draft.redirectUrl,
  })
  if (result.success) return { ok: true, data: result.data }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.')
    if (errors[path] === undefined) errors[path] = issue.message
  }
  return { ok: false, errors }
}
