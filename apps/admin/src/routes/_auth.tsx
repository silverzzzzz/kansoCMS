import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { AdminNavigation, NavigationIcon } from '../components/AdminNavigation.tsx'
import { BrandLogo } from '../components/BrandLogo.tsx'
import { confirmEditorLeave } from '../components/editing/useEditorSave.ts'
import { MobileNavigation } from '../components/MobileNavigation.tsx'
import { toAdminHref } from '../routing.ts'

const SIDEBAR_STORAGE_KEY = 'kanso:sidebar-collapsed'

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

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
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const toggleSidebar = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    } catch {
      // Keep the control usable when browser storage is unavailable.
    }
  }
  const logout = useMutation({
    mutationFn: () => unwrap(api.auth.logout.$post()),
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: '/login', ignoreBlocker: true })
    },
  })
  const logoutError = logout.error instanceof ApiError ? logout.error.message : null

  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
        {/* lg:pl-3.5 lines the sidebar toggle up with the navigation icons below it. */}
        <div className="flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-8 lg:pl-3.5">
          <button
            id="admin-sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
            title={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
            aria-expanded={!collapsed}
            aria-controls="admin-sidebar"
            className="hidden size-11 shrink-0 items-center justify-center border border-neutral-300 text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 lg:flex"
          >
            <NavigationIcon name={collapsed ? 'expand' : 'collapse'} />
          </button>
          <MobileNavigation isAdmin={user.role === 'admin'} />
          <Link
            to="/"
            aria-label="kansoCMS ダッシュボード"
            className="flex min-h-11 min-w-11 shrink-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <BrandLogo markOnly className="size-8 sm:hidden" />
            <BrandLogo className="hidden h-8 w-32 sm:block" />
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-neutral-600 sm:inline" title={user.name}>
              {user.name}
            </span>
            <button
              type="button"
              disabled={logout.isPending}
              onClick={() => {
                if (confirmEditorLeave()) logout.mutate()
              }}
              className="min-h-11 shrink-0 border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 outline-none hover:border-neutral-950 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              {logout.isPending ? 'ログアウト中…' : 'ログアウト'}
            </button>
          </div>
        </div>
      </header>

      {/* top-16 matches the header's h-16; the header's bottom border covers the sidebar's top pixel. */}
      <aside
        id="admin-sidebar"
        aria-label="サイドバー"
        className={`fixed top-16 bottom-0 left-0 z-20 hidden border-r border-neutral-200 bg-white lg:flex lg:flex-col ${collapsed ? 'w-18' : 'w-60'}`}
      >
        <AdminNavigation isAdmin={user.role === 'admin'} collapsed={collapsed} />
        {!collapsed && (
          <p className="shrink-0 border-t border-neutral-200 px-6 py-4 text-xs leading-5 text-neutral-500">
            シンプルに書き、確実に届ける。
          </p>
        )}
      </aside>

      <div className={`min-w-0 ${collapsed ? 'lg:pl-18' : 'lg:pl-60'}`}>
        {logoutError && (
          <p
            role="alert"
            className="sticky top-16 z-10 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-8"
          >
            {logoutError}
          </p>
        )}
        <main className="mx-auto min-w-0 max-w-6xl px-4 py-6 [overflow-wrap:anywhere] sm:px-8 sm:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
