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
