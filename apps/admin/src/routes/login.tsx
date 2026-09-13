import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { safeAdminRedirect } from '../routing.ts'

type LoginSearch = {
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const setupStatus = await context.queryClient.fetchQuery(setupStatusQueryOptions)
    if (setupStatus.needed) throw redirect({ to: '/setup' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate({ from: '/login' })
  const { redirect: redirectTo } = Route.useSearch()
  const { queryClient } = Route.useRouteContext()
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      unwrap(api.auth.login.$post({ json: input })),
    onSuccess: async (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data.user)
      await navigate({ href: safeAdminRedirect(redirectTo) })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    login.mutate({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    })
  }

  const serverError = login.error instanceof ApiError ? login.error.message : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-neutral-500">kansoCMS</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">管理画面にログイン</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          管理者アカウントのメールアドレスとパスワードを入力してください。
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-neutral-800">
            メールアドレス
            <input
              className="mt-2 block w-full border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950 sm:text-sm"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label className="block text-sm font-medium text-neutral-800">
            パスワード
            <input
              className="mt-2 block w-full border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950 sm:text-sm"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {serverError && (
            <p role="alert" className="border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {login.isPending ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </section>
    </main>
  )
}
