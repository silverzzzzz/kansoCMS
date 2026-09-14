import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { toAdminHref } from '../routing.ts'

const navigation = [
  { to: '/', label: 'ダッシュボード', exact: true },
  { to: '/pages', label: '固定ページ' },
  { to: '/posts', label: '投稿' },
  { to: '/post-types', label: '投稿タイプ' },
  { to: '/tags', label: 'タグ' },
  { to: '/media', label: 'メディア' },
  { to: '/forms', label: 'フォーム' },
] as const

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context, location }) => {
    try {
      const user = await context.queryClient.ensureQueryData(meQueryOptions)
      if (!user) throw redirect({ to: '/login' })
      return { user }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error

      const setupStatus = await context.queryClient.fetchQuery(setupStatusQueryOptions)
      if (setupStatus.needed) throw redirect({ to: '/setup' })
      throw redirect({
        to: '/login',
        search: { redirect: toAdminHref(location.href) },
      })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  const { user } = Route.useRouteContext()
  const { queryClient } = Route.useRouteContext()
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: () => unwrap(api.auth.logout.$post()),
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: '/login' })
    },
  })
  const logoutError = logout.error instanceof ApiError ? logout.error.message : null

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-950">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-neutral-200 bg-white md:flex md:flex-col">
        <div className="border-b border-neutral-200 px-6 py-5">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-4"
          >
            kansoCMS
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="管理メニュー">
          {navigation.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
          {user.role === 'admin' && (
            <>
              <NavLink to="/settings" label="設定" />
              <NavLink to="/api-keys" label="API キー" />
            </>
          )}
        </nav>
        <p className="border-t border-neutral-200 px-6 py-4 text-xs leading-5 text-neutral-500">
          シンプルに書き、確実に届ける。
        </p>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-4 px-5 sm:px-8">
            <details className="relative md:hidden">
              <summary className="cursor-pointer list-none border border-neutral-300 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-950">
                メニュー
              </summary>
              <nav
                className="absolute left-0 top-12 w-56 space-y-1 border border-neutral-200 bg-white p-3 shadow-lg"
                aria-label="モバイル管理メニュー"
              >
                {navigation.map((item) => (
                  <NavLink key={item.to} {...item} />
                ))}
                {user.role === 'admin' && (
                  <>
                    <NavLink to="/settings" label="設定" />
                    <NavLink to="/api-keys" label="API キー" />
                  </>
                )}
              </nav>
            </details>

            <Link
              to="/"
              className="text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 md:hidden"
            >
              kansoCMS
            </Link>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-neutral-600 sm:inline">{user.name}</span>
              <button
                type="button"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
                className="border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 outline-none hover:border-neutral-950 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-neutral-400"
              >
                {logout.isPending ? 'ログアウト中…' : 'ログアウト'}
              </button>
            </div>
          </div>
          {logoutError && (
            <p
              role="alert"
              className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700 sm:px-8"
            >
              {logoutError}
            </p>
          )}
        </header>

        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

type NavLinkProps = {
  to:
    | '/'
    | '/pages'
    | '/posts'
    | '/post-types'
    | '/tags'
    | '/media'
    | '/forms'
    | '/settings'
    | '/api-keys'
  label: string
  exact?: boolean
}

function NavLink({ to, label, exact = false }: NavLinkProps) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="block border-l-2 border-transparent px-3 py-2 text-sm font-medium text-neutral-600 outline-none hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
      activeProps={{ className: 'border-neutral-950 bg-neutral-100 text-neutral-950' }}
    >
      {label}
    </Link>
  )
}
