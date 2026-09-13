import { ApiError } from './errors.ts'

type ErrorPayload = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  if (!value || typeof value !== 'object' || !('error' in value)) return false
  const error = value.error
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

export async function unwrap<TResponse extends Response>(
  promise: Promise<TResponse>,
): Promise<Awaited<ReturnType<TResponse['json']>>> {
  const response = await promise

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ApiError(response.status, 'internal', 'The server returned an invalid response')
    }

    if (isErrorPayload(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message, body.error.details)
    }
    throw new ApiError(response.status, 'internal', 'The server returned an invalid response')
  }

  return response.json()
}
