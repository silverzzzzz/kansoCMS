import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { api } from '../api/client.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { getPasskey, passkeyErrorMessage, passkeysSupported } from '../lib/passkey.ts'
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
  const supported = passkeysSupported()
  const login = useMutation({
    mutationFn: async () => {
      const { options } = await unwrap(api.auth.passkey.options.$post())
      const credential = await getPasskey(options)
      return unwrap(api.auth.passkey.$post({ json: { credential } }))
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data.user)
      await navigate({ href: safeAdminRedirect(redirectTo) })
    },
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-neutral-500">kansoCMS</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">管理画面にログイン</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          登録したパスキーでログインします。この端末の指紋・顔認証・PIN
          のほか、パスキーを保存したスマートフォンも使えます。
        </p>

        {!supported && (
          <p role="alert" className="mt-6 border-l-2 border-red-600 pl-3 text-sm text-red-700">
            このブラウザはパスキーに対応していません。最新の Chrome、Edge、Safari、Firefox
            でお試しください。
          </p>
        )}
        {login.error && (
          <p role="alert" className="mt-6 border-l-2 border-red-600 pl-3 text-sm text-red-700">
            {passkeyErrorMessage(login.error)}
          </p>
        )}

        <button
          type="button"
          disabled={!supported || login.isPending}
          onClick={() => login.mutate()}
          className="mt-8 w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {login.isPending ? '確認中…' : 'パスキーでログイン'}
        </button>

        <details className="mt-8 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
          <summary className="cursor-pointer font-medium text-neutral-800">
            パスキーをなくした場合
          </summary>
          <div className="mt-3 space-y-2 leading-6">
            <p>
              サイトを運用している人が、次のコマンドでパスキーの登録用リンク (1 時間有効・1 回限り)
              を発行できます。
            </p>
            <code className="block overflow-x-auto border border-neutral-200 bg-neutral-50 p-3 text-xs">
              pnpm passkey:link メールアドレス --remote --url https://サイトのアドレス
            </code>
          </div>
        </details>
      </section>
    </main>
  )
}
