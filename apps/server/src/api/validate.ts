import { KansoError } from '@kanso/core'
import { idSchema } from '@kanso/shared'
import { z } from 'zod'

type ValidationResult = {
  success: boolean
  error?: {
    issues: readonly { path: readonly PropertyKey[]; message: string }[]
  }
}

export function validationHook(result: ValidationResult): void {
  if (result.success || !result.error) return
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
  throw KansoError.validation('Invalid request', issues)
}

export const idParamSchema = z.object({ id: idSchema })
export const revisionParamSchema = z.object({ id: idSchema, revisionId: idSchema })
