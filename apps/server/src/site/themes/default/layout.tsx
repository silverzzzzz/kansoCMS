import { raw } from 'hono/html'
import { Head } from '../../head.tsx'
import { AccentStyle, FooterExtras } from '../chrome.tsx'
import type { LayoutProps } from '../types.ts'

/**
 * Default theme shell. Styling comes from /themes/default.css in apps/server/public;
 * optional integration scripts are supplied explicitly by the renderer.
 */
export function Layout({
  meta,
  jsonLd,
  nav,
  search,
  scripts = [],
  themeSettings,
  children,
}: LayoutProps) {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang={meta.locale}>
        <head>
          <Head meta={meta} jsonLd={jsonLd} />
          <link rel="stylesheet" href="/themes/default.css" />
          <AccentStyle settings={themeSettings} />
          {scripts.map((src) => (
            <script src={src} async defer></script>
          ))}
        </head>
        <body class="theme-default">
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
            <FooterExtras settings={themeSettings} />
            <small>
              © {new Date().getFullYear()} {meta.siteName}
            </small>
          </footer>
        </body>
      </html>
    </>
  )
}
