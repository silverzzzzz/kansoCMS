import { Link } from '@tanstack/react-router'

const iconPaths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  analytics: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4',
  pages: 'M14 3H5v18h14V8z M14 3v5h5 M8 12h8 M8 16h6',
  customize: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  menus: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  posts: 'M14 5l5 5 M4 20l5-1L21 7l-5-5L4 14z',
  types: 'M3 5h7l2 3h9v12H3z',
  tags: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  media: 'M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M15 7h.01',
  forms: 'M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h4',
  redirects: 'M4 7h14 M14 3l4 4-4 4 M20 17H6 M10 13l-4 4 4 4',
  tools: 'M14 4a6 6 0 0 0-7 7l-4 4a3 3 0 0 0 4 4l4-4a6 6 0 0 0 7-7l-4 4-4-4z',
  settings:
    'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  users:
    'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-2a7 7 0 0 1 14 0v2 M18 5a3 3 0 0 1 0 6 M20 14a5 5 0 0 1 2 4',
  keys: 'M14 8a5 5 0 1 1-5-5 5 5 0 0 1 5 5z M12.5 11.5L21 20 M17 16l3-3 M19 18l3-3',
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  close: 'M6 6l12 12 M6 18L18 6',
  collapse: 'M3 3h18v18H3z M9 3v18 M16 9l-3 3 3 3',
  expand: 'M3 3h18v18H3z M9 3v18 M13 9l3 3-3 3',
} as const

export function NavigationIcon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
    >
      <path d={iconPaths[name]} />
    </svg>
  )
}

const navigation = [
  { to: '/', label: 'ダッシュボード', icon: 'dashboard', exact: true },
  { to: '/activity', label: 'アクティビティ', icon: 'activity' },
  { to: '/analytics', label: 'アクセス解析', icon: 'analytics' },
  { to: '/pages', label: '固定ページ', icon: 'pages' },
  { to: '/customize', label: 'カスタマイズ', icon: 'customize' },
  { to: '/menus', label: 'メニュー', icon: 'menus' },
  { to: '/posts', label: '投稿', icon: 'posts' },
  { to: '/post-types', label: '投稿タイプ', icon: 'types' },
  { to: '/tags', label: 'タグ', icon: 'tags' },
  { to: '/media', label: 'メディア', icon: 'media' },
  { to: '/forms', label: 'フォーム', icon: 'forms' },
  { to: '/redirects', label: 'リダイレクト', icon: 'redirects' },
  { to: '/tools', label: 'ツール', icon: 'tools' },
  { to: '/settings', label: '設定', icon: 'settings', adminOnly: true },
  { to: '/users', label: 'ユーザー', icon: 'users', adminOnly: true },
  { to: '/api-keys', label: 'API キー', icon: 'keys', adminOnly: true },
  { to: '/account', label: 'アカウント', icon: 'account' },
] as const

export function AdminNavigation({
  isAdmin,
  collapsed = false,
  label = '管理メニュー',
}: {
  isAdmin: boolean
  collapsed?: boolean
  label?: string
}) {
  return (
    <nav
      className="admin-nav-scroll min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3"
      aria-label={label}
    >
      {navigation
        .filter((item) => !('adminOnly' in item) || isAdmin)
        .map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: 'exact' in item && item.exact }}
            title={collapsed ? item.label : undefined}
            className={`flex min-h-11 items-center gap-3 border-l-2 border-transparent text-sm font-medium text-neutral-600 outline-none hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950 aria-[current=page]:border-neutral-950 aria-[current=page]:bg-neutral-100 aria-[current=page]:text-neutral-950 ${collapsed ? 'justify-center px-0' : 'px-3 py-2'}`}
          >
            <NavigationIcon name={item.icon} />
            <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
          </Link>
        ))}
    </nav>
  )
}
