import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { analyticsSummaryQuery } from '../../api/queries.ts'
import { PageHeading } from '../../components/PageHeading.tsx'

const DAYS = 30
const CHART_HEIGHT = 160
const BAR_WIDTH = 18
const BAR_GAP = 6

export const Route = createFileRoute('/_auth/analytics')({
  loader: ({ context }) => context.queryClient.ensureQueryData(analyticsSummaryQuery(DAYS)),
  component: AnalyticsPage,
})

/**
 * Cookie-less site analytics (T52): daily PV bar chart (hand-drawn SVG, no
 * chart library) plus the top paths for the same window.
 */
function AnalyticsPage() {
  const summary = useQuery(analyticsSummaryQuery(DAYS))
  const daily = summary.data?.daily ?? []
  const top = summary.data?.top ?? []
  const max = Math.max(1, ...daily.map((row) => row.count))
  const total = daily.reduce((sum, row) => sum + row.count, 0)
  const width = daily.length * (BAR_WIDTH + BAR_GAP) || 1

  return (
    <div>
      <PageHeading
        title="アクセス解析"
        description={`直近 ${DAYS} 日のページビュー (Cookie 不使用)。`}
      />
      <section className="mt-8 border border-neutral-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">日別 PV</h2>
          <p className="text-sm text-neutral-500">合計 {total.toLocaleString()}</p>
        </div>
        {daily.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-500">まだ計測データがありません。</p>
        ) : (
          <svg
            className="mt-6 w-full"
            viewBox={`0 0 ${width} ${CHART_HEIGHT + 24}`}
            role="img"
            aria-label="日別ページビュー"
          >
            {daily.map((row, index) => {
              const height = Math.max(2, Math.round((row.count / max) * CHART_HEIGHT))
              const x = index * (BAR_WIDTH + BAR_GAP)
              return (
                <g key={row.day}>
                  <title>
                    {row.day}: {row.count} PV
                  </title>
                  <rect
                    x={x}
                    y={CHART_HEIGHT - height}
                    width={BAR_WIDTH}
                    height={height}
                    className="fill-neutral-800"
                  />
                  {index % 7 === 0 && (
                    <text x={x} y={CHART_HEIGHT + 16} fontSize="10" className="fill-neutral-500">
                      {row.day.slice(5)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </section>
      <section className="mt-8 border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">ページ別 PV (上位 20)</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 pr-4 font-medium">パス</th>
              <th className="py-2 text-right font-medium">PV</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row) => (
              <tr key={row.path} className="border-b border-neutral-100">
                <td className="py-2 pr-4 font-mono text-xs">{row.path}</td>
                <td className="py-2 text-right tabular-nums">{row.count.toLocaleString()}</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={2} className="py-6 text-center text-neutral-500">
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
