// The subpath, not '@kanso/shared': the entry chunk would otherwise build zod schemas before
// zod-config.ts turns off zod's eval probe, which the admin CSP reports as a violation.
import { ADMIN_PATH } from '@kanso/shared/admin-path'
import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { ApiError } from './api/errors.ts'
import { routeTree } from './routeTree.gen.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 1
      },
    },
  },
})

export const router = createRouter({
  routeTree,
  basepath: ADMIN_PATH,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
