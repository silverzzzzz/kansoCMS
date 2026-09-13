export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {}

  const result: Record<string, string> = {}
  for (const detail of error.details) {
    if (!detail || typeof detail !== 'object') continue
    if (!('path' in detail) || typeof detail.path !== 'string') continue
    if (!('message' in detail) || typeof detail.message !== 'string') continue
    result[detail.path] = detail.message
  }
  return result
}
