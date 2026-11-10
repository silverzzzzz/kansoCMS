import { z } from 'zod'
import { redirectUrlSchema } from './forms.ts'
import { isReservedSlug } from './slug.ts'

export const REDIRECT_STATUSES = [301, 302] as const
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number]

export function normalizeRedirectPath(input: string): string {
  return input
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

export const redirectFromPathSchema = z
  .string()
  .trim()
  .max(2000)
  .transform(normalizeRedirectPath)
  .pipe(
    z
      .string()
      .min(1, 'Path is required')
      .max(500)
      .refine((value) => !/[\s?#]/u.test(value), 'Path must not contain spaces, ? or #')
      .refine((value) => !isReservedSlug(value.split('/')[0] ?? ''), 'Path uses a reserved slug'),
  )

const redirectStatusSchema = z.union([z.literal(301), z.literal(302)])
const redirectFieldsShape = {
  fromPath: redirectFromPathSchema,
  to: redirectUrlSchema,
  status: redirectStatusSchema,
}

function targetDiffersFromSource(value: { fromPath?: string; to?: string }): boolean {
  return (
    value.fromPath === undefined ||
    value.to === undefined ||
    !value.to.startsWith('/') ||
    normalizeRedirectPath(value.to) !== value.fromPath
  )
}

const targetDiffersRefinement = {
  path: ['to'],
  message: 'Redirect target equals its source',
}

export const redirectFieldsSchema = z
  .object(redirectFieldsShape)
  .refine(targetDiffersFromSource, targetDiffersRefinement)

export const createRedirectSchema = z
  .object(redirectFieldsShape)
  .extend({ status: redirectStatusSchema.default(301) })
  .refine(targetDiffersFromSource, targetDiffersRefinement)

export const updateRedirectSchema = z
  .object(redirectFieldsShape)
  .partial()
  .refine(targetDiffersFromSource, targetDiffersRefinement)

export type CreateRedirectInput = z.infer<typeof createRedirectSchema>
export type UpdateRedirectInput = z.infer<typeof updateRedirectSchema>

/** Body of `POST /redirects/import`: raw CSV text, one `from,to[,status]` per line. */
export const redirectImportSchema = z.object({
  csv: z.string().min(1).max(200_000),
})
export type RedirectImportInput = z.infer<typeof redirectImportSchema>

export const REDIRECT_IMPORT_MAX_ROWS = 500

/** One parsed CSV row before schema validation. */
export interface RedirectCsvRow {
  line: number
  fromPath: string
  to: string
  status: string
}

/**
 * Parse `from,to[,status]` CSV lines. Handles a single optional header row and
 * double-quoted fields (which may contain commas). Line numbers are 1-based.
 */
export function parseRedirectCsv(csv: string): { rows: RedirectCsvRow[]; truncated: boolean } {
  const rows: RedirectCsvRow[] = []
  const lines = csv.replace(/\r\n?/g, '\n').split('\n')
  let firstDataLine = true
  let truncated = false
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1
    const trimmed = rawLine.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const cells = parseCsvLine(trimmed)
    if (firstDataLine) {
      firstDataLine = false
      const head = cells[0]?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
      if (head === 'from_path' || head === 'from' || head === 'source') continue
    }
    if (rows.length >= REDIRECT_IMPORT_MAX_ROWS) {
      truncated = true
      break
    }
    rows.push({
      line,
      fromPath: cells[0] ?? '',
      to: cells[1] ?? '',
      status: cells[2] ?? '',
    })
  }
  return { rows, truncated }
}

/** Minimal RFC4180 field splitter: commas inside "..." stay in the field. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}
