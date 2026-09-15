import type { FormField, SubmissionValues } from '@kanso/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import type { PublicForm } from '../forms/submit.ts'
import { turnstileConfig } from '../forms/turnstile.ts'
import type { SiteMessages } from '../i18n.ts'

const FORM_PLACEHOLDER_PATTERN = /<div data-kanso-form="([a-z0-9-]+)"><\/div>/g
const CHECKBOX_TRUE_VALUES = new Set(['on', 'true', '1', 'yes'])
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

export type FormState = {
  slug: string
  values?: SubmissionValues
  errors?: { path: string; message: string }[]
  success?: boolean
}

export function formSlugsIn(html: string): string[] {
  const slugs = new Set<string>()
  for (const match of html.matchAll(FORM_PLACEHOLDER_PATTERN)) {
    const slug = match[1]
    if (slug) slugs.add(slug)
  }
  return [...slugs]
}

function describedBy(field: FormField, error: string | undefined, id: string): string | undefined {
  const ids = []
  if (field.help) ids.push(`${id}-help`)
  if (error) ids.push(`${id}-error`)
  return ids.length > 0 ? ids.join(' ') : undefined
}

function fieldValue(values: SubmissionValues | undefined, field: FormField): string | boolean {
  const value = values?.[field.name]
  if (field.type === 'checkbox') return typeof value === 'boolean' ? value : false
  return typeof value === 'string' ? value : ''
}

function FieldHelp({ field, id }: { field: FormField; id: string }) {
  return field.help ? (
    <p class="kanso-form__help" id={`${id}-help`}>
      {field.help}
    </p>
  ) : null
}

function FieldError({ error, id }: { error: string | undefined; id: string }) {
  return error ? (
    <p class="kanso-form__error" id={`${id}-error`}>
      {error}
    </p>
  ) : null
}

export function KansoForm({
  form,
  action,
  turnstileSiteKey,
  state,
  messages,
}: {
  form: PublicForm
  action: string
  turnstileSiteKey: string | null
  state?: FormState
  messages: SiteMessages['form']
}) {
  const currentState = state?.slug === form.slug ? state : undefined
  if (currentState?.success) {
    return (
      <div class="kanso-form kanso-form--success" role="status">
        <p>{form.successMessage || messages.successDefault}</p>
      </div>
    )
  }

  const fieldNames = new Set(form.fieldsJson.map((field) => field.name))
  const fieldErrors = new Map<string, string>()
  let formError: string | undefined
  for (const error of currentState?.errors ?? []) {
    if (fieldNames.has(error.path)) {
      if (!fieldErrors.has(error.path)) fieldErrors.set(error.path, error.message)
    } else if (formError === undefined) {
      formError = error.message
    }
  }
  if (currentState?.errors && currentState.errors.length === 0) formError = messages.genericError

  return (
    <form method="post" action={action} class="kanso-form">
      <input type="hidden" name="_form" value={form.slug} />
      <div class="kanso-form__hp" aria-hidden="true">
        <label>
          {messages.honeypotLabel}
          <input type="text" name="_hp" tabindex={-1} autocomplete="off" />
        </label>
      </div>
      {formError && (
        <p class="kanso-form__error" role="alert">
          {formError}
        </p>
      )}
      {form.fieldsJson.map((field) => {
        const id = `kanso-${form.slug}-${field.name}`
        const error = fieldErrors.get(field.name)
        const ariaDescribedBy = describedBy(field, error, id)
        const value = fieldValue(currentState?.values, field)

        if (field.type === 'checkbox') {
          return (
            <div class="kanso-form__field">
              <div class="kanso-form__checkbox">
                <input
                  type="checkbox"
                  name={field.name}
                  id={id}
                  value="on"
                  checked={value === true}
                  required={field.required}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={error ? 'true' : undefined}
                />
                <label for={id}>
                  {field.label}
                  {field.required && <span aria-hidden="true"> *</span>}
                </label>
              </div>
              <FieldHelp field={field} id={id} />
              <FieldError error={error} id={id} />
            </div>
          )
        }

        return (
          <div class="kanso-form__field">
            <label for={id}>
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                name={field.name}
                id={id}
                rows={field.rows}
                maxlength={field.maxLength}
                placeholder={field.placeholder ?? undefined}
                required={field.required}
                aria-describedby={ariaDescribedBy}
                aria-invalid={error ? 'true' : undefined}
              >
                {String(value)}
              </textarea>
            ) : field.type === 'select' ? (
              <select
                name={field.name}
                id={id}
                required={field.required}
                aria-describedby={ariaDescribedBy}
                aria-invalid={error ? 'true' : undefined}
              >
                <option value="" selected={value === ''}>
                  {messages.selectPlaceholder}
                </option>
                {field.options.map((option) => (
                  <option value={option.value} selected={value === option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.name}
                id={id}
                maxlength={field.maxLength}
                placeholder={field.placeholder ?? undefined}
                required={field.required}
                value={String(value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={error ? 'true' : undefined}
              />
            )}
            <FieldHelp field={field} id={id} />
            <FieldError error={error} id={id} />
          </div>
        )
      })}
      {form.turnstile && turnstileSiteKey && (
        <div class="cf-turnstile" data-sitekey={turnstileSiteKey}></div>
      )}
      <button type="submit">{messages.submit}</button>
    </form>
  )
}

export function expandForms(
  html: string,
  forms: Map<string, PublicForm>,
  options: {
    action: string
    turnstileSiteKey: string | null
    state?: FormState
    messages: SiteMessages['form']
  },
): string {
  return html.replace(FORM_PLACEHOLDER_PATTERN, (_placeholder, slug: string) => {
    const form = forms.get(slug)
    return form ? String(<KansoForm form={form} {...options} />) : ''
  })
}

export async function prepareForms(
  c: Context<AppEnv>,
  html: string,
  action: string,
  state: FormState | undefined,
  messages: SiteMessages['form'],
): Promise<{ html: string; scripts: string[] }> {
  const slugs = formSlugsIn(html)
  if (slugs.length === 0) return { html, scripts: [] }

  const loaded = await Promise.all(slugs.map((slug) => c.var.kanso.forms.findBySlug(slug)))
  const forms = new Map<string, PublicForm>()
  for (const form of loaded) {
    if (form) forms.set(form.slug, form)
  }

  const config = loaded.some((form) => form?.turnstile) ? await turnstileConfig(c) : null
  const turnstileSiteKey = config?.siteKey ?? null
  return {
    html: expandForms(html, forms, { action, turnstileSiteKey, state, messages }),
    scripts: turnstileSiteKey ? [TURNSTILE_SCRIPT_URL] : [],
  }
}

export function draftValues(form: PublicForm, raw: Record<string, unknown>): SubmissionValues {
  return Object.fromEntries(
    form.fieldsJson.map((field) => {
      const value = raw[field.name]
      if (field.type === 'checkbox') {
        return [
          field.name,
          value === true ||
            (typeof value === 'string' && CHECKBOX_TRUE_VALUES.has(value.toLowerCase())),
        ]
      }
      return [field.name, typeof value === 'string' ? value : '']
    }),
  )
}
