import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { starterQuery } from '../../api/queries.ts'

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
  const starter = useQuery({ ...starterQuery, enabled: user.role === 'admin' })

  return (
    <div className="flex flex-col gap-8">
      {/* For screen readers; the navigation shows sighted users which screen this is. */}
      <h1 className="sr-only">ダッシュボード</h1>

      {starter.data?.installed && (
        <section className="border border-neutral-200 bg-white p-5">
          <h2 className="font-semibold text-neutral-950">サンプルサイトが入っています</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            トップページや会社概要、お知らせのサンプルを、あなたのサイトの内容に書き換えていきましょう。不要になったら「設定」の「サンプルサイト」から削除できます。
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="text-neutral-950 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950"
            >
              サイトを見る
            </a>
            {starter.data.homePageId !== null && (
              <Link
                to="/customize"
                search={{ page: starter.data.homePageId }}
                className="text-neutral-950 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950"
              >
                トップページをカスタマイズ
              </Link>
            )}
            <Link
              to="/settings"
              className="text-neutral-950 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950"
            >
              サンプルの管理
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-px overflow-hidden border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
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
