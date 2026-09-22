import type { Kanso } from '@kanso/core'
import type { SiteRequestContext } from './context.ts'

interface SearchResultsProps {
  ctx: SiteRequestContext
  q: string
  page: number
  totalPages: number
  result: Awaited<ReturnType<Kanso['search']['search']>> | null
}

export function SearchResults({ ctx, q, page, totalPages, result }: SearchResultsProps) {
  const m = ctx.messages.search
  const pageHref = (target: number) => `/search?q=${encodeURIComponent(q)}&page=${target}`
  return (
    <ctx.theme.Layout
      meta={ctx.meta({ title: m.title, path: '/search', noindex: true })}
      nav={ctx.nav}
      search={ctx.search}
    >
      <section class="page search-results">
        <h1>{m.title}</h1>
        {/* biome-ignore lint/a11y/useSemanticElements: Keep the GET form itself as the search landmark. */}
        <form class="site-search" role="search" action="/search" method="get">
          <label class="visually-hidden" for="search-q">
            {m.label}
          </label>
          <input
            id="search-q"
            type="search"
            name="q"
            value={q}
            placeholder={m.placeholder}
            maxlength={100}
          />
          <button type="submit">{m.button}</button>
        </form>
        {result && (
          <>
            <p>{result.total > 0 ? m.resultCount(result.total) : m.noResults}</p>
            <ul>
              {result.items.map((item) => (
                <li>
                  <a href={`/${item.path}`}>{item.title}</a>
                  <small>
                    {item.kind === 'page' ? m.kindPage : item.typeName} ·{' '}
                    {ctx.formatDate(item.publishedAt)}
                  </small>
                  <p>
                    {item.snippet.map((segment) =>
                      segment.hit ? <mark>{segment.text}</mark> : segment.text,
                    )}
                  </p>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav class="pagination">
                {page > 1 && <a href={pageHref(page - 1)}>{ctx.messages.pagination.newer}</a>}
                {page < totalPages && (
                  <a href={pageHref(page + 1)}>{ctx.messages.pagination.older}</a>
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </ctx.theme.Layout>
  )
}
