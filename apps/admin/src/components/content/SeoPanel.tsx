import { useQuery } from '@tanstack/react-query'
import { settingsQuery } from '../../api/queries.ts'
import { docHasText, seoChecks, serpModel, truncateMiddle } from '../../lib/seo-check.ts'
import type { ContentFormValue } from './ContentForm.tsx'

/**
 * SEO checklist + SERP preview shown inside ContentForm. Everything is
 * computed client-side; site settings are read best-effort (non-admin
 * editors cannot read them, so the checklist degrades gracefully).
 */
export function SeoPanel({ value, publicPath }: { value: ContentFormValue; publicPath?: string }) {
  const settings = useQuery({ ...settingsQuery, retry: false })
  const site = settings.data?.site
  const siteOg = site?.ogImageMediaId != null
  const title = value.seoTitle.trim() || value.title
  const description = value.seoDescription.trim() || value.excerpt.trim()
  const checks = seoChecks({
    title,
    slug: value.slug,
    description,
    hasOg: value.ogMediaId !== null,
    hasSiteOg: siteOg,
    hasBody: docHasText(value.bodyJson),
  })
  const serp = serpModel({
    siteName: site?.title ?? '',
    origin: window.location.origin,
    publicPath: publicPath ?? `/${value.slug}`,
    title,
    description,
  })

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="border border-neutral-200 bg-white p-5">
        <p className="text-sm font-semibold">SEO チェック</p>
        <ul className="mt-3 space-y-2">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className={
                  check.status === 'ok'
                    ? 'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-green-600'
                    : 'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500'
                }
              />
              <span>
                <span className="font-medium">{check.label}: </span>
                <span className="text-neutral-600">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          文字数は検索結果に表示されやすい目安です。保存の妨げにはなりません。
        </p>
      </div>
      <div className="border border-neutral-200 bg-white p-5">
        <p className="text-sm font-semibold">検索結果プレビュー</p>
        <div className="mt-3 max-w-xl">
          <p className="text-sm text-neutral-800">{serp.siteName}</p>
          <p className="truncate text-xs text-green-800">{serp.breadcrumb}</p>
          <p className="mt-1 truncate text-xl leading-6 text-[#1a0dab]">
            {truncateMiddle(serp.title, 60)}
          </p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-600">{serp.description}</p>
        </div>
      </div>
    </div>
  )
}
