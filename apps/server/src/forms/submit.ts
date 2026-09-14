import { type Kanso, KansoError } from '@kanso/core'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import { notifySubmission } from './notify.ts'
import { turnstileConfig, verifyTurnstile } from './turnstile.ts'

const RESERVED_KEYS = new Set(['_hp', 'cf-turnstile-response', '_return', '_form'])

export type PublicForm = NonNullable<Awaited<ReturnType<Kanso['forms']['findBySlug']>>>
export type Submission = Awaited<ReturnType<Kanso['forms']['submissions']['create']>>

export type SubmitFormResult = {
  submission: Submission | null
  message: string
  redirectUrl: string | null
}

function successResult(form: PublicForm, submission: Submission | null): SubmitFormResult {
  return {
    submission,
    message: form.successMessage,
    redirectUrl: form.redirectUrl,
  }
}

function submissionValues(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !RESERVED_KEYS.has(key)))
}

function requestCountry(request: Request): string | null {
  if (!('cf' in request)) return null
  const cf = request.cf
  if (typeof cf !== 'object' || cf === null || !('country' in cf)) return null
  return typeof cf.country === 'string' ? cf.country : null
}

export async function submitForm(
  c: Context<AppEnv>,
  form: PublicForm,
  raw: Record<string, unknown>,
): Promise<SubmitFormResult> {
  const honeypot = raw._hp
  if (honeypot !== undefined && honeypot !== null && honeypot !== '') {
    return successResult(form, null)
  }

  const remoteIp = c.req.header('cf-connecting-ip') ?? null
  if (form.turnstile) {
    const config = await turnstileConfig(c)
    if (!config) {
      throw KansoError.validation('Turnstile is not configured')
    }
    const token =
      typeof raw['cf-turnstile-response'] === 'string' ? raw['cf-turnstile-response'] : null
    await verifyTurnstile(config.secretKey, token, remoteIp)
  }

  const values = c.var.kanso.forms.validateSubmission(form, submissionValues(raw))
  const submission = await c.var.kanso.forms.submissions.create(form.id, values, {
    ip: remoteIp,
    userAgent: c.req.header('user-agent') ?? null,
    referrer: c.req.header('referer') ?? null,
    country: requestCountry(c.req.raw),
  })

  c.executionCtx.waitUntil(notifySubmission(c, form, submission))
  return successResult(form, submission)
}
