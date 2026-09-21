import type { PageMeta } from '@kanso/seo'
import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { Head } from '../../head.tsx'

export interface NavItem {
  label: string
  href: string
}

export interface LayoutProps {
  meta: PageMeta
  jsonLd?: unknown[]
  nav: NavItem[]
  search: { label: string; placeholder: string; button: string }
  scripts?: string[]
  children: Child
}

/**
 * Default theme shell. Styling comes from /theme.css in apps/server/public;
 * optional integration scripts are supplied explicitly by the renderer.
 */
export function Layout({ meta, jsonLd, nav, search, scripts = [], children }: LayoutProps) {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang={meta.locale}>
        <head>
          <Head meta={meta} jsonLd={jsonLd} />
          <link rel="stylesheet" href="/theme.css" />
          {scripts.map((src) => (
            <script src={src} async defer></script>
          ))}
        </head>
        <body>
          <header class="site-header">
            <a class="site-title" href="/">
              {meta.siteName}
            </a>
            <nav class="site-nav">
              {nav.map((item) => (
                <a href={item.href}>{item.label}</a>
              ))}
            </nav>
            {/* biome-ignore lint/a11y/useSemanticElements: Keep the GET form itself as the search landmark. */}
            <form class="site-search" role="search" action="/search" method="get">
              <label class="visually-hidden" for="site-search-q">
                {search.label}
              </label>
              <input
                id="site-search-q"
                type="search"
                name="q"
                placeholder={search.placeholder}
                maxlength={100}
              />
              <button type="submit">{search.button}</button>
            </form>
          </header>
          <main class="site-main">{children}</main>
          <footer class="site-footer">
            <small>
              © {new Date().getFullYear()} {meta.siteName}
            </small>
          </footer>
        </body>
      </html>
    </>
  )
}
