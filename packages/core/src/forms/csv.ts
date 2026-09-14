import type { FormField, SubmissionValues } from '@kanso/shared'

export type SubmissionCsvRow = {
  id: number
  createdAt: Date
  readAt: Date | null
  dataJson: SubmissionValues
}

const PHONE_LIKE_PATTERN = /^[0-9+()\-\s.]*$/
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/

function protectFormula(value: string): string {
  if (FORMULA_PREFIX_PATTERN.test(value) && !PHONE_LIKE_PATTERN.test(value)) return `'${value}`
  return value
}

function csvCell(value: string): string {
  const protectedValue = protectFormula(value)
  const needsQuotes = /[",\r\n]/.test(protectedValue) || /^\s|\s$/.test(value)
  return needsQuotes ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue
}

function submissionValue(value: string | boolean | undefined): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value ?? ''
}

export function buildSubmissionsCsv(fields: FormField[], rows: SubmissionCsvRow[]): string {
  const header = ['id', 'createdAt', 'readAt', ...fields.map((field) => field.label)]
  const body = [
    header,
    ...rows.map((row) => [
      String(row.id),
      row.createdAt.toISOString(),
      row.readAt?.toISOString() ?? '',
      ...fields.map((field) => submissionValue(row.dataJson[field.name])),
    ]),
  ]

  return `\uFEFF${body.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
