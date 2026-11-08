import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { api } from '../api/client.ts'
import { meQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import {
  createPasskey,
  defaultPasskeyName,
  passkeyErrorMessage,
  passkeysSupported,
} from '../lib/passkey.ts'

type PasskeyLinkSearch = { token?: string }

/**
 * Landing page of a one-time link from `pnpm passkey:link`: registers a
 * passkey for the link's user and signs them in. Works signed in or out.
 */
export const Route = createFileRoute('/passkey-link')({
  validateSearch: (search: Record<string, unknown>): PasskeyLinkSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: PasskeyLinkPage,
})

function PasskeyLinkPage() {
  const { token = '' } = Route.useSearch()
  const { queryClient } = Route.useRouteContext()
  const navigate = useNavigate()
  const supported = passkeysSupported()
  // Each fetch issues a fresh five-minute challenge, so it is refetched after
  // a failed attempt instead of being cached.
  const link = useQuery({
    queryKey: ['passkey-link', token],
    queryFn: () => unwrap(api.auth['passkey-link'].options.$post({ json: { token } })),
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
  const register = useMutation({
    mutationFn: async () => {
      const options = link.data?.options
      if (!options) throw new Error('No passkey options')
      const credential = await createPasskey(options)
      return unwrap(
        api.auth['passkey-link'].$post({
          json: { token, credential, passkeyName: defaultPasskeyName() },
        }),
      )
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data.user)
      await navigate({ to: '/account' })
    },
    onError: () => void link.refetch(),
  })

  const invalid = token.length === 0 || link.isError

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-neutral-500">kansoCMS</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">パスキーを登録</h1>

        {invalid ? (
          <>
            <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {token.length === 0
                ? 'リンクにトークンがありません。'
                : passkeyErrorMessage(link.error)}
            </p>
            <Link to="/login" className="mt-6 inline-block text-sm font-medium underline">
              ログイン画面へ
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {link.data
                ? `${link.data.user.name} (${link.data.user.email}) のパスキーをこの端末に作成し、ログインします。`
                : 'リンクを確認しています…'}
            </p>
            {!supported && (
              <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
                このブラウザはパスキーに対応していません。
              </p>
            )}
            {register.error && (
              <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
                {passkeyErrorMessage(register.error)}
              </p>
            )}
            <button
              type="button"
              disabled={!supported || !link.data || link.isFetching || register.isPending}
              onClick={() => register.mutate()}
              className="mt-8 w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              {register.isPending ? 'パスキーを作成中…' : 'パスキーを作成してログイン'}
            </button>
          </>
        )}
      </section>
    </main>
  )
}
