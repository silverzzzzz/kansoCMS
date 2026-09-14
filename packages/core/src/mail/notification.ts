import type { FormField, SubmissionValues } from '@kanso/shared'

export type SubmissionNotificationInput = {
  form: { name: string; fields: FormField[] }
  values: SubmissionValues
  submissionId: number
  siteTitle: string
  adminUrl: string
}

export type SubmissionNotification = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function displayValue(value: string | boolean | undefined): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return value ?? ''
}

export function buildSubmissionNotification({
  form,
  values,
  submissionId,
  siteTitle,
  adminUrl,
}: SubmissionNotificationInput): SubmissionNotification {
  const subject = `[${siteTitle}] ${form.name}`
  const text = [
    ...form.fields.map((field) => `${field.label}: ${displayValue(values[field.name])}`),
    '',
    `Submission #${submissionId}`,
    adminUrl,
  ].join('\n')
  const rows = form.fields
    .map((field) => {
      const value = escapeHtml(displayValue(values[field.name])).replace(/\r\n|\r|\n/g, '<br>')
      return `<tr><th scope="row">${escapeHtml(field.label)}</th><td>${value}</td></tr>`
    })
    .join('')
  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>[${escapeHtml(siteTitle)}] ${escapeHtml(form.name)}</title>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(form.name)}</h1>`,
    `<table>${rows}</table>`,
    `<p>Submission #${submissionId}</p>`,
    `<p><a href="${escapeHtml(adminUrl)}">${escapeHtml(adminUrl)}</a></p>`,
    '</body>',
    '</html>',
  ].join('')

  return { subject, text, html }
}
