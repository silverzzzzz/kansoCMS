import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '../../api/client.ts'
import { unwrap } from '../../api/request.ts'

const featureLinks = [
  { to: '/pages', title: '固定ページ', description: 'サイトの基本ページを管理します。' },
  { to: '/posts', title: '投稿', description: '記事を作成し、公開状態を管理します。' },
  {
    to: '/post-types',
    title: '投稿タイプ',
    description: '記事の種類とカテゴリ、タグの利用方法を設定します。',
  },
  { to: '/media', title: 'メディア', description: '画像やファイルを管理します。' },
] as const

export const Route = createFileRoute('/_auth/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = Route.useRouteContext()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap(api.health.$get()),
  })

  return (
    <div>
      <div className="border-b border-neutral-200 pb-6">
        <p className="text-sm text-neutral-500">{health.data?.site ?? 'kansoCMS'}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          おかえりなさい、{user.name}さん
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
          管理する項目を選んでください。
        </p>
      </div>

      {health.isError && (
        <p role="alert" className="mt-6 border-l-2 border-red-600 pl-3 text-sm text-red-700">
          サイト情報を取得できませんでした。
        </p>
      )}

      <div className="mt-8 grid gap-px overflow-hidden border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
        {featureLinks.map((feature) => (
          <Link
            key={feature.to}
            to={feature.to}
            className="group bg-white p-5 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
          >
            <h2 className="font-semibold text-neutral-950">{feature.title}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">{feature.description}</p>
            <span className="mt-5 inline-block text-sm font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-4 group-hover:decoration-neutral-950">
              開く
            </span>
          </Link>
        ))}
        {user.role === 'admin' && (
          <>
            <Link
              to="/settings"
              className="group bg-white p-5 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
            >
              <h2 className="font-semibold text-neutral-950">設定</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                サイトの基本情報を設定します。
              </p>
              <span className="mt-5 inline-block text-sm font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-4 group-hover:decoration-neutral-950">
                開く
              </span>
            </Link>
            <Link
              to="/api-keys"
              className="group bg-white p-5 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
            >
              <h2 className="font-semibold text-neutral-950">API キー</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                外部連携に使う認証キーを管理します。
              </p>
              <span className="mt-5 inline-block text-sm font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-4 group-hover:decoration-neutral-950">
                開く
              </span>
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
