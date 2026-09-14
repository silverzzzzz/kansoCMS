import { buildSubmissionNotification } from '@kanso/core'
import { notifyToAddresses, type SubmissionValues } from '@kanso/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import type { PublicForm, Submission } from './submit.ts'

export type NotifyResult =
  | { skipped: 'no_from' | 'no_recipients' }
  | { sent: number; failed: number }

function errorDetails(error: unknown): { message: string; code?: string } {
  if (!(error instanceof Error)) return { message: 'Unknown error' }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return { message: error.message, ...(code ? { code } : {}) }
}

function logFailure(formId: number, submissionId: number, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'form_notify_failed',
      formId,
      submissionId,
      ...errorDetails(error),
    }),
  )
}

function notificationValues(form: PublicForm, submission: Submission): SubmissionValues {
  const values: SubmissionValues = {}
  for (const field of form.fieldsJson) {
    const value = submission.dataJson[field.name]
    if (typeof value === 'string' || typeof value === 'boolean') values[field.name] = value
  }
  return values
}

function replyToAddress(form: PublicForm, submission: Submission): string | undefined {
  for (const field of form.fieldsJson) {
    if (field.type !== 'email') continue
    const value = submission.dataJson[field.name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

export async function notifySubmission(
  c: Context<AppEnv>,
  form: PublicForm,
  submission: Submission,
): Promise<NotifyResult> {
  try {
    const settings = await c.var.kanso.settings.forms()
    if (settings.fromEmail === '') return { skipped: 'no_from' }

    const formRecipients = notifyToAddresses(form.notifyTo)
    const recipients =
      formRecipients.length > 0 ? formRecipients : notifyToAddresses(settings.notifyTo)
    if (recipients.length === 0) return { skipped: 'no_recipients' }

    const site = await c.var.kanso.settings.site()
    const adminUrl = `${c.env.SITE_URL}/admin/forms/${form.id}/submissions/${submission.id}`
    const notification = buildSubmissionNotification({
      form: { name: form.name, fields: form.fieldsJson },
      values: notificationValues(form, submission),
      submissionId: submission.id,
      siteTitle: site.title,
      adminUrl,
    })
    const from = { email: settings.fromEmail, name: settings.fromName || site.title }
    const replyTo = replyToAddress(form, submission)
    let sent = 0
    let failed = 0

    for (const recipient of recipients) {
      try {
        await c.env.EMAIL.send({
          to: recipient,
          from,
          ...(replyTo ? { replyTo } : {}),
          ...notification,
        })
        sent += 1
      } catch (error) {
        failed += 1
        logFailure(form.id, submission.id, error)
      }
    }

    return { sent, failed }
  } catch (error) {
    logFailure(form.id, submission.id, error)
    return { sent: 0, failed: 1 }
  }
}
