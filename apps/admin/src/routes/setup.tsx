import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'

type SetupInput = {
  siteTitle?: string
  name: string
  email: string
  password: string
}

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const setupStatus = await context.queryClient.fetchQuery(setupStatusQueryOptions)
    if (!setupStatus.needed) throw redirect({ to: '/login' })
  },
  component: SetupPage,
})

function SetupPage() {
  const navigate = useNavigate({ from: '/setup' })
  const { queryClient } = Route.useRouteContext()
  const [clientError, setClientError] = useState<string | null>(null)
  const setup = useMutation({
    mutationFn: (input: SetupInput) => unwrap(api.setup.$post({ json: input })),
    onSuccess: async (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data.user)
      queryClient.setQueryData(setupStatusQueryOptions.queryKey, { needed: false })
      await navigate({ to: '/' })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setClientError(null)
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const passwordConfirm = String(form.get('passwordConfirm') ?? '')

    if (password !== passwordConfirm) {
      setClientError('パスワードが一致しません。')
      return
    }

    const siteTitle = String(form.get('siteTitle') ?? '').trim()
    setup.mutate({
      siteTitle: siteTitle || undefined,
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      password,
    })
  }

  const serverError = setup.error instanceof ApiError ? setup.error.message : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-neutral-500">kansoCMS</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">サイトをセットアップ</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          サイト名と最初の管理者アカウントを登録します。
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <Field label="サイト名" name="siteTitle" autoComplete="organization" maxLength={120} />
          <Field label="名前" name="name" autoComplete="name" maxLength={100} required />
          <Field label="メールアドレス" name="email" type="email" autoComplete="email" required />
          <Field
            label="パスワード"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            required
          />
          <Field
            label="パスワード（確認）"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            required
          />

          {(clientError || serverError) && (
            <p role="alert" className="border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {clientError || serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={setup.isPending}
            className="w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {setup.isPending ? 'セットアップ中…' : 'セットアップを完了'}
          </button>
        </form>
      </section>
    </main>
  )
}

type FieldProps = {
  label: string
  name: string
  type?: 'email' | 'password' | 'text'
  autoComplete: string
  required?: boolean
  minLength?: number
  maxLength?: number
}

function Field({ label, name, type = 'text', ...props }: FieldProps) {
  return (
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      <input
        className="mt-2 block w-full border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950 sm:text-sm"
        name={name}
        type={type}
        {...props}
      />
    </label>
  )
}
